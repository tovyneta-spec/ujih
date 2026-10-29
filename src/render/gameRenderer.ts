// Orquesta la escena Three.js: tema, estadio, coches, pelota, pads, efectos, post-proceso, cámara e
// interpolación. También ofrece una vista previa giratoria para el garaje.
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  CylinderGeometry,
  PMREMGenerator,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_BODIES, THEMES } from '../config';
import type { CarBodyId, GoalExplosion, Theme, TrailStyle } from '../config';
import type { RenderFrame } from '../replay';
import { Vec3 } from '../sim';
import type { SimEvent, World } from '../sim';
import { buildArena } from './arenaMesh';
import type { ArenaVisual } from './arenaMesh';
import { buildBallMesh } from './ballMesh';
import type { BallVisual } from './ballMesh';
import { buildPadMeshes, updatePadVisual } from './boostPadMesh';
import type { PadVisual } from './boostPadMesh';
import { CameraRig } from './cameraRig';
import type { CameraPose } from './cameraRig';
import { buildCarMesh } from './carMesh';
import type { CarLook, CarVisual } from './carMesh';
import { DebugDraw } from './debugDraw';
import { Effects, createFxCar } from './effects';
import type { FxCar } from './effects';
import { buildStadium } from './stadium';
import type { StadiumVisual } from './stadium';

/** Opciones de dibujo para repeticiones, cámaras externas y vista previa del garaje. */
export interface RenderView {
  frame?: RenderFrame;
  pose?: CameraPose;
}

