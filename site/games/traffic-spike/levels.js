// LEVELS and numbers for Traffic Spike.
// This file is data only. To change the game's content or balance you edit this
// file and nothing else. Money is in rupees and every number is a whole number.
//
// HOW THE GAME READS THIS FILE
//   Requests enter a lane on the left and walk to the exit on the right. The lane is
//   cut into slots, and the player puts one component in a slot. Each tick a component
//   handles up to its `rate` of the requests inside its slot. A legitimate request
//   (static or api) that reaches the exit unanswered is an error. So is one that waits
//   in queues for more than `rules.patience` ticks: it gives up. Bots that reach the
//   exit cost nothing, but until then they use up servers and queues.
//
// A LEVEL (every field is required)
//   id           unique text, starting "ts-"
//   title        shown in the level picker and above the lane
//   intro        a line of advice shown before the first wave (keep it under about 100 letters)
//   slots        how many slots the lane has: 4 or 5. (More do not fit a phone screen,
//                and the tests refuse more than 5.)
//   budget       rupees the player starts with
//   errorBudget  errors allowed. One more than this loses the level.
//   shop         which components this level sells, e.g. ['server', 'cache'].
//                The names are the keys of `towers` below.
//   waves        played in order. Each wave is:
//                  ticks    for how many ticks it sends requests
//                  perTick  how many of each kind arrive every tick, e.g. { api: 2, bot: 6 }.
//                           The kinds are the keys of `kinds` below. Up to about 16 of
//                           one kind still draws clearly on a phone.
//                  reward   rupees paid when the wave has fully cleared the lane
//   solution     a list of actions that wins. The tests replay it, so a level that
//                cannot be won as written fails `python3 scripts/arcade.py test`.
//                Each action says when and what:
//                  { wave: 1, t: 0, buy: 'server', slot: 3 }
//                  { wave: 2, t: 0, sell: 'cache', slot: 1 }
//                wave counts from 1. t is ticks since that wave began (0 = before it
//                starts). slot counts from 0 at the entrance.
//
// TO ADD A LEVEL
//   1. Copy an entry below, give it a new id and change the numbers.
//      Leave `solution: []` for now.
//   2. Run `python3 scripts/arcade.py preview`, open the game with ?dev on the end of
//      the URL, and win your level.
//   3. The win panel shows the actions you took. Paste them into `solution`.
//   4. Run `python3 scripts/arcade.py test traffic-spike`. The tests insist that the
//      solution wins with a quarter of the error budget to spare, that doing nothing
//      loses in wave 1, and that the solution without its first action loses.
//
// RULES OF THUMB WHEN TUNING
//   - A request spends slotUnits / speed = 5 ticks inside each slot.
//   - A component in a steady stream handles `rate` per tick. One cache (rate 6) covers
//     6 static per tick; 12 per tick needs two.
//   - A server answers bots first, then static, then api (the order of its `takes`
//     list). So bots and static that are not filtered out before the server waste it.
//     (A real server answers in arrival order; bots first is the worst case of that.)
//   - A queue takes in everything, up to `size`, and lets out `rate` per tick. A backlog
//     of 60 takes 60 / 3 = 20 ticks to clear, and anyone who would wait longer than
//     `patience` ticks gives up. So a queue rides out a short burst, but traffic that
//     stays too high needs another server, not another queue.

// Numbers that apply to every level.
export const rules = {
  slotUnits: 10,          // length of one slot
  speed: 2,               // units a request moves per tick
  patience: 25,           // ticks a request will wait in queues, in all, before it gives up (an error)
  sellPercent: 50,        // selling gives back this much of the cost (selling at once gives back all of it)
  threeStarPercent: 25,   // three stars for using at most this much of the error budget
  twoStarPercent: 60,     // two stars for using at most this much; anything else that wins is one star
};

// The kinds of request. `legit: true` means an unanswered one counts as an error.
// `letter` is how the kind is written in short on the page.
export const kinds = {
  static: { letter: 'S', name: 'static file', legit: true },
  api:    { letter: 'A', name: 'API call',    legit: true },
  bot:    { letter: 'B', name: 'bot',         legit: false },
};

// The components the player can buy. The order here is the order of the number keys 1 to 4.
//   cost   rupees
//   rate   requests handled per tick (for the queue: requests let out per tick)
//   takes  which kinds it touches, in the order it picks them when several arrive together
//   size   queue only: how many requests it can hold
//   does   one short line for the shop button
export const towers = {
  server:  { name: 'Server',       cost: 60, rate: 3, takes: ['bot', 'static', 'api'], does: 'Answers anything, bots included.' },
  cache:   { name: 'Cache',        cost: 40, rate: 6, takes: ['static'],               does: 'Answers static files.' },
  limiter: { name: 'Rate limiter', cost: 40, rate: 8, takes: ['bot'],                  does: 'Drops bots.' },
  queue:   { name: 'Queue',        cost: 30, rate: 3, size: 80, takes: ['bot', 'static', 'api'], does: 'Holds a burst, lets it out steadily.' },
};

