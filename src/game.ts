// Controlador del juego: estados (menú / jugando / pausa), partidas, repeticiones y bucle principal.
import { BALL, BOT_PROFILES, PHYSICS, QUICK_CHAT, resolveMutators } from './config';
import type { Action } from './config';
import type { ResolvedMutators } from './config';
import { GameLoop } from './core/loop';
import { KeyboardInput } from './input/keyboard';
import { Recorder, ReplayPlayer, createRenderFrame } from './replay';
import { CinematicCam } from './render/cinematicCam';
import type { RenderView } from './render/gameRenderer';
import { GameRenderer } from './render/gameRenderer';
import { BotManager, Series, World } from './sim';
import type { Car, SimEvent } from './sim';
import { Hud } from './ui/hud';
import { HudExtras } from './ui/hudExtras';
import { MatchHud } from './ui/matchHud';
import type { EndAction } from './ui/matchHud';
import { Menus } from './ui/menus';
import type { GameSetup } from './ui/urlConfig';

type State = 'menu' | 'playing' | 'paused';

/** Segundos de juego previos al gol / posteriores que se muestran en la repetición. */
const REPLAY_BEFORE = 5;
const REPLAY_AFTER = 2;

export class Game {
  private renderer: GameRenderer;
  private keyboard: KeyboardInput;
  private hud: Hud;
  private matchHud: MatchHud;
  private extras: HudExtras;
  private menus: Menus;
  private loop: GameLoop;
  private recorder = new Recorder(PHYSICS.tickRate, 60, 12, 6);
  private player: ReplayPlayer;
  private cam = new CinematicCam();

  private state: State = 'menu';
  private world: World;
  private bots: BotManager;
  private human: Car | null = null;
  private humanTeam: 0 | 1 = 0;
  private setup: GameSetup | null = null;
  private resolved: ResolvedMutators | null = null;
  private isMatch = false;
  private series = new Series(0);
  private goalInfo = { time: 0, carId: 0, team: 0 as 0 | 1 };
  private menuTime = 0;
  private goalTimer = 0;
  private replayShown = false;
  private lastChat = -10;

  constructor(
    private root: HTMLElement,
    canvas: HTMLCanvasElement,
    private hudRoot: HTMLElement,
    private debugEl: HTMLElement,
  ) {
    this.renderer = new GameRenderer(canvas);
    this.keyboard = new KeyboardInput(root);
    this.hud = new Hud(hudRoot);
    this.matchHud = new MatchHud(hudRoot, (a) => this.onEndAction(a));
    this.extras = new HudExtras(hudRoot);
    this.menus = new Menus(root, {
      play: (s) => this.startMatch(s),
      practice: () => this.startPractice(),
      resume: () => this.resume(),
      restart: () => this.rematch(),
      abandon: () => this.toMenu(),
    });
    this.world = new World(1);
    this.bots = new BotManager(this.world);
    this.player = new ReplayPlayer(this.recorder, createRenderFrame(0));

    const resize = (): void => this.renderer.resize(root.clientWidth, root.clientHeight);
    new ResizeObserver(resize).observe(root);
    resize();

    // Auto-pausa al perder el foco.
    const autoPause = (): void => {
      if (this.state === 'playing') this.pause();
    };
    window.addEventListener('blur', autoPause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autoPause();
    });
    // Un clic salta la repetición.
    root.addEventListener('pointerdown', () => {
      if (this.state === 'playing' && this.world.match.phase === 'replay') this.skipReplay();
    });

