// HUD en HTML/CSS sobre el canvas: indicador circular de turbo, velocidad y ayuda de controles.
import type { Car } from '../sim';

const RADIUS = 52;
const CIRC = 2 * Math.PI * RADIUS;

export class Hud {
  private ring: SVGCircleElement;
  private boostText: HTMLElement;
  private speedText: HTMLElement;
  private speedLines: HTMLElement;
  private lastLines = -1;
  private hint: HTMLElement;
  private lastBoost = -1;
  private lastSpeed = -1;
  imperial = false;

  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="boost" aria-label="Turbo">
        <svg viewBox="0 0 120 120" width="160" height="160">
          <circle class="boost-bg" cx="60" cy="60" r="${RADIUS}"></circle>
          <circle class="boost-fg" cx="60" cy="60" r="${RADIUS}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}" transform="rotate(-90 60 60)"></circle>
        </svg>
        <div class="boost-num">33</div>
        <div class="speed"><b>0</b> km/h</div>
      </div>
      <div class="speedlines"></div>
      <div class="ping" hidden></div>
      <div class="netbanner" hidden>Reconectando…</div>
      <div class="hint">
        <b>WASD</b> conducir · <b>Espacio</b> saltar (otra vez + dirección = flip) · <b>Shift</b> turbo ·
        <b>Ctrl/Z</b> derrape · <b>Q/E</b> giro aéreo · <b>C</b> cámara de pelota · <b>V</b> mirar atrás ·
        <b>R</b> reiniciar · <b>F3</b> depuración
      </div>`;
    this.ring = root.querySelector('.boost-fg') as SVGCircleElement;
    this.boostText = root.querySelector('.boost-num') as HTMLElement;
    this.speedText = root.querySelector('.speed b') as HTMLElement;
    this.speedLines = root.querySelector('.speedlines') as HTMLElement;
    this.hint = root.querySelector('.hint') as HTMLElement;
    setTimeout(() => this.hint.classList.add('fade'), 12000);
  }

  /** Texto de ayuda de controles según el esquema activo. */
  setScheme(mouse: boolean): void {
    this.hint.innerHTML = mouse
      ? `<b>W/S</b> acelerar / frenar · <b>Ratón</b> girar (clic para capturarlo) · <b>Clic izq.</b> turbo ·
        <b>Clic der.</b> saltar (otra vez + dirección = flip) · <b>Ctrl/Z</b> derrape · <b>Q/E</b> giro aéreo ·
        <b>C</b> cámara de pelota · <b>V</b> mirar atrás · <b>R</b> reiniciar · <b>F3</b> depuración`
      : `<b>WASD</b> conducir · <b>Espacio</b> saltar (otra vez + dirección = flip) · <b>Shift</b> turbo ·
        <b>Ctrl/Z</b> derrape · <b>Q/E</b> giro aéreo · <b>C</b> cámara de pelota · <b>V</b> mirar atrás ·
        <b>R</b> reiniciar · <b>F3</b> depuración`;
  }

  /** Indicador de ping online (null lo oculta). */
  setPing(ms: number | null): void {
    const el = this.root.querySelector('.ping') as HTMLElement;
    if (ms === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const q = ms < 60 ? '#4cd964' : ms < 130 ? '#ffcc00' : '#ff5252';
    el.innerHTML = `<span style="color:${q}">●</span> ${Math.round(ms)} ms`;
  }

  setReconnecting(on: boolean): void {
    (this.root.querySelector('.netbanner') as HTMLElement).hidden = !on;
  }

  update(car: Car): void {
    const boost = Math.round(car.boost);
    if (boost !== this.lastBoost) {
      this.lastBoost = boost;
      this.boostText.textContent = String(boost);
      this.ring.style.strokeDashoffset = String(CIRC * (1 - boost / 100));
    }
    // 1000 uu/s = 36 km/h.
    const kmh = Math.round(car.speed * 0.036 * (this.imperial ? 0.621371 : 1));
    if (kmh !== this.lastSpeed) {
      this.lastSpeed = kmh;
      this.speedText.textContent = String(kmh);
    }
    this.ring.classList.toggle('super', car.supersonic);
    // Líneas de velocidad en los bordes: aparecen a partir de ~1500 uu/s y se intensifican con el turbo.
    const k = Math.max(0, Math.min(1, (car.speed - 1500) / 800));
    const lines = Math.round(k * (car.boosting ? 1 : 0.75) * 20) / 20;
    if (lines !== this.lastLines) {
      this.lastLines = lines;
      this.speedLines.style.opacity = String(lines);
    }
  }
}
