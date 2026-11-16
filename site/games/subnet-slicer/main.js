// PAGE for Subnet Slicer: drawing and input only. Every rule lives in logic.js.
//
// Two kinds of level share this page (see the header of levels.js):
//   drill  a question, an answer box (or choice buttons), the last answer explained, a clock
//   carve  an editor for one subnet at a time, Apply, the address map, the list of needs
//
// Every input goes through press(), which calls logic.apply and records the input, so the
// recorded list is exactly what replay() takes. The clock lives here only: it is shown and
// saved as a best time, and never decides a win.
//
// A drill round counts as seen once it has an answer. Playing a seen round again (Restart,
// Same questions) is practice: it is scored and explained, but saves no stars or best time,
// because the answers were on screen last time.
//
// The shape:
//   1. build() makes the frame once; buildDrill() or buildCarve() makes the board for a level.
//   2. Every input ends in update(), which copies the state onto the page.
//   3. ready() is called once the first frame is on screen.
//
// Address options: ?level=3 opens level 3. ?dev shows the recorded inputs on a win, and
// ?dev&level=3&solve plays level 3's solution for you (solve=2: only its first 2 inputs),
// which is a quick way to look at a win screen after editing a level.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import {
  start, apply, replay, stars, current, readable, planProblems, asCidrsubnet,
  parseCidr, cidrText, intToIp, blockSize, usableInAws, networkOf, lastOf, contains,
  AWS_SMALLEST,
} from './logic.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');               // ?dev: show the recorded inputs on a win
const STARS_KEY = 'subnet-slicer:stars';     // { levelId: best stars }
const ROUNDS_KEY = 'subnet-slicer:rounds';   // { levelId: drill rounds seen }: the next round gets new questions
const TIMES_KEY = 'subnet-slicer:times';     // { levelId: fastest winning round, in seconds } (shown only)

