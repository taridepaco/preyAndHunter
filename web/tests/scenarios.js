/*
 * Hand-made scenarios with a known outcome. They run on the CPU reference from Node
 * (tests/engine.test.js) and on the GPU from the browser (tests/index.html), so the same rules
 * are checked on both engines.
 */
import { Reference, fingerprint } from '../engine/reference.js';
import { GRASS_FULL, MAX_SPECIES, STATS, cellAge, cellEnergy, cellSpecies, compileWorld, packCell } from '../engine/rules.js';

const RABBIT = 1;
const FOX = 2;
const THIRD = 3;

const species = {
  conejo: { id: 'conejo', color: '#eda100', grazes: true, grazeGain: 4, metabolism: 1, reproEnergy: 12, maxEnergy: 40, move: 1 },
  zorro: { id: 'zorro', color: '#8f84ea', diet: ['conejo'], preyGain: 14, metabolism: 1, reproEnergy: 30, maxEnergy: 70, move: 1 },
  aguila: { id: 'aguila', color: '#e24b4a', diet: ['zorro'], preyGain: 20, metabolism: 1, reproEnergy: 60, maxEnergy: 90, move: 1 },
  muro: { id: 'muro', color: '#888780', maxEnergy: 1, initEnergy: 1, move: 0 },
};

const world = (...ids) => ({ grass: { regrowTicks: 40, minGraze: 1 }, species: ids.map((id) => species[id]) });
const at = (size, x, y) => y * size + x;
const count = (cells, s) => cells.reduce((k, w) => k + (cellSpecies(w) === s ? 1 : 0), 0);

function expect(ok, message) {
  if (!ok) throw new Error(message);
}

export const scenarios = [
  {
    name: 'Un zorro junto a un conejo se lo come',
    size: 16,
    def: world('conejo', 'zorro'),
    ticks: 1,
    setup({ cells }) {
      cells[at(16, 5, 5)] = packCell(FOX, 20, 0);
      cells[at(16, 6, 5)] = packCell(RABBIT, 10, 0);
    },
    check({ cells, stats }) {
      expect(count(cells, RABBIT) === 0, 'el conejo sigue vivo (¿ha escapado?)');
      const f = cells[at(16, 6, 5)];
      expect(cellSpecies(f) === FOX, 'el zorro no está en la celda del conejo');
      expect(cellEnergy(f) === 20 - 1 + 14, `energía del zorro ${cellEnergy(f)}, se esperaba 33`);
      expect(cellAge(f) === 1, 'la edad del zorro no ha aumentado');
      expect(cells[at(16, 5, 5)] === 0, 'la celda de origen del zorro no ha quedado vacía');
      expect(stats[STATS.PRED + FOX * MAX_SPECIES + RABBIT] === 1, 'la caza no se ha contado');
    },
  },
  {
    name: 'Dos animales y un solo hueco: entra uno y el otro se queda',
    size: 16,
    def: world('conejo', 'zorro', 'muro'),
    ticks: 1,
    setup({ cells }) {
      cells.fill(packCell(THIRD, 1, 0));
      cells[at(16, 4, 4)] = packCell(RABBIT, 10, 0);
      cells[at(16, 5, 4)] = 0;
      cells[at(16, 6, 4)] = packCell(RABBIT, 10, 0);
    },
    check({ cells }) {
      expect(count(cells, RABBIT) === 2, `hay ${count(cells, RABBIT)} conejos en vez de 2`);
      expect(cellSpecies(cells[at(16, 5, 4)]) === RABBIT, 'el hueco sigue vacío');
      const left = cellSpecies(cells[at(16, 4, 4)]) === RABBIT;
      const right = cellSpecies(cells[at(16, 6, 4)]) === RABBIT;
      expect(left !== right, 'no se ha quedado exactamente uno en su sitio');
    },
  },
  {
    name: 'Si te atacan no actúas, y un atacante atacado no llega a su presa',
    size: 16,
    def: world('conejo', 'zorro', 'aguila'),
    ticks: 1,
    setup({ cells }) {
      cells[at(16, 6, 5)] = packCell(RABBIT, 10, 0);
      cells[at(16, 5, 5)] = packCell(FOX, 20, 0);
      cells[at(16, 4, 5)] = packCell(THIRD, 30, 0);
    },
    check({ cells }) {
      expect(cellSpecies(cells[at(16, 6, 5)]) === RABBIT, 'el conejo no sigue en su sitio');
      expect(count(cells, RABBIT) === 1, 'el número de conejos ha cambiado');
      expect(count(cells, FOX) === 0, 'el zorro no ha sido cazado');
      expect(cellSpecies(cells[at(16, 5, 5)]) === THIRD, 'el águila no está donde estaba el zorro');
      expect(cells[at(16, 4, 5)] === 0, 'la celda de origen del águila no ha quedado vacía');
    },
  },
  {
    name: 'La hierba sin herbívoros crece hasta el máximo en el tiempo de rebrote',
    size: 16,
    def: world('conejo'),
    ticks: 40,
    sampleEvery: 1,
    setup() {},
    check({ grass, samples }) {
      const full = (t) => samples.find((s) => s.t === t).stats[STATS.GRASS_FULL];
      expect(full(39) === 0, `en el tick 39 ya hay ${full(39)} celdas llenas`);
      expect(full(40) === 256, `en el tick 40 hay ${full(40)} celdas llenas en vez de 256`);
      expect(grass.every((g) => g === GRASS_FULL), 'no toda la hierba está llena');
    },
  },
  {
    name: 'Un zorro solo, sin presas, muere de hambre al agotar su energía',
    size: 16,
    def: world('conejo', 'zorro'),
    ticks: 10,
    sampleEvery: 1,
    setup({ cells }) {
      cells[at(16, 8, 8)] = packCell(FOX, 10, 0);
    },
    check({ samples }) {
      const foxes = (t) => samples.find((s) => s.t === t).stats[STATS.POP + FOX];
      const deaths = (t) => samples.find((s) => s.t === t).stats[STATS.DEATHS + FOX];
      expect(foxes(9) === 1, 'el zorro ha muerto antes de tiempo');
      expect(foxes(10) === 0 && deaths(10) === 1, 'el zorro no ha muerto en el tick 10');
    },
  },
  {
    name: 'Balance: animales(t) = animales(t−1) + nacimientos − muertes − cazados',
    size: 64,
    seed: 7,
    def: { ...world('conejo', 'zorro'), species: [{ ...species.conejo, density: 0.1 }, { ...species.zorro, density: 0.02 }] },
    ticks: 300,
    sampleEvery: 1,
    check({ samples }) {
      const animals = (s) => s[STATS.POP + RABBIT] + s[STATS.POP + FOX];
      for (let k = 1; k < samples.length; k++) {
        const s = samples[k].stats;
        let eaten = 0;
        for (let i = 0; i < MAX_SPECIES * MAX_SPECIES; i++) eaten += s[STATS.PRED + i];
        const births = s[STATS.BIRTHS + RABBIT] + s[STATS.BIRTHS + FOX];
        const deaths = s[STATS.DEATHS + RABBIT] + s[STATS.DEATHS + FOX];
        const expected = animals(samples[k - 1].stats) + births - deaths - eaten;
        expect(animals(s) === expected, `tick ${samples[k].t}: ${animals(s)} animales, el balance da ${expected}`);
      }
    },
  },
];

