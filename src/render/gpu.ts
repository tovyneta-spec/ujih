// Detección de la GPU y elección del nivel de calidad inicial (usa un canvas desechable).
import { tierForRenderer } from './quality';
import type { Tier } from './quality';

export interface GpuProfile {
  renderer: string;
  start: Tier;
  max: Tier;
  touch: boolean;
}

/** Nombre de la GPU (WEBGL_debug_renderer_info) o cadena vacía si no está disponible. */
export function gpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/**
 * Perfil de la máquina: `?q=low|medium|high` lo fuerza (pruebas); si no, se decide por la GPU.
 * Con pocos núcleos de CPU se baja un nivel el techo.
 */
export function detectProfile(search: string): GpuProfile {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const renderer = gpuName();
  const q = new URLSearchParams(search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return { renderer, start: q, max: q, touch };
  const base = tierForRenderer(renderer, touch);
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 2 && base.max !== 'low') return { renderer, start: 'low', max: 'low', touch };
  return { renderer, ...base, touch };
}
