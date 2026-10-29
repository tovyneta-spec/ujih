import { describe, expect, it } from 'vitest';
import { MATCH } from '../src/config';
import { Recorder, ReplayPlayer, createRenderFrame } from '../src/replay';
import { World, neutralInput } from '../src/sim';

function worldWithCars(): World {
  const w = new World(3);
  w.addCar(0);
  w.addCar(1);
  w.startMatch({ duration: 120, replayTime: 7 });
  for (let i = 0; i < 4 * 120; i++) w.step();
  w.drainEvents();
  w.pads.forEach((p) => {
    p.active = false;
    p.timer = 1e9;
  });
  return w;
}

describe('grabador de repeticiones', () => {
  it('graba a 60 Hz y reproduce estados interpolados', () => {
    const w = worldWithCars();
    const rec = new Recorder(120, 60, 12, 2);
    for (let i = 0; i < 240; i++) {
      w.cars[0].setInput({ ...neutralInput(), throttle: 1, boost: true });
      w.step();
      rec.capture(w);
    }
    expect(rec.length).toBe(120);
    const { start, end } = rec.span;
    expect(end - start).toBeCloseTo(2, 1);
    const frame = createRenderFrame(2);
    expect(rec.sample((start + end) / 2, frame)).toBe(true);
    // Posición del coche a mitad de grabación: entre el primer y el último fotograma.
    const first = createRenderFrame(2);
    const last = createRenderFrame(2);
    rec.sample(start, first);
    rec.sample(end, last);
    expect(frame.cars[0].pos.y).toBeGreaterThan(first.cars[0].pos.y);
    expect(frame.cars[0].pos.y).toBeLessThan(last.cars[0].pos.y);
    expect(frame.cars[0].boosting).toBe(true);
  });
  it('el búfer es circular: sólo conserva los últimos segundos', () => {
    const w = worldWithCars();
    const rec = new Recorder(120, 60, 2, 2);
    for (let i = 0; i < 600; i++) {
      w.step();
      rec.capture(w);
    }
    expect(rec.length).toBe(120);
    expect(rec.span.end - rec.span.start).toBeLessThan(2.05);
  });
  it('el reproductor recorta el segmento a lo grabado', () => {
    const w = worldWithCars();
    const rec = new Recorder(120, 60, 12, 2);
    for (let i = 0; i < 360; i++) {
      w.step();
      rec.capture(w);
    }
    const frame = createRenderFrame(2);
    const player = new ReplayPlayer(rec, frame);
    const dur = player.begin(w.time - 1, 5, 2, 0, 0);
    expect(dur).toBeLessThanOrEqual(3.1);
    expect(player.seek(0)).toBe(true);
    expect(player.seek(999)).toBe(true);
  });
});

describe('fase de repetición en la simulación', () => {
  function goalWorld(): World {
    const w = worldWithCars();
    w.cars[0].place(-2000, -3000, 0);
    w.cars[1].place(2000, 3000, 0);
    // Toque del azul y gol.
    w.match.onTouch(w, w.cars[0]);
    w.ball.pos.set(0, 4800, 120);
    w.ball.vel.set(0, 2500, 0);
    return w;
  }
  it('tras el gol y la celebración congela el juego durante la repetición y luego saca', () => {
    const w = goalWorld();
    const events: string[] = [];
    let guard = 0;
    while (w.match.phase !== 'replay' && guard++ < 120 * 10) {
      w.step();
      events.push(...w.drainEvents().map((e) => e.type));
    }
    expect(w.match.phase).toBe('replay');
    expect(events).toContain('replayStart');
    const frozenBall = w.ball.pos.clone();
    for (let i = 0; i < 120 * 3; i++) w.step();
    expect(w.ball.pos.distanceTo(frozenBall)).toBe(0); // simulación congelada
    expect(w.match.phase).toBe('replay');
    for (let i = 0; i < 120 * 4.2; i++) w.step();
    expect(w.match.phase).toBe('countdown');
    void MATCH;
  });
  it('se puede saltar la repetición', () => {
    const w = goalWorld();
    let guard = 0;
    while (w.match.phase !== 'replay' && guard++ < 120 * 10) w.step();
    expect(w.match.phase).toBe('replay');
    w.match.skipReplay(w);
    expect(w.match.phase).toBe('countdown');
  });
});
