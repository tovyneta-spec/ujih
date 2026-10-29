import './ui/style.css';
import { Game } from './game';
import { parseSetup } from './ui/urlConfig';

const root = document.getElementById('game-root') as HTMLElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const debugEl = document.getElementById('debug-overlay') as HTMLElement;
const fatal = document.getElementById('fatal') as HTMLElement;

function showFatal(msg: string): void {
  fatal.hidden = false;
  fatal.textContent = msg;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  showFatal(
    'Tu navegador no soporta WebGL2, necesario para jugar a Turbo Arena. Prueba con un navegador actualizado.',
  );
} else {
  // Sin parámetros: menú principal. Con `?mode=practice|match&...` arranca directamente
  // (enlaces directos y pruebas; parámetros en el README).
  const direct = new URLSearchParams(location.search).has('mode');
  const game = new Game(root, canvas, hudRoot, debugEl);
  game.boot(direct ? parseSetup(location.search) : null);
}
