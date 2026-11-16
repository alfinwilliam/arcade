// The hub page: one card per entry in games.js, in sections. To add or hide a game, edit games.js.

import { mountShell, ready, el } from './shared/shell.js';
import { games, groups } from './games.js';

const main = mountShell({ title: 'Arcade', home: null });

function card(game) {
  return el('li', {},
    el('a', { class: 'card', href: `./games/${game.id}/`, style: { '--accent': `var(--accent-${game.accent})` } },
      el('span', {}, el('span', { class: 'pill' }, game.tag)),
      el('h3', {}, game.title),
      el('p', { class: 'muted' }, game.blurb),
      el('span', { class: 'card-go', 'aria-hidden': 'true' }, 'Play →')));
}

// Sections in the order of `groups`, then anything with an unknown group under "More".
function sections() {
  const names = [...groups];
  if (games.some((game) => !groups.includes(game.group))) names.push('More');
  return names
    .map((name) => ({
      name,
      list: games.filter((game) => (groups.includes(game.group) ? game.group === name : name === 'More')),
    }))
    .filter((section) => section.list.length > 0);
}

main.append(
  el('section', { class: 'stack' },
    el('p', { class: 'hub-lead' }, 'Small games about packets, pods, pipelines and planets.'),
    el('p', { class: 'muted' }, 'Everything runs in this page: nothing to install, no accounts, no tracking.'),
    el('p', {}, el('a', { href: './lessons/' }, 'Every lesson in one place →'))),
  ...sections().map((section) =>
    el('section', { class: 'stack hub-section' },
      el('h2', {}, section.name),
      el('ul', { class: 'cards' }, section.list.map(card)))),
  el('footer', { class: 'muted hub-foot' },
    'Plain HTML, CSS and JavaScript. ',
    el('a', { href: 'https://github.com/alfinwilliam/arcade' }, 'Source on GitHub'),
    '.'),
);

ready();
