// Geometría visual del estadio generada proceduralmente a partir de las mismas dimensiones que la colisión.
import {
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { ARENA } from '../config';
import type { ThemeSpec } from '../config';
import { makeFloorTexture, makeNetTexture, makeWallTexture } from './textures';

const HX = ARENA.halfWidth;
const HY = ARENA.halfLength;
const H = ARENA.height;
const RC = ARENA.cornerRadius;
const RR = ARENA.rampRadius;
const GX = ARENA.goal.halfWidth;
const GZ = ARENA.goal.height;
const GD = ARENA.goal.depth;

export const TEAM_COLORS = {
  blue: new Color(0x2f7bff),
  orange: new Color(0xff7a1f),
};

export interface Col {
  x: number;
  y: number;
  nx: number;
  ny: number;
}
export interface Strip {
  cols: Col[];
  clipped: boolean;
}
interface ProfilePoint {
  u: number;
  z: number;
  nu: number;
  nz: number;
}

/** Contorno de la planta (rectángulo de esquinas redondeadas) dividido en tiras; recorta el hueco de las porterías. */
export function perimeter(): Strip[] {
  const strips: Strip[] = [];
  const line = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    nx: number,
    ny: number,
    clipped = false,
  ) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / 350));
    const cols: Col[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      cols.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, nx, ny });
    }
    strips.push({ cols, clipped });
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const steps = 20;
    const cols: Col[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      cols.push({
        x: cx + RC * Math.cos(a),
        y: cy + RC * Math.sin(a),
        nx: -Math.cos(a),
        ny: -Math.sin(a),
      });
    }
    strips.push({ cols, clipped: false });
  };
  const ix = HX - RC;
  const iy = HY - RC;
  line(HX, -iy, HX, iy, -1, 0);
  arc(ix, iy, 0, Math.PI / 2);
  line(ix, HY, GX, HY, 0, -1);
  line(GX, HY, -GX, HY, 0, -1, true);
  line(-GX, HY, -ix, HY, 0, -1);
  arc(-ix, iy, Math.PI / 2, Math.PI);
  line(-HX, iy, -HX, -iy, 1, 0);
  arc(-ix, -iy, Math.PI, (3 * Math.PI) / 2);
  line(-ix, -HY, -GX, -HY, 0, 1);
  line(-GX, -HY, GX, -HY, 0, 1, true);
  line(GX, -HY, ix, -HY, 0, 1);
  arc(ix, -iy, (3 * Math.PI) / 2, 2 * Math.PI);
  return strips;
}

/** Perfil de la sección: rampa inferior, pared, rampa superior. */
function profile(clipped: boolean): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const p = (i / steps) * (Math.PI / 2);
    pts.push({
      u: RR - RR * Math.sin(p),
      z: RR - RR * Math.cos(p),
      nu: Math.sin(p),
      nz: Math.cos(p),
    });
  }
  for (let i = 0; i <= steps; i++) {
    const p = (i / steps) * (Math.PI / 2);
    pts.push({
      u: RR - RR * Math.cos(p),
      z: H - RR + RR * Math.sin(p),
      nu: Math.cos(p),
      nz: -Math.sin(p),
    });
  }
  if (!clipped) return pts;
  const out: ProfilePoint[] = [{ u: 0, z: GZ, nu: 1, nz: 0 }];
  for (const p of pts) if (p.z > GZ) out.push(p);
  return out;
}

const blue = TEAM_COLORS.blue;
const orange = TEAM_COLORS.orange;
const tint = new Color();
const cBlue = new Color();
const cOrange = new Color();
function teamTint(y: number, base: number): Color {
  const t = Math.min(1, Math.max(0, (y + 900) / 1800));
  tint.copy(cBlue).lerp(cOrange, t);
  return tint.multiplyScalar(base);
}

