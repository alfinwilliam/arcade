// RULES for Drift. Pure: no page, no storage, no timers, no clock, and none of the
// browser's own randomness. Everything random comes from the seeded generator below, so
// the same seed always gives the same picture and the tests can check the maths directly.
//
// The parts, in the order they are used:
//   createRandom(seed)          a repeatable random number generator
//   validatePreset(preset)      checks one entry of presets.js against the allowed ranges
//   particleCount(...)          how many particles fit this canvas size
//   createWorld(...)            the starting state: a flow field plus particles
//   fieldAngle(field, x, y, t)  which way the flow points at one spot
//   step(world, stir)           moves every particle one step along the flow
//
// One difference from the puzzle games: step() changes the world it is given instead of
// returning a copy. It runs 60 times a second for hundreds of particles, and copying
// them all every time would make phones stutter.

// ---------------------------------------------------------------- tunable numbers

export const MAX_PARTICLES = 1200;        // hard cap, whatever the preset or screen size says
export const MIN_PARTICLES = 40;          // a tiny canvas still gets this many
export const REFERENCE_AREA = 960 * 540;  // a preset's `particles` is meant for a canvas this big
export const EDGE_MARGIN = 20;            // how far outside the canvas a particle may be before it restarts

export const STIR_RADIUS = 110;           // how far from the pointer a stir reaches
export const STIR_STRENGTH = 0.3;         // how much of the pointer's movement a particle picks up
export const PUSH_DECAY = 0.95;           // each step a stirred particle keeps this share of its push
export const MAX_PUSH = 10;               // a particle is never pushed faster than this per step

const WAVE_COUNT = 3;                     // the flow field is this many overlapping waves
const FULL_TURN = Math.PI * 2;

// The allowed range [lowest, highest] for every number in a preset.
// validatePreset() reads this table, and presets.js describes the same ranges in words.
export const LIMITS = {
  particles: [20, MAX_PARTICLES],
  speed: [0.2, 4],
  fade: [0, 0.5],
  swirl: [0.0005, 0.05],
  shift: [0, 0.02],
  orbit: [0, 1],
  life: [20, 2000],
  width: [0.5, 4],
};
export const MAX_PALETTE = 6;
export const SNAP_RANGE = [3, 12];        // snap is 0 (off) or a whole number in this range

// ---------------------------------------------------------------- seeded random numbers

// Returns a function that gives the next number from 0 up to (not including) 1.
// The same seed always gives the same list of numbers. (This recipe is known as "mulberry32".)
export function createRandom(seed) {
  let state = seed >>> 0;   // force a whole number between 0 and 2^32 - 1
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- checking a preset

function isHexColour(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isNumberIn(value, [low, high]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

// Returns a list of problems in plain words. An empty list means the preset is fine.
export function validatePreset(preset) {
  const problems = [];
  if (!preset || typeof preset !== 'object') return ['a preset must be an object { ... }'];

  if (typeof preset.id !== 'string' || !/^[a-z0-9-]+$/.test(preset.id)) {
    problems.push('id must be lowercase letters, digits and dashes');
  }
  if (typeof preset.name !== 'string' || preset.name.trim() === '') {
    problems.push('name must be some text');
  }
  if (!isHexColour(preset.background)) {
    problems.push('background must look like "#rrggbb"');
  }

  const palette = preset.palette;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_PALETTE) {
    problems.push(`palette must be a list of 1 to ${MAX_PALETTE} colours`);
  } else if (!palette.every(isHexColour)) {
    problems.push('every palette colour must look like "#rrggbb"');
  }

  for (const [field, range] of Object.entries(LIMITS)) {
    if (!isNumberIn(preset[field], range)) {
      problems.push(`${field} must be a number from ${range[0]} to ${range[1]}`);
    }
  }

  const snapIsOff = preset.snap === 0;
  const snapIsCount = Number.isInteger(preset.snap) && isNumberIn(preset.snap, SNAP_RANGE);
  if (!snapIsOff && !snapIsCount) {
    problems.push(`snap must be 0 or a whole number from ${SNAP_RANGE[0]} to ${SNAP_RANGE[1]}`);
  }
  return problems;
}

// ---------------------------------------------------------------- building a world

// How many particles to use on a canvas of this size. A preset's number is meant for a
// large canvas; a phone-sized canvas gets a proportionally smaller share.
export function particleCount(preset, width, height) {
  const share = (width * height) / REFERENCE_AREA;
  const wanted = Math.round(preset.particles * share);
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, wanted));
}

// The flow field is a few overlapping waves, each running in its own random direction.
// Adding them up gives a smooth, never-repeating pattern of directions.
function createField(preset, width, height, random) {
  const waves = [];
  for (let i = 0; i < WAVE_COUNT; i += 1) {
    const direction = random() * FULL_TURN;
    const frequency = preset.swirl * (i + 1);   // each wave is finer than the one before...
    waves.push({
      kx: Math.cos(direction) * frequency,
      ky: Math.sin(direction) * frequency,
      phase: random() * FULL_TURN,
      strength: 1 / (i + 1),                    // ...and counts for less
      rate: random() * 2 - 1,                   // how fast this wave slides as time passes
    });
  }
  return {
    waves,
    base: random() * FULL_TURN,   // the overall direction everything leans towards
    centreX: width / 2,
    centreY: height / 2,
    shift: preset.shift,
    orbit: preset.orbit,
    snap: preset.snap,
  };
}

