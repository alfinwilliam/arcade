// LEVELS for the template game, "Number Hop".
// This file is data only. To change the game's content you edit this file and nothing else.
//
// Schema (every field is required):
//   id        unique text, starting "tpl-"
//   title     shown above the level
//   start     the number you begin with
//   target    the number to reach
//   moves     the buttons on offer; each is "+N", "-N" or "*N"
//   maxMoves  how many presses you get
//   solution  a list of moves that wins. The tests replay it, so a level that
//             cannot be won as written fails `python3 scripts/arcade.py test`.
//
// To add a level: copy an entry, change the numbers, open the game with ?dev on
// the end of the URL, win it, and paste the moves it shows into `solution`.

export const levels = [
  { id: 'tpl-01', title: 'Warm up',     start: 1, target: 8,  moves: ['+3', '*2'],       maxMoves: 3, solution: ['+3', '*2'] },
  { id: 'tpl-02', title: 'Three ways',  start: 5, target: 13, moves: ['*2', '-1', '+3'], maxMoves: 3, solution: ['*2', '+3'] },
  { id: 'tpl-03', title: 'Mind the gap', start: 2, target: 21, moves: ['*3', '+1', '-2'], maxMoves: 4, solution: ['*3', '+1', '*3'] },
];
