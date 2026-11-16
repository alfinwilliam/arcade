// RULES for Canary. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.
//
// The picture: users call the service sample-app. Its pods are split into two subsets,
// v1 (the version in production) and v2 (the new one). Before each round the player sets
// the routing; then a fixed batch of requests flows and each version reports its numbers.
//
// Inputs (text, so a solution is a readable list):
//   'weight 10'        v2's share of the default route, 0 to 100 in steps of 5 (v1 gets the rest)
//   'header first'     the testers' route (x-canary: true -> v2): 'off', 'first' or 'last'
//   'mirror 100'       percent of the default route's requests copied to v2 (0 = off)
//   'timeout 500'      ms one try may take before the proxy gives up with a 504 (0 = none)
//   'retries 2'        retries.attempts: how many times a failed try is tried again
//   'outlier 5'        consecutive5xxErrors before a pod is ejected (0 = off)
//   'run'              run one round with the routing as it is
//   'rollback bug'     send everything back to v1 and name the cause (an id from causes)
//
// How one round is worked out, per version (see serve() below):
//   1. Requests are spread evenly over the version's pods that are not ejected.
//   2. Capacity: each pod serves podCapacity tries a round at normal speed. If the tries
//      (first tries + retries + mirrored copies) exceed the capacity, the tries above it are
//      turned away with a 503, and the rest are slowed: latency x tries / capacity.
//      This overload rule is the game's own simplification; Istio and Envoy do not do this.
//   3. Of the tries served: badPod fails every try (500); errorPct fail with 500 on every pod;
//      slowPct of the rest take slowMs instead of ms.
//   4. A try slower than the timeout fails with a 504 at the timeout.
//   5. A failed try is tried again, up to `retries` more times, on another pod if it failed
//      on the bad pod. Retries add tries, which can push the version past its capacity,
//      so the round is recalculated until the number of tries settles.
//   6. Outlier detection: the bad pod is ejected once it has failed `outlier` tries in a row.
// Every share is rounded down, so the same routing always gives the same numbers.

import { causes } from './levels.js';

export const TOOLS = ['weight', 'header', 'mirror', 'timeout', 'retries', 'outlier'];
export const HEADER_CHOICES = ['off', 'first', 'last'];

// The values each control offers unless a level gives its own list in `choices`.
export const DEFAULT_CHOICES = {
  mirror: [0, 10, 100],
  timeout: [0, 250, 500, 1000, 2000],
  retries: [0, 1, 2, 3],
  outlier: [0, 3, 5, 10],
};

const MAX_EJECTION_PERCENT = 50;   // written into the DestinationRule; at least one pod may go

export function choicesFor(level, tool) {
  return (level.choices && level.choices[tool]) || DEFAULT_CHOICES[tool];
}

export function startRouting(level) {
  return { weight: 0, header: 'off', mirror: 0, timeout: 0, retries: 0, outlier: 0, ...(level.start || {}) };
}

// The state at the start of a level.
export function start(level) {
  return {
    level,
    routing: startRouting(level),
    rounds: [],                       // one entry per round run: { routing, v1, v2, failed }
    spent: 0,                         // failed user requests so far (the error budget)
    ejected: { v1: [], v2: [] },      // pod numbers taken out by outlier detection
    streak: { v1: 0, v2: 0 },         // the bad pod's failures in a row, while outlier detection is on
    evidence: false,                  // has v2 shown a problem yet (a failed try, or p99 over the limit)?
    lastWeight: 0,                    // v2's weight in the last round run (for maxStep)
    status: 'playing',
    reason: '',                       // 'promoted', 'rolled back', 'budget', 'rounds' or 'cause'
    verdict: null,                    // the cause the player named, if they rolled back
  };
}

// ------------------------------------------------------------------ inputs

function fail(level, input, why) {
  throw new Error(`level ${level.id}: "${input}" ${why}`);
}

