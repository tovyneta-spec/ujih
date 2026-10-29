import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';

import type { BoostPad } from '../sim';

export interface PadVisual {
  group: Group;
  pad: BoostPad;
  ring: Mesh;
  glow: Mesh;
}

export function buildPadMeshes(pads: readonly BoostPad[]): { group: Group; visuals: PadVisual[] } {
  const group = new Group();
  const visuals: PadVisual[] = [];
  for (const pad of pads) {
    const big = pad.spec.size === 'big';
    const r = big ? 70 : 38;
    const color = new Color(big ? 0xffa21f : 0xffe066);
    const g = new Group();
    g.position.set(pad.spec.x, pad.spec.y, 1.5);
    const ring = new Mesh(
      new TorusGeometry(r, big ? 7 : 4, 8, 28),
      new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4 }),
    );
    const glow = new Mesh(
      new CylinderGeometry(r * 0.9, r * 0.9, big ? 150 : 70, 18, 1, true),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: big ? 0.28 : 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.rotation.x = Math.PI / 2;
    glow.position.z = big ? 75 : 35;
    g.add(ring, glow);
    group.add(g);
    visuals.push({ group: g, pad, ring, glow });
  }
  return { group, visuals };
}

const OFF = new Color(0x3a3320);
const tmpC = new Color();

export function updatePadVisual(v: PadVisual): void {
  const active = v.pad.active;
  v.glow.visible = active;
  const mat = v.ring.material as MeshStandardMaterial;
  const big = v.pad.spec.size === 'big';
  tmpC.set(big ? 0xffa21f : 0xffe066);
  mat.color.copy(active ? tmpC : OFF);
  mat.emissive.copy(active ? tmpC : OFF);
  mat.emissiveIntensity = active ? 1.4 : 0.1;
}
