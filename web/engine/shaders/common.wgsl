// Shared by every shader. The constants (MAX_SPECIES, ACT_*, STATS_*, SALT_*…) are generated
// from rules.js and prepended before this file, so JS and WGSL never disagree.

struct Params {
  width: u32, height: u32, seed: u32, grass_on: u32,
  grass_growth: u32, min_graze: u32, nspecies: u32, p7: u32,
  p8: u32, p9: u32, p10: u32, p11: u32,
  p12: u32, p13: u32, p14: u32, p15: u32,
}

// One row of the species table (see SP in rules.js). Probabilities are Q16.
struct Species {
  diet: u32, grazes: u32, graze_gain: u32, prey_gain: u32,
  metabolism: u32, repro_energy: u32, max_energy: u32, max_age: u32,
  move_p: u32, birth_p: u32, death_p: u32, hunt_p: u32,
  birth_on_eat: u32, smart: u32, init_energy: u32, density: u32,
}

// PCG-style 3D hash (Jarzynski & Olano 2020), as in GameOfLifer.
fn pcg3d(v0: vec3<u32>) -> vec3<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3<u32>(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

// Cell word: species (4 bits) | energy (12) | age (12) | flags (4)
fn cell_energy(w: u32) -> u32 { return (w >> 4u) & 4095u; }
fn cell_age(w: u32) -> u32 { return (w >> 16u) & 4095u; }
fn pack_cell(s: u32, e: u32, a: u32) -> u32 {
  return (s & 15u) | (min(e, 4095u) << 4u) | (min(a, 4095u) << 16u);
}

// Intent word: dir (3 bits) | action (3) | leaves a child (1)
fn pack_intent(act: u32, dir: u32, child: bool) -> u32 {
  return dir | (act << 3u) | select(0u, 64u, child);
}

// Claim word: valid (1 bit) | winner's action (2) | direction from the cell to the winner (3)
fn pack_claim(act: u32, dir: u32) -> u32 {
  return 1u | (act << 1u) | (dir << 4u);
}

// Directions 0 1 2 / 3 · 4 / 5 6 7; the opposite of d is 7 - d. Toroidal, of any width and height.
fn neighbor(x: u32, y: u32, d: u32, w: u32, h: u32) -> u32 {
  let k = select(d, d + 1u, d >= 4u);
  return wrap_step(y, k / 3u, h) * w + wrap_step(x, k % 3u, w);
}

// v + o - 1 (o is 0, 1 or 2) wrapped into [0, n): the same as rules.js's modulo, without a division.
fn wrap_step(v: u32, o: u32, n: u32) -> u32 {
  let s = v + o;
  return select(select(s - 1u, 0u, s > n), n - 1u, s == 0u);
}
