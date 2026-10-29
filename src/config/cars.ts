// Carrocerías: hitbox (largo × ancho × alto, uu) y desplazamiento del centro visual respecto a la hitbox.

export type CarBodyId = 'octane' | 'dominus' | 'plank' | 'breakout' | 'hybrid' | 'merc';

export interface CarBodySpec {
  id: CarBodyId;
  name: string;
  /** Largo (x), ancho (y), alto (z) de la hitbox. */
  length: number;
  width: number;
  height: number;
  /** Desplazamiento del modelo visual respecto al centro de la hitbox (espacio local). */
  visualOffset: { x: number; y: number; z: number };
  /** Parámetros del modelo procedural. */
  model: {
    /** Fracción del largo donde acaba el capó y empieza la cabina. */
    cabinStart: number;
    cabinEnd: number;
    /** Fracción de la altura que ocupa el chasis bajo la cabina. */
    cabinHeight: number;
    wheelRadius: number;
    wheelWidth: number;
  };
}

export const CAR_BODIES: Record<CarBodyId, CarBodySpec> = {
  octane: spec('octane', 'Cometa', 118, 84.2, 36.2, 13.9, 0.3, 0.7, 0.42, 14, 14),
  dominus: spec('dominus', 'Dominador', 127.9, 83.3, 31.3, 15.7, 0.34, 0.66, 0.36, 14, 14),
  plank: spec('plank', 'Tablón', 128.8, 84.7, 29.4, 12.1, 0.38, 0.62, 0.32, 14, 14),
  breakout: spec('breakout', 'Estallido', 131.5, 80.5, 30.3, 12.5, 0.32, 0.6, 0.34, 14, 14),
  hybrid: spec('hybrid', 'Híbrido', 127, 82.2, 34.2, 9.0, 0.3, 0.68, 0.4, 14, 14),
  merc: spec('merc', 'Mercenario', 120.7, 76.7, 41.7, 11.5, 0.2, 0.9, 0.5, 15, 15),
};

function spec(
  id: CarBodyId,
  name: string,
  length: number,
  width: number,
  height: number,
  visualX: number,
  cabinStart: number,
  cabinEnd: number,
  cabinHeight: number,
  wheelRadius: number,
  wheelWidth: number,
): CarBodySpec {
  return {
    id,
    name,
    length,
    width,
    height,
    visualOffset: { x: visualX, y: 0, z: 0 },
    model: { cabinStart, cabinEnd, cabinHeight, wheelRadius, wheelWidth },
  };
}
