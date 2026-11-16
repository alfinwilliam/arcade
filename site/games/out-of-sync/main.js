// PAGE for Out of Sync: drawing and input only.
// Every rule lives in logic.js. This file never decides who wins.
//
// Shape (the same as the template game):
//   1. build() creates the fixed parts of the page once.
//   2. update() redraws everything from `state` after every input.
//   3. Every input goes through press(), which calls logic.apply and records the input.
//   4. ready() is called once the first frame is on screen.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import { start, apply, replay, stars, notBestUsed, badges, compare, resourceHealth, blocked, byKind } from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded inputs on a win
const SAVE_KEY = 'out-of-sync:stars';                           // saved as { levelId: bestStars }

const main = mountShell({ title: 'Out of Sync' });
const best = load(SAVE_KEY, {});
const view = {};        // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;       // the current game state, always produced by logic.js
let recorded = [];      // every input so far, in order: exactly what replay() takes

// Words and symbols for the badges. The symbol and the word carry the meaning; colour only repeats it.
const SYNC_LOOK = { Synced: ['✓', 'good'], OutOfSync: ['≠', 'warn'] };
const HEALTH_LOOK = { Healthy: ['♥', 'good'], Progressing: ['◔', 'warn'], Missing: ['?', 'bad'], Degraded: ['✗', 'bad'] };
const FIELD_NAMES = { wave: 'sync-wave' };
const KEYS = { s: 'sync', p: 'sync-prune', f: 'refresh', w: 'wait' };
const SWITCHES = { auto: 'auto', 'self-heal': 'selfHeal', prune: 'prune' };   // input word -> setting

// ------------------------------------------------------------------- inputs

function press(input) {
  if (state.status !== 'playing' || blocked(state, input)) return;
  state = apply(state, input);
  recorded.push(input);
  if (state.status === 'won') rememberWin();
  update();
  if (state.status !== 'playing') showResult();
}

function undo() {
  if (recorded.length === 0 || state.status === 'won') return;
  const fromResult = view.result.contains(document.activeElement);
  recorded.pop();
  state = replay(state.level, recorded);   // rebuild the state from the inputs that remain
  update();
  if (fromResult) view.actions.querySelector('button:not(:disabled)')?.focus();
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  update();
  if (moveFocus) view.actions.querySelector('button:not(:disabled)')?.focus();
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
  if (KEYS[key] && state.level.actions.includes(KEYS[key])) press(KEYS[key]);
  else if (key === 'u') undo();
  else if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
}

// The win or lose panel can be long: bring its heading into view, then focus its main button.
function showResult() {
  view.result.scrollIntoView({ block: 'start' });
  view.primary.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ drawing

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

// Runs once: creates the fixed elements and puts them on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.hint = el('p', { class: 'oos-hint' });
  view.badges = el('div', { class: 'oos-badges' });
  view.policy = el('p', { class: 'oos-meta' });
  view.next = el('p', { class: 'oos-next' });
  view.note = el('p', { class: 'oos-note', 'aria-live': 'polite' });
  view.result = el('section', { class: 'panel result stack', hidden: true, tabindex: '-1' });
  view.actions = el('section', { class: 'panel oos-actions stack', 'aria-label': 'Actions' });
  view.latest = el('section', { class: 'panel oos-latest stack', 'aria-live': 'polite', 'aria-label': 'What just happened' });
  view.gitHead = el('p', { class: 'oos-head-title' });
  view.rows = el('div', { class: 'oos-rows' });
  view.timeline = el('ol', { class: 'oos-timeline' });
  view.log = el('ol', { class: 'oos-log' });

  main.append(
    el('p', { class: 'how' },
      'Goal: Synced and Healthy after the last event and at every check. Git is what should run; the cluster is what runs. Every press, Wait too, uses an action.'),
    view.picker,
    el('section', { class: 'panel stack oos-top' },
      view.title, view.hint, view.badges, view.policy, view.next, view.note),
    view.result,
    view.actions,
    view.latest,
    el('section', { class: 'oos-board', 'aria-label': 'Git and the cluster, side by side' },
      el('div', { class: 'oos-heads' },
        view.gitHead,
        el('p', { class: 'oos-head-title' }, 'Cluster · namespace sample')),
      view.rows),
    el('section', { class: 'panel stack' }, el('h3', {}, 'Timeline'), view.timeline),
    el('section', { class: 'panel stack' }, el('h3', {}, 'Everything that happened'), view.log),
  );
}

