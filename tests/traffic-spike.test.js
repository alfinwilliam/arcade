// Tests for Traffic Spike.
// The first three tests pin down level ts-01, which the rules were modelled on.
// After that: checks on every level's data, every level's solution, then the rules one by one.

import { test, assert } from './harness.js';
import { levels, towers, kinds, rules } from '../site/games/traffic-spike/levels.js';
import {
  start, apply, tick, replay, stars, stamp, whyNot, refundFor, laneLength, heldCount, inFlight,
} from '../site/games/traffic-spike/logic.js';

// ---------------------------------------------------------------- helpers

// A small made-up level for rule tests. Pass only the fields you want to change.
function tiny(changes) {
  return {
    id: 'x', title: 'x', intro: 'x', slots: 2, budget: 1000, errorBudget: 1000,
    shop: ['server', 'cache', 'limiter', 'queue'],
    waves: [{ ticks: 1, perTick: { api: 1 }, reward: 0 }],
    solution: [],
    ...changes,
  };
}

function buy(kind, slot, wave = 1, t = 0) {
  return { wave, t, buy: kind, slot };
}

function sell(kind, slot, wave = 1, t = 0) {
  return { wave, t, sell: kind, slot };
}

function ticks(state, count) {
  let now = state;
  for (let i = 0; i < count; i += 1) now = tick(now);
  return now;
}

// How many requests of one kind are on the lane.
function onLane(state, kind) {
  let total = 0;
  for (const group of state.lane) if (group.kind === kind) total += group.count;
  return total;
}

// Every legitimate request a level sends, over all its waves.
function legitSent(level) {
  let total = 0;
  for (const wave of level.waves) {
    for (const kind of Object.keys(wave.perTick)) {
      if (kinds[kind].legit) total += wave.ticks * wave.perTick[kind];
    }
  }
  return total;
}

function byId(id) {
  return levels.find((level) => level.id === id);
}

// ---------------------------------------------------------------- the modelled level

test('ts-01: the reference build wins with no errors at all', () => {
  const end = replay(byId('ts-01'), byId('ts-01').solution);
  assert.equal(end.status, 'won');
  assert.equal(end.errors, 0);
  assert.equal(end.rejected.length, 0);
});

test('ts-01: the same parts with the server in slot 0 lose in wave 2', () => {
  const wrong = [buy('server', 0, 1), buy('cache', 3, 2), buy('limiter', 1, 3)];
  const end = replay(byId('ts-01'), wrong);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 2);
});

test('ts-01: doing nothing loses in wave 1', () => {
  const end = replay(byId('ts-01'), []);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 1);
});

test('ts-01: three servers and a cache, without the limiter, lose in wave 3', () => {
  // It costs every rupee the level pays, and 8 bots + 2 API calls a tick is still more than 3 x 3.
  const noLimiter = [buy('server', 3, 1), buy('cache', 0, 2), buy('server', 2, 2), buy('server', 1, 3)];
  const end = replay(byId('ts-01'), noLimiter);
  assert.deepEqual(end.rejected, []);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 3);
});

test('ts-01 and the components keep the numbers the tests above were worked out with', () => {
  const level = byId('ts-01');
  assert.deepEqual(
    { slots: level.slots, budget: level.budget, errorBudget: level.errorBudget, waves: level.waves },
    { slots: 4, budget: 100, errorBudget: 20, waves: [
      { ticks: 40, perTick: { api: 2 }, reward: 60 },
      { ticks: 40, perTick: { api: 2, static: 5 }, reward: 60 },
      { ticks: 40, perTick: { api: 2, static: 5, bot: 8 }, reward: 0 },
    ] },
  );
  assert.deepEqual([towers.cache.cost, towers.cache.rate, towers.cache.takes], [40, 6, ['static']]);
  assert.deepEqual([towers.limiter.cost, towers.limiter.rate, towers.limiter.takes], [40, 8, ['bot']]);
  assert.deepEqual([towers.server.cost, towers.server.rate, towers.server.takes], [60, 3, ['bot', 'static', 'api']]);
  assert.deepEqual([towers.queue.cost, towers.queue.rate, towers.queue.size], [30, 3, 80]);
  assert.deepEqual([rules.slotUnits, rules.speed], [10, 2]);
});

