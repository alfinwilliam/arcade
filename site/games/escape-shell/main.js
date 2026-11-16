// PAGE for Escape Shell: the terminal, the brief, hints and the debrief. Drawing and input only.
// Every rule lives in logic.js. This file never decides what a command prints or who wins.
//
// The shape, as in the template:
//   1. mountShell() gives the top bar and the <main> to build in.
//   2. build() makes the page once; openLevel() sets up a scenario; update() refreshes after every input.
//   3. Every typed line goes through run(), which calls logic.apply and records the line.
//   4. ready() once the first frame is on screen.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import { start, apply, prompt, complete, stars } from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded lines on a win
const SAVE_KEY = 'escape-shell:stars';                          // saved as { scenarioId: bestStars }
const NARROW = matchMedia('(max-width: 640px)').matches;        // phones: chips open, long lines wrap
const FINE_POINTER = matchMedia('(pointer: fine)').matches;     // a mouse: clicking the screen focuses the prompt
const MAX_BLOCKS = 300;                                         // older output scrolls away, as in a real terminal

const main = mountShell({ title: 'Escape Shell' });
const best = load(SAVE_KEY, {});
const view = {};        // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;       // the current host, always produced by logic.js
let recorded = [];      // every line run so far, in order: exactly what replay() takes
let hintsUsed = 0;      // hints read in this scenario; each one costs a star
const history = [];     // lines for Up and Down, oldest first, kept across scenarios like ~/.bash_history
let historyAt = 0;      // where Up/Down is in history; history.length means "the line being typed"
let draft = '';         // the half-typed line, kept while you look through history

// ------------------------------------------------------------------- inputs

// The one input. replay() in logic.js does exactly this for every recorded line.
function run(line) {
  if (state.status !== 'playing') return;
  const before = prompt(state);
  state = apply(state, line);
  if (line.trim() !== '') {
    recorded.push(line);
    remember(line);
  }
  if (state.clear) view.screen.replaceChildren();
  else addBlock(echo(before, line), ...state.output.map((entry) => outLine(entry.text, entry.kind === 'err' ? 'es-err' : '')));
  if (state.status === 'won') rememberWin();
  update();
  if (state.status === 'won') view.primary.focus();
}

function submit(event) {
  event.preventDefault();
  const line = view.input.value;
  setInput('');
  run(line);
}

function remember(line) {
  if (history[history.length - 1] !== line) history.push(line);
  historyAt = history.length;
  draft = '';
}

// Up (-1) and Down (+1) through the lines run before.
function recall(step) {
  if (history.length === 0) return;
  if (historyAt === history.length) draft = view.input.value;
  historyAt = Math.min(history.length, Math.max(0, historyAt + step));
  setInput(historyAt === history.length ? draft : history[historyAt]);
}

// Tab: fill in as much as is certain; when there is a choice, list the choices like bash does.
function tabComplete() {
  if (state.status !== 'playing') return;
  const typed = view.input.value;
  const result = complete(state, typed);
  setInput(result.line);
  if (result.options.length > 1 && result.line === typed) {
    addBlock(echo(prompt(state), typed), outLine(result.options.join('  '), 'es-note'));
  }
}

// Ctrl+C on an empty selection drops the half-typed line, as in a real shell.
function cancelLine() {
  addBlock(echo(prompt(state), view.input.value + '^C'));
  setInput('');
  historyAt = history.length;
}

function setInput(text) {
  view.input.value = text;
  view.input.setSelectionRange(text.length, text.length);
}

function fillChip(text) {
  setInput(text);
  view.input.focus();
}

function showHint() {
  if (state.status !== 'playing' || hintsUsed >= state.level.hints.length) return;
  hintsUsed += 1;
  update();
  if (view.hint.disabled) view.input.focus();
}

function onInputKey(event) {
  const plain = !event.altKey && !event.metaKey;
  if (event.key === 'ArrowUp' && plain) {
    event.preventDefault();
    recall(-1);
  } else if (event.key === 'ArrowDown' && plain) {
    event.preventDefault();
    recall(1);
  } else if (event.key === 'Tab' && !event.shiftKey && plain && !event.ctrlKey && view.input.value.trim() !== '') {
    // Tab completes while there is something to complete. On an empty prompt it moves focus
    // on, so keyboard users can still leave the terminal.
    event.preventDefault();
    tabComplete();
  } else if (event.key.toLowerCase() === 'c' && event.ctrlKey && view.input.selectionStart === view.input.selectionEnd) {
    event.preventDefault();
    cancelLine();
  }
}

