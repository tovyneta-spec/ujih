// Garaje: opciones de personalización del coche del jugador.
import type { CarBodyId } from './cars';

export type WheelStyle = 'classic' | 'spokes' | 'chrome' | 'turbine' | 'neon';
export type TrailStyle = 'flame' | 'plasma' | 'toxic' | 'rainbow' | 'sparkle';
export type GoalExplosion = 'classic' | 'fireworks' | 'confetti';
export type AntennaStyle = 'none' | 'ball' | 'flag' | 'star';
export type DecalStyle = 'none' | 'stripes' | 'dots' | 'checker';

export interface GarageSettings {
  name: string;
  body: CarBodyId;
  /** Colores en formato #rrggbb. */
  primary: string;
  secondary: string;
  wheels: WheelStyle;
  trail: TrailStyle;
  explosion: GoalExplosion;
  antenna: AntennaStyle;
  decal: DecalStyle;
}

export const DEFAULT_GARAGE: GarageSettings = {
  name: 'Tú',
  body: 'octane',
  primary: '#2f7bff',
  secondary: '#1b2236',
  wheels: 'classic',
  trail: 'flame',
  explosion: 'classic',
  antenna: 'none',
  decal: 'none',
};

export const BODY_IDS: readonly CarBodyId[] = [
  'octane',
  'dominus',
  'plank',
  'breakout',
  'hybrid',
  'merc',
];

export const WHEEL_STYLES: Record<WheelStyle, string> = {
  classic: 'Clásicas',
  spokes: 'Radios',
  chrome: 'Cromadas',
  turbine: 'Turbina',
  neon: 'Neón',
};

export interface TrailSpec {
  name: string;
  /** Color del núcleo y del borde de la llama, y de las chispas. */
  core: number;
  outer: number;
  spark: number;
  /** Cicla el matiz con el tiempo. */
  rainbow?: boolean;
}

export const TRAILS: Record<TrailStyle, TrailSpec> = {
  flame: { name: 'Llama', core: 0xffe08a, outer: 0xff6a1a, spark: 0xffb347 },
  plasma: { name: 'Plasma', core: 0xd8f6ff, outer: 0x1fa8ff, spark: 0x7fdcff },
  toxic: { name: 'Tóxica', core: 0xeaffb0, outer: 0x3fd13a, spark: 0xa6ff5c },
  rainbow: { name: 'Arcoíris', core: 0xffffff, outer: 0xff4fd8, spark: 0xffffff, rainbow: true },
  sparkle: { name: 'Destellos', core: 0xfff6d6, outer: 0xffd23f, spark: 0xffffff },
};

export const EXPLOSIONS: Record<GoalExplosion, string> = {
  classic: 'Clásica',
  fireworks: 'Fuegos artificiales',
  confetti: 'Confeti',
};

export const ANTENNAS: Record<AntennaStyle, string> = {
  none: 'Ninguna',
  ball: 'Bola',
  flag: 'Bandera',
  star: 'Estrella',
};

export const DECALS: Record<DecalStyle, string> = {
  none: 'Ninguna',
  stripes: 'Rayas',
  dots: 'Lunares',
  checker: 'Cuadros',
};

/** Paleta rápida de colores del garaje. */
export const PALETTE: readonly string[] = [
  '#2f7bff',
  '#ff7a1f',
  '#e53935',
  '#43a047',
  '#fdd835',
  '#8e24aa',
  '#00bcd4',
  '#ec407a',
  '#eceff1',
  '#546e7a',
  '#212121',
  '#a1887f',
];
