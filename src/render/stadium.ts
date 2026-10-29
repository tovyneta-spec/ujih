// Entorno del estadio: gradas, público instanciado que reacciona a los goles, barras de luz del techo
// y pantallas. Todo en espacio de simulación (z arriba).
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { ARENA } from '../config';
import type { ThemeSpec } from '../config';
import { perimeter } from './arenaMesh';
import type { Quality } from './quality';

const GX = ARENA.goal.halfWidth;
const HY = ARENA.halfLength;
const H = ARENA.height;

/** Anchura del hueco sin gradas detrás de cada portería. */
const GOAL_GAP = GX + 320;
const TIERS = 6;
const TIER_DEPTH = 300;
const TIER_RISE = 190;
const FIRST_OFFSET = 220;

/** Altura de la fila k de la grada y distancia al muro. */
const rowZ = (k: number): number => 90 + k * TIER_RISE;
const rowOffset = (k: number): number => FIRST_OFFSET + k * TIER_DEPTH;

export interface StadiumVisual {
  group: Group;
  /** Excitación del público (0..1), decae sola. */
  excite(amount: number): void;
  /** Muestra el marcador en las pantallas del estadio. */
  setScore(blue: number, orange: number): void;
  update(dt: number): void;
  dispose(): void;
}

function inGap(x: number, y: number): boolean {
  return Math.abs(y) > HY - 100 && Math.abs(x) < GOAL_GAP;
}