// ---------------------------------------------------------------- level data

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

test('level ids are unique and start with ts-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('ts-'), id);
});

test('every component has sensible whole numbers', () => {
  for (const name of Object.keys(towers)) {
    const tower = towers[name];
    assert.ok(Number.isInteger(tower.cost) && tower.cost > 0, `${name} cost`);
    assert.ok(Number.isInteger(tower.rate) && tower.rate > 0, `${name} rate`);
    assert.ok(tower.name && tower.does, `${name} needs a name and a "does" line`);
    for (const kind of tower.takes) assert.ok(kinds[kind], `${name} takes unknown kind ${kind}`);
  }
  assert.ok(Number.isInteger(towers.queue.size) && towers.queue.size > 0, 'queue size');
  assert.equal(rules.slotUnits % rules.speed, 0, 'slotUnits must be a multiple of speed');
});

for (const level of levels) {
  test(`${level.id}: the data is well formed`, () => {
    assert.ok(level.title && level.intro, 'title and intro');
    assert.ok(Number.isInteger(level.slots) && level.slots >= 1 && level.slots <= 5, 'slots must be 1 to 5');
    assert.ok(isCount(level.budget), 'budget');
    assert.ok(isCount(level.errorBudget), 'errorBudget');
    assert.ok(level.shop.length > 0, 'shop');
    for (const name of level.shop) assert.ok(towers[name], `shop sells unknown component ${name}`);
    assert.ok(level.waves.length > 0, 'waves');
    for (const wave of level.waves) {
      assert.ok(Number.isInteger(wave.ticks) && wave.ticks > 0, 'wave ticks');
      assert.ok(isCount(wave.reward), 'wave reward');
      for (const kind of Object.keys(wave.perTick)) {
        assert.ok(kinds[kind], `unknown kind ${kind}`);
        assert.ok(isCount(wave.perTick[kind]), `perTick ${kind}`);
      }
    }
  });

  test(`${level.id}: the solution wins, cleanly, with a quarter of the error budget spare`, () => {
    const end = replay(level, level.solution);
    assert.equal(end.status, 'won');
    assert.deepEqual(end.rejected, [], 'no action may be rejected');
    assert.ok(end.errors * 4 <= level.errorBudget * 3, `errors ${end.errors} of ${level.errorBudget}`);
    assert.ok(stars(end) >= 1);
  });

  test(`${level.id}: doing nothing loses in wave 1`, () => {
    const end = replay(level, []);
    assert.equal(end.status, 'lost');
    assert.equal(end.wave, 1);
  });

  test(`${level.id}: leaving out the first step of the solution does not win`, () => {
    assert.equal(replay(level, level.solution.slice(1)).status, 'lost');
  });

  test(`${level.id}: every legitimate request is either answered or an error`, () => {
    const end = replay(level, level.solution);
    assert.equal(end.answered + end.errors, legitSent(level));
    assert.equal(inFlight(end), 0);
  });

  test(`${level.id}: stepping tick by tick, the way the page does, matches replay`, () => {
    let state = start(level);
    while (state.status === 'playing') {
      for (const action of level.solution) {
        if (action.wave === state.wave && action.t === state.t) state = apply(state, action);
      }
      state = tick(state);
      assert.ok(Number.isInteger(state.money) && Number.isInteger(state.errors), 'whole numbers only');
      assert.ok(state.money >= 0, 'money never goes below zero');
    }
    assert.deepEqual(state, replay(level, level.solution));
  });
}

// ---------------------------------------------------------------- wrong builds on the real levels

test('ts-02: one cache cannot cover twice the static traffic', () => {
  const level = byId('ts-02');
  const withoutSecondCache = level.solution.filter((action) => !(action.wave === 2 && action.buy === 'cache'));
  const end = replay(level, withoutSecondCache);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 2);
});

test('ts-03: a queue behind the server is no help', () => {
  const end = replay(byId('ts-03'), [buy('server', 2, 1), buy('queue', 3, 2)]);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 2);
});

test('ts-03: a limiter behind the queue lets the bots fill the queue first', () => {
  const end = replay(byId('ts-03'), [buy('server', 3, 1), buy('queue', 0, 2), buy('limiter', 1, 3)]);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 3);
});

