// RULES for Ship It. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.
//
// The model, in one paragraph:
//   A pipeline is a list of stages. Stages run one after another; the steps inside one stage
//   run side by side, each on its own clean machine, so a stage lasts as long as its slowest
//   step. If a step fails, the steps beside it finish, the run goes red and later stages never
//   start. Time is whole minutes. Runner-minutes are the minutes steps actually ran, added up
//   (waiting for a person or for a lock costs nothing, because no machine is held; in Jenkins
//   that needs `agent none` at the top and the waiting stage on its own agent).
//
// A "check" runs the pipeline for one push (or a few pushes, for the levels about two runs at
// once) and compares what happened with what the check expects. levels.js documents the fields.

// The options a step can have. levels.js lists which ones a level offers.
export const OPTIONS = ['publish', 'cache', 'main', 'approve', 'lock', 'tag'];

// Pushes inside one check are called A, B, C... in the order they are listed.
export const RUN_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

// Commits that change the lockfile (package-lock.json), so a cache keyed on it misses.
export const LOCKFILE_COMMITS = ['new-dep'];

// A step that cannot even begin (no build output, no image, someone else deploying) fails
// after this many minutes: the machine still has to start and look.
export const QUICK_FAIL = 1;

// On a cache miss the step installs everything and then saves a new cache, which costs this much.
export const CACHE_SAVE = 1;

// ------------------------------------------------------------------ options

// Can this option be switched on this step in this level? Returns '' if yes, or the reason.
export function whyNot(level, stepId, option) {
  const step = level.steps[stepId];
  if (!step) return `there is no step "${stepId}"`;
  if (!OPTIONS.includes(option)) return `"${option}" is not an option`;
  if (!level.toggles.includes(option)) return `this level does not offer "${option}"`;
  if (option === 'publish' && !step.makes) return `${step.label} makes nothing to publish`;
  if (option === 'cache' && !step.cacheSaves) return `${step.label} installs no dependencies to cache`;
  if (option === 'tag' && !step.pushes) return `${step.label} pushes no image to tag`;
  return '';
}

export function has(state, stepId, option) {
  return Boolean(state.opts[stepId] && state.opts[stepId][option]);
}

// ------------------------------------------------------------------- state

// The state at the start of a level.
export function start(level) {
  const opts = {};
  for (const id of Object.keys(level.steps)) opts[id] = {};
  for (const [id, list] of Object.entries(level.on || {})) {
    for (const option of list) opts[id][option] = true;
  }
  return {
    level,
    stages: level.pipeline.map((stage) => [...stage]),
    opts,
    status: 'playing',
    runs: 0,          // how many times Run was pressed
    report: null,     // what the last run found (see runChecks)
    fresh: false,     // true while the pipeline is unchanged since that run
  };
}

// The one way state changes. The page calls this for every input and replay() calls it for
// every recorded move, so both follow exactly the same rules. Returns a new state.
//   'move STEP N'   put STEP into stage N (stages are numbered from 1)
//   'new STEP N'    put STEP into a new stage that becomes stage N (N = 1 .. stages + 1)
//   'OPTION STEP'   switch an option on or off, e.g. 'cache lint' or 'main deploy'
//   'run'           run every check; the level is won when they all pass
// A stage left empty by a move disappears.
export function apply(state, move) {
  if (state.status !== 'playing') return state;
  const level = state.level;
  const words = String(move).trim().split(/\s+/);
  const [verb, id, where] = words;

  if (verb === 'run' && words.length === 1) {
    const report = runChecks(level, state.stages, state.opts);
    return { ...state, runs: state.runs + 1, report, fresh: true, status: report.pass ? 'won' : 'playing' };
  }

  if ((verb === 'move' || verb === 'new') && words.length === 3) {
    if (!level.steps[id]) throw new Error(`"${move}": level ${level.id} has no step "${id}"`);
    const most = state.stages.length + (verb === 'new' ? 1 : 0);
    const n = Number(where);
    if (!Number.isInteger(n) || n < 1 || n > most) {
      throw new Error(`"${move}": the stage number must be 1 to ${most} here`);
    }
    let stages = state.stages.map((stage) => stage.filter((other) => other !== id));
    if (verb === 'move') stages[n - 1].push(id);
    else stages.splice(n - 1, 0, [id]);
    stages = stages.filter((stage) => stage.length > 0);
    return { ...state, stages, fresh: false };
  }

  if (OPTIONS.includes(verb) && words.length === 2) {
    const reason = whyNot(level, id, verb);
    if (reason) throw new Error(`"${move}": ${reason}`);
    const opts = { ...state.opts, [id]: { ...state.opts[id], [verb]: !state.opts[id][verb] } };
    return { ...state, opts, fresh: false };
  }

  throw new Error(`"${move}" is not a move. Moves look like 'move lint 1', 'new lint 1', 'cache lint' or 'run'`);
}