    this.loop = new GameLoop(
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.frame(alpha, dt),
    );
  }

  /** Arranca: con `?mode=` en la URL entra directamente; si no, muestra el menú principal. */
  boot(startup: GameSetup | null): void {
    if (startup) {
      if (startup.mode === 'match') this.startMatch(startup);
      else this.startPractice();
    } else this.toMenu();
    this.loop.start();
    (window as unknown as { __game: unknown }).__game = this;
  }

  // ------------------------------------------------------------------ estados

  private background(): void {
    // Partida de demostración entre bots detrás de los menús.
    const w = new World(Date.now() & 0xffff);
    w.addCar(0);
    w.addCar(1);
    const bots = new BotManager(w, 42);
    bots.add(0, 'pro');
    bots.add(1, 'pro');
    w.startMatch({ duration: 0, overtime: false, replayTime: 0 });
    this.world = w;
    this.bots = bots;
    this.human = null;
    this.isMatch = true;
    this.renderer.setWorld(w, 0);
    this.renderer.setBallScale(1);
    this.recorder.clear();
    this.player.stop();
  }

  private toMenu(): void {
    this.background();
    this.state = 'menu';
    this.loop.paused = false;
    this.loop.timeScale = 1;
    this.keyboard.enabled = false;
    this.matchHud.reset();
    this.matchHud.setVisible(false);
    this.extras.setVisible(false);
    this.menus.showMain();
  }

  private beginGame(): void {
    this.state = 'playing';
    this.menus.hide();
    this.loop.paused = false;
    this.keyboard.enabled = true;
    this.keyboard.clearPressed();
    this.root.focus({ preventScroll: true });
    this.matchHud.reset();
    this.recorder.clear();
    this.goalTimer = 0;
    this.replayShown = false;
  }

  private startMatch(setup: GameSetup): void {
    this.setup = setup;
    const r = resolveMutators(setup.mutators);
    this.resolved = r;
    this.isMatch = true;
    this.humanTeam = setup.humanTeam;
    this.series = new Series(setup.mutators.series);

    const world = new World(Date.now() & 0xffff);
    const human = world.addCar(this.humanTeam, 'octane');
    const bots = new BotManager(world, Date.now() & 0xffff);
    const names = ['Tú'];
    const level = BOT_PROFILES[r.botLevel].name;
    const label = (t: 0 | 1): string => (t === 0 ? 'Azul' : 'Naranja');
    for (let i = 1; i < r.perTeam; i++) {
      const c = world.addCar(this.humanTeam, 'octane');
      bots.add(c.id, r.botLevel);
      names.push(`${label(this.humanTeam)} ${i + 1} (${level})`);
    }
    const other = this.humanTeam === 0 ? 1 : 0;
    for (let i = 0; i < r.perTeam; i++) {
      const c = world.addCar(other, 'octane');
      bots.add(c.id, r.botLevel);
      names.push(`${label(other)} ${i + 1} (${level})`);
    }
    world.applyMutators(r);
    world.startMatch(r.match);

    this.world = world;
    this.bots = bots;
    this.human = human;
    this.renderer.setWorld(world, human.id);
    this.renderer.setBallScale(r.ball.radius / BALL.radius);
    this.player = new ReplayPlayer(this.recorder, createRenderFrame(world.cars.length));
    this.matchHud.names = names;
    this.matchHud.humanId = human.id;
    this.matchHud.humanTeam = this.humanTeam;
    this.matchHud.teamIds = [
      world.cars.filter((c) => c.team === 0).map((c) => c.id),
      world.cars.filter((c) => c.team === 1).map((c) => c.id),
    ];
    this.extras.setup(world, names, human.id);
    this.beginGame();
    this.matchHud.setVisible(true);
    this.extras.setVisible(true);
    this.loop.timeScale = r.timeScale;
  }

  private startPractice(): void {
    this.setup = null;
    this.resolved = null;
    this.isMatch = false;
    const world = new World(Date.now() & 0xffff);
    const human = world.addCar(0, 'octane');
    world.resetKickoff();
    this.world = world;
    this.bots = new BotManager(world);
    this.human = human;
    this.humanTeam = 0;
    this.renderer.setWorld(world, human.id);
    this.renderer.setBallScale(1);
    this.player = new ReplayPlayer(this.recorder, createRenderFrame(1));
    this.beginGame();
    this.matchHud.setVisible(false);
    this.extras.setVisible(false);
    this.loop.timeScale = 1;
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.loop.paused = true;
    this.keyboard.enabled = false;
    this.menus.showPause(!this.isMatch);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.loop.paused = false;
    this.keyboard.enabled = true;
    this.keyboard.clearPressed();
    this.menus.hide();
    this.root.focus({ preventScroll: true });
  }

  private rematch(): void {
    if (!this.setup || !this.resolved) {
      if (this.state === 'paused') {
        this.startPractice();
      }
      return;
    }
    if (this.state === 'paused') this.resume();
    if (this.series.finished) this.series = new Series(this.setup.mutators.series);
    this.matchHud.reset();
    this.recorder.clear();
    this.player.stop();
    this.world.applyMutators(this.resolved);
    this.world.startMatch(this.resolved.match);
    this.replayShown = false;
  }

  private onEndAction(a: EndAction): void {
    if (a === 'rematch') this.rematch();
    else if (a === 'change') {
      this.toMenu();
      this.menus.showQuick();
    } else this.toMenu();
  }

  private skipReplay(): void {
    this.world.match.skipReplay(this.world);
    this.keyboard.clearPressed();
  }

  // ----------------------------------------------------------------- bucle

  private seriesText(winner: -1 | 0 | 1): string {
    const n = this.setup?.mutators.series ?? 0;
    if (n === 0) return '';
    this.series.record(winner);
    const mine = this.series.wins[this.humanTeam];
    const theirs = this.series.wins[this.humanTeam === 0 ? 1 : 0];
    const status = this.series.finished
      ? this.series.winner === this.humanTeam
        ? ' · Serie ganada'
        : ' · Serie perdida'
      : '';
    return `Serie al mejor de ${n}: ${mine} – ${theirs}${status}`;
  }

  private handleEvent(e: SimEvent): void {
    const world = this.world;
    this.bots.onEvent(e);
    if (this.state === 'menu') return;
    if (!this.isMatch) {
      if (e.type === 'goal' && this.goalTimer <= 0) this.goalTimer = 2.5;
      return;
    }
    switch (e.type) {
      case 'matchGoal': {
        // Cámara de repetición: el goleador; si no hay (autogol), el coche más cercano a la pelota.
        let carId = e.scorerId;
        if (carId < 0) {
          let best = Infinity;
          for (const c of world.cars) {
            const d = c.pos.distanceTo(world.ball.pos);
            if (d < best) {
              best = d;
              carId = c.id;
            }
          }
        }
        this.goalInfo = { time: world.time, carId, team: e.team };
        break;
      }
      case 'replayStart':
        this.player.begin(
          this.goalInfo.time,
          REPLAY_BEFORE,
          REPLAY_AFTER,
          this.goalInfo.carId,
          this.goalInfo.team,
        );
        this.keyboard.clearPressed();
        this.matchHud.setReplay(true);
        this.replayShown = true;
        break;
      case 'kickoffReset':
        this.matchHud.setReplay(false);
        this.player.stop();
        this.renderer.rig.reset();
        break;
      case 'matchEnd': {
        this.matchHud.seriesText = this.seriesText(e.winner);
        this.matchHud.seriesContinues =
          !!this.setup && this.setup.mutators.series > 0 && !this.series.finished;
        break;
      }
      default:
        break;
    }
    this.matchHud.onEvent(e, world);
    this.extras.onEvent(e);
  }

  private fixedUpdate(dt: number): void {
    const world = this.world;
    this.bots.update();
    if (this.human && this.state === 'playing')
      world.setInput(this.human.id, this.keyboard.poll(dt));
    world.step();
    if (!world.match.frozen) this.recorder.capture(world);
    for (const e of world.drainEvents()) this.handleEvent(e);
    if (this.goalTimer > 0) {
      this.goalTimer -= dt;
      if (this.goalTimer <= 0) {
        world.ball.reset(0, 0);
        this.renderer.rig.reset();
      }
    }
  }

  private frame(alpha: number, dt: number): void {
    this.menuTime += dt;
    if (this.state === 'menu') {
      this.hudRoot.classList.add('hud-hidden');
      this.renderer.render(alpha, dt, { pose: this.cam.orbit(this.menuTime) });
      return;
    }

    const world = this.world;
    const k = this.keyboard;
    const inReplay = this.isMatch && world.match.phase === 'replay' && this.player.active;

    if (this.state === 'playing') {
      if (k.consumePress('pause')) this.pause();
      if (k.consumePress('ballCam')) this.renderer.rig.ballCam = !this.renderer.rig.ballCam;
      this.renderer.rig.lookBack = k.isDown('lookBack');
      if (inReplay && k.consumePress('jump')) this.skipReplay();
      if (k.consumePress('reset')) {
        if (!this.isMatch) {
          world.resetKickoff();
          this.renderer.rig.reset();
        } else if (world.match.phase === 'ended') this.rematch();
      }
      if (this.isMatch && this.human && !inReplay) {
        QUICK_CHAT.forEach((text, i) => {
          if (k.consumePress(`chat${i + 1}` as Action) && world.time - this.lastChat > 1) {
            this.lastChat = world.time;
            world.emit({ type: 'chat', carId: this.human?.id ?? 0, text });
          }
        });
      }
      if (k.consumePress('debug')) {
        this.debugEl.hidden = !this.debugEl.hidden;
        this.renderer.debug.group.visible = !this.debugEl.hidden;
      }
    }

    let view: RenderView | undefined;
    if (inReplay) {
      const total = world.match.config.replayTime || this.player.duration;
      const elapsed = Math.max(0, total - world.match.timer);
      this.player.seek(elapsed);
      view = {
        frame: this.player.frame,
        pose: this.cam.replay(
          elapsed,
          total,
          this.player.frame,
          this.player.focusCarId,
          this.player.scoringTeam,
        ),
      };
    }
    this.renderer.render(alpha, dt, view);

    this.hudRoot.classList.toggle('hud-hidden', inReplay);
    const human = this.human;
    if (human) {
      this.hud.update(human);
      if (this.isMatch) {
        this.matchHud.update(world.match, dt * 1000);
        this.extras.update(
          world,
          this.renderer,
          human.id,
          !inReplay && world.match.phase !== 'ended',
          this.state === 'playing' && k.isDown('scoreboard') && !inReplay,
        );
      }
    }
    if (!this.debugEl.hidden && human) this.updateDebug(human);
  }

  private updateDebug(car: Car): void {
    const s = this.loop.stats;
    const world = this.world;
    this.debugEl.textContent = [
      `FPS ${s.fps.toFixed(0)}  física ${s.physicsMs.toFixed(2)} ms (${s.steps} pasos)  tick ${world.tick} @${PHYSICS.tickRate} Hz`,
      `vel ${car.speed.toFixed(0)} uu/s (${(car.speed * 0.036).toFixed(0)} km/h)  adelante ${car.forwardSpeed.toFixed(0)}  turbo ${car.boost.toFixed(1)}`,
      `ruedas ${car.wheelsInContact}/4  suelo ${car.grounded}  cuerpo ${car.bodyContact}  flip usado ${car.flipUsed}  aire ${car.airTime.toFixed(2)} s`,
      `pos ${car.pos.x.toFixed(0)}, ${car.pos.y.toFixed(0)}, ${car.pos.z.toFixed(0)}  pelota ${world.ball.pos.x.toFixed(0)}, ${world.ball.pos.y.toFixed(0)}, ${world.ball.pos.z.toFixed(0)}`,
      `repetición: ${this.recorder.length} fotogramas  fase ${world.match.phase}  mostrada ${this.replayShown}`,
      ...this.bots.bots.map(
        (b) =>
          `bot ${b.car.id} ${b.currentRole}  boost ${b.car.boost.toFixed(0)}  v ${b.car.speed.toFixed(0)}`,
      ),
    ].join('\n');
  }
}
