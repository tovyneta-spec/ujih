// Servidor online de Turbo Arena: HTTP (salud y estáticos opcionales) + WebSocket.
//
// Variables de entorno:
//   PORT              puerto (por defecto 8080)
//   HOST              interfaz (por defecto 0.0.0.0)
//   STATIC_DIR        si se define, sirve ese directorio (p. ej. `dist`) en `/`
//   ALLOWED_ORIGINS   lista separada por comas de orígenes permitidos para el WebSocket (vacío = cualquiera)
//   MAX_ROOMS         máx. de salas simultáneas (por defecto 100)
//   MAX_PER_IP        máx. de conexiones por IP (por defecto 8)
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import { DEFAULT_CONFIG, GameServer } from './gameServer';
import type { Conn } from './room';
import { serveStatic } from './static';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = process.env.STATIC_DIR;
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function clientIp(req: IncomingMessage): string {
  // Detrás de un proxy (Fly.io, Render, nginx) la IP real viene en X-Forwarded-For.
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

export function startServer(port = PORT, host = HOST) {
  const game = new GameServer({
    ...DEFAULT_CONFIG,
    maxRooms: Number(process.env.MAX_ROOMS ?? DEFAULT_CONFIG.maxRooms),
    maxPerIp: Number(process.env.MAX_PER_IP ?? DEFAULT_CONFIG.maxPerIp),
  });

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...game.stats() }));
      return;
    }
    if (STATIC_DIR && serveStatic(STATIC_DIR, req, res)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Turbo Arena server');
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: 4096,
    perMessageDeflate: false, // los snapshots son pequeños y la latencia importa más que el ancho de banda
    verifyClient: (info: { origin: string }) =>
      ORIGINS.length === 0 || ORIGINS.includes(info.origin),
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const conn: Conn = {
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data, { binary: typeof data !== 'string' });
      },
      close: (code, reason) => ws.close(code, reason),
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
    };
    if (!game.connect(conn, clientIp(req))) return;
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) game.message(conn, new Uint8Array(data as Buffer));
      else game.message(conn, data.toString());
    });
    ws.on('close', () => game.close(conn));
    ws.on('error', () => ws.terminate());
  });

  // Bucle de las salas: 4 ms de resolución; cada sala acumula tiempo real y avanza en pasos de 1/120 s.
  const timer = setInterval(() => game.tick(performance.now()), 4);

  http.listen(port, host);
  return {
    game,
    http,
    wss,
    port: () => (http.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
