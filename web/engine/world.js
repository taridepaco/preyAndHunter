/*
 * The world on the GPU: buffers, the three simulation passes, seeding, painting, drawing and the
 * asynchronous readback of statistics. It follows the CPU reference (reference.js) bit for bit.
 *
 * The state lives in two cell buffers used in ping-pong (`cur` holds the current one), plus the
 * grass, intents and claims buffers. Nothing is copied to the CPU except the statistics: a few
 * hundred bytes per sampled tick, read back with mapAsync so the simulation never waits.
 */
import { initGPU, loadModule } from './gpu.js';
import { MAX_SPECIES, NO_SAMPLE, PARAM, Q16, SP, STATS, TOOL, WG, clearsEvents, compileWorld, isSampleTick } from './rules.js';

const TICK_STRIDE = 256; // dynamic uniform offsets must be 256-byte aligned
export const MAX_TICKS_PER_STEP = 512;
const STATS_BYTES = STATS.LEN * 4;
const MAX_IN_FLIGHT = 3;
export const MIN_SIDE = WG; // smallest world side

const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Ground colours until the page sets its theme's (setColors). These are the night set.
const DEFAULT_COLORS = {
  soil: '#17120e',
  bare: '#12222b', // ground of worlds without grass
  grassLo: '#1d3a22',
  grassHi: '#2a6a35',
  outside: '#0a141a',
  ring: '#f1ead0', // the brush outline
};

export { TOOL };

export class World {
  /** Creates the GPU device, compiles the shaders and returns an empty world. */
  static async create(canvas) {
    const { device, adapter } = await initGPU();
    const world = new World(canvas, device, adapter);
    await world._init();
    return world;
  }

  constructor(canvas, device, adapter) {
    this.canvas = canvas;
    this.device = device;
    this.adapter = adapter;
    this.width = 0;
    this.height = 0;
    this.tick = 0;
    this.cur = 0;
    this.generation = 0; // bumped on reseed so late readbacks of an old world are dropped
    this.sampleEvery = 5;
    this.inFlight = 0;
    this.staging = [];
    this.params = new Uint32Array(PARAM.STRIDE);
    this.table = new Uint32Array(MAX_SPECIES * SP.STRIDE);
    this.palette = new Float32Array(MAX_SPECIES * 4);
    this.species = [];
    this.tickData = new Uint32Array((MAX_TICKS_PER_STEP * TICK_STRIDE) / 4);
    this.viewData = new Float32Array(32 + MAX_SPECIES * 4); // the View struct of render.wgsl
    this.colors = {};
    this.setColors(DEFAULT_COLORS);
    this.brushData = new Uint32Array(8);
    this.paintSalt = 1;
    this.onStats = null; // (live: Uint32Array, samples: [{t, stats}]) => void
    this.onLost = null;
    this.lastStats = null;
  }

