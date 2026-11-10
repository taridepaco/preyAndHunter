/*
 * The observatory: collects the population samples, refits the models every so often and draws
 * the charts and the equations. Models (one tab each):
 *   lv         classic Lotka-Volterra, prey and predator only
 *   resource   Lotka-Volterra plus the grass, with a fixed, interpretable structure
 *   meanfield  the mean-field equation of the lattice model, straight from its parameters
 *   sindy      sparse search for the terms (STLSQ) over a library of candidates
 * Each model is analysed the same way (fixed point, eigenvalues, period, damping) and its
 * prediction from the current state is drawn over the phase portrait.
 */
import { CHART_COLORS, PhaseChart, SeriesChart } from './charts.js';
import { equation, mi, mo, number, rawEquation } from './equations.js';
import { observedPeriod, prepare, sindy } from './fit.js';
import { eigen2, mean, oscillation, smooth } from './linalg.js';
import { latticeFixedPoint, latticeMeanField, rk4 } from './ode.js';
import { Series } from './series.js';

const WINDOW = 400; // samples used by the fits (2000 ticks at one sample every 5)
const MIN_SAMPLES = 100;
const TRAIL = 300; // samples in the phase portrait's trail
const TRAIL_SMOOTH = 2; // the drawn trail is a moving average over 2k+1 samples (the fits use raw data)
const SHOWN = 600; // samples in the time series
const FIT_EVERY_MS = 700;
const PREDICT_TICKS = 600;
const TRANSIENT_AFTER_RESET = 500; // ticks ignored by the fits after a reset…
const TRANSIENT_AFTER_CHANGE = 300; // …and after a parameter change

const fmt = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('es-ES') : '—');
const dec = (v, d = 2) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

function dynamics(stability, observed) {
  const obs = Number.isFinite(observed) ? ` · observado <b>${fmt(observed)}</b>` : '';
  if (!stability) return 'Sin equilibrio con las dos especies vivas.';
  const o = stability.oscillation;
  if (!o) {
    return (stability.stable ? 'No oscila: vuelve al equilibrio sin dar vueltas' : 'No oscila: se aleja del equilibrio') +
      (obs ? ` (periodo${obs})` : '');
  }
  let kind;
  if (Math.abs(o.damping) < 2e-4) kind = 'órbitas cerradas, como en Lotka-Volterra';
  else if (o.damping < 0) kind = `espiral que se amortigua a la mitad cada <b>${fmt(Math.LN2 / -o.damping)}</b> ticks`;
  else kind = `espiral que crece al doble cada <b>${fmt(Math.LN2 / o.damping)}</b> ticks`;
  return `Periodo predicho <b>${fmt(o.period)}</b> ticks${obs} · ${kind}`;
}

export class Observatory {
  /** els: {series, phase, legend, tabs, model} */
  constructor(els) {
    this.els = els;
    this.series = new Series();
    this.seriesChart = new SeriesChart(els.series);
    this.phaseChart = new PhaseChart(els.phase);
    this.threshold = Number(stored('prey.threshold', '0.1'));
    this.tab = stored('prey.tab', 'resource');
    this.models = {};
    this.dataVersion = 0;
    this.fitVersion = -1;
    this.lastFit = 0;
    this.dirty = true;
  }

  /** Sets up a new world: def (live world description), species (compiled), cells, sampleEvery. */
  configure({ def, species, cells, sampleEvery, grassOn }) {
    this.def = def;
    this.cells = cells;
    this.sampleEvery = sampleEvery;
    this.grassOn = grassOn;
    const obs = def.observatory ?? {};
    this.prey = species.find((s) => s.id === obs.prey) ?? species[0];
    this.pred = species.find((s) => s.id === obs.predator) ?? species[1];
    this.tabs = [
      { id: 'lv', label: 'Lotka-Volterra' },
      grassOn ? { id: 'resource', label: 'Con hierba' } : { id: 'meanfield', label: 'Campo medio' },
      { id: 'sindy', label: 'SINDy' },
    ];
    if (!this.tabs.some((t) => t.id === this.tab)) this.tab = this.tabs[1].id;
    this.renderTabs();
    this.reset();
  }

