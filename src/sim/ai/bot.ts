// Bot de Soccar. Produce un `CarInput` por tick con las mismas reglas que un jugador humano.
import { ARENA, PHYSICS } from '../../config';
import type { BotProfile } from '../../config';
import type { Car } from '../car';
import type { CarInput } from '../input';
import { neutralInput } from '../input';
import { Vec3, clamp } from '../math';
import type { Rng } from '../rng';
import type { World } from '../world';
import { bearing, driveToward, orient } from './control';
import type { BallPredictor } from './prediction';

export type Role = 'attack' | 'support' | 'defend';

export interface Intercept {
  t: number;
  pos: Vec3;
}

export interface BotContext {
  world: World;
  predictor: BallPredictor;
  role: Role;
  intercept: Intercept;
  teammates: readonly Car[];
  enemies: readonly Car[];
  /** Soy quien toma el saque (el más cercano a la pelota de su equipo). */
  kickoffTaker: boolean;
}

type Skill =
  | { type: 'flip'; start: number; f: number; s: number }
  | { type: 'aerial'; start: number; hitTime: number; doubled: boolean }
  | { type: 'recover'; start: number; steer: number }
  | { type: 'demo'; until: number; victim: Car };

const UP = new Vec3(0, 0, 1);
const HY = ARENA.halfLength;

const v1 = new Vec3();
const v2 = new Vec3();
const v3 = new Vec3();
const flat = new Vec3();

export class Bot {
  readonly car: Car;
  readonly profile: BotProfile;
  private rng: Rng;
  private out: CarInput = neutralInput();

  private skill: Skill | null = null;
  private nextDecision = 0;
  private flipCooldown = 0;
  private aerialCooldown = 0;
  private target = new Vec3();
  private speed = 1200;
  private useBoost = false;
  private allowFlip = false;
  private noise = new Vec3();
  private lastRole: Role = 'attack';
  /** Para detectar atasco. */
  private stuckRef = new Vec3();
  private stuckTime = 0;
  private roleChangedAt = -10;

  constructor(car: Car, profile: BotProfile, rng: Rng) {
    this.car = car;
    this.profile = profile;
    this.rng = rng;
  }

  get currentRole(): Role {
    return this.lastRole;
  }

  /** Cambio de rol notificado al gestor para el chat rápido. */
  consumeRoleChange(role: Role, now: number): boolean {
    if (role === this.lastRole) return false;
    this.lastRole = role;
    const fresh = now - this.roleChangedAt > 5;
    this.roleChangedAt = now;
    return fresh;
  }

  update(ctx: BotContext): CarInput {
    const car = this.car;
    const o = this.out;
    Object.assign(o, neutralInput());
    if (car.demolished) return o;
    const now = ctx.world.time;

    this.trackStuck(ctx, now);

    if (this.skill && this.runSkill(ctx, now)) return o;

    // En el aire: orientarse para aterrizar sobre las ruedas.
    if (!car.supported && car.wheelsInContact === 0) {
      if (this.profile.airRecovery) this.recoverInAir(ctx);
      return o;
    }
    // Boca abajo en el suelo / techo: saltar para enderezarse.
    if (car.up.z < -0.4 && car.supported && car.speed < 500) {
      o.jump = true;
      return o;
    }

    // Sobre una pared o el techo: bajar al suelo (techo: soltarse saltando).
    if (car.supported && car.up.z < 0.72 && !this.profile.wallPlay) {
      if (car.up.z < -0.5) o.jump = true;
      else if (car.speed < 150) {
        // Encajado (p. ej. de pie contra el fondo de la portería): saltar a intervalos para soltarse.
        o.jump = ctx.world.tick % 40 < 20;
        o.throttle = -1;
      } else {
        v2.set(car.pos.x * 0.75, car.pos.y * 0.75, 17);
        driveToward(car, v2, 1000, false, o);
      }
      return o;
    }

    if (now >= this.nextDecision) {
      this.decide(ctx, now);
      this.nextDecision = now + this.profile.reaction * (0.8 + 0.4 * this.rng.next());
    }

    const ball = ctx.world.ball;
    driveToward(car, this.target, this.speed * this.profile.speedFactor, this.useBoost, o);
    if (this.useBoost && this.rng.next() > this.profile.boostUse + 0.5) o.boost = false;

    // Flip para golpear la pelota cuando está al alcance.
    if (this.allowFlip && this.profile.flips && car.grounded && now >= this.flipCooldown) {
      v1.copy(ball.pos);
      const dx = ball.pos.x - car.pos.x;
      const dy = ball.pos.y - car.pos.y;
      const dist = Math.hypot(dx, dy);
      const reach = 300 + Math.max(0, car.forwardSpeed) * 0.12;
      if (
        dist < reach &&
        ball.pos.z < 260 + ball.radius &&
        car.forwardSpeed > 350 &&
        Math.abs(bearing(car, v1)) < 0.55
      ) {
        this.startFlip(now, bearing(car, v1));
      }
    }
    return o;
  }

