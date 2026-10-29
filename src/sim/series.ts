// Serie al mejor de 3, 5 o 7 partidos.
export class Series {
  readonly winsNeeded: number;
  readonly wins: [number, number] = [0, 0];
  games = 0;

  /** `bestOf` 0 = partido único. */
  constructor(readonly bestOf: 0 | 3 | 5 | 7) {
    this.winsNeeded = bestOf === 0 ? 1 : Math.ceil(bestOf / 2);
  }

  /** Registra el resultado de un partido (-1 = empate sin prórroga, no cuenta). */
  record(winner: -1 | 0 | 1): void {
    this.games++;
    if (winner !== -1) this.wins[winner]++;
  }

  get finished(): boolean {
    return this.wins[0] >= this.winsNeeded || this.wins[1] >= this.winsNeeded;
  }

  get winner(): 0 | 1 | null {
    if (this.wins[0] >= this.winsNeeded) return 0;
    if (this.wins[1] >= this.winsNeeded) return 1;
    return null;
  }

  reset(): void {
    this.wins[0] = 0;
    this.wins[1] = 0;
    this.games = 0;
  }
}
