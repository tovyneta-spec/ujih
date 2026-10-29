// Gestor de bots: predicción compartida, intercepciones, asignación de roles y rotación, chat rápido.
import { BOT_PROFILES } from '../../config';
import type { BotLevel } from '../../config';
import type { Car } from '../car';
import { Vec3 } from '../math';
import { Rng } from '../rng';
import type { SimEvent, World } from '../world';
import { Bot } from './bot';
import type { BotContext, Intercept, Role } from './bot';
import { bearing } from './control';
import { BallPredictor } from './prediction';

const tmp = new Vec3();

export class BotManager {
  readonly bots: Bot[] = [];
  private predictor = new BallPredictor();
  private lastPredictTick = -100;
  private intercepts = new Map<number, Intercept>();
  private roles = new Map<number, Role>();
  private ctx: BotContext;
  private lastChat = new Map<number, number>();

  constructor(
    private readonly world: World,
    private readonly seed = 777,
  ) {
    this.ctx = {
      world,
      predictor: this.predictor,
      role: 'attack',
      intercept: { t: 1, pos: new Vec3() },
      teammates: [],
      enemies: [],
      kickoffTaker: false,
    };
  }

  /** Controla el coche `carId` con un bot del nivel dado. */
  add(carId: number, level: BotLevel): Bot {
    const bot = new Bot(
      this.world.cars[carId],
      BOT_PROFILES[level],
      new Rng(this.seed + carId * 7919),
    );
    this.bots.push(bot);
    this.intercepts.set(carId, { t: 1, pos: new Vec3() });
    this.roles.set(carId, 'attack');
    return bot;
  }

  isBot(carId: number): boolean {
    return this.bots.some((b) => b.car.id === carId);
  }

  /** Tiempo estimado (s) que tarda un coche en llegar a un punto. */
  private eta(car: Car, p: Vec3): number {
    const dist = Math.hypot(p.x - car.pos.x, p.y - car.pos.y);
    const turn = Math.abs(bearing(car, p));
    const speed = car.boost > 10 ? 1750 : 1300;
    const v0 = Math.max(0, car.forwardSpeed);
    return dist / (speed * 0.5 + v0 * 0.5 + 200) + turn * 0.3;
  }

  /** Primer punto de la trayectoria de la pelota al que el coche puede llegar a tiempo. */
  private computeIntercept(car: Car, out: Intercept): void {
    const samples = this.predictor.samples;
    const offset = this.world.time - this.predictor.time;
    for (let k = 0; k < samples.length; k++) {
      const s = samples[k];
      const t = s.t - offset;
      if (t < 0.05) continue;
      if (this.eta(car, s.pos) <= t) {
        out.t = t;
        out.pos.copy(s.pos);
        return;
      }
    }
    const last = samples[samples.length - 1];
    out.t = last.t - offset;
    out.pos.copy(last.pos);
  }

  update(): void {
    const world = this.world;
    // Predicción compartida (20 Hz).
    if (world.tick - this.lastPredictTick >= 6) {
      this.predictor.predict(world.ball, world.time);
      this.lastPredictTick = world.tick;
    }
    for (const bot of this.bots)
      this.computeIntercept(bot.car, this.intercepts.get(bot.car.id) as Intercept);
    this.assignRoles();

    for (const bot of this.bots) {
      const car = bot.car;
      const mates = world.cars.filter((c) => c.team === car.team);
      const foes = world.cars.filter((c) => c.team !== car.team);
      const ctx = this.ctx;
      ctx.role = this.roles.get(car.id) ?? 'attack';
      ctx.intercept = this.intercepts.get(car.id) as Intercept;
      ctx.teammates = mates;
      ctx.enemies = foes;
      ctx.kickoffTaker = this.isKickoffTaker(car, mates);
      const input = bot.update(ctx);
      world.setInput(car.id, input);
      this.maybeChat(bot, ctx.role);
    }
  }

