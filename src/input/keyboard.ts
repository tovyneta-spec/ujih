// Entrada de teclado y ratón: ejes digitales suavizados con rampa, captura sólo con el juego enfocado.
// Esquema «ratón»: el ratón gira el coche, clic izquierdo = turbo, clic derecho = salto.
import { DEFAULT_KEYS, KEYBOARD_RAMP } from '../config';
import type { Action, ControlScheme } from '../config';
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
  /** Esquema activo y estado del ratón (eje horizontal normalizado −1..1 y botones). */
  scheme: ControlScheme = 'keyboard';
  mouseSensitivity = 1;
  private mouseX = 0;
  private mouseLeft = false;
  private mouseRight = false;
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
    root.addEventListener('pointerdown', (e) => this.onMouseButton(e, true));
    root.addEventListener('contextmenu', (e) => {
      if (this.scheme === 'mouse' && this.enabled) e.preventDefault();
    });
    window.addEventListener('pointerup', (e) => this.onMouseButton(e, false));
    window.addEventListener('pointercancel', () => this.releaseMouse());
    window.addEventListener('pointermove', (e) => this.onMouseMove(e));
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
    this.releaseMouse();
  }

  private releaseMouse(): void {
    this.mouseLeft = false;
    this.mouseRight = false;
  }

  private onMouseButton(e: PointerEvent, isDown: boolean): void {
    if (this.scheme !== 'mouse') return;
    if (isDown && !this.enabled) return;
    if (e.button === 0) this.mouseLeft = isDown;
    else if (e.button === 2) this.mouseRight = isDown;
    if (isDown && this.enabled) e.preventDefault();
  }

  private onMouseMove(e: PointerEvent): void {
    if (this.scheme !== 'mouse') return;
    const r = this.root.getBoundingClientRect();
    if (r.width <= 0) return;
    // Posición respecto al centro de la pantalla: media anchura del centro = giro completo ≈ 45 %.
    const nx = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 2.2 * this.mouseSensitivity;
    this.mouseX = Math.abs(nx) < 0.04 ? 0 : Math.max(-1, Math.min(1, nx));
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
    const mouse = this.scheme === 'mouse';
    const s = mouse
      ? this.mouseX
      : (this.isDown('steerRight') ? 1 : 0) - (this.isDown('steerLeft') ? 1 : 0);
    const r = (this.isDown('rollRight') ? 1 : 0) - (this.isDown('rollLeft') ? 1 : 0);
    // La dirección en suelo se suaviza con rampa; el gas y los ejes aéreos (y por tanto la
    // dirección del flip) son digitales directos para no retrasar la respuesta.
    this.steerAxis = mouse ? s : this.ramp(this.steerAxis, s, dt);

    const o = this.out;
    const handbrake = this.isDown('handbrake');
    o.throttle = t;
    o.steer = this.steerAxis;
    // En el aire: W/S = cabeceo (W morro abajo), A/D = guiñada; con freno de mano A/D = alabeo.
    o.pitch = -t;
    o.yaw = handbrake ? 0 : s;
    o.roll = Math.max(-1, Math.min(1, r + (handbrake ? s : 0)));
    o.jump = mouse ? this.mouseRight : this.isDown('jump');
    o.boost = mouse ? this.mouseLeft : this.isDown('boost');
    o.handbrake = handbrake;
    return o;
  }
}
