// PAGE for Sling Orbit: drawing and input only.
// Every rule lives in logic.js. This file never decides who wins.
//
// How it fits together:
//   - `state` is the game state. Only three functions here change it while you play,
//     and each one calls the matching input in logic.js: doLaunch(), doBrake(), tick().
//   - While the ship flies, frame() runs once per screen refresh. It turns real time
//     into whole ticks, so a slow frame means more ticks at once, never different physics.
//   - refresh() copies the state onto the page: the text (updateHud) and the canvas (draw).
//
// Useful while editing levels.js:
//   ?dev            shows the authoring panel under the game
//   ?level=so-03    opens that level
//   ?dev&fly        flies the level's stored solution straight away

import { mountShell, ready, el, token } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { fitCanvas, pointerPos } from '../../shared/canvas.js';
import { levels } from './levels.js';
import { FIELD, DT, start, launch, brake, step, clampLaunch, findForgivingLaunch } from './logic.js';

// ------------------------------------------------------------------ settings

const TICKS_PER_SECOND = Math.round(1 / DT);
const TICK_MS = 1000 * DT;     // real milliseconds per tick
const MAX_FRAME_MS = 100;      // after a long pause (hidden tab) catch up by at most this much

const NUDGE = 1;               // arrow keys and nudge buttons change the aim by this
const BIG_NUDGE = 10;          // ... and by this with Shift held
const DRAG_SCALE = 1;          // dragging 1 field unit changes the aim by this much speed

// The dotted preview shows the start of the path, not all of it: the puzzle is guessing
// how the planets bend the rest. Longer makes every level easier, shorter makes it harder.
const PREVIEW_LENGTH = 240;    // the dotted preview covers this much path (field units) ...
const PREVIEW_TICKS = 360;     // ... or this much time (3 s), whichever ends first
const PREVIEW_GAP = 12;        // distance between preview dots
const PREVIEW_DOT = 3;         // radius of each dot
const ARROW_SCALE = 0.25;      // arrow length per unit of launch speed
const SHIP_SIZE = 11;
const TRAIL_EVERY = 2;         // remember the ship's position every 2 ticks
const TRAIL_ALPHA = 0.85;      // how solid the trail is (0 to 1)
const GHOST_ALPHA = 0.4;       // ... and the trail of the attempt before
const PULSE_MS = 700;          // length of the ring that spreads out on a win

const REASONS = {              // logic.js reason -> words for the player
  crashed: 'Crashed into a planet',
  left: 'Drifted out of the field',
  time: 'Out of time',
};

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const CALM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SAVE_KEY = 'sling-orbit:best';   // saved as { levelId: fewest ticks to win }

// --------------------------------------------------------------------- state

const main = mountShell({ title: 'Sling Orbit' });
const best = load(SAVE_KEY, {});
const view = {};        // the page elements that refresh() needs to reach
let ctx = null;         // the canvas drawing context, in field units

let levelIndex = 0;
let state = null;       // the current game state, always produced by logic.js
let aim = [0, 0];       // the launch the arrow shows
let recorded = { launch: null, brakes: [] };   // the inputs of this flight: what replay() takes
let trail = [];         // where the ship has been on this flight, as [x, y] points
let ghost = [];         // the trail of the flight before, drawn fainter
let brakeMarks = [];    // where each brake tap happened
let longestStay = 0;    // ring goals: the most ticks in a row spent inside the band on this flight
let autoBrakes = [];    // ?dev "Fly the solution": the brake ticks still to come
let devSolution = null; // ?dev: the launch "Find a forgiving launch" found on this level
let drag = null;        // while dragging: { from: {x, y}, aim: [vx, vy] }
let newBest = false;    // did the last win beat the saved time?

let running = false;    // is frame() being called every screen refresh?
let frameHandle = 0;
let lastTime = 0;
let unspent = 0;        // real time not yet turned into ticks
let pulseUntil = 0;     // the win pulse is drawn until this time

function isAiming() {
  return !state.launched && state.status === 'playing';
}

