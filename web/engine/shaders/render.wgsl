// Draws the world with zoom and pan (ported from GameOfLifer's DRAW shader). Zoomed out, each
// pixel averages up to 4×4 cells so the view shows densities instead of aliasing; zoomed in,
// animals become square sprites. Animals always keep their species colour: darkening them by
// energy made the hungry ones (most of them) vanish into the soil.

struct View {
  canvas: vec2<f32>,
  center: vec2<f32>,
  world: vec2<f32>,
  zoom: f32,
  grass_on: f32,
  brush: vec4<f32>, // x, y, radius (cells), visible
  soil: vec4<f32>,
  grass_lo: vec4<f32>,
  grass_hi: vec4<f32>,
  outside: vec4<f32>,
  ring: vec4<f32>, // brush outline
  colors: array<vec4<f32>, MAX_SPECIES>, // rgb (+ an unused w)
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> grass: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn ground(i: u32) -> vec3<f32> {
  if (V.grass_on < 0.5) { return V.soil.rgb; }
  let g = f32(grass[i]) / 65536.0;
  if (g >= 1.0) { return V.grass_hi.rgb; }
  return mix(V.soil.rgb, V.grass_lo.rgb, g);
}

fn animal(w: u32) -> vec3<f32> {
  return V.colors[w & 15u].rgb;
}

fn cell_color(ix: u32, iy: u32) -> vec3<f32> {
  let i = iy * u32(V.world.x) + ix;
  let w = cells[i];
  if ((w & 15u) == 0u) { return ground(i); }
  return animal(w);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let cell = V.center + (pos.xy - 0.5 * V.canvas) / V.zoom;
  if (any(cell < vec2<f32>(0.0)) || any(cell >= V.world)) {
    return vec4<f32>(V.outside.rgb, 1.0);
  }
  var col: vec3<f32>;
  if (V.zoom >= 6.0) {
    let ic = vec2<u32>(cell);
    let i = ic.y * u32(V.world.x) + ic.x;
    let w = cells[i];
    col = ground(i);
    if ((w & 15u) != 0u) {
      // a square sprite inside its cell, like a pixel of a 16-bit screen
      let q = abs(fract(cell) - vec2<f32>(0.5));
      let r = max(q.x, q.y);
      let aa = 0.5 / V.zoom;
      col = mix(col, animal(w), smoothstep(0.38 + aa, 0.38 - aa, r));
    }
    if (V.zoom >= 14.0) {
      let f = fract(cell) * V.zoom;
      if (min(f.x, f.y) < 1.0) { col = mix(col, V.outside.rgb, 0.35); }
    }
  } else if (V.zoom >= 1.0) {
    let ic = vec2<u32>(cell);
    col = cell_color(ic.x, ic.y);
  } else {
    let span = 1.0 / V.zoom;
    let k = i32(min(ceil(span), 4.0));
    var acc = vec3<f32>(0.0);
    for (var i = 0; i < 4; i++) {
      if (i >= k) { break; }
      for (var j = 0; j < 4; j++) {
        if (j >= k) { break; }
        let q = cell + (vec2<f32>(f32(i), f32(j)) + 0.5) / f32(k) * span - 0.5 * span;
        let qc = vec2<u32>(clamp(q, vec2<f32>(0.0), V.world - 1.0));
        acc += cell_color(qc.x, qc.y);
      }
    }
    col = acc / f32(k * k);
  }
  if (V.brush.w > 0.5) {
    let d = length(cell - V.brush.xy) * V.zoom;
    let rr = max(V.brush.z * V.zoom, 3.0);
    if (abs(d - rr) < 1.0) { col = mix(col, V.ring.rgb, 0.85); }
  }
  return vec4<f32>(col, 1.0);
}
