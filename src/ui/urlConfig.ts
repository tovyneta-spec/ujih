// Lectura de la configuración de partida desde la URL (hasta que existan los menús de F4).
import { DEFAULT_MUTATORS } from '../config';
import type { BotLevel, Mutators } from '../config';

export interface GameSetup {
  mode: 'practice' | 'match';
  mutators: Mutators;
  /** Equipo del jugador humano. */
  humanTeam: 0 | 1;
}

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function num<T extends number>(v: string | null, allowed: readonly T[], fallback: T): T {
  const n = v === null ? NaN : Number(v);
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback;
}

export function parseSetup(search: string): GameSetup {
  const q = new URLSearchParams(search);
  const legacy = q.get('mode') ?? 'practice';
  const isMatch = legacy.startsWith('match');
  const legacyFormat = legacy === 'match3' ? '3v3' : legacy === 'match2' ? '2v2' : '1v1';
  const d = DEFAULT_MUTATORS;
  const mutators: Mutators = {
    format: pick(q.get('format'), ['1v1', '2v2', '3v3'], legacyFormat),
    durationMinutes: num(q.get('duration'), [0, 3, 5, 10, 20], d.durationMinutes),
    maxGoals: Math.max(0, Math.floor(Number(q.get('goals') ?? d.maxGoals)) || 0),
    overtime: q.get('overtime') !== '0',
    series: num(q.get('series'), [0, 3, 5, 7], d.series),
    gameSpeed: pick(q.get('speed'), ['normal', 'slow', 'fast'], d.gameSpeed),
    ballMaxSpeed: pick(q.get('ballspeed'), ['default', 'slow', 'fast', 'super'], d.ballMaxSpeed),
    ballSize: pick(q.get('ballsize'), ['default', 'small', 'large', 'giant'], d.ballSize),
    ballBounce: pick(q.get('bounce'), ['default', 'low', 'high', 'super'], d.ballBounce),
    ballWeight: pick(q.get('weight'), ['default', 'light', 'heavy', 'superLight'], d.ballWeight),
    boostAmount: pick(q.get('boost'), ['normal', 'none', 'unlimited', 'recharge'], d.boostAmount),
    boostStrength: num(q.get('boostpower'), [1, 1.5, 2, 10], d.boostStrength),
    gravity: pick(q.get('gravity'), ['low', 'normal', 'high'], d.gravity),
    demolition: pick(q.get('demo'), ['normal', 'off', 'friendly', 'contact'], d.demolition),
    respawnTime: Math.min(
      10,
      Math.max(0, Number(q.get('respawn') ?? d.respawnTime) || d.respawnTime),
    ),
    theme: pick(q.get('theme'), ['day', 'night', 'neon'], d.theme),
    botLevel: pick<BotLevel>(q.get('bots'), ['rookie', 'pro', 'legend'], d.botLevel),
  };
  return {
    mode: isMatch ? 'match' : 'practice',
    mutators,
    humanTeam: q.get('team') === 'orange' ? 1 : 0,
  };
}
