// Rules of the world, checked on the CPU reference engine. Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fingerprint, parityWorlds, runOnReference, scenarios } from '../web/tests/scenarios.js';
import { STATS } from '../web/engine/rules.js';

for (const scn of scenarios) {
  test(scn.name, () => {
    scn.check(runOnReference(scn));
  });
}

test('La misma semilla da el mismo mundo, y otra semilla da otro', async () => {
  const [w] = await parityWorlds();
  const a = runOnReference(w);
  const b = runOnReference(w);
  const c = runOnReference({ ...w, seed: w.seed + 1 });
  assert.equal(fingerprint(a.cells, a.grass), fingerprint(b.cells, b.grass));
  assert.notEqual(fingerprint(a.cells, a.grass), fingerprint(c.cells, c.grass));
});

test('La pradera por defecto coexiste 4000 ticks en 128×128', async () => {
  const def = JSON.parse(await readFile(new URL('../web/worlds/pradera.json', import.meta.url), 'utf8'));
  for (const seed of [1, 2]) {
    const { samples } = runOnReference({ size: 128, seed, def, ticks: 4000, sampleEvery: 50 });
    const min = (s) => Math.min(...samples.map((x) => x.stats[STATS.POP + s]));
    assert.ok(min(1) > 0 && min(2) > 0, `semilla ${seed}: se ha extinguido una especie`);
  }
});
