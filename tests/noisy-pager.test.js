// Tests for Noisy Pager. Each level's `solution` is replayed through the real rules and must
// win; its starting rule and its `wrong` rules must lose in the way the level says.
// The rules every level must follow are listed in the header of site/games/noisy-pager/levels.js.

import { test, assert } from './harness.js';
import { levels } from '../site/games/noisy-pager/levels.js';
import {
  start, apply, replay, evaluate, generate, series, stars, ruleYaml, thresholdsFor,
  usesRange, toMinutes, DAY,
} from '../site/games/noisy-pager/logic.js';

const KIND_MEASURES = {
  gauge: ['value', 'up', 'absent'],
  counter: ['value', 'rate', 'up', 'absent'],
  latency: ['avg', 'p99', 'up', 'absent'],
  errors: ['rate', 'ratio', 'burn', 'up', 'absent'],
};

const whole = (n) => Number.isInteger(n);

// How a run failed: the words used in a level's `wrong` list.
function failures(run) {
  const found = [];
  if (run.falsePages.length > 0) found.push('false page');
  if (run.incidents.some((i) => i.pagedAt !== null && !i.ok)) found.push('late');
  if (run.incidents.some((i) => i.pagedAt === null)) found.push('missed');
  if (run.incidents.some((i) => i.repeats > 0)) found.push('flapping');
  return found;
}

// Every rule the player could build in a level.
function allRules(level) {
  const rules = [];
  for (const measure of Object.keys(level.measures)) {
    const ranges = usesRange(measure) ? level.ranges : [0];
    const shorts = measure === 'burn' ? level.shorts : [0];
    const thresholds = thresholdsFor(level, measure);
    for (const range of ranges) for (const short of shorts) for (const f of level.fors) {
      for (const threshold of thresholds.length ? thresholds : [null]) {
        rules.push({ measure, range, short, threshold, for: f });
      }
    }
  }
  return rules;
}

test('level ids are unique and start with np-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('np-'), id);
});

