// Tests for the template game. Every game has a file like this one.
// The important part is the loop: each level's `solution` is replayed through the
// real rules and must win. If you add a level that cannot be won as written, this fails.

import { test, assert } from './harness.js';
import { levels } from '../site/games/_template/levels.js';
import { start, apply, replay } from '../site/games/_template/logic.js';

test('level ids are unique', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const level of levels) {
  test(`${level.id}: the solution wins`, () => {
    assert.equal(replay(level, level.solution).status, 'won');
  });

  test(`${level.id}: doing nothing does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
  });

  test(`${level.id}: the solution fits in the move limit`, () => {
    assert.ok(level.solution.length <= level.maxMoves);
  });
}

test('running out of moves loses', () => {
  const level = { id: 'x', title: 'x', start: 1, target: 100, moves: ['+1'], maxMoves: 2, solution: [] };
  assert.equal(replay(level, ['+1', '+1']).status, 'lost');
});

test('nothing changes after the level is over', () => {
  const level = { id: 'x', title: 'x', start: 1, target: 2, moves: ['+1'], maxMoves: 3, solution: ['+1'] };
  const won = replay(level, ['+1']);
  assert.deepEqual(apply(won, '+1'), won);
});

test('a move the level does not offer is rejected', () => {
  const level = { id: 'x', title: 'x', start: 1, target: 2, moves: ['+1'], maxMoves: 3, solution: ['+1'] };
  assert.throws(() => apply(start(level), '*9'));
});
