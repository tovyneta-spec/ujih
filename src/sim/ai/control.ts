// Controladores de bajo nivel: orientación en el aire y conducción sobre cualquier superficie.
import { CAR } from '../../config';
import type { Car } from '../car';
import type { CarInput } from '../input';
import { Vec3, clamp } from '../math';

const wl = new Vec3();

/**
 * Controlador PD de actitud: orienta el morro hacia `fwdT` y el techo hacia `upT`
 * produciendo pitch/yaw/roll normalizados. Vectores unitarios en coordenadas del mundo.
 */
export function orient(car: Car, fwdT: Vec3, upT: Vec3, out: CarInput): void {
  // Objetivo en coordenadas locales (x adelante, y izquierda, z arriba).
  const tfx = fwdT.dot(car.forward);
  const tfy = fwdT.dot(car.leftAxis);
  const tfz = fwdT.dot(car.up);
  const tuy = upT.dot(car.leftAxis);
  const tuz = upT.dot(car.up);
  const pitchErr = Math.atan2(tfz, tfx); // >0: objetivo por encima → morro arriba
  const yawErr = Math.atan2(tfy, tfx); // >0: objetivo a la izquierda
  const rollErr = Math.atan2(tuy, tuz);

  car.quat.unrotate(car.angVel, wl);
  out.pitch = clamp(2.4 * pitchErr + 0.9 * wl.y, -1, 1);
  out.yaw = clamp(-3.3 * yawErr + 1.2 * wl.z, -1, 1);
  // El alabeo sólo importa cuando el morro ya apunta aproximadamente bien.
  const rollGain = Math.abs(pitchErr) + Math.abs(yawErr) < 1.2 ? 1 : 0.3;
  out.roll = clamp((-1.4 * rollErr - 0.5 * wl.x) * rollGain, -1, 1);
}

/** Ángulo (rad) del objetivo respecto al morro en el plano del coche; >0 = a la izquierda. */
export function bearing(car: Car, target: Vec3): number {
  const dx = target.x - car.pos.x;
  const dy = target.y - car.pos.y;
  const dz = target.z - car.pos.z;
  const lf = dx * car.forward.x + dy * car.forward.y + dz * car.forward.z;
  const ll = dx * car.leftAxis.x + dy * car.leftAxis.y + dz * car.leftAxis.z;
  return Math.atan2(ll, lf);
}

/**
 * Conduce hacia `target` con una velocidad deseada. Usa las mismas entradas que un jugador:
 * gas, dirección, derrape y turbo.
 */
export function driveToward(
  car: Car,
  target: Vec3,
  desiredSpeed: number,
  allowBoost: boolean,
  out: CarInput,
): void {
  const angle = bearing(car, target);
  const abs = Math.abs(angle);
  const vf = car.forwardSpeed;

  out.steer = clamp(-angle * 2.6, -1, 1);
  out.yaw = out.steer;
  out.pitch = 0;
  out.roll = 0;

  // Gas: mantener la velocidad deseada; reducir en giros cerrados.
  const want = desiredSpeed * (abs > 1.3 ? 0.45 : abs > 0.7 ? 0.75 : 1);
  if (vf < want - 80) out.throttle = 1;
  else if (vf > want + 350) out.throttle = -1;
  else out.throttle = vf > want ? 0 : 0.5;

  // Derrape en giros cerrados a velocidad.
  out.handbrake = abs > 1.15 && Math.abs(vf) > 700;
  out.boost =
    allowBoost && abs < 0.22 && vf < CAR.supersonicSpeed + 50 && want > vf + 150 && car.boost > 2;
  out.jump = false;
}
