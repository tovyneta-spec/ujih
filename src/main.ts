import './ui/style.css';
import { BALL, BOT_PROFILES, PHYSICS, resolveMutators } from './config';
import { GameLoop } from './core/loop';
import { KeyboardInput } from './input/keyboard';
import { GameRenderer } from './render/gameRenderer';
import { BotManager, Series, World } from './sim';
import { Hud } from './ui/hud';
import { MatchHud } from './ui/matchHud';
import { parseSetup } from './ui/urlConfig';

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

  // Configuración por URL (los menús llegan en F4):
  //   /                      práctica libre
  //   /?mode=match           1v1 contra bots; añade &format=2v2|3v3, &bots=rookie|pro|legend, &team=orange
  //   mutadores: duration, goals, overtime, series, speed, ballsize, bounce, weight, ballspeed,
  //              boost, boostpower, gravity, demo, respawn, theme (ver README)
  const setup = parseSetup(location.search);
  const isMatch = setup.mode === 'match';
  const resolved = resolveMutators(setup.mutators);

  const world = new World(Date.now() & 0xffff);
  const humanTeam = setup.humanTeam;
  const human = world.addCar(humanTeam, 'octane');
  const names: string[] = ['Tú'];
  const bots = new BotManager(world, Date.now() & 0xffff);
  let series = new Series(setup.mutators.series);

  if (isMatch) {
    const levelName = BOT_PROFILES[resolved.botLevel].name;
    const label = (team: 0 | 1): string => (team === 0 ? 'Azul' : 'Naranja');
    // Compañeros y rivales: plazas libres ocupadas por bots.
    for (let i = 1; i < resolved.perTeam; i++) {
      const c = world.addCar(humanTeam, 'octane');
      bots.add(c.id, resolved.botLevel);
      names.push(`${label(humanTeam)} ${i + 1} (${levelName})`);
    }
    const other = humanTeam === 0 ? 1 : 0;
    for (let i = 0; i < resolved.perTeam; i++) {
      const c = world.addCar(other, 'octane');
      bots.add(c.id, resolved.botLevel);
      names.push(`${label(other)} ${i + 1} (${levelName})`);
    }
    world.applyMutators(resolved);
    world.startMatch(resolved.match);
  } else world.resetKickoff();

  const renderer = new GameRenderer(canvas);
  renderer.setWorld(world, human.id);
  renderer.setBallScale(isMatch ? resolved.ball.radius / BALL.radius : 1);
  const keyboard = new KeyboardInput(root);
  const hud = new Hud(hudRoot);
  const matchHud = new MatchHud(hudRoot);
  matchHud.names = names;
  matchHud.humanId = human.id;
  matchHud.humanTeam = humanTeam;
  matchHud.setVisible(isMatch);
  root.focus({ preventScroll: true });

  const resize = (): void => renderer.resize(root.clientWidth, root.clientHeight);
  new ResizeObserver(resize).observe(root);
  resize();

  const seriesText = (winner: -1 | 0 | 1): string => {
    if (setup.mutators.series === 0) return '';
    series.record(winner);
    const mine = series.wins[humanTeam];
    const theirs = series.wins[humanTeam === 0 ? 1 : 0];
    const status = series.finished
      ? series.winner === humanTeam
        ? ' · Serie ganada'
        : ' · Serie perdida'
      : '';
    return `Serie al mejor de ${setup.mutators.series}: ${mine} – ${theirs}${status}`;
  };

  let goalTimer = 0;
  const loop = new GameLoop(
    (dt) => {
      bots.update();
      world.setInput(human.id, keyboard.poll(dt));
      world.step();
      for (const e of world.drainEvents()) {
        if (isMatch) {
          if (e.type === 'matchEnd') matchHud.seriesText = seriesText(e.winner);
          matchHud.onEvent(e, world);
          bots.onEvent(e);
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
          // Revancha / siguiente partido de la serie / nueva serie.
          if (series.finished) series = new Series(setup.mutators.series);
          world.applyMutators(resolved);
          world.startMatch(resolved.match);
        }
      }
      if (keyboard.consumePress('debug')) {
        debugEl.hidden = !debugEl.hidden;
        renderer.debug.group.visible = !debugEl.hidden;
      }
      renderer.render(alpha, frameDt);
      hud.update(human);
      if (isMatch) matchHud.update(world.match, frameDt * 1000);
      if (!debugEl.hidden) {
        const s = loop.stats;
        const car = human;
        debugEl.textContent = [
          `FPS ${s.fps.toFixed(0)}  física ${s.physicsMs.toFixed(2)} ms (${s.steps} pasos)  tick ${world.tick} @${PHYSICS.tickRate} Hz`,
          `vel ${car.speed.toFixed(0)} uu/s (${(car.speed * 0.036).toFixed(0)} km/h)  adelante ${car.forwardSpeed.toFixed(0)}  turbo ${car.boost.toFixed(1)}`,
          `ruedas ${car.wheelsInContact}/4  suelo ${car.grounded}  cuerpo ${car.bodyContact}  flip usado ${car.flipUsed}  aire ${car.airTime.toFixed(2)} s`,
          `pos ${car.pos.x.toFixed(0)}, ${car.pos.y.toFixed(0)}, ${car.pos.z.toFixed(0)}  pelota ${world.ball.pos.x.toFixed(0)}, ${world.ball.pos.y.toFixed(0)}, ${world.ball.pos.z.toFixed(0)}`,
          ...bots.bots.map(
            (b) =>
              `bot ${b.car.id} ${b.currentRole}  boost ${b.car.boost.toFixed(0)}  v ${b.car.speed.toFixed(0)}`,
          ),
        ].join('\n');
      }
    },
  );
  loop.timeScale = isMatch ? resolved.timeScale : 1;
  loop.start();

  // Para depuración desde la consola del navegador.
  (window as unknown as { __game: unknown }).__game = { world, renderer, loop, keyboard, bots };
}

start();
