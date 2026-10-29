// Buffer de snapshots para interpolar los coches remotos con un retardo fijo (≈ 80 ms): se ven
// fluidos aunque lleguen paquetes con jitter. Estima el reloj del servidor suavizando la deriva.
import type { RenderFrame } from '../replay';
import { Quat } from '../sim';
import { INTERP_DELAY, SERVER_TICK_RATE } from './protocol';
import type { NetSnapshot } from './state';

const CAPACITY = 48;

interface Entry {
  time: number;
  pos: Float32Array;
  quat: Float32Array;
  flags: Uint16Array;
  steer: Float32Array;
  fwd: Float32Array;
}

const qa = new Quat();
const qb = new Quat();

export class SnapshotBuffer {
  private entries: Entry[] = [];
  private head = 0;
  private count = 0;
  /** Estimación suavizada de (reloj del servidor − reloj local) en segundos. */
  private clockOffset = 0;
  private hasClock = false;

  constructor(private readonly numCars: number) {
    for (let i = 0; i < CAPACITY; i++) {
      this.entries.push({
        time: 0,
        pos: new Float32Array(numCars * 3),
        quat: new Float32Array(numCars * 4),
        flags: new Uint16Array(numCars),
        steer: new Float32Array(numCars),
        fwd: new Float32Array(numCars),
      });
    }
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
    this.hasClock = false;
  }

  /** Guarda un snapshot recibido en el instante local `nowMs`. */
  push(s: NetSnapshot, nowMs: number): void {
    const time = s.tick / SERVER_TICK_RATE;
    const sample = time - nowMs / 1000;
    if (!this.hasClock) {
      this.clockOffset = sample;
      this.hasClock = true;
    } else {
      // Se prefiere el paquete más reciente respecto al reloj local (menor latencia): sube rápido y baja lento.
      this.clockOffset += (sample - this.clockOffset) * (sample > this.clockOffset ? 0.2 : 0.02);
    }
    const e = this.entries[this.head];
    e.time = time;
    for (const c of s.cars) {
      const i = c.id;
      if (i >= this.numCars) continue;
      e.pos[i * 3] = c.pos[0];
      e.pos[i * 3 + 1] = c.pos[1];
      e.pos[i * 3 + 2] = c.pos[2];
      e.quat[i * 4] = c.quat[0];
      e.quat[i * 4 + 1] = c.quat[1];
      e.quat[i * 4 + 2] = c.quat[2];
      e.quat[i * 4 + 3] = c.quat[3];
      e.flags[i] = c.flags;
      e.steer[i] = c.input.steer;
      // Velocidad hacia delante aproximada (para el giro visual de las ruedas).
      qa.set(c.quat[0], c.quat[1], c.quat[2], c.quat[3]);
      const fx = 1 - 2 * (qa.y * qa.y + qa.z * qa.z);
      const fy = 2 * (qa.x * qa.y + qa.z * qa.w);
      const fz = 2 * (qa.x * qa.z - qa.y * qa.w);
      e.fwd[i] = c.vel[0] * fx + c.vel[1] * fy + c.vel[2] * fz;
    }
    this.head = (this.head + 1) % CAPACITY;
    this.count = Math.min(CAPACITY, this.count + 1);
  }

  private at(i: number): Entry {
    return this.entries[(this.head - this.count + i + CAPACITY * 2) % CAPACITY];
  }

  /** Instante del servidor que se debe dibujar ahora. */
  renderTime(nowMs: number): number {
    return nowMs / 1000 + this.clockOffset - INTERP_DELAY;
  }

  /** Rellena los coches de `out` (salvo `skipId`) con el estado interpolado; false si aún no hay datos. */
  sample(nowMs: number, out: RenderFrame, skipId: number): boolean {
    if (this.count === 0) return false;
    const newest = this.at(this.count - 1);
    let t = this.renderTime(nowMs);
    const oldest = this.at(0);
    if (t < oldest.time) t = oldest.time;
    if (t > newest.time) t = newest.time;
    // Último par que encierra t.
    let lo = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.at(i).time <= t) {
        lo = i;
        break;
      }
    }
    const a = this.at(lo);
    const b = this.at(Math.min(this.count - 1, lo + 1));
    const f = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
    for (let i = 0; i < out.cars.length; i++) {
      if (i === skipId) continue;
      const c = out.cars[i];
      c.pos.set(
        a.pos[i * 3] + (b.pos[i * 3] - a.pos[i * 3]) * f,
        a.pos[i * 3 + 1] + (b.pos[i * 3 + 1] - a.pos[i * 3 + 1]) * f,
        a.pos[i * 3 + 2] + (b.pos[i * 3 + 2] - a.pos[i * 3 + 2]) * f,
      );
      qa.set(a.quat[i * 4], a.quat[i * 4 + 1], a.quat[i * 4 + 2], a.quat[i * 4 + 3]);
      qb.set(b.quat[i * 4], b.quat[i * 4 + 1], b.quat[i * 4 + 2], b.quat[i * 4 + 3]);
      const dot = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
      const sgn = dot < 0 ? -1 : 1;
      c.quat
        .set(
          qa.x + (sgn * qb.x - qa.x) * f,
          qa.y + (sgn * qb.y - qa.y) * f,
          qa.z + (sgn * qb.z - qa.z) * f,
          qa.w + (sgn * qb.w - qa.w) * f,
        )
        .normalize();
      const flags = b.flags[i];
      c.boosting = (flags & 32) !== 0;
      c.demolished = (flags & 64) !== 0;
      c.grounded = (flags & 128) !== 0;
      c.steer = b.steer[i];
      c.forwardSpeed = a.fwd[i] + (b.fwd[i] - a.fwd[i]) * f;
    }
    return true;
  }
}
