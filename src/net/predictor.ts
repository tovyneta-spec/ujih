// Predicción del cliente con reconciliación: el coche propio se simula localmente al instante y,
// cuando llega un snapshot autoritativo, se restaura ese estado y se vuelven a simular las entradas
// que el servidor aún no ha confirmado. El error visual se absorbe suavemente (sin saltos).
import type { CarInput, World } from '../sim';
import { Vec3, copyInput, neutralInput } from '../sim';
import { applySnapshot } from './state';
import type { NetSnapshot } from './state';

/** Por encima de esta distancia (uu) la corrección es un salto limpio en lugar de un deslizamiento. */
export const SNAP_DISTANCE = 300;
/** Máx. de entradas sin confirmar que se conservan (≈ 2 s). */
const MAX_PENDING = 240;

interface Pending {
  seq: number;
  input: CarInput;
}

export class Predictor {
  private pending: Pending[] = [];
  /** Siguiente número de secuencia de entrada. */
  nextSeq = 1;
  /** Desfase visual que decae con el tiempo (posición renderizada = simulada + desfase). */
  readonly offset = new Vec3();
  /** Error de posición (uu) de la última reconciliación. */
  lastError = 0;
  reconciliations = 0;
  private before = new Vec3();

  constructor(
    readonly world: World,
    readonly carId: number,
  ) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Simula un tick local con la entrada del jugador y devuelve su número de secuencia. */
  step(input: CarInput): number {
    const seq = this.nextSeq++;
    const copy = neutralInput();
    copyInput(input, copy);
    this.pending.push({ seq, input: copy });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.world.setInput(this.carId, copy);
    this.world.step();
    this.world.drainEvents(); // los eventos buenos llegan del servidor
    return seq;
  }

  /** Aplica el estado autoritativo y vuelve a simular las entradas pendientes. */
  reconcile(s: NetSnapshot): void {
    const car = this.world.cars[this.carId];
    this.before.copy(car.pos); // posición simulada (sin desfase visual) antes de corregir
    applySnapshot(this.world, s);
    while (this.pending.length > 0 && this.pending[0].seq <= s.ack) this.pending.shift();
    for (const p of this.pending) {
      this.world.setInput(this.carId, p.input);
      this.world.step();
      this.world.drainEvents();
    }
    this.reconciliations++;
    // Error real de predicción: lo que se movió el coche simulado al aplicar el estado autoritativo.
    const err = car.pos.distanceTo(this.before);
    this.lastError = err;
    if (err > SNAP_DISTANCE) this.offset.set(0, 0, 0);
    else this.offset.add(this.before).sub(car.pos); // el desfase visual absorbe la corrección
  }

  /** Hace decaer el desfase visual (constante de tiempo ≈ 0,1 s). */
  smooth(dt: number): void {
    this.offset.scale(Math.exp(-dt / 0.1));
  }
}
