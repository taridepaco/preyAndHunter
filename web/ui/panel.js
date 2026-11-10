/* Side panel: species cards with live sliders, and the brush tools. */
import { STATS, TOOL } from '../engine/rules.js';

const fmtInt = (v) => Math.round(v).toLocaleString('es-ES');

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

function slider(control, value, onInput) {
  const digits = decimals(control.step);
  const show = (v) => Number(v).toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const input = el('input', { type: 'range', min: control.min, max: control.max, step: control.step, value });
  const out = el('output', {}, show(value));
  input.addEventListener('input', () => {
    out.textContent = show(input.value);
    onInput(Number(input.value));
  });
  const label = control.unit ? `${control.label} (${control.unit})` : control.label;
  return el('label', { class: 'control' }, label, input, out);
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
    const card = el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'swatch', style: `background:${s.color}` }), el('strong', {}, s.name), count));
    const spec = def.species.find((x) => x.id === s.id);
    for (const c of def.controls ?? []) {
      if (c.species !== s.id) continue;
      card.append(slider(c, spec[c.key], (v) => { spec[c.key] = v; onChange(); }));
    }
    container.append(card);
  }
  let grassCount = null;
  if (def.grass) {
    grassCount = el('span', { class: 'count' }, '—');
    const card = el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'swatch', style: 'background:#4f8a2b' }), el('strong', {}, 'Hierba'), grassCount));
    for (const c of def.controls ?? []) {
      if (!c.grass) continue;
      card.append(slider(c, def.grass[c.grass], (v) => { def.grass[c.grass] = v; onChange(); }));
    }
    container.append(card);
  }
  return {
    update(stats, cells) {
      for (const [index, node] of counts) node.textContent = fmtInt(stats[STATS.POP + index]);
      if (grassCount) grassCount.textContent = `${Math.round((100 * stats[STATS.GRASS_FULL]) / cells)} % madura`;
    },
  };
}

/** Brush tools: one button per species, grass (if the world has it) and erase. */
export function buildTools(container, def, species, { onSelect }) {
  container.innerHTML = '';
  const tools = species.map((s) => ({ label: s.name, color: s.color, tool: TOOL.ANIMAL, species: s.index, id: s.id }));
  if (def.grass) tools.push({ label: 'Hierba', color: '#4f8a2b', tool: TOOL.GRASS, species: 0, id: 'hierba' });
  tools.push({ label: 'Borrar', color: null, tool: TOOL.ERASE, species: 0, id: 'borrar' });
  const buttons = [];
  const select = (t) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.id === t.id));
    onSelect(t);
  };
  for (const t of tools) {
    const b = el('button', { type: 'button', 'aria-pressed': 'false', 'data-id': t.id },
      t.color ? el('span', { class: 'swatch', style: `background:${t.color}` }) : '', t.label);
    b.addEventListener('click', () => select(t));
    buttons.push(b);
    container.append(b);
  }
  const preferred = tools.find((t) => t.id === def.observatory?.predator) ?? tools[0];
  select(preferred);
}
