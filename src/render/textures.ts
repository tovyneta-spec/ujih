// Texturas generadas por código (sin assets de terceros).
import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { ARENA } from '../config';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = false, anisotropy = 4): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.minFilter = LinearFilter;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Suelo con franjas, líneas de campo, círculo central, áreas y marcas de saque. */
export function makeFloorTexture(): CanvasTexture {
  const W = 1024;
  const H = 1280;
  const k = W / (ARENA.halfWidth * 2);
  const [c, g] = canvas(W, H);
  const X = (x: number) => (x + ARENA.halfWidth) * k;
  const Y = (y: number) => (ARENA.halfLength - y) * k;

  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 === 0 ? '#1d6b46' : '#1a6040';
    g.fillRect(0, (H / stripes) * i, W, H / stripes + 1);
  }
  // Mitades teñidas por equipo.
  const gb = g.createLinearGradient(0, H, 0, H / 2);
  gb.addColorStop(0, 'rgba(40,110,255,0.28)');
  gb.addColorStop(1, 'rgba(40,110,255,0)');
  g.fillStyle = gb;
  g.fillRect(0, H / 2, W, H / 2);
  const go = g.createLinearGradient(0, 0, 0, H / 2);
  go.addColorStop(0, 'rgba(255,130,30,0.28)');
  go.addColorStop(1, 'rgba(255,130,30,0)');
  g.fillStyle = go;
  g.fillRect(0, 0, W, H / 2);

  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(-ARENA.halfWidth), Y(0));
  g.lineTo(X(ARENA.halfWidth), Y(0));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Y(0), 1000 * k, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(X(0), Y(0), 28 * k * 2, 0, Math.PI * 2);
  g.fill();
  // Áreas de portería.
  for (const s of [-1, 1]) {
    const yEnd = s * ARENA.halfLength;
    const yIn = s * (ARENA.halfLength - 1900);
    g.strokeRect(X(-1800), Math.min(Y(yEnd), Y(yIn)), 3600 * k, 1900 * k);
    const yIn2 = s * (ARENA.halfLength - 900);
    g.strokeRect(
      X(-ARENA.goal.halfWidth),
      Math.min(Y(yEnd), Y(yIn2)),
      ARENA.goal.halfWidth * 2 * k,
      900 * k,
    );
  }
  return finish(c);
}

/** Baldosa de pared con paneles y luz de borde. */
export function makeWallTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#d7dbe6';
  g.fillRect(0, 0, 256, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(0,0,0,0.0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(20,30,60,0.55)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 252);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.strokeRect(12, 12, 232, 232);
  g.beginPath();
  g.moveTo(12, 128);
  g.lineTo(128, 12);
  g.lineTo(244, 128);
  g.lineTo(128, 244);
  g.closePath();
  g.stroke();
  return finish(c, true);
}

/** Red de portería (rejilla sobre fondo transparente). */
export function makeNetTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  return finish(c, true);
}

/** Pelota: superficie oscura con paneles luminosos para que se aprecie el giro. */
export function makeBallTexture(): CanvasTexture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#2a3350';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#9fe8ff';
  g.lineWidth = 5;
  const cols = 12;
  const rows = 6;
  for (let i = 0; i <= cols; i++) {
    g.beginPath();
    g.moveTo((512 / cols) * i, 0);
    g.lineTo((512 / cols) * i, 256);
    g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    g.beginPath();
    g.moveTo(0, (256 / rows) * j);
    g.lineTo(512, (256 / rows) * j);
    g.stroke();
  }
  g.fillStyle = '#ffd34d';
  for (let i = 0; i < cols; i += 2) {
    for (let j = 1; j < rows; j += 2) {
      g.fillRect((512 / cols) * i + 14, (256 / rows) * j + 10, 512 / cols - 28, 256 / rows - 20);
    }
  }
  return finish(c, true);
}

/** Mancha radial suave (sombra de la pelota, halos). */
export function makeBlobTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return finish(c, false, 1);
}
