import { CAR_BODIES, CAR_CAR, KICKOFF_SPOTS, PHYSICS } from '../config';
import type { CarBodyId, MatchConfig, ResolvedMutators } from '../config';
import { goalScoredBy } from './arena';
import { Ball } from './ball';
import { Car, DEFAULT_RULES } from './car';
import type { CarRules } from './car';
import { applyBump, bumpInfo, collideBallCar, collideCarCar, resolveCarArena } from './collisions';
import type { BallCarHit, CarCarContact } from './collisions';
import type { CarInput } from './input';
import { neutralInput } from './input';
import { Match } from './match';
import type { MatchSnapshot } from './match';
import { BoostPad, createPads, updatePads } from './pads';
import { Vec3 } from './math';
import { Rng } from './rng';

export type SimEvent =
  | { type: 'ballTouch'; carId: number; relSpeed: number; flipReset: boolean }
  | { type: 'padPickup'; carId: number; padIndex: number }
  | { type: 'goal'; team: 0 | 1 }
  | {
      type: 'matchGoal';
      team: 0 | 1;
      scorerId: number;
      assistId: number;
      speedKmh: number;
      ownGoal: boolean;
    }
  | {
      type: 'award';
      carId: number;
      kind: 'goal' | 'assist' | 'save' | 'epicSave' | 'shot' | 'demo';
      points: number;
    }
  | { type: 'demolition'; attackerId: number; victimId: number }
  | { type: 'respawn'; carId: number }
  | { type: 'bump'; attackerId: number; victimId: number }
  | { type: 'chat'; carId: number; text: string }
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'kickoffReset' }
  | { type: 'overtime' }
  | { type: 'replayStart' }
  | { type: 'matchEnd'; winner: -1 | 0 | 1 }
  | { type: 'jump'; carId: number }
  | { type: 'flip'; carId: number };

export interface WorldSnapshot {
  tick: number;
  rng: number;
  ball: { pos: number[]; vel: number[]; ang: number[]; quat: number[] };
  cars: {
    pos: number[];
    vel: number[];
    ang: number[];
    quat: number[];
    boost: number;
    flags: number[];
    timers: number[];
    jumpDir: number[];
  }[];
  pads: { active: boolean; timer: number }[];
  match: MatchSnapshot;
  bumps: Record<string, number>;
}

/** Estado completo de la simulación. Determinista, sin dependencias de DOM ni de Three.js. */
export class World {
  tick = 0;
  /** Tiempo de simulación (s), derivado del contador de ticks para ser exactamente reproducible. */
  get time(): number {
    return this.tick * PHYSICS.dt;
  }
  readonly rng: Rng;
  readonly ball = new Ball();
  readonly cars: Car[] = [];
  readonly pads: BoostPad[] = createPads();
  private events: SimEvent[] = [];
  private pickups: BoostPad[] = [];
  private hit: BallCarHit = { flipReset: false, fresh: false, relSpeed: 0 };
  private inputs: CarInput[] = [];
  readonly match = new Match();
  /** Reglas globales (mutadores) que afectan a los coches. */
  rules: CarRules = { ...DEFAULT_RULES };
  private contact: CarCarContact = { normal: new Vec3(), point: new Vec3(), penetration: 0 };
  private bumpTicks = new Map<number, number>();
  private preA = new Vec3();
  private preB = new Vec3();

  constructor(seed = 12345) {
    this.rng = new Rng(seed);
  }

  addCar(team: 0 | 1, body: CarBodyId = 'octane'): Car {
    const car = new Car(this.cars.length, team, CAR_BODIES[body]);
    this.cars.push(car);
    this.inputs.push(neutralInput());
    return car;
  }

