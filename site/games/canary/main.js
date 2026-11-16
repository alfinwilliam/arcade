// PAGE for Canary: drawing and input only. Every rule lives in logic.js; this file never
// decides who wins.
//
//   1. mountShell() gives the top bar and the <main> to build in.
//   2. build() makes the page once; openLevel() fills in one level; update() copies the
//      state onto the page after every input.
//   3. Every input goes through press(), which calls logic.apply and records the input.
//   4. ready() once the first frame is on screen.

import { mountShell, ready, el, svg } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels, causes } from './levels.js';
import {
  start, apply, replay, stars, healthy, choicesFor, virtualServiceYaml, destinationRuleYaml,
} from './logic.js';

// URL options:  ?level=3 opens level 3.  ?dev shows the recorded inputs on a win, and with
// ?dev&play=weight 5,run the page plays those inputs at once (handy to check a solution).
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const SAVE_KEY = 'canary:stars';                                // saved as { levelId: bestStars }

const main = mountShell({ title: 'Canary' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every input so far, in order: exactly what replay() takes

const LABELS = {
  header: 'Testers\' route',
  mirror: 'Mirror to v2',
  timeout: 'Timeout per try',
  retries: 'Retries',
  outlier: 'Eject a pod on 5xx',
};

// ------------------------------------------------------------------- inputs

function press(input) {
  if (state.status !== 'playing') return;
  try {
    state = apply(state, input);
  } catch (error) {
    view.note.textContent = error.message.replace(/^level \S+: /, '');
    return;
  }
  // Several changes to the same control in a row are one change: keep only the last.
  const verb = input.split(' ')[0];
  const last = recorded[recorded.length - 1];
  if (verb !== 'run' && last && last.split(' ')[0] === verb) recorded[recorded.length - 1] = input;
  else recorded.push(input);
  view.note.textContent = '';
  if (state.status === 'won') rememberWin();
  update();
  if (state.status !== 'playing') {
    view.result.scrollIntoView({ block: 'start' });
    view.primary.focus({ preventScroll: true });
  } else if (verb === 'run') {
    // The newest round sits just below the controls: scroll only as far as needed to show it,
    // so the Run button usually stays on screen too.
    view.log.firstElementChild.scrollIntoView({ block: 'nearest' });
  }
}

function run() {
  if (state.status === 'playing') press('run');
}

function nudgeWeight(step) {
  const next = state.routing.weight + step;
  if (next >= 0 && next <= maxWeight()) press(`weight ${next}`);
}

// The highest v2 weight allowed this round (the level's maxStep, if it has one).
function maxWeight() {
  const step = state.level.maxStep;
  return step ? Math.min(100, state.lastWeight + step) : 100;
}

function toggleRollback(open) {
  if (state.level.rollback === false || state.status !== 'playing') return;
  if (!state.evidence) {
    view.note.textContent = 'Roll back opens once v2 has shown a problem: an error, or p99 over the limit.';
    return;
  }
  view.chooser.hidden = !open;
  if (open) {
    // Show the whole chooser, down to its confirm button, then focus the first cause.
    view.chooser.scrollIntoView({ block: 'nearest' });
    view.chooser.querySelector('input').focus({ preventScroll: true });
  } else {
    view.rollback.focus();
  }
}

function confirmRollback() {
  const picked = view.chooser.querySelector('input:checked');
  if (!picked) {
    view.note.textContent = 'Pick the cause first.';
    return;
  }
  press(`rollback ${picked.value}`);
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  buildControls();
  view.note.textContent = '';
  update();
  if (moveFocus) view.weight.focus();
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state));
  save(SAVE_KEY, best);
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = event.target.tagName;
  const inField = tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA';
  const key = event.key.toLowerCase();
  const lastLevel = levelIndex === levels.length - 1;
  if (key === 'g') run();
  else if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
  else if (key === 'b') toggleRollback(view.chooser.hidden);
  else if (key === 'escape' && !view.chooser.hidden) toggleRollback(false);
  else if (!inField && (key === 'arrowleft' || key === '-')) nudgeWeight(-5);
  else if (!inField && (key === 'arrowright' || key === '+' || key === '=')) nudgeWeight(5);
  else return;
  event.preventDefault();
}