// openLevel(i) starts scenario i. Running it again on the same scenario is "reset the host":
// the hints already read stay read.
function openLevel(index, moveFocus) {
  if (index !== levelIndex || state === null) hintsUsed = 0;
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  buildLevel();
  update();
  if (moveFocus) view.input.focus();
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state, hintsUsed));
  save(SAVE_KEY, best);
}

// ------------------------------------------------------------------ drawing

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

// Text from levels.js: anything between `backticks` is shown as code.
function rich(text) {
  return text.split('`').map((part, i) => (i % 2 === 1 ? el('code', {}, part) : part)).filter((part) => part !== '');
}

function echo(promptText, line) {
  return el('div', { class: 'es-line' }, el('span', { class: 'es-ps' }, promptText), line);
}

function outLine(text, kind) {
  return el('div', { class: kind ? `es-line ${kind}` : 'es-line' }, text);
}

// One command and what it printed. The screen is a live region, so each new block is read out.
function addBlock(...lines) {
  view.screen.append(el('div', { class: 'es-block' }, ...lines));
  while (view.screen.childElementCount > MAX_BLOCKS) view.screen.firstElementChild.remove();
  view.screen.scrollTop = view.screen.scrollHeight;
}

// Runs once: creates every element and puts it on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Scenarios' });
  view.title = el('h2');
  view.brief = el('p');
  view.hints = el('ol', { class: 'es-hints', 'aria-label': 'Hints', 'aria-live': 'polite' });
  view.hint = el('button', { class: 'btn', type: 'button', onclick: showHint });
  view.worth = el('p', { class: 'es-worth muted' });

  view.screen = el('div', {
    class: NARROW ? 'es-screen wrap' : 'es-screen',
    role: 'log', 'aria-live': 'polite', 'aria-label': 'Terminal output', tabindex: '0',
  });
  view.screen.addEventListener('click', () => {
    if (FINE_POINTER && String(getSelection()) === '' && !view.input.disabled) view.input.focus({ preventScroll: true });
  });
  view.ps = el('span', { class: 'es-ps', 'aria-hidden': 'true' });
  view.input = el('input', {
    class: 'es-input', type: 'text', id: 'es-input', name: 'command',
    autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'send',
    onkeydown: onInputKey,
  });
  view.wrap = el('button', {
    class: 'btn btn-quiet', type: 'button', 'aria-pressed': String(NARROW),
    onclick: () => {
      const on = view.screen.classList.toggle('wrap');
      view.wrap.setAttribute('aria-pressed', String(on));
    },
  }, 'Wrap lines');
  view.reset = el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Reset host');

  view.chipList = el('ul', { class: 'es-chip-list', 'aria-label': 'Commands for this scenario' });
  view.chips = el('details', { class: 'panel es-chips', open: NARROW },
    el('summary', {}, 'Command chips'),
    el('div', { class: 'es-chips-body' },
      el('p', { class: 'muted' }, 'A chip puts a command at the prompt without running it. Finish it if it ends in …, then press Run.'),
      view.chipList,
      el('div', { class: 'row es-keys' },
        el('button', { class: 'btn', type: 'button', onclick: () => { tabComplete(); view.input.focus(); } }, 'Tab', el('span', { class: 'sr-only' }, ' complete')),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Previous command', onclick: () => { recall(-1); view.input.focus(); } }, '↑'),
        el('button', { class: 'btn', type: 'button', 'aria-label': 'Next command', onclick: () => { recall(1); view.input.focus(); } }, '↓'),
        el('button', { class: 'btn btn-primary', type: 'submit', form: 'es-form' }, 'Run ⏎'))));

  view.result = el('section', { class: 'panel result stack', hidden: true, 'aria-live': 'polite' });

  main.append(
    el('p', { class: 'how' }, 'Read the ticket, find out why the service is down, and fix it by typing commands. ',
      'Up and Down recall commands, Tab completes names. Each hint costs a star.'),
    view.picker,
    el('section', { class: 'panel stack es-brief' },
      el('div', { class: 'es-ticket' }, el('span', { class: 'pill' }, 'Ticket'), view.title),
      view.brief,
      view.hints,
      el('div', { class: 'row' }, view.hint, view.worth)),
    el('section', { class: 'es-term', 'aria-label': 'Terminal' },
      el('div', { class: 'es-term-bar' }, el('span', { class: 'es-term-title' }, 'ssh ops@sample-host'), view.wrap, view.reset),
      view.screen,
      el('form', { class: 'es-input-row', id: 'es-form', onsubmit: submit },
        el('label', { for: 'es-input', class: 'sr-only' }, 'Command'), view.ps, view.input)),
    view.chips,
    view.result,
  );
}

