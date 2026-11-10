/*
 * Canvas charts of the observatory: stacked population panels and the phase portrait.
 * Colours come from the page's tokens (refreshChartColors reads them again when the theme
 * changes); axes and text in --ink and --muted with the system's monospace font. Species lines
 * get a --shade casing so light colours stay readable on the light background.
 */
import { num, t } from '../i18n.js';

export const chartColors = {
  ink: '#1f2a33',
  muted: '#48595f',
  shade: '#1f2a33',
  accent: '#d9442e',
  theory: '#2f7e96',
  grass: '#74b34e',
};

/** Reads the colours from the CSS tokens (system.css and style.css). */
export function refreshChartColors() {
  const css = getComputedStyle(document.documentElement);
  const tokens = { ink: '--ink', muted: '--muted', shade: '--shade', accent: '--accent', theory: '--c-theory', grass: '--sim-grass-hi' };
  for (const [k, name] of Object.entries(tokens)) chartColors[k] = css.getPropertyValue(name).trim() || chartColors[k];
}

const C = chartColors;
const FONT = '"Martian Mono", Consolas, "Courier New", monospace';
const fmt = (v) => num(Math.round(v));

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

function range(values, extra = []) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (const v of extra) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!Number.isFinite(lo)) return [0, 1];
  const span = Math.max(hi - lo, Math.abs(hi) * 0.04, 4);
  const mid = (lo + hi) / 2;
  return [Math.max(0, mid - span * 0.56), mid + span * 0.56];
}

function polyline(g, pts, X, Y) {
  g.beginPath();
  pts.forEach(([a, b], i) => (i ? g.lineTo(X(a), Y(b)) : g.moveTo(X(a), Y(b))));
  g.stroke();
}

/** A coloured line over a darker casing, like an outlined sprite. */
function casedLine(g, pts, X, Y, color, width, d) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = C.shade;
  g.lineWidth = width + 2 * d;
  polyline(g, pts, X, Y);
  g.strokeStyle = color;
  g.lineWidth = width;
  polyline(g, pts, X, Y);
}

/** Populations as stacked panels sharing the time axis, each with its own vertical range. */
export class SeriesChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
  }

  /** panels: [{label, color, values, theory?}] with values of equal length; ticks: span shown. */
  draw(panels, ticks) {
    const d = fitCanvas(this.canvas);
    const { width: w, height: h } = this.canvas;
    const g = this.g;
    g.clearRect(0, 0, w, h);
    if (!panels.length) return;
    const pad = 6 * d;
    const bottom = 16 * d;
    const ph = (h - bottom) / panels.length;
    const n = Math.max(2, panels[0].values.length);
    const X = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
    g.font = `500 ${10 * d}px ${FONT}`;
    g.textBaseline = 'alphabetic';
    panels.forEach((p, k) => {
      const top = k * ph + 6 * d;
      const bot = (k + 1) * ph - 4 * d;
      const [lo, hi] = range(p.values, p.theory ?? []);
      const Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top - 14 * d);
      if (k > 0) {
        g.strokeStyle = C.muted;
        g.lineWidth = d;
        g.setLineDash([2 * d, 3 * d]);
        g.beginPath();
        g.moveTo(0, k * ph);
        g.lineTo(w, k * ph);
        g.stroke();
        g.setLineDash([]);
      }
      if (p.theory) {
        g.strokeStyle = C.theory;
        g.lineWidth = 1.5 * d;
        g.setLineDash([4 * d, 3 * d]);
        polyline(g, p.theory.map((v, i) => [i, v]), X, Y);
        g.setLineDash([]);
      }
      casedLine(g, p.values.map((v, i) => [i, v]), X, Y, p.color, 2 * d, d);
      const last = p.values[p.values.length - 1];
      g.fillStyle = C.muted;
      g.textAlign = 'left';
      g.fillText(p.label, pad, top + 9 * d);
      g.fillStyle = C.ink;
      g.font = `700 ${10 * d}px ${FONT}`;
      g.fillText(last === undefined ? '—' : p.format ? p.format(last) : fmt(last), pad + g.measureText(p.label).width + 8 * d, top + 9 * d);
      g.font = `500 ${10 * d}px ${FONT}`;
      g.fillStyle = C.muted;
      g.textAlign = 'right';
      g.fillText(`${p.format ? p.format(lo) : fmt(lo)} – ${p.format ? p.format(hi) : fmt(hi)}`, w - pad, top + 9 * d);
    });
    g.strokeStyle = C.ink;
    g.lineWidth = 2 * d;
    g.beginPath();
    g.moveTo(0, h - bottom);
    g.lineTo(w, h - bottom);
    g.stroke();
    g.fillStyle = C.muted;
    g.textAlign = 'right';
    g.fillText(t('chart.last', { n: fmt(ticks) }), w - pad, h - 4 * d);
  }
}

