// LEVELS for Noisy Pager.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// Each level is one simulated day of one app ("sample-app"), scraped once a minute.
// The player builds one alerting rule and runs the day. The level is won when every
// incident is paged once, within its deadline, and nothing else pages.
//
// Times are 'HH:MM' text, between '00:00' and '23:59'. Durations are whole minutes.
// Use whole numbers for everything the generator reads (shape, noise, add, permille ...).
//
// Schema for a level (every field is required unless it says optional):
//   id          unique text, starting "np-"
//   title       shown above the level
//   brief       one or two sentences shown while playing: what the chart is and what is wrong
//   hint        one or two sentences shown after a run that loses: what to try next
//   lesson      one plain sentence shown on the win screen. It must be true of real Prometheus.
//   inRealLife  1 to 3 snippets { label, code }, each at most 14 lines, written as `backtick`
//               text so the lines can be typed as they are. The FIRST one must be exactly the
//               rule file the game prints for the solution's rule (the tests compare them).
//               Easiest way: win the level with ?dev on the URL and copy the "Prometheus rule"
//               block from the win screen. The win screen shows the player's own rule in its
//               place, then the other snippets.
//   docs        1 to 3 official documentation URLs (https://) that back the lesson
//   alert       { name, summary }: the alert's name and its summary annotation (no double quotes)
//   kind        what is scraped, and what the measures can read:
//                 'gauge'    one value that goes up and down       measures: value, up, absent
//                 'counter'  one counter (only goes up; resets)    measures: value, rate, up, absent
//                 'latency'  a request-duration histogram          measures: avg, p99, up, absent
//                 'errors'   a request counter and its 5xx part    measures: rate, ratio, burn, up, absent
//   metric      the metric name shown in PromQL, e.g. 'sample_app_queue_depth'. For 'latency' it is
//               the histogram's base name (the game adds _bucket, _sum, _count). For 'errors' it is
//               the request counter; errors are the requests with code=~"5..".
//   unit        optional, for 'gauge': the word under the numbers, e.g. 'jobs'
//   seed        any whole number: picks the noise. Change it to get a different but similar day.
//   shape       the normal day as [hour, value] points, from hour 0 to hour 24, straight lines
//               between them. For 'gauge' it is the value; for 'counter' how much the counter
//               grows per minute; for 'latency' and 'errors' the requests per minute.
//   noise       how far each minute may wander from the shape, plus or minus (whole number)
//   incidents   the real problems, at least one: { start, minutes, deadline, add, ramp }
//                 deadline  the page must fire within this many minutes of start
//                           (at least 1, and no more than the incident's minutes)
//                 add       how much the problem adds at full strength (same unit as the
//                           shape; for 'latency' and 'errors' it is per mille of requests
//                           that are slow or fail)
//                 ramp      optional: minutes to reach full strength (default 1)
//               List incidents in time order. They must not overlap, and must end by 24:00.
//   spikes      optional: brief harmless bumps { start, minutes, add }, same units as `add`
//   gaps        optional: minutes when the target cannot be scraped { start, minutes, restart }.
//               There is no sample at all and `up` is 0. As with Prometheus staleness markers,
//               the series vanishes at once, but rate() over a range still uses the samples
//               before the gap while at least two of them are inside it. With restart: true the app itself
//               was down: nothing is counted and its counters start again from 0 afterwards.
//   resets      optional, 'counter': times when the app restarts and its counter starts from 0
//   counterStart  optional, 'counter': the counter's value at the start (default 0)
//   typical     'latency': the usual request time in ms, as [hour, ms] points like `shape`
//   tail        'latency': { permille, ms, noise } a normal slow tail: that many per mille of
//               requests take `ms`, the share wanders by plus or minus `noise`
//   slowMs      'latency': how long the slow requests of an incident take, in ms
//   errors      'errors': { permille, noise } the normal share of failing requests per mille,
//               and how far the error count wanders per minute
//   slo         'errors' with the burn measure: the availability target in percent, e.g. 99.9
//   measures    what the player may measure, each with its threshold choices:
//                 { op, min, max, step, start }  a slider; op is '>' (default) or '<'
//                 { op, choices: [...], start }  a fixed list instead of a slider
//                 {}                             for 'up' (up == 0) and 'absent': no threshold
//               Units: value as scraped; rate per second; avg and p99 in ms; ratio in percent;
//               burn as a multiple of the error budget. start must be one of the choices.
//   ranges      the ranges in minutes offered for rate, avg, p99, ratio and burn, e.g. [5, 15, 60]
//               (leave it out if no measure uses one). Each is a whole number, at least 2
//               (a rate needs two samples) and at most 360. For burn, the range is the long one.
//   shorts      'burn' only: the short ranges in minutes; 0 means "no short range". The others
//               follow the same limits as ranges.
//   fors        the `for:` choices in minutes, e.g. [0, 1, 2, 5, 10]
//   rule        the rule the level starts with: { measure, range, short, for }. Its threshold
//               is the measure's `start`; range, short and for must be among the choices above.
//               The tests check that this rule LOSES.
//   solution    a list of inputs that wins. The tests replay it. Inputs:
//                 'measure p99'  'range 5'  'short 5'  'threshold 750'  'for 5'  'run'
//               and the last one is 'run'. Its total paging delay is the bar for three stars.
//   wrong       rules that must lose, and how: [{ inputs, fails }] where fails is
//                 'false page'  some page started outside every incident
//                 'late'        an incident was paged, but after its deadline
//                 'missed'      an incident was never paged
//                 'flapping'    an incident paged more than once: the alert stopped and fired
//                               again while the problem was still going on
//               Each `inputs` ends with 'run'. These are the traps the lesson is about.
//
// To add a level: copy an entry, give it a new id, change the day, and set solution to
// ['run']. Open the game with ?dev on the end of the URL, find a rule that wins, and paste
// the inputs it shows into `solution` and its rule file into inRealLife[0]. Then run
// `python3 scripts/arcade.py test noisy-pager`.

