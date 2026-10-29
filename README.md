# Turbo Arena

Fútbol con coches propulsados por cohetes para el navegador, inspirado en las **mecánicas** del modo Soccar.
TypeScript estricto + Vite + Three.js (WebGL2) con una simulación física propia, determinista y separada del render.

> Juego original: no usa nombres, logos, modelos, texturas ni sonidos de Psyonix/Epic Games.
> Todos los assets se generan por código (ver `CREDITS.md`).

**Estado: Fase F4 (parcial)** (ver [Plan de fases](#plan-de-fases)). Menú principal, práctica libre y
**partidas completas contra bots** en 1v1, 2v2 y 3v3 (Azul vs Naranja), con reglas Soccar (saque 3-2-1, reloj,
goles con goleador y velocidad, prórroga con gol de oro, demoliciones, puntuación), 3 niveles de bots, partida
personalizada con mutadores, **repetición de cada gol** con cámaras cinemáticas y pantalla de resultados.
De F4 quedan para otra entrega: ajustes persistentes y reasignación de teclas, cámara con ajustes, mando y táctil.

## Menús y pantallas

- **Menú principal**: Jugar (formato, equipo, nivel de bots), Partida personalizada (todos los mutadores),
  Práctica libre, Créditos. _Garaje_ y _Ajustes_ aparecen deshabilitados hasta sus fases. La última
  configuración se recuerda en `localStorage`.
- **Pausa** (`Esc`, o automática al perder el foco): Continuar, Reiniciar partida, Abandonar.
- **Repetición**: tras cada gol y 2,5 s de juego libre se reproducen ≈7 s con tres planos (seguimiento del
  goleador, órbita sobre la pelota y cámara de línea de gol). `Espacio` o clic para saltarla.
- **Resultados**: ganador, marcador, serie, tablas por equipo con MVP y botones _Revancha / Siguiente
  partido_, _Cambiar modo_ y _Menú principal_ (`R` = revancha).
- **HUD**: marcador y reloj (en prórroga `+m:ss`), turbo circular con km/h, nombres sobre los coches, barras
  de turbo de compañeros, registro de eventos (demoliciones, paradas, asistencias), avisos de puntos,
  chat rápido (`1`–`4`) y marcador completo con `Tab`.

## Modos y configuración por URL

| URL                                   | Qué hace                                        |
| ------------------------------------- | ----------------------------------------------- |
| `/`                                   | Práctica libre (pelota y coche, `R` reinicia)   |
| `/?mode=match`                        | Partida 1v1 contra un bot Pro                   |
| `/?mode=match&format=3v3&bots=legend` | 3v3 (tus compañeros y rivales son bots Leyenda) |

Parámetros (todos opcionales, valores inválidos se ignoran):

| Parámetro    | Valores                                         | Por defecto |
| ------------ | ----------------------------------------------- | ----------- |
| `format`     | `1v1`, `2v2`, `3v3`                             | `1v1`       |
| `bots`       | `rookie` (Novato), `pro`, `legend` (Leyenda)    | `pro`       |
| `team`       | `blue`, `orange` (tu equipo)                    | `blue`      |
| `duration`   | `0` (ilimitada), `3`, `5`, `10`, `20` (minutos) | `5`         |
| `goals`      | goles máximos para ganar (0 = sin límite)       | `0`         |
| `overtime`   | `0` desactiva la prórroga                       | activa      |
| `series`     | `0`, `3`, `5`, `7` (al mejor de)                | `0`         |
| `speed`      | `normal`, `slow`, `fast` (velocidad de juego)   | `normal`    |
| `ballsize`   | `default`, `small`, `large`, `giant`            | `default`   |
| `bounce`     | `default`, `low`, `high`, `super`               | `default`   |
| `weight`     | `default`, `light`, `heavy`, `superLight`       | `default`   |
| `ballspeed`  | `default`, `slow`, `fast`, `super`              | `default`   |
| `boost`      | `normal`, `none`, `unlimited`, `recharge`       | `normal`    |
| `boostpower` | `1`, `1.5`, `2`, `10`                           | `1`         |
| `gravity`    | `low`, `normal`, `high`                         | `normal`    |
| `demo`       | `normal`, `off`, `friendly`, `contact`          | `normal`    |
| `respawn`    | segundos de reaparición tras demolición         | `3`         |
| `theme`      | `day`, `night`, `neon` (temas en F5)            | `day`       |

Ejemplo: `/?mode=match&format=2v2&bots=legend&ballsize=giant&gravity=low&series=3`.
Al terminar una partida, `R` = revancha (o siguiente partido de la serie).

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
| Marcador completo        | `Tab` (mantener)                                      |
| Chat rápido              | `1` `2` `3` `4`                                       |
| Pausa                    | `Esc`                                                 |
| Depuración               | `F3` (hitboxes, contactos de ruedas, velocidad, FPS)  |

Las teclas por defecto están en `src/config/controls.ts` (la reasignación desde Ajustes llega en una fase posterior).

## Estructura del proyecto

```
src/
  config/   TODAS las constantes (física, estadio, pads, carrocerías, cámara, teclas)
  sim/      simulación determinista sin DOM ni Three.js (paso fijo 120 Hz)
    ai/            bots: predicción de pelota, control, roles/rotación, habilidades
    series.ts      serie al mejor de 3/5/7
    arena.ts       SDF analítico del estadio + detección de gol
    ball.ts        pelota (rebote, fricción → giro)
    car.ts         controlador del coche (suelo/paredes/techo, salto, flip, aire, turbo)
    collisions.ts  coche↔estadio, pelota↔coche (impulso extra), coche↔coche (SAT)
    pads.ts        34 pads de turbo
    match.ts       reglas: fases, reloj, goles, prórroga, puntuación, estadísticas
    world.ts       estado, paso, eventos, snapshots (serializable)
    input.ts       CarInput: la única estructura de entrada
  render/   Three.js: estadio procedural, coche, pelota, pads, cámara, depuración
  input/    teclado (rampa digital); mando y táctil pendientes
  core/     bucle de paso fijo con acumulador + render interpolado
  replay/   grabador circular de estados + reproductor interpolado (sin DOM)
  ui/       HUD, menús y pantallas en HTML/CSS
  game.ts   controlador: estados menú/jugando/pausa, partidas, repeticiones
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
