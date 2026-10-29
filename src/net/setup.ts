// Configuración de una partida online: la construye el servidor y la reciben los clientes para crear
// una réplica idéntica de la simulación (mismos coches, carrocerías y mutadores).
import {
  ANTENNAS,
  BODY_IDS,
  CAR_BODIES,
  DECALS,
  DEFAULT_GARAGE,
  EXPLOSIONS,
  TRAILS,
  WHEEL_STYLES,
  resolveMutators,
} from '../config';
import type { BotLevel, CarBodyId, GarageSettings, Mutators, ResolvedMutators } from '../config';
import { World } from '../sim';

export interface NetCarSetup {
  id: number;
  team: 0 | 1;
  body: CarBodyId;
  name: string;
  /** Controlado por un bot del servidor. */
  bot: boolean;
  /** Apariencia (ya validada por el servidor). */
  look: GarageSettings;
}

export interface NetSetup {
  seed: number;
  mutators: ResolvedMutators;
  botLevel: BotLevel;
  cars: NetCarSetup[];
}

/** Mutadores de una sala online: sin repetición (la simulación no se congela para los clientes). */
export function onlineMutators(m: Mutators): ResolvedMutators {
  const r = resolveMutators(m);
  r.match = { ...r.match, replayTime: 0 };
  return r;
}

/** Crea el mundo de una partida (sin iniciar las reglas: eso lo hace el servidor / llega por red). */
export function buildNetWorld(setup: NetSetup): World {
  const world = new World(setup.seed);
  for (const c of setup.cars) {
    if (!(c.body in CAR_BODIES)) throw new Error(`carrocería desconocida: ${c.body}`);
    world.addCar(c.team, c.body);
  }
  world.applyMutators(setup.mutators);
  return world;
}

const nth = <T extends string>(obj: Record<string, unknown>, i: number): T =>
  Object.keys(obj)[i % Object.keys(obj).length] as T;

/** Carrocería determinista de un bot (la misma regla que en el juego local). */
export function botBodyFor(carId: number): CarBodyId {
  return BODY_IDS[(carId * 5 + 3) % BODY_IDS.length];
}

/** Aspecto determinista de un bot: colores de su equipo y variedad en ruedas, estela y calcomanía. */
export function botGarage(carId: number, team: 0 | 1, name: string): GarageSettings {
  return {
    ...DEFAULT_GARAGE,
    name,
    body: botBodyFor(carId),
    primary: team === 0 ? '#2a6fe6' : '#e66f1c',
    secondary: team === 0 ? '#10244f' : '#4a2208',
    wheels: nth(WHEEL_STYLES, carId * 3 + 1),
    trail: nth(TRAILS, carId * 2 + team),
    antenna: nth(ANTENNAS, carId + 2),
    decal: nth(DECALS, carId + 1),
    decalColor: '#f4f6ff',
    explosion: nth(EXPLOSIONS, carId + team),
  };
}
