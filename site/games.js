// The hub shows one card per line in this list, in this order.
// A game folder that is not listed here is simply not shown.
//
//   id      the folder name under site/games/
//   title   the name on the card
//   blurb   one sentence under the title
//   tag     a short label, e.g. "puzzle" or "toy"
//   accent  which accent colour token the card uses: 1 to 6 (see shared/base.css).
//           Use the same number as the game's own style.css.

export const games = [
  { id: 'traffic-spike', title: 'Traffic Spike', tag: 'defence', accent: 3,
    blurb: 'One-lane tower defence: place caches, rate limiters, queues and servers so no real request reaches the exit unanswered.' },
  { id: 'sling-orbit', title: 'Sling Orbit', tag: 'physics', accent: 4,
    blurb: 'Aim one launch and let the planets bend your path through every target, then brake into a parking orbit.' },
  { id: 'drift', title: 'Drift', tag: 'toy', accent: 6,
    blurb: 'Particles drift through an invisible wind. Stir them, change the mood, save the picture.' },
];
