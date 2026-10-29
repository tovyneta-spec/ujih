// Modelo procedural low-poly del coche (sin assets externos). Ejes locales: x adelante, y izquierda, z arriba.
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
} from 'three';
import type { CarBodySpec } from '../config';

export interface CarVisual {
  group: Group;
  /** Pivotes de dirección de las ruedas delanteras. */
  steerPivots: Group[];
  wheels: Mesh[];
  flames: Mesh[];
  setColors(primary: Color, secondary: Color): void;
}

function extruded(points: [number, number][], depth: number, bevel: number): ExtrudeGeometry {
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
  geo.rotateX(Math.PI / 2); // forma (x,y) → (x,z) ; extrusión → eje y
  return geo;
}

export function buildCarMesh(spec: CarBodySpec, primary: Color, secondary: Color): CarVisual {
  const group = new Group();
  const root = new Group();
  root.position.set(spec.visualOffset.x, spec.visualOffset.y, spec.visualOffset.z);
  group.add(root);

  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const m = spec.model;

  const bodyMat = new MeshStandardMaterial({ color: primary, roughness: 0.35, metalness: 0.35 });
  const trimMat = new MeshStandardMaterial({ color: secondary, roughness: 0.5, metalness: 0.2 });
  const glassMat = new MeshStandardMaterial({ color: 0x0b1424, roughness: 0.08, metalness: 0.7 });
  const tireMat = new MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });
  const rimMat = new MeshStandardMaterial({ color: 0xd9dde6, roughness: 0.3, metalness: 0.8 });

  const zb = -H / 2 + m.wheelRadius * 0.55;
  const zt = H / 2;
  const zd = zb + (zt - zb) * (1 - m.cabinHeight);
  const xr = -L / 2;
  const xf = L / 2;
  const xCabR = xr + L * m.cabinStart;
  const xCabF = xr + L * m.cabinEnd;
  const inset = L * 0.07;

  const lower = extruded(
    [
      [xr, zb],
      [xf, zb],
      [xf, zb + (zd - zb) * 0.55],
      [xCabF, zd],
      [xCabR, zd],
      [xr, zd - (zd - zb) * 0.15],
    ],
    W * 0.9,
    3,
  );
  root.add(new Mesh(lower, bodyMat));

  const cabin = extruded(
    [
      [xCabR, zd],
      [xCabR + inset, zt],
      [xCabF - inset * 1.4, zt],
      [xCabF, zd],
    ],
    W * 0.72,
    2,
  );
  root.add(new Mesh(cabin, glassMat));

  // Techo, alerón y faldones con el color secundario.
  const roof = new Mesh(new BoxGeometry(xCabF - xCabR - inset * 2.6, W * 0.7, 2), trimMat);
  roof.position.set((xCabR + xCabF) / 2 - inset * 0.2, 0, zt + 1);
  root.add(roof);
  const spoiler = new Mesh(new BoxGeometry(L * 0.07, W * 0.85, 3), trimMat);
  spoiler.position.set(xr + L * 0.03, 0, zd + 3);
  root.add(spoiler);
  for (const s of [-1, 1]) {
    const skirt = new Mesh(new BoxGeometry(L * 0.62, 3, (zd - zb) * 0.3), trimMat);
    skirt.position.set(L * 0.02, s * (W * 0.45 + 1), zb + (zd - zb) * 0.25);
    root.add(skirt);
  }
  const bumper = new Mesh(new BoxGeometry(4, W * 0.8, (zd - zb) * 0.3), trimMat);
  bumper.position.set(xf, 0, zb + (zd - zb) * 0.22);
  root.add(bumper);

  // Ruedas.
  const wheels: Mesh[] = [];
  const steerPivots: Group[] = [];
  const wx = L * 0.3;
  const wy = W / 2 - m.wheelWidth / 2 + 3;
  const wz = -H / 2 + m.wheelRadius;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const pivot = new Group();
      pivot.position.set(sx * wx, sy * wy, wz);
      const wheel = new Mesh(
        new CylinderGeometry(m.wheelRadius, m.wheelRadius, m.wheelWidth, 16),
        tireMat,
      );
      const rim = new Mesh(
        new CylinderGeometry(m.wheelRadius * 0.62, m.wheelRadius * 0.62, m.wheelWidth + 1, 10),
        rimMat,
      );
      wheel.add(rim);
      pivot.add(wheel);
      root.add(pivot);
      wheels.push(wheel);
      if (sx > 0) steerPivots.push(pivot);
    }
  }

  // Llamas del turbo (se escalan según el uso).
  const flames: Mesh[] = [];
  const flameMat = new MeshBasicMaterial({
    color: 0xffa33a,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (const sy of [-1, 1]) {
    const flame = new Mesh(new ConeGeometry(W * 0.09, L * 0.55, 10, 1, true), flameMat);
    flame.geometry.rotateZ(Math.PI / 2); // punta hacia -x
    flame.geometry.translate(-L * 0.28, 0, 0);
    flame.position.set(xr, sy * W * 0.22, zd - (zd - zb) * 0.35);
    flame.visible = false;
    root.add(flame);
    flames.push(flame);
  }

  root.traverse((o) => {
    o.castShadow = true;
  });

  return {
    group,
    steerPivots,
    wheels,
    flames,
    setColors(p, s) {
      bodyMat.color.copy(p);
      trimMat.color.copy(s);
    },
  };
}
