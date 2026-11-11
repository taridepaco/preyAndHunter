// Seeding and painting. Both write the current cells buffer in place.

struct Brush { cx: u32, cy: u32, radius: u32, tool: u32, species: u32, density: u32, salt: u32, pad: u32 }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> SP: array<Species, MAX_SPECIES>;
@group(0) @binding(2) var<storage, read_write> cells: array<u32>;
@group(0) @binding(3) var<storage, read_write> grass: array<u32>;
@group(0) @binding(4) var<uniform> B: Brush;

// Same as Reference.initEnergy.
fn init_energy(s: u32, r: u32) -> u32 {
  let sp = SP[s];
  let max_e = max(1u, sp.max_energy);
  let m = max(1u, select(max_e, sp.repro_energy, sp.repro_energy > 0u));
  let e = select(1u + r % m, sp.init_energy, sp.init_energy > 0u);
  return min(e, max_e);
}

@compute @workgroup_size(WG, WG)
fn tool_seed(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= P.width || gid.y >= P.height) { return; }
  let c = gid.y * P.width + gid.x;
  let h = pcg3d(vec3<u32>(c, 0u, P.seed ^ SALT_SEED));
  var g = 0u;
  if (P.grass_on != 0u) { g = select(h.x >> 16u, GRASS_FULL, (h.x & 1u) != 0u); }
  grass[c] = g;
  let r = h.y >> 16u;
  var acc = 0u;
  var s = 0u;
  for (var i = 1u; i <= P.nspecies; i++) {
    acc += SP[i].density;
    if (r < acc) {
      s = i;
      break;
    }
  }
  cells[c] = select(0u, pack_cell(s, init_energy(s, h.z), 0u), s != 0u);
}

// The dispatch covers the brush's bounding square; cells outside the circle are skipped.
@compute @workgroup_size(WG, WG)
fn tool_paint(@builtin(global_invocation_id) gid: vec3<u32>) {
  let side = 2u * B.radius + 1u;
  if (gid.x >= side || gid.y >= side) { return; }
  let dx = i32(gid.x) - i32(B.radius);
  let dy = i32(gid.y) - i32(B.radius);
  if (dx * dx + dy * dy > i32(B.radius * B.radius)) { return; }
  let ww = i32(P.width);
  let wh = i32(P.height);
  let x = u32(((i32(B.cx) + dx) % ww + ww) % ww);
  let y = u32(((i32(B.cy) + dy) % wh + wh) % wh);
  let c = y * P.width + x;
  let h = pcg3d(vec3<u32>(c, B.salt, P.seed ^ SALT_PAINT));
  if (B.tool == TOOL_ANIMAL) {
    if ((cells[c] & 15u) == 0u && (h.x >> 16u) < B.density) {
      cells[c] = pack_cell(B.species, init_energy(B.species, h.y), 0u);
    }
  } else if (B.tool == TOOL_GRASS) {
    grass[c] = GRASS_FULL;
  } else {
    cells[c] = 0u;
    grass[c] = 0u;
  }
}
