import { BOOST_PADS, PADS } from '../config';
import type { PadSpec } from '../config';
import type { Car } from './car';

export class BoostPad {
  readonly spec: PadSpec;
  active = true;
  timer = 0;
  constructor(spec: PadSpec) {
    this.spec = spec;
  }
  reset(): void {
    this.active = true;
    this.timer = 0;
  }
}

export function createPads(): BoostPad[] {
  return BOOST_PADS.map((s) => new BoostPad(s));
}

/** Avanza los temporizadores de reaparición y devuelve los pads recogidos por `car` en este paso. */
export function updatePads(
  pads: BoostPad[],
  dt: number,
  cars: readonly Car[],
  pickups: BoostPad[],
  enabled = true,
): void {
  pickups.length = 0;
  for (const pad of pads) {
    if (!pad.active) {
      pad.timer -= dt;
      if (pad.timer <= 0) pad.active = true;
    }
  }
  if (!enabled) return;
  if (!enabled) return;
  for (const car of cars) {
    if (car.demolished) continue;
    for (const pad of pads) {
      if (!pad.active) continue;
      const cfg = PADS[pad.spec.size];
      const dx = car.pos.x - pad.spec.x;
      const dy = car.pos.y - pad.spec.y;
      if (dx * dx + dy * dy > cfg.radius * cfg.radius || Math.abs(car.pos.z) > cfg.height) continue;
      pad.active = false;
      pad.timer = cfg.respawn;
      car.boost = Math.min(100, car.boost + cfg.amount);
      car.lastPadPickup = pad;
      pickups.push(pad);
    }
  }
}
