// Efectos visuales: llamas y estela del turbo, estela supersónica, humo y marcas de derrape, chispas,
// ondas de choque, explosiones de demolición y de gol, anillos de pads. Todo con pools (sin asignaciones).
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { ARENA, PADS, TRAILS } from '../config';
import type { GoalExplosion, TrailStyle } from '../config';
import { Quat, Vec3 } from '../sim';
import type { SimEvent, World } from '../sim';
import type { CarVisual } from './carMesh';
import { ParticleSystem } from './particles';

/** Estado visual de un coche en este frame (sirve para vivo y repeticiones). */
export interface FxCar {
  pos: Vec3;
  quat: Quat;
  boosting: boolean;
  grounded: boolean;
  fwdSpeed: number;
  handbrake: boolean;
  demolished: boolean;
}

export const createFxCar = (): FxCar => ({
  pos: new Vec3(),
  quat: new Quat(),
  boosting: false,
  grounded: true,
  fwdSpeed: 0,
  handbrake: false,
  demolished: false,
});

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const SKIDS = 220;

interface Shell {
  mesh: Mesh;
  life: number;
  max: number;
  radius: number;
}
interface Ring {
  mesh: Mesh;
  life: number;
  max: number;
  radius: number;
}
interface Timer {
  t: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  hue: number;
}

const tmpA = new Vec3();
const tmpB = new Vec3();
const c1 = new Color();
const c2 = new Color();
const dummy = new Object3D();

export class Effects {
  readonly group = new Group();
  readonly glow = new ParticleSystem({ capacity: 7000, additive: true });
  readonly solid = new ParticleSystem({ capacity: 2500, additive: false });
  private shells: Shell[] = [];
  private rings: Ring[] = [];
  private skids: InstancedMesh;
  private skidCursor = 0;
  private lastSkid: Vec3[] = [];
  private acc: number[] = [];
  private timers: Timer[] = Array.from({ length: 24 }, () => ({
    t: -1,
    kind: 0,
    x: 0,
    y: 0,
    z: 0,
    hue: 0,
  }));
  private lastBall = new Vec3();
  private ballInit = false;
  private time = 0;

