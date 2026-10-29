// Funciones puras del audio (sin WebAudio) para poder probarlas: afinación del motor, atenuación
// por distancia, panorama estéreo y la progresión musical.

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

/** Convierte una nota MIDI en frecuencia. */
export const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Progresión Am – F – C – G (raíces MIDI y tipo de acorde). */
const CHORDS: { root: number; third: number }[] = [
  { root: 57, third: 3 }, // La menor
  { root: 53, third: 4 }, // Fa mayor
  { root: 48, third: 4 }, // Do mayor
  { root: 55, third: 4 }, // Sol mayor
];

export interface MusicStep {
  chordIndex: number;
  /** Notas del acorde (MIDI) para el colchón. */
  chord: number[];
  bass: number;
  /** Nota del arpegio en esta corchea. */
  arp: number;
}

/** Paso `step` (corcheas) de la música generativa. Cada acorde dura 8 corcheas. */
export function musicStep(step: number): MusicStep {
  const chordIndex = Math.floor(step / 8) % CHORDS.length;
  const { root, third } = CHORDS[chordIndex];
  const chord = [root, root + third, root + 7];
  const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
  return { chordIndex, chord, bass: root - 24, arp: chord[pattern[step % 8]] + 12 };
}
