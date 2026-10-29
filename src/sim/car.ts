import { CAR, PHYSICS, sampleCurve } from '../config';
import type { CarBodySpec } from '../config';
import { arenaQuery } from './arena';
import type { BoostPad } from './pads';
import { copyInput, neutralInput } from './input';
import type { CarInput } from './input';
import { Quat, Vec3, clamp } from './math';

/** Reglas globales que afectan al coche (mutadores). */
export interface CarRules {
  gravityScale: number;
  boostMode: 'normal' | 'none' | 'unlimited' | 'recharge';
  boostStrength: number;
  /** Turbo con el que se empieza cada saque / reaparición. */
  startBoost: number;
}

export const DEFAULT_RULES: CarRules = {
  gravityScale: 1,
  boostMode: 'normal',
  boostStrength: 1,
  startBoost: CAR.boost.start,
};

/** Recarga de turbo (uu/s) en el modo "recarga". */
const RECHARGE_RATE = 10;

const n = new Vec3();
const f = new Vec3();
const left = new Vec3();
const tmp = new Vec3();
const wl = new Vec3();
const corner = new Vec3();
const cn = new Vec3();

/** Esquinas locales de la hitbox: las 4 primeras (z<0) son las "ruedas". */
const CORNER_SIGNS: readonly [number, number, number][] = [
  [1, 1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, -1],
  [1, 1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [-1, -1, 1],
];

export class Car {
  readonly id: number;
  team: 0 | 1;
  body: CarBodySpec;

  pos = new Vec3();
  vel = new Vec3();
  quat = new Quat();
  angVel = new Vec3();
  prevPos = new Vec3();
  prevQuat = new Quat();

  /** Semiextensiones de la hitbox y esquinas locales. */
  half = new Vec3();
  corners: Vec3[] = CORNER_SIGNS.map(() => new Vec3());
  invInertiaLocal = new Vec3();
  readonly mass: number = CAR.mass;

  input: CarInput = neutralInput();
  prevJump = false;

  boost: number = CAR.boost.start;
  boostTimer = 0;
  boosting = false;
  prevBoostInput = false;

  // Ejes del coche en el mundo.
  forward = new Vec3(1, 0, 0);
  leftAxis = new Vec3(0, 1, 0);
  up = new Vec3(0, 0, 1);

  // Contacto.
  wheelContact: boolean[] = [false, false, false, false];
  wheelsInContact = 0;
  bodyContact = false;
  grounded = false;
  supported = false;
  surfaceNormal = new Vec3(0, 0, 1);
  bodyNormal = new Vec3(0, 0, 1);

  // Salto y flip.
  isJumping = false;
  jumpTimer = 0;
  jumpDir = new Vec3(0, 0, 1);
  groundLock = 0;
  airTime = 0;
  flipUsed = false;
  flipActive = false;
  flipTimer = 0;
  flipForward = 0;
  flipSide = 0;

  // Derivados para HUD/render.
  forwardSpeed = 0;
  speed = 0;
  supersonic = false;
  /** Ángulo acumulado de giro de ruedas (rad) para el render. */
  steerVisual = 0;

  // Estadísticas de contacto.
  lastBallTouchTick = -1;
  lastWallHitTick = -100;
  lastPadPickup: BoostPad | null = null;
  /** Reservado para las demoliciones (F2): un coche destruido no interactúa. */
  demolished = false;
  respawnTimer = 0;
  /** Radio envolvente de la hitbox (fase ancha). */
  radius = 0;

  constructor(id: number, team: 0 | 1, body: CarBodySpec) {
    this.id = id;
    this.team = team;
    this.body = body;
    this.half.set(body.length / 2, body.width / 2, body.height / 2);
    const m = CAR.mass;
    const l = body.length;
    const w = body.width;
    const h = body.height;
    this.invInertiaLocal.set(
      12 / (m * (w * w + h * h)),
      12 / (m * (l * l + h * h)),
      12 / (m * (l * l + w * w)),
    );
    CORNER_SIGNS.forEach((s, i) => {
      this.corners[i].set(s[0] * this.half.x, s[1] * this.half.y, s[2] * this.half.z);
    });
    this.radius = this.half.length();
    this.updateAxes();
  }

  /** Coloca el coche en el suelo mirando en la dirección `yaw` (rad, 0 = +x). */
  place(x: number, y: number, yaw: number): void {
    this.pos.set(x, y, this.half.z + 0.5);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.copy(Quat.fromAxisAngle(0, 0, 1, yaw));
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.boost = CAR.boost.start;
    this.boostTimer = 0;
    this.boosting = false;
    this.isJumping = false;
    this.flipActive = false;
    this.flipUsed = false;
    this.airTime = 0;
    this.groundLock = 0;
    this.prevJump = false;
    this.demolished = false;
    this.respawnTimer = 0;
    this.updateAxes();
  }

  savePrev(): void {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  setInput(i: CarInput): void {
    copyInput(i, this.input);
  }

  updateAxes(): void {
    this.quat.rotate(AX_X, this.forward);
    this.quat.rotate(AX_Y, this.leftAxis);
    this.quat.rotate(AX_Z, this.up);
  }

  /** Aplica el tensor de inercia inverso (diagonal en ejes locales) a un vector del mundo. */
  applyInvInertia(v: Vec3, out: Vec3): Vec3 {
    this.quat.unrotate(v, out);
    out.set(
      out.x * this.invInertiaLocal.x,
      out.y * this.invInertiaLocal.y,
      out.z * this.invInertiaLocal.z,
    );
    return this.quat.rotate(out, out);
  }

  /** Posición mundial de una esquina de la hitbox. */
  cornerWorld(i: number, out: Vec3): Vec3 {
    this.quat.rotate(this.corners[i], out);
    return out.add(this.pos);
  }

  /** Detecta contactos de ruedas y carrocería con el estadio. */
  computeContacts(): void {
    const tol = CAR.wheelContactTolerance;
    let wheels = 0;
    let bodyHits = 0;
    this.surfaceNormal.set(0, 0, 0);
    this.bodyNormal.set(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      this.cornerWorld(i, corner);
      const d = arenaQuery(corner.x, corner.y, corner.z, cn);
      const touching = d < tol;
      if (i < 4) {
        this.wheelContact[i] = touching;
        if (touching) {
          wheels++;
          this.surfaceNormal.add(cn);
        }
      }
      if (touching) {
        bodyHits++;
        this.bodyNormal.add(cn);
      }
    }
    this.wheelsInContact = wheels;
    this.bodyContact = bodyHits > 0;
    if (wheels > 0) this.surfaceNormal.normalize();
    else this.surfaceNormal.copy(this.up);
    if (bodyHits > 0) this.bodyNormal.normalize();
  }

  /** Un paso de control y movimiento (sin resolver colisiones). */
  step(dt: number, rules: CarRules = DEFAULT_RULES): void {
    const inp = this.input;
    const c = CAR;
    this.updateAxes();
    this.computeContacts();

    if (this.groundLock > 0) this.groundLock = Math.max(0, this.groundLock - dt);
    const locked = this.groundLock > 0;
    this.grounded = !locked && this.wheelsInContact >= c.groundedWheels;
    const touching = !locked && this.wheelsInContact >= 1;
    this.supported = this.grounded || (!locked && this.bodyContact);

    if (this.supported) {
      this.airTime = 0;
      this.flipUsed = false;
      this.flipActive = false;
    } else {
      this.airTime += dt;
    }

    // --- Salto / doble salto / flip ---
    const jumpPressed = inp.jump && !this.prevJump;
    this.prevJump = inp.jump;
    if (jumpPressed) {
      if (this.supported) this.startJump();
      else if (!this.flipUsed && this.airTime < c.jump.flipWindow) this.startDodge();
    }
    if (!inp.jump) this.isJumping = false;

    let ax = 0;
    let ay = 0;
    let az = PHYSICS.gravity * rules.gravityScale;
    if (this.isJumping) {
      this.jumpTimer += dt;
      if (this.jumpTimer < c.jump.holdTime) {
        ax += this.jumpDir.x * c.jump.holdAccel;
        ay += this.jumpDir.y * c.jump.holdAccel;
        az += this.jumpDir.z * c.jump.holdAccel;
      } else this.isJumping = false;
    }

    // --- Turbo ---
    if (inp.boost && !this.prevBoostInput && this.boost > 0) this.boostTimer = c.boost.minDuration;
    this.prevBoostInput = inp.boost;
    const noBoost = rules.boostMode === 'none';
    this.boosting = !noBoost && this.boost > 0 && (inp.boost || this.boostTimer > 0);
    if (this.boostTimer > 0) this.boostTimer -= dt;
    if (this.boosting) {
      if (rules.boostMode !== 'unlimited')
        this.boost = Math.max(0, this.boost - c.boost.useRate * dt);
      const a = c.boost.accel * rules.boostStrength;
      ax += this.forward.x * a;
      ay += this.forward.y * a;
      az += this.forward.z * a;
    } else if (rules.boostMode === 'recharge') {
      this.boost = Math.min(c.boost.max, this.boost + RECHARGE_RATE * dt);
    }

    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.vel.z += az * dt;

    if (this.grounded) this.driveOnSurface(dt);
    else if (!touching) this.airControl(dt);

    // Límite de velocidad (cualquier estado).
    this.vel.clampLength(c.maxSpeed);

    this.speed = this.vel.length();
    this.forwardSpeed = this.vel.dot(this.forward);
    this.supersonic = this.speed >= c.supersonicSpeed;

    this.pos.addScaled(this.vel, dt);
    this.quat.integrate(this.angVel.x, this.angVel.y, this.angVel.z, dt);
  }

  private startJump(): void {
    const c = CAR.jump;
    if (this.grounded) this.jumpDir.copy(this.up);
    else this.jumpDir.copy(this.bodyNormal);
    this.vel.addScaled(this.jumpDir, c.impulse);
    this.isJumping = true;
    this.jumpTimer = 0;
    this.groundLock = c.groundLock;
    this.airTime = 0;
    this.supported = false;
    this.grounded = false;
  }

  private startDodge(): void {
    const c = CAR.jump;
    const inp = this.input;
    this.flipUsed = true;
    const fwdIn = -inp.pitch;
    const sideIn = inp.yaw;
    const mag = Math.hypot(fwdIn, sideIn);
    if (mag < c.flipDeadzone) {
      this.vel.addScaled(this.up, c.doubleJumpImpulse);
      return;
    }
    const df = fwdIn / mag;
    const ds = sideIn / mag;
    // Dirección horizontal de avance (proyección del morro en el plano horizontal).
    f.set(this.forward.x, this.forward.y, 0);
    if (f.lengthSq() < 1e-4) f.set(this.up.x, this.up.y, 0);
    f.normalize();
    // Derecha horizontal = f girado -90° alrededor de z.
    tmp.set(f.y, -f.x, 0);
    this.vel.addScaled(f, df * c.flipImpulse);
    this.vel.addScaled(tmp, ds * c.flipImpulse);
    this.flipActive = true;
    this.flipTimer = 0;
    this.flipForward = df;
    this.flipSide = ds;
  }

  /** Conducción sobre cualquier superficie (suelo, pared o techo). */
  private driveOnSurface(dt: number): void {
    const inp = this.input;
    const c = CAR;
    n.copy(this.surfaceNormal);

    // Dirección de avance proyectada en el plano de la superficie.
    f.copy(this.forward).addScaled(n, -this.forward.dot(n));
    if (f.lengthSq() < 1e-6) f.copy(this.leftAxis).addScaled(n, -this.leftAxis.dot(n));
    f.normalize();
    left.crossOf(n, f);

    let vf = this.vel.dot(f);
    const vl = this.vel.dot(left);

    // Gas / freno. El turbo equivale a gas a fondo hacia delante.
    const throttle = this.boosting ? 1 : inp.throttle;
    if (Math.abs(throttle) > c.throttleDeadzone) {
      if (vf * throttle < 0) {
        const dv = Math.min(c.brakeAccel * dt, Math.abs(vf));
        this.vel.addScaled(f, Math.sign(throttle) * dv);
        vf += Math.sign(throttle) * dv;
      } else {
        const a = Math.max(0, c.engineAccel * (1 - Math.abs(vf) / c.engineAccelZeroAt));
        this.vel.addScaled(f, a * throttle * dt);
      }
    } else {
      const dv = Math.min(c.coastDecel * dt, Math.abs(vf));
      this.vel.addScaled(f, -Math.sign(vf) * dv);
    }

    // Agarre lateral (menor con el freno de mano → derrape).
    const grip = inp.handbrake ? c.lateralGripHandbrake : c.lateralGrip;
    this.vel.addScaled(left, -vl * (1 - Math.exp(-grip * dt)));

    // Fuerza que pega el coche a la superficie.
    this.vel.addScaled(n, -c.stickyAccel * dt);

    // Dirección: velocidad de giro = curvatura(v) · v_avance, alrededor de la normal.
    const curvature = sampleCurve(c.steerCurvature, Math.abs(vf));
    const targetYaw = -inp.steer * curvature * vf;
    const wn = this.angVel.dot(n);
    this.angVel.addScaled(n, -wn);
    this.angVel.scale(Math.exp(-c.groundAngularDamping * dt));
    this.angVel.addScaled(n, targetYaw);
    this.steerVisual = inp.steer;
  }

  /** Control aéreo: cabeceo, guiñada y alabeo con amortiguación; el flip aplica su propio par. */
  private airControl(dt: number): void {
    const inp = this.input;
    const a = CAR.air;
    const j = CAR.jump;

    this.quat.unrotate(this.angVel, wl);
    const before = wl.length();

    if (this.flipActive) {
      this.flipTimer += dt;
      if (this.flipTimer >= j.flipTorqueTime) this.flipActive = false;
    }

    if (this.flipActive) {
      // Durante el flip el cabeceo/alabeo los gobierna el par del dodge. Pulsar en sentido
      // contrario lo reduce y permite cancelarlo (física emergente, no atajo programado).
      const fwdIn = -inp.pitch;
      const cancelF =
        this.flipForward !== 0 ? clamp(-fwdIn * Math.sign(this.flipForward), 0, 1) : 0;
      const cancelS = this.flipSide !== 0 ? clamp(-inp.yaw * Math.sign(this.flipSide), 0, 1) : 0;
      const targetY = this.flipForward * j.flipSpinRate * (1 - cancelF);
      const targetX = this.flipSide * j.flipSpinRate * (1 - cancelS);
      const step = j.flipSpinAccel * dt;
      wl.y += clamp(targetY - wl.y, -step, step);
      wl.x += clamp(targetX - wl.x, -step, step);
      wl.z += -inp.yaw * a.yawAccel * dt;
      wl.z *= 1 - a.yawDamping * (1 - Math.abs(inp.yaw)) * dt;
    } else {
      wl.x += inp.roll * a.rollAccel * dt;
      wl.y += -inp.pitch * a.pitchAccel * dt;
      wl.z += -inp.yaw * a.yawAccel * dt;
      wl.x *= 1 - a.rollDamping * (1 - Math.abs(inp.roll)) * dt;
      wl.y *= 1 - a.pitchDamping * (1 - Math.abs(inp.pitch)) * dt;
      wl.z *= 1 - a.yawDamping * (1 - Math.abs(inp.yaw)) * dt;
      const after = wl.length();
      const limit = Math.max(before, a.maxAngularSpeed);
      if (after > limit) wl.scale(limit / after);
    }
    this.quat.rotate(wl, this.angVel);

    // Gas en el aire (leve) cuando no hay turbo.
    if (!this.boosting) this.vel.addScaled(this.forward, inp.throttle * a.throttleAccel * dt);
  }
}

const AX_X = new Vec3(1, 0, 0);
const AX_Y = new Vec3(0, 1, 0);
const AX_Z = new Vec3(0, 0, 1);
