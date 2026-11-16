// LEVELS for Canary, an Istio traffic-shifting game.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// The story of every level: the service sample-app (namespace sample) runs version v1. Version
// v2 is ready, and something may be wrong with it. Each round a fixed batch of requests flows
// through the mesh; before each round the player sets the routing. The level is WON when a
// round ends with v2 on 100% and healthy (see below), or when the player rolls back to v1 and
// names the right cause. It is LOST when the failed user requests add up to more than the
// budget, when the rounds run out, or when a rollback names the wrong cause.
//
// "Healthy" in a round means: v2 served users, none of them got an error, none of v2's pods
// answered with a 5xx, and v2's p99 latency was within p99Limit.
// A rollback is only accepted once v2 has shown a problem (a failed try, or p99 over the limit).
// Testers' failures and mirrored copies' failures never count against the budget.
//
// The rules that turn these numbers into a round are at the top of logic.js.
//
// Schema for a level (every field is required unless it says optional):
//   id          unique text, starting "cn-"
//   title       shown above the level
//   brief       one to three sentences shown while playing: the situation, not the answer
//   hint        one or two sentences shown after a loss: what to try next
//   lesson      one plain sentence for the win screen. It must be true of real Istio.
//   inRealLife  1 to 3 snippets { label, code }, each at most 18 lines: the real YAML or command.
//               A snippet that mentions networking.istio.io must start with the line
//               apiVersion: networking.istio.io/v1
//   docs        1 to 3 official documentation URLs (https://) that back the lesson
//   (Every number below is a whole number.)
//   users       user requests per round, 1 or more (1000 makes the weights read as counts)
//   testers     optional: tester requests per round, sent with the header x-canary: true
//               (needed, 1 or more, if tools has 'header'; default 0)
//   rounds      how many rounds the player may run, 1 or more
//   budget      how many failed user requests the level allows in total (0 or more)
//   p99Limit    the p99 latency, in ms, v2 must stay within to count as healthy (1 or more)
//   tools       the controls on offer, from: 'weight', 'header', 'mirror', 'timeout',
//               'retries', 'outlier'. 'weight' must be there.
//   choices     optional: replace a control's list of values, e.g. { timeout: [0, 500, 1000] }.
//               Only for mirror, timeout, retries and outlier. The defaults are in logic.js
//               (DEFAULT_CHOICES). Lists of whole numbers, 0 or more.
//   start       optional: the routing the level starts with, e.g. { header: 'last', retries: 3 }.
//               Otherwise everything starts at 0 / 'off'. Only controls in `tools`, values
//               among the choices, and the weight a multiple of 5 below 100.
//   maxStep     optional: the most v2's weight may rise above the last round's weight
//               (a multiple of 5)
//   rollback    optional: false means the player may not roll back (v2 must ship)
//   fault       what is really wrong with v2: null (nothing), or a cause id from `causes` below.
//               With rollback: false the fault is shown for the record only.
//   v1, v2      each version's hidden traits:
//                 pods          how many pods (1 or more)
//                 ms            normal latency of an answer, in ms (1 or more)
//                 podCapacity   tries one pod serves in a round at normal speed (1 or more).
//                               Above the version's total, the excess is turned away (503) and
//                               the rest slow down by tries / capacity. (The game's own rule.)
//                 errorPct      optional: percent (0 to 100) of tries that fail with a 500 on
//                               every pod
//                 testerErrorPct optional: the same for testers' requests (default errorPct)
//                 slowPct       optional: percent (0 to 100) of good tries that take slowMs
//                 slowMs        how long a slow try takes, in ms (needed when slowPct is set)
//                 badPod        optional: the number of one pod (1 to pods) that fails every try
//   solution    a list of inputs that wins. The tests replay it, and its rounds and failed
//               requests are the bar for three stars. Inputs:
//                 'weight 10'  'header first'  'header last'  'header off'  'mirror 100'
//                 'timeout 500'  'retries 2'  'outlier 5'  'run'  'rollback bug'
//               Only controls in `tools` may be used; weights go in steps of 5.
//   traps       optional: inputs that must LOSE, and how: [{ inputs, reason }] where reason is
//                 'budget'  more failed user requests than the budget
//                 'rounds'  the rounds ran out
//                 'cause'   a rollback named the wrong cause
//               These are the mistakes the lesson is about. The tests check each one.
//
// The tests also check: ids are unique; the solution wins within `rounds`; doing nothing
// (no inputs, or one 'run' at the start routing) does not win; a level with fault null is
// won by reaching 100%; a level with rollback: false is won by reaching 100%; every field
// above is within its limits.
//
// To add a level: copy an entry to the end of the list, give it a new id, change the traits,
// and set solution and traps to []. Open the game with ?dev&level=8 on the end of the URL
// (8 = the level's place in this list), win the level, and paste the inputs the win screen
// shows into `solution`. Add a trap or two: a wrong play and how it loses (try it first with
// ?dev&level=8&play=weight 100,run). Then run `python3 scripts/arcade.py test canary`.
// A rollback level reads best when its fault differs from the level before it, so the player
// has to read the numbers instead of repeating the last answer.

