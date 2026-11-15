// Runs the test files in the browser and shows the result.
//   tests/index.html                      every game on the hub, plus the template
//   tests/index.html?only=pod-packer      just the named files (comma separated)
//   ...&report=1                          also POST the result to scripts/arcade.py

import { runFiles, format } from './harness.js';

const params = new URLSearchParams(location.search);
let names = (params.get('only') || '').split(',').filter(Boolean);

if (names.length === 0) {
  const { games } = await import('../site/games.js');
  names = ['_template', ...games.map((game) => game.id)];
}

const summary = await runFiles(names, (name) => import(`./${name}.test.js`));
const lines = format(summary);
const passedAll = summary.failed === 0 && summary.passed > 0;

document.documentElement.dataset.status = passedAll ? 'pass' : 'fail';
document.title = `${passedAll ? 'PASS' : 'FAIL'} ${summary.passed}/${summary.passed + summary.failed}`;
document.getElementById('summary').textContent = lines[lines.length - 1];
document.getElementById('summary').className = passedAll ? 'ok' : 'fail';

const log = document.getElementById('log');
for (const line of lines.slice(0, -1)) {
  const row = document.createElement('div');
  row.textContent = line;
  row.className = line.startsWith('ok') ? 'ok' : 'fail';
  log.append(row);
}

if (params.has('report')) {
  await fetch('/__report', {
    method: 'POST',
    body: JSON.stringify({ kind: 'tests', passed: summary.passed, failed: summary.failed, lines }),
  });
}
