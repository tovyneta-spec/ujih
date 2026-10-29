import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import type { LobbyInfo, ServerMsg } from '../src/net/protocol';
import { packInputs, unpackSnapshot } from '../src/net/state';
import { neutralInput } from '../src/sim';
import { DEFAULT_CONFIG, GameServer } from '../server/gameServer';
import type { Conn } from '../server/room';

/** Conexión simulada que registra todo lo que recibe. */
class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  binary: Uint8Array[] = [];
  closed: { code?: number; reason?: string } | null = null;
  bufferedAmount = 0;
  send(data: string | Uint8Array): void {
    if (typeof data === 'string') this.msgs.push(JSON.parse(data) as ServerMsg);
    else this.binary.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.msgs].reverse().find((m) => m.t === t) as
      Extract<ServerMsg, { t: T }> | undefined;
  }
  all<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.msgs.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
}

function setup(cfg = DEFAULT_CONFIG) {
  let wall = 1_000_000;
  let mono = 0;
  const server = new GameServer(cfg, () => wall);
  /** Avanza el reloj `ms` milisegundos, ejecutando el bucle del servidor cada 4 ms. */
  const advance = (ms: number): void => {
    for (let t = 0; t < ms; t += 4) {
      wall += 4;
      mono += 4;
      server.tick(mono);
    }
  };
  const client = (ip = '10.0.0.1', name = 'Ana', token?: string): FakeConn => {
    const c = new FakeConn();
    server.connect(c, ip);
    server.message(c, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, look: {}, token }));
    return c;
  };
  return { server, advance, client, clock: () => wall };
}

const send = (s: GameServer, c: FakeConn, m: object): void => s.message(c, JSON.stringify(m));

describe('conexión y saludo', () => {
  it('responde con welcome y un token', () => {
    const { client } = setup();
    const c = client();
    const w = c.last('welcome');
    expect(w?.id).toBeGreaterThan(0);
    expect(w?.token).toMatch(/^[0-9a-f]{32}$/);
  });
  it('rechaza otra versión del protocolo', () => {
    const { server } = setup();
    const c = new FakeConn();
    server.connect(c, '1.1.1.1');
    send(server, c, { t: 'hello', v: 99, name: 'x', look: {} });
    expect(c.last('error')?.code).toBe('version');
    expect(c.closed).not.toBeNull();
  });
  it('exige hello antes de cualquier otro mensaje y expulsa si no llega a tiempo', () => {
    const { server, advance } = setup();
    const c = new FakeConn();
    server.connect(c, '1.1.1.2');
    send(server, c, { t: 'quick', format: '1v1', level: 'pro' });
    expect(c.last('error')?.code).toBe('bad_message');
    advance(6000);
    expect(c.closed?.code).toBe(1008);
  });
  it('limita las conexiones por IP', () => {
    const { server } = setup({ ...DEFAULT_CONFIG, maxPerIp: 2 });
    const a = new FakeConn();
    const b = new FakeConn();
    const c = new FakeConn();
    expect(server.connect(a, '9.9.9.9')).toBe(true);
    expect(server.connect(b, '9.9.9.9')).toBe(true);
    expect(server.connect(c, '9.9.9.9')).toBe(false);
    expect(c.closed?.code).toBe(1013);
    server.close(a);
    expect(server.connect(new FakeConn(), '9.9.9.9')).toBe(true);
  });
  it('sanea el nombre y el aspecto recibidos', () => {
    const { server } = setup();
    const c = new FakeConn();
    server.connect(c, '2.2.2.2');
    send(server, c, {
      t: 'hello',
      v: PROTOCOL_VERSION,
      name: '<script>alert(1)</script>',
      look: { body: 'tank', primary: 'rojo' },
    });
    send(server, c, { t: 'create', format: '1v1', level: 'pro', durationMinutes: 5 });
    const lobby = c.last('lobby')?.lobby as LobbyInfo;
    expect(lobby.players[0].name).not.toMatch(/[<>]/);
  });
});

describe('mensajes inválidos y límites', () => {
  it('JSON roto, tipos desconocidos y mensajes enormes', () => {
    const { server, client } = setup();
    const c = client();
    server.message(c, '{no json');
    expect(c.last('error')?.code).toBe('bad_message');
    server.message(c, JSON.stringify({ nada: 1 }));
    expect(c.last('error')?.code).toBe('bad_message');
    send(server, c, { t: 'inventado' });
    expect(c.last('error')?.code).toBe('bad_message');
    const big = new FakeConn();
    server.connect(big, '3.3.3.3');
    server.message(big, 'x'.repeat(5000));
    expect(big.closed?.code).toBe(1009);
  });
  it('expulsa a quien inunda de mensajes de control', () => {
    const { server, client } = setup();
    const c = client();
    for (let i = 0; i < 200 && !c.closed; i++) send(server, c, { t: 'ping', ts: i });
    expect(c.all('error').some((e) => e.code === 'rate_limited')).toBe(true);
    expect(c.closed?.code).toBe(1008);
  });
  it('valida los parámetros de las peticiones', () => {
    const { server, client } = setup();
    const c = client();
    send(server, c, { t: 'quick', format: '9v9', level: 'pro' });
    expect(c.last('error')?.code).toBe('bad_request');
    send(server, c, { t: 'create', format: '2v2', level: 'dios', durationMinutes: 5 });
    expect(c.last('error')?.code).toBe('bad_request');
    send(server, c, { t: 'create', format: '2v2', level: 'pro', durationMinutes: 999 });
    expect(c.last('error')?.code).toBe('bad_request');
    send(server, c, { t: 'join', code: 'nope' });
    expect(c.last('error')?.code).toBe('room_not_found');
    send(server, c, { t: 'join', code: 'ABCDE' });
    expect(c.last('error')?.code).toBe('room_not_found');
    send(server, c, { t: 'team', team: 1 });
    expect(c.last('error')?.code).toBe('no_room');
  });
});

