// Funciones puras del audio (sin WebAudio) para poder probarlas: afinación del motor, atenuación
// por distancia y panorama estéreo.

/** Frecuencia del motor (Hz) según la velocidad (uu/s). */
export function engineFrequency(speed: number): number {
  return 58 + Math.min(2300, Math.max(0, speed)) * 0.085;
}

/** Ganancia 0..1 según la distancia al oyente (uu); cae de forma suave hasta 0 a `range`. */
export function distanceGain(dist: number, range = 6500): number {
  const k = Math.max(0, 1 - dist / range);
  return k * k;
}

/** Panorama estéreo -1..1 a partir del vector oyente→fuente y el eje derecho del oyente. */
export function panFor(
  dx: number,
  dy: number,
  dz: number,
  rx: number,
  ry: number,
  rz: number,
): number {
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) return 0;
  return Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / len));
}
