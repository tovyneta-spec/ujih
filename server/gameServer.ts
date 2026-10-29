// Lógica del servidor independiente del transporte: conexiones, salas, emparejamiento rápido,
// validación de mensajes y límites. `index.ts` la conecta a WebSocket real; los tests, a conexiones simuladas.
import { randomBytes } from 'node:crypto';
import { BOT_PROFILES } from '../src/config';
import type { BotLevel } from '../src/config';
import { generateCode, isValidCode, sanitizeName, clampNum } from '../src/net/limits';
import { MAX_INPUT_BATCH, PROTOCOL_VERSION } from '../src/net/protocol';
import type { ClientMsg, ErrorCode, Format, ServerMsg } from '../src/net/protocol';
import { unpackInputs } from '../src/net/state';
import { sanitizeGarage } from '../src/storage';
import { DURATIONS, FORMATS, Player, Room } from './room';
import type { Conn } from './room';

export interface ServerConfig {
  maxRooms: number;
  maxPerIp: number;
  /** Tiempo (ms) para enviar `hello` tras conectar. */
  helloTimeoutMs: number;
  /** Faltas (mensajes inválidos / límites) tras las cuales se expulsa al cliente. */
  maxStrikes: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  maxRooms: 100,
  maxPerIp: 8,
  helloTimeoutMs: 5000,
  maxStrikes: 8,
};

interface ConnState {
  conn: Conn;
  ip: string;
  player: Player | null;
  connectedAt: number;
}

const MAX_JSON_BYTES = 2048;
const isFormat = (v: unknown): v is Format => typeof v === 'string' && v in FORMATS;
const isLevel = (v: unknown): v is BotLevel => typeof v === 'string' && v in BOT_PROFILES;

export class GameServer {
  readonly rooms = new Map<string, Room>();
  private players = new Map<number, Player>();
  private byToken = new Map<string, Player>();
  private conns = new Map<Conn, ConnState>();
  private ipCounts = new Map<string, number>();
  private nextId = 1;

