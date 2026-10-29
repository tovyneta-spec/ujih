import { describe, expect, it } from 'vitest';
import { BALL, DEFAULT_MUTATORS, resolveMutators } from '../src/config';
import type { Mutators } from '../src/config';
import { Series, World, neutralInput } from '../src/sim';
import { parseSetup } from '../src/ui/urlConfig';

const DT = 1 / 120;
const mut = (p: Partial<Mutators>): Mutators => ({ ...DEFAULT_MUTATORS, ...p });

function freeWorld(m: Partial<Mutators> = {}): World {
  const w = new World(1);
  w.addCar(0);
  w.applyMutators(resolveMutators(mut(m)));
  w.cars[0].place(0, -3000, Math.PI / 2);
  w.cars[0].boost = w.rules.startBoost;
  w.pads.forEach((p) => {
    p.active = false;
    p.timer = 1e9;
  });
  return w;
}

describe('mutadores', () => {
  it('traduce formato, duración y pelota a valores numéricos', () => {
    const r = resolveMutators(
      mut({
        format: '3v3',
        durationMinutes: 10,
        ballSize: 'giant',
        ballWeight: 'heavy',
        gravity: 'low',
      }),
    );
    expect(r.perTeam).toBe(3);
    expect(r.match.duration).toBe(600);
    expect(r.ball.radius).toBeGreaterThan(BALL.radius * 2);
    expect(r.ball.mass).toBe(BALL.mass * 2);
    expect(r.gravityScale).toBe(0.5);
    expect(resolveMutators(mut({ durationMinutes: 0 })).match.duration).toBe(0);
  });
  it('gravedad baja: la pelota y el coche caen más despacio', () => {
    const lo = freeWorld({ gravity: 'low' });
    const hi = freeWorld({ gravity: 'high' });
    lo.ball.reset(0, 0, 1500);
    hi.ball.reset(0, 0, 1500);
    for (let i = 0; i < 60; i++) {
      lo.step();
      hi.step();
    }
    expect(Math.abs(hi.ball.vel.z)).toBeGreaterThan(Math.abs(lo.ball.vel.z) * 3);
  });
  it('pelota gigante: usa el radio nuevo en colisiones (reposa más alta)', () => {
    const w = freeWorld({ ballSize: 'giant' });
    w.ball.reset(0, 0, 600);
    for (let i = 0; i < 360; i++) w.step();
    expect(w.ball.pos.z).toBeGreaterThan(BALL.radius * 2);
  });
  it('rebote alto conserva más energía que rebote bajo', () => {
    const peak = (b: Partial<Mutators>): number => {
      const w = freeWorld(b);
      w.ball.reset(0, 0, 1000);
      let landed = false;
      let rebound = 0;
      for (let i = 0; i < 600; i++) {
        w.step();
        if (w.ball.vel.z > 0) landed = true;
        if (landed) rebound = Math.max(rebound, w.ball.pos.z);
      }
      return rebound;
    };
    expect(peak({ ballBounce: 'high' })).toBeGreaterThan(peak({ ballBounce: 'low' }) + 200);
  });
  it('velocidad máxima de pelota configurable', () => {
    const w = freeWorld({ ballMaxSpeed: 'slow' });
    w.ball.reset(0, 0, 500);
    w.ball.vel.set(5000, 0, 0);
    w.step();
    expect(w.ball.vel.length()).toBeLessThanOrEqual(3000.001);
  });
  it('sin turbo: empieza con 0, no consume y los pads no dan nada', () => {
    const w = freeWorld({ boostAmount: 'none' });
    const car = w.cars[0];
    expect(car.boost).toBe(0);
    for (let i = 0; i < 60; i++) {
      car.setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
    }
    expect(car.boosting).toBe(false);
    const wp = new World(1);
    const c = wp.addCar(0);
    wp.applyMutators(resolveMutators(mut({ boostAmount: 'none' })));
    c.place(wp.pads[0].spec.x, wp.pads[0].spec.y, 0);
    c.boost = 0;
    wp.step();
    expect(c.boost).toBe(0);
  });
  it('turbo ilimitado no se agota y recarga lo repone', () => {
    const w = freeWorld({ boostAmount: 'unlimited' });
    for (let i = 0; i < 240; i++) {
      w.cars[0].setInput({ ...neutralInput(), boost: true });
      w.step();
    }
    expect(w.cars[0].boost).toBe(100);
    const r = freeWorld({ boostAmount: 'recharge' });
    r.cars[0].boost = 10;
    for (let i = 0; i < 120; i++) r.step();
    expect(r.cars[0].boost).toBeGreaterThan(15);
  });
  it('fuerza del turbo ×10 acelera mucho más', () => {
    const speedAfter = (s: 1 | 10): number => {
      const w = freeWorld({ boostStrength: s });
      w.cars[0].pos.z = 1500; // en el aire, sin fricción
      w.cars[0].vel.set(0, 0, 0);
      for (let i = 0; i < 30; i++) {
        w.cars[0].setInput({ ...neutralInput(), boost: true });
        w.step();
      }
      return w.cars[0].vel.length();
    };
    expect(speedAfter(10)).toBeGreaterThan(speedAfter(1) * 3);
  });
  it('sin pelota fuera del límite: demoliciones y reaparición pasan a la configuración de la partida', () => {
    const r = resolveMutators(mut({ demolition: 'friendly', respawnTime: 5 }));
    expect(r.match.demolition).toBe('friendly');
    expect(r.match.respawnTime).toBe(5);
  });
  it('velocidad de juego', () => {
    expect(resolveMutators(mut({ gameSpeed: 'slow' })).timeScale).toBeLessThan(1);
    expect(resolveMutators(mut({ gameSpeed: 'fast' })).timeScale).toBeGreaterThan(1);
  });
  it('la simulación sigue siendo determinista con mutadores', () => {
    const run = (): string => {
      const w = freeWorld({ gravity: 'low', ballSize: 'large', boostAmount: 'recharge' });
      for (let i = 0; i < 300; i++) {
        w.cars[0].setInput({
          ...neutralInput(),
          throttle: 1,
          boost: i % 30 < 15,
          steer: Math.sin(i / 20),
        });
        w.step();
      }
      return JSON.stringify(w.snapshot());
    };
    expect(run()).toBe(run());
    void DT;
  });
});

describe('serie', () => {
  it('al mejor de 5 gana quien llega a 3', () => {
    const s = new Series(5);
    s.record(0);
    s.record(1);
    s.record(0);
    expect(s.finished).toBe(false);
    s.record(0);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(0);
  });
  it('partido único termina con la primera victoria', () => {
    const s = new Series(0);
    s.record(1);
    expect(s.winner).toBe(1);
  });
});

describe('configuración por URL', () => {
  it('lee formato, bots, equipo y mutadores', () => {
    const s = parseSetup(
      '?mode=match&format=3v3&bots=legend&team=orange&ballsize=giant&boost=none&series=5',
    );
    expect(s.mode).toBe('match');
    expect(s.mutators.format).toBe('3v3');
    expect(s.mutators.botLevel).toBe('legend');
    expect(s.humanTeam).toBe(1);
    expect(s.mutators.ballSize).toBe('giant');
    expect(s.mutators.boostAmount).toBe('none');
    expect(s.mutators.series).toBe(5);
  });
  it('ignora valores inválidos y mantiene el modo antiguo matchN', () => {
    const s = parseSetup('?mode=match2&gravity=banana&duration=7');
    expect(s.mutators.format).toBe('2v2');
    expect(s.mutators.gravity).toBe('normal');
    expect(s.mutators.durationMinutes).toBe(5);
  });
});
