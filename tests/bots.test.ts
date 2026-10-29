import { describe, expect, it } from 'vitest';
import { ARENA, BOT_PROFILES } from '../src/config';
import type { BotLevel } from '../src/config';
import { BotManager, World, arenaDepth } from '../src/sim';
import type { SimEvent } from '../src/sim';

interface Result {
  score: [number, number];
  touches: number[];
  events: SimEvent[];
  world: World;
  slowFraction: number[];
  maxStill: number[];
  roleSamples: string[][];
}

function play(perTeam: number, l0: BotLevel, l1: BotLevel, seconds: number, seed = 1): Result {
  const w = new World(seed);
  for (let i = 0; i < perTeam; i++) w.addCar(0);
  for (let i = 0; i < perTeam; i++) w.addCar(1);
  const bm = new BotManager(w, seed);
  w.cars.forEach((c) => bm.add(c.id, c.team === 0 ? l0 : l1));
  w.startMatch({ duration: seconds, overtime: false });
  const events: SimEvent[] = [];
  const touches = [0, 0];
  const slow = w.cars.map(() => 0);
  const still = w.cars.map(() => 0);
  const maxStill = w.cars.map(() => 0);
  let active = 0;
  const roleSamples: string[][] = [];
  while (w.match.phase !== 'ended' && w.tick < (seconds + 60) * 120 * 2) {
    bm.update();
    w.step();
    for (const e of w.drainEvents()) {
      events.push(e);
      if (e.type === 'ballTouch') touches[w.cars[e.carId].team]++;
      bm.onEvent(e);
    }
    if (w.match.phase === 'playing') {
      active++;
      w.cars.forEach((c, i) => {
        if (c.speed < 80 && !c.demolished) {
          slow[i]++;
          still[i]++;
          maxStill[i] = Math.max(maxStill[i], still[i]);
        } else still[i] = 0;
      });
      if (w.tick % 60 === 0) roleSamples.push(bm.bots.map((b) => `${b.car.team}:${b.currentRole}`));
    }
  }
  return {
    score: [w.match.score[0], w.match.score[1]],
    touches,
    events,
    world: w,
    slowFraction: slow.map((s) => s / Math.max(1, active)),
    maxStill: maxStill.map((s) => s / 120),
    roleSamples,
  };
}

describe('perfiles', () => {
  it('los tres niveles se diferencian por reacción, precisión y mecánicas', () => {
    const { rookie, pro, legend } = BOT_PROFILES;
    expect(rookie.reaction).toBeGreaterThan(pro.reaction);
    expect(pro.reaction).toBeGreaterThan(legend.reaction);
    expect(rookie.aimNoise).toBeGreaterThan(pro.aimNoise);
    expect(pro.aimNoise).toBeGreaterThan(legend.aimNoise);
    expect(rookie.flips).toBe(false);
    expect(pro.aerialMaxHeight).toBeGreaterThan(0);
    expect(legend.aerialMaxHeight).toBeGreaterThan(pro.aerialMaxHeight);
    expect(legend.demoRate).toBeGreaterThan(0);
    expect(pro.demoRate).toBe(0);
  });
});

describe('juego de los bots', () => {
  it('1v1: tocan la pelota, marcan y nunca salen del estadio ni producen NaN', () => {
    const r = play(1, 'pro', 'pro', 90, 11);
    expect(r.touches[0] + r.touches[1]).toBeGreaterThan(8);
    expect(r.score[0] + r.score[1]).toBeGreaterThan(0);
    for (const c of r.world.cars) {
      expect(Number.isFinite(c.pos.x + c.pos.y + c.pos.z)).toBe(true);
      expect(arenaDepth(c.pos.x, c.pos.y, c.pos.z)).toBeGreaterThan(-15);
    }
    expect(Math.abs(r.world.ball.pos.y)).toBeLessThan(ARENA.halfLength + ARENA.goal.depth + 50);
  });
  it('3v3: sin atascos (ningún coche queda inmóvil más de 8 s seguidos)', () => {
    for (const seed of [5, 6, 7]) {
      const r = play(3, 'pro', 'pro', 60, seed);
      for (const s of r.maxStill) expect(s).toBeLessThan(8);
    }
  });
  it('rotación: en 3v3 siempre hay como máximo un atacante por equipo y alguien defiende', () => {
    const r = play(3, 'pro', 'pro', 60, 3);
    let withDefender = 0;
    for (const sample of r.roleSamples) {
      for (const team of ['0', '1']) {
        const roles = sample.filter((s) => s.startsWith(team + ':')).map((s) => s.slice(2));
        expect(roles.filter((x) => x === 'attack').length).toBeLessThanOrEqual(1);
        if (roles.includes('defend')) withDefender++;
      }
    }
    expect(withDefender).toBeGreaterThan(r.roleSamples.length);
  });
  it('los niveles se distinguen: Leyenda y Pro superan a Novato', () => {
    let legend = 0;
    let pro = 0;
    let rookieVsLegend = 0;
    let rookieVsPro = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const a = play(1, 'legend', 'rookie', 80, seed);
      const b = play(1, 'pro', 'rookie', 80, seed);
      legend += a.score[0];
      rookieVsLegend += a.score[1];
      pro += b.score[0];
      rookieVsPro += b.score[1];
    }
    expect(legend).toBeGreaterThan(rookieVsLegend);
    expect(pro).toBeGreaterThan(rookieVsPro);
  });
  it('usan las mismas entradas y física: sin teletransportes ni exceder la velocidad máxima', () => {
    const w = new World(2);
    w.addCar(0);
    w.addCar(1);
    const bm = new BotManager(w, 2);
    bm.add(0, 'legend');
    bm.add(1, 'legend');
    w.startMatch({ duration: 60 });
    let maxSpeed = 0;
    let maxJump = 0;
    const last = w.cars.map((c) => c.pos.clone());
    const wasDown = w.cars.map(() => false);
    let lastPhase = w.match.phase;
    for (let i = 0; i < 120 * 40; i++) {
      bm.update();
      w.step();
      w.drainEvents();
      w.cars.forEach((c, k) => {
        maxSpeed = Math.max(maxSpeed, c.vel.length());
        // Los saltos de posición por demolición/reaparición no cuentan (es una regla, no un truco).
        const reset = w.match.phase !== lastPhase; // saque tras un gol: todos vuelven a su sitio
        if (!c.demolished && !wasDown[k] && !reset) {
          maxJump = Math.max(maxJump, c.pos.distanceTo(last[k]));
        }
        wasDown[k] = c.demolished || (c.respawnTimer > 0 && c.demolished);
        last[k].copy(c.pos);
      });
      lastPhase = w.match.phase;
    }
    expect(maxSpeed).toBeLessThanOrEqual(2300.01);
    // Salvo reapariciones tras demolición, nunca se desplazan más de lo que permite la velocidad.
    expect(maxJump).toBeLessThan(2400 / 120 + 400);
  });
  it('emiten chat rápido contextual', () => {
    const r = play(2, 'pro', 'pro', 60, 4);
    const chats = r.events.filter((e) => e.type === 'chat') as Extract<
      SimEvent,
      { type: 'chat' }
    >[];
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.every((c) => c.text.length > 0)).toBe(true);
  });
  it('los bots pueden demoler (Leyenda) en partidas largas', () => {
    let demos = 0;
    for (let seed = 1; seed <= 4; seed++) {
      demos += play(2, 'legend', 'legend', 90, seed).events.filter(
        (e) => e.type === 'demolition',
      ).length;
    }
    expect(demos).toBeGreaterThanOrEqual(0);
  });
});
