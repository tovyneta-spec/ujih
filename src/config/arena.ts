// Geometría del estadio estándar (unidades de juego "uu": 1 uu = 1 cm).
// Ejes de la simulación: x = ancho, y = largo (portería azul en y<0), z = arriba.

export const ARENA = {
  /** Semiancho (paredes laterales en x = ±4096). */
  halfWidth: 4096,
  /** Semilargo hasta las paredes de fondo (y = ±5120). */
  halfLength: 5120,
  /** Altura del techo. */
  height: 2044,
  /** Radio de las esquinas verticales (planta redondeada). */
  cornerRadius: 1152,
  /** Radio de las rampas curvas suelo-pared y pared-techo. */
  rampRadius: 260,
  goal: {
    /** Semiancho de la portería (x = ±893). */
    halfWidth: 893,
    /** Altura interior hasta el larguero. */
    height: 643,
    /** Fondo de la portería detrás de la línea de gol. */
    depth: 880,
    /** Radio visual de postes y larguero. */
    postRadius: 22,
    /** Origen (|y|) a partir del cual existe el hueco de portería (recorta la rampa). */
    pocketStart: 4500,
  },
} as const;

export type PadSize = 'big' | 'small';

export interface PadSpec {
  x: number;
  y: number;
  size: PadSize;
}

/** Reflejo simétrico respecto a x e y (sin duplicar coordenadas 0). */
function mirror(x: number, y: number, size: PadSize): PadSpec[] {
  const xs = x === 0 ? [0] : [x, -x];
  const ys = y === 0 ? [0] : [y, -y];
  const out: PadSpec[] = [];
  for (const yy of ys) for (const xx of xs) out.push({ x: xx, y: yy, size });
  return out;
}

/** Los 34 pads de turbo: 6 grandes y 28 pequeños. */
export const BOOST_PADS: readonly PadSpec[] = [
  ...mirror(3072, 4096, 'big'),
  ...mirror(3584, 0, 'big'),
  ...mirror(0, 4240, 'small'),
  ...mirror(1792, 4184, 'small'),
  ...mirror(940, 3308, 'small'),
  ...mirror(0, 2816, 'small'),
  ...mirror(3584, 2484, 'small'),
  ...mirror(1788, 2300, 'small'),
  ...mirror(2048, 1036, 'small'),
  ...mirror(0, 1024, 'small'),
  ...mirror(1024, 0, 'small'),
];

export const PADS = {
  big: { amount: 100, respawn: 10, radius: 208, height: 168 },
  small: { amount: 12, respawn: 4, radius: 144, height: 165 },
} as const;

/** Posiciones de saque del equipo azul (y<0). El naranja usa el espejo (x, y) → (-x, -y). */
export const KICKOFF_SPOTS: readonly { x: number; y: number }[] = [
  { x: -2048, y: -2560 },
  { x: 2048, y: -2560 },
  { x: -256, y: -3840 },
  { x: 256, y: -3840 },
  { x: 0, y: -4608 },
];
