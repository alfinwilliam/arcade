// PAGE for Drift: drawing and input only.
// The maths (random numbers, the flow field, moving the particles) lives in logic.js.
// The looks (colours, speeds, counts) live in presets.js.
//
// How this file is laid out:
//   1. Tunable numbers and the page's state.
//   2. Actions: one function per button (choose a preset, pause, clear, new pattern, save).
//   3. Stirring: the pointer and the arrow keys both feed the same `stir` object.
//   4. Drawing: fade the old lines a little, then draw one short line per particle.
//   5. The loop: runs the steps at a steady 60 per second while the page is visible.
//   6. build() creates the page once; then the first picture is drawn and ready() is called.
//
// Handy while testing: add ?seed=123 to the URL to get the same pattern every time.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { fitCanvas, pointerPos } from '../../shared/canvas.js';
import { presets } from './presets.js';
import { createWorld, step, validatePreset } from './logic.js';

// ---------------------------------------------------------------- tunable numbers

const SAVE_KEY = 'drift:preset';                    // remembers the id of the last preset chosen
const WIDE_SIZE = { width: 960, height: 540 };      // the canvas, in drawing units, on a wide screen
const NARROW_SIZE = { width: 400, height: 500 };    // ...and on a narrow one (taller, so it fills a phone)
const NARROW_QUERY = '(max-width: 640px)';          // keep the same width as the @media rule in style.css
const STEP_MS = 1000 / 60;                          // one step of the particles per 60th of a second
const MAX_STEPS_PER_FRAME = 2;                      // after a hiccup, catch up at most this fast
const WARM_UP_STEPS = 180;                          // steps drawn at once, so a new picture never starts blank
const KEY_STIR = 28;                                // how far one arrow-key press moves the stir ring
const RING_HIDE_MS = 900;                           // the ring stays this long after the last arrow key
const SEED_LIMIT = 100000;                          // random seeds run from 0 to one less than this
const GENERATOR_RANGE = 2 ** 32;                    // createRandom (logic.js) only uses a seed modulo this
const DOWNLOAD_CLEANUP_MS = 10000;                  // a saved picture's temporary link is released after this long
const KEY_PRESETS = 9;                              // keys 1 to 9 pick the first nine presets
const ARROWS = {                                    // arrow key -> direction [x, y]
  arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1],
};

// ---------------------------------------------------------------- state

const main = mountShell({ title: 'Drift' });
const narrowScreen = window.matchMedia(NARROW_QUERY);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const view = {};          // the page elements the functions below need to reach
let ctx = null;           // the canvas drawing context
let world = null;         // the flow field and the particles, always made by logic.js
let presetIndex = 0;
let seed = 0;
let paused = reducedMotion;   // people who ask for less motion get a still picture and a Play button

let frameRequest = 0;     // the id of the waiting animation frame, or 0 when the loop is stopped
let lastFrameTime = 0;
let owedMs = 0;           // time that has passed but has not been turned into steps yet

// Where the player is stirring, and how far they moved since the last step.
// pointerId is the finger (or mouse or pen) doing the stirring; other fingers are ignored.
const stir = { x: 0, y: 0, dx: 0, dy: 0, dragging: false, pointerId: null };
let ringTimer = 0;

// ---------------------------------------------------------------- actions

function currentPreset() {
  return presets[presetIndex];
}

function randomSeed() {
  return Math.floor(Math.random() * SEED_LIMIT);
}

// Show a short message just above the picture. Screen readers read it out too.
// Pass isProblem = true when something went wrong: it is then shown in the "bad" colour.
function say(message, isProblem = false) {
  view.said.textContent = message;
  view.said.classList.toggle('drift-said-bad', isProblem);
}

function choosePreset(index) {
  presetIndex = index;
  save(SAVE_KEY, currentPreset().id);
  seed = randomSeed();
  startPicture();
  // A preset that never fades fills up over time, so say how to start again.
  const hint = currentPreset().fade === 0 ? ' Lines never fade here: press Clear to start again.' : '';
  say(`${currentPreset().name}: a new pattern.${hint}`);
}

