// Reglas de Soccar: fases de partida, reloj, goles, prórroga con gol de oro, puntuación y estadísticas.
import { ARENA, BALL, DEFAULT_MATCH_CONFIG, MATCH, PHYSICS } from '../config';
import type { MatchConfig } from '../config';
import { arenaDepth } from './arena';
import type { Car } from './car';
import type { World } from './world';

export type MatchPhase =
  | 'countdown' // 3-2-1, todo congelado
  | 'kickoff' // juego activo, reloj detenido hasta el primer toque
  | 'playing'
  | 'goal' // juego libre tras el gol, reloj detenido
  | 'replay' // simulación congelada mientras la UI reproduce la repetición
  | 'ended';

export interface CarStats {
  score: number;
  goals: number;
  assists: number;
  saves: number;
  epicSaves: number;
  shots: number;
  demos: number;
}

interface Touch {
  carId: number;
  team: 0 | 1;
  time: number;
  ballSpeed: number;
}

interface PendingShot {
  team: 0 | 1;
  speed: number;
  expires: number;
}

export interface MatchSnapshot {
  enabled: boolean;
  config: MatchConfig;
  phase: MatchPhase;
  timer: number;
  timeRemaining: number;
  overtime: boolean;
  overtimeTime: number;
  timeUp: boolean;
  score: [number, number];
  stats: CarStats[];
  touches: Touch[];
  pendingShot: PendingShot | null;
  shotTimes: number[];
  lastCountdown: number;
  winner: -1 | 0 | 1 | null;
  touchedAtKickoff: boolean;
}

const emptyStats = (): CarStats => ({
  score: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  epicSaves: 0,
  shots: 0,
  demos: 0,
});

export class Match {
  /** Sin partida activa el mundo funciona en práctica libre (sin reglas). */
  enabled = false;
  config: MatchConfig = { ...DEFAULT_MATCH_CONFIG };
  phase: MatchPhase = 'playing';
  /** Temporizador de la fase actual (cuenta atrás, celebración, repetición). */
  timer = 0;
  timeRemaining = 0;
  overtime = false;
  overtimeTime = 0;
  /** El tiempo reglamentario se ha agotado y se espera a que la pelota toque el suelo. */
  timeUp = false;
  score: [number, number] = [0, 0];
  stats: CarStats[] = [];
  /** Ganador al terminar: 0 azul, 1 naranja, -1 empate (sin prórroga). */
  winner: -1 | 0 | 1 | null = null;

  private touches: Touch[] = [];
  private pendingShot: PendingShot | null = null;
  private shotTimes: number[] = [];
  private lastCountdown = -1;
  private touchedAtKickoff = false;

  /** Cuando es true el mundo no avanza la física. */
  get frozen(): boolean {
    return (
      this.enabled &&
      (this.phase === 'countdown' || this.phase === 'replay' || this.phase === 'ended')
    );
  }

  /** ¿Se aceptan goles ahora? */
  get acceptsGoals(): boolean {
    return !this.enabled || this.phase === 'kickoff' || this.phase === 'playing';
  }

  start(world: World, config: Partial<MatchConfig> = {}): void {
    this.enabled = true;
    this.config = { ...DEFAULT_MATCH_CONFIG, ...config };
    this.score = [0, 0];
    this.stats = world.cars.map(emptyStats);
    this.timeRemaining = this.config.duration;
    this.overtime = false;
    this.overtimeTime = 0;
    this.timeUp = false;
    this.winner = null;
    this.touches = [];
    this.pendingShot = null;
    this.shotTimes = world.cars.map(() => -Infinity);
    this.beginKickoff(world);
  }

  private beginKickoff(world: World): void {
    world.resetKickoff();
    this.phase = 'countdown';
    this.timer = MATCH.countdown;
    this.lastCountdown = -1;
    this.touchedAtKickoff = false;
    this.touches = [];
    this.pendingShot = null;
    world.emit({ type: 'kickoffReset' });
  }