const SUN_OFFSET = new Vector3(0.45, 0.9, 0.35).normalize();
const SHADOW_RANGE = 1700;

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(110, 1, 5, 40000);
  readonly rig = new CameraRig();
  readonly debug = new DebugDraw();
  readonly effects = new Effects();
  /** Raíz en espacio de simulación (z arriba) rotada al espacio de Three (y arriba). */
  private readonly simRoot = new Group();
  private arena: ArenaVisual | null = null;
  private stadium: StadiumVisual | null = null;
  private ball: BallVisual;
  private padVisuals: PadVisual[] = [];
  private padsGroup: Group | null = null;
  private cars: { visual: CarVisual; wheelSpin: number }[] = [];
  private trails: TrailStyle[] = [];
  private explosions: GoalExplosion[] = [];
  private fxCars: FxCar[] = [];
  private sun: DirectionalLight;
  private hemi: HemisphereLight;
  private world: World | null = null;
  private focusCarId = 0;
  private ballScale = 1;
  private themeId: Theme | null = null;
  /** Posición interpolada (o de repetición) de cada coche en el último frame. */
  carRenderPos: Vec3[] = [];

  // Post-proceso.
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  // Vista previa del garaje.
  private preview: { visual: CarVisual; platform: Mesh; time: number } | null = null;
  private previewBodyId: CarBodyId = 'octane';
  private previewFx: FxCar = createFxCar();

  private carPos = new Vec3();
  private ballPos = new Vec3();
  private tq = new Quaternion();
  private tq2 = new Quaternion();
  private tv = new Vector3();
  private tmpPose: CameraPose = { position: new Vec3(), target: new Vec3(), fov: 45 };
  private width = 1;
  private height = 1;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.simRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.simRoot);

    // Reflejos baratos: entorno procedural prefiltrado una sola vez.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.hemi = new HemisphereLight(0xcfe0ff, 0x2a3350, 1.15);
    this.scene.add(this.hemi);
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

    this.ball = buildBallMesh();
    this.simRoot.add(this.ball.group, this.ball.blob);
    this.simRoot.add(this.debug.group, this.effects.group);

    // Post-proceso: bloom + tone mapping en el pase de salida; MSAA en el objetivo intermedio.
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.3, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setTheme('day');
  }

  /** Aplica un tema: reconstruye estadio y entorno (geometría idéntica, otra paleta). */
  setTheme(id: Theme): void {
    if (this.themeId === id) return;
    this.themeId = id;
    const t = THEMES[id];
    if (this.arena) {
      this.simRoot.remove(this.arena.group);
      this.arena.dispose();
    }
    if (this.stadium) {
      this.simRoot.remove(this.stadium.group);
      this.stadium.dispose();
    }
    this.arena = buildArena(t);
    this.stadium = buildStadium(t);
    this.simRoot.add(this.arena.group, this.stadium.group);
    this.scene.background = new Color(t.background);
    this.scene.fog = new Fog(t.fog, t.fogNear, t.fogFar);
    this.scene.environmentIntensity = t.envIntensity;
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = t.hemiIntensity;
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sunIntensity;
    this.renderer.toneMappingExposure = t.exposure;
    this.bloom.strength = t.bloom.strength;
    this.bloom.radius = t.bloom.radius;
    this.bloom.threshold = t.bloom.threshold;
  }

  /** Escala visual de la pelota (mutador de tamaño). */
  setBallScale(scale: number): void {
    this.ball.mesh.scale.setScalar(scale);
    this.ballScale = scale;
  }

  /**
   * Crea los objetos visuales de un mundo. `lookOf` define la apariencia de cada coche y
   * `explosionOf` el estilo de explosión de gol de su dueño.
   */
  setWorld(
    world: World,
    focusCarId: number,
    lookOf: (carId: number) => CarLook,
    explosionOf: (carId: number) => GoalExplosion = () => 'classic',
  ): void {
    this.world = world;
    this.focusCarId = focusCarId;
    for (const c of this.cars) {
      this.simRoot.remove(c.visual.group);
      c.visual.dispose();
    }
    if (this.padsGroup) this.simRoot.remove(this.padsGroup);
    this.trails = [];
    this.explosions = [];
    this.cars = world.cars.map((car) => {
      const look = lookOf(car.id);
      const visual = buildCarMesh(CAR_BODIES[car.body.id], look);
      this.simRoot.add(visual.group);
      this.trails.push(look.trail);
      this.explosions.push(explosionOf(car.id));
      return { visual, wheelSpin: 0 };
    });
    this.carRenderPos = world.cars.map(() => new Vec3());
    this.fxCars = world.cars.map(() => createFxCar());
    const pads = buildPadMeshes(world.pads);
    this.simRoot.add(pads.group);
    this.padsGroup = pads.group;
    this.padVisuals = pads.visuals;
    this.debug.setCars(world.cars);
    this.effects.clear();
    this.stadium?.setScore(0, 0);
    this.rig.reset();
  }

  /** Reacciona a eventos de la simulación (efectos, público, marcador). */
  onEvent(e: SimEvent): void {
    const world = this.world;
    if (!world) return;
    this.effects.onEvent(e, world, (id) => this.explosions[id] ?? 'classic');
    if (e.type === 'matchGoal') {
      this.stadium?.excite(1);
      this.stadium?.setScore(world.match.score[0], world.match.score[1]);
    } else if (e.type === 'kickoffReset' && world.match.enabled) {
      this.stadium?.setScore(world.match.score[0], world.match.score[1]);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = Math.max(1, height);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.effects.setViewportHeight(height * this.renderer.getPixelRatio());
  }

  // ------------------------------------------------------------ vista previa

  /** Muestra (o reconstruye) el coche del garaje sobre una plataforma giratoria. */
  setPreview(bodyId: CarBodyId, look: CarLook): void {
    this.clearPreview();
    const spec = CAR_BODIES[bodyId];
    const visual = buildCarMesh(spec, look);
    visual.group.position.set(0, 0, spec.height / 2 + 4);
    const platform = new Mesh(
      new CylinderGeometry(260, 280, 8, 40),
      new MeshStandardMaterial({ color: 0x20263a, roughness: 0.4, metalness: 0.6 }),
    );
    platform.rotation.x = Math.PI / 2;
    platform.position.set(0, 0, 2);
    this.simRoot.add(visual.group, platform);
    this.preview = { visual, platform, time: this.preview?.time ?? 0 };
    this.previewBodyId = bodyId;
    this.trails = [look.trail];
    this.explosions = ['classic'];
  }

  clearPreview(): void {
    if (!this.preview) return;
    this.simRoot.remove(this.preview.visual.group, this.preview.platform);
    this.preview.visual.dispose();
    this.preview.platform.geometry.dispose();
    this.preview = null;
  }

  get previewActive(): boolean {
    return this.preview !== null;
  }

  /** Dispara una explosión de gol de muestra sobre el coche del garaje. */
  previewExplosion(style: GoalExplosion): void {
    this.effects.setScale(0.3);
    this.effects.goalExplosion(0, style, new Vec3(0, 0, 120));
    this.effects.setScale(1);
  }

  /** Dibuja la vista previa del garaje (panel a la izquierda, coche a la derecha). */
  renderPreview(dt: number): void {
    const p = this.preview;
    if (!p) return;
    p.time += dt;
    const spec = CAR_BODIES[this.previewBodyId];
    const ang = p.time * 0.5;
    p.visual.group.rotation.z = ang;
    for (const f of p.visual.flames) {
      f.visible = true;
      f.scale.set(0.85 + Math.random() * 0.3, 1, 1);
    }
    for (const w of p.visual.wheels) w.rotation.y = -p.time * 6;

    // Todo lo demás del mundo queda oculto.
    for (const c of this.cars) c.visual.group.visible = false;
    this.ball.group.visible = false;
    this.ball.blob.visible = false;
    if (this.padsGroup) this.padsGroup.visible = false;

    const fx = this.previewFx;
    fx.pos.set(0, 0, spec.height / 2 + 4);
    fx.quat.set(0, 0, Math.sin(ang / 2), Math.cos(ang / 2));
    fx.boosting = true;
    fx.grounded = true;
    fx.fwdSpeed = 800;
    fx.handbrake = false;
    this.effects.setScale(0.3);
    this.effects.update(dt, [fx], [p.visual], this.ballPos.set(0, 0, 9999), this.trails);
    this.effects.setScale(1);
    this.stadium?.update(dt);

    const pose = this.tmpPose;
    pose.position.set(Math.cos(0.7) * 420, Math.sin(0.7) * 420, 170);
    pose.target.set(0, 0, 40);
    pose.fov = 40;
    this.applyPose(pose);
    this.camera.setViewOffset(
      this.width,
      this.height,
      -this.width * 0.17,
      0,
      this.width,
      this.height,
    );
    this.sun.target.position.set(0, 0, 0);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_OFFSET, 2500);
    this.composer.render(dt);
    this.camera.clearViewOffset();
    for (const c of this.cars) c.visual.group.visible = true;
    this.ball.group.visible = true;
    this.ball.blob.visible = true;
    if (this.padsGroup) this.padsGroup.visible = true;
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.set(pose.position.x, pose.position.z, -pose.position.y);
    this.tv.set(pose.target.x, pose.target.z, -pose.target.y);
    this.camera.lookAt(this.tv);
    if (Math.abs(this.camera.fov - pose.fov) > 0.01) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ juego

  /**
   * Dibuja un frame. Sin `view`, interpola entre los dos últimos pasos de física y usa la cámara de
   * juego; con `view.frame` dibuja un estado grabado (repetición) y con `view.pose` usa esa cámara.
   */
  render(alpha: number, frameDt: number, view?: RenderView): void {
    const world = this.world;
    if (!world) return;
    const frame = view?.frame;
    this.lastTime += frameDt;

    // Pelota.
    const b = world.ball;
    if (frame) {
      this.ballPos.copy(frame.ballPos);
      this.tq.set(frame.ballQuat.x, frame.ballQuat.y, frame.ballQuat.z, frame.ballQuat.w);
    } else {
      this.ballPos.set(
        b.prevPos.x + (b.pos.x - b.prevPos.x) * alpha,
        b.prevPos.y + (b.pos.y - b.prevPos.y) * alpha,
        b.prevPos.z + (b.pos.z - b.prevPos.z) * alpha,
      );
      this.tq.set(b.prevQuat.x, b.prevQuat.y, b.prevQuat.z, b.prevQuat.w);
      this.tq2.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
      this.tq.slerp(this.tq2, alpha);
    }
    this.ball.group.position.set(this.ballPos.x, this.ballPos.y, this.ballPos.z);
    this.ball.group.quaternion.copy(this.tq);
    this.ball.blob.position.set(this.ballPos.x, this.ballPos.y, 1);
    const height = this.ballPos.z;
    const s = (1 + height / 900) * this.ballScale;
    this.ball.blob.scale.set(s, s, 1);
    (this.ball.blob.material as { opacity: number }).opacity = Math.max(0.15, 0.8 - height / 1800);

    // Coches.
    world.cars.forEach((car, i) => {
      const v = this.cars[i];
      const fx = this.fxCars[i];
      const g = v.visual.group;
      let px: number;
      let py: number;
      let pz: number;
      let demolished: boolean;
      let boosting: boolean;
      let grounded: boolean;
      let steerIn: number;
      let fwdSpeed: number;
      let handbrake = false;
      if (frame) {
        const fc = frame.cars[i];
        px = fc.pos.x;
        py = fc.pos.y;
        pz = fc.pos.z;
        this.tq.set(fc.quat.x, fc.quat.y, fc.quat.z, fc.quat.w);
        demolished = fc.demolished;
        boosting = fc.boosting;
        grounded = fc.grounded;
        steerIn = fc.steer;
        fwdSpeed = fc.forwardSpeed;
      } else {
        px = car.prevPos.x + (car.pos.x - car.prevPos.x) * alpha;
        py = car.prevPos.y + (car.pos.y - car.prevPos.y) * alpha;
        pz = car.prevPos.z + (car.pos.z - car.prevPos.z) * alpha;
        this.tq.set(car.prevQuat.x, car.prevQuat.y, car.prevQuat.z, car.prevQuat.w);
        this.tq2.set(car.quat.x, car.quat.y, car.quat.z, car.quat.w);
        this.tq.slerp(this.tq2, alpha);
        demolished = car.demolished;
        boosting = car.boosting;
        grounded = car.grounded;
        steerIn = car.input.steer;
        fwdSpeed = car.forwardSpeed;
        handbrake = car.input.handbrake;
      }
      g.position.set(px, py, pz);
      g.quaternion.copy(this.tq);
      g.visible = !demolished;
      this.carRenderPos[i].set(px, py, pz);

      // Ruedas: giro por distancia recorrida y dirección visual.
      v.wheelSpin += (fwdSpeed * frameDt) / car.body.model.wheelRadius;
      for (const w of v.visual.wheels) w.rotation.y = -v.wheelSpin;
      const steer = grounded ? -steerIn * 0.45 : 0;
      for (const p of v.visual.steerPivots)
        p.rotation.z += (steer - p.rotation.z) * Math.min(1, frameDt * 14);
      // Llamas (con ciclo de color en la estela arcoíris).
      const flicker = 0.85 + Math.random() * 0.3;
      for (const f of v.visual.flames) {
        f.visible = boosting;
        f.scale.set(flicker, 1, 1);
      }
      if (v.visual.trail === 'rainbow' && boosting) {
        v.visual.flameMaterials[0].color.setHSL((this.lastTime * 0.7) % 1, 1, 0.55);
        v.visual.flameMaterials[2].color.setHSL((this.lastTime * 0.7 + 0.5) % 1, 1, 0.55);
      }
      if (car.id === this.focusCarId) this.carPos.set(px, py, pz);

      // Estado para efectos.
      fx.pos.set(px, py, pz);
      fx.quat.set(this.tq.x, this.tq.y, this.tq.z, this.tq.w);
      fx.boosting = boosting && !demolished;
      fx.grounded = grounded;
      fx.fwdSpeed = fwdSpeed;
      fx.handbrake = handbrake;
      fx.demolished = demolished;
    });

    for (const p of this.padVisuals) updatePadVisual(p);
    this.effects.update(
      frameDt,
      this.fxCars,
      this.cars.map((c) => c.visual),
      this.ballPos,
      this.trails,
    );
    this.stadium?.update(frameDt);

    // Cámara.
    const focus = world.cars[this.focusCarId];
    let pose: CameraPose | null = view?.pose ?? null;
    if (!pose && focus) {
      pose = this.rig.update(frameDt, this.carPos, focus.forward, this.ballPos, focus.boosting);
    }
    if (pose) this.applyPose(pose);

    // Sombras: la cámara de sombra sigue al foco (más densidad de texel que cubrir todo el estadio).
    const sx = view?.pose ? this.ballPos.x : this.carPos.x;
    const sy = view?.pose ? this.ballPos.y : this.carPos.y;
    this.sun.target.position.set(sx, 0, -sy);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_OFFSET, 2500);

    this.debug.update(alpha);
    this.composer.render(frameDt);
  }

  /** Proyecta un punto de la simulación a píxeles de pantalla; devuelve false si queda detrás de la cámara. */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.tv.set(x, z, -y).project(this.camera);
    out.x = (this.tv.x * 0.5 + 0.5) * this.renderer.domElement.clientWidth;
    out.y = (-this.tv.y * 0.5 + 0.5) * this.renderer.domElement.clientHeight;
    return this.tv.z < 1;
  }

  dispose(): void {
    this.arena?.dispose();
    this.stadium?.dispose();
    this.effects.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