// Runs after every input: copies the state onto the page.
function update() {
  const level = state.level;
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.hint.textContent = level.hint;
  drawTop();
  drawActions();
  drawLatest();
  drawBoard();
  drawTimeline();
  drawLog();
  drawPicker();
  drawResult();
}

function badge(name, value, look) {
  const [symbol, tone] = look[value];
  return el('div', { class: 'oos-badge', 'data-tone': tone },
    el('span', { class: 'oos-badge-label' }, name),
    el('strong', {}, `${symbol} ${value}`));
}

function drawTop() {
  const level = state.level;
  const now = badges(state);
  const left = level.maxActions - state.used;
  view.badges.replaceChildren(
    badge('Sync', now.sync, SYNC_LOOK),
    badge('Health', now.health, HEALTH_LOOK),
    el('div', { class: 'oos-badge', 'data-tone': left <= 1 ? 'warn' : '' },
      el('span', { class: 'oos-badge-label' }, 'Actions'),
      el('strong', {}, `${left} of ${level.maxActions} left`)));

  const s = state.settings;
  const ignores = s.ignore.map((id) => {
    const rule = level.ignores.find((item) => item.id === id);
    return `${rule.pointer} on ${rule.resource}`;
  });
  view.policy.textContent = (s.auto
    ? `Sync policy: automated, self-heal ${s.selfHeal ? 'on' : 'off'}, prune ${s.prune ? 'on' : 'off'}.`
    : 'Sync policy: manual.')
    + (ignores.length ? ` ignoreDifferences: ${ignores.join(', ')}.` : '');

  const event = level.events[state.next];
  // replaceChildren() would show a null as the text "null", so build the parts with el().
  view.next.replaceChildren(el('span', {},
    el('strong', {}, event ? 'Next when you wait: ' : 'No more events. '),
    event ? event.text : 'Win as soon as the app is Synced and Healthy.',
    event && event.check ? el('span', { class: 'pill oos-check' }, 'check') : null));

  const head = state.commits[state.commits.length - 1];
  const notes = [];
  if (state.seen !== state.commits.length - 1) {
    notes.push(`Git has a newer commit, ${head.sha}. The badges still compare ${state.commits[state.seen].sha}: `
      + 'Argo CD fetches Git when time passes (it polls every 120 seconds plus up to 60 seconds of jitter by default) or when you Refresh.');
  }
  if (state.note) notes.push(state.note);
  view.note.textContent = notes.join(' ');
  view.note.hidden = notes.length === 0;
}

function actionButton(input, text, key, extra) {
  const why = state.status === 'playing' ? blocked(state, input) : 'The level is over.';
  return el('button', {
    class: 'btn oos-act', type: 'button', 'data-id': SWITCHES[input.split(':')[0]] ? input.split(':')[0] : input,
    disabled: Boolean(why), title: why || null, onclick: () => press(input), ...extra,
  }, text, key ? kbd(key) : null);
}

function group(title, buttons) {
  const kept = buttons.filter(Boolean);
  if (kept.length === 0) return null;
  return el('div', { class: 'oos-group', role: 'group', 'aria-label': title },
    el('h3', {}, title), el('div', { class: 'oos-buttons' }, kept));
}

// Runs after every input: the buttons depend on the state (switches show on or off).
function drawActions() {
  const level = state.level;
  const has = (action) => level.actions.includes(action);
  const focused = document.activeElement && view.actions.contains(document.activeElement)
    ? document.activeElement.dataset.id : null;

  const toggle = (verb, name) => {
    if (!has(verb)) return null;
    const on = state.settings[SWITCHES[verb]];
    return actionButton(`${verb}:${on ? 'off' : 'on'}`, `${name}: ${on ? 'on' : 'off'}`, null, { 'aria-pressed': on ? 'true' : 'false' });
  };

  view.actions.replaceChildren(...[
    group('Argo CD', [
      has('sync') ? actionButton('sync', 'Sync', 'S', { class: 'btn oos-act oos-main' }) : null,
      has('wait') ? actionButton('wait', 'Wait: let time pass', 'W', { class: 'btn oos-act oos-main' }) : null,
      has('refresh') ? actionButton('refresh', 'Refresh', 'F') : null,
      has('sync-prune') ? actionButton('sync-prune', 'Sync with prune', 'P') : null,
      has('rollback') ? actionButton('rollback', 'Roll back to the previous sync') : null,
    ]),
    group('Sync policy', [
      toggle('auto', 'Auto-sync'),
      toggle('self-heal', 'Self-heal'),
      toggle('prune', 'Auto-prune'),
      ...level.ignores.map((rule) => actionButton(`ignore:${rule.id}`, `Ignore ${rule.pointer} (${rule.resource})`)),
    ]),
    group('Git: commit and push', [
      ...level.commits.map((c) => actionButton(`commit:${c.id}`, c.label)),
      has('revert') ? actionButton('revert', 'git revert HEAD', null, { class: 'btn oos-act oos-cmd' }) : null,
    ]),
    group('kubectl (by hand)', level.edits.map((e) => actionButton(`edit:${e.id}`, e.label, null, { class: 'btn oos-act oos-cmd' }))),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-quiet', type: 'button', 'data-id': 'undo', onclick: undo,
        disabled: recorded.length === 0 || state.status === 'won' }, 'Undo', kbd('U')),
      el('button', { class: 'btn btn-quiet', type: 'button', 'data-id': 'restart', onclick: () => openLevel(levelIndex, true) },
        'Restart', kbd('R'))),
  ].filter(Boolean));

  // Keep keyboard focus where it was. If that button is now disabled (a commit that was just
  // used), move to the first button that works (usually Sync), so focus is not lost.
  if (focused) {
    const buttons = [...view.actions.querySelectorAll('button')];
    const again = buttons.find((b) => b.dataset.id === focused && !b.disabled) || buttons.find((b) => !b.disabled);
    if (again) again.focus();
  }
}

