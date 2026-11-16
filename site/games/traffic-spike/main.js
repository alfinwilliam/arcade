// PAGE for Traffic Spike: drawing and input only.
// Every rule lives in logic.js. This file never decides what a component handles or who wins.
//
// How it fits together:
//   - `state` always comes from logic.js: start(), apply() for a buy or sell, tick() for time.
//   - Every buy and sell goes through act(), which stamps it with the wave and tick and
//     records it. That list is exactly what logic.replay() takes, so with ?dev in the URL
//     a win shows the list ready to paste into levels.js as a `solution`.
//   - The speed buttons only change how long a tick stays on screen. The rules never see them.
//   - The slots are real buttons under the canvas. The canvas is a picture of the state.

import { mountShell, ready, el, svg, token } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { fitCanvas, pointerPos } from '../../shared/canvas.js';
import { levels, towers, kinds, rules } from './levels.js';
import { start, apply, tick, stamp, whyNot, refundFor, replay, stars, laneLength, heldCount } from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded actions on a win
const SAVE_KEY = 'traffic-spike:best';                          // saved as { levelId: { stars, errors } }

// ---- Numbers you can tune. None of them can change who wins.
const BASE_TICK_MS = 140;      // how long one tick is shown at 1x speed
const SPEEDS = [1, 2, 4];
const GUTTER = 18;             // px left of the lane, for the entrance strip and the row letters
const EXIT_WIDTH = 18;         // px right of the lane, for the exit strip
const HEADER = 36;             // px above the rows, for component names
const MIN_ROWS = 4;            // each row of the lane is at least this many requests tall
const MAX_COLUMNS = 4;         // one tick's requests of a kind are drawn at most this many wide
const ROW_PAD = 8;             // px of air in each row
const MIN_SHAPE = 4;           // request size in px on a narrow screen
const MAX_SHAPE = 8;           // and on a wide one
const MIN_WIDTH = 280;
const GONE_ALPHA = 0.55;       // how solid a request looks at the moment a component takes it

// How each kind of request is drawn. A kind without an entry is drawn as a square.
const SHAPES = { static: 'square', api: 'circle', bot: 'triangle' };
const KIND_ORDER = Object.keys(kinds);     // the rows of the lane, top to bottom
const TOWER_ORDER = Object.keys(towers);   // number key 1 buys the first, 2 the second ...

