// PAGE for Ship It: drawing and input only.
// Every rule lives in logic.js. This file never decides who wins.
//
//   1. mountShell() gives the top bar and the <main> to build in.
//   2. build() makes the page once; update() copies the state onto it after every input.
//   3. Every input goes through press(), which calls logic.apply and records the move.
//      Selecting a step is not a move: it only decides what the next tap does.
//   4. ready() is called once the first frame is on screen.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import { OPTIONS, start, apply, replay, stars, whyNot, has, pushesOf } from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded moves on a win
const SAVE_KEY = 'ship-it:stars';                               // saved as { levelId: bestStars }

// How each option is named on its button, on a step's badge, and its keyboard key.
const OPTION_TEXT = {
  publish: { name: 'Publish artifact', badge: 'artifact', key: 'P' },
  cache: { name: 'Cache deps', badge: 'cache', key: 'C' },
  main: { name: 'Only on main', badge: 'main only', key: 'M' },
  approve: { name: 'Needs approval', badge: 'approval', key: 'A' },
  lock: { name: 'Lock', badge: 'lock', key: 'L' },
  tag: { name: 'Tag by commit', badge: 'tag: commit', key: 'T' },
};

// What each kind of commit is called in the checks. Any other word is shown as it is.
const COMMIT_TEXT = {
  good: 'a good commit',
  'lint-error': 'a lint error',
  'test-fail': 'a failing unit test',
  'type-error': 'a type error',
  'build-error': 'code that does not compile',
  'ui-bug': 'a bug in the checkout page',
  'new-dep': 'a new dependency (the lockfile changes)',
};

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

const main = mountShell({ title: 'Ship It' });
const best = load(SAVE_KEY, {});
const view = {};        // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;       // the current game state, always produced by logic.js
let recorded = [];      // every move so far, in order: exactly what replay() takes
let selected = null;    // the id of the selected step, or null

// ------------------------------------------------------------------- inputs

function press(move) {
  if (state.status !== 'playing') return;
  state = apply(state, move);
  recorded.push(move);
  if (state.status === 'won') rememberWin();
}

function selectStep(id) {
  if (state.status !== 'playing') return;
  selected = selected === id ? null : id;
  update();
  focusStep(id);
}

function moveTo(n) {
  if (!selected) return;
  const id = selected;
  press(`move ${id} ${n}`);
  selected = null;
  update();
  focusStep(id);
}

function newStage(n) {
  if (!selected) return;
  const id = selected;
  press(`new ${id} ${n}`);
  selected = null;
  update();
  focusStep(id);
}

function toggle(option) {
  if (!selected || whyNot(state.level, selected, option)) return;
  press(`${option} ${selected}`);
  update();
  const button = view.pipe.querySelector(`[data-option="${option}"]`);
  if (button) button.focus();
}

function run() {
  if (state.status !== 'playing') return;
  selected = null;
  press('run');
  update();
  if (state.status === 'won') {
    view.primary.focus({ preventScroll: true });
    view.result.scrollIntoView({ block: 'start' });   // a long win screen starts at its heading
  } else if (view.checksPanel.getBoundingClientRect().top > innerHeight - 80) {
    view.checksPanel.scrollIntoView({ block: 'start' });
  }
}

// Undo the last change to the pipeline (and any runs after it).
function undo() {
  if (state.status !== 'playing') return;
  let i = recorded.length - 1;
  while (i >= 0 && recorded[i] === 'run') i -= 1;
  if (i < 0) return;
  recorded = recorded.slice(0, i);
  state = replay(state.level, recorded);
  selected = null;
  update();
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  selected = null;
  update();
  if (moveFocus) view.run.focus();
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
  if (key === 'escape' && selected) {
    const id = selected;
    selected = null;
    update();
    focusStep(id);
    return;
  }
  if (state.status === 'won') {
    if (key === 'n' && !lastLevel) openLevel(levelIndex + 1, true);
    return;
  }
  if (key === 'r') run();
  else if (key === 'u') undo();
  else if (selected && /^[1-9]$/.test(key)) {
    const n = Number(key);
    if (n <= state.stages.length) moveTo(n);
    else if (n === state.stages.length + 1) newStage(n);
  } else if (selected) {
    const option = OPTIONS.find((o) => OPTION_TEXT[o].key.toLowerCase() === key && !whyNot(state.level, selected, o));
    if (option) toggle(option);
  }
}

// ------------------------------------------------------------------ helpers

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function focusStep(id) {
  const button = view.pipe.querySelector(`[data-step="${id}"]`);
  if (button) button.focus();
}

function commitText(commit) {
  return COMMIT_TEXT[commit] || `a "${commit}" commit`;
}

