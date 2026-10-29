// Sombras falsas instanciadas (una sola llamada de dibujo) para el nivel de calidad bajo.
import {
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { makeBlobTexture } from './textures';

export class ShadowBlobs {
  readonly mesh: InstancedMesh;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private axis = new Vector3(0, 0, 1);

  constructor(readonly capacity: number) {
    this.mesh = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: makeBlobTexture(),
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: DoubleSide,
      }),
      capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Coloca la mancha `i` en el suelo bajo (x, y); `z` (altura) la hace más pequeña. */
  set(
    i: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    length: number,
    width: number,
  ): void {
    const k = 1 / (1 + Math.max(0, z) / 700);
    this.q.setFromAxisAngle(this.axis, yaw);
    this.p.set(x, y, 1.2);
    this.s.set(length * k, width * k, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }

  commit(count: number): void {
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