function newPattern() {
  seed = randomSeed();
  startPicture();
  say('New pattern.');
}

function clearTrails() {
  wipe();
  say(paused ? 'Cleared. Press Play to draw again.' : 'Cleared.');
}

function togglePause() {
  paused = !paused;
  stir.dx = 0;
  stir.dy = 0;
  updateControls();
  syncLoop();
  say(paused ? 'Paused.' : 'Playing.');
}

function savePng() {
  const name = `drift-${currentPreset().id}-${seed}.png`;
  view.canvas.toBlob((blob) => {
    if (!blob) {
      say('Sorry, this browser could not save the picture.', true);
      return;
    }
    const url = URL.createObjectURL(blob);
    el('a', { href: url, download: name }).click();   // a link that is "clicked" to start the download
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_CLEANUP_MS);
    say(`Saving as ${name} ...`);   // "Saving", not "Saved": the page cannot tell if the browser did
  }, 'image/png');
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (typeof event.key !== 'string') return;   // some odd keyboards and tools send no key name
  const key = event.key.toLowerCase();
  // A held-down key repeats. That is wanted for stirring, but not for saving twenty pictures.
  if (event.repeat && !ARROWS[key]) return;
  const number = Number(key);
  if (number >= 1 && number <= Math.min(presets.length, KEY_PRESETS)) choosePreset(number - 1);
  else if (key === 'p') togglePause();
  else if (key === 'c') clearTrails();
  else if (key === 'n') newPattern();
  else if (key === 's') savePng();
  else if (ARROWS[key]) {
    event.preventDefault();   // stop the arrow key from scrolling the page
    keyStir(ARROWS[key]);
  }
}

// ---------------------------------------------------------------- stirring

function showRing() {
  view.ring.style.left = `${(stir.x / world.width) * 100}%`;
  view.ring.style.top = `${(stir.y / world.height) * 100}%`;
  view.ring.hidden = false;
}

function hideRing() {
  view.ring.hidden = true;
}

function remindIfPaused() {
  if (paused) say('Paused. Press Play, then stir.');
}

function onPointerDown(event) {
  if (event.button !== 0) return;   // left mouse button, a finger or a pen; not a right-click
  // A second finger while the first is still stirring is not "primary": ignore it.
  // (A new primary pointer means the old one is gone, so that one may take over.)
  if (stir.dragging && !event.isPrimary) return;
  const spot = pointerPos(event, view.canvas);
  stir.x = spot.x;
  stir.y = spot.y;
  stir.dragging = true;
  stir.pointerId = event.pointerId;
  // Keep getting moves even if the pointer leaves the canvas. The drag works without it,
  // so if the browser refuses (it can, for a pointer it no longer tracks), just carry on.
  try {
    view.canvas.setPointerCapture(event.pointerId);
  } catch {
    // no capture: moves outside the canvas are simply missed
  }
  clearTimeout(ringTimer);
  showRing();
  remindIfPaused();
}

function onPointerMove(event) {
  if (!stir.dragging || event.pointerId !== stir.pointerId) return;   // only the stirring finger
  const spot = pointerPos(event, view.canvas);
  if (!paused) {
    stir.dx += spot.x - stir.x;
    stir.dy += spot.y - stir.y;
  }
  stir.x = spot.x;
  stir.y = spot.y;
  showRing();
}

function onPointerUp(event) {
  if (event.pointerId !== stir.pointerId) return;   // another finger lifted: keep stirring
  stir.dragging = false;
  stir.pointerId = null;
  hideRing();
}

// One arrow-key press: move the ring that way and stir as if the pointer had been dragged there.
function keyStir([directionX, directionY]) {
  stir.x = Math.max(0, Math.min(world.width, stir.x + directionX * KEY_STIR));
  stir.y = Math.max(0, Math.min(world.height, stir.y + directionY * KEY_STIR));
  if (!paused) {
    stir.dx += directionX * KEY_STIR;
    stir.dy += directionY * KEY_STIR;
  }
  showRing();
  clearTimeout(ringTimer);
  ringTimer = setTimeout(hideRing, RING_HIDE_MS);
  remindIfPaused();
}

