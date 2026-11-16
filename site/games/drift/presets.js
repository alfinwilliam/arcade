// PRESETS for Drift, the generative-art toy.
// This file is data only. To change how the toy looks you edit this file and nothing else.
//
// What a preset describes: a few hundred particles are dropped on the canvas. An invisible
// "flow field" gives every spot on the canvas a direction, like wind on a weather map. Each
// particle follows the wind and leaves a thin line behind it. The numbers below shape the wind
// and the lines.
//
// Units used below:
//   - One "step" is 1/60 of a second (the page runs 60 steps a second), so life 60 is about a second.
//   - Distances are in picture units: the picture is 960 x 540 on a large screen and 400 x 500
//     on a phone, whatever its size on the screen.
//
// Schema (every field is required; the allowed range is in brackets):
//   id          unique text, lowercase letters, digits and dashes. Saved as the player's last choice.
//   name        the label on the preset button. Keep it short: one word fits best.
//   background  canvas colour, written "#rrggbb"
//   palette     1 to 6 line colours, each "#rrggbb" (no empty slots, so no double commas).
//               Every particle picks one at random.
//   particles   how many particles on a large screen [40 to 1200]. Small screens get fewer
//               automatically (see particleCount in logic.js), so phones stay smooth.
//   speed       how far a particle moves per step [0.2 to 4]. Higher = longer, faster strokes.
//   fade        how quickly old lines fade away [0, or 0.03 to 0.5]. 0 = never fade: the picture
//               builds up until the player presses Clear, so keep `particles` low (see Ink).
//               0.03 = long trails. 0.1 = short comets.
//               Fading works in whole colour steps, so it never gets all the way back to the
//               background: old lines leave a faint permanent tint, and the canvas settles a
//               little off the background colour. The SMALLER the fade, the STRONGER that tint
//               (roughly 0.5 / fade colour steps, so about 17 at 0.03 and 5 at 0.1). Below 0.03
//               it is strong enough to change the background colour, so the check rejects it.
//   swirl       how tightly the flow curls [0.0005 to 0.05]. 0.002 = a few big lazy curves,
//               0.01 = many small eddies.
//   shift       how fast the flow itself changes, per step [0 to 0.02]. 0 = frozen, so lines
//               pile up on the same paths. 0.004 = slowly wandering.
//   orbit       how much the flow circles the middle of the canvas [0 to 1]. 0 = not at all,
//               1 = a plain whirlpool.
//   snap        0 for smooth curves, or a whole number [3 to 12] to allow only that many
//               directions. 4 gives right-angle "circuit" lines, 6 gives a honeycomb feel.
//   life        how many steps a particle lives before it restarts somewhere new [20 to 2000].
//               Short lives give short dashes spread evenly; long lives give long ribbons.
//   width       line thickness, in picture units [0.5 to 4]
//
// To add a preset: copy an entry, give it a new id and name, change the numbers, save, and
// reload the page. A wrong value shows a red banner on the page naming the entry and the
// field. Then run `python3 scripts/arcade.py test drift`: it checks every entry against the
// ranges above. Keys 1 to 9 pick the first nine presets, in the order they appear here.
// The first entry is the one a new visitor sees. More than about six presets wrap onto a
// second row of buttons.

export const presets = [
  {
    id: 'aurora', name: 'Aurora', background: '#0b1020',
    palette: ['#7cf5c4', '#5aa9ff', '#c77dff'],
    particles: 600, speed: 1.2, fade: 0.06, swirl: 0.004, shift: 0.002, orbit: 0, snap: 0, life: 220, width: 1.2,
  },
  {
    id: 'ember', name: 'Ember', background: '#140a08',
    palette: ['#ffb347', '#ff6b4a', '#ffe08a', '#c2410c'],
    particles: 500, speed: 1.6, fade: 0.04, swirl: 0.008, shift: 0.004, orbit: 0, snap: 0, life: 140, width: 1.4,
  },
  {
    id: 'eddy', name: 'Eddy', background: '#06141a',
    palette: ['#4dd0e1', '#b2ebf2', '#26a69a', '#e0f7fa'],
    particles: 700, speed: 1.4, fade: 0.05, swirl: 0.006, shift: 0.003, orbit: 0.65, snap: 0, life: 260, width: 1,
  },
  {
    id: 'lattice', name: 'Lattice', background: '#0a1410',
    palette: ['#9be564', '#f2c14e', '#57c7a3'],
    particles: 450, speed: 1.5, fade: 0.03, swirl: 0.005, shift: 0.001, orbit: 0, snap: 6, life: 180, width: 1.2,
  },
  {
    id: 'ink', name: 'Ink', background: '#f3ead8',
    palette: ['#1f2a44', '#7a1f2b', '#2f5d50'],
    // fade 0: lines never fade, so the paper fills up. 100 particles (it was 300) keep it
    // airy for longer; the page also says "press Clear to start again" when Ink is picked.
    particles: 100, speed: 1, fade: 0, swirl: 0.003, shift: 0, orbit: 0.2, snap: 0, life: 320, width: 0.7,
  },
];
