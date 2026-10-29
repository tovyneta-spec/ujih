// Ayudas para elegir la dirección lateral del flip (función pura, probada aparte).

export interface FlipOptions {
  /** Esquema de ratón activo. */
  mouse: boolean;
  /** Con ratón: el volante no cuenta; la dirección lateral sale sólo de Q/E. */
  ignoreMouse: boolean;
  /** Flip recto: con avance/retroceso claro y poca entrada lateral, el flip sale sin diagonal. */
  assist: boolean;
}

/** Umbral de entrada lateral por debajo del cual el flip asistido sale recto. */
export const FLIP_SIDE_THRESHOLD = 0.7;

/**
 * Devuelve la entrada lateral (guiñada) que se usará al decidir el flip.
 * @param fwd avance (+1) / retroceso (−1); @param side lateral del esquema activo (teclas A/D o volante);
 * @param roll Q/E (−1..1)
 */
export function flipSide(fwd: number, side: number, roll: number, o: FlipOptions): number {
  let yaw = o.mouse && o.ignoreMouse ? roll : side;
  if (o.assist && Math.abs(fwd) > 0.5 && Math.abs(yaw) < FLIP_SIDE_THRESHOLD) yaw = 0;
  return yaw;
}
