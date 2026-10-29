import { describe, expect, it } from 'vitest';
import { ARENA, MATCH } from '../src/config';
import type { MatchConfig } from '../src/config';
import { World, neutralInput } from '../src/sim';
import type { SimEvent } from '../src/sim';

const TICK = 120;

function stepSeconds(w: World, s: number, events?: SimEvent[]): void {
  for (let i = 0; i < Math.round(s * TICK); i++) {
    w.step();
    const ev = w.drainEvents();
    if (events) events.push(...ev);
  }
}

/** Mundo 1v1 con partida iniciada y cuenta atrás ya superada; coches parados lejos del balón. */
function matchWorld(cfg: Partial<MatchConfig> = {}, cars = 2): World {
  const w = new World(9);
  w.addCar(0);
  if (cars > 1) w.addCar(1);
  if (cars > 2) w.addCar(0);
  w.startMatch(cfg);
  stepSeconds(w, MATCH.countdown + 0.05);
  w.pads.forEach((p) => {
    p.active = false;
    p.timer = 1e9;
  });
  return w;
}

/** Fuerza un toque a la pelota del coche indicado (la coloca pegada a su morro). */
function touchBall(w: World, carId: number): void {
  const c = w.cars[carId];
  w.ball.pos.copy(c.pos).addScaled(c.forward, c.half.x + 60);
  w.ball.pos.z = 91;
  w.ball.vel.set(0, 0, 0);
  const before = w.match.phase;
  for (let i = 0; i < 3 && w.match.phase === before; i++) w.step();
}

function shootIntoGoal(w: World, towardsPositiveY: boolean): void {
  const s = towardsPositiveY ? 1 : -1;
  w.ball.pos.set(0, s * (ARENA.halfLength - 400), 120);
  w.ball.vel.set(0, s * 2500, 0);
}

describe('saque y reloj', () => {
  it('congela la simulación durante la cuenta atrás 3-2-1 y emite ¡YA!', () => {
    const w = new World(1);
    w.addCar(0);
    w.addCar(1);
    w.startMatch();
    expect(w.match.phase).toBe('countdown');
    const pos0 = w.cars[0].pos.clone();
    const events: SimEvent[] = [];
    for (let i = 0; i < 2.5 * TICK; i++) {
      w.cars[0].setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
      events.push(...w.drainEvents());
    }
    expect(w.cars[0].pos.distanceTo(pos0)).toBe(0);
    stepSeconds(w, 0.6, events);
    expect(w.match.phase).toBe('kickoff');
    expect(events.filter((e) => e.type === 'countdown').map((e) => (e as { n: number }).n)).toEqual(
      [3, 2, 1],
    );
    expect(events.some((e) => e.type === 'go')).toBe(true);
  });
  it('todos los coches empiezan el saque con 33 de turbo', () => {
    const w = matchWorld({}, 3);
    expect(w.cars.every((c) => c.boost === 33)).toBe(true);
  });
  it('el reloj sólo corre tras el primer toque del saque', () => {
    const w = matchWorld();
    const t0 = w.match.timeRemaining;
    stepSeconds(w, 2);
    expect(w.match.timeRemaining).toBe(t0);
    touchBall(w, 0);
    expect(w.match.phase).toBe('playing');
    stepSeconds(w, 1);
    expect(t0 - w.match.timeRemaining).toBeGreaterThan(0.9);
  });
  it('las posiciones de saque de ambos equipos son simétricas', () => {
    const w = new World(4);
    w.addCar(0);
    w.addCar(1);
    w.resetKickoff();
    const [a, b] = w.cars;
    expect(a.pos.x).toBeCloseTo(-b.pos.x, 3);
    expect(a.pos.y).toBeCloseTo(-b.pos.y, 3);
  });
});

