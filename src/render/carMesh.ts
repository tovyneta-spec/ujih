// Modelos procedurales low-poly de las 9 carrocerías, con ruedas, calcomanías, antena y estela
// personalizables. Ejes locales: x adelante, y izquierda, z arriba; el origen es el centro de la hitbox.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { TRAILS } from '../config';
import type {
  AntennaStyle,
  CarBodyId,
  CarBodySpec,
  DecalStyle,
  TrailStyle,
  WheelStyle,
} from '../config';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BufferGeometry, ColorRepresentation, Material } from 'three';
import type { Quality } from './quality';
import { makeBlobTexture } from './textures';

export interface CarLook {
  primary: Color;
  secondary: Color;
  /** Color del equipo (barra del techo y brillo bajo el coche). */
  team: Color;
  wheels: WheelStyle;
  trail: TrailStyle;
  antenna: AntennaStyle;
  decal: DecalStyle;
}

export interface CarVisual {
  group: Group;
  /** Pivotes de dirección de las ruedas delanteras. */
  steerPivots: Group[];
  wheels: Mesh[] | Group[];
  flames: Mesh[];
  flameMaterials: MeshBasicMaterial[];
  trail: TrailStyle;
  /** Posiciones locales de los escapes y de las ruedas traseras (para partículas). */
  exhaust: Vector3[];
  rearWheels: Vector3[];
  /** Activa o desactiva que el coche proyecte sombra. */
  setShadow(on: boolean): void;
  dispose(): void;
}

type P = [number, number];

interface BodyShape {
  /** Polígonos en fracciones (x: 0 trasera → 1 morro; z: 0 base → 1 techo). */
  lower: P[];
  cabin: P[];
  lowerWidth: number;
  cabinWidth: number;
  extras?: (c: Ctx) => void;
}

interface Ctx {
  root: Group;
  L: number;
  W: number;
  H: number;
  zb: number;
  zt: number;
  /** Convierte fracciones a coordenadas locales. */
  X: (f: number) => number;
  Z: (f: number) => number;
  body: Material;
  trim: Material;
  dark: Material;
  /** Añade una malla estática: se fusiona con las del mismo material (una sola llamada de dibujo). */
  add(mesh: Mesh): void;
}

const box = (
  c: Ctx,
  w: number,
  d: number,
  h: number,
  x: number,
  y: number,
  z: number,
  m: Material,
): Mesh => {
  const mesh = new Mesh(new BoxGeometry(w, d, h), m);
  mesh.position.set(x, y, z);
  c.add(mesh);
  return mesh;
};