// Put a particle at a fresh random spot with a fresh colour and lifetime.
function respawn(world, particle) {
  const { random, preset } = world;
  particle.x = random() * world.width;
  particle.y = random() * world.height;
  particle.prevX = particle.x;   // same as x and y, so no line is drawn across the canvas
  particle.prevY = particle.y;
  particle.pushX = 0;
  particle.pushY = 0;
  particle.age = 0;
  particle.life = Math.round(preset.life * (0.5 + random()));   // half to one and a half times `life`
  particle.colour = Math.floor(random() * preset.palette.length);
}

// The starting state for one picture. `seed` is any whole number.
export function createWorld(preset, width, height, seed) {
  const random = createRandom(seed);
  const world = {
    preset, width, height, seed, random,
    tick: 0,
    field: createField(preset, width, height, random),
    particles: [],
  };
  const count = particleCount(preset, width, height);
  for (let i = 0; i < count; i += 1) {
    const particle = {};
    respawn(world, particle);
    // Start each one part-way through its life, so they do not all restart on the same step.
    particle.age = Math.floor(random() * particle.life);
    world.particles.push(particle);
  }
  return world;
}

// ---------------------------------------------------------------- the flow field

// Which way the flow points at (x, y) on step number `tick`. The answer is an angle in
// radians: 0 points right, a quarter turn (PI / 2) points down the screen.
export function fieldAngle(field, x, y, tick) {
  const time = tick * field.shift;
  let sum = 0;
  for (const wave of field.waves) {
    sum += wave.strength * Math.sin(wave.kx * x + wave.ky * y + wave.phase + wave.rate * time);
  }
  let angle = field.base + sum * Math.PI;

  if (field.orbit > 0) {
    // Blend with "go round the middle": add the two directions as arrows, then read the angle back.
    const around = Math.atan2(y - field.centreY, x - field.centreX) + Math.PI / 2;
    const arrowX = (1 - field.orbit) * Math.cos(angle) + field.orbit * Math.cos(around);
    const arrowY = (1 - field.orbit) * Math.sin(angle) + field.orbit * Math.sin(around);
    angle = Math.atan2(arrowY, arrowX);
  }

  if (field.snap > 0) {
    // Round to the nearest allowed direction.
    const slice = FULL_TURN / field.snap;
    angle = Math.round(angle / slice) * slice;
  }
  return angle;
}

// ---------------------------------------------------------------- one step

// A stir is { x, y, dx, dy }: where the pointer is, and how far it moved since the last step.
function isUsableStir(stir) {
  return Boolean(stir) && [stir.x, stir.y, stir.dx, stir.dy].every(Number.isFinite);
}

// Particles near the pointer pick up some of its movement; nearer ones pick up more.
function applyStir(particle, stir) {
  const distance = Math.hypot(particle.x - stir.x, particle.y - stir.y);
  if (distance >= STIR_RADIUS) return;
  const closeness = 1 - distance / STIR_RADIUS;
  particle.pushX += stir.dx * STIR_STRENGTH * closeness;
  particle.pushY += stir.dy * STIR_STRENGTH * closeness;

  const push = Math.hypot(particle.pushX, particle.pushY);
  if (push > MAX_PUSH) {
    particle.pushX *= MAX_PUSH / push;
    particle.pushY *= MAX_PUSH / push;
  }
}

function isOutside(world, particle) {
  return particle.x < -EDGE_MARGIN || particle.x > world.width + EDGE_MARGIN
    || particle.y < -EDGE_MARGIN || particle.y > world.height + EDGE_MARGIN;
}

// Move every particle one step. Pass a stir while the player is dragging, otherwise null.
// Afterwards each particle's prevX/prevY is where it was and x/y is where it is now, so
// the page draws one short line per particle.
export function step(world, stir) {
  const usableStir = isUsableStir(stir) ? stir : null;
  const speed = world.preset.speed;
  world.tick += 1;

  for (const particle of world.particles) {
    particle.prevX = particle.x;
    particle.prevY = particle.y;
    if (usableStir) applyStir(particle, usableStir);

    const angle = fieldAngle(world.field, particle.x, particle.y, world.tick);
    particle.x += Math.cos(angle) * speed + particle.pushX;
    particle.y += Math.sin(angle) * speed + particle.pushY;
    particle.pushX *= PUSH_DECAY;
    particle.pushY *= PUSH_DECAY;
    particle.age += 1;

    if (particle.age > particle.life || isOutside(world, particle)) respawn(world, particle);
  }
  return world;
}
