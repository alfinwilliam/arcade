// PAGE for Allow or Deny: drawing and input only. Every rule lives in logic.js, which also
// writes the step-by-step explanation shown after each answer.
//
// The shape:
//   1. build() makes the frame once: the level picker, the board and the result panel.
//   2. Every answer goes through press(), which calls logic.apply and records the input,
//      so the recorded list is exactly what replay() takes.
//   3. update() copies the state onto the page after every input.
//   4. ready() is called once the first frame is on screen.
//
// The board. On a phone, top to bottom: the request card, the explanation (after an answer),
// the policies as JSON, and the answer bar, which sticks to the bottom of the screen so it
// stays reachable while you read. On a wide screen the left column is the request card, the
// answer bar right under it (so Next appears where Allow and Deny were) and the explanation;
// the policies sit in a column on the right.
//
// What is page-only (never part of the rules): whether the Deny question "explicit or
// implicit?" is open, whether the explanation of the last answer is on screen, and
// whether the result is showing.
//
// Address options: ?level=3 opens level 3. ?dev shows the recorded answers on the result
// screen as a `solution:` line to paste into levels.js. ?dev&level=3&solve=2 answers the
// first 2 cases of level 3 from its solution and leaves the explanation of case 2 on screen;
// ?dev&level=3&solve answers them all and shows the result. Handy after editing a level.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import {
  start, apply, stars, evaluate, contextShown, principalOf, resourceAccountOf, statementsOf, TYPE_LABEL,
} from './logic.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');                  // ?dev: show the recorded answers on the result screen
const SAVE_KEY = 'allow-or-deny:stars';         // saved as { levelId: bestStars }
const narrow = window.matchMedia('(max-width: 899px)');

const main = mountShell({ title: 'Allow or Deny' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every answer so far, in order: exactly what replay() takes
let askKind = false;      // Deny was pressed: waiting for "explicit or implicit?"
let reviewing = false;    // the explanation of the case just answered is on screen
let showResult = false;   // the level is over and its result panel is on screen

const ANSWER_TEXT = { allow: 'Allow', explicit: 'Deny (explicit)', implicit: 'Deny (implicit)' };
const MARK = {            // how each step of the explanation is marked: a symbol AND a word
  ok: ['✓', 'passes'],
  note: ['•', 'passes'],
  allow: ['✓', 'Allow'],
  deny: ['⛔', 'explicit deny'],
  no: ['✗', 'implicit deny'],
};

// ------------------------------------------------------------------- inputs

function press(input) {
  if (state.status !== 'playing' || reviewing) return;
  state = apply(state, input);
  recorded.push(input);
  askKind = false;
  reviewing = true;
  if (state.status === 'won') rememberWin();
  update();
  // A phone shows the explanation from its top; the Next button is in the sticky bar.
  // A wide screen scrolls only if Next is out of sight.
  if (narrow.matches) view.verdict.scrollIntoView({ block: 'start' });
  view.next.focus({ preventScroll: narrow.matches });
}

function chooseDeny() {
  if (state.status !== 'playing' || reviewing) return;
  askKind = true;
  update();
  view.explicit.focus({ preventScroll: true });
}

function cancelDeny() {
  askKind = false;
  update();
  view.deny.focus({ preventScroll: true });
}

// After an explanation: the next case, or the result once the level is over.
function next() {
  if (!reviewing) return;
  if (state.status === 'playing') {
    reviewing = false;
    update();
    if (narrow.matches) view.board.scrollIntoView({ block: 'start' });
    view.allow.focus({ preventScroll: narrow.matches });
  } else {
    showResult = true;
    update();
    view.result.scrollIntoView({ block: 'start' });   // a long result starts at its heading
    view.primary.focus({ preventScroll: true });
  }
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  askKind = false;
  reviewing = false;
  showResult = false;
  update();
  if (moveFocus) {
    view.board.scrollIntoView({ block: 'start' });
    view.allow.focus({ preventScroll: true });
  }
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state));
  save(SAVE_KEY, best);
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const lastLevel = levelIndex === levels.length - 1;
  if (showResult) {
    if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
    else if (key === 'r') openLevel(levelIndex, true);
  } else if (reviewing) {
    if (key === 'n') next();
  } else if (key === 'a') press('allow');
  else if (key === 'd') chooseDeny();
  else if (key === 'e') press('explicit');
  else if (key === 'i') press('implicit');
  else if (key === 'escape' && askKind) cancelDeny();
}

// ------------------------------------------------------------------ drawing

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