// Play a whole list of moves from the start. Returns the final state.
export function replay(level, solution) {
  let state = start(level);
  for (const move of solution) state = apply(state, move);
  return state;
}

// Stars for a won level: fewer runner-minutes across all checks is better.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const minutes = state.report.minutes;
  if (minutes <= state.level.stars.three) return 3;
  if (minutes <= state.level.stars.two) return 2;
  return 1;
}

// --------------------------------------------------------------- the checks

// The pushes a check makes. A check with `commit` is one push at minute 0.
export function pushesOf(check) {
  const list = check.runs || [{ commit: check.commit, branch: check.branch, at: 0, approveAt: check.approveAt }];
  return list.map((push, i) => ({
    name: RUN_NAMES[i],
    commit: push.commit,
    branch: push.branch,
    at: push.at || 0,
    approveAt: push.approveAt === undefined ? null : push.approveAt,
  }));
}

// Run every check of a level against a pipeline.
// Returns { pass, minutes, checks: [{ pass, why, minutes, length, runs }] }.
export function runChecks(level, stages, opts) {
  const checks = level.checks.map((check) => {
    const runs = simulate(level, stages, opts, check);
    const why = judge(level, check, runs);
    const minutes = runs.reduce((sum, run) => sum + run.minutes, 0);
    return { pass: why === '', why, minutes, length: lengthOf(runs), runs };
  });
  return {
    pass: checks.every((check) => check.pass),
    minutes: checks.reduce((sum, check) => sum + check.minutes, 0),
    checks,
  };
}

// How many minutes the timeline of a check should show.
function lengthOf(runs) {
  let length = 1;
  for (const run of runs) {
    for (const s of run.steps) length = Math.max(length, s.end || 0, (s.waitFrom || 0) + 2);
    if (run.approveAt !== null && run.state !== 'waiting') length = Math.max(length, run.approveAt);
  }
  return length;
}