function wallGeometry(theme: ThemeSpec): BufferGeometry {
  cBlue.set(theme.wallBlue);
  cOrange.set(theme.wallOrange);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  const full = profile(false);
  const clip = profile(true);
  for (const strip of perimeter()) {
    const prof = strip.clipped ? clip : full;
    const base = pos.length / 3;
    let prev: Col | null = null;
    strip.cols.forEach((c, i) => {
      if (prev) s += Math.hypot(c.x - prev.x, c.y - prev.y);
      prev = c;
      for (const p of prof) {
        pos.push(c.x + c.nx * p.u, c.y + c.ny * p.u, p.z);
        nor.push(c.nx * p.nu, c.ny * p.nu, p.nz);
        const ramp = p.z < RR || p.z > H - RR ? 0.55 : 1;
        const k = teamTint(c.y, ramp * (0.7 + 0.3 * (1 - Math.abs(p.z - H * 0.4) / H)));
        // Opaco abajo y en las rampas; semitransparente arriba para ver las gradas.
        const alpha =
          p.z < 300 || p.z > H - RR
            ? 0.96
            : Math.max(theme.wallOpacity, 0.96 - ((p.z - 300) / 500) * (0.96 - theme.wallOpacity));
        col.push(k.r, k.g, k.b, alpha);
        uv.push(s / 700, p.z / 700);
      }
      if (i > 0) {
        const n = prof.length;
        const a = base + (i - 1) * n;
        const b = base + i * n;
        for (let j = 0; j < n - 1; j++)
          idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
      }
    });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Polígono de suelo/techo (planta inscrita en la rampa) triangulado en abanico. */
function capGeometry(
  z: number,
  normalZ: number,
  uvFn: (x: number, y: number) => [number, number],
): BufferGeometry {
  const ix = HX - RR;
  const iy = HY - RR;
  const r = RC - RR;
  const cx = ix - r;
  const cy = iy - r;
  const ring: [number, number][] = [];
  const arcSteps = 20;
  const quadrants: [number, number, number, number][] = [
    [cx, cy, 0, Math.PI / 2],
    [-cx, cy, Math.PI / 2, Math.PI],
    [-cx, -cy, Math.PI, (3 * Math.PI) / 2],
    [cx, -cy, (3 * Math.PI) / 2, 2 * Math.PI],
  ];
  for (const [qx, qy, a0, a1] of quadrants) {
    for (let i = 0; i <= arcSteps; i++) {
      const a = a0 + ((a1 - a0) * i) / arcSteps;
      ring.push([qx + r * Math.cos(a), qy + r * Math.sin(a)]);
    }
  }
  const pos: number[] = [0, 0, z];
  const nor: number[] = [0, 0, normalZ];
  const uv: number[] = [...uvFn(0, 0)];
  const idx: number[] = [];
  ring.forEach(([x, y], i) => {
    pos.push(x, y, z);
    nor.push(0, 0, normalZ);
    uv.push(...uvFn(x, y));
    const a = 1 + i;
    const b = 1 + ((i + 1) % ring.length);
    idx.push(0, a, b);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function bar(a: Vector3, b: Vector3, radius: number, mat: MeshStandardMaterial): Mesh {
  const len = a.distanceTo(b);
  const m = new Mesh(new CylinderGeometry(radius, radius, len, 10), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export interface ArenaVisual {
  group: Group;
  dispose(): void;
}

/** Construye el estadio en el espacio de la simulación (z arriba). */
export function buildArena(theme: ThemeSpec): ArenaVisual {
  const group = new Group();
  group.name = 'arena';

  const wallTex = makeWallTexture();
  const floorTex = makeFloorTexture(theme);
  const netTex = makeNetTexture();

  const wallMat = new MeshStandardMaterial({
    map: wallTex,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.1,
    side: DoubleSide,
    transparent: true,
    emissive: new Color(theme.wallEmissive),
    emissiveIntensity: 1,
  });
  group.add(new Mesh(wallGeometry(theme), wallMat));

  const floorMat = new MeshStandardMaterial({
    map: floorTex,
    roughness: 0.75,
    metalness: 0.05,
    side: DoubleSide,
  });
  const floor = new Mesh(
    capGeometry(0, 1, (x, y) => [(x + HX) / (HX * 2), (y + HY) / (HY * 2)]),
    floorMat,
  );
  floor.receiveShadow = true;
  group.add(floor);

  const ceilMat = new MeshStandardMaterial({
    map: wallTex,
    color: theme.ceiling,
    roughness: 0.7,
    emissive: new Color(theme.ceilingEmissive),
    side: DoubleSide,
  });
  group.add(
    new Mesh(
      capGeometry(H, -1, (x, y) => [x / 700, y / 700]),
      ceilMat,
    ),
  );

  // Suelo dentro de las porterías (el recorte de la rampa deja el suelo plano hasta la línea de fondo).
  for (const s of [-1, 1]) {
    const len = GD + RR;
    const plane = new Mesh(new PlaneGeometry(GX * 2, len), floorMat.clone());
    (plane.material as MeshStandardMaterial).map = null;
    (plane.material as MeshStandardMaterial).color = new Color(s < 0 ? 0x16306b : 0x7a3410);
    plane.position.set(0, s * (HY - RR + len / 2), 0.2);
    plane.receiveShadow = true;
    group.add(plane);

    const teamCol = s < 0 ? blue : orange;
    const netMat = new MeshBasicMaterial({
      map: netTex,
      color: teamCol,
      transparent: true,
      opacity: 0.75,
      side: DoubleSide,
      depthWrite: false,
    });
    const back = new Mesh(new PlaneGeometry(GX * 2, GZ), netMat);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, s * (HY + GD), GZ / 2);
    (back.material as MeshBasicMaterial).map = netTex.clone();
    (back.material as MeshBasicMaterial).map!.repeat.set((GX * 2) / 60, GZ / 60);
    group.add(back);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(GD, GZ), netMat.clone());
      side.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      side.position.set(sx * GX, s * (HY + GD / 2), GZ / 2);
      (side.material as MeshBasicMaterial).map = netTex.clone();
      (side.material as MeshBasicMaterial).map!.repeat.set(GD / 60, GZ / 60);
      group.add(side);
    }
    const roof = new Mesh(new PlaneGeometry(GX * 2, GD), netMat.clone());
    roof.position.set(0, s * (HY + GD / 2), GZ);
    (roof.material as MeshBasicMaterial).map = netTex.clone();
    (roof.material as MeshBasicMaterial).map!.repeat.set((GX * 2) / 60, GD / 60);
    group.add(roof);

    // Postes y larguero.
    const postMat = new MeshStandardMaterial({
      color: 0xf2f4fa,
      emissive: teamCol,
      emissiveIntensity: 0.55,
      roughness: 0.3,
    });
    const pr = ARENA.goal.postRadius;
    for (const sx of [-1, 1]) {
      group.add(
        bar(new Vector3(sx * GX, s * HY, 0), new Vector3(sx * GX, s * HY, GZ), pr, postMat),
      );
      const ball = new Mesh(new SphereGeometry(pr, 10, 8), postMat);
      ball.position.set(sx * GX, s * HY, GZ);
      group.add(ball);
    }
    group.add(bar(new Vector3(-GX, s * HY, GZ), new Vector3(GX, s * HY, GZ), pr, postMat));
  }

  // Fondo exterior oscuro visible a través de las porterías.
  const outer = new Mesh(
    new SphereGeometry(18000, 16, 12),
    new MeshBasicMaterial({ color: theme.background, side: BackSide, depthWrite: false }),
  );
  group.add(outer);

  return {
    group,
    dispose() {
      group.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mat = m.material as MeshStandardMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
    },
  };
}