function isFlying() {
  return state.launched && state.status === 'playing';
}

// ------------------------------------------------------------------- inputs
// The three functions that change `state` during play.

function doLaunch() {
  if (!isAiming()) return;
  state = launch(state, aim);
  recorded = { launch: state.launch, brakes: [] };
  trail = [[state.x, state.y]];
  startLoop();
  refresh();
  if (state.level.brake.taps > 0) view.brake.focus({ preventScroll: true });
}

function doBrake() {
  const next = brake(state);
  if (next === state) return;          // not flying, or no taps left: nothing happened
  recorded.brakes.push(state.tick);
  brakeMarks.push([state.x, state.y]);
  state = next;
  refresh();
}

function tick() {
  if (autoBrakes.includes(state.tick)) doBrake();
  state = step(state);
  longestStay = Math.max(longestStay, ...state.held);   // held is 0 for zone goals
  if (state.tick % TRAIL_EVERY === 0 || state.status !== 'playing') trail.push([state.x, state.y]);
  if (state.status !== 'playing') endFlight();
}

// ------------------------------------------------------- aiming and resetting

function setAim(vector) {
  if (state.status === 'lost') resetFlight();   // re-aiming after a miss starts a fresh attempt
  if (!isAiming()) return;
  aim = clampLaunch(state.level, vector);
  refresh();
}

function nudge(dx, dy) {
  setAim([aim[0] + dx, aim[1] + dy]);
}

// Back to the launch pad on the same level. The aim stays, and the last trail becomes the ghost.
function resetFlight() {
  stopLoop();
  if (trail.length > 1) ghost = trail;
  state = start(levels[levelIndex]);
  recorded = { launch: null, brakes: [] };
  trail = [];
  brakeMarks = [];
  longestStay = 0;
  autoBrakes = [];
  view.result.hidden = true;
  refresh();
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  trail = [];
  ghost = [];
  devSolution = null;
  aim = levels[index].aim;
  state = start(levels[index]);
  resetFlight();
  drawLevelText();
  drawPicker();
  if (moveFocus) view.launch.focus({ preventScroll: true });
}

function tryAgain() {
  resetFlight();
  view.launch.focus({ preventScroll: true });
}

function endFlight() {
  newBest = false;
  if (state.status === 'won') rememberWin();
  pulseUntil = state.status === 'won' && !CALM ? performance.now() + PULSE_MS : 0;
  drawPicker();
  drawResult();
  view.primary.focus({ preventScroll: true });
  if (state.status === 'won') view.result.scrollIntoView({ block: 'nearest', behavior: CALM ? 'auto' : 'smooth' });
}

function rememberWin() {
  const id = state.level.id;
  newBest = !best[id] || state.tick < best[id];
  if (!newBest) return;
  best[id] = state.tick;
  save(SAVE_KEY, best);
}

// ------------------------------------------------------------- the frame loop

function startLoop() {
  if (running) return;
  running = true;
  lastTime = performance.now();
  unspent = 0;
  frameHandle = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(frameHandle);
  running = false;
  pulseUntil = 0;
}

// Runs once per screen refresh while the ship is flying.
// Real time is saved up in `unspent` and spent one whole tick at a time.
function frame(now) {
  unspent += Math.min(now - lastTime, MAX_FRAME_MS);
  lastTime = now;
  while (unspent >= TICK_MS && state.status === 'playing') {
    tick();
    unspent -= TICK_MS;
  }
  refresh();
  if (state.status === 'playing' || now < pulseUntil) {
    frameHandle = requestAnimationFrame(frame);
  } else {
    running = false;
  }
}

// ---------------------------------------------------------- pointer and keys

function onPointerDown(event) {
  event.preventDefault();
  if (isFlying()) return doBrake();     // a tap during the flight is a brake
  if (state.status === 'won') return;
  setAim(aim);                          // after a miss this puts the ship back on the pad
  drag = { from: pointerPos(event, view.canvas), aim: [...aim] };
  try {
    view.canvas.setPointerCapture(event.pointerId);   // keep the drag even if the pointer leaves the field
  } catch {
    // a made-up pointer (in a test) cannot be captured; dragging inside the field still works
  }
}

