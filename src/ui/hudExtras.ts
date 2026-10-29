// Elementos de HUD adicionales: nombres sobre los coches, barras de turbo de compañeros,
// marcador completo (Tab) y registro de eventos.
import type { GameRenderer } from '../render/gameRenderer';
import type { SimEvent, World } from '../sim';

const KIND_TEXT: Record<string, string> = {
  goal: 'Gol',
  assist: 'Asistencia',
  save: 'Parada',
  epicSave: 'Parada épica',
  demo: 'Demolición',
};

/** Quita el sufijo de nivel "(Pro)" del nombre para las etiquetas flotantes. */
export const shortName = (n: string): string => n.replace(/\s*\(.*\)$/, '');

export class HudExtras {
  readonly root: HTMLElement;
  private plates: HTMLElement[] = [];
  private bars: { row: HTMLElement; fill: HTMLElement; carId: number }[] = [];
  private barsBox: HTMLElement;
  private board: HTMLElement;
  private feed: HTMLElement;
  private pt = { x: 0, y: 0 };
  names: string[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'extras';
    this.root.innerHTML = `<div class="plates"></div><div class="teambars"></div><div class="feed"></div><div class="board" hidden></div>`;
    parent.appendChild(this.root);
    this.barsBox = this.root.querySelector('.teambars') as HTMLElement;
    this.board = this.root.querySelector('.board') as HTMLElement;
    this.feed = this.root.querySelector('.feed') as HTMLElement;
  }

  /** Reconstruye etiquetas y barras para un mundo nuevo. */
  setup(world: World, names: string[], humanId: number): void {
    this.names = names;
    const platesBox = this.root.querySelector('.plates') as HTMLElement;
    platesBox.innerHTML = '';
    this.barsBox.innerHTML = '';
    this.feed.innerHTML = '';
    this.plates = world.cars.map((c) => {
      const el = document.createElement('div');
      el.className = `plate t${c.team}`;
      el.textContent = shortName(names[c.id] ?? `Coche ${c.id + 1}`);
      el.hidden = c.id === humanId;
      platesBox.appendChild(el);
      return el;
    });
    const human = world.cars[humanId];
    this.bars = [];
    for (const c of world.cars) {
      if (c.id === humanId || !human || c.team !== human.team) continue;
      const row = document.createElement('div');
      row.className = 'tbar';
      row.innerHTML = `<span>${shortName(names[c.id] ?? '')}</span><div><i></i></div>`;
      this.barsBox.appendChild(row);
      this.bars.push({ row, fill: row.querySelector('i') as HTMLElement, carId: c.id });
    }
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  onEvent(e: SimEvent): void {
    let text: string | null = null;
    let team = 0;
    const name = (id: number): string => shortName(this.names[id] ?? `Coche ${id + 1}`);
    if (e.type === 'demolition') text = `${name(e.attackerId)} ⚡ ${name(e.victimId)}`;
    else if (e.type === 'award' && e.kind in KIND_TEXT)
      text = `${name(e.carId)} · ${KIND_TEXT[e.kind]} +${e.points}`;
    if (!text) return;
    if (e.type === 'award' || e.type === 'demolition') team = this.teamOf(e);
    const el = document.createElement('div');
    el.className = `feeditem t${team}`;
    el.textContent = text;
    this.feed.prepend(el);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => el.remove(), 4500);
  }

  private world: World | null = null;
  private teamOf(e: SimEvent): number {
    const id = e.type === 'award' ? e.carId : e.type === 'demolition' ? e.attackerId : -1;
    return this.world?.cars[id]?.team ?? 0;
  }

  update(
    world: World,
    renderer: GameRenderer,
    humanId: number,
    showPlates: boolean,
    tab: boolean,
  ): void {
    this.world = world;
    const cam = renderer.camera.position;
    world.cars.forEach((c, i) => {
      const el = this.plates[i];
      if (!el || c.id === humanId) return;
      const p = renderer.carRenderPos[i];
      if (!showPlates || c.demolished || !p) {
        el.hidden = true;
        return;
      }
      const onScreen = renderer.project(p.x, p.y, p.z + 90, this.pt);
      el.hidden = !onScreen;
      if (!onScreen) return;
      // La distancia a la cámara atenúa y reduce la etiqueta.
      const d = Math.hypot(p.x - cam.x, p.z - cam.y, -p.y - cam.z);
      el.style.transform = `translate(${this.pt.x}px, ${this.pt.y}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.max(0.35, Math.min(1, 3500 / Math.max(d, 1))));
    });
    for (const b of this.bars) {
      const car = world.cars[b.carId];
      b.fill.style.width = `${Math.max(0, Math.min(100, car.boost))}%`;
      b.row.classList.toggle('down', car.demolished);
    }
    this.barsBox.hidden = !showPlates;
    this.board.hidden = !tab;
    if (tab) this.renderBoard(world);
  }

  private renderBoard(world: World): void {
    const m = world.match;
    const row = (id: number): string => {
      const s = m.stats[id];
      if (!s) return '';
      return `<tr><td>${this.names[id] ?? `Coche ${id + 1}`}</td><td>${s.score}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.saves + s.epicSaves}</td><td>${s.shots}</td><td>${s.demos}</td></tr>`;
    };
    const team = (t: 0 | 1): string => {
      const ids = world.cars.filter((c) => c.team === t).map((c) => c.id);
      ids.sort((a, b) => (m.stats[b]?.score ?? 0) - (m.stats[a]?.score ?? 0));
      return `<tr class="th t${t}"><th>${t === 0 ? 'AZUL' : 'NARANJA'}  ${m.score[t]}</th><th>Pts</th><th>Goles</th><th>Asist.</th><th>Paradas</th><th>Tiros</th><th>Demol.</th></tr>${ids.map(row).join('')}`;
    };
    this.board.innerHTML = `<table>${team(0)}${team(1)}</table>`;
  }
}
