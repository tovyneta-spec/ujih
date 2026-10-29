// Persistencia de los volúmenes de audio.
export interface AudioSettings {
  master: number;
  sfx: number;
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, sfx: 0.9 };

const KEY = 'turbo-arena:audio';

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function sanitizeAudio(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_AUDIO;
  return {
    master: unit(r.master, d.master),
    sfx: unit(r.sfx, d.sfx),
  };
}

export function loadAudio(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeAudio(JSON.parse(raw));
  } catch {
    /* sin almacenamiento */
  }
  return { ...DEFAULT_AUDIO };
}

export function saveAudio(a: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* sin almacenamiento */
  }
}