// Dragging works like a trackpad: the aim changes by however far the pointer has moved,
// wherever on the field the drag began.
function onPointerMove(event) {
  if (!drag) return;
  const now = pointerPos(event, view.canvas);
  setAim([
    drag.aim[0] + (now.x - drag.from.x) * DRAG_SCALE,
    drag.aim[1] + (now.y - drag.from.y) * DRAG_SCALE,
  ]);
}

function onPointerUp() {
  drag = null;
}

// Enter: launch while aiming, otherwise press the button in the result panel.
function primaryAction() {
  if (isAiming()) doLaunch();
  else if (state.status !== 'playing') view.primary.click();
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // Enter and Space on a focused button belong to that button, not to the game.
  const onButton = event.target instanceof Element && event.target.closest('button, a');
  const size = event.shiftKey ? BIG_NUDGE : NUDGE;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const lastLevel = levelIndex === levels.length - 1;

  if (key === 'ArrowLeft') nudge(-size, 0);
  else if (key === 'ArrowRight') nudge(size, 0);
  else if (key === 'ArrowUp') nudge(0, -size);
  else if (key === 'ArrowDown') nudge(0, size);
  else if (key === 'Enter' && !onButton) primaryAction();
  else if (key === ' ' && !onButton) doBrake();
  else if (key === 'r') tryAgain();
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
  else return;
  if (!onButton || key.startsWith('Arrow')) event.preventDefault();   // do not scroll the page
}

// ------------------------------------------------------------- building the page

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function seconds(ticks) {
  return (ticks / TICKS_PER_SECOND).toFixed(1);
}

function nudgeButton(arrow, name, dx, dy) {
  return el('button', {
    class: 'btn so-nudge', type: 'button', 'aria-label': `Aim ${name} by ${NUDGE}`,
    onclick: () => nudge(dx, dy),
  }, arrow);
}

// Runs once: creates every element and puts it on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.hint = el('p', { class: 'muted' });
  view.goal = el('p', { class: 'so-goal' });
  view.canvas = el('canvas', { class: 'stage so-stage', role: 'img', 'aria-label': 'The playing field' });
  view.launch = el('button', { class: 'btn btn-primary so-wide', type: 'button', onclick: doLaunch }, 'Launch', kbd('Enter'));
  view.brake = el('button', { class: 'btn so-wide', type: 'button', onclick: doBrake }, 'Brake', kbd('Space'));
  view.reset = el('button', { class: 'btn btn-quiet so-reset', type: 'button', onclick: tryAgain }, 'Reset', kbd('R'));
  view.nudges = el('div', {
    class: 'row so-nudges', role: 'group',
    'aria-label': `Fine aim: change the launch by ${NUDGE}. The arrow keys do the same, and Shift with an arrow key changes it by ${BIG_NUDGE}.`,
  },
    nudgeButton('←', 'left', -NUDGE, 0), nudgeButton('↑', 'up', 0, -NUDGE),
    nudgeButton('↓', 'down', 0, NUDGE), nudgeButton('→', 'right', NUDGE, 0));
  view.status = el('p', { class: 'so-status' });
  view.holdMeter = el('div', { class: 'meter' }, el('span'));
  view.holdText = el('span');
  view.hold = el('div', { class: 'so-hold' }, el('span', {}, 'In the band'), view.holdMeter, view.holdText);
  view.result = el('section', { class: 'panel result stack so-result', hidden: true, 'aria-live': 'polite' });
  view.dev = DEV ? buildDevPanel() : null;

  main.append(
    el('p', { class: 'how' },
      'Drag on the field to aim, then launch. Planets bend your path: touch every target to win.'),
    view.picker,
    el('div', { class: 'so-layout' },
      el('section', { class: 'panel stack so-info' }, view.title, view.hint, view.goal),
      view.canvas,
      view.result,
      el('section', { class: 'panel stack so-controls' },
        el('div', { class: 'row' }, view.launch, view.brake),
        el('div', { class: 'row' }, view.nudges, view.reset),
        view.hold,
        view.status),
      view.dev),
  );

  ctx = fitCanvas(view.canvas, FIELD, FIELD);
  view.canvas.addEventListener('pointerdown', onPointerDown);
  view.canvas.addEventListener('pointermove', onPointerMove);
  view.canvas.addEventListener('pointerup', onPointerUp);
  view.canvas.addEventListener('pointercancel', onPointerUp);
}

