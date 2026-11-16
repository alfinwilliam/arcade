// Tests for Drift. Drift is a toy, so there are no levels or solutions to replay.
// Instead these check three things:
//   1. every entry in presets.js is inside the allowed ranges,
//   2. the same seed always gives the same picture,
//   3. the particle maths never produces a broken number or a runaway particle.

import { test, assert } from './harness.js';
import { presets } from '../site/games/drift/presets.js';
import {
  createRandom, validatePreset, particleCount, createWorld, fieldAngle, step,
  MAX_PARTICLES, MIN_PARTICLES, EDGE_MARGIN, STIR_RADIUS, MAX_PUSH, LIMITS,
} from '../site/games/drift/logic.js';

const WIDTH = 960;
const HEIGHT = 540;   // 960 x 540 is the large canvas the page uses
const SEED = 12345;
const LONG_RUN = 1000;   // steps, as the spec asks

// A copy of the first preset with some fields replaced: handy for rule cases.
function presetWith(changes) {
  return { ...presets[0], ...changes };
}

// Run a world forward. `stirAt(i)` may return a stir for step i, or null.
function run(world, steps, stirAt) {
  for (let i = 0; i < steps; i += 1) step(world, stirAt ? stirAt(i) : null);
  return world;
}

// A stir that sweeps back and forth across the canvas, hard, on every step.
function roughStir(i) {
  return { x: (i * 37) % WIDTH, y: (i * 23) % HEIGHT, dx: i % 2 ? 80 : -80, dy: i % 3 ? 60 : -60 };
}

// Throws if any particle has a broken number or has escaped the canvas.
function checkParticles(world, when) {
  for (const particle of world.particles) {
    for (const key of ['x', 'y', 'prevX', 'prevY', 'pushX', 'pushY', 'age', 'life', 'colour']) {
      assert.ok(Number.isFinite(particle[key]), `${when}: particle.${key} is not a normal number`);
    }
    assert.ok(particle.x >= -EDGE_MARGIN && particle.x <= world.width + EDGE_MARGIN, `${when}: x out of bounds`);
    assert.ok(particle.y >= -EDGE_MARGIN && particle.y <= world.height + EDGE_MARGIN, `${when}: y out of bounds`);
    assert.ok(Math.hypot(particle.pushX, particle.pushY) <= MAX_PUSH + 1e-9, `${when}: push too large`);
    assert.ok(particle.colour >= 0 && particle.colour < world.preset.palette.length, `${when}: colour not in palette`);
  }
}

// ---------------------------------------------------------------- presets

