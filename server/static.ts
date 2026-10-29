// Servidor de ficheros estáticos mínimo (opcional): permite servir `dist/` y el juego online desde un
// único proceso/contenedor. Evita salidas del directorio y fija tipos MIME y caché razonables.
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Resuelve una URL a un fichero dentro de `root`; null si intenta salir del directorio. */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const target = resolve(join(base, normalize(decoded)));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = resolveStatic(root, req.url ?? '/');
  if (!path) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  let file = path;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const hashed = /\/assets\//.test(file.replaceAll('\\', '/'));
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}
