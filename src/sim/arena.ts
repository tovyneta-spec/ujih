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

// Resultado de la última evaluación. Se devuelve por un Float64Array y no por `return`: así V8 no
// reserva un número decimal en el montón en cada llamada (decenas de miles por tick).
const OUT = new Float64Array(1);

/** Profundidad de la última consulta de `arenaQueryD`. */
export const queryDepth = new Float64Array(1);

/** Entrada de `sdf` (punto a evaluar). Se pasa por array para no crear números decimales en el montón. */
const IN = new Float64Array(3);

function sdf(): void {
  const x = IN[0];
  const y = IN[1];
  const z = IN[2];
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;

  // Profundidad horizontal hasta la pared (planta de rectángulo con esquinas redondeadas).
  const qx = ax - (HX - RC);
  const qy = ay - (HY - RC);
  let a: number;
  if (qx > 0 && qy > 0) a = RC - Math.sqrt(qx * qx + qy * qy);
  else {
    const u = HX - ax;
    const v = HY - ay;
    a = u < v ? u : v;
  }

  // Profundidad vertical hasta suelo o techo.
  const zc = H - z;
  const b = z < zc ? z : zc;

  // Intersección redondeada (rampas) de ambos semiespacios.
  let d: number;
  if (a >= RR || b >= RR) d = a < b ? a : b;
  else {
    const du = RR - a;
    const dv = RR - b;
    d = RR - Math.sqrt(du * du + dv * dv);
  }

  // Hueco de portería: unión con una caja que atraviesa la pared de fondo y recorta la rampa.
  let g = GX - ax;
  if (z < g) g = z;
  const t = GZ - z;
  if (t < g) g = t;
  const e = GEND - ay;
  if (e < g) g = e;
  const f = ay - GSTART;
  if (f < g) g = f;
  OUT[0] = g > d ? g : d;
}

/** Profundidad (distancia a la superficie más cercana, positiva dentro) en el punto dado. */
export function arenaDepth(x: number, y: number, z: number): number {
  IN[0] = x;
  IN[1] = y;
  IN[2] = z;
  sdf();
  return OUT[0];
}

const EPS = 0.5;

/**
 * Versión sin asignaciones para los bucles de física: escribe la normal unitaria de la superficie
 * (hacia el interior jugable, por diferencias centrales) en `normal` y la profundidad en `queryDepth[0]`.
 */
export function arenaQueryD(x: number, y: number, z: number, normal: Vec3): void {
  IN[0] = x;
  IN[1] = y;
  IN[2] = z;
  evalNormal(x, y, z, normal);
}

/** Igual que `arenaQueryD` pero recibe el punto como vector (sin pasar números sueltos). */
export function arenaQueryV(p: Vec3, normal: Vec3): void {
  evalNormal(p.x, p.y, p.z, normal);
}

function evalNormal(x: number, y: number, z: number, normal: Vec3): void {
  IN[0] = x;
  IN[1] = y;
  IN[2] = z;
  sdf();
  const d = OUT[0];
  IN[0] = x + EPS;
  sdf();
  const xp = OUT[0];
  IN[0] = x - EPS;
  sdf();
  const xm = OUT[0];
  IN[0] = x;
  IN[1] = y + EPS;
  sdf();
  const yp = OUT[0];
  IN[1] = y - EPS;
  sdf();
  const ym = OUT[0];
  IN[1] = y;
  IN[2] = z + EPS;
  sdf();
  const zp = OUT[0];
  IN[2] = z - EPS;
  sdf();
  const zm = OUT[0];
  normal.set(xp - xm, yp - ym, zp - zm);
  if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
  else normal.normalize();
  queryDepth[0] = d;
}

/** Devuelve la profundidad y escribe en `normal` la normal unitaria de la superficie. */
export function arenaQuery(x: number, y: number, z: number, normal: Vec3): number {
  arenaQueryD(x, y, z, normal);
  return queryDepth[0];
}

/** Equipo que marca si la pelota está completamente dentro de una portería: 0 azul, 1 naranja, -1 ninguno. */
export function goalScoredBy(x: number, y: number, z: number, ballRadius: number): -1 | 0 | 1 {
  if (Math.abs(x) > GX || z > GZ + ballRadius) return -1;
  if (y > HY + ballRadius) return 0; // la pelota entra en la portería naranja (y>0): marca el azul
  if (y < -(HY + ballRadius)) return 1;
  return -1;
}
