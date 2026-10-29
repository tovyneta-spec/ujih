// Cámara de coche y cámara de pelota con suavizado, transición y colisión con el estadio.
import { DEFAULT_CAMERA } from '../config';
import type { CameraSettings } from '../config';
import { Vec3, clamp } from '../sim';
import { arenaQuery } from '../sim/arena';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

const DEG = Math.PI / 180;
const tmp = new Vec3();
const n = new Vec3();

export class CameraRig {
  settings: CameraSettings = { ...DEFAULT_CAMERA };
  ballCam = true;
  lookBack = false;
  readonly pose: CameraPose = { position: new Vec3(0, -1500, 400), target: new Vec3(), fov: 110 };

  private heading = new Vec3(0, 1, 0);
  private blend = 1; // 0 = cámara de coche, 1 = cámara de pelota
  private smoothPos = new Vec3(0, -1500, 400);
  private smoothTarget = new Vec3();
  private fovKick = 0;
  /** Amplitud de la sacudida (uu); decae sola. Se dispara con goles y demoliciones. */
  private shakeAmp = 0;
  private shakeT = 0;
  private initialised = false;
  private wantPos = new Vec3();
  private wantTarget = new Vec3();
  private carLook = new Vec3();
  private ballLook = new Vec3();

  reset(): void {
    this.initialised = false;
    this.shakeAmp = 0;
  }

  /** Sacudida puntual de la cámara (sólo si está activada en los ajustes). */
  kick(amount: number): void {
    if (this.settings.shake) this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /**
   * Actualiza la pose en coordenadas de la simulación.
   * @param carPos posición interpolada del coche; carFwd su eje de avance
   */
  update(dt: number, carPos: Vec3, carFwd: Vec3, ballPos: Vec3, boosting: boolean): CameraPose {
    const s = this.settings;
    const { distance, height } = s;

    // Transición suave entre modos.
    const targetBlend = this.ballCam && !this.lookBack ? 1 : 0;
    this.blend += clamp(targetBlend - this.blend, -1, 1) * Math.min(1, dt * s.transitionSpeed * 3);

    // --- Cámara de coche: rumbo horizontal del coche (o el contrario al mirar atrás). ---
    tmp.set(carFwd.x, carFwd.y, 0);
    const horiz = tmp.length();
    if (horiz > 0.25) {
      tmp.scale(1 / horiz);
      if (this.lookBack) tmp.scale(-1);
      const k = 1 - Math.exp(-s.swivelSpeed * 2.2 * dt);
      this.heading.x += (tmp.x - this.heading.x) * k;
      this.heading.y += (tmp.y - this.heading.y) * k;
      this.heading.normalize();
    }
    const carCamDir = this.heading;

    // --- Cámara de pelota: del coche hacia la pelota. ---
    let bx = ballPos.x - carPos.x;
    let by = ballPos.y - carPos.y;
    let bz = ballPos.z - carPos.z;
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl;
    by /= bl;
    bz /= bl;
    const bh = Math.hypot(bx, by) || 1;
    // Limita el cabeceo del rayo para que la cámara no se vaya al suelo/techo.
    const pitch = clamp(Math.atan2(bz, bh), -10 * DEG, 40 * DEG);
    const ballDirX = (bx / bh) * Math.cos(pitch);
    const ballDirY = (by / bh) * Math.cos(pitch);
    const ballDirZ = Math.sin(pitch);

    // Pose según cada modo.
    const b = this.blend;
    const dirX = carCamDir.x * (1 - b) + ballDirX * b;
    const dirY = carCamDir.y * (1 - b) + ballDirY * b;
    const dirZ = ballDirZ * b;
    const dl = Math.hypot(dirX, dirY, dirZ) || 1;
    const wantPos = this.wantPos.set(
      carPos.x - (dirX / dl) * distance,
      carPos.y - (dirY / dl) * distance,
      carPos.z - (dirZ / dl) * distance * 0.8 + height,
    );
    // Objetivo de la mirada: delante del coche en modo coche; hacia la pelota en modo pelota.
    const aim = Math.tan(s.angle * DEG);
    const carLook = this.carLook.set(
      carPos.x + carCamDir.x * 400,
      carPos.y + carCamDir.y * 400,
      carPos.z + height * 0.4 + aim * 400,
    );
    const ballLook = this.ballLook.set(
      carPos.x + (ballPos.x - carPos.x) * 0.85,
      carPos.y + (ballPos.y - carPos.y) * 0.85,
      Math.max(ballPos.z * 0.9, carPos.z + 40),
    );
    const wantTarget = this.wantTarget.lerpOf(carLook, ballLook, b);

    if (!this.initialised) {
      this.smoothPos.copy(wantPos);
      this.smoothTarget.copy(wantTarget);
      this.initialised = true;
    }
    const kp = 1 - Math.exp(-dt * (6 + s.stiffness * 40));
    this.smoothPos.lerpOf(this.smoothPos, wantPos, kp);
    this.smoothTarget.lerpOf(
      this.smoothTarget,
      wantTarget,
      1 - Math.exp(-dt * (10 + s.stiffness * 30)),
    );

    // Colisión con el estadio: la cámara no atraviesa paredes ni techo.
    for (let i = 0; i < 3; i++) {
      const d = arenaQuery(this.smoothPos.x, this.smoothPos.y, this.smoothPos.z, n);
      if (d < 30) this.smoothPos.addScaled(n, 30 - d);
    }

    this.pose.position.copy(this.smoothPos);
    if (this.shakeAmp > 0.05 && this.settings.shake) {
      this.shakeT += dt * 55;
      const a = this.shakeAmp;
      this.pose.position.x += Math.sin(this.shakeT * 1.3) * a;
      this.pose.position.y += Math.sin(this.shakeT * 1.7 + 1) * a;
      this.pose.position.z += Math.sin(this.shakeT * 2.1 + 2) * a * 0.6;
      this.shakeAmp *= Math.exp(-dt * 5);
    } else this.shakeAmp = 0;
    this.pose.target.copy(this.smoothTarget);
    this.fovKick += ((boosting ? 6 : 0) - this.fovKick) * Math.min(1, dt * 6);
    this.pose.fov = s.fov + this.fovKick;
    return this.pose;
  }
}