function entryLine(entry) {
  return el('li', { class: 'oos-entry' }, el('span', { class: 'oos-who' }, entry.who), ' ', entry.text);
}

// The lines from the latest input, right under the buttons.
function drawLatest() {
  const lines = state.log.filter((entry) => entry.turn === state.used && state.used > 0);
  view.latest.hidden = lines.length === 0;
  view.latest.replaceChildren(el('h3', {}, 'What just happened'), el('ul', { class: 'oos-lines' }, lines.map(entryLine)));
}

function fieldLine(field, value, mark) {
  const sign = { differs: '≠', ignored: '≈', removed: '−' }[mark] || '';
  const note = { differs: ' (differs)', ignored: ' (differs, ignored)', removed: ' (no longer in Git)' }[mark] || '';
  return el('div', { class: mark ? `oos-field is-${mark}` : 'oos-field' },
    el('span', { class: 'oos-mark', 'aria-hidden': 'true' }, sign),
    el('span', {}, `${FIELD_NAMES[field] || field}: ${value}`, el('span', { class: 'oos-why' }, note)));
}

// One row per resource: what Git says on the left, what runs on the right. Marks compare the
// newest commit with the cluster, so a commit shows up here before Argo CD has fetched it.
// Rows with a problem (differs from Git, or not Healthy) come first, so on a phone the
// difference is the first thing under the board's heading.
function drawBoard() {
  const newest = state.commits.length - 1;
  const git = state.commits[newest];
  const diff = compare(state, newest);
  view.gitHead.textContent = `Git · main @ ${git.sha}: ${git.message}`;
  const fine = (key) => diff.resources[key].hook
    || (diff.resources[key].synced && resourceHealth(state, key).health === 'Healthy');
  const keys = [...new Set([...Object.keys(git.manifests), ...Object.keys(state.live)])]
    .sort((a, b) => fine(a) - fine(b) || byKind(a, b));

  view.rows.replaceChildren(...keys.map((key) => {
    const want = git.manifests[key];
    const live = state.live[key];
    const result = diff.resources[key];
    const gitBody = !want
      ? [el('p', { class: 'oos-gone' }, '− Not in Git. Only a sync with prune deletes it.')]
      : Object.entries(want).map(([field, value]) => fieldLine(field, value, want.hook ? '' : (result.diffs[field] === 'removed' ? '' : result.diffs[field])));
    if (want && want.hook) gitBody.push(el('p', { class: 'oos-small' }, 'A hook: it runs during each sync and is never compared.'));

    let liveBody;
    if (want && want.hook) {
      liveBody = [el('p', { class: 'oos-small' }, 'Hooks run during a sync; there is nothing here to compare.')];
    } else if (!live) {
      liveBody = [el('p', { class: 'oos-gone' }, '? Missing: not in the cluster')];
    } else {
      const { health, why } = resourceHealth(state, key);
      liveBody = [
        ...Object.entries(live).map(([field, value]) => fieldLine(field, value, result.diffs[field])),
        el('p', { class: 'oos-health', 'data-tone': HEALTH_LOOK[health][1] }, `${HEALTH_LOOK[health][0]} ${health}${why ? `: ${why}` : ''}`),
      ];
    }
    const matches = result.synced;
    return el('div', { class: matches ? 'oos-row' : 'oos-row is-out' },
      el('div', { class: 'oos-card' },
        el('p', { class: 'oos-side' }, 'Git'), el('h4', {}, key), gitBody),
      el('div', { class: 'oos-card' },
        el('p', { class: 'oos-side' }, 'Cluster', el('span', { class: 'oos-match' }, matches ? '✓ matches Git' : '≠ differs from Git')),
        el('h4', {}, key), liveBody));
  }));
}