// The one way state changes. The page calls this for every input and replay() calls it for
// every recorded input, so both follow exactly the same rules. It never edits the old state.
export function apply(state, input) {
  if (state.status !== 'playing') return state;
  const level = state.level;
  const [verb, arg] = String(input).split(' ');

  if (verb === 'run') return runRound(state);
  if (verb === 'rollback') return rollBack(state, input, arg);

  if (!TOOLS.includes(verb)) fail(level, input, 'is not an input this game knows');
  if (verb !== 'weight' && !level.tools.includes(verb)) fail(level, input, `uses ${verb}, which this level does not offer`);

  let value;
  if (verb === 'header') {
    if (!HEADER_CHOICES.includes(arg)) fail(level, input, 'must be header off, first or last');
    value = arg;
  } else {
    value = Number(arg);
    if (!Number.isInteger(value)) fail(level, input, 'needs a whole number');
    if (verb === 'weight') {
      if (value < 0 || value > 100 || value % 5 !== 0) fail(level, input, 'must be 0 to 100 in steps of 5');
      if (level.maxStep && value > state.lastWeight + level.maxStep) {
        fail(level, input, `raises v2 by more than ${level.maxStep} since the last round (it was ${state.lastWeight})`);
      }
    } else if (!choicesFor(level, verb).includes(value)) {
      fail(level, input, `is not one of the choices: ${choicesFor(level, verb).join(', ')}`);
    }
  }
  const routing = { ...state.routing, [verb]: value };
  // Outlier detection only counts failures while it is switched on.
  const streak = verb === 'outlier' ? { v1: 0, v2: 0 } : state.streak;
  return { ...state, routing, streak };
}

function rollBack(state, input, cause) {
  const level = state.level;
  if (level.rollback === false) fail(level, input, 'is not allowed: this level must ship v2');
  if (!causes.some((c) => c.id === cause)) fail(level, input, `names no known cause (${causes.map((c) => c.id).join(', ')})`);
  if (!state.evidence) fail(level, input, 'comes before v2 has shown any problem: there is no evidence yet');
  const right = level.fault === cause;
  return {
    ...state,
    routing: { ...state.routing, weight: 0, header: 'off', mirror: 0 },
    verdict: cause,
    status: right ? 'won' : 'lost',
    reason: right ? 'rolled back' : 'cause',
  };
}

// --------------------------------------------------------------- one round

// Who goes where. Testers send the header x-canary: true. With the testers' route first they
// all reach v2; with it off, or last (below the catch-all route, so it never matches), they
// follow the weights like everyone else. Mirroring copies the default route's requests.
export function split(level, routing) {
  const users = level.users;
  const testers = level.testers || 0;
  const direct = routing.header === 'first' ? testers : 0;
  const viaWeights = testers - direct;
  const u2 = Math.floor(users * routing.weight / 100);
  const t2 = Math.floor(viaWeights * routing.weight / 100);
  return {
    v1: { users: users - u2, testers: viaWeights - t2, mirrored: 0 },
    v2: { users: u2, testers: t2 + direct, mirrored: Math.floor((users + viaWeights) * routing.mirror / 100) },
  };
}

function runRound(state) {
  const level = state.level;
  const routing = state.routing;
  const flows = split(level, routing);
  const policy = { timeout: routing.timeout, retries: routing.retries, outlier: routing.outlier };
  const v1 = serve(level.v1, flows.v1, policy, state.ejected.v1, state.streak.v1);
  const v2 = serve(level.v2, flows.v2, policy, state.ejected.v2, state.streak.v2);
  const failed = v1.failed.users + v2.failed.users;
  const spent = state.spent + failed;
  const rounds = [...state.rounds, { routing, v1, v2, failed }];

  let status = 'playing';
  let reason = '';
  if (spent > level.budget) {
    status = 'lost';
    reason = 'budget';
  } else if (routing.weight === 100 && healthy(level, v2)) {
    status = 'won';
    reason = 'promoted';
  } else if (rounds.length >= level.rounds) {
    status = 'lost';
    reason = 'rounds';
  }

  return {
    ...state,
    rounds,
    spent,
    ejected: { v1: v1.ejected, v2: v2.ejected },
    streak: { v1: v1.streak, v2: v2.streak },
    evidence: state.evidence || troubled(level, v2),
    lastWeight: routing.weight,
    status,
    reason,
  };
}

