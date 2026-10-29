import { BALL, PHYSICS } from '../config';
import { arenaQuery } from './arena';
import { Quat, Vec3 } from './math';

const n = new Vec3();
const r = new Vec3();
const vrel = new Vec3();
const tmp = new Vec3();
const torque = new Vec3();

export class Ball {
  pos = new Vec3(0, 0, BALL.radius);
  vel = new Vec3();
  angVel = new Vec3();
  quat = new Quat();
  prevPos = new Vec3(0, 0, BALL.radius);
  prevQuat = new Quat();
  radius: number = BALL.radius;
  mass: number = BALL.mass;
  /** Gravedad relativa (mutadores). */
  gravityScale = 1;
  maxSpeed: number = BALL.maxSpeed;
  restitution: number = BALL.restitution;

  reset(x = 0, y = 0, z: number = this.radius): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.set(0, 0, 0, 1);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  savePrev(): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  /** Integra gravedad, resistencia del aire y movimiento. */
  integrate(dt: number): void {
    this.vel.z += PHYSICS.gravity * this.gravityScale * dt;
    this.vel.scale(1 - BALL.drag * dt);
    this.vel.clampLength(this.maxSpeed);
    this.angVel.clampLength(BALL.maxAngularSpeed);
    this.pos.addScaled(this.vel, dt);
    this.quat.integrate(this.angVel.x, this.angVel.y, this.angVel.z, dt);
  }

  /** Colisión esfera-estadio con rebote y fricción (genera giro). */
  collideArena(): number {
    let impact = 0;
    for (let i = 0; i < 2; i++) {
      const depth = arenaQuery(this.pos.x, this.pos.y, this.pos.z, n);
      const pen = this.radius - depth;
      if (pen <= 0) return impact;
      this.pos.addScaled(n, pen);

      // Velocidad del punto de contacto: v + ω × r, con r = -n·R.
      r.copy(n).scale(-this.radius);
      tmp.crossOf(this.angVel, r);
      vrel.copy(this.vel).add(tmp);
      const vn = vrel.dot(n);
      if (vn >= 0) continue;
      impact = Math.max(impact, -vn);

      const e = vn < -BALL.restitutionThreshold ? this.restitution : 0;
      const jn = -(1 + e) * vn * this.mass;
      this.vel.addScaled(n, jn / this.mass);

      // Fricción de Coulomb tangencial (masa efectiva de esfera maciza: 3.5/m con factor 0.4).
      tmp.copy(vrel).addScaled(n, -vn);
      const vt = tmp.length();
      if (vt > 1e-6) {
        tmp.scale(1 / vt);
        const kInv = (1 + 1 / BALL.inertiaFactor) / this.mass;
        const jt = Math.min(BALL.friction * jn, vt / kInv);
        this.vel.addScaled(tmp, -jt / this.mass);
        torque
          .crossOf(r, tmp)
          .scale(-jt / (BALL.inertiaFactor * this.mass * this.radius * this.radius));
        this.angVel.add(torque);
      }
    }
    return impact;
  }
}