// Run the pipeline for every push in one check, minute by minute.
// Each run comes back as { name, commit, branch, at, approveAt, state, end, failAt, waitAt,
// minutes, steps } where state is 'green', 'red' or 'waiting' (stopped for an approval that
// never came) and each step is { id, stage, state, waitFrom, waitFor, start, end, note, image }
// with state 'ok', 'fail', 'skip', 'cancel' or 'waiting'. Steps of stages never reached are absent.
export function simulate(level, stages, opts, check) {
  const on = (id, option) => Boolean(opts[id] && opts[id][option]);
  const pusher = Object.keys(level.steps).find((id) => level.steps[id].pushes);
  const registry = { latest: 'old' };   // image tag -> the push whose image it is
  const locks = {};                     // step id -> the run holding its lock
  const runs = pushesOf(check).map((push) => ({
    ...push, state: 'queued', stage: -1, steps: [], end: null, failAt: null, waitAt: null, minutes: 0,
  }));

  let horizon = 10;
  for (const run of runs) horizon = Math.max(horizon, run.at, run.approveAt || 0);
  for (const step of Object.values(level.steps)) horizon += (step.minutes + CACHE_SAVE + QUICK_FAIL) * runs.length;

  const current = (run) => run.steps.filter((s) => s.stage === run.stage + 1);

  function openStage(run, index) {
    run.stage = index;
    for (const id of stages[index]) {
      run.steps.push({ id, stage: index + 1, state: 'pending', waitFrom: null, waitFor: null,
        start: null, end: null, note: '', image: null, willFail: false });
    }
  }

  function wait(s, why, t) {
    if (s.waitFrom === null) s.waitFrom = t;
    s.waitFor = why;
    s.state = 'waiting';
    return false;
  }

  // Try to begin one step at minute t. Returns true if it started or was skipped.
  function begin(run, s, t) {
    const step = level.steps[s.id];
    if (on(s.id, 'main') && run.branch !== 'main') {
      s.state = 'skip';
      s.note = 'skipped: it only runs on main';
      return true;
    }
    if (on(s.id, 'approve') && !(run.approveAt !== null && t >= run.approveAt)) return wait(s, 'approval', t);
    if (on(s.id, 'lock') && locks[s.id] !== undefined) return wait(s, 'lock', t);
    if (on(s.id, 'lock')) locks[s.id] = run.name;

    s.state = 'running';
    s.start = t;
    let minutes = step.minutes;
    let problem = '';
    const notes = [];

    if (step.cacheSaves && on(s.id, 'cache')) {
      if (LOCKFILE_COMMITS.includes(run.commit)) {
        minutes += CACHE_SAVE;
        notes.push(`cache miss (the lockfile changed): full install, then ${CACHE_SAVE} min to save a new cache`);
      } else {
        minutes -= step.cacheSaves;
        notes.push(`cache hit: ${step.cacheSaves} min saved`);
      }
    }

    if (step.needs === 'image') {
      const tag = pusher && on(pusher, 'tag') ? run.name : 'latest';
      if (registry[tag] === undefined) problem = `no image tagged ${tag} in the registry yet`;
      else s.image = registry[tag];
    } else if (step.needs) {
      const published = run.steps.some((o) => o.stage < s.stage && o.state === 'ok'
        && level.steps[o.id].makes === step.needs && on(o.id, 'publish'));
      if (!published) problem = 'no build output on this machine (every job starts clean, so an earlier stage must publish it)';
    }

    if (!problem && step.deploys) {
      const busy = runs.find((other) => other !== run && other.steps.some((o) => o.state === 'running'
        && level.steps[o.id].deploys === step.deploys));
      if (busy) problem = `push ${busy.name} was already deploying to ${step.deploys}`;
    }

    if (problem) {
      s.end = t + QUICK_FAIL;
      s.willFail = true;
      s.note = `failed: ${problem}`;
    } else {
      s.end = t + minutes;
      s.willFail = (step.fails || []).includes(run.commit);
      if (s.willFail) notes.unshift('failed: it caught the problem in this commit');
      if (s.image !== null) notes.push(s.image === run.name ? `deployed push ${run.name}'s image` : imageText(s.image));
      s.note = notes.join('; ');
    }
    run.minutes += s.end - s.start;
    return true;
  }

  function finish(run, s) {
    s.state = s.willFail ? 'fail' : 'ok';
    if (s.state === 'fail' && (run.failAt === null || s.end < run.failAt)) run.failAt = s.end;
    if (s.state === 'ok' && level.steps[s.id].pushes) registry[on(s.id, 'tag') ? run.name : 'latest'] = run.name;
    if (locks[s.id] === run.name) delete locks[s.id];
  }

  // Move one run forward at minute t. Returns true if anything changed.
  function advance(run, t) {
    if (run.state === 'queued') {
      if (t < run.at) return false;
      run.state = 'running';
      openStage(run, 0);
      return true;
    }
    if (run.state !== 'running') return false;
    const steps = current(run);
    let changed = false;
    for (const s of steps) {
      if (s.state === 'pending' || s.state === 'waiting') changed = begin(run, s, t) || changed;
    }
    if (steps.some((s) => s.state === 'running')) return changed;
    const waiting = steps.filter((s) => s.state === 'waiting');
    if (steps.some((s) => s.state === 'fail')) {
      for (const s of waiting) {
        s.state = 'cancel';
        s.note = 'cancelled: a step beside it had failed';
      }
      run.state = 'red';
      run.end = t;
      return true;
    }
    if (waiting.length > 0) return changed;
    if (run.stage + 1 < stages.length) openStage(run, run.stage + 1);
    else {
      run.state = 'green';
      run.end = t;
    }
    return true;
  }

  for (let t = 0; t <= horizon; t += 1) {
    for (const run of runs) {
      for (const s of run.steps) if (s.state === 'running' && s.end === t) finish(run, s);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const run of runs) if (advance(run, t)) changed = true;
    }
    if (runs.every((run) => run.state === 'green' || run.state === 'red')) break;
  }

  for (const run of runs) {
    if (run.state === 'running') {
      run.state = 'waiting';
      // The minute it had nothing left to do but wait: the gate is reached and the steps beside it are done.
      const gate = Math.min(...current(run).filter((s) => s.state === 'waiting').map((s) => s.waitFrom));
      run.waitAt = Math.max(gate, ...run.steps.map((s) => s.end || 0));
    }
    for (const s of run.steps) delete s.willFail;
  }
  return runs;
}

function imageText(image) {
  return image === 'old' ? 'deployed an old image (whatever latest pointed at before this run)'
    : `deployed push ${image}'s image`;
}

// ------------------------------------------------------------------ judging

