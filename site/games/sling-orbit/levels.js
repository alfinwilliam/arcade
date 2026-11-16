// LEVELS for Sling Orbit.
// This file is data only. To change the game's content you edit this file and nothing else.
//
// The field is a 600 x 600 square. [0, 0] is the top-left corner, x grows to the right
// and y grows DOWN, so a launch of [100, -50] goes right and up. Distances are in field
// units, speeds in units per second, and time in ticks: 120 ticks = 1 second.
//
// Schema (every field is required):
//   id        unique text, starting "so-"
//   title     shown above the field
//   hint      one short line of advice shown under the title
//   start     [x, y]: where the ship waits
//   aim       [vx, vy]: where the arrow points when the level opens. Must NOT win.
//   maxSpeed  the fastest launch allowed (the length of the arrow)
//   maxTicks  the time limit; the flight is lost when it runs out
//   bodies    the planets, as a list of { at: [x, y], r, gm }
//               r   radius; touching it is a crash
//               gm  strength of its pull. 2400000 is a heavy planet, 1200000 a light one.
//   goals     what the player must do; ALL of them, in any order. Two kinds:
//               { type: 'zone', at: [x, y], r }
//                   touch this circle once
//               { type: 'ring', body: 0, rMin: 60, rMax: 120, ticks: 600 }
//                   stay between rMin and rMax from the centre of bodies[body]
//                   (0 is the first body) for that many ticks in a row
//   brake     { taps, dv }: how many brake taps the player gets, and how much speed
//             each one removes. Use taps: 0 on levels without a ring.
//   solution  { launch: [vx, vy], brakes: [tick, ...] }: a launch that wins, and the tick
//             of each brake tap ([] for none). Whole numbers only.
//
// To add a level:
//   1. Copy an entry, give it a new id, move things around, and set solution to
//      { launch: [0, 0], brakes: [] } for now.
//   2. Run `python3 scripts/arcade.py preview` and open
//      http://127.0.0.1:8000/site/games/sling-orbit/?dev&level=so-07  (your new id).
//   3. Press "Find a forgiving launch". After a few seconds it prints a `solution:` line
//      and its margin. Press "Fly the solution" to watch that launch, then paste the line here.
//      Or win the level by hand: with ?dev the result box shows the launch and brakes you used.
//   4. Run `python3 scripts/arcade.py test sling-orbit`. It fails if the solution does not
//      win, if a launch within +-2 of it loses, or if a brake tap 12 ticks early or late
//      loses. When that happens the level is too fiddly: make a zone or ring bigger,
//      or move it, and search again. A margin of 3 or more is comfortable.

export const levels = [
  {
    id: 'so-01', title: 'First push',
    hint: 'The planet bends your path. Aim a little to the left of the target.',
    start: [90, 510], aim: [150, -120], maxSpeed: 320, maxTicks: 1200,
    bodies: [{ at: [380, 380], r: 34, gm: 1200000 }],
    goals: [{ type: 'zone', at: [500, 110], r: 44 }],
    brake: { taps: 0, dv: 34 },
    solution: { launch: [187, -221], brakes: [] },
  },
  {
    id: 'so-02', title: 'Behind the moon',
    hint: 'Straight ahead is a crash. Go fast and pass to one side.',
    start: [60, 300], aim: [200, 0], maxSpeed: 320, maxTicks: 2400,
    bodies: [{ at: [300, 300], r: 36, gm: 2400000 }],
    goals: [{ type: 'zone', at: [540, 300], r: 28 }],
    brake: { taps: 0, dv: 34 },
    solution: { launch: [300, 100], brakes: [] },
  },
  {
    id: 'so-03', title: 'Two for one',
    hint: 'Go slowly. A gentle push falls into a loop round the planet.',
    start: [60, 300], aim: [100, -100], maxSpeed: 320, maxTicks: 1800,
    bodies: [{ at: [300, 300], r: 34, gm: 2400000 }],
    goals: [
      { type: 'zone', at: [300, 180], r: 30 },
      { type: 'zone', at: [300, 420], r: 30 },
    ],
    brake: { taps: 0, dv: 34 },
    solution: { launch: [-4, -69], brakes: [] },
  },
  {
    id: 'so-04', title: 'The hook',
    hint: 'Aim right of the gap: the near planet pulls you into it, then the far one swings you round.',
    start: [300, 540], aim: [-100, 0], maxSpeed: 320, maxTicks: 2400,
    bodies: [
      { at: [200, 380], r: 30, gm: 2000000 },
      { at: [400, 220], r: 30, gm: 2000000 },
    ],
    goals: [
      { type: 'zone', at: [300, 300], r: 34 },
      { type: 'zone', at: [520, 90], r: 40 },
    ],
    brake: { taps: 0, dv: 34 },
    solution: { launch: [53, -85], brakes: [] },
  },
  {
    id: 'so-05', title: 'Parking orbit',
    hint: 'Dive into the band, then brake at your closest point to stay in it.',
    start: [300, 540], aim: [-100, -40], maxSpeed: 320, maxTicks: 2400,
    bodies: [{ at: [300, 300], r: 36, gm: 2400000 }],
    goals: [{ type: 'ring', body: 0, rMin: 60, rMax: 120, ticks: 600 }],
    brake: { taps: 1, dv: 34 },
    solution: { launch: [-75, -47], brakes: [311] },
  },
  {
    id: 'so-06', title: 'Tag, then park',
    hint: 'Launch up, gently, so your loop dips onto the far target. Brake at your closest pass, and again at the next.',
    start: [60, 300], aim: [0, -120], maxSpeed: 320, maxTicks: 3000,
    bodies: [{ at: [300, 300], r: 34, gm: 2400000 }],
    goals: [
      { type: 'zone', at: [480, 300], r: 30 },
      { type: 'ring', body: 0, rMin: 60, rMax: 120, ticks: 480 },
    ],
    brake: { taps: 2, dv: 32 },
    solution: { launch: [-10, -92], brakes: [916, 1273] },
  },
];