// Compact JSON: short arrays and short objects stay on one line (counting their indent),
// the rest are spread over indented lines.
function format(value, depth) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(value)) {
    const inline = `[${value.map((v) => format(v, 0)).join(', ')}]`;
    if (pad.length + inline.length <= 52 && !inline.includes('\n')) return inline;
    return `[\n${value.map((v) => `${pad}  ${format(v, depth + 1)}`).join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const pairs = Object.entries(value).map(([k, v]) => [JSON.stringify(k), v]);
    const inline = `{ ${pairs.map(([k, v]) => `${k}: ${format(v, 0)}`).join(', ')} }`;
    if (depth > 0 && pad.length + inline.length <= 58 && !inline.includes('\n')) return inline;
    return `{\n${pairs.map(([k, v]) => `${pad}  ${k}: ${format(v, depth + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

// JSON text as one block per line. A long line that wraps on a phone continues indented
// under itself (the --i custom property is the line's own indent, in characters), and an ARN
// in it wraps after a ':' or '/' (a <wbr>) rather than in the middle of a name.
function lines(text) {
  return text.split('\n').map((line) => el('span', {
    class: 'aod-line', style: { '--i': String(line.length - line.trimStart().length) } },
  line.split(/(?<=[:/])(?=[^\s:/])/).flatMap((part, i) => (i === 0 ? [part] : [el('wbr'), part]))));
}

// Runs once: creates every element and puts it on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.count = el('span', { class: 'pill' });
  view.score = el('span', { class: 'aod-score' });
  view.brief = el('p', { class: 'aod-brief' });
  view.request = el('section', { class: 'aod-request', 'aria-label': 'The request' });
  view.verdict = el('section', { class: 'aod-verdict', 'aria-live': 'polite', hidden: true });
  view.bar = el('div', { class: 'aod-bar' });
  view.policies = el('section', { class: 'aod-policies', 'aria-label': 'Policies in play' });

  view.allow = el('button', { class: 'btn aod-answer aod-allow', type: 'button', onclick: () => press('allow') }, 'Allow', kbd('A'));
  view.deny = el('button', { class: 'btn aod-answer aod-deny', type: 'button', onclick: chooseDeny }, 'Deny', kbd('D'));
  view.explicit = el('button', { class: 'btn aod-answer aod-deny', type: 'button', onclick: () => press('explicit') },
    el('span', { class: 'aod-two' }, 'Explicit', el('small', {}, 'a Deny statement matched')), kbd('E'));
  view.implicit = el('button', { class: 'btn aod-answer aod-deny', type: 'button', onclick: () => press('implicit') },
    el('span', { class: 'aod-two' }, 'Implicit', el('small', {}, 'nothing allowed it')), kbd('I'));
  view.back = el('button', { class: 'btn btn-quiet aod-back', type: 'button', onclick: cancelDeny }, 'Back', kbd('Esc'));
  view.next = el('button', { class: 'btn btn-primary aod-answer', type: 'button', onclick: next });
  view.result = el('section', { class: 'panel result stack aod-result', hidden: true });

  view.board = el('section', { class: 'panel aod-board' },
    el('div', { class: 'aod-head' }, view.title, view.count, view.score),
    view.brief,
    el('div', { class: 'aod-left' }, view.request, view.bar, view.verdict),
    view.policies);

  main.append(
    el('p', { class: 'how' },
      'Each case is one request to AWS and the policies in play. Will AWS allow it? '
      + 'For a Deny, say which kind: a Deny statement matched (explicit), or none did but a policy that had to allow it did not (implicit).'),
    view.picker,
    view.board,
    view.result,
  );
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  const shown = reviewing ? state.index - 1 : state.index;
  const kase = level.cases[shown];
  const given = reviewing ? state.given[shown] : null;
  const result = given ? evaluate(kase) : null;
  const wrong = state.given.length - state.right;

  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.count.textContent = `Case ${shown + 1} of ${level.cases.length}`;
  view.score.textContent = `✓ ${state.right} right · ✗ ${wrong} wrong · ${level.pass} to pass`;
  view.brief.textContent = level.brief;
  drawPicker();
  drawRequest(kase);
  drawVerdict(given, result);
  drawPolicies(kase, result);
  drawBar();
  drawResult();
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] || 0;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}: ${level.title}, ${earned} of 3 stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

// An ARN as code that wraps after ':' or '/' rather than in the middle of a name.
function arn(text, className) {
  const parts = text.split(/(?<=[:/])/);
  return el('code', { class: className || null }, parts.flatMap((part, i) => (i === 0 ? [part] : [el('wbr'), part])));
}

function row(label, ...value) {
  return [el('dt', {}, label), el('dd', {}, ...value)];
}

function drawRequest(kase) {
  const who = principalOf(kase);
  const owner = resourceAccountOf(kase);
  const caller = who.kind === 'role'
    ? [arn(who.arn), el('span', { class: 'aod-sub' }, ` as session ${who.sessionArn.split('/').pop()}`)]
    : [arn(who.arn), el('span', { class: 'aod-sub' }, ' (IAM user)')];
  const accounts = owner === who.account
    ? [el('code', {}, owner), el('span', { class: 'aod-sub' }, ' (caller and resource)')]
    : [el('code', {}, who.account), ' → ', el('code', {}, owner), el('span', { class: 'aod-sub aod-cross' }, ' cross-account')];
  const context = contextShown(kase).map(([key, value]) => el('li', {},
    el('code', {}, key),
    value === null ? el('span', { class: 'aod-missing' }, ' not in the request') : [' = ', el('code', {}, value)]));
  view.request.replaceChildren(...[
    el('dl', { class: 'aod-dl' },
      row('Caller', ...caller),
      row('Action', el('code', { class: 'aod-strong' }, kase.action)),
      row('Resource', arn(kase.resource, 'aod-strong')),
      row('Account', ...accounts),
      context.length > 0 ? row('Context', el('ul', { class: 'aod-context' }, context)) : []),
    kase.note ? el('p', { class: 'aod-note' }, kase.note) : null,
  ].filter(Boolean));
}

function drawVerdict(given, result) {
  view.verdict.hidden = !given;
  if (!given) return view.verdict.replaceChildren();
  const heading = given.right
    ? `✓ Right: ${ANSWER_TEXT[given.verdict]}`
    : `✗ Not quite: you said ${ANSWER_TEXT[given.input]}, AWS says ${ANSWER_TEXT[given.verdict]}`;
  const steps = result.steps.map((step) => {
    const [symbol, word] = MARK[step.mark];
    return el('li', { class: `aod-step is-${step.mark}` },
      el('p', {}, el('span', { class: 'aod-mark' }, `${symbol} ${word}`), ' ', el('strong', {}, step.title)),
      el('p', {}, step.text),
      step.notes.length > 0 ? el('ul', { class: 'aod-notes' }, step.notes.map((note) => el('li', {}, note))) : null);
  });
  view.verdict.className = given.right ? 'aod-verdict is-right' : 'aod-verdict is-wrong';
  view.verdict.replaceChildren(
    el('h3', {}, heading),
    el('p', { class: 'aod-sub' }, 'How AWS decides, in order. The statements it rests on are marked in the policies.'),
    el('ol', { class: 'aod-steps' }, steps));
}

// Which statements and policies the explanation points at: { statements: Map, policies: Map }.
function marksOf(result) {
  const statements = new Map();     // 'p:s' -> { kind, label }
  const policies = new Map();       // p -> label (a policy that decided by allowing nothing)
  if (!result) return { statements, policies };
  for (const step of result.steps) {
    const decided = step === result.decided;
    for (const [p, s] of step.refs) {
      const kind = step.mark === 'deny' ? 'deny' : 'allow';
      const label = kind === 'deny' ? '⛔ explicit deny: this decided it' : `✓ allows${decided ? ': this decided it' : ''}`;
      statements.set(`${p}:${s}`, { kind, label });
    }
    for (const [p, s] of step.skipped) statements.set(`${p}:${s}`, { kind: 'skip', label: '• a Deny that does not apply here (see why above)' });
    if (decided && step.mark === 'no') step.policies.forEach((p) => policies.set(p, '✗ nothing here allows it'));
  }
  return { statements, policies };
}

function drawPolicies(kase, result) {
  const marks = marksOf(result);
  const involved = new Set([...marks.policies.keys(), ...[...marks.statements.keys()].map((key) => Number(key.split(':')[0]))]);
  const blocks = kase.policies.map((policy, p) => {
    const statements = statementsOf(policy.doc);
    const code = [...lines(`{\n  "Version": ${JSON.stringify(policy.doc.Version)},\n  "Statement": [`)];
    statements.forEach((statement, s) => {
      const mark = marks.statements.get(`${p}:${s}`);
      const text = `    ${format(statement, 2)}${s < statements.length - 1 ? ',' : ''}`;
      code.push(el('span', { class: mark ? `aod-stmt is-${mark.kind}` : 'aod-stmt' },
        mark ? el('span', { class: 'aod-tag' }, mark.label) : null, lines(text)));
    });
    code.push(...lines('  ]\n}'));
    const policyMark = marks.policies.get(p);
    // Before an answer every policy is open. After one, a phone keeps open only the policies that decided.
    const open = !result || !narrow.matches || involved.has(p) || involved.size === 0;
    return el('details', { class: policyMark ? 'aod-policy is-empty' : 'aod-policy', open },
      el('summary', {},
        el('span', { class: `pill aod-type is-${policy.type}` }, TYPE_LABEL[policy.type]),
        el('span', { class: 'aod-pname' }, policy.name),
        policy.attachedTo ? el('span', { class: 'aod-sub' }, `attached at ${policy.attachedTo}`) : null,
        policyMark ? el('span', { class: 'aod-ptag' }, policyMark) : null),
      el('pre', { class: 'aod-json' }, el('code', {}, ...code)));
  });
  view.policies.replaceChildren(
    el('h3', { class: 'aod-ph' }, `Policies in play: ${kase.policies.length}`),
    ...(blocks.length > 0 ? blocks : [el('p', { class: 'aod-none' }, 'No policies at all: nothing is attached to this caller or this resource.')]));
}

function drawBar() {
  const playing = state.status === 'playing' && !reviewing;
  if (playing && askKind) {
    view.bar.replaceChildren(
      el('p', { class: 'aod-ask' }, 'Deny. Explicit or implicit?'),
      el('div', { class: 'aod-buttons' }, view.explicit, view.implicit),
      view.back);
  } else if (playing) {
    view.bar.replaceChildren(el('div', { class: 'aod-buttons' }, view.allow, view.deny));
  } else {
    const over = state.status !== 'playing';
    view.next.replaceChildren(over ? 'See the result' : 'Next case', kbd('N'));
    view.next.disabled = showResult;
    view.bar.replaceChildren(el('div', { class: 'aod-buttons' }, view.next));
  }
}

function drawResult() {
  view.result.hidden = !showResult;
  if (!showResult) return view.result.replaceChildren();
  const level = state.level;
  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result stack aod-result' : 'panel result lost stack aod-result';

  const button = (label, key, onclick, primary) => el('button', {
    class: primary ? 'btn btn-primary' : 'btn btn-quiet', type: 'button', onclick }, label, kbd(key));
  const again = () => openLevel(levelIndex, true);
  const buttons = won && !lastLevel
    ? [button('Next level', 'N', () => openLevel(levelIndex + 1, true), true), button('Play again', 'R', again)]
    : [button(won ? 'Play again' : 'Try again', 'R', again, true)];
  view.primary = buttons[0];

  const earned = stars(state);
  const review = state.given.map((given, i) => {
    const kase = level.cases[i];
    return el('li', {},
      el('span', { class: given.right ? 'aod-good' : 'aod-bad' }, given.right ? '✓ ' : '✗ '),
      el('code', {}, kase.action), ' ',
      el('span', { class: 'aod-sub' }, given.right ? ANSWER_TEXT[given.verdict] : `you: ${ANSWER_TEXT[given.input]} · AWS: ${ANSWER_TEXT[given.verdict]}`));
  });
  view.result.replaceChildren(...[
    el('h2', {}, won ? `${state.right} of ${level.cases.length} right: level passed` : `${state.right} of ${level.cases.length} right: ${level.pass} needed`),
    won ? el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)) : null,
    el('ol', { class: 'aod-review' }, review),
    el('p', { class: 'aod-lesson' }, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'In real life'),
    ...level.inRealLife.map((snippet) => el('div', { class: 'aod-snippet' },
      el('p', { class: 'aod-snippet-label' }, snippet.label),
      el('pre', { class: 'aod-code' }, el('code', {}, snippet.code)))),
    el('h3', {}, 'Official docs'),
    el('ul', { class: 'aod-docs' }, level.docs.map((url) => el('li', {},
      el('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace('https://', ''))))),
    won && lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, buttons),
    DEV ? el('pre', { class: 'dev' }, `solution: [${recorded.map((a) => `'${a}'`).join(', ')}],`) : null,
  ].filter(Boolean));
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

// ?dev&solve: play the opened level's own solution (or its first N answers) through press().
function playSolution(count) {
  const answers = state.level.solution.slice(0, count);
  answers.forEach((answer, i) => {
    if (i > 0) next();
    press(answer);
  });
  if (count >= state.level.cases.length) next();
}

const asked = Number(params.get('level'));
build();
openLevel(asked >= 1 && asked <= levels.length ? asked - 1 : firstUnsolved(), false);
if (DEV && params.has('solve')) playSolution(Number(params.get('solve')) || Infinity);
document.addEventListener('keydown', onKey);
ready();
