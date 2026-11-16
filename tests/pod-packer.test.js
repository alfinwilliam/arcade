// Tests for Pod Packer.
// Part 1 checks every level in levels.js: the data is sane, the solution wins, lazy play does not.
// Part 2 checks the rules themselves on tiny made-up levels.

import { test, assert } from './harness.js';
import { levels } from '../site/games/pod-packer/levels.js';
import {
  MAX_NODES, start, apply, check, replay, fits, freeOn, stars, referenceBill,
  notices, comingNext, turnCost, patienceOf, cpuText, memText,
} from '../site/games/pod-packer/logic.js';

// ------------------------------------------------------------------ helpers

// A tiny level for rule tests. Pass only the fields a test cares about.
function tiny(overrides) {
  return {
    id: 'x', title: 'x', hint: 'x', lesson: 'x', turns: 2, maxBill: 1000, patience: 0,
    nodeTypes: {
      small: { cpu: 2000, mem: 4096, price: 10 },
      spot: { cpu: 2000, mem: 4096, price: 4, spot: true },
      gpu: { cpu: 2000, mem: 8192, price: 40, taint: 'gpu', label: 'gpu' },
    },
    arrivals: [{ turn: 1, pods: [{ id: 'a', cpu: 1000, mem: 1024 }] }],
    events: [],
    solution: [],
    ...overrides,
  };
}

// An empty node of one of a level's types, for asking "could this pod ever run here?".
function emptyNode(level, typeName) {
  const type = level.nodeTypes[typeName];
  return { id: 'n1', type: typeName, cpu: type.cpu, mem: type.mem, taint: type.taint || '', label: type.label || '', pods: [] };
}

function allPods(level) {
  return level.arrivals.flatMap((wave) => wave.pods);
}

function cheapestTypeFor(level, pod) {
  const names = Object.keys(level.nodeTypes)
    .filter((name) => fits(pod, emptyNode(level, name)).ok)
    .sort((a, b) => level.nodeTypes[a].price - level.nodeTypes[b].price);
  return names[0];
}

// The naive player: a brand new node for every pod (the cheapest type it can run on),
// never shares a node, never drains. Returns the final state.
function playNaive(level) {
  let state = start(level);
  while (state.status === 'playing') {
    for (const pod of state.pending) {
      state = apply(state, `buy ${cheapestTypeFor(level, pod)}`);
      state = apply(state, `place ${pod.id} n${state.nextNode - 1}`);
    }
    state = apply(state, 'end');
  }
  return state;
}

function isWholeNumber(value) {
  return Number.isInteger(value) && value >= 0;
}

// ------------------------------------------------- part 1: the real levels

test('there are at least six levels, with unique ids', () => {
  const ids = levels.map((level) => level.id);
  assert.ok(levels.length >= 6);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('pp-')));
});

