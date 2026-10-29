import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NetClient } from '../src/net/client';
import type { NetStatus } from '../src/net/client';
import type { LobbyInfo } from '../src/net/protocol';
import { OnlineMatch } from '../src/net/session';
import type { NetSetup } from '../src/net/setup';
import { neutralInput } from '../src/sim';
import { startServer } from '../server/index';

let srv: ReturnType<typeof startServer>;
let url: string;

beforeAll(async () => {
  srv = startServer(0, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  url = `ws://127.0.0.1:${srv.port()}/ws`;
});
afterAll(async () => {
  await srv.close();
});

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condición');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('NetClient + OnlineMatch contra el servidor real', () => {
  it('conecta, crea sala, empieza y predice con error pequeño mientras recibe snapshots', async () => {
    let lobby: LobbyInfo | null = null;
    let session: OnlineMatch | null = null;
    let setup: NetSetup | null = null;
    const statuses: NetStatus[] = [];
    const client = new NetClient(
      url,
      { name: 'Prueba', look: {} },
      {
        onStatus: (s) => statuses.push(s),
        onLobby: (l) => (lobby = l),
        onStart: (s, me, _tick, match) => {
          setup = s;
          session = new OnlineMatch(s, me);
          session.applyMatchInfo(match);
        },
        onSnapshot: (data) => session?.onSnapshot(data, performance.now()),
        onMatch: (_t, info) => session?.applyMatchInfo(info),
      },
    );
    client.connect();
    await until(() => client.status === 'open');
    client.send({ t: 'create', format: '1v1', level: 'rookie', durationMinutes: 3 });
    await until(() => lobby !== null);
    client.send({ t: 'start' });
    await until(() => session !== null);
    expect(setup!.cars).toHaveLength(2);

    // Bucle de entrada a 120 Hz durante ~3,5 s (cuenta atrás incluida).
    const batch: ReturnType<typeof neutralInput>[] = [];
    let batchSeq = 0;
    const t0 = Date.now();
    let ticks = 0;
    let maxErrAfterWarmup = 0;
    while (Date.now() - t0 < 3500) {
      const due = Math.floor(((Date.now() - t0) / 1000) * 120);
      while (ticks < due) {
        const input = {
          ...neutralInput(),
          throttle: 1,
          boost: ticks % 200 < 60,
          steer: Math.sin(ticks / 60),
        };
        const seq = session!.step(input);
        session!.predictor.smooth(1 / 120);
        if (batch.length === 0) batchSeq = seq;
        batch.push(input);
        ticks++;
      }
      if (batch.length > 0) {
        client.sendInputs(batchSeq, batch);
        batch.length = 0;
      }
      if (Date.now() - t0 > 2000)
        maxErrAfterWarmup = Math.max(maxErrAfterWarmup, session!.predictor.lastError);
      await new Promise((r) => setTimeout(r, 8));
    }
    expect(session!.snapshots).toBeGreaterThan(100);
    expect(session!.predictor.reconciliations).toBeGreaterThan(100);
    // Con latencia de bucle local la predicción debe ser casi perfecta.
    expect(maxErrAfterWarmup).toBeLessThan(25);
    expect(client.rtt).toBeGreaterThan(0);
    expect(session!.world.match.phase).not.toBe('ended');
    client.disconnect();
  });

  it('se reconecta solo con su token y vuelve a recibir la partida', async () => {
    let starts = 0;
    let snaps = 0;
    const statuses: NetStatus[] = [];
    const client = new NetClient(
      url,
      { name: 'Reco', look: {} },
      {
        onStatus: (s) => statuses.push(s),
        onStart: () => starts++,
        onSnapshot: () => snaps++,
      },
    );
    client.connect();
    await until(() => client.status === 'open');
    client.send({ t: 'create', format: '1v1', level: 'rookie', durationMinutes: 3 });
    client.send({ t: 'start' });
    await until(() => starts === 1);
    await until(() => snaps > 5);
    // Corta el socket sin avisar.
    (client as unknown as { ws: WebSocket }).ws.close();
    await until(() => statuses.includes('reconnecting'));
    await until(() => starts === 2, 6000);
    const before = snaps;
    await until(() => snaps > before + 5);
    expect(statuses).toContain('open');
    client.disconnect();
  });
});
