// Partida personalizada: mutadores configurables y su traducción a valores numéricos.
import { BALL } from './physics';
import { DEFAULT_MATCH_CONFIG } from './match';
import type { DemolitionMode, MatchConfig } from './match';
import type { BotLevel } from './bots';

export type Format = '1v1' | '2v2' | '3v3';
export type BoostMode = 'normal' | 'none' | 'unlimited' | 'recharge';
export type GameSpeed = 'normal' | 'slow' | 'fast';
export type Level4 = 'default' | 'low' | 'high' | 'super';
export type BallSize = 'default' | 'small' | 'large' | 'giant';
export type BallWeight = 'default' | 'light' | 'heavy' | 'superLight';
export type BallMaxSpeed = 'default' | 'slow' | 'fast' | 'super';
export type Gravity = 'low' | 'normal' | 'high';
export type Theme = 'day' | 'night' | 'neon';

export interface Mutators {
  format: Format;
  /** Minutos (0 = ilimitada). */
  durationMinutes: 0 | 3 | 5 | 10 | 20;
  maxGoals: number;
  overtime: boolean;
  /** Serie: 0 = partido único, o al mejor de 3/5/7. */
  series: 0 | 3 | 5 | 7;
  gameSpeed: GameSpeed;
  ballMaxSpeed: BallMaxSpeed;
  ballSize: BallSize;
  ballBounce: Level4;
  ballWeight: BallWeight;
  boostAmount: BoostMode;
  boostStrength: 1 | 1.5 | 2 | 10;
  gravity: Gravity;
  demolition: DemolitionMode;
  respawnTime: number;
  theme: Theme;
  botLevel: BotLevel;
}

export const DEFAULT_MUTATORS: Mutators = {
  format: '1v1',
  durationMinutes: 5,
  maxGoals: 0,
  overtime: true,
  series: 0,
  gameSpeed: 'normal',
  ballMaxSpeed: 'default',
  ballSize: 'default',
  ballBounce: 'default',
  ballWeight: 'default',
  boostAmount: 'normal',
  boostStrength: 1,
  gravity: 'normal',
  demolition: 'normal',
  respawnTime: 3,
  theme: 'day',
  botLevel: 'pro',
};

export interface ResolvedMutators {
  perTeam: number;
  match: MatchConfig;
  /** Escala del tiempo del juego (bucle). */
  timeScale: number;
  ball: { radius: number; mass: number; restitution: number; maxSpeed: number };
  gravityScale: number;
  boostMode: BoostMode;
  boostStrength: number;
  botLevel: BotLevel;
  theme: Theme;
}

const BALL_SIZE: Record<BallSize, number> = { default: 1, small: 0.65, large: 1.5, giant: 2.2 };
const BALL_BOUNCE: Record<Level4, number> = { default: 1, low: 0.5, high: 1.5, super: 1.9 };
const BALL_WEIGHT: Record<BallWeight, number> = {
  default: 1,
  light: 0.5,
  heavy: 2,
  superLight: 0.25,
};
const BALL_SPEED: Record<BallMaxSpeed, number> = {
  default: 6000,
  slow: 3000,
  fast: 9000,
  super: 12000,
};
const GRAVITY: Record<Gravity, number> = { low: 0.5, normal: 1, high: 2 };
const SPEED: Record<GameSpeed, number> = { normal: 1, slow: 0.5, fast: 1.5 };

export function resolveMutators(m: Mutators): ResolvedMutators {
  return {
    perTeam: Number(m.format[0]),
    match: {
      ...DEFAULT_MATCH_CONFIG,
      duration: m.durationMinutes * 60,
      maxGoals: m.maxGoals,
      overtime: m.overtime,
      demolition: m.demolition,
      respawnTime: m.respawnTime,
    },
    timeScale: SPEED[m.gameSpeed],
    ball: {
      radius: BALL.radius * BALL_SIZE[m.ballSize],
      mass: BALL.mass * BALL_WEIGHT[m.ballWeight],
      restitution: BALL.restitution * BALL_BOUNCE[m.ballBounce],
      maxSpeed: BALL_SPEED[m.ballMaxSpeed],
    },
    gravityScale: GRAVITY[m.gravity],
    boostMode: m.boostAmount,
    boostStrength: m.boostStrength,
    botLevel: m.botLevel,
    theme: m.theme,
  };
}