// Hand the collected movement to the next step, and start collecting again.
function takeStir() {
  if (stir.dx === 0 && stir.dy === 0) return null;
  const taken = { x: stir.x, y: stir.y, dx: stir.dx, dy: stir.dy };
  stir.dx = 0;
  stir.dy = 0;
  return taken;
}

// ---------------------------------------------------------------- drawing

// Paint the whole canvas in the preset's background colour.
function wipe() {
  ctx.globalAlpha = 1;
  ctx.fillStyle = currentPreset().background;
  ctx.fillRect(0, 0, world.width, world.height);
}

// Paint a see-through layer of background over everything, so old lines sink away a little.
function fadeTrails() {
  const preset = currentPreset();
  if (preset.fade === 0) return;
  ctx.globalAlpha = preset.fade;
  ctx.fillStyle = preset.background;
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.globalAlpha = 1;
}

// One short line per particle, from where it was to where it is. All the lines of one
// colour are drawn together, which is much faster than drawing them one by one.
function drawLines() {
  const preset = currentPreset();
  ctx.lineWidth = preset.width;
  preset.palette.forEach((colour, colourIndex) => {
    ctx.beginPath();
    for (const particle of world.particles) {
      if (particle.colour !== colourIndex) continue;
      ctx.moveTo(particle.prevX, particle.prevY);
      ctx.lineTo(particle.x, particle.y);
    }
    ctx.strokeStyle = colour;
    ctx.stroke();
  });
}

// One step of the toy: move the particles, then draw what changed.
function advance(stirNow) {
  step(world, stirNow);
  fadeTrails();
  drawLines();
}

// Start a fresh picture for the current preset and seed, sized for the current screen.
function startPicture() {
  const size = narrowScreen.matches ? NARROW_SIZE : WIDE_SIZE;
  ctx = fitCanvas(view.canvas, size.width, size.height);
  ctx.lineCap = 'round';
  world = createWorld(currentPreset(), size.width, size.height, seed);
  // The arrow keys start from the middle. Mid-drag, keep the finger's spot, or the next
  // move would count the jump from the middle to the finger as one big stir.
  if (!stir.dragging) {
    stir.x = size.width / 2;
    stir.y = size.height / 2;
  }
  stir.dx = 0;
  stir.dy = 0;
  wipe();
  for (let i = 0; i < WARM_UP_STEPS; i += 1) advance(null);
  updateControls();
}

// Copy the state onto the buttons and the info line.
function updateControls() {
  const preset = currentPreset();
  [...view.presets.children].forEach((button, index) => {
    button.setAttribute('aria-pressed', index === presetIndex ? 'true' : 'false');
  });
  view.pauseLabel.textContent = paused ? 'Play' : 'Pause';
  view.pause.classList.toggle('btn-primary', paused);
  view.info.textContent = `${preset.name} · pattern ${seed} · ${world.particles.length} particles`;
}

// ---------------------------------------------------------------- the loop

function frame(now) {
  frameRequest = requestAnimationFrame(frame);
  owedMs += now - lastFrameTime;
  lastFrameTime = now;
  // If the page stalled for a while, do not try to replay all the missed time.
  owedMs = Math.min(owedMs, STEP_MS * MAX_STEPS_PER_FRAME);
  while (owedMs >= STEP_MS) {
    advance(takeStir());
    owedMs -= STEP_MS;
  }
}

// Run the loop only while the toy is playing and the tab is visible.
function syncLoop() {
  const shouldRun = !paused && !document.hidden;
  if (shouldRun && !frameRequest) {
    lastFrameTime = performance.now();
    owedMs = 0;
    frameRequest = requestAnimationFrame(frame);
  } else if (!shouldRun && frameRequest) {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }
}

