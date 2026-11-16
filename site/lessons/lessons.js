// The lessons page: every lesson from every game, read straight from each game's levels.js,
// so it never goes stale. A game appears here if any of its levels has one of these fields:
//
//   lesson       one plain sentence (most games)
//   term         the proper name for the idea (Packet Quest)
//   debrief      { cause, evidence, habit } (Escape Shell)
//   inRealLife   [{ label, code }]: the real config or command
//   command      a real command (Packet Quest), and reveals: what to look for in its output
//   docs         [url, ...]: official documentation
//
// To leave a game out entirely (one with no levels.js), give it  lessons: false  in games.js.

import { mountShell, ready, el } from '../shared/shell.js';
import { games } from '../games.js';

const main = mountShell({ title: 'Lessons', home: '../index.html' });

function hasLesson(level) {
  return Boolean(level.lesson || level.debrief || level.inRealLife);
}

function codeBlock(label, code) {
  return [el('p', { class: 'lesson-label' }, label), el('pre', {}, el('code', {}, code))];
}

function lessonItem(level, index) {
  const snippets = level.inRealLife || [];
  const docs = level.docs || [];
  return el('li', { class: 'lesson' },
    el('h3', {}, `${index + 1}. ${level.title || level.id}`),
    level.lesson ? el('p', {}, level.lesson) : null,
    level.term ? el('p', { class: 'muted' }, level.term) : null,
    level.debrief ? el('p', {}, level.debrief.cause) : null,
    level.debrief ? el('p', { class: 'muted' }, 'Habit: ' + level.debrief.habit) : null,
    level.command ? codeBlock('Command', level.command) : null,
    level.reveals ? el('p', { class: 'muted' }, level.reveals) : null,
    snippets.map((snippet) => codeBlock(snippet.label, snippet.code)),
    docs.length > 0
      ? el('p', { class: 'lesson-docs' },
        docs.map((url) => el('a', { href: url, rel: 'noopener' }, url.replace(/^https:\/\//, ''))))
      : null);
}

function gameSection(game, levels) {
  const withLessons = levels.filter(hasLesson);
  return el('details', { class: 'panel lesson-game', style: { '--accent': `var(--accent-${game.accent})` } },
    el('summary', {},
      el('h2', {}, game.title),
      el('span', { class: 'pill' }, `${withLessons.length} lessons`),
      el('a', { href: `../games/${game.id}/` }, 'Play')),
    el('ol', { class: 'lesson-list' }, levels.map((level, i) => (hasLesson(level) ? lessonItem(level, i) : null))));
}

async function load(game) {
  try {
    const data = await import(`../games/${game.id}/levels.js`);
    return { game, levels: data.levels || [] };
  } catch (error) {
    // One broken data file must not hide every other game's lessons.
    return { game, levels: [], error: String((error && error.message) || error) };
  }
}

main.append(
  el('p', { class: 'how' },
    'What each level teaches, with the real command or config. Each game is folded so nothing is spoiled until you open it.'),
);

const loaded = await Promise.all(games.filter((game) => game.lessons !== false).map(load));
const list = el('div', { class: 'stack' });
for (const { game, levels, error } of loaded) {
  if (error) list.append(el('p', { class: 'panel' }, `${game.title}: could not load its levels (${error}).`));
  else if (levels.some(hasLesson)) list.append(gameSection(game, levels));
}
main.append(list);
ready();
