import {
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { BALL } from '../config';
import type { Quality } from './quality';
import { makeBallTexture, makeBlobTexture } from './textures';

export interface BallVisual {
  group: Group;
  mesh: Mesh;
  /** Mancha de sombra en el suelo para localizar la pelota. */
  blob: Mesh;
}

export function buildBallMesh(q: Quality): BallVisual {
  const group = new Group();
  const tex = makeBallTexture();
  tex.anisotropy = q.anisotropy;
  const material = q.lambert
    ? new MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: new Color(0x667799) })
    : new MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new Color(0x445577),
        emissiveIntensity: 0.6,
        roughness: 0.35,
        metalness: 0.25,
      });
  const mesh = new Mesh(new IcosahedronGeometry(BALL.radius, q.ballDetail), material);
  mesh.castShadow = true;
  group.add(mesh);

  const blob = new Mesh(
    new PlaneGeometry(BALL.radius * 3, BALL.radius * 3),
    new MeshBasicMaterial({
      map: makeBlobTexture(),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  blob.position.z = 1;
  return { group, mesh, blob };
}
