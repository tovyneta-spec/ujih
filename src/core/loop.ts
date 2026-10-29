// Bucle de paso fijo con acumulador: la física corre a 120 Hz y el render a la frecuencia del monitor.
import { PHYSICS } from '../config';

export interface LoopStats {
  fps: number;
  /** Tiempo de física acumulado en el último frame (ms). */
  physicsMs: number;
  /** Pasos de física ejecutados en el último frame. */
  steps: number;
  ticks: number;
}

export class GameLoop {
  readonly stats: LoopStats = { fps: 0, physicsMs: 0, steps: 0, ticks: 0 };
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  /** Escala de tiempo del juego (mutador de velocidad). */
  timeScale = 1;
  paused = false;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      this.acc = 0;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    let steps = 0;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += frameDt * this.timeScale;
      while (this.acc >= PHYSICS.dt && steps < PHYSICS.maxStepsPerFrame) {
        this.fixedUpdate(PHYSICS.dt);
        this.acc -= PHYSICS.dt;
        steps++;
      }
      if (steps === PHYSICS.maxStepsPerFrame) this.acc = 0;
    }
    this.stats.physicsMs = performance.now() - t0;
    this.stats.steps = steps;
    this.stats.ticks += steps;

    this.render(this.paused ? 1 : this.acc / PHYSICS.dt, frameDt);
    this.raf = requestAnimationFrame(this.frame);
  };
}
