// Menús: principal, partida rápida, personalizada, créditos y pausa. DOM puro sobre el canvas.
import { BOT_PROFILES, DEFAULT_MUTATORS } from '../config';
import type { BotLevel, Mutators } from '../config';
import type { GameSetup } from './urlConfig';

export interface MenuCallbacks {
  play(setup: GameSetup): void;
  practice(): void;
  resume(): void;
  restart(): void;
  abandon(): void;
}

type Screen = 'main' | 'quick' | 'custom' | 'credits' | 'pause';

interface Option {
  value: string | number | boolean;
  label: string;
}
interface Field {
  key: keyof Mutators;
  label: string;
  options: Option[];
}

const FIELDS: Field[] = [
  { key: 'format', label: 'Formato', options: opts(['1v1', '2v2', '3v3']) },
  {
    key: 'botLevel',
    label: 'Nivel de bots',
    options: (Object.keys(BOT_PROFILES) as BotLevel[]).map((k) => ({
      value: k,
      label: BOT_PROFILES[k].name,
    })),
  },
  {
    key: 'durationMinutes',
    label: 'Duración',
    options: [
      { value: 3, label: '3 min' },
      { value: 5, label: '5 min' },
      { value: 10, label: '10 min' },
      { value: 20, label: '20 min' },
      { value: 0, label: 'Ilimitada' },
    ],
  },
  {
    key: 'maxGoals',
    label: 'Goles máximos',
    options: [0, 1, 3, 5, 7, 10].map((n) => ({
      value: n,
      label: n === 0 ? 'Sin límite' : String(n),
    })),
  },
  {
    key: 'overtime',
    label: 'Prórroga',
    options: [
      { value: true, label: 'Sí (gol de oro)' },
      { value: false, label: 'No' },
    ],
  },
  {
    key: 'series',
    label: 'Serie',
    options: [
      { value: 0, label: 'Partido único' },
      { value: 3, label: 'Al mejor de 3' },
      { value: 5, label: 'Al mejor de 5' },
      { value: 7, label: 'Al mejor de 7' },
    ],
  },
  {
    key: 'gameSpeed',
    label: 'Velocidad de juego',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'slow', label: 'Lenta' },
      { value: 'fast', label: 'Rápida' },
    ],
  },
  {
    key: 'ballMaxSpeed',
    label: 'Velocidad máx. pelota',
    options: [
      { value: 'default', label: 'Normal' },
      { value: 'slow', label: 'Lenta' },
      { value: 'fast', label: 'Rápida' },
      { value: 'super', label: 'Súper rápida' },
    ],
  },
  {
    key: 'ballSize',
    label: 'Tamaño de pelota',
    options: [
      { value: 'default', label: 'Normal' },
      { value: 'small', label: 'Pequeña' },
      { value: 'large', label: 'Grande' },
      { value: 'giant', label: 'Gigante' },
    ],
  },
  {
    key: 'ballBounce',
    label: 'Rebote de pelota',
    options: [
      { value: 'default', label: 'Normal' },
      { value: 'low', label: 'Bajo' },
      { value: 'high', label: 'Alto' },
      { value: 'super', label: 'Súper alto' },
    ],
  },
  {
    key: 'ballWeight',
    label: 'Peso de pelota',
    options: [
      { value: 'default', label: 'Normal' },
      { value: 'light', label: 'Ligera' },
      { value: 'heavy', label: 'Pesada' },
      { value: 'superLight', label: 'Súper ligera' },
    ],
  },
  {
    key: 'boostAmount',
    label: 'Cantidad de turbo',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'none', label: 'Sin turbo' },
      { value: 'unlimited', label: 'Ilimitado' },
      { value: 'recharge', label: 'Recarga' },
    ],
  },
  {
    key: 'boostStrength',
    label: 'Fuerza del turbo',
    options: [1, 1.5, 2, 10].map((n) => ({ value: n, label: `×${String(n).replace('.', ',')}` })),
  },
  {
    key: 'gravity',
    label: 'Gravedad',
    options: [
      { value: 'low', label: 'Baja' },
      { value: 'normal', label: 'Normal' },
      { value: 'high', label: 'Alta' },
    ],
  },
  {
    key: 'demolition',
    label: 'Demoliciones',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'off', label: 'Desactivadas' },
      { value: 'friendly', label: 'Fuego amigo' },
      { value: 'contact', label: 'Al contacto' },
    ],
  },
  {
    key: 'respawnTime',
    label: 'Reaparición',
    options: [1, 2, 3, 5, 8].map((n) => ({ value: n, label: `${n} s` })),
  },
  {
    key: 'theme',
    label: 'Tema de estadio',
    options: [
      { value: 'day', label: 'Día' },
      { value: 'night', label: 'Noche' },
      { value: 'neon', label: 'Neón' },
    ],
  },
];