  /** Se llama una vez por tick (también con la física congelada). */
  update(world: World): void {
    if (!this.enabled) return;
    const dt = PHYSICS.dt;
    switch (this.phase) {
      case 'countdown': {
        this.timer -= dt;
        const n = Math.ceil(this.timer);
        if (n !== this.lastCountdown && n > 0) {
          this.lastCountdown = n;
          world.emit({ type: 'countdown', n });
        }
        if (this.timer <= 0) {
          this.phase = 'kickoff';
          world.emit({ type: 'go' });
        }
        break;
      }
      case 'kickoff':
        // El reloj se reanuda con el primer toque a la pelota (ver onTouch).
        break;
      case 'playing':
        this.tickClock(world, dt);
        break;
      case 'goal':
        this.timer -= dt;
        if (this.timer <= 0) this.afterGoal(world);
        break;
      case 'replay':
        this.timer -= dt;
        if (this.timer <= 0) this.beginKickoff(world);
        break;
      case 'ended':
        break;
    }
    if (this.pendingShot && world.time > this.pendingShot.expires) this.pendingShot = null;
  }

  private tickClock(world: World, dt: number): void {
    if (this.overtime) {
      this.overtimeTime += dt;
      return;
    }
    if (this.config.duration <= 0) return;
    if (!this.timeUp) {
      this.timeRemaining = Math.max(0, this.timeRemaining - dt);
      if (this.timeRemaining <= 0) this.timeUp = true;
    }
    if (this.timeUp) {
      // Si la pelota está en el aire el juego continúa hasta que toque una superficie.
      const b = world.ball;
      const airborne = arenaDepth(b.pos.x, b.pos.y, b.pos.z) > BALL.radius + 15;
      if (!airborne) this.finishRegulation(world);
    }
  }

  private finishRegulation(world: World): void {
    const [a, b] = this.score;
    if (a === b) {
      if (this.config.overtime) {
        this.overtime = true;
        this.overtimeTime = 0;
        this.beginKickoff(world);
        world.emit({ type: 'overtime' });
      } else this.end(world, -1);
    } else this.end(world, a > b ? 0 : 1);
  }

  private end(world: World, winner: -1 | 0 | 1): void {
    this.phase = 'ended';
    this.winner = winner;
    world.emit({ type: 'matchEnd', winner });
  }

  private afterGoal(world: World): void {
    const maxGoals = this.config.maxGoals;
    if (this.overtime) return this.end(world, this.score[0] > this.score[1] ? 0 : 1);
    if (maxGoals > 0 && Math.max(...this.score) >= maxGoals) {
      return this.end(world, this.score[0] > this.score[1] ? 0 : 1);
    }
    if (this.timeUp) return this.finishRegulation(world);
    if (this.config.replayTime > 0) {
      this.phase = 'replay';
      this.timer = this.config.replayTime;
      world.emit({ type: 'replayStart' });
    } else this.beginKickoff(world);
  }

  /** La UI puede saltar la repetición. */
  skipReplay(world: World): void {
    if (this.phase === 'replay') this.beginKickoff(world);
  }

  // ------------------------------------------------------------------ eventos

  private award(
    world: World,
    car: Car,
    kind: 'goal' | 'assist' | 'save' | 'epicSave' | 'shot' | 'demo',
  ): void {
    const s = this.stats[car.id];
    const pts = MATCH.points[kind];
    s.score += pts;
    if (kind === 'goal') s.goals++;
    else if (kind === 'assist') s.assists++;
    else if (kind === 'save') s.saves++;
    else if (kind === 'epicSave') s.epicSaves++;
    else if (kind === 'shot') s.shots++;
    else s.demos++;
    world.emit({ type: 'award', carId: car.id, kind, points: pts });
  }

  /** Primer toque / toque nuevo de un coche a la pelota. */
  onTouch(world: World, car: Car): void {
    if (!this.enabled || !this.acceptsGoals) return;
    const ball = world.ball;
    const speed = ball.vel.length();

    if (this.phase === 'kickoff') {
      this.phase = 'playing';
      this.touchedAtKickoff = true;
    }

    // Parada: el rival había hecho un tiro a puerta y la trayectoria deja de ir a puerta.
    const ps = this.pendingShot;
    if (ps && ps.team !== car.team && !this.onTarget(world, ps.team)) {
      const distToGoal = Math.abs(ARENA.halfLength * (ps.team === 0 ? 1 : -1) - ball.pos.y);
      const epic = ps.speed >= MATCH.epicSaveSpeed && distToGoal <= MATCH.epicSaveDistance;
      this.award(world, car, epic ? 'epicSave' : 'save');
      this.pendingShot = null;
    }

    // Toques seguidos del mismo coche cuentan como uno (se conserva el toque previo de otro coche).
    const lastTouch = this.touches[this.touches.length - 1];
    if (lastTouch && lastTouch.carId === car.id) {
      lastTouch.time = world.time;
      lastTouch.ballSpeed = speed;
    } else {
      this.touches.push({ carId: car.id, team: car.team, time: world.time, ballSpeed: speed });
      if (this.touches.length > 6) this.touches.shift();
    }

    // Tiro a puerta propio.
    if (
      speed >= MATCH.shotMinSpeed &&
      this.onTarget(world, car.team) &&
      world.time - this.shotTimes[car.id] > MATCH.shotCooldown
    ) {
      this.shotTimes[car.id] = world.time;
      this.pendingShot = { team: car.team, speed, expires: world.time + MATCH.shotLifetime };
      this.award(world, car, 'shot');
    }
  }

