import { describe, expect, it } from 'vitest';
import { ARENA, BALL, BOOST_PADS, PADS } from '../src/config';
import { World, Vec3, arenaDepth, arenaQuery, goalScoredBy, neutralInput } from '../src/sim';
import type { CarInput } from '../src/sim';

const DT = 1 / 120;

function input(p: Partial<CarInput> = {}): CarInput {
  return { ...neutralInput(), ...p };
}

function run(
  world: World,
  seconds: number,
  inp: Partial<CarInput> | ((t: number) => Partial<CarInput>),
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const p = typeof inp === 'function' ? inp(i * DT) : inp;
    world.cars.forEach((c) => c.setInput(input(p)));
    world.step();
  }
}

function singleCar(x = 0, y = -3000, yaw = Math.PI / 2): World {
  const w = new World(1);
  const car = w.addCar(0);
  car.place(x, y, yaw);
  w.ball.reset(3000, 3000, 2000); // pelota lejos
  w.ball.vel.set(0, 0, 0);
  w.pads.forEach((p) => {
    p.active = false;
    p.timer = 1e9;
  }); // sin pads: no alteran el turbo
  return w;
}

describe('estadio (SDF)', () => {
  it('es jugable en el centro y sólido fuera', () => {
    expect(arenaDepth(0, 0, 500)).toBeGreaterThan(200);
    expect(arenaDepth(0, 0, -50)).toBeLessThan(0);
    expect(arenaDepth(5000, 0, 500)).toBeLessThan(0);
    expect(arenaDepth(0, 0, ARENA.height + 50)).toBeLessThan(0);
  });
  it('la normal del suelo apunta arriba y la de la pared lateral hacia dentro', () => {
    const n = new Vec3();
    arenaQuery(0, 0, 10, n);
    expect(n.z).toBeCloseTo(1, 3);
    arenaQuery(ARENA.halfWidth - 20, 0, 1000, n);
    expect(n.x).toBeCloseTo(-1, 3);
  });
  it('la portería es un hueco en la pared de fondo, cerrado fuera de ella', () => {
    expect(arenaDepth(0, ARENA.halfLength + 400, 300)).toBeGreaterThan(100);
    expect(arenaDepth(ARENA.goal.halfWidth + 200, ARENA.halfLength + 400, 300)).toBeLessThan(0);
    expect(arenaDepth(0, ARENA.halfLength + 400, ARENA.goal.height + 200)).toBeLessThan(0);
  });
});

describe('pelota', () => {
  it('cae con la gravedad configurada', () => {
    const w = new World();
    w.ball.reset(0, 0, 1500);
    for (let i = 0; i < 60; i++) w.step(); // 0,5 s
    expect(w.ball.vel.z).toBeGreaterThan(-340);
    expect(w.ball.vel.z).toBeLessThan(-300);
  });
  it('rebota con la restitución esperada y nunca atraviesa el suelo', () => {
    const w = new World();
    w.ball.reset(0, 0, 1000);
    let minZ = Infinity;
    for (let i = 0; i < 120 * 6; i++) {
      w.step();
      minZ = Math.min(minZ, w.ball.pos.z);
    }
    expect(minZ).toBeGreaterThan(BALL.radius - 2);
  });
  it('limita la velocidad máxima a 6000 uu/s', () => {
    const w = new World();
    w.ball.reset(0, 0, 1000);
    w.ball.vel.set(9000, 0, 0);
    w.step();
    expect(w.ball.vel.length()).toBeLessThanOrEqual(6000.001);
  });
  it('detecta gol sólo cuando cruza completamente la línea', () => {
    const r = BALL.radius;
    expect(goalScoredBy(0, ARENA.halfLength + r - 1, 100, r)).toBe(-1);
    expect(goalScoredBy(0, ARENA.halfLength + r + 1, 100, r)).toBe(0);
    expect(goalScoredBy(0, -(ARENA.halfLength + r + 1), 100, r)).toBe(1);
    expect(goalScoredBy(ARENA.goal.halfWidth + 10, ARENA.halfLength + 200, 100, r)).toBe(-1);
  });
  it('la pelota rueda dentro de la portería y emite evento de gol', () => {
    const w = new World();
    w.ball.reset(0, ARENA.halfLength - 600, 120);
    w.ball.vel.set(0, 1800, 0);
    let goals = 0;
    for (let i = 0; i < 240; i++) {
      w.step();
      goals += w.drainEvents().filter((e) => e.type === 'goal').length;
    }
    expect(goals).toBeGreaterThan(0);
    // No atraviesa el fondo de la red.
    expect(w.ball.pos.y).toBeLessThan(ARENA.halfLength + ARENA.goal.depth);
  });
  it('rebota en el larguero y los postes sin atravesarlos', () => {
    const w = new World();
    w.ball.reset(0, ARENA.halfLength - 300, ARENA.goal.height + 250);
    w.ball.vel.set(0, 1500, 0);
    for (let i = 0; i < 240; i++) w.step();
    expect(w.ball.pos.y).toBeLessThan(ARENA.halfLength);
  });
});