const main = mountShell({ title: 'Traffic Spike' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every accepted buy and sell, stamped: exactly what replay() takes
let selected = 0;         // which slot the next buy or sell applies to
let running = false;      // are ticks being played right now?
let speed = 1;
let timer = 0;            // the setInterval that plays ticks while a wave is running
let lastTickAt = 0;       // when the latest tick happened, in ms
let frameQueued = false;  // is a redraw already booked for the next screen refresh?
let ctx = null;           // the canvas drawing context
let geo = null;           // sizes for drawing, worked out in resize()

// ------------------------------------------------------------------- inputs

// Show one line about what just happened. `refused` marks it as a "no".
function say(text, refused) {
  view.say.textContent = refused ? `✕ ${text}` : text;
  view.say.className = refused ? 'ts-say ts-refused' : 'ts-say';
}

// The only place the player changes the game. Returns true if the action was accepted.
function act(action) {
  const stamped = stamp(state, action);
  const reason = whyNot(state, stamped);
  if (reason) {
    say(reason, true);
    return false;
  }
  state = apply(state, stamped);
  recorded.push(stamped);
  return true;
}

function buySelected(kind) {
  if (act({ buy: kind, slot: selected })) {
    say(`${towers[kind].name} placed in slot ${selected + 1} for ₹${towers[kind].cost}.`);
  }
  update();
}

function sellSelected() {
  const tower = state.slots[selected];
  const refund = refundFor(state, selected);
  if (!tower) say('That slot is empty.', true);
  else if (act({ sell: tower.kind, slot: selected })) {
    say(`Sold the ${towers[tower.kind].name.toLowerCase()} in slot ${selected + 1} for ₹${refund}.`);
  }
  update();
}

function select(slot) {
  const count = state.level.slots;
  selected = (slot + count) % count;       // wraps round at both ends
  update();
}

// Start the wave, pause it, or carry on.
function toggleRun() {
  if (state.status !== 'playing') return;
  if (running) {
    stopClock();
    say('Paused. You can still buy and sell.');
  } else {
    say(state.t === 0 ? `Wave ${state.wave} is coming.` : 'Running.');
    startClock();
  }
  update();
}

function setSpeed(value) {
  speed = value;
  if (running) startClock();               // restart the timer at the new pace
  update();
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  stopClock();
  selected = state.level.slots - 1;        // the slot nearest the exit: a good home for a server
  buildLevel();
  resize();
  say(state.level.intro);
  drawPicker();
  update();
  if (moveFocus) view.slotButtons[selected].focus();
}

function rememberWin() {
  const id = state.level.id;
  const old = best[id];
  const earned = stars(state);
  if (!old || earned > old.stars || (earned === old.stars && state.errors < old.errors)) {
    best[id] = { stars: earned, errors: state.errors };
    save(SAVE_KEY, best);
  }
  drawPicker();
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const over = state.status !== 'playing';
  const lastLevel = levelIndex === levels.length - 1;
  const towerIndex = Number(key) - 1;

  if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
  else if (key === 'f') setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
  else if (over) return;                    // the rest only make sense while playing
  else if (key === ' ') { event.preventDefault(); toggleRun(); }
  else if (key === 'arrowleft') { event.preventDefault(); moveSelection(-1); }
  else if (key === 'arrowright') { event.preventDefault(); moveSelection(1); }
  else if (key === 'x') sellSelected();
  else if (towerIndex >= 0 && towerIndex < TOWER_ORDER.length) buySelected(TOWER_ORDER[towerIndex]);
}

// Some browsers press the focused button when Space is released. Space is ours while playing.
function onKeyUp(event) {
  if (event.key === ' ' && state.status === 'playing') event.preventDefault();
}

function moveSelection(step) {
  const onSlot = view.slotButtons.includes(document.activeElement);
  select(selected + step);
  if (onSlot) view.slotButtons[selected].focus();
}

// Tapping the picture of a slot selects it, the same as its button.
function onCanvasClick(event) {
  const x = pointerPos(event, view.canvas).x;
  const slot = Math.floor((x - geo.laneX) / geo.slotW);
  if (slot >= 0 && slot < state.level.slots) select(slot);
}

// --------------------------------------------------------------- the clock

// While a wave is playing, a timer plays one tick at a time. Between ticks, frame()
// redraws the lane with the requests part-way to their next position, so they glide.

function startClock() {
  stopClock();
  running = true;
  lastTickAt = performance.now();
  timer = setInterval(onTimer, BASE_TICK_MS / speed);
  queueFrame();
}

function stopClock() {
  running = false;
  clearInterval(timer);
}

function onTimer() {
  lastTickAt = performance.now();
  step();
  draw(0);
}

function queueFrame() {
  if (frameQueued || reduceMotion) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}

function frame() {
  frameQueued = false;
  if (!running) return;
  const sinceTick = performance.now() - lastTickAt;
  draw(Math.min(1, sinceTick / (BASE_TICK_MS / speed)));
  queueFrame();
}

// Play one tick and react to what it changed.
function step() {
  const before = state;
  state = tick(state);
  if (state.status !== 'playing') {
    stopClock();
    if (state.status === 'won') rememberWin();
    say(state.status === 'won' ? 'Every wave cleared.' : 'Too many requests went unanswered.', state.status === 'lost');
  } else if (state.wave !== before.wave) {
    stopClock();
    say(`Wave ${before.wave} cleared: +₹${state.paid}. Build for wave ${state.wave}, then send it.`);
  }
  update();
  if (state.status !== 'playing') view.primary.focus();
}

// ------------------------------------------------------- drawing the canvas

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// The most requests of one kind that a level sends in a single tick.
function biggestStack(level) {
  let most = 1;
  for (const wave of level.waves) {
    for (const kind of Object.keys(wave.perTick)) most = Math.max(most, wave.perTick[kind]);
  }
  return most;
}

// Work out every size from the width the canvas has on this screen.
// One tick's requests are drawn as a block: as many columns as fit before the next
// tick's block, and as many rows as the level's biggest stack then needs.
function resize() {
  const level = state.level;
  const width = Math.max(MIN_WIDTH, view.board.clientWidth - 2);   // minus the canvas border
  const laneW = width - GUTTER - EXIT_WIDTH;
  const perUnit = laneW / laneLength(level);                        // px per lane unit
  const size = clamp(Math.floor(perUnit) - 2, MIN_SHAPE, MAX_SHAPE);
  const pitch = size + 2;                                           // a shape plus the gap after it
  const columns = clamp(Math.floor((perUnit * rules.speed) / pitch), 2, MAX_COLUMNS);
  const rows = Math.max(MIN_ROWS, Math.ceil(biggestStack(level) / columns));
  const rowH = rows * pitch + ROW_PAD;
  const height = HEADER + KIND_ORDER.length * rowH + 12;
  geo = { width, height, laneX: GUTTER, laneW, perUnit, size, pitch, rows, rowH, slotW: laneW / level.slots };
  ctx = fitCanvas(view.canvas, width, height);
  draw(0);
}

// Read the colours from the stylesheet each time, so the canvas follows the theme.
function readLook() {
  const look = { text: token('--text'), muted: token('--muted'), line: token('--line'), bad: token('--bad'),
    accent: token('--accent'), mono: token('--mono') };
  for (const name of [...KIND_ORDER, ...TOWER_ORDER]) look[name] = token(`--ts-${name}`) || look.text;
  return look;
}

// Draw everything. `glide` is how far we are towards the next tick, from 0 to 1.
function draw(glide) {
  const look = readLook();
  ctx.clearRect(0, 0, geo.width, geo.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawRows(look);
  for (let slot = 0; slot < state.level.slots; slot += 1) drawSlot(slot, look);
  drawGone(glide, look);
  drawRequests(glide, look);
  drawExit(look);
}

// The entrance strip on the left, and one row per kind of request with its letter.
function drawRows(look) {
  ctx.fillStyle = look.line;
  ctx.fillRect(0, 0, GUTTER, geo.height);
  ctx.fillStyle = look.text;
  ctx.font = `700 10px ${look.mono}`;
  ctx.fillText('IN', GUTTER / 2, 14);
  ctx.font = `700 12px ${look.mono}`;
  KIND_ORDER.forEach((kind, row) => {
    const top = HEADER + row * geo.rowH;
    ctx.fillStyle = look.line;
    ctx.fillRect(geo.laneX, top, geo.laneW, 1);
    ctx.fillStyle = look[kind];
    ctx.fillText(kinds[kind].letter, GUTTER / 2, top + geo.rowH / 2);
  });
}

function drawSlot(slot, look) {
  const x = geo.laneX + slot * geo.slotW + 2;
  const w = geo.slotW - 4;
  const h = geo.height - 4;
  const tower = state.slots[slot];
  ctx.lineWidth = 1;
  if (tower) {
    ctx.fillStyle = look[tower.kind];
    ctx.globalAlpha = state.worked[slot] > 0 ? 0.3 : 0.12;     // brighter on a tick it handled something
    ctx.fillRect(x, 2, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = look[tower.kind];
    ctx.strokeRect(x + 0.5, 2.5, w - 1, h - 1);
    drawTowerLabel(slot, tower, x + w / 2, look);
  } else {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = look.line;
    ctx.strokeRect(x + 0.5, 2.5, w - 1, h - 1);
    ctx.setLineDash([]);
  }
  if (slot === selected) drawSelection(x, w, h, look);
}

// The chosen slot gets a thick outline and a marker pointing at its button.
function drawSelection(x, w, h, look) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = look.accent;
  ctx.strokeRect(x + 1.5, 3.5, w - 3, h - 3);
  ctx.fillStyle = look.accent;
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - 6, geo.height - 11);
  ctx.lineTo(x + w / 2 + 6, geo.height - 11);
  ctx.lineTo(x + w / 2, geo.height - 3);
  ctx.fill();
}

// What a component says about this tick, e.g. "3/3 max" or "37/80".
function towerStatus(slot, tower) {
  if (tower.kind === 'queue') {
    const held = heldCount(tower);
    return held >= towers.queue.size ? `full ${held}` : `${held}/${towers.queue.size}`;
  }
  const rate = towers[tower.kind].rate;
  const worked = state.worked[slot];
  return worked >= rate ? `${worked}/${rate} max` : `${worked}/${rate}`;
}

function drawTowerLabel(slot, tower, centre, look) {
  ctx.fillStyle = look.text;
  ctx.font = `700 11px ${look.mono}`;
  ctx.fillText(tower.kind.toUpperCase(), centre, 13);
  ctx.font = `600 11px ${look.mono}`;
  ctx.fillStyle = look.muted;
  ctx.fillText(towerStatus(slot, tower), centre, 27);
}

// Add up groups of requests by kind and position, so each spot is drawn once.
function stacksOf(groups) {
  const stacks = new Map();
  for (const group of groups) {
    const key = `${group.kind}:${group.pos}`;
    const stack = stacks.get(key) || { kind: group.kind, pos: group.pos, count: 0 };
    stack.count += group.count;
    stacks.set(key, stack);
  }
  return [...stacks.values()];
}

function drawRequests(glide, look) {
  for (const stack of stacksOf(state.lane)) {
    const row = KIND_ORDER.indexOf(stack.kind);
    const x = geo.laneX + 2 + (stack.pos + glide * rules.speed) * geo.perUnit;
    drawStack(stack, x, HEADER + row * geo.rowH, look);
  }
}

// The requests a component took in the latest tick, fading out where they were taken.
// Without this, a request handled the moment it arrives would never be seen at all.
function drawGone(glide, look) {
  ctx.globalAlpha = GONE_ALPHA * (1 - glide);
  for (const stack of stacksOf(state.gone)) {
    const row = KIND_ORDER.indexOf(stack.kind);
    const x = geo.laneX + 2 + stack.pos * geo.perUnit;
    drawStack(stack, x, HEADER + row * geo.rowH, look);
  }
  ctx.globalAlpha = 1;
}

// One stack of requests: a column of up to geo.rows shapes, then a second column, and so on.
function drawStack(stack, x, top, look) {
  const columns = Math.ceil(stack.count / geo.rows);
  const rows = Math.ceil(stack.count / columns);
  const firstY = top + (geo.rowH - rows * geo.pitch) / 2 + 1;
  ctx.fillStyle = look[stack.kind];
  for (let i = 0; i < stack.count; i += 1) {
    const column = Math.floor(i / rows);
    drawShape(SHAPES[stack.kind], x + column * geo.pitch, firstY + (i % rows) * geo.pitch, geo.size);
  }
}

function drawShape(shape, x, y, size) {
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(x + size / 2, y);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y + size);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, size, size);
  }
}

