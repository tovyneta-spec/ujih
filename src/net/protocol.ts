// Protocolo de red de Turbo Arena. Mensajes de control en JSON; entradas y snapshots en binario
// compacto (little-endian) para ocupar poco ancho de banda a 60 paquetes por segundo.
import type { BotLevel, GarageSettings } from '../config';
import type { MatchSnapshot, SimEvent } from '../sim';
import type { NetSetup } from './setup';

export const PROTOCOL_VERSION = 1;
/** Frecuencia de la simulación del servidor (igual que la local). */
export const SERVER_TICK_RATE = 120;
/** Un snapshot cada N ticks (120/2 = 60 Hz). */
export const SNAPSHOT_EVERY = 2;
/** Retardo de interpolación de los coches remotos (s). */
export const INTERP_DELAY = 0.08;
/** Máx. entradas por paquete y tamaño de la cola del servidor por jugador. */
export const MAX_INPUT_BATCH = 16;
export const MAX_QUEUE = 30;
/** Tiempo (ms) que se reserva el coche de un jugador desconectado antes de ceder definitivamente a un bot. */
export const RECONNECT_WINDOW_MS = 60_000;

export type Format = '1v1' | '2v2' | '3v3' | '4v4';

export interface PlayerInfo {
  id: number;
  name: string;
  team: 0 | 1;
  /** RTT (ms) comunicado por el cliente. */
  ping: number;
  isHost: boolean;
  connected: boolean;
}

export interface LobbyInfo {
  code: string;
  public: boolean;
  format: Format;
  botLevel: BotLevel;
  durationMinutes: number;
  hostId: number;
  state: 'lobby' | 'playing';
  perTeam: number;
  players: PlayerInfo[];
  /** Segundos que faltan para el inicio automático (salas de partida rápida). */
  autoStartIn: number | null;
}

// ------------------------------------------------------------------ cliente → servidor

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; look: Partial<GarageSettings>; token?: string }
  | { t: 'quick'; format: Format; level: BotLevel }
  | { t: 'create'; format: Format; level: BotLevel; durationMinutes: number }
  | { t: 'join'; code: string }
  | { t: 'team'; team: 0 | 1 }
  | { t: 'cfg'; format?: Format; level?: BotLevel; durationMinutes?: number }
  | { t: 'start' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; ts: number }
  | { t: 'rtt'; ms: number }
  | { t: 'chat'; idx: number };

// ------------------------------------------------------------------ servidor → cliente

export type ServerMsg =
  | { t: 'welcome'; v: number; id: number; token: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'start'; setup: NetSetup; me: number; tick: number; match: MatchSnapshot }
  | { t: 'events'; tick: number; events: SimEvent[] }
  | { t: 'match'; tick: number; info: MatchSnapshot }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'left'; reason: string };

export type ErrorCode =
  | 'version'
  | 'bad_message'
  | 'rate_limited'
  | 'room_not_found'
  | 'room_full'
  | 'in_progress'
  | 'not_host'
  | 'no_room'
  | 'server_full'
  | 'team_full'
  | 'bad_request';

// ------------------------------------------------------------------ tipos de paquete binario

export const PKT_INPUT = 1;
export const PKT_SNAPSHOT = 2;

// Los mensajes JSON se distinguen de los binarios por el tipo de dato de WebSocket (string vs binario).
export function isClientMsg(x: unknown): x is ClientMsg {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}
