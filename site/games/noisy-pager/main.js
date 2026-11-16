// PAGE for Noisy Pager: drawing and input only.
// Every rule lives in logic.js. This file never decides what pages or who wins.
//
// How it is put together:
//   1. build() creates the fixed parts of the page once.
//   2. Every input (a control, a key) ends in press(), which calls logic.apply and records
//      the input. `recorded` is exactly what replay() takes.
//   3. update() copies the state onto the page and redraws the chart after every input.
//
// Add ?dev to the URL to see the recorded inputs on the win screen, ready to paste into
// levels.js as a level's `solution`.

import { mountShell, ready, el, token } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { fitCanvas, pointerPos } from '../../shared/canvas.js';
import { levels } from './levels.js';
import {
  start, apply, stars, series, gapMinutes, ruleYaml, promExpr, thresholdsFor, usesRange,
  hasThreshold, opOf, clock, duration, toMinutes, DAY,
} from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');
const SAVE_KEY = 'noisy-pager:stars';   // saved as { levelId: bestStars }
const HOW = 'Build an alert rule, run the day: page each shaded incident once, in time, nothing else.';
const KEYS = 'Point at the chart to read a value (or focus it and use ← →, with Shift for an hour). Keys: R run the day · [ and ] threshold down and up · N next level';

const main = mountShell({ title: 'Noisy Pager' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every input so far, in order: exactly what replay() takes
let cursor = null;        // the minute under the chart cursor, or null

// ------------------------------------------------------------ small helpers

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// What each measure is called in the measure list.
function measureName(level, measure) {
  const names = {
    value: level.kind === 'counter' ? 'Raw counter' : 'Raw value',
    rate: level.kind === 'errors' ? 'Errors per second' : 'rate() per second',
    avg: 'Average time',
    p99: '99th percentile',
    ratio: 'Error ratio',
    up: 'up == 0',
    absent: 'absent()',
    burn: 'Burn rate',
  };
  return names[measure];
}

// A value as the chart and the readout show it.
function show(level, measure, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'no data';
  const round = (x, places) => String(Number(x.toFixed(places)));
  switch (measure) {
    case 'value': return `${Math.round(v).toLocaleString('en-US')}${level.unit ? ` ${level.unit}` : ''}`;
    case 'rate': return `${round(v, 2)}/s`;
    case 'avg':
    case 'p99': return `${Math.round(v)} ms`;
    case 'ratio': return `${round(v, 2)}%`;
    case 'burn': return `${round(v, 1)}×`;
    default: return String(v);
  }
}

function shortNumber(v) {
  if (Math.abs(v) >= 1e6) return `${Number((v / 1e6).toFixed(2))}M`;
  if (Math.abs(v) >= 1e4) return `${Number((v / 1e3).toFixed(1))}k`;
  return String(Number(v.toFixed(2)));
}

function conditionText(level, rule) {
  if (rule.measure === 'up') return 'up == 0';
  if (rule.measure === 'absent') return 'absent()';
  return `${opOf(level, rule.measure)} ${show(level, rule.measure, rule.threshold)}`;
}

// ------------------------------------------------------------------- inputs

function press(input) {
  if (state.status === 'won') return;
  state = apply(state, input);
  // Several slider steps in a row are one change: keep only the last, so ?dev stays short.
  const verb = input.split(' ')[0];
  const last = recorded[recorded.length - 1];
  if (verb !== 'run' && last && last.split(' ')[0] === verb) recorded[recorded.length - 1] = input;
  else recorded.push(input);
  if (state.status === 'won') rememberWin();
  update();
  if (state.status === 'won') {
    view.result.scrollIntoView({ block: 'start' });
    view.primary.focus({ preventScroll: true });
  }
}

function run() {
  if (state.status !== 'won') press('run');
}

function nudgeThreshold(step) {
  if (!hasThreshold(state.rule.measure) || state.status === 'won') return;
  const list = thresholdsFor(state.level, state.rule.measure);
  const i = list.indexOf(state.rule.threshold) + step;
  if (i >= 0 && i < list.length) press(`threshold ${list[i]}`);
}

function openLevel(index, moveFocus) {
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  cursor = null;
  buildControls();
  update();
  if (moveFocus) view.measure.focus();
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state));
  save(SAVE_KEY, best);
}

