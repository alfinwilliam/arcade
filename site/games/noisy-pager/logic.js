// RULES for Noisy Pager. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.
//
// How a level plays:
//   1. generate() turns the level's data into one simulated day of scrapes, one sample per
//      minute (00:00 to 23:59), plus some time before midnight so that a 1h range is full at 00:00.
//      The "noise" comes from a small seeded generator, so the day is the same on every run.
//   2. The player builds a rule: what to measure, the range ([5m] ...), the threshold and `for:`.
//   3. 'run' evaluates the rule once a minute, the way Prometheus evaluates an alerting rule:
//      while the condition is true the alert is pending; once it has been true for the `for:`
//      duration it fires (that is a page); when the condition is false it stops (the game
//      has no keep_firing_for). Simplified: scrapes and rule checks happen together on each
//      minute, and a firing alert counts as a page (in real life Alertmanager sends it).
//   4. Each page that starts inside an incident counts for that incident. A page that starts
//      anywhere else is a false page. A second page inside the same incident (the alert
//      stopped and fired again: flapping) is a repeat page. The level is won when every
//      incident was paged within its deadline, with no false page and no repeat page.

export const DAY = 1440;                                   // minutes in the simulated day
export const BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, Infinity];   // histogram `le` bounds
const JOB = 'job="sample-app"';
const RANGED = ['rate', 'avg', 'p99', 'ratio', 'burn'];   // measures that read a range of samples
const FIXED = ['up', 'absent'];                            // measures with no threshold to set

// ------------------------------------------------------------------ helpers

// '03:20' -> 200
export function toMinutes(text) {
  const [hours, mins] = String(text).split(':').map(Number);
  return hours * 60 + mins;
}