test('ts-05: two queues in a row cannot stand in for a second server', () => {
  // Wave 2 sends 6 API calls a tick for 40 ticks at one server (3 a tick). The queues
  // fill, and the requests at the back wait too long and give up.
  const stacked = [
    buy('cache', 0, 1), buy('cache', 1, 1), buy('server', 4, 1),
    sell('cache', 1, 2), buy('limiter', 1, 2), buy('queue', 2, 2), buy('queue', 3, 2),
  ];
  const end = replay(byId('ts-05'), stacked);
  assert.deepEqual(end.rejected, []);
  assert.equal(end.status, 'lost');
  assert.equal(end.wave, 2);
  assert.ok(end.timedOut > 0, 'the errors are requests giving up in the queues');
});

test('ts-04: cannot be won without selling', () => {
  const level = byId('ts-04');
  const end = replay(level, level.solution.filter((action) => action.buy !== undefined));
  assert.equal(end.status, 'lost');
  assert.ok(end.rejected.length > 0);
});

// ---------------------------------------------------------------- rules: movement and errors

test('a request crosses one slot in slotUnits / speed ticks, and the whole lane in order', () => {
  const level = tiny({ slots: 3 });
  const crossing = laneLength(level) / rules.speed;       // 15 ticks
  let state = ticks(start(level), crossing);
  assert.equal(state.errors, 0);                          // still on the last step of the lane
  assert.equal(onLane(state, 'api'), 1);
  state = tick(state);
  assert.equal(state.errors, 1);
  assert.equal(state.newErrors, 1);
});

test('a bot that reaches the exit is not an error', () => {
  const level = tiny({ errorBudget: 0, waves: [{ ticks: 3, perTick: { bot: 9 }, reward: 0 }] });
  const end = replay(level, []);
  assert.equal(end.status, 'won');
  assert.equal(end.errors, 0);
});

test('errors equal to the budget are allowed; one more loses', () => {
  const exactly = tiny({ errorBudget: 4, waves: [{ ticks: 2, perTick: { api: 2 }, reward: 0 }] });
  assert.equal(replay(exactly, []).status, 'won');
  const oneMore = tiny({ errorBudget: 3, waves: [{ ticks: 2, perTick: { api: 2 }, reward: 0 }] });
  const end = replay(oneMore, []);
  assert.equal(end.status, 'lost');
  assert.equal(end.errors, 4);
});

// ---------------------------------------------------------------- rules: components

test('a server handles at most its rate per tick', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 1, perTick: { api: 10 }, reward: 0 }] });
  let state = apply(start(level), buy('server', 0));
  state = tick(state);
  assert.equal(onLane(state, 'api'), 10 - towers.server.rate);
  assert.equal(state.worked[0], towers.server.rate);
  assert.equal(state.answered, towers.server.rate);
});

test('a server spends itself on bots first, then static, then api', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 1, perTick: { api: 2, static: 2, bot: 2 }, reward: 0 }] });
  let state = apply(start(level), buy('server', 0));
  state = tick(state);                                    // rate 3: both bots and one static
  assert.deepEqual([onLane(state, 'bot'), onLane(state, 'static'), onLane(state, 'api')], [0, 1, 2]);
  assert.equal(state.answered, 1);                        // the bots do not count as answered
});

test('a component works on the request nearest the exit first', () => {
  // Two ticks of 3 api each, then buy the server: the older group must go first.
  const level = tiny({ slots: 1, waves: [{ ticks: 2, perTick: { api: 3 }, reward: 0 }] });
  let state = ticks(start(level), 2);
  state = tick(apply(state, buy('server', 0, 1, 2)));
  const positions = state.lane.map((group) => group.pos);
  assert.deepEqual(positions, [rules.speed]);              // only the younger group is left
});

test('a cache answers static files and nothing else', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 1, perTick: { api: 2, static: 2, bot: 2 }, reward: 0 }] });
  const state = tick(apply(start(level), buy('cache', 0)));
  assert.deepEqual([onLane(state, 'bot'), onLane(state, 'static'), onLane(state, 'api')], [2, 0, 2]);
  assert.equal(state.answered, 2);
});

