// Entrada de teclado y ratón: ejes digitales suavizados con rampa, captura sólo con el juego enfocado.
// Esquema «ratón»: el movimiento relativo del ratón (con el puntero bloqueado) gira el coche y se
// recentra solo al dejar de moverlo; clic izquierdo = turbo, clic derecho = salto.
import { DEFAULT_KEYS, KEYBOARD_RAMP } from '../config';
import type { Action, ControlScheme } from '../config';
import { neutralInput } from '../sim';
import { flipSide } from './flip';
import type { CarInput } from '../sim';

export class KeyboardInput {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private bindings: Record<Action, readonly string[]>;
  private captured = false;
  /** Si es false se ignora el teclado (menús abiertos): no bloquea teclas del navegador. */
  private _enabled = true;
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) this.unlockPointer();
  }
  /** Se llama cuando el jugador libera el puntero (Esc) con el juego en marcha. */
  onLockLost: (() => void) | null = null;
  private lastMove = 0;
  private steerAxis = 0;
  /** Esquema activo y estado del ratón (eje horizontal normalizado −1..1 y botones). */
  scheme: ControlScheme = 'keyboard';
  mouseSensitivity = 1;
  /** Ayudas de flip (ver ControlSettings). */
  flipAssist = true;
  flipIgnoreMouse = true;
  private flipWindow = 0;
  private prevJump = false;
  private mouseX = 0;
  private mouseSteerPerPx = 0.0045;
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
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.root && this.scheme === 'mouse' && this._enabled)
        this.onLockLost?.();
    });
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
    if (isDown && this.enabled) {
      e.preventDefault();
      this.lockPointer();
    }
  }

  private onMouseMove(e: PointerEvent): void {
    if (this.scheme !== 'mouse' || !this._enabled) return;
    // Movimiento relativo: cada píxel desplaza el volante; la rueda se recentra sola en poll().
    this.mouseX = Math.max(
      -1,
      Math.min(1, this.mouseX + e.movementX * this.mouseSteerPerPx * this.mouseSensitivity),
    );
    if (e.movementX !== 0) this.lastMove = performance.now();
  }

  /** Bloquea el puntero en la raíz del juego (necesita un gesto del usuario). */
  private lockPointer(): void {
    if (document.pointerLockElement === this.root) return;
    try {
      void (this.root.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(
        () => undefined,
      );
    } catch {
      /* el navegador no permite bloquear el puntero aquí */
    }
  }

  private unlockPointer(): void {
    this.mouseX = 0;
    if (document.pointerLockElement === this.root) document.exitPointerLock();
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

  /**
   * Ayudas para elegir la dirección del flip. Se aplican en unos pocos ticks tras pulsar saltar (el
   * segundo salto en el aire es el flip): no afectan al control normal en el aire.
   */
  private shapeFlip(o: CarInput, mouse: boolean, digitalSide: number, roll: number): void {
    if (o.jump && !this.prevJump) this.flipWindow = 4;
    this.prevJump = o.jump;
    if (this.flipWindow <= 0) return;
    this.flipWindow--;
    const side = mouse ? this.mouseX : digitalSide;
    o.yaw = flipSide(-o.pitch, side, roll, {
      mouse,
      ignoreMouse: this.flipIgnoreMouse,
      assist: this.flipAssist,
    });
  }

  /** Lee el estado justo antes de cada paso de física. */
  poll(dt: number): CarInput {
    const t = (this.isDown('throttleUp') ? 1 : 0) - (this.isDown('throttleDown') ? 1 : 0);
    const mouse = this.scheme === 'mouse';
    const s = mouse ? 0 : (this.isDown('steerRight') ? 1 : 0) - (this.isDown('steerLeft') ? 1 : 0);
    const r = (this.isDown('rollRight') ? 1 : 0) - (this.isDown('rollLeft') ? 1 : 0);
    // La dirección en suelo se suaviza con rampa; el gas y los ejes aéreos (y por tanto la
    // dirección del flip) son digitales directos para no retrasar la respuesta.
    if (mouse && performance.now() - this.lastMove > 80) this.mouseX *= Math.exp(-dt * 5.5);
    const ax = mouse ? this.mouseX : s;
    this.steerAxis = mouse ? ax : this.ramp(this.steerAxis, s, dt);

    const o = this.out;
    const handbrake = this.isDown('handbrake');
    o.throttle = t;
    o.steer = this.steerAxis;
    // En el aire: W/S = cabeceo (W morro abajo), A/D = guiñada; con freno de mano A/D = alabeo.
    o.pitch = -t;
    o.yaw = handbrake ? 0 : ax;
    o.roll = Math.max(-1, Math.min(1, r + (handbrake ? ax : 0)));
    o.jump = mouse ? this.mouseRight : this.isDown('jump');
    this.shapeFlip(o, mouse, s, r);
    o.boost = mouse ? this.mouseLeft : this.isDown('boost');
    o.handbrake = handbrake;
    return o;
  }
}
