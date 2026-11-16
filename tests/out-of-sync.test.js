// Tests for Out of Sync. The loop replays every level's solution through the real rules,
// checks the rules in the levels.js header, and checks that each "tempting" wrong idea loses.
// Below the loop, small made-up levels pin down each Argo CD rule the game teaches.

import { test, assert } from './harness.js';
import { levels } from '../site/games/out-of-sync/levels.js';
import { start, apply, replay, badges, inputs, stars, ACTIONS } from '../site/games/out-of-sync/logic.js';

test('level ids are unique and start with "oos-"', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('oos-'), id);
});

for (const level of levels) {
  test(`${level.id}: the solution wins with 3 stars`, () => {
    const state = replay(level, level.solution);
    assert.equal(state.status, 'won');
    assert.equal(stars(state), 3);
  });

  test(`${level.id}: actions are known words, and commit, edit and ignore ids are unique`, () => {
    for (const action of level.actions) assert.ok(ACTIONS.includes(action), `unknown action "${action}"`);
    for (const list of [level.commits, level.edits, level.ignores]) {
      const ids = list.map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length, `repeated id in ${ids.join(', ')}`);
    }
  });

  test(`${level.id}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
  });

  test(`${level.id}: the solution fits in maxActions`, () => {
    assert.ok(level.solution.length <= level.maxActions);
  });

  test(`${level.id}: every tempting idea does not win`, () => {
    assert.ok(level.tempting.length >= 1 && level.tempting.length <= 3, 'tempting has 1 to 3 entries');
    for (const idea of level.tempting) {
      assert.ok(idea.label && idea.why, 'each tempting entry has a label and a why');
      const after = replay(level, idea.moves);
      const now = badges(after);
      assert.ok(after.status === 'lost' || now.sync !== 'Synced' || now.health !== 'Healthy',
        `"${idea.label}" does not fail: after its moves the level is ${after.status} and the app ${now.sync} and ${now.health}`);
    }
  });

  test(`${level.id}: every notBest idea wins, with 2 stars at most`, () => {
    for (const idea of level.notBest || []) {
      assert.ok(idea.label && idea.why, 'each notBest entry has a label and a why');
      assert.ok(idea.moves.includes(idea.input), `"${idea.label}": its moves do not use ${idea.input}`);
      assert.ok(!level.solution.includes(idea.input), `the solution uses ${idea.input}, a notBest input`);
      const after = replay(level, idea.moves);
      assert.equal(after.status, 'won', `"${idea.label}" does not win, so it belongs in tempting`);
      assert.ok(stars(after) <= 2, `"${idea.label}" earns ${stars(after)} stars`);
    }
  });

  test(`${level.id}: lesson, inRealLife (1 to 3, at most 14 lines) and docs (1 to 3 https links)`, () => {
    assert.ok(typeof level.lesson === 'string' && level.lesson.trim() !== '', 'lesson');
    assert.ok(level.inRealLife.length >= 1 && level.inRealLife.length <= 3, 'inRealLife count');
    for (const snippet of level.inRealLife) {
      assert.ok(snippet.label && snippet.code, 'each snippet has a label and code');
      assert.ok(snippet.code.split('\n').length <= 14, `"${snippet.label}" is longer than 14 lines`);
    }
    assert.ok(level.docs.length >= 1 && level.docs.length <= 3, 'docs count');
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
  });

  test(`${level.id}: every event that commits to Git has a message`, () => {
    for (const event of level.events) assert.ok(!event.git || event.message, event.text);
  });
}

// ---------------------------------------------------------------- the rules, one by one

// A small level to vary: one Deployment and one ConfigMap, already synced.
function tiny(extra) {
  return {
    id: 'x', images: { 'app:1': 'ok', 'app:2': 'ok' },
    git: [{ message: 'one', manifests: {
      'Deployment/app': { image: 'app:1', replicas: 2 },
      'ConfigMap/app': { MODE: 'a' },
    } }],
    actions: ['sync', 'sync-prune', 'refresh', 'rollback', 'revert', 'wait', 'auto', 'self-heal', 'prune'],
    commits: [], edits: [], ignores: [], events: [], maxActions: 9, solution: [],
    ...extra,
  };
}
const scaleTo5 = { 'Deployment/app': { replicas: 5 } };

test('a hand edit makes the app OutOfSync', () => {
  const level = tiny({ edits: [{ id: 'e', label: 'kubectl scale', live: scaleTo5 }], events: [{ text: 'later' }] });
  assert.equal(badges(apply(start(level), 'edit:e')).sync, 'OutOfSync');
});

test('auto-sync without self-heal leaves a hand edit; with self-heal it is undone', () => {
  const level = tiny({ policy: { auto: true }, events: [{ text: 'night', live: scaleTo5 }, { text: 'later' }] });
  assert.equal(replay(level, ['wait']).live['Deployment/app'].replicas, 5);
  assert.equal(replay(level, ['self-heal:on', 'wait']).live['Deployment/app'].replicas, 2);
});

test('auto-sync applies a new commit once Argo CD has fetched it', () => {
  const level = tiny({ policy: { auto: true },
    commits: [{ id: 'c', label: 'c', message: 'c', git: { 'ConfigMap/app': { MODE: 'b' } } }], events: [{ text: 'later' }] });
  const committed = apply(start(level), 'commit:c');
  assert.equal(committed.live['ConfigMap/app'].MODE, 'a', 'not before the poll');
  assert.equal(apply(committed, 'refresh').live['ConfigMap/app'].MODE, 'b', 'Refresh fetches it now');
});

test('a resource removed from Git stays until a sync with prune', () => {
  const level = tiny({ policy: { auto: true, selfHeal: true },
    events: [{ text: 'rm', message: 'rm', git: { 'ConfigMap/app': null } }, { text: 'later' }] });
  const after = replay(level, ['wait', 'sync']);
  assert.ok(after.live['ConfigMap/app'], 'auto-sync and a plain sync both leave it');
  assert.equal(badges(after).sync, 'OutOfSync');
  assert.ok(!replay(level, ['wait', 'sync-prune']).live['ConfigMap/app'], 'sync with prune deletes it');
  assert.ok(!replay(level, ['prune:on', 'wait']).live['ConfigMap/app'], 'auto-prune deletes it');
});

test('syncing a commit with a missing image again does not fix it', () => {
  const level = tiny({ git: [{ message: 'bad', manifests: { 'Deployment/app': { image: 'app:9', replicas: 2 } } }],
    events: [{ text: 'later' }] });
  const state = replay(level, ['sync', 'sync']);
  assert.equal(badges(state).sync, 'Synced');
  assert.equal(badges(state).health, 'Degraded');
});

test('a new rollout of a missing image is Progressing, then Degraded once time passes', () => {
  const level = tiny({ commits: [{ id: 'bad', label: 'b', message: 'b', git: { 'Deployment/app': { image: 'app:9' } } }],
    events: [{ text: 'later' }] });
  const synced = replay(level, ['commit:bad', 'sync']);
  assert.equal(badges(synced).health, 'Progressing');
  assert.equal(badges(apply(synced, 'wait')).health, 'Degraded');
});

test('rollback is refused while auto-sync is on, and works once it is off', () => {
  const level = tiny({ policy: { auto: true },
    git: [{ message: 'one', manifests: { 'Deployment/app': { image: 'app:1', replicas: 2 } } },
      { message: 'two', change: { 'Deployment/app': { image: 'app:2' } } }],
    synced: [1, 2], events: [{ text: 'later' }] });
  assert.equal(replay(level, ['rollback']).live['Deployment/app'].image, 'app:2');
  const rolled = replay(level, ['auto:off', 'rollback']);
  assert.equal(rolled.live['Deployment/app'].image, 'app:1');
  assert.equal(badges(rolled).sync, 'OutOfSync', 'Git still says app:2');
});

test('git revert makes a new commit with the previous manifests', () => {
  const level = tiny({ git: [{ message: 'one', manifests: { 'Deployment/app': { image: 'app:1', replicas: 2 } } },
    { message: 'two', change: { 'Deployment/app': { image: 'app:2' } } }], events: [{ text: 'later' }] });
  const state = apply(start(level), 'revert');
  assert.equal(state.commits.length, 3);
  assert.equal(state.commits[2].manifests['Deployment/app'].image, 'app:1');
});

test('ignoreDifferences keeps an HPA-owned field from making the app OutOfSync', () => {
  const level = tiny({ policy: { auto: true, selfHeal: true }, hpa: 2,
    git: [{ message: 'one', manifests: { 'Deployment/app': { image: 'app:1', replicas: 2 },
      'HorizontalPodAutoscaler/app': { min: 1, max: 9 } } }],
    ignores: [{ id: 'r', resource: 'Deployment/app', field: 'replicas', pointer: '/spec/replicas' }],
    events: [{ text: 'rush', hpa: 7 }, { text: 'later' }] });
  assert.equal(badges(replay(level, ['wait'])).sync, 'OutOfSync', 'self-heal and the HPA fight');
  const ignoring = replay(level, ['ignore:r', 'wait']);
  assert.equal(badges(ignoring).sync, 'Synced');
  assert.equal(ignoring.live['Deployment/app'].replicas, 7);
});

test('PreSync hooks and earlier waves finish before the Deployment; the same wave does not', () => {
  const level = tiny({ images: { 'app:1': 'ok', 'app:2': 'needs-migration' },
    git: [{ message: 'one', manifests: { 'Deployment/app': { image: 'app:1' } } },
      { message: 'two', change: { 'Deployment/app': { image: 'app:2' }, 'Job/migrate': { image: 'app:2' } } }],
    synced: [1],
    commits: [{ id: 'hook', label: 'h', message: 'h', git: { 'Job/migrate': { hook: 'PreSync' } } },
      { id: 'early', label: 'e', message: 'e', git: { 'Job/migrate': { wave: -1 } } }] });
  assert.equal(replay(level, ['sync']).status, 'lost');
  assert.equal(replay(level, ['commit:hook', 'sync']).status, 'won');
  assert.equal(replay(level, ['commit:early', 'sync']).status, 'won');
});

test('auto-sync does not start another sync to a commit whose sync failed', () => {
  const level = tiny({ policy: { auto: true, selfHeal: true }, images: { 'app:1': 'ok', 'bad:1': 'fails' },
    events: [{ text: 'c', message: 'c', git: { 'Job/pre': { image: 'bad:1', hook: 'PreSync' }, 'ConfigMap/app': { MODE: 'b' } } },
      { text: 'later' }] });
  const state = replay(level, ['wait', 'wait']);
  assert.equal(state.syncs.filter((s) => !s.ok).length, 1, 'one failed attempt, not two');
  assert.equal(state.live['ConfigMap/app'].MODE, 'a', 'nothing was applied');
});

test('a check after an event loses the level if the app is not Synced and Healthy', () => {
  const level = tiny({ events: [{ text: 'night', live: scaleTo5, check: true }] });
  assert.equal(replay(level, ['wait']).status, 'lost');
});

test('running out of actions loses', () => {
  const level = tiny({ maxActions: 1, events: [{ text: 'a' }, { text: 'b' }] });
  assert.equal(replay(level, ['refresh']).status, 'lost');
});

test('nothing changes after the level is over', () => {
  const level = tiny({ events: [{ text: 'later' }] });
  const won = replay(level, ['wait']);
  assert.equal(won.status, 'won');
  assert.deepEqual(apply(won, 'refresh'), won);
});

test('an input the level does not offer, or a switch that is already set, is rejected', () => {
  const level = tiny({ actions: ['sync', 'self-heal'], events: [{ text: 'later' }] });
  assert.throws(() => apply(start(level), 'wait'));
  assert.throws(() => apply(start(level), 'self-heal:on'), 'self-heal needs auto-sync');
  assert.ok(inputs(level).includes('self-heal:on'));
});

test('a field dropped from Git is removed by the next sync: replicas falls back to 1', () => {
  const level = tiny({ commits: [{ id: 'c', label: 'c', message: 'c', git: { 'Deployment/app': { replicas: null } } }],
    events: [{ text: 'later' }] });
  const committed = replay(level, ['commit:c', 'refresh']);
  assert.equal(badges(committed).sync, 'OutOfSync', 'the live object still has the field Argo CD applied');
  const synced = apply(committed, 'sync');
  assert.equal(synced.live['Deployment/app'].replicas, 1);
  assert.equal(badges(synced).sync, 'Synced');
});

test('an ignored field stops counting in the diff, but a sync still writes the value from Git', () => {
  const level = tiny({ edits: [{ id: 'e', label: 'kubectl scale', live: scaleTo5 }],
    ignores: [{ id: 'r', resource: 'Deployment/app', field: 'replicas', pointer: '/spec/replicas' }],
    events: [{ text: 'later' }] });
  const ignoring = replay(level, ['ignore:r', 'edit:e']);
  assert.equal(badges(ignoring).sync, 'Synced');
  assert.equal(apply(ignoring, 'sync').live['Deployment/app'].replicas, 2);
});

test('turning auto-sync off also turns off self-heal and prune', () => {
  const level = tiny({ policy: { auto: true, selfHeal: true, prune: true }, events: [{ text: 'later' }] });
  const off = apply(start(level), 'auto:off');
  assert.deepEqual([off.settings.auto, off.settings.selfHeal, off.settings.prune], [false, false, false]);
});

test('a notBest input caps a win at 2 stars', () => {
  const level = tiny({ events: [{ text: 'later' }], solution: ['wait', 'wait'],
    notBest: [{ label: 'refresh first', input: 'refresh', moves: ['refresh', 'wait'], why: 'just to test' }] });
  assert.equal(stars(replay(level, ['wait', 'wait'])), 3);
  assert.equal(stars(replay(level, ['refresh', 'wait'])), 2, 'as short as the solution, but capped');
});