// The ?dev panel: tools for whoever is writing levels.js.
function buildDevPanel() {
  view.devOut = el('pre', { class: 'dev' }, 'Win the level, or press a button, and the line for levels.js appears here.');
  return el('section', { class: 'panel stack so-dev' },
    el('h3', {}, 'Level authoring (?dev)'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', type: 'button', onclick: findLaunch }, 'Find a forgiving launch'),
      el('button', { class: 'btn', type: 'button', onclick: flySolution }, 'Fly the solution')),
    view.devOut);
}

// --------------------------------------------------------------- dev tools

// One line in the shape levels.js wants.
function solutionText(solution) {
  return `solution: { launch: [${solution.launch.join(', ')}], brakes: [${solution.brakes.join(', ')}] },`;
}

// Searches for the launch with the most room for error and shows it as text to paste.
function findLaunch() {
  view.devOut.textContent = 'Searching. This takes a few seconds and the page will not respond meanwhile...';
  setTimeout(() => {                    // the pause lets the message above appear first
    const found = findForgivingLaunch(state.level);
    if (!found) {
      view.devOut.textContent = 'No winning launch found. Make a target bigger or nearer, or raise maxSpeed or maxTicks.';
      return;
    }
    devSolution = found.solution;
    view.devOut.textContent = `${solutionText(found.solution)}\n`
      + `margin ${found.margin}: every launch within +-${found.margin} of it also wins (the tests need 2 or more).\n`
      + 'Press "Fly the solution" to watch it, then paste the line into levels.js.';
    setAim(found.solution.launch);
  }, 50);
}

// Flies the launch just found by "Find a forgiving launch", or else the solution stored
// in levels.js, through the same inputs a player uses.
function flySolution() {
  const solution = devSolution || state.level.solution;
  resetFlight();
  aim = clampLaunch(state.level, solution.launch);
  autoBrakes = [...solution.brakes];
  doLaunch();
}

// ------------------------------------------------------------------ the text

// Runs after every change: text first, then the canvas.
function refresh() {
  updateHud();
  draw();
}

function setEnabled(button, on) {
  // aria-disabled (not disabled) so a focused button keeps the keyboard focus
  if (on) button.removeAttribute('aria-disabled');
  else button.setAttribute('aria-disabled', 'true');
}

function goalText(level) {
  const zones = level.goals.filter((goal) => goal.type === 'zone').length;
  const ring = level.goals.find((goal) => goal.type === 'ring');
  const parts = [];
  if (zones === 1) parts.push('touch the target');
  if (zones > 1) parts.push(`touch all ${zones} targets`);
  if (ring) parts.push(`stay inside the dashed band for ${ring.ticks / TICKS_PER_SECOND} seconds`);
  return `Goal: ${parts.join(', then ')}.`;
}

function statusText() {
  const level = state.level;
  if (isAiming()) {
    const [vx, vy] = aim;
    const speed = Math.round(Math.sqrt(vx * vx + vy * vy));
    let text = `Aim ${vx < 0 ? '←' : '→'} ${Math.abs(vx)}  ${vy > 0 ? '↓' : '↑'} ${Math.abs(vy)} · speed ${speed} of ${level.maxSpeed}`;
    if (level.brake.taps > 0) text += ` · brakes ${level.brake.taps}`;
    return `${text}\nArrow keys aim too; with Shift they move ${BIG_NUDGE} at a time.`;
  }
  const zones = level.goals.filter((goal) => goal.type === 'zone');
  const touched = level.goals.filter((goal, i) => goal.type === 'zone' && state.done[i]).length;
  let text = `Time ${seconds(state.tick)} of ${seconds(level.maxTicks)} s`;
  if (zones.length > 0) text += ` · targets ${touched} of ${zones.length}`;
  if (level.brake.taps > 0) text += ` · brakes left ${level.brake.taps - state.brakes.length}`;
  return text;
}