const SHAPES: Record<CarBodyId, BodyShape> = {
  // Hatchback compacto y equilibrado.
  octane: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.22],
      [0.93, 0.34],
      [0.62, 0.42],
      [0.2, 0.42],
      [0.02, 0.36],
      [0, 0.2],
    ],
    cabin: [
      [0.28, 0.42],
      [0.4, 1],
      [0.58, 1],
      [0.68, 0.42],
    ],
    lowerWidth: 0.9,
    cabinWidth: 0.72,
    extras: (c) => box(c, c.L * 0.08, c.W * 0.82, 3, c.X(0.03), 0, c.Z(0.46), c.trim),
  },
  // Cuña larga y baja con gran alerón.
  dominus: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.2],
      [0.9, 0.3],
      [0.58, 0.36],
      [0.1, 0.36],
      [0, 0.3],
    ],
    cabin: [
      [0.18, 0.36],
      [0.3, 0.92],
      [0.48, 0.92],
      [0.58, 0.36],
    ],
    lowerWidth: 0.95,
    cabinWidth: 0.66,
    extras: (c) => {
      box(c, c.L * 0.1, c.W * 0.96, 3, c.X(0.0), 0, c.Z(0.78), c.trim);
      for (const s of [-1, 1]) {
        box(c, 5, 3, c.H * 0.42, c.X(0.04), s * c.W * 0.3, c.Z(0.52), c.trim);
        // Aletas ensanchadas sobre las ruedas y splitter delantero.
        box(c, c.L * 0.26, 7, 6, c.X(0.2), s * (c.W * 0.5 + 1), c.Z(0.24), c.body);
        box(c, c.L * 0.26, 7, 6, c.X(0.8), s * (c.W * 0.5 + 1), c.Z(0.24), c.body);
      }
      box(c, 9, c.W * 0.98, 3, c.X(1.02), 0, c.Z(0.02), c.dark);
    },
  },
  // Tabla plana con cabina pequeña muy retrasada.
  plank: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.24],
      [0.85, 0.34],
      [0.55, 0.36],
      [0.1, 0.36],
      [0, 0.3],
    ],
    cabin: [
      [0.1, 0.36],
      [0.22, 0.95],
      [0.4, 0.95],
      [0.5, 0.36],
    ],
    lowerWidth: 0.96,
    cabinWidth: 0.6,
    extras: (c) => {
      for (const s of [-1, 1])
        box(c, c.L * 0.22, 3, 2, c.X(0.7), s * c.W * 0.18, c.Z(0.36) + 1, c.dark);
    },
  },
  // Cuña agresiva con morro puntiagudo y aleta trasera.
  breakout: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.15],
      [0.88, 0.3],
      [0.5, 0.4],
      [0.12, 0.42],
      [0, 0.34],
    ],
    cabin: [
      [0.3, 0.42],
      [0.42, 0.92],
      [0.56, 0.92],
      [0.66, 0.42],
    ],
    lowerWidth: 0.88,
    cabinWidth: 0.6,
    extras: (c) => {
      box(c, c.L * 0.16, 3, c.H * 0.6, c.X(0.06), 0, c.Z(0.75), c.trim);
      box(c, c.L * 0.06, c.W * 0.75, 3, c.X(0.97), 0, c.Z(0.1), c.dark);
      // Morro en punta y tomas de aire laterales.
      const nose = new Mesh(new ConeGeometry(c.W * 0.1, c.L * 0.14, 4), c.trim);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(c.X(1.04), 0, c.Z(0.12));
      c.add(nose);
      for (const s of [-1, 1])
        box(c, c.L * 0.14, 3, c.H * 0.18, c.X(0.45), s * (c.W * 0.44 + 1), c.Z(0.22), c.dark);
    },
  },
  // Compacto redondeado con doble aleta.
  hybrid: {
    lower: [
      [0, 0.05],
      [0.04, 0],
      [0.96, 0],
      [1, 0.08],
      [1, 0.26],
      [0.9, 0.36],
      [0.64, 0.42],
      [0.18, 0.42],
      [0.02, 0.34],
    ],
    cabin: [
      [0.26, 0.42],
      [0.36, 1],
      [0.62, 1],
      [0.72, 0.42],
    ],
    lowerWidth: 0.92,
    cabinWidth: 0.74,
    extras: (c) => {
      for (const s of [-1, 1])
        box(c, c.L * 0.1, 3, c.H * 0.32, c.X(0.05), s * c.W * 0.34, c.Z(0.62), c.trim);
    },
  },
  // Todoterreno alto y cuadrado con barras de techo y defensa.
  merc: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.3],
      [0.94, 0.4],
      [0.72, 0.44],
      [0.02, 0.44],
      [0, 0.38],
    ],
    cabin: [
      [0.1, 0.44],
      [0.12, 1],
      [0.72, 1],
      [0.78, 0.44],
    ],
    lowerWidth: 0.98,
    cabinWidth: 0.9,
    extras: (c) => {
      for (const f of [0.25, 0.5]) box(c, 4, c.W * 0.8, 4, c.X(f), 0, c.zt + 5, c.dark);
      for (const s of [-1, 1]) box(c, c.L * 0.5, 3, 3, c.X(0.4), s * c.W * 0.4, c.zt + 5, c.dark);
      box(c, 6, c.W * 0.86, c.H * 0.16, c.X(1.0), 0, c.Z(0.22), c.dark);
      // Rueda de repuesto en la trasera.
      const spare = new Mesh(new CylinderGeometry(c.H * 0.2, c.H * 0.2, 6, 14), c.dark);
      spare.rotation.z = Math.PI / 2;
      spare.position.set(c.X(-0.02), 0, c.Z(0.6));
      c.add(spare);
    },
  },
  // Cuña de superdeportivo: morro afilado, cabina retrasada y gran alerón.
  viper: {
    lower: [
      [0, 0],
      [1, 0],
      [1, 0.1],
      [0.82, 0.3],
      [0.52, 0.42],
      [0.12, 0.5],
      [0, 0.46],
    ],
    cabin: [
      [0.4, 0.5],
      [0.55, 0.9],
      [0.68, 0.9],
      [0.8, 0.5],
    ],
    lowerWidth: 1,
    cabinWidth: 0.6,
    extras: (c) => {
      // Alerón elevado sobre dos pilares y splitter plano.
      box(c, c.L * 0.14, c.W * 1.02, 3, c.X(0.02), 0, c.Z(1.0), c.dark);
      for (const s of [-1, 1]) box(c, 4, 3, c.H * 0.5, c.X(0.06), s * c.W * 0.3, c.Z(0.74), c.trim);
      box(c, c.L * 0.16, c.W * 1.0, 2, c.X(1.02), 0, c.Z(0.04), c.dark);
      // Entradas de aire laterales.
      for (const s of [-1, 1])
        box(c, c.L * 0.14, 3, c.H * 0.2, c.X(0.52), s * (c.W * 0.5 + 1), c.Z(0.3), c.dark);
    },
  },
  // Camioneta alta: cabina cuadrada, caja de carga y barra de luces.
  titan: {
    lower: [
      [0, 0.1],
      [1, 0.1],
      [1, 0.5],
      [0.96, 0.58],
      [0.5, 0.6],
      [0, 0.6],
    ],
    cabin: [
      [0.5, 0.6],
      [0.56, 1],
      [0.88, 1],
      [0.94, 0.6],
    ],
    lowerWidth: 0.96,
    cabinWidth: 0.86,
    extras: (c) => {
      // Defensa delantera, barra de luces y baca; la caja trasera queda rehundida.
      box(c, 8, c.W * 0.98, c.H * 0.16, c.X(1.03), 0, c.Z(0.24), c.dark);
      box(c, 4, c.W * 0.6, 4, c.X(0.72), 0, c.zt + 3, c.trim);
      for (const s of [-1, 1]) {
        box(c, c.L * 0.44, 3, c.H * 0.1, c.X(0.24), s * c.W * 0.46, c.Z(0.66), c.dark);
        box(c, 6, 6, 6, c.X(0.9), s * c.W * 0.34, c.zt + 4, c.trim);
      }
    },
  },
  // Microcoche redondeado con cúpula acristalada casi esférica.
  bubble: {
    lower: [
      [0.04, 0.05],
      [0.96, 0.05],
      [1, 0.2],
      [0.96, 0.34],
      [0.7, 0.4],
      [0.3, 0.4],
      [0.04, 0.34],
      [0, 0.2],
    ],
    cabin: [
      [0.08, 0.4],
      [0.14, 0.78],
      [0.3, 0.98],
      [0.55, 1],
      [0.76, 0.9],
      [0.9, 0.64],
      [0.94, 0.4],
    ],
    lowerWidth: 0.96,
    cabinWidth: 0.92,
    extras: (c) => {
      // Faros redondos y paragolpes mullido.
      for (const s of [-1, 1]) {
        const lamp = new Mesh(new CylinderGeometry(5, 5, 3, 12), c.trim);
        lamp.rotation.z = Math.PI / 2;
        lamp.position.set(c.X(1.0), s * c.W * 0.3, c.Z(0.26));
        c.add(lamp);
      }
      box(c, 5, c.W * 0.9, c.H * 0.14, c.X(1.02), 0, c.Z(0.08), c.dark);
      box(c, 5, c.W * 0.9, c.H * 0.14, c.X(-0.02), 0, c.Z(0.08), c.dark);
    },
  },
};