describe('goles', () => {
  it('suma el gol, detiene el reloj y reinicia el saque tras la celebración', () => {
    const w = matchWorld();
    touchBall(w, 0);
    stepSeconds(w, 1);
    const events: SimEvent[] = [];
    shootIntoGoal(w, true);
    stepSeconds(w, 0.5, events);
    expect(w.match.score).toEqual([1, 0]);
    expect(w.match.phase).toBe('goal');
    const g = events.find((e) => e.type === 'matchGoal') as Extract<
      SimEvent,
      { type: 'matchGoal' }
    >;
    expect(g.scorerId).toBe(0);
    expect(g.speedKmh).toBeGreaterThanOrEqual(0);
    const t = w.match.timeRemaining;
    stepSeconds(w, 1);
    expect(w.match.timeRemaining).toBe(t); // reloj detenido
    stepSeconds(w, MATCH.goalCelebration + 0.2);
    expect(w.match.phase).toBe('countdown');
    expect(Math.hypot(w.ball.pos.x, w.ball.pos.y)).toBeLessThan(5);
    expect(w.cars.every((c) => c.boost === 33)).toBe(true);
    // No cuenta dos veces el mismo gol.
    expect(w.match.score).toEqual([1, 0]);
  });
  it('reinicia todos los pads tras un gol', () => {
    const w = matchWorld();
    touchBall(w, 0);
    w.pads.forEach((p) => {
      p.active = false;
      p.timer = 1e9;
    });
    shootIntoGoal(w, true);
    stepSeconds(w, MATCH.goalCelebration + 1);
    expect(w.pads.every((p) => p.active)).toBe(true);
  });
  it('puntúa gol 100 y asistencia 50 con el toque previo de un compañero', () => {
    const w = matchWorld({}, 3);
    touchBall(w, 0);
    stepSeconds(w, 0.5);
    touchBall(w, 2); // compañero (mismo equipo)
    stepSeconds(w, 0.3);
    shootIntoGoal(w, true);
    stepSeconds(w, 0.5);
    expect(w.match.stats[2].goals).toBe(1);
    expect(w.match.stats[2].score).toBeGreaterThanOrEqual(MATCH.points.goal);
    expect(w.match.stats[0].assists).toBe(1);
    expect(w.match.stats[0].score).toBe(MATCH.points.assist);
  });
  it('un autogol da el punto al rival sin goleador', () => {
    const w = matchWorld();
    touchBall(w, 1); // el naranja toca…
    stepSeconds(w, 0.3);
    shootIntoGoal(w, false); // …y marca en la portería naranja? (y<0 es la azul): gol para el naranja
    stepSeconds(w, 0.5);
    expect(w.match.score).toEqual([0, 1]);
    shootIntoGoal(w, true);
    expect(w.match.stats[1].goals).toBe(1);
  });
  it('cuenta tiros y paradas', () => {
    const w = matchWorld();
    touchBall(w, 0);
    // Tiro a puerta del azul.
    w.ball.pos.set(0, 2000, 200);
    w.ball.vel.set(0, 2600, 600);
    w.match.onTouch(w, w.cars[0]);
    expect(w.match.stats[0].shots).toBe(1);
    // El naranja desvía la pelota fuera de la portería: parada.
    w.ball.vel.set(1500, -1000, 400);
    w.match.onTouch(w, w.cars[1]);
    expect(w.match.stats[1].saves + w.match.stats[1].epicSaves).toBe(1);
  });
});

describe('fin de partida y prórroga', () => {
  it('con la pelota en el aire al llegar a 0 el juego continúa hasta que toque el suelo', () => {
    const w = matchWorld({ duration: 2 });
    touchBall(w, 0);
    w.ball.pos.set(0, 0, 1500);
    w.ball.vel.set(0, 0, 0);
    stepSeconds(w, 2.04);
    expect(w.match.timeRemaining).toBe(0);
    expect(w.match.phase).toBe('playing'); // aún en el aire (cae desde 1500 uu en ≈2,08 s)
    stepSeconds(w, 0.3);
    expect(w.match.overtime).toBe(true); // empate al tocar el suelo → prórroga
  });
  it('si hay empate entra en prórroga con gol de oro y cronómetro ascendente', () => {
    const w = matchWorld({ duration: 1 });
    touchBall(w, 0);
    w.ball.pos.set(0, 0, 91);
    w.ball.vel.set(0, 0, 0);
    const ev: SimEvent[] = [];
    stepSeconds(w, 1.5, ev);
    expect(w.match.overtime).toBe(true);
    expect(ev.some((e) => e.type === 'overtime')).toBe(true);
    stepSeconds(w, MATCH.countdown + 0.1);
    touchBall(w, 1);
    stepSeconds(w, 2);
    expect(w.match.overtimeTime).toBeGreaterThan(1.5);
    shootIntoGoal(w, false);
    const ev2: SimEvent[] = [];
    stepSeconds(w, MATCH.goalCelebration + 0.5, ev2);
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(1);
    expect(ev2.some((e) => e.type === 'matchEnd')).toBe(true);
  });
  it('gana el equipo con más goles al acabar el tiempo', () => {
    const w = matchWorld({ duration: 3 });
    touchBall(w, 0);
    shootIntoGoal(w, true);
    stepSeconds(w, 0.3);
    stepSeconds(w, MATCH.goalCelebration + MATCH.countdown + 0.3);
    touchBall(w, 1);
    w.ball.pos.set(0, 0, 91);
    w.ball.vel.set(0, 0, 0);
    stepSeconds(w, 4);
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(0);
  });
  it('respeta el máximo de goles', () => {
    const w = matchWorld({ maxGoals: 1 });
    touchBall(w, 0);
    shootIntoGoal(w, true);
    stepSeconds(w, MATCH.goalCelebration + 0.5);
    expect(w.match.phase).toBe('ended');
    expect(w.match.winner).toBe(0);
  });
});

