/*
 * Spanish and English, as on taridepaco.github.io. The inline script in index.html fixes the
 * language before the first paint (?lang=, then the last choice, then the browser); this module
 * holds the texts, formats numbers for that language and lets the page switch it live.
 * Static texts are marked in the HTML with data-i18n (text), data-i18n-title and data-i18n-aria.
 */

const KEY = 'taridepaco-lang';

const TEXT = {
  es: {
    tagline: 'ecosistemas en la GPU',
    'nav.code': 'Código',
    'theme.auto': 'Tema: auto',
    'theme.light': 'Tema: claro',
    'theme.dark': 'Tema: oscuro',
    play: 'Play',
    pause: 'Pausa',
    'play.title': 'Reproducir o pausar (espacio)',
    step: 'Paso',
    'step.title': 'Un tick (N)',
    reset: 'Reiniciar',
    'reset.title': 'Volver a empezar con la misma semilla (R)',
    fit: 'Encajar',
    'fit.title': 'Ver el mundo entero (F)',
    world: 'Mundo',
    size: 'Tamaño',
    speed: 'Velocidad',
    seed: 'Semilla',
    newSeed: 'Nueva',
    'newSeed.title': 'Semilla nueva (S)',
    controls: 'Controles de la simulación',
    hint: 'Clic: pincel · Arrastre con botón derecho, central o Mayús: mover · Rueda: zoom',
    species: 'Especies',
    'species.note': 'Los cambios se aplican en vivo',
    brush: 'Pincel',
    'brush.tools': 'Herramienta del pincel',
    'brush.radius': 'Radio',
    grass: 'Hierba',
    erase: 'Borrar',
    'grass.mature': '{p} % madura',
    obs: 'Observatorio',
    models: 'Modelos',
    'chart.series': 'Poblaciones a lo largo del tiempo',
    'chart.phase': 'Retrato de fase: presas frente a depredadores',
    'chart.last': 'últimos {n} ticks',
    'chart.wait': 'Esperando datos…',
    stats: 'tick {tick} · {tps} ticks/s · {g} Gceldas/s · zoom {z}',
    'speed.opt': '{n} ticks/s',
    'err.title': 'No se puede simular',
    'err.webgpu': 'Este navegador no tiene WebGPU. Prueba con Chrome o Edge, Safari 26 o Firefox 141+ en Windows.',
    'err.adapter': 'WebGPU está, pero no encuentra una GPU compatible.',
    'err.worlds': 'No se pudieron cargar los mundos: {msg}',
    'err.lost': 'Se ha perdido el acceso a la GPU ({why}). Recarga la página.',

    'm.lv': 'Lotka-Volterra',
    'm.resource': 'Con hierba',
    'm.meanfield': 'Campo medio',
    'm.sindy': 'SINDy',
    'k.real': 'Trayectoria real',
    'k.theory': 'Teoría de campo medio desde ahora',
    'k.predict': 'Lo que predice el modelo desde ahora',
    'k.eq': 'Equilibrio',
    'grass.series': 'Hierba madura',
    'grass.pct': '{p} %',
    'd.none': 'Sin equilibrio con las dos especies vivas.',
    'd.observed': ' · observado <b>{n}</b>',
    'd.stableNoOsc': 'No oscila: vuelve al equilibrio sin dar vueltas',
    'd.unstableNoOsc': 'No oscila: se aleja del equilibrio',
    'd.period': ' (periodo{obs})',
    'd.closed': 'órbitas cerradas, como en Lotka-Volterra',
    'd.damped': 'espiral que se amortigua a la mitad cada <b>{n}</b> ticks',
    'd.growing': 'espiral que crece al doble cada <b>{n}</b> ticks',
    'd.predicted': 'Periodo predicho <b>{n}</b> ticks{obs} · {kind}',
    'o.extinct': 'Una de las especies se ha extinguido: ya no hay ciclo que ajustar.',
    'o.collecting': 'Recogiendo datos para ajustar las ecuaciones… {p} %',
    'o.threshold': 'Umbral de poda',
    'o.kept': 'Se quedan <b>{k}</b> de {n} términos posibles',
    'o.eq': 'Equilibrio: <b>{a}</b> {prey} y <b>{b}</b> {pred} (media observada {ma} y {mb})',
    'o.noEq': 'Este modelo no tiene un equilibrio con todas las especies vivas.',
    'o.vars2': '{names}: fracción de celdas con {prey} y con {pred}',
    'o.vars3': '{names}: fracción de celdas con {prey}, con {pred} y con hierba madura',
    'o.span': '{vars}. Ajuste sobre los últimos {n} ticks.',
    'mf.params': 'σ = <b>{s}</b>, λ = <b>{l}</b>, μ = <b>{m}</b>: los parámetros del mundo, sin ajustar nada',
    'mf.obs': ' · en la rejilla, media observada <b>{a}</b> y <b>{b}</b>',
    'mf.eq': 'Equilibrio teórico: <b>{a}</b> {prey} y <b>{b}</b> {pred}{obs}',
    'mf.dies': 'Con estos parámetros la teoría dice que los depredadores no sobreviven (μ ≥ λ).',
    'mf.soup': 'La teoría supone una sopa bien mezclada. En la rejilla cada animal solo ve a sus vecinos: presas y depredadores forman manchas y el equilibrio real se aparta del teórico.',
  },
  en: {
    tagline: 'ecosystems on the GPU',
    'nav.code': 'Code',
    'theme.auto': 'Theme: auto',
    'theme.light': 'Theme: light',
    'theme.dark': 'Theme: dark',
    play: 'Play',
    pause: 'Pause',
    'play.title': 'Play or pause (space)',
    step: 'Step',
    'step.title': 'One tick (N)',
    reset: 'Restart',
    'reset.title': 'Start again with the same seed (R)',
    fit: 'Fit',
    'fit.title': 'Show the whole world (F)',
    world: 'World',
    size: 'Size',
    speed: 'Speed',
    seed: 'Seed',
    newSeed: 'New',
    'newSeed.title': 'New seed (S)',
    controls: 'Simulation controls',
    hint: 'Click: brush · Drag with the right or middle button or Shift: move · Wheel: zoom',
    species: 'Species',
    'species.note': 'Changes apply live',
    brush: 'Brush',
    'brush.tools': 'Brush tool',
    'brush.radius': 'Radius',
    grass: 'Grass',
    erase: 'Erase',
    'grass.mature': '{p}% mature',
    obs: 'Observatory',
    models: 'Models',
    'chart.series': 'Populations over time',
    'chart.phase': 'Phase portrait: prey against predators',
    'chart.last': 'last {n} ticks',
    'chart.wait': 'Waiting for data…',
    stats: 'tick {tick} · {tps} ticks/s · {g} Gcells/s · zoom {z}',
    'speed.opt': '{n} ticks/s',
    'err.title': "Can't run the simulation",
    'err.webgpu': 'This browser has no WebGPU. Try Chrome or Edge, Safari 26, or Firefox 141+ on Windows.',
    'err.adapter': 'WebGPU is there, but it finds no compatible GPU.',
    'err.worlds': 'Could not load the worlds: {msg}',
    'err.lost': 'Lost access to the GPU ({why}). Reload the page.',

    'm.lv': 'Lotka-Volterra',
    'm.resource': 'With grass',
    'm.meanfield': 'Mean field',
    'm.sindy': 'SINDy',
    'k.real': 'Actual trajectory',
    'k.theory': 'Mean-field theory from now on',
    'k.predict': 'What the model predicts from now on',
    'k.eq': 'Equilibrium',
    'grass.series': 'Mature grass',
    'grass.pct': '{p}%',
    'd.none': 'No equilibrium with both species alive.',
    'd.observed': ' · observed <b>{n}</b>',
    'd.stableNoOsc': 'No oscillation: it returns to equilibrium without circling',
    'd.unstableNoOsc': 'No oscillation: it moves away from equilibrium',
    'd.period': ' (period{obs})',
    'd.closed': 'closed orbits, as in Lotka-Volterra',
    'd.damped': 'a spiral that halves every <b>{n}</b> ticks',
    'd.growing': 'a spiral that doubles every <b>{n}</b> ticks',
    'd.predicted': 'Predicted period <b>{n}</b> ticks{obs} · {kind}',
    'o.extinct': 'One of the species has died out: there is no cycle left to fit.',
    'o.collecting': 'Collecting data to fit the equations… {p}%',
    'o.threshold': 'Pruning threshold',
    'o.kept': '<b>{k}</b> of {n} possible terms remain',
    'o.eq': 'Equilibrium: <b>{a}</b> {prey} and <b>{b}</b> {pred} (observed mean {ma} and {mb})',
    'o.noEq': 'This model has no equilibrium with every species alive.',
    'o.vars2': '{names}: fraction of cells with {prey} and with {pred}',
    'o.vars3': '{names}: fraction of cells with {prey}, with {pred} and with mature grass',
    'o.span': '{vars}. Fitted over the last {n} ticks.',
    'mf.params': 'σ = <b>{s}</b>, λ = <b>{l}</b>, μ = <b>{m}</b>: the world’s own parameters, nothing fitted',
    'mf.obs': ' · on the lattice, observed mean <b>{a}</b> and <b>{b}</b>',
    'mf.eq': 'Theoretical equilibrium: <b>{a}</b> {prey} and <b>{b}</b> {pred}{obs}',
    'mf.dies': 'With these parameters the theory says the predators do not survive (μ ≥ λ).',
    'mf.soup': 'The theory assumes a well-mixed soup. On the lattice each animal only sees its neighbours: prey and predators form patches and the real equilibrium drifts away from the theoretical one.',
  },
};

let lang = globalThis.document?.documentElement.lang === 'en' ? 'en' : 'es'; // Spanish outside a page (Node tests)
const subs = [];

export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-GB' : 'es-ES');

/** Text for `key`, with {name} placeholders filled from `vars`. */
export function t(key, vars) {
  const s = TEXT[lang][key] ?? TEXT.es[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

/** A text from the world files: a plain string or {es, en}. */
export const tx = (v) => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.es ?? '');

/** A number in the current language. */
export const num = (v, opts) => v.toLocaleString(locale(), opts);

/** Fills every data-i18n, data-i18n-title and data-i18n-aria under `root` and syncs the switch. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const b of root.querySelectorAll('.lang-switch button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'es';
  try { localStorage.setItem(KEY, lang); } catch { /* no storage */ }
  document.documentElement.lang = lang;
  applyStatic();
  for (const f of subs) f(lang);
}

export const onLang = (f) => subs.push(f);

/** Wires the .lang-switch buttons. */
export function bindLangSwitch(root = document) {
  for (const b of root.querySelectorAll('.lang-switch button')) {
    b.addEventListener('click', () => { if (b.dataset.lang !== lang) setLang(b.dataset.lang); });
  }
}