// Compare what happened with what the check expects. Returns '' if it passed, else the reason.
export function judge(level, check, runs) {
  const label = (s) => level.steps[s.id].label;
  const many = runs.length > 1;
  const who = (run) => (many ? `Push ${run.name}` : 'It');
  const deploysTo = (s, env) => Boolean(level.steps[s.id].deploys) && (!env || level.steps[s.id].deploys === env);
  const firstFail = (run) => run.steps.find((s) => s.state === 'fail' && s.end === run.failAt);
  const waitingStep = (run) => run.steps.find((s) => s.state === 'waiting');
  const first = runs[0];
  const within = check.within;

  // The labels of the steps (picked by `wanted`) that did not run in this run, or ''.
  function notRun(run, wanted) {
    const ids = Object.keys(level.steps).filter((id) => wanted(id)
      && !run.steps.some((s) => s.id === id && (s.state === 'ok' || s.state === 'fail')));
    return ids.map((id) => level.steps[id].label).join(', ');
  }

  // Why a run did not finish green, or '' if it did.
  function notGreen(run) {
    if (run.state === 'red') {
      const s = firstFail(run);
      return `${who(run)} went red at minute ${run.failAt}: ${label(s)} ${s.note}`;
    }
    if (run.state === 'waiting') {
      const s = waitingStep(run);
      return `${who(run)} is still waiting for ${s.waitFor === 'lock' ? 'a lock' : 'approval'} before ${label(s)}`;
    }
    return '';
  }

  // A deploy that pulled an image this push did not build (another push's, or the old one
  // that "latest" pointed at before the check), or ''. Green still means the wrong thing shipped.
  function wrongImage(run) {
    const s = run.steps.find((o) => o.image !== null && o.image !== run.name);
    if (!s) return '';
    const got = s.image === 'old' ? 'an old image (whatever latest pointed at before the push)' : `push ${s.image}'s image`;
    return `${label(s)} shipped ${got}, not the one ${many ? `push ${run.name}` : 'this push'} built`;
  }

  function tooSlow(run, minute, what) {
    if (within === undefined || minute - run.at <= within) return '';
    return `${who(run)} ${what} after ${minute - run.at} min; the limit is ${within}`;
  }

  if (check.expect === 'green') {
    for (const run of runs) {
      const why = notGreen(run) || wrongImage(run) || tooSlow(run, run.end, 'went green');
      if (why) return why;
    }
    return '';
  }

  if (check.expect === 'no-deploy') {
    for (const run of runs) {
      const shipped = run.steps.find((s) => s.start !== null && deploysTo(s));
      if (shipped) return `${label(shipped)} ran on ${run.branch}`;
      const why = notGreen(run) || tooSlow(run, run.end, 'went green');
      if (why) return why;
      const missed = notRun(run, (id) => !level.steps[id].deploys);
      if (missed) return `${missed} did not run on ${run.branch}; a branch should still be built and tested`;
    }
    return '';
  }

  if (check.expect === 'red') {
    if (first.state === 'green') return 'It went green: no step caught the problem in this commit';
    if (first.state === 'waiting') return `It stopped to wait for approval before ${label(waitingStep(first))} instead of going red`;
    const shipped = first.steps.find((s) => s.state === 'ok' && deploysTo(s));
    if (shipped) return `It went red, but only after ${label(shipped)} had shipped the broken commit`;
    return tooSlow(first, first.failAt, 'went red');
  }

  if (check.expect === 'waits') {
    const shipped = first.steps.find((s) => s.state === 'ok' && deploysTo(s, 'production'));
    if (shipped) return `${label(shipped)} went out to production with nobody approving it`;
    if (first.state !== 'waiting') return notGreen(first) || 'It finished without ever stopping for approval';
    const s = waitingStep(first);
    if (!deploysTo(s, 'production')) return `It stopped for approval before ${label(s)}; only the production deploy should wait for a person`;
    const left = notRun(first, (id) => id !== s.id);
    if (left) return `It stopped for approval while ${left} had not run yet; production should be the only step left`;
    return wrongImage(first) || tooSlow(first, first.waitAt, 'reached the approval');
  }

  if (check.expect === 'same-image') {
    const why = notGreen(first);
    if (why) return why;
    const wrong = first.steps.find((s) => s.image !== null && s.image !== first.name);
    if (wrong) {
      const got = wrong.image === 'old' ? 'an old image' : `push ${wrong.image}'s image`;
      return `${label(wrong)} got ${got}, but push ${first.name} is the one that was tested and approved`;
    }
    return '';
  }

  throw new Error(`level ${level.id}: a check expects "${check.expect}", which is not a known result`);
}