  /** ¿Va la pelota a la portería rival de `attackingTeam`? Predicción balística sin rebotes. */
  private onTarget(world: World, attackingTeam: 0 | 1): boolean {
    const b = world.ball;
    const dir = attackingTeam === 0 ? 1 : -1;
    const vy = b.vel.y * dir;
    if (vy < 300) return false;
    const goalY = ARENA.halfLength * dir;
    const t = (goalY - b.pos.y) / b.vel.y;
    if (t <= 0 || t > 4) return false;
    const x = b.pos.x + b.vel.x * t;
    const z = b.pos.z + b.vel.z * t + 0.5 * PHYSICS.gravity * t * t;
    return (
      Math.abs(x) < ARENA.goal.halfWidth + BALL.radius &&
      z > 0 &&
      z < ARENA.goal.height + BALL.radius
    );
  }

  /** La pelota ha cruzado la línea. `team` = equipo que marca. */
  onGoal(world: World, team: 0 | 1): void {
    if (!this.enabled) return;
    this.score[team]++;
    // Goleador: último toque; si fue del equipo rival es un autogol.
    const last = this.touches[this.touches.length - 1];
    let scorerId = -1;
    let assistId = -1;
    let speedKmh = Math.round(world.ball.vel.length() * 0.036);
    let ownGoal = false;
    if (last) {
      if (last.team === team) {
        scorerId = last.carId;
        speedKmh = Math.round(last.ballSpeed * 0.036);
        const prev = this.touches[this.touches.length - 2];
        if (
          prev &&
          prev.team === team &&
          prev.carId !== last.carId &&
          last.time - prev.time <= MATCH.assistWindow
        ) {
          assistId = prev.carId;
        }
      } else ownGoal = true;
    }
    if (scorerId >= 0) this.award(world, world.cars[scorerId], 'goal');
    if (assistId >= 0) this.award(world, world.cars[assistId], 'assist');
    world.emit({ type: 'matchGoal', team, scorerId, assistId, speedKmh, ownGoal });
    this.phase = 'goal';
    this.timer = MATCH.goalCelebration;
    this.pendingShot = null;
  }

  onDemolition(world: World, attacker: Car, victim: Car): void {
    if (!this.enabled) return;
    if (attacker.team !== victim.team) this.award(world, attacker, 'demo');
  }

  // ---------------------------------------------------------------- snapshot

  serialize(): MatchSnapshot {
    return JSON.parse(
      JSON.stringify({
        enabled: this.enabled,
        config: this.config,
        phase: this.phase,
        timer: this.timer,
        timeRemaining: this.timeRemaining,
        overtime: this.overtime,
        overtimeTime: this.overtimeTime,
        timeUp: this.timeUp,
        score: this.score,
        stats: this.stats,
        touches: this.touches,
        pendingShot: this.pendingShot,
        shotTimes: this.shotTimes.map((t) => (t === -Infinity ? null : t)),
        lastCountdown: this.lastCountdown,
        winner: this.winner,
        touchedAtKickoff: this.touchedAtKickoff,
      }),
    ) as MatchSnapshot;
  }

  restore(s: MatchSnapshot): void {
    this.enabled = s.enabled;
    this.config = { ...s.config };
    this.phase = s.phase;
    this.timer = s.timer;
    this.timeRemaining = s.timeRemaining;
    this.overtime = s.overtime;
    this.overtimeTime = s.overtimeTime;
    this.timeUp = s.timeUp;
    this.score = [s.score[0], s.score[1]];
    this.stats = s.stats.map((x) => ({ ...x }));
    this.touches = s.touches.map((t) => ({ ...t }));
    this.pendingShot = s.pendingShot ? { ...s.pendingShot } : null;
    this.shotTimes = (s.shotTimes as (number | null)[]).map((t) => (t === null ? -Infinity : t));
    this.lastCountdown = s.lastCountdown;
    this.winner = s.winner;
    this.touchedAtKickoff = s.touchedAtKickoff;
  }
}
