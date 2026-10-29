// Audio 100 % sintetizado con WebAudio (sin archivos): motor, turbo, impactos, demolición, pads,
// cuenta atrás, bocina y ovación de gol, ambiente de público y sonidos de UI.
import { DEFAULT_AUDIO, saveAudio } from '../storage';
import type { AudioSettings } from '../storage';
import type { Car, SimEvent, World } from '../sim';
import { distanceGain, engineFrequency, panFor } from './dsp';

interface CarVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  engineGain: GainNode;
  filter: BiquadFilterNode;
  boostSrc: AudioBufferSourceNode;
  boostGain: GainNode;
  pan: StereoPannerNode;
}

/** Oyente: posición y eje derecho en coordenadas de la simulación. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private voices = new Map<number, CarVoice>();
  private crowdGain!: GainNode;
  private crowdLevel = 0.05;
  settings: AudioSettings;

  constructor(initial: AudioSettings = DEFAULT_AUDIO) {
    this.settings = { ...initial };
  }

  /** Crea/reanuda el contexto tras una interacción del usuario (política de autoplay). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setSettings(s: AudioSettings): void {
    this.settings = { ...s };
    saveAudio(this.settings);
    this.applyVolumes();
  }

  private build(): void {
    const ctx = this.ctx as AudioContext;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyVolumes();

    // Ruido blanco reutilizable.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Ambiente de público.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.5;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain).connect(this.sfx);
    src.start();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master, t, 0.03);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.03);
  }

  // ------------------------------------------------------------ utilidades

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when = 0,
    to?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(
    dur: number,
    gain: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    when = 0,
    q = 0.7,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- eventos

  /** Sonidos de interfaz. */
  ui(kind: 'click' | 'hover' | 'back'): void {
    if (!this.ready) return;
    if (kind === 'hover') this.tone(660, 0.04, 'sine', 0.05);
    else if (kind === 'back') this.tone(420, 0.09, 'triangle', 0.12, 0, 300);
    else {
      this.tone(520, 0.07, 'triangle', 0.14);
      this.tone(780, 0.09, 'triangle', 0.1, 0.05);
    }
  }

  onEvent(e: SimEvent, world: World, listener: Listener): void {
    if (!this.ready) return;
    const near = (x: number, y: number, z: number): number =>
      distanceGain(Math.hypot(x - listener.x, y - listener.y, z - listener.z), 9000);
    switch (e.type) {
      case 'ballTouch': {
        const b = world.ball.pos;
        const k = Math.min(1, e.relSpeed / 2800) * Math.max(0.35, near(b.x, b.y, b.z) * 2);
        this.burst(0.14, 0.25 + 0.5 * k, 'highpass', 1800, 700, 0, 0.8);
        this.tone(150, 0.2, 'sine', 0.2 + 0.55 * k, 0, 48);
        break;
      }
      case 'ballBounce': {
        const k = Math.min(1, e.speed / 2500) * Math.max(0.3, near(e.x, e.y, e.z) * 2);
        this.burst(0.16, 0.08 + 0.35 * k, 'lowpass', 900, 200);
        this.tone(95, 0.18, 'sine', 0.1 + 0.3 * k, 0, 40);
        break;
      }
      case 'wallHit': {
        const c = world.cars[e.carId];
        const k = Math.min(1, e.speed / 2200) * Math.max(0.25, near(c.pos.x, c.pos.y, c.pos.z) * 2);
        this.burst(0.2, 0.1 + 0.4 * k, 'lowpass', 600, 120);
        break;
      }
      case 'bump':
        this.tone(520, 0.1, 'square', 0.1, 0, 400);
        this.tone(780, 0.08, 'square', 0.07, 0.01, 600);
        this.burst(0.1, 0.25, 'bandpass', 2000, 800);
        break;
      case 'jump':
        this.tone(260, 0.12, 'triangle', 0.1, 0, 520);
        break;
      case 'flip':
        this.burst(0.22, 0.15, 'bandpass', 500, 2500, 0, 1.2);
        this.tone(340, 0.16, 'triangle', 0.08, 0, 700);
        break;
      case 'padPickup': {
        const p = world.pads[e.padIndex];
        const mine = e.carId === (world.cars[0]?.id ?? -1);
        const g = mine ? 1 : Math.max(0.15, near(p.spec.x, p.spec.y, 0) * 1.5);
        if (p.spec.size === 'big') {
          this.tone(440, 0.28, 'sine', 0.22 * g, 0);
          this.tone(660, 0.28, 'sine', 0.18 * g, 0.05);
          this.tone(880, 0.35, 'sine', 0.14 * g, 0.1);
        } else {
          this.tone(880, 0.1, 'sine', 0.14 * g);
          this.tone(1320, 0.12, 'sine', 0.1 * g, 0.05);
        }
        break;
      }
      case 'demolition': {
        const c = world.cars[e.victimId];
        const g = Math.max(0.4, near(c.pos.x, c.pos.y, c.pos.z) * 2);
        this.burst(0.9, 0.7 * g, 'lowpass', 2600, 90);
        this.tone(110, 0.7, 'sine', 0.5 * g, 0, 30);
        this.burst(0.35, 0.3 * g, 'highpass', 3500, 1200, 0.04);
        break;
      }
      case 'respawn':
        this.burst(0.4, 0.15, 'bandpass', 300, 1800, 0, 1.5);
        break;
      case 'countdown':
        this.tone(e.n === 1 ? 560 : 480, 0.16, 'triangle', 0.3);
        break;
      case 'go':
        this.tone(880, 0.5, 'triangle', 0.35);
        this.tone(1320, 0.5, 'sine', 0.15);
        break;
      case 'matchGoal':
        // Bocina de dos tonos con vibrato y ovación del público.
        this.horn();
        this.cheer(1);
        break;
      case 'overtime':
        this.tone(660, 0.5, 'triangle', 0.3);
        this.tone(990, 0.6, 'triangle', 0.25, 0.25);
        break;
      case 'matchEnd':
        this.tone(440, 0.25, 'sawtooth', 0.2);
        this.tone(440, 0.25, 'sawtooth', 0.2, 0.3);
        this.tone(660, 0.8, 'sawtooth', 0.22, 0.6);
        this.cheer(0.7);
        break;
      case 'chat':
        this.tone(740, 0.07, 'sine', 0.1);
        break;
      default:
        break;
    }
  }

  private horn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const f of [233, 311, 466]) {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      lfo.frequency.value = 5.5;
      lg.gain.value = 3;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.setValueAtTime(0.12, t + 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      o.connect(lp).connect(g).connect(this.sfx);
      o.start(t);
      lfo.start(t);
      o.stop(t + 1.7);
      lfo.stop(t + 1.7);
    }
  }

  private cheer(level: number): void {
    this.crowdLevel = 0.05 + 0.3 * level;
  }

  // ---------------------------------------------------------------- por frame

  /** Motores, turbo y ambiente. Llamar una vez por frame. */
  update(world: World, listener: Listener, active: boolean, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;

    // Ambiente de público: decae hacia el nivel base.
    this.crowdLevel += (0.05 - this.crowdLevel) * Math.min(1, dt * 0.45);
    this.crowdGain.gain.setTargetAtTime(active ? this.crowdLevel : 0.02, t, 0.2);

    for (const car of world.cars) {
      let v = this.voices.get(car.id);
      if (!v) {
        v = this.createVoice();
        this.voices.set(car.id, v);
      }
      const mine = car.id === (world.cars[0]?.id ?? 0);
      const dist = Math.hypot(
        car.pos.x - listener.x,
        car.pos.y - listener.y,
        car.pos.z - listener.z,
      );
      const vol = active && !car.demolished ? (mine ? 1 : distanceGain(dist)) : 0;
      this.updateVoice(v, car, vol, listener, t);
    }
  }

  private createVoice(): CarVoice {
    const ctx = this.ctx as AudioContext;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(engineGain).connect(pan).connect(this.sfx);
    osc1.start();
    osc2.start();

    const boostSrc = ctx.createBufferSource();
    boostSrc.buffer = this.noise;
    boostSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const boostGain = ctx.createGain();
    boostGain.gain.value = 0;
    boostSrc.connect(bp).connect(boostGain).connect(pan);
    boostSrc.start();
    return { osc1, osc2, engineGain, filter, boostSrc, boostGain, pan };
  }

  private updateVoice(v: CarVoice, car: Car, vol: number, l: Listener, t: number): void {
    const f = engineFrequency(car.speed);
    const throttle = Math.abs(car.input.throttle);
    v.osc1.frequency.setTargetAtTime(f, t, 0.05);
    v.osc2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    v.filter.frequency.setTargetAtTime(380 + car.speed * 0.45 + throttle * 250, t, 0.06);
    v.engineGain.gain.setTargetAtTime(vol * (0.045 + 0.05 * throttle + car.speed / 55000), t, 0.05);
    v.boostGain.gain.setTargetAtTime(car.boosting ? vol * 0.16 : 0, t, 0.04);
    v.pan.pan.setTargetAtTime(
      panFor(car.pos.x - l.x, car.pos.y - l.y, car.pos.z - l.z, l.rx, l.ry, l.rz),
      t,
      0.05,
    );
  }

  /** Silencia los motores (menús, pausa). */
  silenceCars(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices.values()) {
      v.engineGain.gain.setTargetAtTime(0, t, 0.05);
      v.boostGain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  /** Elimina las voces de un mundo anterior. */
  resetVoices(): void {
    for (const v of this.voices.values()) {
      v.osc1.stop();
      v.osc2.stop();
      v.boostSrc.stop();
      v.pan.disconnect();
    }
    this.voices.clear();
  }
}
