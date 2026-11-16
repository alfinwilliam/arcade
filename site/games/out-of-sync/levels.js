// LEVELS for Out of Sync, the Argo CD puzzle.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// How the game works (the rules live in logic.js):
//   - Git is a list of commits; the cluster is a set of live resources. Argo CD compares the
//     commit it last fetched with the cluster and shows two badges, worked out every time:
//       sync status  Synced, or OutOfSync if any resource is missing, has a field that differs
//                    from Git (unless ignored), or is still running after Git dropped it.
//       health       the worst of: Healthy < Progressing < Missing < Degraded (Argo CD's own order;
//                    it also has Suspended and Unknown, which the game does not use).
//   - Every input uses one action. Most change nothing about time. "wait" lets time pass: the
//     next event in `events` happens, Argo CD polls Git (by default every 120 seconds plus up to
//     60 seconds of jitter, so at most 3 minutes apart), auto-sync may act, and a rollout that
//     cannot finish turns from Progressing to Degraded (in real life once it passes the
//     Deployment's progressDeadlineSeconds, 600 by default).
//   - Win: every event has happened, Argo CD has seen the newest commit, and the app is
//     Synced and Healthy. Lose: out of actions, a failed check (see events), or an outage
//     (an image marked 'needs-migration' started before its migration Job finished).
//   - Argo CD rules modelled, as documented:
//       manual sync      applies the newest commit; never deletes unless it is "sync with prune".
//       auto-sync        syncs when OutOfSync, once per commit. It does not sync the same commit
//                        again unless self-heal is on; once a sync to a commit has failed (after
//                        its own automatic retries, which the game folds into one try) it does not
//                        start another sync to that commit; and it skips a sync whose only change
//                        is a deletion unless prune is on.
//       self-heal/prune  only exist with auto-sync on; turning auto-sync off (removing the
//                        automated block) clears both.
//       rollback         re-applies the commit of the sync before the last one. Refused while
//                        auto-sync is on.
//       git revert HEAD  a new commit with the manifests of the commit before HEAD.
//       ignore           (ignoreDifferences) the field stops counting in the diff, but a sync
//                        still writes Git's value (the RespectIgnoreDifferences=true sync option
//                        changes that; the game does not model it).
//       sync order       PreSync hooks first, then sync waves from the lowest; a wave starts
//                        only after the earlier waves are synced and healthy. Inside a wave all
//                        is applied together.
//       removed field    if Git drops a field Argo CD applied before, the next sync removes it from
//                        the live object (Argo CD's default client-side apply does this), so a
//                        Deployment's replicas falls back to the default, 1.
//       HPA              a live HorizontalPodAutoscaler sets replicas on the Deployment of the same
//                        name (its target, in this game) to the level's `hpa` number, kept within
//                        its min and max.
//   Not modelled: a plain Job's pod template cannot be changed after it is created, so in real
//   life a non-hook Job whose image changes in Git fails the sync. Keep migrations as hooks.
//
// Resources (in git, drift, commits, edits and events): an object keyed 'Kind/name', each a flat
// object of fields. Field names are free, but these have meaning:
//   Deployment  image ('sample-app:1.5.0'), replicas (a whole number)
//   Job         image (the migration it runs). A Job with hook: 'PreSync' is a hook: it runs
//               before each sync and is never compared. Only 'PreSync' is allowed.
//   any kind    wave: a whole number, the sync wave (leave it out for wave 0)
//   HorizontalPodAutoscaler  min, max
//   others (ConfigMap data, Service port ...) are compared but have no other effect.
// A patch is the same shape, but a field set to null removes that field, and 'Kind/name': null
// removes the whole resource.
//
// Schema for a level (every field is required unless it says optional):
//   id          unique text, starting "oos-"
//   title       shown above the level
//   hint        one or two sentences shown while playing: the situation
//   lesson      one plain sentence for the win screen and the lessons page. It must be true.
//   inRealLife  1 to 3 snippets, { label, code }: the real Argo CD config or command. At most
//               14 lines each.
//   docs        1 to 3 links (full https addresses) to official documentation for the lesson
//   tempting    1 to 3 wrong ideas shown on the win screen as "Why not just ...":
//               { label, moves, why }. moves is a list of inputs, from the start of the level,
//               that plays the idea through. The tests check that after them the level is lost,
//               or the app is not both Synced and Healthy; so include the Waits that show it fail.
//   notBest     optional: ideas that do win this time but are not the habit to keep, also shown
//               under "Why not just ...": { label, input, moves, why }. A win whose inputs include
//               `input` earns at most 2 stars, and the win screen says why. moves is an example
//               win that uses input. Leave the field out when a level has none.
//   images      what each image tag does: 'ok', 'crash' (exits on start), 'needs-migration'
//               (works only after a Job with the same image has finished), or 'fails' (a Job
//               that fails). A tag that is not listed does not exist in the registry.
//   git         the commits, oldest first, at least one. The first is { message, manifests }
//               with every resource; each later one is { message, change } with a patch.
//   synced      optional: the commit numbers (1 = the first) Argo CD synced, oldest first.
//               The cluster starts as the last of them. Default: the newest commit only.
//   drift       optional: a patch applied to the cluster at the start (hand-made changes)
//   policy      optional: { auto, selfHeal, prune } true/false. Default: manual sync.
//   hpa         optional: the replicas the HPA wants at the start (needs a live HPA resource)
//   actions     which plain actions the player gets, from:
//                 'sync' 'sync-prune' 'refresh' 'rollback' 'revert' 'wait'
//                 'auto' 'self-heal' 'prune'  (switches; inputs 'auto:on', 'auto:off' ...)
//   commits     fixes the player may commit: [{ id, label, message, git: patch }]. [] for none.
//               Input 'commit:<id>'. A commit that would change nothing cannot be used.
//   edits       kubectl changes the player may make: [{ id, label, live: patch }]. [] for none.
//               Input 'edit:<id>'. Write the real command in label.
//   ignores     fields the player may ignore: [{ id, resource, field, pointer }]. [] for none.
//               Input 'ignore:<id>'. pointer is the JSON pointer shown, e.g. '/spec/replicas'.
//   events      what happens each time the player waits, in order. [] for none. Each:
//                 { text, git: patch, message, live: patch, hpa: number, check: true }
//               text is required; the rest optional. git is a teammate's commit (it needs a
//               message). live is a change made by hand. hpa changes what the HPA wants.
//               check: true means the app must be Synced and Healthy after this event, or the
//               level is lost.
//   maxActions  how many inputs the player gets, Wait included
//   solution    a list of inputs that wins. The tests replay it, so a level that cannot be
//               won as written fails `python3 scripts/arcade.py test out-of-sync`.
//
// Stars: 3 for a win in as many inputs as the solution, one fewer for each extra input, never
// fewer than 1; at most 2 if the win used a notBest input.
//
// The tests also check, for every level: ids are unique and start "oos-"; every word in actions
// is one from the list above; the ids inside commits, edits and ignores are unique; the solution
// wins with 3 stars and fits in maxActions; doing nothing does not win; tempting has 1 to 3
// entries, each with a label and a why, and its moves fail as described above; each notBest
// entry has a label and a why, its moves win with at most 2 stars and include its input, and the
// solution does not use that input; lesson is not empty; inRealLife has 1 to 3 snippets of at
// most 14 lines; docs has 1 to 3 https links; an event with git has a message.
//
// To add a level: copy an entry, change it, open the game with ?dev on the end of the URL,
// win it, and paste the inputs it shows into `solution`.

