// Tests for Ship It.
// Part 1 checks every level in levels.js: the data is well formed, the solution wins,
// the starting pipeline does not, and (for the shipped levels) the named wrong move fails
// the check it should.
// Part 2 checks the rules themselves on tiny made-up levels.

import { test, assert } from './harness.js';
import { levels } from '../site/games/ship-it/levels.js';
import { OPTIONS, start, apply, replay, stars, simulate, whyNot } from '../site/games/ship-it/logic.js';

const EXPECTS = ['green', 'red', 'no-deploy', 'waits', 'same-image'];
const ONE_PUSH_ONLY = ['red', 'waits'];

// ------------------------------------------------------------ part 1: levels

test('level ids are unique and start with "si-"', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('si-'), id);
});

for (const level of levels) {
  const name = level.id;

  test(`${name}: has every field, with a lesson, 1 to 3 snippets and 1 to 3 docs links`, () => {
    for (const field of ['title', 'hint', 'lesson', 'steps', 'pipeline', 'on', 'toggles', 'checks', 'stars', 'solution', 'inRealLife', 'docs']) {
      assert.ok(level[field] !== undefined, `missing ${field}`);
    }
    assert.ok(level.lesson.length > 20, 'lesson is too short');
    assert.ok(level.inRealLife.length >= 1 && level.inRealLife.length <= 3, 'inRealLife needs 1 to 3 snippets');
    for (const snippet of level.inRealLife) {
      assert.ok(snippet.label && snippet.code, 'a snippet needs a label and code');
      assert.ok(snippet.code.split('\n').length <= 14, `snippet "${snippet.label}" is longer than 14 lines`);
    }
    assert.ok(level.docs.length >= 1 && level.docs.length <= 3, 'docs needs 1 to 3 links');
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
  });

  test(`${name}: every step is in the pipeline exactly once, with sane numbers`, () => {
    const placed = level.pipeline.flat();
    assert.deepEqual([...placed].sort(), Object.keys(level.steps).sort());
    assert.ok(level.pipeline.every((stage) => stage.length > 0), 'a stage is empty');
    for (const [id, step] of Object.entries(level.steps)) {
      assert.ok(/^[a-z0-9-]+$/.test(id), `step id "${id}" must be a short lowercase word`);
      assert.ok(Number.isInteger(step.minutes) && step.minutes >= 1, `${id}: minutes must be a whole number, 1 or more`);
      if (step.cacheSaves) assert.ok(step.cacheSaves < step.minutes, `${id}: cacheSaves must be less than minutes`);
    }
    assert.ok(Object.values(level.steps).filter((step) => step.pushes).length <= 1, 'at most one step pushes an image');
  });

  test(`${name}: options and checks are well formed`, () => {
    for (const option of level.toggles) assert.ok(OPTIONS.includes(option), `unknown toggle ${option}`);
    for (const [id, list] of Object.entries(level.on)) {
      for (const option of list) {
        // An option that is on at the start must make sense on that step (the toggles list aside).
        const reason = whyNot({ ...level, toggles: OPTIONS }, id, option);
        assert.equal(reason, '', `on.${id}: ${option}`);
      }
    }
    for (const check of level.checks) {
      assert.ok(EXPECTS.includes(check.expect), `unknown expect "${check.expect}"`);
      const pushes = check.runs || [check];
      assert.ok(pushes.every((push) => push.commit && push.branch), 'every push needs a commit and a branch');
      if (ONE_PUSH_ONLY.includes(check.expect)) assert.ok(!check.runs || check.runs.length === 1, `${check.expect} takes one push`);
    }
  });

  test(`${name}: the solution wins`, () => {
    const state = replay(level, level.solution);
    const failing = state.report ? state.report.checks.filter((c) => !c.pass).map((c) => c.why) : ['it never runs'];
    assert.equal(state.status, 'won', failing.join(' | '));
  });

  test(`${name}: the solution earns three stars, and stars.three <= stars.two`, () => {
    const state = replay(level, level.solution);
    assert.ok(state.report.minutes <= level.stars.three, `the solution uses ${state.report.minutes} runner-minutes`);
    assert.ok(level.stars.three <= level.stars.two);
    assert.equal(stars(state), 3);
  });

  test(`${name}: the starting pipeline fails at least one check`, () => {
    const state = replay(level, ['run']);
    assert.equal(state.status, 'playing');
  });

  test(`${name}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
  });
}

// The wrong move each shipped level is about, and the check (counted from 0) it must fail.
// Levels added later are not listed here, so they are not held to this.
const WRONG = {
  'si-01': { moves: ['new lint 2'], fails: 1 },                        // lint after unit tests
  'si-02': { moves: ['move types 2'], fails: 0 },                      // only half parallel: too slow
  'si-03': { moves: ['publish build', 'move e2e 2'], fails: 0 },       // e2e beside build: no output yet
  'si-04': { moves: ['cache unit', 'cache build'], fails: 1 },         // lint left uncached: red too late
  'si-05': { moves: ['main deploy', 'main lint'], fails: 3 },          // lint skipped on branches
  'si-06': { moves: ['approve staging'], fails: 0 },                   // the gate on the wrong deploy
  'si-07': { moves: ['tag image', 'move staging 1'], fails: 0 },       // deploy before the image exists
  'si-08': { moves: ['lock unit'], fails: 1 },                         // the lock on the wrong step
};

for (const [id, wrong] of Object.entries(WRONG)) {
  const level = levels.find((l) => l.id === id);
  if (!level) continue;
  test(`${id}: the wrong move ${JSON.stringify(wrong.moves)} fails check ${wrong.fails + 1}`, () => {
    const state = replay(level, [...wrong.moves, 'run']);
    assert.equal(state.report.checks[wrong.fails].pass, false);
  });
}

// Checks on single shipped levels. Each is skipped if that level is ever removed.
function shipped(id, title, body) {
  const level = levels.find((l) => l.id === id);
  if (level) test(`${id}: ${title}`, () => body(level));
}

shipped('si-07', 'with the "latest" tag, production gets the other push\'s image', (level) => {
  const state = replay(level, ['run']);
  assert.ok(/push B's image/.test(state.report.checks[1].why), state.report.checks[1].why);
});

shipped('si-08', 'without a lock the second deploy collides with the first', (level) => {
  const state = replay(level, ['run']);
  assert.ok(/already deploying/.test(state.report.checks[1].why), state.report.checks[1].why);
});

// The cheap win this closes: deploy beside the image step, tag off, so it pulls the old "latest".
shipped('si-08', 'a deploy beside the image step with the "latest" tag ships the old image and fails', (level) => {
  const state = replay(level, ['tag image', 'lock deploy', 'new unit 1', 'move deploy 2', 'run']);
  assert.equal(state.status, 'playing');
  assert.ok(/old image/.test(state.report.checks[0].why), state.report.checks[0].why);
});

// ------------------------------------------------------- part 2: the rules

function tiny(overrides) {
  return {
    id: 'x', title: 'x', hint: 'x', lesson: 'x', inRealLife: [], docs: [],
    steps: {
      a: { label: 'A', minutes: 2 },
      b: { label: 'B', minutes: 5, fails: ['bad'] },
    },
    pipeline: [['a'], ['b']],
    on: {},
    toggles: OPTIONS,
    checks: [{ commit: 'good', branch: 'main', expect: 'green' }],
    stars: { three: 100, two: 100 },
    solution: ['run'],
    ...overrides,
  };
}

function runOne(level, moves, check) {
  const state = replay(level, moves);
  return simulate(level, state.stages, state.opts, check);
}

test('stages run one after another; a stage lasts as long as its slowest step', () => {
  const level = tiny();
  assert.equal(runOne(level, [], level.checks[0])[0].end, 7);
  assert.equal(runOne(level, ['move b 1'], level.checks[0])[0].end, 5);
});

test('runner-minutes add up every step, even side by side', () => {
  const level = tiny();
  assert.equal(replay(level, ['move b 1', 'run']).report.minutes, 7);
});

test('a failure stops later stages; steps beside it still finish', () => {
  const level = tiny({
    steps: { a: { label: 'A', minutes: 1, fails: ['bad'] }, b: { label: 'B', minutes: 4 }, c: { label: 'C', minutes: 3 } },
    pipeline: [['a', 'b'], ['c']],
  });
  const [run] = runOne(level, [], { commit: 'bad', branch: 'main', expect: 'red' });
  assert.equal(run.state, 'red');
  assert.equal(run.failAt, 1);
  assert.equal(run.minutes, 5);
  assert.equal(run.steps.some((s) => s.id === 'c'), false);
});

test('moves: new stages, empty stages vanish, bad numbers are rejected', () => {
  const level = tiny();
  assert.deepEqual(apply(start(level), 'new b 1').stages, [['b'], ['a']]);
  assert.deepEqual(apply(start(level), 'move a 2').stages, [['b', 'a']]);
  assert.deepEqual(apply(start(level), 'new a 3').stages, [['b'], ['a']]);
  assert.throws(() => apply(start(level), 'move a 3'));
  assert.throws(() => apply(start(level), 'new a 0'));
  assert.throws(() => apply(start(level), 'move zz 1'));
  assert.throws(() => apply(start(level), 'jump a'));
});

test('an option the step or level does not allow is rejected', () => {
  const level = tiny({ toggles: ['main'] });
  assert.throws(() => apply(start(level), 'cache a'));
  assert.throws(() => apply(start(tiny()), 'publish a'));   // a makes nothing
  assert.throws(() => apply(start(tiny()), 'cache a'));     // a has no cacheSaves
  assert.equal(whyNot(level, 'a', 'main'), '');
});

test('build output reaches a later stage only when published, and never the same stage', () => {
  const level = tiny({
    steps: { build: { label: 'Build', minutes: 2, makes: 'app' }, use: { label: 'Use', minutes: 3, needs: 'app' } },
    pipeline: [['build'], ['use']],
  });
  const check = level.checks[0];
  assert.equal(runOne(level, [], check)[0].state, 'red');
  assert.equal(runOne(level, ['publish build'], check)[0].state, 'green');
  const beside = runOne(level, ['publish build', 'move use 1'], check)[0];
  assert.equal(beside.state, 'red');
  assert.equal(beside.failAt, 1);   // it fails at once, after QUICK_FAIL minutes
});

test('a cache hit saves minutes; a lockfile change misses and costs one more', () => {
  const level = tiny({ steps: { a: { label: 'A', minutes: 5, cacheSaves: 3 } }, pipeline: [['a']] });
  assert.equal(runOne(level, [], { commit: 'good', branch: 'main' })[0].end, 5);
  assert.equal(runOne(level, ['cache a'], { commit: 'good', branch: 'main' })[0].end, 2);
  assert.equal(runOne(level, ['cache a'], { commit: 'new-dep', branch: 'main' })[0].end, 6);
});

test('"main" skips a step on other branches and costs nothing there', () => {
  const level = tiny();
  const [run] = runOne(level, ['main b'], { commit: 'good', branch: 'feature/x' });
  assert.equal(run.state, 'green');
  assert.equal(run.minutes, 2);
  assert.equal(run.steps.find((s) => s.id === 'b').state, 'skip');
});

test('an approval waits for ever without approveAt, and waiting costs nothing', () => {
  const level = tiny();
  const [stuck] = runOne(level, ['approve b'], { commit: 'good', branch: 'main' });
  assert.equal(stuck.state, 'waiting');
  assert.equal(stuck.waitAt, 2);
  assert.equal(stuck.minutes, 2);
  const [later] = runOne(level, ['approve b'], { commit: 'good', branch: 'main', approveAt: 10 });
  assert.equal(later.state, 'green');
  assert.equal(later.end, 15);
  assert.equal(later.minutes, 7);
});

function deployLevel(extra) {
  return tiny({
    steps: {
      image: { label: 'Image', minutes: 2, pushes: true },
      deploy: { label: 'Deploy', minutes: 3, needs: 'image', deploys: 'staging' },
    },
    pipeline: [['image'], ['deploy']],
    ...extra,
  });
}
const twoPushes = { runs: [{ commit: 'good', branch: 'main', at: 0 }, { commit: 'good', branch: 'main', at: 1 }], expect: 'green' };

test('two deploys to one environment at once: the second fails, unless a lock makes it wait', () => {
  const level = deployLevel();
  const clash = runOne(level, [], twoPushes);
  assert.equal(clash[1].state, 'red');
  const queued = runOne(level, ['lock deploy'], twoPushes);
  assert.equal(queued[1].state, 'green');
  assert.equal(queued[1].end, 8);          // waited from 3 to 5, then ran 5 to 8
  assert.equal(queued[1].minutes, 5);      // the wait was free
});

test('"latest" moves under a waiting run; a commit tag does not', () => {
  const level = deployLevel();
  const check = { runs: [{ commit: 'good', branch: 'main', at: 0, approveAt: 20 }, { commit: 'good', branch: 'main', at: 1 }], expect: 'same-image' };
  const loose = runOne(level, ['approve deploy'], check);
  assert.equal(loose[0].steps.find((s) => s.id === 'deploy').image, 'B');
  const pinned = runOne(level, ['approve deploy', 'tag image'], check);
  assert.equal(pinned[0].steps.find((s) => s.id === 'deploy').image, 'A');
});

test('a tagged image that is not pushed yet cannot be deployed', () => {
  const level = deployLevel();
  const [run] = runOne(level, ['tag image', 'move deploy 1'], level.checks[0]);
  assert.equal(run.state, 'red');
});

test('green is not good enough if a deploy shipped an image its own push did not build', () => {
  const level = deployLevel({ pipeline: [['image', 'deploy']] });   // deploy pulls "latest" before the build pushes it
  assert.ok(/old image/.test(replay(level, ['run']).report.checks[0].why));
  assert.equal(replay(level, ['new deploy 2', 'run']).status, 'won');
});

test('no-deploy also needs every step that does not deploy to run', () => {
  const level = tiny({
    steps: { a: { label: 'A', minutes: 2 }, d: { label: 'D', minutes: 1, deploys: 'staging' } },
    pipeline: [['a'], ['d']],
    checks: [{ commit: 'good', branch: 'feature/x', expect: 'no-deploy' }],
  });
  assert.equal(replay(level, ['run']).status, 'playing');                    // d deployed
  assert.equal(replay(level, ['main d', 'run']).status, 'won');
  assert.equal(replay(level, ['main d', 'main a', 'run']).status, 'playing'); // a skipped too
});

test('waits: every other step must have run, and the limit counts until the steps beside the gate end', () => {
  const steps = {
    a: { label: 'A', minutes: 2 },
    p: { label: 'P', minutes: 1, deploys: 'production' },
    c: { label: 'C', minutes: 6 },
  };
  const waits = (within, pipeline) => tiny({ steps, pipeline, checks: [{ commit: 'good', branch: 'main', expect: 'waits', within }] });
  assert.equal(replay(waits(8, [['a'], ['p', 'c']]), ['approve p', 'run']).status, 'won');      // gate at 2, c done at 8
  assert.equal(replay(waits(7, [['a'], ['p', 'c']]), ['approve p', 'run']).status, 'playing');
  assert.equal(replay(waits(20, [['a'], ['p'], ['c']]), ['approve p', 'run']).status, 'playing'); // c never ran
});

test('red is not good enough if a deploy shipped the commit first', () => {
  const level = tiny({
    steps: { test: { label: 'Test', minutes: 4, fails: ['bad'] }, deploy: { label: 'Deploy', minutes: 1, deploys: 'staging' } },
    pipeline: [['test', 'deploy']],
    checks: [{ commit: 'bad', branch: 'main', expect: 'red' }],
  });
  assert.equal(replay(level, ['run']).report.checks[0].pass, false);
  assert.equal(replay(level, ['new deploy 2', 'run']).report.checks[0].pass, true);
});

test('nothing changes after the level is won', () => {
  const level = tiny();
  const won = replay(level, ['run']);
  assert.equal(won.status, 'won');
  assert.deepEqual(apply(won, 'move a 2'), won);
});

test('stars follow the runner-minutes', () => {
  const level = tiny({ stars: { three: 7, two: 8 } });
  assert.equal(stars(replay(level, ['run'])), 3);
  assert.equal(stars(replay(tiny({ stars: { three: 5, two: 7 } }), ['run'])), 2);
  assert.equal(stars(replay(tiny({ stars: { three: 5, two: 6 } }), ['run'])), 1);
});