// ------------------------------------------------------------------ helpers

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function valueText(tool, value) {
  if (tool === 'header') return { off: 'Off', first: 'First', last: 'Last' }[value];
  if (tool === 'mirror') return value === 0 ? 'Off' : `${value}% of requests`;
  if (tool === 'timeout') return value === 0 ? 'None (default)' : `${value} ms`;
  if (tool === 'retries') return value === 0 ? '0: no retries' : `${value} more ${value === 1 ? 'try' : 'tries'}`;
  if (tool === 'outlier') return value === 0 ? 'Off' : `After ${value} in a row`;
  return String(value);
}

function routingText(level, r) {
  const parts = [`v2 ${r.weight}%`];
  if (level.tools.includes('header')) parts.push(`testers' route ${r.header}`);
  if (level.tools.includes('mirror')) parts.push(r.mirror ? `mirror ${r.mirror}%` : 'no mirror');
  if (level.tools.includes('timeout')) parts.push(r.timeout ? `timeout ${r.timeout} ms` : 'no timeout');
  if (level.tools.includes('retries')) parts.push(`retries ${r.retries}`);
  if (level.tools.includes('outlier')) parts.push(r.outlier ? `outlier ${r.outlier}` : 'no outlier detection');
  return parts.join(' · ');
}

// ------------------------------------------------------------------ drawing

// Runs once: creates every element and puts it on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.brief = el('p', { class: 'cn-brief' });
  view.status = el('p', { class: 'cn-status mono', 'aria-live': 'polite' });
  view.mesh = svg('svg', { class: 'cn-mesh', viewBox: '0 0 360 160', role: 'img' });

  view.weight = el('input', {
    class: 'cn-slider', type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'v2 weight in percent',
    oninput: () => {
      const value = Math.min(Number(view.weight.value), maxWeight());
      view.weight.value = String(value);
      if (value !== state.routing.weight) press(`weight ${value}`);
    },
  });
  view.weightLabel = el('span', { class: 'cn-label cn-weight-label', 'aria-hidden': 'true' });
  view.weightText = el('p', { class: 'cn-weight-text mono' });
  view.minus = el('button', { class: 'btn cn-step', type: 'button', 'aria-label': 'Less to v2', onclick: () => nudgeWeight(-5) }, '−');
  view.plus = el('button', { class: 'btn cn-step', type: 'button', 'aria-label': 'More to v2', onclick: () => nudgeWeight(5) }, '+');
  view.selects = el('div', { class: 'cn-selects' });
  view.run = el('button', { class: 'btn btn-primary cn-run', type: 'button', onclick: run }, 'Run round', kbd('G'));
  view.rollback = el('button', { class: 'btn cn-rollback', type: 'button', onclick: () => toggleRollback(view.chooser.hidden) },
    'Roll back', kbd('B'));
  view.note = el('p', { class: 'cn-note', role: 'status' });

  view.chooser = el('fieldset', { class: 'cn-chooser stack', hidden: true },
    el('legend', {}, 'Roll back to v1. What is wrong with v2?'),
    ...causes.map((cause) => el('label', { class: 'cn-cause' },
      el('input', { type: 'radio', name: 'cause', value: cause.id }), cause.text)),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: confirmRollback }, 'Roll back to v1'),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => toggleRollback(false) }, 'Cancel')));

  view.result = el('section', { class: 'panel result stack', hidden: true, tabIndex: -1 });
  view.log = el('ol', { class: 'cn-log', reversed: true });
  view.vs = el('code');
  view.dr = el('code');

  main.append(
    el('p', { class: 'how' }, 'Set the routing, run a round, read each version\'s numbers. Ship v2 on 100% and healthy, or roll back and name the fault.'),
    view.picker,
    el('section', { class: 'panel stack cn-play' },
      view.title,
      view.brief,
      view.status,
      view.mesh,
      el('div', { class: 'cn-weight-row' },
        view.weightLabel,
        view.minus, view.weight, view.plus),
      view.weightText,
      view.selects,
      el('div', { class: 'row cn-actions' }, view.run, view.rollback),
      view.note,
      view.chooser),
    view.result,
    el('section', { class: 'panel stack' },
      el('h3', {}, 'Round log'),
      view.log),
    el('details', { class: 'panel cn-details' },
      el('summary', {}, 'The Istio YAML for this routing'),
      el('p', { class: 'muted cn-small' }, 'Every control above sets a field in these two objects. The timeout is written as perTryTimeout when retries are on, and as the route\'s timeout when they are off.'),
      el('pre', { class: 'cn-pre' }, view.vs),
      el('pre', { class: 'cn-pre' }, view.dr)),
    el('details', { class: 'panel cn-details' },
      el('summary', {}, 'How this game simplifies Istio'),
      el('ul', { class: 'cn-small stack' },
        el('li', {}, 'Each round is a fixed batch of requests, spread evenly over the pods, with every share rounded down. Real load balancing is not this even, and real traffic is not this regular.'),
        el('li', {}, 'Outlier detection is tracked by each calling proxy on its own; here there is one shared view. A real ejected pod comes back after baseEjectionTime (longer each time it is ejected); here it stays out for the rest of the level.'),
        el('li', {}, 'Real retries wait a short, randomised backoff between tries (Envoy\'s base interval is 25 ms); the game leaves that time out. Mirrored copies are never retried here.'),
        el('li', {}, 'Where a level has no Retries control, the YAML has no retries block, so real Istio would use its default: 2 retries, but only on connection failures, refused streams and some gRPC errors. None of the errors in this game (500, 503, 504) match that, so the game does not retry there.'),
        el('li', {}, 'The weights here always add up to 100, so they read as percentages. Istio treats them as relative shares.'),
        el('li', {}, 'Overload follows a rule made up for this game, not an Istio or Envoy behaviour: past its capacity a version turns the excess away with 503 and serves the rest more slowly, and the round is worked out again until the number of tries settles. Real services under overload queue, slow down, time out or crash, each in its own way.'))),
  );
}