function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// One plain sentence for a check, e.g. "A lint error on main must go red within 2 min, before anything deploys."
function describeCheck(check) {
  const pushes = pushesOf(check);
  const limit = check.within === undefined ? '' : ` within ${check.within} min`;
  const many = pushes.length > 1;
  let who;
  if (!many) {
    const p = pushes[0];
    who = `${capital(commitText(p.commit))} on ${p.branch}` + (p.approveAt === null ? '' : ` (approved at minute ${p.approveAt})`);
  } else {
    const alike = pushes.every((p) => p.commit === pushes[0].commit && p.branch === pushes[0].branch);
    const when = (p) => `${p.name} at minute ${p.at}` + (p.approveAt === null ? '' : ` (approved at minute ${p.approveAt})`);
    who = alike
      ? `${NUMBER_WORDS[pushes.length] || pushes.length} pushes to ${pushes[0].branch}, each ${commitText(pushes[0].commit)}: ${pushes.map(when).join(', ')}.`
      : `Pushes ${pushes.map((p) => `${when(p)}, ${commitText(p.commit)} on ${p.branch}`).join('; ')}.`;
  }
  const expects = {
    green: many ? `Each must go green${limit ? `${limit} of its push` : ''}` : `must go green${limit}`,
    red: `must go red${limit}, before anything deploys`,
    'no-deploy': many ? 'Each must be built and tested, go green, and deploy nothing' : 'must be built and tested, go green, and deploy nothing',
    waits: `must run every other step, then wait for a person before production${limit}`,
    'same-image': `${many ? 'P' : 'p'}roduction must get the very image push ${pushes[0].name} built`,
  };
  return `${who} ${expects[check.expect] || check.expect}.`;
}

// The short facts under a step's name, e.g. "4 min · builds the app".
function stepMeta(step) {
  const bits = [`${step.minutes} min`];
  if (step.cacheSaves) bits.push(`${step.cacheSaves} of them installing`);
  if (step.makes) bits.push(`builds the ${step.makes}`);
  if (step.pushes) bits.push('pushes an image');
  if (step.needs === 'image') bits.push('pulls the image');
  else if (step.needs) bits.push(`needs the ${step.needs}`);
  if (step.deploys) bits.push(`deploys to ${step.deploys}`);
  return bits.join(' · ');
}

// ------------------------------------------------------------------ drawing

// Runs once: creates the parts of the page that stay.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.run = el('button', { class: 'btn btn-primary', type: 'button', onclick: run }, '▶ Run', kbd('R'));
  view.undo = el('button', { class: 'btn btn-quiet', type: 'button', onclick: undo }, 'Undo', kbd('U'));
  view.reset = el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Reset');
  view.hint = el('p', { class: 'si-hint' });
  view.status = el('p', { class: 'si-status', 'aria-live': 'polite' });
  view.tip = el('p', { class: 'si-tip' });
  view.pipe = el('div', { class: 'si-pipe', role: 'group', 'aria-label': 'Pipeline' });
  view.checks = el('ol', { class: 'si-checks' });
  view.stale = el('p', { class: 'si-stale-note', hidden: true }, 'You changed the pipeline since this run. Run it again to check.');
  view.checksPanel = el('section', { class: 'panel stack', 'aria-label': 'Checks' },
    el('h2', {}, 'Checks'), view.stale, view.checks);
  view.result = el('section', { class: 'panel result stack si-result', hidden: true });

  main.append(
    el('p', { class: 'how' }, 'Rearrange the pipeline until Run passes every check. Fewer runner-minutes earn more stars.'),
    view.picker,
    el('section', { class: 'panel stack si-board' },
      el('div', { class: 'si-head' }, view.title, el('div', { class: 'row si-actions' }, view.run, view.undo, view.reset)),
      view.hint,
      el('div', { class: 'si-line' }, view.status, view.tip),   // one line on a phone, to save height
      view.pipe),
    view.checksPanel,
    view.result,
    el('p', { class: 'muted si-keys' }, 'Keys: R run, U undo, Esc deselect. With a step selected: 1 to 9 move it to that stage (one more than the last makes a new stage at the end), Tab reaches the "+ new stage" gaps, and the letter on each option button switches it.'),
  );
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.hint.textContent = level.hint;
  view.run.disabled = state.status !== 'playing';
  view.undo.disabled = state.status !== 'playing' || !recorded.some((move) => move !== 'run');
  drawStatus();
  drawPipe();
  drawChecks();
  drawPicker();
  drawResult();
}

