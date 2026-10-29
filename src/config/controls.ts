// Asignación de teclas por defecto (códigos KeyboardEvent.code). Reasignable desde Ajustes (F4).
export type Action =
  | 'throttleUp'
  | 'throttleDown'
  | 'steerLeft'
  | 'steerRight'
  | 'jump'
  | 'boost'
  | 'handbrake'
  | 'rollLeft'
  | 'rollRight'
  | 'ballCam'
  | 'lookBack'
  | 'scoreboard'
  | 'reset'
  | 'pause'
  | 'debug';

export const DEFAULT_KEYS: Record<Action, readonly string[]> = {
  throttleUp: ['KeyW', 'ArrowUp'],
  throttleDown: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['ControlLeft', 'KeyZ'],
  rollLeft: ['KeyQ'],
  rollRight: ['KeyE'],
  ballCam: ['KeyC'],
  lookBack: ['KeyV'],
  scoreboard: ['Tab'],
  reset: ['KeyR'],
  pause: ['Escape'],
  debug: ['F3'],
};

/** Rampa del teclado digital (unidades de eje por segundo). */
export const KEYBOARD_RAMP = { rise: 9, fall: 14 } as const;