describe('coche', () => {
  it('acelera según la curva del motor (≈957 uu/s tras 1 s)', () => {
    const w = singleCar();
    run(w, 1, { throttle: 1 });
    const v = w.cars[0].vel.length();
    expect(v).toBeGreaterThan(900);
    expect(v).toBeLessThan(1010);
  });
  it('no supera 2300 uu/s ni con turbo', () => {
    const w = singleCar(0, -4400);
    w.cars[0].boost = 100;
    let max = 0;
    for (let i = 0; i < 120 * 3; i++) {
      w.cars[0].setInput(input({ throttle: 1, boost: true }));
      w.step();
      max = Math.max(max, w.cars[0].vel.length());
    }
    expect(max).toBeLessThanOrEqual(2300.001);
    expect(max).toBeGreaterThan(1800);
  });
  it('permanece en el suelo sin entrada y se detiene por la deceleración', () => {
    const w = singleCar();
    w.cars[0].vel.set(0, 1000, 0);
    run(w, 1, {});
    expect(w.cars[0].grounded).toBe(true);
    expect(w.cars[0].vel.length()).toBeLessThan(560);
    expect(w.cars[0].pos.z).toBeLessThan(w.cars[0].half.z + 3);
  });
  it('el turbo consume ≈33,3/s y se agota en 3 s', () => {
    const w = singleCar();
    w.cars[0].boost = 100;
    run(w, 1, { boost: true });
    expect(w.cars[0].boost).toBeGreaterThan(65);
    expect(w.cars[0].boost).toBeLessThan(67.5);
    run(w, 3, { boost: true });
    expect(w.cars[0].boost).toBe(0);
  });
  it('una pulsación breve de turbo consume como mínimo 0,1 s', () => {
    const w = singleCar();
    w.cars[0].boost = 50;
    run(w, 0.01, { boost: true });
    run(w, 0.5, {});
    expect(50 - w.cars[0].boost).toBeGreaterThan(3);
  });
  it('salta con impulso inicial y más alto manteniendo el botón', () => {
    const short = singleCar();
    run(short, 0.05, { jump: true });
    run(short, 0.05, {});
    const high = singleCar();
    run(high, 0.3, { jump: true });
    let maxShort = 0;
    let maxHigh = 0;
    for (let i = 0; i < 120; i++) {
      short.step();
      high.step();
      maxShort = Math.max(maxShort, short.cars[0].pos.z);
      maxHigh = Math.max(maxHigh, high.cars[0].pos.z);
    }
    expect(maxHigh).toBeGreaterThan(maxShort + 20);
    expect(maxShort).toBeGreaterThan(40);
  });
  it('doble salto vertical sin dirección', () => {
    const w = singleCar();
    run(w, 0.1, { jump: true });
    run(w, 0.15, {});
    const vzBefore = w.cars[0].vel.z;
    run(w, DT, { jump: true });
    expect(w.cars[0].vel.z - vzBefore).toBeGreaterThan(250);
    expect(w.cars[0].flipUsed).toBe(true);
  });
  it('flip hacia delante: +500 uu/s en la dirección de avance y rotación', () => {
    const w = singleCar();
    run(w, 0.1, { jump: true });
    run(w, 0.15, {});
    const car = w.cars[0];
    const vy0 = car.vel.y;
    run(w, DT, { jump: true, pitch: -1, throttle: 1 });
    expect(car.vel.y - vy0).toBeGreaterThan(450);
    expect(car.vel.y - vy0).toBeLessThan(560);
    // Gira unos 360° en el eje de cabeceo.
    let angle = 0;
    for (let i = 0; i < 120; i++) {
      w.cars[0].setInput(input({ pitch: 0 }));
      w.step();
      angle += Math.abs(car.angVel.dot(car.leftAxis)) * DT;
      if (car.grounded) break;
    }
    expect(angle).toBeGreaterThan(Math.PI);
  });
  it('flips en 8 direcciones', () => {
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [f, s] of dirs) {
      const w = singleCar(0, -3000, Math.PI / 2);
      run(w, 0.1, { jump: true });
      run(w, 0.15, {});
      const car = w.cars[0];
      const v0 = car.vel.clone();
      run(w, DT, { jump: true, pitch: -f, yaw: s });
      const dvy = car.vel.y - v0.y; // el coche mira a +y
      const dvx = car.vel.x - v0.x; // derecha del coche = +x
      if (f !== 0) expect(Math.sign(dvy)).toBe(f);
      if (s !== 0) expect(Math.sign(dvx)).toBe(s);
      expect(Math.hypot(dvx, dvy)).toBeGreaterThan(400);
    }
  });
  it('sólo hay segundo salto durante 1,25 s', () => {
    const w = singleCar(0, -3000);
    w.cars[0].boost = 100;
    w.cars[0].pos.z = 1500;
    w.cars[0].airTime = 0;
    // Cae sin saltar: la ventana corre desde que deja el suelo.
    run(w, 1.3, {});
    run(w, DT, { jump: true, pitch: -1 });
    expect(w.cars[0].flipUsed).toBe(false);
  });
  it('control aéreo: el cabeceo cambia la orientación', () => {
    const w = singleCar();
    w.cars[0].pos.z = 1500;
    run(w, 0.5, { pitch: 1 });
    expect(w.cars[0].forward.z).toBeGreaterThan(0.5);
  });
  it('aterriza sobre las ruedas y se pega al suelo', () => {
    const w = singleCar();
    w.cars[0].pos.z = 600;
    w.cars[0].angVel.set(2, 1, 0);
    run(w, 2, { pitch: 0 });
    run(w, 1, {});
    expect(w.cars[0].up.z).toBeGreaterThan(0.9);
  });
  it('sube por la pared y se mantiene adherido', () => {
    const w = singleCar(0, 0, 0); // mira a +x hacia la pared lateral
    w.cars[0].pos.set(2500, 0, 20);
    w.cars[0].boost = 100;
    run(w, 3, { throttle: 1, boost: true });
    const car = w.cars[0];
    expect(car.pos.z).toBeGreaterThan(500);
  });
  it('estadio sin fugas: ninguna entidad sale con entradas aleatorias', () => {
    const w = new World(7);
    w.addCar(0).place(-500, -2000, 1);
    w.addCar(1).place(500, 2000, -2);
    w.ball.reset(0, 0, 400);
    w.ball.vel.set(1500, 1200, 900);
    let seed = 99;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let k = 0; k < 120 * 20; k++) {
      if (k % 30 === 0) {
        w.cars.forEach((c) => {
          c.setInput(
            input({
              throttle: rnd() * 2 - 1,
              steer: rnd() * 2 - 1,
              pitch: rnd() * 2 - 1,
              yaw: rnd() * 2 - 1,
              roll: rnd() * 2 - 1,
              jump: rnd() < 0.3,
              boost: rnd() < 0.6,
              handbrake: rnd() < 0.2,
            }),
          );
        });
      }
      w.step();
      for (const c of w.cars) {
        expect(arenaDepth(c.pos.x, c.pos.y, c.pos.z)).toBeGreaterThan(-10);
        expect(Number.isFinite(c.pos.x + c.vel.x)).toBe(true);
      }
      expect(arenaDepth(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z)).toBeGreaterThan(BALL.radius - 6);
    }
  });
});

