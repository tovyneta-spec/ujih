// Apariencia de los coches: la del jugador sale del garaje; la de los bots, de su equipo.
import { Color } from 'three';
import { ANTENNAS, BODY_IDS, DECALS, TRAILS, WHEEL_STYLES } from '../config';
import type {
  AntennaStyle,
  CarBodyId,
  DecalStyle,
  GarageSettings,
  TrailStyle,
  WheelStyle,
} from '../config';
import { TEAM_COLORS } from './arenaMesh';
import type { CarLook } from './carMesh';

const teamColor = (team: 0 | 1): Color =>
  (team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.orange).clone();

/** Look del jugador: colores del garaje; el color de equipo se conserva en barra y brillo. */
export function playerLook(g: GarageSettings, team: 0 | 1): CarLook {
  return {
    primary: new Color(g.primary),
    secondary: new Color(g.secondary),
    team: teamColor(team),
    wheels: g.wheels,
    trail: g.trail,
    antenna: g.antenna,
    decal: g.decal,
    decalColor: new Color(g.decalColor),
  };
}

const pick = <T extends string>(obj: Record<string, unknown>, i: number): T =>
  Object.keys(obj)[i % Object.keys(obj).length] as T;

/** Look determinista de un bot: colores de su equipo y variedad de ruedas, estela y calcomanía. */
export function botLook(carId: number, team: 0 | 1): CarLook {
  const tc = teamColor(team);
  return {
    primary: tc.clone().multiplyScalar(0.9),
    secondary: new Color(team === 0 ? 0x10244f : 0x4a2208),
    team: tc,
    wheels: pick<WheelStyle>(WHEEL_STYLES, carId * 3 + 1),
    trail: pick<TrailStyle>(TRAILS, carId * 2 + team),
    antenna: pick<AntennaStyle>(ANTENNAS, carId + 2),
    decal: pick<DecalStyle>(DECALS, carId + 1),
    decalColor: new Color(0xf4f6ff),
  };
}

/** Carrocería determinista de un bot. */
export function botBody(carId: number): CarBodyId {
  return BODY_IDS[(carId * 5 + 3) % BODY_IDS.length];
}