const main = mountShell({ title: 'Subnet Slicer' });
const best = load(STARS_KEY, {});
const rounds = load(ROUNDS_KEY, {});
const times = load(TIMES_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every input so far, in order: exactly what replay() takes
let seed = 0;             // the drill round being played (levels.js: seed, seed + 1, ...)
let practice = false;     // drill: this round was seen before, so it saves no stars
let lastAnswer = null;    // drill: { question, given, right }, explained under the question
let selected = null;      // carve: the id of the need being edited
const clock = { started: 0, seconds: 0, timer: null };

// ------------------------------------------------------------------- inputs

function press(input) {
  if (state.status !== 'playing') return;
  state = apply(state, input);
  recorded.push(input);
  if (state.level.kind === 'drill') markSeen();
  if (state.status !== 'playing') finish();
}

// A drill round with an answer is seen: the next round opened gets fresh questions.
function markSeen() {
  const level = state.level;
  const seen = seed - level.seed + 1;
  if ((rounds[level.id] || 0) < seen) {
    rounds[level.id] = seen;
    save(ROUNDS_KEY, rounds);
  }
}

// After the last input of a level: stop the clock, remember stars and best time.
function finish() {
  const level = state.level;
  if (level.kind === 'drill') stopClock();
  if (state.status !== 'won' || practice) return;
  best[level.id] = Math.max(best[level.id] || 0, stars(state));
  save(STARS_KEY, best);
  if (level.kind === 'drill' && (!times[level.id] || clock.seconds < times[level.id])) {
    times[level.id] = clock.seconds;
    save(TIMES_KEY, times);
  }
}

// Redraw, then put the keyboard where the next input goes.
function afterInput() {
  update();
  if (state.status !== 'playing') {
    view.primary.focus({ preventScroll: true });
    view.result.scrollIntoView({ block: 'start' });    // a long result starts at its heading
  } else {
    focusBoard();
  }
}

function focusBoard() {
  if (state.level.kind === 'carve') view.cidr.focus();
  else if (current(state).choices) view.choices.firstElementChild.focus();
  else view.input.focus();
}

// keepSeed: true replays the same drill questions (Restart); otherwise the next unplayed round.
function openLevel(index, moveFocus, keepSeed = false) {
  const level = levels[index];
  levelIndex = index;
  if (!keepSeed || level.kind !== 'drill') seed = level.kind === 'drill' ? level.seed + (rounds[level.id] || 0) : 0;
  practice = level.kind === 'drill' && seed < level.seed + (rounds[level.id] || 0);
  state = level.kind === 'drill' ? start(level, seed) : start(level);
  recorded = [];
  lastAnswer = null;
  selected = level.kind === 'carve' ? level.needs[0].id : null;
  view.board.className = `panel stack ss-board is-${level.kind}`;
  if (level.kind === 'drill') buildDrill(); else buildCarve();
  if (level.kind === 'drill') startClock(); else stopClock();
  update();
  if (moveFocus) focusBoard();
}

function newQuestions() {
  markSeen();                                // skip this round even if nothing was answered yet
  openLevel(levelIndex, true);
}

// ---- drill inputs

function answer(text) {
  const question = current(state);
  if (!question) return;
  press(text.trim());
  lastAnswer = { question, given: text.trim(), right: state.answers.at(-1).right };
  if (view.input) view.input.value = '';
  view.formHint.textContent = '';
  afterInput();
}

function submitTyped(event) {
  event.preventDefault();
  const question = current(state);
  if (!question) return;
  if (!readable(question, view.input.value)) {
    view.formHint.textContent = INPUTS[question.input].hint;   // not an answer yet: nothing is spent
    return;
  }
  answer(view.input.value);
}

// ---- carve inputs

function needOf(id) {
  return state.level.needs.find((need) => need.id === id);
}

function selectNeed(id, moveFocus) {
  selected = id;
  const block = state.blocks[id];
  view.cidr.value = block ? cidrText(block) : '';
  update();
  if (moveFocus) view.cidr.focus();
}

function submitPlace(event) {
  event.preventDefault();
  if (state.status !== 'playing') return;
  const block = parseCidr(view.cidr.value);
  if (!block) {
    view.preview.textContent = 'Write the block as address/prefix, for example 10.0.4.0/22.';
    return;
  }
  press(`${selected} ${cidrText(block)}`);
  // Move on: the next need with no block, else the first one with a problem, else Apply.
  const needs = state.level.needs;
  const from = needs.findIndex((need) => need.id === selected);
  const ordered = [...needs.slice(from + 1), ...needs.slice(0, from + 1)];
  const problems = planProblems(state);
  const next = ordered.find((need) => !state.blocks[need.id])
    || ordered.find((need) => problems.some((p) => p.need === need.id));
  if (next) {
    selectNeed(next.id, true);
  } else {
    update();
    view.apply.focus();
  }
}

// The block the editor shows: what is typed, or a /24 at the start of the VPC to begin from.
function draftBlock() {
  const typed = parseCidr(view.cidr.value);
  if (typed) return typed;
  const prefix = Math.min(AWS_SMALLEST, Math.max(state.vpc.prefix, 24));
  return { ip: state.vpc.ip, prefix };
}

// The buttons (and + - Up Down in the box) change the typed block: size or position.
function nudge(change) {
  if (state.status !== 'playing') return;
  const vpc = state.vpc;
  let { ip, prefix } = draftBlock();
  if (change === 'bigger') prefix = Math.max(vpc.prefix, prefix - 1);
  if (change === 'smaller') prefix = Math.min(AWS_SMALLEST, prefix + 1);
  prefix = Math.max(vpc.prefix, prefix);                         // never bigger than the VPC
  ip = networkOf(ip, prefix);                                    // always land on a boundary
  const size = blockSize(prefix);
  if (change === 'earlier') ip -= size;
  if (change === 'later') ip += size;
  ip = Math.min(Math.max(ip, vpc.ip), lastOf(vpc) + 1 - size);   // stay inside the VPC
  view.cidr.value = cidrText({ ip, prefix });
  update();
}

function cidrKeys(event) {
  const moves = { '+': 'bigger', '=': 'bigger', '-': 'smaller', ArrowUp: 'earlier', ArrowDown: 'later' };
  if (moves[event.key]) {
    event.preventDefault();
    nudge(moves[event.key]);
  }
}

function applyPlan() {
  if (state.status !== 'playing') return;
  press('apply');
  afterInput();
}

// After a refused plan: take back the 'apply' and keep editing.
function fixPlan() {
  if (state.status !== 'lost' || state.level.kind !== 'carve') return;
  recorded.pop();
  state = replay(state.level, recorded);
  const problem = planProblems(state)[0];
  selectNeed(problem ? problem.need : selected, true);
}

// ---- keys

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement) {
    if (event.key === 'Escape') event.target.blur();             // Esc frees the letter keys
    return;
  }
  const key = event.key.toLowerCase();
  const level = state.level;
  const playing = state.status === 'playing';
  const lastLevel = levelIndex === levels.length - 1;
  if (key === 'r') openLevel(levelIndex, true, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
  else if (level.kind === 'drill') {
    const question = current(state);
    if (key === 'q') newQuestions();
    else if (question && question.choices && /^[1-9]$/.test(key) && question.choices[Number(key) - 1]) {
      answer(question.choices[Number(key) - 1]);
    }
  } else if (key === 'a' && playing) applyPlan();
  else if (key === 'u') fixPlan();
  else if (playing && /^[1-9]$/.test(key) && level.needs[Number(key) - 1]) selectNeed(level.needs[Number(key) - 1].id, true);
}

