// Sistema de partículas con pool fijo (cero asignaciones por frame) dibujado con un único Points.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    float a = smoothstep(1.0, 0.25, r) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

export interface ParticleOptions {
  /** Número máximo de partículas vivas. */
  capacity: number;
  additive: boolean;
}

/** Parámetros de emisión de una partícula. */
export interface Emit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  /** Cambio de tamaño por segundo (puede ser negativo). */
  grow?: number;
  life: number;
  color: Color;
  /** Color final (se interpola); por defecto el mismo. */
  endColor?: Color;
  alpha?: number;
  /** Gravedad en z (uu/s², negativa = cae). */
  gravity?: number;
  /** Fricción del aire (1/s). */
  drag?: number;
}

export class ParticleSystem {
  readonly points: Points;
  readonly capacity: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private startCol: Float32Array;
  private endCol: Float32Array;
  private baseAlpha: Float32Array;
  private geo: BufferGeometry;
  private material: ShaderMaterial;
  /** Siguiente hueco a reutilizar (búfer circular: la partícula más antigua se sobrescribe). */
  private cursor = 0;
  alive = 0;
  /** Multiplicador del tamaño al emitir (vistas de cerca, como el garaje). */
  sizeScale = 1;

  constructor(opts: ParticleOptions) {
    const n = opts.capacity;
    this.capacity = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.startCol = new Float32Array(n * 3);
    this.endCol = new Float32Array(n * 3);
    this.baseAlpha = new Float32Array(n);
    // Partículas libres fuera de la vista.
    for (let i = 0; i < n; i++) this.pos[i * 3 + 2] = -1e5;

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(35048));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 4).setUsage(35048));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(35048));
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? AdditiveBlending : NormalBlending,
      uniforms: { uScale: { value: 900 } },
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  /** Escala del tamaño de punto según la altura del viewport (píxeles). */
  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.9;
  }

  emit(e: Emit): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const p = i * 3;
    this.pos[p] = e.x;
    this.pos[p + 1] = e.y;
    this.pos[p + 2] = e.z;
    this.vel[p] = e.vx;
    this.vel[p + 1] = e.vy;
    this.vel[p + 2] = e.vz;
    this.size[i] = e.size * this.sizeScale;
    this.grow[i] = (e.grow ?? 0) * this.sizeScale;
    this.life[i] = e.life;
    this.maxLife[i] = e.life;
    this.grav[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0;
    this.baseAlpha[i] = e.alpha ?? 1;
    this.startCol[p] = e.color.r;
    this.startCol[p + 1] = e.color.g;
    this.startCol[p + 2] = e.color.b;
    const end = e.endColor ?? e.color;
    this.endCol[p] = end.r;
    this.endCol[p + 1] = end.g;
    this.endCol[p + 2] = end.b;
  }

  update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const nl = l - dt;
      const p = i * 3;
      if (nl <= 0) {
        this.life[i] = 0;
        this.pos[p + 2] = -1e5;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] = nl;
      alive++;
      const k = 1 - nl / this.maxLife[i];
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[p] *= damp;
      this.vel[p + 1] *= damp;
      this.vel[p + 2] = this.vel[p + 2] * damp + this.grav[i] * dt;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      const c = i * 4;
      this.col[c] = this.startCol[p] + (this.endCol[p] - this.startCol[p]) * k;
      this.col[c + 1] = this.startCol[p + 1] + (this.endCol[p + 1] - this.startCol[p + 1]) * k;
      this.col[c + 2] = this.startCol[p + 2] + (this.endCol[p + 2] - this.startCol[p + 2]) * k;
      // Aparición rápida y desvanecimiento suave.
      this.col[c + 3] = this.baseAlpha[i] * Math.min(1, k * 12) * (1 - k * k);
    }
    this.alive = alive;
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
