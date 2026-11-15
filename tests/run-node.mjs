// CI entry point: runs the same test files as the browser page, under Node.
//   node tests/run-node.mjs               every *.test.js in this folder
//   node tests/run-node.mjs pod-packer    one game
//
// Locally you do not need Node: use `python3 scripts/arcade.py test` instead.

import { readdirSync } from 'node:fs';
import { runFiles, format } from './harness.js';

const wanted = process.argv.slice(2);
const all = readdirSync(new URL('.', import.meta.url))
  .filter((file) => file.endsWith('.test.js'))
  .map((file) => file.slice(0, -'.test.js'.length))
  .sort();
const names = wanted.length > 0 ? wanted : all;

const summary = await runFiles(names, (name) => import(`./${name}.test.js`));
for (const line of format(summary)) console.log(line);

process.exit(summary.failed === 0 && summary.passed > 0 ? 0 : 1);
