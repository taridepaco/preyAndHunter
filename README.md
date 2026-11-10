# Prey

Ecosistemas vivos en la GPU del navegador (WebGPU): hierba, conejos y zorros en millones de celdas,
y un observatorio que **descubre las ecuaciones** que gobiernan sus poblaciones mientras corre.

No programamos las ecuaciones de Lotka-Volterra: programamos animales que comen, se mueven, crían y
mueren, y las ecuaciones aparecen solas en el retrato de fase. Prey las ajusta en directo y las compara
con lo que de verdad hace el mundo.

| Ruta | Qué hay |
|---|---|
| `web/` | La aplicación. Sin dependencias ni compilación: módulos ES y shaders WGSL. |
| `web/system.css`, `web/theme.js` | El sistema de diseño común de [taridepaco.github.io](https://taridepaco.github.io/), copiado sin cambios: no se editan aquí. |
| `web/style.css`, `web/i18n.js` | Lo propio de Prey sobre el sistema (pantalla, deslizadores, selectores, observatorio) y los textos en español e inglés. |
| `web/engine/` | El motor: `rules.js` (reglas compartidas), `world.js` (GPU), `reference.js` (CPU) y `shaders/`. |
| `web/observatory/` | Series, ajustes (Lotka-Volterra, modelo con hierba, SINDy), RK4, gráficas y ecuaciones en MathML. |
| `web/ui/` | Vista con zoom y pincel, y panel de especies. |
| `web/worlds/` | Los mundos: `pradera.json` y `lotka-rejilla.json`. |
| `web/tests/` | Pruebas en el navegador: la GPU contra el motor de referencia, bit a bit. |
| `tests/` | Pruebas con Node (`npm test`): reglas y matemáticas del observatorio. |
| `tools/serve.py` | Servidor de desarrollo sin caché. |
| `deploy/` | Construcción de `dist/` (lo que se publica), tests previos e instalación en el servidor de casa. Ver [DEPLOY.md](DEPLOY.md). |
| `.github/workflows/pages.yml` | Publica `dist/` en GitHub Pages con cada push a `main`. |

## Los mundos

**La pradera.** La hierba rebrota en 40 ticks. Los conejos gastan 1 de energía por tick, ganan 4 al comer
hierba madura y, si al moverse tienen 12 o más, dejan una cría con la mitad. Los zorros cazan conejos
vecinos (+14), crían a partir de 30 y aguantan hasta 70. Se forman frentes de pasto y de caza que
recorren el mundo como ondas.

**Lotka en rejilla.** El modelo estocástico clásico de dos especies (Mobilia, Georgiev y Täuber): la presa
nace en una celda vecina vacía con probabilidad σ, el depredador convierte una presa vecina en su cría
con probabilidad λ y muere con probabilidad μ. Su ecuación de campo medio es
da/dt = σa(1−a−b) − λab, db/dt = λab − μb, y la rejilla se aparta de ella: los animales forman manchas.

## El motor: tres pases sin conflictos

Cada tick, para todas las celdas a la vez y con un único escritor por celda (sin carreras ni atómicos en
el estado):

1. **Intención.** Cada animal decide, mirando la foto del estado: quedarse, moverse a una celda vacía,
   atacar a una presa vecina o morir (hambre, vejez o azar).
2. **Reclamación.** Cada celda elige un único ganador entre quienes la quieren, con prioridad aleatoria.
3. **Aplicación.** Cada celda escribe su estado final. Si te atacan, no actúas. Un atacante al que atacan
   no llega a su presa. Quien se va puede dejar una cría.

Todo lo que decide es entero (energía, edad, hierba y probabilidades en coma fija Q16) y el azar sale de
un hash de (celda, tick, semilla): la misma semilla da el mismo mundo en cualquier GPU, y la GPU coincide
bit a bit con el motor de referencia en JS.

## El observatorio

- Poblaciones en el tiempo y retrato de fase (presas frente a depredadores) con el equilibrio y lo que
  predice cada modelo desde el estado actual.
- **Lotka-Volterra**: d ln c/dt = α − βz, d ln z/dt = δc − γ.
- **Con hierba**: Lotka-Volterra más el recurso, con estructura fija e interpretable.
- **SINDy**: búsqueda dispersa de términos (STLSQ, Brunton, Proctor y Kutz, 2016) con umbral ajustable.
- **Campo medio** (en la rejilla de Lotka): la ecuación teórica con los parámetros del mundo, sin ajustar.

Cada modelo se analiza igual: punto fijo, autovalores, periodo y amortiguamiento, frente al periodo
observado.

Lo que enseña la pradera (512², semilla 1): Lotka-Volterra solo explica el 12 % de la variación de los
conejos y predice un periodo de ~300 ticks cuando se observan ~100. Con la hierba explica el 40 % y
predice ~140 ticks: es una espiral amortiguada que el ruido demográfico mantiene viva (los cuasi-ciclos
de McKane y Newman, 2005).

## Controles

Espacio: reproducir o pausar · N: un tick · R: reiniciar con la misma semilla · S: semilla nueva ·
F: encajar · +/−: zoom · clic: pincel · arrastre con botón derecho, central o Mayús: mover · rueda: zoom.

El mundo, el tamaño y la semilla van en la URL (`#mundo=pradera&tam=512&semilla=1`): un enlace
reproduce exactamente el mismo mundo.

Arriba a la derecha están el tema (auto, claro u oscuro; el mundo tiene suelo de día y de noche) y el
idioma (ES/EN, también con `?lang=en`). Ambos se guardan con las mismas claves que la portada, así que
en `taridepaco.github.io` la elección vale para todas las páginas.

## Rendimiento

Medido en el panel de navegador del escritorio de Claude (Chromium, WebGPU sobre D3D12) en este equipo,
con la pradera y sin dibujar:

| Mundo | Ticks/s | Celdas·tick/s |
|---|---|---|
| 512² | ~9200 | 2,4 G |
| 1024² | ~3200 | 3,3 G |
| 2048² | ~1050 | 4,4 G |
| 4096² | ~290 | 4,9 G |

## Desarrollo

```bash
python3 tools/serve.py 8091     # http://localhost:8091 (pruebas en /tests/)
npm test                        # reglas y matemáticas, sin dependencias
```

Hace falta un navegador con WebGPU: Chrome o Edge, Safari 26, o Firefox 141+ en Windows (145+ en
Mac ARM). En Linux todavía es parcial.

## Despliegue

`deploy/build.sh` construye `web/` en `dist/`, y ese mismo `dist/` se publica en todos los sitios:
GitHub Pages (`.github/workflows/pages.yml`, con cada push a `main` y solo si pasan los tests) y el
servidor de casa (`deploy/install.sh`). Detalles en [DEPLOY.md](DEPLOY.md).

## Hoja de ruta

1. **Hola, Lotka** (esta versión): motor, pradera, rejilla de Lotka, observatorio.
2. **Bestiario**: n especies en JSON, terreno y clima, olores que se difunden (rastrear y huir), editor de
   especies, red trófica con flujos de energía, matriz de interacción ajustada y la lupa (ciclos locales).
3. **Laboratorio**: mosaico de mundos con parámetros distintos, deslizador de mezcla (espacio ↔ sopa),
   herramientas de dios, vídeo y exportación CSV.
4. **Evolución**: rasgos heredables con mutación, compromisos alométricos, linajes.

## Referencias

- Mobilia, Georgiev, Täuber: *Phase transitions and spatio-temporal fluctuations in stochastic lattice
  Lotka-Volterra models* (arXiv:q-bio/0512039).
- McKane, Newman: *Predator-prey cycles from resonant amplification of demographic stochasticity*,
  PRL 94, 218102 (2005).
- Sherratt, Lewis, Fowler: *Ecological chaos in the wake of invasion*, PNAS (1995).
- Brunton, Proctor, Kutz: *Discovering governing equations from data by sparse identification of
  nonlinear dynamical systems*, PNAS (2016).
- Dewdney: Wa-Tor, *Scientific American* (1984). Wilensky: *Wolf Sheep Predation*, NetLogo (1997).
- Jarzynski, Olano: *Hash functions for GPU rendering* (2020), para `pcg3d`.