// ------------------------------------------------------------------- clock

function clockText(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function tick() {
  clock.seconds = Math.floor((Date.now() - clock.started) / 1000);
  if (view.clock) view.clock.textContent = clockText(clock.seconds);
}
function startClock() {
  stopClock();
  clock.started = Date.now();
  clock.seconds = 0;
  clock.timer = setInterval(tick, 1000);
}
function stopClock() {
  if (clock.timer) {
    tick();
    clearInterval(clock.timer);
  }
  clock.timer = null;
}

// ------------------------------------------------------------------ drawing

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

// What each kind of typed answer looks like.
const INPUTS = {
  number: { mode: 'numeric', placeholder: 'e.g. 128', hint: 'Type a whole number, such as 128.' },
  prefix: { mode: 'numeric', placeholder: 'e.g. /24 or 24', hint: 'Type a prefix, such as /24 or just 24.' },
  ip: { mode: 'decimal', placeholder: 'e.g. 10.0.4.0', hint: 'Type an address, such as 10.0.4.0.' },
};

// Runs once: the frame every level shares.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.board = el('section', { class: 'panel stack ss-board' });
  view.result = el('section', { class: 'panel result stack', hidden: true, tabIndex: -1 });
  main.append(view.picker, view.board, view.result);
}

function boardHead(...extra) {
  view.title = el('h2');
  return el('div', { class: 'ss-head' }, view.title, ...extra);
}

// Runs when a drill opens.
function buildDrill() {
  view.progress = el('span', { class: 'pill' });
  view.clock = el('span', { class: 'ss-clock', role: 'timer', title: 'Time so far (it never decides a win)' }, '0:00');
  view.score = el('p', { class: 'ss-score' });
  view.question = el('p', { class: 'ss-question', id: 'ss-question' });
  view.input = el('input', {
    class: 'ss-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    'aria-labelledby': 'ss-question',
  });
  view.form = el('form', { class: 'ss-form', onsubmit: submitTyped },
    view.input, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Check', kbd('Enter')));
  view.choices = el('div', { class: 'ss-choices', role: 'group', 'aria-label': 'Choices' });
  view.formHint = el('p', { class: 'ss-hint', 'aria-live': 'polite' });
  view.feedback = el('div', { class: 'ss-feedback', 'aria-live': 'polite' });
  view.board.replaceChildren(
    boardHead(view.progress, view.clock),
    el('p', { class: 'ss-brief' }, levels[levelIndex].brief),
    view.question,
    view.form,
    view.choices,
    view.formHint,
    view.feedback,
    el('div', { class: 'row ss-tools' },
      view.score,
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: newQuestions }, 'New questions', kbd('Q')),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true, true) }, 'Restart', kbd('R'))),
  );
}

