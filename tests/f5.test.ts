import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import {
  ANTENNAS,
  BODY_IDS,
  CAR_BODIES,
  DECALS,
  DEFAULT_GARAGE,
  EXPLOSIONS,
  THEMES,
  TRAILS,
  WHEEL_STYLES,
} from '../src/config';
import { distanceGain, engineFrequency, panFor } from '../src/audio/dsp';
import { ParticleSystem } from '../src/render/particles';
import { sanitizeAudio, sanitizeGarage } from '../src/storage';
import { World, neutralInput } from '../src/sim';
import type { SimEvent } from '../src/sim';

describe('garaje', () => {
  it('ofrece 6 carrocerías, 5 ruedas, ≥4 estelas y ≥3 explosiones', () => {
    expect(BODY_IDS).toHaveLength(6);
    for (const id of BODY_IDS) expect(CAR_BODIES[id]).toBeDefined();
    expect(Object.keys(WHEEL_STYLES)).toHaveLength(5);
    expect(Object.keys(TRAILS).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(EXPLOSIONS).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(ANTENNAS).length).toBeGreaterThan(1);
    expect(Object.keys(DECALS).length).toBeGreaterThan(1);
  });
  it('sanea datos corruptos o malintencionados', () => {
    const g = sanitizeGarage({
      name: '<img src=x onerror=1>Nombre larguísimo para el jugador',
      body: 'tank',
      primary: 'rojo',
      secondary: '#ABCDEF',
      wheels: 'square',
      trail: 'rainbow',
      explosion: 5,
    });
    expect(g.name).not.toMatch(/[<>&"]/);
    expect(g.name.length).toBeLessThanOrEqual(16);
    expect(g.body).toBe(DEFAULT_GARAGE.body);
    expect(g.primary).toBe(DEFAULT_GARAGE.primary);
    expect(g.secondary).toBe('#abcdef');
    expect(g.wheels).toBe(DEFAULT_GARAGE.wheels);
    expect(g.trail).toBe('rainbow');
    expect(g.explosion).toBe(DEFAULT_GARAGE.explosion);
    expect(sanitizeGarage(null)).toEqual(DEFAULT_GARAGE);
    expect(sanitizeGarage('basura')).toEqual(DEFAULT_GARAGE);
  });
  it('un garaje válido se conserva', () => {
    const g = {
      ...DEFAULT_GARAGE,
      body: 'merc' as const,
      wheels: 'turbine' as const,
      decal: 'dots' as const,
      name: 'Ana',
    };
    expect(sanitizeGarage(g)).toEqual(g);
  });
});

describe('audio (funciones puras y ajustes)', () => {
  it('el motor sube de tono con la velocidad', () => {
    expect(engineFrequency(0)).toBeLessThan(engineFrequency(1000));
    expect(engineFrequency(1000)).toBeLessThan(engineFrequency(2300));
    expect(engineFrequency(99999)).toBe(engineFrequency(2300));
  });
  it('la ganancia cae con la distancia y es 0 fuera de rango', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(3000)).toBeLessThan(distanceGain(1000));
    expect(distanceGain(7000)).toBe(0);
  });
  it('el panorama refleja de qué lado está la fuente', () => {
    expect(panFor(500, 0, 0, 1, 0, 0)).toBeGreaterThan(0.9);
    expect(panFor(-500, 0, 0, 1, 0, 0)).toBeLessThan(-0.9);
    expect(panFor(0, 500, 0, 1, 0, 0)).toBeCloseTo(0, 5);
  });
  it('sanea los volúmenes e ignora campos antiguos (música)', () => {
    expect(sanitizeAudio({ master: 5, sfx: -1, music: 0.4, musicOn: true })).toEqual({
      master: 1,
      sfx: 0,
    });
    expect(sanitizeAudio(null)).toEqual({ master: 0.8, sfx: 0.9 });
  });
});

describe('temas', () => {
  it('hay 3 temas con paletas distintas y bloom propio', () => {
    const ids = Object.keys(THEMES);
    expect(ids).toEqual(expect.arrayContaining(['day', 'night', 'neon']));
    expect(THEMES.neon.bloom.strength).toBeGreaterThan(THEMES.day.bloom.strength);
    expect(new Set(Object.values(THEMES).map((t) => t.background)).size).toBe(3);
    for (const t of Object.values(THEMES)) {
      expect(t.crowd.length).toBeGreaterThan(2);
      expect(t.wallOpacity).toBeGreaterThan(0);
      expect(t.wallOpacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('partículas', () => {
  const c = new Color(0xffffff);
  const e = { x: 0, y: 0, z: 100, vx: 10, vy: 0, vz: 0, size: 10, life: 0.5, color: c };
  it('emite, envejece y libera partículas sin crecer', () => {
    const ps = new ParticleSystem({ capacity: 50, additive: true });
    for (let i = 0; i < 20; i++) ps.emit(e);
    ps.update(0.1);
    expect(ps.alive).toBe(20);
    ps.update(0.5);
    expect(ps.alive).toBe(0);
  });
  it('el pool es circular: nunca supera su capacidad', () => {
    const ps = new ParticleSystem({ capacity: 10, additive: false });
    for (let i = 0; i < 100; i++) ps.emit(e);
    ps.update(0.01);
    expect(ps.alive).toBe(10);
  });
  it('aplica gravedad y velocidad', () => {
    const ps = new ParticleSystem({ capacity: 4, additive: true });
    ps.emit({ ...e, vx: 100, gravity: -1000, life: 2 });
    ps.update(0.5);
    const pos = ps.points.geometry.getAttribute('position');
    expect(pos.getX(0)).toBeGreaterThan(40);
    expect(pos.getZ(0)).toBeLessThan(100);
  });
});

describe('eventos de impacto de la simulación', () => {
  it('emite ballBounce al caer la pelota con fuerza y wallHit al chocar un coche', () => {
    const w = new World(1);
    const car = w.addCar(0);
    car.place(3300, 0, 0);
    car.pos.z = 900; // en el aire: embiste la pared lateral de frente
    car.vel.set(2000, 0, 0);
    w.pads.forEach((p) => {
      p.active = false;
      p.timer = 1e9;
    });
    w.ball.reset(2000, 2000, 1200);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 240; i++) {
      car.setInput({ ...neutralInput(), throttle: 1, boost: true, steer: 0 });
      w.step();
      ev.push(...w.drainEvents());
    }
    expect(ev.some((e) => e.type === 'ballBounce')).toBe(true);
    expect(ev.some((e) => e.type === 'wallHit')).toBe(true);
  });
});
