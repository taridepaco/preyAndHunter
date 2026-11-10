/*
 * The rules every engine shares: constants, how cells, intents and claims are packed into u32
 * words, the species table and the hash. The GPU engine (world.js + shaders) and the CPU
 * reference (reference.js) both build on this file, so they agree bit for bit.
 *
 * All the state that drives decisions is integer: energy and age are counters, probabilities
 * and grass are Q16 fixed point (65536 = 1), and randomness comes from hashing
 * (cell, tick, seed ^ salt). The same seed therefore gives the same world on any GPU.
 */

export const MAX_SPECIES = 8; // species ids 1..7; 0 means an empty cell
export const Q16 = 65536;
export const GRASS_FULL = Q16;
export const WG = 16; // compute workgroup side (WG×WG invocations)
export const ENERGY_MAX = 4095;
export const AGE_MAX = 4095;
export const NO_SAMPLE = 0xffffffff;

// Cell word: species (bits 0-3) | energy (4-15) | age (16-27) | flags (28-31, unused for now)
export const cellSpecies = (w) => w & 15;
export const cellEnergy = (w) => (w >>> 4) & 4095;
export const cellAge = (w) => (w >>> 16) & 4095;
export const packCell = (s, e, a) =>
  ((s & 15) | (Math.min(e, ENERGY_MAX) << 4) | (Math.min(a, AGE_MAX) << 16)) >>> 0;

// Intent word: dir (bits 0-2) | action (3-5) | leaves a child behind (6)
export const ACT = { STAY: 0, MOVE: 1, ATTACK: 2, DIE: 3 };
export const packIntent = (act, dir, child) => (dir | (act << 3) | (child ? 64 : 0)) >>> 0;
export const intentDir = (w) => w & 7;
export const intentAct = (w) => (w >>> 3) & 7;
export const intentChild = (w) => (w >>> 6) & 1;

// Claim word: valid (bit 0) | action of the winner (1-2) | direction from the cell to the winner (4-6)
export const packClaim = (act, dir) => (1 | (act << 1) | (dir << 4)) >>> 0;
export const claimValid = (w) => w & 1;
export const claimAct = (w) => (w >>> 1) & 3;
export const claimDir = (w) => (w >>> 4) & 7;

/*
 * Directions: 0 1 2 / 3 · 4 / 5 6 7. The opposite of d is 7 - d.
 * Worlds are toroidal and their sides are powers of two, so wrapping is a mask.
 */
export function neighbor(x, y, d, w, h) {
  const k = d >= 4 ? d + 1 : d;
  const nx = (x + (k % 3) + w - 1) & (w - 1);
  const ny = (y + ((k / 3) | 0) + h - 1) & (h - 1);
  return ny * w + nx;
}

// Statistics buffer (u32 each). The snapshot part describes the state after the last tick and is
// cleared every tick; the events part accumulates between two samples.
export const STATS = {
  POP: 0, // [MAX_SPECIES] individuals per species (index 0, empty cells, is not counted)
  GRASS_FULL: 8, // cells with grass fully grown
  GRASS_SUM: 9, // sum of grass >> 10 (64 = a full cell)
  SNAPSHOT_LEN: 16,
  BIRTHS: 16, // [MAX_SPECIES]
  DEATHS: 24, // [MAX_SPECIES] starvation, old age or random death
  PRED: 32, // [MAX_SPECIES * MAX_SPECIES] predator * 8 + prey
  LEN: 96,
};

// Species table: 16 u32 per species.
export const SP = {
  DIET: 0, // bitmask of the species it eats (bit = species id)
  GRAZES: 1, // eats grass
  GRAZE_GAIN: 2, // energy from a fully grown grass cell
  PREY_GAIN: 3, // energy per prey eaten
  METABOLISM: 4, // energy spent per tick (0 = energy does not matter)
  REPRO_ENERGY: 5, // energy needed to leave a child behind when moving (0 = never by energy)
  MAX_ENERGY: 6,
  MAX_AGE: 7, // 0 = no age limit
  MOVE: 8, // Q16 probability of trying to move each tick
  BIRTH: 9, // Q16 probability of trying to reproduce each tick (probabilistic species)
  DEATH: 10, // Q16 probability of dying each tick
  HUNT: 11, // Q16 probability of attacking adjacent prey each tick
  BIRTH_ON_EAT: 12, // a successful attack always leaves a child behind
  SMART: 13, // 1: choose among suitable neighbours; 0: pick a random neighbour and act only if suitable
  INIT_ENERGY: 14, // energy at seeding (0 = random in 1..REPRO_ENERGY or 1..MAX_ENERGY)
  DENSITY: 15, // Q16 initial fraction of cells
  STRIDE: 16,
};

// Global parameters: 16 u32.
export const PARAM = { WIDTH: 0, HEIGHT: 1, SEED: 2, GRASS_ON: 3, GRASS_GROWTH: 4, MIN_GRAZE: 5, NSPECIES: 6, STRIDE: 16 };

// Paint tools
export const TOOL = { ANIMAL: 0, GRASS: 1, ERASE: 2 };

