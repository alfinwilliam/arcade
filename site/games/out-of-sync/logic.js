// RULES for Out of Sync, the Argo CD puzzle. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.
//
// The model in one paragraph:
//   Git      a list of commits, oldest first. Each commit holds the full set of manifests.
//   cluster  the live resources ("live"), keyed 'Kind/name', each a flat object of fields.
//   Argo CD  compares the commit it last fetched ("seen") with the cluster. Its two badges,
//            sync status and health, are worked out from that on demand and never stored.
//   time     moves only when the player presses Wait: the next scripted event happens, Argo CD
//            fetches Git (by default every 120 s plus up to 60 s of jitter) and auto-sync may act.
// Every input, Wait included, uses one of the level's actions.

// Within one sync wave Argo CD applies kinds in this order (a short part of its full list).
const KIND_ORDER = ['Namespace', 'ServiceAccount', 'Secret', 'ConfigMap', 'Service', 'Deployment',
  'HorizontalPodAutoscaler', 'StatefulSet', 'Job'];
// The app's health is the worst of its resources' health, in Argo CD's order (best first).
// Argo CD's full list is Healthy, Suspended, Progressing, Missing, Degraded, Unknown.
const HEALTH_ORDER = ['Healthy', 'Progressing', 'Missing', 'Degraded'];
// The plain actions a level may offer in `actions`. Inputs: 'sync', 'auto:on', 'commit:<id>' ...
export const ACTIONS = ['sync', 'sync-prune', 'refresh', 'rollback', 'revert', 'wait', 'auto', 'self-heal', 'prune'];
const TOGGLES = { auto: 'auto-sync', 'self-heal': 'self-heal', prune: 'auto-prune' };
const SETTING = { auto: 'auto', 'self-heal': 'selfHeal', prune: 'prune' };

// ------------------------------------------------------------------ helpers

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function kindOf(key) {
  return key.split('/')[0];
}

function nameOf(key) {
  return key.split('/').slice(1).join('/');
}

