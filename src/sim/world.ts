import { CAR_BODIES, KICKOFF_SPOTS, PHYSICS } from '../config';
import type { CarBodyId } from '../config';
import { goalScoredBy } from './arena';
import { Ball } from './ball';
import { Car } from './car';
import { collideBallCar, resolveCarArena } from './collisions';
import type { BallCarHit } from './collisions';
import type { CarInput } from './input';
import { neutralInput } from './input';
import { BoostPad, createPads, updatePads } from './pads';
import { Rng } from './rng';

export type SimEvent =
  | { type: 'ballTouch'; carId: number; relSpeed: number; flipReset: boolean }
  | { type: 'padPickup'; carId: number; padIndex: number }
  | { type: 'goal'; team: 0 | 1 }
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
}

/** Estado completo de la simulación. Determinista, sin dependencias de DOM ni de Three.js. */
export class World {
  tick = 0;
  time = 0;
  readonly rng: Rng;
  readonly ball = new Ball();
  readonly cars: Car[] = [];
  readonly pads: BoostPad[] = createPads();
  private events: SimEvent[] = [];
  private pickups: BoostPad[] = [];
  private hit: BallCarHit = { flipReset: false, fresh: false, relSpeed: 0 };
  private inputs: CarInput[] = [];

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
        car.place(sx, sy, Math.atan2(-sy, -sx));
      });
    });
    for (const p of this.pads) p.reset();
    this.events.length = 0;
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
    this.time += dt;
    this.ball.savePrev();
    for (const car of this.cars) car.savePrev();

    for (const car of this.cars) {
      const wasJumping = car.isJumping;
      const hadFlip = car.flipUsed;
      car.step(dt);
      if (car.isJumping && !wasJumping) this.events.push({ type: 'jump', carId: car.id });
      if (car.flipUsed && !hadFlip) this.events.push({ type: 'flip', carId: car.id });
    }
    this.ball.integrate(dt);

    for (const car of this.cars) resolveCarArena(car);
    this.ball.collideArena();
    for (const car of this.cars) {
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
        }
      }
    }
    this.ball.collideArena();

    updatePads(this.pads, dt, this.cars, this.pickups);
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
    if (scorer !== -1) this.events.push({ type: 'goal', team: scorer });
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
        ],
      })),
      pads: this.pads.map((p) => ({ active: p.active, timer: p.timer })),
    };
  }

  restore(s: WorldSnapshot): void {
    this.tick = s.tick;
    this.time = s.tick * PHYSICS.dt;
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
      c.jumpDir.set(cs.jumpDir[0], cs.jumpDir[1], cs.jumpDir[2]);
      [c.jumpTimer, c.groundLock, c.airTime, c.flipTimer, c.boostTimer, c.flipForward, c.flipSide] =
        cs.timers as [number, number, number, number, number, number, number];
      c.prevPos.copy(c.pos);
      c.prevQuat.copy(c.quat);
      c.updateAxes();
    });
    s.pads.forEach((ps, i) => {
      this.pads[i].active = ps.active;
      this.pads[i].timer = ps.timer;
    });
  }
}
