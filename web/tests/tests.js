// Runs the engine scenarios on the GPU and compares every run with the CPU reference.
import { TOOL, cellSpecies } from '../engine/rules.js';
import { World } from '../engine/world.js';
import { compareRuns, fingerprint, parityWorlds, runOnReference, runOnWorld, scenarios } from './scenarios.js';

const list = document.getElementById('results');
const summary = document.getElementById('summary');
const results = [];

async function check(name, fn) {
  const li = document.createElement('li');
  li.textContent = name;
  list.append(li);
  const t0 = performance.now();
  let error = null;
  try {
    await fn();
  } catch (e) {
    error = e.message || String(e);
  }
  const ms = performance.now() - t0;
  li.className = error ? 'bad' : 'ok';
  li.insertAdjacentHTML('beforeend', ` <span class="ms">${ms.toFixed(0)} ms</span>`);
  if (error) {
    const span = document.createElement('span');
    span.className = 'err';
    span.textContent = error;
    li.append(span);
  }
  results.push({ name, ok: !error, error, ms });
}

async function main() {
  let world;
  try {
    world = await World.create(document.getElementById('gpu'));
  } catch (e) {
    summary.textContent = e.message;
    window.testResults = { error: e.message };
    return;
  }

  for (const scn of scenarios) {
    await check(`${scn.name} (GPU)`, async () => {
      const gpu = await runOnWorld(world, scn, [1, 2, 7]);
      scn.check(gpu);
      const diff = compareRuns(gpu, runOnReference(scn));
      if (diff) throw new Error(`Distinto de la referencia: ${diff}`);
    });
  }

  const worlds = await parityWorlds();
  for (const w of worlds) {
    await check(`GPU = referencia bit a bit: ${w.name}, ${w.ticks} ticks en lotes de 1, 3, 64, 200 y 512`, async () => {
      const diff = compareRuns(await runOnWorld(world, w, [1, 3, 64, 200, 512]), runOnReference(w));
      if (diff) throw new Error(diff);
    });
  }

  await check('El pincel rellena exactamente un círculo (también a través del borde del toro) y Borrar lo vacía', async () => {
    const size = 64;
    await world.resize(size, size);
    world.update({ grass: { regrowTicks: 40 }, species: [{ id: 'conejo', color: '#eda100', metabolism: 1, reproEnergy: 12, maxEnergy: 40, move: 1 }] }, 1);
    world.reseed();
    const disc = (cx, cy, r) => {
      const inside = new Set();
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) inside.add((((cy + dy) & (size - 1)) * size) + ((cx + dx) & (size - 1)));
      }
      return inside;
    };
    for (const [cx, cy, r] of [[20, 30, 6], [1, 1, 3]]) {
      world.writeState(new Uint32Array(size * size));
      world.paint(cx, cy, r, TOOL.ANIMAL, 1, 1);
      const { cells } = await world.readState();
      const inside = disc(cx, cy, r);
      cells.forEach((w, i) => {
        if ((cellSpecies(w) === 1) !== inside.has(i)) throw new Error(`Celda ${i % size},${Math.floor(i / size)} mal pintada (pincel en ${cx},${cy}, radio ${r}).`);
      });
      world.paint(cx, cy, r, TOOL.ERASE);
      const after = await world.readState();
      if (after.cells.some((w) => w !== 0)) throw new Error('Borrar ha dejado animales.');
    }
  });

  await check('Determinismo en la GPU: la misma semilla da el mismo mundo tras 1000 ticks, se agrupen como se agrupen', async () => {
    const w = { ...worlds[0], ticks: 1000 };
    const a = await runOnWorld(world, w, [512]);
    const b = await runOnWorld(world, w, [100, 37]);
    if (fingerprint(a.cells, a.grass) !== fingerprint(b.cells, b.grass)) throw new Error('Las huellas no coinciden.');
  });

  const failed = results.filter((r) => !r.ok).length;
  summary.textContent = failed ? `${failed} de ${results.length} pruebas fallan` : `${results.length} pruebas superadas`;
  window.testResults = { passed: results.length - failed, failed, results };
}

main();