function standsGeometry(color: Color): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  // Perfil escalonado: peldaños de grada hacia fuera.
  const prof: [number, number][] = [[FIRST_OFFSET - 80, 0]];
  for (let k = 0; k < TIERS; k++) {
    const d0 = rowOffset(k) - TIER_DEPTH / 2;
    prof.push([d0, rowZ(k) - 10], [d0 + TIER_DEPTH, rowZ(k) - 10]);
    if (k < TIERS - 1) prof.push([d0 + TIER_DEPTH, rowZ(k + 1) - 10]);
  }
  prof.push([rowOffset(TIERS - 1) + TIER_DEPTH, H * 0.9]);
  for (const strip of perimeter()) {
    if (strip.clipped) continue;
    const base = pos.length / 3;
    strip.cols.forEach((c, i) => {
      for (const [d, z] of prof) {
        pos.push(c.x - c.nx * d, c.y - c.ny * d, z);
        const shade = 0.55 + 0.35 * Math.min(1, z / 1300);
        col.push(color.r * shade, color.g * shade, color.b * shade);
      }
      if (i > 0 && !(inGap(c.x, c.y) && inGap(strip.cols[i - 1].x, strip.cols[i - 1].y))) {
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
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function screenTexture(blue: number, orange: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d');
  if (g) {
    const bg = g.createLinearGradient(0, 0, 1024, 0);
    bg.addColorStop(0, '#0b2a6b');
    bg.addColorStop(0.5, '#0a0e22');
    bg.addColorStop(1, '#6b2a0b');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 320);
    g.fillStyle = '#8db8ff';
    g.font = '900 170px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(blue), 190, 170);
    g.fillStyle = '#ffb27a';
    g.fillText(String(orange), 834, 170);
    g.fillStyle = '#ffffff';
    g.font = '800 64px system-ui, sans-serif';
    g.fillText('TURBO ARENA', 512, 170);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function addLights(group: Group, theme: ThemeSpec): void {
  // Barras de luz del techo (instanciadas: una sola llamada de dibujo).
  const lightColor = new Color(theme.light).multiplyScalar(theme.id === 'day' ? 1.4 : 3);
  const bars: Matrix4[] = [];
  for (let y = -4000; y <= 4000; y += 1000) {
    for (const x of [-2600, 0, 2600]) {
      const m = new Matrix4().makeTranslation(x, y, H - 6);
      bars.push(m);
    }
  }
  const lights = new InstancedMesh(
    new BoxGeometry(1300, 70, 6),
    new MeshBasicMaterial({ color: lightColor }),
    bars.length,
  );
  bars.forEach((m, i) => lights.setMatrixAt(i, m));
  group.add(lights);
}

export function buildStadium(theme: ThemeSpec, quality: Quality): StadiumVisual {
  const group = new Group();
  group.name = 'stadium';

  // Nivel bajo: sin gradas, público ni pantallas (las paredes son opacas y no se verían).
  if (!quality.crowd) {
    addLights(group, theme);
    return {
      group,
      excite: () => {},
      setScore: () => {},
      update: () => {},
      dispose() {
        group.traverse((o) => {
          const m = o as Mesh;
          m.geometry?.dispose();
          (m.material as MeshBasicMaterial | undefined)?.dispose();
        });
      },
    };
  }

  // --- Gradas ---
  const standColor = new Color(theme.id === 'day' ? 0x4a556e : 0x1b2038);
  const stands = new Mesh(
    standsGeometry(standColor),
    new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
  );
  group.add(stands);

  // --- Público instanciado ---
  interface Person {
    x: number;
    y: number;
    z: number;
    rot: number;
    phase: number;
  }
  const people: Person[] = [];
  const spacing = 150;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const strip of perimeter()) {
    if (strip.clipped) continue;
    for (let i = 1; i < strip.cols.length; i++) {
      const a = strip.cols[i - 1];
      const b = strip.cols[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < TIERS; k++) {
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t;
          const nx = a.nx + (b.nx - a.nx) * t;
          const ny = a.ny + (b.ny - a.ny) * t;
          const nl = Math.hypot(nx, ny) || 1;
          const d = rowOffset(k) + (rnd() - 0.5) * 40;
          const x = px - (nx / nl) * d;
          const y = py - (ny / nl) * d;
          if (inGap(x, y)) continue;
          people.push({ x, y, z: rowZ(k), rot: Math.atan2(ny, nx), phase: rnd() * 6.28 });
        }
      }
    }
  }
  const bodyGeo = new BoxGeometry(75, 48, 100);
  const headGeo = new BoxGeometry(42, 42, 42);
  const mat = new MeshBasicMaterial({ color: 0xffffff });
  const bodies = new InstancedMesh(bodyGeo, mat, people.length);
  const heads = new InstancedMesh(
    headGeo,
    new MeshBasicMaterial({ color: 0xf0c8a0 }),
    people.length,
  );
  const tmpColor = new Color();
  people.forEach((_p, i) => {
    tmpColor
      .set(theme.crowd[Math.floor(rnd() * theme.crowd.length)])
      .multiplyScalar(theme.crowdBrightness);
    bodies.setColorAt(i, tmpColor);
    tmpColor.set(0xe9bf98).multiplyScalar(theme.crowdBrightness);
    heads.setColorAt(i, tmpColor);
  });
  const dummy = new Object3D();
  const placeAll = (bob: number, time: number): void => {
    people.forEach((p, i) => {
      const lift = bob > 0 ? Math.abs(Math.sin(time * 7 + p.phase)) * bob * 45 : 0;
      dummy.position.set(p.x, p.y, p.z + 50 + lift);
      dummy.rotation.set(0, 0, p.rot);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.y, p.z + 122 + lift);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };
  placeAll(0, 0);
  group.add(bodies, heads);

  addLights(group, theme);

  // --- Pantallas tras las porterías (visibles por encima del larguero) ---
  let scoreTex = screenTexture(0, 0);
  const screens: Mesh[] = [];
  for (const s of [-1, 1]) {
    const scr = new Mesh(
      new PlaneGeometry(3400, 1060),
      new MeshBasicMaterial({ map: scoreTex, side: DoubleSide }),
    );
    scr.position.set(0, s * (HY + 1500), 1250);
    scr.rotation.x = Math.PI / 2;
    // Mira hacia el centro del estadio (si no, el texto se ve invertido).
    scr.rotation.y = s > 0 ? 0 : Math.PI;
    group.add(scr);
    screens.push(scr);
  }

  let excitement = 0;
  let time = 0;
  let wasCheering = false;
  return {
    group,
    excite(a: number): void {
      excitement = Math.min(1, Math.max(excitement, a));
    },
    setScore(blue: number, orange: number): void {
      const old = scoreTex;
      scoreTex = screenTexture(blue, orange);
      for (const s of screens) (s.material as MeshBasicMaterial).map = scoreTex;
      old.dispose();
    },
    update(dt: number): void {
      time += dt;
      if (excitement > 0.01) {
        placeAll(excitement, time);
        excitement = Math.max(0, excitement - dt * 0.22);
        wasCheering = true;
      } else if (wasCheering) {
        placeAll(0, time);
        wasCheering = false;
      }
    },
    dispose(): void {
      group.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose();
        const mt = m.material as MeshBasicMaterial | undefined;
        mt?.map?.dispose();
        mt?.dispose();
      });
    },
  };
}
