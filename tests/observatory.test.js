// Mathematics of the observatory, checked on synthetic data with a known answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eigen2, eigen3, lstsq, oscillation } from '../web/observatory/linalg.js';
import { lotkaVolterra, lvInvariant, rk4 } from '../web/observatory/ode.js';
import { fitLV, observedPeriod, prepare, sindy } from '../web/observatory/fit.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} frente a ${b}`);

function noise(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5);
}

const LV = { alpha: 0.02, beta: 1.0, gamma: 0.03, delta: 0.8 };

function lvSeries(level = 0.01) {
  const traj = rk4(lotkaVolterra(LV), [0.03, 0.025], 1, 3000, { every: 5 });
  const rnd = noise(7);
  return {
    t: traj.map((_, i) => i * 5),
    x: traj.map((s) => s[0] * (1 + level * rnd())),
    y: traj.map((s) => s[1] * (1 + level * rnd())),
  };
}

test('RK4 conserva la integral primera de Lotka-Volterra', () => {
  const traj = rk4(lotkaVolterra(LV), [0.03, 0.025], 0.5, 4000);
  const v0 = lvInvariant(LV, ...traj[0]);
  const v1 = lvInvariant(LV, ...traj[traj.length - 1]);
  assert.ok(Math.abs(v1 - v0) < 1e-9 * Math.abs(v0), `V pasa de ${v0} a ${v1}`);
});

test('El ajuste de Lotka-Volterra recupera α, β, γ y δ de datos con ruido', () => {
  const { t, x, y } = lvSeries();
  const fit = fitLV(prepare(t, { x, y }), 'x', 'y');
  assert.ok(fit.valid);
  for (const k of ['alpha', 'beta', 'gamma', 'delta']) close(fit[k], LV[k], 0.03, k);
  close(fit.period, (2 * Math.PI) / Math.sqrt(LV.alpha * LV.gamma), 0.03, 'periodo');
});

test('SINDy descarta los términos que sobran y conserva los de Lotka-Volterra', () => {
  const { t, x, y } = lvSeries();
  const model = sindy(prepare(t, { x, y }), [
    { target: 'x', log: true, terms: ['1', 'x', 'y'] },
    { target: 'y', log: true, terms: ['1', 'x', 'y'] },
  ], { threshold: 0.1 });
  const names = (target) => model.equations.find((e) => e.target === target).terms.map((tm) => tm.name).sort();
  assert.deepEqual(names('x'), ['1', 'y']);
  assert.deepEqual(names('y'), ['1', 'x']);
  close(model.fixedPoint[0], LV.gamma / LV.delta, 0.03, 'equilibrio de la presa');
  close(model.fixedPoint[1], LV.alpha / LV.beta, 0.03, 'equilibrio del depredador');
  const osc = model.stability.oscillation;
  close(osc.period, (2 * Math.PI) / Math.sqrt(LV.alpha * LV.gamma), 0.05, 'periodo');
  assert.ok(Math.abs(osc.damping) < 1e-3, `Lotka-Volterra no debería amortiguarse (${osc.damping})`);
});

test('SINDy encuentra la estructura de un modelo con recurso', () => {
  // c' = c(0.15h − 1.2z − 0.03), z' = z(0.8c − 0.025), h' = 0.02(1 − h) − 0.9hc, starting off equilibrium
  const f = ([c, z, h]) => [c * (0.15 * h - 1.2 * z - 0.03), z * (0.8 * c - 0.025), 0.02 * (1 - h) - 0.9 * h * c];
  const traj = rk4(f, [0.08, 0.01, 0.9], 1, 2500, { every: 5 });
  const t = traj.map((_, i) => i * 5);
  const model = sindy(prepare(t, { c: traj.map((s) => s[0]), z: traj.map((s) => s[1]), h: traj.map((s) => s[2]) }), [
    { target: 'c', log: true, terms: ['1', 'c', 'z', 'h'] },
    { target: 'z', log: true, terms: ['1', 'c', 'z', 'h'] },
    { target: 'h', log: false, terms: ['1', 'h', 'h*c', 'h*z'] },
  ], { threshold: 0.1 });
  const names = (target) => model.equations.find((e) => e.target === target).terms.map((tm) => tm.name).sort();
  assert.deepEqual(names('c'), ['1', 'h', 'z']);
  assert.deepEqual(names('z'), ['1', 'c']);
  assert.deepEqual(names('h'), ['1', 'h', 'h*c']);
  assert.ok(model.stability.stable, 'el modelo con recurso debería ser estable');
});

test('Mínimos cuadrados, autovalores y periodo observado', () => {
  const X = Array.from({ length: 50 }, (_, i) => [1, i, i * i]);
  const fit = lstsq(X, X.map(([, i]) => 3 - 2 * i + 0.5 * i * i));
  fit.b.forEach((b, k) => close(b, [3, -2, 0.5][k], 1e-9, `coeficiente ${k}`));
  const [l1, l2] = eigen2([[0, -2], [2, 0]]);
  assert.ok(Math.abs(l1.re) < 1e-12 && Math.abs(Math.abs(l1.im) - 2) < 1e-12 && l2.im === -l1.im);
  const e3 = eigen3([[-1, 0, 0], [0, -0.1, -1], [0, 1, -0.1]]).sort((a, b) => a.re - b.re);
  close(e3[0].re, -1, 1e-9, 'autovalor real');
  const osc = oscillation(e3);
  close(osc.damping, -0.1, 1e-6, 'amortiguamiento');
  close(osc.period, 2 * Math.PI, 1e-6, 'periodo del par complejo');
  const t = Array.from({ length: 2000 }, (_, i) => i);
  close(observedPeriod(t, t.map((v) => Math.sin((2 * Math.PI * v) / 87))), 87, 0.02, 'periodo de un seno');
});
