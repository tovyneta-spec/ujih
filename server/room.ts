// Sala de juego del servidor autoritativo: lobby, partida (la misma simulación `sim/` a 120 Hz),
// bots de relleno y de relevo, snapshots a 60 Hz y reconexión.
import { BOT_PROFILES, DEFAULT_MUTATORS, QUICK_CHAT } from '../src/config';
import type { BotLevel, GarageSettings, Mutators } from '../src/config';
import { TokenBucket } from '../src/net/limits';
import {
  MAX_QUEUE,
  RECONNECT_WINDOW_MS,
  SERVER_TICK_RATE,
  SNAPSHOT_EVERY,
} from '../src/net/protocol';
import type { ErrorCode, Format, LobbyInfo, PlayerInfo, ServerMsg } from '../src/net/protocol';
import { botBodyFor, botGarage, buildNetWorld, onlineMutators } from '../src/net/setup';
import type { NetCarSetup, NetSetup } from '../src/net/setup';
import { packSnapshot, withHeader } from '../src/net/state';
import { BotManager, neutralInput } from '../src/sim';
import type { CarInput, SimEvent, World } from '../src/sim';

/** Conexión abstracta (WebSocket real o simulada en tests). */
export interface Conn {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  /** Bytes pendientes de enviar (para no saturar a clientes lentos). */
  readonly bufferedAmount: number;
}

export interface QueuedInput {
  seq: number;
  input: CarInput;
}

export class Player {
  team: 0 | 1 = 0;
  conn: Conn | null = null;
  ping = 0;
  room: Room | null = null;
  carId = -1;
  queue: QueuedInput[] = [];
  lastInput: CarInput = neutralInput();
  /** Última entrada aplicada por el servidor (se devuelve al cliente para reconciliar). */
  ack = 0;
  lastSeq = 0;
  disconnectedAt = 0;
  strikes = 0;
  lastChatAt = 0;
  /** Límites de tasa: mensajes de control y paquetes de entrada. */
  readonly control = new TokenBucket(20, 6);
  readonly inputs = new TokenBucket(120, 160);

  constructor(
    readonly id: number,
    readonly token: string,
    public name: string,
    public look: GarageSettings,
  ) {}

  get connected(): boolean {
    return this.conn !== null;
  }
}

export const FORMATS: Record<Format, number> = { '1v1': 1, '2v2': 2, '3v3': 3 };
export const DURATIONS = [3, 5, 10, 20] as const;

/** Segundos de espera antes de empezar una sala de partida rápida (y al llenarse). */
const QUICK_WAIT_MS = 10_000;
const FULL_WAIT_MS = 1_500;
/** Tras acabar una partida se vuelve al lobby pasado este tiempo. */
const POST_MATCH_MS = 15_000;
/** Una sala sin nadie conectado se destruye pasado este tiempo. */
const EMPTY_MS = 30_000;

export interface RoomOptions {
  isPublic: boolean;
  format: Format;
  botLevel: BotLevel;
  durationMinutes: number;
}

