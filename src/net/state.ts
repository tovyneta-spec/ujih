// Empaquetado binario del estado de la simulación (snapshots) y de las entradas de los jugadores.
// Formato little-endian de tamaño fijo por coche: un snapshot de 3v3 ocupa ≈ 0,9 KB.
import type { CarInput, World } from '../sim';
import { neutralInput } from '../sim';
import { PKT_INPUT, PKT_SNAPSHOT } from './protocol';

// ---------------------------------------------------------------------------- entradas

/** Bytes por entrada: 5 ejes en int8 + 1 byte de botones. */
export const INPUT_BYTES = 6;

const toI8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));
const fromI8 = (b: number): number => b / 127;

export function encodeInput(i: CarInput, view: DataView, o: number): void {
  view.setInt8(o, toI8(i.throttle));
  view.setInt8(o + 1, toI8(i.steer));
  view.setInt8(o + 2, toI8(i.pitch));
  view.setInt8(o + 3, toI8(i.yaw));
  view.setInt8(o + 4, toI8(i.roll));
  view.setUint8(o + 5, (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0));
}

export function decodeInput(view: DataView, o: number, into: CarInput): void {
  into.throttle = clampAxis(fromI8(view.getInt8(o)));
  into.steer = clampAxis(fromI8(view.getInt8(o + 1)));
  into.pitch = clampAxis(fromI8(view.getInt8(o + 2)));
  into.yaw = clampAxis(fromI8(view.getInt8(o + 3)));
  into.roll = clampAxis(fromI8(view.getInt8(o + 4)));
  const b = view.getUint8(o + 5);
  into.jump = (b & 1) !== 0;
  into.boost = (b & 2) !== 0;
  into.handbrake = (b & 4) !== 0;
}

const clampAxis = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Paquete de entradas: [tipo u8][seq u32 de la primera][n u8][n × entrada]. */
export function packInputs(seq: number, inputs: readonly CarInput[]): Uint8Array {
  const buf = new Uint8Array(6 + inputs.length * INPUT_BYTES);
  const v = new DataView(buf.buffer);
  v.setUint8(0, PKT_INPUT);
  v.setUint32(1, seq >>> 0, true);
  v.setUint8(5, inputs.length);
  inputs.forEach((inp, i) => encodeInput(inp, v, 6 + i * INPUT_BYTES));
  return buf;
}

export interface InputPacket {
  seq: number;
  inputs: CarInput[];
}

/** Lee un paquete de entradas; devuelve null si está malformado (tamaño, tipo o cuenta incoherentes). */
export function unpackInputs(data: ArrayBuffer | Uint8Array, maxCount: number): InputPacket | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 6) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== PKT_INPUT) return null;
  const n = v.getUint8(5);
  if (n === 0 || n > maxCount || bytes.byteLength !== 6 + n * INPUT_BYTES) return null;
  const inputs: CarInput[] = [];
  for (let i = 0; i < n; i++) {
    const inp = neutralInput();
    decodeInput(v, 6 + i * INPUT_BYTES, inp);
    inputs.push(inp);
  }
  return { seq: v.getUint32(1, true), inputs };
}

// ------------------------------------------------------------------------- snapshots

const HEADER = 15;
const BALL_BYTES = 13 * 4;
export const CAR_BYTES = 1 + 2 + 13 * 4 + 4 + 8 * 4 + 3 * 4 + 4 + INPUT_BYTES;

const F_JUMPING = 1;
const F_FLIPUSED = 2;
const F_FLIPACTIVE = 4;
const F_PREVJUMP = 8;
const F_PREVBOOST = 16;
const F_BOOSTING = 32;
const F_DEMOLISHED = 64;
const F_GROUNDED = 128;

export interface NetCarState {
  id: number;
  flags: number;
  pos: [number, number, number];
  vel: [number, number, number];
  quat: [number, number, number, number];
  ang: [number, number, number];
  boost: number;
  timers: [number, number, number, number, number, number, number, number];
  jumpDir: [number, number, number];
  touchTick: number;
  input: CarInput;
}

export interface NetSnapshot {
  tick: number;
  /** Última entrada del jugador receptor que el servidor ya ha aplicado. */
  ack: number;
  /** Entradas pendientes en la cola del servidor para este jugador. */
  queue: number;
  rng: number;
  ball: {
    pos: [number, number, number];
    vel: [number, number, number];
    ang: [number, number, number];
    quat: [number, number, number, number];
  };
  cars: NetCarState[];
  /** Por pad: 0 si está activo, o el tiempo restante de reaparición. */
  pads: number[];
}