// v2 is healthy in a round when it served users, none of them saw an error, none of its
// pods answered with a 5xx, and its p99 is within the level's limit.
export function healthy(level, stats) {
  return stats.users > 0 && stats.failed.users === 0 && stats.pod5xx === 0 &&
    stats.p99 !== null && stats.p99 <= level.p99Limit;
}

// Did this version show a problem this round: any failed try, or a p99 over the limit?
export function troubled(level, stats) {
  return stats.codes[500] + stats.codes[503] + stats.codes[504] > 0 || (stats.p99 !== null && stats.p99 > level.p99Limit);
}

// One version's round. `flow` is the first tries: { users, testers, mirrored }.
// Retries add tries, and tries slow the version down past its capacity, which can cause more
// failures and so more retries. So the round is worked out again with the new number of tries
// until that number stops growing (it can only grow, and it has a ceiling, so this ends).
export function serve(spec, flow, policy, ejectedBefore, streakBefore) {
  const active = [];
  for (let pod = 1; pod <= spec.pods; pod++) if (!ejectedBefore.includes(pod)) active.push(pod);
  const capacity = active.length * spec.podCapacity;
  let load = flow.users + flow.testers + flow.mirrored;
  let result = tries(spec, flow, policy, active, capacity, load, streakBefore);
  for (let i = 0; i < 10000 && result.attempts > load; i++) {
    load = result.attempts;
    result = tries(spec, flow, policy, active, capacity, load, streakBefore);
  }

  // Outlier detection: the bad pod goes once its failures in a row reach the setting.
  const ejected = [...ejectedBefore];
  let streak = 0;
  if (policy.outlier > 0 && result.bad) {
    streak = streakBefore + result.badServed;
    const room = Math.max(1, Math.floor(spec.pods * MAX_EJECTION_PERCENT / 100));
    if (streak >= policy.outlier && ejected.length < room) {
      ejected.push(result.bad);
      streak = 0;
    }
  }

  return {
    users: flow.users,
    testers: flow.testers,
    mirrored: flow.mirrored,
    attempts: result.attempts,
    capacity,
    failed: result.failed,
    codes: result.codes,
    pod5xx: result.codes[500] + result.codes[503],
    podErrors: podErrors(spec, active, result),
    p99: percentile99(result.outcomes),
    ejected,
    newlyEjected: ejected.filter((pod) => !ejectedBefore.includes(pod)),
    streak,
  };
}

