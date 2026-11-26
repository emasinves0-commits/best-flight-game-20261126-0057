// Every tuning number and colour in one place. The world is a volcanic
// archipelago at golden hour: one smoking volcano, two green islands with
// airstrips, sea stacks, a lighthouse rock, and the home base in the south.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size.
export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** World size in metres; sea level is y = 0 and up is +y. North is -z. */
export const WORLD = { size: 3600, half: 1800, seaLevel: 0 };

/** Terrain mesh resolution: GRID x GRID cells across the world. */
export const GRID = 36;

export const PLANE = {
  /** Cruise speed the throttle chases, knots. */
  cruiseSpeed: 118,
  maxSpeed: 165,
  minSpeed: 42,
  /** Knots per second gained or lost toward the throttle target. */
  accel: 26,
  drag: 9,
  /** Degrees per second of bank and pitch at full input. */
  bankRate: 68,
  pitchRate: 34,
  maxBank: 62,
  maxPitch: 26,
  /** Speed below which the wing quits: the nose drops and the sink grows. */
  stallSpeed: 58,
  /** Fuel in percent; a full tank is 100. */
  tank: 100,
  burnPerSecond: 0.34,
  ringFuel: 12,
  /** Damage 0..100; a hard hit ends the flight. */
  crashDamage: 100,
};

export const RINGS = {
  count: 8,
  radius: 30,
  /** Points for threading a ring, before the time bonus. */
  points: 100,
};

export const CONTRACTS = {
  rings: {
    key: '1',
    name: 'RING RUN',
    goal: 'Thread all 8 gold rings, then land back home.',
    rings: 8,
  },
  airmail: {
    key: '2',
    name: 'AIRMAIL',
    goal: 'Land on both island strips to deliver the mail, then come home.',
    rings: 5,
  },
  storm: {
    key: '3',
    name: 'STORM RESCUE',
    goal: 'Reach the lighthouse strip through the squall before the clock runs out.',
    rings: 4,
    timeLimit: 180,
  },
};

export const PALETTE = {
  skyTop: '#2b2a55',
  skyMid: '#7a4a7d',
  skyHorizon: '#ff9a3d',
  sun: '#ffd76a',
  sunGlow: '#ff8c42',
  seaDeep: '#0e3a5c',
  seaShallow: '#2e7f8f',
  sand: '#e8c98a',
  grass: '#4d8a4a',
  jungle: '#2f6b3a',
  rock: '#6e5847',
  volcano: '#4a3a3a',
  crater: '#2b1d1d',
  smoke: '#b8b0a8',
  cloud: '#ffd9b0',
  runway: '#2e3138',
  runwayMark: '#f2f2e8',
  ring: '#ffc233',
  ringNext: '#ffe27a',
  panel: '#0d1420',
  panelEdge: '#2a3a52',
  litAmber: '#ffc857',
  litCyan: '#7de3ff',
  litGreen: '#7dff9a',
  litRed: '#ff5a4e',
  text: '#f4ead8',
  muted: '#b9a98c',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'merapi-airmail.best';
