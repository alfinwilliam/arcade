// Tests for Subnet Slicer.
//
// Three groups:
//   1. the level data keeps to the rules in the header of levels.js
//   2. every answer the question maker gives is checked against a second, brute-force
//      calculation that shares no code with logic.js (it walks addresses one by one and
//      compares them as strings of bits)
//   3. each level's solution wins, and the mistakes the puzzles are about lose

import { test, assert } from './harness.js';
import { levels } from '../site/games/subnet-slicer/levels.js';
import {
  start, apply, replay, stars, current, makeQuestions, isCorrect, readable, planProblems, KINDS,
  ipToInt, intToIp, parseCidr, cidrText, inCidr, overlap, usableInAws, fitPrefix, cidrsubnet, asCidrsubnet,
} from '../site/games/subnet-slicer/logic.js';

const drills = levels.filter((level) => level.kind === 'drill');
const carves = levels.filter((level) => level.kind === 'carve');

// ------------------------------------------------- the brute-force second opinion
// An address is a 32-character string of 0s and 1s. A block is its first `prefix` characters.
// Walking a block means trying addresses one at a time and keeping those whose bits match.

const bitsOf = (address) => address.split('.').map((octet) => Number(octet).toString(2).padStart(8, '0')).join('');
const bitsToNumber = (bits) => parseInt(bits, 2);
const numberToBits = (n) => n.toString(2).padStart(32, '0');
const textOf = (n) => { const b = numberToBits(n); return [0, 8, 16, 24].map((i) => parseInt(b.slice(i, i + 8), 2)).join('.'); };

function blockOf(cidr) {
  const [address, prefix] = cidr.split('/');
  return { head: bitsOf(address).slice(0, Number(prefix)), prefix: Number(prefix) };
}
const isIn = (n, block) => numberToBits(n).startsWith(block.head);

// Every address in a block, in order, found by walking up from the all-zeros host part.
function walk(cidr) {
  const block = blockOf(cidr);
  const out = [];
  for (let n = bitsToNumber(block.head.padEnd(32, '0')); n < 2 ** 32 && isIn(n, block); n += 1) out.push(n);
  return out;
}

const sizeCache = {};
function bruteSize(prefix) {
  sizeCache[prefix] ??= walk(`10.0.0.0/${prefix}`).length;
  return sizeCache[prefix];
}
function bruteUsable(prefix) {
  return walk(`10.0.0.0/${prefix}`).slice(4, -1).length;   // AWS keeps the first four and the last
}

// The brute-force answer to any generated question, worked out from its text alone.
function bruteAnswer(question) {
  const t = question.text;
  let m;
  if ((m = /^How many addresses are in a \/(\d+)\?$/.exec(t))) return String(bruteSize(Number(m[1])));
  if ((m = /is a \/(\d+)\. How many addresses can you give/.exec(t))) return String(bruteUsable(Number(m[1])));
  if ((m = /holds (\d+) hosts\?$/.exec(t))) {
    for (let p = 28; p >= 16; p -= 1) if (bruteSize(p) - 5 >= Number(m[1])) return `/${p}`;
    return 'none';
  }
  if ((m = /^How many \/(\d+) subnets fit in one \/(\d+)\?$/.exec(t))) {
    const zeros = '0'.repeat(32 - Number(m[1]));
    return String(walk(`10.0.0.0/${m[2]}`).filter((n) => numberToBits(n).endsWith(zeros)).length);
  }
  if ((m = /^Is ([\d.]+) inside ([\d./]+)\?$/.exec(t))) return isIn(bitsToNumber(bitsOf(m[1])), blockOf(m[2])) ? 'yes' : 'no';
  if ((m = /^What is the network address \(the first address\) of ([\d.]+)\/(\d+)\?$/.exec(t))) {
    const block = blockOf(`${m[1]}/${m[2]}`);
    let n = bitsToNumber(bitsOf(m[1]));
    while (n > 0 && isIn(n - 1, block)) n -= 1;               // walk down to the first address
    return textOf(n);
  }
  if ((m = /^What is the last address of ([\d./]+)\?$/.exec(t))) return textOf(walk(m[1]).at(-1));
  if ((m = /^Which of these overlaps ([\d./]+)\?$/.exec(t))) {
    const target = blockOf(m[1]);
    const hits = question.choices.filter((choice) => walk(choice).some((n) => isIn(n, target)));
    return hits.length === 1 ? hits[0] : `${hits.length} choices overlap`;
  }
  return `no brute-force rule for: ${t}`;
}

// ------------------------------------------------------------ 1. the level data

test('level ids are unique and start with ss-', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith('ss-'), id);
});

