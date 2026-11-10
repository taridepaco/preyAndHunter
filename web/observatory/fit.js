/*
 * Discovering the equations from the population series.
 *
 * Every fit works on densities (fraction of cells) sampled every few ticks. The series are
 * smoothed lightly and differentiated with central differences, and then:
 *   - fitLV: the classic two-species Lotka-Volterra, d ln x/dt = α − βy and d ln y/dt = δx − γ;
 *   - sindy: sparse regression (STLSQ, Brunton, Proctor & Kutz 2016) over a library of candidate
 *     terms. For animals the target is the per-capita growth d ln x/dt with a linear library, which
 *     is the generalized Lotka-Volterra family; for the resource it is dh/dt with products.
 * The discovered model is then analysed: fixed point (Newton), Jacobian, eigenvalues, damping and
 * the period of its oscillations, to compare with what the world actually does.
 */
import { eigen2, eigen3, lstsq, mean, oscillation, smooth, solve, std } from './linalg.js';

/** Smooths the series and differentiates them. t: ticks; vars: {name: densities}. */
export function prepare(t, vars, k = 1) {
  const names = Object.keys(vars);
  const sm = Object.fromEntries(names.map((n) => [n, smooth(vars[n], k)]));
  const rows = [];
  for (let i = 1; i < t.length - 1; i++) {
    const dt = t[i + 1] - t[i - 1];
    const x = {};
    const dx = {};
    const dlog = {};
    let ok = dt > 0;
    for (const n of names) {
      const a = sm[n][i - 1];
      const b = sm[n][i + 1];
      x[n] = sm[n][i];
      dx[n] = (b - a) / dt;
      dlog[n] = a > 0 && b > 0 ? (Math.log(b) - Math.log(a)) / dt : NaN;
      if (!(x[n] > 0)) ok = false;
    }
    if (ok) rows.push({ t: t[i], x, dx, dlog });
  }
  return { names, rows };
}

/** Classic Lotka-Volterra for a prey x and a predator y. Null if the data do not have its shape. */
export function fitLV(prep, x, y) {
  const rows = prep.rows.filter((r) => Number.isFinite(r.dlog[x]) && Number.isFinite(r.dlog[y]));
  if (rows.length < 30) return null;
  const fx = lstsq(rows.map((r) => [1, r.x[y]]), rows.map((r) => r.dlog[x]));
  const fy = lstsq(rows.map((r) => [1, r.x[x]]), rows.map((r) => r.dlog[y]));
  if (!fx || !fy) return null;
  const alpha = fx.b[0];
  const beta = -fx.b[1];
  const gamma = -fy.b[0];
  const delta = fy.b[1];
  const valid = alpha > 0 && beta > 0 && gamma > 0 && delta > 0;
  return {
    alpha, beta, gamma, delta, valid,
    r2: [fx.r2, fy.r2],
    eq: [gamma / delta, alpha / beta],
    period: valid ? (2 * Math.PI) / Math.sqrt(alpha * gamma) : NaN,
  };
}

const termValue = (factors, x) => factors.reduce((p, f) => p * x[f], 1);

/**
 * Sparse identification. spec: [{target, log, terms}] where terms are names like '1', 'c', 'h*c'.
 * threshold is relative: a term survives if its share of the target's scale is at least that.
 */