test('a rate limiter drops bots and nothing else', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 1, perTick: { api: 2, static: 2, bot: 2 }, reward: 0 }] });
  const state = tick(apply(start(level), buy('limiter', 0)));
  assert.deepEqual([onLane(state, 'bot'), onLane(state, 'static'), onLane(state, 'api')], [0, 2, 2]);
  assert.equal(state.answered, 0);
});

test('each tick reports what the components took, for the page to draw', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 2, perTick: { api: 2, bot: 1 }, reward: 0 }] });
  let state = tick(apply(start(level), buy('server', 0)));
  assert.deepEqual(state.gone, [{ kind: 'bot', pos: 0, count: 1 }, { kind: 'api', pos: 0, count: 2 }]);
  assert.deepEqual(state.worked, [3]);
  state = tick(state);
  assert.equal(state.gone.length, 2);                     // only the latest tick is kept
});

test('a component only touches requests inside its own slot', () => {
  const level = tiny({ slots: 2, waves: [{ ticks: 1, perTick: { api: 1 }, reward: 0 }] });
  let state = apply(start(level), buy('server', 1));
  state = ticks(state, rules.slotUnits / rules.speed);    // the request is on its last step in slot 0
  assert.equal(onLane(state, 'api'), 1);
  state = tick(state);                                    // now it enters slot 1
  assert.equal(onLane(state, 'api'), 0);
  assert.equal(state.slots[1].done, 1);
});

// ---------------------------------------------------------------- rules: the queue

test('a queue holds a burst and feeds the server behind it at its rate', () => {
  const level = tiny({ slots: 2, errorBudget: 0, waves: [{ ticks: 1, perTick: { api: 30 }, reward: 0 }] });
  let state = apply(apply(start(level), buy('queue', 0)), buy('server', 1));
  state = tick(state);
  assert.equal(heldCount(state.slots[0]), 30);
  assert.equal(onLane(state, 'api'), 0);
  state = tick(state);                                    // lets out 3, and the server answers them
  assert.equal(heldCount(state.slots[0]), 30 - towers.queue.rate);
  assert.equal(state.answered, towers.queue.rate);
  assert.equal(replay(level, [buy('queue', 0), buy('server', 1)]).status, 'won');
});

test('the same burst without the queue swamps the server', () => {
  const level = tiny({ slots: 2, errorBudget: 0, waves: [{ ticks: 1, perTick: { api: 30 }, reward: 0 }] });
  const end = replay(level, [buy('server', 1)]);
  assert.equal(end.status, 'lost');
});

test('a full queue lets the rest walk past', () => {
  const burst = towers.queue.size + 7;
  const level = tiny({ slots: 2, waves: [{ ticks: 1, perTick: { api: burst }, reward: 0 }] });
  const state = tick(apply(start(level), buy('queue', 0)));
  assert.equal(heldCount(state.slots[0]), towers.queue.size);
  assert.equal(onLane(state, 'api'), 7);
});

test('a queue in the last slot lets requests out straight into the exit', () => {
  const level = tiny({ slots: 1, waves: [{ ticks: 1, perTick: { api: 6 }, reward: 0 }] });
  const end = replay(level, [buy('queue', 0)]);
  assert.equal(end.errors, 6);
});

test('a queue lets requests out oldest first', () => {
  const level = tiny({ slots: 2, waves: [{ ticks: 2, perTick: { api: 3 }, reward: 0 }] });
  let state = apply(start(level), buy('queue', 0));
  state = ticks(state, 2);                                // took in 3, let out 0; then took in 3 more, let out 3
  assert.equal(heldCount(state.slots[0]), 3);
  assert.deepEqual(state.lane, [{ kind: 'api', pos: rules.slotUnits, count: 3, waited: 1 }]);
});

// Puts `count` requests of `kind` in a queue in slot 0, as if they had already waited `waited` ticks.
function queueHolding(kind, count, waited) {
  const level = tiny({ slots: 2, waves: [{ ticks: 1, perTick: { [kind]: count }, reward: 0 }] });
  const state = tick(apply(start(level), buy('queue', 0)));
  state.slots[0].held[0].waited = waited;                  // our own copy: tick() made it
  return state;
}

