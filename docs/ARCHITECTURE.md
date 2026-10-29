# Arquitectura de Turbo Arena

## Principios

1. **Simulación separada del render.** `src/sim/` no importa DOM ni Three.js. Corre con paso fijo de 1/120 s
   (acumulador en `core/loop.ts`); el render interpola entre los dos últimos estados (`prevPos/prevQuat`).
2. **Determinismo y serialización.** RNG con semilla (`sim/rng.ts`), sin `Math.random` en la simulación y
   `World.snapshot()/restore()` serializable (base de repeticiones y netcode).
3. **Una sola entrada.** `CarInput { throttle, steer, pitch, yaw, roll, jump, boost, handbrake }` es lo único que
   consume la simulación; la producen teclado, mando, táctil, bots y red.
4. **Constantes centralizadas** en `src/config/`.
5. **Sin dependencias en ejecución** salvo Three.js, empaquetado en el build (`base: './'`).

## Decisión de física: motor propio (sin Rapier ni raycast-vehicle)

El comportamiento del coche de Soccar es muy específico (curvatura de dirección dependiente de la velocidad,
aceleración con caída lineal, "pegamento" a cualquier superficie, flips con par controlado, impulso extra de
golpeo). Un motor genérico obligaría a pelear contra su solver para imitarlo, y añadiría un WASM de ~1 MB.
Con un motor propio:

- el paso es determinista y trivialmente serializable (necesario para repeticiones y netcode con el servidor
  ejecutando la misma `sim/`);
- el coste es mínimo (≈0,1 ms por paso con 1 coche; presupuesto ≤ 4 ms/frame);
- cada regla del coche es una función legible y ajustable.

**Colisión con el estadio: SDF analítico** (`sim/arena.ts`). El interior es la intersección redondeada de una
planta de rectángulo con esquinas circulares (radio 1152) y el slab suelo–techo con rampas circulares (radio
260), unida a una caja de portería que recorta la rampa. Ventajas: sin huecos ni atascos por construcción,
normales suaves en las transiciones (coches y pelota circulan por paredes y techo sin saltos) y coste constante.
Las normales se obtienen por diferencias centrales.

**Coche.** Cuerpo rígido (masa 180, inercia de caja) con hitbox OBB. Las 8 esquinas se resuelven contra el SDF
con impulsos + corrección posicional (`collisions.ts`); las 4 inferiores son las "ruedas". Con ≥3 ruedas
apoyadas el coche está "en el suelo": se aplican motor/freno/deriva, agarre lateral, fuerza adhesiva y
dirección por curvatura sobre la normal de la superficie. En el aire actúan pitch/yaw/roll con amortiguación.
Las mecánicas avanzadas (cancelación de flip, half-flip, wavedash, aéreos, dribbling, flicks, flip reset)
**emergen** de estas reglas: no hay atajos programados.

**Pelota.** Esfera con rebote (0,6), fricción de Coulomb 0,35 que genera giro y resistencia del aire.
**Coche–pelota:** esfera–OBB con fricción alta y, en el primer instante del contacto, un impulso extra
dependiente de la velocidad relativa y de la zona de contacto (componente vertical atenuada al 35 %, componente
frontal al 65 %), que produce el característico "pop".

## Repeticiones (`src/replay/`)

`Recorder` guarda a 60 Hz un búfer circular de 12 s con el estado _visual_ (pose de coches y pelota, turbo,
demolición, dirección). Al marcar, la simulación entra en la fase `replay` (congelada, temporizador de
`replayTime`) y `ReplayPlayer` reproduce el segmento [gol − 5 s, gol + 2 s] interpolado. El renderer acepta un
`RenderView` (fotograma + cámara) en lugar del estado vivo, de modo que la repetición no toca la simulación.
Las cámaras (`render/cinematicCam.ts`) son tres planos: persecución del goleador, órbita sobre la pelota y línea
de gol. Saltar la repetición llama a `Match.skipReplay`, que lleva directamente al saque.

## IA de bots (`src/sim/ai/`)

Los bots viven en `sim/` (sin DOM) y producen un `CarInput` por tick: **la misma entrada y la misma física que
un jugador**, sin trampas de velocidad ni teletransportes (hay un test que lo comprueba).

- **Predicción** (`prediction.ts`): la pelota se simula 2,6 s hacia delante con su propia física (gravedad,
  aire, rebotes en el SDF) a 20 Hz compartidos por todos los bots.