describe('salas privadas y lobby', () => {
  it('crear, unirse por código, cambiar de equipo y límites de plazas', () => {
    const { server, client } = setup();
    const a = client('1.0.0.1', 'Ana');
    send(server, a, { t: 'create', format: '1v1', level: 'pro', durationMinutes: 5 });
    const code = (a.last('lobby')?.lobby as LobbyInfo).code;
    expect(code).toHaveLength(5);
    const b = client('1.0.0.2', 'Beto');
    send(server, b, { t: 'join', code });
    const lobby = b.last('lobby')?.lobby as LobbyInfo;
    expect(lobby.players).toHaveLength(2);
    expect(lobby.players[0].team).not.toBe(lobby.players[1].team); // reparto automático
    expect(lobby.players.find((p) => p.name === 'Ana')?.isHost).toBe(true);
    // 1v1: una plaza por equipo.
    const c = client('1.0.0.3', 'Carla');
    send(server, c, { t: 'join', code });
    expect(c.last('error')?.code).toBe('room_full');
    send(server, b, { t: 'team', team: 0 });
    expect(b.last('error')?.code).toBe('team_full');
  });
  it('sólo el anfitrión configura e inicia', () => {
    const { server, client } = setup();
    const a = client('1.0.1.1');
    send(server, a, { t: 'create', format: '2v2', level: 'pro', durationMinutes: 5 });
    const code = (a.last('lobby')?.lobby as LobbyInfo).code;
    const b = client('1.0.1.2', 'Beto');
    send(server, b, { t: 'join', code });
    send(server, b, { t: 'cfg', level: 'legend' });
    expect(b.last('error')?.code).toBe('not_host');
    send(server, b, { t: 'start' });
    expect(b.last('error')?.code).toBe('not_host');
    send(server, a, { t: 'cfg', level: 'legend', format: '3v3' });
    expect((a.last('lobby')?.lobby as LobbyInfo | undefined)?.format ?? '3v3').toBe('3v3');
  });
  it('la salida del anfitrión traspasa el mando y la sala vacía se destruye', () => {
    const { server, client, advance } = setup();
    const a = client('1.0.2.1', 'Ana');
    send(server, a, { t: 'create', format: '2v2', level: 'pro', durationMinutes: 5 });
    const code = (a.last('lobby')?.lobby as LobbyInfo).code;
    const b = client('1.0.2.2', 'Beto');
    send(server, b, { t: 'join', code });
    server.close(a);
    advance(100);
    const lobby = b.last('lobby')?.lobby as LobbyInfo;
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0].isHost).toBe(true);
    send(server, b, { t: 'leave' });
    advance(100);
    expect(server.rooms.size).toBe(0);
  });
});

describe('partida rápida', () => {
  it('empareja a jugadores del mismo formato en la misma sala y rellena con bots', () => {
    const { server, client, advance } = setup();
    const a = client('2.0.0.1', 'Ana');
    const b = client('2.0.0.2', 'Beto');
    const other = client('2.0.0.3', 'Otro');
    send(server, a, { t: 'quick', format: '2v2', level: 'pro' });
    send(server, b, { t: 'quick', format: '2v2', level: 'pro' });
    send(server, other, { t: 'quick', format: '1v1', level: 'pro' });
    expect(server.rooms.size).toBe(2);
    advance(11_000); // inicio automático
    const start = a.last('start');
    expect(start).toBeDefined();
    expect(start?.setup.cars).toHaveLength(4);
    expect(start?.setup.cars.filter((c) => c.bot)).toHaveLength(2);
    expect(b.last('start')?.setup.seed).toBe(start?.setup.seed);
    expect(a.last('start')?.me).not.toBe(b.last('start')?.me);
    expect(other.last('start')?.setup.cars).toHaveLength(2);
  });
  it('arranca casi de inmediato cuando la sala se llena', () => {
    const { server, client, advance } = setup();
    const a = client('2.1.0.1');
    const b = client('2.1.0.2');
    send(server, a, { t: 'quick', format: '1v1', level: 'rookie' });
    send(server, b, { t: 'quick', format: '1v1', level: 'rookie' });
    advance(2000);
    expect(a.last('start')).toBeDefined();
    expect(a.last('start')?.setup.cars.every((c) => !c.bot)).toBe(true);
  });
});

