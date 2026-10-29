# Turbo Arena

Fútbol con coches propulsados por cohetes para el navegador, inspirado en las **mecánicas** del modo Soccar.
TypeScript estricto + Vite + Three.js (WebGL2) con una simulación física propia, determinista y separada del render.

> Juego original: no usa nombres, logos, modelos, texturas ni sonidos de Psyonix/Epic Games.
> Todos los assets se generan por código (ver `CREDITS.md`).

**Estado: Fase F2** (ver [Plan de fases](#plan-de-fases)). Práctica libre jugable (estadio, pelota, coche con
todas las mecánicas, pads, cámaras, HUD, depuración) y **partida con reglas Soccar**: saque 3-2-1, reloj,
goles con goleador y velocidad, prórroga con gol de oro, demoliciones, puntuación y pantalla final.

Modos de prueba (hasta que lleguen menús y bots en F3/F4), por URL:

- `/` práctica libre
- `/?mode=match` 1v1, `/?mode=match2` 2v2, `/?mode=match3` 3v3 — rivales y compañeros inmóviles; `R` al
  terminar = revancha.

## Instalación y ejecución

Requisitos: Node.js ≥ 18.

```bash
npm install
npm run dev        # servidor de desarrollo (Vite)
npm run build      # typecheck + build estático en dist/
npm run preview    # sirve dist/ en local
npm test           # tests de la simulación (Vitest)
npm run lint       # ESLint
npm run format     # Prettier
```

## Despliegue

`npm run build` genera `dist/` con rutas **relativas** (`base: './'`): súbelo tal cual a GitHub Pages,
Netlify, Vercel o cualquier hosting estático (sin CDN ni dependencias externas en ejecución).

Para incrustarlo en tu web:

```html
<iframe
  src="https://tu-sitio.com/turbo-arena/"
  width="960"
  height="540"
  allow="fullscreen; gamepad"
  style="border:0"
></iframe>
```

El juego sólo captura el teclado cuando tiene el foco (clic dentro) y bloquea el scroll de flechas/espacio
únicamente entonces.

## Controles (F1)

| Acción                   | Teclado                                               |
| ------------------------ | ----------------------------------------------------- |
| Acelerar / frenar        | `W`/`S` o `↑`/`↓` (en el aire: morro abajo / arriba)  |
| Girar                    | `A`/`D` o `←`/`→` (en el aire: guiñada)               |
| Saltar                   | `Espacio` (mantener = más alto)                       |
| Doble salto / flip       | `Espacio` otra vez en el aire (+ dirección = flip 8D) |
| Turbo                    | `Shift` (mantener)                                    |
| Derrape                  | `Ctrl` o `Z` (en el aire + `A`/`D`: giro aéreo)       |
| Giro aéreo               | `Q` / `E`                                             |
| Cámara de pelota / coche | `C`                                                   |
| Mirar atrás              | `V` (mantener)                                        |
| Reiniciar                | `R`                                                   |
| Depuración               | `F3` (hitboxes, contactos de ruedas, velocidad, FPS)  |

Las teclas por defecto están en `src/config/controls.ts` (la reasignación desde Ajustes llega en F4).

## Estructura del proyecto

```
src/
  config/   TODAS las constantes (física, estadio, pads, carrocerías, cámara, teclas)
  sim/      simulación determinista sin DOM ni Three.js (paso fijo 120 Hz)
    arena.ts       SDF analítico del estadio + detección de gol
    ball.ts        pelota (rebote, fricción → giro)
    car.ts         controlador del coche (suelo/paredes/techo, salto, flip, aire, turbo)
    collisions.ts  coche↔estadio, pelota↔coche (impulso extra), coche↔coche (SAT)
    pads.ts        34 pads de turbo
    match.ts       reglas: fases, reloj, goles, prórroga, puntuación, estadísticas
    world.ts       estado, paso, eventos, snapshots (serializable)
    input.ts       CarInput: la única estructura de entrada
  render/   Three.js: estadio procedural, coche, pelota, pads, cámara, depuración
  input/    teclado (rampa digital); mando y táctil llegan en F4
  core/     bucle de paso fijo con acumulador + render interpolado
  ui/       HUD HTML/CSS
tests/      Vitest sobre la simulación
docs/       arquitectura y decisiones
```

## Ajustar la sensación de juego

Todo está en `src/config/physics.ts`, con comentarios. Los más influyentes:

- `CAR.engineAccel`, `CAR.steerCurvature`, `CAR.lateralGrip`, `CAR.lateralGripHandbrake`: conducción y derrape.
- `CAR.jump.*`: impulso, empuje mantenido, ventana de flip (1,25 s), impulso y giro del flip.
- `CAR.air.*`: aceleraciones angulares y amortiguación del control aéreo.
- `CAR.hit.*`: restitución, fricción y curva del impulso extra de golpeo ("pop").
- `BALL.*`: restitución, fricción, resistencia del aire, velocidad máxima.
- `src/config/camera.ts`: FOV 110, distancia 270, altura 100, ángulo −3°, rigidez 0,45, giro 4,7, transición 1,2.

Tras cambiar constantes, `npm test` verifica que nada básico se rompe.

## Plan de fases

| Fase | Contenido                                                                          | Estado    |
| ---- | ---------------------------------------------------------------------------------- | --------- |
| F0   | Esqueleto Vite+TS+Three, bucle de paso fijo, config, entrada, modo debug           | ✅        |
| F1   | Estadio + pelota + coche (suelo, saltos, flips, aire, turbo, paredes/techo), pads  | ✅        |
| F2   | Reglas Soccar (saque, goles, reloj, prórroga, reset de pads, demoliciones, puntos) | pendiente |
| F3   | 1v1/2v2/3v3 con bots (3 niveles), equipos y partida personalizada                  | pendiente |
| F4   | Cámara completa, HUD, menús, ajustes, mando y táctil, repeticiones y resultados    | pendiente |
| F5   | Pulido gráfico, efectos, audio, garaje, temas                                      | pendiente |
| F6   | Pantalla dividida, PWA, optimización y QA                                          | pendiente |
| F7   | Multijugador online (opcional)                                                     | pendiente |

## Supuestos y problemas conocidos

Ver `docs/ARCHITECTURE.md` (sección "Supuestos") y la lista de problemas conocidos al final de ese documento.