// 200 -> '03:20'
export function clock(minute) {
  const m = ((minute % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// 5 -> '5m', 60 -> '1h': how Prometheus durations are written.
export function duration(minutes) {
  return minutes > 0 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

// 0.30000000000000004 -> '0.3'
export function num(x) {
  return String(Number(x.toFixed(6)));
}

export function usesRange(measure) {
  return RANGED.includes(measure);
}

export function hasThreshold(measure) {
  return !FIXED.includes(measure);
}

// The comparison a measure uses: set in the level, '>' if the level does not say.
export function opOf(level, measure) {
  if (measure === 'up') return '==';
  return level.measures[measure].op || '>';
}

// The threshold a measure starts at when the player picks it.
export function startThreshold(level, measure) {
  if (!hasThreshold(measure)) return null;
  const spec = level.measures[measure];
  return spec.start;
}

// Every threshold the player may pick for a measure, smallest first.
export function thresholdsFor(level, measure) {
  if (!hasThreshold(measure)) return [];
  const spec = level.measures[measure];
  if (spec.choices) return spec.choices.slice();
  const list = [];
  const count = Math.round((spec.max - spec.min) / spec.step);
  for (let i = 0; i <= count; i++) list.push(Number((spec.min + i * spec.step).toFixed(6)));
  return list;
}

// A seeded generator of whole numbers (mulberry32). Same seed, same numbers, every engine.
function generator(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// A whole number from -size to +size.
function wobble(next, size) {
  if (!size) return 0;
  return (next() % (2 * size + 1)) - size;
}

// The daily shape: straight lines between [hour, value] points, rounded to a whole number.
function shapeAt(points, minute) {
  const t = ((minute % DAY) + DAY) % DAY;
  for (let i = 1; i < points.length; i++) {
    const [h0, v0] = points[i - 1];
    const [h1, v1] = points[i];
    if (t <= h1 * 60) return Math.round(v0 + ((v1 - v0) * (t - h0 * 60)) / ((h1 - h0) * 60));
  }
  return points[points.length - 1][1];
}

function within(item, minute) {
  const k = minute - toMinutes(item.start);
  return k >= 0 && k < item.minutes ? k : -1;
}

// What incidents and spikes add at this minute. An incident ramps up over `ramp` minutes.
function extraAt(level, minute) {
  let total = 0;
  for (const incident of level.incidents) {
    const k = within(incident, minute);
    if (k >= 0) {
      const ramp = incident.ramp || 1;
      total += Math.round((incident.add * Math.min(k + 1, ramp)) / ramp);
    }
  }
  for (const spike of level.spikes || []) {
    if (within(spike, minute) >= 0) total += spike.add;
  }
  return total;
}

function gapAt(level, minute) {
  return (level.gaps || []).find((gap) => within(gap, minute) >= 0) || null;
}

// ---------------------------------------------------------- the simulated day

// Minutes simulated before 00:00, so that the longest range is already full at midnight.
function warmUp(level) {
  return Math.max(60, ...(level.ranges || []), ...(level.shorts || []));
}

// Every scrape of the day. Index i is minute (i - pre); minute 0 is 00:00.
// Counters are cumulative, as Prometheus scrapes them. All values are whole numbers.
//   has[i]   false while the target cannot be scraped (a gap): no sample at all
//   up[i]    1 when the scrape worked, 0 when it failed (Prometheus records `up` either way)
export function generate(level) {
  const pre = warmUp(level);
  const next = generator(level.seed);
  const day = { pre, has: [], up: [] };
  const kind = level.kind;
  if (kind === 'gauge') day.value = [];
  if (kind === 'counter') day.counter = [];
  if (kind === 'latency') { day.count = []; day.sum = []; day.buckets = BUCKETS_MS.map(() => []); }
  if (kind === 'errors') { day.requests = []; day.errors = []; }

  let total = level.counterStart || 0;       // counter kind
  let count = 0;                             // latency kind
  let sum = 0;
  const le = BUCKETS_MS.map(() => 0);
  let requests = 0;                          // errors kind
  let errors = 0;
  let restart = false;                       // the process restarted: counters begin again from 0
  const resets = (level.resets || []).map(toMinutes);

  for (let i = 0; i < pre + DAY; i++) {
    const minute = i - pre;
    const gap = gapAt(level, minute);
    const down = Boolean(gap && gap.restart);   // the app itself is down, not just the scrape
    day.has.push(!gap);
    day.up.push(gap ? 0 : 1);
    const base = shapeAt(level.shape, minute) + wobble(next, level.noise);
    const extra = extraAt(level, minute);
    if (down) restart = true;
    const fresh = !down && (restart || resets.includes(minute));
    if (fresh) restart = false;

    if (kind === 'gauge') {
      day.value.push(Math.max(0, base + extra));
    } else if (kind === 'counter') {
      const add = down ? 0 : Math.max(0, base + extra);
      total = fresh ? add : total + add;
      day.counter.push(total);
    } else if (kind === 'latency') {
      const n = down ? 0 : Math.max(0, base);
      const tailShare = Math.max(0, level.tail.permille + wobble(next, level.tail.noise));
      const slow = Math.round((n * extra) / 1000);
      const tail = Math.round((n * tailShare) / 1000);
      const typical = Math.max(0, n - slow - tail);
      const typicalMs = shapeAt(level.typical, minute);
      count += typical + tail + slow;
      sum += typical * typicalMs + tail * level.tail.ms + slow * level.slowMs;
      BUCKETS_MS.forEach((bound, b) => {
        le[b] += (typicalMs <= bound ? typical : 0) + (level.tail.ms <= bound ? tail : 0) + (level.slowMs <= bound ? slow : 0);
        day.buckets[b].push(le[b]);
      });
      day.count.push(count);
      day.sum.push(sum);
    } else if (kind === 'errors') {
      const n = down ? 0 : Math.max(0, base);
      const share = level.errors.permille + extra;
      const failed = Math.min(n, Math.max(0, Math.round((n * share) / 1000) + wobble(next, level.errors.noise)));
      requests = fresh ? n : requests + n;
      errors = fresh ? failed : errors + failed;
      day.requests.push(requests);
      day.errors.push(errors);
    } else {
      throw new Error(`level ${level.id}: unknown kind "${kind}"`);
    }
  }
  return day;
}

const days = new WeakMap();            // generate() once per level: the same input gives the same day
function dayOf(level) {
  if (!days.has(level)) days.set(level, generate(level));
  return days.get(level);
}

// ------------------------------------------------------------- PromQL, simplified

// rate() as Prometheus computes it (extrapolatedRate in promql/functions.go), for the range
// (i - span, i] in minutes (left-open, as in Prometheus 3): the increase between the first and
// last sample (a drop counts as a counter reset), extrapolated towards the ends of the range,
// divided by the range in seconds. Fewer than two samples: no result. Staleness markers are
// skipped inside a range, so missing minutes are simply left out.
function rateAt(values, has, i, span) {
  let first = -1;
  let last = -1;
  let samples = 0;
  let increase = 0;
  let previous = 0;
  for (let j = i - span + 1; j <= i; j++) {
    if (j < 0 || !has[j]) continue;
    if (first < 0) first = j;
    else increase += values[j] >= previous ? values[j] - previous : values[j];
    previous = values[j];
    last = j;
    samples++;
  }
  if (samples < 2) return null;
  const sampled = (last - first) * 60;
  const average = sampled / (samples - 1);
  let toStart = (first - (i - span)) * 60;
  let toEnd = (i - last) * 60;
  if (toStart >= average * 1.1) toStart = average / 2;
  if (increase > 0 && values[first] >= 0) {            // a counter never goes below zero
    const toZero = sampled * (values[first] / increase);
    if (toZero < toStart) toStart = toZero;
  }
  if (toEnd >= average * 1.1) toEnd = average / 2;
  return (increase * ((sampled + toStart + toEnd) / sampled)) / (span * 60);
}

// histogram_quantile() as Prometheus computes it from cumulative `le` bucket rates:
// find the bucket holding the q-th observation and interpolate linearly inside it. In the
// +Inf bucket it returns the second-highest bound; the lowest bucket starts at 0.
function quantile(q, rates) {
  const total = rates[rates.length - 1];
  if (!(total > 0)) return NaN;
  const rank = q * total;
  let b = 0;
  while (b < rates.length - 1 && rates[b] < rank) b++;
  if (b === rates.length - 1) return BUCKETS_MS[BUCKETS_MS.length - 2];
  const lower = b > 0 ? BUCKETS_MS[b - 1] : 0;
  const below = b > 0 ? rates[b - 1] : 0;
  return lower + (BUCKETS_MS[b] - lower) * ((rank - below) / (rates[b] - below));
}

function divide(a, b) {
  return a === null || b === null ? null : a / b;   // 0/0 is NaN, as in PromQL
}

// The value of one measure at every minute of the day: a number, NaN, or null for "no result".
// Units: latency in ms, ratio in percent, burn as a multiple of the error budget.
function valuesOf(level, measure, span) {
  const day = dayOf(level);
  const out = [];
  for (let t = 0; t < DAY; t++) {
    const i = t + day.pre;
    let v = null;
    if (measure === 'value') {
      if (day.has[i]) v = level.kind === 'gauge' ? day.value[i] : day.counter[i];
    } else if (measure === 'rate') {
      v = rateAt(level.kind === 'errors' ? day.errors : day.counter, day.has, i, span);
    } else if (measure === 'avg') {
      v = divide(rateAt(day.sum, day.has, i, span), rateAt(day.count, day.has, i, span));
    } else if (measure === 'p99') {
      const rates = day.buckets.map((bucket) => rateAt(bucket, day.has, i, span));
      v = rates[0] === null ? null : quantile(0.99, rates);
    } else if (measure === 'ratio' || measure === 'burn') {
      const ratio = divide(rateAt(day.errors, day.has, i, span), rateAt(day.requests, day.has, i, span));
      if (ratio !== null) v = measure === 'ratio' ? ratio * 100 : (ratio * 100) / (100 - level.slo);
    } else if (measure === 'up') {
      v = day.up[i];
    } else if (measure === 'absent') {
      v = day.has[i] ? null : 1;          // a failed scrape writes staleness markers, so the series is gone at once
    }
    out.push(v);
  }
  return out;
}

const cache = new WeakMap();
function cached(level, measure, span) {
  if (!cache.has(level)) cache.set(level, new Map());
  const store = cache.get(level);
  const key = `${measure}:${span}`;
  if (!store.has(key)) store.set(key, valuesOf(level, measure, span));
  return store.get(key);
}

// What the rule looks at: { values, short }. `short` is the burn rate over the short range
// when the rule has one, otherwise null.
export function series(level, rule) {
  const values = cached(level, rule.measure, usesRange(rule.measure) ? rule.range : 0);
  const short = rule.measure === 'burn' && rule.short ? cached(level, 'burn', rule.short) : null;
  return { values, short };
}

// Minutes with no sample at all (the target could not be scraped), for drawing.
export function gapMinutes(level) {
  const day = dayOf(level);
  const out = [];
  for (let t = 0; t < DAY; t++) if (!day.has[t + day.pre]) out.push(t);
  return out;
}

function compare(v, op, threshold) {
  if (v === null || !Number.isFinite(v)) return false;   // no data never crosses a threshold
  if (op === '>') return v > threshold;
  if (op === '<') return v < threshold;
  return v === threshold;
}

// Is the rule's condition true at minute t?
function holds(level, rule, values, short, t) {
  if (rule.measure === 'absent') return values[t] !== null;
  if (rule.measure === 'up') return values[t] === 0;
  const op = opOf(level, rule.measure);
  if (!compare(values[t], op, rule.threshold)) return false;
  return short ? compare(short[t], op, rule.threshold) : true;
}

// --------------------------------------------------------------- evaluation

// Evaluate the rule at every minute of the day and score the pages.
// Returns {
//   states      per minute: 0 inactive, 1 pending, 2 firing
//   pages       [{ at, since, end, kind }]  at = the minute it fired, since = when it went pending,
//               end = the minute the condition was false again (null if still firing at 24:00),
//               kind = 'ok', 'late', 'false' or 'repeat'
//   incidents   [{ start, end, deadline, pagedAt, delay, ok, repeats, firingSince }]
//               pagedAt and delay are null when no page started inside the incident;
//               repeats counts the pages after the first one inside the incident;
//               firingSince is set when an earlier page was still firing as the incident began
//   falsePages  the pages that started outside every incident
//   repeatPages the pages that started inside an incident that had already paged
//   won, delay  delay = the minutes from incident start to page, summed over paged incidents
// }
export function evaluate(level, rule) {
  const { values, short } = series(level, rule);
  const states = [];
  const pages = [];
  let since = null;
  let firing = null;
  for (let t = 0; t < DAY; t++) {
    if (holds(level, rule, values, short, t)) {
      if (since === null) since = t;
      if (!firing && t - since >= rule.for) {
        firing = { at: t, since, end: null };
        pages.push(firing);
      }
      states.push(firing ? 2 : 1);
    } else {
      since = null;
      if (firing) firing.end = t;
      firing = null;
      states.push(0);
    }
  }

  const incidents = level.incidents.map((incident) => {
    const begin = toMinutes(incident.start);
    return { start: begin, end: begin + incident.minutes, deadline: incident.deadline,
      pagedAt: null, delay: null, ok: false, repeats: 0, firingSince: null };
  });
  const falsePages = [];
  const repeatPages = [];
  for (const page of pages) {
    const hit = incidents.find((incident) => page.at >= incident.start && page.at < incident.end);
    if (!hit) {
      page.kind = 'false';
      falsePages.push(page);
    } else if (hit.pagedAt === null) {
      hit.pagedAt = page.at;
      hit.delay = page.at - hit.start;
      hit.ok = hit.delay <= hit.deadline;
      page.kind = hit.ok ? 'ok' : 'late';
    } else {
      hit.repeats += 1;              // the alert stopped and fired again: one more page, same incident
      page.kind = 'repeat';
      repeatPages.push(page);
    }
  }
  for (const incident of incidents) {
    if (incident.pagedAt !== null) continue;
    const before = pages.find((page) => page.at < incident.start && (page.end === null || page.end > incident.start));
    if (before) incident.firingSince = before.at;
  }
  const won = falsePages.length === 0 && repeatPages.length === 0 && incidents.every((incident) => incident.ok);
  const delay = incidents.reduce((sum, incident) => sum + (incident.delay || 0), 0);
  return { states, pages, incidents, falsePages, repeatPages, won, delay };
}

// ------------------------------------------------------------ state and input

// The state at the start of a level: the level's starting rule, not run yet.
export function start(level) {
  const begin = level.rule;
  const rule = {
    measure: begin.measure,
    range: begin.range || (level.ranges ? level.ranges[0] : 0),
    short: begin.short || 0,
    threshold: startThreshold(level, begin.measure),
    for: begin.for || 0,
  };
  return { level, rule, runs: 0, run: null, status: 'playing' };
}

function refuse(level, input, why) {
  throw new Error(`"${input}" is not allowed in level ${level.id}: ${why}`);
}

// The one way state changes. Inputs are text:
//   'measure rate'   'range 5'   'short 5'   'threshold 250'   'for 5'   'run'
// An edit clears the last run (its pages belong to the old rule). 'run' plays the day:
// status becomes 'won' or 'lost'. After a loss the player may edit and run again.
export function apply(state, input) {
  if (state.status === 'won') return state;
  const level = state.level;
  const [verb, word] = String(input).split(' ');
  const value = Number(word);
  const rule = { ...state.rule };

  if (verb === 'run') {
    const run = evaluate(level, rule);
    return { ...state, runs: state.runs + 1, run, status: run.won ? 'won' : 'lost' };
  }
  if (verb === 'measure') {
    if (!Object.prototype.hasOwnProperty.call(level.measures, word)) refuse(level, input, 'the level does not offer that measure');
    rule.measure = word;
    rule.threshold = startThreshold(level, word);
  } else if (verb === 'range') {
    if (!(level.ranges || []).includes(value)) refuse(level, input, `ranges are ${(level.ranges || []).join(', ')}`);
    rule.range = value;
  } else if (verb === 'short') {
    if (!(level.shorts || []).includes(value)) refuse(level, input, `short ranges are ${(level.shorts || []).join(', ')}`);
    rule.short = value;
  } else if (verb === 'threshold') {
    if (!thresholdsFor(level, rule.measure).includes(value)) refuse(level, input, `not a threshold for ${rule.measure}`);
    rule.threshold = value;
  } else if (verb === 'for') {
    if (!level.fors.includes(value)) refuse(level, input, `for: may be ${level.fors.join(', ')}`);
    rule.for = value;
  } else {
    refuse(level, input, 'unknown input');
  }
  return { ...state, rule, run: null, status: 'playing' };
}

// Play a whole list of inputs from the start. Returns the final state.
export function replay(level, inputs) {
  let state = start(level);
  for (const input of inputs) state = apply(state, input);
  return state;
}

// Three stars for paging no later in total than the level's solution does, two for
// within 5 more minutes per incident, one for any other win.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const reference = replay(state.level, state.level.solution).run.delay;
  if (state.run.delay <= reference) return 3;
  if (state.run.delay <= reference + 5 * state.level.incidents.length) return 2;
  return 1;
}

// ------------------------------------------------------------ the real rule

// The PromQL expression for a rule, as a list of lines.
export function promExpr(level, rule) {
  const m = level.metric;
  const sel = `{${JOB}}`;
  const range = `[${duration(rule.range)}]`;
  const op = opOf(level, rule.measure);
  const t = rule.threshold;
  switch (rule.measure) {
    case 'value':
      return [`${m}${sel} ${op} ${num(t)}`];
    case 'rate':
      return level.kind === 'errors'
        ? [`sum(rate(${m}{${JOB},code=~"5.."}${range})) ${op} ${num(t)}`]
        : [`rate(${m}${sel}${range}) ${op} ${num(t)}`];
    case 'avg':
      return [`sum(rate(${m}_sum${sel}${range}))`, `  / sum(rate(${m}_count${sel}${range})) ${op} ${num(t / 1000)}`];
    case 'p99':
      return ['histogram_quantile(0.99,', `  sum by (le) (rate(${m}_bucket${sel}${range}))`, `) ${op} ${num(t / 1000)}`];
    case 'ratio':
      return [`sum(rate(${m}{${JOB},code=~"5.."}${range}))`, `  / sum(rate(${m}${sel}${range})) ${op} ${num(t / 100)}`];
    case 'up':
      return [`up${sel} == 0`];
    case 'absent':
      return [`absent(${m}${sel})`];
    case 'burn': {
      const budget = num((100 - level.slo) / 100);
      const line = (span) => `job:slo_errors_per_request:ratio_rate${duration(span)}${sel} > (${num(t)} * ${budget})`;
      return rule.short ? [line(rule.range), 'and', line(rule.short)] : [line(rule.range)];
    }
    default:
      throw new Error(`unknown measure "${rule.measure}"`);
  }
}

// The rule as a Prometheus alerting-rule file.
export function ruleYaml(level, rule) {
  const expr = promExpr(level, rule);
  const lines = ['groups:', '  - name: sample-app', '    rules:', `      - alert: ${level.alert.name}`];
  if (expr.length === 1) lines.push(`        expr: ${expr[0]}`);
  else lines.push('        expr: |', ...expr.map((line) => `          ${line}`));
  if (rule.for > 0) lines.push(`        for: ${duration(rule.for)}`);
  lines.push('        labels:', '          severity: page', '        annotations:', `          summary: "${level.alert.summary}"`);
  return lines.join('\n');
}