// The strip on the right. It turns red, with a count, on a tick that caused errors.
function drawExit(look) {
  const x = geo.laneX + geo.laneW;
  const hit = state.newErrors > 0;
  ctx.fillStyle = hit ? look.bad : look.line;
  ctx.fillRect(x, 0, EXIT_WIDTH, geo.height);
  ctx.save();
  ctx.translate(x + EXIT_WIDTH / 2, geo.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = look.text;
  ctx.font = `700 11px ${look.mono}`;
  ctx.fillText(hit ? `EXIT  ✕ ${state.newErrors} ERRORS` : 'EXIT', 0, 1);
  ctx.restore();
}

// ---------------------------------------------------------- building the page

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// A small picture of one kind of request, matching its shape on the canvas.
function kindIcon(kind) {
  let mark = svg('rect', { x: 1, y: 1, width: 10, height: 10 });
  if (SHAPES[kind] === 'circle') mark = svg('circle', { cx: 6, cy: 6, r: 5 });
  if (SHAPES[kind] === 'triangle') mark = svg('path', { d: 'M6 1 L11 11 L1 11 Z' });
  return svg('svg', { class: 'ts-shape', viewBox: '0 0 12 12', 'data-kind': kind, 'aria-hidden': 'true' }, mark);
}

function speedButton(value) {
  return el('button', { class: 'btn', type: 'button', dataset: { speed: String(value) }, onclick: () => setSpeed(value),
    'aria-label': `Speed ${value} times` }, `${value}×`);
}

// Runs once: creates the parts of the page that are the same for every level.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.wave = el('span');
  view.money = el('span', { class: 'ts-money' });
  view.budgetText = el('span', { class: 'mono' });
  view.meter = el('div', { class: 'meter', role: 'meter', 'aria-label': 'Error budget left', 'aria-valuemin': '0' }, el('span'));
  view.canvas = el('canvas', { class: 'stage ts-stage', role: 'img', onclick: onCanvasClick,
    'aria-label': 'The lane. Requests move from left to right through the slots. The buttons below show what is in each slot.' });
  view.slots = el('div', { class: 'ts-slots', role: 'group', 'aria-label': 'Slots',
    style: { paddingLeft: `${GUTTER + 1}px`, paddingRight: `${EXIT_WIDTH + 1}px` } });
  view.board = el('div', { class: 'ts-board' }, view.canvas, view.slots);
  view.say = el('p', { class: 'ts-say', role: 'status' });
  view.shop = el('div', { class: 'ts-shop', role: 'group', 'aria-label': 'Buy a component for the chosen slot' });
  view.sendLabel = el('span');
  view.send = el('button', { class: 'btn btn-primary', type: 'button', onclick: toggleRun }, view.sendLabel, kbd('Space'));
  view.sellLabel = el('span');
  view.sell = el('button', { class: 'btn', type: 'button', onclick: sellSelected }, view.sellLabel, kbd('X'));
  view.speeds = SPEEDS.map(speedButton);
  view.waves = el('ol', { class: 'ts-waves', 'aria-label': 'Waves in this level' });
  view.result = el('section', { class: 'panel result ts-result stack', hidden: true });

  main.append(
    el('p', { class: 'how' }, 'Stop real requests reaching the exit unanswered: pick a slot, buy a component for it, then send the wave.'),
    view.picker,
    el('section', { class: 'panel stack' }, buildHead(), view.board, view.say, view.result, buildControls(), view.shop),
    el('section', { class: 'panel stack' }, el('h3', {}, 'Waves in this level'), view.waves, buildLegend()),
    el('p', { class: 'muted ts-keys' }, kbd('←'), ' ', kbd('→'), ' pick a slot · ', kbd('1'), '–', kbd('4'), ' buy · ',
      kbd('X'), ' sell · ', kbd('Space'), ' send or pause · ', kbd('F'), ' speed · ', kbd('R'), ' restart'),
  );
}