export class Room {
  state: 'lobby' | 'playing' = 'lobby';
  readonly players: Player[] = [];
  hostId = -1;
  format: Format;
  botLevel: BotLevel;
  durationMinutes: number;
  autoStartAt: number | null = null;
  world: World | null = null;
  setup: NetSetup | null = null;
  private bots: BotManager | null = null;
  private acc = 0;
  private lastUpdate = 0;
  private events: SimEvent[] = [];
  private snapshotCount = 0;
  private endedAt = 0;
  private emptySince = 0;
  private lobbyDirty = false;
  private lastLobbyAt = 0;
  private seed = 1;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    opts: RoomOptions,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.format = opts.format;
    this.botLevel = opts.botLevel;
    this.durationMinutes = opts.durationMinutes;
  }

  get perTeam(): number {
    return FORMATS[this.format];
  }

  get capacity(): number {
    return this.perTeam * 2;
  }

  get humans(): Player[] {
    return this.players;
  }

  teamCount(team: 0 | 1): number {
    return this.players.filter((p) => p.team === team).length;
  }

  // --------------------------------------------------------------------- lobby

  /** Añade un jugador al lobby; devuelve un código de error si no cabe. */
  join(p: Player): ErrorCode | null {
    if (this.state !== 'lobby') return 'in_progress';
    if (this.players.length >= this.capacity) return 'room_full';
    // Equipo con menos jugadores (el azul si empatan).
    p.team = this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
    p.room = this;
    this.players.push(p);
    if (this.hostId < 0) this.hostId = p.id;
    if (this.isPublic) {
      this.autoStartAt =
        this.now() + (this.players.length >= this.capacity ? FULL_WAIT_MS : QUICK_WAIT_MS);
    }
    this.markLobby();
    return null;
  }

  setTeam(p: Player, team: 0 | 1): ErrorCode | null {
    if (this.state !== 'lobby') return 'in_progress';
    if (p.team === team) return null;
    if (this.teamCount(team) >= this.perTeam) return 'team_full';
    p.team = team;
    this.markLobby();
    return null;
  }

  configure(
    p: Player,
    cfg: { format?: Format; level?: BotLevel; durationMinutes?: number },
  ): ErrorCode | null {
    if (this.state !== 'lobby') return 'in_progress';
    if (p.id !== this.hostId) return 'not_host';
    const format = cfg.format ?? this.format;
    if (FORMATS[format] < Math.max(this.teamCount(0), this.teamCount(1))) return 'team_full';
    this.format = format;
    if (cfg.level) this.botLevel = cfg.level;
    if (cfg.durationMinutes !== undefined) this.durationMinutes = cfg.durationMinutes;
    this.markLobby();
    return null;
  }

  /** Quita a un jugador (salida voluntaria o expiración de la reconexión). */
  leave(p: Player): void {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    p.room = null;
    if (this.state === 'playing' && this.world && p.carId >= 0) {
      // El coche pasa a ser de un bot para que la partida continúe.
      this.ensureBot(p.carId);
    }
    p.carId = -1;
    if (p.id === this.hostId) {
      const next = this.players.find((q) => q.connected) ?? this.players[0];
      this.hostId = next ? next.id : -1;
    }
    this.markLobby();
  }

  get empty(): boolean {
    return this.players.length === 0;
  }

  /** Marca que hay que reenviar el estado del lobby (agrupa cambios en un solo mensaje). */
  markLobby(): void {
    this.lobbyDirty = true;
  }

  /** Envía ya el estado del lobby a todos (cambios que el jugador espera ver al instante). */
  flushLobby(): void {
    this.lobbyDirty = false;
    this.broadcast({ t: 'lobby', lobby: this.lobbyInfo() });
  }

  lobbyInfo(): LobbyInfo {
    const players: PlayerInfo[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      ping: p.ping,
      isHost: p.id === this.hostId,
      connected: p.connected,
    }));
    return {
      code: this.code,
      public: this.isPublic,
      format: this.format,
      botLevel: this.botLevel,
      durationMinutes: this.durationMinutes,
      hostId: this.hostId,
      state: this.state,
      perTeam: this.perTeam,
      players,
      autoStartIn:
        this.state === 'lobby' && this.autoStartAt !== null
          ? Math.max(0, Math.ceil((this.autoStartAt - this.now()) / 1000))
          : null,
    };
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players) p.conn?.send(data);
  }

  // -------------------------------------------------------------------- partida

  /** Inicia la partida con los jugadores actuales; las plazas libres las ocupan bots. */
  start(): ErrorCode | null {
    if (this.state !== 'lobby' && !this.world) return 'in_progress';
    const mutators: Mutators = {
      ...DEFAULT_MUTATORS,
      format: this.format,
      durationMinutes: this.durationMinutes as Mutators['durationMinutes'],
      botLevel: this.botLevel,
    };
    const resolved = onlineMutators(mutators);
    const cars: NetCarSetup[] = [];
    const levelName = BOT_PROFILES[this.botLevel].name;
    for (const team of [0, 1] as const) {
      let botN = 0;
      const humans = this.players.filter((p) => p.team === team);
      for (let i = 0; i < this.perTeam; i++) {
        const id = cars.length;
        const human = humans[i];
        if (human) {
          human.carId = id;
          human.queue.length = 0;
          human.ack = 0;
          human.lastSeq = 0;
          human.lastInput = neutralInput();
          cars.push({
            id,
            team,
            body: human.look.body,
            name: human.name,
            bot: false,
            look: human.look,
          });
        } else {
          botN++;
          const name = `Bot ${team === 0 ? 'Azul' : 'Naranja'} ${botN} (${levelName})`;
          const look = botGarage(id, team, name);
          cars.push({ id, team, body: botBodyFor(id), name, bot: true, look });
        }
      }
    }
    this.seed = (Date.now() ^ (this.code.charCodeAt(0) << 8)) & 0xffff;
    this.setup = { seed: this.seed, mutators: resolved, botLevel: this.botLevel, cars };
    const world = buildNetWorld(this.setup);
    this.bots = new BotManager(world, this.seed);
    for (const c of cars) if (c.bot) this.bots.add(c.id, this.botLevel);
    // Jugadores que ya estaban desconectados al empezar: su coche lo lleva un bot.
    for (const p of this.players)
      if (!p.connected && p.carId >= 0) this.bots.add(p.carId, this.botLevel);
    world.startMatch(resolved.match);
    this.world = world;
    this.state = 'playing';
    this.autoStartAt = null;
    this.acc = 0;
    this.lastUpdate = 0;
    this.endedAt = 0;
    this.events = [];
    this.snapshotCount = 0;
    this.markLobby();
    for (const p of this.players) this.sendStart(p);
    return null;
  }

  private sendStart(p: Player): void {
    if (!this.world || !this.setup || p.carId < 0 || !p.conn) return;
    const msg: ServerMsg = {
      t: 'start',
      setup: this.setup,
      me: p.carId,
      tick: this.world.tick,
      match: this.world.match.serialize(),
    };
    p.conn.send(JSON.stringify(msg));
  }

  private ensureBot(carId: number): void {
    if (this.bots && !this.bots.isBot(carId)) this.bots.add(carId, this.botLevel);
  }

  /** Un jugador se desconecta durante la partida: un bot lleva su coche mientras tanto. */
  disconnect(p: Player): void {
    p.conn = null;
    p.disconnectedAt = this.now();
    if (this.state === 'playing' && p.carId >= 0) this.ensureBot(p.carId);
    this.markLobby();
  }

  /** Reconexión: el jugador recupera su coche. */
  reconnect(p: Player, conn: Conn): void {
    p.conn = conn;
    p.disconnectedAt = 0;
    p.strikes = 0;
    if (this.state === 'playing' && this.world && p.carId >= 0) {
      this.bots?.remove(p.carId);
      p.queue.length = 0;
      p.lastInput = neutralInput();
      this.sendStart(p);
    } else conn.send(JSON.stringify({ t: 'lobby', lobby: this.lobbyInfo() } satisfies ServerMsg));
    this.markLobby();
  }

  /** Entradas recibidas de un jugador (ya validadas). */
  pushInputs(p: Player, seq: number, inputs: CarInput[]): void {
    for (let i = 0; i < inputs.length; i++) {
      const s = seq + i;
      if (s <= p.lastSeq) continue; // duplicada o antigua
      p.lastSeq = s;
      p.queue.push({ seq: s, input: inputs[i] });
    }
    while (p.queue.length > MAX_QUEUE) p.queue.shift();
  }

  chat(p: Player, idx: number): void {
    const text = QUICK_CHAT[idx];
    if (!text || !this.world || p.carId < 0) return;
    const t = this.now();
    if (t - p.lastChatAt < 1000) return;
    p.lastChatAt = t;
    this.world.emit({ type: 'chat', carId: p.carId, text });
  }

  rematch(p: Player): ErrorCode | null {
    if (p.id !== this.hostId) return 'not_host';
    if (this.state === 'playing' && this.world?.match.phase === 'ended') return this.start();
    return null;
  }

  // ----------------------------------------------------------------- bucle

  /** Avanza la sala hasta `nowMs` (reloj monótono en ms). Devuelve false si la sala debe destruirse. */
  update(nowMs: number): boolean {
    const wall = this.now();
    if (this.lobbyDirty && nowMs - this.lastLobbyAt > 50) {
      this.lobbyDirty = false;
      this.lastLobbyAt = nowMs;
      this.broadcast({ t: 'lobby', lobby: this.lobbyInfo() });
    }
    // Expira la reconexión de los desconectados.
    for (const p of [...this.players]) {
      if (!p.connected && p.disconnectedAt > 0 && wall - p.disconnectedAt > RECONNECT_WINDOW_MS)
        this.leave(p);
    }
    if (this.players.some((p) => p.connected)) this.emptySince = 0;
    else if (this.emptySince === 0) this.emptySince = wall;
    else if (wall - this.emptySince > EMPTY_MS) return false;
    if (this.empty) return false;

    if (this.state === 'lobby') {
      if (this.autoStartAt !== null && wall >= this.autoStartAt && this.players.length > 0)
        this.start();
      return true;
    }
    if (!this.world) return true;

    if (this.lastUpdate === 0) this.lastUpdate = nowMs;
    this.acc += Math.min(nowMs - this.lastUpdate, 100);
    this.lastUpdate = nowMs;
    const stepMs = 1000 / SERVER_TICK_RATE;
    let n = 0;
    while (this.acc >= stepMs && n < 8) {
      this.stepOnce();
      this.acc -= stepMs;
      n++;
    }
    if (n === 8) this.acc = 0;

    // Tras acabar la partida se vuelve al lobby.
    if (this.world.match.phase === 'ended') {
      if (this.endedAt === 0) this.endedAt = wall;
      else if (wall - this.endedAt > POST_MATCH_MS) this.returnToLobby();
    }
    return true;
  }

  /** Un paso fijo de simulación: aplica entradas, mueve bots y avanza el mundo. */
  stepOnce(): void {
    const world = this.world;
    if (!world) return;
    for (const p of this.players) {
      if (p.carId < 0 || this.bots?.isBot(p.carId)) continue;
      // Si la cola crece demasiado (el cliente va adelantado) se descartan las más antiguas.
      while (p.queue.length > 8) p.queue.shift();
      const next = p.queue.shift();
      if (next) {
        p.lastInput = next.input;
        p.ack = next.seq;
      }
      world.setInput(p.carId, p.lastInput);
    }
    this.bots?.update();
    world.step();
    for (const e of world.drainEvents()) {
      this.events.push(e);
      this.bots?.onEvent(e);
    }
    if (world.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  private sendSnapshots(): void {
    const world = this.world;
    if (!world) return;
    this.snapshotCount++;
    const packed = packSnapshot(world);
    for (const p of this.players) {
      if (!p.conn || p.carId < 0) continue;
      if (p.conn.bufferedAmount > 256 * 1024) continue; // cliente lento: se salta este snapshot
      p.conn.send(withHeader(packed, p.ack, p.queue.length));
    }
    if (this.events.length > 0) {
      const important = this.events.some((e) =>
        [
          'countdown',
          'go',
          'matchGoal',
          'kickoffReset',
          'overtime',
          'matchEnd',
          'award',
          'demolition',
        ].includes(e.type),
      );
      this.broadcast({ t: 'events', tick: world.tick, events: this.events });
      this.events = [];
      if (important)
        this.broadcast({ t: 'match', tick: world.tick, info: world.match.serialize() });
    } else if (this.snapshotCount % 12 === 0) {
      this.broadcast({ t: 'match', tick: world.tick, info: world.match.serialize() });
    }
  }

  returnToLobby(): void {
    this.world = null;
    this.bots = null;
    this.setup = null;
    this.state = 'lobby';
    this.endedAt = 0;
    for (const p of [...this.players]) {
      p.carId = -1;
      p.queue.length = 0;
      if (!p.connected) this.leave(p);
    }
    this.autoStartAt = this.isPublic && this.players.length > 0 ? this.now() + QUICK_WAIT_MS : null;
    this.markLobby();
  }
}
