// Tests for Sling Orbit.
// The important part is the loop over the levels: each level's `solution` is flown through
// the real rules and must win, and so must every launch close to it and every brake tap a
// little early or late. A level that only works with a pixel-perfect launch fails here.

import { test, assert } from './harness.js';
import { levels } from '../site/games/sling-orbit/levels.js';
import {
  FIELD, LAUNCH_SLACK, BRAKE_SLACK,
  start, launch, brake, step, replay, clampLaunch, margin, tryLaunch, findForgivingLaunch,
} from '../site/games/sling-orbit/logic.js';

// ------------------------------------------------------------------ helpers

// A level to test one rule with. Pass only the fields the test cares about.
function makeLevel(fields) {
  return {
    id: 'x', title: 'x', hint: 'x', start: [300, 300], aim: [0, 0], maxSpeed: 320, maxTicks: 600,
    bodies: [], goals: [{ type: 'zone', at: [50, 50], r: 10 }], brake: { taps: 0, dv: 34 },
    solution: { launch: [0, 0], brakes: [] },
    ...fields,
  };
}

function stepTimes(state, count) {
  let s = state;
  for (let i = 0; i < count; i += 1) s = step(s);
  return s;
}

function speedOf(state) {
  return Math.sqrt(state.vx * state.vx + state.vy * state.vy);
}