  /** Reinicia pelota, coches (posiciones de saque simétricas) y pads. */
  resetKickoff(): void {
    this.ball.reset(0, 0);
    const perTeam: Car[][] = [[], []];
    for (const c of this.cars) perTeam[c.team].push(c);
    const spots = [...KICKOFF_SPOTS];
    // Selección aleatoria pero simétrica: se eligen índices de posiciones sin repetir.
    for (let i = spots.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    perTeam.forEach((cars, team) => {
      cars.forEach((car, i) => {
        const s = spots[i % spots.length];
        const sx = team === 0 ? s.x : -s.x;
        const sy = team === 0 ? s.y : -s.y;
        this.placeCar(car, sx, sy, Math.atan2(-sy, -sx));
      });
    });
    for (const p of this.pads) p.reset();
    this.bumpTicks.clear();
  }

  /** Aplica los mutadores de física (pelota, gravedad, turbo). Llamar antes de `startMatch`. */
  applyMutators(m: ResolvedMutators): void {
    const b = this.ball;
    b.radius = m.ball.radius;
    b.mass = m.ball.mass;
    b.restitution = m.ball.restitution;
    b.maxSpeed = m.ball.maxSpeed;
    b.gravityScale = m.gravityScale;
    const startBoost =
      m.boostMode === 'none' ? 0 : m.boostMode === 'unlimited' ? 100 : DEFAULT_RULES.startBoost;
    this.rules = {
      gravityScale: m.gravityScale,
      boostMode: m.boostMode,
      boostStrength: m.boostStrength,
      startBoost,
    };
    b.reset(0, 0);
    for (const c of this.cars) c.boost = startBoost;
  }

  /** Restablece el estado de turbo de un coche según las reglas. */
  private placeCar(car: Car, x: number, y: number, yaw: number): void {
    car.place(x, y, yaw);
    car.boost = this.rules.startBoost;
  }

  /** Inicia una partida con reglas Soccar (saque con cuenta atrás incluido). */
  startMatch(config: Partial<MatchConfig> = {}): void {
    this.match.start(this, config);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Devuelve y vacía los eventos acumulados desde la última llamada. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  setInput(carId: number, input: CarInput): void {
    this.cars[carId].setInput(input);
  }

  /** Avanza un paso fijo (1/120 s). */
  step(): void {
    const dt = PHYSICS.dt;
    this.tick++;
    this.ball.savePrev();
    for (const car of this.cars) car.savePrev();

    if (!this.match.frozen) this.stepPhysics(dt);
    this.match.update(this);
  }

  private stepPhysics(dt: number): void {
    for (const car of this.cars) {
      if (car.demolished) {
        car.respawnTimer -= dt;
        if (car.respawnTimer <= 0) this.respawn(car);
        continue;
      }
      const wasJumping = car.isJumping;
      const hadFlip = car.flipUsed;
      car.step(dt, this.rules);
      if (car.isJumping && !wasJumping) this.events.push({ type: 'jump', carId: car.id });
      if (car.flipUsed && !hadFlip) this.events.push({ type: 'flip', carId: car.id });
    }
    this.ball.integrate(dt);

    for (const car of this.cars) if (!car.demolished) resolveCarArena(car);
    this.collideCars();
    this.ball.collideArena();
    for (const car of this.cars) {
      if (car.demolished) continue;
      if (collideBallCar(this.ball, car, this.tick, this.hit)) {
        if (this.hit.flipReset && !car.supported) {
          car.flipUsed = false;
          car.airTime = 0;
        }
        if (this.hit.fresh) {
          this.events.push({
            type: 'ballTouch',
            carId: car.id,
            relSpeed: this.hit.relSpeed,
            flipReset: this.hit.flipReset,
          });
          this.match.onTouch(this, car);
        }
      }
    }
    this.ball.collideArena();

    updatePads(this.pads, dt, this.cars, this.pickups, this.rules.boostMode !== 'none');
    for (const pad of this.pickups) {
      const carId = this.cars.findIndex((c) => c.lastPadPickup === pad);
      this.events.push({ type: 'padPickup', carId, padIndex: this.pads.indexOf(pad) });
    }

    const scorer = goalScoredBy(
      this.ball.pos.x,
      this.ball.pos.y,
      this.ball.pos.z,
      this.ball.radius,
    );
    if (scorer !== -1 && this.match.acceptsGoals) {
      this.events.push({ type: 'goal', team: scorer });
      this.match.onGoal(this, scorer);
    }
  }

  /** Choques entre coches: empujones con transferencia de momento y demoliciones. */
  private collideCars(): void {
    const mode = this.match.enabled ? this.match.config.demolition : 'normal';
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (a.demolished || b.demolished) continue;
        // Velocidades previas al impulso: las necesita la evaluación de la embestida.
        this.preA.copy(a.vel);
        this.preB.copy(b.vel);
        if (!collideCarCar(a, b, this.contact)) continue;
        const ia = bumpInfo(a, b, this.contact, this.preA, this.preB);
        const ib = bumpInfo(b, a, this.contact, this.preB, this.preA);
        const aSuper = a.supersonic;
        const bSuper = b.supersonic;

        const key = i * 64 + j;
        const last = this.bumpTicks.get(key) ?? -Infinity;
        const cooled = this.tick - last > CAR_CAR.bumpCooldown * PHYSICS.tickRate;
        const sameTeam = a.team === b.team;
        const canDemo = mode !== 'off' && (!sameTeam || mode === 'friendly');
        const needSuper = mode !== 'contact';

        const aHits = ia.front && ia.closing > 0 && (!needSuper || aSuper);
        const bHits = ib.front && ib.closing > 0 && (!needSuper || bSuper);
        if (canDemo && (aHits || bHits)) {
          // Si ambos embisten, gana el de mayor velocidad de acercamiento.
          const attacker = aHits && (!bHits || ia.closing >= ib.closing) ? a : b;
          // El atacante conserva su momento: la embestida destruye al rival sin frenarlo.
          attacker.vel.copy(attacker === a ? this.preA : this.preB);
          this.demolish(attacker, attacker === a ? b : a);
          continue;
        }
        if (cooled) {
          if (ia.front && ia.closing > CAR_CAR.bumpMinClosing) {
            applyBump(a, b, ia.closing);
            this.events.push({ type: 'bump', attackerId: a.id, victimId: b.id });
            this.bumpTicks.set(key, this.tick);
          } else if (ib.front && ib.closing > CAR_CAR.bumpMinClosing) {
            applyBump(b, a, ib.closing);
            this.events.push({ type: 'bump', attackerId: b.id, victimId: a.id });
            this.bumpTicks.set(key, this.tick);
          }
        }
      }
    }
  }

