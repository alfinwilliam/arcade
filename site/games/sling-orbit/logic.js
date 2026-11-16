// RULES for Sling Orbit. Pure: no page, no storage, no timers, no randomness.
// The same launch always gives the same flight, in every browser and in the tests,
// because time moves in fixed ticks and the maths uses only + - * / and square root.
//
// The three inputs are launch(), brake() and step(). The page calls them while you
// play; replay() calls the very same functions for a recorded solution.

export const FIELD = 600;        // the field is FIELD x FIELD units; flying out of it loses
export const DT = 1 / 120;       // seconds of game time in one tick

// How forgiving a level must be. The tests check every level against these, and
// findForgivingLaunch() (at the bottom of this file) uses them too.
export const LAUNCH_SLACK = 2;   // every launch within +-2 of the solution must also win
export const BRAKE_SLACK = 12;   // brake taps up to 12 ticks early or late must also win

// ---------------------------------------------------------------- small helpers

function distance(x, y, point) {
  const dx = point[0] - x;
  const dy = point[1] - y;
  return Math.sqrt(dx * dx + dy * dy);
}

// The pull of every body on a ship at (x, y): gm / distance^2, towards the body.
function gravity(bodies, x, y) {
  let ax = 0;
  let ay = 0;
  for (const body of bodies) {
    const dx = body.at[0] - x;
    const dy = body.at[1] - y;
    const r = Math.sqrt(dx * dx + dy * dy);
    const pull = body.gm / (r * r);
    ax += (pull * dx) / r;
    ay += (pull * dy) / r;
  }
  return [ax, ay];
}

function copy(state) {
  return { ...state, brakes: [...state.brakes], done: [...state.done], held: [...state.held] };
}

// ------------------------------------------------------------------- the state

// The state at the start of a level: the ship sits still until it is launched.
export function start(level) {
  return {
    level,
    x: level.start[0],
    y: level.start[1],
    vx: 0,
    vy: 0,
    tick: 0,                              // ticks flown since the launch
    launched: false,
    launch: null,                         // the launch that was used, as [vx, vy]
    brakes: [],                           // the tick of every brake tap so far
    done: level.goals.map(() => false),   // one flag per goal
    held: level.goals.map(() => 0),       // ring goals: ticks in a row spent inside the band
    status: 'playing',                    // 'playing', 'won' or 'lost'
    reason: '',                           // why it was lost: 'crashed', 'left' or 'time'
  };
}

// Launches are whole numbers, and never faster than the level's maxSpeed.
// A launch that is too fast is shortened, keeping its direction.
export function clampLaunch(level, vector) {
  let vx = Math.round(vector[0]);
  let vy = Math.round(vector[1]);
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > level.maxSpeed) {
    vx = Math.trunc((vx * level.maxSpeed) / speed);
    vy = Math.trunc((vy * level.maxSpeed) / speed);
  }
  return [vx, vy];
}

// ------------------------------------------------------------------ the inputs

// Input 1: set the ship moving. Only the first launch counts.
export function launch(state, vector) {
  if (state.launched || state.status !== 'playing') return state;
  const [vx, vy] = clampLaunch(state.level, vector);
  return { ...copy(state), vx, vy, launched: true, launch: [vx, vy] };
}

// Input 2: one brake tap. It takes level.brake.dv off the speed without turning the ship.
// A tap with no taps left, or before the launch, does nothing.
export function brake(state) {
  if (!state.launched || state.status !== 'playing') return state;
  if (state.brakes.length >= state.level.brake.taps) return state;
  const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
  if (speed === 0) return state;
  const keep = Math.max(0, speed - state.level.brake.dv) / speed;
  const next = copy(state);
  next.vx = state.vx * keep;
  next.vy = state.vy * keep;
  next.brakes.push(state.tick);
  return next;
}

// Input 3: let one tick of time pass. Returns a new state and never edits the old one.
export function step(state) {
  if (!state.launched || state.status !== 'playing') return state;
  const next = copy(state);
  advance(next);
  return next;
}

// ------------------------------------------------------------- one tick of time

// Moves the ship by one tick, editing `s` in place. This is the "leapfrog" method:
// half a push from gravity, move, then the other half push from the new place.
// It keeps orbits steady for a long time, which a simpler "push, then move" does not.
function advance(s) {
  const bodies = s.level.bodies;
  let [ax, ay] = gravity(bodies, s.x, s.y);
  s.vx += (ax * DT) / 2;
  s.vy += (ay * DT) / 2;
  s.x += s.vx * DT;
  s.y += s.vy * DT;
  [ax, ay] = gravity(bodies, s.x, s.y);
  s.vx += (ax * DT) / 2;
  s.vy += (ay * DT) / 2;
  s.tick += 1;
  judge(s);
}