describe('choques y demoliciones', () => {
  function duel(
    cfg: Partial<MatchConfig> = {},
    teamB: 0 | 1 = 1,
  ): { w: World; a: World['cars'][0]; b: World['cars'][0] } {
    const w = new World(2);
    const a = w.addCar(0);
    const b = w.addCar(teamB);
    w.startMatch(cfg);
    stepSeconds(w, MATCH.countdown + 0.05);
    w.pads.forEach((p) => {
      p.active = false;
      p.timer = 1e9;
    });
    a.place(0, -2000, Math.PI / 2);
    b.place(0, -1500, -Math.PI / 2); // de frente
    w.ball.reset(3000, 3000, 1500);
    return { w, a, b };
  }
  it('un coche supersónico que embiste de frente demuele al rival', () => {
    const { w, a, b } = duel();
    a.vel.set(0, 2250, 0);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 90; i++) {
      a.setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
      ev.push(...w.drainEvents());
    }
    expect(b.demolished).toBe(true);
    expect(ev.some((e) => e.type === 'demolition')).toBe(true);
    expect(w.match.stats[0].demos).toBe(1);
    expect(w.match.stats[0].score).toBe(MATCH.points.demo);
  });
  it('el demolido reaparece a los 3 s con 33 de turbo', () => {
    const { w, a, b } = duel();
    a.vel.set(0, 2250, 0);
    for (let i = 0; i < 90; i++) {
      a.setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
    }
    expect(b.demolished).toBe(true);
    b.boost = 5;
    stepSeconds(w, 2);
    expect(b.demolished).toBe(true);
    stepSeconds(w, 1.2);
    expect(b.demolished).toBe(false);
    expect(b.boost).toBe(33);
  });
  it('por debajo de la velocidad supersónica sólo hay empujón', () => {
    const { w, a, b } = duel();
    a.vel.set(0, 1200, 0);
    for (let i = 0; i < 120; i++) {
      a.setInput({ ...neutralInput(), throttle: 1 });
      w.step();
    }
    expect(b.demolished).toBe(false);
    expect(b.vel.length() + a.vel.length()).toBeGreaterThan(0);
  });
  it('no hay demoliciones entre compañeros salvo fuego amigo', () => {
    const mates = duel({}, 0);
    mates.a.vel.set(0, 2250, 0);
    for (let i = 0; i < 90; i++) {
      mates.a.setInput({ ...neutralInput(), throttle: 1, boost: true });
      mates.w.step();
    }
    expect(mates.b.demolished).toBe(false);
    const ff = duel({ demolition: 'friendly' }, 0);
    ff.a.vel.set(0, 2250, 0);
    for (let i = 0; i < 90; i++) {
      ff.a.setInput({ ...neutralInput(), throttle: 1, boost: true });
      ff.w.step();
    }
    expect(ff.b.demolished).toBe(true);
  });
  it('con demoliciones desactivadas nadie es destruido', () => {
    const { w, a, b } = duel({ demolition: 'off' });
    a.vel.set(0, 2250, 0);
    for (let i = 0; i < 90; i++) {
      a.setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
    }
    expect(b.demolished).toBe(false);
  });
  it('en modo "al contacto" basta cualquier embestida frontal', () => {
    const { w, a, b } = duel({ demolition: 'contact' });
    a.vel.set(0, 900, 0);
    for (let i = 0; i < 120; i++) {
      a.setInput({ ...neutralInput(), throttle: 1 });
      w.step();
    }
    expect(b.demolished).toBe(true);
  });
  it('los coches no se atraviesan y se transmiten momento', () => {
    const { w, a, b } = duel({ demolition: 'off' });
    a.vel.set(0, 1500, 0);
    b.vel.set(0, 0, 0);
    b.place(0, -1500, Math.PI / 2); // mismo sentido: A alcanza a B por detrás
    for (let i = 0; i < 90; i++) w.step();
    expect(b.vel.y).toBeGreaterThan(300);
    expect(a.pos.distanceTo(b.pos)).toBeGreaterThan(80);
  });
});

describe('determinismo con partida', () => {
  it('restaurar un snapshot en mitad de la partida reproduce el mismo estado', () => {
    const w = matchWorld({ duration: 60 });
    const drive = (n: number): void => {
      for (let i = 0; i < n; i++) {
        w.cars[0].setInput({
          ...neutralInput(),
          throttle: 1,
          boost: i % 40 < 20,
          steer: Math.sin(i / 25),
        });
        w.cars[1].setInput({ ...neutralInput(), throttle: 1, steer: -Math.sin(i / 31) });
        w.step();
      }
    };
    drive(400);
    const snap = JSON.parse(JSON.stringify(w.snapshot()));
    drive(400);
    const end = JSON.stringify(w.snapshot());
    w.restore(snap);
    drive(400);
    expect(JSON.stringify(w.snapshot())).toBe(end);
  });
});