function moveCursor(step) {
  cursor = Math.max(0, Math.min(DAY - 1, (cursor === null ? 720 : cursor) + step));
  drawChart();
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = event.target && event.target.tagName;
  if (tag === 'SELECT') return;                 // a select uses letters to jump between options
  const key = event.key.toLowerCase();
  const lastLevel = levelIndex === levels.length - 1;
  if (event.target === view.canvas && (key === 'arrowleft' || key === 'arrowright')) {
    event.preventDefault();
    moveCursor((key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 60 : 5));
  } else if (key === 'r') run();
  else if (key === '[') nudgeThreshold(-1);
  else if (key === ']') nudgeThreshold(1);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
}

function onPointer(event) {
  const { x } = pointerPos(event, view.canvas);
  const box = view.box;
  if (!box) return;
  const t = Math.round(((x - box.left) / (box.right - box.left)) * DAY);
  cursor = Math.max(0, Math.min(DAY - 1, t));
  drawChart();
}

// ------------------------------------------------------------------ building

function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.brief = el('p', { class: 'np-brief' });
  view.canvas = el('canvas', {
    class: 'stage np-chart', tabindex: '0', role: 'img',
    onpointermove: onPointer, onpointerdown: onPointer,
  });
  view.readout = el('p', { class: 'sr-only' });   // the cursor value, for screen readers
  view.incidents = el('p', { class: 'np-incidents muted' });
  view.legend = el('p', { class: 'np-legend muted' });

  view.measure = el('select', { class: 'np-select', 'aria-label': 'What to measure',
    onchange: () => press(`measure ${view.measure.value}`) });
  view.range = el('select', { class: 'np-select', 'aria-label': 'Range',
    onchange: () => press(`range ${view.range.value}`) });
  view.short = el('select', { class: 'np-select', 'aria-label': 'Short range',
    onchange: () => press(`short ${view.short.value}`) });
  view.forSelect = el('select', { class: 'np-select np-for', 'aria-label': 'How long the condition must hold (for:)',
    onchange: () => press(`for ${view.forSelect.value}`) });
  // A measure with a short list of `choices` gets a dropdown; one with min/max/step a slider.
  view.thresholdSelect = el('select', { class: 'np-select', 'aria-label': 'Threshold',
    onchange: () => press(`threshold ${view.thresholdSelect.value}`) });
  view.slider = el('input', { type: 'range', class: 'np-slider', min: '0', step: '1', 'aria-label': 'Threshold',
    oninput: () => press(`threshold ${thresholdsFor(state.level, state.rule.measure)[Number(view.slider.value)]}`) });
  view.down = el('button', { class: 'btn np-step', type: 'button', 'aria-label': 'Lower threshold', onclick: () => nudgeThreshold(-1) }, '−');
  view.up = el('button', { class: 'btn np-step', type: 'button', 'aria-label': 'Raise threshold', onclick: () => nudgeThreshold(1) }, '+');
  view.thresholdText = el('output', { class: 'np-threshold mono' });
  view.thresholdRow = el('div', { class: 'np-row np-threshold-row' }, view.down, view.slider, view.up, view.thresholdText);
  view.run = el('button', { class: 'btn btn-primary np-run', type: 'button', onclick: run }, 'Run the day', kbd('R'));
  view.status = el('p', { class: 'np-status', 'aria-live': 'polite' });
  view.expr = el('pre', { class: 'np-expr' });
  view.result = el('section', { class: 'panel result stack', hidden: true, tabindex: '-1' });

  main.append(
    el('p', { class: 'how' }, HOW),
    view.picker,
    // On a phone the Run button must show without scrolling, so the chart and the rule share
    // one panel and the deadlines sit under the Run button.
    el('section', { class: 'panel stack np-stage' },
      view.title, view.brief, view.canvas, view.readout,
      el('div', { class: 'stack np-rule', role: 'group', 'aria-label': 'Your alert rule' },
        el('div', { class: 'np-row' }, view.measure, view.range, view.short, view.thresholdSelect),
        view.thresholdRow,
        el('div', { class: 'np-row' }, view.forSelect, view.run)),
      view.status,
      view.incidents),
    view.legend,
    view.result,
    el('section', { class: 'panel stack np-explain' },
      el('p', { class: 'np-expr-label muted' }, 'What Prometheus evaluates every minute. Here scrapes and rule checks happen once a minute, in step, and a firing alert counts as a page (in real life Alertmanager sends it):'),
      view.expr),
    el('p', { class: 'muted np-keys' }, KEYS),
  );

  view.canvas.addEventListener('pointerleave', () => { cursor = null; drawChart(); });
  window.addEventListener('resize', drawChart);
  const scheme = window.matchMedia('(prefers-color-scheme: light)');
  if (scheme.addEventListener) scheme.addEventListener('change', drawChart);
}