// Runs when a level opens: one <select> per control the level offers (besides the weight).
function buildControls() {
  const level = state.level;
  const selects = [];
  view.select = {};
  for (const tool of ['header', 'mirror', 'timeout', 'retries', 'outlier']) {
    if (!level.tools.includes(tool)) continue;
    const values = tool === 'header' ? ['off', 'first', 'last'] : choicesFor(level, tool);
    const select = el('select', {
      class: 'cn-select', id: `cn-${tool}`,
      onchange: () => press(`${tool} ${select.value}`),
    }, ...values.map((v) => el('option', { value: String(v) }, valueText(tool, v))));
    view.select[tool] = select;
    selects.push(el('label', { class: 'cn-field', for: `cn-${tool}` }, el('span', { class: 'cn-label' }, LABELS[tool]), select));
  }
  view.selects.replaceChildren(...selects);
  view.selects.hidden = selects.length === 0;
  view.rollback.hidden = level.rollback === false;
  view.chooser.hidden = true;
  for (const input of view.chooser.querySelectorAll('input')) input.checked = false;
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  const r = state.routing;
  const playing = state.status === 'playing';
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.brief.textContent = level.brief;

  const roundNo = Math.min(state.rounds.length + 1, level.rounds);
  view.status.textContent = `Round ${playing ? roundNo : state.rounds.length} of ${level.rounds} · ` +
    `failed requests ${state.spent} (budget ${level.budget}) · p99 limit ${level.p99Limit} ms`;

  view.weight.value = String(r.weight);
  view.weight.disabled = !playing;
  view.minus.disabled = !playing || r.weight <= 0;
  view.plus.disabled = !playing || r.weight >= maxWeight();
  view.weightLabel.textContent = `v2 ${r.weight}%`;
  view.weight.setAttribute('aria-valuetext', `v2 ${r.weight}%, v1 ${100 - r.weight}%`);
  view.weightText.textContent = level.maxStep ? `v2 may go up to ${maxWeight()}% this round.` : '';
  for (const [tool, select] of Object.entries(view.select)) {
    select.value = String(r[tool]);
    select.disabled = !playing;
  }
  view.run.disabled = !playing;
  view.rollback.disabled = !playing;
  // Not `disabled` before there is evidence: a tap then explains why it cannot open yet.
  view.rollback.setAttribute('aria-disabled', String(!state.evidence));
  if (!playing) view.chooser.hidden = true;

  view.vs.textContent = virtualServiceYaml(level, r);
  view.dr.textContent = destinationRuleYaml(level, r);
  drawMesh();
  drawLog();
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

// ---------------------------------------------------------------- the mesh

function box(x, y, w, h, title, sub, cls) {
  return svg('g', { class: cls },
    svg('rect', { x, y, width: w, height: h, rx: 6 }),
    svg('text', { x: x + w / 2, y: y + 15, 'text-anchor': 'middle', class: 'cn-svg-title' }, title),
    sub ? svg('text', { x: x + w / 2, y: y + 28, 'text-anchor': 'middle', class: 'cn-svg-sub' }, sub) : null);
}

// Pod squares inside a version box: ✕ for an ejected pod, ! for one that answered 5xx last round.
function pods(x, y, name) {
  const spec = state.level[name];
  const lastRound = state.rounds[state.rounds.length - 1];
  const errors = lastRound ? lastRound[name].podErrors : [];
  const parts = [];
  for (let pod = 1; pod <= spec.pods; pod++) {
    const px = x + (pod - 1) * 15;
    const out = state.ejected[name].includes(pod);
    const hurt = !out && errors[pod - 1] && errors[pod - 1].errors > 0;
    parts.push(svg('rect', { x: px, y, width: 12, height: 12, rx: 2, class: out ? 'cn-pod cn-pod-out' : 'cn-pod' }));
    if (out || hurt) {
      parts.push(svg('text', { x: px + 6, y: y + 10, 'text-anchor': 'middle', class: 'cn-svg-mark' }, out ? '✕' : '!'));
    }
  }
  return parts;
}

function line(x1, y1, x2, y2, share, cls, label, lx, ly) {
  return [
    svg('line', { x1, y1, x2, y2, class: cls, 'stroke-width': share > 0 ? Math.max(1.5, share * 14 / 100) : 1 }),
    label ? svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'cn-svg-label' }, label) : null,
  ];
}