// Independent hash streams
export const SALT = {
  SEED: 0x9e3779b9,
  INTENT_A: 0x85ebca6b,
  INTENT_B: 0xc2b2ae35,
  PRIORITY: 0x27d4eb2f,
  PAINT: 0x165667b1,
};

/** PCG-style 3D hash (Jarzynski & Olano 2020), the same one GameOfLifer uses for its random fill. */
export function pcg3d(x, y, z, out) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Which ticks are sampled, and which ticks start a new events accumulation. */
export const isSampleTick = (t, every) => t % every === 0;
export const clearsEvents = (t, every) => t > 1 && (t - 1) % every === 0;

/** WGSL declarations of the constants above, prepended to every shader. */
export function wgslPrelude() {
  const u = (v) => `${v >>> 0}u`;
  const lines = [
    ['MAX_SPECIES', MAX_SPECIES], ['Q16', Q16], ['GRASS_FULL', GRASS_FULL], ['WG', WG],
    ['NO_SAMPLE', NO_SAMPLE], ['ACT_STAY', ACT.STAY], ['ACT_MOVE', ACT.MOVE], ['ACT_ATTACK', ACT.ATTACK],
    ['ACT_DIE', ACT.DIE], ['STATS_POP', STATS.POP], ['STATS_GRASS_FULL', STATS.GRASS_FULL],
    ['STATS_GRASS_SUM', STATS.GRASS_SUM], ['STATS_SNAPSHOT_LEN', STATS.SNAPSHOT_LEN],
    ['STATS_BIRTHS', STATS.BIRTHS], ['STATS_DEATHS', STATS.DEATHS], ['STATS_PRED', STATS.PRED],
    ['STATS_LEN', STATS.LEN], ['TOOL_ANIMAL', TOOL.ANIMAL], ['TOOL_GRASS', TOOL.GRASS], ['TOOL_ERASE', TOOL.ERASE],
    ['SALT_SEED', SALT.SEED], ['SALT_INTENT_A', SALT.INTENT_A], ['SALT_INTENT_B', SALT.INTENT_B],
    ['SALT_PRIORITY', SALT.PRIORITY], ['SALT_PAINT', SALT.PAINT],
  ];
  return lines.map(([k, v]) => `const ${k}: u32 = ${u(v)};`).join('\n') + '\n';
}

const prob = (p) => Math.max(0, Math.min(Q16, Math.round((p ?? 0) * Q16)));

/**
 * Turns a world description (worlds/*.json) into the GPU tables.
 * Returns { params: Uint32Array(16), table: Uint32Array(MAX_SPECIES * 16), species: [...] }.
 */
export function compileWorld(def, { width, height, seed }) {
  const species = def.species.map((s, i) => ({ ...s, index: i + 1 }));
  if (species.length > MAX_SPECIES - 1) throw new Error(`Como mucho ${MAX_SPECIES - 1} especies.`);
  const byId = new Map(species.map((s) => [s.id, s]));
  const table = new Uint32Array(MAX_SPECIES * SP.STRIDE);
  for (const s of species) {
    const o = s.index * SP.STRIDE;
    let diet = 0;
    for (const id of s.diet ?? []) {
      const prey = byId.get(id);
      if (!prey) throw new Error(`${s.id} come "${id}", que no existe.`);
      diet |= 1 << prey.index;
    }
    table[o + SP.DIET] = diet;
    table[o + SP.GRAZES] = s.grazes ? 1 : 0;
    table[o + SP.GRAZE_GAIN] = s.grazeGain ?? 0;
    table[o + SP.PREY_GAIN] = s.preyGain ?? 0;
    table[o + SP.METABOLISM] = s.metabolism ?? 0;
    table[o + SP.REPRO_ENERGY] = s.reproEnergy ?? 0;
    table[o + SP.MAX_ENERGY] = Math.min(ENERGY_MAX, s.maxEnergy ?? 1);
    table[o + SP.MAX_AGE] = s.maxAge ?? 0;
    table[o + SP.MOVE] = prob(s.move);
    table[o + SP.BIRTH] = prob(s.birth);
    table[o + SP.DEATH] = prob(s.death);
    table[o + SP.HUNT] = prob(s.hunt ?? (diet ? 1 : 0));
    table[o + SP.BIRTH_ON_EAT] = s.birthOnEat ? 1 : 0;
    table[o + SP.SMART] = (s.choice ?? 'smart') === 'smart' ? 1 : 0;
    table[o + SP.INIT_ENERGY] = s.initEnergy ?? 0;
    table[o + SP.DENSITY] = prob(s.density);
  }
  const params = new Uint32Array(PARAM.STRIDE);
  params[PARAM.WIDTH] = width;
  params[PARAM.HEIGHT] = height;
  params[PARAM.SEED] = seed >>> 0;
  const grass = def.grass;
  params[PARAM.GRASS_ON] = grass ? 1 : 0;
  params[PARAM.GRASS_GROWTH] = grass ? Math.ceil(Q16 / Math.max(1, grass.regrowTicks)) : 0;
  params[PARAM.MIN_GRAZE] = grass ? prob(grass.minGraze ?? 1) : Q16;
  params[PARAM.NSPECIES] = species.length;
  return { params, table, species };
}