// After a miss: how far the flight got, so the player can see what to change.
// e.g. "Targets touched: 1 of 1. Longest stay in the band: 2.5 of 4.0 s. Brakes used: 1 of 2."
function progressText() {
  const level = state.level;
  const zones = level.goals.filter((goal) => goal.type === 'zone').length;
  const touched = level.goals.filter((goal, i) => goal.type === 'zone' && state.done[i]).length;
  const ring = level.goals.find((goal) => goal.type === 'ring');
  const parts = [];
  if (zones > 0) parts.push(`Targets touched: ${touched} of ${zones}.`);
  if (ring) parts.push(`Longest stay in the band: ${seconds(Math.min(longestStay, ring.ticks))} of ${seconds(ring.ticks)} s.`);
  if (level.brake.taps > 0) parts.push(`Brakes used: ${state.brakes.length} of ${level.brake.taps}.`);
  return parts.join(' ');
}

// The ring goal's progress, 0 to 1 (0 on levels without a ring).
function holdProgress() {
  const i = state.level.goals.findIndex((goal) => goal.type === 'ring');
  if (i === -1) return 0;
  return state.done[i] ? 1 : state.held[i] / state.level.goals[i].ticks;
}

function updateHud() {
  const level = state.level;
  const ring = level.goals.find((goal) => goal.type === 'ring');
  const tapsLeft = level.brake.taps - state.brakes.length;

  view.status.textContent = statusText();
  setEnabled(view.launch, isAiming());
  for (const button of view.nudges.querySelectorAll('button')) setEnabled(button, state.status !== 'won' && !isFlying());

  view.brake.hidden = level.brake.taps === 0;
  setEnabled(view.brake, isFlying() && tapsLeft > 0);

  view.hold.hidden = !ring;
  if (ring) {
    const progress = holdProgress();
    view.holdMeter.style.setProperty('--value', `${Math.round(progress * 100)}%`);
    view.holdText.textContent = `${seconds(progress * ring.ticks)} of ${seconds(ring.ticks)} s`;
  }
}