  constructor(
    readonly cfg: ServerConfig = DEFAULT_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {}

  stats(): { rooms: number; players: number; connections: number } {
    return { rooms: this.rooms.size, players: this.players.size, connections: this.conns.size };
  }

  // ------------------------------------------------------------- conexiones

  /** Acepta una conexión nueva; false si se supera el límite por IP. */
  connect(conn: Conn, ip: string): boolean {
    const n = this.ipCounts.get(ip) ?? 0;
    if (n >= this.cfg.maxPerIp) {
      conn.close(1013, 'too many connections');
      return false;
    }
    this.ipCounts.set(ip, n + 1);
    this.conns.set(conn, { conn, ip, player: null, connectedAt: this.now() });
    return true;
  }

  close(conn: Conn): void {
    const st = this.conns.get(conn);
    if (!st) return;
    this.conns.delete(conn);
    const n = (this.ipCounts.get(st.ip) ?? 1) - 1;
    if (n <= 0) this.ipCounts.delete(st.ip);
    else this.ipCounts.set(st.ip, n);
    const p = st.player;
    if (p && p.conn === conn) {
      p.conn = null;
      const room = p.room;
      if (room) {
        if (room.state === 'playing')
          room.disconnect(p); // conserva el coche: hay ventana de reconexión
        else this.dropPlayer(p); // en el lobby no hace falta reservar nada
      } else this.forget(p);
    }
  }

  private forget(p: Player): void {
    this.players.delete(p.id);
    this.byToken.delete(p.token);
  }

  private dropPlayer(p: Player): void {
    const room = p.room;
    if (room) {
      room.leave(p);
      if (room.empty) this.rooms.delete(room.code);
      else room.flushLobby();
    }
    this.forget(p);
  }

  private send(conn: Conn, msg: ServerMsg): void {
    conn.send(JSON.stringify(msg));
  }

  private error(conn: Conn, code: ErrorCode, message: string): void {
    this.send(conn, { t: 'error', code, message });
  }

  /** Cuenta una falta; expulsa al cliente si se pasa del límite. */
  private strike(st: ConnState, why: string): void {
    const p = st.player;
    if (p) p.strikes++;
    const count = p ? p.strikes : this.cfg.maxStrikes;
    if (count >= this.cfg.maxStrikes) st.conn.close(1008, why);
  }

  // --------------------------------------------------------------- mensajes

  message(conn: Conn, data: string | Uint8Array): void {
    const st = this.conns.get(conn);
    if (!st) return;
    if (typeof data !== 'string') {
      this.binary(st, data);
      return;
    }
    if (data.length > MAX_JSON_BYTES) {
      conn.close(1009, 'message too big');
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      this.error(conn, 'bad_message', 'JSON inválido');
      this.strike(st, 'bad json');
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof (msg as { t?: unknown }).t !== 'string') {
      this.error(conn, 'bad_message', 'mensaje sin tipo');
      this.strike(st, 'bad message');
      return;
    }
    const m = msg as ClientMsg;
    if (m.t === 'hello') {
      this.hello(st, m);
      return;
    }
    const p = st.player;
    if (!p) {
      this.error(conn, 'bad_message', 'se esperaba hello');
      this.strike(st, 'no hello');
      return;
    }
    if (!p.control.take()) {
      this.error(conn, 'rate_limited', 'demasiados mensajes');
      this.strike(st, 'rate limit');
      return;
    }
    this.handle(st, p, m);
  }

  private binary(st: ConnState, data: Uint8Array): void {
    const p = st.player;
    if (!p || !p.room || p.carId < 0) return;
    if (!p.inputs.take()) {
      this.strike(st, 'input flood');
      return;
    }
    const pkt = unpackInputs(data, MAX_INPUT_BATCH);
    if (!pkt) {
      this.strike(st, 'bad input packet');
      return;
    }
    p.room.pushInputs(p, pkt.seq, pkt.inputs);
  }

  private hello(st: ConnState, m: Extract<ClientMsg, { t: 'hello' }>): void {
    const conn = st.conn;
    if (st.player) return; // ya identificado
    if (m.v !== PROTOCOL_VERSION) {
      this.error(conn, 'version', `versión de protocolo ${PROTOCOL_VERSION} requerida`);
      conn.close(1002, 'version');
      return;
    }
    // Reconexión con token.
    if (typeof m.token === 'string') {
      const existing = this.byToken.get(m.token);
      if (existing) {
        if (existing.conn && existing.conn !== conn) existing.conn.close(1000, 'replaced');
        existing.conn = conn;
        st.player = existing;
        this.send(conn, {
          t: 'welcome',
          v: PROTOCOL_VERSION,
          id: existing.id,
          token: existing.token,
        });
        if (existing.room) existing.room.reconnect(existing, conn);
        return;
      }
    }
    const token = randomBytes(16).toString('hex');
    const p = new Player(this.nextId++, token, sanitizeName(m.name), sanitizeGarage(m.look));
    p.conn = conn;
    st.player = p;
    this.players.set(p.id, p);
    this.byToken.set(token, p);
    this.send(conn, { t: 'welcome', v: PROTOCOL_VERSION, id: p.id, token });
  }

  private handle(st: ConnState, p: Player, m: ClientMsg): void {
    const conn = st.conn;
    const fail = (code: ErrorCode | null, message = ''): boolean => {
      if (code) this.error(conn, code, message || code);
      return code !== null;
    };
    switch (m.t) {
      case 'ping':
        this.send(conn, { t: 'pong', ts: clampNum(m.ts, 0, Number.MAX_SAFE_INTEGER) });
        return;
      case 'rtt':
        p.ping = Math.round(clampNum(m.ms, 0, 5000));
        p.room?.markLobby();
        return;
      case 'quick': {
        if (!isFormat(m.format) || !isLevel(m.level)) {
          fail('bad_request');
          return;
        }
        this.leaveRoom(p);
        const room = this.findOrCreatePublic(m.format, m.level);
        if (!room) {
          fail('server_full', 'servidor lleno');
          return;
        }
        if (!fail(room.join(p))) room.flushLobby();
        return;
      }
      case 'create': {
        if (
          !isFormat(m.format) ||
          !isLevel(m.level) ||
          !(DURATIONS as readonly number[]).includes(m.durationMinutes)
        ) {
          fail('bad_request');
          return;
        }
        this.leaveRoom(p);
        if (this.rooms.size >= this.cfg.maxRooms) {
          fail('server_full', 'servidor lleno');
          return;
        }
        const room = this.createRoom(false, m.format, m.level, m.durationMinutes);
        if (!fail(room.join(p))) room.flushLobby();
        return;
      }
      case 'join': {
        if (!isValidCode(m.code)) {
          fail('room_not_found', 'código inválido');
          return;
        }
        const room = this.rooms.get(m.code);
        if (!room) {
          fail('room_not_found', 'sala no encontrada');
          return;
        }
        if (p.room === room) return;
        this.leaveRoom(p);
        if (!fail(room.join(p))) room.flushLobby();
        return;
      }
      case 'team': {
        if (!p.room) return void fail('no_room');
        if (m.team !== 0 && m.team !== 1) return void fail('bad_request');
        if (!fail(p.room.setTeam(p, m.team))) p.room.flushLobby();
        return;
      }
      case 'cfg': {
        if (!p.room) return void fail('no_room');
        if (m.format !== undefined && !isFormat(m.format)) return void fail('bad_request');
        if (m.level !== undefined && !isLevel(m.level)) return void fail('bad_request');
        if (
          m.durationMinutes !== undefined &&
          !(DURATIONS as readonly number[]).includes(m.durationMinutes)
        ) {
          return void fail('bad_request');
        }
        if (!fail(p.room.configure(p, m))) p.room.flushLobby();
        return;
      }
      case 'start': {
        if (!p.room) return void fail('no_room');
        if (p.room.hostId !== p.id) return void fail('not_host');
        fail(p.room.start());
        return;
      }
      case 'rematch': {
        if (!p.room) return void fail('no_room');
        fail(p.room.rematch(p));
        return;
      }
      case 'chat': {
        if (p.room && typeof m.idx === 'number') p.room.chat(p, Math.floor(m.idx));
        return;
      }
      case 'leave':
        this.leaveRoom(p);
        this.send(conn, { t: 'left', reason: 'leave' });
        return;
      default:
        this.error(conn, 'bad_message', 'tipo desconocido');
        this.strike(st, 'unknown type');
    }
  }

  private leaveRoom(p: Player): void {
    const room = p.room;
    if (!room) return;
    room.leave(p);
    if (room.empty) this.rooms.delete(room.code);
    else room.flushLobby();
  }

  private createRoom(
    isPublic: boolean,
    format: Format,
    level: BotLevel,
    durationMinutes: number,
  ): Room {
    let code = generateCode();
    while (this.rooms.has(code)) code = generateCode();
    const room = new Room(
      code,
      isPublic,
      { isPublic, format, botLevel: level, durationMinutes },
      this.now,
    );
    this.rooms.set(code, room);
    return room;
  }

  private findOrCreatePublic(format: Format, level: BotLevel): Room | null {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (
        !r.isPublic ||
        r.state !== 'lobby' ||
        r.format !== format ||
        r.players.length >= r.capacity
      )
        continue;
      if (!best || r.players.length > best.players.length) best = r;
    }
    if (best) return best;
    if (this.rooms.size >= this.cfg.maxRooms) return null;
    return this.createRoom(true, format, level, 5);
  }

  // ------------------------------------------------------------------ bucle

  /** Avanza todas las salas y limpia lo que sobre. `nowMs` es un reloj monótono en milisegundos. */
  tick(nowMs: number): void {
    for (const [code, room] of this.rooms) {
      if (!room.update(nowMs)) {
        for (const p of [...room.players]) {
          p.room = null;
          if (!p.conn) this.forget(p);
        }
        this.rooms.delete(code);
      }
    }
    // Jugadores sin conexión y sin sala: ya no hay nada que reservar.
    for (const p of [...this.players.values()]) if (!p.conn && !p.room) this.forget(p);
    // Conexiones que no se identifican a tiempo.
    const t = this.now();
    for (const st of this.conns.values()) {
      if (!st.player && t - st.connectedAt > this.cfg.helloTimeoutMs)
        st.conn.close(1008, 'hello timeout');
    }
  }
}
