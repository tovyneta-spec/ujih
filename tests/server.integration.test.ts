import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import type { LobbyInfo, ServerMsg } from '../src/net/protocol';
import { packInputs, unpackSnapshot } from '../src/net/state';
import { neutralInput } from '../src/sim';
import { startServer } from '../server/index';

type Srv = ReturnType<typeof startServer>;
let srv: Srv;
let base: string;

beforeAll(async () => {
  srv = startServer(0, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  base = `127.0.0.1:${srv.port()}`;
});
afterAll(async () => {
  await srv.close();
});

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  snapshots: Uint8Array[] = [];
  closed = false;
  constructor(url = `ws://${base}/ws`) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) this.snapshots.push(new Uint8Array(data as Buffer));
      else this.msgs.push(JSON.parse(data.toString()) as ServerMsg);
    });
    this.ws.on('close', () => (this.closed = true));
    this.ws.on('error', () => (this.closed = true));
  }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: object): void {
    this.ws.send(JSON.stringify(m));
  }
  hello(name = 'Test', token?: string): void {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, look: {}, token });
  }
  async waitFor<T extends ServerMsg['t']>(t: T, ms = 3000): Promise<Extract<ServerMsg, { t: T }>> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const m = [...this.msgs].reverse().find((x) => x.t === t);
      if (m) return m as Extract<ServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no llegó ${t}; recibido: ${this.msgs.map((m) => m.t).join(',')}`);
  }
  close(): void {
    this.ws.close();
  }
}

async function connect(name?: string): Promise<Client> {
  const c = new Client();
  await c.open();
  c.hello(name);
  await c.waitFor('welcome');
  return c;
}

describe('servidor real (WebSocket)', () => {
  it('responde en /health', async () => {
    const res = await fetch(`http://${base}/health`);
    const body = (await res.json()) as { ok: boolean; rooms: number };
    expect(body.ok).toBe(true);
    expect(typeof body.rooms).toBe('number');
  });

  it('dos clientes juegan una partida: start, snapshots a ~60 Hz y confirmación de entradas', async () => {
    const a = await connect('Ana');
    const b = await connect('Beto');
    a.send({ t: 'create', format: '1v1', level: 'rookie', durationMinutes: 3 });
    const code = (await a.waitFor('lobby')).lobby.code;
    b.send({ t: 'join', code });
    const lobby = (await b.waitFor('lobby')).lobby as LobbyInfo;
    expect(lobby.players.map((p) => p.name).sort()).toEqual(['Ana', 'Beto']);
    a.send({ t: 'start' });
    const sa = await a.waitFor('start');
    const sb = await b.waitFor('start');
    expect(sa.setup.seed).toBe(sb.setup.seed);
    expect(sa.me).not.toBe(sb.me);

    // Ana envía entradas a 60 paquetes/s durante ~1,2 s.
    let seq = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < 1200) {
      a.ws.send(
        packInputs(seq, [
          { ...neutralInput(), throttle: 1 },
          { ...neutralInput(), throttle: 1 },
        ]),
      );
      seq += 2;
      await new Promise((r) => setTimeout(r, 16));
    }
    const rate = a.snapshots.length / 1.2;
    expect(rate).toBeGreaterThan(35); // ~60 Hz teórico; margen para el planificador de CI
    expect(rate).toBeLessThan(75);
    const last = unpackSnapshot(a.snapshots[a.snapshots.length - 1]);
    expect(last).not.toBeNull();
    expect(last!.ack).toBeGreaterThan(20);
    expect(last!.cars).toHaveLength(2);
    expect(b.snapshots.length).toBeGreaterThan(30);
    a.close();
    b.close();
  });

  it('rechaza ráfagas de basura y cierra la conexión', async () => {
    const c = await connect('Spam');
    for (let i = 0; i < 100; i++) c.send({ t: 'ping', ts: i });
    const start = Date.now();
    while (!c.closed && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 20));
    expect(c.closed).toBe(true);
  });

  it('un mensaje de más de 4 KB corta la conexión (maxPayload)', async () => {
    const c = await connect('Big');
    c.ws.send('x'.repeat(10_000));
    const start = Date.now();
    while (!c.closed && Date.now() - start < 2000) await new Promise((r) => setTimeout(r, 20));
    expect(c.closed).toBe(true);
  });

  it('un cliente se reconecta con su token y recupera la partida', async () => {
    const a = await connect('Ana');
    const token = (await a.waitFor('welcome')).token;
    a.send({ t: 'create', format: '1v1', level: 'rookie', durationMinutes: 3 });
    await a.waitFor('lobby');
    a.send({ t: 'start' });
    const first = await a.waitFor('start');
    a.ws.terminate();
    await new Promise((r) => setTimeout(r, 300));
    const a2 = new Client();
    await a2.open();
    a2.hello('Ana', token);
    const again = await a2.waitFor('start');
    expect(again.me).toBe(first.me);
    const t0 = Date.now();
    while (a2.snapshots.length < 5 && Date.now() - t0 < 2000)
      await new Promise((r) => setTimeout(r, 20));
    expect(a2.snapshots.length).toBeGreaterThanOrEqual(5);
    a2.close();
  });
});