test('there are presets, and their ids are unique', () => {
  assert.ok(presets.length >= 1);
  const ids = presets.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const preset of presets) {
  test(`${preset.id}: the preset is valid`, () => {
    assert.deepEqual(validatePreset(preset), []);
  });

  test(`${preset.id}: ${LONG_RUN} steps give no broken numbers and stay in bounds`, () => {
    const world = createWorld(preset, WIDTH, HEIGHT, SEED);
    for (let i = 0; i < LONG_RUN; i += 1) {
      step(world, null);
      if (i % 100 === 0) checkParticles(world, `step ${i}`);
    }
    checkParticles(world, 'at the end');
    assert.equal(world.tick, LONG_RUN);
  });

  test(`${preset.id}: ${LONG_RUN} steps of rough stirring stay in bounds too`, () => {
    const world = createWorld(preset, WIDTH, HEIGHT, SEED);
    for (let i = 0; i < LONG_RUN; i += 1) {
      step(world, roughStir(i));
      checkParticles(world, `step ${i}`);
    }
  });

  test(`${preset.id}: the same seed gives the same picture`, () => {
    const first = run(createWorld(preset, WIDTH, HEIGHT, SEED), 200, roughStir);
    const second = run(createWorld(preset, WIDTH, HEIGHT, SEED), 200, roughStir);
    assert.deepEqual(first.particles, second.particles);
  });

  test(`${preset.id}: the flow has a direction everywhere`, () => {
    const world = createWorld(preset, WIDTH, HEIGHT, SEED);
    for (let x = -EDGE_MARGIN; x <= WIDTH + EDGE_MARGIN; x += 49) {
      for (let y = -EDGE_MARGIN; y <= HEIGHT + EDGE_MARGIN; y += 49) {
        assert.ok(Number.isFinite(fieldAngle(world.field, x, y, 500)), `no direction at ${x},${y}`);
      }
    }
    // The exact middle is the awkward spot for `orbit`: there is no "around" there.
    assert.ok(Number.isFinite(fieldAngle(world.field, WIDTH / 2, HEIGHT / 2, 0)));
  });
}

test('a preset with a missing or out-of-range field is rejected, and the message names the field', () => {
  assert.ok(validatePreset(presetWith({ speed: 0 })).join().includes('speed'));
  assert.ok(validatePreset(presetWith({ fade: 2 })).join().includes('fade'));
  assert.ok(validatePreset(presetWith({ particles: MAX_PARTICLES + 1 })).join().includes('particles'));
  assert.ok(validatePreset(presetWith({ swirl: 'fast' })).join().includes('swirl'));
  assert.ok(validatePreset(presetWith({ life: undefined })).join().includes('life'));
  assert.ok(validatePreset(presetWith({ width: NaN })).join().includes('width'));
  assert.ok(validatePreset(presetWith({ id: 'Has Spaces' })).join().includes('id'));
  assert.ok(validatePreset(presetWith({ name: '' })).join().includes('name'));
  assert.ok(validatePreset(null).length > 0);
});

test('colours must be written #rrggbb', () => {
  assert.ok(validatePreset(presetWith({ background: 'navy' })).join().includes('background'));
  assert.ok(validatePreset(presetWith({ background: '#abc' })).join().includes('background'));
  assert.ok(validatePreset(presetWith({ palette: [] })).join().includes('palette'));
  assert.ok(validatePreset(presetWith({ palette: ['#12345g'] })).join().includes('palette'));
  assert.ok(validatePreset(presetWith({ palette: new Array(7).fill('#ffffff') })).join().includes('palette'));
});

test('snap is 0 or a whole number of directions', () => {
  assert.deepEqual(validatePreset(presetWith({ snap: 0 })), []);
  assert.deepEqual(validatePreset(presetWith({ snap: 4 })), []);
  assert.ok(validatePreset(presetWith({ snap: 2 })).join().includes('snap'));
  assert.ok(validatePreset(presetWith({ snap: 4.5 })).join().includes('snap'));
  assert.ok(validatePreset(presetWith({ snap: 99 })).join().includes('snap'));
});

test('the limits table covers every number the header of presets.js describes', () => {
  assert.deepEqual(Object.keys(LIMITS).sort(), ['fade', 'life', 'orbit', 'particles', 'shift', 'speed', 'swirl', 'width']);
});

// ---------------------------------------------------------------- seeded random numbers

test('the same seed gives the same sequence', () => {
  const a = createRandom(SEED);
  const b = createRandom(SEED);
  for (let i = 0; i < 500; i += 1) assert.equal(a(), b());
});

test('different seeds give different sequences', () => {
  const a = createRandom(1);
  const b = createRandom(2);
  const listA = [a(), a(), a(), a()];
  const listB = [b(), b(), b(), b()];
  assert.ok(listA.join() !== listB.join());
});

test('random numbers are from 0 up to, but not including, 1, and are spread out', () => {
  const random = createRandom(7);
  let total = 0;
  for (let i = 0; i < 5000; i += 1) {
    const value = random();
    assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
    total += value;
  }
  const average = total / 5000;
  assert.ok(average > 0.45 && average < 0.55, `average ${average} is not near 0.5`);
});

test('a seed that is not a tidy whole number still works', () => {
  for (const seed of [0, -5, 3.7, 2 ** 40]) {
    const value = createRandom(seed)();
    assert.ok(value >= 0 && value < 1, `seed ${seed} gave ${value}`);
  }
});

// ---------------------------------------------------------------- building a world

test('a different seed gives a different picture', () => {
  const first = createWorld(presets[0], WIDTH, HEIGHT, 1);
  const second = createWorld(presets[0], WIDTH, HEIGHT, 2);
  assert.ok(first.particles[0].x !== second.particles[0].x);
  assert.ok(fieldAngle(first.field, 100, 100, 0) !== fieldAngle(second.field, 100, 100, 0));
});

test('a large canvas gets the number of particles the preset asks for', () => {
  assert.equal(particleCount(presetWith({ particles: 600 }), WIDTH, HEIGHT), 600);
  assert.equal(createWorld(presetWith({ particles: 600 }), WIDTH, HEIGHT, SEED).particles.length, 600);
});

test('a phone-sized canvas gets fewer particles', () => {
  // 400 x 500 is the canvas the page uses on narrow screens: about two fifths of the area.
  const count = particleCount(presetWith({ particles: 600 }), 400, 500);
  assert.equal(count, 231);
});

test('the particle count is capped, however big the canvas', () => {
  assert.equal(particleCount(presetWith({ particles: MAX_PARTICLES }), 4000, 3000), MAX_PARTICLES);
});

test('a tiny canvas still gets a few particles', () => {
  assert.equal(particleCount(presetWith({ particles: 20 }), 100, 100), MIN_PARTICLES);
});

test('particles start inside the canvas', () => {
  const world = createWorld(presets[0], 300, 200, SEED);
  for (const particle of world.particles) {
    assert.ok(particle.x >= 0 && particle.x <= 300 && particle.y >= 0 && particle.y <= 200);
  }
});

// ---------------------------------------------------------------- the flow and the step

test('with snap 4 the flow only points along the four compass directions', () => {
  const world = createWorld(presetWith({ snap: 4 }), WIDTH, HEIGHT, SEED);
  for (let x = 0; x < WIDTH; x += 61) {
    const quarterTurns = fieldAngle(world.field, x, x / 2, 0) / (Math.PI / 2);
    assert.ok(Math.abs(quarterTurns - Math.round(quarterTurns)) < 1e-9, `angle at x=${x} is not a quarter turn`);
  }
});

test('with orbit 1 the flow circles the middle', () => {
  const world = createWorld(presetWith({ orbit: 1 }), WIDTH, HEIGHT, SEED);
  // Directly right of the middle, "around" means straight down the screen: a quarter turn.
  const angle = fieldAngle(world.field, WIDTH / 2 + 100, HEIGHT / 2, 0);
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-9, `got ${angle}`);
});

