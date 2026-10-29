// Sesión de una partida online en el cliente: réplica de la simulación con predicción del coche
// propio y de la pelota, e interpolación de los demás coches.
import type { RenderFrame } from '../replay';
import { createRenderFrame } from '../replay';
import type { CarInput, MatchSnapshot, World } from '../sim';
import { Quat } from '../sim';
import { SnapshotBuffer } from './interpolation';
import { Predictor } from './predictor';
import { buildNetWorld } from './setup';
import type { NetSetup } from './setup';
import { unpackSnapshot } from './state';

const nlerp = (a: Quat, b: Quat, t: number, out: Quat): void => {
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
};

export class OnlineMatch {
  readonly world: World;
  readonly predictor: Predictor;
  readonly interp: SnapshotBuffer;
  readonly frame: RenderFrame;
  /** Cola de entradas del servidor en el último snapshot (para ajustar el ritmo del cliente). */
  queue = 0;
  snapshots = 0;
  private lastTick = -1;
  private qa = new Quat();
  private qb = new Quat();

  constructor(
    readonly setup: NetSetup,
    readonly me: number,
  ) {
    this.world = buildNetWorld(setup);
    this.predictor = new Predictor(this.world, me);
    this.interp = new SnapshotBuffer(setup.cars.length);
    this.frame = createRenderFrame(setup.cars.length);
  }

  /** Estado de las reglas (marcador, reloj, fase) enviado por el servidor. */
  applyMatchInfo(info: MatchSnapshot): void {
    this.world.match.restore(info);
  }

  /** Procesa un snapshot binario. Devuelve false si es inválido o antiguo. */
  onSnapshot(data: ArrayBuffer | Uint8Array, nowMs: number): boolean {
    const s = unpackSnapshot(data);
    if (!s || s.tick <= this.lastTick) return false;
    this.lastTick = s.tick;
    this.predictor.reconcile(s);
    this.interp.push(s, nowMs);
    this.queue = s.queue;
    this.snapshots++;
    return true;
  }

  /** Un tick local de predicción; devuelve el número de secuencia que hay que enviar al servidor. */
  step(input: CarInput): number {
    return this.predictor.step(input);
  }

  /**
   * Ajuste fino del ritmo del reloj local para mantener la cola del servidor corta pero no vacía:
   * evita que el cliente se adelante o se retrase respecto al servidor.
   */
  paceScale(): number {
    if (this.snapshots < 10) return 1;
    if (this.queue > 8) return 0.97;
    if (this.queue < 1) return 1.03;
    return 1;
  }

  /**
   * Compone el fotograma a dibujar: coche propio y pelota predichos (interpolados entre ticks, con
   * el desfase de corrección) y el resto de coches interpolados con retardo desde los snapshots.
   */
  buildFrame(alpha: number, nowMs: number): RenderFrame {
    const w = this.world;
    const f = this.frame;
    const b = w.ball;
    f.ballPos.lerpOf(b.prevPos, b.pos, alpha);
    this.qa.copy(b.prevQuat);
    this.qb.copy(b.quat);
    nlerp(this.qa, this.qb, alpha, f.ballQuat);

    this.interp.sample(nowMs, f, this.me);
    const car = w.cars[this.me];
    const c = f.cars[this.me];
    c.pos.lerpOf(car.prevPos, car.pos, alpha).add(this.predictor.offset);
    this.qa.copy(car.prevQuat);
    this.qb.copy(car.quat);
    nlerp(this.qa, this.qb, alpha, c.quat);
    c.boosting = car.boosting;
    c.demolished = car.demolished;
    c.grounded = car.grounded;
    c.steer = car.input.steer;
    c.forwardSpeed = car.forwardSpeed;

    // Sin datos de interpolación todavía: se usan las posiciones de la réplica.
    if (this.interp.length === 0) {
      w.cars.forEach((o, i) => {
        if (i === this.me) return;
        f.cars[i].pos.copy(o.pos);
        f.cars[i].quat.copy(o.quat);
        f.cars[i].boosting = o.boosting;
        f.cars[i].demolished = o.demolished;
      });
    }
    return f;
  }
}
