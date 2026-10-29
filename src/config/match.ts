// Reglas de partida (Soccar) y puntuación. Todo configurable.

export type DemolitionMode = 'normal' | 'off' | 'friendly' | 'contact';

export interface MatchConfig {
  /** Duración en segundos (0 = ilimitada). */
  duration: number;
  /** Prórroga con gol de oro si hay empate. */
  overtime: boolean;
  /** Goles máximos para ganar (0 = sin límite). */
  maxGoals: number;
  demolition: DemolitionMode;
  /** Tiempo de reaparición tras una demolición (s). */
  respawnTime: number;
  /** Duración de la repetición tras un gol (s). 0 = sin repetición (F4 la activa). */
  replayTime: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  duration: 300,
  overtime: true,
  maxGoals: 0,
  demolition: 'normal',
  respawnTime: 3,
  replayTime: 0,
};

export const MATCH = {
  /** Cuenta atrás del saque (3-2-1). */
  countdown: 3,
  /** Juego libre tras un gol antes de la repetición / reinicio (s). */
  goalCelebration: 2.5,
  /** Ventana (s) para considerar asistencia el toque previo de un compañero. */
  assistWindow: 5,
  /** Vida (s) de un tiro a puerta pendiente para poder ser parado. */
  shotLifetime: 4,
  /** Tiempo mínimo (s) entre tiros contados del mismo coche. */
  shotCooldown: 3,
  /** Parada épica: velocidad mínima del tiro (uu/s) y distancia máx. a la portería (uu). */
  epicSaveSpeed: 2200,
  epicSaveDistance: 1400,
  /** Velocidad mínima de la pelota para contar un tiro (uu/s). */
  shotMinSpeed: 800,
  points: { goal: 100, assist: 50, save: 50, epicSave: 75, shot: 20, demo: 25 },
} as const;
