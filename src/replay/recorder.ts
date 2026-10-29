// Grabación y reproducción de repeticiones. Guarda un búfer circular de estados visuales (posición y
// orientación de coches y pelota) y los interpola al reproducirlos. No depende de DOM ni de Three.js.
import type { World } from '../sim';
import { Quat, Vec3 } from '../sim';

export interface RenderCar {
  pos: Vec3;
  quat: Quat;
  boosting: boolean;
  demolished: boolean;
  steer: number;
  forwardSpeed: number;
  grounded: boolean;
}

export interface RenderFrame {
  ballPos: Vec3;
  ballQuat: Quat;
  cars: RenderCar[];
}

const CAR_STRIDE = 12; // pos(3) quat(4) boosting demolished steer fwdSpeed grounded
const BALL_STRIDE = 7;

export function createRenderFrame(numCars: number): RenderFrame {
  return {
    ballPos: new Vec3(),
    ballQuat: new Quat(),
    cars: Array.from({ length: numCars }, () => ({
      pos: new Vec3(),
      quat: new Quat(),
      boosting: false,
      demolished: false,
      steer: 0,
      forwardSpeed: 0,
      grounded: true,
    })),
  };
}

/** Interpolación normalizada de cuaterniones (camino corto). */
function nlerp(a: Quat, b: Quat, t: number, out: Quat): void {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  out
    .set(
      a.x + (s * b.x - a.x) * t,
      a.y + (s * b.y - a.y) * t,
      a.z + (s * b.z - a.z) * t,
      a.w + (s * b.w - a.w) * t,
    )
    .normalize();
}

export class Recorder {
  /** Frecuencia de grabación (Hz). */
  readonly rate: number;
  private readonly capacity: number;
  private readonly stride: number;
  private data: Float32Array;
  private times: Float64Array;
  private head = 0;
  private count = 0;
  private numCars = 0;
  private lastTick = -Infinity;
  private readonly every: number;

  constructor(tickRate = 120, rate = 60, seconds = 12, maxCars = 6) {
    this.rate = rate;
    this.every = Math.max(1, Math.round(tickRate / rate));
    this.capacity = Math.ceil(seconds * rate);
    this.stride = BALL_STRIDE + CAR_STRIDE * maxCars;
    this.data = new Float32Array(this.capacity * this.stride);
    this.times = new Float64Array(this.capacity);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.lastTick = -Infinity;
  }

  get length(): number {
    return this.count;
  }

  /** Graba el estado actual si toca (se llama tras cada paso de física no congelado). */
  capture(world: World): void {
    if (world.tick - this.lastTick < this.every) return;
    this.lastTick = world.tick;
    this.numCars = world.cars.length;
    const o = this.head * this.stride;
    const d = this.data;
    const b = world.ball;
    d[o] = b.pos.x;
    d[o + 1] = b.pos.y;
    d[o + 2] = b.pos.z;
    d[o + 3] = b.quat.x;
    d[o + 4] = b.quat.y;
    d[o + 5] = b.quat.z;
    d[o + 6] = b.quat.w;
    world.cars.forEach((c, i) => {
      const k = o + BALL_STRIDE + i * CAR_STRIDE;
      d[k] = c.pos.x;
      d[k + 1] = c.pos.y;
      d[k + 2] = c.pos.z;
      d[k + 3] = c.quat.x;
      d[k + 4] = c.quat.y;
      d[k + 5] = c.quat.z;
      d[k + 6] = c.quat.w;
      d[k + 7] = c.boosting ? 1 : 0;
      d[k + 8] = c.demolished ? 1 : 0;
      d[k + 9] = c.input.steer;
      d[k + 10] = c.forwardSpeed;
      d[k + 11] = c.grounded ? 1 : 0;
    });
    this.times[this.head] = world.time;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  /** Instante (s de simulación) más antiguo y más reciente disponibles. */
  get span(): { start: number; end: number } {
    if (this.count === 0) return { start: 0, end: 0 };
    const oldest = (this.head - this.count + this.capacity) % this.capacity;
    const newest = (this.head - 1 + this.capacity) % this.capacity;
    return { start: this.times[oldest], end: this.times[newest] };
  }

  private index(i: number): number {
    // i = 0 es el más antiguo.
    return (this.head - this.count + i + this.capacity * 2) % this.capacity;
  }

  /** Devuelve el estado interpolado en el instante `time`; false si no hay datos. */
  sample(time: number, out: RenderFrame): boolean {
    if (this.count === 0) return false;
    const { start, end } = this.span;
    const t = Math.min(end, Math.max(start, time));
    // Búsqueda binaria del último fotograma con tiempo ≤ t.
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.times[this.index(mid)] <= t) lo = mid;
      else hi = mid - 1;
    }
    const ia = this.index(lo);
    const ib = this.index(Math.min(this.count - 1, lo + 1));
    const ta = this.times[ia];
    const tb = this.times[ib];
    const f = tb > ta ? (t - ta) / (tb - ta) : 0;
    const A = ia * this.stride;
    const B = ib * this.stride;
    const d = this.data;
    const mix = (k: number): number => d[A + k] + (d[B + k] - d[A + k]) * f;
    out.ballPos.set(mix(0), mix(1), mix(2));
    qa.set(d[A + 3], d[A + 4], d[A + 5], d[A + 6]);
    qb.set(d[B + 3], d[B + 4], d[B + 5], d[B + 6]);
    nlerp(qa, qb, f, out.ballQuat);
    for (let i = 0; i < Math.min(out.cars.length, this.numCars); i++) {
      const k = BALL_STRIDE + i * CAR_STRIDE;
      const c = out.cars[i];
      c.pos.set(mix(k), mix(k + 1), mix(k + 2));
      qa.set(d[A + k + 3], d[A + k + 4], d[A + k + 5], d[A + k + 6]);
      qb.set(d[B + k + 3], d[B + k + 4], d[B + k + 5], d[B + k + 6]);
      nlerp(qa, qb, f, c.quat);
      c.boosting = d[A + k + 7] > 0.5;
      c.demolished = d[A + k + 8] > 0.5;
      c.steer = d[A + k + 9];
      c.forwardSpeed = d[A + k + 10];
      c.grounded = d[A + k + 11] > 0.5;
    }
    return true;
  }
}

const qa = new Quat();
const qb = new Quat();

/** Segmento de repetición a reproducir. */
export class ReplayPlayer {
  start = 0;
  duration = 0;
  /** Coche goleador (para la cámara de seguimiento). */
  focusCarId = 0;
  /** Equipo que marcó (determina la portería de la cámara de línea de gol). */
  scoringTeam: 0 | 1 = 0;
  active = false;

  constructor(
    private readonly recorder: Recorder,
    readonly frame: RenderFrame,
  ) {}

  /**
   * Prepara la reproducción de [goalTime - before, goalTime + after]; recorta a lo grabado y
   * devuelve la duración real.
   */
  begin(goalTime: number, before: number, after: number, carId: number, team: 0 | 1): number {
    const span = this.recorder.span;
    this.start = Math.max(span.start, goalTime - before);
    const end = Math.min(span.end, goalTime + after);
    this.duration = Math.max(0.5, end - this.start);
    this.focusCarId = carId;
    this.scoringTeam = team;
    this.active = true;
    return this.duration;
  }

  stop(): void {
    this.active = false;
  }

  /** Actualiza `frame` para el instante `t` (s desde el inicio de la repetición). */
  seek(t: number): boolean {
    return this.recorder.sample(this.start + Math.min(this.duration, Math.max(0, t)), this.frame);
  }
}