// Runs when a scenario opens: the ticket, the chips and a fresh screen.
function buildLevel() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.brief.replaceChildren(...rich(level.brief));
  view.chipList.replaceChildren(...level.chips.map((chip) => {
    const open = chip.endsWith(' ');
    return el('li', {},
      el('button', {
        class: 'btn es-chip', type: 'button', onclick: () => fillChip(chip),
        'aria-label': open ? `Put "${chip.trim()}" at the prompt, to finish` : `Put "${chip}" at the prompt`,
      }, open ? `${chip.trim()} …` : chip));
  }));
  view.screen.replaceChildren();
  addBlock(
    outLine(`# You are logged in to sample-host as ops. Scenario ${levelIndex + 1}: ${level.title}.`, 'es-note'),
    outLine('# help lists the commands. Changing the system needs sudo in front.', 'es-note'));
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  const playing = state.status === 'playing';
  const left = level.hints.length - hintsUsed;
  view.hints.replaceChildren(...level.hints.slice(0, hintsUsed).map((hint) => el('li', {}, ...rich(hint))));
  view.hint.disabled = !playing || left === 0;
  view.hint.textContent = left === 0 ? 'No hints left' : `Hint ${hintsUsed + 1} of ${level.hints.length}`;
  const worth = stars({ status: 'won' }, hintsUsed);
  view.worth.textContent = playing ? `A fix now earns ${starText(worth)} (${worth} of 3)` : '';
  view.ps.textContent = prompt(state).trimEnd();
  view.input.disabled = !playing;
  view.chips.hidden = !playing;
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
        'aria-label': `Scenario ${i + 1}, ${level.title}, ${earned} of 3 stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

function drawResult() {
  const won = state.status === 'won';
  view.result.hidden = !won;
  if (!won) return;

  const level = state.level;
  const lastLevel = levelIndex === levels.length - 1;
  view.primary = lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(0, true) }, 'Back to scenario 1')
    : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next scenario');
  const earned = stars(state, hintsUsed);
  const commands = recorded.length;

  const parts = [
    el('h2', {}, `Fixed in ${commands} ${commands === 1 ? 'command' : 'commands'}`),
    el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    hintsUsed > 0 ? el('p', { class: 'muted' }, `${hintsUsed} ${hintsUsed === 1 ? 'hint' : 'hints'} read.`) : null,
    el('dl', { class: 'debrief' },
      el('dt', {}, 'What broke'), el('dd', {}, ...rich(level.debrief.cause)),
      el('dt', {}, 'The evidence'), el('dd', {}, ...rich(level.debrief.evidence)),
      el('dt', {}, 'The habit'), el('dd', {}, ...rich(level.debrief.habit))),
    lastLevel ? el('p', {}, 'That was the last scenario.') : null,
    el('div', { class: 'row' }, view.primary,
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Play it again')),
    DEV ? el('pre', { class: 'dev' }, 'solution: ' + JSON.stringify(recorded)) : null,
  ];
  // replaceChildren() would show a null as the text "null", so drop the parts not in use.
  view.result.replaceChildren(...parts.filter(Boolean));
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

build();
openLevel(firstUnsolved(), false);
if (FINE_POINTER) view.input.focus({ preventScroll: true });
ready();