function drawMesh() {
  const level = state.level;
  const r = state.routing;
  const testers = level.testers || 0;
  const w1 = 100 - r.weight;
  const parts = [
    ...line(76, 53, 124, 62, 100, 'cn-flow', null),
    ...line(216, 56, 266, 33, w1, w1 > 0 ? 'cn-flow' : 'cn-flow cn-off', `${w1}%`, 236, 34),
    ...line(216, 72, 266, 108, r.weight, r.weight > 0 ? 'cn-flow cn-flow-v2' : 'cn-flow cn-off', `${r.weight}%`, 254, 86),
  ];
  if (r.mirror > 0) {
    parts.push(svg('line', { x1: 196, y1: 82, x2: 266, y2: 130, class: 'cn-mirror' }),
      svg('text', { x: 311, y: 158, 'text-anchor': 'middle', class: 'cn-svg-label' }, `mirrored ${r.mirror}%`));
  }
  if (testers) {
    if (r.header === 'first') {
      parts.push(svg('path', { d: 'M76 136 C 150 160, 230 160, 266 140', class: 'cn-testers' }),
        svg('text', { x: 150, y: 140, 'text-anchor': 'middle', class: 'cn-svg-label' }, 'x-canary → v2'));
    } else {
      parts.push(...line(76, 124, 124, 80, 30, 'cn-testers', null));
    }
  }
  parts.push(
    box(4, 36, 72, 34, 'users', `${level.users}/round`, 'cn-node'),
    testers ? box(4, 112, 72, 34, 'testers', `${testers}/round`, 'cn-node cn-node-quiet') : null,
    box(124, 48, 92, 34, 'sample-app', 'routing', 'cn-node cn-node-hub'),
    box(266, 8, 90, 50, 'v1', null, 'cn-node'),
    box(266, 96, 90, 50, 'v2', null, 'cn-node cn-node-v2'),
    ...pods(274, 38, 'v1'),
    ...pods(274, 126, 'v2'),
  );
  view.mesh.replaceChildren(...parts.filter(Boolean));
  const text = [`Users: v1 ${w1}%, v2 ${r.weight}%.`];
  if (testers) text.push(r.header === 'first' ? 'Testers go to v2 by header.' : 'Testers follow the weights.');
  if (r.mirror) text.push(`${r.mirror}% of requests mirrored to v2.`);
  if (state.ejected.v2.length) text.push(`Ejected v2 pods: ${state.ejected.v2.join(', ')}.`);
  view.mesh.setAttribute('aria-label', 'Traffic: ' + text.join(' '));
}