// ---------------------------------------------------------------- building the page

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function presetButton(preset, index) {
  // The swatch is a gradient through the palette. The first colour is added again at the
  // end, so a one-colour palette still gives two stops (a gradient needs at least two).
  const swatch = el('span', {
    class: 'drift-swatch', 'aria-hidden': 'true',
    style: { background: `linear-gradient(135deg, ${[...preset.palette, preset.palette[0]].join(', ')})` },
  });
  return el('button', { class: 'btn drift-preset', type: 'button', onclick: () => choosePreset(index) },
    swatch,
    el('span', { class: 'drift-name' }, preset.name),
    index < KEY_PRESETS ? kbd(String(index + 1)) : null);
}

// Runs once: creates every element and puts it on the page.
function build() {
  view.presets = el('div', { class: 'row', role: 'group', 'aria-label': 'Styles' }, presets.map(presetButton));
  view.pauseLabel = el('span', {}, 'Pause');
  view.pause = el('button', { class: 'btn', type: 'button', onclick: togglePause }, view.pauseLabel, kbd('P'));
  view.canvas = el('canvas', {
    class: 'stage drift-canvas', role: 'img',
    'aria-label': 'Coloured particles drifting along an invisible flow and leaving trails.',
    onpointerdown: onPointerDown, onpointermove: onPointerMove, onpointerup: onPointerUp, onpointercancel: onPointerUp,
  });
  view.ring = el('div', { class: 'drift-ring', hidden: true, 'aria-hidden': 'true' });
  view.info = el('p', { class: 'muted mono drift-info' });
  view.said = el('p', { class: 'drift-said', role: 'status' });

  // Order on the page: how-to line, buttons, message, picture, info line. The message sits
  // between the buttons and the picture so it stays on screen on a phone.
  main.append(
    el('p', { class: 'how' },
      'Drag across the picture to stir the drifting particles',
      el('span', { class: 'drift-keys-hint' }, ', or use the arrow keys'),   // hidden on phones
      '. Pick a style to change the mood.'),
    el('div', { class: 'drift-controls' },
      view.presets,
      el('div', { class: 'row', role: 'group', 'aria-label': 'Actions' },
        view.pause,
        el('button', { class: 'btn', type: 'button', onclick: clearTrails }, 'Clear', kbd('C')),
        el('button', { class: 'btn', type: 'button', onclick: newPattern }, 'New pattern', kbd('N')),
        el('button', { class: 'btn', type: 'button', onclick: savePng }, 'Save picture', kbd('S')))),
    view.said,
    el('div', { class: 'drift-stage' }, view.canvas, view.ring),
    el('div', { class: 'row drift-status' }, view.info),
  );
}

// ---------------------------------------------------------------- start

// A mistake in presets.js should say which entry and which field, not just look odd.
function checkPresets() {
  for (const preset of presets) {
    const problems = validatePreset(preset);
    if (problems.length > 0) {
      throw new Error(`presets.js, entry "${preset && preset.id}": ${problems.join('; ')}`);
    }
  }
}

// Which preset to open with: the one saved last time, or the first.
function savedPresetIndex() {
  const index = presets.findIndex((preset) => preset.id === load(SAVE_KEY, ''));
  return index === -1 ? 0 : index;
}

// ?seed=123 in the URL gives that pattern; otherwise pick one at random.
// Only plain digits count ("", "1e3" and "0x10" get a random pattern). The number is folded
// into the generator's range, so the info line and the file name match the picture drawn.
function firstSeed() {
  const asked = new URLSearchParams(location.search).get('seed');
  if (asked === null || !/^\d+$/.test(asked)) return randomSeed();
  return Number(asked) % GENERATOR_RANGE;
}

checkPresets();
build();
presetIndex = savedPresetIndex();
seed = firstSeed();
startPicture();
if (reducedMotion) say('Paused, because your device asks for less motion. Press Play to start.');

document.addEventListener('keydown', onKey);
document.addEventListener('visibilitychange', syncLoop);
narrowScreen.addEventListener('change', startPicture);   // crossing the narrow/wide line needs a new canvas size
syncLoop();
ready();