- **Intercepción y roles** (`manager.ts`): cada bot calcula el primer punto de la trayectoria al que llega a
  tiempo. El más rápido de su equipo ataca (con histéresis para no oscilar); el más retrasado defiende y el
  resto apoya. De ahí sale la **rotación** 1.º/2.º/3.er hombre. En 1v1 ataca si llega antes que el rival.
- **Comportamiento** (`bot.ts`): saque (el más cercano va a por la pelota, los demás a por turbo), ataque con
  aproximación por detrás de la pelota para no golpear hacia la propia portería, despeje a las bandas en el
  tercio propio, pase a un compañero adelantado, defensa entre pelota y portería, gestión de turbo, flips
  para golpear, aéreos (el objetivo se persigue con un controlador de empuje + actitud), recuperación y
  aterrizaje sobre las ruedas, bajada de paredes/techo, demoliciones oportunistas (Leyenda) y detección de
  atasco con maniobra de salida. Cada nivel limita reacción, precisión y mecánicas (`config/bots.ts`).
- **Chat rápido** contextual (`chat` en los eventos): "¡La tengo!", "¡Defendiendo!", "¡Buen tiro!", "¡Gracias!".

## Mutadores (`config/mutators.ts`)

`Mutators` (lo que elige el jugador) se traduce con `resolveMutators()` a valores numéricos que aplica
`World.applyMutators()`: tamaño/rebote/peso/velocidad máxima de la pelota, gravedad, modo y fuerza del turbo,
demoliciones, reaparición, duración, goles máximos y prórroga. La velocidad de juego escala el bucle de render
(`GameLoop.timeScale`) sin tocar el paso fijo, y la serie al mejor de N la gestiona `Series`.

## Ejes y unidades

Unidades de juego (uu, 1 uu = 1 cm). Ejes de la simulación: x = ancho, y = largo (portería azul en y < 0),
z = arriba. En el render, el grupo raíz se rota −90° en x, de modo que los objetos usan directamente
coordenadas de la simulación.

## Supuestos

- Se usa un radio de esquina vertical de 1152 uu y rampas de 260 uu (aproximación del estadio estándar).
- Los postes y el larguero son aristas del SDF (grosor visual de 22 uu, colisión de arista viva).
- La hitbox coincide con el centro físico; el desplazamiento visual (`visualOffset`) sólo afecta al modelo.
- El flip aplica un impulso horizontal de 500 uu/s en el rumbo plano del coche y un par controlado de ≈0,65 s.
- La pelota hace "gol" al cruzar por completo la línea (centro a más de su radio tras la línea de fondo).
- El reloj y las reglas viven en la simulación (`sim/match.ts`) para que el servidor autoritativo (F7) y las
  repeticiones usen la misma lógica. Sin `startMatch()` el mundo está en práctica libre (sin reglas).
- Una demolición exige embestir con la zona frontal (45 uu del morro) yendo supersónico (≥2200 uu/s); el
  atacante conserva su velocidad. Los empujones añaden un impulso extra al rival (`CAR_CAR`).
- Parada = el rival había hecho un tiro a puerta (predicción balística sin rebotes) y su trayectoria deja
  de ir a puerta tras el toque; épica si el tiro iba a ≥2200 uu/s y ocurre a ≤1400 uu de la línea.
- Se considera autogol si el último toque fue del equipo que defiende esa portería.

## Problemas conocidos (F1)

- Sin menús (F4): las partidas se arrancan y configuran por URL.
- Los bots no conducen por paredes/techo a propósito (`wallPlay: false`) y los aéreos de Pro/Leyenda fallan a
  veces: es intencionado; afina `config/bots.ts` y `sim/ai/bot.ts` si quieres otro nivel de exigencia.
- El estado interno de los bots (RNG, habilidades) no entra en los snapshots: para repeticiones se graban
  sus entradas, y un servidor autoritativo (F7) los ejecuta él mismo.
- El tema de estadio de los mutadores se acepta pero no cambia nada hasta F5.
- La repetición muestra los pads tal y como están en vivo (no se graban sus estados).
- Si el navegador va muy por debajo de 60 FPS, la repetición se reproduce igualmente en tiempo de simulación.
- La explosión de demolición es sólo ocultar el coche; los efectos llegan en F5.
- Los modelos de las 6 carrocerías comparten generador procedural con parámetros distintos; se diferenciarán
  más en F5.
- La sensación de juego (curvas de giro, flip, golpeo) se ha calibrado con pruebas numéricas, no con jugadores:
  afínala en `src/config/physics.ts`.
- Visual aún básico: sin bloom, partículas, audio ni gradas (F5).