for (const level of levels) {
  const id = level.id;

  test(`${id}: has the text the pages show`, () => {
    for (const field of ['title', 'brief', 'hint', 'lesson']) {
      assert.ok(typeof level[field] === 'string' && level[field].length > 0, `${field} is missing`);
    }
    assert.ok(level.inRealLife.length >= 1 && level.inRealLife.length <= 3, 'inRealLife has 1 to 3 snippets');
    for (const snippet of level.inRealLife) {
      assert.ok(snippet.label && snippet.code, 'each snippet has a label and code');
      assert.ok(snippet.code.split('\n').length <= 14, `"${snippet.label}" is at most 14 lines`);
    }
    assert.ok(level.docs.length >= 1 && level.docs.length <= 3, 'docs has 1 to 3 links');
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
    assert.ok(level.alert.name && level.alert.summary && !level.alert.summary.includes('"'), 'alert name and summary, no double quotes');
  });

  test(`${id}: the day is built from whole numbers`, () => {
    assert.ok(whole(level.seed) && whole(level.noise), 'seed and noise');
    assert.equal(level.shape[0][0], 0, 'shape starts at hour 0');
    assert.equal(level.shape[level.shape.length - 1][0], 24, 'shape ends at hour 24');
    for (let i = 1; i < level.shape.length; i++) assert.ok(level.shape[i][0] > level.shape[i - 1][0], 'shape hours go up');
    for (const [, value] of level.shape.concat(level.typical || [])) assert.ok(whole(value), `shape value ${value}`);
    for (const item of level.incidents.concat(level.spikes || [])) assert.ok(whole(item.add) && whole(item.minutes), `${item.start}: add and minutes`);
  });

  test(`${id}: incidents fit in the day, do not overlap and have a deadline`, () => {
    assert.ok(level.incidents.length >= 1, 'at least one incident');
    let end = -1;
    for (const incident of level.incidents) {
      const begin = toMinutes(incident.start);
      assert.ok(begin >= end, `${incident.start}: incidents are in time order and do not overlap`);
      end = begin + incident.minutes;
      assert.ok(end <= DAY, `${incident.start} ends by 24:00`);
      assert.ok(incident.deadline >= 1 && incident.deadline <= incident.minutes, `${incident.start}: 1 <= deadline <= minutes`);
    }
  });

  test(`${id}: measures, ranges and the starting rule are valid`, () => {
    for (const measure of Object.keys(level.measures)) {
      assert.ok(KIND_MEASURES[level.kind].includes(measure), `${measure} is not a measure of a ${level.kind}`);
      const spec = level.measures[measure];
      if (['up', 'absent'].includes(measure)) continue;
      assert.ok(thresholdsFor(level, measure).includes(spec.start), `${measure}: start is one of its thresholds`);
      if (measure === 'burn') assert.ok(level.slo > 0 && level.slo < 100, 'burn needs slo');
    }
    for (const range of (level.ranges || []).concat((level.shorts || []).filter(Boolean))) {
      assert.ok(whole(range) && range >= 2 && range <= 360, `range ${range}`);
    }
    const rule = start(level).rule;
    assert.ok(Object.keys(level.measures).includes(rule.measure), 'rule.measure is offered');
    assert.ok(level.fors.includes(rule.for), 'rule.for is offered');
    if (Object.keys(level.measures).some(usesRange)) assert.ok(level.ranges.includes(rule.range), 'rule.range is offered');
  });

  test(`${id}: the solution wins`, () => {
    assert.equal(level.solution[level.solution.length - 1], 'run', 'the solution ends with run');
    assert.equal(replay(level, level.solution).status, 'won');
  });

  test(`${id}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
  });

  test(`${id}: the starting rule loses`, () => {
    assert.equal(replay(level, ['run']).status, 'lost');
  });

  test(`${id}: each wrong rule loses in the stated way`, () => {
    assert.ok(level.wrong.length >= 1, 'at least one wrong rule');
    for (const wrong of level.wrong) {
      const state = replay(level, wrong.inputs);
      assert.equal(state.status, 'lost', JSON.stringify(wrong.inputs));
      assert.ok(failures(state.run).includes(wrong.fails), `${JSON.stringify(wrong.inputs)} should fail by "${wrong.fails}", it failed by ${JSON.stringify(failures(state.run))}`);
    }
  });

  test(`${id}: inRealLife[0] is the rule file for the solution`, () => {
    const rule = replay(level, level.solution).rule;
    assert.equal(level.inRealLife[0].code, ruleYaml(level, rule));
  });

  test(`${id}: the same level gives the same day every time`, () => {
    const a = generate(level);
    const b = generate(level);
    assert.deepEqual(a, b);
    const counters = a.value || a.counter || a.count || a.requests;
    assert.ok(counters.every(whole), 'scraped values are whole numbers');
  });
}

// ---------------------------------------------------- the lesson of each shipped level

// For the levels as shipped: no rule of the kind the lesson warns about can win.
const TRAPS = {
  'np-02': ['no rule without for: wins', (rule) => rule.for === 0],
  'np-03': ['no rule on the raw counter wins', (rule) => rule.measure === 'value'],
  'np-04': ['no rule on the average wins', (rule) => rule.measure === 'avg'],
  'np-05': ['no rule on errors per second wins', (rule) => rule.measure === 'rate'],
  'np-06': ['no threshold on the request rate wins', (rule) => rule.measure === 'rate'],
  'np-07': ['no burn-rate rule without a short range wins', (rule) => rule.measure === 'burn' && !rule.short],
};
for (const [id, [name, isTrap]] of Object.entries(TRAPS)) {
  const level = levels.find((l) => l.id === id);
  if (!level) continue;
  test(`${id}: ${name}`, () => {
    const winners = allRules(level).filter(isTrap).filter((rule) => evaluate(level, rule).won);
    assert.deepEqual(winners, []);
  });
}

// ---------------------------------------------------------------- the rules themselves

// A small made-up level: a flat gauge at 10 with one incident at 01:00 that adds 100.
function gaugeLevel(extra) {
  return {
    id: 'x', kind: 'gauge', metric: 'm', seed: 1, noise: 0, shape: [[0, 10], [24, 10]],
    incidents: [{ start: '01:00', minutes: 30, deadline: 10, add: 100 }],
    measures: { value: { min: 0, max: 200, step: 10, start: 50 }, up: {}, absent: {} },
    fors: [0, 2, 5, 15], rule: { measure: 'value', for: 0 },
    alert: { name: 'X', summary: 'x' }, solution: ['run'], ...extra,
  };
}

test('for: keeps the alert pending, then it fires once the condition has held that long', () => {
  const run = replay(gaugeLevel(), ['for 5', 'run']).run;
  assert.equal(run.states[59], 0, 'inactive before');
  assert.equal(run.states[60], 1, 'pending from the first true minute');
  assert.equal(run.states[64], 1, 'still pending after 4 minutes');
  assert.equal(run.states[65], 2, 'firing after 5 minutes');
  assert.equal(run.incidents[0].delay, 5);
  assert.equal(run.states[90], 0, 'stops when the condition is false');
});

test('a spike shorter than for: never pages', () => {
  const level = gaugeLevel({ spikes: [{ start: '05:00', minutes: 4, add: 100 }] });
  assert.equal(replay(level, ['run']).run.falsePages.length, 1, 'without for: the spike pages');
  assert.equal(replay(level, ['for 5', 'run']).run.falsePages.length, 0, 'with for: 5m it does not');
});

test('a page outside every incident is a false page; a page after the deadline is late', () => {
  const level = gaugeLevel({ spikes: [{ start: '05:00', minutes: 1, add: 100 }] });
  const run = replay(level, ['for 15', 'run']).run;
  assert.equal(run.falsePages.length, 0);
  assert.equal(run.incidents[0].delay, 15);
  assert.equal(run.incidents[0].ok, false, 'deadline 10, paged after 15');
  assert.equal(replay(level, ['run']).run.falsePages[0].at, 300);
  const onTime = gaugeLevel({ fors: [0, 10] });
  assert.equal(replay(onTime, ['for 10', 'run']).status, 'won', 'paged exactly at the deadline is in time');
});

test('an alert that stops and fires again inside one incident pages twice: flapping loses', () => {
  // The incident lifts the gauge from 10 to 110, but it dips to 30 for minute 10 only.
  const level = gaugeLevel({ spikes: [{ start: '01:10', minutes: 1, add: -80 }] });
  const run = replay(level, ['run']).run;
  assert.equal(run.pages.length, 2);
  assert.equal(run.incidents[0].ok, true, 'the first page was in time');
  assert.equal(run.incidents[0].repeats, 1);
  assert.deepEqual(run.pages.map((page) => page.kind), ['ok', 'repeat']);
  assert.equal(run.won, false);
  assert.equal(replay(level, ['for 2', 'run']).status, 'lost', 'for: does not help: the dip resets it');
  assert.equal(replay(level, ['threshold 20', 'run']).status, 'won', 'a threshold below the dip pages once');
});

test('stars: three for the solution\'s total delay, two within 5 more per incident, else one', () => {
  const level = gaugeLevel({ incidents: [{ start: '01:00', minutes: 30, deadline: 20, add: 100 }], fors: [0, 2, 5, 15] });
  assert.equal(stars(replay(level, ['run'])), 3);
  assert.equal(stars(replay(level, ['for 5', 'run'])), 2);
  assert.equal(stars(replay(level, ['for 15', 'run'])), 1);
});

test('no data never crosses a threshold; up and absent see the gap', () => {
  const level = gaugeLevel({
    measures: { value: { op: '<', min: 0, max: 200, step: 5, start: 5 }, up: {}, absent: {} },
    gaps: [{ start: '01:00', minutes: 30 }],
  });
  assert.equal(replay(level, ['run']).run.pages.length, 0, 'value < 5 never fires on missing data');
  const up = series(level, { measure: 'up' }).values;
  const absent = series(level, { measure: 'absent' }).values;
  assert.deepEqual([up[59], up[60], up[89], up[90]], [1, 0, 0, 1]);
  assert.deepEqual([absent[59], absent[60], absent[90]], [null, 1, null]);
  assert.equal(replay(level, ['measure up', 'run']).status, 'won');
  assert.equal(replay(level, ['measure absent', 'run']).status, 'won');
});

test('rate() copes with a counter reset', () => {
  const level = {
    id: 'x', kind: 'counter', metric: 'm', seed: 1, noise: 0, shape: [[0, 60], [24, 60]],
    counterStart: 5000, resets: ['06:00'], incidents: [], ranges: [5],
  };
  const rate = series(level, { measure: 'rate', range: 5 }).values;
  for (const t of [100, 359, 360, 361, 364, 600]) assert.equal(rate[t], 1, `at minute ${t}`);
  const raw = series(level, { measure: 'value' }).values;
  assert.ok(raw[359] > 5000 && raw[360] === 60, 'the raw counter drops to zero at the reset');
});

test('rate() needs two samples in the range, so it stops soon after the data stops', () => {
  const level = {
    id: 'x', kind: 'counter', metric: 'm', seed: 1, noise: 0, shape: [[0, 60], [24, 60]],
    gaps: [{ start: '02:00', minutes: 30, restart: true }], incidents: [], ranges: [5],
  };
  const rate = series(level, { measure: 'rate', range: 5 }).values;
  assert.ok(rate[121] !== null, 'two old samples left: still a value');
  assert.equal(rate[123], null, 'one sample left: no result');
  assert.equal(rate[129], null);
});

test('histogram_quantile interpolates inside the bucket that holds the 99th percentile', () => {
  const level = {
    id: 'x', kind: 'latency', metric: 'm', seed: 1, noise: 0, shape: [[0, 1000], [24, 1000]],
    typical: [[0, 60], [24, 60]], tail: { permille: 15, ms: 400, noise: 0 }, slowMs: 1500,
    incidents: [], ranges: [5],
  };
  // 985 of 1000 requests take 60 ms (le 100), 15 take 400 ms (le 500).
  // rank 990 falls 5/15 of the way into the 250-500 bucket: 250 + 250/3.
  const p99 = series(level, { measure: 'p99', range: 5 }).values[600];
  assert.ok(Math.abs(p99 - (250 + 250 / 3)) < 1e-9, `p99 was ${p99}`);
  const avg = series(level, { measure: 'avg', range: 5 }).values[600];
  assert.ok(Math.abs(avg - (985 * 60 + 15 * 400) / 1000) < 1e-9, `avg was ${avg}`);
});

test('nothing changes after a win; an edit after a loss plays on', () => {
  const won = replay(gaugeLevel(), ['run']);
  assert.equal(won.status, 'won');
  assert.deepEqual(apply(won, 'for 5'), won);
  assert.equal(stars(won), 3);
  const lost = replay(gaugeLevel(), ['threshold 0', 'run']);
  assert.equal(lost.status, 'lost');
  const edited = apply(lost, 'threshold 50');
  assert.equal(edited.status, 'playing');
  assert.equal(edited.run, null, 'the old run is cleared');
});

test('an input the level does not offer is rejected', () => {
  const state = start(gaugeLevel());
  assert.throws(() => apply(state, 'threshold 55'));
  assert.throws(() => apply(state, 'for 3'));
  assert.throws(() => apply(state, 'measure p99'));
  assert.throws(() => apply(state, 'jump'));
});

test('the rule file leaves out for: when it is 0', () => {
  const level = gaugeLevel();
  assert.ok(!ruleYaml(level, start(level).rule).includes('for:'));
  assert.ok(ruleYaml(level, replay(level, ['for 5']).rule).includes('        for: 5m'));
});
