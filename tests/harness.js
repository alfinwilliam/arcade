// harness.js: a very small test harness with no dependencies.
// The same file runs in a browser (tests/index.html) and in Node (tests/run-node.mjs).
//
// In a test file:
//   import { test, assert } from './harness.js';
//   test('one plus one', () => { assert.equal(1 + 1, 2); });

const registered = [];   // every test() call lands here
let currentFile = '';    // set by runFiles() while a test file is loading

export function test(name, fn) {
  registered.push({ file: currentFile, name, fn });
}

function fail(message, detail) {
  throw new Error(message ? `${message}: ${detail}` : detail);
}

function show(value) {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

// Deep comparison for plain data: numbers, strings, booleans, null, arrays and objects.
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && same(a[key], b[key]));
}

export const assert = {
  ok(value, message) {
    if (!value) fail(message, `expected something true, got ${show(value)}`);
  },
  equal(actual, expected, message) {
    if (actual !== expected) fail(message, `expected ${show(expected)}, got ${show(actual)}`);
  },
  deepEqual(actual, expected, message) {
    if (!same(actual, expected)) fail(message, `expected ${show(expected)}, got ${show(actual)}`);
  },
  throws(fn, message) {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) fail(message, 'expected the function to throw, and it did not');
  },
};

// Load each test file (which registers its tests), then run everything.
// `load` is a function that imports one test file by name; the caller supplies it
// because a relative import() resolves from the file that contains it.
export async function runFiles(names, load) {
  for (const name of names) {
    currentFile = name;
    const before = registered.length;
    try {
      await load(name);
      if (registered.length === before) {
        registered.push({ file: name, name: '(no tests)', fn: () => fail('', 'this file registered no tests') });
      }
    } catch (error) {
      registered.push({ file: name, name: '(loading the test file)', fn: () => { throw error; } });
    }
  }
  currentFile = '';

  const results = [];
  for (const { file, name, fn } of registered) {
    try {
      await fn();
      results.push({ file, name, ok: true, error: '' });
    } catch (error) {
      results.push({ file, name, ok: false, error: String((error && error.message) || error) });
    }
  }
  const failed = results.filter((result) => !result.ok).length;
  return { passed: results.length - failed, failed, results };
}

// Turn a summary into printable lines. Used by the browser page and by Node, so both read the same.
export function format(summary) {
  const lines = [];
  for (const result of summary.results) {
    lines.push(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.file}: ${result.name}`);
    if (!result.ok) lines.push(`        ${result.error}`);
  }
  lines.push(`${summary.passed} passed, ${summary.failed} failed`);
  return lines;
}
