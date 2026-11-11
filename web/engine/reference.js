/*
 * CPU reference engine. It runs the same three passes as the GPU shaders (sim.wgsl) with the
 * same integer arithmetic and the same hash, so after any number of ticks its cells, grass and
 * statistics must match the GPU exactly. The tests rely on that, and it is handy to explore
 * parameters from Node without a browser.
 *
 * One tick, for every cell at once (each cell is written by exactly one invocation):
 *   1. intent:  each animal looks at the snapshot and decides to stay, move to an empty
 *               neighbour, attack an adjacent prey or die.
 *   2. claim:   each cell picks one winner among the animals that target it (random priority).
 *   3. apply:   each cell writes its final state from its own claim and its neighbours' claims.
 *               An animal under attack does not act; a winner only arrives if it is not under
 *               attack itself; an animal that leaves may leave a child behind.
 */
import {
  ACT, GRASS_FULL, MAX_SPECIES, PARAM, SALT, SP, STATS,
  cellAge, cellEnergy, clearsEvents, isSampleTick, neighbor, packCell, packClaim, packIntent, pcg3d,
} from './rules.js';

export class Reference {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.n = width * height;
    this.cells = new Uint32Array(this.n);
    this.next = new Uint32Array(this.n);
    this.grass = new Uint32Array(this.n);
    this.intents = new Uint32Array(this.n);
    this.claims = new Uint32Array(this.n);
    this.stats = new Uint32Array(STATS.LEN);
    this.params = new Uint32Array(PARAM.STRIDE);
    this.table = new Uint32Array(MAX_SPECIES * SP.STRIDE);
    this.tick = 0;
    this.nb = new Int32Array(this.n * 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let d = 0; d < 8; d++) this.nb[(y * width + x) * 8 + d] = neighbor(x, y, d, width, height);
      }
    }
    this.h1 = new Uint32Array(3);
    this.h2 = new Uint32Array(3);
    this.list = new Int32Array(8);
  }

  setParams(params) {
    this.params.set(params);
    this.params[PARAM.WIDTH] = this.width;
    this.params[PARAM.HEIGHT] = this.height;
  }

  setSpecies(table) {
    this.table.set(table);
  }

  /** Random initial world from the seed and the species densities (mirrors `seed` in tools.wgsl). */
  seed() {
    const { cells, grass, table, params, h1 } = this;
    const salt = (params[PARAM.SEED] ^ SALT.SEED) >>> 0;
    const grassOn = params[PARAM.GRASS_ON];
    const ns = params[PARAM.NSPECIES];
    for (let c = 0; c < this.n; c++) {
      pcg3d(c, 0, salt, h1);
      grass[c] = grassOn ? (h1[0] & 1 ? GRASS_FULL : h1[0] >>> 16) : 0;
      const r = h1[1] >>> 16;
      let acc = 0;
      let s = 0;
      for (let i = 1; i <= ns; i++) {
        acc += table[i * SP.STRIDE + SP.DENSITY];
        if (r < acc) { s = i; break; }
      }
      cells[c] = s ? packCell(s, this.initEnergy(s, h1[2]), 0) : 0;
    }
    this.stats.fill(0);
    this.tick = 0;
  }

  initEnergy(s, r) {
    const o = s * SP.STRIDE;
    const maxE = Math.max(1, this.table[o + SP.MAX_ENERGY]);
    const init = this.table[o + SP.INIT_ENERGY];
    const repro = this.table[o + SP.REPRO_ENERGY];
    const e = init > 0 ? init : 1 + (r % Math.max(1, repro > 0 ? repro : maxE));
    return Math.min(e, maxE);
  }

  /** Runs n ticks. onSample(tick, statsCopy) is called on every sampled tick. */
  step(n = 1, sampleEvery = 5, onSample = null) {
    for (let i = 0; i < n; i++) {
      const t = ++this.tick;
      this._tick(t, clearsEvents(t, sampleEvery));
      if (onSample && isSampleTick(t, sampleEvery)) onSample(t, this.stats.slice());
    }
  }

  _tick(t, clearEvents) {
    const { n, cells, next, grass, intents, claims, stats, table, params, nb, h1, h2, list } = this;
    const seed = params[PARAM.SEED];
    stats.fill(0, 0, STATS.SNAPSHOT_LEN);
    if (clearEvents) stats.fill(0, STATS.SNAPSHOT_LEN);

    // 1. intent
    const saltA = (seed ^ SALT.INTENT_A) >>> 0;
    const saltB = (seed ^ SALT.INTENT_B) >>> 0;
    for (let c = 0; c < n; c++) {
      const X = cells[c];
      const s = X & 15;
      if (!s) { intents[c] = 0; continue; }
      const o = s * SP.STRIDE;
      pcg3d(c, t, saltA, h1);
      pcg3d(c, t, saltB, h2);
      const met = table[o + SP.METABOLISM];
      const e0 = cellEnergy(X);
      const maxAge = table[o + SP.MAX_AGE];
      if ((met > 0 && e0 <= met) || (maxAge > 0 && cellAge(X) >= maxAge) || (h1[0] >>> 16) < table[o + SP.DEATH]) {
        intents[c] = packIntent(ACT.DIE, 0, 0);
        continue;
      }
      const e = e0 - met;
      const repro = table[o + SP.REPRO_ENERGY];
      const child = (repro > 0 && e >= repro) || (h1[1] >>> 16) < table[o + SP.BIRTH];
      const diet = table[o + SP.DIET];
      const smart = table[o + SP.SMART];
      const base = c * 8;
      if (diet !== 0 && (h1[2] >>> 16) < table[o + SP.HUNT]) {
        const childOnEat = child || table[o + SP.BIRTH_ON_EAT] !== 0;
        if (smart) {
          let m = 0;
          for (let d = 0; d < 8; d++) {
            const q = cells[nb[base + d]] & 15;
            if (q !== 0 && (diet >>> q) & 1) list[m++] = d;
          }
          if (m > 0) { intents[c] = packIntent(ACT.ATTACK, list[h2[0] % m], childOnEat); continue; }
        } else {
          const d = h2[0] & 7;
          const q = cells[nb[base + d]] & 15;
          if (q !== 0 && (diet >>> q) & 1) { intents[c] = packIntent(ACT.ATTACK, d, childOnEat); continue; }
        }
      }
      if (child || (h2[1] >>> 16) < table[o + SP.MOVE]) {
        if (smart) {
          let m = 0;
          for (let d = 0; d < 8; d++) if ((cells[nb[base + d]] & 15) === 0) list[m++] = d;
          if (m > 0) { intents[c] = packIntent(ACT.MOVE, list[h2[2] % m], child); continue; }
        } else {
          const d = h2[2] & 7;
          if ((cells[nb[base + d]] & 15) === 0) { intents[c] = packIntent(ACT.MOVE, d, child); continue; }
        }
      }
      intents[c] = packIntent(ACT.STAY, 0, 0);
    }

    // 2. claim
    const saltP = (seed ^ SALT.PRIORITY) >>> 0;
    for (let c = 0; c < n; c++) {
      const occupied = (cells[c] & 15) !== 0;
      let found = false;
      let best = 0;
      let bestDir = 0;
      let bestAct = 0;
      for (let d = 0; d < 8; d++) {
        const from = nb[c * 8 + d];
        const it = intents[from];
        const a = (it >>> 3) & 7;
        if (a !== ACT.MOVE && a !== ACT.ATTACK) continue;
        if ((it & 7) !== 7 - d) continue;
        if (occupied ? a !== ACT.ATTACK : a !== ACT.MOVE) continue;
        const pr = pcg3d(from, t, saltP, h1)[0];
        if (!found || pr > best) { found = true; best = pr; bestDir = d; bestAct = a; }
      }
      claims[c] = found ? packClaim(bestAct, bestDir) : 0;
    }

    // 3. apply
    const grassOn = params[PARAM.GRASS_ON];
    const growth = params[PARAM.GRASS_GROWTH];
    const minGraze = params[PARAM.MIN_GRAZE];
    for (let c = 0; c < n; c++) {
      const X = cells[c];
      const s = X & 15;
      const it = intents[c];
      const cl = claims[c];
      let g = grass[c];
      if (grassOn) g = Math.min(g + growth, GRASS_FULL);
      const attackedHere = (cl & 1) !== 0 && ((cl >>> 1) & 3) === ACT.ATTACK;
      let out = 0;
      let arrived = false;
      if (cl & 1) {
        const from = nb[c * 8 + ((cl >>> 4) & 7)];
        const cf = claims[from];
        const fromAttacked = (cf & 1) !== 0 && ((cf >>> 1) & 3) === ACT.ATTACK;
        if (!fromAttacked) {
          arrived = true;
          const A = cells[from];
          const sa = A & 15;
          const o = sa * SP.STRIDE;
          const maxE = table[o + SP.MAX_ENERGY];
          let e = cellEnergy(A) - table[o + SP.METABOLISM];
          if ((intents[from] >>> 6) & 1) e -= e >>> 1;
          if (((cl >>> 1) & 3) === ACT.ATTACK) {
            e = Math.min(e + table[o + SP.PREY_GAIN], maxE);
            stats[STATS.PRED + sa * MAX_SPECIES + s]++;
          }
          if (grassOn && table[o + SP.GRAZES] && g >= minGraze) {
            e = Math.min(e + ((table[o + SP.GRAZE_GAIN] * g) >>> 16), maxE);
            g = 0;
          }
          out = packCell(sa, e, cellAge(A) + 1);
        }
      }
      if (!arrived && s !== 0) {
        const o = s * SP.STRIDE;
        const a = (it >>> 3) & 7;
        if (a === ACT.DIE) {
          stats[STATS.DEATHS + s]++;
        } else {
          let departs = false;
          if (!attackedHere && (a === ACT.MOVE || a === ACT.ATTACK)) {
            const dir = it & 7;
            const ct = claims[nb[c * 8 + dir]];
            departs = (ct & 1) !== 0 && ((ct >>> 4) & 7) === 7 - dir;
          }
          if (departs) {
            if ((it >>> 6) & 1) {
              out = packCell(s, (cellEnergy(X) - table[o + SP.METABOLISM]) >>> 1, 0);
              stats[STATS.BIRTHS + s]++;
            }
          } else {
            const maxE = table[o + SP.MAX_ENERGY];
            let e = cellEnergy(X) - table[o + SP.METABOLISM];
            if (grassOn && table[o + SP.GRAZES] && g >= minGraze) {
              e = Math.min(e + ((table[o + SP.GRAZE_GAIN] * g) >>> 16), maxE);
              g = 0;
            }
            out = packCell(s, e, cellAge(X) + 1);
          }
        }
      }
      next[c] = out;
      grass[c] = g;
      if (out & 15) stats[STATS.POP + (out & 15)]++;
      if (grassOn) {
        if (g >= GRASS_FULL) stats[STATS.GRASS_FULL]++;
        stats[STATS.GRASS_SUM] += g >>> 10;
      }
    }
    this.cells = next;
    this.next = cells;
  }

  count(s) {
    let k = 0;
    for (let c = 0; c < this.n; c++) if ((this.cells[c] & 15) === s) k++;
    return k;
  }

  setCell(x, y, s, e = 1, age = 0) {
    this.cells[y * this.width + x] = s ? packCell(s, e, age) : 0;
  }

  getCell(x, y) {
    return this.cells[y * this.width + x];
  }
}

/** FNV-1a over u32 arrays: a cheap fingerprint to compare whole worlds. */
export function fingerprint(...arrays) {
  let h = 2166136261;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      let v = a[i];
      for (let b = 0; b < 4; b++) {
        h = Math.imul(h ^ (v & 255), 16777619) >>> 0;
        v >>>= 8;
      }
    }
  }
  return h >>> 0;
}