/** Acumula mallas estáticas y las fusiona por material. */
class Baker {
  private parts = new Map<Material, BufferGeometry[]>();
  add(mesh: Mesh): void {
    mesh.updateMatrix();
    const g = mesh.geometry.applyMatrix4(mesh.matrix);
    const list = this.parts.get(mesh.material as Material) ?? [];
    list.push(g.index ? g.toNonIndexed() : g);
    this.parts.set(mesh.material as Material, list);
  }
  /** Crea una malla por material en `parent` y devuelve la lista. */
  flush(parent: Group): Mesh[] {
    const out: Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** Material PBR o Lambert según el nivel de calidad. */
function mk(
  q: Quality,
  color: ColorRepresentation,
  roughness: number,
  metalness: number,
  emissive?: ColorRepresentation,
): MeshStandardMaterial | MeshLambertMaterial {
  return q.lambert
    ? new MeshLambertMaterial({ color, emissive: emissive ?? 0x000000 })
    : new MeshStandardMaterial({ color, roughness, metalness, emissive: emissive ?? 0x000000 });
}

function extruded(points: P[], depth: number, bevel: number): ExtrudeGeometry {
  const shape = new Shape();
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(Math.PI / 2); // forma (x,y) → (x,z); extrusión → eje y
  return geo;
}

/** Genera las piezas de una rueda (eje de giro = y local) y las entrega a `emit`. */
function wheelParts(
  style: WheelStyle,
  r: number,
  w: number,
  tireMat: Material,
  rimMat: Material,
  neonMat: Material,
  emit: (m: Mesh) => void,
): void {
  const disc = (rad: number): Mesh => new Mesh(new CylinderGeometry(rad, rad, w + 1, 10), rimMat);
  emit(new Mesh(new CylinderGeometry(r, r, w, 14), tireMat));
  switch (style) {
    case 'classic':
      emit(disc(r * 0.62));
      break;
    case 'chrome':
      emit(disc(r * 0.78));
      break;
    case 'spokes': {
      emit(disc(r * 0.2));
      for (let i = 0; i < 5; i++) {
        const spoke = new Mesh(new BoxGeometry(r * 1.3, w + 1, r * 0.16), rimMat);
        spoke.rotation.y = (i / 5) * Math.PI;
        emit(spoke);
      }
      break;
    }
    case 'turbine': {
      emit(disc(r * 0.18));
      for (let i = 0; i < 8; i++) {
        const blade = new Mesh(new BoxGeometry(r * 0.62, w + 1, r * 0.1), rimMat);
        const a = (i / 8) * Math.PI * 2;
        blade.position.set(Math.cos(a) * r * 0.36, 0, Math.sin(a) * r * 0.36);
        blade.rotation.y = -a + 0.5;
        emit(blade);
      }
      break;
    }
    case 'neon': {
      emit(disc(r * 0.55));
      const ring = new Mesh(new TorusGeometry(r * 0.72, 1.6, 6, 16), neonMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = w / 2 + 0.6;
      emit(ring);
      break;
    }
  }
}

export function buildCarMesh(spec: CarBodySpec, look: CarLook, quality: Quality): CarVisual {
  const group = new Group();
  const root = new Group();
  root.position.set(spec.visualOffset.x, spec.visualOffset.y, spec.visualOffset.z);
  group.add(root);

  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const m = spec.model;
  const shape = SHAPES[spec.id];

  const body = mk(quality, look.primary, 0.28, 0.5);
  const trim = mk(quality, look.secondary, 0.45, 0.3);
  const dark = mk(quality, 0x14171f, 0.6, 0.2);
  const glass = mk(quality, 0x0b1424, 0.05, 0.85);
  const tireMat = mk(quality, 0x15171c, 0.9, 0);
  const rimMat = mk(
    quality,
    look.wheels === 'chrome' ? 0xf2f5ff : 0xd9dde6,
    look.wheels === 'chrome' ? 0.08 : 0.3,
    look.wheels === 'chrome' ? 1 : 0.8,
  );
  const neonMat = new MeshBasicMaterial({
    color: look.primary.clone().multiplyScalar(2.2),
  });
  const baker = new Baker();

  const zb = -H / 2 + m.wheelRadius * 0.55;
  const zt = H / 2;
  const X = (f: number): number => -L / 2 + f * L;
  const Z = (f: number): number => zb + f * (zt - zb);
  const c: Ctx = { root, L, W, H, zb, zt, X, Z, body, trim, dark, add: (m) => baker.add(m) };
  const toXZ = (pts: P[]): P[] => pts.map(([fx, fz]) => [X(fx), Z(fz)]);

  c.add(new Mesh(extruded(toXZ(shape.lower), W * shape.lowerWidth, 3), body));
  c.add(new Mesh(extruded(toXZ(shape.cabin), W * shape.cabinWidth, 2), glass));
  // Techo con el color secundario.
  const roofPts = shape.cabin.filter(([, fz]) => fz >= 0.9);
  if (roofPts.length >= 2) {
    const x0 = X(roofPts[0][0]);
    const x1 = X(roofPts[roofPts.length - 1][0]);
    box(c, x1 - x0, W * shape.cabinWidth * 0.95, 2, (x0 + x1) / 2, 0, Z(roofPts[0][1]) + 1, trim);
  }
  // Faldones y parachoques.
  for (const s of [-1, 1]) {
    box(
      c,
      L * 0.6,
      3,
      (Z(0.4) - zb) * 0.32,
      L * 0.02,
      s * (W * shape.lowerWidth * 0.5 + 1),
      zb + (Z(0.4) - zb) * 0.25,
      trim,
    );
  }
  box(
    c,
    4,
    W * shape.lowerWidth * 0.8,
    (Z(0.4) - zb) * 0.3,
    X(1),
    0,
    zb + (Z(0.4) - zb) * 0.22,
    trim,
  );
  shape.extras?.(c);

  // Barra luminosa del equipo sobre el parabrisas y brillo bajo el coche.
  const teamEmissive = new MeshBasicMaterial({
    color: look.team.clone().multiplyScalar(2.4),
  });
  const roofX = shape.cabin.length >= 3 ? X(shape.cabin[shape.cabin.length - 2][0]) : X(0.6);
  // Faros delanteros y piloto trasero con el color del equipo (mismo material: sin llamadas extra).
  for (const s of [-1, 1]) {
    const head = new Mesh(new BoxGeometry(3, W * 0.2, Math.max(3, H * 0.09)), teamEmissive);
    head.position.set(X(1) + 0.5, s * W * 0.3 * shape.lowerWidth, Z(0.22));
    c.add(head);
  }
  const tail = new Mesh(new BoxGeometry(2, W * shape.lowerWidth * 0.7, 2.5), teamEmissive);
  tail.position.set(X(0) - 0.5, 0, Z(0.26));
  c.add(tail);
  const teamBar = new Mesh(new BoxGeometry(3, W * shape.cabinWidth * 0.8, 2), teamEmissive);
  teamBar.position.set(roofX + 4, 0, Z(0.97));
  c.add(teamBar);
  const glow = new Mesh(
    new PlaneGeometry(L * 1.25, W * 1.4),
    new MeshBasicMaterial({
      map: makeBlobTexture(),
      color: look.team,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  glow.position.set(0, 0, -H / 2 + 0.6);
  root.add(glow);

  addDecal(c, look.decal, shape, spec);
  addAntenna(c, look, shape);

  // Ruedas. Nivel bajo: fusionadas con la carrocería (sin giro individual); resto: animadas.
  const wheels: Group[] = [];
  const steerPivots: Group[] = [];
  const rearWheels: Vector3[] = [];
  const wx = L * 0.3;
  const wy = W / 2 - m.wheelWidth / 2 + 3;
  const wz = -H / 2 + m.wheelRadius;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      if (quality.staticWheels) {
        wheelParts(look.wheels, m.wheelRadius, m.wheelWidth, tireMat, rimMat, neonMat, (part) => {
          part.position.add(new Vector3(sx * wx, sy * wy, wz));
          baker.add(part);
        });
      } else {
        const pivot = new Group();
        pivot.position.set(sx * wx, sy * wy, wz);
        const wheel = new Group();
        const local = new Baker();
        wheelParts(look.wheels, m.wheelRadius, m.wheelWidth, tireMat, rimMat, neonMat, (part) =>
          local.add(part),
        );
        local.flush(wheel);
        pivot.add(wheel);
        root.add(pivot);
        wheels.push(wheel);
        if (sx > 0) steerPivots.push(pivot);
      }
      if (sx < 0) rearWheels.push(new Vector3(sx * wx, sy * wy, -H / 2 + 1).add(root.position));
    }
  }

  // Llamas del turbo con los colores de la estela elegida.
  const trailSpec = TRAILS[look.trail];
  const flames: Mesh[] = [];
  const flameMaterials: MeshBasicMaterial[] = [];
  const exhaust: Vector3[] = [];
  for (const sy of [-1, 1]) {
    const outerMat = new MeshBasicMaterial({
      color: new Color(trailSpec.outer),
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const flame = new Mesh(new ConeGeometry(W * 0.1, L * 0.6, 10, 1, true), outerMat);
    flame.geometry.rotateZ(Math.PI / 2); // punta hacia -x
    flame.geometry.translate(-L * 0.3, 0, 0);
    const pos = new Vector3(X(0), sy * W * 0.22, Z(0.18));
    flame.position.copy(pos);
    const coreMat = new MeshBasicMaterial({
      color: new Color(trailSpec.core),
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const core = new Mesh(new ConeGeometry(W * 0.055, L * 0.38, 8, 1, true), coreMat);
    core.geometry.rotateZ(Math.PI / 2);
    core.geometry.translate(-L * 0.19, 0, 0);
    flame.add(core);
    flame.visible = false;
    root.add(flame);
    flames.push(flame);
    flameMaterials.push(outerMat, coreMat);
    exhaust.push(pos.clone().add(root.position));
  }

  // Fusiona todo lo estático por material (una llamada de dibujo por material).
  baker.flush(root);
  const casters: Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (
      mesh.isMesh &&
      mesh !== glow &&
      !flames.includes(mesh) &&
      !flames.some((f) => f.children.includes(mesh))
    ) {
      casters.push(mesh);
    }
  });
  const setShadow = (on: boolean): void => {
    for (const m of casters) m.castShadow = on;
  };
  setShadow(true);

  return {
    group,
    steerPivots,
    wheels,
    flames,
    flameMaterials,
    trail: look.trail,
    exhaust,
    rearWheels,
    setShadow,
    dispose() {
      group.traverse((o) => {
        const mesh = o as Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as MeshStandardMaterial | undefined;
        mat?.map?.dispose();
        mat?.dispose?.();
      });
    },
  };
}

function addDecal(c: Ctx, style: DecalStyle, shape: BodyShape, spec: CarBodySpec): void {
  if (style === 'none') return;
  const half = (c.W * shape.lowerWidth) / 2;
  const mat = c.trim;
  if (style === 'stripes') {
    // Dos franjas sobre el capó (siguiendo la pendiente), el techo y el maletero.
    const lower = shape.lower;
    const nose = lower[lower.length > 7 ? 4 : 3];
    const base = lower[lower.length > 7 ? 5 : 4];
    const x0 = c.X(base[0]);
    const z0 = c.Z(base[1]);
    const x1 = c.X(nose[0]);
    const z1 = c.Z(nose[1]);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (const s of [-1, 1]) {
      const hood = new Mesh(new BoxGeometry(len, 7, 1.6), mat);
      hood.position.set((x0 + x1) / 2, s * 9, (z0 + z1) / 2 + 1.2);
      hood.rotation.y = -ang;
      c.add(hood);
      box(c, c.L * 0.1, 7, 1.6, c.X(0.08), s * 9, c.Z(0.43) + 1.2, mat);
    }
  } else if (style === 'dots') {
    for (const s of [-1, 1]) {
      for (const f of [0.3, 0.55, 0.8]) {
        const d = new Mesh(new CylinderGeometry(c.H * 0.1, c.H * 0.1, 1.5, 12), mat);
        d.position.set(c.X(f), s * (half + 0.8), c.Z(0.2));
        c.add(d);
      }
    }
  } else {
    // Cuadros a lo largo de ambos lados.
    const n = 8;
    const h = (c.Z(0.3) - c.zb) * 0.32;
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 2; j++) {
          if ((i + j) % 2 === 0) continue;
          box(
            c,
            (c.L * 0.7) / n,
            1.5,
            h,
            c.X(0.15) + ((c.L * 0.7) / n) * i,
            s * (half + 0.9),
            c.zb + h * (0.7 + j),
            mat,
          );
        }
      }
    }
  }
  void spec;
}

function addAntenna(c: Ctx, look: CarLook, shape: BodyShape): void {
  if (look.antenna === 'none') return;
  const x = c.X(0.08);
  const y = c.W * shape.lowerWidth * 0.32;
  const z0 = c.Z(0.42);
  const poleH = 34;
  const pole = new Mesh(new CylinderGeometry(1.1, 1.1, poleH, 6), c.dark);
  pole.rotation.x = Math.PI / 2;
  pole.position.set(x, y, z0 + poleH / 2);
  c.add(pole);
  const top = z0 + poleH;
  if (look.antenna === 'ball') {
    const b = new Mesh(
      new SphereGeometry(5, 10, 8),
      new MeshStandardMaterial({ color: look.team, emissive: look.team, emissiveIntensity: 0.6 }),
    );
    b.position.set(x, y, top + 3);
    c.add(b);
  } else if (look.antenna === 'flag') {
    const f = new Mesh(
      new PlaneGeometry(22, 13),
      new MeshStandardMaterial({ color: look.team, side: DoubleSide }),
    );
    f.rotation.x = Math.PI / 2;
    f.position.set(x - 11, y, top - 6);
    c.add(f);
  } else {
    const s = new Mesh(new OctahedronGeometry(6, 0), new MeshBasicMaterial({ color: 0xffd23f }));
    s.position.set(x, y, top + 5);
    c.add(s);
  }
}