// Every try of one round, given the total number of tries `load` (which sets the slow-down).
function tries(spec, flow, policy, active, capacity, load, streak) {
  const over = Math.max(0, load - capacity);
  const slowed = (ms) => (load > capacity ? Math.floor(ms * load / capacity) : ms);
  const fastMs = slowed(spec.ms);
  const slowMs = slowed(spec.slowMs || spec.ms);
  const T = policy.timeout;
  const late = (ms) => T > 0 && ms > T;

  const bad = spec.badPod && active.includes(spec.badPod) ? spec.badPod : 0;
  const goodPods = active.length - (bad ? 1 : 0);
  // With outlier detection on, the bad pod takes only the failures left before it is ejected.
  let badRoom = bad && policy.outlier > 0 ? Math.max(0, policy.outlier - streak) : Infinity;
  if (goodPods === 0) badRoom = Infinity;

  const codes = { 500: 0, 503: 0, 504: 0 };
  const failed = { users: 0, testers: 0, mirrored: 0 };
  const outcomes = [];                 // { count, ms } for every request's final answer
  let attempts = 0;
  let badServed = 0;
  let badAnswered5xx = 0;              // 5xx answered by the pods themselves (not proxy timeouts)
  let goodAnswered5xx = 0;

  for (const kind of ['users', 'testers', 'mirrored']) {
    const errorPct = kind === 'testers' && spec.testerErrorPct !== undefined ? spec.testerErrorPct : (spec.errorPct || 0);
    const maxTries = kind === 'mirrored' ? 1 : policy.retries + 1;   // mirrored copies are never retried
    let groups = [{ count: flow[kind], elapsed: 0, avoidBad: false }];

    for (let attempt = 1; attempt <= maxTries && groups.length > 0; attempt++) {
      const retry = new Map();         // failures to try again, merged by elapsed time and pod
      const last = attempt === maxTries;
      const settle = (count, ms, ok, avoidBad) => {
        if (count === 0) return;
        if (ok || last) {
          outcomes.push({ count, ms });
          if (!ok) failed[kind] += count;
          return;
        }
        const key = `${ms}:${avoidBad}`;
        const g = retry.get(key) || { count: 0, elapsed: ms, avoidBad };
        g.count += count;
        retry.set(key, g);
      };

      for (const g of groups) {
        attempts += g.count;
        // The bad pod's even share, unless this try is a retry of a failure on that pod.
        let toBad = bad && !g.avoidBad ? Math.floor(g.count / active.length) : 0;
        if (bad && !g.avoidBad && goodPods === 0) toBad = g.count;
        toBad = Math.min(toBad, badRoom - badServed);
        const toGood = g.count - toBad;

        // Past capacity: the share above it is turned away at once with a 503.
        const shedBad = over ? Math.floor(toBad * over / load) : 0;
        const shedGood = over ? Math.floor(toGood * over / load) : 0;
        const servedBad = toBad - shedBad;
        const servedGood = toGood - shedGood;
        badServed += servedBad;
        codes[503] += shedBad + shedGood;
        badAnswered5xx += shedBad + (late(fastMs) ? 0 : servedBad);
        goodAnswered5xx += shedGood;
        settle(shedBad, g.elapsed + spec.ms, false, true);
        settle(shedGood, g.elapsed + spec.ms, false, false);

        // A 500 that would arrive after the timeout is a 504 at the timeout instead.
        const errors = (count, avoidBad) => {
          if (late(fastMs)) { codes[504] += count; settle(count, g.elapsed + T, false, avoidBad); }
          else { codes[500] += count; settle(count, g.elapsed + fastMs, false, avoidBad); }
        };
        errors(servedBad, true);
        const e500 = Math.floor(servedGood * errorPct / 100);
        if (!late(fastMs)) goodAnswered5xx += e500;
        errors(e500, false);

        const rest = servedGood - e500;
        const slow = Math.floor(rest * (spec.slowPct || 0) / 100);
        for (const [count, ms] of [[rest - slow, fastMs], [slow, slowMs]]) {
          if (late(ms)) { codes[504] += count; settle(count, g.elapsed + T, false, false); }
          else settle(count, g.elapsed + ms, true, false);
        }
      }
      groups = [...retry.values()];
    }
  }
  return { attempts, failed, codes, outcomes, bad, badServed, badAnswered5xx, goodAnswered5xx };
}

// 5xx answered by each pod, for the round log: the bad pod's own, and the rest spread evenly.
function podErrors(spec, active, result) {
  const list = [];
  const good = active.filter((pod) => pod !== result.bad);
  const each = good.length ? Math.floor(result.goodAnswered5xx / good.length) : 0;
  let extra = good.length ? result.goodAnswered5xx - each * good.length : 0;
  for (let pod = 1; pod <= spec.pods; pod++) {
    if (!active.includes(pod)) list.push({ pod, errors: null });             // ejected
    else if (pod === result.bad) list.push({ pod, errors: result.badAnswered5xx });
    else {
      list.push({ pod, errors: each + (extra > 0 ? 1 : 0) });
      extra -= 1;
    }
  }
  return list;
}