const REPO = 'https://git.example.com/platform/sample-app-config.git';

export const levels = [
  {
    id: 'oos-01',
    title: 'Out of sync',
    hint: 'Git now says 1.5.0 plus a new ConfigMap, but the cluster still runs 1.4.0. The sync policy is manual, so nothing changes until you sync.',
    lesson: 'Git holds what should run and the cluster is what does run; when they differ Argo CD marks the app OutOfSync, and without an automated sync policy nothing changes until someone syncs, after every new commit.',
    inRealLife: [
      { label: 'Argo CD Application', code:
`apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: sample-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ${REPO}
    targetRevision: main
    path: deploy
  destination:
    server: https://kubernetes.default.svc   # the cluster Argo CD runs in
    namespace: sample` },
      { label: 'argocd CLI', code:
`argocd app diff sample-app   # what a sync would change
argocd app sync sample-app   # apply Git to the cluster
argocd app get sample-app    # Sync Status and Health Status` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/core_concepts/',
      'https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_sync/',
    ],
    tempting: [
      { label: 'Wait for Argo CD to do it', moves: ['wait'], why: 'With a manual sync policy Argo CD only reports the difference. Nothing is applied until someone syncs.' },
    ],
    images: { 'sample-app:1.4.0': 'ok', 'sample-app:1.5.0': 'ok' },
    git: [
      { message: 'Release 1.4.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.4.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
      } },
      { message: 'Release 1.5.0 with a ConfigMap', change: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0' },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
      } },
    ],
    synced: [1],
    actions: ['sync', 'refresh', 'wait'],
    commits: [],
    edits: [],
    ignores: [],
    events: [
      { text: 'Noon: the release check. Is 1.5.0 live?', check: true },
      { text: 'Afternoon: a teammate merges "Set LOG_LEVEL=debug".', message: 'Set LOG_LEVEL=debug',
        git: { 'ConfigMap/sample-app-config': { LOG_LEVEL: 'debug' } } },
    ],
    maxActions: 5,
    solution: ['sync', 'wait', 'wait', 'sync'],
  },

  {
    id: 'oos-02',
    title: 'Synced but Degraded',
    hint: 'The 1.6.0 commit is synced, but CI never pushed a 1.6.0 image. The build that worked was pushed as 1.6.1.',
    lesson: 'Synced only means the cluster matches Git, not that it works: a commit that names an image tag that does not exist syncs fine, shows Progressing, and turns Degraded once the rollout passes its progress deadline (10 minutes by default); syncing it again changes nothing, so fix the commit in Git.',
    inRealLife: [
      { label: 'kubectl', code:
`kubectl -n sample rollout status deployment/sample-app
# fails once the rollout passes its progress deadline
kubectl -n sample get pods
# new pods show ErrImagePull or ImagePullBackOff` },
      { label: 'git and argocd CLI', code:
`sed -i 's/sample-app:1.6.0/sample-app:1.6.1/' deploy/deployment.yaml
git commit -am "Use 1.6.1, the tag CI pushed"
git push
argocd app sync sample-app` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/operator-manual/health/',
      'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#failed-deployment',
    ],
    tempting: [
      { label: 'Sync again', moves: ['sync'], why: 'A sync applies the same commit again. The tag still does not exist, so the new pods still cannot pull it.' },
      { label: 'Fix the image with kubectl', moves: ['edit:set-image'], why: 'The pods recover, but the cluster no longer matches Git, so the app is OutOfSync, and the next sync puts 1.6.0 back.' },
    ],
    images: { 'sample-app:1.5.0': 'ok', 'sample-app:1.6.1': 'ok' },
    git: [
      { message: 'Release 1.5.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
      } },
      { message: 'Release 1.6.0', change: { 'Deployment/sample-app': { image: 'sample-app:1.6.0' } } },
    ],
    synced: [1, 2],
    actions: ['sync', 'refresh', 'revert', 'wait'],
    commits: [
      { id: 'tag-161', label: 'set the image to sample-app:1.6.1', message: 'Use 1.6.1, the tag CI pushed',
        git: { 'Deployment/sample-app': { image: 'sample-app:1.6.1' } } },
      { id: 'replicas-5', label: 'raise replicas to 5', message: 'More replicas',
        git: { 'Deployment/sample-app': { replicas: 5 } } },
    ],
    edits: [
      { id: 'set-image', label: 'kubectl set image deployment/sample-app app=sample-app:1.6.1',
        live: { 'Deployment/sample-app': { image: 'sample-app:1.6.1' } } },
    ],
    ignores: [],
    events: [],
    maxActions: 4,
    solution: ['commit:tag-161', 'sync'],
  },

  {
    id: 'oos-03',
    title: 'Night shift',
    hint: 'Auto-sync is on. Every night someone changes the cluster by hand, and every morning a check wants it to match Git again.',
    lesson: 'Auto-sync applies new commits, but by default it leaves changes made by hand in the cluster alone; self-heal makes Argo CD sync again whenever the live state drifts from Git.',
    inRealLife: [
      { label: 'Argo CD Application', code:
`apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: sample-app
  namespace: argocd
spec:
  # project, source and destination as before
  syncPolicy:
    automated:
      selfHeal: true   # undo live changes that drift from Git` },
      { label: 'argocd CLI', code: 'argocd app set sample-app --self-heal' },
    ],
    docs: ['https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/'],
    tempting: [
      { label: 'Rely on auto-sync', moves: ['wait'], why: 'Auto-sync already synced this commit. Without self-heal it does not sync the same commit again, so the hand edit stays.' },
      { label: 'Sync before bed', moves: ['sync', 'wait'], why: 'The cluster matches Git when you sync, but the edit happens later, while you sleep.' },
    ],
    images: { 'sample-app:1.5.0': 'ok' },
    git: [
      { message: 'Release 1.5.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
      } },
    ],
    policy: { auto: true },
    actions: ['sync', 'refresh', 'self-heal', 'wait'],
    commits: [],
    edits: [],
    ignores: [],
    events: [
      { text: 'Night 1: a teammate runs kubectl scale deployment sample-app --replicas=5. Morning check.',
        live: { 'Deployment/sample-app': { replicas: 5 } }, check: true },
      { text: 'Night 2: someone runs kubectl edit configmap sample-app-config and sets LOG_LEVEL=debug. Morning check.',
        live: { 'ConfigMap/sample-app-config': { LOG_LEVEL: 'debug' } }, check: true },
      { text: 'Night 3: kubectl delete service sample-app, run in the wrong terminal. Morning check.',
        live: { 'Service/sample-app': null }, check: true },
    ],
    maxActions: 5,
    solution: ['self-heal:on', 'wait', 'wait', 'wait'],
  },

  {
    id: 'oos-04',
    title: 'Gone from Git, still running',
    hint: 'Auto-sync and self-heal are on; prune is not. A teammate is about to delete the legacy ConfigMap from Git.',
    lesson: 'When a resource is deleted from Git, Argo CD marks it as needing pruning but leaves it in the cluster; it deletes it only on a sync with prune, or when prune is turned on in the automated sync policy.',
    inRealLife: [
      { label: 'Argo CD Application', code:
`spec:
  syncPolicy:
    automated:
      prune: true      # delete what was removed from Git
      selfHeal: true` },
      { label: 'argocd CLI', code:
`argocd app sync sample-app --prune   # once, by hand
argocd app set sample-app --auto-prune   # every auto-sync` },
      { label: 'Keep one resource from ever being pruned', code:
`metadata:
  annotations:
    argocd.argoproj.io/sync-options: Prune=false` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/',
      'https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/',
    ],
    tempting: [
      { label: 'Sync', moves: ['wait', 'sync', 'wait'], why: 'A sync without prune applies what is in Git but never deletes, so the ConfigMap stays and the app stays OutOfSync.' },
      { label: 'Trust self-heal', moves: ['wait', 'wait'], why: 'With prune off, auto-sync (self-heal included) skips a sync whose only change is a deletion, so nothing is deleted until prune is on in the policy.' },
    ],
    images: { 'sample-app:1.5.0': 'ok' },
    git: [
      { message: 'Release 1.5.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
        'ConfigMap/sample-app-legacy': { OLD_UI: 'on' },
      } },
    ],
    policy: { auto: true, selfHeal: true },
    actions: ['sync', 'sync-prune', 'refresh', 'prune', 'wait'],
    commits: [],
    edits: [],
    ignores: [],
    events: [
      { text: 'A teammate merges "Remove the legacy ConfigMap".', message: 'Remove the legacy ConfigMap',
        git: { 'ConfigMap/sample-app-legacy': null } },
      { text: 'Evening check.', check: true },
    ],
    maxActions: 4,
    solution: ['prune:on', 'wait', 'wait'],
  },

  {
    id: 'oos-05',
    title: 'Migrate first',
    hint: '2.0.0 needs a new database column, which the db-migrate Job adds in about five minutes. 2.0.0 passes its health check without the column, so if it takes traffic first, requests fail.',
    lesson: 'Argo CD runs PreSync hooks before it applies anything else and applies sync waves lowest first, starting a wave only when the earlier ones are synced and healthy, so a migration Job run as a PreSync hook finishes before the new version starts; a plain Job in an earlier wave also works once, but the next release that changes its image fails to sync, because a Job\'s pod template cannot be changed.',
    inRealLife: [
      { label: 'Job as a PreSync hook', code:
`apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/hook: PreSync   # runs on every sync: make it safe to repeat
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation   # the default
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: migrate
        image: registry.example.com/sample-app:2.0.0   # its command runs the migration` },
      { label: 'Or: an earlier sync wave (one release only)', code:
`metadata:
  name: db-migrate
  annotations:
    argocd.argoproj.io/sync-wave: "-1"   # the default wave is 0
# A plain Job's pod template cannot be changed, so the next release
# that changes its image fails the sync ("field is immutable").
# A hook avoids that: BeforeHookCreation deletes the old Job first.` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/',
      'https://kubernetes.io/docs/concepts/workloads/controllers/job/#mutable-scheduling-directives',
    ],
    tempting: [
      { label: 'Just sync', moves: ['sync'], why: 'The Job and the Deployment are in the same wave, so Argo CD applies both together and 2.0.0 starts while the migration still runs.' },
      { label: 'Put the Job in wave 1', moves: ['commit:wave-late', 'sync'], why: 'Waves run lowest first. The Deployment is in wave 0, so wave 1 runs the migration after 2.0.0 has started.' },
    ],
    notBest: [
      { label: 'Put the Job in wave -1', input: 'commit:wave-early', moves: ['commit:wave-early', 'sync'],
        why: 'It works for this release, because wave -1 finishes before wave 0 starts. But a plain Job\'s pod template cannot be changed, so the next release that changes its image fails to sync ("field is immutable"). As a PreSync hook, the default BeforeHookCreation policy deletes the old Job first. That is why only the hook earns three stars.' },
    ],
    images: { 'sample-app:1.5.0': 'ok', 'sample-app:2.0.0': 'needs-migration' },
    git: [
      { message: 'Release 1.5.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
      } },
      { message: 'Release 2.0.0 with a database migration', change: {
        'Deployment/sample-app': { image: 'sample-app:2.0.0' },
        'Job/db-migrate': { image: 'sample-app:2.0.0' },
      } },
    ],
    synced: [1],
    actions: ['sync', 'refresh', 'wait'],
    commits: [
      { id: 'hook', label: 'make db-migrate a PreSync hook', message: 'Run db-migrate as a PreSync hook',
        git: { 'Job/db-migrate': { hook: 'PreSync' } } },
      { id: 'wave-early', label: 'put db-migrate in sync wave -1', message: 'Migrate in wave -1',
        git: { 'Job/db-migrate': { wave: -1 } } },
      { id: 'wave-late', label: 'put db-migrate in sync wave 1', message: 'Migrate in wave 1',
        git: { 'Job/db-migrate': { wave: 1 } } },
    ],
    edits: [],
    ignores: [],
    events: [],
    maxActions: 3,
    solution: ['commit:hook', 'sync'],
  },

  {
    id: 'oos-06',
    title: 'Roll back under auto-sync',
    hint: 'Auto-sync and self-heal are on, and release 1.6.0 crashes on start. Get 1.5.0 running again, matching Git, before the evening check.',
    lesson: 'With auto-sync on, Argo CD refuses a rollback, and with self-heal on it also undoes a fix made by hand, so you roll back in Git: git revert makes a new commit that restores the old version, and auto-sync deploys it.',
    inRealLife: [
      { label: 'git', code:
`git revert HEAD    # a new commit that undoes the bad release
git push           # auto-sync deploys it on its next poll` },
      { label: 'argocd CLI', code:
`argocd app get sample-app --refresh   # fetch Git now, not at the next poll
argocd app history sample-app         # what was synced, and when
argocd app rollback sample-app        # only with auto-sync off` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/',
      'https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_rollback/',
    ],
    tempting: [
      { label: 'Roll back in Argo CD', moves: ['rollback', 'wait'], why: 'Argo CD does not allow a rollback while auto-sync is on.' },
      { label: 'Turn auto-sync off, then roll back', moves: ['auto:off', 'rollback', 'wait'], why: 'The cluster runs 1.5.0, but Git still says 1.6.0, so the app is OutOfSync. Turning auto-sync back on would deploy 1.6.0 again.' },
      { label: 'kubectl set image', moves: ['edit:set-image', 'wait'], why: 'Self-heal puts 1.6.0 back within seconds, because Git still says 1.6.0.' },
    ],
    images: { 'sample-app:1.5.0': 'ok', 'sample-app:1.6.0': 'crash' },
    git: [
      { message: 'Release 1.5.0', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
      } },
      { message: 'Release 1.6.0', change: { 'Deployment/sample-app': { image: 'sample-app:1.6.0' } } },
    ],
    synced: [1, 2],
    policy: { auto: true, selfHeal: true },
    actions: ['sync', 'refresh', 'rollback', 'revert', 'auto', 'wait'],
    commits: [],
    edits: [
      { id: 'set-image', label: 'kubectl set image deployment/sample-app app=sample-app:1.5.0',
        live: { 'Deployment/sample-app': { image: 'sample-app:1.5.0' } } },
    ],
    ignores: [],
    events: [
      { text: 'Evening: the on-call check.', check: true },
    ],
    maxActions: 4,
    solution: ['revert', 'wait'],
  },

  {
    id: 'oos-07',
    title: 'Self-heal vs the autoscaler',
    hint: 'Git says 3 replicas. The HPA scales sample-app between 2 and 8 with load. Auto-sync and self-heal are on.',
    lesson: 'When an autoscaler owns a field such as replicas and Git sets it too, self-heal and the HPA keep undoing each other; leave the field out of Git, or list it under ignoreDifferences so Argo CD stops comparing it.',
    inRealLife: [
      { label: 'Argo CD Application', code:
`spec:
  ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
    - /spec/replicas
  syncPolicy:
    automated:
      selfHeal: true
    syncOptions:
    - RespectIgnoreDifferences=true   # a sync keeps the live value too` },
      { label: 'Or: leave replicas out of Git', code:
`apiVersion: apps/v1
kind: Deployment
metadata: { name: sample-app }
spec:
  # no replicas: the HPA owns it. The first sync after you remove it
  # drops the field, so 1 pod runs (the default) until the HPA scales up.
  selector:
    matchLabels: { app: sample-app }
  template:
    metadata: { labels: { app: sample-app } }
    spec:
      containers:
      - name: app
        image: registry.example.com/sample-app:1.5.0` },
    ],
    docs: [
      'https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/',
      'https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/',
      'https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/#migrating-deployments-and-statefulsets-to-horizontal-autoscaling',
    ],
    tempting: [
      { label: 'Turn off self-heal', moves: ['self-heal:off', 'wait'], why: 'The fight stops, but the HPA\'s 6 replicas still differ from the 3 in Git, so the app stays OutOfSync.' },
      { label: 'Pin 6 replicas in Git', moves: ['commit:pin-6', 'wait', 'wait'], why: 'That matches the lunch rush, but in the evening the HPA wants 2 and the fight starts again.' },
    ],
    images: { 'sample-app:1.5.0': 'ok' },
    git: [
      { message: 'Release 1.5.0 with an autoscaler', manifests: {
        'Deployment/sample-app': { image: 'sample-app:1.5.0', replicas: 3 },
        'Service/sample-app': { port: 80 },
        'ConfigMap/sample-app-config': { LOG_LEVEL: 'info' },
        'HorizontalPodAutoscaler/sample-app': { min: 2, max: 8 },
      } },
    ],
    policy: { auto: true, selfHeal: true },
    hpa: 3,
    actions: ['sync', 'refresh', 'self-heal', 'wait'],
    commits: [
      { id: 'drop-replicas', label: 'remove replicas from the Deployment', message: 'Let the HPA own replicas',
        git: { 'Deployment/sample-app': { replicas: null } } },
      { id: 'pin-6', label: 'set replicas to 6', message: 'Run 6 replicas',
        git: { 'Deployment/sample-app': { replicas: 6 } } },
    ],
    edits: [],
    ignores: [
      { id: 'replicas', resource: 'Deployment/sample-app', field: 'replicas', pointer: '/spec/replicas' },
    ],
    events: [
      { text: 'Lunch rush: load climbs and the HPA wants 6 replicas. Afternoon check.', hpa: 6, check: true },
      { text: 'Evening: a teammate merges "Set LOG_LEVEL=warn" and load drops (the HPA wants 2). Night check.',
        message: 'Set LOG_LEVEL=warn', git: { 'ConfigMap/sample-app-config': { LOG_LEVEL: 'warn' } }, hpa: 2, check: true },
    ],
    maxActions: 4,
    solution: ['ignore:replicas', 'wait', 'wait'],
  },
];
