// Pads de turbo: dos mallas instanciadas (anillos y haces de luz) para los 34 pads, con color por
// instancia. Sólo se actualizan las matrices de los pads que cambian de estado.
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BoostPad } from '../sim';

export interface PadVisuals {
  group: Group;
  /** Sincroniza el aspecto con el estado de los pads (barato: sólo procesa los que cambian). */
  update(): void;
  dispose(): void;
}

const OFF = new Color(0x3a3320);
const BIG = new Color(0xffa21f);
const SMALL = new Color(0xffe066);

export function buildPadMeshes(pads: readonly BoostPad[]): PadVisuals {
  const group = new Group();
  const n = pads.length;
  const ringMat = new MeshBasicMaterial({ color: 0xffffff });
  const rings = new InstancedMesh(new TorusGeometry(1, 0.1, 8, 28), ringMat, n);
  const glowMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glows = new InstancedMesh(new CylinderGeometry(1, 1, 1, 18, 1, true), glowMat, n);
  rings.frustumCulled = glows.frustumCulled = false;
  group.add(rings, glows);

  const last: (boolean | null)[] = pads.map(() => null);
  const m = new Matrix4();
  const tmpColor = new Color();
  const qUp = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
  const qFlat = new Quaternion();

  const apply = (i: number): void => {
    const pad = pads[i];
    const big = pad.spec.size === 'big';
    const r = big ? 70 : 38;
    const active = pad.active;
    m.compose(new Vector3(pad.spec.x, pad.spec.y, 1.5), qFlat, new Vector3(r, r, r));
    rings.setMatrixAt(i, m);
    tmpColor.copy(active ? (big ? BIG : SMALL) : OFF).multiplyScalar(active ? 1.6 : 1);
    rings.setColorAt(i, tmpColor);
    // Haz de luz: invisible (escala 0) mientras el pad está desactivado.
    const h = big ? 150 : 70;
    const k = active ? 1 : 0;
    m.compose(
      new Vector3(pad.spec.x, pad.spec.y, 1.5 + h / 2),
      qUp,
      new Vector3(r * 0.9 * k, h * k, r * 0.9 * k),
    );
    glows.setMatrixAt(i, m);
    glows.setColorAt(i, big ? BIG : SMALL);
  };
  pads.forEach((_p, i) => apply(i));
  for (const mesh of [rings, glows]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    group,
    update(): void {
      let dirty = false;
      for (let i = 0; i < n; i++) {
        if (pads[i].active === last[i]) continue;
        last[i] = pads[i].active;
        apply(i);
        dirty = true;
      }
      if (!dirty) return;
      for (const mesh of [rings, glows]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose(): void {
      rings.geometry.dispose();
      glows.geometry.dispose();
      ringMat.dispose();
      glowMat.dispose();
    },
  };
}