  constructor() {
    this.group.add(this.glow.points, this.solid.points);
    const shellGeo = new SphereGeometry(1, 18, 12);
    for (let i = 0; i < 8; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(shellGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.shells.push({ mesh, life: 0, max: 1, radius: 1 });
    }
    const ringGeo = new RingGeometry(0.86, 1, 40);
    for (let i = 0; i < 10; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, radius: 1 });
    }
    this.skids = new InstancedMesh(
      new PlaneGeometry(13, 46),
      new MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
      SKIDS,
    );
    this.skids.frustumCulled = false;
    const hide = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SKIDS; i++) this.skids.setMatrixAt(i, hide);
    this.group.add(this.skids);
  }

  /** Escala el tamaño de las partículas que se emiten a partir de ahora. */
  setScale(k: number): void {
    this.glow.sizeScale = k;
    this.solid.sizeScale = k;
  }

  setViewportHeight(h: number): void {
    this.glow.setViewportHeight(h);
    this.solid.setViewportHeight(h);
  }

  /** Reinicia efectos al cambiar de partida. */
  clear(): void {
    for (const s of this.shells) {
      s.life = 0;
      s.mesh.visible = false;
    }
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const t of this.timers) t.t = -1;
    this.ballInit = false;
    this.acc.length = 0;
    this.lastSkid.length = 0;
  }

  // ------------------------------------------------------------------ pools

  private shell(x: number, y: number, z: number, color: number, radius: number, dur: number): void {
    const s = this.shells.find((v) => v.life <= 0) ?? this.shells[0];
    s.mesh.position.set(x, y, z);
    (s.mesh.material as MeshBasicMaterial).color.set(color);
    s.life = s.max = dur;
    s.radius = radius;
    s.mesh.visible = true;
  }

  private ring(x: number, y: number, z: number, color: number, radius: number, dur: number): void {
    const r = this.rings.find((v) => v.life <= 0) ?? this.rings[0];
    r.mesh.position.set(x, y, z);
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.life = r.max = dur;
    r.radius = radius;
    r.mesh.visible = true;
  }

  private schedule(delay: number, kind: number, x: number, y: number, z: number, hue = 0): void {
    const t = this.timers.find((v) => v.t < 0);
    if (!t) return;
    t.t = delay;
    t.kind = kind;
    t.x = x;
    t.y = y;
    t.z = z;
    t.hue = hue;
  }

  // -------------------------------------------------------------- emisores

  private burst(
    x: number,
    y: number,
    z: number,
    n: number,
    speed: number,
    size: number,
    life: number,
    color: number,
    end: number,
    gravity = -300,
    additive = true,
  ): void {
    const sys = additive ? this.glow : this.solid;
    c1.set(color);
    c2.set(end);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-1, 1));
      const sp = speed * rand(0.35, 1);
      sys.emit({
        x,
        y,
        z,
        vx: Math.sin(ph) * Math.cos(th) * sp,
        vy: Math.sin(ph) * Math.sin(th) * sp,
        vz: Math.cos(ph) * sp,
        size: size * rand(0.6, 1.2),
        life: life * rand(0.6, 1),
        color: c1,
        endColor: c2,
        gravity,
        drag: 1.2,
      });
    }
  }

  private fireworkBurst(x: number, y: number, z: number, hue: number): void {
    c1.setHSL(hue, 1, 0.6);
    c2.setHSL((hue + 0.08) % 1, 1, 0.45);
    for (let i = 0; i < 70; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(rand(-1, 1));
      const sp = rand(450, 800);
      this.glow.emit({
        x,
        y,
        z,
        vx: Math.sin(ph) * Math.cos(th) * sp,
        vy: Math.sin(ph) * Math.sin(th) * sp,
        vz: Math.cos(ph) * sp,
        size: rand(40, 70),
        life: rand(1.1, 1.7),
        color: c1,
        endColor: c2,
        gravity: -260,
        drag: 1.6,
      });
    }
    this.shell(x, y, z, c1.getHex(), 380, 0.45);
  }

  /** Explosión de gol en la portería `goalY` (y = ±5120), con el estilo del goleador. */
  goalExplosion(team: 0 | 1, style: GoalExplosion, origin?: Vec3): void {
    const goalY = (team === 0 ? 1 : -1) * ARENA.halfLength;
    const x = origin ? origin.x : 0;
    const y = origin ? origin.y : goalY - Math.sign(goalY) * 200;
    const z = origin ? origin.z : 280;
    const main = team === 0 ? 0x4f8dff : 0xff8a3a;
    const light = team === 0 ? 0xbfd9ff : 0xffd2a8;
    if (style === 'classic') {
      this.burst(x, y, z, 160, 1500, 80, 1.3, light, main, -200);
      this.burst(x, y, z, 70, 2200, 28, 0.9, 0xffffff, main, -500);
      this.shell(x, y, z, main, 900, 0.6);
      this.ring(x, y, 3, main, 1100, 0.9);
    } else if (style === 'fireworks') {
      this.burst(x, y, z, 50, 1100, 60, 1, light, main, -200);
      for (let i = 0; i < 6; i++) {
        const sx = rand(-700, 700);
        const sy = y - Math.sign(goalY) * rand(0, 600);
        this.schedule(
          0.15 + i * 0.28,
          1,
          sx,
          sy,
          rand(900, 1400),
          (i * 0.17 + Math.random() * 0.1) % 1,
        );
      }
    } else {
      for (let i = 0; i < 260; i++) {
        c1.setHSL(Math.random(), 0.95, 0.58);
        this.solid.emit({
          x: x + rand(-500, 500),
          y: y + rand(-200, 200),
          z: z + rand(0, 200),
          vx: rand(-500, 500),
          vy: rand(-500, 500) - Math.sign(goalY) * 300,
          vz: rand(900, 2000),
          size: rand(14, 26),
          life: rand(2.2, 3.4),
          color: c1,
          gravity: -520,
          drag: 0.7,
        });
      }
      this.ring(x, y, 3, main, 900, 0.7);
    }
  }

  demolition(pos: Vec3): void {
    this.burst(pos.x, pos.y, pos.z + 20, 110, 1400, 70, 0.9, 0xffe3a0, 0xff4a10, -400);
    this.burst(pos.x, pos.y, pos.z + 20, 30, 1700, 26, 0.7, 0xffffff, 0xffa040, -900);
    this.burst(pos.x, pos.y, pos.z + 20, 28, 500, 120, 1.4, 0x6b5a50, 0x2a2420, 40, false);
    this.shell(pos.x, pos.y, pos.z + 20, 0xffa040, 650, 0.45);
    this.ring(pos.x, pos.y, 3, 0xff8030, 700, 0.6);
  }

  // ---------------------------------------------------------------- eventos

  onEvent(e: SimEvent, world: World, explosionOf: (carId: number) => GoalExplosion): void {
    switch (e.type) {
      case 'ballTouch': {
        const b = world.ball.pos;
        const k = Math.min(1, e.relSpeed / 2500);
        if (e.relSpeed > 500) {
          this.shell(b.x, b.y, b.z, 0xffffff, 140 + k * 260, 0.3);
          this.burst(
            b.x,
            b.y,
            b.z,
            Math.round(8 + k * 26),
            500 + k * 1200,
            26,
            0.45,
            0xfff3c0,
            0xffa030,
            -400,
          );
        }
        break;
      }
      case 'ballBounce':
        if (e.speed > 700)
          this.burst(e.x, e.y, e.z, 10, 350 + e.speed * 0.15, 22, 0.4, 0xffffff, 0x88aaff, -300);
        break;
      case 'wallHit': {
        const c = world.cars[e.carId];
        if (e.speed > 500) {
          this.burst(
            c.pos.x,
            c.pos.y,
            c.pos.z,
            Math.min(30, Math.round(e.speed / 60)),
            350 + e.speed * 0.3,
            20,
            0.35,
            0xfff0b0,
            0xff7020,
            -600,
          );
        }
        break;
      }
      case 'bump': {
        const c = world.cars[e.victimId];
        this.burst(c.pos.x, c.pos.y, c.pos.z, 14, 600, 22, 0.35, 0xffffff, 0xffc060, -500);
        break;
      }
      case 'padPickup': {
        const p = world.pads[e.padIndex];
        const big = p.spec.size === 'big';
        this.ring(
          p.spec.x,
          p.spec.y,
          4,
          big ? 0xffb030 : 0xffe880,
          (big ? PADS.big.radius : PADS.small.radius) * 1.1,
          0.5,
        );
        this.burst(
          p.spec.x,
          p.spec.y,
          20,
          big ? 24 : 10,
          big ? 600 : 380,
          24,
          0.55,
          0xfff0a0,
          0xffa020,
          400,
        );
        break;
      }
      case 'demolition':
        this.demolition(world.cars[e.victimId].pos);
        break;
      case 'matchGoal':
        this.goalExplosion(
          e.team,
          explosionOf(
            e.scorerId >= 0 ? e.scorerId : (world.cars.find((c) => c.team === e.team)?.id ?? 0),
          ),
        );
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ frame

  update(
    dt: number,
    cars: readonly FxCar[],
    visuals: readonly CarVisual[],
    ballPos: Vec3,
    trails: readonly TrailStyle[],
  ): void {
    this.time += dt;
    // Temporizadores (fuegos artificiales).
    for (const t of this.timers) {
      if (t.t < 0) continue;
      t.t -= dt;
      if (t.t <= 0) {
        t.t = -1;
        if (t.kind === 1) this.fireworkBurst(t.x, t.y, t.z, t.hue);
      }
    }

    cars.forEach((car, i) => {
      if (car.demolished) return;
      const v = visuals[i];
      const spec = TRAILS[trails[i] ?? 'flame'];
      this.acc[i * 3] ??= 0;
      this.acc[i * 3 + 1] ??= 0;
      this.acc[i * 3 + 2] ??= 0;

      // Turbo: llama de partículas desde los escapes.
      if (car.boosting) {
        this.acc[i * 3] += dt * 130;
        while (this.acc[i * 3] >= 1) {
          this.acc[i * 3]--;
          const ex = v.exhaust[Math.random() < 0.5 ? 0 : 1];
          tmpA.set(ex.x, ex.y, ex.z);
          car.quat.rotate(tmpA, tmpB);
          tmpA.set(-1, 0, 0);
          car.quat.rotate(tmpA, tmpA);
          if (spec.rainbow) c1.setHSL((this.time * 0.8 + Math.random() * 0.25) % 1, 1, 0.6);
          else c1.set(spec.outer);
          c2.set(spec.core);
          const sp = rand(500, 900) + Math.max(0, car.fwdSpeed) * 0.15;
          this.glow.emit({
            x: car.pos.x + tmpB.x,
            y: car.pos.y + tmpB.y,
            z: car.pos.z + tmpB.z,
            vx: tmpA.x * sp + rand(-70, 70),
            vy: tmpA.y * sp + rand(-70, 70),
            vz: tmpA.z * sp + rand(-70, 70),
            size: rand(22, 36),
            grow: -60,
            life: rand(0.18, 0.34),
            color: c2,
            endColor: c1,
            alpha: 0.55,
            drag: 2,
          });
          if (Math.random() < 0.18) {
            c1.set(spec.spark);
            this.glow.emit({
              x: car.pos.x + tmpB.x,
              y: car.pos.y + tmpB.y,
              z: car.pos.z + tmpB.z,
              vx: tmpA.x * 900 + rand(-350, 350),
              vy: tmpA.y * 900 + rand(-350, 350),
              vz: tmpA.z * 900 + rand(-100, 500),
              size: 14,
              life: rand(0.3, 0.6),
              color: c1,
              gravity: -500,
            });
          }
        }
      }

      // Estela supersónica.
      if (Math.abs(car.fwdSpeed) >= 2200) {
        this.acc[i * 3 + 1] += dt * 90;
        while (this.acc[i * 3 + 1] >= 1) {
          this.acc[i * 3 + 1]--;
          const side = Math.random() < 0.5 ? 1 : -1;
          tmpA.set(-55, side * 38, rand(-6, 12));
          car.quat.rotate(tmpA, tmpB);
          c1.set(0xbfe8ff);
          c2.set(0x4f9cff);
          this.glow.emit({
            x: car.pos.x + tmpB.x,
            y: car.pos.y + tmpB.y,
            z: car.pos.z + tmpB.z,
            vx: 0,
            vy: 0,
            vz: 0,
            size: 22,
            grow: -30,
            life: 0.45,
            color: c1,
            endColor: c2,
            alpha: 0.7,
          });
        }
      }

      // Derrape: humo y marcas en el suelo.
      if (car.handbrake && car.grounded && Math.abs(car.fwdSpeed) > 500) {
        this.acc[i * 3 + 2] += dt * 55;
        while (this.acc[i * 3 + 2] >= 1) {
          this.acc[i * 3 + 2]--;
          const wp = v.rearWheels[Math.random() < 0.5 ? 0 : 1];
          tmpA.set(wp.x, wp.y, wp.z);
          car.quat.rotate(tmpA, tmpB);
          c1.set(0xb8b8b8);
          c2.set(0x606060);
          this.solid.emit({
            x: car.pos.x + tmpB.x,
            y: car.pos.y + tmpB.y,
            z: car.pos.z + tmpB.z,
            vx: rand(-60, 60),
            vy: rand(-60, 60),
            vz: rand(30, 110),
            size: 30,
            grow: 85,
            life: rand(0.5, 0.9),
            color: c1,
            endColor: c2,
            alpha: 0.4,
            drag: 1.5,
          });
        }
        for (let w = 0; w < 2; w++) {
          const wp = v.rearWheels[w];
          tmpA.set(wp.x, wp.y, wp.z);
          car.quat.rotate(tmpA, tmpB);
          const x = car.pos.x + tmpB.x;
          const y = car.pos.y + tmpB.y;
          const key = i * 2 + w;
          const last = (this.lastSkid[key] ??= new Vec3(1e9, 1e9, 0));
          if (Math.hypot(x - last.x, y - last.y) > 40) {
            tmpA.set(1, 0, 0);
            car.quat.rotate(tmpA, tmpA);
            dummy.position.set(x, y, 1.4);
            dummy.rotation.set(0, 0, Math.atan2(tmpA.y, tmpA.x) + Math.PI / 2);
            dummy.updateMatrix();
            this.skids.setMatrixAt(this.skidCursor, dummy.matrix);
            this.skidCursor = (this.skidCursor + 1) % SKIDS;
            this.skids.instanceMatrix.needsUpdate = true;
            last.set(x, y, 0);
          }
        }
      }
    });

    // Estela de la pelota a gran velocidad.
    if (this.ballInit && dt > 0) {
      const sp = ballPos.distanceTo(this.lastBall) / dt;
      if (sp > 2600 && Math.random() < Math.min(1, dt * 90)) {
        c1.set(0xdff4ff);
        c2.set(0x6aa8ff);
        this.glow.emit({
          x: ballPos.x,
          y: ballPos.y,
          z: ballPos.z,
          vx: 0,
          vy: 0,
          vz: 0,
          size: 70,
          grow: -120,
          life: 0.4,
          color: c1,
          endColor: c2,
          alpha: 0.6,
        });
      }
    }
    this.lastBall.copy(ballPos);
    this.ballInit = true;

    // Pools de formas.
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = 1 - Math.max(0, s.life) / s.max;
      s.mesh.scale.setScalar(Math.max(1, s.radius * (0.25 + 0.75 * Math.sqrt(k))));
      (s.mesh.material as MeshBasicMaterial).opacity = 0.5 * (1 - k);
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life) / r.max;
      r.mesh.scale.setScalar(Math.max(1, r.radius * (0.15 + 0.85 * k)));
      (r.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (r.life <= 0) r.mesh.visible = false;
    }
    this.glow.update(dt);
    this.solid.update(dt);
  }

  dispose(): void {
    this.glow.dispose();
    this.solid.dispose();
  }
}