  /** The world was reseeded. */
  reset() {
    this.series.clear();
    this.since = TRANSIENT_AFTER_RESET;
    this.models = {};
    this.touch();
  }

  /** The parameters changed at `tick`: older samples no longer describe the world. */
  changed(def, tick) {
    this.def = def;
    this.since = tick + TRANSIENT_AFTER_CHANGE;
    this.touch();
  }

  push(samples) {
    for (const s of samples) this.series.push(s.t, s.stats);
    if (samples.length) this.touch();
  }

  touch() {
    this.dataVersion++;
    this.dirty = true;
  }

  /** Call every frame: refits (throttled) when there is new data and redraws when needed. */
  frame(now) {
    if (this.fitVersion !== this.dataVersion && now - this.lastFit > FIT_EVERY_MS) {
      this.fit();
      this.fitVersion = this.dataVersion;
      this.lastFit = now;
      this.renderModel();
      this.dirty = true;
    }
    if (this.dirty) {
      this.draw();
      this.dirty = false;
    }
  }

  fitWindow() {
    const s = this.series;
    const N = this.cells;
    const i0 = Math.max(s.indexAt(this.since), s.length - WINDOW);
    const vars = {
      [this.prey.symbol]: s.pop[this.prey.index].slice(i0).map((v) => v / N),
      [this.pred.symbol]: s.pop[this.pred.index].slice(i0).map((v) => v / N),
    };
    if (this.grassOn) vars.h = s.grass.slice(i0).map((v) => v / N);
    return { t: s.t.slice(i0), vars };
  }