function startMatch(f: ReturnType<typeof setup>) {
  const a = f.client('3.0.0.1', 'Ana');
  const b = f.client('3.0.0.2', 'Beto');
  send(f.server, a, { t: 'create', format: '2v2', level: 'pro', durationMinutes: 5 });
  const code = (a.last('lobby')?.lobby as LobbyInfo).code;
  send(f.server, b, { t: 'join', code });
  send(f.server, a, { t: 'start' });
  f.advance(50);
  return { a, b, code };
}

describe('partida online', () => {
  it('envía snapshots binarios a ~60 Hz y confirma las entradas del cliente', () => {
    const f = setup();
    const { a } = startMatch(f);
    expect(a.last('start')?.me).toBeGreaterThanOrEqual(0);
    a.binary.length = 0;
    // El cliente envía una entrada por tick de 120 Hz durante 1 s.
    const inputs = Array.from({ length: 8 }, () => ({ ...neutralInput(), throttle: 1 }));
    let seq = 1;
    for (let ms = 0; ms < 1000; ms += 8) {
      f.server.message(a, packInputs(seq, inputs.slice(0, 1)));
      seq++;
      f.advance(8);
    }
    expect(a.binary.length).toBeGreaterThan(50);
    expect(a.binary.length).toBeLessThan(70);
    const snap = unpackSnapshot(a.binary[a.binary.length - 1]);
    expect(snap).not.toBeNull();
    expect(snap!.ack).toBeGreaterThan(100);
    expect(snap!.cars).toHaveLength(4);
  });
  it('los eventos y el estado de las reglas llegan por JSON', () => {
    const f = setup();
    const { a } = startMatch(f);
    f.advance(4000); // cuenta atrás completa
    expect(a.all('events').some((m) => m.events.some((e) => e.type === 'countdown'))).toBe(true);
    expect(a.all('events').some((m) => m.events.some((e) => e.type === 'go'))).toBe(true);
    expect(a.last('match')?.info.phase).toBeDefined();
  });
  it('descarta paquetes de entrada malformados y expulsa a quien insiste', () => {
    const f = setup();
    const { a } = startMatch(f);
    for (let i = 0; i < 20 && !a.closed; i++) f.server.message(a, new Uint8Array([1, 2, 3]));
    expect(a.closed?.code).toBe(1008);
  });
  it('un coche sin cliente lo lleva un bot y el jugador puede reconectarse con su token', () => {
    const f = setup();
    const { a } = startMatch(f);
    const token = a.last('welcome')!.token;
    const carId = a.last('start')!.me;
    f.server.close(a); // se cae la conexión
    f.advance(2000);
    const a2 = f.client('3.0.0.1', 'Ana', token);
    expect(a2.last('welcome')?.token).toBe(token);
    const again = a2.last('start');
    expect(again?.me).toBe(carId);
    expect(again?.setup.cars).toHaveLength(4);
    a2.binary.length = 0;
    f.advance(200);
    expect(a2.binary.length).toBeGreaterThan(5); // vuelve a recibir snapshots
  });
  it('pasada la ventana de reconexión se pierde la plaza y el coche queda con el bot', () => {
    const f = setup();
    const { a, b } = startMatch(f);
    const token = a.last('welcome')!.token;
    f.server.close(a);
    f.advance(61_000);
    const lobbyCount = f.server.rooms.size;
    expect(lobbyCount).toBe(1);
    const late = f.client('3.0.0.1', 'Ana', token);
    // El token ya no es válido: se crea un jugador nuevo sin sala.
    expect(late.last('start')).toBeUndefined();
    expect(b.closed).toBeNull();
  });
  it('la partida continúa con bots si todos los humanos se van, y se destruye tras un rato', () => {
    const f = setup();
    const { a, b } = startMatch(f);
    f.server.close(a);
    f.server.close(b);
    f.advance(2000);
    expect(f.server.rooms.size).toBe(1);
    f.advance(65_000);
    expect(f.server.rooms.size).toBe(0);
  });
  it('el chat rápido del jugador llega a todos con límite de frecuencia', () => {
    const f = setup();
    const { a, b } = startMatch(f);
    f.advance(100);
    send(f.server, a, { t: 'chat', idx: 0 });
    send(f.server, a, { t: 'chat', idx: 1 }); // dentro del segundo: ignorado
    f.advance(100);
    const chats = b
      .all('events')
      .flatMap((m) => m.events)
      .filter((e) => e.type === 'chat');
    expect(chats).toHaveLength(1);
  });
  it('la revancha sólo la pide el anfitrión y tras terminar la partida', () => {
    const f = setup();
    const { a, b } = startMatch(f);
    send(f.server, b, { t: 'rematch' });
    expect(b.last('error')?.code).toBe('not_host');
    const before = a.all('start').length;
    send(f.server, a, { t: 'rematch' }); // la partida aún no ha terminado: no hace nada
    expect(a.all('start').length).toBe(before);
  });
});