function drawLevelText() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.hint.textContent = level.hint;
  view.goal.textContent = goalText(level);
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const ticks = best[level.id];
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}, ${level.title}, ${ticks ? `solved, best ${seconds(ticks)} seconds` : 'not solved yet'}`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'so-best', 'aria-hidden': 'true' }, ticks ? `✓ ${seconds(ticks)}` : '–')));
  });
  view.picker.replaceChildren(...chips);
}

function drawResult() {
  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  const allSolved = levels.every((level) => best[level.id]);
  view.result.hidden = false;
  view.result.className = won ? 'panel result stack so-result' : 'panel result lost stack so-result';

  const again = el('button', { class: won ? 'btn btn-quiet' : 'btn btn-primary', type: 'button', onclick: tryAgain },
    won ? 'Fly it again' : 'Try again', kbd('R'));
  const next = won && !lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next level', kbd('N'))
    : null;
  view.primary = next || again;

  let detail = 'Your last path stays on the field. Change the aim a little and launch again.';
  if (won) detail = newBest ? 'That is your best time on this level.' : `Your best here is ${seconds(best[state.level.id])} s.`;

  const parts = [
    el('h2', { class: 'so-result-title' }, won ? `✓ Solved in ${seconds(state.tick)} s` : `✗ ${REASONS[state.reason]}`),
    won ? null : el('p', { class: 'so-goal' }, progressText()),
    el('p', {}, detail),
    won && lastLevel ? el('p', {}, allSolved ? 'That was the last level. You have solved them all!' : 'That was the last level.') : null,
    el('div', { class: 'row' }, next, again),
    DEV && won ? el('pre', { class: 'dev' }, solutionText(recorded)) : null,
  ];
  view.result.replaceChildren(...parts.filter(Boolean));   // leave out the parts that do not apply
}

// ---------------------------------------------------------------- the canvas
// Everything below draws in field units: 0..FIELD across and down.

function colours() {
  // read on every draw, so the canvas follows the light or dark theme
  return {
    text: token('--text'), muted: token('--muted'), line: token('--line'), surface: token('--surface'),
    accent: token('--accent'), good: token('--good'), bad: token('--bad'), warn: token('--warn'),
  };
}

function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function label(text, x, y, colour, size) {
  ctx.font = `600 ${size}px ${token('--font')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function draw() {
  const c = colours();
  ctx.clearRect(0, 0, FIELD, FIELD);
  ctx.globalAlpha = 1;
  state.level.goals.forEach((goal, i) => (goal.type === 'ring' ? drawRing(goal, i, c) : drawZone(goal, i, c)));
  state.level.bodies.forEach((body) => drawBody(body, c));
  drawPath(ghost, c.muted, GHOST_ALPHA);
  drawPath(trail, c.accent, TRAIL_ALPHA);
  brakeMarks.forEach((mark) => drawBrakeMark(mark, c));
  if (isAiming()) {
    drawPreview(c);
    drawArrow(c);
  }
  drawShip(c);
  drawPulse(c);
  drawBanner(c);
}

// A target: dashed with a + until touched, then solid with a tick.
function drawZone(goal, i, c) {
  const done = state.done[i];
  const [x, y] = goal.at;
  ctx.fillStyle = c.good;
  ctx.globalAlpha = done ? 0.3 : 0.1;
  circle(x, y, goal.r);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.good;
  ctx.lineWidth = 3;
  ctx.setLineDash(done ? [] : [8, 6]);
  circle(x, y, goal.r);
  ctx.stroke();
  ctx.setLineDash([]);
  label(done ? '✓' : '+', x, y, c.good, 26);
}

// A ring goal: a shaded band with dashed edges, and a solid arc that grows as time in it adds up.
function drawRing(goal, i, c) {
  const [x, y] = state.level.bodies[goal.body].at;
  ctx.fillStyle = c.good;
  ctx.globalAlpha = 0.13;
  ctx.beginPath();
  ctx.arc(x, y, goal.rMax, 0, Math.PI * 2);
  ctx.arc(x, y, goal.rMin, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.good;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  circle(x, y, goal.rMin);
  ctx.stroke();
  circle(x, y, goal.rMax);
  ctx.stroke();
  ctx.setLineDash([]);

  const progress = state.done[i] ? 1 : state.held[i] / goal.ticks;
  if (progress <= 0) return;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(x, y, goal.rMax, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
}

function drawBody(body, c) {
  const [x, y] = body.at;
  ctx.fillStyle = c.line;
  ctx.strokeStyle = c.muted;
  ctx.lineWidth = 2;
  circle(x, y, body.r);
  ctx.fill();
  ctx.globalAlpha = 0.3;                // a wash of the lighter colour makes it look solid
  ctx.fillStyle = c.muted;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.globalAlpha = 0.35;               // a short highlight so it reads as a ball
  ctx.beginPath();
  ctx.arc(x, y, body.r * 0.68, Math.PI * 1.05, Math.PI * 1.45);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPath(points, colour, alpha) {
  if (points.length < 2) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBrakeMark([x, y], c) {
  ctx.strokeStyle = c.warn;
  ctx.lineWidth = 3;
  circle(x, y, 7);
  ctx.stroke();
  label('brake', x, y - 20, c.warn, 16);
}

// The first part of the path this aim would fly, as evenly spaced dots.
function previewDots() {
  const dots = [];
  let s = launch(start(state.level), aim);
  let travelled = 0;
  let sinceDot = 0;
  while (s.status === 'playing' && s.tick < PREVIEW_TICKS && travelled < PREVIEW_LENGTH) {
    const before = s;
    s = step(s);
    const moved = Math.sqrt((s.x - before.x) ** 2 + (s.y - before.y) ** 2);
    travelled += moved;
    sinceDot += moved;
    if (sinceDot >= PREVIEW_GAP) {
      dots.push([s.x, s.y]);
      sinceDot = 0;
    }
  }
  return dots;
}

function drawPreview(c) {
  ctx.fillStyle = c.text;
  ctx.globalAlpha = 0.8;
  for (const [x, y] of previewDots()) {
    circle(x, y, PREVIEW_DOT);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// The launch arrow: its direction is the aim and its length is the speed.
function drawArrow(c) {
  const [vx, vy] = aim;
  if (vx === 0 && vy === 0) return;
  const tipX = state.x + vx * ARROW_SCALE;
  const tipY = state.y + vy * ARROW_SCALE;
  const angle = Math.atan2(vy, vx);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(state.x, state.y);
  ctx.lineTo(tipX, tipY);
  for (const turn of [-0.45, 0.45]) {   // the two strokes of the arrow head
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - 14 * Math.cos(angle + turn), tipY - 14 * Math.sin(angle + turn));
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawShip(c) {
  if (state.reason === 'crashed') return drawCrash(c);
  const [hx, hy] = state.launched ? [state.vx, state.vy] : aim;
  if (isAiming()) {                     // a ring round the ship on the pad, so it is easy to find
    ctx.strokeStyle = c.accent;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    circle(state.x, state.y, SHIP_SIZE * 1.8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.save();
  ctx.translate(state.x, state.y);
  ctx.rotate(hx === 0 && hy === 0 ? -Math.PI / 2 : Math.atan2(hy, hx));
  ctx.beginPath();                      // a small dart pointing along +x
  ctx.moveTo(SHIP_SIZE, 0);
  ctx.lineTo(-SHIP_SIZE * 0.8, SHIP_SIZE * 0.7);
  ctx.lineTo(-SHIP_SIZE * 0.4, 0);
  ctx.lineTo(-SHIP_SIZE * 0.8, -SHIP_SIZE * 0.7);
  ctx.closePath();
  ctx.fillStyle = c.text;
  ctx.fill();
  ctx.restore();
}

// Where the ship hit a planet: a small star of short strokes.
function drawCrash(c) {
  ctx.strokeStyle = c.bad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4;
    ctx.moveTo(state.x + 6 * Math.cos(angle), state.y + 6 * Math.sin(angle));
    ctx.lineTo(state.x + 16 * Math.cos(angle), state.y + 16 * Math.sin(angle));
  }
  ctx.stroke();
}

// On a win, a ring spreads out from the ship for a moment (skipped with reduced motion).
function drawPulse(c) {
  const left = pulseUntil - performance.now();
  if (left <= 0) return;
  const progress = 1 - left / PULSE_MS;
  ctx.strokeStyle = c.good;
  ctx.globalAlpha = 1 - progress;
  ctx.lineWidth = 5;
  circle(state.x, state.y, 12 + progress * 110);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// When the flight is over, say so on the field itself, in words.
function drawBanner(c) {
  if (state.status === 'playing') return;
  const won = state.status === 'won';
  const text = won ? `✓ Solved in ${seconds(state.tick)} s` : `✗ ${REASONS[state.reason]}`;
  ctx.font = `600 26px ${token('--font')}`;
  const width = ctx.measureText(text).width + 40;
  const left = (FIELD - width) / 2;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = c.surface;
  ctx.fillRect(left, 16, width, 50);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = won ? c.good : c.bad;
  ctx.lineWidth = 3;
  ctx.strokeRect(left, 16, width, 50);
  label(text, FIELD / 2, 42, c.text, 26);
}

// -------------------------------------------------------------------- start

function firstLevel() {
  const asked = levels.findIndex((level) => level.id === params.get('level'));
  if (asked !== -1) return asked;
  const unsolved = levels.findIndex((level) => !best[level.id]);
  return unsolved === -1 ? 0 : unsolved;
}

build();
openLevel(firstLevel(), false);
document.addEventListener('keydown', onKey);
ready();
if (DEV && params.has('fly')) flySolution();
