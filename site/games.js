// The hub shows one card per line in this list, grouped into sections.
// A game folder that is not listed here is simply not shown.
//
//   id       the folder name under site/games/
//   title    the name on the card
//   blurb    one sentence under the title
//   tag      a short label, e.g. "puzzle" or "toy"
//   accent   which accent colour token the card uses: 1 to 11 (see shared/base.css).
//            Use the same number as the game's own style.css.
//   group    which hub section the card goes in: one of the names in `groups` below
//   lessons  optional. Set it to false for a game with no levels.js (the lessons page skips it)

// Hub sections, in the order they appear. A card whose group is not listed goes under "More".
export const groups = ['Networking', 'Kubernetes', 'Delivery', 'Operations', 'Just for fun'];

export const games = [
  { id: 'packet-quest', title: 'Packet Quest', tag: 'puzzle', accent: 1, group: 'Networking',
    blurb: 'Follow one packet hop by hop, find where the network drops it, and fix the right thing.' },
  { id: 'pod-packer', title: 'Pod Packer', tag: 'puzzle', accent: 2, group: 'Kubernetes',
    blurb: 'Buy nodes, place pods by their CPU and memory requests, ride out taints and spot reclaims, and keep the bill under the cap.' },
  { id: 'canary', title: 'Canary', tag: 'rollout', accent: 10, group: 'Kubernetes',
    blurb: 'Roll out v2 of a service through an Istio mesh: shift weights, route testers, mirror, set timeouts and retries, eject a bad pod.' },
  { id: 'ship-it', title: 'Ship It', tag: 'pipeline', accent: 7, group: 'Delivery',
    blurb: 'Rearrange a CI/CD pipeline until every check passes: fail fast, run in parallel, cache, gate and lock the deploy.' },
  { id: 'out-of-sync', title: 'Out of Sync', tag: 'gitops', accent: 9, group: 'Delivery',
    blurb: 'Git says one thing, the cluster another. Use Argo CD sync, prune, self-heal, hooks and git revert to end Synced and Healthy.' },
  { id: 'traffic-spike', title: 'Traffic Spike', tag: 'defence', accent: 3, group: 'Operations',
    blurb: 'One-lane tower defence: place caches, rate limiters, queues and servers so no real request reaches the exit unanswered.' },
  { id: 'escape-shell', title: 'Escape Shell', tag: 'terminal', accent: 5, group: 'Operations',
    blurb: 'A service is down on a pretend server. Investigate with real commands, find the cause, and bring it back.' },
  { id: 'noisy-pager', title: 'Noisy Pager', tag: 'alerting', accent: 8, group: 'Operations',
    blurb: 'Tune a Prometheus alert against a simulated day: page for every real incident in time, and for nothing else.' },
  { id: 'sling-orbit', title: 'Sling Orbit', tag: 'physics', accent: 4, group: 'Just for fun',
    blurb: 'Aim one launch and let the planets bend your path through every target, then brake into a parking orbit.' },
  { id: 'drift', title: 'Drift', tag: 'toy', accent: 6, group: 'Just for fun', lessons: false,
    blurb: 'Particles drift through an invisible wind. Stir them, change the mood, save the picture.' },
];
