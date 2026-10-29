import { describe, expect, it } from 'vitest';
import { BotManager, Vec3, World, arenaDepth, arenaQuery } from '../src/sim';
import { arenaQueryV, queryDepth } from '../src/sim/arena';

describe('presupuesto de rendimiento de la simulación', () => {
  it('3v3 con bots Pro cuesta menos de 1 ms por tick (120 Hz) de media', () => {
    const w = new World(3);
    for (let i = 0; i < 3; i++) w.addCar(0);
    for (let i = 0; i < 3; i++) w.addCar(1);
    const bm = new BotManager(w, 3);
    w.cars.forEach((c) => bm.add(c.id, 'pro'));
    w.startMatch({ duration: 120 });
    for (let i = 0; i < 600; i++) {
      bm.update();
      w.step();
      w.drainEvents();
    }
    const ticks = 120 * 5;
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      bm.update();
      w.step();
      w.drainEvents();
    }
    const msPerTick = (performance.now() - t0) / ticks;
    // 120 ticks/s → 1 ms/tick sería el 12 % de un núcleo; en la práctica son ~0,1 ms.
    expect(msPerTick).toBeLessThan(1);
  });
});

describe('SDF sin asignaciones', () => {
  it('arenaQueryV, arenaQuery y arenaDepth coinciden y la normal es unitaria', () => {
    const n1 = new Vec3();
    const n2 = new Vec3();
    const pts: [number, number, number][] = [
      [0, 0, 500],
      [3900, 0, 800],
      [-3000, 4900, 100],
      [3500, 4700, 1900],
      [0, 5300, 200],
      [-1200, -2000, 20],
    ];
    for (const [x, y, z] of pts) {
      const d = arenaQuery(x, y, z, n1);
      arenaQueryV(new Vec3(x, y, z), n2);
      expect(queryDepth[0]).toBe(d);
      expect(d).toBe(arenaDepth(x, y, z));
      expect(n1.x).toBe(n2.x);
      expect(n1.y).toBe(n2.y);
      expect(n1.z).toBe(n2.z);
      expect(n1.length()).toBeCloseTo(1, 6);
    }
  });
});