test('with shift 0 the flow never changes; with shift above 0 it does', () => {
  const frozen = createWorld(presetWith({ shift: 0 }), WIDTH, HEIGHT, SEED);
  assert.equal(fieldAngle(frozen.field, 200, 150, 0), fieldAngle(frozen.field, 200, 150, 900));
  const moving = createWorld(presetWith({ shift: 0.01 }), WIDTH, HEIGHT, SEED);
  assert.ok(fieldAngle(moving.field, 200, 150, 0) !== fieldAngle(moving.field, 200, 150, 900));
});

test('an unstirred particle moves exactly `speed` per step', () => {
  const preset = presetWith({ speed: 2, life: 2000 });
  const world = createWorld(preset, WIDTH, HEIGHT, SEED);
  step(world, null);
  const moved = world.particles.filter((p) => p.age > 0);   // age 0 means it just restarted
  assert.ok(moved.length > 0);
  for (const particle of moved) {
    const distance = Math.hypot(particle.x - particle.prevX, particle.y - particle.prevY);
    assert.ok(Math.abs(distance - 2) < 1e-9, `moved ${distance}`);
  }
});

test('a particle that restarts draws no line across the canvas', () => {
  const world = createWorld(presetWith({ life: 20 }), WIDTH, HEIGHT, SEED);
  for (let i = 0; i < 100; i += 1) {
    step(world, null);
    for (const particle of world.particles) {
      const distance = Math.hypot(particle.x - particle.prevX, particle.y - particle.prevY);
      assert.ok(distance <= world.preset.speed + 1e-9, `a ${distance} long jump on step ${i}`);
    }
  }
});

test('stirring pushes particles near the pointer and leaves far ones alone', () => {
  const world = createWorld(presetWith({ life: 2000 }), WIDTH, HEIGHT, SEED);
  const stir = { x: 200, y: 200, dx: 30, dy: 0 };
  const near = world.particles.filter((p) => Math.hypot(p.x - stir.x, p.y - stir.y) < STIR_RADIUS / 2);
  const far = world.particles.filter((p) => Math.hypot(p.x - stir.x, p.y - stir.y) > STIR_RADIUS);
  assert.ok(near.length > 0 && far.length > 0);
  for (const particle of near) particle.age = 0;   // make sure none of them is about to restart
  for (const particle of far) particle.age = 0;
  step(world, stir);
  for (const particle of near) assert.ok(particle.pushX > 0, 'a near particle was not pushed');
  for (const particle of far) assert.equal(particle.pushX, 0, 'a far particle was pushed');
});

test('a push dies away once the stirring stops', () => {
  const world = createWorld(presetWith({ life: 2000 }), WIDTH, HEIGHT, SEED);
  step(world, { x: 480, y: 300, dx: 50, dy: 50 });
  const strongest = () => Math.max(...world.particles.map((p) => Math.hypot(p.pushX, p.pushY)));
  const before = strongest();
  run(world, 200);
  assert.ok(before > 0.5);
  assert.ok(strongest() < 0.01, `still pushing at ${strongest()}`);
});

test('a broken stir is ignored instead of spreading broken numbers', () => {
  const world = createWorld(presets[0], WIDTH, HEIGHT, SEED);
  step(world, { x: NaN, y: 10, dx: 5, dy: 5 });
  step(world, { x: 10, y: 10, dx: Infinity, dy: 0 });
  step(world, {});
  checkParticles(world, 'after broken stirs');
});

test('stirring changes the picture, but only through the stir', () => {
  const calm = run(createWorld(presets[0], WIDTH, HEIGHT, SEED), 50);
  const stirred = run(createWorld(presets[0], WIDTH, HEIGHT, SEED), 50, roughStir);
  let different = 0;
  for (let i = 0; i < calm.particles.length; i += 1) {
    if (calm.particles[i].x !== stirred.particles[i].x) different += 1;
  }
  assert.ok(different > 0);
});