function buildHead() {
  return el('div', { class: 'stack' },
    el('div', { class: 'ts-head' }, view.title, el('div', { class: 'ts-stats' }, view.wave, view.money)),
    el('div', { class: 'ts-budget' },
      el('div', { class: 'ts-budget-label' }, el('span', {}, 'Error budget'), view.budgetText),
      view.meter));
}

function buildControls() {
  return el('div', { class: 'row' },
    view.send,
    view.sell,
    el('div', { class: 'ts-speed', role: 'group', 'aria-label': 'Speed' }, el('span', { class: 'muted' }, 'Speed'), view.speeds),
    el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Restart', kbd('R')));
}

function buildLegend() {
  const entries = KIND_ORDER.map((kind) => el('span', { class: 'ts-count' },
    kindIcon(kind), `${kinds[kind].letter} = ${kinds[kind].name}`));
  return el('div', { class: 'stack' },
    el('p', { class: 'ts-legend' }, entries),
    el('p', { class: 'muted' }, 'A bot that reaches the exit is not an error. But a server or a queue cannot tell a bot from a customer.'));
}

// Runs when a level opens: the slot buttons, the shop and the wave list depend on the level.
function buildLevel() {
  const level = state.level;
  view.slots.style.setProperty('--ts-slot-count', String(level.slots));
  view.slotButtons = [];
  view.slotNames = [];
  for (let slot = 0; slot < level.slots; slot += 1) {
    view.slotNames.push(el('span'));
    view.slotButtons.push(el('button', { class: 'btn ts-slot', type: 'button', onclick: () => select(slot) },
      el('span', { class: 'ts-slot-number' }, `slot ${slot + 1}`), view.slotNames[slot]));
  }
  view.slots.replaceChildren(...view.slotButtons);
  view.shopButtons = TOWER_ORDER.filter((kind) => level.shop.includes(kind)).map(shopButton);
  view.shop.replaceChildren(...view.shopButtons);
  view.waveItems = level.waves.map(waveItem);
  view.waves.replaceChildren(...view.waveItems);
}

function shopButton(kind) {
  const tower = towers[kind];
  const rate = kind === 'queue' ? `Holds ${tower.size}, lets out ${tower.rate} a tick.` : `Up to ${tower.rate} a tick.`;
  return el('button', { class: 'btn ts-buy', type: 'button', dataset: { tower: kind }, onclick: () => buySelected(kind) },
    el('span', { class: 'ts-buy-top' },
      kbd(String(TOWER_ORDER.indexOf(kind) + 1)), el('span', {}, tower.name), el('span', { class: 'ts-buy-cost' }, `₹${tower.cost}`)),
    el('span', { class: 'ts-buy-does' }, `${tower.does} ${rate}`));
}

function waveItem(wave, index) {
  const counts = KIND_ORDER.filter((kind) => wave.perTick[kind] > 0).map((kind) => el('span', { class: 'ts-count' },
    kindIcon(kind), `${wave.perTick[kind]} ${kinds[kind].letter}`));
  const isLast = index === state.level.waves.length - 1;
  return el('li', { class: 'ts-wave' },
    el('span', { class: 'ts-wave-name' }),
    counts,
    el('span', { class: 'muted' }, `a tick, for ${wave.ticks} ticks`),
    el('span', { class: 'ts-wave-pay' }, isLast ? 'last wave' : `pays ₹${wave.reward}`));
}

// ---------------------------------------------------------- updating the page

// Runs after every input and every tick: copies the state onto the page.
function update() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.wave.textContent = `Wave ${state.wave} of ${level.waves.length}`;
  view.money.textContent = `₹${state.money}`;
  updateBudget();
  updateSlots();
  updateShop();
  updateControls();
  updateWaves();
  drawResult();
  if (!running) draw(0);
}

