// Utilidades de validación y límites de tasa (sin dependencias: se usan en servidor y en tests).

/** Cubeta de fichas: permite ráfagas de `capacity` mensajes y `rate` por segundo sostenidos. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly rate: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.last = this.now();
  }
  /** Intenta consumir `cost` fichas; false si se ha superado el límite. */
  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Alfabeto de los códigos de sala (sin caracteres confusos como 0/O o 1/I). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function isValidCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    code.length === CODE_LENGTH &&
    [...code].every((c) => CODE_ALPHABET.includes(c))
  );
}

export function generateCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++)
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

/** Nombre visible: sin caracteres de control ni HTML, máx. 16 caracteres. */
export function sanitizeName(raw: unknown, fallback = 'Jugador'): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return clean || fallback;
}

/** Acota un número a un rango; los valores no numéricos dan 0. */
export function clampNum(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n < lo ? lo : n > hi ? hi : n;
}
