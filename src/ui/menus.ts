// Menús: principal, partida rápida, personalizada, créditos y pausa. DOM puro sobre el canvas.
import {
  ANTENNAS,
  BODY_IDS,
  BOT_PROFILES,
  CAMERA_LIMITS,
  DEFAULT_CAMERA,
  DEFAULT_CONTROLS,
  DEFAULT_KEYS,
  REMAPPABLE,
  SCHEMES,
  keyLabel,
  CAR_BODIES,
  DECALS,
  DEFAULT_GARAGE,
  DEFAULT_MUTATORS,
  EXPLOSIONS,
  PALETTE,
  TRAILS,
  WHEEL_STYLES,
} from '../config';
import type {
  Action,
  BotLevel,
  CameraSettings,
  ControlScheme,
  GarageSettings,
  GoalExplosion,
  Mutators,
} from '../config';
import { loadAudio, loadGarage, loadSettings, sanitizeGarage, saveGarage } from '../storage';
import type { AudioSettings, PlayerSettings } from '../storage';
import { defaultServerUrl } from '../net/client';
import type { Format, LobbyInfo } from '../net/protocol';
import type { GameSetup } from './urlConfig';

export interface MenuCallbacks {
  play(setup: GameSetup): void;
  practice(): void;
  resume(): void;
  restart(): void;
  abandon(): void;
  /** Entra en el garaje (vista previa 3D) con los ajustes actuales. */
  garageEnter(g: GarageSettings): void;
  garageChange(g: GarageSettings): void;
  garageExplosion(style: GoalExplosion): void;
  garageExit(): void;
  audioChange(a: AudioSettings): void;
  /** Ajustes de cámara y controles modificados (ya validados; el juego los guarda y aplica). */
  settingsChange(s: PlayerSettings): void;
  /** Sonidos de interfaz. */
  ui(kind: 'click' | 'hover' | 'back'): void;
  online: OnlineMenuApi;
}

/** Acciones online que dispara la interfaz. */
export interface OnlineMenuApi {
  connect(url: string): void;
  disconnect(): void;
  quick(format: Format, level: BotLevel): void;
  create(format: Format, level: BotLevel, minutes: number): void;
  join(code: string): void;
  team(team: 0 | 1): void;
  cfg(patch: { format?: Format; level?: BotLevel; durationMinutes?: number }): void;
  start(): void;
  leave(): void;
}

type Screen =
  | 'main'
  | 'quick'
  | 'custom'
  | 'credits'
  | 'pause'
  | 'garage'
  | 'audio'
  | 'online'
  | 'lobby'
  | 'settings';

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
  { key: 'format', label: 'Formato', options: opts(['1v1', '2v2', '3v3', '4v4']) },
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

const SERVER_KEY = 'turbo-arena:server';

function loadServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_KEY) || defaultServerUrl();
  } catch {
    return defaultServerUrl();
  }
}

function saveServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_KEY, url);
  } catch {
    /* sin almacenamiento */
  }
}

/** Primera tecla por defecto de cada acción (la que muestra la pantalla de ajustes). */
const DEFAULT_KEYS_FIRST: Record<string, string> = Object.fromEntries(
  Object.entries(DEFAULT_KEYS).map(([a, k]) => [a, k[0] ?? '']),
);

