/* WebGPU setup and shader loading. */
import { wgslPrelude } from './rules.js';

export async function initGPU() {
  if (!navigator.gpu) {
    throw Object.assign(new Error('Este navegador no tiene WebGPU. Prueba con Chrome o Edge, Safari 26 o Firefox 141+ en Windows.'), { code: 'webgpu' });
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Object.assign(new Error('WebGPU está, pero no encuentra una GPU compatible.'), { code: 'adapter' });
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  return { adapter, device };
}

const SHADER_DIR = new URL('./shaders/', import.meta.url);

async function fetchText(name) {
  const res = await fetch(new URL(name, SHADER_DIR));
  if (!res.ok) throw new Error(`No se pudo cargar ${name} (${res.status}).`);
  return res.text();
}

/**
 * Compiles a shader made of the generated constants, common.wgsl and the given file.
 * Compilation errors are reported with the line number inside that file.
 */
export async function loadModule(device, name) {
  const [common, body] = await Promise.all([fetchText('common.wgsl'), fetchText(name)]);
  const head = wgslPrelude() + common + '\n';
  const offset = head.split('\n').length - 1;
  const module = device.createShaderModule({ label: name, code: head + body });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) {
    const where = (m) => (m.lineNum > offset ? `${name}:${m.lineNum - offset}` : `prelude:${m.lineNum}`);
    throw new Error(errors.map((m) => `${where(m)}: ${m.message}`).join('\n'));
  }
  return module;
}
