// Persistencia del garaje y del audio en localStorage (siempre protegida: puede no estar disponible).
import {
  ANTENNAS,
  BODY_IDS,
  DECALS,
  DEFAULT_GARAGE,
  EXPLOSIONS,
  TRAILS,
  WHEEL_STYLES,
} from '../config';
import type { GarageSettings } from '../config';

const KEY = 'turbo-arena:garage';

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Valida datos arbitrarios y devuelve un garaje correcto (valores inválidos → por defecto). */
export function sanitizeGarage(raw: unknown): GarageSettings {
  const d = DEFAULT_GARAGE;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly string[], fallback: T): T =>
    typeof v === 'string' && allowed.includes(v) ? (v as T) : fallback;
  const color = (v: unknown, fallback: string): string =>
    typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
  const name =
    typeof r.name === 'string'
      ? r.name
          .replace(/[<>&"]/g, '')
          .trim()
          .slice(0, 16)
      : '';
  return {
    name: name || d.name,
    body: pick(r.body, BODY_IDS, d.body),
    primary: color(r.primary, d.primary),
    secondary: color(r.secondary, d.secondary),
    wheels: pick(r.wheels, Object.keys(WHEEL_STYLES), d.wheels),
    trail: pick(r.trail, Object.keys(TRAILS), d.trail),
    explosion: pick(r.explosion, Object.keys(EXPLOSIONS), d.explosion),
    antenna: pick(r.antenna, Object.keys(ANTENNAS), d.antenna),
    decal: pick(r.decal, Object.keys(DECALS), d.decal),
  };
}

export function loadGarage(): GarageSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeGarage(JSON.parse(raw));
  } catch {
    /* almacenamiento no disponible o JSON corrupto */
  }
  return { ...DEFAULT_GARAGE };
}

export function saveGarage(g: GarageSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* almacenamiento no disponible */
  }
}
