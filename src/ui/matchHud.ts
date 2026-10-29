// Marcador, reloj, cuenta atrás, avisos de gol/estadísticas y pantalla final.
import type { Match, SimEvent, World } from '../sim';

const AWARD_TEXT: Record<string, string> = {
  goal: 'Gol',
  assist: 'Asistencia',
  save: 'Parada',
  epicSave: 'Parada épica',
  shot: 'Tiro a puerta',
  demo: 'Demolición',
};

function fmt(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class MatchHud {
  private root: HTMLElement;
  private blue: HTMLElement;
  private orange: HTMLElement;
  private clock: HTMLElement;
  private banner: HTMLElement;
  private sub: HTMLElement;
  private toasts: HTMLElement;
  private end: HTMLElement;
  private bannerTimer = 0;
  private lastClock = '';
  /** Nombres visibles por id de coche. */
  names: string[] = [];
  humanId = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'match';
    this.root.innerHTML = `
      <div class="score">
        <div class="blue">0</div>
        <div class="clock">5:00</div>
        <div class="orange">0</div>
      </div>
      <div class="banner" hidden><div class="big"></div><div class="small"></div></div>
      <div class="toasts"></div>
      <div class="end" hidden></div>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.blue = q('.blue');
    this.orange = q('.orange');
    this.clock = q('.clock');
    this.banner = q('.banner');
    this.sub = q('.banner .small');
    this.toasts = q('.toasts');
    this.end = q('.end');
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  private showBanner(big: string, small = '', ms = 1800, cls = ''): void {
    this.banner.hidden = false;
    this.banner.className = `banner ${cls}`;
    (this.banner.querySelector('.big') as HTMLElement).textContent = big;
    this.sub.textContent = small;
    this.bannerTimer = ms;
  }

  private toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private name(id: number): string {
    return this.names[id] ?? `Coche ${id + 1}`;
  }

  onEvent(e: SimEvent, world: World): void {
    switch (e.type) {
      case 'countdown':
        this.end.hidden = true;
        this.showBanner(String(e.n), '', 1000, 'count');
        break;
      case 'go':
        this.showBanner('¡YA!', '', 800, 'count');
        break;
      case 'matchGoal': {
        const who = e.ownGoal ? 'Autogol' : this.name(e.scorerId);
        const assist = e.assistId >= 0 ? ` · Asistencia: ${this.name(e.assistId)}` : '';
        this.showBanner(
          '¡GOL!',
          `${who} · ${e.speedKmh} km/h${assist}`,
          3000,
          e.team === 0 ? 'blue' : 'orange',
        );
        break;
      }
      case 'overtime':
        this.showBanner('¡PRÓRROGA!', 'Gol de oro', 2500);
        break;
      case 'award':
        if (e.carId === this.humanId && e.kind !== 'goal') {
          this.toast(`${AWARD_TEXT[e.kind]} +${e.points}`);
        } else if (e.carId === this.humanId) this.toast(`Gol +${e.points}`);
        break;
      case 'demolition':
        if (e.attackerId === this.humanId) this.toast('¡Demolición!');
        else if (e.victimId === this.humanId) this.toast('Te han demolido');
        break;
      case 'matchEnd':
        this.showEnd(world.match, e.winner);
        break;
      default:
        break;
    }
  }

  private showEnd(match: Match, winner: -1 | 0 | 1): void {
    const humanTeam = 0;
    const title = winner === -1 ? 'Empate' : winner === humanTeam ? '¡Victoria!' : 'Derrota';
    let best = -1;
    let mvp = 0;
    match.stats.forEach((s, i) => {
      if (s.score > best) {
        best = s.score;
        mvp = i;
      }
    });
    const rows = match.stats
      .map(
        (s, i) =>
          `<tr class="${i === mvp ? 'mvp' : ''}"><td>${this.name(i)}${i === mvp ? ' ★ MVP' : ''}</td><td>${s.score}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.saves + s.epicSaves}</td><td>${s.shots}</td><td>${s.demos}</td></tr>`,
      )
      .join('');
    this.end.hidden = false;
    this.end.innerHTML = `<h2>${title}</h2><div class="final">${match.score[0]} – ${match.score[1]}</div>
      <table><tr><th></th><th>Pts</th><th>Goles</th><th>Asist.</th><th>Paradas</th><th>Tiros</th><th>Demol.</th></tr>${rows}</table>
      <p>Pulsa <b>R</b> para la revancha</p>`;
    this.banner.hidden = true;
  }

  update(match: Match, frameMs: number): void {
    this.blue.textContent = String(match.score[0]);
    this.orange.textContent = String(match.score[1]);
    let text: string;
    if (match.overtime) text = `+${fmt(match.overtimeTime - 0.999)}`;
    else if (match.config.duration <= 0) text = '∞';
    else text = fmt(match.timeRemaining);
    if (text !== this.lastClock) {
      this.lastClock = text;
      this.clock.textContent = text;
    }
    this.clock.classList.toggle(
      'low',
      !match.overtime && match.config.duration > 0 && match.timeRemaining <= 30,
    );
    if (this.bannerTimer > 0) {
      this.bannerTimer -= frameMs;
      if (this.bannerTimer <= 0) this.banner.hidden = true;
    }
  }
}
