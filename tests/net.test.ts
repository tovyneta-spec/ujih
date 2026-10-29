import { describe, expect, it } from 'vitest';
import { DEFAULT_GARAGE, DEFAULT_MUTATORS } from '../src/config';
import { createRenderFrame } from '../src/replay';
import { OnlineMatch } from '../src/net/session';
import { SnapshotBuffer } from '../src/net/interpolation';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  TokenBucket,
  clampNum,
  generateCode,
  isValidCode,
  sanitizeName,
} from '../src/net/limits';
import { Predictor } from '../src/net/predictor';
import { buildNetWorld, onlineMutators } from '../src/net/setup';
import type { NetSetup } from '../src/net/setup';
import {
  applySnapshot,
  packInputs,
  packSnapshot,
  snapshotSize,
  unpackInputs,
  unpackSnapshot,
  withHeader,
} from '../src/net/state';
import { World, neutralInput } from '../src/sim';
import type { CarInput } from '../src/sim';

function setup(): NetSetup {
  return {
    seed: 5,
    mutators: onlineMutators(DEFAULT_MUTATORS),
    botLevel: 'pro',
    cars: [
      { id: 0, team: 0, body: 'octane', name: 'A', bot: false, look: DEFAULT_GARAGE },
      { id: 1, team: 1, body: 'dominus', name: 'B', bot: true, look: DEFAULT_GARAGE },
    ],
  };
}

const input = (p: Partial<CarInput> = {}): CarInput => ({ ...neutralInput(), ...p });