// The error budget meter drains from full to empty.
function updateBudget() {
  const budget = state.level.errorBudget;
  const left = Math.max(0, budget - state.errors);
  const percent = budget > 0 ? Math.round((left * 100) / budget) : 0;
  let level = 'ok';
  if (percent <= 50) level = 'mid';
  if (percent <= 25) level = 'low';
  view.budgetText.textContent = `${left} of ${budget} left`;
  view.meter.style.setProperty('--value', `${percent}%`);
  view.meter.dataset.level = level;
  view.meter.setAttribute('aria-valuemax', String(budget));
  view.meter.setAttribute('aria-valuenow', String(left));
}

function updateSlots() {
  state.slots.forEach((tower, slot) => {
    const name = tower ? towers[tower.kind].name : 'empty';
    view.slotNames[slot].textContent = name;
    view.slotButtons[slot].setAttribute('aria-pressed', slot === selected ? 'true' : 'false');
    view.slotButtons[slot].setAttribute('aria-label', `Slot ${slot + 1}: ${name}`);
  });
}

// A shop button looks switched off when the buy would be refused. It can still be
// pressed: the reason then appears in the message line.
function updateShop() {
  for (const button of view.shopButtons) {
    const refused = whyNot(state, { buy: button.dataset.tower, slot: selected }) !== '';
    button.setAttribute('aria-disabled', refused ? 'true' : 'false');
  }
}

