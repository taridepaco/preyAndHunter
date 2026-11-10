// One tick of the world in three passes plus an optional snapshot of the statistics.
// Mirrors Reference._tick in reference.js line by line: keep both in sync.

struct Tick { tick: u32, sample_slot: u32, clear_events: u32, pad: u32 }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> SP: array<Species, MAX_SPECIES>;
@group(0) @binding(2) var<storage, read> cells_in: array<u32>;
@group(0) @binding(3) var<storage, read_write> cells_out: array<u32>;
@group(0) @binding(4) var<storage, read_write> grass: array<u32>;
@group(0) @binding(5) var<storage, read_write> intents: array<u32>;
@group(0) @binding(6) var<storage, read_write> claims: array<u32>;
@group(0) @binding(7) var<storage, read_write> stats: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> samples: array<u32>;
@group(1) @binding(0) var<uniform> T: Tick;

var<workgroup> wg_stats: array<atomic<u32>, STATS_LEN>;
var<workgroup> wg_grass: array<u32, 256>; // WG*WG partial sums: (full cells << 16) | (grass >> 10)

fn nb(x: u32, y: u32, d: u32) -> u32 {
  return neighbor(x, y, d, P.width, P.height);
}

fn eats(diet: u32, s: u32) -> bool {
  return s != 0u && ((diet >> s) & 1u) != 0u;
}

// 1. Each animal decides what to do from the snapshot.
@compute @workgroup_size(WG, WG)
fn pass_intent(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x == 0u && gid.y == 0u) {
    for (var i = 0u; i < STATS_SNAPSHOT_LEN; i++) { atomicStore(&stats[i], 0u); }
    if (T.clear_events != 0u) {
      for (var i = STATS_SNAPSHOT_LEN; i < STATS_LEN; i++) { atomicStore(&stats[i], 0u); }
    }
  }
  if (gid.x >= P.width || gid.y >= P.height) { return; }
  let x = gid.x;
  let y = gid.y;
  let c = y * P.width + x;
  let X = cells_in[c];
  let s = X & 15u;
  if (s == 0u) {
    intents[c] = 0u;
    return;
  }
  let sp = SP[s];
  let h1 = pcg3d(vec3<u32>(c, T.tick, P.seed ^ SALT_INTENT_A));
  let h2 = pcg3d(vec3<u32>(c, T.tick, P.seed ^ SALT_INTENT_B));
  let e0 = cell_energy(X);
  if ((sp.metabolism > 0u && e0 <= sp.metabolism) || (sp.max_age > 0u && cell_age(X) >= sp.max_age) || (h1.x >> 16u) < sp.death_p) {
    intents[c] = pack_intent(ACT_DIE, 0u, false);
    return;
  }
  let e = e0 - sp.metabolism;
  let child = (sp.repro_energy > 0u && e >= sp.repro_energy) || (h1.y >> 16u) < sp.birth_p;
  var list: array<u32, 8>;
  if (sp.diet != 0u && (h1.z >> 16u) < sp.hunt_p) {
    let child_on_eat = child || sp.birth_on_eat != 0u;
    if (sp.smart != 0u) {
      var m = 0u;
      for (var d = 0u; d < 8u; d++) {
        if (eats(sp.diet, cells_in[nb(x, y, d)] & 15u)) {
          list[m] = d;
          m++;
        }
      }
      if (m > 0u) {
        intents[c] = pack_intent(ACT_ATTACK, list[h2.x % m], child_on_eat);
        return;
      }
    } else {
      let d = h2.x & 7u;
      if (eats(sp.diet, cells_in[nb(x, y, d)] & 15u)) {
        intents[c] = pack_intent(ACT_ATTACK, d, child_on_eat);
        return;
      }
    }
  }
  if (child || (h2.y >> 16u) < sp.move_p) {
    if (sp.smart != 0u) {
      var m = 0u;
      for (var d = 0u; d < 8u; d++) {
        if ((cells_in[nb(x, y, d)] & 15u) == 0u) {
          list[m] = d;
          m++;
        }
      }
      if (m > 0u) {
        intents[c] = pack_intent(ACT_MOVE, list[h2.z % m], child);
        return;
      }
    } else {
      let d = h2.z & 7u;
      if ((cells_in[nb(x, y, d)] & 15u) == 0u) {
        intents[c] = pack_intent(ACT_MOVE, d, child);
        return;
      }
    }
  }
  intents[c] = pack_intent(ACT_STAY, 0u, false);
}