for (const level of levels) {
  test(`${level.id}: kind, lesson, snippets and docs keep to the header's limits`, () => {
    assert.ok(['drill', 'carve'].includes(level.kind), `kind "${level.kind}"`);
    for (const field of ['title', 'brief', 'lesson']) assert.ok(typeof level[field] === 'string' && level[field].length > 0, field);
    assert.ok(level.inRealLife.length >= 1 && level.inRealLife.length <= 3, 'inRealLife: 1 to 3 snippets');
    for (const snippet of level.inRealLife) {
      assert.ok(snippet.label && snippet.code, 'each snippet has a label and code');
      assert.ok(snippet.code.split('\n').length <= 12, `"${snippet.label}" is over 12 lines`);
    }
    assert.ok(level.docs.length >= 1 && level.docs.length <= 3, 'docs: 1 to 3 URLs');
    for (const url of level.docs) assert.ok(url.startsWith('https://'), url);
  });

  // Snippet lines written as  cidrsubnet("10.0.0.0/24", 2, 2)  # "10.0.0.128/26"  must be true.
  test(`${level.id}: every cidrsubnet() result quoted in a snippet is right`, () => {
    for (const snippet of level.inRealLife) {
      for (const m of snippet.code.matchAll(/cidrsubnet\("([^"]+)", (\d+), (\d+)\)\s*# "([^"]+)"/g)) {
        assert.equal(cidrsubnet(m[1], Number(m[2]), Number(m[3])), m[4], m[0]);
      }
    }
  });
}

for (const level of drills) {
  test(`${level.id}: drill fields are in range`, () => {
    assert.ok(level.asks.length > 0 && level.asks.every((kind) => KINDS.includes(kind)), `asks: ${level.asks}`);
    const [low, high] = level.prefixes;
    assert.ok(Number.isInteger(low) && Number.isInteger(high) && low >= 16 && low <= high && high <= 28,
      `prefixes [${low}, ${high}] must be whole numbers with 16 <= low <= high <= 28`);
    if (level.asks.includes('split')) assert.ok(high > low, "'split' needs high > low");
    assert.ok(Number.isInteger(level.questions) && level.questions >= 1, 'questions');
    assert.ok(Number.isInteger(level.pass) && level.pass >= 1 && level.pass <= level.questions, 'pass: 1 to questions');
    assert.ok(Number.isInteger(level.seed), 'seed is a whole number');
    assert.equal(level.solution.length, level.questions, 'one answer per question');
  });
}

for (const level of carves) {
  test(`${level.id}: carve fields are in range`, () => {
    const vpc = parseCidr(level.vpc);
    assert.ok(vpc && vpc.prefix >= 16 && vpc.prefix <= 28, `vpc ${level.vpc}`);
    assert.equal(walk(level.vpc)[0], ipToInt(level.vpc.split('/')[0]), `vpc ${level.vpc} must start on its boundary`);
    const ids = level.needs.map((need) => need.id);
    assert.equal(new Set(ids).size, ids.length, 'need ids are unique');
    for (const need of level.needs) {
      assert.ok(/^\S+$/.test(need.id) && need.id !== 'apply', `need id "${need.id}"`);
      assert.ok(need.label, `${need.id} has a label`);
      assert.ok(Number.isInteger(need.hosts) && need.hosts >= 1, `${need.id}: hosts`);
      assert.ok(fitPrefix(need.hosts) !== null && fitPrefix(need.hosts) >= vpc.prefix, `${need.id}: ${need.hosts} hosts cannot fit in the VPC`);
    }
    for (const item of level.taken || []) {
      const block = parseCidr(item.cidr);
      assert.ok(item.label && block, `taken ${item.cidr}`);
      assert.equal(walk(item.cidr)[0], block.ip, `taken ${item.cidr} must start on its boundary`);
      assert.ok(walk(item.cidr).every((n) => isIn(n, blockOf(level.vpc))), `taken ${item.cidr} must be inside the VPC`);
    }
    if (level.mapRows !== undefined) {
      assert.ok(Number.isInteger(level.mapRows) && 2 ** (32 - vpc.prefix) % level.mapRows === 0, 'mapRows divides the VPC evenly');
    }
  });
}

// --------------------------------------------- 2. the question maker, checked

test('address helpers agree with hand-worked examples', () => {
  assert.equal(ipToInt('10.0.1.0'), 167772416);
  assert.equal(intToIp(167772416), '10.0.1.0');
  assert.equal(intToIp(ipToInt('203.0.113.255')), '203.0.113.255');
  assert.equal(parseCidr('10.0.0.0/33'), null);
  assert.equal(parseCidr('10.0.0/24'), null);
  assert.equal(parseCidr('256.0.0.0/8'), null);
  assert.ok(inCidr(ipToInt('10.0.3.17'), parseCidr('10.0.2.0/23')));
  assert.ok(!inCidr(ipToInt('10.0.4.0'), parseCidr('10.0.2.0/23')));
  assert.ok(overlap(parseCidr('10.0.4.0/22'), parseCidr('10.0.6.0/24')));
  assert.ok(!overlap(parseCidr('10.0.4.0/22'), parseCidr('10.0.8.0/24')));
  assert.equal(usableInAws(24), 251);
  assert.equal(fitPrefix(500), 23);
  assert.equal(fitPrefix(251), 24);
  assert.equal(fitPrefix(252), 23);
  assert.equal(fitPrefix(1), 28);
  assert.equal(fitPrefix(70000), null);
});

test('cidrsubnet matches the Terraform documentation examples', () => {
  assert.equal(cidrsubnet('10.0.0.0/16', 8, 1), '10.0.1.0/24');
  assert.equal(cidrsubnet('172.16.0.0/12', 4, 2), '172.18.0.0/16');
  assert.equal(cidrsubnet('10.1.2.0/24', 4, 15), '10.1.2.240/28');
  assert.equal(asCidrsubnet('10.0.0.0/24', '10.0.0.128/26'), 'cidrsubnet("10.0.0.0/24", 2, 2)');
});

// A level that asks everything, across the whole AWS range, to stretch the question maker.
const everything = { id: 'all', kind: 'drill', asks: KINDS, prefixes: [16, 28], questions: 16, pass: 1, seed: 1 };

function checkRound(level, seed) {
  const questions = makeQuestions(level, seed);
  assert.equal(questions.length, level.questions);
  questions.forEach((question, i) => {
    const where = `${level.id} seed ${seed} question ${i + 1} (${question.text})`;
    assert.ok(level.asks.includes(question.kind), `${where}: kind ${question.kind}`);
    assert.ok(readable(question, question.answer) && isCorrect(question, question.answer), `${where}: its own answer`);
    const brute = bruteAnswer(question);
    assert.ok(isCorrect(question, brute), `${where}: says ${question.answer}, brute force says ${brute}`);
    if (question.choices) {
      assert.equal(question.choices.filter((choice) => isCorrect(question, choice)).length, 1, `${where}: exactly one right choice`);
    } else if (question.input !== 'ip') {
      assert.ok(!isCorrect(question, String(Number(question.answer.replace('/', '')) + 1)), `${where}: a wrong number is wrong`);
    }
    assert.ok(question.explain.length > 0, `${where}: has an explanation`);
  });
}

for (const level of [...drills, everything]) {
  test(`${level.id}: the same seed gives the same questions, another seed different ones`, () => {
    assert.deepEqual(makeQuestions(level, level.seed), makeQuestions(level, level.seed));
    const texts = (seed) => makeQuestions(level, seed).map((q) => q.text).join('|');
    assert.ok(texts(level.seed) !== texts(level.seed + 1), 'seed + 1 should change the round');
  });

  test(`${level.id}: ten rounds of answers match the brute-force calculation`, () => {
    for (let seed = level.seed; seed < level.seed + 10; seed += 1) checkRound(level, seed);
  });
}

test('answers are read the way a person types them', () => {
  const [size] = makeQuestions({ ...everything, asks: ['size'], prefixes: [22, 22], questions: 1 }, 7);
  assert.ok(isCorrect(size, '1,024') && isCorrect(size, ' 1024 '));
  assert.ok(!readable(size, 'lots'));
  const [fit] = makeQuestions({ ...everything, asks: ['fit'], questions: 1 }, 7);
  assert.ok(isCorrect(fit, fit.answer.slice(1)), 'a prefix may be typed without the slash');
  const [net] = makeQuestions({ ...everything, asks: ['network'], prefixes: [22, 22], questions: 1 }, 7);
  assert.ok(isCorrect(net, `${net.answer}/22`), 'an address may carry its prefix');
  assert.ok(!readable(net, '10.0.300.0'));
  const [inside] = makeQuestions({ ...everything, asks: ['inside'], questions: 1 }, 7);
  assert.ok(readable(inside, 'Y') && readable(inside, 'no') && !readable(inside, 'maybe'));
});

// ---------------------------------------------------- 3. solutions and mistakes

for (const level of drills) {
  test(`${level.id}: the solution answers every question right and wins with 3 stars`, () => {
    const state = replay(level, level.solution);
    assert.equal(state.status, 'won');
    assert.equal(state.correct, level.questions);
    assert.equal(stars(state), 3);
  });

  test(`${level.id}: doing nothing does not win; too many wrong answers lose`, () => {
    assert.equal(replay(level, []).status, 'playing');
    const wrongs = level.questions - level.pass + 1;     // one more wrong answer than the level allows
    const inputs = level.solution.map((answer, i) => {
      if (i >= wrongs) return answer;
      const question = makeQuestions(level, level.seed)[i];
      return question.choices ? question.choices.find((c) => !isCorrect(question, c)) : (question.input === 'ip' ? '0.0.0.0' : '1');
    });
    assert.equal(replay(level, inputs).status, 'lost');
  });
}

test('one wrong answer still wins, with 2 stars; time plays no part', () => {
  const level = { ...everything, asks: ['size'], prefixes: [24, 24], questions: 3, pass: 2 };
  const state = replay(level, ['256', '1', '256']);
  assert.equal(state.status, 'won');
  assert.equal(stars(state), 2);
});

test('an answer of the wrong form is refused, and a finished round ignores input', () => {
  const level = { ...everything, asks: ['size'], prefixes: [24, 24], questions: 1, pass: 1 };
  assert.throws(() => apply(start(level), 'abc'));
  const won = replay(level, ['256']);
  assert.equal(current(won), null);
  assert.deepEqual(apply(won, '256'), won);
});

for (const level of carves) {
  const places = level.solution.filter((input) => input !== 'apply');

  test(`${level.id}: the solution wins with 3 stars`, () => {
    const state = replay(level, level.solution);
    assert.equal(state.status, 'won', JSON.stringify(state.problems));
    assert.equal(stars(state), 3);
    assert.equal(level.solution.at(-1), 'apply');
  });

  test(`${level.id}: doing nothing does not win; an empty plan loses`, () => {
    assert.equal(replay(level, []).status, 'playing');
    const state = replay(level, ['apply']);
    assert.equal(state.status, 'lost');
    assert.ok(state.problems.every((p) => p.code === 'missing'));
  });

  test(`${level.id}: the solution is the same plan written as cidrsubnet() calls`, () => {
    for (const input of places) {
      const [, block] = input.split(' ');
      const m = /cidrsubnet\("([^"]+)", (\d+), (\d+)\)/.exec(asCidrsubnet(level.vpc, block));
      assert.equal(cidrsubnet(m[1], Number(m[2]), Number(m[3])), block);
    }
  });

  test(`${level.id}: moving one subnet onto another loses with 'overlap'`, () => {
    const [firstId, firstBlock] = places[0].split(' ');
    const [secondId, secondBlock] = places[1].split(' ');
    const moved = `${secondId} ${firstBlock.split('/')[0]}/${secondBlock.split('/')[1]}`;
    const state = replay(level, [...places, moved, 'apply']);
    assert.equal(state.status, 'lost');
    assert.ok(state.problems.some((p) => p.code === 'overlap' && [firstId, secondId].includes(p.need)));
  });

  test(`${level.id}: a block off its boundary loses with 'misaligned'`, () => {
    const [id, block] = places[0].split(' ');
    const parsed = parseCidr(block);
    const nudged = `${id} ${intToIp(parsed.ip + 1)}/${parsed.prefix}`;
    const state = replay(level, [...places, nudged, 'apply']);
    assert.equal(state.status, 'lost');
    assert.ok(state.problems.some((p) => p.code === 'misaligned' && p.need === id));
  });
}