/** Prey against predator: the recent trail, the model's equilibrium and its prediction. */
export class PhaseChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
  }

  /**
   * o = {x, y: arrays of counts (trail, oldest first), xLabel, yLabel, xColor, yColor,
   *      eq: [x, y] | null, prediction: [[x, y]…] | null, theory: [[x, y]…] | null, theoryEq: [x, y] | null}
   */
  draw(o) {
    const d = fitCanvas(this.canvas);
    const { width: w, height: h } = this.canvas;
    const g = this.g;
    g.clearRect(0, 0, w, h);
    const L = 54 * d;
    const B = 34 * d;
    const T = 10 * d;
    const R = 12 * d;
    if (o.x.length < 2) {
      g.fillStyle = C.muted;
      g.font = `500 ${11 * d}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(t('chart.wait'), w / 2, h / 2);
      return;
    }
    const xs = [...o.x];
    const ys = [...o.y];
    for (const p of [o.eq, o.theoryEq]) if (p) { xs.push(p[0]); ys.push(p[1]); }
    const [x0, x1] = range(xs);
    const [y0, y1] = range(ys);
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (w - L - R);
    const Y = (v) => h - B - ((v - y0) / (y1 - y0)) * (h - B - T);

    g.lineWidth = 2 * d;
    g.strokeStyle = C.ink;
    g.setLineDash([]);
    g.lineCap = 'square';
    g.beginPath();
    g.moveTo(L, T);
    g.lineTo(L, h - B);
    g.lineTo(w - R, h - B);
    g.stroke();
    g.font = `500 ${10 * d}px ${FONT}`;
    g.fillStyle = C.muted;
    g.textAlign = 'left';
    g.fillText(fmt(x0), L, h - B + 14 * d);
    g.textAlign = 'right';
    g.fillText(fmt(x1), w - R, h - B + 14 * d);
    g.fillText(fmt(y0), L - 6 * d, h - B);
    g.fillText(fmt(y1), L - 6 * d, T + 9 * d);
    g.font = `700 ${10 * d}px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = C.ink;
    g.fillText(o.xLabel, (L + w - R) / 2, h - 6 * d);
    g.save();
    g.translate(14 * d, (T + h - B) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(o.yLabel, 0, 0);
    g.restore();
    // the axis names carry the species colour as a small square, as in the panel
    const tag = (x, y) => {
      g.fillStyle = C.shade;
      g.fillRect(x - 5 * d, y - 5 * d, 10 * d, 10 * d);
    };
    const xw = g.measureText(o.xLabel).width;
    tag((L + w - R) / 2 - xw / 2 - 10 * d, h - 9.5 * d);
    g.fillStyle = o.xColor;
    g.fillRect((L + w - R) / 2 - xw / 2 - 13 * d, h - 12.5 * d, 6 * d, 6 * d);
    const yw = g.measureText(o.yLabel).width;
    tag(10.5 * d, (T + h - B) / 2 + yw / 2 + 10 * d);
    g.fillStyle = o.yColor;
    g.fillRect(7.5 * d, (T + h - B) / 2 + yw / 2 + 7 * d, 6 * d, 6 * d);

    g.save();
    g.beginPath();
    g.rect(L + d, T, w - L - R, h - B - T - d);
    g.clip();
    for (const [p, color] of [[o.theoryEq, C.theory], [o.eq, C.muted]]) {
      if (!p) continue;
      g.strokeStyle = color;
      g.lineWidth = d;
      g.setLineDash([3 * d, 4 * d]);
      g.beginPath();
      g.moveTo(X(p[0]), T);
      g.lineTo(X(p[0]), h - B);
      g.moveTo(L, Y(p[1]));
      g.lineTo(w - R, Y(p[1]));
      g.stroke();
    }
    g.setLineDash([]);
    if (o.theory) {
      g.strokeStyle = C.theory;
      g.lineWidth = 2 * d;
      g.setLineDash([2 * d, 3 * d]);
      polyline(g, o.theory, X, Y);
      g.setLineDash([]);
    }
    g.strokeStyle = C.ink;
    g.lineWidth = 1.6 * d;
    g.lineCap = 'round';
    const n = o.x.length;
    for (let i = 1; i < n; i++) {
      g.globalAlpha = 0.06 + 0.94 * (i / n) ** 1.5; // older samples fade: the trail shows time
      g.beginPath();
      g.moveTo(X(o.x[i - 1]), Y(o.y[i - 1]));
      g.lineTo(X(o.x[i]), Y(o.y[i]));
      g.stroke();
    }
    g.globalAlpha = 1;
    if (o.prediction) {
      g.strokeStyle = C.accent;
      g.lineWidth = 2.5 * d;
      g.setLineDash([6 * d, 4 * d]);
      polyline(g, o.prediction, X, Y);
      g.setLineDash([]);
    }
    // the current state: a square marker with a hard shadow
    const px = Math.round(X(o.x[n - 1]));
    const py = Math.round(Y(o.y[n - 1]));
    const s = 9 * d;
    g.fillStyle = C.shade;
    g.fillRect(px - s / 2 + 2 * d, py - s / 2 + 2 * d, s, s);
    g.fillStyle = C.accent;
    g.fillRect(px - s / 2, py - s / 2, s, s);
    g.strokeStyle = C.ink;
    g.lineWidth = 2 * d;
    g.strokeRect(px - s / 2, py - s / 2, s, s);
    g.restore();
  }
}
