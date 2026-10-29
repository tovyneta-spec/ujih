// Asignación de teclas por defecto (códigos KeyboardEvent.code), esquemas de control y reasignación.
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
  | 'debug'
  | 'chat1'
  | 'chat2'
  | 'chat3'
  | 'chat4';

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
  chat1: ['Digit1'],
  chat2: ['Digit2'],
  chat3: ['Digit3'],
  chat4: ['Digit4'],
};

/** Mensajes del chat rápido (teclas 1–4). */
export const QUICK_CHAT = ['¡La tengo!', '¡Defendiendo!', '¡Buen tiro!', '¡Gracias!'] as const;

/** Rampa del teclado digital (unidades de eje por segundo). */
export const KEYBOARD_RAMP = { rise: 9, fall: 14 } as const;

/** Esquema de control: teclado clásico o ratón (nombre propio «67tetitasdani»). */
export type ControlScheme = 'keyboard' | 'mouse';

export const SCHEMES: Record<ControlScheme, { name: string; description: string }> = {
  keyboard: {
    name: 'Teclado',
    description: 'WASD para conducir, Espacio salta, Shift turbo.',
  },
  mouse: {
    name: '67tetitasdani',
    description:
      'W acelera, S frena y marcha atrás; mueve el ratón a izquierda/derecha para girar (el volante se recentra solo); clic izquierdo = turbo; clic derecho = salto.',
  },
};

/** Acciones que el jugador puede reasignar a otra tecla (esquema de teclado). */
export const REMAPPABLE: readonly { action: Action; label: string }[] = [
  { action: 'throttleUp', label: 'Acelerar' },
  { action: 'throttleDown', label: 'Frenar / marcha atrás' },
  { action: 'steerLeft', label: 'Girar a la izquierda' },
  { action: 'steerRight', label: 'Girar a la derecha' },
  { action: 'jump', label: 'Saltar' },
  { action: 'boost', label: 'Turbo' },
  { action: 'handbrake', label: 'Derrape' },
  { action: 'rollLeft', label: 'Alabeo izquierda' },
  { action: 'rollRight', label: 'Alabeo derecha' },
  { action: 'ballCam', label: 'Cámara de pelota' },
  { action: 'lookBack', label: 'Mirar atrás' },
  { action: 'scoreboard', label: 'Marcador' },
  { action: 'reset', label: 'Reiniciar' },
];

export interface ControlSettings {
  scheme: ControlScheme;
  /** Teclas personalizadas (una por acción) que sustituyen a las de por defecto. */
  keys: Partial<Record<Action, string>>;
  /** Sensibilidad del ratón (0,5–2) en el esquema de ratón. */
  mouseSensitivity: number;
  /** Flip recto: con entrada de avance/retroceso y poca lateral, el flip sale sin diagonal ni croqueta. */
  flipAssist: boolean;
  /** Esquema de ratón: el volante no decide la dirección del flip (sólo W/S y Q/E). */
  flipIgnoreMouse: boolean;
}

export const DEFAULT_CONTROLS: ControlSettings = {
  scheme: 'keyboard',
  keys: {},
  mouseSensitivity: 1,
  flipAssist: true,
  flipIgnoreMouse: true,
};

/** Teclas efectivas de cada acción según el esquema y las personalizaciones. */
export function effectiveBindings(c: ControlSettings): Record<Action, readonly string[]> {
  const out = { ...DEFAULT_KEYS } as Record<Action, readonly string[]>;
  if (c.scheme === 'mouse') {
    // Dirección, salto y turbo pasan al ratón: se liberan A/D, flechas, Espacio y Shift.
    out.steerLeft = [];
    out.steerRight = [];
    out.jump = [];
    out.boost = [];
    return out;
  }
  for (const [action, code] of Object.entries(c.keys) as [Action, string][]) {
    out[action] = code ? [code] : [];
  }
  return out;
}

/** Nombre legible de un código de tecla. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Espacio',
    ShiftLeft: 'Shift izq.',
    ShiftRight: 'Shift der.',
    ControlLeft: 'Ctrl izq.',
    ControlRight: 'Ctrl der.',
    AltLeft: 'Alt izq.',
    AltRight: 'Alt der.',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Tab: 'Tab',
    Enter: 'Intro',
    Backspace: 'Retroceso',
  };
  return names[code] ?? code;
}
