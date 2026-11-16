// The hub page. The games are planets circling a small sun: hover, tap or Tab to a planet to
// see what it is, then press Play (or tap it again, or press Enter).
// games.js decides which games exist and in what order; this file only draws them.

import { mountShell, ready, el, svg } from './shared/shell.js';
import { games, groups } from './games.js';

const main = mountShell({ title: 'Arcade', home: null });
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;   // no orbiting at all

// ------------------------------------------------------------------ orbits
//
// radius  share of the stage width, from the centre (0.5 would touch the edge)
// speed   degrees per second; a minus sign turns that ring the other way
// The "Just for fun" games circle close to the sun; every other game goes on the outer ring.
const RINGS = [
  { radius: 0.25, speed: 5, list: [] },
  { radius: 0.41, speed: -3, list: [] },
];
const INNER_GROUP = 'Just for fun';
const EASE = 4;   // how quickly the orbit slows to a stop or speeds back up (bigger = quicker)

for (const game of games) {
  (game.group === INNER_GROUP ? RINGS[0] : RINGS[1]).list.push(game);
}

// ------------------------------------------------------------------- state

const planets = [];        // { game, ring, slot, button }
let selected = -1;         // index into planets, -1 = nothing chosen yet
let clock = 0;             // seconds the orbit has actually moved
let speed = STILL ? 0 : 1; // 0 = stopped, 1 = full speed; eases between the two
let userPaused = false;    // the Pause button
let hovering = false;      // pointer over the stage
let focused = false;       // keyboard focus inside the stage
let lastFrame = 0;

// --------------------------------------------------------------- building

function initials(title) {
  return title.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
}

const tether = svg('line', { class: 'tether', x1: 500, y1: 500, x2: 500, y2: 500 });
const sky = svg('svg', { class: 'orbit-sky', viewBox: '0 0 1000 1000', 'aria-hidden': 'true' },
  RINGS.filter((ring) => ring.list.length > 0)
    .map((ring) => svg('circle', { class: 'orbit-ring', cx: 500, cy: 500, r: ring.radius * 1000 })),
  tether);

const sun = el('div', { class: 'sun', 'aria-hidden': 'true' },
  el('span', { class: 'sun-name' }, 'ARCADE'),
  el('span', { class: 'sun-count' }, `${games.length} games`));

const stage = el('div', { class: 'orbit', role: 'group', 'aria-label': 'Games. Use Tab or the arrow keys to move between them.' },
  sky, sun);

RINGS.forEach((ring) => {
  ring.list.forEach((game, slot) => {
    const index = planets.length;
    const button = el('button', {
      class: 'planet', type: 'button', 'aria-pressed': 'false',
      'aria-label': `${game.title}: ${game.tag}`,
      style: { '--accent': `var(--accent-${game.accent})` },
      onpointerdown: (event) => { button.dataset.armed = String(selected === index || event.pointerType === 'mouse'); },
      onpointerenter: (event) => { if (event.pointerType === 'mouse') select(index); },
      onfocus: () => select(index),
      onclick: (event) => {
        // Keyboard (detail 0) and mouse open the game at once; a finger chooses first, then opens.
        if (event.detail === 0 || button.dataset.armed === 'true') open(game);
        else select(index);
      },
    },
    el('span', { class: 'planet-body', 'aria-hidden': 'true' }, initials(game.title)),
    el('span', { class: 'planet-name', 'aria-hidden': 'true' }, game.title));
    planets.push({ game, ring, slot, button });
    stage.append(button);
  });
});

const detail = el('section', { class: 'panel detail', 'aria-live': 'polite' });
const toggle = el('button', { class: 'btn btn-quiet orbit-toggle', type: 'button', hidden: STILL, onclick: togglePause }, 'Pause orbit');

// --------------------------------------------------------------- behaviour

function open(game) {
  location.href = `./games/${game.id}/`;
}

function select(index) {
  if (index === selected) return;
  selected = index;
  planets.forEach((planet, i) => planet.button.setAttribute('aria-pressed', String(i === index)));
  const game = planets[index].game;
  stage.style.setProperty('--sun', `var(--accent-${game.accent})`);
  stage.classList.add('has-choice');
  showDetail(game);
  place();
}

