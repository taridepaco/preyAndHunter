/* Population samples over time, kept in growable typed columns (oldest dropped past `capacity`). */
import { MAX_SPECIES, STATS } from '../engine/rules.js';

export class Series {
  constructor(capacity = 8000) {
    this.capacity = capacity;
    this.clear();
  }

  clear() {
    this.t = [];
    this.pop = Array.from({ length: MAX_SPECIES }, () => []);
    this.grass = [];
    this.births = Array.from({ length: MAX_SPECIES }, () => []);
    this.eaten = Array.from({ length: MAX_SPECIES }, () => []);
  }

  get length() {
    return this.t.length;
  }

  push(t, stats) {
    this.t.push(t);
    for (let s = 1; s < MAX_SPECIES; s++) {
      this.pop[s].push(stats[STATS.POP + s]);
      this.births[s].push(stats[STATS.BIRTHS + s]);
      let eaten = 0;
      for (let p = 1; p < MAX_SPECIES; p++) eaten += stats[STATS.PRED + p * MAX_SPECIES + s];
      this.eaten[s].push(eaten);
    }
    this.grass.push(stats[STATS.GRASS_FULL]);
    if (this.t.length > this.capacity) {
      const drop = this.t.length - this.capacity;
      this.t.splice(0, drop);
      this.grass.splice(0, drop);
      for (const cols of [this.pop, this.births, this.eaten]) for (const c of cols) c.splice(0, drop);
    }
  }

  /** Index of the first sample at or after tick t. */
  indexAt(t) {
    let lo = 0;
    let hi = this.t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