export function snapshotSize(numCars: number, numPads: number): number {
  return HEADER + BALL_BYTES + numCars * CAR_BYTES + 1 + numPads * 4;
}

/** Empaqueta el estado completo del mundo. `ack` y `queue` se rellenan por receptor con `patchHeader`. */
export function packSnapshot(world: World): Uint8Array {
  const buf = new Uint8Array(snapshotSize(world.cars.length, world.pads.length));
  const v = new DataView(buf.buffer);
  v.setUint8(0, PKT_SNAPSHOT);
  v.setUint32(1, world.tick >>> 0, true);
  v.setUint32(5, 0, true);
  v.setUint8(9, 0);
  v.setUint8(10, world.cars.length);
  v.setUint32(11, world.rng.getState() >>> 0, true);
  let o = HEADER;
  const f = (x: number): void => {
    v.setFloat32(o, x, true);
    o += 4;
  };
  const b = world.ball;
  [
    b.pos.x,
    b.pos.y,
    b.pos.z,
    b.vel.x,
    b.vel.y,
    b.vel.z,
    b.angVel.x,
    b.angVel.y,
    b.angVel.z,
    b.quat.x,
    b.quat.y,
    b.quat.z,
    b.quat.w,
  ].forEach(f);
  for (const c of world.cars) {
    v.setUint8(o, c.id);
    const flags =
      (c.isJumping ? F_JUMPING : 0) |
      (c.flipUsed ? F_FLIPUSED : 0) |
      (c.flipActive ? F_FLIPACTIVE : 0) |
      (c.prevJump ? F_PREVJUMP : 0) |
      (c.prevBoostInput ? F_PREVBOOST : 0) |
      (c.boosting ? F_BOOSTING : 0) |
      (c.demolished ? F_DEMOLISHED : 0) |
      (c.grounded ? F_GROUNDED : 0);
    v.setUint16(o + 1, flags, true);
    o += 3;
    [
      c.pos.x,
      c.pos.y,
      c.pos.z,
      c.vel.x,
      c.vel.y,
      c.vel.z,
      c.quat.x,
      c.quat.y,
      c.quat.z,
      c.quat.w,
      c.angVel.x,
      c.angVel.y,
      c.angVel.z,
    ].forEach(f);
    f(c.boost);
    [
      c.jumpTimer,
      c.groundLock,
      c.airTime,
      c.flipTimer,
      c.boostTimer,
      c.flipForward,
      c.flipSide,
      c.respawnTimer,
    ].forEach(f);
    f(c.jumpDir.x);
    f(c.jumpDir.y);
    f(c.jumpDir.z);
    v.setInt32(o, c.lastBallTouchTick, true);
    o += 4;
    encodeInput(c.input, v, o);
    o += INPUT_BYTES;
  }
  v.setUint8(o, world.pads.length);
  o += 1;
  for (const p of world.pads) {
    f(p.active ? 0 : Math.max(0.0001, p.timer));
  }
  return buf;
}

/** Copia un snapshot empaquetado escribiendo la confirmación de entradas y la cola del receptor. */
export function withHeader(packed: Uint8Array, ack: number, queue: number): Uint8Array {
  const out = packed.slice();
  const v = new DataView(out.buffer);
  v.setUint32(5, ack >>> 0, true);
  v.setUint8(9, Math.min(255, queue));
  return out;
}