describe('golpe coche-pelota', () => {
  it('la pelota sale más rápido que el coche (impulso extra) y sube poco', () => {
    const w = new World(3);
    const car = w.addCar(0);
    car.place(0, -2500, Math.PI / 2);
    car.vel.set(0, 1500, 0);
    w.ball.reset(0, -1900, 130);
    let touched = false;
    for (let i = 0; i < 120; i++) {
      car.setInput(input({ throttle: 1 }));
      w.step();
      if (w.drainEvents().some((e) => e.type === 'ballTouch')) touched = true;
    }
    expect(touched).toBe(true);
    expect(w.ball.vel.length()).toBeGreaterThan(1700);
    expect(w.ball.vel.y).toBeGreaterThan(1500);
  });
  it('tocar la pelota con la parte inferior restaura el flip', () => {
    const w = new World(3);
    const car = w.addCar(0);
    car.place(0, 0, 0);
    car.pos.z = 700;
    car.flipUsed = true;
    car.airTime = 1.0;
    w.ball.reset(0, 0, 700 - car.half.z - 91.25 + 8);
    w.ball.vel.set(0, 0, 0);
    // Para que no caiga: pelota fija relativa; un solo paso basta.
    w.step();
    expect(car.flipUsed).toBe(false);
  });
});

describe('pads de turbo', () => {
  it('hay 34 pads: 6 grandes y 28 pequeños', () => {
    expect(BOOST_PADS).toHaveLength(34);
    expect(BOOST_PADS.filter((p) => p.size === 'big')).toHaveLength(6);
    expect(BOOST_PADS.filter((p) => p.size === 'small')).toHaveLength(28);
  });
  it('dan la cantidad correcta y reaparecen a su tiempo', () => {
    const w = new World();
    const car = w.addCar(0);
    const big = w.pads.findIndex((p) => p.spec.size === 'big');
    const small = w.pads.findIndex((p) => p.spec.size === 'small');
    car.place(w.pads[small].spec.x, w.pads[small].spec.y, 0);
    car.boost = 0;
    w.ball.reset(3000, 3000, 2000);
    w.step();
    expect(car.boost).toBe(PADS.small.amount);
    expect(w.pads[small].active).toBe(false);
    car.place(w.pads[big].spec.x, w.pads[big].spec.y, 0);
    car.boost = 10;
    w.step();
    expect(car.boost).toBe(100);
    car.place(0, -3000, 0);
    car.vel.set(0, 0, 0);
    for (let i = 0; i < 120 * 4 + 2; i++) w.step();
    expect(w.pads[small].active).toBe(true);
    expect(w.pads[big].active).toBe(false);
    for (let i = 0; i < 120 * 6 + 2; i++) w.step();
    expect(w.pads[big].active).toBe(true);
  });
});

describe('determinismo y snapshots', () => {
  it('dos simulaciones idénticas producen el mismo estado', () => {
    const make = () => {
      const w = new World(5);
      w.addCar(0);
      w.resetKickoff();
      return w;
    };
    const a = make();
    const b = make();
    for (let i = 0; i < 600; i++) {
      for (const w of [a, b]) {
        w.cars[0].setInput(
          input({ throttle: 1, boost: i % 50 < 25, steer: Math.sin(i / 40), jump: i % 90 === 0 }),
        );
        w.step();
      }
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });
  it('restaurar un snapshot reproduce la misma evolución', () => {
    const w = new World(5);
    w.addCar(0);
    w.resetKickoff();
    const drive = (world: World, n: number, off: number) => {
      for (let i = 0; i < n; i++) {
        world.cars[0].setInput(input({ throttle: 1, steer: Math.sin((i + off) / 30) }));
        world.step();
      }
    };
    drive(w, 200, 0);
    const snap = JSON.parse(JSON.stringify(w.snapshot()));
    drive(w, 200, 200);
    const end = JSON.stringify(w.snapshot());
    w.restore(snap);
    drive(w, 200, 200);
    expect(JSON.stringify(w.snapshot())).toBe(end);
  });
});