// Runs when a carve puzzle opens.
function buildCarve() {
  const level = levels[levelIndex];
  view.editLabel = el('label', { class: 'ss-edit-label', for: 'ss-cidr' });
  view.cidr = el('input', {
    id: 'ss-cidr', class: 'ss-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: '10.0.0.0/24', oninput: update, onkeydown: cidrKeys,
  });
  const step = (change, label, aria) => el('button', {
    class: 'btn ss-step', type: 'button', 'aria-label': aria, onclick: () => { nudge(change); view.cidr.focus(); },
  }, label);
  view.preview = el('p', { class: 'ss-preview', 'aria-live': 'polite' });
  view.apply = el('button', { class: 'btn btn-primary', type: 'button', onclick: applyPlan }, 'Apply plan', kbd('A'));
  view.map = el('div', { class: 'ss-map', role: 'img' });
  view.mapNote = el('p', { class: 'ss-map-note' });
  view.needs = el('ol', { class: 'ss-needs', 'aria-label': 'Subnets to make' });
  view.board.replaceChildren(
    boardHead(el('span', { class: 'pill' }, `VPC ${level.vpc}`)),
    el('p', { class: 'ss-brief' }, level.brief),
    el('div', { class: 'ss-editor stack' },
      view.editLabel,
      el('form', { class: 'ss-form', onsubmit: submitPlace },
        view.cidr, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Place', kbd('Enter'))),
      el('div', { class: 'ss-steps', role: 'group', 'aria-label': 'Change the block' },
        step('smaller', '− size', 'Smaller block (key -)'),
        step('bigger', '+ size', 'Bigger block (key +)'),
        step('earlier', '◀ move', 'Move one block earlier (key Up)'),
        step('later', 'move ▶', 'Move one block later (key Down)')),
      view.preview),
    el('div', { class: 'row ss-tools' },
      view.apply,
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Start over', kbd('R'))),
    el('div', { class: 'stack ss-mapbox' }, view.map, view.mapNote),
    view.needs,
    el('p', { class: 'ss-keys' }, 'Keys: type a block and press Enter. In the box, + and − change the size, ',
      'Up and Down move it. Esc leaves the box; then 1 to 9 pick a subnet and A applies.'),
  );
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  if (level.kind === 'drill') drawDrill(); else drawCarve();
  drawPicker();
  drawResult();
}

function drawDrill() {
  const level = state.level;
  const question = current(state);
  const number = Math.min(state.answers.length + 1, level.questions);
  view.progress.textContent = `${number} / ${level.questions}`;
  view.score.textContent = `${state.correct} right · ${level.pass} to pass${practice ? ' · practice' : ''}`;
  view.question.textContent = question ? question.text : `Round over: ${state.correct} of ${level.questions} right.`;
  view.form.hidden = !question || Boolean(question.choices);
  view.choices.hidden = !question || !question.choices;
  if (question && question.choices) {
    view.choices.replaceChildren(...question.choices.map((choice, i) => el('button', {
      class: 'btn ss-choice', type: 'button', onclick: () => answer(choice),
    }, choice, kbd(String(i + 1)))));
  } else if (question) {
    view.input.inputMode = INPUTS[question.input].mode;
    view.input.placeholder = INPUTS[question.input].placeholder;
  }
  view.feedback.replaceChildren(...feedbackParts(lastAnswer));
}

function feedbackParts(last) {
  if (!last) return [el('p', { class: 'ss-muted' }, 'Each answer is explained here, right or wrong.')];
  const verdict = last.right
    ? el('p', { class: 'ss-good' }, `✓ Right: ${last.question.answer}`)
    : el('p', { class: 'ss-bad' }, `✗ Not quite. You said ${last.given}; the answer is ${last.question.answer}.`);
  return [el('p', { class: 'ss-last' }, `Last question: ${last.question.text}`), verdict, el('p', {}, last.question.explain)];
}

function drawCarve() {
  const level = state.level;
  const need = needOf(selected);
  const number = level.needs.indexOf(need) + 1;
  view.editLabel.textContent = `${number} · ${need.id}: ${need.label}, needs at least ${need.hosts} hosts`;
  const playing = state.status === 'playing';
  view.cidr.disabled = !playing;
  for (const button of view.board.querySelectorAll('.ss-step')) button.disabled = !playing;
  view.apply.disabled = !playing;
  view.preview.replaceChildren(...previewParts(need));
  drawMap();
  drawNeeds();
}

// The live check of the block being typed: its range, its size, and anything AWS would refuse.
function previewParts(need) {
  const text = view.cidr.value.trim();
  if (!text) return [`Type a block such as ${intToIp(state.vpc.ip)}/24, or use the buttons.`];
  const block = parseCidr(text);
  if (!block) return ['Write it as address/prefix, for example 10.0.4.0/22.'];
  const usable = Math.max(0, usableInAws(block.prefix));
  const facts = `${intToIp(block.ip)} to ${intToIp(lastOf(block))} · ${blockSize(block.prefix)} addresses, ${usable} usable in AWS`;
  const trial = planProblems(apply({ ...state, status: 'playing' }, `${need.id} ${cidrText(block)}`))
    .filter((problem) => problem.need === need.id && problem.code !== 'missing');
  const verdict = trial.length
    ? el('span', { class: 'ss-bad' }, `✗ ${trial.map((problem) => problem.text).join('. ')}.`)
    : el('span', { class: 'ss-good' }, '✓ fits. Press Enter to place it.');
  return [el('span', { class: 'ss-facts' }, facts), ' ', verdict];
}

function drawNeeds() {
  const level = state.level;
  const problems = planProblems(state);
  const items = level.needs.map((need, i) => {
    const block = state.blocks[need.id];
    const mine = problems.filter((problem) => problem.need === need.id && problem.code !== 'missing');
    const status = !block ? 'not placed' : mine.length ? `✗ ${mine[0].text}` : '✓ ok';
    return el('li', {},
      el('button', {
        class: `ss-need${mine.length ? ' is-bad' : ''}`, type: 'button',
        'aria-pressed': need.id === selected ? 'true' : 'false',
        onclick: () => selectNeed(need.id, true),
      },
      el('span', { class: 'ss-letter', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'ss-need-name' }, need.id),
      el('span', { class: 'ss-need-block' }, block ? cidrText(block) : '—'),
      el('span', { class: 'ss-need-info' }, `${need.label} · ≥ ${need.hosts} hosts · `,
        el('span', { class: mine.length ? 'ss-bad' : block ? 'ss-good' : 'ss-muted' }, status))));
  });
  view.needs.replaceChildren(...items);
}

// The address map: the VPC as one bar, wrapped into level.mapRows rows. Each placed block is a
// numbered segment; taken blocks are hatched; the block being typed is a dashed outline.
function drawMap() {
  const level = state.level;
  const vpc = state.vpc;
  const rows = level.mapRows || 1;
  const perRow = blockSize(vpc.prefix) / rows;
  const problems = planProblems(state);
  const items = state.taken.map((item) => ({ block: item, cls: 'is-taken', text: item.label }));
  level.needs.forEach((need, i) => {
    const block = state.blocks[need.id];
    if (!block) return;
    const bad = problems.some((p) => p.need === need.id && p.code !== 'missing');
    const cls = `is-need${bad ? ' is-bad' : ''}${need.id === selected ? ' is-selected' : ''}`;
    items.push({ block, cls, text: String(i + 1) + (bad ? '!' : '') });
  });
  const draft = parseCidr(view.cidr.value);
  if (draft && state.status === 'playing') items.push({ block: draft, cls: 'is-draft', text: '' });

  const rowEls = [];
  for (let r = 0; r < rows; r += 1) {
    const from = vpc.ip + r * perRow;
    const to = from + perRow - 1;
    const segments = items.filter((item) => item.block.ip <= to && lastOf(item.block) >= from).map((item) => {
      const left = Math.max(item.block.ip, from);
      const right = Math.min(lastOf(item.block), to);
      return el('div', {
        class: `ss-seg ${item.cls}`, title: `${item.text} ${cidrText(item.block)}`,
        style: { left: `${((left - from) / perRow) * 100}%`, width: `${((right - left + 1) / perRow) * 100}%` },
      }, (right - left + 1) * 16 >= perRow ? el('span', {}, item.text) : null);   // no text in a sliver
    });
    rowEls.push(el('div', { class: 'ss-maprow' },
      el('span', { class: 'ss-maplabel' }, intToIp(from)), el('div', { class: 'ss-track' }, segments)));
  }
  view.map.replaceChildren(...rowEls);

  const placed = level.needs.filter((need) => state.blocks[need.id])
    .map((need) => `${need.id} ${cidrText(state.blocks[need.id])}`);
  view.map.setAttribute('aria-label', `Address map of ${level.vpc}. ${placed.length ? `Placed: ${placed.join(', ')}.` : 'Nothing placed yet.'}`
    + (state.taken.length ? ` Taken: ${state.taken.map((t) => cidrText(t)).join(', ')}.` : ''));
  const outside = items.some((item) => item.cls.includes('is-need') && !contains(vpc, item.block));
  view.mapNote.textContent = `${intToIp(vpc.ip)} to ${intToIp(lastOf(vpc))}. Each row is ${perRow} addresses, `
    + `each tick ${perRow / 16}.${state.taken.length ? ' Hatched: taken.' : ''}${outside ? ' A block outside the VPC is not drawn.' : ''}`;
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] || 0;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}, ${level.kind === 'drill' ? 'drill' : 'puzzle'}, ${earned} of 3 stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

// ------------------------------------------------------------------ results

function drawResult() {
  const over = state.status !== 'playing';
  view.result.hidden = !over;
  if (!over) return view.result.replaceChildren();
  const level = state.level;
  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result stack' : 'panel result lost stack';

  // The buttons: the most likely next step first, as the primary one.
  const button = (label, key, onclick, primary) => el('button', {
    class: primary ? 'btn btn-primary' : 'btn btn-quiet', type: 'button', onclick }, label, kbd(key));
  const next = () => openLevel(levelIndex + 1, true);
  const same = () => openLevel(levelIndex, true, true);
  let row;
  if (level.kind === 'drill') {
    row = won && !lastLevel
      ? [button('Next level', 'N', next, true), button('New questions', 'Q', newQuestions), button('Same questions', 'R', same)]
      : [button('New questions', 'Q', newQuestions, true), button('Same questions', 'R', same)];
  } else if (won) {
    row = lastLevel ? [button('Play again', 'R', same, true)] : [button('Next level', 'N', next, true), button('Play again', 'R', same)];
  } else {
    row = [button('Fix the plan', 'U', fixPlan, true), button('Start over', 'R', same)];
  }
  view.primary = row[0];
  const buttons = el('div', { class: 'row' }, row);

  const parts = level.kind === 'drill' ? drillResult(won) : carveResult(won);
  view.result.replaceChildren(...[
    ...parts,
    won ? lessonParts(level) : [],
    won && lastLevel ? el('p', {}, 'That was the last level. New questions are always one press away.') : null,
    buttons,
    DEV && won ? devLine(level) : null,
  ].flat().filter(Boolean));
}

function drillResult(won) {
  const level = state.level;
  const earned = stars(state);
  const record = times[level.id];
  const review = state.questions.map((question, i) => {
    const given = state.answers[i];
    return el('li', { class: given.right ? 'ss-right' : 'ss-wrong' },
      el('p', {}, el('span', { class: given.right ? 'ss-good' : 'ss-bad' }, given.right ? '✓ ' : '✗ '), question.text),
      el('p', { class: 'ss-muted' }, given.right ? `You: ${given.given}` : `You: ${given.given} · Answer: ${question.answer}`),
      given.right ? null : el('p', {}, question.explain));
  });
  return [
    el('h2', {}, won ? `${state.correct} of ${level.questions} right` : `${state.correct} of ${level.questions} right: ${level.pass} needed`),
    won ? el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)) : null,
    el('p', { class: 'ss-muted' }, `Time ${clockText(clock.seconds)}${record !== undefined ? ` · best ${clockText(record)}` : ''}. `
      + 'Stars count right answers only; the clock is for you.'),
    practice ? el('p', { class: 'ss-muted' }, 'Practice: you had seen these questions before, so no stars or time were saved. '
      + 'New questions count again.') : null,
    el('ol', { class: 'ss-review' }, review),
  ];
}

