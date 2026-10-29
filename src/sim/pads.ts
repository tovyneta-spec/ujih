import { BOOST_PADS, PADS } from '../config';
import type { PadSpec } from '../config';
import type { Car } from './car';

export class BoostPad {
  readonly spec: PadSpec;
  active = true;
  timer = 0;
  /** Radio² y altura de recogida, precalculados (el bucle de recogida es de los más calientes). */
  readonly radiusSq: number;
  readonly height: number;
  readonly amount: number;
  readonly respawn: number;
  constructor(spec: PadSpec) {
    this.spec = spec;
    const cfg = PADS[spec.size];
    this.radiusSq = cfg.radius * cfg.radius;
    this.height = cfg.height;
    this.amount = cfg.amount;
    this.respawn = cfg.respawn;
  }
  reset(): void {
    this.active = true;
    this.timer = 0;
  }
}

export function createPads(): BoostPad[] {
  return BOOST_PADS.map((s) => new BoostPad(s));
}

/** Avanza los temporizadores de reaparición y devuelve los pads recogidos en este paso. */
export function updatePads(
  pads: BoostPad[],
  dt: number,
  cars: readonly Car[],
  pickups: BoostPad[],
  enabled = true,
): void {
  pickups.length = 0;
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (!pad.active) {
      pad.timer -= dt;
      if (pad.timer <= 0) pad.active = true;
    }
  }
  if (!enabled) return;
  for (let c = 0; c < cars.length; c++) {
    const car = cars[c];
    // Un coche demolido o muy alto (aéreo) no puede recoger turbo.
    if (car.demolished || car.pos.z > 170) continue;
    const cx = car.pos.x;
    const cy = car.pos.y;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad.active) continue;
      const dx = cx - pad.spec.x;
      const dy = cy - pad.spec.y;
      if (dx * dx + dy * dy > pad.radiusSq || car.pos.z > pad.height) continue;
      pad.active = false;
      pad.timer = pad.respawn;
      car.boost = Math.min(100, car.boost + pad.amount);
      car.lastPadPickup = pad;
      pickups.push(pad);
    }
  }
}
