import './ui/style.css';
import { PHYSICS } from './config';
import { GameLoop } from './core/loop';
import { KeyboardInput } from './input/keyboard';
import { GameRenderer } from './render/gameRenderer';
import { World } from './sim';
import { Hud } from './ui/hud';
import { MatchHud } from './ui/matchHud';

const root = document.getElementById('game-root') as HTMLElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const debugEl = document.getElementById('debug-overlay') as HTMLElement;
const fatal = document.getElementById('fatal') as HTMLElement;

function showFatal(msg: string): void {
  fatal.hidden = false;
  fatal.textContent = msg;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function start(): void {
  if (!hasWebGL2()) {
    showFatal(
      'Tu navegador no soporta WebGL2, necesario para jugar a Turbo Arena. Prueba con un navegador actualizado.',
    );
    return;
  }

  // ?mode=match (1v1), match2 (2v2), match3 (3v3): partida con reglas contra coches inmóviles
  // (los bots llegan en F3). Sin parámetro: práctica libre.
  const mode = new URLSearchParams(location.search).get('mode') ?? 'practice';
  const perTeam = mode === 'match3' ? 3 : mode === 'match2' ? 2 : 1;
  const isMatch = mode.startsWith('match');
  const world = new World(Date.now() & 0xffff);
  const car = world.addCar(0, 'octane');
  const names = ['Tú'];
  if (isMatch) {
    for (let i = 1; i < perTeam; i++) {
      world.addCar(0, 'octane');
      names.push(`Azul ${i + 1}`);
    }
    for (let i = 0; i < perTeam; i++) {
      world.addCar(1, 'octane');
      names.push(`Naranja ${i + 1}`);
    }
    world.startMatch({ duration: 300 });
  } else world.resetKickoff();

  const renderer = new GameRenderer(canvas);
  renderer.setWorld(world, car.id);
  const keyboard = new KeyboardInput(root);
  const hud = new Hud(hudRoot);
  const matchHud = new MatchHud(hudRoot);
  matchHud.names = names;
  matchHud.setVisible(isMatch);
  root.focus({ preventScroll: true });

  const resize = (): void => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    renderer.resize(w, h);
  };
  new ResizeObserver(resize).observe(root);
  resize();

  let goalTimer = 0;
  const loop = new GameLoop(
    (dt) => {
      world.setInput(car.id, keyboard.poll(dt));
      world.step();
      for (const e of world.drainEvents()) {
        if (isMatch) {
          matchHud.onEvent(e, world);
          if (e.type === 'kickoffReset') renderer.rig.reset();
        } else if (e.type === 'goal' && goalTimer <= 0) goalTimer = 2.5;
      }
      if (goalTimer > 0) {
        goalTimer -= dt;
        if (goalTimer <= 0) {
          world.ball.reset(0, 0);
          renderer.rig.reset();
        }
      }
    },
    (alpha, frameDt) => {
      if (keyboard.consumePress('ballCam')) renderer.rig.ballCam = !renderer.rig.ballCam;
      renderer.rig.lookBack = keyboard.isDown('lookBack');
      if (keyboard.consumePress('reset')) {
        if (!isMatch) {
          world.resetKickoff();
          renderer.rig.reset();
        } else if (world.match.phase === 'ended') {
          world.startMatch({ duration: 300 }); // revancha
        }
      }
      if (keyboard.consumePress('debug')) {
        debugEl.hidden = !debugEl.hidden;
        renderer.debug.group.visible = !debugEl.hidden;
      }
      renderer.render(alpha, frameDt);
      hud.update(car);
      if (isMatch) matchHud.update(world.match, frameDt * 1000);
      if (!debugEl.hidden) {
        const s = loop.stats;
        debugEl.textContent = [
          `FPS ${s.fps.toFixed(0)}  física ${s.physicsMs.toFixed(2)} ms (${s.steps} pasos)  tick ${world.tick} @${PHYSICS.tickRate} Hz`,
          `vel ${car.speed.toFixed(0)} uu/s (${(car.speed * 0.036).toFixed(0)} km/h)  adelante ${car.forwardSpeed.toFixed(0)}  turbo ${car.boost.toFixed(1)}`,
          `ruedas ${car.wheelsInContact}/4  suelo ${car.grounded}  cuerpo ${car.bodyContact}  flip usado ${car.flipUsed}  aire ${car.airTime.toFixed(2)} s`,
          `pos ${car.pos.x.toFixed(0)}, ${car.pos.y.toFixed(0)}, ${car.pos.z.toFixed(0)}  pelota ${world.ball.pos.x.toFixed(0)}, ${world.ball.pos.y.toFixed(0)}, ${world.ball.pos.z.toFixed(0)}`,
        ].join('\n');
      }
    },
  );
  loop.start();

  // Para depuración desde la consola del navegador.
  (window as unknown as { __game: unknown }).__game = { world, renderer, loop, keyboard };
}

start();