function updateControls() {
  const over = state.status !== 'playing';
  const tower = state.slots[selected];
  let label = state.t === 0 ? `Send wave ${state.wave}` : 'Resume';
  if (running) label = 'Pause';
  view.sendLabel.textContent = label;
  view.send.hidden = over;                 // once the level is over, the result box has the way onward
  view.sell.hidden = over;
  view.sellLabel.textContent = tower ? `Sell for ₹${refundFor(state, selected)}` : 'Sell';
  view.sell.setAttribute('aria-disabled', tower ? 'false' : 'true');
  for (const button of view.speeds) {
    button.setAttribute('aria-pressed', button.dataset.speed === String(speed) ? 'true' : 'false');
  }
}

function updateWaves() {
  view.waveItems.forEach((item, index) => {
    const number = index + 1;
    let when = 'next';
    if (number < state.wave || state.status === 'won') when = 'done';
    else if (number === state.wave) when = 'now';
    const mark = { done: '✓ ', now: '▶ ', next: '' }[when];
    item.dataset.when = when;
    item.firstElementChild.textContent = `${mark}Wave ${number}`;
  });
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] ? best[level.id].stars : 0;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}, ${level.title}, ${earned} of 3 stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

// ---------------------------------------------------------- the result panel

// "14 API calls, 8 static files": which legitimate requests got no answer.
function missedText() {
  const parts = KIND_ORDER.filter((kind) => state.missed[kind] > 0)
    .map((kind) => plural(state.missed[kind], kinds[kind].name));
  return parts.join(', ');
}