function distanceFrom(state, point) {
  const dx = state.x - point[0];
  const dy = state.y - point[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// One heavy planet in the middle with the ship 240 units to its left: the layout the
// level examples were first worked out on. A launch of [0, -100] is a perfect circle here.
const PLANET = { at: [300, 300], r: 36, gm: 2400000 };
const zoneExample = makeLevel({
  start: [60, 300], maxTicks: 2400, bodies: [PLANET],
  goals: [{ type: 'zone', at: [540, 300], r: 28 }],
});
const ringExample = makeLevel({
  start: [60, 300], maxTicks: 2400, bodies: [PLANET],
  goals: [{ type: 'ring', body: 0, rMin: 70, rMax: 110, ticks: 600 }],
  brake: { taps: 1, dv: 34 },
});

// --------------------------------------------- the two worked examples (first!)
// If these two fail, the integrator in logic.js has changed and every level's
// solution needs to be searched for again.

test('worked example: the zone behind the planet is reached by [300, 100]', () => {
  assert.equal(replay(zoneExample, { launch: [300, 100], brakes: [] }).status, 'won');
});

test('worked example: every launch within +-8 of [300, 100] also wins', () => {
  for (let dx = -8; dx <= 8; dx += 1) {
    for (let dy = -8; dy <= 8; dy += 1) {
      const end = replay(zoneExample, { launch: [300 + dx, 100 + dy], brakes: [] });
      assert.equal(end.status, 'won', `launch [${300 + dx}, ${100 + dy}]`);
    }
  }
});

test('worked example: [0, -74] with one brake at tick 516 parks in the ring', () => {
  assert.equal(replay(ringExample, { launch: [0, -74], brakes: [516] }).status, 'won');
});

test('worked example: the same launch without the brake does not park', () => {
  assert.equal(replay(ringExample, { launch: [0, -74], brakes: [] }).status, 'lost');
});

// ------------------------------------------------------------------ the levels

test('level ids are unique and start with so-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('so-')));
});

for (const level of levels) {
  const { solution } = level;

  test(`${level.id}: has a title, a hint and at least one goal`, () => {
    assert.ok(level.title.length > 0 && level.hint.length > 0);
    assert.ok(level.goals.length > 0);
    assert.ok(level.maxSpeed > 0 && level.maxTicks > 0);
  });

  test(`${level.id}: everything is inside the field and nothing starts inside a planet`, () => {
    const inside = ([x, y]) => x >= 0 && x <= FIELD && y >= 0 && y <= FIELD;
    assert.ok(inside(level.start), 'start');
    for (const body of level.bodies) {
      assert.ok(inside(body.at), 'body');
      assert.ok(distanceFrom({ x: level.start[0], y: level.start[1] }, body.at) > body.r, 'start is inside a body');
    }
    for (const goal of level.goals) {
      if (goal.type === 'zone') assert.ok(inside(goal.at), 'zone');
      else if (goal.type === 'ring') assert.ok(level.bodies[goal.body] && goal.rMin < goal.rMax, 'ring');
      else assert.ok(false, `unknown goal type ${goal.type}`);
    }
  });

  test(`${level.id}: the solution wins`, () => {
    assert.equal(replay(level, solution).status, 'won');
  });

  test(`${level.id}: the solution is a legal input`, () => {
    assert.deepEqual(clampLaunch(level, solution.launch), solution.launch, 'whole numbers, within maxSpeed');
    assert.ok(solution.brakes.length <= level.brake.taps, 'no more brakes than the level allows');
    assert.ok(solution.brakes.every((tick) => Number.isInteger(tick) && tick >= 0));
  });

  test(`${level.id}: not launching does not win`, () => {
    assert.equal(replay(level, { launch: null, brakes: [] }).status, 'playing');
    assert.equal(replay(level, null).status, 'playing');
  });

  test(`${level.id}: the opening aim does not win`, () => {
    assert.equal(replay(level, { launch: level.aim, brakes: [] }).status, 'lost');
  });

  test(`${level.id}: a feeble launch does not win`, () => {
    assert.equal(replay(level, { launch: [1, 0], brakes: solution.brakes }).status, 'lost');
  });

  test(`${level.id}: every launch within +-${LAUNCH_SLACK} of the solution wins`, () => {
    for (let dx = -LAUNCH_SLACK; dx <= LAUNCH_SLACK; dx += 1) {
      for (let dy = -LAUNCH_SLACK; dy <= LAUNCH_SLACK; dy += 1) {
        const near = [solution.launch[0] + dx, solution.launch[1] + dy];
        assert.equal(replay(level, { launch: near, brakes: solution.brakes }).status, 'won', `launch [${near}]`);
      }
    }
  });

  if (solution.brakes.length > 0) {
    test(`${level.id}: brakes up to ${BRAKE_SLACK} ticks early or late still win`, () => {
      for (let shift = -BRAKE_SLACK; shift <= BRAKE_SLACK; shift += 1) {
        // all the taps moved together ...
        const together = solution.brakes.map((tick) => tick + shift);
        assert.equal(replay(level, { launch: solution.launch, brakes: together }).status, 'won', `all taps ${shift}`);
        // ... and each tap moved on its own
        solution.brakes.forEach((_, i) => {
          const alone = solution.brakes.map((tick, j) => (j === i ? tick + shift : tick));
          assert.equal(replay(level, { launch: solution.launch, brakes: alone }).status, 'won', `tap ${i + 1} ${shift}`);
        });
      }
    });

    test(`${level.id}: the brakes are needed`, () => {
      assert.equal(replay(level, { launch: solution.launch, brakes: [] }).status, 'lost');
    });
  }
}

// ------------------------------------------------------------------- physics

test('a circular orbit holds its radius within 1% over 5,000 steps', () => {
  // Circular speed is sqrt(gm / radius) = sqrt(2400000 / 240) = 100.
  const level = makeLevel({ start: [60, 300], maxTicks: 6000, bodies: [PLANET] });
  let s = launch(start(level), [0, -100]);
  for (let i = 0; i < 5000; i += 1) {
    s = step(s);
    const radius = distanceFrom(s, PLANET.at);
    assert.ok(radius > 240 * 0.99 && radius < 240 * 1.01, `radius ${radius} at tick ${s.tick}`);
  }
  assert.equal(s.status, 'playing');
  assert.equal(s.tick, 5000);
});

test('with no planets the ship flies in a straight line at a steady speed', () => {
  const level = makeLevel({ start: [100, 300] });
  const s = stepTimes(launch(start(level), [120, 0]), 120);   // 120 ticks = one second
  assert.ok(Math.abs(s.x - 220) < 1e-6, `x is ${s.x}`);
  assert.equal(s.y, 300);
});

test('the same inputs always give exactly the same flight', () => {
  const level = levels[levels.length - 1];
  assert.deepEqual(replay(level, level.solution), replay(level, level.solution));
});

test('stepping one tick at a time matches replay', () => {
  const level = levels[0];
  let s = launch(start(level), level.solution.launch);
  while (s.status === 'playing') s = step(s);
  assert.deepEqual(s, replay(level, level.solution));
});

// ------------------------------------------------------------- winning, losing

test('touching a zone wins', () => {
  const level = makeLevel({ start: [100, 300], goals: [{ type: 'zone', at: [220, 300], r: 10 }] });
  const end = replay(level, { launch: [120, 0], brakes: [] });
  assert.equal(end.status, 'won');
  assert.ok(end.tick >= 109 && end.tick <= 111, `won at tick ${end.tick}`);
});

test('every zone must be touched, not just one', () => {
  const level = makeLevel({ start: [100, 300], goals: [
    { type: 'zone', at: [220, 300], r: 10 },
    { type: 'zone', at: [220, 100], r: 10 },
  ] });
  const end = replay(level, { launch: [120, 0], brakes: [] });
  assert.equal(end.status, 'lost');
  assert.deepEqual(end.done, [true, false]);
});

test('hitting a planet loses, with the reason "crashed"', () => {
  const level = makeLevel({ start: [60, 300], bodies: [PLANET] });
  const end = replay(level, { launch: [200, 0], brakes: [] });
  assert.equal(end.status, 'lost');
  assert.equal(end.reason, 'crashed');
});

test('flying out of the field loses, with the reason "left"', () => {
  const end = replay(makeLevel({}), { launch: [0, 300], brakes: [] });
  assert.equal(end.status, 'lost');
  assert.equal(end.reason, 'left');
});

test('running out of time loses, with the reason "time"', () => {
  const end = replay(makeLevel({ maxTicks: 50 }), { launch: [1, 0], brakes: [] });
  assert.equal(end.status, 'lost');
  assert.equal(end.reason, 'time');
  assert.equal(end.tick, 50);
});

test('a ring is won after exactly its number of ticks inside the band', () => {
  const level = makeLevel({ start: [60, 300], maxTicks: 2400, bodies: [PLANET],
    goals: [{ type: 'ring', body: 0, rMin: 230, rMax: 250, ticks: 300 }] });
  const end = replay(level, { launch: [0, -100], brakes: [] });
  assert.equal(end.status, 'won');
  assert.equal(end.tick, 300);
});

test('leaving the band sets the ring count back to zero', () => {
  let s = launch(start(ringExample), [0, -74]);   // dips through the band and out again
  let most = 0;
  for (let i = 0; i < 700; i += 1) {
    s = step(s);
    most = Math.max(most, s.held[0]);
  }
  assert.ok(most > 50 && most < 600, `longest stay was ${most} ticks`);
  assert.equal(s.held[0], 0);
  assert.equal(s.status, 'playing');
});

// --------------------------------------------------------------------- inputs

test('a launch is rounded to whole numbers and shortened to maxSpeed', () => {
  const level = makeLevel({ maxSpeed: 100 });
  assert.deepEqual(clampLaunch(level, [10.4, -20.6]), [10, -21]);
  assert.deepEqual(clampLaunch(level, [300, 400]), [60, 80]);
  const fast = clampLaunch(level, [-999, 5]);
  assert.ok(fast[0] * fast[0] + fast[1] * fast[1] <= 100 * 100);
});

test('only the first launch counts', () => {
  const once = launch(start(makeLevel({})), [50, 0]);
  assert.deepEqual(launch(once, [0, 99]), once);
  assert.deepEqual(once.launch, [50, 0]);
});

test('time does not pass before the launch', () => {
  const waiting = start(makeLevel({}));
  assert.deepEqual(step(waiting), waiting);
  assert.deepEqual(brake(waiting), waiting);
});

test('a brake takes dv off the speed and keeps the direction', () => {
  const level = makeLevel({ brake: { taps: 1, dv: 34 } });
  const before = stepTimes(launch(start(level), [60, 80]), 10);   // speed 100
  const after = brake(before);
  assert.ok(Math.abs(speedOf(after) - 66) < 1e-9, `speed is ${speedOf(after)}`);
  assert.ok(Math.abs(after.vx / after.vy - 60 / 80) < 1e-9);
  assert.deepEqual(after.brakes, [10]);
});

test('a brake cannot push the ship backwards', () => {
  const level = makeLevel({ brake: { taps: 1, dv: 34 } });
  const after = brake(launch(start(level), [20, 0]));
  assert.equal(speedOf(after), 0);
});

test('a brake with no taps left does nothing', () => {
  const level = makeLevel({ brake: { taps: 1, dv: 10 } });
  const once = brake(launch(start(level), [100, 0]));
  assert.deepEqual(brake(once), once);
  const none = launch(start(makeLevel({})), [100, 0]);   // taps: 0
  assert.deepEqual(brake(none), none);
});

test('inputs never edit the state they are given', () => {
  const level = makeLevel({ brake: { taps: 1, dv: 10 } });
  const flying = launch(start(level), [100, 0]);
  const snapshot = JSON.stringify(flying);
  step(flying);
  brake(flying);
  assert.equal(JSON.stringify(flying), snapshot);
});

test('nothing changes after the flight is over', () => {
  const level = makeLevel({ brake: { taps: 1, dv: 10 } });
  const over = replay(level, { launch: [0, 300], brakes: [] });
  assert.equal(over.status, 'lost');
  assert.deepEqual(step(over), over);
  assert.deepEqual(brake(over), over);
  assert.deepEqual(launch(over, [1, 1]), over);
});

// -------------------------------------------------------------- authoring aid

test('margin() measures the room for error around a launch', () => {
  assert.equal(margin(zoneExample, { launch: [300, 100], brakes: [] }), 8);
  assert.equal(margin(zoneExample, { launch: [200, 0], brakes: [] }), -1);   // a crash: not a winner at all
});

test('tryLaunch() finds where to brake', () => {
  const found = tryLaunch(ringExample, [0, -74]);
  assert.ok(found, 'expected a solution');
  assert.equal(found.brakes.length, 1);
  assert.ok(Math.abs(found.brakes[0] - 516) <= 3, `brake at ${found.brakes[0]}`);
  assert.equal(tryLaunch(ringExample, [200, 0]), null);
});

test('findForgivingLaunch() returns a winning launch with room to spare', () => {
  // A small, quick level: slow ship, one planet, one big zone on the far side.
  const level = makeLevel({ start: [200, 300], maxSpeed: 90, maxTicks: 500,
    bodies: [{ at: [300, 300], r: 20, gm: 400000 }],
    goals: [{ type: 'zone', at: [400, 300], r: 30 }] });
  const found = findForgivingLaunch(level);
  assert.ok(found, 'expected a solution');
  assert.equal(replay(level, found.solution).status, 'won');
  assert.ok(found.margin >= LAUNCH_SLACK, `margin ${found.margin}`);
});

test('findForgivingLaunch() returns null when a level cannot be won', () => {
  const level = makeLevel({ maxSpeed: 20, maxTicks: 100 });   // the zone is far out of reach
  assert.equal(findForgivingLaunch(level), null);
});
