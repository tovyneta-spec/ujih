// Ajustes de cámara por defecto (modificables desde Ajustes en fases posteriores).
/** Cuándo mira la cámara hacia la pelota. */
export type BallCamMode = 'always' | 'hold' | 'auto' | 'never';

export const BALLCAM_MODES: Record<BallCamMode, { name: string; description: string }> = {
  always: { name: 'Siempre', description: 'Cámara de pelota activa; C la alterna.' },
  hold: {
    name: 'Con tecla',
    description: 'Cámara de coche; mantén C para mirar a la pelota.',
  },
  auto: {
    name: 'Automática',
    description: 'Mira a la pelota solo cuando está cerca y delante de ti.',
  },
  never: { name: 'Nunca', description: 'Cámara de coche siempre.' },
};

export interface CameraSettings {
  ballCamMode: BallCamMode;
  fov: number;
  distance: number;
  height: number;
  /** Ángulo de cabeceo en grados (negativo = mira hacia abajo). */
  angle: number;
  stiffness: number;
  swivelSpeed: number;
  transitionSpeed: number;
  shake: boolean;
}

export const DEFAULT_CAMERA: CameraSettings = {
  ballCamMode: 'hold',
  fov: 110,
  distance: 270,
  height: 100,
  angle: -3,
  stiffness: 0.45,
  swivelSpeed: 4.7,
  transitionSpeed: 1.2,
  shake: true,
};

/** Rangos permitidos (mínimo, máximo, paso) para cada ajuste numérico de la cámara. */
export const CAMERA_LIMITS = {
  fov: { min: 60, max: 120, step: 1, label: 'Campo de visión' },
  distance: { min: 150, max: 400, step: 5, label: 'Distancia' },
  height: { min: 40, max: 200, step: 5, label: 'Altura' },
  angle: { min: -15, max: 10, step: 1, label: 'Ángulo' },
  stiffness: { min: 0, max: 1, step: 0.05, label: 'Rigidez' },
  swivelSpeed: { min: 1, max: 10, step: 0.1, label: 'Velocidad de giro' },
  transitionSpeed: { min: 0.5, max: 2, step: 0.1, label: 'Velocidad de transición' },
} as const;