describe('paquetes de entrada', () => {
  it('ida y vuelta con la cuantización a 8 bits', () => {
    const inputs = [
      input({ throttle: 1, steer: -0.5, jump: true, boost: true }),
      input({ pitch: 0.3, yaw: -1, roll: 1, handbrake: true }),
    ];
    const p = unpackInputs(packInputs(41, inputs), 16);
    expect(p?.seq).toBe(41);
    expect(p?.inputs).toHaveLength(2);
    expect(p?.inputs[0].throttle).toBe(1);
    expect(p?.inputs[0].steer).toBeCloseTo(-0.5, 2);
    expect(p?.inputs[0].jump && p?.inputs[0].boost && !p?.inputs[0].handbrake).toBe(true);
    expect(p?.inputs[1].roll).toBe(1);
    expect(p?.inputs[1].handbrake).toBe(true);
  });
  it('rechaza paquetes malformados o demasiado largos', () => {
    expect(unpackInputs(new Uint8Array([1, 0, 0, 0, 0]), 16)).toBeNull();
    expect(unpackInputs(new Uint8Array([9, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), 16)).toBeNull(); // tipo erróneo
    expect(unpackInputs(new Uint8Array([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0]), 16)).toBeNull(); // cuenta ≠ tamaño
    expect(
      unpackInputs(
        packInputs(
          1,
          Array.from({ length: 20 }, () => input()),
        ),
        16,
      ),
    ).toBeNull();
    expect(unpackInputs(new Uint8Array([1, 0, 0, 0, 0, 0]), 16)).toBeNull(); // 0 entradas
  });
  it('los ejes nunca salen de [-1, 1] aunque el paquete lo intente', () => {
    const bytes = packInputs(1, [input()]);
    bytes[6] = 0x80; // -128
    bytes[7] = 0x7f;
    const p = unpackInputs(bytes, 16);
    expect(p?.inputs[0].throttle).toBe(-1);
    expect(p?.inputs[0].steer).toBe(1);
  });
});

describe('snapshots binarios', () => {
  it('empaqueta y restaura el estado completo del mundo', () => {
    const w = buildNetWorld(setup());
    w.startMatch({ duration: 300 });
    for (let i = 0; i < 480; i++) {
      w.cars[0].setInput(
        input({ throttle: 1, boost: true, steer: Math.sin(i / 30), jump: i % 100 === 0 }),
      );
      w.step();
      w.drainEvents();
    }
    const packed = packSnapshot(w);
    expect(packed.byteLength).toBe(snapshotSize(2, w.pads.length));
    const snap = unpackSnapshot(withHeader(packed, 123, 4));
    expect(snap).not.toBeNull();
    expect(snap?.tick).toBe(w.tick);
    expect(snap?.ack).toBe(123);
    expect(snap?.queue).toBe(4);

    const replica = buildNetWorld(setup());
    applySnapshot(replica, snap!);
    expect(replica.tick).toBe(w.tick);
    for (let i = 0; i < 2; i++) {
      expect(replica.cars[i].pos.distanceTo(w.cars[i].pos)).toBeLessThan(0.01);
      expect(replica.cars[i].vel.distanceTo(w.cars[i].vel)).toBeLessThan(0.01);
      expect(replica.cars[i].boost).toBeCloseTo(w.cars[i].boost, 3);
      expect(replica.cars[i].flipUsed).toBe(w.cars[i].flipUsed);
    }
    expect(replica.ball.pos.distanceTo(w.ball.pos)).toBeLessThan(0.01);
    expect(replica.pads.map((p) => p.active)).toEqual(w.pads.map((p) => p.active));
  });
  it('rechaza snapshots truncados o de otro tipo', () => {
    const w = buildNetWorld(setup());
    const packed = packSnapshot(w);
    expect(unpackSnapshot(packed.slice(0, packed.length - 3))).toBeNull();
    expect(unpackSnapshot(new Uint8Array(5))).toBeNull();
    const wrong = packed.slice();
    wrong[0] = 9;
    expect(unpackSnapshot(wrong)).toBeNull();
  });
  it('un snapshot de 3v3 ocupa menos de 1 KB', () => {
    expect(snapshotSize(6, 34)).toBeLessThan(1000);
  });
});

/** Servidor simulado con latencia fija (en ticks) en cada sentido. */
class Harness {
  server = buildNetWorld(setup());
  client = new OnlineMatch(setup(), 0);
  tick = 0;
  private inbound: { at: number; seq: number; input: CarInput }[] = [];
  private outbound: { at: number; data: Uint8Array }[] = [];
  private lastSeq = 0;
  private queue: { seq: number; input: CarInput }[] = [];
  private lastInput = neutralInput();
  constructor(public latency: number) {
    this.server.startMatch({ duration: 300 });
    this.client.world.startMatch({ duration: 300 });
    // Salta la cuenta atrás en ambos para que el coche pueda moverse.
    for (let i = 0; i < 400; i++) {
      this.server.step();
      this.client.world.step();
    }
    this.server.drainEvents();
    this.client.world.drainEvents();
  }
  /** Un tick del mundo: el cliente predice y envía; el servidor consume y emite snapshots. */
  run(inp: CarInput, serverTamper?: (w: World) => void): void {
    this.tick++;
    const seq = this.client.step(inp);
    this.client.predictor.smooth(1 / 120);
    this.inbound.push({ at: this.tick + this.latency, seq, input: inp });
    for (const m of this.inbound.filter((x) => x.at <= this.tick))
      this.queue.push({ seq: m.seq, input: m.input });
    this.inbound = this.inbound.filter((x) => x.at > this.tick);
    const next = this.queue.shift();
    if (next) {
      this.lastInput = next.input;
      this.lastSeq = next.seq;
    }
    this.server.setInput(0, this.lastInput);
    serverTamper?.(this.server);
    this.server.step();
    this.server.drainEvents();
    if (this.tick % 2 === 0) {
      this.outbound.push({
        at: this.tick + this.latency,
        data: withHeader(packSnapshot(this.server), this.lastSeq, this.queue.length),
      });
    }
    for (const m of this.outbound.filter((x) => x.at <= this.tick))
      this.client.onSnapshot(m.data, (this.tick * 1000) / 120);
    this.outbound = this.outbound.filter((x) => x.at > this.tick);
  }
}

describe('predicción y reconciliación', () => {
  it('sin perturbaciones, la predicción coincide con el servidor pese a 100 ms de latencia', () => {
    const h = new Harness(12); // 12 ticks = 100 ms por sentido
    let maxErr = 0;
    for (let i = 0; i < 600; i++) {
      h.run(
        input({ throttle: 1, boost: i % 80 < 40, steer: Math.sin(i / 35), jump: i % 150 === 0 }),
      );
      if (i > 60) maxErr = Math.max(maxErr, h.client.predictor.lastError);
    }
    expect(h.client.predictor.reconciliations).toBeGreaterThan(50);
    expect(maxErr).toBeLessThan(5);
  });
  it('mientras el servidor sigue ocupado la cola de entradas pendientes crece y luego se vacía', () => {
    const h = new Harness(6);
    for (let i = 0; i < 100; i++) h.run(input({ throttle: 1 }));
    expect(h.client.predictor.pendingCount).toBeGreaterThan(5);
    expect(h.client.predictor.pendingCount).toBeLessThan(40);
  });
  it('si el servidor corrige al coche (empujón), el cliente converge sin saltos bruscos', () => {
    const h = new Harness(8);
    for (let i = 0; i < 120; i++) h.run(input({ throttle: 1, boost: true }));
    let tamper = true;
    let jumpErr = 0;
    for (let i = 0; i < 240; i++) {
      h.run(input({ throttle: 1, boost: true }), (w) => {
        if (tamper) {
          tamper = false;
          w.cars[0].vel.x += 600; // otro coche lo ha empujado en el servidor
        }
      });
      jumpErr = Math.max(jumpErr, h.client.predictor.lastError);
    }
    expect(jumpErr).toBeGreaterThan(20); // se detecta la divergencia…
    // …y al final cliente y servidor vuelven a coincidir.
    for (let i = 0; i < 60; i++) h.run(input({ throttle: 1, boost: true }));
    expect(h.client.predictor.lastError).toBeLessThan(5);
    expect(h.client.predictor.offset.length()).toBeLessThan(3);
  });
  it('el desfase visual decae con el tiempo', () => {
    const w = buildNetWorld(setup());
    const p = new Predictor(w, 0);
    p.offset.set(100, 0, 0);
    for (let i = 0; i < 60; i++) p.smooth(1 / 60);
    expect(p.offset.length()).toBeLessThan(1);
  });
});

describe('interpolación de coches remotos', () => {
  it('sigue un movimiento lineal con un retardo fijo y sin saltos', () => {
    const w = buildNetWorld(setup());
    const buf = new SnapshotBuffer(2);
    const frame = createRenderFrame(2);
    const speed = 1000; // uu/s en x
    const positions: number[] = [];
    for (let tick = 0; tick <= 600; tick += 2) {
      w.tick = tick;
      w.cars[1].pos.set(speed * (tick / 120), 0, 17);
      w.cars[1].quat.set(0, 0, 0, 1);
      const snap = unpackSnapshot(packSnapshot(w));
      // Llegada con jitter de ±8 ms.
      const jitter = ((tick * 7919) % 17) - 8;
      buf.push(snap!, (tick / 120) * 1000 + 40 + jitter);
      if (tick > 100) {
        buf.sample((tick / 120) * 1000 + 40, frame, 0);
        positions.push(frame.cars[1].pos.x);
      }
    }
    for (let i = 1; i < positions.length; i++) {
      const step = positions[i] - positions[i - 1];
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(40); // 1000 uu/s × 2 ticks = 16,7 uu esperados
    }
    // El retardo de interpolación hace que se dibuje un poco por detrás del servidor.
    const lag = 1000 * (600 / 120) - positions[positions.length - 1];
    expect(lag).toBeGreaterThan(40);
    expect(lag).toBeLessThan(400);
  });
});

describe('utilidades de validación', () => {
  it('los códigos de sala son válidos y se detectan los inválidos', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(isValidCode(c)).toBe(true);
    }
    expect(isValidCode('ABCDE')).toBe(true);
    expect(isValidCode('abcde')).toBe(false);
    expect(isValidCode('AB0DE')).toBe(false); // 0 no está en el alfabeto
    expect(isValidCode('ABCD')).toBe(false);
    expect(isValidCode(12345)).toBe(false);
    expect(CODE_ALPHABET).not.toMatch(/[0O1I]/);
  });
  it('los nombres se limpian de HTML y caracteres de control', () => {
    expect(sanitizeName('<b>Ana</b>')).toBe('bAna/b');
    expect(sanitizeName('  Pedro\n\t el   largo nombre de más de 16  ')).toHaveLength(16);
    expect(sanitizeName(42)).toBe('Jugador');
    expect(sanitizeName('')).toBe('Jugador');
    expect(clampNum(5, 0, 3)).toBe(3);
    expect(clampNum('x', 0, 3)).toBe(0);
    expect(clampNum(NaN, -1, 1)).toBe(0);
  });
  it('la cubeta de fichas limita ráfagas y se rellena con el tiempo', () => {
    let now = 0;
    const b = new TokenBucket(5, 10, () => now);
    for (let i = 0; i < 5; i++) expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 200; // +2 fichas
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });
});
