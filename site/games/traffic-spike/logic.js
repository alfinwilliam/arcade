// RULES for Traffic Spike. Pure: no page, no storage, no timers, no randomness.
// Everything is whole-number maths, so the tests, the page and every browser get
// exactly the same answer from the same inputs.
//
// The idea in one paragraph:
//   Requests enter the lane at position 0 and move `rules.speed` units every tick.
//   The lane is cut into slots of `rules.slotUnits` units. A component sits in a slot
//   and, each tick, handles up to its `rate` of the requests that are inside its slot.
//   A legitimate request that walks off the far end unanswered is an error.
//   More errors than the level's `errorBudget` loses. Clearing every wave wins.
//
// The state is plain data. The functions below never edit the state they are given;
// they return a new one.

import { towers, kinds, rules } from './levels.js';

// A safety stop for replay(), so bad level data can never hang the page.
const MAX_REPLAY_TICKS = 100000;

// ---------------------------------------------------------------- small helpers

// Length of the whole lane, in units.
export function laneLength(level) {
  return level.slots * rules.slotUnits;
}

// The wave being played (state.wave counts from 1, like the solutions do).
export function currentWave(state) {
  return state.level.waves[state.wave - 1];
}

// How many requests one queue is holding.
export function heldCount(tower) {
  let total = 0;
  for (const group of tower.held) total += group.count;
  return total;
}

// How many requests are still on the lane or waiting in a queue.
export function inFlight(state) {
  let total = 0;
  for (const group of state.lane) total += group.count;
  for (const tower of state.slots) if (tower) total += heldCount(tower);
  return total;
}

function copy(state) {
  return {
    ...state,
    lane: state.lane.map((group) => ({ ...group })),
    slots: state.slots.map((tower) => (tower ? { ...tower, held: tower.held.map((group) => ({ ...group })) } : null)),
    rejected: state.rejected.slice(),
    missed: { ...state.missed },
  };
}

// ---------------------------------------------------------------- start

// The state at the start of a level.
export function start(level) {
  return {
    level,
    status: 'playing',          // 'playing', 'won' or 'lost'
    wave: 1,                    // which wave we are in, counting from 1
    t: 0,                       // ticks since this wave began
    money: level.budget,        // rupees
    errors: 0,                  // legitimate requests that got no answer
    missed: {},                 // the same errors counted per kind, e.g. { api: 4 }
    answered: 0,                // legitimate requests that did
    lane: [],                   // groups of requests: { kind, pos, count }
    slots: new Array(level.slots).fill(null),   // null, or { kind, held, done, boughtWave, boughtT }
    rejected: [],               // actions that were refused: { action, reason }
    // What happened in the most recent tick. The page uses these for feedback only.
    worked: new Array(level.slots).fill(0),     // requests each slot handled
    gone: [],                   // what the components took off the lane: { kind, pos, count }
    newErrors: 0,
    paid: 0,                    // reward paid for a wave that just ended
  };
}

// ---------------------------------------------------------------- actions (buy and sell)

// What selling the component in `slot` would give back, in rupees.
// Sold in the same moment it was bought, it is a full refund (an undo).
export function refundFor(state, slot) {
  const tower = state.slots[slot];
  if (!tower) return 0;
  const cost = towers[tower.kind].cost;
  const justBought = tower.boughtWave === state.wave && tower.boughtT === state.t;
  return justBought ? cost : Math.floor((cost * rules.sellPercent) / 100);
}

function whyNotBuy(state, action) {
  const tower = towers[action.buy];
  if (!tower || !state.level.shop.includes(action.buy)) return `This level does not sell "${action.buy}".`;
  if (state.slots[action.slot]) return 'That slot is taken. Sell what is in it first.';
  if (state.money < tower.cost) return `Not enough money: that costs ₹${tower.cost} and you have ₹${state.money}.`;
  return '';
}

function whyNotSell(state, action) {
  const tower = state.slots[action.slot];
  if (!tower) return 'That slot is empty.';
  if (tower.kind !== action.sell) return `That slot holds a ${tower.kind}, not a ${action.sell}.`;
  if (heldCount(tower) > 0) return 'The queue is still holding requests. Let it empty first.';
  return '';
}

// Why an action is not allowed right now. An empty string means it is allowed.
export function whyNot(state, action) {
  if (state.status !== 'playing') return 'The level is over.';
  if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot >= state.level.slots) {
    return 'There is no such slot.';
  }
  if (action.buy !== undefined) return whyNotBuy(state, action);
  if (action.sell !== undefined) return whyNotSell(state, action);
  return 'An action must buy or sell something.';
}

// Add the "when" to an action: the wave and the tick it happens at.
export function stamp(state, action) {
  return { wave: state.wave, t: state.t, ...action };
}

// The one way the player changes the state. The page calls this for every buy and
// sell, and replay() calls it for every recorded action, so both follow the same rules.
// An action that is not allowed changes nothing except the `rejected` list.
export function apply(state, action) {
  const next = copy(state);
  const reason = whyNot(state, action);
  if (reason) {
    next.rejected.push({ action, reason });
    return next;
  }
  if (action.buy !== undefined) {
    next.money -= towers[action.buy].cost;
    next.slots[action.slot] = { kind: action.buy, held: [], done: 0, boughtWave: state.wave, boughtT: state.t };
  } else {
    next.money += refundFor(state, action.slot);
    next.slots[action.slot] = null;
  }
  return next;
}

// ---------------------------------------------------------------- one tick

// A group of requests walks off the far end of the lane.
function leave(state, group) {
  if (!kinds[group.kind].legit) return;
  state.errors += group.count;
  state.newErrors += group.count;
  state.missed[group.kind] = (state.missed[group.kind] || 0) + group.count;
}