export class Menus {
  private root: HTMLElement;
  private screen: Screen | null = null;
  private saved: Saved = load();
  private garage: GarageSettings = loadGarage();
  private audio: AudioSettings = loadAudio();
  private lastHover: HTMLButtonElement | null = null;
  private pauseMode: 'practice' | 'match' | 'online' = 'match';
  private onlineConnected = false;
  private onlineText = 'Sin conexión';
  private serverUrl = loadServerUrl();
  private lobby: LobbyInfo | null = null;
  private myId = -1;
  private settings: PlayerSettings = loadSettings();
  private settingsTab: 'camera' | 'controls' = 'camera';
  private settingsBack: 'main' | 'pause' = 'main';
  private rebinding: Action | null = null;

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    parent.appendChild(this.root);
    // Captura de la nueva tecla al reasignar: va en fase de captura para adelantarse a todo lo demás.
    window.addEventListener('keydown', (e) => this.onRebindKey(e), true);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Sonidos de interfaz por delegación.
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.cb.ui('click');
    });
    this.root.addEventListener('mouseover', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled && b !== this.lastHover) this.cb.ui('hover');
      this.lastHover = b;
    });
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

  showPause(mode: 'practice' | 'match' | 'online'): void {
    this.pauseMode = mode;
    this.open('pause');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.screen === 'pause') this.cb.resume();
      else if (this.screen === 'garage') this.leaveGarage();
      else if (this.screen === 'settings') this.closeSettings();
      else if (this.screen === 'lobby') this.cb.online.leave();
      else if (this.screen === 'online') {
        this.cb.online.disconnect();
        this.open('main');
      } else if (this.screen !== 'main') this.open('main');
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
      case 'garage':
        return this.renderGarage();
      case 'audio':
        return this.renderAudio();
      case 'online':
        return this.renderOnline();
      case 'lobby':
        return this.renderLobby();
      case 'settings':
        return this.renderSettings();
    }
  }

  private render(html: string): HTMLElement {
    this.root.classList.toggle('garage', this.screen === 'garage');
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
        <button class="btn" data-go="online">Jugar online</button>
        <button class="btn" data-go="garage">Garaje</button>
        <button class="btn" data-go="settings">Ajustes</button>
        <button class="btn" data-go="audio">Audio</button>
        <button class="btn" data-go="credits">Créditos</button>
      </div>
      <p class="foot">Juego original inspirado en las mecánicas del modo Soccar</p>`);
    this.on('[data-go=quick]', () => this.open('quick'));
    this.on('[data-go=custom]', () => this.open('custom'));
    this.on('[data-go=credits]', () => this.open('credits'));
    this.on('[data-go=garage]', () => {
      this.open('garage');
      this.cb.garageEnter(this.garage);
    });
    this.on('[data-go=audio]', () => this.open('audio'));
    this.on('[data-go=settings]', () => this.openSettings('main'));
    this.on('[data-go=online]', () => this.open('online'));
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

  private leaveGarage(): void {
    saveGarage(this.garage);
    this.cb.garageExit();
    this.open('main');
  }

  private swatches(name: 'primary' | 'secondary', current: string): string {
    const items = PALETTE.map(
      (c) =>
        `<button type="button" class="sw ${c === current ? 'on' : ''}" data-sw="${name}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`,
    ).join('');
    return `<div class="swatches">${items}<input type="color" data-pick="${name}" value="${current}" aria-label="Color personalizado" /></div>`;
  }

  private renderGarage(): void {
    const g = this.garage;
    const seg = (
      name: string,
      label: string,
      entries: [string, string][],
      current: string,
    ): string =>
      this.segment(
        name,
        label,
        entries.map(([value, text]) => ({ value, label: text })),
        current,
      );
    this.render(`
      <h2>Garaje</h2>
      <label class="field"><span>Nombre del jugador</span><input type="text" maxlength="16" data-name value="${g.name}" /></label>
      ${seg(
        'body',
        'Carrocería',
        BODY_IDS.map((id) => [id, CAR_BODIES[id].name]),
        g.body,
      )}
      <div class="row"><span>Color primario</span>${this.swatches('primary', g.primary)}</div>
      <div class="row"><span>Color secundario</span>${this.swatches('secondary', g.secondary)}</div>
      ${seg('wheels', 'Ruedas', Object.entries(WHEEL_STYLES), g.wheels)}
      ${seg(
        'trail',
        'Estela de turbo',
        Object.entries(TRAILS).map(([k, v]) => [k, v.name]),
        g.trail,
      )}
      ${seg('explosion', 'Explosión de gol', Object.entries(EXPLOSIONS), g.explosion)}
      ${seg('antenna', 'Antena', Object.entries(ANTENNAS), g.antenna)}
      ${seg('decal', 'Calcomanía', Object.entries(DECALS), g.decal)}
      <div class="buttons">
        <button class="btn" data-go="reset">Restablecer</button>
        <button class="btn" data-go="boom">Probar explosión</button>
        <button class="btn primary" data-go="back">Guardar y volver</button>
      </div>`);
    const apply = (patch: Partial<GarageSettings>): void => {
      this.garage = sanitizeGarage({ ...this.garage, ...patch });
      saveGarage(this.garage);
      this.cb.garageChange(this.garage);
    };
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.seg as string;
        this.root
          .querySelectorAll<HTMLElement>(`.seg[data-seg=${name}]`)
          .forEach((x) => x.classList.toggle('on', x === b));
        apply({ [name]: b.dataset.v } as Partial<GarageSettings>);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('.sw').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.sw as 'primary' | 'secondary';
        const input = this.root.querySelector<HTMLInputElement>(`input[data-pick=${name}]`);
        if (input) input.value = b.dataset.c as string;
        this.root
          .querySelectorAll<HTMLElement>(`.sw[data-sw=${name}]`)
          .forEach((x) => x.classList.toggle('on', x === b));
        apply({ [name]: b.dataset.c } as Partial<GarageSettings>);
      }),
    );
    this.root
      .querySelectorAll<HTMLInputElement>('input[data-pick]')
      .forEach((i) =>
        i.addEventListener('input', () =>
          apply({ [i.dataset.pick as string]: i.value } as Partial<GarageSettings>),
        ),
      );
    this.root
      .querySelector<HTMLInputElement>('input[data-name]')
      ?.addEventListener('change', (e) => {
        apply({ name: (e.target as HTMLInputElement).value });
      });
    this.on('[data-go=boom]', () => this.cb.garageExplosion(this.garage.explosion));
    this.on('[data-go=reset]', () => {
      this.garage = { ...DEFAULT_GARAGE };
      saveGarage(this.garage);
      this.cb.garageChange(this.garage);
      this.renderGarage();
    });
    this.on('[data-go=back]', () => this.leaveGarage());
  }

  private renderAudio(): void {
    const a = this.audio;
    const slider = (key: 'master' | 'sfx', label: string): string =>
      `<label class="field slider"><span>${label} <b data-val="${key}">${Math.round(a[key] * 100)}</b></span>
        <input type="range" min="0" max="100" value="${Math.round(a[key] * 100)}" data-vol="${key}" /></label>`;
    this.render(`
      <h2>Audio</h2>
      ${slider('master', 'Volumen general')}
      ${slider('sfx', 'Efectos')}
      <div class="buttons">
        <button class="btn" data-go="test">Probar sonido</button>
        <button class="btn primary" data-go="back">Volver</button>
      </div>`);
    this.root.querySelectorAll<HTMLInputElement>('input[data-vol]').forEach((i) =>
      i.addEventListener('input', () => {
        const key = i.dataset.vol as 'master' | 'sfx';
        this.audio = { ...this.audio, [key]: Number(i.value) / 100 };
        const out = this.root.querySelector(`[data-val=${key}]`);
        if (out) out.textContent = i.value;
        this.cb.audioChange(this.audio);
      }),
    );
    this.on('[data-go=test]', () => this.cb.ui('click'));
    this.on('[data-go=back]', () => this.open('main'));
  }

  // ---------------------------------------------------------------- ajustes

  private openSettings(back: 'main' | 'pause'): void {
    this.settingsBack = back;
    this.rebinding = null;
    this.open('settings');
  }

  private closeSettings(): void {
    this.rebinding = null;
    this.open(this.settingsBack);
  }

  private commitSettings(): void {
    this.cb.settingsChange(this.settings);
  }

  private onRebindKey(e: KeyboardEvent): void {
    if (!this.visible || this.screen !== 'settings' || !this.rebinding) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const action = this.rebinding;
    this.rebinding = null;
    if (e.code !== 'Escape') {
      const keys = { ...this.settings.controls.keys };
      // Una tecla sólo puede pertenecer a una acción: se libera de la que la tuviera.
      const eff = this.effectiveKeys();
      for (const [a, code] of Object.entries(eff) as [Action, string][]) {
        if (code === e.code && a !== action) keys[a] = '';
      }
      keys[action] = e.code;
      this.settings = {
        ...this.settings,
        controls: { ...this.settings.controls, keys },
      };
      this.commitSettings();
    }
    this.renderSettings();
  }

  /** Tecla efectiva (una por acción) del esquema de teclado. */
  private effectiveKeys(): Record<string, string> {
    const out: Record<string, string> = {};
    const custom = this.settings.controls.keys;
    for (const { action } of REMAPPABLE) {
      const c = custom[action];
      out[action] = c !== undefined ? c : (DEFAULT_KEYS_FIRST[action] ?? '');
    }
    return out;
  }

  private renderSettings(): void {
    const tab = this.settingsTab;
    const cam = this.settings.camera;
    const ctl = this.settings.controls;
    const fmt = (key: keyof typeof CAMERA_LIMITS, v: number): string =>
      CAMERA_LIMITS[key].step < 1 ? v.toFixed(CAMERA_LIMITS[key].step < 0.1 ? 2 : 1) : String(v);
    const camSlider = (key: keyof typeof CAMERA_LIMITS): string => {
      const l = CAMERA_LIMITS[key];
      return `<label class="field slider"><span>${l.label} <b data-camval="${key}">${fmt(key, cam[key])}</b></span>
        <input type="range" min="${l.min}" max="${l.max}" step="${l.step}" value="${cam[key]}" data-cam="${key}" /></label>`;
    };
    const cameraTab = `
      ${(Object.keys(CAMERA_LIMITS) as (keyof typeof CAMERA_LIMITS)[]).map(camSlider).join('')}
      <label class="field check"><input type="checkbox" data-camshake ${cam.shake ? 'checked' : ''} />
        <span>Sacudida de cámara (goles y demoliciones)</span></label>
      <div class="buttons"><button class="btn" data-go="camreset">Restaurar cámara</button></div>`;

    const eff = this.effectiveKeys();
    const keyRows = REMAPPABLE.map(
      ({ action, label }) => `<div class="row"><span>${label}</span>
        <button type="button" class="seg keybtn ${this.rebinding === action ? 'on' : ''}" data-key="${action}">${
          this.rebinding === action ? 'Pulsa una tecla…' : eff[action] ? keyLabel(eff[action]) : '—'
        }</button></div>`,
    ).join('');
    const schemes = (Object.keys(SCHEMES) as ControlScheme[])
      .map(
        (k) =>
          `<button type="button" class="seg ${ctl.scheme === k ? 'on' : ''}" data-scheme="${k}">${SCHEMES[k].name}</button>`,
      )
      .join('');
    const controlsTab = `
      <div class="row"><span>Esquema</span><div class="segs">${schemes}</div></div>
      <p class="note">${SCHEMES[ctl.scheme].description}</p>
      ${
        ctl.scheme === 'mouse'
          ? `<label class="field slider"><span>Sensibilidad del ratón <b data-mousesens>${ctl.mouseSensitivity.toFixed(1)}</b></span>
              <input type="range" min="0.5" max="2" step="0.1" value="${ctl.mouseSensitivity}" data-sens /></label>
             <p class="note">Mueve el ratón a la izquierda o la derecha del centro de la pantalla para girar.</p>`
          : `<div class="keys">${keyRows}</div>
             <div class="buttons"><button class="btn" data-go="keyreset">Restaurar teclas</button></div>`
      }`;
    this.render(`
      <h2>Ajustes</h2>
      <div class="segs tabs">
        <button type="button" class="seg ${tab === 'camera' ? 'on' : ''}" data-tab="camera">Cámara</button>
        <button type="button" class="seg ${tab === 'controls' ? 'on' : ''}" data-tab="controls">Controles</button>
      </div>
      <div class="settings-body">${tab === 'camera' ? cameraTab : controlsTab}</div>
      <div class="buttons"><button class="btn primary" data-go="back">Volver</button></div>`);

    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.settingsTab = b.dataset.tab as 'camera' | 'controls';
        this.rebinding = null;
        this.renderSettings();
      }),
    );
    this.on('[data-go=back]', () => this.closeSettings());
    this.root.querySelectorAll<HTMLInputElement>('input[data-cam]').forEach((i) =>
      i.addEventListener('input', () => {
        const key = i.dataset.cam as keyof typeof CAMERA_LIMITS;
        const camera: CameraSettings = { ...this.settings.camera, [key]: Number(i.value) };
        this.settings = { ...this.settings, camera };
        const out = this.root.querySelector(`[data-camval=${key}]`);
        if (out) out.textContent = fmt(key, camera[key]);
        this.commitSettings();
      }),
    );
    this.root
      .querySelector<HTMLInputElement>('[data-camshake]')
      ?.addEventListener('change', (e) => {
        const camera = { ...this.settings.camera, shake: (e.target as HTMLInputElement).checked };
        this.settings = { ...this.settings, camera };
        this.commitSettings();
      });
    this.on('[data-go=camreset]', () => {
      this.settings = { ...this.settings, camera: { ...DEFAULT_CAMERA } };
      this.commitSettings();
      this.renderSettings();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-scheme]').forEach((b) =>
      b.addEventListener('click', () => {
        const controls = { ...this.settings.controls, scheme: b.dataset.scheme as ControlScheme };
        this.settings = { ...this.settings, controls };
        this.rebinding = null;
        this.commitSettings();
        this.renderSettings();
      }),
    );
    this.root.querySelector<HTMLInputElement>('[data-sens]')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.settings = {
        ...this.settings,
        controls: { ...this.settings.controls, mouseSensitivity: v },
      };
      const out = this.root.querySelector('[data-mousesens]');
      if (out) out.textContent = v.toFixed(1);
      this.commitSettings();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        this.rebinding = b.dataset.key as Action;
        this.renderSettings();
      }),
    );
    this.on('[data-go=keyreset]', () => {
      this.settings = {
        ...this.settings,
        controls: { ...DEFAULT_CONTROLS, scheme: this.settings.controls.scheme, keys: {} },
      };
      this.commitSettings();
      this.renderSettings();
    });
  }

  // ----------------------------------------------------------------- online

  /** Muestra la pantalla de conexión online. */
  showOnline(): void {
    this.open('online');
  }

  /** Estado de la conexión (se refleja en la pantalla Online sin reconstruirla). */
  setOnlineStatus(connected: boolean, text: string): void {
    this.onlineConnected = connected;
    this.onlineText = text;
    if (this.screen !== 'online') return;
    const el = this.root.querySelector('[data-status]');
    if (el) {
      el.textContent = text;
      el.classList.toggle('ok', connected);
    }
    this.root.querySelector('[data-connected]')?.toggleAttribute('hidden', !connected);
    const btn = this.root.querySelector('[data-go=connect]');
    if (btn) btn.textContent = connected ? 'Desconectar' : 'Conectar';
  }

  /** Mensaje de error/aviso breve sobre el menú actual. */
  notify(text: string): void {
    const el = document.createElement('div');
    el.className = 'notice';
    el.textContent = text;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  private renderOnline(): void {
    const m = this.saved.mutators;
    this.render(`
      <h2>Jugar online</h2>
      <label class="field"><span>Servidor</span><input type="text" data-url value="${this.serverUrl}" spellcheck="false" /></label>
      <div class="status ${this.onlineConnected ? 'ok' : ''}" data-status>${this.onlineText}</div>
      <div data-connected ${this.onlineConnected ? '' : 'hidden'}>
        ${this.segment('ofmt', 'Formato', FIELDS[0].options, m.format)}
        ${this.segment('olvl', 'Nivel de los bots', FIELDS[1].options, m.botLevel)}
        <div class="buttons">
          <button class="btn primary" data-go="quick">Partida rápida</button>
          <button class="btn" data-go="create">Crear sala privada</button>
        </div>
        <div class="row joinrow"><span>Unirse con código</span>
          <div class="segs"><input type="text" data-code maxlength="5" placeholder="ABCDE" autocapitalize="characters" spellcheck="false" />
          <button class="btn" data-go="join">Unirse</button></div></div>
      </div>
      <div class="buttons">
        <button class="btn" data-go="back">Atrás</button>
        <button class="btn" data-go="connect">${this.onlineConnected ? 'Desconectar' : 'Conectar'}</button>
      </div>`);
    const sel: Record<string, string> = { ofmt: m.format, olvl: m.botLevel };
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((b) =>
      b.addEventListener('click', () => {
        const name = b.dataset.seg as string;
        sel[name] = b.dataset.v as string;
        this.root
          .querySelectorAll<HTMLElement>(`.seg[data-seg=${name}]`)
          .forEach((x) => x.classList.toggle('on', x === b));
      }),
    );
    const url = (): string =>
      (this.root.querySelector<HTMLInputElement>('input[data-url]')?.value ?? '').trim();
    this.on('[data-go=connect]', () => {
      if (this.onlineConnected) this.cb.online.disconnect();
      else {
        this.serverUrl = url();
        saveServerUrl(this.serverUrl);
        this.setOnlineStatus(false, 'Conectando…');
        this.cb.online.connect(this.serverUrl);
      }
    });
    this.on('[data-go=quick]', () =>
      this.cb.online.quick(sel.ofmt as Format, sel.olvl as BotLevel),
    );
    this.on('[data-go=create]', () =>
      this.cb.online.create(sel.ofmt as Format, sel.olvl as BotLevel, 5),
    );
    this.on('[data-go=join]', () => {
      const code = (this.root.querySelector<HTMLInputElement>('input[data-code]')?.value ?? '')
        .trim()
        .toUpperCase();
      this.cb.online.join(code);
    });
    this.on('[data-go=back]', () => {
      this.cb.online.disconnect();
      this.open('main');
    });
  }

  /** Muestra o actualiza el lobby de la sala. */
  showLobby(lobby: LobbyInfo, myId: number): void {
    this.lobby = lobby;
    this.myId = myId;
    if (this.screen !== 'lobby') {
      this.open('lobby');
      return;
    }
    this.fillLobby();
  }

  private renderLobby(): void {
    const l = this.lobby;
    if (!l) return;
    const host = l.hostId === this.myId;
    const opt = (cur: string, list: [string, string][]): string =>
      list
        .map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`)
        .join('');
    this.render(`
      <h2>Sala <span class="code" data-code-text>${l.code}</span></h2>
      <p class="note" data-meta></p>
      <div class="cfgrow" ${host ? '' : 'hidden'}>
        <select data-cfg="format">${opt(l.format, [
          ['1v1', '1v1'],
          ['2v2', '2v2'],
          ['3v3', '3v3'],
          ['4v4', '4v4'],
        ])}</select>
        <select data-cfg="level">${opt(
          l.botLevel,
          FIELDS[1].options.map((o) => [String(o.value), o.label] as [string, string]),
        )}</select>
        <select data-cfg="durationMinutes">${opt(String(l.durationMinutes), [
          ['3', '3 min'],
          ['5', '5 min'],
          ['10', '10 min'],
          ['20', '20 min'],
        ])}</select>
      </div>
      <div class="teams" data-teams></div>
      <p class="note" data-auto></p>
      <div class="buttons">
        <button class="btn" data-go="leave">Salir</button>
        <button class="btn" data-go="team">Cambiar de equipo</button>
        <button class="btn primary" data-go="start" ${host ? '' : 'disabled'}>${host ? 'Iniciar partida' : 'Esperando al anfitrión'}</button>
      </div>`);
    this.root.querySelectorAll<HTMLSelectElement>('select[data-cfg]').forEach((sel) =>
      sel.addEventListener('change', () => {
        const key = sel.dataset.cfg as 'format' | 'level' | 'durationMinutes';
        this.cb.online.cfg({ [key]: key === 'durationMinutes' ? Number(sel.value) : sel.value });
      }),
    );
    this.on('[data-go=leave]', () => this.cb.online.leave());
    this.on('[data-go=start]', () => this.cb.online.start());
    this.on('[data-go=team]', () => {
      const me = this.lobby?.players.find((p) => p.id === this.myId);
      if (me) this.cb.online.team(me.team === 0 ? 1 : 0);
    });
    this.fillLobby();
  }

  /** Actualiza las partes dinámicas del lobby sin destruir los selectores. */
  private fillLobby(): void {
    const l = this.lobby;
    if (!l) return;
    const host = l.hostId === this.myId;
    const dot = (ms: number, connected: boolean): string =>
      `<i class="dot ${!connected ? 'off' : ms < 60 ? 'good' : ms < 130 ? 'mid' : 'bad'}"></i>${connected ? `${ms} ms` : 'desconectado'}`;
    const col = (team: 0 | 1): string => {
      const mine = l.players.filter((p) => p.team === team);
      const rows = mine
        .map(
          (p) =>
            `<div class="prow ${p.id === this.myId ? 'me' : ''}"><b>${p.isHost ? '★ ' : ''}${p.name}</b><span>${dot(p.ping, p.connected)}</span></div>`,
        )
        .join('');
      const free = Array.from(
        { length: Math.max(0, l.perTeam - mine.length) },
        () => '<div class="prow free">— bot —</div>',
      ).join('');
      return `<div class="tcol t${team}"><h3>${team === 0 ? 'Azul' : 'Naranja'}</h3>${rows}${free}</div>`;
    };
    const teams = this.root.querySelector('[data-teams]');
    if (teams) teams.innerHTML = col(0) + col(1);
    const meta = this.root.querySelector('[data-meta]');
    if (meta) {
      meta.textContent = `${l.public ? 'Partida rápida' : 'Sala privada'} · ${l.format} · bots ${BOT_PROFILES[l.botLevel].name} · ${l.durationMinutes} min · Comparte el código ${l.code} para invitar`;
    }
    const auto = this.root.querySelector('[data-auto]');
    if (auto)
      auto.textContent =
        l.autoStartIn !== null
          ? `La partida empieza en ${l.autoStartIn} s (las plazas libres las ocupan bots)`
          : '';
    const cfg = this.root.querySelector('.cfgrow');
    cfg?.toggleAttribute('hidden', !host);
    this.root.querySelectorAll<HTMLSelectElement>('select[data-cfg]').forEach((sel) => {
      if (document.activeElement === sel) return;
      const key = sel.dataset.cfg as 'format' | 'level' | 'durationMinutes';
      const v =
        key === 'format' ? l.format : key === 'level' ? l.botLevel : String(l.durationMinutes);
      sel.value = v;
    });
    const start = this.root.querySelector<HTMLButtonElement>('[data-go=start]');
    if (start) {
      start.disabled = !host;
      start.textContent = host ? 'Iniciar partida' : 'Esperando al anfitrión';
    }
  }

  private renderCredits(): void {
    this.render(`
      <h2>Créditos</h2>
      <div class="credits">
        <p><b>Turbo Arena</b> es un juego original inspirado en las mecánicas de un deporte de coches con cohetes.</p>
        <p>Todos los modelos, texturas y efectos se generan por código; no incluye assets de terceros y no usa
        nombres, logos, modelos, texturas, sonidos ni música de Rocket League, Psyonix ni Epic Games.</p>
        <p>Hecho con <b>three.js</b> (MIT), TypeScript y Vite. Física, bots, reglas y audio (WebAudio): propios.</p>
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
        <button class="btn" data-go="settings">Ajustes</button>
        ${this.pauseMode === 'match' ? '<button class="btn" data-go="restart">Reiniciar partida</button>' : ''}
        <button class="btn" data-go="abandon">${this.pauseMode === 'practice' ? 'Salir al menú' : 'Abandonar partida'}</button>
      </div>
      <p class="foot">Esc para continuar</p>`);
    this.on('[data-go=resume]', () => this.cb.resume());
    this.on('[data-go=settings]', () => this.openSettings('pause'));
    this.on('[data-go=restart]', () => this.cb.restart());
    this.on('[data-go=abandon]', () => this.cb.abandon());
  }
}
