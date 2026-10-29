import { BALL, CAR, CAR_CAR, sampleCurve } from '../config';
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
export function resolveCarArena(car: Car): number {
  const wheelsRoll = car.grounded;
  let impact = 0;
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
      impact = Math.max(impact, -vn);

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
  return impact;
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

// ---------------------------------------------------------------------------
// Coche contra coche: contacto por esquinas de OBB, impulso con inercia y empujones.
// ---------------------------------------------------------------------------

export interface CarCarContact {
  /** Normal del contacto, de B hacia A. */
  normal: Vec3;
  point: Vec3;
  penetration: number;
}

const ccD = new Vec3();
const ccAxis = new Vec3();
const ccBestAxis = new Vec3();
const ccSupA = new Vec3();
const ccSupB = new Vec3();

/** Proyección (semiancho) de la caja de `c` sobre el eje unitario `l`. */
function extent(c: Car, l: Vec3): number {
  return (
    c.half.x * Math.abs(c.forward.dot(l)) +
    c.half.y * Math.abs(c.leftAxis.dot(l)) +
    c.half.z * Math.abs(c.up.dot(l))
  );
}

/** Punto de soporte de la caja de `c` en la dirección `v` (0 en ejes perpendiculares: centro de cara). */
function support(c: Car, v: Vec3, out: Vec3): Vec3 {
  out.copy(c.pos);
  const sx = Math.abs(c.forward.dot(v)) < 1e-4 ? 0 : Math.sign(c.forward.dot(v));
  const sy = Math.abs(c.leftAxis.dot(v)) < 1e-4 ? 0 : Math.sign(c.leftAxis.dot(v));
  const sz = Math.abs(c.up.dot(v)) < 1e-4 ? 0 : Math.sign(c.up.dot(v));
  out.addScaled(c.forward, sx * c.half.x);
  out.addScaled(c.leftAxis, sy * c.half.y);
  out.addScaled(c.up, sz * c.half.z);
  return out;
}

/** Prueba un eje separador; devuelve false si separa las cajas, y actualiza el de menor solape. */
function satAxis(a: Car, b: Car, l: Vec3, penalty: number, best: { overlap: number }): boolean {
  const overlap = extent(a, l) + extent(b, l) - Math.abs(ccD.dot(l));
  if (overlap <= 0) return false;
  if (overlap + penalty < best.overlap) {
    best.overlap = overlap + penalty;
    ccBestAxis.copy(l);
  }
  return true;
}

const rA = new Vec3();
const rB = new Vec3();
const vA = new Vec3();
const vB = new Vec3();
const cc1 = new Vec3();
const cc2 = new Vec3();
const cc3 = new Vec3();

/**
 * Detecta y resuelve el choque entre dos coches. Devuelve true si había contacto y rellena `out`.
 * La normal apunta de B hacia A.
 */
export function collideCarCar(a: Car, b: Car, out: CarCarContact): boolean {
  const reach = a.radius + b.radius;
  cc1.copy(a.pos).sub(b.pos);
  if (cc1.lengthSq() > reach * reach) return false;

  // Teorema de ejes separadores: 3+3 ejes de cara y 9 de aristas.
  ccD.copy(a.pos).sub(b.pos);
  const best = { overlap: Infinity };
  const axesA = [a.forward, a.leftAxis, a.up];
  const axesB = [b.forward, b.leftAxis, b.up];
  for (const l of axesA) if (!satAxis(a, b, l, 0, best)) return false;
  for (const l of axesB) if (!satAxis(a, b, l, 0, best)) return false;
  for (const la of axesA) {
    for (const lb of axesB) {
      ccAxis.crossOf(la, lb);
      const len = ccAxis.length();
      if (len < 1e-3) continue;
      ccAxis.scale(1 / len);
      if (!satAxis(a, b, ccAxis, 0.75, best)) return false;
    }
  }
  // Normal de B hacia A y penetración real.
  out.normal.copy(ccBestAxis);
  if (out.normal.dot(ccD) < 0) out.normal.scale(-1);
  out.penetration = Math.max(
    0,
    extent(a, out.normal) + extent(b, out.normal) - Math.abs(ccD.dot(out.normal)),
  );
  // Punto de contacto: punto medio entre los soportes de cada caja hacia la otra.
  support(a, ccAxis.copy(out.normal).scale(-1), ccSupA);
  support(b, out.normal, ccSupB);
  out.point.copy(ccSupA).add(ccSupB).scale(0.5);

  const n = out.normal;
  // Separación a partes iguales.
  a.pos.addScaled(n, out.penetration * 0.5);
  b.pos.addScaled(n, -out.penetration * 0.5);

  rA.copy(out.point).sub(a.pos);
  rB.copy(out.point).sub(b.pos);
  cc1.crossOf(a.angVel, rA);
  vA.copy(a.vel).add(cc1);
  cc1.crossOf(b.angVel, rB);
  vB.copy(b.vel).add(cc1);
  const vn = cc2.copy(vA).sub(vB).dot(n);
  if (vn < 0) {
    const denom = carInvEffMass(a, rA, n) + carInvEffMass(b, rB, n);
    const j = (-(1 + CAR_CAR.restitution) * vn) / denom;
    applyCarImpulse(a, rA, n, j);
    applyCarImpulse(b, rB, n, -j);
  }
  return true;
}

export interface BumpInfo {
  /** El contacto ocurre en la zona frontal del coche. */
  front: boolean;
  /** Velocidad de acercamiento del coche hacia el otro (uu/s, >0 si embiste). */
  closing: number;
}

/** Evalúa si `attacker` embiste a `victim` con su zona frontal. */
export function bumpInfo(
  attacker: Car,
  victim: Car,
  contact: CarCarContact,
  attackerVel: Vec3,
  victimVel: Vec3,
): BumpInfo {
  cc1.copy(contact.point).sub(attacker.pos);
  attacker.quat.unrotate(cc1, cc1);
  const front = cc1.x >= attacker.half.x - CAR_CAR.frontZone;
  cc2.copy(victim.pos).sub(attacker.pos).normalize();
  cc3.copy(attackerVel).sub(victimVel);
  return { front, closing: cc3.dot(cc2) };
}

/** Empujón: transfiere un impulso adicional al rival según la velocidad de acercamiento. */
export function applyBump(attacker: Car, victim: Car, closing: number): void {
  cc1.copy(victim.pos).sub(attacker.pos).normalize();
  const extra = CAR_CAR.bumpBase + closing * CAR_CAR.bumpFactor;
  cc1.z += CAR_CAR.bumpUpward;
  cc1.normalize();
  victim.vel.addScaled(cc1, extra);
}
