// Estructura única de entrada de un coche: la producen por igual teclado, mando, táctil, bots y red.
export interface CarInput {
  /** -1 (marcha atrás/freno) … 1 (acelerar). */
  throttle: number;
  /** -1 (izquierda) … 1 (derecha). */
  steer: number;
  /** -1 (morro abajo) … 1 (morro arriba). */
  pitch: number;
  /** -1 (izquierda) … 1 (derecha). */
  yaw: number;
  /** -1 (alabeo izquierda) … 1 (alabeo derecha). */
  roll: number;
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
}

export function neutralInput(): CarInput {
  return {
    throttle: 0,
    steer: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    jump: false,
    boost: false,
    handbrake: false,
  };
}

export function copyInput(src: CarInput, dst: CarInput): void {
  dst.throttle = src.throttle;
  dst.steer = src.steer;
  dst.pitch = src.pitch;
  dst.yaw = src.yaw;
  dst.roll = src.roll;
  dst.jump = src.jump;
  dst.boost = src.boost;
  dst.handbrake = src.handbrake;
}

/** Restablece una entrada a neutra sin crear objetos nuevos. */
export function resetInput(i: CarInput): void {
  i.throttle = 0;
  i.steer = 0;
  i.pitch = 0;
  i.yaw = 0;
  i.roll = 0;
  i.jump = false;
  i.boost = false;
  i.handbrake = false;
}