  async _init() {
    const d = this.device;
    const U = GPUBufferUsage;
    d.lost.then((info) => this.onLost?.(info));
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx = this.canvas.getContext('webgpu');
    this.ctx.configure({ device: d, format: this.format, alphaMode: 'opaque' });

    const [sim, tools, render] = await Promise.all([
      loadModule(d, 'sim.wgsl'), loadModule(d, 'tools.wgsl'), loadModule(d, 'render.wgsl'),
    ]);

    const C = GPUShaderStage.COMPUTE;
    const F = GPUShaderStage.FRAGMENT;
    const entry = (binding, type, visibility = C, extra = {}) => ({ binding, visibility, buffer: { type, ...extra } });
    this.simLayout = d.createBindGroupLayout({
      label: 'sim',
      entries: [
        entry(0, 'uniform'), entry(1, 'uniform'), entry(2, 'read-only-storage'), entry(3, 'storage'),
        entry(4, 'storage'), entry(5, 'storage'), entry(6, 'storage'), entry(7, 'storage'), entry(8, 'storage'),
      ],
    });
    this.tickLayout = d.createBindGroupLayout({
      label: 'tick',
      entries: [entry(0, 'uniform', C, { hasDynamicOffset: true, minBindingSize: 16 })],
    });
    this.toolsLayout = d.createBindGroupLayout({
      label: 'tools',
      entries: [entry(0, 'uniform'), entry(1, 'uniform'), entry(2, 'storage'), entry(3, 'storage'), entry(4, 'uniform')],
    });
    this.renderLayout = d.createBindGroupLayout({
      label: 'render',
      entries: [entry(0, 'uniform', F), entry(1, 'read-only-storage', F), entry(2, 'read-only-storage', F)],
    });

    const simPL = d.createPipelineLayout({ bindGroupLayouts: [this.simLayout, this.tickLayout] });
    const toolsPL = d.createPipelineLayout({ bindGroupLayouts: [this.toolsLayout] });
    const compute = (module, entryPoint, layout) =>
      d.createComputePipelineAsync({ label: entryPoint, layout, compute: { module, entryPoint } });
    [this.pIntent, this.pClaim, this.pApply, this.pSnapshot, this.pSeed, this.pPaint, this.pRender] = await Promise.all([
      compute(sim, 'pass_intent', simPL),
      compute(sim, 'pass_claim', simPL),
      compute(sim, 'pass_apply', simPL),
      compute(sim, 'pass_snapshot', simPL),
      compute(tools, 'tool_seed', toolsPL),
      compute(tools, 'tool_paint', toolsPL),
      d.createRenderPipelineAsync({
        label: 'render',
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
        vertex: { module: render, entryPoint: 'vs' },
        fragment: { module: render, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);

    const buffer = (label, size, usage) => d.createBuffer({ label, size, usage });
    this.paramsBuf = buffer('params', PARAM.STRIDE * 4, U.UNIFORM | U.COPY_DST);
    this.speciesBuf = buffer('species', MAX_SPECIES * SP.STRIDE * 4, U.UNIFORM | U.COPY_DST);
    this.tickBuf = buffer('ticks', MAX_TICKS_PER_STEP * TICK_STRIDE, U.UNIFORM | U.COPY_DST);
    this.statsBuf = buffer('stats', STATS_BYTES, U.STORAGE | U.COPY_SRC | U.COPY_DST);
    this.samplesBuf = buffer('samples', MAX_TICKS_PER_STEP * STATS_BYTES, U.STORAGE | U.COPY_SRC);
    this.brushBuf = buffer('brush', 32, U.UNIFORM | U.COPY_DST);
    this.viewBuf = buffer('view', this.viewData.byteLength, U.UNIFORM | U.COPY_DST);
    this.tickBG = d.createBindGroup({
      layout: this.tickLayout,
      entries: [{ binding: 0, resource: { buffer: this.tickBuf, size: 16 } }],
    });
  }

  /** Side of the largest square world (a power of two) whose buffers this GPU can bind. */
  get maxSide() {
    const lim = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
    return 2 ** Math.floor(Math.log2(Math.sqrt(lim / 4)));
  }

  /**
   * Allocates a w×h world: any whole sizes from MIN_SIDE up, with no more cells than the largest
   * square. Throws a readable error without GPU memory.
   */
  async resize(w, h) {
    if (w === this.width && h === this.height) return;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < MIN_SIDE || h < MIN_SIDE) {
      throw new Error(`El mundo debe medir al menos ${MIN_SIDE}×${MIN_SIDE} celdas.`);
    }
    if (w * h > this.maxSide ** 2) throw new Error(`El máximo de esta GPU es ${this.maxSide}×${this.maxSide}.`);
    const d = this.device;
    const U = GPUBufferUsage;
    this._free();
    d.pushErrorScope('out-of-memory');
    const bytes = w * h * 4;
    const make = (label, usage) => d.createBuffer({ label, size: bytes, usage });
    const S = U.STORAGE | U.COPY_SRC | U.COPY_DST;
    this.cells = [make('cells A', S), make('cells B', S)];
    this.grass = make('grass', S);
    this.intents = make('intents', U.STORAGE);
    this.claims = make('claims', U.STORAGE);
    const err = await d.popErrorScope();
    if (err) {
      this._free();
      throw new Error(`No hay memoria de GPU suficiente para ${w}×${h}.`);
    }
    this.width = w;
    this.height = h;
    this.cur = 0;
    this._bindGroups();
  }

  _free() {
    for (const b of [...(this.cells ?? []), this.grass, this.intents, this.claims]) b?.destroy();
    this.cells = null;
    this.grass = this.intents = this.claims = null;
    this.width = this.height = 0;
  }

  _bindGroups() {
    const d = this.device;
    const bind = (layout, buffers) =>
      d.createBindGroup({ layout, entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    this.simBG = [0, 1].map((p) => bind(this.simLayout, [
      this.paramsBuf, this.speciesBuf, this.cells[p], this.cells[1 - p], this.grass,
      this.intents, this.claims, this.statsBuf, this.samplesBuf,
    ]));
    this.toolsBG = [0, 1].map((p) => bind(this.toolsLayout, [
      this.paramsBuf, this.speciesBuf, this.cells[p], this.grass, this.brushBuf,
    ]));
    this.renderBG = [0, 1].map((p) => bind(this.renderLayout, [this.viewBuf, this.cells[p], this.grass]));
  }

  /** Loads a world description (worlds/*.json) with the given width, height and seed, and seeds it. */
  async load(def, { width, height, seed }) {
    await this.resize(width, height);
    this.def = def;
    this.update(def, seed);
    this.reseed();
  }

  /** Applies a (possibly edited) world description without touching the cells: live parameters. */
  update(def, seed = this.params[PARAM.SEED]) {
    this.def = def;
    const { params, table, species } = compileWorld(def, { width: this.width, height: this.height, seed });
    this.species = species;
    this.params.set(params);
    this.table.set(table);
    this.device.queue.writeBuffer(this.paramsBuf, 0, this.params);
    this.device.queue.writeBuffer(this.speciesBuf, 0, this.table);
    this.palette.fill(0);
    for (const s of species) this.palette.set([...rgb(s.color), 1], s.index * 4);
  }

  /** Ground, outside and brush colours as hex strings ({soil, bare, grassLo, grassHi, outside, ring}). */
  setColors(colors) {
    for (const [k, hex] of Object.entries({ ...DEFAULT_COLORS, ...colors })) {
      if (/^#[0-9a-f]{6}$/i.test(hex)) this.colors[k] = rgb(hex);
    }
  }

  get grassOn() {
    return this.params[PARAM.GRASS_ON] !== 0;
  }

  /** Fills the world at random from the seed and the species densities. */
  reseed(seed = this.params[PARAM.SEED]) {
    this.params[PARAM.SEED] = seed >>> 0;
    this.device.queue.writeBuffer(this.paramsBuf, 0, this.params);
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.statsBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pSeed);
    pass.setBindGroup(0, this.toolsBG[this.cur]);
    pass.dispatchWorkgroups(Math.ceil(this.width / WG), Math.ceil(this.height / WG));
    pass.end();
    this.device.queue.submit([enc.finish()]);
    this.tick = 0;
    this.generation++;
    this.lastStats = null;
  }

  /**
   * Queues n ticks (at most MAX_TICKS_PER_STEP) in one submission and returns how many were queued,
   * or 0 when too many readbacks are still pending: the caller simply tries again next frame.
   * Statistics are read back only when a sampled tick is among them, or when `readback` is set.
   */
  step(n = 1, readback = false) {
    if (this.inFlight >= MAX_IN_FLIGHT) return 0;
    n = Math.min(n, MAX_TICKS_PER_STEP);
    const d = this.device;
    const data = this.tickData;
    const every = this.sampleEvery;
    const sampled = [];
    for (let i = 0; i < n; i++) {
      const t = this.tick + 1 + i;
      const o = (i * TICK_STRIDE) / 4;
      data[o] = t;
      data[o + 1] = isSampleTick(t, every) ? sampled.length : NO_SAMPLE;
      data[o + 2] = clearsEvents(t, every) ? 1 : 0;
      if (data[o + 1] !== NO_SAMPLE) sampled.push(t);
    }
    d.queue.writeBuffer(this.tickBuf, 0, data, 0, (n * TICK_STRIDE) / 4);

    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    // the shaders skip the invocations past the edge when a side is not a multiple of WG
    const gx = Math.ceil(this.width / WG);
    const gy = Math.ceil(this.height / WG);
    for (let i = 0; i < n; i++) {
      pass.setBindGroup(0, this.simBG[this.cur]);
      pass.setBindGroup(1, this.tickBG, [i * TICK_STRIDE]);
      pass.setPipeline(this.pIntent);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(this.pClaim);
      pass.dispatchWorkgroups(gx, gy);
      pass.setPipeline(this.pApply);
      pass.dispatchWorkgroups(gx, gy);
      if (data[(i * TICK_STRIDE) / 4 + 1] !== NO_SAMPLE) {
        pass.setPipeline(this.pSnapshot);
        pass.dispatchWorkgroups(1);
      }
      this.cur ^= 1;
    }
    pass.end();

    if (!sampled.length && !readback) {
      d.queue.submit([enc.finish()]);
      this.tick += n;
      this.lastReadback = Promise.resolve({ live: this.lastStats, samples: [] });
      return n;
    }
    const bytes = (sampled.length + 1) * STATS_BYTES;
    const staging = this.staging.pop() ??
      d.createBuffer({ label: 'stats readback', size: (MAX_TICKS_PER_STEP + 1) * STATS_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(this.statsBuf, 0, staging, 0, STATS_BYTES);
    if (sampled.length) enc.copyBufferToBuffer(this.samplesBuf, 0, staging, STATS_BYTES, sampled.length * STATS_BYTES);
    d.queue.submit([enc.finish()]);
    this.tick += n;
    this.inFlight++;
    const generation = this.generation;
    // Resolves with {live, samples} once the GPU has run these ticks (null for a discarded world).
    this.lastReadback = staging.mapAsync(GPUMapMode.READ, 0, bytes).then(() => {
      const u = new Uint32Array(staging.getMappedRange(0, bytes).slice(0));
      staging.unmap();
      this.staging.push(staging);
      this.inFlight--;
      if (generation !== this.generation) return null;
      const live = u.subarray(0, STATS.LEN);
      this.lastStats = live;
      const samples = sampled.map((t, k) => ({ t, stats: u.subarray((k + 1) * STATS.LEN, (k + 2) * STATS.LEN) }));
      this.onStats?.(live, samples);
      return { live, samples };
    }, (e) => {
      this.inFlight--;
      console.warn('Stats readback failed:', e);
      return null;
    });
    return n;
  }

  /** Paints a disc of radius r (cells) centred on (x, y). tool: TOOL.ANIMAL (with species), GRASS or ERASE. */
  paint(x, y, r, tool, species = 0, density = 0.3) {
    const b = this.brushData;
    b[0] = ((Math.floor(x) % this.width) + this.width) % this.width;
    b[1] = ((Math.floor(y) % this.height) + this.height) % this.height;
    b[2] = Math.max(0, Math.round(r));
    b[3] = tool;
    b[4] = species;
    b[5] = Math.round(Math.min(1, Math.max(0, density)) * Q16);
    b[6] = this.paintSalt++;
    b[7] = 0;
    const d = this.device;
    d.queue.writeBuffer(this.brushBuf, 0, b);
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pPaint);
    pass.setBindGroup(0, this.toolsBG[this.cur]);
    const groups = Math.ceil((2 * b[2] + 1) / WG);
    pass.dispatchWorkgroups(groups, groups);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** Fills the canvas with the colour around the world: what it shows until the world exists. */
  clear() {
    const [r, g, b] = this.colors.outside;
    const enc = this.device.createCommandEncoder();
    enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r, g, b, a: 1 },
        storeOp: 'store',
      }],
    }).end();
    this.device.queue.submit([enc.finish()]);
  }

  /** Draws the world. view = {cx, cy, zoom}: cell at the canvas centre and pixels per cell. */
  draw(view, brush = null) {
    const f = this.viewData;
    f[0] = this.canvas.width;
    f[1] = this.canvas.height;
    f[2] = view.cx;
    f[3] = view.cy;
    f[4] = this.width;
    f[5] = this.height;
    f[6] = view.zoom;
    f[7] = this.grassOn ? 1 : 0;
    if (brush) f.set([brush.x, brush.y, brush.r, 1], 8);
    else f[11] = 0;
    const c = this.colors;
    f.set([...(this.grassOn ? c.soil : c.bare), 1], 12);
    f.set([...c.grassLo, 1], 16);
    f.set([...c.grassHi, 1], 20);
    f.set([...c.outside, 1], 24);
    f.set([...c.ring, 1], 28);
    f.set(this.palette, 32);
    const d = this.device;
    d.queue.writeBuffer(this.viewBuf, 0, f);
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pRender);
    pass.setBindGroup(0, this.renderBG[this.cur]);
    pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
  }

  /** Copies the current cells and grass to the CPU (for tests and fingerprints, not per frame). */
  async readState() {
    const d = this.device;
    const n = this.width * this.height;
    const staging = d.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.cells[this.cur], 0, staging, 0, n * 4);
    enc.copyBufferToBuffer(this.grass, 0, staging, n * 4, n * 4);
    d.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const all = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return { cells: all.subarray(0, n), grass: all.subarray(n) };
  }

  /** Overwrites the current cells (and grass, if given). For tests and hand-made scenarios. */
  writeState(cells, grass = null) {
    this.device.queue.writeBuffer(this.cells[this.cur], 0, cells);
    if (grass) this.device.queue.writeBuffer(this.grass, 0, grass);
  }

  /** Resolves when the GPU has finished everything queued so far. */
  idle() {
    return this.device.queue.onSubmittedWorkDone();
  }
}
