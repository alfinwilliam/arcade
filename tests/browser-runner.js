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

// Ask locate.html where a module failed to load: "site/games/pod-packer/levels.js, line 42".
function locate(src) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    let finished = false;
    function done(text) {
      if (finished) return;
      finished = true;
      removeEventListener('message', onMessage);
      frame.remove();
      resolve(text);
    }
    function onMessage(event) {
      if (!event.data || !event.data.locate) return;
      const { file, line } = event.data;
      done(file && line ? `${file.replace(location.origin + '/', '')}, line ${line}` : '');
    }
    addEventListener('message', onMessage);
    setTimeout(() => done(''), 3000);
    frame.src = `./locate.html?module=${encodeURIComponent(src)}`;
    document.body.append(frame);
  });
}

async function load(name) {
  try {
    return await import(`./${name}.test.js`);
  } catch (error) {
    const where = await locate(`./${name}.test.js`);
    if (!where) throw error;
    throw new Error(`${error.message} (in ${where}: usually a missing comma or bracket at or just before that line)`);
  }
}

const summary = await runFiles(names, load);
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