// One action per line, ready to paste into levels.js.
function solutionText() {
  const lines = recorded.map((action) => `  ${JSON.stringify(action)},`);
  const check = replay(state.level, recorded).status;
  return `solution: [\n${lines.join('\n')}\n]\n// replay of these actions: ${check}`;
}

function drawResult() {
  const over = state.status !== 'playing';
  view.result.hidden = !over;
  if (!over) {
    view.shownResult = null;
    return;
  }
  if (view.shownResult === state) return;      // already showing this result
  view.shownResult = state;

  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result ts-result stack' : 'panel result ts-result lost stack';

  if (won && !lastLevel) {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) },
      'Next level', kbd('N'));
  } else {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex, true) },
      won ? 'Play again' : 'Try again', kbd('R'));
  }
  const parts = [
    ...(won ? wonLines(lastLevel) : lostLines()),
    el('div', { class: 'row' }, view.primary),
    DEV && won ? el('pre', { class: 'dev' }, solutionText()) : null,
  ];
  view.result.replaceChildren(...parts.filter(Boolean));   // drop the lines that do not apply
}

function wonLines(lastLevel) {
  const earned = stars(state);
  const budget = state.level.errorBudget;
  return [
    el('h2', {}, state.errors === 0 ? 'Every request answered' : 'Traffic handled'),
    el('p', { class: 'stars ts-result-stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', { class: 'ts-result-facts' }, `Errors: ${state.errors} of ${budget} allowed · Money left: ₹${state.money}`),
    earned < 3 ? el('p', { class: 'muted' }, `Three stars need ${Math.floor((budget * rules.threeStarPercent) / 100)} errors or fewer.`) : null,
    lastLevel ? el('p', {}, 'That was the last level.') : null,
  ];
}

function lostLines() {
  return [
    el('h2', {}, `Error budget spent in wave ${state.wave}`),
    el('p', { class: 'ts-result-facts' }, `${state.errors} errors, ${state.level.errorBudget} allowed. Unanswered: ${missedText()}.`),
    el('p', { class: 'muted' }, 'Watch which shapes reach the exit, and which component shows "max". Then put something in their way.'),
  ];
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

build();
openLevel(firstUnsolved(), false);
document.addEventListener('keydown', onKey);
document.addEventListener('keyup', onKeyUp);
window.addEventListener('resize', resize);
ready();
