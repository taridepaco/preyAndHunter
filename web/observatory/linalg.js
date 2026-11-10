/* Small dense linear algebra for the fits: least squares, eigenvalues of 2×2 and 3×3 matrices. */

export const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;

export function std(v) {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
}

/** Centred moving average over 2k+1 points (shorter at the ends). */
export function smooth(v, k = 1) {
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const lo = Math.max(0, i - k);
    const hi = Math.min(v.length - 1, i + k);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += v[j];
    out[i] = s / (hi - lo + 1);
  }
  return out;
}

/** Solves A x = b (A is n×n, arrays of rows) by Gaussian elimination with partial pivoting. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Least squares y ≈ X b (X: rows of regressors). Columns are scaled internally for conditioning;
 * `ridge` adds a small Tikhonov term on the scaled problem. Returns {b, r2} or null.
 */
export function lstsq(X, y, ridge = 0) {
  const m = X.length;
  const p = X[0].length;
  if (m <= p) return null;
  const scale = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += X[i][j] * X[i][j];
    scale[j] = Math.sqrt(s / m) || 1;
  }
  const A = Array.from({ length: p }, () => new Float64Array(p));
  const v = new Float64Array(p);
  for (let i = 0; i < m; i++) {
    const row = X[i];
    for (let a = 0; a < p; a++) {
      const xa = row[a] / scale[a];
      v[a] += xa * y[i];
      for (let c = a; c < p; c++) A[a][c] += xa * (row[c] / scale[c]);
    }
  }
  for (let a = 0; a < p; a++) {
    A[a][a] += ridge * m;
    for (let c = 0; c < a; c++) A[a][c] = A[c][a];
  }
  const z = solve(A.map((r) => Array.from(r)), Array.from(v));
  if (!z || z.some((x) => !Number.isFinite(x))) return null;
  const b = z.map((x, j) => x / scale[j]);
  return { b, r2: rSquared(X, y, b) };
}

export function rSquared(X, y, b) {
  const my = mean(y);
  let ss = 0;
  let st = 0;
  for (let i = 0; i < X.length; i++) {
    let pred = 0;
    for (let j = 0; j < b.length; j++) pred += X[i][j] * b[j];
    ss += (y[i] - pred) ** 2;
    st += (y[i] - my) ** 2;
  }
  return st > 0 ? 1 - ss / st : 0;
}

/** Eigenvalues of a 2×2 matrix as [{re, im}, {re, im}]. */
export function eigen2(J) {
  const tr = J[0][0] + J[1][1];
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const disc = tr * tr - 4 * det;
  if (disc < 0) return [{ re: tr / 2, im: Math.sqrt(-disc) / 2 }, { re: tr / 2, im: -Math.sqrt(-disc) / 2 }];
  return [{ re: (tr + Math.sqrt(disc)) / 2, im: 0 }, { re: (tr - Math.sqrt(disc)) / 2, im: 0 }];
}

/** Eigenvalues of a 3×3 matrix: one real root by bisection, the other two from the quadratic left. */
export function eigen3(J) {
  const tr = J[0][0] + J[1][1] + J[2][2];
  const m2 = J[0][0] * J[1][1] - J[0][1] * J[1][0] + J[0][0] * J[2][2] - J[0][2] * J[2][0] + J[1][1] * J[2][2] - J[1][2] * J[2][1];
  const det = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) -
    J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) +
    J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
  const f = (l) => ((l - tr) * l + m2) * l - det; // characteristic polynomial
  let hi = 1 + Math.abs(tr) + Math.abs(m2) + Math.abs(det);
  let lo = -hi;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  const r = (lo + hi) / 2;
  const p = r - tr;
  const q = m2 + r * p;
  const disc = p * p - 4 * q;
  const rest = disc < 0
    ? [{ re: -p / 2, im: Math.sqrt(-disc) / 2 }, { re: -p / 2, im: -Math.sqrt(-disc) / 2 }]
    : [{ re: (-p + Math.sqrt(disc)) / 2, im: 0 }, { re: (-p - Math.sqrt(disc)) / 2, im: 0 }];
  return [{ re: r, im: 0 }, ...rest];
}

/** The oscillating pair (largest |im|) of a list of eigenvalues, or null if none oscillates. */
export function oscillation(eigs) {
  const pair = eigs.filter((e) => e.im > 1e-12).sort((a, b) => b.im - a.im)[0];
  return pair ? { damping: pair.re, period: (2 * Math.PI) / pair.im } : null;
}