// Decides whether the flight is over. The order matters: crashing beats everything.
function judge(s) {
  const level = s.level;
  for (const body of level.bodies) {
    if (distance(s.x, s.y, body.at) <= body.r) return finish(s, 'lost', 'crashed');
  }
  if (s.x < 0 || s.x > FIELD || s.y < 0 || s.y > FIELD) return finish(s, 'lost', 'left');
  updateGoals(s);
  if (s.done.every(Boolean)) return finish(s, 'won', '');
  if (s.tick >= level.maxTicks) return finish(s, 'lost', 'time');
}

function finish(s, status, reason) {
  s.status = status;
  s.reason = reason;
}

// A zone is done the moment the ship touches it, and stays done.
// A ring is done once the ship has stayed inside its band for goal.ticks ticks in a row.
function updateGoals(s) {
  s.level.goals.forEach((goal, i) => {
    if (goal.type === 'zone') {
      if (distance(s.x, s.y, goal.at) <= goal.r) s.done[i] = true;
    }
    if (goal.type === 'ring') {
      const d = distance(s.x, s.y, s.level.bodies[goal.body].at);
      const inside = d >= goal.rMin && d <= goal.rMax;
      s.held[i] = inside ? s.held[i] + 1 : 0;
      if (s.held[i] >= goal.ticks) s.done[i] = true;
    }
  });
}

// --------------------------------------------------------------------- replay

// Fly a whole recorded solution: { launch: [vx, vy], brakes: [tick, tick, ...] }.
// A brake listed at tick 516 is tapped when the ship has flown exactly 516 ticks.
// Returns the final state. With no launch the ship never moves, so it stays 'playing'.
export function replay(level, solution) {
  const state = start(level);
  if (!solution || !solution.launch) return state;
  let s = launch(state, solution.launch);
  const brakes = solution.brakes || [];
  while (s.status === 'playing') {
    for (const tick of brakes) {
      if (tick === s.tick) s = brake(s);
    }
    advance(s);
  }
  return s;
}

// ------------------------------------------------------------- authoring aid
// Nothing below is needed to play. It answers one question for whoever writes a
// level: "which launch wins this, with the most room for error?"
// The game's ?dev panel has a button that runs it and prints a line for levels.js.

const COARSE = 4;        // first pass tries every 4th launch in each direction
const WINDOW = 30;       // second pass tries every launch within +-30 of the best one
const MAX_MARGIN = 12;   // stop measuring room for error beyond +-12
const CROWD = 3;         // tie-break: count the winners within 3 grid steps
const FINALISTS = 200;   // measure this many of the best candidates properly

// Flies one launch. On levels with brake taps it brakes at the ship's closest
// approaches to the ring's body, trying 0 taps, then 1, then 2, ... up to the limit.
// Returns a winning { launch, brakes }, or null if this launch does not win.
export function tryLaunch(level, vector) {
  const ring = level.goals.find((goal) => goal.type === 'ring');
  const mostTaps = ring ? level.brake.taps : 0;
  for (let taps = 0; taps <= mostTaps; taps += 1) {
    const end = flyBrakingAtClosest(level, vector, ring, taps);
    if (end.status !== 'won') continue;
    const solution = { launch: end.launch, brakes: end.brakes };
    if (brakesAreForgiving(level, solution)) return solution;
  }
  return null;
}

// Flies a launch, tapping the brake `taps` times: once at each closest approach to the ring's body.
function flyBrakingAtClosest(level, vector, ring, taps) {
  let s = launch(start(level), vector);
  let wasClosing = false;
  while (s.status === 'playing') {
    const closing = ring ? isClosing(s, level.bodies[ring.body]) : false;
    if (wasClosing && !closing && s.brakes.length < taps) s = brake(s);
    wasClosing = closing;
    advance(s);
  }
  return s;
}

// True while the ship is getting nearer to the body.
function isClosing(s, body) {
  return (s.x - body.at[0]) * s.vx + (s.y - body.at[1]) * s.vy < 0;
}

// True if the solution still wins with every brake tap moved early or late by BRAKE_SLACK.
function brakesAreForgiving(level, solution) {
  if (solution.brakes.length === 0) return true;
  for (const shift of [-BRAKE_SLACK, -BRAKE_SLACK / 2, BRAKE_SLACK / 2, BRAKE_SLACK]) {
    const brakes = solution.brakes.map((tick) => tick + shift);
    if (replay(level, { launch: solution.launch, brakes }).status !== 'won') return false;
  }
  return true;
}