function opts(values: string[]): Option[] {
  return values.map((v) => ({ value: v, label: v }));
}

const STORE = 'turbo-arena:setup';

interface Saved {
  mutators: Mutators;
  humanTeam: 0 | 1;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      return {
        mutators: { ...DEFAULT_MUTATORS, ...s.mutators },
        humanTeam: s.humanTeam === 1 ? 1 : 0,
      };
    }
  } catch {
    /* sin almacenamiento disponible */
  }
  return { mutators: { ...DEFAULT_MUTATORS }, humanTeam: 0 };
}

function save(s: Saved): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* sin almacenamiento disponible */
  }
}

export class Menus {
  private root: HTMLElement;
  private screen: Screen | null = null;
  private saved: Saved = load();
  private practicePause = false;

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
    this.screen = null;
  }

  /** Para volver a "Cambiar modo" desde la pantalla de resultados. */
  showQuick(): void {
    this.open('quick');
  }

  showMain(): void {
    this.open('main');
  }

  showPause(practice: boolean): void {
    this.practicePause = practice;
    this.open('pause');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.screen === 'pause') this.cb.resume();
      else if (this.screen !== 'main') this.open('main');
    }
  }

  private open(screen: Screen): void {
    this.screen = screen;
    this.root.hidden = false;
    switch (screen) {
      case 'main':
        return this.renderMain();
      case 'quick':
        return this.renderQuick();
      case 'custom':
        return this.renderCustom();
      case 'credits':
        return this.renderCredits();
      case 'pause':
        return this.renderPause();
    }
  }

  private render(html: string): HTMLElement {
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    return this.root.querySelector('.panel') as HTMLElement;
  }

  private on(sel: string, fn: () => void): void {
    this.root.querySelector(sel)?.addEventListener('click', fn);
  }

  private renderMain(): void {
    this.render(`
      <h1 class="title">TURBO <span>ARENA</span></h1>
      <p class="tag">Fútbol con coches propulsados por cohetes</p>
      <div class="stack">
        <button class="btn primary" data-go="quick">Jugar</button>
        <button class="btn" data-go="custom">Partida personalizada</button>
        <button class="btn" data-go="practice">Práctica libre</button>
        <button class="btn" disabled title="Próximamente">Garaje <small>próximamente</small></button>
        <button class="btn" disabled title="Próximamente">Ajustes <small>próximamente</small></button>
        <button class="btn" data-go="credits">Créditos</button>
      </div>
      <p class="foot">Juego original inspirado en las mecánicas del modo Soccar</p>`);
    this.on('[data-go=quick]', () => this.open('quick'));
    this.on('[data-go=custom]', () => this.open('custom'));
    this.on('[data-go=credits]', () => this.open('credits'));
    this.on('[data-go=practice]', () => this.cb.practice());
  }

  private segment(name: string, label: string, options: Option[], current: string): string {
    const items = options
      .map(
        (o) =>
          `<button type="button" class="seg ${String(o.value) === current ? 'on' : ''}" data-seg="${name}" data-v="${String(o.value)}">${o.label}</button>`,
      )
      .join('');
    return `<div class="row"><span>${label}</span><div class="segs">${items}</div></div>`;
  }

  private renderQuick(): void {
    const m = this.saved.mutators;
    this.render(`
      <h2>Jugar</h2>
      ${this.segment('format', 'Formato', FIELDS[0].options, m.format)}
      ${this.segment(
        'team',
        'Tu equipo',
        [
          { value: 0, label: 'Azul' },
          { value: 1, label: 'Naranja' },
        ],
        String(this.saved.humanTeam),
      )}
      ${this.segment('botLevel', 'Nivel de bots', FIELDS[1].options, m.botLevel)}
      <p class="note">Las plazas libres se rellenan con bots (compañeros y rivales). Duración 5:00 con prórroga.</p>
      <div class="buttons">
        <button class="btn" data-go="back">Atrás</button>
        <button class="btn primary" data-go="start">¡A jugar!</button>
      </div>`);
    const sel: Record<string, string> = {
      format: m.format,
      team: String(this.saved.humanTeam),
      botLevel: m.botLevel,
    };
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.seg as string;
        sel[name] = b.dataset.v as string;
        this.root
          .querySelectorAll<HTMLElement>(`.seg[data-seg=${name}]`)
          .forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    this.on('[data-go=back]', () => this.open('main'));
    this.on('[data-go=start]', () => {
      const mutators: Mutators = {
        ...DEFAULT_MUTATORS,
        ...this.saved.mutators,
        format: sel.format as Mutators['format'],
        botLevel: sel.botLevel as BotLevel,
      };
      const humanTeam = sel.team === '1' ? 1 : 0;
      this.saved = { mutators, humanTeam };
      save(this.saved);
      this.cb.play({ mode: 'match', mutators, humanTeam });
    });
  }

  private renderCustom(): void {
    const m = this.saved.mutators as unknown as Record<string, unknown>;
    const fields = FIELDS.map((f) => {
      const current = String(m[f.key]);
      const options = f.options
        .map(
          (o) =>
            `<option value="${String(o.value)}" ${String(o.value) === current ? 'selected' : ''}>${o.label}</option>`,
        )
        .join('');
      return `<label class="field"><span>${f.label}</span><select data-key="${f.key}">${options}</select></label>`;
    }).join('');
    this.render(`
      <h2>Partida personalizada</h2>
      <label class="field"><span>Tu equipo</span><select data-key="__team">
        <option value="0" ${this.saved.humanTeam === 0 ? 'selected' : ''}>Azul</option>
        <option value="1" ${this.saved.humanTeam === 1 ? 'selected' : ''}>Naranja</option></select></label>
      <div class="grid">${fields}</div>
      <div class="buttons">
        <button class="btn" data-go="back">Atrás</button>
        <button class="btn" data-go="reset">Restablecer</button>
        <button class="btn primary" data-go="start">¡A jugar!</button>
      </div>`);
    this.on('[data-go=back]', () => this.open('main'));
    this.on('[data-go=reset]', () => {
      this.saved = { mutators: { ...DEFAULT_MUTATORS }, humanTeam: 0 };
      save(this.saved);
      this.renderCustom();
    });
    this.on('[data-go=start]', () => {
      const mutators = { ...this.saved.mutators } as unknown as Record<string, unknown>;
      let humanTeam: 0 | 1 = 0;
      this.root.querySelectorAll<HTMLSelectElement>('select').forEach((s) => {
        const key = s.dataset.key as string;
        if (key === '__team') {
          humanTeam = s.value === '1' ? 1 : 0;
          return;
        }
        const field = FIELDS.find((f) => f.key === key);
        const opt = field?.options[s.selectedIndex];
        if (opt) mutators[key] = opt.value;
      });
      this.saved = { mutators: mutators as unknown as Mutators, humanTeam };
      save(this.saved);
      this.cb.play({ mode: 'match', mutators: this.saved.mutators, humanTeam });
    });
  }

  private renderCredits(): void {
    this.render(`
      <h2>Créditos</h2>
      <div class="credits">
        <p><b>Turbo Arena</b> es un juego original inspirado en las mecánicas de un deporte de coches con cohetes.</p>
        <p>Todos los modelos, texturas y efectos se generan por código; no incluye assets de terceros y no usa
        nombres, logos, modelos, texturas, sonidos ni música de Rocket League, Psyonix ni Epic Games.</p>
        <p>Hecho con <b>three.js</b> (MIT), TypeScript y Vite. Física, bots y reglas: simulación propia.</p>
        <p>Detalle completo en <code>CREDITS.md</code>.</p>
      </div>
      <div class="buttons"><button class="btn primary" data-go="back">Volver</button></div>`);
    this.on('[data-go=back]', () => this.open('main'));
  }

  private renderPause(): void {
    this.render(`
      <h2>Pausa</h2>
      <div class="stack">
        <button class="btn primary" data-go="resume">Continuar</button>
        ${this.practicePause ? '' : '<button class="btn" data-go="restart">Reiniciar partida</button>'}
        <button class="btn" data-go="abandon">${this.practicePause ? 'Salir al menú' : 'Abandonar partida'}</button>
      </div>
      <p class="foot">Esc para continuar</p>`);
    this.on('[data-go=resume]', () => this.cb.resume());
    this.on('[data-go=restart]', () => this.cb.restart());
    this.on('[data-go=abandon]', () => this.cb.abandon());
  }
}
