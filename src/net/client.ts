// Cliente WebSocket de Turbo Arena: identificación, reconexión automática con token, medición de
// ping y envío de entradas. Usa el WebSocket global (navegador o Node ≥ 22), sin dependencias.
import type { GarageSettings } from '../config';
import type { MatchSnapshot, SimEvent } from '../sim';
import { PROTOCOL_VERSION, RECONNECT_WINDOW_MS } from './protocol';
import type { ClientMsg, ErrorCode, LobbyInfo, ServerMsg } from './protocol';
import type { NetSetup } from './setup';
import { packInputs } from './state';
import type { CarInput } from '../sim';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetHandlers {
  onStatus?(status: NetStatus, detail?: string): void;
  onWelcome?(id: number, token: string): void;
  onLobby?(lobby: LobbyInfo): void;
  onStart?(setup: NetSetup, me: number, tick: number, match: MatchSnapshot): void;
  onSnapshot?(data: ArrayBuffer): void;
  onEvents?(tick: number, events: SimEvent[]): void;
  onMatch?(tick: number, info: MatchSnapshot): void;
  onError?(code: ErrorCode, message: string): void;
  onLeft?(): void;
  /** La sesión anterior (con partida en curso) ya no existe en el servidor: se perdió la plaza. */
  onLost?(): void;
  onRtt?(ms: number): void;
}

const TOKEN_KEY = 'turbo-arena:token';

export class NetClient {
  status: NetStatus = 'idle';
  /** RTT suavizado en ms. */
  rtt = 0;
  playerId = -1;
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private wantOpen = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lostSince = 0;
  private inMatch = false;
  private lastRttReport = 0;
  private pending: ClientMsg[] = [];

  constructor(
    private readonly url: string,
    private readonly identity: { name: string; look: Partial<GarageSettings> },
    private readonly h: NetHandlers = {},
  ) {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY);
    } catch {
      /* sin sessionStorage */
    }
  }

  connect(): void {
    this.wantOpen = true;
    this.open();
  }

  private setStatus(s: NetStatus, detail?: string): void {
    this.status = s;
    this.h.onStatus?.(s, detail);
  }

  private open(): void {
    if (this.ws) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.setStatus('closed', e instanceof Error ? e.message : 'URL inválida');
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const hello: ClientMsg = {
        t: 'hello',
        v: PROTOCOL_VERSION,
        name: this.identity.name,
        look: this.identity.look,
        token: this.token ?? undefined,
      };
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (ev: MessageEvent) => this.onMessage(ev.data as string | ArrayBuffer);
    ws.onclose = () => this.onClose();
    ws.onerror = () => {
      /* el cierre posterior gestiona el reintento */
    };
  }

  private onMessage(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      this.h.onSnapshot?.(data);
      return;
    }
    let m: ServerMsg;
    try {
      m = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome': {
        const sameSession = this.playerId === m.id;
        const hadSession = this.playerId >= 0;
        this.playerId = m.id;
        this.token = m.token;
        try {
          sessionStorage.setItem(TOKEN_KEY, m.token);
        } catch {
          /* sin sessionStorage */
        }
        this.attempt = 0;
        this.lostSince = 0;
        this.setStatus('open');
        this.startPing();
        // Tras reconectar con partida en curso, un id distinto significa que la plaza se perdió.
        if (hadSession && !sameSession && this.inMatch) {
          this.inMatch = false;
          this.h.onLost?.();
        }
        this.h.onWelcome?.(m.id, m.token);
        for (const p of this.pending.splice(0)) this.send(p);
        break;
      }
      case 'lobby':
        this.inMatch = m.lobby.state === 'playing';
        this.h.onLobby?.(m.lobby);
        break;
      case 'start':
        this.inMatch = true;
        this.h.onStart?.(m.setup, m.me, m.tick, m.match);
        break;
      case 'events':
        this.h.onEvents?.(m.tick, m.events);
        break;
      case 'match':
        this.h.onMatch?.(m.tick, m.info);
        break;
      case 'pong': {
        const sample = performance.now() - m.ts;
        this.rtt = this.rtt === 0 ? sample : this.rtt * 0.7 + sample * 0.3;
        this.h.onRtt?.(this.rtt);
        const now = performance.now();
        if (now - this.lastRttReport > 5000) {
          this.lastRttReport = now;
          this.send({ t: 'rtt', ms: Math.round(this.rtt) });
        }
        break;
      }
      case 'error':
        this.h.onError?.(m.code, m.message);
        break;
      case 'left':
        this.inMatch = false;
        this.h.onLeft?.();
        break;
    }
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const ping = (): void => this.send({ t: 'ping', ts: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private onClose(): void {
    this.ws = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (!this.wantOpen) {
      this.setStatus('closed');
      return;
    }
    if (this.lostSince === 0) this.lostSince = Date.now();
    // Dentro de la ventana de reconexión se reintenta con espera creciente.
    if (Date.now() - this.lostSince > RECONNECT_WINDOW_MS) {
      this.wantOpen = false;
      this.setStatus('closed', 'sin conexión con el servidor');
      this.h.onLost?.();
      return;
    }
    this.attempt++;
    this.setStatus('reconnecting');
    const delay = Math.min(3000, 400 * Math.pow(1.6, this.attempt));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.open();
    }, delay);
  }

  /** Envía un mensaje de control (se guarda si aún no hay conexión). */
  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== 'ping' && msg.t !== 'rtt') this.pending.push(msg);
  }

  /** Envía un lote de entradas (la primera lleva el número de secuencia `seq`). */
  sendInputs(seq: number, inputs: readonly CarInput[]): void {
    if (!this.ws || this.ws.readyState !== 1 || inputs.length === 0) return;
    this.ws.send(packInputs(seq, inputs));
  }

  /** Cierra y olvida la sesión (salida voluntaria). */
  disconnect(): void {
    this.wantOpen = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pending = [];
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* sin sessionStorage */
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }
}

/** URL por defecto del servidor según dónde esté alojado el juego. */
export function defaultServerUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
    if (env) return env;
    const loc = globalThis.location;
    if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:')) {
      const dev = loc.port === '5173' || loc.port === '5174' || loc.port === '4173';
      if (!dev) return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
    }
  } catch {
    /* entorno sin location */
  }
  return 'ws://localhost:8080/ws';
}
