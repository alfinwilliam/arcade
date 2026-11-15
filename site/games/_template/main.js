// PAGE for the template game "Number Hop": drawing and input only.
// Every rule lives in logic.js. This file never decides who wins.
//
// The shape to copy for a new game:
//   1. mountShell() gives you the top bar and the <main> to build in.
//   2. Build the page once (build), then refresh it after every input (update).
//   3. Every input goes through one function (press) that calls logic.apply and records the input.
//   4. Call ready() once the first frame is on screen.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import { start, apply, replay, stars } from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded moves on a win
const SAVE_KEY = '_template:stars';                             // saved as { levelId: bestStars }

const main = mountShell({ title: 'Number Hop' });
const best = load(SAVE_KEY, {});
const view = {};        // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;       // the current game state, always produced by logic.js
let recorded = [];      // every move pressed so far, in order: exactly what replay() takes

// ------------------------------------------------------------------- inputs

function press(move) {
  if (state.status !== 'playing') return;
  state = apply(state, move);
  recorded.push(move);
  if (state.status === 'won') rememberWin();
  update();
  if (state.status !== 'playing') view.primary.focus();
}

function undo() {
  if (recorded.length === 0 || state.status === 'won') return;
  recorded.pop();
  state = replay(state.level, recorded);   // rebuild the state from the moves that remain
  update();
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  buildMoves();
  update();
  if (moveFocus) view.moves.firstElementChild.focus();
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state));
  save(SAVE_KEY, best);
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const number = Number(key);
  const lastLevel = levelIndex === levels.length - 1;
  if (number >= 1 && number <= state.level.moves.length) press(state.level.moves[number - 1]);
  else if (key === 'u') undo();
  else if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
}

// ------------------------------------------------------------------ drawing

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

// Runs once: creates every element and puts it on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.now = el('div', { class: 'hop-number hop-now', 'aria-live': 'polite' });
  view.goal = el('div', { class: 'hop-number hop-goal' });
  view.left = el('p', { class: 'muted' });
  view.moves = el('div', { class: 'row', role: 'group', 'aria-label': 'Moves' });
  view.undo = el('button', { class: 'btn btn-quiet', type: 'button', onclick: undo }, 'Undo', kbd('U'));
  view.restart = el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) },
    'Restart', kbd('R'));
  view.result = el('section', { class: 'panel result stack', hidden: true });

  main.append(
    el('p', { class: 'how' }, 'Press the buttons to turn the number on the left into the target on the right.'),
    view.picker,
    el('section', { class: 'panel stack' },
      view.title,
      el('div', { class: 'hop-board' },
        el('div', { class: 'hop-box' }, view.now, el('span', { class: 'hop-label' }, 'now')),
        el('span', { class: 'hop-arrow', 'aria-hidden': 'true' }, '→'),
        el('div', { class: 'hop-box' }, view.goal, el('span', { class: 'hop-label' }, 'target'))),
      view.left,
      view.moves,
      el('div', { class: 'row' }, view.undo, view.restart)),
    view.result,
  );
}

// Runs when a level opens: one button per move the level offers.
function buildMoves() {
  const buttons = state.level.moves.map((move, i) => {
    const label = move.replace('*', '×').replace('-', '−');
    return el('button', { class: 'btn hop-move', type: 'button', onclick: () => press(move) }, label, kbd(String(i + 1)));
  });
  view.moves.replaceChildren(...buttons);
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  const playing = state.status === 'playing';
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.now.textContent = String(state.value);
  view.goal.textContent = String(level.target);
  view.left.textContent = `${level.maxMoves - state.used} of ${level.maxMoves} moves left`;
  for (const button of view.moves.children) button.disabled = !playing;
  view.undo.disabled = recorded.length === 0 || state.status === 'won';
  drawPicker();
  drawResult();
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] || 0;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}, ${earned} of 3 stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

function drawResult() {
  const over = state.status !== 'playing';
  view.result.hidden = !over;
  if (!over) return;

  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result stack' : 'panel result lost stack';

  if (won && !lastLevel) {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) },
      'Next level', kbd('N'));
  } else {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex, true) },
      won ? 'Play again' : 'Try again', kbd('R'));
  }

  const earned = stars(state);
  view.result.replaceChildren(
    el('h2', {}, won ? `Solved in ${state.used} ${state.used === 1 ? 'move' : 'moves'}` : 'Out of moves'),
    won ? el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)) : null,
    won && lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, view.primary),
    DEV && won ? el('pre', { class: 'dev' }, 'solution: ' + JSON.stringify(recorded)) : null,
  );
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

build();
openLevel(firstUnsolved(), false);
document.addEventListener('keydown', onKey);
ready();