function drawStatus() {
  const report = state.report;
  if (!report) {
    view.status.textContent = 'Not run yet.';
  } else if (!state.fresh) {
    view.status.textContent = 'Changed since the last run.';
  } else {
    const passed = report.checks.filter((check) => check.pass).length;
    view.status.textContent = `${passed} of ${report.checks.length} checks pass · ${report.minutes} runner-minutes`;
  }
  view.tip.textContent = selected
    ? `${state.level.steps[selected].label} is selected: tap a stage or a "new stage" gap to move it, or switch an option.`
    : 'Tap a step, then where it should go.';
}

function drawPipe() {
  const parts = [];
  const count = state.stages.length;
  const home = selected ? state.stages.findIndex((stage) => stage.includes(selected)) : -1;
  const alone = home >= 0 && state.stages[home].length === 1;
  // A gap makes a new stage. Gaps right next to a step that is alone in its stage would change nothing.
  const gap = (n) => (selected && !(alone && (n === home + 1 || n === home + 2)) ? drawGap(n) : null);
  state.stages.forEach((stage, i) => {
    parts.push(gap(i + 1));
    if (!selected && i > 0) parts.push(el('span', { class: 'si-arrow', 'aria-hidden': 'true' }, '→'));
    parts.push(drawStage(stage, i));
  });
  parts.push(gap(count + 1));
  // replaceChildren() would show a null as the text "null", so drop the parts not in use.
  view.pipe.replaceChildren(...parts.filter(Boolean));
}

function drawGap(n) {
  const label = state.level.steps[selected].label;
  return el('button', {
    class: 'si-gap', type: 'button', onclick: () => newStage(n),
    'aria-label': `Put ${label} in a new stage ${n}`,
  }, el('span', { 'aria-hidden': 'true' }, '+'), el('span', { class: 'si-gap-text' }, ' new stage here'),
  n === state.stages.length + 1 && n <= 9 ? kbd(String(n)) : null);
}

function drawStage(stage, i) {
  const level = state.level;
  const target = selected && !stage.includes(selected);
  const chips = stage.map((id) => {
    const step = level.steps[id];
    const badges = OPTIONS.filter((option) => has(state, id, option))
      .map((option) => el('span', { class: 'si-badge' }, OPTION_TEXT[option].badge));
    return el('li', {},
      el('button', {
        class: 'si-step', type: 'button', 'data-step': id,
        'aria-pressed': selected === id ? 'true' : 'false',
        onclick: () => selectStep(id),
      },
      el('span', { class: 'si-step-name' }, step.label),
      el('span', { class: 'si-step-meta' }, stepMeta(step)),
      badges.length ? el('span', { class: 'si-badges' }, badges) : null));
  });
  const here = target
    ? el('button', { class: 'btn si-here', type: 'button', onclick: () => moveTo(i + 1) }, 'Move here', i < 9 ? kbd(String(i + 1)) : null)
    : null;
  return el('div', {
    class: target ? 'si-stage is-target' : 'si-stage',
    // Tapping anywhere on a target stage moves the selected step there; the button does the same.
    onclick: (event) => { if (target && !event.target.closest('button')) moveTo(i + 1); },
  },
  el('div', { class: 'si-stage-head' }, el('span', {}, `Stage ${i + 1}`), here),
  el('ul', { class: 'si-steps' }, chips),
  selected && stage.includes(selected) ? drawOptions() : null);
}

function drawOptions() {
  const level = state.level;
  const allowed = level.toggles.filter((option) => !whyNot(level, selected, option));
  if (allowed.length === 0) {
    return el('p', { class: 'si-opts muted' }, level.toggles.length ? 'No options for this step.' : 'No options in this level: only order matters.');
  }
  return el('div', { class: 'si-opts', role: 'group', 'aria-label': 'Options' }, allowed.map((option) => {
    const on = has(state, selected, option);
    return el('button', {
      class: 'btn si-opt', type: 'button', 'data-option': option,
      'aria-pressed': on ? 'true' : 'false', onclick: () => toggle(option),
    }, `${OPTION_TEXT[option].name}: ${on ? 'on' : 'off'}`, kbd(OPTION_TEXT[option].key));
  }));
}

function drawChecks() {
  const report = state.report;
  view.stale.hidden = !report || state.fresh;
  let opened = false;
  const items = state.level.checks.map((check, i) => {
    const result = report ? report.checks[i] : null;
    const verdict = !result ? 'not run' : result.pass ? 'pass' : 'fail';
    let details = null;
    if (result) {
      const open = !result.pass && !opened;
      if (open) opened = true;
      details = el('details', { class: 'si-details', open },
        el('summary', {}, `Timeline · ${result.minutes} runner-min`), drawTimeline(result));
    }
    return el('li', { class: `si-check ${result ? verdict : ''} ${report && !state.fresh ? 'is-stale' : ''}` },
      el('div', { class: 'si-check-head' },
        el('span', { class: 'si-mark', 'aria-hidden': 'true' }, !result ? '·' : result.pass ? '✓' : '✗'),
        el('div', { class: 'si-check-body' },
          el('p', {}, el('span', { class: 'pill si-verdict' }, verdict), ' ', describeCheck(check)),
          result && !result.pass ? el('p', { class: 'si-why' }, result.why) : null)),
      details);
  });
  view.checks.replaceChildren(...items);
}

