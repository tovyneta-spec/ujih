// Constantes de física. Valores medidos por la comunidad; ajústalos aquí hasta lograr el tacto deseado.

export const PHYSICS = {
  /** Frecuencia del paso fijo de simulación. */
  tickRate: 120,
  dt: 1 / 120,
  /** Gravedad (uu/s²), eje z. */
  gravity: -650,
  /** Máx. de pasos de física por frame de render (evita la "espiral de la muerte"). */
  maxStepsPerFrame: 8,
} as const;

export const BALL = {
  radius: 91.25,
  mass: 30,
  maxSpeed: 6000,
  /** rad/s */
  maxAngularSpeed: 6,
  /** Rebote contra el estadio. */
  restitution: 0.6,
  /** Fricción de Coulomb contra superficies (genera giro). */
  friction: 0.35,
  /** Resistencia lineal del aire (1/s). */
  drag: 0.0305,
  /** Inercia de esfera maciza: 0.4·m·r². */
  inertiaFactor: 0.4,
  /** Rebote mínimo: por debajo de esta velocidad normal no hay restitución (evita vibración). */
  restitutionThreshold: 25,
} as const;

/** Interpolación lineal de tablas [x, y] ordenadas por x. */
export type Curve = readonly (readonly [number, number])[];

export const CAR = {
  mass: 180,
  maxSpeed: 2300,
  supersonicSpeed: 2200,
  /** Aceleración del motor a velocidad 0 y velocidad a la que llega a 0. */
  engineAccel: 1600,
  engineAccelZeroAt: 1410,
  brakeAccel: 3500,
  coastDecel: 525,
  /** Umbral de gas para considerar "sin acelerar". */
  throttleDeadzone: 0.01,
  /** Curvatura (1/uu) en función de la velocidad de avance. */
  steerCurvature: [
    [0, 0.0069],
    [500, 0.00398],
    [1000, 0.00235],
    [1500, 0.001375],
    [1750, 0.0011],
    [2300, 0.00088],
  ] as Curve,
  /** Agarre lateral (1/s): tasa de eliminación de la velocidad lateral. */
  lateralGrip: 14,
  /** Agarre lateral con freno de mano (derrape). */
  lateralGripHandbrake: 1.6,
  /** Fuerza que pega el coche a la superficie (uu/s²) cuando hay ≥3 ruedas apoyadas. */
  stickyAccel: 975,
  /** Amortiguación (1/s) de la rotación perpendicular a la superficie con ruedas apoyadas. */
  groundAngularDamping: 10,
  /** Tolerancia (uu) para considerar que una rueda toca la superficie. */
  wheelContactTolerance: 1.5,
  /** Mínimo de ruedas en contacto para estar "en el suelo". */
  groundedWheels: 3,
  /** Rozamiento de Coulomb de la carrocería contra el estadio. */
  bodyFriction: 0.35,
  bodyRestitution: 0.05,

  boost: {
    max: 100,
    start: 33,
    /** Consumo por segundo (≈3 s a tope). */
    useRate: 100 / 3,
    /** Duración mínima de una pulsación (s). */
    minDuration: 0.1,
    accel: 991.667,
  },

  jump: {
    impulse: 292,
    /** Empuje mientras se mantiene el botón (uu/s²). */
    holdAccel: 1458,
    holdTime: 0.2,
    /** Ventana para el segundo salto / flip tras dejar el suelo (s). */
    flipWindow: 1.25,
    /** Impulso del flip (uu/s). */
    flipImpulse: 500,
    /** Impulso del doble salto sin dirección (uu/s). */
    doubleJumpImpulse: 292,
    /** Entrada mínima para considerar que hay dirección de flip. */
    flipDeadzone: 0.5,
    /** Duración del par de giro del flip (s). */
    flipTorqueTime: 0.65,
    /** Velocidad angular objetivo del flip (rad/s). */
    flipSpinRate: 7.6,
    /** Aceleración angular del flip (rad/s²). */
    flipSpinAccel: 70,
    /** Tras saltar, no cuenta como "en el suelo" durante este tiempo (s). */
    groundLock: 0.08,
  },

  air: {
    maxAngularSpeed: 5.5,
    /** Aceleración angular máxima (rad/s²): cabeceo, guiñada, alabeo. */
    pitchAccel: 12.5,
    yawAccel: 9,
    rollAccel: 22,
    /** Amortiguación (1/s) cuando no hay entrada en cada eje. */
    pitchDamping: 3.0,
    yawDamping: 2.4,
    rollDamping: 2.6,
    /** Aceleración con gas en el aire (uu/s²). */
    throttleAccel: 66.7,
  },

  /** Golpe coche-pelota. */
  hit: {
    restitution: 0.2,
    friction: 2.0,
    /** Impulso extra: escala vertical y atenuación de la componente frontal. */
    extraZScale: 0.35,
    extraForwardScale: 0.65,
    maxRelSpeed: 4600,
    /** Factor del impulso extra según la velocidad relativa. */
    extraFactor: [
      [0, 0.65],
      [500, 0.65],
      [2300, 0.55],
      [4600, 0.3],
    ] as Curve,
  },
} as const;

/** Choques coche–coche, empujones y demoliciones. */
export const CAR_CAR = {
  restitution: 0.2,
  /** Zona frontal (uu desde el morro) que cuenta como "embestida". */
  frontZone: 45,
  /** Velocidad de acercamiento mínima para que un empujón añada impulso (uu/s). */
  bumpMinClosing: 300,
  /** Impulso extra al rival en un empujón: fracción de la velocidad de acercamiento + base. */
  bumpFactor: 0.35,
  bumpBase: 100,
  bumpUpward: 0.18,
  /** Tiempo (s) entre empujones del mismo par. */
  bumpCooldown: 0.25,
} as const;

/** Evalúa una curva lineal a tramos, saturada en los extremos. */
export function sampleCurve(curve: Curve, x: number): number {
  const first = curve[0];
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    if (x <= b[0]) {
      const a = curve[i - 1];
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return curve[curve.length - 1][1];
}
