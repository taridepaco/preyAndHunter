/* Ordinary differential equations: a classic fourth-order Runge-Kutta and the models we compare. */

/** Integrates x' = f(x) from x0 with step dt; returns `steps + 1` states, keeping every `every`-th. */
export function rk4(f, x0, dt, steps, { every = 1, clampMin = null } = {}) {
  const n = x0.length;
  let x = Float64Array.from(x0);
  const out = [Array.from(x)];
  const tmp = new Float64Array(n);
  for (let s = 1; s <= steps; s++) {
    const k1 = f(x);
    for (let i = 0; i < n; i++) tmp[i] = x[i] + (dt / 2) * k1[i];
    const k2 = f(tmp);
    for (let i = 0; i < n; i++) tmp[i] = x[i] + (dt / 2) * k2[i];
    const k3 = f(tmp);
    for (let i = 0; i < n; i++) tmp[i] = x[i] + dt * k3[i];
    const k4 = f(tmp);
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      next[i] = x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      if (clampMin !== null && next[i] < clampMin) next[i] = clampMin;
    }
    x = next;
    if (s % every === 0) out.push(Array.from(x));
  }
  return out;
}

/** Classic Lotka-Volterra: x' = αx − βxy, y' = δxy − γy. */
export const lotkaVolterra = ({ alpha, beta, gamma, delta }) => ([x, y]) => [alpha * x - beta * x * y, delta * x * y - gamma * y];

/** Its conserved quantity: constant along every orbit of the classic model. */
export const lvInvariant = ({ alpha, beta, gamma, delta }, x, y) => delta * x - gamma * Math.log(x) + beta * y - alpha * Math.log(y);

/** Mean field of the lattice model (densities a, b): a' = σa(1−a−b) − λab, b' = λab − μb. */
export const latticeMeanField = ({ sigma, lambda, mu }) => ([a, b]) => [sigma * a * (1 - a - b) - lambda * a * b, lambda * a * b - mu * b];

/** Fixed point and Jacobian of the lattice mean field (coexistence branch). */
export function latticeFixedPoint({ sigma, lambda, mu }) {
  const a = mu / lambda;
  const b = (sigma * (1 - a)) / (sigma + lambda);
  const J = [
    [sigma * (1 - 2 * a - b) - lambda * b, -sigma * a - lambda * a],
    [lambda * b, lambda * a - mu],
  ];
  return { a, b, J, viable: a < 1 && b > 0 };
}
