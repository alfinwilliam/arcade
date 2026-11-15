// The hub page: one card per entry in games.js. To add or hide a game, edit games.js, not this file.

import { mountShell, ready, el } from './shared/shell.js';
import { games } from './games.js';

const main = mountShell({ title: 'Arcade', home: null });

function card(game) {
  return el('li', {},
    el('a', { class: 'card', href: `./games/${game.id}/`, style: { '--accent': `var(--accent-${game.accent})` } },
      el('span', {}, el('span', { class: 'pill' }, game.tag)),
      el('h2', {}, game.title),
      el('p', { class: 'muted' }, game.blurb),
      el('span', { class: 'card-go', 'aria-hidden': 'true' }, 'Play →')));
}

main.append(
  el('section', { class: 'stack' },
    el('p', { class: 'hub-lead' }, 'Small games about packets, pods and planets.'),
    el('p', { class: 'muted' }, 'Everything runs in this page: nothing to install, no accounts, no tracking.')),
  games.length > 0
    ? el('ul', { class: 'cards' }, games.map(card))
    : el('p', { class: 'panel' }, 'The first games are on their way.'),
  el('footer', { class: 'muted hub-foot' },
    'Plain HTML, CSS and JavaScript. ',
    el('a', { href: 'https://github.com/alfinwilliam/arcade' }, 'Source on GitHub'),
    '.'),
);

ready();