function drawTimeline() {
  const events = state.level.events;
  if (events.length === 0) {
    view.timeline.replaceChildren(el('li', { class: 'muted' }, 'No scheduled events in this level.'));
    return;
  }
  view.timeline.replaceChildren(...events.map((event, i) => {
    const when = i < state.next ? 'done' : i === state.next ? 'next' : 'later';
    return el('li', { class: `oos-when-${when}`, 'aria-current': when === 'next' ? 'step' : null },
      el('span', { class: 'oos-when' }, when), ' ', event.text,
      event.check ? el('span', { class: 'pill oos-check' }, 'check') : null);
  }));
}

function drawLog() {
  const turns = [];
  for (const entry of state.log) {
    if (entry.turn === 0) continue;   // what happened before the first input
    if (!turns[entry.turn]) turns[entry.turn] = [];
    turns[entry.turn].push(entry);
  }
  const items = turns.map((lines, turn) => (lines
    ? el('li', {}, el('span', { class: 'oos-turn' }, `${turn}.`), el('ul', { class: 'oos-lines' }, lines.map(entryLine)))
    : null)).filter(Boolean).reverse();
  view.log.replaceChildren(...(items.length ? items : [el('li', { class: 'muted' }, 'Nothing yet.')]));
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] || 0;
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

function drawResult() {
  const over = state.status !== 'playing';
  view.result.hidden = !over;
  if (!over) return view.result.replaceChildren();

  const level = state.level;
  const won = state.status === 'won';
  const lastLevel = levelIndex === levels.length - 1;
  const again = () => openLevel(levelIndex, true);
  view.result.className = won ? 'panel result stack' : 'panel result lost stack';

  if (!won) {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', onclick: again }, 'Try again', kbd('R'));
    view.result.replaceChildren(
      el('h2', {}, 'Not this time'),
      el('p', {}, state.reason),
      el('div', { class: 'row' }, view.primary,
        el('button', { class: 'btn btn-quiet', type: 'button', onclick: undo }, 'Undo the last action', kbd('U'))));
    return;
  }

  const earned = stars(state);
  const capped = notBestUsed(state);
  view.primary = lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: again }, 'Play again')
    : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next level', kbd('N'));

  const parts = [
    el('h2', {}, 'Synced and Healthy'),
    el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', {}, `${state.used} of ${level.maxActions} actions used. Three stars take ${level.solution.length}`
      + `${(level.notBest || []).length ? ', with the lasting fix' : ''}.`),
    capped.map((idea) => el('p', { class: 'oos-note' },
      el('strong', {}, 'Two stars at most: '), `"${idea.label}" works this time, but it is not the fix to keep. See why below.`)),
    el('p', { class: 'oos-lesson' }, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'Why not just…'),
    el('ul', { class: 'oos-why-list' },
      level.tempting.map((idea) => el('li', {}, el('strong', {}, `${idea.label}? `), idea.why)),
      (level.notBest || []).map((idea) => el('li', {},
        el('strong', {}, `${idea.label}? `), 'It wins this time, for two stars at most. ', idea.why))),
    el('h3', {}, 'In real life'),
    level.inRealLife.map((snippet) => el('div', { class: 'oos-snippet' },
      el('p', { class: 'oos-snippet-label' }, snippet.label),
      el('pre', {}, el('code', {}, snippet.code)))),
    el('h3', {}, 'Official docs'),
    el('ul', { class: 'oos-docs' }, level.docs.map((url) => el('li', {},
      el('a', { href: url, target: '_blank', rel: 'noopener' }, url.replace('https://', ''))))),
    lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, view.primary,
      lastLevel ? null : el('button', { class: 'btn btn-quiet', type: 'button', onclick: again }, 'Play again')),
    DEV ? el('pre', { class: 'dev' }, `solution: [${recorded.map((input) => `'${input}'`).join(', ')}],`) : null,
  ];
  // replaceChildren() would show a null as the text "null", so drop the parts not in use.
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