  private demolish(attacker: Car, victim: Car): void {
    victim.demolished = true;
    victim.respawnTimer = this.match.enabled ? this.match.config.respawnTime : 3;
    victim.vel.set(0, 0, 0);
    victim.angVel.set(0, 0, 0);
    victim.boosting = false;
    this.events.push({ type: 'demolition', attackerId: attacker.id, victimId: victim.id });
    this.match.onDemolition(this, attacker, victim);
  }

  /** Reaparición tras una demolición: posición de saque propia, 33 de turbo. */
  private respawn(car: Car): void {
    const spots = KICKOFF_SPOTS;
    const s = spots[this.rng.int(spots.length)];
    const sx = car.team === 0 ? s.x : -s.x;
    const sy = car.team === 0 ? s.y : -s.y;
    this.placeCar(car, sx, sy, Math.atan2(-sy, -sx));
    this.events.push({ type: 'respawn', carId: car.id });
  }

  snapshot(): WorldSnapshot {
    const v = (a: { x: number; y: number; z: number }) => [a.x, a.y, a.z];
    const q = (a: { x: number; y: number; z: number; w: number }) => [a.x, a.y, a.z, a.w];
    return {
      tick: this.tick,
      rng: this.rng.getState(),
      ball: {
        pos: v(this.ball.pos),
        vel: v(this.ball.vel),
        ang: v(this.ball.angVel),
        quat: q(this.ball.quat),
      },
      cars: this.cars.map((c) => ({
        pos: v(c.pos),
        vel: v(c.vel),
        ang: v(c.angVel),
        quat: q(c.quat),
        boost: c.boost,
        flags: [
          +c.isJumping,
          +c.flipUsed,
          +c.flipActive,
          +c.prevJump,
          +c.prevBoostInput,
          +c.boosting,
          c.lastBallTouchTick,
          +c.demolished,
        ],
        jumpDir: v(c.jumpDir),
        timers: [
          c.jumpTimer,
          c.groundLock,
          c.airTime,
          c.flipTimer,
          c.boostTimer,
          c.flipForward,
          c.flipSide,
          c.respawnTimer,
        ],
      })),
      pads: this.pads.map((p) => ({ active: p.active, timer: p.timer })),
      match: this.match.serialize(),
      bumps: Object.fromEntries(this.bumpTicks),
    };
  }

  restore(s: WorldSnapshot): void {
    this.tick = s.tick;
    this.rng.setState(s.rng);
    this.ball.pos.set(s.ball.pos[0], s.ball.pos[1], s.ball.pos[2]);
    this.ball.vel.set(s.ball.vel[0], s.ball.vel[1], s.ball.vel[2]);
    this.ball.angVel.set(s.ball.ang[0], s.ball.ang[1], s.ball.ang[2]);
    this.ball.quat.set(s.ball.quat[0], s.ball.quat[1], s.ball.quat[2], s.ball.quat[3]);
    this.ball.prevPos.copy(this.ball.pos);
    this.ball.prevQuat.copy(this.ball.quat);
    s.cars.forEach((cs, i) => {
      const c = this.cars[i];
      c.pos.set(cs.pos[0], cs.pos[1], cs.pos[2]);
      c.vel.set(cs.vel[0], cs.vel[1], cs.vel[2]);
      c.angVel.set(cs.ang[0], cs.ang[1], cs.ang[2]);
      c.quat.set(cs.quat[0], cs.quat[1], cs.quat[2], cs.quat[3]);
      c.boost = cs.boost;
      [c.isJumping, c.flipUsed, c.flipActive, c.prevJump, c.prevBoostInput, c.boosting] = cs.flags
        .slice(0, 6)
        .map((x) => x === 1) as [boolean, boolean, boolean, boolean, boolean, boolean];
      c.lastBallTouchTick = cs.flags[6];
      c.demolished = cs.flags[7] === 1;
      c.jumpDir.set(cs.jumpDir[0], cs.jumpDir[1], cs.jumpDir[2]);
      [
        c.jumpTimer,
        c.groundLock,
        c.airTime,
        c.flipTimer,
        c.boostTimer,
        c.flipForward,
        c.flipSide,
        c.respawnTimer,
      ] = cs.timers as [number, number, number, number, number, number, number, number];
      c.prevPos.copy(c.pos);
      c.prevQuat.copy(c.quat);
      c.updateAxes();
    });
    s.pads.forEach((ps, i) => {
      this.pads[i].active = ps.active;
      this.pads[i].timer = ps.timer;
    });
    this.match.restore(s.match);
    this.bumpTicks = new Map(Object.entries(s.bumps).map(([k, v]) => [Number(k), v]));
  }
}