test('a request that has waited rules.patience ticks in a queue gives up on the next tick: an error', () => {
  const state = tick(queueHolding('api', 9, rules.patience));
  assert.equal(heldCount(state.slots[0]), 0);
  assert.equal(onLane(state, 'api'), 0);                   // gone, not let out
  assert.deepEqual([state.errors, state.timedOut, state.gaveUp[0], state.newErrors], [9, 9, 9, 0]);
  assert.deepEqual(state.missed, { api: 9 });
});

test('one tick less, and the queue still lets it out', () => {
  const state = tick(queueHolding('api', 9, rules.patience - 1));
  assert.equal(state.errors, 0);
  assert.equal(onLane(state, 'api'), towers.queue.rate);
  assert.equal(heldCount(state.slots[0]), 9 - towers.queue.rate);
});

test('a bot that gives up in a queue is not an error', () => {
  const state = tick(queueHolding('bot', 9, rules.patience));
  assert.equal(heldCount(state.slots[0]), 0);
  assert.deepEqual([state.errors, state.timedOut], [0, 0]);
});

test('waiting adds up across queues in a row, so a second queue does not reset it', () => {
  const level = tiny({ slots: 3, waves: [{ ticks: 1, perTick: { api: 9 }, reward: 0 }] });
  let state = apply(apply(start(level), buy('queue', 0)), buy('queue', 1));
  state = ticks(state, 2);                                 // the first queue lets 3 out into the second
  assert.deepEqual(state.slots[1].held, [{ kind: 'api', count: towers.queue.rate, waited: 1 }]);
});

test('a queue cannot fix traffic that stays above what the server behind it can answer', () => {
  // Twice what one server answers, for long enough that the backlog outlasts anyone's patience.
  const rate = towers.server.rate;
  const level = tiny({ slots: 2, waves: [{ ticks: rules.patience * 2, perTick: { api: rate * 2 }, reward: 0 }] });
  const queued = replay(level, [buy('queue', 0), buy('server', 1)]);
  assert.ok(queued.timedOut > 0, 'some give up waiting');
  // A second server, with no queue at all, answers every request.
  assert.equal(replay(level, [buy('server', 0), buy('server', 1)]).errors, 0);
});

// ---------------------------------------------------------------- rules: buying and selling

test('buying takes the cost and fills the slot', () => {
  const level = tiny({ budget: 100 });
  const state = apply(start(level), buy('server', 1));
  assert.equal(state.money, 100 - towers.server.cost);
  assert.equal(state.slots[1].kind, 'server');
  assert.equal(state.rejected.length, 0);
});

test('a rejected action changes nothing but the rejected list', () => {
  const level = tiny({ budget: 50, shop: ['server', 'cache'] });
  const before = start(level);
  const cases = [
    buy('server', 0),             // costs 60, have 50
    buy('limiter', 0),            // not sold in this level
    buy('nonsense', 0),           // not a component
    buy('cache', 2),              // no such slot
    buy('cache', -1),
    buy('cache', 0.5),
    sell('cache', 0),             // nothing there
    { wave: 1, t: 0, slot: 0 },   // neither buy nor sell
  ];
  for (const action of cases) {
    assert.ok(whyNot(before, action) !== '', JSON.stringify(action));
    const after = apply(before, action);
    assert.equal(after.rejected.length, 1);
    assert.deepEqual({ ...after, rejected: [] }, before);
  }
});

test('a taken slot cannot be bought again', () => {
  const state = apply(start(tiny({})), buy('cache', 0));
  const again = apply(state, buy('server', 0));
  assert.equal(again.rejected.length, 1);
  assert.equal(again.slots[0].kind, 'cache');
  assert.equal(again.money, state.money);
});

test('selling at once is a full refund; selling later gives back half', () => {
  const level = tiny({ budget: 100, waves: [{ ticks: 3, perTick: { bot: 1 }, reward: 0 }] });
  const bought = apply(start(level), buy('server', 0));
  assert.equal(refundFor(bought, 0), towers.server.cost);
  assert.equal(apply(bought, sell('server', 0)).money, 100);

  const later = tick(bought);
  assert.equal(refundFor(later, 0), (towers.server.cost * rules.sellPercent) / 100);
  const sold = apply(later, sell('server', 0, 1, 1));
  assert.equal(sold.money, 100 - towers.server.cost + 30);
  assert.equal(sold.slots[0], null);
});