/** Lee un snapshot; devuelve null si el tamaño o el tipo no son coherentes. */
export function unpackSnapshot(data: ArrayBuffer | Uint8Array): NetSnapshot | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < HEADER + BALL_BYTES + 1) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== PKT_SNAPSHOT) return null;
  const nCars = v.getUint8(10);
  const padsOffset = HEADER + BALL_BYTES + nCars * CAR_BYTES;
  if (bytes.byteLength < padsOffset + 1) return null;
  const nPads = v.getUint8(padsOffset);
  if (bytes.byteLength !== padsOffset + 1 + nPads * 4) return null;

  let o = HEADER;
  const f = (): number => {
    const x = v.getFloat32(o, true);
    o += 4;
    return x;
  };
  const v3 = (): [number, number, number] => [f(), f(), f()];
  const ball = {
    pos: v3(),
    vel: v3(),
    ang: v3(),
    quat: [f(), f(), f(), f()] as [number, number, number, number],
  };
  const cars: NetCarState[] = [];
  for (let i = 0; i < nCars; i++) {
    const id = v.getUint8(o);
    const flags = v.getUint16(o + 1, true);
    o += 3;
    const pos = v3();
    const vel = v3();
    const quat: [number, number, number, number] = [f(), f(), f(), f()];
    const ang = v3();
    const boost = f();
    const timers: NetCarState['timers'] = [f(), f(), f(), f(), f(), f(), f(), f()];
    const jumpDir = v3();
    const touchTick = v.getInt32(o, true);
    o += 4;
    const input = neutralInput();
    decodeInput(v, o, input);
    o += INPUT_BYTES;
    cars.push({ id, flags, pos, vel, quat, ang, boost, timers, jumpDir, touchTick, input });
  }
  o += 1;
  const pads: number[] = [];
  for (let i = 0; i < nPads; i++) pads.push(f());
  return {
    tick: v.getUint32(1, true),
    ack: v.getUint32(5, true),
    queue: v.getUint8(9),
    rng: v.getUint32(11, true),
    ball,
    cars,
    pads,
  };
}

/** Restaura el estado del mundo (réplica del cliente) a partir de un snapshot. */
export function applySnapshot(world: World, s: NetSnapshot): void {
  world.tick = s.tick;
  world.rng.setState(s.rng);
  const b = world.ball;
  b.pos.set(s.ball.pos[0], s.ball.pos[1], s.ball.pos[2]);
  b.vel.set(s.ball.vel[0], s.ball.vel[1], s.ball.vel[2]);
  b.angVel.set(s.ball.ang[0], s.ball.ang[1], s.ball.ang[2]);
  b.quat.set(s.ball.quat[0], s.ball.quat[1], s.ball.quat[2], s.ball.quat[3]).normalize();
  b.prevPos.copy(b.pos);
  b.prevQuat.copy(b.quat);
  for (const cs of s.cars) {
    const c = world.cars[cs.id];
    if (!c) continue;
    c.pos.set(cs.pos[0], cs.pos[1], cs.pos[2]);
    c.vel.set(cs.vel[0], cs.vel[1], cs.vel[2]);
    c.quat.set(cs.quat[0], cs.quat[1], cs.quat[2], cs.quat[3]).normalize();
    c.angVel.set(cs.ang[0], cs.ang[1], cs.ang[2]);
    c.boost = cs.boost;
    c.isJumping = (cs.flags & F_JUMPING) !== 0;
    c.flipUsed = (cs.flags & F_FLIPUSED) !== 0;
    c.flipActive = (cs.flags & F_FLIPACTIVE) !== 0;
    c.prevJump = (cs.flags & F_PREVJUMP) !== 0;
    c.prevBoostInput = (cs.flags & F_PREVBOOST) !== 0;
    c.boosting = (cs.flags & F_BOOSTING) !== 0;
    c.demolished = (cs.flags & F_DEMOLISHED) !== 0;
    c.grounded = (cs.flags & F_GROUNDED) !== 0;
    [
      c.jumpTimer,
      c.groundLock,
      c.airTime,
      c.flipTimer,
      c.boostTimer,
      c.flipForward,
      c.flipSide,
      c.respawnTimer,
    ] = cs.timers;
    c.jumpDir.set(cs.jumpDir[0], cs.jumpDir[1], cs.jumpDir[2]);
    c.lastBallTouchTick = cs.touchTick;
    c.input.throttle = cs.input.throttle;
    c.input.steer = cs.input.steer;
    c.input.pitch = cs.input.pitch;
    c.input.yaw = cs.input.yaw;
    c.input.roll = cs.input.roll;
    c.input.jump = cs.input.jump;
    c.input.boost = cs.input.boost;
    c.input.handbrake = cs.input.handbrake;
    c.prevPos.copy(c.pos);
    c.prevQuat.copy(c.quat);
    c.updateAxes();
    c.speed = c.vel.length();
    c.forwardSpeed = c.vel.dot(c.forward);
  }
  for (let i = 0; i < world.pads.length && i < s.pads.length; i++) {
    const t = s.pads[i];
    world.pads[i].active = t <= 0;
    world.pads[i].timer = t;
  }
}
