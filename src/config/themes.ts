// Temas visuales del estadio. La geometría es idéntica; sólo cambian paleta, luces y brillo.
import type { Theme } from './mutators';

export interface ThemeSpec {
  id: Theme;
  name: string;
  background: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  /** Intensidad del mapa de entorno (reflejos baratos). */
  envIntensity: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** Color de la pared del equipo azul y naranja. */
  wallBlue: number;
  wallOrange: number;
  wallEmissive: number;
  wallOpacity: number;
  floorA: string;
  floorB: string;
  floorTintBlue: string;
  floorTintOrange: string;
  line: string;
  ceiling: number;
  ceilingEmissive: number;
  /** Barras de luz del techo y pantallas. */
  light: number;
  crowd: number[];
  /** Brillo de los espectadores (los temas oscuros los iluminan menos). */
  crowdBrightness: number;
}

export const THEMES: Record<Theme, ThemeSpec> = {
  day: {
    id: 'day',
    name: 'Día',
    background: 0x7fb4e8,
    fog: 0x9cc4ec,
    fogNear: 12000,
    fogFar: 30000,
    hemiSky: 0xdcebff,
    hemiGround: 0x5a6a80,
    hemiIntensity: 1.25,
    sunColor: 0xfff3dd,
    sunIntensity: 2.5,
    exposure: 1.05,
    envIntensity: 0.55,
    bloom: { strength: 0.22, radius: 0.5, threshold: 0.92 },
    wallBlue: 0x2f7bff,
    wallOrange: 0xff7a1f,
    wallEmissive: 0x16203a,
    wallOpacity: 0.55,
    floorA: '#2e8a5a',
    floorB: '#277a4f',
    floorTintBlue: 'rgba(40,110,255,0.26)',
    floorTintOrange: 'rgba(255,130,30,0.26)',
    line: 'rgba(255,255,255,0.88)',
    ceiling: 0x9aa3c0,
    ceilingEmissive: 0x20263c,
    light: 0xfff6dd,
    crowd: [0xe94f4f, 0x3a6fe0, 0xf2c744, 0x4fc48a, 0xffffff, 0xff8a3c, 0x7b5cd6],
    crowdBrightness: 1,
  },
  night: {
    id: 'night',
    name: 'Noche',
    background: 0x050814,
    fog: 0x070a18,
    fogNear: 9000,
    fogFar: 24000,
    hemiSky: 0x6f86c9,
    hemiGround: 0x141a30,
    hemiIntensity: 0.9,
    sunColor: 0xb8c8ff,
    sunIntensity: 1.5,
    exposure: 1.1,
    envIntensity: 0.35,
    bloom: { strength: 0.55, radius: 0.6, threshold: 0.78 },
    wallBlue: 0x2a62d8,
    wallOrange: 0xe0661a,
    wallEmissive: 0x0e1630,
    wallOpacity: 0.5,
    floorA: '#14333f',
    floorB: '#112c38',
    floorTintBlue: 'rgba(60,120,255,0.3)',
    floorTintOrange: 'rgba(255,140,40,0.3)',
    line: 'rgba(170,230,255,0.95)',
    ceiling: 0x39415e,
    ceilingEmissive: 0x0a1026,
    light: 0xbfe0ff,
    crowd: [0xc9d6ff, 0xffe9a8, 0x9fd0ff, 0xffffff, 0xff9ec4],
    crowdBrightness: 0.7,
  },
  neon: {
    id: 'neon',
    name: 'Neón',
    background: 0x03020a,
    fog: 0x07041a,
    fogNear: 8000,
    fogFar: 22000,
    hemiSky: 0x7a4dff,
    hemiGround: 0x10081f,
    hemiIntensity: 0.8,
    sunColor: 0xff7de0,
    sunIntensity: 1.2,
    exposure: 1.15,
    envIntensity: 0.4,
    bloom: { strength: 0.95, radius: 0.7, threshold: 0.6 },
    wallBlue: 0x00d4ff,
    wallOrange: 0xff2fa6,
    wallEmissive: 0x12062c,
    wallOpacity: 0.45,
    floorA: '#120a2a',
    floorB: '#0d0620',
    floorTintBlue: 'rgba(0,200,255,0.3)',
    floorTintOrange: 'rgba(255,40,170,0.3)',
    line: 'rgba(120,255,240,1)',
    ceiling: 0x241a4a,
    ceilingEmissive: 0x120a30,
    light: 0xc07bff,
    crowd: [0x00e5ff, 0xff2fa6, 0x9d4dff, 0xffe600, 0x39ff88],
    crowdBrightness: 0.9,
  },
};