test('selling must name what is in the slot', () => {
  const state = apply(start(tiny({})), buy('cache', 0));
  assert.equal(apply(state, sell('server', 0)).rejected.length, 1);
});

test('a queue that is holding requests cannot be sold', () => {
  const level = tiny({ slots: 2, waves: [{ ticks: 1, perTick: { api: 9 }, reward: 0 }] });
  const state = tick(apply(start(level), buy('queue', 0)));
  const after = apply(state, sell('queue', 0, 1, 1));
  assert.equal(after.rejected.length, 1);
  assert.equal(after.slots[0].kind, 'queue');
});

test('apply and tick never edit the state they are given', () => {
  const level = byId('ts-01');
  const before = apply(start(level), buy('server', 3));
  const snapshot = JSON.stringify(before);
  apply(before, buy('cache', 0));
  apply(before, sell('server', 3));
  ticks(before, 30);
  assert.equal(JSON.stringify(before), snapshot);
});

// ---------------------------------------------------------------- rules: waves, timing and the end

test('a wave ends only when the lane is clear; then it pays and the next one waits at t = 0', () => {
  const level = tiny({ slots: 1, budget: 60, waves: [
    { ticks: 2, perTick: { api: 1 }, reward: 25 },
    { ticks: 1, perTick: { api: 1 }, reward: 0 },
  ] });
  let state = apply(start(level), buy('server', 0));
  state = tick(state);
  assert.deepEqual([state.wave, state.t, state.money, state.paid], [1, 1, 0, 0]);
  state = tick(state);
  assert.deepEqual([state.wave, state.t, state.money, state.paid], [2, 0, 25, 25]);
  state = tick(state);
  assert.equal(state.status, 'won');
});

test('actions in the middle of a wave happen at their own tick', () => {
  // Nothing is in the lane's last slot until tick 6, so a server bought at t = 5 is in time.
  const level = tiny({ slots: 2, errorBudget: 0, waves: [{ ticks: 4, perTick: { api: 1 }, reward: 0 }] });
  assert.equal(replay(level, [buy('server', 1, 1, 5)]).status, 'won');
  // Bought after the first request has left, it is too late.
  assert.equal(replay(level, [buy('server', 1, 1, 12)]).status, 'lost');
});

test('an action whose moment never comes is reported as rejected', () => {
  const end = replay(byId('ts-01'), [buy('server', 3, 9, 0)]);
  assert.equal(end.status, 'lost');
  assert.equal(end.rejected.length, 1);
});

test('stamp adds the current wave and tick to an action', () => {
  const state = ticks(start(byId('ts-01')), 3);
  assert.deepEqual(stamp(state, { buy: 'cache', slot: 2 }), { wave: 1, t: 3, buy: 'cache', slot: 2 });
});

test('nothing changes after the level is over', () => {
  const level = byId('ts-01');
  const won = replay(level, level.solution);
  assert.deepEqual(tick(won), won);
  const after = apply(won, buy('cache', 2));
  assert.equal(after.rejected.length, 1);
  assert.equal(after.money, won.money);
  const lost = replay(level, []);
  assert.deepEqual(tick(lost), lost);
});

test('replaying the same actions twice gives exactly the same result', () => {
  for (const level of levels) {
    assert.deepEqual(replay(level, level.solution), replay(level, level.solution));
  }
});

test('stars follow the share of the error budget used', () => {
  const base = { ...start(tiny({ errorBudget: 20 })), status: 'won' };
  assert.equal(stars({ ...base, errors: 0 }), 3);
  assert.equal(stars({ ...base, errors: 5 }), 3);     // 25%
  assert.equal(stars({ ...base, errors: 6 }), 2);
  assert.equal(stars({ ...base, errors: 12 }), 2);    // 60%
  assert.equal(stars({ ...base, errors: 13 }), 1);
  assert.equal(stars({ ...base, errors: 20 }), 1);
  assert.equal(stars({ ...base, status: 'lost', errors: 0 }), 0);
});