const STEP_MARK = { ok: '✓', fail: '✗', skip: '–', cancel: '–', waiting: '⏸' };

// One check's runs as bars on a shared minute axis.
function drawTimeline(result) {
  const level = state.level;
  const length = result.length;
  const pct = (minute) => `${(100 * minute) / length}%`;
  const blocks = result.runs.map((run) => {
    const ended = run.state === 'green' ? `green at minute ${run.end}`
      : run.state === 'red' ? `red at minute ${run.failAt}` : `waiting for approval from minute ${run.waitAt}`;
    const head = result.runs.length > 1
      ? `Push ${run.name} (minute ${run.at}): ${ended}` : capital(ended);
    const reached = run.steps.map((s) => s.id);
    const unreached = Object.keys(level.steps).filter((id) => !reached.includes(id));
    const rows = run.steps.map((s) => {
      const bars = [];
      if (s.waitFrom !== null) {
        const until = s.start === null ? length : s.start;
        bars.push(el('span', { class: 'si-bar wait', style: { left: pct(s.waitFrom), width: pct(until - s.waitFrom) } }));
      }
      if (s.start !== null) {
        bars.push(el('span', { class: `si-bar ${s.state}`, style: { left: pct(s.start), width: pct(s.end - s.start) } }));
      }
      let note = s.state === 'skip' ? 'skipped' : s.state === 'cancel' ? 'cancelled'
        : s.state === 'waiting' ? `waits from ${s.waitFrom}` : `${s.start}–${s.end}`;
      if (s.start !== null && s.waitFrom !== null) note += ` (waited ${s.start - s.waitFrom})`;
      return el('div', { class: `si-row ${s.state}`, title: s.note || null },
        el('span', { class: 'si-row-label' }, level.steps[s.id].label),
        el('span', { class: 'si-track' }, bars),
        el('span', { class: 'si-row-note' }, `${STEP_MARK[s.state] || ''} ${note}`));
    });
    for (const id of unreached) {
      rows.push(el('div', { class: 'si-row unreached' },
        el('span', { class: 'si-row-label' }, level.steps[id].label),
        el('span', { class: 'si-track' }),
        el('span', { class: 'si-row-note' }, '· not reached')));
    }
    const notes = run.steps.filter((s) => s.note).map((s) => el('li', {}, `${level.steps[s.id].label}: ${s.note}`));
    return el('div', { class: 'si-run' },
      el('p', { class: 'si-run-head' }, head),
      rows,
      notes.length ? el('ul', { class: 'si-notes' }, notes) : null);
  });
  const axis = el('div', { class: 'si-row si-axis', 'aria-hidden': 'true' },
    el('span'), el('span', { class: 'si-axis-track' }, el('span', {}, '0'), el('span', {}, `${length} min`)), el('span'));
  return el('div', { class: 'si-timeline' }, blocks, axis);
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
  const won = state.status === 'won';
  view.result.hidden = !won;
  if (!won) return view.result.replaceChildren();

  const level = state.level;
  const lastLevel = levelIndex === levels.length - 1;
  const earned = stars(state);
  const again = () => openLevel(levelIndex, true);
  view.primary = lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: again }, 'Play again')
    : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next level', kbd('N'));

  const snippets = level.inRealLife.map((snippet) => el('div', { class: 'si-snippet' },
    el('p', { class: 'si-snippet-label' }, snippet.label),
    el('pre', {}, el('code', {}, snippet.code))));
  const links = level.docs.map((url) => el('li', {},
    el('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace('https://', ''))));

  const parts = [
    el('h2', {}, 'Shipped: every check passes'),
    el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', {}, `${state.report.minutes} runner-minutes across ${level.checks.length} checks. `
      + `Three stars at ${level.stars.three} or less, two at ${level.stars.two} or less.`),
    el('p', { class: 'si-lesson' }, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'In real life'),
    snippets,
    el('h3', {}, 'Official docs'),
    el('ul', { class: 'si-docs' }, links),
    lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, view.primary,
      lastLevel ? null : el('button', { class: 'btn btn-quiet', type: 'button', onclick: again }, 'Play again')),
    DEV ? el('pre', { class: 'dev' }, `solution: [${recorded.map((move) => `'${move}'`).join(', ')}],`) : null,
  ];
  view.result.replaceChildren(...parts.flat().filter(Boolean));
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
