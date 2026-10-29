// Controlador del juego: estados (menú / jugando / pausa), partidas, repeticiones y bucle principal.
import { BALL, BOT_PROFILES, PHYSICS, QUICK_CHAT, resolveMutators } from './config';
import type { Action, GarageSettings, GoalExplosion, Theme } from './config';
import { AudioEngine } from './audio';
import type { Listener } from './audio';
import { botBody, botLook, playerLook } from './render/looks';
import { detectProfile } from './render/gpu';
import { PerformanceGovernor } from './render/quality';
import { loadAudio, loadGarage } from './storage';
import type { ResolvedMutators } from './config';
import { GameLoop } from './core/loop';
import { KeyboardInput } from './input/keyboard';
import { Recorder, ReplayPlayer, createRenderFrame } from './replay';
import { CinematicCam } from './render/cinematicCam';
import type { RenderView } from './render/gameRenderer';
import { GameRenderer } from './render/gameRenderer';
import { BotManager, Series, World } from './sim';
import type { Car, SimEvent } from './sim';
import { Vector3 } from 'three';
import { Hud } from './ui/hud';
import { HudExtras } from './ui/hudExtras';
import { MatchHud } from './ui/matchHud';
import type { EndAction } from './ui/matchHud';
import { Menus } from './ui/menus';
import type { GameSetup } from './ui/urlConfig';

type State = 'menu' | 'playing' | 'paused' | 'garage';

/** Segundos de juego previos al gol / posteriores que se muestran en la repetición. */
const REPLAY_BEFORE = 5;
const REPLAY_AFTER = 2;

