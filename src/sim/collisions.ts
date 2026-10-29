import { BALL, CAR, sampleCurve } from '../config';
import { arenaQuery } from './arena';
import type { Ball } from './ball';
import type { Car } from './car';
import { Vec3, clamp } from './math';

const CAR_HIT = CAR.hit;

const n = new Vec3();
const corner = new Vec3();
const r = new Vec3();
const vp = new Vec3();
const t = new Vec3();
const tmp = new Vec3();
const tmp2 = new Vec3();
const rxn = new Vec3();
const iw = new Vec3();
const local = new Vec3();
const clampedLocal = new Vec3();
const contactWorld = new Vec3();
const relPos = new Vec3();
const relVel = new Vec3();
const rb = new Vec3();

/** Masa efectiva inversa del coche en el punto r para la dirección d. */
function carInvEffMass(car: Car, rr: Vec3, d: Vec3): number {
  rxn.crossOf(rr, d);
  car.applyInvInertia(rxn, iw);
  tmp2.crossOf(iw, rr);
  return 1 / car.mass + tmp2.dot(d);
}

/** Aplica un impulso J·dir al coche en el punto relativo rr. */
function applyCarImpulse(car: Car, rr: Vec3, dir: Vec3, j: number): void {
  car.vel.addScaled(dir, j / car.mass);
  rxn.crossOf(rr, dir).scale(j);
  car.applyInvInertia(rxn, iw);
  car.angVel.add(iw);
}

/** Resuelve la colisión de las 8 esquinas de la hitbox contra el estadio. */
export function resolveCarArena(car: Car): void {
  const wheelsRoll = car.grounded;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < 8; i++) {
      car.cornerWorld(i, corner);
      const depth = arenaQuery(corner.x, corner.y, corner.z, n);
      if (depth >= 0) continue;
      const pen = -depth;
      car.pos.addScaled(n, pen);

      r.copy(corner).sub(car.pos).addScaled(n, pen);
      tmp.crossOf(car.angVel, r);
      vp.copy(car.vel).add(tmp);
      const vn = vp.dot(n);
      if (vn >= 0) continue;

      const e = vn < -80 ? CAR.bodyRestitution : 0;
      const jn = (-(1 + e) * vn) / carInvEffMass(car, r, n);
      applyCarImpulse(car, r, n, jn);

      // Las ruedas apoyadas no tienen fricción propia: la conducción modela su agarre.
      if (i < 4 && wheelsRoll) continue;
      tmp.crossOf(car.angVel, r);
      vp.copy(car.vel).add(tmp);
      t.copy(vp).addScaled(n, -vp.dot(n));
      const vt = t.length();
      if (vt > 1e-4) {
        t.scale(1 / vt);
        const jt = Math.min(CAR.bodyFriction * jn, vt / carInvEffMass(car, r, t));
        applyCarImpulse(car, r, t, -jt);
      }
    }
  }
}

export interface BallCarHit {
  /** La parte inferior del coche (ruedas) ha tocado la pelota: restaura el flip. */
  flipReset: boolean;
  /** Primer instante del contacto (no un contacto continuado). */
  fresh: boolean;
  /** Velocidad relativa previa al golpe (uu/s). */
  relSpeed: number;
}

/**
 * Colisión esfera-OBB entre pelota y coche. Aplica el impulso normal con fricción alta
 * y, en el primer instante del contacto, el impulso extra de golpeo que da el "pop".
 */
export function collideBallCar(ball: Ball, car: Car, tick: number, out: BallCarHit): boolean {
  // Pelota en el espacio local del coche.
  local.copy(ball.pos).sub(car.pos);
  car.quat.unrotate(local, local);
  clampedLocal.set(
    clamp(local.x, -car.half.x, car.half.x),
    clamp(local.y, -car.half.y, car.half.y),
    clamp(local.z, -car.half.z, car.half.z),
  );
  tmp.copy(local).sub(clampedLocal);
  let dist = tmp.length();
  if (dist >= ball.radius) return false;

  if (dist < 1e-6) {
    // Centro dentro de la caja: expulsar por la cara más cercana.
    const dx = car.half.x - Math.abs(local.x);
    const dy = car.half.y - Math.abs(local.y);
    const dz = car.half.z - Math.abs(local.z);
    tmp.set(0, 0, 0);
    if (dx <= dy && dx <= dz) tmp.x = Math.sign(local.x || 1);
    else if (dy <= dz) tmp.y = Math.sign(local.y || 1);
    else tmp.z = Math.sign(local.z || 1);
    dist = 0;
  } else tmp.scale(1 / dist);

  // Normal (del coche hacia la pelota) y punto de contacto en el mundo.
  const localNormalZ = tmp.z;
  const localContactZ = clampedLocal.z;
  car.quat.rotate(tmp, n);
  car.quat.rotate(clampedLocal, contactWorld);
  contactWorld.add(car.pos);

  const pen = ball.radius - dist;
  const wasTouching = car.lastBallTouchTick >= tick - 1;
  out.fresh = !wasTouching;
  car.lastBallTouchTick = tick;

  // Velocidades relativas previas (para el impulso extra).
  relVel.copy(ball.vel).sub(car.vel);
  out.relSpeed = relVel.length();
  relPos.copy(ball.pos).sub(car.pos);
  out.flipReset = localNormalZ < -0.6 && localContactZ <= -car.half.z + 8;

  ball.pos.addScaled(n, pen);

  // Impulso normal + fricción.
  r.copy(contactWorld).sub(car.pos);
  rb.copy(n).scale(-ball.radius);
  tmp.crossOf(ball.angVel, rb);
  vp.copy(ball.vel).add(tmp);
  tmp.crossOf(car.angVel, r);
  vp.sub(car.vel).sub(tmp);
  const vn = vp.dot(n);
  if (vn < 0) {
    const e = CAR_HIT.restitution;
    const kBall = 1 / ball.mass;
    const jn = (-(1 + e) * vn) / (kBall + carInvEffMass(car, r, n));
    ball.vel.addScaled(n, jn / ball.mass);
    applyCarImpulse(car, r, n, -jn);

    t.copy(vp).addScaled(n, -vn);
    const vt = t.length();
    if (vt > 1e-4) {
      t.scale(1 / vt);
      const kT = (1 + 1 / BALL.inertiaFactor) / ball.mass + carInvEffMass(car, r, t);
      const jt = Math.min(CAR_HIT.friction * jn, vt / kT);
      ball.vel.addScaled(t, -jt / ball.mass);
      tmp.crossOf(rb, t).scale(-jt / (BALL.inertiaFactor * ball.mass * ball.radius * ball.radius));
      ball.angVel.add(tmp);
      applyCarImpulse(car, r, t, jt);
    }
  }

  // Impulso extra de golpeo ("pop"): depende de la velocidad relativa y de la zona de contacto.
  if (out.fresh) {
    const relSpeed = Math.min(out.relSpeed, CAR_HIT.maxRelSpeed);
    if (relSpeed > 1) {
      tmp.set(relPos.x, relPos.y, relPos.z * CAR_HIT.extraZScale).normalize();
      // Atenúa la componente a lo largo del eje de avance del coche.
      const along = tmp.dot(car.forward);
      tmp.addScaled(car.forward, -along * (1 - CAR_HIT.extraForwardScale)).normalize();
      const factor = sampleCurve(CAR_HIT.extraFactor, relSpeed);
      ball.vel.addScaled(tmp, relSpeed * factor);
    }
  }
  ball.vel.clampLength(ball.maxSpeed);
  return true;
}