// 2. Each cell picks one winner among the animals that target it: moves into empty cells,
//    attacks into occupied ones. The priority is a hash of the origin cell and the tick.
@compute @workgroup_size(WG, WG)
fn pass_claim(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.width || gid.y >= P.height) { return; }
  let c = gid.y * P.width + gid.x;
  let occupied = (cells_in[c] & 15u) != 0u;
  var found = false;
  var best = 0u;
  var best_dir = 0u;
  var best_act = 0u;
  for (var d = 0u; d < 8u; d++) {
    let src = nb(gid.x, gid.y, d);
    let it = intents[src];
    let a = (it >> 3u) & 7u;
    if (a != ACT_MOVE && a != ACT_ATTACK) { continue; }
    if ((it & 7u) != 7u - d) { continue; }
    if (select(a != ACT_MOVE, a != ACT_ATTACK, occupied)) { continue; }
    let pr = pcg3d(vec3<u32>(src, T.tick, P.seed ^ SALT_PRIORITY)).x;
    if (!found || pr > best) {
      found = true;
      best = pr;
      best_dir = d;
      best_act = a;
    }
  }
  claims[c] = select(0u, pack_claim(best_act, best_dir), found);
}

fn graze(sp: Species, e: u32, g: ptr<function, u32>) -> u32 {
  if (P.grass_on != 0u && sp.grazes != 0u && *g >= P.min_graze) {
    let fed = min(e + ((sp.graze_gain * *g) >> 16u), sp.max_energy);
    *g = 0u;
    return fed;
  }
  return e;
}

// Writes the cell's final state and returns its grass contribution to the statistics.
fn apply_cell(x: u32, y: u32) -> u32 {
  let c = y * P.width + x;
  let X = cells_in[c];
  let s = X & 15u;
  let it = intents[c];
  let cl = claims[c];
  var g = grass[c];
  if (P.grass_on != 0u) { g = min(g + P.grass_growth, GRASS_FULL); }
  let attacked_here = (cl & 1u) != 0u && ((cl >> 1u) & 3u) == ACT_ATTACK;
  var out = 0u;
  var arrived = false;
  if ((cl & 1u) != 0u) {
    let src = nb(x, y, (cl >> 4u) & 7u);
    let cs = claims[src];
    let src_attacked = (cs & 1u) != 0u && ((cs >> 1u) & 3u) == ACT_ATTACK;
    if (!src_attacked) {
      arrived = true;
      let A = cells_in[src];
      let sa = A & 15u;
      let sp = SP[sa];
      var e = cell_energy(A) - sp.metabolism;
      if (((intents[src] >> 6u) & 1u) != 0u) { e -= e >> 1u; }
      if (((cl >> 1u) & 3u) == ACT_ATTACK) {
        e = min(e + sp.prey_gain, sp.max_energy);
        atomicAdd(&wg_stats[STATS_PRED + sa * MAX_SPECIES + s], 1u);
      }
      e = graze(sp, e, &g);
      out = pack_cell(sa, e, cell_age(A) + 1u);
    }
  }
  if (!arrived && s != 0u) {
    let sp = SP[s];
    let a = (it >> 3u) & 7u;
    if (a == ACT_DIE) {
      atomicAdd(&wg_stats[STATS_DEATHS + s], 1u);
    } else {
      var departs = false;
      if (!attacked_here && (a == ACT_MOVE || a == ACT_ATTACK)) {
        let dir = it & 7u;
        let ct = claims[nb(x, y, dir)];
        departs = (ct & 1u) != 0u && ((ct >> 4u) & 7u) == 7u - dir;
      }
      if (departs) {
        if (((it >> 6u) & 1u) != 0u) {
          out = pack_cell(s, (cell_energy(X) - sp.metabolism) >> 1u, 0u);
          atomicAdd(&wg_stats[STATS_BIRTHS + s], 1u);
        }
      } else {
        let e = graze(sp, cell_energy(X) - sp.metabolism, &g);
        out = pack_cell(s, e, cell_age(X) + 1u);
      }
    }
  }
  cells_out[c] = out;
  grass[c] = g;
  if ((out & 15u) != 0u) { atomicAdd(&wg_stats[STATS_POP + (out & 15u)], 1u); }
  return select(0u, 65536u, g >= GRASS_FULL) | (g >> 10u);
}

// 3. Each cell writes its final state (single writer per cell, so no races). Statistics are
//    summed per workgroup first (atomics for the rare events, a tree for the grass that every
//    cell contributes) and then added to the global buffer.
@compute @workgroup_size(WG, WG)
fn pass_apply(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  var g = 0u;
  if (gid.x < P.width && gid.y < P.height) { g = apply_cell(gid.x, gid.y); }
  wg_grass[li] = g;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { wg_grass[li] += wg_grass[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u && P.grass_on != 0u) {
    atomicAdd(&stats[STATS_GRASS_FULL], wg_grass[0] >> 16u);
    atomicAdd(&stats[STATS_GRASS_SUM], wg_grass[0] & 0xffffu);
  }
  if (li < STATS_LEN) {
    let v = atomicLoad(&wg_stats[li]);
    if (v != 0u) { atomicAdd(&stats[li], v); }
  }
}

// Copies the statistics of a sampled tick to its slot in the samples buffer.
@compute @workgroup_size(128)
fn pass_snapshot(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x < STATS_LEN && T.sample_slot != NO_SAMPLE) {
    samples[T.sample_slot * STATS_LEN + gid.x] = atomicLoad(&stats[gid.x]);
  }
}