export function sindy(prep, spec, { threshold = 0.1, ridge = 1e-6, iterations = 10 } = {}) {
  const equations = [];
  for (const eq of spec) {
    const terms = eq.terms.map((name) => ({ name, factors: name === '1' ? [] : name.split('*') }));
    const rows = prep.rows.filter((r) => Number.isFinite(eq.log ? r.dlog[eq.target] : r.dx[eq.target]));
    if (rows.length < 30) return null;
    const X = rows.map((r) => terms.map((tm) => termValue(tm.factors, r.x)));
    const y = rows.map((r) => (eq.log ? r.dlog[eq.target] : r.dx[eq.target]));
    // A term's weight is how much of the target's variation it carries: |coef|·std(term)/std(target).
    // Using spreads rather than raw sizes keeps a nearly constant term (like the grass level) from
    // looking important just because it cancels against the intercept, which is always kept.
    const yScale = std(y) || 1;
    const colScale = terms.map((tm, j) => (tm.factors.length ? std(X.map((row) => row[j])) : Infinity));
    let active = terms.map(() => true);
    let coef = null;
    let r2 = 0;
    for (let it = 0; it < iterations; it++) {
      const idx = active.map((a, j) => (a ? j : -1)).filter((j) => j >= 0);
      if (!idx.length) break;
      const fit = lstsq(X.map((row) => idx.map((j) => row[j])), y, ridge);
      if (!fit) return null;
      coef = terms.map(() => 0);
      idx.forEach((j, k) => { coef[j] = fit.b[k]; });
      r2 = fit.r2;
      const next = active.map((a, j) => a && Math.abs(coef[j] * colScale[j]) / yScale >= threshold);
      if (next.every((a, j) => a === active[j])) break;
      active = next;
    }
    equations.push({
      target: eq.target,
      log: eq.log,
      r2,
      terms: terms.map((tm, j) => ({ ...tm, coef: coef ? coef[j] : 0 })).filter((tm) => tm.coef !== 0),
    });
  }
  return analyse(equations, prep);
}

/** Right-hand side f(x) of a list of equations, as a function of an array in `names` order. */
export function rhs(equations, names) {
  return (arr) => {
    const x = Object.fromEntries(names.map((n, i) => [n, arr[i]]));
    return names.map((n) => {
      const eq = equations.find((e) => e.target === n);
      if (!eq) return 0;
      const s = eq.terms.reduce((acc, tm) => acc + tm.coef * termValue(tm.factors, x), 0);
      return eq.log ? x[n] * s : s;
    });
  };
}

function jacobian(f, x) {
  const n = x.length;
  const f0 = f(x);
  const J = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const h = Math.max(1e-7, Math.abs(x[j]) * 1e-5);
    const xp = x.slice();
    xp[j] += h;
    const f1 = f(xp);
    for (let i = 0; i < n; i++) J[i][j] = (f1[i] - f0[i]) / h;
  }
  return J;
}

/** Fixed point of f by Newton's method from x0 (null if it does not converge to positive values). */
export function fixedPoint(f, x0) {
  let x = x0.slice();
  for (let it = 0; it < 60; it++) {
    const fx = f(x);
    const step = solve(jacobian(f, x), fx.map((v) => -v));
    if (!step) return null;
    let lambda = 1;
    while (lambda > 1e-3 && x.some((v, i) => v + lambda * step[i] <= 0)) lambda /= 2;
    x = x.map((v, i) => v + lambda * step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-12) break;
  }
  const res = Math.max(...f(x).map(Math.abs));
  return Number.isFinite(res) && res < 1e-9 && x.every((v) => v > 0) ? x : null;
}

function analyse(equations, prep) {
  const names = equations.map((e) => e.target);
  const f = rhs(equations, names);
  const x0 = names.map((n) => mean(prep.rows.map((r) => r.x[n])));
  const fp = fixedPoint(f, x0);
  let stability = null;
  if (fp && names.length <= 3) {
    const J = jacobian(f, fp);
    const eig = names.length === 2 ? eigen2(J) : names.length === 3 ? eigen3(J) : [{ re: J[0][0], im: 0 }];
    stability = { eig, oscillation: oscillation(eig), stable: eig.every((e) => e.re < 0) };
  }
  return { names, equations, f, fixedPoint: fp, mean: x0, stability };
}

/** Typical period of the oscillations of x (mean crossings with hysteresis), in ticks. */
export function observedPeriod(t, x) {
  if (x.length < 10) return NaN;
  const m = mean(x);
  const s = std(x);
  const ups = [];
  let armed = false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] < m - 0.3 * s) armed = true;
    else if (armed && x[i] > m + 0.3 * s) {
      ups.push(t[i]);
      armed = false;
    }
  }
  return ups.length > 2 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN;
}