// ---------------------------------------------------------------- the log

// One round as a small table: a row per measure, a column per version, so v1 and v2 sit side
// by side. Every bad cell starts with ✕ (and every clean result with ✓), so colour is never
// the only signal.
function roundTable(level, round) {
  const both = [round.v1, round.v2];
  const firstTries = (s) => s.users + s.testers + s.mirrored;
  const failedText = (s) => {
    const parts = [];
    if (s.failed.users) parts.push(plural(s.failed.users, 'user'));
    if (s.failed.testers) parts.push(plural(s.failed.testers, 'tester'));
    if (s.failed.mirrored) parts.push(`${s.failed.mirrored} mirrored`);
    return parts.length ? `✕ ${parts.join(', ')}` : '✓ none';
  };
  const codesText = (s) => {
    const parts = Object.entries(s.codes).filter(([, n]) => n > 0).map(([code, n]) => `${code} ×${n}`);
    return parts.length ? parts.join(', ') : '–';
  };
  const p99Text = (s) => {
    if (s.p99 === null) return '–';
    return s.p99 > level.p99Limit ? `✕ ${s.p99} ms` : `${s.p99} ms`;
  };
  const podText = (s) => s.podErrors.map((p) => (p.errors === null ? 'out' : String(p.errors))).join(' · ');

  const rows = [['users', (s) => String(s.users)]];
  if (level.testers) rows.push(['testers', (s) => String(s.testers)]);
  if (both.some((s) => s.mirrored)) rows.push(['mirrored', (s) => String(s.mirrored)]);
  if (both.some((s) => s.attempts !== firstTries(s))) rows.push(['tries', (s) => String(s.attempts)]);
  rows.push(['failed', failedText], ['codes', codesText], ['p99', p99Text], ['5xx by pod', podText]);

  const cell = (s, text) => {
    const quiet = firstTries(s) === 0;
    const bad = text.startsWith('✕');
    return el('td', { class: bad ? 'cn-bad' : (quiet ? 'muted' : null) }, quiet ? '–' : text);
  };
  return el('table', { class: 'cn-table' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Measure')),
      el('th', { scope: 'col' }, 'v1'),
      el('th', { scope: 'col' }, 'v2'))),
    el('tbody', {}, ...rows.map(([name, text]) => el('tr', {},
      el('th', { scope: 'row' }, name),
      ...both.map((s) => cell(s, text(s)))))));
}

function healthLine(level, round) {
  if (round.routing.weight !== 100) return null;
  const s = round.v2;
  if (healthy(level, s)) return el('p', { class: 'cn-good' }, '✓ v2 on 100% and healthy');
  const why = [];
  if (s.failed.users > 0) why.push(`${plural(s.failed.users, 'user request')} failed`);
  if (s.pod5xx > 0) why.push(`its pods answered ${s.pod5xx} with 5xx`);
  if (s.p99 !== null && s.p99 > level.p99Limit) why.push(`p99 ${s.p99} ms is over ${level.p99Limit}`);
  return el('p', { class: 'cn-bad' }, `✕ v2 on 100% but not healthy: ${why.join('; ')}`);
}

