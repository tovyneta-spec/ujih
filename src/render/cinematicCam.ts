// Cámaras cinemáticas: repetición de gol (3 planos) y órbita lenta para el fondo de los menús.
import { ARENA } from '../config';
import type { RenderFrame } from '../replay';
import { Vec3 } from '../sim';
import { arenaQuery } from '../sim/arena';
import type { CameraPose } from './cameraRig';

const n = new Vec3();

function keepInside(p: Vec3): void {
  for (let i = 0; i < 3; i++) {
    const d = arenaQuery(p.x, p.y, p.z, n);
    if (d < 40) p.addScaled(n, 40 - d);
  }
}

export class CinematicCam {
  readonly pose: CameraPose = { position: new Vec3(), target: new Vec3(), fov: 80 };
  private heading = new Vec3(0, 1, 0);

  /**
   * Cámara de repetición en el instante `t` de `duration`.
   * Plano 1: seguimiento del goleador · plano 2: órbita sobre la pelota · plano 3: línea de gol.
   */
  replay(
    t: number,
    duration: number,
    frame: RenderFrame,
    focusCarId: number,
    scoringTeam: 0 | 1,
  ): CameraPose {
    const p = this.pose;
    const ball = frame.ballPos;
    const car = frame.cars[focusCarId]?.pos ?? ball;
    const u = t / Math.max(0.001, duration);

    if (u < 0.42) {
      // Persecución del goleador (rumbo suavizado a partir de su movimiento).
      const q = frame.cars[focusCarId]?.quat;
      if (q) {
        const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
        const fy = 2 * (q.x * q.y + q.z * q.w);
        const l = Math.hypot(fx, fy);
        if (l > 0.3) {
          this.heading.x += (fx / l - this.heading.x) * 0.12;
          this.heading.y += (fy / l - this.heading.y) * 0.12;
          this.heading.normalize();
        }
      }
      p.position.set(car.x - this.heading.x * 520, car.y - this.heading.y * 520, car.z + 230);
      p.target.set(
        car.x + (ball.x - car.x) * 0.5,
        car.y + (ball.y - car.y) * 0.5,
        Math.max(60, car.z * 0.5 + ball.z * 0.5),
      );
      p.fov = 85;
    } else if (u < 0.74) {
      // Órbita lenta alrededor de la pelota.
      const a = (u - 0.42) * 5.2 + 0.6;
      p.position.set(ball.x + Math.cos(a) * 1000, ball.y + Math.sin(a) * 1000, ball.z + 380);
      p.target.copy(ball);
      p.fov = 70;
    } else {
      // Cámara de línea de gol: situada delante de la portería, mirando a la pelota.
      const goalY = (scoringTeam === 0 ? 1 : -1) * ARENA.halfLength;
      const side = ball.x >= 0 ? -1 : 1;
      p.position.set(side * 700, goalY - Math.sign(goalY) * 1500, 330);
      p.target.copy(ball);
      p.fov = 62;
    }
    keepInside(p.position);
    return p;
  }

  /** Órbita lenta alrededor del estadio (fondo de menús). */
  orbit(time: number): CameraPose {
    const p = this.pose;
    const a = time * 0.12;
    p.position.set(Math.cos(a) * 3300, Math.sin(a) * 4300, 1000 + Math.sin(time * 0.2) * 250);
    p.target.set(0, 0, 250);
    p.fov = 70;
    keepInside(p.position);
    return p;
  }
}