  fit() {
    const { t, vars } = this.fitWindow();
    const c = this.prey.symbol;
    const z = this.pred.symbol;
    const m = {
      samples: t.length,
      span: t.length > 1 ? t[t.length - 1] - t[0] : 0,
      observedPeriod: observedPeriod(t, vars[c]),
      mean: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.length ? mean(v) : NaN])),
    };
    if (!this.grassOn) m.meanfield = this.meanField();
    this.models = m;
    if (t.length < MIN_SAMPLES) return;
    if (vars[c].some((v) => v <= 0) || vars[z].some((v) => v <= 0)) {
      m.extinct = true;
      return;
    }
    const prep = prepare(t, vars);
    m.lv = sindy(prep, [
      { target: c, log: true, terms: ['1', z] },
      { target: z, log: true, terms: ['1', c] },
    ], { threshold: 0 });
    if (this.grassOn) {
      m.resource = sindy(prep, [
        { target: c, log: true, terms: ['1', 'h', z] },
        { target: z, log: true, terms: ['1', c] },
        { target: 'h', log: false, terms: ['1', 'h', `h*${c}`] },
      ], { threshold: 0 });
    }
    const library = ['1', c, z, ...(this.grassOn ? ['h'] : [])];
    const spec = [{ target: c, log: true, terms: library }, { target: z, log: true, terms: library }];
    if (this.grassOn) spec.push({ target: 'h', log: false, terms: ['1', 'h', `h*${c}`, `h*${z}`] });
    m.sindy = sindy(prep, spec, { threshold: this.threshold });
  }

  /** The lattice model's mean-field equation, with the world's current parameters. */
  meanField() {
    const prey = this.def.species.find((s) => s.id === this.prey.id);
    const pred = this.def.species.find((s) => s.id === this.pred.id);
    const p = { sigma: prey.birth ?? 0, lambda: pred.hunt ?? 0, mu: pred.death ?? 0 };
    const fp = latticeFixedPoint(p);
    const eig = eigen2(fp.J);
    return {
      params: p,
      f: latticeMeanField(p),
      names: [this.prey.symbol, this.pred.symbol],
      fixedPoint: fp.viable ? [fp.a, fp.b] : null,
      stability: fp.viable ? { eig, oscillation: oscillation(eig), stable: eig.every((e) => e.re < 0) } : null,
    };
  }

  /** Integrates a model from the current state; returns the path in (prey, predator) counts. */
  predict(model) {
    const s = this.series;
    const N = this.cells;
    const last = s.length - 1;
    if (last < 0 || !model?.f) return null;
    const now = { [this.prey.symbol]: s.pop[this.prey.index][last] / N, [this.pred.symbol]: s.pop[this.pred.index][last] / N, h: s.grass[last] / N };
    const x0 = model.names.map((n) => now[n]);
    if (x0.some((v) => !(v > 0))) return null;
    const ic = model.names.indexOf(this.prey.symbol);
    const iz = model.names.indexOf(this.pred.symbol);
    const path = [];
    for (const x of rk4(model.f, x0, 2, PREDICT_TICKS / 2, { every: 2, clampMin: 0 })) {
      if (!x.every((v) => Number.isFinite(v) && v <= 1)) break;
      path.push([x[ic] * N, x[iz] * N]);
    }
    return path;
  }

  draw() {
    const s = this.series;
    const N = this.cells;
    const i0 = Math.max(0, s.length - SHOWN);
    const panels = [
      { label: this.prey.name, color: this.prey.color, values: s.pop[this.prey.index].slice(i0) },
      { label: this.pred.name, color: this.pred.color, values: s.pop[this.pred.index].slice(i0) },
    ];
    if (this.grassOn) {
      panels.push({ label: 'Hierba madura', color: '#5c9e33', values: s.grass.slice(i0).map((v) => (100 * v) / N), format: (v) => `${dec(v, 1)} %` });
    }
    this.seriesChart.draw(panels, Math.max(0, s.length - i0 - 1) * this.sampleEvery);

    const j0 = Math.max(0, s.length - TRAIL - TRAIL_SMOOTH);
    const trail = (col) => Array.from(smooth(col.slice(j0), TRAIL_SMOOTH)).slice(-TRAIL);
    const model = this.models[this.tab];
    const theory = this.tab === 'meanfield';
    const eq = model?.fixedPoint ? [model.fixedPoint[0] * N, model.fixedPoint[1] * N] : null;
    const path = this.predict(model);
    this.phaseChart.draw({
      x: trail(s.pop[this.prey.index]),
      y: trail(s.pop[this.pred.index]),
      xLabel: this.prey.name,
      yLabel: this.pred.name,
      xColor: this.prey.color,
      yColor: this.pred.color,
      eq: theory ? null : eq,
      prediction: theory ? null : path,
      theory: theory ? path : null,
      theoryEq: theory ? eq : null,
    });
  }

  renderTabs() {
    const box = this.els.tabs;
    box.innerHTML = '';
    for (const t of this.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === this.tab));
      b.textContent = t.label;
      b.addEventListener('click', () => {
        this.tab = t.id;
        store('prey.tab', t.id);
        this.renderTabs();
        this.renderModel();
        this.dirty = true;
      });
      box.append(b);
    }
    const theory = this.tab === 'meanfield';
    this.els.legend.innerHTML =
      `<span><i style="border-color:${CHART_COLORS.INK}"></i>Trayectoria real</span>` +
      (theory
        ? `<span><i style="border-color:${CHART_COLORS.THEORY};border-top-style:dotted"></i>Teoría de campo medio desde ahora</span>`
        : `<span><i style="border-color:${CHART_COLORS.PREDICT};border-top-style:dashed"></i>Lo que predice el modelo desde ahora</span>`) +
      `<span><i style="border-color:${theory ? CHART_COLORS.THEORY : CHART_COLORS.MUTED};border-top-style:dashed;border-top-width:1px"></i>Equilibrio</span>`;
  }

  renderModel() {
    const el = this.els.model;
    const m = this.models;
    const N = this.cells;
    const c = this.prey.symbol;
    const z = this.pred.symbol;
    const names = `${c}, ${z}${this.grassOn ? ', h' : ''}`;
    const vars = `${names}: fracción de celdas con ${this.prey.name.toLowerCase()}, ${this.pred.name.toLowerCase()}${this.grassOn ? ' y hierba madura' : ''}`;

    if (this.tab === 'meanfield') {
      el.innerHTML = this.meanFieldHTML(m.meanfield ?? this.meanField(), vars);
      return;
    }
    if (m.extinct) {
      el.innerHTML = '<p class="wait">Una de las especies se ha extinguido: ya no hay ciclo que ajustar.</p>';
      return;
    }
    const model = m[this.tab];
    if (!model) {
      const pct = Math.min(99, Math.round((100 * (m.samples ?? 0)) / MIN_SAMPLES));
      el.innerHTML = `<p class="wait">Recogiendo datos para ajustar las ecuaciones… ${pct} %</p>`;
      return;
    }
    let html = '';
    if (this.tab === 'sindy') {
      html += `<label class="threshold">Umbral de poda <input type="range" min="0" max="0.5" step="0.01" value="${this.threshold}"><output>${dec(this.threshold)}</output></label>`;
    }
    html += `<div class="eqs">${model.equations.map((e) => equation(e.target, e.terms, { log: e.log })).join('')}</div>`;
    const facts = [];
    facts.push(`R²: ${model.equations.map((e) => `${e.target} <b>${dec(e.r2)}</b>`).join(' · ')}`);
    if (this.tab === 'sindy') {
      const kept = model.equations.reduce((k, e) => k + e.terms.length, 0);
      const total = 2 * (this.grassOn ? 4 : 3) + (this.grassOn ? 4 : 0);
      facts.push(`Se quedan <b>${kept}</b> de ${total} términos posibles`);
    }
    const fp = model.fixedPoint;
    facts.push(fp
      ? `Equilibrio: <b>${fmt(fp[0] * N)}</b> ${this.prey.name.toLowerCase()} y <b>${fmt(fp[1] * N)}</b> ${this.pred.name.toLowerCase()} (media observada ${fmt(m.mean[c] * N)} y ${fmt(m.mean[z] * N)})`
      : 'Este modelo no tiene un equilibrio con todas las especies vivas.');
    facts.push(dynamics(model.stability, m.observedPeriod));
    html += `<ul class="facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
    html += `<p class="legend-vars">${vars}. Ajuste sobre los últimos ${fmt(m.span)} ticks.</p>`;
    el.innerHTML = html;
    const slider = el.querySelector('.threshold input');
    if (slider) {
      slider.addEventListener('input', () => {
        this.threshold = Number(slider.value);
        slider.nextElementSibling.textContent = dec(this.threshold);
        store('prey.threshold', String(this.threshold));
      });
      slider.addEventListener('change', () => {
        this.fit();
        this.renderModel();
        this.dirty = true;
      });
    }
  }

  meanFieldHTML(mf, vars) {
    const a = this.prey.symbol;
    const b = this.pred.symbol;
    const { sigma, lambda, mu } = mf.params;
    const D = mo('·');
    const eqA = rawEquation(a, `${number(sigma)}${D}${mi(a)}${D}<mrow>${mo('(')}${number(1)}${mo('−')}${mi(a)}${mo('−')}${mi(b)}${mo(')')}</mrow>${mo('−')}${number(lambda)}${D}${mi(a)}${D}${mi(b)}`);
    const eqB = rawEquation(b, `${number(lambda)}${D}${mi(a)}${D}${mi(b)}${mo('−')}${number(mu)}${D}${mi(b)}`);
    const N = this.cells;
    const m = this.models;
    const facts = [
      `σ = <b>${dec(sigma)}</b>, λ = <b>${dec(lambda)}</b>, μ = <b>${dec(mu, 3)}</b>: los parámetros del mundo, sin ajustar nada`,
    ];
    if (mf.fixedPoint) {
      const obs = Number.isFinite(m.mean?.[a]) ? ` · en la rejilla, media observada <b>${fmt(m.mean[a] * N)}</b> y <b>${fmt(m.mean[b] * N)}</b>` : '';
      facts.push(`Equilibrio teórico: <b>${fmt(mf.fixedPoint[0] * N)}</b> ${this.prey.name.toLowerCase()} y <b>${fmt(mf.fixedPoint[1] * N)}</b> ${this.pred.name.toLowerCase()}${obs}`);
      facts.push(dynamics(mf.stability, m.observedPeriod));
    } else {
      facts.push('Con estos parámetros la teoría dice que los depredadores no sobreviven (μ ≥ λ).');
    }
    facts.push('La teoría supone una sopa bien mezclada. En la rejilla cada animal solo ve a sus vecinos: presas y depredadores forman manchas y el equilibrio real se aparta del teórico.');
    return `<div class="eqs">${eqA}${eqB}</div><ul class="facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul><p class="legend-vars">${vars}.</p>`;
  }
}