// Sort resource keys the way Argo CD applies them: by kind, then by name.
export function byKind(a, b) {
  const rank = (key) => {
    const index = KIND_ORDER.indexOf(kindOf(key));
    return index === -1 ? KIND_ORDER.length : index;
  };
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

// A patch: { 'Kind/name': { field: value } } sets fields, a field set to null is removed,
// and 'Kind/name': null removes the whole resource.
function patched(manifests, patch) {
  const out = copy(manifests);
  for (const [key, fields] of Object.entries(patch || {})) {
    if (fields === null) {
      delete out[key];
      continue;
    }
    const resource = { ...(out[key] || {}) };
    for (const [field, value] of Object.entries(fields)) {
      if (value === null) delete resource[field];
      else resource[field] = value;
    }
    out[key] = resource;
  }
  return out;
}

// A short, made-up commit id that is the same every time (FNV-1a hash of the inputs).
function shaFor(levelId, number, message) {
  let hash = 0x811c9dc5;
  for (const char of `${levelId}/${number}/${message}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

function say(state, who, text) {
  state.log.push({ turn: state.used, who, text });
}

function head(state) {
  return state.commits.length - 1;
}

// ------------------------------------------------------------------ images and health

// What an image tag does when it runs: 'ok', 'crash', 'needs-migration' or 'fails' (a Job that
// fails). A tag the level does not list does not exist in the registry: 'missing'.
function imageKind(state, image) {
  return (state.level.images || {})[image] || 'missing';
}

function imageWorks(state, image) {
  const kind = imageKind(state, image);
  return kind === 'ok' || (kind === 'needs-migration' && state.migrated.includes(image));
}

const WHY_BROKEN = {
  missing: 'ImagePullBackOff: the registry has no such tag',
  crash: 'CrashLoopBackOff: the container exits on start',
  fails: 'CrashLoopBackOff: the container exits on start',
  'needs-migration': 'needs its database migration first',
};

// One live resource's health: { health, why }.
export function resourceHealth(state, key) {
  const live = state.live[key];
  if (!live) return { health: 'Missing', why: 'not in the cluster' };
  const kind = kindOf(key);
  if (kind === 'Deployment') {
    if (imageWorks(state, live.image)) return { health: 'Healthy', why: `${live.replicas ?? 1} replicas ready` };
    const why = WHY_BROKEN[imageKind(state, live.image)];
    // A rollout that cannot finish stays Progressing until its progress deadline (10 minutes by
    // default) passes; then Argo CD calls it Degraded. Here that happens when time next passes.
    const age = state.clock - (state.rolloutAt[key] ?? -1);
    return age >= 1 ? { health: 'Degraded', why: `rollout failed, ${why}` } : { health: 'Progressing', why };
  }
  if (kind === 'Job') {
    return state.jobs[key] === 'Failed' ? { health: 'Degraded', why: 'the Job failed' } : { health: 'Healthy', why: 'Completed' };
  }
  return { health: 'Healthy', why: '' };
}

function ignored(state, key, field) {
  return state.settings.ignore.some((id) => {
    const rule = state.level.ignores.find((item) => item.id === id);
    return rule.resource === key && rule.field === field;
  });
}

// ------------------------------------------------------------------ the two badges

// Compare one commit's manifests with the cluster. Per resource:
//   diffs     { field: 'differs' | 'removed' | 'ignored' }  ('removed': Argo CD applied it before,
//             Git no longer has it, so the next sync removes it from the live object)
//   missing   in Git, not in the cluster
//   prune     in the cluster, not in Git (it "requires pruning")
//   hook      a hook: run by a sync, never compared
export function compare(state, index = state.seen) {
  const desired = state.commits[index].manifests;
  const resources = {};
  for (const [key, fields] of Object.entries(desired)) {
    if (fields.hook) {
      resources[key] = { hook: true, diffs: {}, synced: true };
      continue;
    }
    const live = state.live[key];
    const diffs = {};
    if (live) {
      for (const [field, value] of Object.entries(fields)) {
        if (live[field] !== value) diffs[field] = ignored(state, key, field) ? 'ignored' : 'differs';
      }
      for (const field of state.applied[key] || []) {
        if (!(field in fields) && field in live) diffs[field] = ignored(state, key, field) ? 'ignored' : 'removed';
      }
    }
    const synced = Boolean(live) && Object.values(diffs).every((d) => d === 'ignored');
    resources[key] = { missing: !live, diffs, synced };
  }
  for (const key of Object.keys(state.live)) {
    if (!(key in desired)) resources[key] = { prune: true, diffs: {}, synced: false };
  }
  const list = Object.values(resources);
  return {
    sync: list.every((r) => r.synced) ? 'Synced' : 'OutOfSync',
    onlyPrune: list.every((r) => r.synced || r.prune),
    resources,
  };
}

export function health(state, index = state.seen) {
  let worst = 'Healthy';
  const consider = (value) => {
    if (HEALTH_ORDER.indexOf(value) > HEALTH_ORDER.indexOf(worst)) worst = value;
  };
  const desired = state.commits[index].manifests;
  for (const [key, fields] of Object.entries(desired)) {
    if (!fields.hook && !state.live[key]) consider('Missing');
  }
  for (const key of Object.keys(state.live)) consider(resourceHealth(state, key).health);
  return worst;
}

// The two badges as Argo CD shows them: against the commit it last fetched.
export function badges(state) {
  return { sync: compare(state).sync, health: health(state) };
}

// ------------------------------------------------------------------ changing the cluster

// After a live resource changed: a new Deployment image starts a rollout; a new Job runs.
// `finished` collects migrations that complete in the current sync wave.
function afterChange(state, key, before, finished) {
  const now = state.live[key];
  const kind = kindOf(key);
  if (kind === 'Deployment' && (!before || before.image !== now.image)) {
    if (imageKind(state, now.image) === 'needs-migration' && !state.migrated.includes(now.image)) {
      state.status = 'lost';
      state.reason = `${now.image} started taking traffic before its database migration had finished, and its requests failed.`;
      say(state, 'Kubernetes', state.reason);
      return;
    }
    state.rolloutAt[key] = state.clock;
    if (!imageWorks(state, now.image)) say(state, 'Kubernetes', `${key} rolls out ${now.image}: ${WHY_BROKEN[imageKind(state, now.image)]}.`);
  }
  if (kind === 'Job' && (!before || !same(before, now))) {
    if (imageKind(state, now.image) === 'fails') {
      state.jobs[key] = 'Failed';
      say(state, 'Kubernetes', `${key} failed.`);
    } else {
      state.jobs[key] = 'Completed';
      if (finished) finished.push(now.image);
      else if (!state.migrated.includes(now.image)) state.migrated.push(now.image);
    }
  }
}

// kubectl edits and scripted events: change the cluster directly.
function changeLive(state, patch) {
  for (const [key, fields] of Object.entries(patch)) {
    const before = state.live[key];
    if (fields === null) {
      delete state.live[key];
      delete state.applied[key];
      delete state.jobs[key];
      continue;
    }
    state.live[key] = patched({ [key]: before || {} }, { [key]: fields })[key];
    afterChange(state, key, before, null);
    if (state.status !== 'playing') return;
  }
}

// Apply one manifest, as kubectl apply would: set every field in Git, and remove a field that
// Argo CD applied before but Git no longer has (client-side apply, Argo CD's default, does that
// through the last-applied-configuration annotation). Returns a few words for the log, or ''.
function applyResource(state, key, fields, finished) {
  const before = state.live[key];
  const after = { ...(before || {}) };
  const notes = [];
  for (const field of state.applied[key] || []) {
    if (field in fields || !(field in after)) continue;
    delete after[field];
    if (kindOf(key) === 'Deployment' && field === 'replicas') {
      after.replicas = 1;
      notes.push('replicas left Git, so the apply removed it and Kubernetes used the default, 1');
    }
  }
  for (const [field, value] of Object.entries(fields)) {
    if (before && after[field] !== value && ignored(state, key, field)) {
      notes.push(`it also wrote ${field}: ${value} from Git, because ignoreDifferences only changes the diff`);
    }
    after[field] = value;
  }
  state.applied[key] = Object.keys(fields);
  state.live[key] = after;
  if (before && same(before, after)) return '';
  afterChange(state, key, before, finished);
  const changed = before ? Object.keys(after).filter((field) => before[field] !== after[field]) : [];
  const what = before ? `updated ${key} (${changed.map((f) => `${f}: ${after[f]}`).join(', ')})` : `created ${key}`;
  return what + (notes.length ? `; ${notes.join('; ')}` : '');
}

// One sync operation to commit `index`: PreSync hooks, then each sync wave from the lowest,
// then pruning if asked. Argo CD starts a wave only when the earlier ones are synced and healthy,
// so a Job in an earlier wave has finished before the next wave starts. Inside one wave
// everything is applied together. Not modelled: a real Job's pod template cannot be changed, so
// a plain (non-hook) Job whose image changes would fail this apply.
function runSync(state, index, prune, why) {
  const desired = state.commits[index].manifests;
  const sha = state.commits[index].sha;
  const done = [];
  const keys = Object.keys(desired).sort(byKind);
  const at = state.log.length;   // the summary goes before what the cluster said while applying
  const report = (text) => state.log.splice(at, 0, { turn: state.used, who: 'Argo CD', text });

  for (const key of keys.filter((k) => desired[k].hook === 'PreSync')) {
    const image = desired[key].image;
    if (imageKind(state, image) === 'fails') {
      state.syncs.push({ commit: index, ok: false });
      report(`${why} to ${sha} failed: the PreSync hook ${key} failed, so nothing else was applied.`);
      return;
    }
    if (image && !state.migrated.includes(image)) state.migrated.push(image);
    done.push(`ran the PreSync hook ${key} to completion`);
  }

  const normal = keys.filter((k) => !desired[k].hook);
  const waves = [...new Set(normal.map((k) => desired[k].wave || 0))].sort((a, b) => a - b);
  for (const wave of waves) {
    const finished = [];
    for (const key of normal.filter((k) => (desired[k].wave || 0) === wave)) {
      const what = applyResource(state, key, desired[key], finished);
      if (what) done.push(waves.length > 1 ? `wave ${wave}: ${what}` : what);
      if (state.status !== 'playing') break;
    }
    if (state.status !== 'playing') break;
    for (const image of finished) if (!state.migrated.includes(image)) state.migrated.push(image);
  }

  const extra = Object.keys(state.live).filter((k) => !(k in desired)).sort(byKind);
  if (prune && state.status === 'playing') {
    for (const key of extra) {
      delete state.live[key];
      delete state.applied[key];
      delete state.jobs[key];
      done.push(`pruned ${key}`);
    }
  }
  state.syncs.push({ commit: index, ok: true });
  report(`${why} to ${sha}: ${done.length ? done.join(', ') : 'nothing to change'}.`);
  if (!prune && extra.length) {
    say(state, 'Argo CD', `${extra.join(', ')} ${extra.length === 1 ? 'is' : 'are'} no longer in Git but still running: this sync did not prune.`);
  }
}

// ------------------------------------------------------------------ controllers

// The HorizontalPodAutoscaler sets replicas on the Deployment of the same name, within min and max.
function autoscale(state) {
  let changed = false;
  if (state.hpa === null) return changed;
  for (const [key, fields] of Object.entries(state.live)) {
    const target = `Deployment/${nameOf(key)}`;
    if (kindOf(key) !== 'HorizontalPodAutoscaler' || !state.live[target]) continue;
    const want = Math.min(fields.max, Math.max(fields.min, state.hpa));
    if (state.live[target].replicas === want) continue;
    state.live[target] = { ...state.live[target], replicas: want };
    say(state, 'HPA', `scaled ${target} to ${want} replicas.`);
    changed = true;
  }
  return changed;
}

// Argo CD's automated sync, following its documented rules:
//   - it acts only when the app is OutOfSync;
//   - without prune it will not sync when the only change is a deletion;
//   - it syncs a commit once: if the latest sync was to this same commit it does not sync again,
//     unless that sync succeeded and self-heal is on; if that sync failed it does not start
//     another one to the same commit. (A real sync operation retries itself first, per
//     syncPolicy.retry; the game counts the whole operation as one failed sync.)
// Returns true if it ran a sync. The reason it waits goes in state.note for the page.
function reconcile(state) {
  const settings = state.settings;
  if (!settings.auto) return false;
  const result = compare(state);
  if (result.sync === 'Synced') return false;
  const sha = state.commits[state.seen].sha;
  if (!settings.prune && result.onlyPrune) {
    state.note = 'Auto-sync is waiting: the only change is a deletion, and prune is off in the sync policy.';
    return false;
  }
  const last = state.syncs[state.syncs.length - 1];
  if (last && last.commit === state.seen) {
    if (!last.ok) {
      state.note = `Auto-sync will not sync ${sha} again: its last sync to that commit failed. A new commit or a manual sync is needed.`;
      return false;
    }
    if (!settings.selfHeal) {
      state.note = `Auto-sync is waiting: it already synced ${sha}, and without self-heal it leaves live changes alone.`;
      return false;
    }
    runSync(state, state.seen, settings.prune, 'Self-heal synced');
    return true;
  }
  runSync(state, state.seen, settings.prune, 'Auto-sync synced');
  return true;
}

// Let the controllers react to a change: the HPA, then Argo CD, then the HPA again.
function settle(state) {
  state.note = '';
  autoscale(state);
  if (state.status !== 'playing') return;
  const synced = reconcile(state);
  if (synced && autoscale(state) && state.settings.selfHeal && compare(state).sync === 'OutOfSync') {
    say(state, 'Argo CD', 'Self-heal and the HPA keep undoing each other, so the app flips back to OutOfSync every few seconds.');
  }
}

function commit(state, message, patch) {
  const manifests = patched(state.commits[head(state)].manifests, patch);
  const sha = shaFor(state.level.id, state.commits.length, message);
  state.commits.push({ sha, message, manifests });
  return sha;
}

// ------------------------------------------------------------------ time

function step(state) {
  state.clock += 1;
  for (const key of Object.keys(state.live)) {
    if (kindOf(key) === 'Deployment' && state.rolloutAt[key] === state.clock - 1 && resourceHealth(state, key).health === 'Degraded') {
      say(state, 'Kubernetes', `${key} passed its progress deadline: Degraded.`);
    }
  }
  const event = state.level.events[state.next];
  if (event) {
    state.next += 1;
    say(state, 'Event', event.text);
    if (event.git) say(state, 'Git', `new commit ${commit(state, event.message, event.git)}: ${event.message}`);
    if (event.live) changeLive(state, event.live);
    if (event.hpa !== undefined) state.hpa = event.hpa;
  } else {
    say(state, 'Time', 'Time passes. Nothing is scheduled.');
  }
  if (state.status !== 'playing') return;
  if (state.seen !== head(state)) say(state, 'Argo CD', `polled Git and found ${state.commits[head(state)].sha}.`);
  state.seen = head(state);
  settle(state);
  if (event && event.check && state.status === 'playing') {
    const now = badges(state);
    if (now.sync === 'Synced' && now.health === 'Healthy') {
      say(state, 'Check', 'Passed: Synced and Healthy.');
    } else {
      state.status = 'lost';
      state.reason = `The check after "${event.text}" found the app ${now.sync} and ${now.health}.`;
      say(state, 'Check', `Failed: ${now.sync} and ${now.health}.`);
    }
  }
}

// ------------------------------------------------------------------ inputs

// Words for an input, used in the log and on the page.
export function label(level, input) {
  const [verb, arg] = input.split(':');
  if (verb === 'commit') return `Commit: ${level.commits.find((c) => c.id === arg).label}`;
  if (verb === 'edit') return level.edits.find((e) => e.id === arg).label;
  if (verb === 'ignore') {
    const rule = level.ignores.find((i) => i.id === arg);
    return `Ignore ${rule.pointer} on ${rule.resource}`;
  }
  if (TOGGLES[verb]) return `Turn ${arg} ${TOGGLES[verb]}`;
  return {
    sync: 'Sync', 'sync-prune': 'Sync with prune', refresh: 'Refresh', rollback: 'Roll back to the previous sync',
    revert: 'git revert HEAD', wait: 'Wait for the next event',
  }[verb];
}

// Every input this level offers, in the order the page shows them.
export function inputs(level) {
  const list = [];
  for (const action of ACTIONS) {
    if (!level.actions.includes(action)) continue;
    if (TOGGLES[action]) list.push(`${action}:on`, `${action}:off`);
    else list.push(action);
  }
  for (const c of level.commits) list.push(`commit:${c.id}`);
  for (const e of level.edits) list.push(`edit:${e.id}`);
  for (const i of level.ignores) list.push(`ignore:${i.id}`);
  return list;
}

// Why an input cannot be used right now, or '' if it can.
export function blocked(state, input) {
  const level = state.level;
  if (!inputs(level).includes(input)) return `"${input}" is not an action in level ${level.id}`;
  const [verb, arg] = input.split(':');
  if (TOGGLES[verb]) {
    const on = arg === 'on';
    if (state.settings[SETTING[verb]] === on) return `${TOGGLES[verb]} is already ${arg}`;
    if (verb !== 'auto' && on && !state.settings.auto) return `${TOGGLES[verb]} is part of the automated sync policy: turn on auto-sync first`;
  }
  if (verb === 'revert' && state.commits.length < 2) return 'there is no earlier commit to revert to';
  if (verb === 'commit') {
    const offered = level.commits.find((c) => c.id === arg);
    if (same(patched(state.commits[head(state)].manifests, offered.git), state.commits[head(state)].manifests)) {
      return 'that commit would change nothing in Git';
    }
  }
  if (verb === 'ignore' && state.settings.ignore.includes(arg)) return 'that field is already ignored';
  return '';
}

// The state at the start of a level.
export function start(level) {
  const commits = [];
  let manifests = {};
  level.git.forEach((entry, i) => {
    manifests = entry.manifests ? copy(entry.manifests) : patched(manifests, entry.change);
    commits.push({ sha: shaFor(level.id, i, entry.message), message: entry.message, manifests });
  });
  for (const fields of Object.values(manifests)) {
    if (fields.hook && fields.hook !== 'PreSync') throw new Error(`${level.id}: only PreSync hooks are modelled`);
  }
  const synced = level.synced || [commits.length];
  const lastSynced = commits[synced[synced.length - 1] - 1].manifests;
  const live = {};
  const applied = {};
  for (const [key, fields] of Object.entries(lastSynced)) {
    if (fields.hook) continue;
    live[key] = { ...fields };
    applied[key] = Object.keys(fields);
  }
  const policy = level.policy || {};
  const state = {
    level,
    commits,
    seen: commits.length - 1,
    live: patched(live, level.drift),
    applied,
    rolloutAt: {},
    jobs: {},
    migrated: [],
    settings: {
      auto: Boolean(policy.auto),
      selfHeal: Boolean(policy.auto && policy.selfHeal),
      prune: Boolean(policy.auto && policy.prune),
      ignore: [],
    },
    syncs: synced.map((number) => ({ commit: number - 1, ok: true })),
    hpa: level.hpa ?? null,
    clock: 0,
    next: 0,
    used: 0,
    inputs: [],         // every input so far, in order (stars() looks for a level's notBest inputs)
    status: 'playing',
    reason: '',
    note: '',
    log: [],
  };
  settle(state);
  judge(state);
  return state;
}

function judge(state) {
  if (state.status !== 'playing') return;
  const now = badges(state);
  const done = state.next >= state.level.events.length && state.seen === head(state);
  if (done && now.sync === 'Synced' && now.health === 'Healthy') {
    state.status = 'won';
  } else if (state.used >= state.level.maxActions) {
    state.status = 'lost';
    state.reason = 'Out of actions before the app was Synced and Healthy after the last event.';
  }
}

// The one way state changes. The page calls this for every button press and replay() calls it
// for every recorded input, so both follow exactly the same rules. Returns a new state.
export function apply(state, input) {
  if (state.status !== 'playing') return state;
  const reason = blocked(state, input);
  if (reason) throw new Error(reason);

  const { level, ...rest } = state;
  const next = { level, ...copy(rest) };
  next.used += 1;
  next.inputs.push(input);
  say(next, 'You', label(level, input));
  const [verb, arg] = input.split(':');

  if (verb === 'wait') {
    step(next);
    judge(next);
    return next;
  }
  if (verb === 'sync' || verb === 'sync-prune') {
    next.seen = head(next);
    runSync(next, next.seen, verb === 'sync-prune', 'Manual sync');
  } else if (verb === 'refresh') {
    if (next.seen === head(next)) say(next, 'Argo CD', 'compared Git with the cluster again: nothing new in Git.');
    else say(next, 'Argo CD', `fetched Git now and found ${next.commits[head(next)].sha}.`);
    next.seen = head(next);
  } else if (verb === 'rollback') {
    const good = next.syncs.filter((s) => s.ok);
    if (next.settings.auto) {
      say(next, 'Argo CD', 'Refused: rollback is not allowed while auto-sync is on.');
    } else if (good.length < 2) {
      say(next, 'Argo CD', 'Refused: there is no earlier sync in the history to roll back to.');
    } else {
      runSync(next, good[good.length - 2].commit, false, 'Rollback synced');
    }
  } else if (verb === 'revert') {
    const last = next.commits[head(next)];
    const message = `Revert "${last.message}"`;
    const target = next.commits[head(next) - 1].manifests;
    next.commits.push({ sha: shaFor(level.id, next.commits.length, message), message, manifests: copy(target) });
    say(next, 'Git', `new commit ${next.commits[head(next)].sha}: ${message}. Argo CD sees it on its next poll, or on Refresh.`);
  } else if (verb === 'commit') {
    const offered = level.commits.find((c) => c.id === arg);
    const sha = commit(next, offered.message, offered.git);
    say(next, 'Git', `new commit ${sha}: ${offered.message}. Argo CD sees it on its next poll, or on Refresh.`);
  } else if (verb === 'edit') {
    changeLive(next, level.edits.find((e) => e.id === arg).live);
  } else if (verb === 'ignore') {
    next.settings.ignore.push(arg);
  } else if (TOGGLES[verb]) {
    next.settings[SETTING[verb]] = arg === 'on';
    if (verb === 'auto' && arg === 'off') {
      next.settings.selfHeal = false;   // both live under spec.syncPolicy.automated,
      next.settings.prune = false;      // which turning auto-sync off removes
    }
  }
  if (next.status === 'playing') settle(next);
  judge(next);
  return next;
}

// Play a whole list of inputs from the start. Returns the final state.
export function replay(level, solution) {
  let state = start(level);
  for (const input of solution) state = apply(state, input);
  return state;
}

// The level's notBest ideas this play used: wins that work here but are not the fix to keep.
export function notBestUsed(state) {
  return (state.level.notBest || []).filter((idea) => state.inputs.includes(idea.input));
}

// Three stars for matching the reference solution's length, one fewer for each extra action,
// never fewer than one. A win that used one of the level's notBest inputs gets two at most.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const extra = state.used - state.level.solution.length;
  const earned = Math.max(1, 3 - Math.max(0, extra));
  return notBestUsed(state).length ? Math.min(2, earned) : earned;
}