function options(select, list, label) {
  select.replaceChildren(...list.map((value) => el('option', { value: String(value) }, label(value))));
}

// Runs when a level opens: the choices this level offers.
function buildControls() {
  const level = state.level;
  options(view.measure, Object.keys(level.measures), (m) => measureName(level, m));
  options(view.range, level.ranges || [], (m) => `range [${duration(m)}]`);
  options(view.short, level.shorts || [], (m) => (m ? `and short [${duration(m)}]` : 'no short range'));
  options(view.forSelect, level.fors, (m) => `for: ${duration(m)}`);
}

// ------------------------------------------------------------------ updating

function update() {
  const level = state.level;
  const rule = state.rule;
  const won = state.status === 'won';
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.brief.textContent = level.brief;

  view.measure.value = rule.measure;
  view.range.value = String(rule.range);
  view.short.value = String(rule.short);
  view.forSelect.value = String(rule.for);
  view.range.hidden = !usesRange(rule.measure);
  view.short.hidden = rule.measure !== 'burn';
  const choices = hasThreshold(rule.measure) && Boolean(level.measures[rule.measure].choices);
  view.thresholdRow.hidden = !hasThreshold(rule.measure) || choices;
  view.thresholdSelect.hidden = !choices;
  if (hasThreshold(rule.measure)) {
    const list = thresholdsFor(level, rule.measure);
    if (choices) {
      options(view.thresholdSelect, list, (v) => conditionText(level, { ...rule, threshold: v }));
      view.thresholdSelect.value = String(rule.threshold);
    }
    view.slider.max = String(list.length - 1);
    view.slider.value = String(list.indexOf(rule.threshold));
    view.thresholdText.textContent = conditionText(level, rule);
  }
  for (const control of [view.measure, view.range, view.short, view.thresholdSelect, view.forSelect, view.slider, view.down, view.up, view.run]) {
    control.disabled = won;
  }

  const expr = promExpr(level, rule);
  view.expr.textContent = expr.join('\n') + (rule.for > 0 ? `\nfor: ${duration(rule.for)}` : '');
  view.status.textContent = statusText();

  view.incidents.textContent = 'Deadlines: ' + level.incidents
    .map((incident, i) => `incident ${i + 1} (${incident.start}) within ${incident.deadline} min`).join(' · ') + '.';
  view.legend.textContent = legendText(rule);

  drawPicker();
  drawResult();
  drawChart();
}

function statusText() {
  if (!state.run) return state.runs ? 'Rule changed: run the day again.' : 'Not run yet.';
  const run = state.run;
  if (run.won) return 'Every incident paged in time, no false page.';
  const inTime = run.incidents.filter((i) => i.ok && !i.repeats).length;
  const repeats = run.repeatPages.length ? ` · ${plural(run.repeatPages.length, 'repeat page')}` : '';
  return `${inTime} of ${run.incidents.length} incidents paged once and in time · ${plural(run.falsePages.length, 'false page')}${repeats}. Details below.`;
}

