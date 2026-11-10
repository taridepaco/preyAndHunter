/* Prey: wires the GPU world, the view, the side panel and the observatory together. */
import { World } from './engine/world.js';
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
const SIZES = [128, 256, 512, 1024, 2048, 4096];
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

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    preset: p.get('mundo'),
    size: Number(p.get('tam')) || null,
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

const themeBtn = $('theme-btn');
function syncTheme() {
  if (Theme) themeBtn.textContent = t(`theme.${Theme.mode()}`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
}
if (Theme) {
  themeBtn.addEventListener('click', () => Theme.cycle());
  Theme.onChange(syncTheme);
} else {
  themeBtn.hidden = true;
}
onLang(syncTheme);
syncTheme();

async function main() {
  const canvas = $('world');
  let world;
  try {
    world = await World.create(canvas);
  } catch (e) {
    fail(errorText(e));
    return;
  }

  let defs;
  try {
    // relative to this module, so the site also works from a versioned directory (deploy/build.sh)
    const loaded = await Promise.all(PRESETS.map(async (p) => [p.id, await (await fetch(new URL(p.file, import.meta.url))).json()]));
    defs = Object.fromEntries(loaded);
  } catch (e) {
    fail(t('err.worlds', { msg: e.message }));
    return;
  }

  // ---- state -------------------------------------------------------------
  let running = true;
  let rate = 60; // target ticks per second
  let pending = 0; // fractional ticks owed to the clock
  let dirty = true;
  let presetId = null;
  let def = null; // live copy of the world description, edited by the sliders
  let size = 0;
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
    speciesPanel?.update(live, size * size);
  };
  world.onLost = (info) => {
    running = false;
    fail(t('err.lost', { why: info.message || info.reason }));
  };

  // ---- controls ----------------------------------------------------------
  const presetSel = $('preset');
  for (const p of PRESETS) presetSel.add(new Option('', p.id));
  presetSel.addEventListener('change', () => loadPreset(presetSel.value));

  const sizeSel = $('size');
  for (const s of SIZES) if (s <= world.maxSide) sizeSel.add(new Option('', s));
  sizeSel.addEventListener('change', () => changeSize(Number(sizeSel.value)));

  const speedSel = $('speed');
  for (const s of SPEEDS) speedSel.add(new Option('', s, false, s === rate));
  speedSel.addEventListener('change', () => { rate = Number(speedSel.value); });

  function labelOptions() {
    for (const o of presetSel.options) o.text = tx(defs[o.value].name);
    for (const o of sizeSel.options) o.text = `${o.value}² (${cellsLabel(Number(o.value) ** 2)})`;
    for (const o of speedSel.options) o.text = t('speed.opt', { n: num(Number(o.value)) });
  }
  labelOptions();

  const seedInput = $('seed');
  seedInput.addEventListener('change', () => restart(Number(seedInput.value) >>> 0));
  $('new-seed').addEventListener('click', () => restart(randomSeed()));

  const playBtn = $('play');
  function setRunning(on) {
    running = on;
    pending = 0;
    playBtn.classList.toggle('running', on);
    $('play-label').textContent = t(on ? 'pause' : 'play');
  }
  playBtn.addEventListener('click', () => setRunning(!running));
  $('step').addEventListener('click', stepOnce);
  $('reset').addEventListener('click', () => restart(seed));
  $('fit').addEventListener('click', () => view.fit());

  const radius = $('brush-radius');
  radius.addEventListener('input', () => {
    view.radius = Number(radius.value);
    $('brush-radius-out').textContent = radius.value;
    dirty = true;
  });

  // Give the keyboard back to the world after using a button or a list, so a later Space
  // doesn't press that button again (as in GameOfLifer).
  for (const box of document.querySelectorAll('.topbar, .toolbar, .side')) {
    box.addEventListener('click', (e) => e.target.closest('button')?.blur());
    box.addEventListener('change', (e) => { if (e.target.matches('select')) e.target.blur(); });
  }

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
    history.replaceState(null, '', `#${new URLSearchParams({ mundo: presetId, tam: size, semilla: seed })}`);
  }

  function describe() {
    presetSel.value = presetId;
    sizeSel.value = String(size);
    seedInput.value = String(seed);
    $('world-name').textContent = tx(def.name);
    $('world-desc').textContent = tx(def.description);
  }

  function buildPanels() {
    speciesPanel = buildSpeciesPanel($('species'), def, world.species, { onChange: paramsChanged });
    buildTools($('tools'), def, world.species, { onSelect: (sel) => { tool = sel; }, selected: tool?.id });
  }

  async function loadPreset(id, opts = {}) {
    presetId = id;
    def = structuredClone(defs[id]);
    size = Math.min(opts.size ?? def.size ?? 512, world.maxSide);
    seed = opts.seed ?? randomSeed();
    try {
      await world.load(def, { size, seed });
    } catch (e) {
      fail(errorText(e));
      return;
    }
    describe();
    tool = null;
    buildPanels();
    observatory.configure({ def, species: world.species, cells: size * size, sampleEvery: world.sampleEvery, grassOn: world.grassOn });
    view.setWorld(size, size);
    pending = 0;
    writeHash();
    dirty = true;
  }

  async function changeSize(newSize) {
    const previous = size;
    size = newSize;
    try {
      await world.load(def, { size, seed });
    } catch (e) {
      alert(errorText(e));
      size = previous;
      await world.load(def, { size, seed });
    }
    describe();
    observatory.configure({ def, species: world.species, cells: size * size, sampleEvery: world.sampleEvery, grassOn: world.grassOn });
    view.setWorld(size, size);
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
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

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
      const tps = statTicks / ((now - statT) / 1000);
      statTicks = 0;
      statT = now;
      const z = view.zoom >= 1 ? num(view.zoom, oneDecimal) : `1/${num(1 / view.zoom, oneDecimal)}`;
      statsLine.textContent = t('stats', {
        tick: num(world.tick),
        tps: num(Math.round(tps)),
        g: num((tps * size * size) / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        z,
      });
    }
    requestAnimationFrame(frame);
  }

  // ---- start -------------------------------------------------------------
  const start = readHash();
  await loadPreset(defs[start.preset] ? start.preset : PRESETS[0].id, {
    size: SIZES.includes(start.size) ? start.size : undefined,
    seed: start.seed ?? undefined,
  });
  setRunning(true);
  window.prey = { world, view, observatory, get def() { return def; } }; // handy from the console
  requestAnimationFrame(frame);
}

main();
