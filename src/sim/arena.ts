// Colisión del estadio mediante un campo de distancia con signo (SDF) analítico: sin mallas ni huecos.
// depth > 0 dentro del espacio jugable, depth < 0 dentro de la pared. Las transiciones suelo-pared y
// pared-techo son rampas circulares y las esquinas verticales son arcos de circunferencia.

import { ARENA } from '../config';
import { Vec3 } from './math';

const HX = ARENA.halfWidth;
const HY = ARENA.halfLength;
const H = ARENA.height;
const RC = ARENA.cornerRadius;
const RR = ARENA.rampRadius;
const GX = ARENA.goal.halfWidth;
const GZ = ARENA.goal.height;
const GEND = HY + ARENA.goal.depth;
const GSTART = ARENA.goal.pocketStart;

/** Profundidad (distancia a la superficie más cercana, positiva dentro) en el punto dado. */
export function arenaDepth(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);

  // Profundidad horizontal hasta la pared (planta de rectángulo con esquinas redondeadas).
  const qx = ax - (HX - RC);
  const qy = ay - (HY - RC);
  const a = qx > 0 && qy > 0 ? RC - Math.hypot(qx, qy) : Math.min(HX - ax, HY - ay);

  // Profundidad vertical hasta suelo o techo.
  const b = Math.min(z, H - z);

  // Intersección redondeada (rampas) de ambos semiespacios.
  const d = a >= RR || b >= RR ? Math.min(a, b) : RR - Math.hypot(RR - a, RR - b);

  // Hueco de portería: unión con una caja que atraviesa la pared de fondo y recorta la rampa.
  const g = Math.min(GX - ax, z, GZ - z, GEND - ay, ay - GSTART);
  return g > d ? g : d;
}

const EPS = 0.5;

/**
 * Devuelve la profundidad y escribe en `normal` la normal unitaria de la superficie
 * (apunta hacia el interior jugable), calculada por diferencias centrales.
 */
export function arenaQuery(x: number, y: number, z: number, normal: Vec3): number {
  const d = arenaDepth(x, y, z);
  normal.set(
    arenaDepth(x + EPS, y, z) - arenaDepth(x - EPS, y, z),
    arenaDepth(x, y + EPS, z) - arenaDepth(x, y - EPS, z),
    arenaDepth(x, y, z + EPS) - arenaDepth(x, y, z - EPS),
  );
  if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
  else normal.normalize();
  return d;
}

/** Equipo que marca si la pelota está completamente dentro de una portería: 0 azul, 1 naranja, -1 ninguno. */
export function goalScoredBy(x: number, y: number, z: number, ballRadius: number): -1 | 0 | 1 {
  if (Math.abs(x) > GX || z > GZ + ballRadius) return -1;
  if (y > HY + ballRadius) return 0; // la pelota entra en la portería naranja (y>0): marca el azul
  if (y < -(HY + ballRadius)) return 1;
  return -1;
}