function showDetail(game) {
  if (!game) {
    detail.replaceChildren(
      el('h2', {}, 'Pick a planet'),
      el('p', { class: 'muted' }, 'Hover, tap or Tab to a planet to see what it is. Tap it again, or press Enter, to play.'));
    return;
  }
  detail.style.setProperty('--accent', `var(--accent-${game.accent})`);
  detail.replaceChildren(
    el('p', { class: 'row detail-tags' }, el('span', { class: 'pill' }, game.tag), el('span', { class: 'muted' }, game.group || 'More')),
    el('h2', {}, game.title),
    el('p', {}, game.blurb),
    el('div', { class: 'row' }, el('a', { class: 'btn btn-primary', href: `./games/${game.id}/` }, 'Play →')));
}

function togglePause() {
  userPaused = !userPaused;
  toggle.textContent = userPaused ? 'Resume orbit' : 'Pause orbit';
  toggle.setAttribute('aria-pressed', String(userPaused));
}

function moveFocus(step) {
  const current = planets.findIndex((planet) => planet.button === document.activeElement);
  const next = current === -1 ? 0 : (current + step + planets.length) % planets.length;
  planets[next].button.focus();
}

stage.addEventListener('keydown', (event) => {
  const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(event.key in steps)) return;
  event.preventDefault();
  moveFocus(steps[event.key]);
});
stage.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') hovering = true; });
stage.addEventListener('pointerleave', () => { hovering = false; });
stage.addEventListener('focusin', () => { focused = true; });
stage.addEventListener('focusout', () => { focused = stage.contains(document.activeElement); });

// --------------------------------------------------------------- drawing

// The outer ring starts with a planet at the top. The inner ring starts half a gap round from
// that, so at rest (and with reduced motion) no inner planet sits right beside an outer one.
function angleOf(planet) {
  const { ring, slot } = planet;
  const outerGap = 360 / Math.max(1, RINGS[1].list.length);
  const start = ring === RINGS[0] ? -90 + outerGap / 2 : -90;
  return start + (slot * 360) / ring.list.length + ring.speed * clock;
}

// Put every planet at its place on its ring, and the tether on the chosen one.
function place() {
  planets.forEach((planet, i) => {
    const radians = (angleOf(planet) * Math.PI) / 180;
    const x = 50 + planet.ring.radius * 100 * Math.cos(radians);
    const y = 50 + planet.ring.radius * 100 * Math.sin(radians);
    planet.button.style.left = `${x}%`;
    planet.button.style.top = `${y}%`;
    if (i === selected) {
      tether.setAttribute('x2', String(x * 10));
      tether.setAttribute('y2', String(y * 10));
    }
  });
}

function frame(now) {
  const seconds = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
  lastFrame = now;
  const wanted = userPaused || hovering || focused ? 0 : 1;
  speed += (wanted - speed) * Math.min(1, seconds * EASE);
  clock += seconds * speed;
  if (speed > 0.001) place();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------- the list view

function listView() {
  const names = [...groups];
  if (games.some((game) => !groups.includes(game.group))) names.push('More');
  const sections = names
    .map((name) => ({ name, list: games.filter((game) => (groups.includes(game.group) ? game.group === name : name === 'More')) }))
    .filter((section) => section.list.length > 0);
  return el('details', { class: 'panel hub-list' },
    el('summary', {}, 'All games as a list'),
    sections.map((section) => el('div', { class: 'hub-list-group' },
      el('h3', {}, section.name),
      el('ul', {}, section.list.map((game) => el('li', { style: { '--accent': `var(--accent-${game.accent})` } },
        el('a', { href: `./games/${game.id}/` }, game.title),
        el('span', { class: 'muted' }, ` · ${game.tag}`)))))));
}

// -------------------------------------------------------------------- start

main.append(
  el('section', { class: 'stack' },
    el('p', { class: 'hub-lead' }, 'Small games about packets, pods, pipelines and planets.'),
    el('p', { class: 'muted' }, 'Everything runs in this page: nothing to install, no accounts, no tracking.')),
  el('div', { class: 'hub-top' },
    el('div', { class: 'orbit-wrap' }, stage, toggle),
    el('div', { class: 'stack' },
      detail,
      el('p', {}, el('a', { href: './lessons/' }, 'Every lesson in one place →')))),
  listView(),
  el('footer', { class: 'muted hub-foot' },
    'Plain HTML, CSS and JavaScript. ',
    el('a', { href: 'https://github.com/alfinwilliam/arcade' }, 'Source on GitHub'),
    '.'),
);

// ?pick=packet-quest opens the page with that planet already chosen (handy for sharing a link).
const picked = planets.findIndex((planet) => planet.game.id === new URLSearchParams(location.search).get('pick'));
if (picked === -1) showDetail(null);
else select(picked);
place();
ready();
if (!STILL) requestAnimationFrame(frame);