test('carve: too small, outside the VPC, wrong size for AWS and taken blocks are caught', () => {
  const level = {
    id: 'x', kind: 'carve', vpc: '10.0.0.0/24', mapRows: 1,
    needs: [{ id: 'a', label: 'a', hosts: 100 }, { id: 'b', label: 'b', hosts: 2 }],
    taken: [{ label: 'old', cidr: '10.0.0.192/26' }],
  };
  const codes = (inputs) => planProblems(replay(level, inputs)).map((p) => `${p.need} ${p.code}`);
  assert.deepEqual(codes(['a 10.0.0.0/26', 'b 10.0.0.128/28']), ['a small']);    // 59 usable < 100
  assert.deepEqual(codes(['a 10.0.0.0/25', 'b 10.0.1.0/28']), ['b outside']);
  assert.deepEqual(codes(['a 10.0.0.0/25', 'b 10.0.0.128/29']), ['b range']);   // AWS's smallest is a /28
  assert.deepEqual(codes(['a 10.0.0.0/25', 'b 10.0.0.192/28']), ['b overlap']);  // on the taken block
  assert.equal(replay(level, ['a 10.0.0.0/25', 'b 10.0.0.128/28', 'apply']).status, 'won');
  assert.equal(cidrText(parseCidr(' 10.0.0.0 / 25 ')), '10.0.0.0/25');
});

test('carve: an unknown need or a broken block is refused, and placing again moves the block', () => {
  const level = carves[0];
  assert.throws(() => apply(start(level), 'nobody 10.0.0.0/24'));
  assert.throws(() => apply(start(level), `${level.needs[0].id} 10.0.0/24`));
  const id = level.needs[0].id;
  const state = replay(level, [`${id} 10.0.0.0/26`, `${id} 10.0.0.64/26`]);
  assert.equal(cidrText(state.blocks[id]), '10.0.0.64/26');
});