export const levels = [
  {
    id: 'np-01',
    title: 'Above the daily peak',
    brief: 'Jobs waiting in the queue. Every afternoon the queue grows, and it drains by night. Twice today a worker got stuck and the queue kept climbing.',
    hint: 'Look at the normal afternoon high on the chart. The threshold has to sit above it, and below where the stuck queue climbs to within ten minutes.',
    lesson: 'A normal busy hour should never page anyone, so set the alert threshold above the usual daily peak and below the level real trouble reaches.',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: QueueBacklog
        expr: sample_app_queue_depth{job="sample-app"} > 250
        labels:
          severity: page
        annotations:
          summary: "Jobs are piling up in the sample-app queue"` },
    ],
    docs: [
      'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/',
      'https://prometheus.io/docs/practices/alerting/',
    ],
    alert: { name: 'QueueBacklog', summary: 'Jobs are piling up in the sample-app queue' },
    kind: 'gauge',
    metric: 'sample_app_queue_depth',
    unit: 'jobs',
    seed: 11,
    shape: [[0, 20], [6, 20], [10, 130], [15, 160], [20, 60], [24, 20]],
    noise: 8,
    incidents: [
      { start: '03:20', minutes: 45, deadline: 10, add: 400, ramp: 10 },
      { start: '20:30', minutes: 40, deadline: 10, add: 400, ramp: 10 },
    ],
    measures: { value: { min: 0, max: 500, step: 10, start: 100 } },
    fors: [0, 1, 2, 5, 10],
    rule: { measure: 'value', for: 0 },
    solution: ['threshold 250', 'run'],
    wrong: [
      { inputs: ['threshold 150', 'run'], fails: 'false page' },
      { inputs: ['threshold 450', 'run'], fails: 'missed' },
      { inputs: ['threshold 420', 'run'], fails: 'flapping' },
    ],
  },
  {
    id: 'np-02',
    title: 'Hold it for a while',
    brief: 'The same queue, but now a batch import drops a few hundred jobs at once a few times a day. They drain in two or three minutes. The two stuck workers still keep it climbing.',
    hint: 'No threshold separates a three-minute spike from a real backlog. Make the condition hold for a few minutes with for:, but not so long that the page comes too late.',
    lesson: 'A spike that clears by itself should not wake anyone, so make the condition hold for a while first: the rule\'s for: keeps the alert pending, and every minute of it is a minute later that you hear about real trouble.',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: QueueBacklog
        expr: sample_app_queue_depth{job="sample-app"} > 250
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "Jobs are piling up in the sample-app queue"` },
    ],
    docs: [
      'https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/',
    ],
    alert: { name: 'QueueBacklog', summary: 'Jobs are piling up in the sample-app queue' },
    kind: 'gauge',
    metric: 'sample_app_queue_depth',
    unit: 'jobs',
    seed: 22,
    shape: [[0, 20], [6, 20], [10, 130], [15, 160], [20, 60], [24, 20]],
    noise: 8,
    spikes: [
      { start: '01:15', minutes: 3, add: 420 },
      { start: '06:40', minutes: 2, add: 450 },
      { start: '11:05', minutes: 3, add: 380 },
      { start: '14:30', minutes: 2, add: 350 },
      { start: '17:50', minutes: 3, add: 400 },
      { start: '22:10', minutes: 2, add: 450 },
    ],
    incidents: [
      { start: '04:10', minutes: 50, deadline: 12, add: 400, ramp: 10 },
      { start: '15:40', minutes: 40, deadline: 12, add: 400, ramp: 10 },
    ],
    measures: { value: { min: 0, max: 600, step: 10, start: 250 } },
    fors: [0, 1, 2, 5, 10, 15],
    rule: { measure: 'value', for: 0 },
    solution: ['for 5', 'run'],
    wrong: [
      { inputs: ['for 2', 'run'], fails: 'false page' },
      { inputs: ['for 10', 'run'], fails: 'late' },
    ],
  },
  {
    id: 'np-03',
    title: 'Counters only go up',
    brief: 'Failed background jobs, as a counter: it only ever goes up, and a deploy at 12:30 restarted the app, so it started again from zero. Twice today a bad batch made jobs fail fast.',
    hint: 'The raw counter climbs all day and drops at the restart, so any threshold on it pages at the wrong time. Measure how fast it grows instead: rate().',
    lesson: 'A counter only goes up and starts again from zero when the process restarts, so its raw value tells you little about what is happening now; alert on how fast it grows with rate(), which also copes with the reset.',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: JobsFailing
        expr: rate(sample_app_jobs_failed_total{job="sample-app"}[5m]) > 3
        labels:
          severity: page
        annotations:
          summary: "Background jobs are failing in sample-app"` },
    ],
    docs: [
      'https://prometheus.io/docs/prometheus/latest/querying/functions/#rate',
      'https://prometheus.io/docs/concepts/metric_types/#counter',
    ],
    alert: { name: 'JobsFailing', summary: 'Background jobs are failing in sample-app' },
    kind: 'counter',
    metric: 'sample_app_jobs_failed_total',
    seed: 33,
    shape: [[0, 20], [8, 20], [13, 50], [18, 50], [24, 20]],
    noise: 10,
    counterStart: 250000,
    resets: ['12:30'],
    incidents: [
      { start: '04:00', minutes: 30, deadline: 10, add: 600, ramp: 2 },
      { start: '17:00', minutes: 30, deadline: 10, add: 600, ramp: 2 },
    ],
    measures: {
      value: { min: 0, max: 400000, step: 10000, start: 300000 },
      rate: { min: 0, max: 20, step: 1, start: 0 },
    },
    ranges: [5, 15, 60],
    fors: [0, 1, 2, 5, 10],
    rule: { measure: 'value', range: 5, for: 0 },
    solution: ['measure rate', 'threshold 3', 'run'],
    wrong: [
      { inputs: ['threshold 260000', 'run'], fails: 'missed' },
      { inputs: ['threshold 20000', 'run'], fails: 'false page' },
    ],
  },
  {
    id: 'np-04',
    title: 'The slow tail',
    brief: 'How long requests take, from a histogram. Busy hours are a bit slower. Twice today a slow dependency made a few requests in a hundred take one and a half seconds.',
    hint: 'At night the average stays below the normal busy-hour average even during the incident. Watch the 99th percentile: the time that 99 in 100 requests stay under.',
    lesson: 'An average lets a few very slow requests hide among many fast ones, so watch the slow tail: the 99th percentile, estimated from the histogram\'s buckets with histogram_quantile().',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: SlowRequests
        expr: |
          histogram_quantile(0.99,
            sum by (le) (rate(http_request_duration_seconds_bucket{job="sample-app"}[5m]))
          ) > 0.75
        labels:
          severity: page
        annotations:
          summary: "The slowest requests to sample-app are too slow"` },
    ],
    docs: [
      'https://prometheus.io/docs/practices/histograms/',
      'https://prometheus.io/docs/prometheus/latest/querying/functions/#histogram_quantile',
    ],
    alert: { name: 'SlowRequests', summary: 'The slowest requests to sample-app are too slow' },
    kind: 'latency',
    metric: 'http_request_duration_seconds',
    seed: 44,
    shape: [[0, 600], [7, 600], [12, 3000], [17, 3000], [22, 900], [24, 600]],
    noise: 40,
    typical: [[0, 60], [7, 60], [12, 110], [17, 110], [22, 70], [24, 60]],
    tail: { permille: 15, ms: 400, noise: 3 },
    slowMs: 1500,
    incidents: [
      { start: '02:30', minutes: 40, deadline: 10, add: 25 },
      { start: '15:10', minutes: 30, deadline: 10, add: 25 },
    ],
    measures: {
      avg: { min: 0, max: 400, step: 10, start: 150 },
      p99: { min: 0, max: 3000, step: 50, start: 500 },
    },
    ranges: [5, 15, 60],
    fors: [0, 1, 2, 5, 10],
    rule: { measure: 'avg', range: 5, for: 0 },
    solution: ['measure p99', 'threshold 750', 'run'],
    wrong: [
      { inputs: ['threshold 100', 'run'], fails: 'false page' },
      { inputs: ['threshold 130', 'run'], fails: 'missed' },
    ],
  },
  {
    id: 'np-05',
    title: 'Errors per request',
    brief: 'Requests and the ones that failed with a 5xx. Daytime traffic is twenty times the night. A few requests in a thousand always fail; twice today a bad config made far more fail.',
    hint: 'At night even a bad config produces fewer errors per second than a normal afternoon. Divide by the traffic: measure the error ratio.',
    lesson: 'More traffic brings more errors even when nothing is wrong, so alert on the share of requests that fail: the error ratio, failed requests divided by all requests.',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: HighErrorRatio
        expr: |
          sum(rate(http_requests_total{job="sample-app",code=~"5.."}[5m]))
            / sum(rate(http_requests_total{job="sample-app"}[5m])) > 0.02
        labels:
          severity: page
        annotations:
          summary: "Too many sample-app requests are failing"` },
    ],
    docs: [
      'https://sre.google/sre-book/service-level-objectives/',
      'https://prometheus.io/docs/practices/rules/',
    ],
    alert: { name: 'HighErrorRatio', summary: 'Too many sample-app requests are failing' },
    kind: 'errors',
    metric: 'http_requests_total',
    seed: 55,
    shape: [[0, 300], [7, 300], [11, 6000], [16, 6000], [21, 1200], [24, 300]],
    noise: 20,
    errors: { permille: 5, noise: 2 },
    incidents: [
      { start: '02:40', minutes: 40, deadline: 10, add: 40 },
      { start: '13:20', minutes: 25, deadline: 10, add: 30 },
    ],
    measures: {
      rate: { min: 0, max: 2, step: 0.1, start: 0.3 },
      ratio: { min: 0, max: 10, step: 0.5, start: 1 },
    },
    ranges: [5, 15, 60],
    fors: [0, 1, 2, 5, 10],
    rule: { measure: 'rate', range: 5, for: 0 },
    solution: ['measure ratio', 'threshold 2', 'run'],
    wrong: [
      { inputs: ['threshold 0.2', 'run'], fails: 'false page' },
      { inputs: ['threshold 0.6', 'run'], fails: 'missed' },
    ],
  },
  {
    id: 'np-06',
    title: 'Silence is not OK',
    brief: 'Requests served. Twice today the app crashed and stayed down, and its metrics went with it. The network also dropped a scrape or two now and then.',
    hint: 'While the app is down no new samples arrive: rate() works from the last few for two or three minutes, then has no result at all, and no result never crosses a threshold. Alert on the failing scrape itself, and hold it long enough to ignore one dropped scrape.',
    lesson: 'When a target stops answering, its metrics stop arriving, and no data never crosses a threshold; alert on the silence itself, with up == 0 for a failing scrape or absent() for a series that has gone.',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: SampleAppDown
        expr: up{job="sample-app"} == 0
        for: 2m
        labels:
          severity: page
        annotations:
          summary: "Prometheus cannot scrape sample-app"` },
    ],
    docs: [
      'https://prometheus.io/docs/concepts/jobs_instances/',
      'https://prometheus.io/docs/prometheus/latest/querying/functions/#absent',
    ],
    alert: { name: 'SampleAppDown', summary: 'Prometheus cannot scrape sample-app' },
    kind: 'counter',
    metric: 'http_requests_total',
    seed: 66,
    shape: [[0, 200], [7, 200], [12, 1500], [18, 1500], [22, 400], [24, 200]],
    noise: 20,
    counterStart: 120000,
    gaps: [
      { start: '01:50', minutes: 40, restart: true },
      { start: '05:12', minutes: 1 },
      { start: '10:03', minutes: 2 },
      { start: '16:20', minutes: 30, restart: true },
      { start: '19:45', minutes: 1 },
      { start: '22:30', minutes: 2 },
    ],
    incidents: [
      { start: '01:50', minutes: 40, deadline: 5, add: 0 },
      { start: '16:20', minutes: 30, deadline: 5, add: 0 },
    ],
    measures: {
      rate: { op: '<', min: 0, max: 20, step: 1, start: 1 },
      up: {},
      absent: {},
    },
    ranges: [5, 15],
    fors: [0, 1, 2, 5, 10],
    rule: { measure: 'rate', range: 5, for: 0 },
    solution: ['measure up', 'for 2', 'run'],
    wrong: [
      { inputs: ['threshold 4', 'run'], fails: 'missed' },
      { inputs: ['measure up', 'run'], fails: 'false page' },
      { inputs: ['measure absent', 'for 10', 'run'], fails: 'late' },
    ],
  },
  {
    id: 'np-07',
    title: 'Burning the budget',
    brief: 'The promise: 99.9% of requests succeed over 30 days, so 0.1% may fail (the error budget). At 02:00 half of all requests failed; soon after the fix, a second problem failed one in ten. A deploy at 09:00 failed a fifth of requests for three minutes, which the budget can afford.',
    hint: 'A one-hour range still remembers the 02:00 outage at 03:05, so the alert never stopped and the second problem never paged. Add a short range: then both must be burning fast.',
    lesson: 'Page on how fast the error budget is burning, measured over a long range so a short blip cannot page and over a short range so the alert stops soon after the fix: a multiwindow burn-rate alert (the SRE Workbook pages at a burn rate of 14.4 over 1h and 5m; at that pace one hour spends 2% of a 30-day budget).',
    inRealLife: [
      { label: 'Prometheus rule', code: `groups:
  - name: sample-app
    rules:
      - alert: ErrorBudgetBurn
        expr: |
          job:slo_errors_per_request:ratio_rate1h{job="sample-app"} > (14.4 * 0.001)
          and
          job:slo_errors_per_request:ratio_rate5m{job="sample-app"} > (14.4 * 0.001)
        labels:
          severity: page
        annotations:
          summary: "sample-app is burning its error budget fast"` },
      { label: 'Recording rules', code: `groups:
  - name: sample-app-slo
    rules:
      - record: job:slo_errors_per_request:ratio_rate5m
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))
            / sum by (job) (rate(http_requests_total[5m]))
      - record: job:slo_errors_per_request:ratio_rate1h
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[1h]))
            / sum by (job) (rate(http_requests_total[1h]))` },
    ],
    docs: [
      'https://sre.google/workbook/alerting-on-slos/',
      'https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/',
    ],
    alert: { name: 'ErrorBudgetBurn', summary: 'sample-app is burning its error budget fast' },
    kind: 'errors',
    metric: 'http_requests_total',
    seed: 77,
    shape: [[0, 3000], [7, 3000], [12, 6000], [18, 6000], [24, 3000]],
    noise: 50,
    errors: { permille: 0, noise: 2 },
    slo: 99.9,
    spikes: [
      { start: '09:00', minutes: 3, add: 200 },
    ],
    incidents: [
      { start: '02:00', minutes: 30, deadline: 5, add: 500 },
      { start: '03:05', minutes: 30, deadline: 10, add: 100 },
    ],
    measures: {
      burn: { choices: [1, 2, 6, 14.4], start: 14.4 },
    },
    ranges: [5, 60, 360],
    shorts: [0, 5],
    fors: [0, 2, 5, 10],
    rule: { measure: 'burn', range: 60, short: 0, for: 0 },
    solution: ['short 5', 'run'],
    wrong: [
      { inputs: ['run'], fails: 'missed' },
      { inputs: ['range 5', 'run'], fails: 'false page' },
      { inputs: ['range 5', 'for 10', 'run'], fails: 'late' },
      { inputs: ['range 360', 'short 5', 'run'], fails: 'late' },
    ],
  },
];
