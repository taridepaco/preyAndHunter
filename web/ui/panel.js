/* Side panel: species cards with live sliders, and the brush tools. */
import { STATS, TOOL } from '../engine/rules.js';
import { num, t, tx } from '../i18n.js';

const fmtInt = (v) => num(Math.round(v));

function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') e.style.cssText = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

let sliders = 0; // ids that tie each slider's label and value to its input

/** Tells the slider's track how far to fill (style.css draws it from --p, 0 to 1). */
export function fillRange(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const p = max > min ? (Number(input.value) - min) / (max - min) : 0;
  input.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
}

function slider(control, value, onInput) {
  const digits = decimals(control.step);
  const show = (v) => num(Number(v), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const id = `slider-${++sliders}`;
  const input = el('input', { type: 'range', id, min: control.min, max: control.max, step: control.step, value });
  const out = el('output', { for: id }, show(value));
  fillRange(input);
  input.addEventListener('input', () => {
    out.textContent = show(input.value);
    onInput(Number(input.value));
  });
  const name = tx(control.label);
  const label = control.unit ? `${name} (${control.unit})` : name;
  // the system's slider: name and value on top, the track below (as in GameOfLifer and Boider)
  return el('div', { class: 'slider' }, el('label', { for: id }, label), out, input);
}

function card(swatch, name, count) {
  return el('div', { class: 'sp' }, el('div', { class: 'sp-head' }, swatch, el('h3', {}, name), count));
}

/**
 * Builds a card per species (and one for the grass) with the sliders the world description
 * declares in `controls`. Changing a slider edits `def` in place and calls onChange().
 * Returns {update(stats, cells)} to refresh the live counts from a statistics record.
 */
export function buildSpeciesPanel(container, def, species, { onChange }) {
  container.innerHTML = '';
  const counts = new Map();
  for (const s of species) {
    const count = el('span', { class: 'count' }, '—');
    counts.set(s.index, count);
    const box = card(el('span', { class: 'swatch', style: `background:${s.color}` }), tx(s.name), count);
    const spec = def.species.find((x) => x.id === s.id);
    for (const c of def.controls ?? []) {
      if (c.species !== s.id) continue;
      box.append(slider(c, spec[c.key], (v) => { spec[c.key] = v; onChange(); }));
    }
    container.append(box);
  }
  let grassCount = null;
  if (def.grass) {
    grassCount = el('span', { class: 'count' }, '—');
    const box = card(el('span', { class: 'swatch grass' }), t('grass'), grassCount);
    for (const c of def.controls ?? []) {
      if (!c.grass) continue;
      box.append(slider(c, def.grass[c.grass], (v) => { def.grass[c.grass] = v; onChange(); }));
    }
    container.append(box);
  }
  return {
    update(stats, cells) {
      for (const [index, node] of counts) node.textContent = fmtInt(stats[STATS.POP + index]);
      if (grassCount) grassCount.textContent = t('grass.mature', { p: Math.round((100 * stats[STATS.GRASS_FULL]) / cells) });
    },
  };
}

/**
 * Brush tools: one chip per species, grass (if the world has it) and erase. `selected` keeps
 * a previous choice by id; otherwise the predator is picked.
 */
export function buildTools(container, def, species, { onSelect, selected = null }) {
  container.innerHTML = '';
  const tools = species.map((s) => ({ label: tx(s.name), color: s.color, tool: TOOL.ANIMAL, species: s.index, id: s.id }));
  if (def.grass) tools.push({ label: t('grass'), swatch: 'grass', tool: TOOL.GRASS, species: 0, id: 'hierba' });
  tools.push({ label: t('erase'), tool: TOOL.ERASE, species: 0, id: 'borrar' });
  const buttons = [];
  const select = (tl) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === tl.id));
    onSelect(tl);
  };
  for (const tl of tools) {
    const swatch = tl.color ? el('span', { class: 'swatch', style: `background:${tl.color}` })
      : tl.swatch ? el('span', { class: `swatch ${tl.swatch}` }) : '';
    const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-id': tl.id }, swatch, tl.label);
    b.addEventListener('click', () => select(tl));
    buttons.push(b);
    container.append(b);
  }
  const preferred = tools.find((tl) => tl.id === selected) ?? tools.find((tl) => tl.id === def.observatory?.predator) ?? tools[0];
  select(preferred);
}
