// RULES for the template game. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.

// The state at the start of a level.
export function start(level) {
  return { level, value: level.start, used: 0, status: 'playing' };
}

// The one way state changes. The page calls this for every button press and
// replay() calls it for every recorded move, so both follow exactly the same rules.
// It returns a new state and never edits the old one.
export function apply(state, move) {
  if (state.status !== 'playing') return state;
  if (!state.level.moves.includes(move)) {
    throw new Error(`"${move}" is not a move in level ${state.level.id}`);
  }

  const sign = move[0];
  const amount = Number(move.slice(1));
  let value = state.value;
  if (sign === '+') value += amount;
  if (sign === '-') value -= amount;
  if (sign === '*') value *= amount;

  const used = state.used + 1;
  let status = 'playing';
  if (value === state.level.target) status = 'won';
  else if (used >= state.level.maxMoves) status = 'lost';

  return { ...state, value, used, status };
}

// Play a whole list of moves from the start. Returns the final state.
export function replay(level, solution) {
  let state = start(level);
  for (const move of solution) state = apply(state, move);
  return state;
}

// Three stars for matching the reference solution's length, fewer for each extra move.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const extra = state.used - state.level.solution.length;
  return Math.max(1, 3 - Math.max(0, extra));
}