export class Game {
  private renderer: GameRenderer;
  private governor: PerformanceGovernor;
  private adaptive = true;
  private profile: ReturnType<typeof detectProfile>;
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
  private audio = new AudioEngine(loadAudio());
  private garage: GarageSettings = loadGarage();
  private listener: Listener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 };

  constructor(
    private root: HTMLElement,
    canvas: HTMLCanvasElement,
    private hudRoot: HTMLElement,
    private debugEl: HTMLElement,
  ) {
    // Calidad adaptativa: nivel inicial según la GPU y gobernador de rendimiento (60 FPS objetivo).
    const profile = detectProfile(location.search);
    this.profile = profile;
    this.renderer = new GameRenderer(canvas, profile.start);
    this.governor = new PerformanceGovernor(profile.start, profile.max);
    this.adaptive = new URLSearchParams(location.search).get('adapt') !== '0';
    this.renderer.setRenderScale(this.governor.scale);
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
      garageEnter: (g) => this.enterGarage(g),
      garageChange: (g) => this.changeGarage(g),
      garageExplosion: (style) => this.renderer.previewExplosion(style),
      garageExit: () => this.exitGarage(),
      audioChange: (a) => this.audio.setSettings(a),
      ui: (k) => this.audio.ui(k),
    });
    // Política de autoplay: el audio arranca con la primera interacción.
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
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
      else this.startPractice(startup.mutators.theme);
    } else this.toMenu();
    this.loop.start();
    (window as unknown as { __game: unknown }).__game = this;
  }

  // ------------------------------------------------------------------ estados

  private background(): void {
    // Partida de demostración entre bots detrás de los menús.
    const w = new World(Date.now() & 0xffff);
    w.addCar(0, botBody(0));
    w.addCar(1, botBody(1));
    const bots = new BotManager(w, 42);
    bots.add(0, 'pro');
    bots.add(1, 'pro');
    w.startMatch({ duration: 0, overtime: false, replayTime: 0 });
    this.world = w;
    this.bots = bots;
    this.human = null;
    this.isMatch = true;
    this.renderer.setTheme('night');
    this.renderer.setWorld(w, 0, (id) => botLook(id, w.cars[id].team));
    this.renderer.setBallScale(1);
    this.recorder.clear();
    this.player.stop();
    this.audio.resetVoices();
  }

  private toMenu(): void {
    this.renderer.clearPreview();
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
    const human = world.addCar(this.humanTeam, this.garage.body);
    const bots = new BotManager(world, Date.now() & 0xffff);
    const names = [this.garage.name];
    const level = BOT_PROFILES[r.botLevel].name;
    const label = (t: 0 | 1): string => (t === 0 ? 'Azul' : 'Naranja');
    for (let i = 1; i < r.perTeam; i++) {
      const c = world.addCar(this.humanTeam, botBody(world.cars.length));
      bots.add(c.id, r.botLevel);
      names.push(`${label(this.humanTeam)} ${i + 1} (${level})`);
    }
    const other = this.humanTeam === 0 ? 1 : 0;
    for (let i = 0; i < r.perTeam; i++) {
      const c = world.addCar(other, botBody(world.cars.length));
      bots.add(c.id, r.botLevel);
      names.push(`${label(other)} ${i + 1} (${level})`);
    }
    world.applyMutators(r);
    world.startMatch(r.match);

    this.world = world;
    this.bots = bots;
    this.human = human;
    this.renderer.setTheme(r.theme);
    this.renderer.setWorld(
      world,
      human.id,
      (id) => this.lookOf(world, id),
      (id) => this.explosionOf(world, id),
    );
    this.audio.resetVoices();
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

  private startPractice(theme: Theme = 'day'): void {
    this.setup = null;
    this.resolved = null;
    this.isMatch = false;
    const world = new World(Date.now() & 0xffff);
    const human = world.addCar(0, this.garage.body);
    world.resetKickoff();
    this.world = world;
    this.bots = new BotManager(world);
    this.human = human;
    this.humanTeam = 0;
    this.renderer.setTheme(theme);
    this.renderer.setWorld(
      world,
      human.id,
      (id) => this.lookOf(world, id),
      (id) => this.explosionOf(world, id),
    );
    this.audio.resetVoices();
    this.renderer.setBallScale(1);
    this.player = new ReplayPlayer(this.recorder, createRenderFrame(1));
    this.beginGame();
    this.matchHud.setVisible(false);
    this.extras.setVisible(false);
    this.loop.timeScale = 1;
  }

  /** Apariencia: el coche del jugador usa el garaje; los demás, su equipo. */
  private lookOf(world: World, id: number): ReturnType<typeof playerLook> {
    const car = world.cars[id];
    return this.human && id === this.human.id
      ? playerLook(this.garage, car.team)
      : botLook(id, car.team);
  }

  private explosionOf(world: World, id: number): GoalExplosion {
    return this.human && id === this.human.id
      ? this.garage.explosion
      : (['classic', 'fireworks', 'confetti'] as const)[(id + world.cars[id].team) % 3];
  }

  // ------------------------------------------------------------------ garaje

  private enterGarage(g: GarageSettings): void {
    this.garage = g;
    this.state = 'garage';
    this.keyboard.enabled = false;
    this.renderer.setPreview(g.body, playerLook(g, 0));
  }

  private changeGarage(g: GarageSettings): void {
    this.garage = g;
    this.renderer.setPreview(g.body, playerLook(g, 0));
  }

  private exitGarage(): void {
    this.garage = loadGarage();
    this.renderer.clearPreview();
    this.state = 'menu';
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
    if (this.state === 'menu' || this.state === 'garage') return;
    this.renderer.onEvent(e);
    this.audio.onEvent(e, world, this.listener);
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
    if (this.state === 'garage') return;
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
    if (this.adaptive) {
      const r = this.governor.update(dt * 1000);
      if (r.tierChanged) this.renderer.setTier(this.governor.tier);
      if (r.scaleChanged) this.renderer.setRenderScale(this.governor.scale);
    }
    if (this.state === 'garage') {
      this.hudRoot.classList.add('hud-hidden');
      this.renderer.renderPreview(dt);
      this.audio.silenceCars();
      return;
    }
    if (this.state === 'menu') {
      this.hudRoot.classList.add('hud-hidden');
      this.renderer.render(alpha, dt, { pose: this.cam.orbit(this.menuTime) });
      this.audio.silenceCars();
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
    this.updateListener();
    this.audio.update(world, this.listener, this.state === 'playing' && !inReplay, dt);

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

  /** Oyente de audio: posición y eje derecho de la cámara, en coordenadas de la simulación. */
  private updateListener(): void {
    const cam = this.renderer.camera;
    const l = this.listener;
    l.x = cam.position.x;
    l.y = -cam.position.z;
    l.z = cam.position.y;
    cam.getWorldDirection(this.fwdTmp);
    // Derecha de la cámara (Three): forward × up.
    const fx = this.fwdTmp.x;
    const fz = this.fwdTmp.z;
    const len = Math.hypot(fx, fz) || 1;
    const rxT = -fz / len;
    const rzT = fx / len;
    l.rx = rxT;
    l.ry = -rzT;
    l.rz = 0;
  }

  private fwdTmp = new Vector3();

  private formatStats(): string {
    const st = this.renderer.stats();
    return `${st.calls} llamadas  ${(st.triangles / 1000).toFixed(0)}k tris`;
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
      `calidad ${this.renderer.quality.tier} (máx ${this.profile.max})  escala ${this.governor.scale}  frame ${this.governor.averageMs.toFixed(1)} ms  ${this.formatStats()}  ${this.governor.lastChange}`,
      `GPU: ${this.profile.renderer || 'desconocida'}`,
      ...this.bots.bots.map(
        (b) =>
          `bot ${b.car.id} ${b.currentRole}  boost ${b.car.boost.toFixed(0)}  v ${b.car.speed.toFixed(0)}`,
      ),
    ].join('\n');
  }
}
