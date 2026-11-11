/* Prey: wires the GPU world, the view, the side panel and the observatory together. */
import { MIN_SIDE, World } from './engine/world.js';
import { applyStatic, bindLangSwitch, num, onLang, t, tx } from './i18n.js';
import { refreshChartColors } from './observatory/charts.js';
import { Observatory } from './observatory/observatory.js';
import { buildSpeciesPanel, buildTools, fillRange } from './ui/panel.js';
import { View } from './ui/view.js';

const PRESETS = [
  { id: 'pradera', file: 'worlds/pradera.json' },
  { id: 'lotka', file: 'worlds/lotka-rejilla.json' },
];
const SPEEDS = [1, 2, 5, 10, 30, 60, 120, 240, 480, 960, 1920, 3840];
const SIZES = [128, 256, 512, 1024, 2048, 4096]; // the square worlds of the size list, after "Screen"
const MAX_STEPS_PER_FRAME = 256;

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const Theme = window.Theme; // theme.js, loaded in <head>
const errorBox = $('error');
const randomSeed = () => Math.floor(Math.random() * 1e9);

function fail(msg) {
  $('error-msg').textContent = msg;
  errorBox.hidden = false;
}

/** Engine errors that a visitor can meet carry a code with a translated text. */
const errorText = (e) => (e.code ? t(`err.${e.code}`) : e.message);

function cellsLabel(n) {
  return n >= 1e6 ? `${num(n / 1e6, { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1e3)} k`;
}

/** A world size in the URL: "512" for a square, "579x604" for any other. */
function parseSize(text) {
  const m = /^(\d+)(?:x(\d+))?$/.exec(text ?? '');
  return m ? { w: Number(m[1]), h: Number(m[2] ?? m[1]) } : null;
}
const sizeText = ({ w, h }) => (w === h ? String(w) : `${w}x${h}`);

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    preset: p.get('mundo'),
    size: parseSize(p.get('tam')),
    seed: p.has('semilla') ? Number(p.get('semilla')) >>> 0 : null,
  };
}

/** The world's ground colours for the current theme: the --sim-* tokens of style.css. */
function simColors() {
  const css = getComputedStyle(root);
  const get = (name) => css.getPropertyValue(name).trim();
  return {
    soil: get('--sim-soil'),
    bare: get('--sim-bare'),
    grassLo: get('--sim-grass-lo'),
    grassHi: get('--sim-grass-hi'),
    outside: get('--sim-outside'),
    ring: get('--ink'),
  };
}

// ---- page chrome: texts, language and theme, ready before the GPU starts -------------------
applyStatic();
bindLangSwitch();
for (const r of document.querySelectorAll('input[type="range"]')) fillRange(r);
document.addEventListener('input', (e) => { if (e.target.matches('input[type="range"]')) fillRange(e.target); });

const themeBtns = document.querySelectorAll('.theme-btn'); // top bar, and the panel on phones
function syncTheme() {
  if (Theme) for (const b of themeBtns) b.textContent = t(`theme.${Theme.mode()}`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
}
if (Theme) {
  for (const b of themeBtns) b.addEventListener('click', () => Theme.cycle());
  Theme.onChange(syncTheme);
} else {
  for (const b of themeBtns) b.hidden = true;
}
onLang(syncTheme);
syncTheme();

// Give the keyboard back to the world after using a button or a list, so a later Space doesn't
// press that button again or open the list (as in GameOfLifer).
document.addEventListener('click', (e) => e.target.closest('button, summary')?.blur());
document.addEventListener('change', (e) => {
  if (e.target.matches('select, input[type="checkbox"], input[type="radio"]')) e.target.blur();
});

// The "screen" world takes the size of the canvas, and the canvas only has its final size once
// the web fonts are in: they change the width of the folded panel and the height of the top bar.
// Waits for them, 1.5 s at most.
const fontsReady = document.fonts && document.fonts.ready
  ? Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 1500))])
  : Promise.resolve();

