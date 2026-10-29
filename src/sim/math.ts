// Álgebra mínima mutable (sin dependencias). Ejes: x adelante, y izquierda, z arriba en el espacio local del coche.

export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  addScaled(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  /** this = a × b */
  crossOf(a: Vec3, b: Vec3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    return this.set(x, y, z);
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length(): number {
    return Math.sqrt(this.lengthSq());
  }
  normalize(): this {
    const l = this.length();
    return l > 1e-9 ? this.scale(1 / l) : this.set(0, 0, 0);
  }
  clampLength(max: number): this {
    const l = this.length();
    return l > max ? this.scale(max / l) : this;
  }
  distanceTo(v: Vec3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  lerpOf(a: Vec3, b: Vec3, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

export class Quat {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  copy(q: Quat): this {
    return this.set(q.x, q.y, q.z, q.w);
  }
  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }
  normalize(): this {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w) || 1;
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
  static fromAxisAngle(ax: number, ay: number, az: number, angle: number): Quat {
    const s = Math.sin(angle / 2);
    return new Quat(ax * s, ay * s, az * s, Math.cos(angle / 2));
  }
  /** Integra una velocidad angular en ejes del mundo durante dt. */
  integrate(wx: number, wy: number, wz: number, dt: number): this {
    const h = 0.5 * dt;
    const nx = this.x + h * (wx * this.w + wy * this.z - wz * this.y);
    const ny = this.y + h * (wy * this.w + wz * this.x - wx * this.z);
    const nz = this.z + h * (wz * this.w + wx * this.y - wy * this.x);
    const nw = this.w + h * (-wx * this.x - wy * this.y - wz * this.z);
    return this.set(nx, ny, nz, nw).normalize();
  }
  /** out = q · v (local → mundo). */
  rotate(v: Vec3, out: Vec3): Vec3 {
    const { x, y, z, w } = this;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return out.set(
      v.x + w * tx + (y * tz - z * ty),
      v.y + w * ty + (z * tx - x * tz),
      v.z + w * tz + (x * ty - y * tx),
    );
  }
  /** out = q⁻¹ · v (mundo → local). */
  unrotate(v: Vec3, out: Vec3): Vec3 {
    const { x, y, z } = this;
    const w = this.w;
    const tx = 2 * (-y * v.z + z * v.y);
    const ty = 2 * (-z * v.x + x * v.z);
    const tz = 2 * (-x * v.y + y * v.x);
    return out.set(
      v.x + w * tx + (-y * tz + z * ty),
      v.y + w * ty + (-z * tx + x * tz),
      v.z + w * tz + (-x * ty + y * tx),
    );
  }
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v < 0 ? -1 : 1);

/** Hipotenusa de 2 componentes sin `Math.hypot` (que reserva memoria en cada llamada). */
export const hyp2 = (a: number, b: number): number => Math.sqrt(a * a + b * b);
