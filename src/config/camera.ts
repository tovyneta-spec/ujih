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