for (const level of levels) {
  test(`${level.id}: the data is complete and uses whole numbers`, () => {
    assert.ok(level.title && level.hint && level.lesson, 'title, hint and lesson');
    assert.ok(level.turns >= 3 && level.turns <= 6, 'between 3 and 6 turns');
    assert.ok(isWholeNumber(level.maxBill) && isWholeNumber(level.patience));
    for (const type of Object.values(level.nodeTypes)) {
      assert.ok(isWholeNumber(type.cpu) && isWholeNumber(type.mem) && isWholeNumber(type.price));
    }
    for (const pod of allPods(level)) {
      assert.ok(isWholeNumber(pod.cpu) && isWholeNumber(pod.mem), `${pod.id} cpu and mem`);
      assert.ok(pod.runs === undefined || pod.runs >= 1, `${pod.id} runs`);
      assert.ok(!pod.id.includes(' '), `${pod.id} has no spaces`);
    }
  });

  test(`${level.id}: pod ids are unique and every pod can run on some node type`, () => {
    const ids = allPods(level).map((pod) => pod.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const pod of allPods(level)) {
      assert.ok(cheapestTypeFor(level, pod), `${pod.id} fits on no node type`);
    }
  });

  test(`${level.id}: arrivals and events are inside the level, and only spot types are reclaimed`, () => {
    for (const wave of level.arrivals) assert.ok(wave.turn >= 1 && wave.turn <= level.turns);
    for (const event of level.events) {
      assert.ok(event.turn >= 1 && event.turn <= level.turns);
      assert.ok(level.nodeTypes[event.reclaim] && level.nodeTypes[event.reclaim].spot, `${event.reclaim} is not a spot type`);
    }
  });

  test(`${level.id}: every move of the solution is accepted`, () => {
    let state = start(level);
    for (const move of level.solution) {
      const verdict = check(state, move);
      assert.ok(verdict.ok, `"${move}" on turn ${state.turn}: ${verdict.reason}`);
      state = apply(state, move);
    }
  });

  test(`${level.id}: the solution wins, within the cap, in exactly the level's turns`, () => {
    const end = replay(level, level.solution);
    assert.equal(end.status, 'won');
    assert.ok(end.bill <= level.maxBill, `bill ${end.bill} is over the cap ${level.maxBill}`);
    assert.equal(level.solution.filter((move) => move === 'end').length, level.turns);
    assert.equal(stars(end), 3);
  });

  test(`${level.id}: the cap leaves room for a win that is not perfect`, () => {
    assert.ok(level.maxBill * 100 > referenceBill(level) * 115);
  });

  test(`${level.id}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
    const justEnding = Array.from({ length: level.turns }, () => 'end');
    assert.equal(replay(level, justEnding).status, 'lost');
  });

  test(`${level.id}: the solution without its last move has not won`, () => {
    assert.equal(replay(level, level.solution.slice(0, -1)).status, 'playing');
  });

  test(`${level.id}: a naive player with one node per pod does not win`, () => {
    assert.equal(playNaive(level).status, 'lost');
  });
}

// ------------------------------------------- part 2: fits(), the scheduler rule

const smallNode = { id: 'n1', type: 'small', cpu: 2000, mem: 4096, taint: '', label: '', pods: [] };
const gpuNode = { id: 'n2', type: 'gpu', cpu: 2000, mem: 8192, taint: 'gpu', label: 'gpu', pods: [] };

test('fits: a pod that fits on both CPU and memory is accepted', () => {
  assert.deepEqual(fits({ id: 'a', cpu: 1000, mem: 1024 }, smallNode), { ok: true, reason: '' });
});

test('fits: an exact fit is accepted', () => {
  assert.ok(fits({ id: 'a', cpu: 2000, mem: 4096 }, smallNode).ok);
});

test('fits: too much CPU is rejected even when memory fits', () => {
  const verdict = fits({ id: 'a', cpu: 2500, mem: 512 }, smallNode);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason.includes('Insufficient cpu'));
  assert.ok(!verdict.reason.includes('Insufficient memory'));
});

test('fits: too much memory is rejected even when CPU fits', () => {
  const verdict = fits({ id: 'a', cpu: 500, mem: 5000 }, smallNode);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason.includes('Insufficient memory'));
  assert.ok(!verdict.reason.includes('Insufficient cpu'));
});

test('fits: what counts is what the pods already there have left', () => {
  const busy = { ...smallNode, pods: [{ id: 'b', cpu: 1500, mem: 1024 }] };
  assert.deepEqual(freeOn(busy), { cpu: 500, mem: 3072 });
  assert.ok(fits({ id: 'a', cpu: 500, mem: 3072 }, busy).ok);
  assert.ok(fits({ id: 'a', cpu: 1000, mem: 1024 }, busy).reason.includes('Insufficient cpu'));
});

test('fits: a tainted node rejects a pod without the toleration, however much room there is', () => {
  const verdict = fits({ id: 'a', cpu: 100, mem: 100 }, gpuNode);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason.includes('taint'));
});

test('fits: a toleration lets a pod onto the tainted node', () => {
  assert.ok(fits({ id: 'a', cpu: 100, mem: 100, tolerates: 'gpu' }, gpuNode).ok);
});

test('fits: a toleration does not send the pod there: it may still go on a plain node', () => {
  assert.ok(fits({ id: 'a', cpu: 100, mem: 100, tolerates: 'gpu' }, smallNode).ok);
});

test('fits: a node selector is what rules out the other nodes', () => {
  const verdict = fits({ id: 'a', cpu: 100, mem: 100, tolerates: 'gpu', needs: 'gpu' }, smallNode);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason.includes('node selector'));
});

test('fits: a node selector without the toleration still cannot get past the taint', () => {
  const verdict = fits({ id: 'a', cpu: 100, mem: 100, needs: 'gpu' }, gpuNode);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reason.includes('taint'));
});

test('fits: a toleration for a different taint does not help', () => {
  assert.equal(fits({ id: 'a', cpu: 100, mem: 100, tolerates: 'other' }, gpuNode).ok, false);
});

test('units are written as CPUs and Mi/Gi', () => {
  assert.equal(cpuText(500), '0.5 CPU');
  assert.equal(cpuText(2000), '2 CPU');
  assert.equal(memText(512), '512Mi');
  assert.equal(memText(3072), '3Gi');
  assert.equal(memText(1536), '1.5Gi');
});

// ------------------------------------------------- part 2: buying and placing

test('nodes are named n1, n2, ... in the order bought, and a name is never reused', () => {
  const state = replay(tiny(), ['buy small', 'buy gpu', 'drain n1', 'buy spot']);
  assert.deepEqual(state.nodes.map((node) => `${node.id}:${node.type}`), ['n2:gpu', 'n3:spot']);
});

test('placing moves the pod from Pending onto the node', () => {
  const state = replay(tiny(), ['buy small', 'place a n1']);
  assert.equal(state.pending.length, 0);
  assert.deepEqual(state.nodes[0].pods.map((pod) => pod.id), ['a']);
});

test('apply returns a new state and leaves the old one alone', () => {
  const before = apply(start(tiny()), 'buy small');
  const after = apply(before, 'place a n1');
  assert.equal(before.pending.length, 1);
  assert.equal(before.nodes[0].pods.length, 0);
  assert.equal(after.nodes[0].pods.length, 1);
});

test('moves that make no sense are rejected with a reason', () => {
  const state = apply(start(tiny()), 'buy small');
  for (const move of ['buy huge', 'place a n7', 'place nobody n1', 'drain n7', 'dance', '',
    'buy', 'buy small now', 'place a', 'place a n1 extra', 'drain', 'end now', 'buy constructor']) {
    assert.equal(check(state, move).ok, false, move);
    assert.ok(check(state, move).reason.length > 0, move);
    assert.throws(() => apply(state, move), move);
  }
});

test('a pod that does not fit is rejected and nothing changes', () => {
  const level = tiny({ arrivals: [{ turn: 1, pods: [{ id: 'a', cpu: 1500, mem: 512 }, { id: 'b', cpu: 1500, mem: 512 }] }] });
  const state = replay(level, ['buy small', 'place a n1']);
  assert.ok(check(state, 'place b n1').reason.includes('Insufficient cpu'));
  assert.throws(() => apply(state, 'place b n1'));
});

test(`at most ${MAX_NODES} nodes can be alive at once`, () => {
  const state = replay(tiny(), Array.from({ length: MAX_NODES }, () => 'buy spot'));
  assert.equal(check(state, 'buy spot').ok, false);
  assert.ok(check(apply(state, 'drain n1'), 'buy spot').ok);
});

// --------------------------------------------------- part 2: ending the turn

test('ending a turn bills every live node, and shows up in turnCost first', () => {
  const state = replay(tiny(), ['buy small', 'buy gpu', 'place a n1']);
  assert.equal(turnCost(state), 50);
  const next = apply(state, 'end');
  assert.equal(next.bill, 50);
  assert.equal(next.turn, 2);
  assert.equal(apply(next, 'end').bill, 100);
});

test('a node that was drained before the turn ended is not billed', () => {
  const state = replay(tiny(), ['buy small', 'buy gpu', 'drain n2', 'place a n1', 'end']);
  assert.equal(state.bill, 10);
});

test('a bill over the cap loses, a bill equal to the cap does not', () => {
  const over = replay(tiny({ maxBill: 19 }), ['buy small', 'place a n1', 'end', 'end']);
  assert.equal(over.status, 'lost');
  assert.ok(over.lostReason.includes('₹20'));
  const exact = replay(tiny({ maxBill: 20 }), ['buy small', 'place a n1', 'end', 'end']);
  assert.equal(exact.status, 'won');
});

test('with patience 0, a pod left Pending at the end of a turn loses', () => {
  const state = replay(tiny(), ['end']);
  assert.equal(state.status, 'lost');
  assert.ok(state.lostReason.includes('a was still Pending'));
});

test('with patience 1, a pod may be Pending for one turn end but not two', () => {
  const level = tiny({ turns: 3, patience: 1 });
  assert.equal(replay(level, ['end']).status, 'playing');
  assert.equal(replay(level, ['end']).pending[0].waited, 1);
  assert.equal(replay(level, ['end', 'end']).status, 'lost');
  assert.equal(replay(level, ['end', 'buy small', 'place a n1', 'end', 'end']).status, 'won');
});

test("a pod's own patience replaces the level's", () => {
  const pods = [{ id: 'a', cpu: 1000, mem: 1024, patience: 1 }, { id: 'b', cpu: 1000, mem: 1024 }];
  const level = tiny({ turns: 3, arrivals: [{ turn: 1, pods }] });
  assert.equal(patienceOf(level, pods[0]), 1);
  assert.equal(patienceOf(level, pods[1]), 0);
  assert.equal(replay(level, ['buy small', 'place b n1', 'end']).status, 'playing');
  assert.equal(replay(level, ['buy small', 'place a n1', 'end']).status, 'lost');
});

test('a pod still Pending when the last turn ends loses, even with patience left', () => {
  const level = tiny({ turns: 1, patience: 5 });
  assert.equal(replay(level, ['end']).status, 'lost');
});

test('new pods arrive at the start of their turn, and comingNext shows them a turn early', () => {
  const level = tiny({ turns: 3, arrivals: [
    { turn: 1, pods: [{ id: 'a', cpu: 1000, mem: 1024 }] },
    { turn: 2, pods: [{ id: 'b', cpu: 500, mem: 512 }] },
  ] });
  const first = replay(level, ['buy small', 'place a n1']);
  assert.deepEqual(comingNext(first).map((pod) => pod.id), ['b']);
  const second = apply(first, 'end');
  assert.deepEqual(second.pending.map((pod) => pod.id), ['b']);
  assert.deepEqual(comingNext(second), []);
});

test('surviving the last turn wins, and nothing changes after that', () => {
  const won = replay(tiny(), ['buy small', 'place a n1', 'end', 'end']);
  assert.equal(won.status, 'won');
  assert.deepEqual(apply(won, 'end'), won);
  assert.equal(check(won, 'buy small').ok, false);
});

// ------------------------------------------------------------ part 2: jobs

test('a job finishes after running for `runs` turn ends and frees its room', () => {
  const level = tiny({ turns: 3, arrivals: [{ turn: 1, pods: [{ id: 'job', cpu: 2000, mem: 1024, runs: 2 }] }] });
  const one = replay(level, ['buy small', 'place job n1', 'end']);
  assert.equal(one.nodes[0].pods[0].runs, 1);
  const two = apply(one, 'end');
  assert.equal(two.nodes[0].pods.length, 0);
  assert.deepEqual(freeOn(two.nodes[0]), { cpu: 2000, mem: 4096 });
  assert.ok(two.news.some((line) => line.includes('job finished')));
});

test('a Pending job makes no progress', () => {
  const level = tiny({ turns: 3, patience: 1, arrivals: [{ turn: 1, pods: [{ id: 'job', cpu: 1000, mem: 1024, runs: 1 }] }] });
  const waited = replay(level, ['end']);
  assert.equal(waited.pending[0].runs, 1);
});

// ----------------------------------------------------------- part 2: drain

test('draining evicts the pods back to Pending and removes the node', () => {
  const state = replay(tiny(), ['buy small', 'place a n1', 'drain n1']);
  assert.equal(state.nodes.length, 0);
  assert.deepEqual(state.pending.map((pod) => pod.id), ['a']);
  assert.equal(replay(tiny(), ['buy small', 'place a n1', 'drain n1', 'end']).status, 'lost');
});

test('an evicted job is replaced by a fresh copy that starts its work again', () => {
  const level = tiny({ turns: 4, arrivals: [{ turn: 1, pods: [{ id: 'job', cpu: 1000, mem: 1024, runs: 2 }] }] });
  const ran = replay(level, ['buy small', 'place job n1', 'end']);
  assert.equal(ran.nodes[0].pods[0].runs, 1);
  const moved = replay(level, ['buy small', 'place job n1', 'end', 'buy small', 'drain n1', 'place job n2']);
  assert.equal(moved.nodes[0].pods[0].runs, 2);
  assert.equal(apply(moved, 'end').nodes[0].pods.length, 1, 'still running after one more turn end');
});

test('an evicted pod waits afresh: earlier waiting does not count against it', () => {
  const level = tiny({ turns: 4, patience: 1 });
  const moves = ['end', 'buy small', 'place a n1', 'end', 'drain n1'];
  assert.equal(replay(level, moves).pending[0].waited, 0);
  assert.equal(replay(level, [...moves, 'end']).status, 'playing');
  assert.equal(replay(level, [...moves, 'end', 'end']).status, 'lost');
});

test('a drained pod can be placed again on another node in the same turn', () => {
  const state = replay(tiny(), ['buy small', 'place a n1', 'buy small', 'drain n1', 'place a n2', 'end']);
  assert.equal(state.status, 'playing');
  assert.equal(state.bill, 10);
});

// ----------------------------------------------------- part 2: spot reclaim

const spotLevel = tiny({
  turns: 3,
  arrivals: [{ turn: 1, pods: [{ id: 'a', cpu: 1000, mem: 1024 }, { id: 'b', cpu: 1000, mem: 1024 }] }],
  events: [{ turn: 2, reclaim: 'spot' }],
});

test('a reclaim is announced during its own turn and not before', () => {
  const first = replay(spotLevel, ['buy spot', 'buy small', 'place a n1', 'place b n2']);
  assert.deepEqual(notices(first), []);
  assert.deepEqual(notices(apply(first, 'end')), [{ type: 'spot', nodeIds: ['n1'] }]);
});

test('a reclaim takes every node of that type, evicts their pods and leaves other nodes alone', () => {
  const level = { ...spotLevel, patience: 1 };
  const state = replay(level, ['buy spot', 'buy small', 'place a n1', 'place b n2', 'end', 'end']);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.nodes.map((node) => node.id), ['n2']);
  assert.deepEqual(state.pending.map((pod) => pod.id), ['a']);
  assert.equal(state.pending[0].waited, 1);
});

test('with patience 0, pods still on a reclaimed node lose the level', () => {
  const state = replay(spotLevel, ['buy spot', 'place a n1', 'place b n1', 'end', 'end']);
  assert.equal(state.status, 'lost');
});

test('moving the pods off the spot node before the turn ends survives the reclaim', () => {
  const moves = ['buy spot', 'place a n1', 'place b n1', 'end',
    'buy small', 'drain n1', 'place a n2', 'place b n2', 'end', 'end'];
  const state = replay(spotLevel, moves);
  assert.equal(state.status, 'won');
  assert.equal(state.bill, 4 + 10 + 10);
});

// ------------------------------------------------------------ part 2: stars

test('stars: 3 at the reference bill, 2 within 15 percent, otherwise 1, and 0 without a win', () => {
  // The reference bill of this level is 100: one node at 50 for two turns.
  const level = tiny({
    nodeTypes: { small: { cpu: 2000, mem: 4096, price: 50 }, extra: { cpu: 100, mem: 100, price: 15 }, more: { cpu: 100, mem: 100, price: 16 } },
    solution: ['buy small', 'place a n1', 'end', 'end'],
  });
  assert.equal(referenceBill(level), 100);
  assert.equal(stars(replay(level, level.solution)), 3);
  assert.equal(stars(replay(level, ['buy small', 'place a n1', 'buy extra', 'end', 'drain n2', 'end'])), 2);   // 115
  assert.equal(stars(replay(level, ['buy small', 'place a n1', 'buy more', 'end', 'drain n2', 'end'])), 1);    // 116
  assert.equal(stars(replay(level, ['buy small'])), 0);
  assert.equal(stars(replay(level, ['end'])), 0);
});