function carveResult(won) {
  const level = state.level;
  if (!won) {
    return [
      el('h2', {}, 'This plan does not work'),
      el('ul', { class: 'ss-problems' }, state.problems.map((p) => el('li', {}, `${p.need}: ${p.text}`))),
      el('p', { class: 'ss-muted' }, 'Fix the plan to keep your blocks and try again.'),
    ];
  }
  const width = Math.max(...level.needs.map((need) => need.id.length));
  const lines = level.needs.map((need) => {
    const cidr = cidrText(state.blocks[need.id]);
    return `${need.id.padEnd(width)}  ${asCidrsubnet(level.vpc, cidr)}  # ${cidr}`;
  });
  return [
    el('h2', {}, 'Plan applied: every subnet fits'),
    el('p', { class: 'stars', role: 'img', 'aria-label': '3 of 3 stars' }, starText(stars(state))),
    el('p', { class: 'ss-snippet-label' }, 'Your plan, written as Terraform cidrsubnet() calls'),
    el('pre', { class: 'ss-code' }, el('code', {}, lines.join('\n'))),
  ];
}

function lessonParts(level) {
  return [
    el('p', { class: 'ss-lesson' }, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'In real life'),
    ...level.inRealLife.map((snippet) => el('div', { class: 'ss-snippet' },
      el('p', { class: 'ss-snippet-label' }, snippet.label),
      el('pre', { class: 'ss-code' }, el('code', {}, snippet.code)))),
    el('h3', {}, 'Official docs'),
    el('ul', { class: 'ss-docs' }, level.docs.map((url) => el('li', {},
      el('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace('https://', ''))))),
  ];
}

function devLine(level) {
  const list = `solution: [${recorded.map((input) => `'${input}'`).join(', ')}],`;
  const note = level.kind === 'drill' && seed !== level.seed
    ? `\n(these answer round seed ${seed}; a level's solution must answer seed ${level.seed}: clear saved progress or set seed: ${seed})`
    : '';
  return el('pre', { class: 'dev' }, list + note);
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

// ?dev&solve: play the opened level's own solution (or its first N inputs) through the real inputs.
function playSolution(count) {
  const level = state.level;
  seed = level.seed;                                  // the solution answers the level's own seed
  openLevel(levelIndex, false, true);
  for (const input of level.solution.slice(0, count)) {
    if (level.kind === 'drill') answer(input);
    else if (input === 'apply') applyPlan();
    else {
      press(input);
      selectNeed(input.split(' ')[0], false);
    }
  }
}

const asked = Number(params.get('level'));
build();
openLevel(asked >= 1 && asked <= levels.length ? asked - 1 : firstUnsolved(), false);
if (DEV && params.has('solve')) playSolution(Number(params.get('solve')) || Infinity);
document.addEventListener('keydown', onKey);
ready();