// How much room for error a solution has: the largest m (up to MAX_MARGIN) such that every
// launch within +-m of it wins with the same brake taps. Returns -1 if the solution itself loses.
export function margin(level, solution) {
  const [vx, vy] = solution.launch;
  const wins = (dx, dy) => {
    const launchVector = [vx + dx, vy + dy];
    return replay(level, { launch: launchVector, brakes: solution.brakes }).status === 'won';
  };
  if (!wins(0, 0)) return -1;
  for (let m = 1; m <= MAX_MARGIN; m += 1) {
    for (let d = -m; d <= m; d += 1) {
      // the four edges of the square of side 2m around the launch
      if (!wins(d, -m) || !wins(d, m) || !wins(-m, d) || !wins(m, d)) return m - 1;
    }
  }
  return MAX_MARGIN;
}

// Tries every launch on a grid: `spacing` apart, within `reach` of `centre`, and no
// faster than the level allows. Returns the winning solutions.
function winnersOnGrid(level, centre, reach, spacing) {
  const winners = [];
  for (let vx = centre[0] - reach; vx <= centre[0] + reach; vx += spacing) {
    for (let vy = centre[1] - reach; vy <= centre[1] + reach; vy += spacing) {
      if (vx * vx + vy * vy > level.maxSpeed * level.maxSpeed) continue;
      const solution = tryLaunch(level, [vx, vy]);
      if (solution) winners.push(solution);
    }
  }
  return winners;
}

// Room for error measured on the grid: the largest m such that every grid launch
// within m grid steps of this one is also a winner. `isWinner` is a Set of launches as text.
function gridRoom(launchVector, isWinner, spacing) {
  for (let m = 1; ; m += 1) {
    if (winnersAround(launchVector, isWinner, spacing, m) < (2 * m + 1) * (2 * m + 1)) return m - 1;
  }
}

// How many grid launches within m grid steps of this one are winners (counting itself).
function winnersAround(launchVector, isWinner, spacing, m) {
  let count = 0;
  for (let dx = -m; dx <= m; dx += 1) {
    for (let dy = -m; dy <= m; dy += 1) {
      const near = [launchVector[0] + dx * spacing, launchVector[1] + dy * spacing];
      if (isWinner.has(String(near))) count += 1;
    }
  }
  return count;
}

// Sorts winners, best first: most room for error, then most other winners close by.
// The first one is the middle of the biggest patch of winning launches.
function bestFirst(winners, spacing) {
  const isWinner = new Set(winners.map((solution) => String(solution.launch)));
  const scored = winners.map((solution) => ({
    solution,
    room: gridRoom(solution.launch, isWinner, spacing),
    crowd: winnersAround(solution.launch, isWinner, spacing, CROWD),
  }));
  scored.sort((a, b) => b.room - a.room || b.crowd - a.crowd);
  return scored.map((entry) => entry.solution);
}

// Picks the most forgiving winner from a grid of winners. The quick grid measure above
// chooses the finalists; margin() then measures each of those properly, because on brake
// levels a nearby launch must win with the SAME brake taps, which the grid cannot see.
function pickBest(level, winners, spacing) {
  const finalists = bestFirst(winners, spacing).slice(0, FINALISTS);
  let best = { solution: finalists[0], margin: margin(level, finalists[0]) };
  for (const solution of finalists.slice(1)) {
    const room = margin(level, solution);
    if (room > best.margin) best = { solution, margin: room };
  }
  return best;
}

// The search itself. Returns { solution, margin, tried } or null if nothing wins.
//   solution  { launch, brakes } to paste into levels.js
//   margin    every launch within +-margin of it also wins (the tests need LAUNCH_SLACK or more)
//   tried     how many winning launches it looked at
// It can take several seconds: it flies many thousands of launches.
export function findForgivingLaunch(level) {
  // Pass 1: a coarse grid over every allowed launch, to find the best patch of winners.
  const coarse = winnersOnGrid(level, [0, 0], level.maxSpeed, COARSE);
  if (coarse.length === 0) return null;
  const seed = pickBest(level, coarse, COARSE).solution;

  // Pass 2: every whole-number launch near that one.
  const fine = winnersOnGrid(level, seed.launch, WINDOW, 1);
  return { ...pickBest(level, fine, 1), tried: coarse.length + fine.length };
}
