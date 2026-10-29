// Predicción balística de la pelota (misma física que la simulación: gravedad, aire y rebotes en el estadio).
import { PHYSICS } from '../../config';
import { Ball } from '../ball';
import { Vec3 } from '../math';

export interface BallSample {
  /** Tiempo (s) desde el instante de la predicción. */
  t: number;
  pos: Vec3;
  vel: Vec3;
}

export class BallPredictor {
  readonly step = 1 / 40;
  readonly horizon = 2.6;
  readonly samples: BallSample[] = [];
  /** Tiempo de simulación (s) en el que se calculó la predicción. */
  time = -1;
  private scratch = new Ball();

  constructor() {
    const n = Math.ceil(this.horizon / this.step);
    for (let i = 0; i < n; i++) {
      this.samples.push({ t: (i + 1) * this.step, pos: new Vec3(), vel: new Vec3() });
    }
  }

  predict(ball: Ball, time: number): void {
    const s = this.scratch;
    s.pos.copy(ball.pos);
    s.vel.copy(ball.vel);
    s.angVel.copy(ball.angVel);
    s.quat.copy(ball.quat);
    s.radius = ball.radius;
    s.mass = ball.mass;
    s.restitution = ball.restitution;
    s.maxSpeed = ball.maxSpeed;
    s.gravityScale = ball.gravityScale;
    for (const sample of this.samples) {
      s.integrate(this.step);
      s.collideArena();
      sample.pos.copy(s.pos);
      sample.vel.copy(s.vel);
    }
    this.time = time;
  }

  /** Muestra de la predicción correspondiente al instante absoluto `time` (la más cercana). */
  at(time: number): BallSample {
    const k = Math.round((time - this.time) / this.step) - 1;
    return this.samples[Math.max(0, Math.min(this.samples.length - 1, k))];
  }
}

export const GRAVITY = PHYSICS.gravity;
