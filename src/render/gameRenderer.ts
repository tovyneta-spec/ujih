// Orquesta la escena Three.js: estadio, coches, pelota, pads, luces, cámara e interpolación.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CAR_BODIES } from '../config';
import type { World } from '../sim';
import { buildArena } from './arenaMesh';
import type { ArenaVisual } from './arenaMesh';
import { buildBallMesh } from './ballMesh';
import type { BallVisual } from './ballMesh';
import { buildPadMeshes, updatePadVisual } from './boostPadMesh';
import type { PadVisual } from './boostPadMesh';
import { CameraRig } from './cameraRig';
import { buildCarMesh } from './carMesh';
import type { CarVisual } from './carMesh';
import { DebugDraw } from './debugDraw';
import { TEAM_COLORS } from './arenaMesh';
import { Vec3 } from '../sim';

const SUN_OFFSET = new Vector3(0.45, 0.9, 0.35).normalize();
const SHADOW_RANGE = 1700;

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(110, 1, 5, 30000);
  readonly rig = new CameraRig();
  readonly debug = new DebugDraw();
  /** Raíz en espacio de simulación (z arriba) rotada al espacio de Three (y arriba). */
  private readonly simRoot = new Group();
  private arena: ArenaVisual;
  private ball: BallVisual;
  private padVisuals: PadVisual[] = [];
  private cars: { visual: CarVisual; wheelSpin: number }[] = [];
  private sun: DirectionalLight;
  private world: World | null = null;
  private focusCarId = 0;
  private ballScale = 1;

  private carPos = new Vec3();
  private ballPos = new Vec3();
  private tq = new Quaternion();
  private tq2 = new Quaternion();
  private tv = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene.background = new Color(0x0a1022);
    this.scene.fog = new Fog(0x0a1022, 9000, 22000);
    this.simRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.simRoot);

    this.scene.add(new HemisphereLight(0xcfe0ff, 0x2a3350, 1.15));
    this.sun = new DirectionalLight(0xfff3dd, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_RANGE;
    sc.right = SHADOW_RANGE;
    sc.top = SHADOW_RANGE;
    sc.bottom = -SHADOW_RANGE;
    sc.near = 100;
    sc.far = 6000;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 2;
    this.scene.add(this.sun, this.sun.target);

    this.arena = buildArena();
    this.simRoot.add(this.arena.group);
    this.ball = buildBallMesh();
    this.simRoot.add(this.ball.group, this.ball.blob);
    this.simRoot.add(this.debug.group);
  }

  /** Escala visual de la pelota (mutador de tamaño). */
  setBallScale(scale: number): void {
    this.ball.mesh.scale.setScalar(scale);
    this.ballScale = scale;
  }

  /** Crea los objetos visuales de un mundo (coches, pads). */
  setWorld(world: World, focusCarId = 0): void {
    this.world = world;
    this.focusCarId = focusCarId;
    for (const c of this.cars) this.simRoot.remove(c.visual.group);
    this.cars = world.cars.map((car) => {
      const primary = car.team === 0 ? TEAM_COLORS.blue : TEAM_COLORS.orange;
      const secondary = new Color(0x1b2236);
      const visual = buildCarMesh(CAR_BODIES[car.body.id], primary, secondary);
      this.simRoot.add(visual.group);
      return { visual, wheelSpin: 0 };
    });
    const pads = buildPadMeshes(world.pads);
    this.simRoot.add(pads.group);
    this.padVisuals = pads.visuals;
    this.debug.setCars(world.cars);
    this.rig.reset();
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Dibuja un frame interpolando entre los dos últimos pasos de física. */
  render(alpha: number, frameDt: number): void {
    const world = this.world;
    if (!world) return;

    // Pelota.
    const b = world.ball;
    this.ballPos.set(
      b.prevPos.x + (b.pos.x - b.prevPos.x) * alpha,
      b.prevPos.y + (b.pos.y - b.prevPos.y) * alpha,
      b.prevPos.z + (b.pos.z - b.prevPos.z) * alpha,
    );
    this.ball.group.position.set(this.ballPos.x, this.ballPos.y, this.ballPos.z);
    this.tq.set(b.prevQuat.x, b.prevQuat.y, b.prevQuat.z, b.prevQuat.w);
    this.tq2.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
    this.ball.group.quaternion.copy(this.tq.slerp(this.tq2, alpha));
    this.ball.blob.position.set(this.ballPos.x, this.ballPos.y, 1);
    const height = this.ballPos.z;
    const s = (1 + height / 900) * this.ballScale;
    this.ball.blob.scale.set(s, s, 1);
    (this.ball.blob.material as { opacity: number }).opacity = Math.max(0.15, 0.8 - height / 1800);

    // Coches.
    world.cars.forEach((car, i) => {
      const v = this.cars[i];
      const g = v.visual.group;
      const px = car.prevPos.x + (car.pos.x - car.prevPos.x) * alpha;
      const py = car.prevPos.y + (car.pos.y - car.prevPos.y) * alpha;
      const pz = car.prevPos.z + (car.pos.z - car.prevPos.z) * alpha;
      g.position.set(px, py, pz);
      this.tq.set(car.prevQuat.x, car.prevQuat.y, car.prevQuat.z, car.prevQuat.w);
      this.tq2.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
      g.quaternion.copy(this.tq.slerp(this.tq2, alpha));
      g.visible = !car.demolished;

      // Ruedas: giro por distancia recorrida y dirección visual.
      v.wheelSpin += (car.forwardSpeed * frameDt) / car.body.model.wheelRadius;
      for (const w of v.visual.wheels) w.rotation.y = -v.wheelSpin;
      const steer = car.grounded ? -car.input.steer * 0.45 : 0;
      for (const p of v.visual.steerPivots)
        p.rotation.z += (steer - p.rotation.z) * Math.min(1, frameDt * 14);
      // Llamas.
      const flicker = 0.85 + Math.random() * 0.3;
      for (const f of v.visual.flames) {
        f.visible = car.boosting;
        f.scale.set(flicker, 1, 1);
      }
      if (car.id === this.focusCarId) this.carPos.set(px, py, pz);
    });

    for (const p of this.padVisuals) updatePadVisual(p);

    // Cámara.
    const focus = world.cars[this.focusCarId];
    if (focus) {
      const fwd = focus.forward;
      const pose = this.rig.update(frameDt, this.carPos, fwd, this.ballPos, focus.boosting);
      this.camera.position.set(pose.position.x, pose.position.z, -pose.position.y);
      this.tv.set(pose.target.x, pose.target.z, -pose.target.y);
      this.camera.lookAt(this.tv);
      if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
        this.camera.fov = pose.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    // Sombras: la cámara de sombra sigue al coche (más densidad de texel que cubrir todo el estadio).
    this.sun.target.position.set(this.carPos.x, 0, -this.carPos.y);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_OFFSET, 2500);

    this.debug.update(alpha);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.arena.dispose();
    this.renderer.dispose();
  }
}
