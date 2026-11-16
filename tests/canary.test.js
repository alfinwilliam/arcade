// Tests for Canary. Each level's `solution` is replayed through the real rules and must win;
// each of its `traps` must lose in the way the level says.
// The rules every level must follow are listed in the header of site/games/canary/levels.js.

import { test, assert } from './harness.js';
import { levels, causes } from '../site/games/canary/levels.js';
import {
  start, apply, replay, stars, split, serve, choicesFor, startRouting,
  virtualServiceYaml, destinationRuleYaml, TOOLS, HEADER_CHOICES,
} from '../site/games/canary/logic.js';

const whole = (n) => Number.isInteger(n);
const causeIds = causes.map((c) => c.id);

test('level ids are unique and start with "cn-"', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('cn-'), id);
});

test('cause ids are unique and every cause has text', () => {
  assert.equal(new Set(causeIds).size, causeIds.length);
  for (const cause of causes) assert.ok(typeof cause.text === 'string' && cause.text.length > 0, cause.id);
});

for (const level of levels) {
  const id = level.id;

  test(`${id}: has title, brief, hint and a one-sentence lesson`, () => {
    for (const field of ['title', 'brief', 'hint', 'lesson']) {
      assert.ok(typeof level[field] === 'string' && level[field].length > 0, `${field} is missing`);
    }
  });

  test(`${id}: inRealLife has 1 to 3 snippets of at most 18 lines`, () => {
    assert.ok(Array.isArray(level.inRealLife) && level.inRealLife.length >= 1 && level.inRealLife.length <= 3);
    for (const snippet of level.inRealLife) {
      assert.ok(typeof snippet.label === 'string' && snippet.label.length > 0, 'a snippet has no label');
      assert.ok(typeof snippet.code === 'string' && snippet.code.split('\n').length <= 18, `${snippet.label}: too long`);
      if (snippet.code.includes('networking.istio.io')) {
        assert.ok(snippet.code.startsWith('apiVersion: networking.istio.io/v1\n'), `${snippet.label}: use apiVersion networking.istio.io/v1`);
      }
    }
  });

  test(`${id}: docs has 1 to 3 https links`, () => {
    assert.ok(Array.isArray(level.docs) && level.docs.length >= 1 && level.docs.length <= 3);
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
  });

  test(`${id}: numbers are whole and in range`, () => {
    assert.ok(whole(level.users) && level.users > 0, 'users');
    assert.ok(whole(level.testers || 0) && (level.testers || 0) >= 0, 'testers');
    assert.ok(whole(level.rounds) && level.rounds > 0, 'rounds');
    assert.ok(whole(level.budget) && level.budget >= 0, 'budget');
    assert.ok(whole(level.p99Limit) && level.p99Limit > 0, 'p99Limit');
    if (level.maxStep !== undefined) assert.ok(whole(level.maxStep) && level.maxStep > 0 && level.maxStep % 5 === 0, 'maxStep');
  });

  test(`${id}: tools are known, include weight, and testers exist if header is offered`, () => {
    assert.ok(level.tools.includes('weight'), 'weight is missing');
    for (const tool of level.tools) assert.ok(TOOLS.includes(tool), `unknown tool ${tool}`);
    if (level.tools.includes('header')) assert.ok((level.testers || 0) > 0, 'header needs testers');
    for (const [tool, list] of Object.entries(level.choices || {})) {
      assert.ok(TOOLS.includes(tool) && tool !== 'weight' && tool !== 'header', `choices for ${tool}`);
      assert.ok(list.length > 0 && list.every((v) => whole(v) && v >= 0), `choices for ${tool}`);
    }
  });

  test(`${id}: the start routing uses offered controls and values`, () => {
    const routing = startRouting(level);
    for (const [tool, value] of Object.entries(level.start || {})) {
      assert.ok(level.tools.includes(tool), `start sets ${tool}, which is not in tools`);
      if (tool === 'header') assert.ok(HEADER_CHOICES.includes(value), 'header');
      else if (tool === 'weight') assert.ok(whole(value) && value % 5 === 0 && value >= 0 && value <= 100, 'weight');
      else assert.ok(choicesFor(level, tool).includes(value), `${tool} ${value} is not a choice`);
    }
    assert.ok(routing.weight < 100, 'a level must not start with v2 on 100%');
  });

  test(`${id}: version traits are valid`, () => {
    for (const name of ['v1', 'v2']) {
      const v = level[name];
      assert.ok(whole(v.pods) && v.pods >= 1, `${name}.pods`);
      assert.ok(whole(v.ms) && v.ms > 0, `${name}.ms`);
      assert.ok(whole(v.podCapacity) && v.podCapacity > 0, `${name}.podCapacity`);
      for (const pct of ['errorPct', 'testerErrorPct', 'slowPct']) {
        if (v[pct] !== undefined) assert.ok(whole(v[pct]) && v[pct] >= 0 && v[pct] <= 100, `${name}.${pct}`);
      }
      if (v.slowPct) assert.ok(whole(v.slowMs) && v.slowMs > 0, `${name}.slowMs is needed with slowPct`);
      if (v.badPod !== undefined) assert.ok(whole(v.badPod) && v.badPod >= 1 && v.badPod <= v.pods, `${name}.badPod`);
    }
  });

  test(`${id}: fault is null or a known cause`, () => {
    assert.ok(level.fault === null || causeIds.includes(level.fault), `fault ${level.fault}`);
  });

  test(`${id}: the solution wins`, () => {
    const end = replay(level, level.solution);
    assert.equal(end.status, 'won');
    assert.ok(end.rounds.length <= level.rounds);
    assert.equal(stars(end), 3);
  });

  if (level.fault === null || level.rollback === false) {
    test(`${id}: the solution wins by putting v2 on 100%`, () => {
      assert.equal(replay(level, level.solution).reason, 'promoted');
    });
  }

  test(`${id}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
    assert.ok(replay(level, ['run']).status !== 'won');
  });

  for (const [i, trap] of (level.traps || []).entries()) {
    test(`${id}: trap ${i + 1} loses with "${trap.reason}"`, () => {
      const end = replay(level, trap.inputs);
      assert.equal(end.status, 'lost');
      assert.equal(end.reason, trap.reason);
    });
  }
}

// ------------------------------------------------------------- the rules

const v1 = { pods: 4, ms: 100, podCapacity: 1000 };
function make(extra) {
  return {
    id: 'x', title: 'x', users: 1000, testers: 20, rounds: 5, budget: 1000, p99Limit: 500,
    tools: ['weight', 'header', 'mirror', 'timeout', 'retries', 'outlier'], fault: 'bug',
    v1, v2: { pods: 4, ms: 100, podCapacity: 1000 }, solution: [], ...extra,
  };
}

test('weights move in steps of 5 between 0 and 100', () => {
  const s = start(make());
  assert.throws(() => apply(s, 'weight 7'));
  assert.throws(() => apply(s, 'weight 105'));
  assert.equal(apply(s, 'weight 35').routing.weight, 35);
});

test('maxStep limits how far v2 rises after each round', () => {
  const level = make({ maxStep: 25 });
  assert.throws(() => apply(start(level), 'weight 30'));
  const after = replay(level, ['weight 25', 'run']);
  assert.equal(apply(after, 'weight 50').routing.weight, 50);
  assert.throws(() => apply(after, 'weight 55'));
});

test('a control the level does not offer is rejected', () => {
  const level = make({ tools: ['weight'] });
  assert.throws(() => apply(start(level), 'mirror 100'));
  assert.throws(() => apply(start(make()), 'timeout 123'));
});

test('the weights split users by percentage', () => {
  const flows = split(make(), { ...startRouting(make()), weight: 15 });
  assert.equal(flows.v2.users, 150);
  assert.equal(flows.v1.users, 850);
});

test('testers reach v2 only when their route comes first', () => {
  const level = make();
  const base = startRouting(level);
  assert.equal(split(level, { ...base, header: 'first' }).v2.testers, 20);
  assert.equal(split(level, { ...base, header: 'last' }).v2.testers, 0);
  assert.equal(split(level, { ...base, header: 'off' }).v2.testers, 0);
});

test('mirrored copies go to v2 and their failures cost no budget', () => {
  const level = make({ budget: 0, v2: { pods: 4, ms: 100, podCapacity: 1000, errorPct: 50 } });
  const end = replay(level, ['mirror 100', 'run']);
  assert.equal(end.rounds[0].v2.mirrored, 1020);
  assert.ok(end.rounds[0].v2.failed.mirrored > 0);
  assert.equal(end.spent, 0);
  assert.equal(end.status, 'playing');
});

test('tester failures cost no budget', () => {
  const level = make({ budget: 0, v2: { pods: 4, ms: 100, podCapacity: 1000, errorPct: 50 } });
  const end = replay(level, ['header first', 'run']);
  assert.equal(end.rounds[0].v2.failed.testers, 10);
  assert.equal(end.spent, 0);
});

test('spending more than the budget loses', () => {
  const level = make({ budget: 5, v2: { pods: 4, ms: 100, podCapacity: 1000, errorPct: 50 } });
  const end = replay(level, ['weight 5', 'run']);
  assert.equal(end.status, 'lost');
  assert.equal(end.reason, 'budget');
});

test('a rollback needs evidence, and must name the right cause', () => {
  const level = make({ v2: { pods: 4, ms: 100, podCapacity: 1000, errorPct: 20 } });
  assert.throws(() => apply(start(level), 'rollback bug'));
  const seen = replay(level, ['weight 5', 'run']);
  assert.equal(apply(seen, 'rollback bug').status, 'won');
  assert.equal(apply(seen, 'rollback slow').reason, 'cause');
  assert.throws(() => apply(seen, 'rollback nonsense'));
  assert.throws(() => apply(replay({ ...level, rollback: false }, ['weight 5', 'run']), 'rollback bug'));
});

test('v2 on 100% is not healthy while its pods answer 5xx, even if retries hide them from users', () => {
  const level = make({ v2: { pods: 4, ms: 100, podCapacity: 1000, badPod: 1 } });
  const end = replay(level, ['retries 1', 'weight 100', 'run']);
  assert.equal(end.rounds[0].v2.failed.users, 0);
  assert.ok(end.rounds[0].v2.pod5xx > 0);
  assert.equal(end.status, 'playing');
});

test('v2 on 100% is not healthy while its p99 is over the limit', () => {
  const v2 = { pods: 4, ms: 100, podCapacity: 1000, slowPct: 5, slowMs: 3000 };
  const strict = replay(make({ v2, p99Limit: 1000 }), ['weight 100', 'run']);
  assert.equal(strict.spent, 0);
  assert.equal(strict.status, 'playing');
  assert.equal(replay(make({ v2, p99Limit: 3000 }), ['weight 100', 'run']).reason, 'promoted');
});

test('a timeout turns a slow answer into a 504, and a retry asks again', () => {
  const spec = { pods: 4, ms: 100, podCapacity: 1000, slowPct: 10, slowMs: 3000 };
  const flow = { users: 1000, testers: 0, mirrored: 0 };
  const none = serve(spec, flow, { timeout: 0, retries: 0, outlier: 0 }, [], 0);
  assert.equal(none.p99, 3000);
  assert.equal(none.failed.users, 0);
  const cut = serve(spec, flow, { timeout: 500, retries: 0, outlier: 0 }, [], 0);
  assert.equal(cut.failed.users, 100);
  assert.equal(cut.codes[504], 100);
  const retried = serve(spec, flow, { timeout: 500, retries: 3, outlier: 0 }, [], 0);
  assert.equal(retried.failed.users, 0);
  assert.equal(retried.attempts, 1000 + 100 + 10 + 1);   // each retry is one more try
});

test('retries on an overloaded version add tries and make it worse', () => {
  const spec = { pods: 3, ms: 200, podCapacity: 200 };
  const flow = { users: 700, testers: 0, mirrored: 0 };
  const plain = serve(spec, flow, { timeout: 250, retries: 0, outlier: 0 }, [], 0);
  const storm = serve(spec, flow, { timeout: 250, retries: 3, outlier: 0 }, [], 0);
  assert.ok(storm.attempts > plain.attempts * 2, 'retries multiply the tries');
  assert.ok(storm.failed.users > plain.failed.users, 'and more users fail');
});

test('outlier detection ejects the bad pod after that many failures in a row', () => {
  const spec = { pods: 4, ms: 100, podCapacity: 1000, badPod: 2 };
  const flow = { users: 400, testers: 0, mirrored: 0 };
  const off = serve(spec, flow, { timeout: 0, retries: 0, outlier: 0 }, [], 0);
  assert.equal(off.failed.users, 100);
  assert.deepEqual(off.ejected, []);
  const on = serve(spec, flow, { timeout: 0, retries: 0, outlier: 5 }, [], 0);
  assert.equal(on.failed.users, 5);
  assert.deepEqual(on.ejected, [2]);
  const next = serve(spec, flow, { timeout: 0, retries: 0, outlier: 5 }, on.ejected, on.streak);
  assert.equal(next.failed.users, 0);
});

test('a retry after the bad pod goes to another pod', () => {
  const spec = { pods: 4, ms: 100, podCapacity: 1000, badPod: 1 };
  const out = serve(spec, { users: 400, testers: 0, mirrored: 0 }, { timeout: 0, retries: 1, outlier: 0 }, [], 0);
  assert.equal(out.failed.users, 0);
  assert.equal(out.attempts, 500);
});

test('nothing changes after the level is over', () => {
  const level = levels[0];
  const won = replay(level, level.solution);
  assert.deepEqual(apply(won, 'run'), won);
});

test('the VirtualService weights add up to 100 and the testers\' route comes first', () => {
  const level = make();
  const yaml = virtualServiceYaml(level, { ...startRouting(level), weight: 30, header: 'first', mirror: 100, retries: 2, timeout: 500 });
  const weights = [...yaml.matchAll(/weight: (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(weights, [70, 30]);
  assert.ok(yaml.indexOf('x-canary') < yaml.indexOf('weight: 70'), 'the match route is above the catch-all');
  assert.ok(yaml.includes('perTryTimeout: 500ms') && yaml.includes('attempts: 2'));
  assert.ok(yaml.includes('mirrorPercentage:'));
  assert.ok(yaml.startsWith('apiVersion: networking.istio.io/v1\nkind: VirtualService'));
});

test('the DestinationRule holds the subsets, and outlier detection when it is on', () => {
  const level = make();
  const off = destinationRuleYaml(level, startRouting(level));
  assert.ok(off.includes('labels: { version: v2 }') && !off.includes('outlierDetection'));
  const on = destinationRuleYaml(level, { ...startRouting(level), outlier: 5 });
  assert.ok(on.includes('consecutive5xxErrors: 5'));
});