async function main() {
  const canvas = $('world');
  let world;
  try {
    world = await World.create(canvas);
  } catch (e) {
    fail(errorText(e));
    return;
  }
  // until the world exists, the canvas shows the colour around it
  world.setColors(simColors());
  world.clear();

  let defs;
  try {
    // relative to this module, so the site also works from a versioned directory (deploy/build.sh)
    const loaded = await Promise.all(PRESETS.map(async (p) => [p.id, await (await fetch(new URL(p.file, import.meta.url))).json()]));
    defs = Object.fromEntries(loaded);
  } catch (e) {
    fail(t('err.worlds', { msg: e.message }));
    return;
  }

  // The controls wait for the fonts too: until then they have no listeners and do nothing.
  await fontsReady;

  // ---- state -------------------------------------------------------------
  let running = true;
  let rate = 60; // target ticks per second
  let pending = 0; // fractional ticks owed to the clock
  let dirty = true;
  let presetId = null;
  let def = null; // live copy of the world description, edited by the sliders
  let dims = { w: 0, h: 0 }; // the world's width and height in cells
  let sizeValue = 'screen'; // value of the size list for the current world
  let seed = 0;
  let tool = null;
  let speciesPanel = null;

  const view = new View(canvas, { onPaint: paint, onChange: () => { dirty = true; } });
  refreshChartColors();
  const observatory = new Observatory({
    series: $('series'), phase: $('phase'), legend: $('phase-legend'), tabs: $('model-tabs'), model: $('model'),
  });
  world.setColors(simColors());

  world.onStats = (live, samples) => {
    observatory.push(samples);
    speciesPanel?.update(live, dims.w * dims.h);
  };
  world.onLost = (info) => {
    running = false;
    fail(t('err.lost', { why: info.message || info.reason }));
  };

  // ---- controls ----------------------------------------------------------
  const presetSel = $('preset');
  for (const p of PRESETS) presetSel.add(new Option('', p.id));
  presetSel.addEventListener('change', () => loadPreset(presetSel.value));

  // World shaped like the canvas (the default, "Screen"), made of cells of a whole number c of
  // device pixels, so view.fit() draws it at exactly c pixels per cell, aligned with the pixels:
  // every cell is an exact square and there is no moiré. c is the device pixels of the longer side
  // of the canvas divided by a target of cells, rounded, and at least 2: the target is the smallest
  // power of two that covers the longer side in CSS pixels, between 256 and 1024. A computer gets
  // c = 2, a phone 2 or 3. The same rule as GameOfLifer's screenBoard().
  function screenWorld() {
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return { w: 512, h: 512 };
    // the same device size that view.resize() gives the canvas
    const dw = Math.max(1, Math.round(cw * dpr));
    const dh = Math.max(1, Math.round(ch * dpr));
    let target = 256;
    while (target < Math.max(cw, ch) && target < 1024) target *= 2;
    const long = Math.max(dw, dh);
    const c = Math.max(2, Math.round(long / target), Math.ceil(long / world.maxSide));
    return { w: Math.max(MIN_SIDE, Math.floor(dw / c)), h: Math.max(MIN_SIDE, Math.floor(dh / c)) };
  }
  let screenDims = screenWorld();

  // The size list: "Screen", then a size that came in a link (when it is neither of the others),
  // then the squares.
  const sizeSel = $('size');
  sizeSel.add(new Option('', 'screen'));
  for (const s of SIZES) if (s <= world.maxSide) sizeSel.add(new Option('', s));
  sizeSel.addEventListener('change', () => {
    if (sizeSel.value === 'screen') { screenDims = screenWorld(); labelOptions(); } // the canvas may have changed
    changeSize(sizeSel.value);
  });
  const dimsOf = (value) => (value === 'screen' ? screenDims : parseSize(value));

  /** The value of the size list for a size from a link, adding it to the list when it is new. */
  function sizeValueFor(d) {
    if (!d || d.w < MIN_SIDE || d.h < MIN_SIDE || d.w * d.h > world.maxSide ** 2) return 'screen';
    const text = sizeText(d);
    if ([...sizeSel.options].some((o) => o.value === text)) return text;
    if (d.w === screenDims.w && d.h === screenDims.h) return 'screen';
    sizeSel.add(new Option('', text), 1);
    return text;
  }

  const speedSel = $('speed');
  for (const s of SPEEDS) speedSel.add(new Option('', s, false, s === rate));
  speedSel.addEventListener('change', () => { rate = Number(speedSel.value); });

  function labelOptions() {
    for (const o of presetSel.options) o.text = tx(defs[o.value].name);
    for (const o of sizeSel.options) {
      const { w, h } = dimsOf(o.value);
      const cells = cellsLabel(w * h);
      o.text = o.value === 'screen' ? `${t('size.screen')}: ${w}×${h} (${cells})` : w === h ? `${w}² (${cells})` : `${w}×${h} (${cells})`;
    }
    for (const o of speedSel.options) o.text = t('speed.opt', { n: num(Number(o.value)) });
  }
  labelOptions();

  const seedInput = $('seed');
  seedInput.addEventListener('change', () => restart(Number(seedInput.value) >>> 0));

  // Play/Pause, Step and Restart are in the panel and in the phone's deck: one handler per
  // action, and both copies of Play change together.
  const playBtns = document.querySelectorAll('[data-act="play"]');
  function setRunning(on) {
    running = on;
    pending = 0;
    for (const b of playBtns) {
      const label = b.querySelector('span');
      label.dataset.i18n = on ? 'pause' : 'play';
      label.textContent = t(label.dataset.i18n);
      b.dataset.running = on;
    }
  }
  const ACTIONS = {
    play: () => setRunning(!running),
    step: stepOnce,
    fit: () => view.fit(),
    reset: () => restart(seed),
    seed: () => restart(randomSeed()),
  };
  for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', ACTIONS[b.dataset.act]);

  const radius = $('brush-radius');
  radius.addEventListener('input', () => {
    view.radius = Number(radius.value);
    $('brush-radius-out').textContent = radius.value;
    dirty = true;
  });

  // The charts live in the panel: draw them again when they change size (folding or opening the
  // panel, turning the phone).
  const charts = new ResizeObserver(() => observatory.restyle());
  charts.observe($('series-wrap'));
  charts.observe($('phase-wrap'));

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); setRunning(!running); }
    else if (k === 'n') stepOnce();
    else if (k === 'r') restart(seed);
    else if (k === 's') restart(randomSeed());
    else if (k === 'f') view.fit();
    else if (k === '+' || k === '=') view.zoomAt(canvas.width / 2, canvas.height / 2, 1.25);
    else if (k === '-') view.zoomAt(canvas.width / 2, canvas.height / 2, 0.8);
  });

  // ---- theme and language --------------------------------------------------
  Theme?.onChange(() => {
    world.setColors(simColors());
    refreshChartColors();
    observatory.restyle();
    dirty = true;
  });

  onLang(() => {
    labelOptions();
    describe();
    setRunning(running);
    buildPanels();
    observatory.relabel();
  });

  // ---- actions -----------------------------------------------------------
  function writeHash() {
    history.replaceState(null, '', `#${new URLSearchParams({ mundo: presetId, tam: sizeText(dims), semilla: seed })}`);
  }

  function describe() {
    presetSel.value = presetId;
    sizeSel.value = sizeValue;
    seedInput.value = String(seed);
    $('world-desc').textContent = tx(def.description);
  }

  function buildPanels() {
    speciesPanel = buildSpeciesPanel($('species'), def, world.species, { onChange: paramsChanged });
    buildTools($('tools'), def, world.species, { onSelect: (sel) => { tool = sel; }, selected: tool?.id });
  }

  /** Loads a world description at the size chosen in the list (which a new world keeps). */
  async function loadPreset(id, opts = {}) {
    presetId = id;
    def = structuredClone(defs[id]);
    seed = opts.seed ?? randomSeed();
    try {
      await world.load(def, { width: dims.w, height: dims.h, seed });
    } catch (e) {
      fail(errorText(e));
      return;
    }
    tool = null;
    buildPanels();
    afterLoad();
  }

  /** New world of the same description and seed for a value of the size list. */
  async function changeSize(value) {
    const previous = { dims, value: sizeValue };
    try {
      dims = dimsOf(value);
      sizeValue = value;
      await world.load(def, { width: dims.w, height: dims.h, seed });
    } catch (e) {
      alert(errorText(e));
      ({ dims, value: sizeValue } = previous);
      await world.load(def, { width: dims.w, height: dims.h, seed });
    }
    afterLoad();
  }

  function afterLoad() {
    describe();
    observatory.configure({ def, species: world.species, cells: dims.w * dims.h, sampleEvery: world.sampleEvery, grassOn: world.grassOn });
    view.setWorld(dims.w, dims.h);
    pending = 0;
    writeHash();
    dirty = true;
  }

  function restart(newSeed) {
    seed = newSeed >>> 0;
    seedInput.value = String(seed);
    world.reseed(seed);
    observatory.reset();
    pending = 0;
    writeHash();
    dirty = true;
  }

  function paramsChanged() {
    world.update(def);
    observatory.changed(def, world.tick);
    dirty = true;
  }

  function stepOnce() {
    setRunning(false);
    world.step(1, true);
    dirty = true;
  }

  function paint(x, y) {
    if (!tool) return;
    world.paint(x, y, view.radius, tool.tool, tool.species, 0.3);
    dirty = true;
  }

  // ---- loop --------------------------------------------------------------
  const statsLine = $('stats');
  let last = performance.now();
  let statT = last;
  let statTicks = 0;
  let tps = 0;
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  const narrow = window.matchMedia('(max-width: 720px)'); // phones: one short line, without Gcells/s

  function paintStats() {
    const z = view.zoom >= 1 ? num(view.zoom, oneDecimal) : `1/${num(1 / view.zoom, oneDecimal)}`;
    statsLine.textContent = t(narrow.matches ? 'stats.narrow' : 'stats', {
      tick: num(world.tick),
      tps: num(Math.round(tps)),
      g: num((tps * dims.w * dims.h) / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      z,
    });
  }
  onLang(paintStats);

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (view.resize()) dirty = true;
    if (running) {
      pending += rate * dt;
      const n = Math.min(Math.floor(pending), MAX_STEPS_PER_FRAME);
      if (n > 0) {
        const done = world.step(n);
        pending = Math.min(pending - done, MAX_STEPS_PER_FRAME);
        statTicks += done;
        if (done) dirty = true;
      }
    }
    if (dirty) {
      world.draw(view, view.brush);
      dirty = false;
    }
    observatory.frame(now);
    if (now - statT > 500) {
      tps = statTicks / ((now - statT) / 1000);
      statTicks = 0;
      statT = now;
      paintStats();
    }
    requestAnimationFrame(frame);
  }

  // ---- start -------------------------------------------------------------
  // The world, its size and its seed come from the link when it has them; the size is "Screen"
  // otherwise.
  const start = readHash();
  sizeValue = sizeValueFor(start.size);
  dims = dimsOf(sizeValue);
  labelOptions();
  await loadPreset(defs[start.preset] ? start.preset : PRESETS[0].id, { seed: start.seed ?? undefined });
  setRunning(true); // starts playing as soon as the page opens
  window.prey = { world, view, observatory, get def() { return def; } }; // handy from the console
  requestAnimationFrame(frame);
}

main();
