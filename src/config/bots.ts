// Perfiles de los bots. Los tres niveles usan los mismos controles y la misma física que el jugador:
// sólo cambian el tiempo de reacción, la precisión, la agresividad y las mecánicas que dominan.

export type BotLevel = 'rookie' | 'pro' | 'legend';

export interface BotProfile {
  name: string;
  /** Intervalo entre decisiones (s): tiempo de reacción. */
  reaction: number;
  /** Error de puntería (uu) añadido al punto objetivo. */
  aimNoise: number;
  /** Fracción de la velocidad máxima que se atreve a usar. */
  speedFactor: number;
  /** Probabilidad de usar turbo cuando conviene (0..1). */
  boostUse: number;
  /** Usa flips para golpear. */
  flips: boolean;
  /** Altura máxima (uu) de la pelota que intenta alcanzar en el aire (0 = sin aéreos). */
  aerialMaxHeight: number;
  /** Usa doble salto en aéreos. */
  aerialDoubleJump: boolean;
  /** Probabilidad por segundo de intentar una demolición oportunista. */
  demoRate: number;
  /** Rota de rol con los compañeros (1.º/2.º/3.er hombre). */
  rotates: boolean;
  /** Probabilidad de pasar a un compañero mejor situado. */
  passChance: number;
  /** Recoge turbo de forma activa cuando le queda poco. */
  managesBoost: boolean;
  /** Se recupera en el aire y aterriza sobre las ruedas. */
  airRecovery: boolean;
  /** Se atreve a conducir por paredes y techo. */
  wallPlay: boolean;
}

export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  rookie: {
    name: 'Novato',
    reaction: 0.32,
    aimNoise: 380,
    speedFactor: 0.7,
    boostUse: 0.35,
    flips: false,
    aerialMaxHeight: 0,
    aerialDoubleJump: false,
    demoRate: 0,
    rotates: false,
    passChance: 0,
    managesBoost: false,
    airRecovery: true,
    wallPlay: false,
  },
  pro: {
    name: 'Pro',
    reaction: 0.12,
    aimNoise: 130,
    speedFactor: 0.95,
    boostUse: 0.8,
    flips: true,
    aerialMaxHeight: 800,
    aerialDoubleJump: false,
    demoRate: 0,
    rotates: true,
    passChance: 0.25,
    managesBoost: true,
    airRecovery: true,
    wallPlay: false,
  },
  legend: {
    name: 'Leyenda',
    reaction: 0.04,
    aimNoise: 30,
    speedFactor: 1,
    boostUse: 1,
    flips: true,
    aerialMaxHeight: 1600,
    aerialDoubleJump: true,
    demoRate: 0.06,
    rotates: true,
    passChance: 0.5,
    managesBoost: true,
    airRecovery: true,
    wallPlay: false,
  },
};
