// Entrada de teclado: ejes digitales suavizados con rampa, captura sólo con el juego enfocado.
import { DEFAULT_KEYS, KEYBOARD_RAMP } from '../config';
import type { Action } from '../config';
import { neutralInput } from '../sim';
import type { CarInput } from '../sim';

export class KeyboardInput {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private bindings: Record<Action, readonly string[]>;
  private captured = false;
  /** Si es false se ignora el teclado (menús abiertos): no bloquea teclas del navegador. */
  enabled = true;
  private steerAxis = 0;
  private readonly out: CarInput = neutralInput();
  private keyToAction = new Map<string, Action>();

  constructor(
    private root: HTMLElement,
    bindings: Record<Action, readonly string[]> = DEFAULT_KEYS,
  ) {
    this.bindings = bindings;
    this.rebuildMap();
    root.addEventListener('pointerdown', () => this.capture());
    root.addEventListener('focus', () => this.capture());
    root.addEventListener('blur', () => this.release());
    window.addEventListener('blur', () => this.release());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  setBindings(b: Record<Action, readonly string[]>): void {
    this.bindings = b;
    this.rebuildMap();
  }

  private rebuildMap(): void {
    this.keyToAction.clear();
    for (const [action, codes] of Object.entries(this.bindings) as [Action, readonly string[]][]) {
      for (const c of codes) this.keyToAction.set(c, action);
    }
  }

  private capture(): void {
    this.captured = true;
    this.root.focus({ preventScroll: true });
  }

  private release(): void {
    this.captured = false;
    this.down.clear();
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (!this.captured || !this.enabled) return;
    const action = this.keyToAction.get(e.code);
    if (!action) return;
    // Evita que flechas, espacio o Tab desplacen la página que aloja el juego.
    e.preventDefault();
    if (isDown) {
      if (!this.down.has(e.code) && !e.repeat) this.pressed.add(action);
      this.down.add(e.code);
    } else this.down.delete(e.code);
  }

  /** Descarta las pulsaciones pendientes (p. ej. al cambiar de pantalla). */
  clearPressed(): void {
    this.pressed.clear();
  }

  isDown(action: Action): boolean {
    for (const c of this.bindings[action]) if (this.down.has(c)) return true;
    return false;
  }

  /** Pulsación nueva desde la última consulta (para alternar cámara, pausa, etc.). */
  consumePress(action: Action): boolean {
    return this.pressed.delete(action);
  }

  private ramp(axis: number, target: number, dt: number): number {
    const rate =
      Math.abs(target) > Math.abs(axis) || Math.sign(target) !== Math.sign(axis)
        ? KEYBOARD_RAMP.rise
        : KEYBOARD_RAMP.fall;
    const step = rate * dt;
    return axis < target ? Math.min(target, axis + step) : Math.max(target, axis - step);
  }

  /** Lee el estado justo antes de cada paso de física. */
  poll(dt: number): CarInput {
    const t = (this.isDown('throttleUp') ? 1 : 0) - (this.isDown('throttleDown') ? 1 : 0);
    const s = (this.isDown('steerRight') ? 1 : 0) - (this.isDown('steerLeft') ? 1 : 0);
    const r = (this.isDown('rollRight') ? 1 : 0) - (this.isDown('rollLeft') ? 1 : 0);
    // La dirección en suelo se suaviza con rampa; el gas y los ejes aéreos (y por tanto la
    // dirección del flip) son digitales directos para no retrasar la respuesta.
    this.steerAxis = this.ramp(this.steerAxis, s, dt);

    const o = this.out;
    const handbrake = this.isDown('handbrake');
    o.throttle = t;
    o.steer = this.steerAxis;
    // En el aire: W/S = cabeceo (W morro abajo), A/D = guiñada; con freno de mano A/D = alabeo.
    o.pitch = -t;
    o.yaw = handbrake ? 0 : s;
    o.roll = Math.max(-1, Math.min(1, r + (handbrake ? s : 0)));
    o.jump = this.isDown('jump');
    o.boost = this.isDown('boost');
    o.handbrake = handbrake;
    return o;
  }
}