  private isKickoffTaker(car: Car, mates: readonly Car[]): boolean {
    const ball = this.world.ball.pos;
    let best = car;
    let bd = Infinity;
    for (const m of mates) {
      const d = Math.hypot(m.pos.x - ball.x, m.pos.y - ball.y);
      if (d < bd - 1) {
        bd = d;
        best = m;
      }
    }
    return best.id === car.id;
  }

  /** Atacante = el que antes llega a la pelota (con histéresis); el más retrasado defiende. */
  private assignRoles(): void {
    const world = this.world;
    // Un coche demolido no ocupa el rol de atacante mientras reaparece.
    for (const c of world.cars) if (c.demolished) this.roles.set(c.id, 'support');
    for (const team of [0, 1] as const) {
      const cars = world.cars.filter((c) => c.team === team && !c.demolished);
      if (cars.length === 0) continue;
      const bots = cars.filter((c) => this.isBot(c.id));
      if (bots.length === 0) continue;
      const ownY = team === 0 ? -1 : 1;
      const t = (c: Car): number => this.intercepts.get(c.id)?.t ?? this.humanEta(c);

      // Rival más rápido a la pelota.
      let enemyBest = Infinity;
      for (const e of world.cars)
        if (e.team !== team && !e.demolished) enemyBest = Math.min(enemyBest, this.humanEta(e));

      const sorted = [...cars].sort((a, b) => t(a) - t(b));
      let attacker = sorted[0];
      // Histéresis: el atacante actual conserva el rol si no es mucho más lento.
      const current = cars.find((c) => this.roles.get(c.id) === 'attack' && this.isBot(c.id));
      const rotates = current ? this.botOf(current.id)?.profile.rotates !== false : true;
      if (current && t(current) <= t(attacker) + (rotates ? 0.3 : 1.2)) attacker = current;

      if (cars.length === 1) {
        // 1v1: ataca si llega antes (o casi) que el rival; si no, vigila la portería.
        this.roles.set(attacker.id, t(attacker) <= enemyBest + 0.5 ? 'attack' : 'defend');
        continue;
      }
      this.roles.set(attacker.id, 'attack');
      const rest = cars.filter((c) => c.id !== attacker.id);
      // El más cercano a la portería propia es el último hombre.
      rest.sort((a, b) => a.pos.y * ownY - b.pos.y * ownY);
      rest.forEach((c, i) => this.roles.set(c.id, i === rest.length - 1 ? 'defend' : 'support'));
      // (orden ascendente por profundidad hacia su propia portería: el último es el más retrasado)
    }
  }

  private botOf(id: number): Bot | undefined {
    return this.bots.find((b) => b.car.id === id);
  }

  private humanEta(c: Car): number {
    const ball = this.world.ball.pos;
    tmp.set(ball.x, ball.y, ball.z);
    return this.eta(c, tmp);
  }

  private maybeChat(bot: Bot, role: Role): void {
    const world = this.world;
    if (!bot.consumeRoleChange(role, world.time)) return;
    const last = this.lastChat.get(bot.car.id) ?? -10;
    if (world.time - last < 6) return;
    const text = role === 'attack' ? '¡La tengo!' : role === 'defend' ? '¡Defendiendo!' : null;
    if (!text) return;
    // Sólo habla si hay compañeros a quienes avisar.
    if (!world.cars.some((c) => c.team === bot.car.team && c.id !== bot.car.id)) return;
    this.lastChat.set(bot.car.id, world.time);
    world.emit({ type: 'chat', carId: bot.car.id, text });
  }

  /** Reacciones sociales a los eventos de partida (se llama con los eventos ya drenados). */
  onEvent(e: SimEvent): void {
    const world = this.world;
    if (e.type === 'matchGoal') {
      const mates = this.bots.filter((b) => b.car.team === e.team);
      const bot = mates.find((b) => b.car.id !== e.scorerId) ?? mates[0];
      if (bot && !this.lastChat.has(-1 - bot.car.id)) {
        world.emit({
          type: 'chat',
          carId: bot.car.id,
          text: e.assistId === bot.car.id ? '¡Gracias!' : '¡Buen tiro!',
        });
      }
    }
  }
}