export const levels = [
  { id: 'ts-01', title: 'Front page', slots: 4, budget: 100, errorBudget: 20,
    intro: 'Start with a server near the exit. Later, put filters in front of it so it is not wasted on junk.',
    shop: ['server', 'cache', 'limiter'],
    waves: [
      { ticks: 40, perTick: { api: 2 },                    reward: 60 },
      { ticks: 40, perTick: { api: 2, static: 5 },         reward: 60 },
      { ticks: 40, perTick: { api: 2, static: 5, bot: 8 }, reward: 0 },
    ],
    solution: [
      { wave: 1, t: 0, buy: 'server',  slot: 3 },
      { wave: 2, t: 0, buy: 'cache',   slot: 0 },
      { wave: 3, t: 0, buy: 'limiter', slot: 1 },
    ] },

  { id: 'ts-02', title: 'Scale out', slots: 5, budget: 100, errorBudget: 30,
    intro: 'A component has a limit per tick. When the traffic doubles, add a second one.',
    shop: ['server', 'cache', 'limiter'],
    waves: [
      { ticks: 40, perTick: { static: 6,  api: 3 },         reward: 50 },
      { ticks: 40, perTick: { static: 12, api: 3 },         reward: 70 },
      { ticks: 40, perTick: { static: 12, api: 6 },         reward: 50 },
      { ticks: 40, perTick: { static: 12, api: 6, bot: 8 }, reward: 0 },
    ],
    solution: [
      { wave: 1, t: 0, buy: 'cache',   slot: 0 },
      { wave: 1, t: 0, buy: 'server',  slot: 4 },
      { wave: 2, t: 0, buy: 'cache',   slot: 1 },
      { wave: 3, t: 0, buy: 'server',  slot: 3 },
      { wave: 4, t: 0, buy: 'limiter', slot: 2 },
    ] },

  { id: 'ts-03', title: 'Flash sale', slots: 4, budget: 80, errorBudget: 20,
    intro: 'A burst swamps one server. A queue in front holds it and feeds it in, if nobody waits too long.',
    shop: ['server', 'queue', 'limiter'],
    waves: [
      { ticks: 40, perTick: { api: 3 },         reward: 30 },
      { ticks: 10, perTick: { api: 9 },         reward: 50 },
      { ticks: 24, perTick: { api: 5, bot: 8 }, reward: 0 },
    ],
    solution: [
      { wave: 1, t: 0, buy: 'server',  slot: 3 },
      { wave: 2, t: 0, buy: 'queue',   slot: 2 },
      { wave: 3, t: 0, buy: 'limiter', slot: 1 },
    ] },

  { id: 'ts-04', title: 'Moving target', slots: 4, budget: 140, errorBudget: 30,
    intro: 'The traffic changes every wave and money is tight. Sell what the next wave does not need.',
    shop: ['server', 'cache', 'limiter', 'queue'],
    waves: [
      { ticks: 40, perTick: { static: 10, api: 3 },        reward: 30 },
      { ticks: 40, perTick: { static: 4, api: 3, bot: 8 }, reward: 30 },
      { ticks: 12, perTick: { api: 8, bot: 8 },            reward: 0 },
    ],
    solution: [
      { wave: 1, t: 0, buy: 'cache',    slot: 1 },
      { wave: 1, t: 0, buy: 'cache',    slot: 2 },
      { wave: 1, t: 0, buy: 'server',   slot: 3 },
      { wave: 2, t: 0, sell: 'cache',   slot: 1 },
      { wave: 2, t: 0, buy: 'limiter',  slot: 1 },
      { wave: 3, t: 0, sell: 'cache',   slot: 2 },
      { wave: 3, t: 0, buy: 'queue',    slot: 2 },
    ] },

  { id: 'ts-05', title: 'Launch day', slots: 5, budget: 140, errorBudget: 40,
    intro: 'Everything at once. Read all four waves before you spend, and expect to rebuild between them.',
    shop: ['server', 'cache', 'limiter', 'queue'],
    waves: [
      { ticks: 40, perTick: { static: 10, api: 3 },         reward: 80 },
      { ticks: 40, perTick: { static: 6, api: 6, bot: 8 },  reward: 40 },
      { ticks: 10, perTick: { api: 14, bot: 8 },            reward: 30 },
      { ticks: 30, perTick: { static: 6, api: 5, bot: 14 }, reward: 0 },
    ],
    solution: [
      { wave: 1, t: 0, buy: 'cache',    slot: 1 },
      { wave: 1, t: 0, buy: 'cache',    slot: 3 },
      { wave: 1, t: 0, buy: 'server',   slot: 4 },
      { wave: 2, t: 0, sell: 'cache',   slot: 3 },
      { wave: 2, t: 0, buy: 'limiter',  slot: 0 },
      { wave: 2, t: 0, buy: 'server',   slot: 2 },
      { wave: 3, t: 0, buy: 'queue',    slot: 3 },
      { wave: 4, t: 0, sell: 'server',  slot: 2 },
      { wave: 4, t: 0, buy: 'limiter',  slot: 2 },
    ] },
];
