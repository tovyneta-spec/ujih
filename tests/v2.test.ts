// Ajustes de cámara/controles, esquema de ratón, formato 4v4, carrocerías nuevas y subpasos de la pelota.
import { describe, expect, it } from 'vitest';
import {
  ARENA,
  BODY_IDS,
  CAMERA_LIMITS,
  CAR_BODIES,
  DEFAULT_CONTROLS,
  DEFAULT_MUTATORS,
  effectiveBindings,
  resolveMutators,
} from '../src/config';
import { defaultSettings, sanitizeSettings } from '../src/storage';
import { World } from '../src/sim';
import { buildNetWorld } from '../src/net/setup';
import { packSnapshot, snapshotSize, unpackSnapshot } from '../src/net/state';
import { FORMATS } from '../server/room';

describe('ajustes persistentes', () => {
  it('valores por defecto y saneado de datos corruptos', () => {
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
    const s = sanitizeSettings({
      camera: { fov: 9999, distance: -5, shake: 'x' },
      controls: { scheme: 'mouse', keys: { jump: 'KeyJ', boost: '<script>', nope: 'KeyX' } },
    });
    expect(s.camera.fov).toBe(CAMERA_LIMITS.fov.max);
    expect(s.camera.distance).toBe(CAMERA_LIMITS.distance.min);
    expect(s.camera.shake).toBe(true);
    expect(s.controls.scheme).toBe('mouse');
    expect(s.controls.keys.jump).toBe('KeyJ');
    expect(s.controls.keys.boost).toBeUndefined();
    expect((s.controls.keys as Record<string, string>).nope).toBeUndefined();
  });
});

describe('esquemas de control', () => {
  it('teclado: W/S/A/D, y se pueden reasignar teclas', () => {
    const b = effectiveBindings(DEFAULT_CONTROLS);
    expect(b.steerLeft).toContain('KeyA');
    expect(b.jump).toContain('Space');
    const c = effectiveBindings({ ...DEFAULT_CONTROLS, keys: { jump: 'KeyJ', boost: '' } });
    expect(c.jump).toEqual(['KeyJ']);
    expect(c.boost).toEqual([]);
  });
  it('ratón (67tetitasdani): W acelera, S frena, y A/D/Espacio/Shift quedan libres', () => {
    const b = effectiveBindings({ ...DEFAULT_CONTROLS, scheme: 'mouse' });
    expect(b.throttleUp).toContain('KeyW');
    expect(b.throttleDown).toContain('KeyS');
    expect(b.steerLeft).toEqual([]);
    expect(b.steerRight).toEqual([]);
    expect(b.jump).toEqual([]);
    expect(b.boost).toEqual([]);
  });
});

describe('formato 4v4', () => {
  it('se resuelve a 4 coches por equipo y el servidor lo admite', () => {
    const r = resolveMutators({ ...DEFAULT_MUTATORS, format: '4v4' });
    expect(r.perTeam).toBe(4);
    expect(FORMATS['4v4']).toBe(4);
  });
  it('8 coches: el saque no los solapa y el snapshot sigue siendo pequeño', () => {
    const r = resolveMutators({ ...DEFAULT_MUTATORS, format: '4v4' });
    const w = new World(7);
    for (let i = 0; i < 8; i++) w.addCar(i < 4 ? 0 : 1, BODY_IDS[i % BODY_IDS.length]);
    w.applyMutators(r);
    w.resetKickoff();
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++)
        expect(w.cars[i].pos.distanceTo(w.cars[j].pos)).toBeGreaterThan(120);
    for (let i = 0; i < 240; i++) w.step();
    for (const c of w.cars) expect(Number.isFinite(c.pos.x)).toBe(true);
    expect(snapshotSize(8, 34)).toBeLessThan(1300);
    const clone = buildNetWorld({
      seed: 7,
      mutators: r,
      botLevel: 'pro',
      cars: w.cars.map((c) => ({
        id: c.id,
        team: c.team,
        body: c.body.id,
        name: 'x',
        bot: true,
        look: undefined as never,
      })),
    });
    const pkt = packSnapshot(w);
    expect(unpackSnapshot(pkt)?.cars).toHaveLength(8);
    expect(clone.cars).toHaveLength(8);
  });
});

describe('carrocerías', () => {
  it('las 3 nuevas tienen proporciones claramente distintas de las demás', () => {
    for (const id of ['viper', 'titan', 'bubble'] as const) expect(CAR_BODIES[id]).toBeDefined();
    expect(CAR_BODIES.viper.height).toBeLessThan(26);
    expect(CAR_BODIES.titan.height).toBeGreaterThan(50);
    expect(CAR_BODIES.titan.model.wheelRadius).toBeGreaterThan(20);
    expect(CAR_BODIES.bubble.length).toBeLessThan(100);
  });
});

describe('pelota: subpasos contra el estadio', () => {
  it('a máxima velocidad nunca atraviesa paredes ni esquinas', () => {
    const w = new World(3);
    const b = w.ball;
    let worst = 0;
    for (const [vx, vy] of [
      [4200, 4200],
      [-6000, 100],
      [3000, -5200],
      [-4300, 4300],
    ]) {
      b.reset(0, 0, 400);
      b.vel.set(vx, vy, 300);
      for (let i = 0; i < 1200; i++) {
        w.step();
        w.drainEvents();
        const outside =
          Math.max(Math.abs(b.pos.x) - ARENA.halfWidth, 0) > 0 ||
          (Math.abs(b.pos.y) > ARENA.halfLength && Math.abs(b.pos.x) > ARENA.goal.halfWidth);
        if (outside) worst = Math.max(worst, 1);
        expect(Number.isFinite(b.pos.x + b.pos.y + b.pos.z)).toBe(true);
      }
    }
    expect(worst).toBe(0);
  });
});