function drawLog() {
  const level = state.level;
  if (state.rounds.length === 0) {
    view.log.replaceChildren(el('li', { class: 'muted cn-empty' }, 'No rounds yet. Set the routing and press Run round.'));
    return;
  }
  const items = state.rounds.map((round, i) => {
    const ejected = [...round.v1.newlyEjected.map((pod) => `v1 pod ${pod}`), ...round.v2.newlyEjected.map((pod) => `v2 pod ${pod}`)];
    return el('li', { class: 'cn-round stack' },
      el('p', { class: 'cn-round-head' }, el('strong', {}, `Round ${i + 1}`), ` · ${routingText(level, round.routing)}`),
      roundTable(level, round),
      ejected.length ? el('p', { class: 'cn-v' }, `Outlier detection ejected ${ejected.join(', ')}.`) : null,
      el('p', { class: round.failed ? 'cn-bad' : 'cn-v' },
        round.failed ? `✕ ${plural(round.failed, 'failed user request')} this round` : '✓ no failed user requests this round'),
      healthLine(level, round));
  });
  view.log.replaceChildren(...items.reverse());   // newest first
}

// -------------------------------------------------------------- the result

function lossText() {
  const level = state.level;
  if (state.reason === 'budget') return `${plural(state.spent, 'user request')} failed; the budget was ${level.budget}.`;
  if (state.reason === 'rounds') return `All ${level.rounds} rounds used without shipping v2 or rolling it back.`;
  const named = causes.find((c) => c.id === state.verdict);
  const real = causes.find((c) => c.id === level.fault);
  return `You named: ${named.text.toLowerCase()}. ${real ? `The real problem: ${real.text.toLowerCase()}.` : 'v2 was healthy: nothing needed a rollback.'}`;
}

function drawResult() {
  const over = state.status !== 'playing';
  view.result.hidden = !over;
  if (!over) return;
  const level = state.level;
  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result stack' : 'panel result lost stack';

  if (!won) {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Try again', kbd('R'));
    const title = { budget: 'Error budget spent', rounds: 'Out of rounds', cause: 'Wrong cause' }[state.reason];
    view.result.replaceChildren(
      el('h2', {}, title),
      el('p', {}, lossText()),
      el('p', {}, el('strong', {}, 'Hint: '), level.hint),
      el('div', { class: 'row' }, view.primary));
    return;
  }

  view.primary = lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Play again', kbd('R'))
    : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next level', kbd('N'));
  const earned = stars(state);
  const par = replay(level, level.solution);
  const shipped = state.reason === 'promoted';
  const parts = [
    el('h2', {}, shipped ? `v2 shipped after ${plural(state.rounds.length, 'round')}` : 'Rolled back, cause found'),
    shipped ? null : el('p', {}, `The cause: ${causes.find((c) => c.id === state.verdict).text.toLowerCase()}.`),
    el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', { class: 'muted' }, `${plural(state.spent, 'failed user request')} of a budget of ${level.budget}. ` +
      `Three stars: at most ${plural(par.rounds.length, 'round')} and ${par.spent} failed.`),
    el('p', {}, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'In real life'),
    ...level.inRealLife.map((snippet) => el('div', { class: 'cn-snippet' },
      el('p', { class: 'cn-small muted mono' }, snippet.label),
      el('pre', { class: 'cn-pre' }, el('code', {}, snippet.code)))),
    el('p', { class: 'cn-docs' }, 'Read more: ',
      ...level.docs.flatMap((url, i) => [i ? ' · ' : '', el('a', { href: url, rel: 'noopener', target: '_blank' }, url.replace(/^https:\/\//, ''))])),
    lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, view.primary),
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
const asked = Number(params.get('level'));
openLevel(asked >= 1 && asked <= levels.length ? asked - 1 : firstUnsolved(), false);
if (DEV && params.get('play')) for (const input of params.get('play').split(',')) press(input.trim());
document.addEventListener('keydown', onKey);
ready();
