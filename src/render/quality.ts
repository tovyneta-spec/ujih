// Calidad gráfica adaptativa. El juego arranca en el nivel adecuado a la GPU detectada y un
// gobernador ajusta la resolución de render (y, si hace falta, el nivel) para mantener 60 FPS.
// Sin pantalla de ajustes: todo es automático (con `?q=low|medium|high` para forzarlo en pruebas).

export type Tier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: Tier;
  /** Techo del pixel ratio (el del dispositivo se recorta a este valor antes de la escala dinámica). */
  maxPixelRatio: number;
  /** Tamaño del mapa de sombras (0 = sombras falsas con manchas). */
  shadows: 0 | 1024 | 2048;
  /** Sólo el coche del jugador y la pelota proyectan sombra, y se actualiza cada 2 frames. */
  shadowLite: boolean;
  bloom: boolean;
  /** Muestras MSAA del objetivo de post-proceso (0 = sin MSAA). */
  msaa: 0 | 4;
  /** Resolución relativa del bloom. */
  bloomScale: number;
  /** Gradas con público, pantallas y paredes semitransparentes. */
  crowd: boolean;
  /** Materiales Lambert (más baratos que los PBR). */
  lambert: boolean;
  /** Reflejos con mapa de entorno. */
  envMap: boolean;
  /** Multiplicador de la emisión de partículas. */
  particles: number;
  anisotropy: number;
  /** Detalle de la esfera de la pelota. */
  ballDetail: number;
  /** Ruedas fusionadas con la carrocería (sin giro ni dirección individual): menos llamadas de dibujo. */
  staticWheels: boolean;
}

export const TIERS: Record<Tier, Quality> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    shadows: 0,
    shadowLite: true,
    bloom: false,
    msaa: 0,
    bloomScale: 0.5,
    crowd: false,
    lambert: true,
    envMap: false,
    particles: 0.4,
    anisotropy: 1,
    ballDetail: 2,
    staticWheels: true,
  },
  medium: {
    tier: 'medium',
    maxPixelRatio: 1,
    shadows: 1024,
    shadowLite: true,
    bloom: true,
    msaa: 0,
    bloomScale: 0.4,
    crowd: true,
    lambert: true,
    envMap: false,
    particles: 0.7,
    anisotropy: 2,
    ballDetail: 3,
    staticWheels: false,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadows: 2048,
    shadowLite: false,
    bloom: true,
    msaa: 4,
    bloomScale: 0.5,
    crowd: true,
    lambert: false,
    envMap: true,
    particles: 1,
    anisotropy: 4,
    ballDetail: 4,
    staticWheels: false,
  },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];

/** Elige el nivel inicial a partir del nombre de la GPU (WEBGL_debug_renderer_info). */
export function tierForRenderer(renderer: string, touch = false): { start: Tier; max: Tier } {
  const r = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r)) {
    return { start: 'low', max: 'low' };
  }
  if (
    /nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d|apple m\d|apple gpu/.test(r) &&
    !touch
  ) {
    return { start: 'high', max: 'high' };
  }
  // GPU integradas y móviles: arranca en bajo y sólo sube a medio si sobra rendimiento.
  if (
    /intel|uhd|iris|hd graphics|vega|radeon\(tm\)|mali|adreno|powervr|apple|videocore|tegra/.test(
      r,
    ) ||
    touch
  ) {
    return { start: 'low', max: 'medium' };
  }
  return { start: 'medium', max: 'high' };
}

export const tierIndex = (t: Tier): number => ORDER.indexOf(t);
export const tierAt = (i: number): Tier => ORDER[Math.max(0, Math.min(ORDER.length - 1, i))];

export interface GovernorState {
  tier: Tier;
  scale: number;
}

/**
 * Gobernador de rendimiento. Recibe el tiempo de cada frame y decide si bajar/subir la escala de
 * resolución y el nivel. Es una clase pura (sin DOM) para poder probarla.
 */
export class PerformanceGovernor {
  static readonly MIN_SCALE = 0.5;
  tier: Tier;
  scale = 1;
  private readonly max: Tier;
  private times: number[] = [];
  private frames = 0;
  private sinceChange = 0;
  private slowFor = 0;
  private fastFor = 0;
  /** Segundos desde el arranque (el calentamiento se ignora). */
  private elapsed = 0;
  /** Último ajuste decidido (para registro/depuración). */
  lastChange = '';

  constructor(
    start: Tier,
    max: Tier,
    private readonly targetMs = 1000 / 60,
  ) {
    this.tier = start;
    this.max = max;
    // Las GPU débiles empiezan ya con una escala menor para no sufrir al arrancar.
    this.scale = start === 'low' ? 0.85 : 1;
  }

  /** Tiempo medio de frame (ms) de la ventana reciente. */
  get averageMs(): number {
    if (this.times.length === 0) return 0;
    let s = 0;
    for (const t of this.times) s += t;
    return s / this.times.length;
  }

  /**
   * Registra un frame de `ms` milisegundos. Devuelve un cambio de estado si procede
   * (`tierChanged` indica que hay que reconstruir efectos del nivel).
   */
  update(ms: number): { scaleChanged: boolean; tierChanged: boolean } {
    const res = { scaleChanged: false, tierChanged: false };
    const dt = ms / 1000;
    this.elapsed += dt;
    // Frames anómalos (pestaña en segundo plano, carga) no cuentan.
    if (ms > 250 || ms <= 0) return res;
    this.times.push(ms);
    if (this.times.length > 40) this.times.shift();
    this.frames++;
    this.sinceChange += dt;
    if (this.elapsed < 2.5 || this.times.length < 20 || this.sinceChange < 1.5) return res;

    const avg = this.averageMs;
    if (avg > this.targetMs * 1.15) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (avg < this.targetMs * 0.72) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }

    if (this.slowFor > 1) {
      this.slowFor = 0;
      if (this.scale > PerformanceGovernor.MIN_SCALE + 1e-6) {
        this.scale = Math.max(PerformanceGovernor.MIN_SCALE, +(this.scale - 0.1).toFixed(2));
        res.scaleChanged = true;
        this.lastChange = `escala ↓ ${this.scale}`;
      } else if (this.tier !== 'low') {
        this.tier = tierAt(tierIndex(this.tier) - 1);
        this.scale = 0.8;
        res.tierChanged = res.scaleChanged = true;
        this.lastChange = `nivel ↓ ${this.tier}`;
      } else return res;
      this.sinceChange = 0;
      this.times.length = 0;
    } else if (this.fastFor > 4) {
      this.fastFor = 0;
      if (this.scale < 1 - 1e-6) {
        this.scale = Math.min(1, +(this.scale + 0.1).toFixed(2));
        res.scaleChanged = true;
        this.lastChange = `escala ↑ ${this.scale}`;
      } else if (
        tierIndex(this.tier) < tierIndex(this.max) &&
        this.fastFor === 0 &&
        avg < this.targetMs * 0.5
      ) {
        this.tier = tierAt(tierIndex(this.tier) + 1);
        this.scale = 0.9;
        res.tierChanged = res.scaleChanged = true;
        this.lastChange = `nivel ↑ ${this.tier}`;
      } else return res;
      this.sinceChange = 0;
      this.times.length = 0;
    }
    return res;
  }

  get state(): GovernorState {
    return { tier: this.tier, scale: this.scale };
  }
}