function legendText(rule) {
  const parts = ['Chart key: ▨ incident', '- - - threshold', '▼ page', '▽ late page', '✕ false or repeat page', 'bottom strip: ▭ pending, ■ firing'];
  if (rule.measure === 'burn' && rule.short) parts.splice(2, 0, `solid line: [${duration(rule.range)}], dotted: [${duration(rule.short)}]`);
  if (gapMinutes(state.level).length) parts.push('grey stripe: no data');
  if (rule.measure === 'burn') parts.push('the line is cut off at the top of the chart');
  return parts.join(' · ');
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

// One line per incident and per false page.
function outcomeLines(run) {
  const lines = run.incidents.map((incident, i) => {
    const name = `Incident ${i + 1} (${clock(incident.start)}–${clock(incident.end)})`;
    if (incident.pagedAt === null) {
      const why = incident.firingSince !== null
        ? `: the alert was still firing from ${clock(incident.firingSince)}, so it never paged again` : '';
      return ['bad', `✕ ${name}: never paged${why}.`];
    }
    if (!incident.ok) return ['bad', `✕ ${name}: paged after ${incident.delay} min, deadline ${incident.deadline}. Too late.`];
    if (incident.repeats) {
      return ['bad', `✕ ${name}: paged after ${incident.delay} min, then ${plural(incident.repeats, 'more time')}: the alert stopped and fired again (flapping). One page per incident.`];
    }
    return ['good', `✓ ${name}: paged after ${incident.delay} min, deadline ${incident.deadline}.`];
  });
  // All the false pages on one line, so a noisy run does not push the hint off the screen.
  const falses = run.falsePages;
  if (falses.length === 1) lines.push(['bad', `✕ False page at ${clock(falses[0].at)}: no incident then.`]);
  if (falses.length > 1) {
    const times = falses.slice(0, 5).map((page) => clock(page.at)).join(', ');
    const more = falses.length > 5 ? ` and ${falses.length - 5} more` : '';
    lines.push(['bad', `✕ ${falses.length} false pages, with no incident then: ${times}${more}.`]);
  }
  return el('ul', { class: 'np-outcomes' }, ...lines.map(([kind, text]) => el('li', { class: `np-${kind}` }, text)));
}

function drawResult() {
  const run = state.run;
  view.result.hidden = !run;
  if (!run) return;
  const won = state.status === 'won';
  const level = state.level;
  const lastLevel = levelIndex === levels.length - 1;
  view.result.className = won ? 'panel result stack' : 'panel result lost stack';

  if (!won) {
    view.result.replaceChildren(
      el('h2', {}, 'Not yet'),
      outcomeLines(run),
      el('p', {}, el('strong', {}, 'Hint: '), level.hint),
      el('p', { class: 'muted' }, 'Change the rule and run the day again.'));
    return;
  }

  view.primary = lastLevel
    ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex, true) }, 'Play again')
    : el('button', { class: 'btn btn-primary', type: 'button', onclick: () => openLevel(levelIndex + 1, true) }, 'Next level', kbd('N'));
  const earned = stars(state);
  // The player's own rule replaces the first snippet, which is the solution's rule.
  const snippets = [{ label: level.inRealLife[0].label, code: ruleYaml(level, state.rule) }, ...level.inRealLife.slice(1)];
  const parts = [
    el('h2', {}, `Quiet pager after ${plural(state.runs, 'run')}`),
    el('p', { class: 'stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', { class: 'muted' }, earned < 3 ? 'Three stars: page as early in total as the reference rule does.' : 'As fast as the reference rule, or faster.'),
    outcomeLines(run),
    el('p', {}, el('strong', {}, 'What this shows: '), level.lesson),
    el('h3', {}, 'In real life'),
    ...snippets.map((snippet) => el('div', { class: 'np-snippet' },
      el('p', { class: 'np-snippet-label mono' }, snippet.label),
      el('pre', {}, el('code', {}, snippet.code)))),
    el('p', { class: 'np-docs' }, 'Read more: ',
      ...level.docs.flatMap((url, i) => [i ? ' · ' : '', el('a', { href: url, rel: 'noopener', target: '_blank' }, url.replace(/^https:\/\//, ''))])),
    lastLevel ? el('p', {}, 'That was the last level.') : null,
    el('div', { class: 'row' }, view.primary),
    DEV ? el('pre', { class: 'dev' }, 'solution: ' + JSON.stringify(recorded)) : null,
  ];
  // replaceChildren() would show a null as the text "null", so drop the parts not in use.
  view.result.replaceChildren(...parts.filter(Boolean));
}

// -------------------------------------------------------------------- chart

function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw) return m * power;
  return 10 * power;
}

function hatch(colour) {
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const g = tile.getContext('2d');
  g.strokeStyle = colour;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(8, 0);
  g.stroke();
  return tile;
}

function drawChart() {
  if (!state) return;
  const canvas = view.canvas;
  const level = state.level;
  const rule = state.rule;
  const width = Math.max(280, Math.round(canvas.parentElement.clientWidth - 32));
  const height = width < 520 ? 190 : 260;
  const ctx = fitCanvas(canvas, width, height);
  const c = {
    text: token('--text'), muted: token('--muted'), line: token('--line'), accent: token('--accent'),
    bad: token('--bad'), warn: token('--warn'), good: token('--good'), surface: token('--surface'),
  };
  const box = { left: 46, right: width - 10, top: 32, bottom: height - 40 };
  view.box = box;
  const { values, short } = series(level, rule);
  const run = state.run;

  // y scale: 0 to a round number above the data and the threshold.
  const fixed = !hasThreshold(rule.measure);
  let top = fixed ? 1 : rule.threshold;
  for (const list of [values, short]) {
    if (list) for (const v of list) if (v !== null && Number.isFinite(v) && v > top) top = v;
  }
  if (rule.measure === 'burn') top = Math.min(top, rule.threshold * 6);   // keep the threshold readable
  const step = fixed ? 1 : niceStep((top || 1) / 4);
  const yMax = fixed ? 1.25 : step * Math.max(1, Math.ceil((top * 1.05) / step));
  const x = (t) => box.left + (t / DAY) * (box.right - box.left);
  const y = (v) => box.bottom - (Math.min(v, yMax) / yMax) * (box.bottom - box.top);

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px ui-monospace, monospace';
  ctx.textBaseline = 'middle';

  // incidents: hatched bands with their number above
  level.incidents.forEach((incident, i) => {
    const a = x(toMinutes(incident.start));
    const b = Math.max(a + 3, x(toMinutes(incident.start) + incident.minutes));
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = c.bad;
    ctx.fillRect(a, box.top, b - a, box.bottom - box.top);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = ctx.createPattern(hatch(c.bad), 'repeat');
    ctx.fillRect(a, box.top, b - a, box.bottom - box.top);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.text;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), (a + b) / 2, box.top - 24);
  });

  // minutes with no data at all
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.muted;
  for (const t of gapMinutes(level)) ctx.fillRect(x(t), box.top, Math.max(2, x(t + 1) - x(t)), box.bottom - box.top);
  ctx.globalAlpha = 1;

  // grid and labels
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.fillStyle = c.muted;
  ctx.textAlign = 'right';
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    ctx.beginPath();
    ctx.moveTo(box.left, Math.round(y(v)) + 0.5);
    ctx.lineTo(box.right, Math.round(y(v)) + 0.5);
    ctx.stroke();
    ctx.fillText(shortNumber(v), box.left - 6, y(v));
  }
  ctx.textAlign = 'center';
  const hourStep = width < 520 ? 6 : 3;
  for (let h = 0; h <= 24; h += hourStep) {
    ctx.fillText(`${String(h).padStart(2, '0')}:00`, Math.min(box.right - 14, Math.max(box.left + 14, x(h * 60))), box.bottom + 12);
  }

  // the measure (and the short range for a burn rate)
  const trace = (list, dash, colour, widthPx) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = widthPx;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let drawing = false;
    for (let t = 0; t < DAY; t++) {
      const v = list[t];
      if (v === null || !Number.isFinite(v)) { drawing = false; continue; }
      if (drawing) ctx.lineTo(x(t), y(v));
      else ctx.moveTo(x(t), y(v));
      drawing = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, box.top - 2, box.right - box.left, box.bottom - box.top + 2);
  ctx.clip();
  if (rule.measure === 'absent') {
    ctx.fillStyle = c.accent;
    for (let t = 0; t < DAY; t++) if (values[t] !== null) ctx.fillRect(x(t), y(1), Math.max(2, x(t + 1) - x(t)), box.bottom - y(1));
  } else {
    trace(values, [], c.accent, 1.6);
    if (short) trace(short, [1, 3], c.text, 1.4);
  }
  ctx.restore();

  // threshold
  if (!fixed || rule.measure === 'up') {
    const level0 = rule.measure === 'up' ? 0.5 : rule.threshold;
    ctx.strokeStyle = c.warn;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(box.left, y(level0));
    ctx.lineTo(box.right, y(level0));
    ctx.stroke();
    ctx.setLineDash([]);
    const label = conditionText(level, rule);
    ctx.textAlign = 'right';
    const w = ctx.measureText(label).width + 8;
    const ly = Math.max(box.top + 7, y(level0) - 9);
    ctx.fillStyle = c.surface;
    ctx.fillRect(box.right - w, ly - 7, w, 14);
    ctx.fillStyle = c.text;
    ctx.fillText(label, box.right - 4, ly);
  }

  // after a run: the alert state strip and a marker for every page
  const strip = box.bottom + 24;
  if (run) {
    for (let t = 0; t < DAY; t++) {
      if (!run.states[t]) continue;
      const a = x(t);
      const w = Math.max(1, x(t + 1) - a);
      if (run.states[t] === 2) {
        ctx.fillStyle = c.bad;
        ctx.fillRect(a, strip, w, 9);
      } else {
        ctx.strokeStyle = c.warn;
        ctx.lineWidth = 1;
        ctx.strokeRect(a + 0.5, strip + 0.5, Math.max(1, w - 1), 8);
      }
    }
    for (const page of run.pages) {
      const px = x(page.at);
      const ok = page.kind === 'ok' ? true : page.kind === 'late' ? false : undefined;   // undefined: false or repeat page
      ctx.strokeStyle = ok === undefined ? c.bad : ok ? c.good : c.warn;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(px, box.top);
      ctx.lineTo(px, box.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (ok === undefined) {             // a false or repeat page: a cross
        ctx.moveTo(px - 4, box.top - 14); ctx.lineTo(px + 4, box.top - 6);
        ctx.moveTo(px + 4, box.top - 14); ctx.lineTo(px - 4, box.top - 6);
        ctx.stroke();
      } else {                            // a page for an incident: a triangle, hollow if late
        ctx.moveTo(px - 5, box.top - 14); ctx.lineTo(px + 5, box.top - 14); ctx.lineTo(px, box.top - 5);
        ctx.closePath();
        if (ok) ctx.fill(); else ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'left';
    ctx.fillText('Run the day to see where it pages', box.left, strip + 5);
  }

  // the cursor, and the readout under the chart
  if (cursor !== null) {
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x(cursor) + 0.5, box.top);
    ctx.lineTo(x(cursor) + 0.5, box.bottom);
    ctx.stroke();
    const shortText = short ? `, short ${show(level, 'burn', short[cursor])}` : '';
    const stateText = run ? ['', ' · pending', ' · firing'][run.states[cursor]] : '';
    const reading = `${clock(cursor)} · ${rule.measure === 'absent' ? (values[cursor] === null ? 'data present' : 'absent() = 1') : show(level, rule.measure, values[cursor])}${shortText}${stateText}`;
    view.readout.textContent = reading;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const w = ctx.measureText(reading).width + 10;
    const left = Math.min(Math.max(box.left + 2, x(cursor) - w / 2), box.right - w);
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = c.line;
    ctx.fillRect(left, box.top + 2, w, 18);
    ctx.strokeRect(left + 0.5, box.top + 2.5, w - 1, 17);
    ctx.fillStyle = c.text;
    ctx.fillText(reading, left + 5, box.top + 11);
  } else {
    view.readout.textContent = '';
  }
  canvas.setAttribute('aria-label', `Chart of ${measureName(level, rule.measure)} over one day, ${plural(level.incidents.length, 'incident')} shaded`
    + (run ? `, ${plural(run.pages.length, 'page')}` : ''));
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
