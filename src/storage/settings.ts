// Persistencia de los ajustes de cámara y de controles.
import { CAMERA_LIMITS, DEFAULT_CAMERA, DEFAULT_CONTROLS, REMAPPABLE } from '../config';
import type { Action, CameraSettings, ControlScheme, ControlSettings } from '../config';

export interface PlayerSettings {
  camera: CameraSettings;
  controls: ControlSettings;
}

const KEY = 'turbo-arena:settings';

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function defaultSettings(): PlayerSettings {
  return {
    camera: { ...DEFAULT_CAMERA },
    controls: { ...DEFAULT_CONTROLS, keys: {} },
  };
}

export function sanitizeSettings(raw: unknown): PlayerSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rc = (r.camera && typeof r.camera === 'object' ? r.camera : {}) as Record<string, unknown>;
  const rk = (r.controls && typeof r.controls === 'object' ? r.controls : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_CAMERA;
  const L = CAMERA_LIMITS;
  const camera: CameraSettings = {
    fov: num(rc.fov, L.fov.min, L.fov.max, d.fov),
    distance: num(rc.distance, L.distance.min, L.distance.max, d.distance),
    height: num(rc.height, L.height.min, L.height.max, d.height),
    angle: num(rc.angle, L.angle.min, L.angle.max, d.angle),
    stiffness: num(rc.stiffness, L.stiffness.min, L.stiffness.max, d.stiffness),
    swivelSpeed: num(rc.swivelSpeed, L.swivelSpeed.min, L.swivelSpeed.max, d.swivelSpeed),
    transitionSpeed: num(
      rc.transitionSpeed,
      L.transitionSpeed.min,
      L.transitionSpeed.max,
      d.transitionSpeed,
    ),
    shake: typeof rc.shake === 'boolean' ? rc.shake : d.shake,
  };
  const scheme: ControlScheme = rk.scheme === 'mouse' ? 'mouse' : 'keyboard';
  const keys: Partial<Record<Action, string>> = {};
  const rkeys = (rk.keys && typeof rk.keys === 'object' ? rk.keys : {}) as Record<string, unknown>;
  for (const { action } of REMAPPABLE) {
    const v = rkeys[action];
    if (typeof v === 'string' && /^[A-Za-z0-9]{0,20}$/.test(v)) keys[action] = v;
  }
  return {
    camera,
    controls: { scheme, keys, mouseSensitivity: num(rk.mouseSensitivity, 0.5, 2, 1) },
  };
}

export function loadSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    /* sin almacenamiento */
  }
  return defaultSettings();
}

export function saveSettings(s: PlayerSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}
