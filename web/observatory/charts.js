/* Canvas charts of the observatory: stacked population panels and the phase portrait. */

const INK = '#e6edf3';
const MUTED = '#8b98a7';
const FAINT = '#5b6776';
const GRID = '#243040';
const PREDICT = '#ff8f6b';
const THEORY = '#7cc4ff';

const fmt = (v) => Math.round(v).toLocaleString('es-ES');

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
    const bottom = 14 * d;
    const ph = (h - bottom) / panels.length;
    const n = Math.max(2, panels[0].values.length);
    const X = (i) => (i / (n - 1)) * (w - 2 * d) + d;
    g.font = `${11 * d}px system-ui, sans-serif`;
    g.lineJoin = 'round';
    panels.forEach((p, k) => {
      const top = k * ph + 4 * d;
      const bot = (k + 1) * ph - 3 * d;
      const [lo, hi] = range(p.values, p.theory ?? []);
      const Y = (v) => bot - ((v - lo) / (hi - lo)) * (bot - top - 12 * d);
      g.strokeStyle = GRID;
      g.lineWidth = d;
      g.setLineDash([]);
      g.beginPath();
      g.moveTo(0, bot + 1.5 * d);
      g.lineTo(w, bot + 1.5 * d);
      g.stroke();
      if (p.theory) {
        g.strokeStyle = THEORY;
        g.lineWidth = 1.5 * d;
        g.setLineDash([4 * d, 3 * d]);
        polyline(g, p.theory.map((v, i) => [i, v]), X, Y);
        g.setLineDash([]);
      }
      g.strokeStyle = p.color;
      g.lineWidth = 1.6 * d;
      polyline(g, p.values.map((v, i) => [i, v]), X, Y);
      const last = p.values[p.values.length - 1];
      g.fillStyle = MUTED;
      g.textAlign = 'left';
      g.fillText(p.label, 2 * d, top + 9 * d);
      g.fillStyle = INK;
      g.fillText(last === undefined ? '—' : p.format ? p.format(last) : fmt(last), g.measureText(p.label).width + 8 * d, top + 9 * d);
      g.fillStyle = FAINT;
      g.textAlign = 'right';
      g.fillText(`${p.format ? p.format(lo) : fmt(lo)} – ${p.format ? p.format(hi) : fmt(hi)}`, w - 2 * d, top + 9 * d);
    });
    g.fillStyle = FAINT;
    g.textAlign = 'right';
    g.fillText(`últimos ${fmt(ticks)} ticks`, w - 2 * d, h - 2 * d);
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
    const L = 44 * d;
    const B = 30 * d;
    const T = 8 * d;
    const R = 10 * d;
    if (o.x.length < 2) {
      g.fillStyle = MUTED;
      g.font = `${12 * d}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText('Esperando datos…', w / 2, h / 2);
      return;
    }
    const xs = [...o.x];
    const ys = [...o.y];
    for (const p of [o.eq, o.theoryEq]) if (p) { xs.push(p[0]); ys.push(p[1]); }
    const [x0, x1] = range(xs);
    const [y0, y1] = range(ys);
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (w - L - R);
    const Y = (v) => h - B - ((v - y0) / (y1 - y0)) * (h - B - T);

    g.lineWidth = d;
    g.strokeStyle = GRID;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(L, T);
    g.lineTo(L, h - B);
    g.lineTo(w - R, h - B);
    g.stroke();
    g.font = `${11 * d}px system-ui, sans-serif`;
    g.fillStyle = FAINT;
    g.textAlign = 'left';
    g.fillText(fmt(x0), L, h - B + 13 * d);
    g.textAlign = 'right';
    g.fillText(fmt(x1), w - R, h - B + 13 * d);
    g.fillText(fmt(y0), L - 5 * d, h - B);
    g.fillText(fmt(y1), L - 5 * d, T + 9 * d);
    g.textAlign = 'center';
    g.fillStyle = o.xColor;
    g.fillText(o.xLabel, (L + w - R) / 2, h - 6 * d);
    g.save();
    g.translate(12 * d, (T + h - B) / 2);
    g.rotate(-Math.PI / 2);
    g.fillStyle = o.yColor;
    g.fillText(o.yLabel, 0, 0);
    g.restore();

    g.save();
    g.beginPath();
    g.rect(L + d, T, w - L - R, h - B - T);
    g.clip();
    for (const [p, color] of [[o.theoryEq, THEORY], [o.eq, MUTED]]) {
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
      g.strokeStyle = THEORY;
      g.lineWidth = 1.5 * d;
      g.setLineDash([2 * d, 3 * d]);
      polyline(g, o.theory, X, Y);
      g.setLineDash([]);
    }
    g.strokeStyle = INK;
    g.lineWidth = 1.4 * d;
    g.lineCap = 'round';
    const n = o.x.length;
    for (let i = 1; i < n; i++) {
      g.globalAlpha = 0.06 + 0.94 * (i / n) ** 1.5;
      g.beginPath();
      g.moveTo(X(o.x[i - 1]), Y(o.y[i - 1]));
      g.lineTo(X(o.x[i]), Y(o.y[i]));
      g.stroke();
    }
    g.globalAlpha = 1;
    if (o.prediction) {
      g.strokeStyle = PREDICT;
      g.lineWidth = 2 * d;
      g.setLineDash([6 * d, 4 * d]);
      polyline(g, o.prediction, X, Y);
      g.setLineDash([]);
    }
    g.fillStyle = INK;
    g.strokeStyle = '#05070a';
    g.lineWidth = 2 * d;
    g.beginPath();
    g.arc(X(o.x[n - 1]), Y(o.y[n - 1]), 4.5 * d, 0, 2 * Math.PI);
    g.fill();
    g.stroke();
    g.restore();
  }
}

export const CHART_COLORS = { INK, MUTED, PREDICT, THEORY };