// The time within which 99 of every 100 requests had their final answer (ms), or null.
function percentile99(outcomes) {
  const total = outcomes.reduce((sum, o) => sum + o.count, 0);
  if (total === 0) return null;
  const need = Math.ceil(total * 99 / 100);
  let seen = 0;
  for (const o of [...outcomes].sort((a, b) => a.ms - b.ms)) {
    seen += o.count;
    if (seen >= need) return o.ms;
  }
  return null;
}

// -------------------------------------------------------------- whole games

// Play a whole list of inputs from the start. Returns the final state.
export function replay(level, solution) {
  let state = start(level);
  for (const input of solution) state = apply(state, input);
  return state;
}

// One star for a win, one more for using no more rounds than the level's solution,
// one more for spending no more of the error budget than it does.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const par = replay(state.level, state.level.solution);
  return 1 + (state.rounds.length <= par.rounds.length ? 1 : 0) + (state.spent <= par.spent ? 1 : 0);
}

// ----------------------------------------------------------------- the YAML

function duration(ms) {
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`;
}

// The route's timeout and retry lines, indented for a route under http.
function policyLines(level, routing) {
  const lines = [];
  const retriesOffered = level.tools.includes('retries');
  if (routing.retries > 0) {
    lines.push('      retries:', `        attempts: ${routing.retries}`);
    if (routing.timeout > 0) lines.push(`        perTryTimeout: ${duration(routing.timeout)}`);
    lines.push('        retryOn: 5xx');
  } else {
    if (routing.timeout > 0) lines.push(`      timeout: ${duration(routing.timeout)}`);
    if (retriesOffered) lines.push('      retries:', '        attempts: 0      # no retries at all');
  }
  return lines;
}

function destination(subset, weight) {
  const lines = [`        - destination: { host: sample-app, subset: ${subset} }`];
  if (weight !== undefined) lines.push(`          weight: ${weight}`);
  return lines;
}

// The VirtualService for a routing, as the player has set it.
export function virtualServiceYaml(level, routing) {
  const testersRoute = [
    '    - match:',
    '        - headers:',
    '            x-canary:',
    '              exact: "true"',
    '      route:',
    ...destination('v2'),
    ...policyLines(level, routing),
  ];
  const defaultRoute = [
    '    - route:',
    ...destination('v1', 100 - routing.weight),
    ...destination('v2', routing.weight),
  ];
  if (routing.mirror > 0) {
    defaultRoute.push('      mirror: { host: sample-app, subset: v2 }',
      '      mirrorPercentage:', `        value: ${routing.mirror}.0`);
  }
  defaultRoute.push(...policyLines(level, routing));
  return [
    'apiVersion: networking.istio.io/v1',
    'kind: VirtualService',
    'metadata:',
    '  name: sample-app',
    '  namespace: sample',
    'spec:',
    '  hosts:',
    '    - sample-app',
    '  http:',
    ...(routing.header === 'first' ? testersRoute : []),
    ...defaultRoute,
    ...(routing.header === 'last' ? testersRoute : []),
  ].join('\n');
}

// The DestinationRule: the two subsets, and outlier detection when it is on.
export function destinationRuleYaml(level, routing) {
  const lines = [
    'apiVersion: networking.istio.io/v1',
    'kind: DestinationRule',
    'metadata:',
    '  name: sample-app',
    '  namespace: sample',
    'spec:',
    '  host: sample-app',
  ];
  if (routing.outlier > 0) {
    lines.push('  trafficPolicy:', '    outlierDetection:',
      `      consecutive5xxErrors: ${routing.outlier}`,
      '      interval: 10s',
      '      baseEjectionTime: 30s',
      `      maxEjectionPercent: ${MAX_EJECTION_PERCENT}`);
  }
  lines.push('  subsets:',
    '    - name: v1', '      labels: { version: v1 }',
    '    - name: v2', '      labels: { version: v2 }');
  return lines.join('\n');
}