/** Random worlds used to compare the GPU against the reference bit for bit. */
export async function parityWorlds() {
  const load = async (name) => {
    const url = new URL(`../worlds/${name}.json`, import.meta.url);
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      return JSON.parse(await readFile(url, 'utf8'));
    }
    return (await fetch(url)).json();
  };
  return [
    { name: 'La pradera, 64×64', size: 64, seed: 2026, def: await load('pradera'), ticks: 600, sampleEvery: 5 },
    { name: 'Lotka en rejilla, 64×64', size: 64, seed: 99, def: await load('lotka-rejilla'), ticks: 600, sampleEvery: 5 },
    { name: 'La pradera, 128×128', size: 128, seed: 5, def: await load('pradera'), ticks: 300, sampleEvery: 3 },
  ];
}

function blank(size) {
  return { cells: new Uint32Array(size * size), grass: new Uint32Array(size * size) };
}

/** Runs a scenario on the CPU reference. */
export function runOnReference(scn) {
  const r = new Reference(scn.size, scn.size);
  const { params, table } = compileWorld(scn.def, { width: scn.size, height: scn.size, seed: scn.seed ?? 1 });
  r.setParams(params);
  r.setSpecies(table);
  r.seed();
  if (scn.setup) {
    const st = blank(scn.size);
    scn.setup(st);
    r.cells.set(st.cells);
    r.grass.set(st.grass);
  }
  const samples = [];
  r.step(scn.ticks, scn.sampleEvery ?? 5, (t, stats) => samples.push({ t, stats }));
  return { cells: r.cells, grass: r.grass, stats: r.stats, samples };
}

/**
 * Runs a scenario on a GPU World. batches lists the sizes of the step() calls (cycled), to
 * exercise the per-tick uniforms and sample slots.
 */
export async function runOnWorld(world, scn, batches = [512]) {
  await world.resize(scn.size, scn.size);
  world.sampleEvery = scn.sampleEvery ?? 5;
  world.update(scn.def, scn.seed ?? 1);
  world.reseed();
  if (scn.setup) {
    const st = blank(scn.size);
    scn.setup(st);
    world.writeState(st.cells, st.grass);
  }
  const samples = [];
  let live = null;
  for (let done = 0, b = 0; done < scn.ticks; b++) {
    const n = Math.min(batches[b % batches.length], scn.ticks - done);
    world.step(n, true);
    const res = await world.lastReadback;
    live = res.live.slice();
    for (const s of res.samples) samples.push({ t: s.t, stats: s.stats.slice() });
    done += n;
  }
  const { cells, grass } = await world.readState();
  return { cells, grass, stats: live, samples };
}

/** Describes the first difference between two runs, or returns null if they are identical. */
export function compareRuns(a, b) {
  if (a.samples.length !== b.samples.length) return `número de muestras ${a.samples.length} ≠ ${b.samples.length}`;
  for (let k = 0; k < a.samples.length; k++) {
    if (a.samples[k].t !== b.samples[k].t) return `muestra ${k}: tick ${a.samples[k].t} ≠ ${b.samples[k].t}`;
    for (let i = 0; i < STATS.LEN; i++) {
      if (a.samples[k].stats[i] !== b.samples[k].stats[i]) {
        return `tick ${a.samples[k].t}, estadística ${i}: ${a.samples[k].stats[i]} ≠ ${b.samples[k].stats[i]}`;
      }
    }
  }
  for (const key of ['cells', 'grass']) {
    for (let i = 0; i < a[key].length; i++) {
      if (a[key][i] !== b[key][i]) return `${key}[${i}] = ${a[key][i]} ≠ ${b[key][i]}`;
    }
  }
  return null;
}

export { fingerprint };
