// Ajustes de cámara por defecto (modificables desde Ajustes en fases posteriores).
export interface CameraSettings {
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