  // ------------------------------------------------------------------ decisiones

  private ownY(): number {
    return this.car.team === 0 ? -HY : HY;
  }

  private decide(ctx: BotContext, now: number): void {
    const { world, role } = ctx;
    const car = this.car;
    const ball = world.ball;
    const p = this.profile;
    const dir = car.team === 0 ? 1 : -1;
    const ownY = this.ownY();

    // Ruido de puntería (cuanto más novato, más impreciso).
    this.noise.set(
      (this.rng.next() + this.rng.next() - 1) * p.aimNoise,
      (this.rng.next() + this.rng.next() - 1) * p.aimNoise,
      0,
    );
    this.useBoost = false;
    this.allowFlip = false;

    const m = world.match;
    const kickoff =
      m.enabled &&
      (m.phase === 'countdown' || m.phase === 'kickoff') &&
      Math.hypot(ball.pos.x, ball.pos.y) < 30 &&
      ball.vel.length() < 30;

    // --- Saque ---
    if (kickoff) {
      if (ctx.kickoffTaker) {
        this.target.set(ball.pos.x, ball.pos.y, 17).add(this.noise);
        this.speed = 2300;
        this.useBoost = true;
        this.allowFlip = true;
      } else {
        this.goToPadOrBack(ctx, true);
      }
      return;
    }

    // --- Demolición oportunista (Leyenda) ---
    if (
      p.demoRate > 0 &&
      role !== 'defend' &&
      car.speed > 1200 &&
      this.rng.next() < p.demoRate * p.reaction
    ) {
      let best: Car | null = null;
      let bd = 1800;
      for (const e of ctx.enemies) {
        if (e.demolished) continue;
        const d = e.pos.distanceTo(car.pos);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (best) {
        this.skill = { type: 'demo', until: now + 1.4, victim: best };
        return;
      }
    }

    // --- Gestión de turbo ---
    const lowBoost = p.managesBoost && car.boost < (role === 'attack' ? 20 : 40);
    if (lowBoost && (role !== 'attack' || ctx.intercept.t > 1.3)) {
      if (this.goToPad(ctx)) return;
    }

    switch (role) {
      case 'attack':
        this.planAttack(ctx, now, dir);
        break;
      case 'defend':
        this.planDefend(ctx, now);
        break;
      default:
        this.planSupport(ctx, dir, ownY);
        break;
    }
  }

  private aimPoint(ctx: BotContext, ib: Vec3, dir: number): Vec3 {
    const progress = ib.y * dir;
    const out = v3;
    // Despeje: lejos de la portería propia hacia la pared lateral.
    if (progress < -3000) {
      out.set(Math.sign(ib.x || 1) * 3600, ib.y + dir * 2400, 0);
      return out;
    }
    // Pase a un compañero mejor situado.
    if (
      this.profile.passChance > 0 &&
      progress < 1800 &&
      this.rng.next() < this.profile.passChance
    ) {
      for (const t of ctx.teammates) {
        if (t.demolished || t.id === this.car.id) continue;
        if (t.pos.y * dir > ib.y * dir + 1600 && Math.abs(t.pos.x) < 3000) {
          out.set(t.pos.x + t.vel.x * 0.7, t.pos.y + t.vel.y * 0.7, 0);
          return out;
        }
      }
    }
    // Disparo a puerta: punto algo desviado del centro para no ser tan predecible.
    out.set(clamp(ib.x * 0.2, -500, 500), dir * HY, 0);
    return out;
  }

  private planAttack(ctx: BotContext, now: number, dir: number): void {
    const car = this.car;
    const world = ctx.world;
    const ib = ctx.intercept.pos;
    const R = world.ball.radius;
    const aim = this.aimPoint(ctx, ib, dir);

    // Aéreo: sólo Pro/Leyenda y con pelota alta alcanzable.
    if (this.profile.aerialMaxHeight > 0 && car.grounded && now >= this.aerialCooldown) {
      if (this.tryAerial(ctx, now)) return;
    }

    let dx = aim.x - ib.x;
    let dy = aim.y - ib.y;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    // Posición del coche respecto a la pelota en la dirección del tiro (negativo = detrás de ella).
    const behind = (car.pos.x - ib.x) * dx + (car.pos.y - ib.y) * dy;
    const dist = Math.hypot(ib.x - car.pos.x, ib.y - car.pos.y);
    const tz = car.up.z > 0.8 ? 17 : ib.z;

    if (behind > -120 && dist < 3200) {
      // Estamos del lado equivocado: rodear la pelota sin tocarla hacia nuestra portería.
      const px = -dy;
      const py = dx;
      const side = Math.sign((car.pos.x - ib.x) * px + (car.pos.y - ib.y) * py) || 1;
      this.target.set(ib.x - dx * 900 + px * side * 950, ib.y - dy * 900 + py * side * 950, tz);
      this.speed = 1900;
      this.useBoost = true;
      this.allowFlip = false;
    } else {
      this.target.set(ib.x - dx * (R + 60), ib.y - dy * (R + 60), tz);
      this.speed = clamp(dist / Math.max(ctx.intercept.t, 0.2), 700, 2300);
      this.useBoost = this.speed > 1300;
      this.allowFlip = true;
    }
    this.target.add(this.noise);
  }

  private planDefend(ctx: BotContext, now: number): void {
    const world = ctx.world;
    const ownY = this.ownY();
    const future = ctx.predictor.at(now + 0.5).pos;
    v1.set(future.x, future.y - ownY, 0);
    const dBall = v1.length() || 1;
    const depth = clamp(dBall * 0.4, 600, 2400);
    v1.scale(1 / dBall);
    this.target.set(clamp(v1.x * depth, -1500, 1500), ownY + v1.y * depth, 17);
    const dist = Math.hypot(this.target.x - this.car.pos.x, this.target.y - this.car.pos.y);
    this.speed = dist > 700 ? 1900 : clamp(dist * 2.5, 150, 900);
    this.useBoost = dist > 1800;
    void world;
  }

  private planSupport(ctx: BotContext, dir: number, ownY: number): void {
    const ball = ctx.world.ball;
    const bx = ball.pos.x;
    const by = ball.pos.y;
    const px = bx + (0 - bx) * 0.3 + (bx > 0 ? -700 : 700);
    const py = by + (ownY - by) * 0.4;
    this.target.set(clamp(px, -3400, 3400), clamp(py, -HY + 700, HY - 700), 17);
    void dir;
    const dist = Math.hypot(this.target.x - this.car.pos.x, this.target.y - this.car.pos.y);
    this.speed = dist > 500 ? 1700 : clamp(dist * 2.5, 150, 800);
    this.useBoost = dist > 2200;
  }

  /** Tras el pitido del saque (o sin partida): coger turbo cercano y volver. */
  private goToPadOrBack(ctx: BotContext, ownSideOnly: boolean): void {
    const car = this.car;
    const ownY = this.ownY();
    let best: Vec3 | null = null;
    let bd = 3300;
    for (const pad of ctx.world.pads) {
      if (!pad.active) continue;
      if (ownSideOnly && Math.sign(pad.spec.y || ownY) !== Math.sign(ownY)) continue;
      const d = Math.hypot(pad.spec.x - car.pos.x, pad.spec.y - car.pos.y);
      if (d < bd) {
        bd = d;
        best = v2.set(pad.spec.x, pad.spec.y, 17);
      }
    }
    if (best && bd > 140) {
      this.target.copy(best);
      this.speed = 2000;
      this.useBoost = true;
    } else {
      this.target.set(car.pos.x * 0.3, ownY * 0.55, 17);
      this.speed = 600;
    }
  }

  private goToPad(ctx: BotContext): boolean {
    const car = this.car;
    let bestScore = 3500;
    let found = false;
    for (const pad of ctx.world.pads) {
      if (!pad.active) continue;
      const d = Math.hypot(pad.spec.x - car.pos.x, pad.spec.y - car.pos.y);
      const score = d - (pad.spec.size === 'big' ? 900 : 0);
      if (d < 3500 && score < bestScore) {
        bestScore = score;
        this.target.set(pad.spec.x, pad.spec.y, 17);
        found = true;
      }
    }
    if (found) {
      this.speed = 2000;
      this.useBoost = false;
    }
    return found;
  }

  // ---------------------------------------------------------------- habilidades

  private startFlip(now: number, angle: number): void {
    this.skill = { type: 'flip', start: now, f: Math.cos(angle), s: Math.sin(angle) };
    this.flipCooldown = now + 1.2;
  }

  private tryAerial(ctx: BotContext, now: number): boolean {
    const car = this.car;
    const p = this.profile;
    if (car.boost < 28) return false;
    const g = PHYSICS.gravity * ctx.world.rules.gravityScale;
    for (let tt = 0.8; tt <= 2.3; tt += 0.25) {
      const s = ctx.predictor.at(now + tt);
      if (s.pos.z < 280 || s.pos.z > p.aerialMaxHeight) continue;
      // Empuje necesario (tras el salto: ≈ +450 uu/s verticales) para estar en la pelota a tiempo.
      const t = tt - 0.2;
      v1.set(
        ((s.pos.x - car.pos.x - car.vel.x * t) * 2) / (t * t),
        ((s.pos.y - car.pos.y - car.vel.y * t) * 2) / (t * t),
        ((s.pos.z - car.pos.z - (car.vel.z + 450) * t) * 2) / (t * t) - g,
      );
      if (v1.length() > 820) continue;
      if (Math.abs(bearing(car, s.pos)) > 1.2) continue;
      this.skill = { type: 'aerial', start: now, hitTime: now + tt, doubled: false };
      this.aerialCooldown = now + 2.5;
      return true;
    }
    return false;
  }

  /** Ejecuta la habilidad activa. Devuelve true si ha escrito la entrada de este tick. */
  private runSkill(ctx: BotContext, now: number): boolean {
    const car = this.car;
    const o = this.out;
    const sk = this.skill;
    if (!sk) return false;
    const age = now - ('start' in sk ? sk.start : now);

    switch (sk.type) {
      case 'flip': {
        if (age > 0.95 || (age > 0.3 && car.supported)) break;
        const mag = Math.hypot(sk.f, sk.s) || 1;
        o.boost = this.useBoost && car.boost > 5;
        o.throttle = 1;
        if (age < 0.06) o.jump = true;
        else if (age >= 0.14 && age < 0.2) {
          o.jump = true;
          o.pitch = -sk.f / mag;
          o.yaw = -sk.s / mag;
        } else if (age >= 0.2 && age < 0.7) {
          o.pitch = -sk.f / mag;
          o.yaw = -sk.s / mag;
        } else if (age >= 0.7) this.recoverInAir(ctx);
        return true;
      }
      case 'aerial': {
        const tRem = sk.hitTime - now;
        if (tRem < -0.35 || (age > 0.5 && car.supported)) break;
        if (age < 0.22) o.jump = true;
        else if (!sk.doubled && this.profile.aerialDoubleJump && age >= 0.3 && age < 0.34) {
          o.jump = true; // doble salto vertical (sin dirección)
          if (age >= 0.32) sk.doubled = true;
          return true;
        }
        const s = ctx.predictor.at(sk.hitTime);
        const t = Math.max(tRem, 0.1);
        const g = PHYSICS.gravity * ctx.world.rules.gravityScale;
        v1.set(
          ((s.pos.x - car.pos.x - car.vel.x * t) * 2) / (t * t),
          ((s.pos.y - car.pos.y - car.vel.y * t) * 2) / (t * t),
          ((s.pos.z - car.pos.z - car.vel.z * t) * 2) / (t * t) - g,
        );
        const mag = v1.length();
        v1.scale(1 / (mag || 1));
        if (age >= 0.08) {
          orient(car, v1, UP, o);
          o.boost = car.boost > 0 && car.forward.dot(v1) > 0.9 && mag > 250;
        } else o.boost = false;
        return true;
      }
      case 'recover': {
        if (age > 0.9) break;
        o.throttle = -1;
        o.steer = sk.steer;
        o.yaw = sk.steer;
        if (car.up.z < 0) o.jump = age < 0.1;
        return true;
      }
      case 'demo': {
        if (now > sk.until || sk.victim.demolished) break;
        v2.copy(sk.victim.pos).addScaled(sk.victim.vel, 0.25);
        driveToward(car, v2, 2300, true, o);
        if (car.boost > 2 && Math.abs(bearing(car, v2)) < 0.35) o.boost = true;
        return true;
      }
    }
    this.skill = null;
    return false;
  }

  /** Orientación de aterrizaje: morro en la dirección del movimiento horizontal, ruedas hacia abajo. */
  private recoverInAir(_ctx: BotContext): void {
    const car = this.car;
    flat.set(car.vel.x, car.vel.y, 0);
    if (flat.length() < 250) flat.set(car.forward.x, car.forward.y, 0);
    if (flat.length() < 0.2) flat.set(1, 0, 0);
    flat.normalize();
    // Si está cayendo, inclina ligeramente el morro hacia abajo para llegar con las ruedas.
    flat.z = -0.15;
    flat.normalize();
    orient(car, flat, UP, this.out);
    this.out.throttle = 0;
  }

  private trackStuck(ctx: BotContext, now: number): void {
    const car = this.car;
    const world = ctx.world;
    if (world.match.frozen || this.skill || !car.supported) {
      this.stuckTime = now;
      this.stuckRef.copy(car.pos);
      return;
    }
    // Esperar a propósito junto al objetivo no es estar atascado.
    const near =
      car.up.z > 0.8 && Math.hypot(this.target.x - car.pos.x, this.target.y - car.pos.y) < 300;
    if (near || car.pos.distanceTo(this.stuckRef) > 160) {
      this.stuckTime = now;
      this.stuckRef.copy(car.pos);
      return;
    }
    if (now - this.stuckTime > 1.6) {
      this.skill = { type: 'recover', start: now, steer: this.rng.next() < 0.5 ? -1 : 1 };
      this.stuckTime = now;
      this.stuckRef.copy(car.pos);
    }
  }
}