// The causes a player can name when rolling back. A level's `fault` is one of these ids.
export const causes = [
  { id: 'bug', text: 'A bug in v2: some requests fail on every v2 pod' },
  { id: 'pod', text: 'One bad v2 pod: its requests fail, the other pods are fine' },
  { id: 'slow', text: 'v2 is slow: answers arrive, but late' },
  { id: 'capacity', text: 'v2 runs short of capacity: fine at low traffic, failing as load grows' },
];

const v1 = { pods: 4, ms: 100, podCapacity: 1000 };

export const levels = [
  {
    id: 'cn-01',
    title: 'Small steps',
    brief: 'v2 is ready. The release rule says v2 may gain at most 25 points of traffic per round. Move all users to v2 without a single failed request.',
    hint: 'Raise the v2 weight by 25 before every round: 25, 50, 75, 100.',
    lesson: 'Sending a small share of users to the new version first, then more in steps, is a canary release; in Istio the weights on a VirtualService route set each version\'s share.',
    inRealLife: [
      { label: 'Istio VirtualService', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - route:
        - destination: { host: sample-app, subset: v1 }
          weight: 75
        - destination: { host: sample-app, subset: v2 }
          weight: 25` },
      { label: 'Istio DestinationRule', code: `apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: sample-app
  namespace: sample
spec:
  host: sample-app
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }` },
    ],
    docs: [
      'https://istio.io/latest/docs/tasks/traffic-management/traffic-shifting/',
      'https://istio.io/latest/docs/concepts/traffic-management/',
    ],
    users: 1000,
    rounds: 5,
    budget: 0,
    p99Limit: 500,
    tools: ['weight'],
    maxStep: 25,
    fault: null,
    v1,
    v2: { pods: 4, ms: 110, podCapacity: 1000 },
    solution: ['weight 25', 'run', 'weight 50', 'run', 'weight 75', 'run', 'weight 100', 'run'],
    traps: [
      { inputs: ['weight 25', 'run', 'run', 'run', 'run', 'run'], reason: 'rounds' },
    ],
  },
  {
    id: 'cn-02',
    title: 'Catch it at 5%',
    brief: 'v2 passed its tests, but tests are not production. You can afford 20 failed user requests in total. Find out whether v2 is safe.',
    hint: 'Start with a small share such as 5%. If v2 fails there, set it back to 0 and roll back with the cause the numbers point to.',
    lesson: 'Starting with a small share limits the blast radius: a bad v2 on 5% fails only a few requests, and putting all the weight back on v1 is the rollback.',
    inRealLife: [
      { label: 'Istio VirtualService (the 5% canary)', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - route:
        - destination: { host: sample-app, subset: v1 }
          weight: 95
        - destination: { host: sample-app, subset: v2 }
          weight: 5` },
      { label: 'kubectl (roll back: all weight to v1)', code: `kubectl -n sample patch virtualservice sample-app --type=json -p='[
  {"op": "replace", "path": "/spec/http/0/route/0/weight", "value": 100},
  {"op": "replace", "path": "/spec/http/0/route/1/weight", "value": 0}
]'` },
    ],
    docs: [
      'https://istio.io/latest/docs/tasks/traffic-management/traffic-shifting/',
      'https://istio.io/latest/docs/reference/config/networking/virtual-service/',
    ],
    users: 1000,
    rounds: 4,
    budget: 20,
    p99Limit: 500,
    tools: ['weight'],
    fault: 'bug',
    v1,
    v2: { pods: 4, ms: 110, podCapacity: 1000, errorPct: 20 },
    solution: ['weight 5', 'run', 'rollback bug'],
    traps: [
      { inputs: ['weight 25', 'run'], reason: 'budget' },
      { inputs: ['weight 5', 'run', 'rollback pod'], reason: 'cause' },
    ],
  },
  {
    id: 'cn-03',
    title: 'Testers first',
    brief: 'Your testers send the header x-canary: true, and someone already wrote a route that sends them to v2. Not one user request may fail this time.',
    hint: 'Look at where the testers\' route sits. Routes are checked from the top, and the route with no match catches everything.',
    lesson: 'Istio checks a VirtualService\'s HTTP routes from the top and uses the first that matches, so a header route for testers must sit above the catch-all route or it never gets a request.',
    inRealLife: [
      { label: 'Istio VirtualService', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - match:                 # checked first
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination: { host: sample-app, subset: v2 }
    - route:                 # no match: everyone else
        - destination: { host: sample-app, subset: v1 }` },
    ],
    docs: [
      'https://istio.io/latest/docs/tasks/traffic-management/request-routing/',
      'https://istio.io/latest/docs/concepts/traffic-management/',
    ],
    users: 1000,
    testers: 20,
    rounds: 4,
    budget: 0,
    p99Limit: 500,
    tools: ['weight', 'header'],
    start: { header: 'last' },
    fault: 'pod',
    v1,
    v2: { pods: 4, ms: 110, podCapacity: 1000, badPod: 2 },
    solution: ['header first', 'run', 'rollback pod'],
    traps: [
      { inputs: ['weight 5', 'run'], reason: 'budget' },
      { inputs: ['run', 'run', 'run', 'run'], reason: 'rounds' },
      { inputs: ['header first', 'run', 'rollback bug'], reason: 'cause' },
    ],
  },
  {
    id: 'cn-04',
    title: 'Shadow traffic',
    brief: 'The testers\' route works now. But real users run older apps and send requests your testers never do. Not one user request may fail.',
    hint: 'Testers only try what testers try. Mirroring sends v2 a copy of real requests and throws its answers away.',
    lesson: 'Mirroring sends v2 a copy of real requests and discards its answers, so v2 meets real traffic while users only ever get v1\'s answers; Istio calls this mirroring, also called shadowing.',
    inRealLife: [
      { label: 'Istio VirtualService (excerpt: the testers\' route above this one is left out)', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - route:
        - destination: { host: sample-app, subset: v1 }
          weight: 100
      mirror: { host: sample-app, subset: v2 }
      mirrorPercentage:
        value: 100.0` },
    ],
    docs: [
      'https://istio.io/latest/docs/tasks/traffic-management/mirroring/',
      'https://istio.io/latest/docs/reference/config/networking/virtual-service/',
    ],
    users: 1000,
    testers: 20,
    rounds: 4,
    budget: 0,
    p99Limit: 500,
    tools: ['weight', 'header', 'mirror'],
    start: { header: 'first' },
    fault: 'bug',
    v1,
    v2: { pods: 4, ms: 110, podCapacity: 1000, errorPct: 5, testerErrorPct: 0 },
    solution: ['mirror 100', 'run', 'rollback bug'],
    traps: [
      { inputs: ['run', 'weight 5', 'run'], reason: 'budget' },
    ],
  },
  {
    id: 'cn-05',
    title: 'Slow, not broken',
    brief: 'v2 carries a fix users need today, so it must ship. It never returns an error, yet its p99 must be under 1000 ms. Some of its answers are very slow, and asking again usually gets a fast one.',
    hint: 'A timeout alone turns slow answers into errors. A timeout per try plus retries gives up on a slow try and asks again.',
    lesson: 'Istio sets no request timeout by default, so a slow answer keeps the caller waiting; a per-try timeout gives up on a slow try, and retries ask again.',
    inRealLife: [
      { label: 'Istio VirtualService (v2 on 100%)', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - route:
        - destination: { host: sample-app, subset: v2 }
      retries:
        attempts: 2
        perTryTimeout: 500ms
        retryOn: 5xx   # 5xx includes a try that hit perTryTimeout` },
    ],
    docs: [
      'https://istio.io/latest/docs/tasks/traffic-management/request-timeouts/',
      'https://istio.io/latest/docs/reference/config/networking/virtual-service/',
      'https://istio.io/latest/docs/concepts/traffic-management/',
    ],
    users: 1000,
    rounds: 6,
    budget: 60,
    p99Limit: 1000,
    tools: ['weight', 'timeout', 'retries'],
    rollback: false,
    fault: 'slow',
    v1,
    v2: { pods: 4, ms: 100, podCapacity: 1000, slowPct: 5, slowMs: 3000 },
    solution: ['weight 10', 'run', 'timeout 500', 'retries 2', 'weight 100', 'run'],
    traps: [
      { inputs: ['weight 100', 'timeout 500', 'run', 'run'], reason: 'budget' },
      { inputs: ['weight 100', 'run', 'run', 'run', 'run', 'run', 'run'], reason: 'rounds' },
    ],
  },
  {
    id: 'cn-06',
    title: 'Retry storm',
    brief: 'v2 does more work per request, and it has three pods. The team\'s route retries every failure 3 times, with a 250 ms timeout per try. You can afford 160 failed user requests.',
    hint: 'When a service fails because it is busy, each retry is one more request it cannot serve. Try the step that showed trouble again with retries at 0.',
    lesson: 'Each retry is one more request, so retrying a service that fails because it is overloaded adds to its load, and with a short per-try timeout even answers that are only slow become failures that get retried: a few errors can grow into an outage, a retry storm.',
    inRealLife: [
      { label: 'Istio VirtualService (after the rollback: all to v1, retries off)', code: `apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: sample-app
  namespace: sample
spec:
  hosts:
    - sample-app
  http:
    - route:
        - destination: { host: sample-app, subset: v1 }
      timeout: 250ms
      retries:
        attempts: 0` },
      { label: 'kubectl', code: `# Is v2 short of CPU? Give it more pods before the next canary.
kubectl -n sample top pods -l app=sample-app,version=v2
kubectl -n sample scale deployment sample-app-v2 --replicas=6` },
    ],
    docs: [
      'https://istio.io/latest/docs/concepts/traffic-management/',
      'https://sre.google/sre-book/addressing-cascading-failures/',
    ],
    users: 1000,
    rounds: 5,
    budget: 160,
    p99Limit: 500,
    tools: ['weight', 'timeout', 'retries'],
    start: { timeout: 250, retries: 3 },
    fault: 'capacity',
    v1,
    v2: { pods: 3, ms: 200, podCapacity: 200 },
    solution: ['weight 50', 'run', 'retries 0', 'weight 70', 'run', 'rollback capacity'],
    traps: [
      { inputs: ['weight 50', 'run', 'weight 70', 'run'], reason: 'budget' },
      { inputs: ['weight 50', 'run', 'retries 0', 'weight 70', 'run', 'rollback bug'], reason: 'cause' },
    ],
  },
  {
    id: 'cn-07',
    title: 'One bad pod',
    brief: 'v2 must ship, but one of its four pods landed on a broken node and fails every request. You cannot touch the pods, only the mesh. You can afford 25 failed user requests.',
    hint: 'Outlier detection counts each pod\'s 5xx errors in a row and takes a pod that reaches the limit out of the pool.',
    lesson: 'Outlier detection takes a pod that keeps returning 5xx errors out of the load-balancing pool, so one bad pod stops failing a share of every request.',
    inRealLife: [
      { label: 'Istio DestinationRule', code: `apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: sample-app
  namespace: sample
spec:
  host: sample-app
  trafficPolicy:
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }` },
    ],
    docs: [
      'https://istio.io/latest/docs/reference/config/networking/destination-rule/',
      'https://istio.io/latest/docs/tasks/traffic-management/circuit-breaking/',
    ],
    users: 1000,
    rounds: 5,
    budget: 25,
    p99Limit: 500,
    tools: ['weight', 'outlier'],
    rollback: false,
    fault: 'pod',
    v1,
    v2: { pods: 4, ms: 100, podCapacity: 1000, badPod: 3 },
    solution: ['outlier 5', 'weight 10', 'run', 'weight 100', 'run'],
    traps: [
      { inputs: ['weight 100', 'run'], reason: 'budget' },
    ],
  },
];