// Step 1: everything on the lane moves forward. Whatever passes the end, leaves.
function moveRequests(state) {
  const end = laneLength(state.level);
  const staying = [];
  for (const group of state.lane) {
    group.pos += rules.speed;
    if (group.pos >= end) leave(state, group);
    else staying.push(group);
  }
  state.lane = staying;
}

// Step 2: while the wave is still sending, new requests appear at position 0.
function spawnRequests(state) {
  const wave = currentWave(state);
  if (state.t >= wave.ticks) return;
  for (const kind of Object.keys(wave.perTick)) {
    if (wave.perTick[kind] > 0) state.lane.push({ kind, pos: 0, count: wave.perTick[kind] });
  }
}

// Take up to `limit` requests out of one slot and return them as { kind, pos, count } groups.
// Only kinds in `takes` are touched. Order: the request nearest the exit first; among
// requests at the same position, the order of the `takes` list.
function takeFromSlot(state, slot, takes, limit) {
  const first = slot * rules.slotUnits;
  const last = first + rules.slotUnits;
  const here = state.lane.filter((group) => group.pos >= first && group.pos < last && takes.includes(group.kind));
  here.sort((a, b) => b.pos - a.pos || takes.indexOf(a.kind) - takes.indexOf(b.kind));

  const taken = [];
  let room = limit;
  for (const group of here) {
    if (room === 0) break;
    const count = Math.min(room, group.count);
    group.count -= count;
    room -= count;
    taken.push({ kind: group.kind, pos: group.pos, count });
  }
  state.lane = state.lane.filter((group) => group.count > 0);
  state.gone.push(...taken);
  return taken;
}

// Step 3: a queue lets out up to its rate, oldest first, at the start of the next slot.
function releaseFromQueue(state, slot) {
  const tower = state.slots[slot];
  const exitPos = (slot + 1) * rules.slotUnits;
  let room = towers.queue.rate;
  while (room > 0 && tower.held.length > 0) {
    const oldest = tower.held[0];
    const count = Math.min(room, oldest.count);
    oldest.count -= count;
    room -= count;
    if (oldest.count === 0) tower.held.shift();
    const group = { kind: oldest.kind, pos: exitPos, count };
    if (exitPos >= laneLength(state.level)) leave(state, group);
    else state.lane.push(group);
  }
}

// Step 4 for a queue: pull in everything in its slot, as long as there is room.
function fillQueue(state, slot) {
  const tower = state.slots[slot];
  const room = towers.queue.size - heldCount(tower);
  const taken = takeFromSlot(state, slot, towers.queue.takes, room);
  for (const group of taken) {
    tower.held.push({ kind: group.kind, count: group.count });
    state.worked[slot] += group.count;
  }
}

// Step 4 for a cache, limiter or server: handle up to `rate` requests. They are gone.
function handleRequests(state, slot) {
  const tower = state.slots[slot];
  const taken = takeFromSlot(state, slot, towers[tower.kind].takes, towers[tower.kind].rate);
  for (const group of taken) {
    tower.done += group.count;
    state.worked[slot] += group.count;
    if (kinds[group.kind].legit) state.answered += group.count;
  }
}

// Step 5: decide whether the level or the wave is over.
function finishTick(state) {
  if (state.errors > state.level.errorBudget) {
    state.status = 'lost';
    return;
  }
  const wave = currentWave(state);
  if (state.t < wave.ticks || inFlight(state) > 0) return;   // the wave is still going

  state.money += wave.reward;
  state.paid = wave.reward;
  if (state.wave === state.level.waves.length) {
    state.status = 'won';
  } else {
    state.wave += 1;
    state.t = 0;
  }
}

// Advance the game by one tick. Returns a new state.
export function tick(state) {
  if (state.status !== 'playing') return state;
  const next = copy(state);
  next.worked = new Array(next.level.slots).fill(0);
  next.gone = [];
  next.newErrors = 0;
  next.paid = 0;

  moveRequests(next);
  spawnRequests(next);
  next.slots.forEach((tower, slot) => {
    if (tower && tower.kind === 'queue') releaseFromQueue(next, slot);
  });
  next.slots.forEach((tower, slot) => {
    if (!tower) return;
    if (tower.kind === 'queue') fillQueue(next, slot);
    else handleRequests(next, slot);
  });
  next.t += 1;
  finishTick(next);
  return next;
}

// ---------------------------------------------------------------- replay and score

// Play a whole list of stamped actions from the start, running every wave to its end.
// Each action happens at its own { wave, t }. Returns the final state.
// An action whose moment never comes (for example, the level was lost first) is
// added to `rejected`, so a test can insist on a clean run.
export function replay(level, solution) {
  let state = start(level);
  const used = new Set();
  for (let i = 0; i < MAX_REPLAY_TICKS && state.status === 'playing'; i += 1) {
    for (const action of solution) {
      if (used.has(action) || action.wave !== state.wave || action.t !== state.t) continue;
      used.add(action);
      state = apply(state, action);
    }
    state = tick(state);
  }
  const missed = solution.filter((action) => !used.has(action));
  if (missed.length === 0) return state;
  const end = copy(state);
  for (const action of missed) end.rejected.push({ action, reason: 'Its moment never came.' });
  return end;
}

// Stars for a won level: fewer errors, more stars. The cut-offs are in levels.js.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const usedPercent = (state.errors * 100) / state.level.errorBudget;
  if (usedPercent <= rules.threeStarPercent) return 3;
  if (usedPercent <= rules.twoStarPercent) return 2;
  return 1;
}
