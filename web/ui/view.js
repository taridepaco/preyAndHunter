/*
 * Zoom, pan and the brush on the world canvas, adapted from GameOfLifer's ui.js: left button
 * paints, right/middle button or Shift+drag pans, the wheel zooms around the cursor.
 */
export class View {
  constructor(canvas, { onPaint, onChange }) {
    this.canvas = canvas;
    this.onPaint = onPaint;
    this.onChange = onChange;
    this.cx = 0;
    this.cy = 0;
    this.zoom = 1;
    this.width = 1;
    this.height = 1;
    this.autoFit = true; // until the user zooms or pans, keep the whole world in view
    this.radius = 12;
    this.hover = null; // brush position in cells while the pointer is over the canvas
    this.drag = null;
    this._bind();
  }

  setWorld(w, h) {
    this.width = w;
    this.height = h;
    this.fit();
  }

  /** Matches the backing store to the CSS size. Returns true if it changed. */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.autoFit) this.fit(false);
    return true;
  }

  fit(notify = true) {
    this.autoFit = true;
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.zoom = Math.min(this.canvas.width / this.width, this.canvas.height / this.height) * 0.98;
    if (notify) this.onChange();
  }

  get brush() {
    return this.hover ? { x: this.hover[0], y: this.hover[1], r: this.radius } : null;
  }

  devicePoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  }

  cellAt(px, py) {
    return [this.cx + (px - this.canvas.width / 2) / this.zoom, this.cy + (py - this.canvas.height / 2) / this.zoom];
  }

  zoomAt(px, py, factor) {
    const maxZoom = 64;
    const minZoom = Math.min(this.canvas.width / this.width, this.canvas.height / this.height) / 4;
    const z = Math.min(maxZoom, Math.max(minZoom, this.zoom * factor));
    // keep the cell under the cursor in place
    this.cx += (px - this.canvas.width / 2) * (1 / this.zoom - 1 / z);
    this.cy += (py - this.canvas.height / 2) * (1 / this.zoom - 1 / z);
    this.zoom = z;
    this.autoFit = false;
    this.onChange();
  }

  _stroke(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, this.radius / 2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) this.onPaint(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const [px, py] = this.devicePoint(e);
      if (e.button === 1 || e.button === 2 || e.shiftKey) {
        this.drag = { mode: 'pan', lastX: px, lastY: py };
        c.classList.add('panning');
        return;
      }
      if (e.button !== 0) return;
      const [x, y] = this.cellAt(px, py);
      this.drag = { mode: 'paint', lastX: x, lastY: y };
      this.onPaint(x, y);
    });
    c.addEventListener('pointermove', (e) => {
      const [px, py] = this.devicePoint(e);
      const [x, y] = this.cellAt(px, py);
      this.hover = e.pointerType === 'mouse' ? [x, y] : null;
      if (this.drag?.mode === 'pan') {
        this.cx -= (px - this.drag.lastX) / this.zoom;
        this.cy -= (py - this.drag.lastY) / this.zoom;
        this.drag.lastX = px;
        this.drag.lastY = py;
        this.autoFit = false;
      } else if (this.drag?.mode === 'paint') {
        this._stroke(this.drag.lastX, this.drag.lastY, x, y);
        this.drag.lastX = x;
        this.drag.lastY = y;
      }
      this.onChange();
    });
    const end = () => {
      this.drag = null;
      c.classList.remove('panning');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.onChange();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = this.devicePoint(e);
      this.zoomAt(px, py, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }
}
