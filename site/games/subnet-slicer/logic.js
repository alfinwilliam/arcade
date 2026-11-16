// RULES for Subnet Slicer. Pure: no page, no storage, no timers, no randomness.
//
// The drill questions look random, but they come from a seeded number generator: the same
// seed always gives the same questions in the same order. So a round can be replayed, and the
// tests can check every answer this file gives against a second, slower calculation.
//
// Addresses are handled as whole numbers: 10.0.1.0 is 10*256^3 + 0*256^2 + 1*256 + 0.
// We use * and Math.floor, never the << and >> operators, because those work on signed
// 32-bit numbers and would turn the upper half of all addresses negative.
//
// Contents:
//   1. address helpers      ipToInt, intToIp, parseCidr, blockSize, isAligned, overlap ...
//   2. AWS sizing           usableInAws, fitPrefix (AWS keeps 5 addresses in every subnet)
//   3. Terraform            cidrsubnet, asCidrsubnet
//   4. the question maker   makeQuestions(level, seed), isCorrect, readable
//   5. drill rounds         answer questions one by one
//   6. carve puzzles        place a block for each need, then 'apply'
//   7. start, apply, replay, stars: the contract every game follows

// ------------------------------------------------------------ 1. address helpers

// '10.0.1.0' -> 167772416. Anything that is not four numbers from 0 to 255 gives null.
export function ipToInt(text) {
  const parts = String(text).trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

// 167772416 -> '10.0.1.0'
export function intToIp(value) {
  return [16777216, 65536, 256, 1].map((place) => Math.floor(value / place) % 256).join('.');
}

// How many addresses a block with this prefix holds: 2 to the power of (32 - prefix).
export function blockSize(prefix) {
  return 2 ** (32 - prefix);
}

// '10.0.4.0/22' -> { ip: <10.0.4.0 as a number>, prefix: 22 }. Null if it does not parse.
// The address is kept exactly as written, even if it is not on a boundary (see isAligned).
export function parseCidr(text) {
  const match = /^\s*([0-9.]+)\s*\/\s*(\d{1,2})\s*$/.exec(String(text));
  if (!match) return null;
  const ip = ipToInt(match[1]);
  const prefix = Number(match[2]);
  if (ip === null || prefix > 32) return null;
  return { ip, prefix };
}

// { ip, prefix } -> '10.0.4.0/22'
export function cidrText(block) {
  return `${intToIp(block.ip)}/${block.prefix}`;
}

// The start of the block of this size that holds the address: round down to a multiple of the size.
export function networkOf(ip, prefix) {
  const size = blockSize(prefix);
  return Math.floor(ip / size) * size;
}

// The last address of a block, counting from the address as written.
export function lastOf(block) {
  return block.ip + blockSize(block.prefix) - 1;
}

// A block is aligned when it starts on a multiple of its own size: 10.0.4.0/22 is, 10.0.5.0/22 is not.
export function isAligned(block) {
  return block.ip % blockSize(block.prefix) === 0;
}

// Is the address inside the block?
export function inCidr(ip, block) {
  return ip >= block.ip && ip <= lastOf(block);
}

// Do two blocks share at least one address?
export function overlap(a, b) {
  return a.ip <= lastOf(b) && b.ip <= lastOf(a);
}

// Is block `inner` wholly inside block `outer`?
export function contains(outer, inner) {
  return inner.ip >= outer.ip && lastOf(inner) <= lastOf(outer);
}

// --------------------------------------------------------------- 2. AWS sizing

// AWS keeps 5 addresses in every subnet: the first four (the network address, the VPC router,
// one reserved for DNS, one for future use) and the last (broadcast) address.
// Source: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html
export const AWS_RESERVED = 5;
export const AWS_BIGGEST = 16;     // the biggest subnet AWS allows is a /16 ...
export const AWS_SMALLEST = 28;    // ... and the smallest is a /28

// Addresses you can give to instances in an AWS subnet with this prefix.
export function usableInAws(prefix) {
  return blockSize(prefix) - AWS_RESERVED;
}

// The smallest AWS subnet (the biggest prefix number) that holds this many hosts, or null.
export function fitPrefix(hosts) {
  for (let prefix = AWS_SMALLEST; prefix >= AWS_BIGGEST; prefix -= 1) {
    if (usableInAws(prefix) >= hosts) return prefix;
  }
  return null;
}

// ---------------------------------------------------------------- 3. Terraform

// Terraform's cidrsubnet(prefix, newbits, netnum): make the prefix `newbits` longer and take
// block number `netnum` (counting from 0). cidrsubnet('10.0.0.0/16', 8, 1) -> '10.0.1.0/24'.
export function cidrsubnet(prefixText, newbits, netnum) {
  const parent = parseCidr(prefixText);
  const prefix = parent.prefix + newbits;
  return cidrText({ ip: parent.ip + netnum * blockSize(prefix), prefix });
}

// The other way round: how to write a block of the VPC as a cidrsubnet() call.
// asCidrsubnet('10.0.0.0/24', '10.0.0.128/26') -> 'cidrsubnet("10.0.0.0/24", 2, 2)'
export function asCidrsubnet(vpcText, blockText) {
  const vpc = parseCidr(vpcText);
  const block = parseCidr(blockText);
  const netnum = (block.ip - vpc.ip) / blockSize(block.prefix);
  return `cidrsubnet("${vpcText}", ${block.prefix - vpc.prefix}, ${netnum})`;
}

// ------------------------------------------------------------ 4. the question maker

// A seeded number generator (the well-known "mulberry32"). pick(n) gives a whole number
// from 0 to n - 1. The same seed always gives the same sequence.
export function seeded(seed) {
  let a = seed >>> 0;
  return function pick(n) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

// The kinds of question a drill level may ask (its `asks` list).
export const KINDS = ['size', 'usable', 'fit', 'split', 'inside', 'network', 'last', 'overlap'];

const ORDINAL = ['first', 'second', 'third', 'fourth'];

// "A /22 moves in steps of 4 in the third octet": the shortcut for finding boundaries by hand.
function stepOf(prefix) {
  const octet = Math.min(3, Math.floor((prefix - 1) / 8));   // the octet the prefix ends in
  return { octet, step: 2 ** (8 * (octet + 1) - prefix) };
}
function stepLine(prefix) {
  const { octet, step } = stepOf(prefix);
  return `A /${prefix} moves in steps of ${step} in the ${ORDINAL[octet]} octet`;
}
function octetOf(ip, octet) {
  return Math.floor(ip / 256 ** (3 - octet)) % 256;
}

// A random address in 10.0.0.0 to 10.31.255.255, and a random block of a given prefix.
function randomIp(pick) {
  return ipToInt('10.0.0.0') + pick(32) * 65536 + pick(256) * 256 + pick(256);
}
function randomBlock(pick, prefix) {
  return { ip: networkOf(randomIp(pick), prefix), prefix };
}
function between(pick, low, high) {
  return high > low ? low + pick(high - low + 1) : low;
}

// One function per kind. Each returns { kind, text, answer, input, explain } and, for
// pick-one questions, `choices`. `input` tells the page what to expect:
//   'number' a whole number    'prefix' a prefix such as /23    'ip' an address
//   'choice' one of `choices`
const MAKERS = {
  size(pick, low, high) {
    const prefix = between(pick, low, high);
    const bits = 32 - prefix;
    return {
      text: `How many addresses are in a /${prefix}?`,
      answer: String(blockSize(prefix)), input: 'number',
      explain: `32 − ${prefix} = ${bits} bits are left for addresses, and 2^${bits} = ${blockSize(prefix)}.`,
    };
  },

  usable(pick, low, high) {
    const prefix = between(pick, Math.max(low, AWS_BIGGEST), Math.min(high, AWS_SMALLEST));
    const size = blockSize(prefix);
    return {
      text: `An AWS subnet is a /${prefix}. How many addresses can you give to instances?`,
      answer: String(size - AWS_RESERVED), input: 'number',
      explain: `A /${prefix} holds 2^${32 - prefix} = ${size} addresses. AWS keeps 5 in every subnet `
        + `(network address, VPC router, one reserved for DNS, one for future use, and the last address): `
        + `${size} − 5 = ${size - 5}.`,
    };
  },

  fit(pick, low, high) {
    const prefix = between(pick, Math.max(low, AWS_BIGGEST), Math.min(high, AWS_SMALLEST));
    const most = usableInAws(prefix);                     // the most hosts this prefix holds
    const fewest = blockSize(prefix + 1) - AWS_RESERVED + 1;   // one more than the next size down holds
    const roll = pick(4);                                 // edge cases are the interview favourites
    const hosts = roll === 0 ? most : roll === 1 ? fewest : between(pick, fewest, most);
    const need = hosts + AWS_RESERVED;
    return {
      text: `What is the smallest AWS subnet that holds ${hosts} hosts?`,
      answer: `/${prefix}`, input: 'prefix',
      explain: `Add the 5 addresses AWS keeps: ${hosts} + 5 = ${need}. The smallest power of two that holds `
        + `${need} is 2^${32 - prefix} = ${blockSize(prefix)}, which needs ${32 - prefix} host bits, `
        + `so the prefix is 32 − ${32 - prefix} = /${prefix} (${most} usable).`,
    };
  },

  split(pick, low, high) {
    const outer = between(pick, low, Math.max(low, high - 1));
    const inner = Math.min(32, between(pick, outer + 1, Math.min(outer + 8, Math.max(high, outer + 1))));
    const bits = inner - outer;
    return {
      text: `How many /${inner} subnets fit in one /${outer}?`,
      answer: String(2 ** bits), input: 'number',
      explain: `Each extra prefix bit halves the block. From /${outer} to /${inner} is ${bits} `
        + `bit${bits === 1 ? '' : 's'}, so 2^${bits} = ${2 ** bits} subnets of ${blockSize(inner)} addresses.`,
    };
  },

  inside(pick, low, high) {
    const block = randomBlock(pick, between(pick, low, high));
    const size = blockSize(block.prefix);
    const roll = pick(3);                                 // inside, just before, or just after
    let ip = block.ip + pick(size);
    if (roll === 1 && block.ip >= ipToInt('10.0.0.0') + size) ip = block.ip - 1 - pick(size);
    if (roll === 2) ip = block.ip + size + pick(size);
    const yes = inCidr(ip, block);
    const rest = yes ? 'inside' : `outside: it belongs to ${intToIp(networkOf(ip, block.prefix))}/${block.prefix}`;
    return {
      text: `Is ${intToIp(ip)} inside ${cidrText(block)}?`,
      answer: yes ? 'yes' : 'no', input: 'choice', choices: ['yes', 'no'],
      explain: `${stepLine(block.prefix)}, so ${cidrText(block)} runs from ${intToIp(block.ip)} to `
        + `${intToIp(lastOf(block))}. ${intToIp(ip)} is ${rest}.`,
    };
  },

  network(pick, low, high) {
    const prefix = between(pick, low, high);
    const ip = randomIp(pick);
    const net = networkOf(ip, prefix);
    const { octet, step } = stepOf(prefix);
    const value = octetOf(ip, octet);
    const tail = octet === 3 ? '' : ' Set the octets after it to 0.';
    return {
      text: `What is the network address (the first address) of ${intToIp(ip)}/${prefix}?`,
      answer: intToIp(net), input: 'ip',
      explain: `${stepLine(prefix)}. In ${intToIp(ip)} that octet is ${value}; the multiple of ${step} `
        + `at or below it is ${value - (value % step)}.${tail} Answer: ${intToIp(net)}.`,
    };
  },

  last(pick, low, high) {
    const block = randomBlock(pick, between(pick, low, high));
    const next = block.ip + blockSize(block.prefix);
    return {
      text: `What is the last address of ${cidrText(block)}?`,
      answer: intToIp(next - 1), input: 'ip',
      explain: `${stepLine(block.prefix)} (${blockSize(block.prefix)} addresses), so the next block starts at `
        + `${intToIp(next)}. The last address is the one before it: ${intToIp(next - 1)}. `
        + 'In an AWS subnet this is one of the 5 addresses AWS keeps.',
    };
  },

  overlap(pick, low, high) {
    const prefix = between(pick, low, high);
    const size = blockSize(prefix);
    // Keep the block clear of 10.0.0.0 so the "just before" decoy stays in 10.x.
    const base = { ip: networkOf(randomIp(pick) + 65536, prefix), prefix };
    // The one that overlaps: a smaller block inside it, or (sometimes) a bigger block around it.
    let hit;
    if (pick(3) === 0 && prefix > 8) {
      const bigger = prefix - 1 - pick(2);
      hit = { ip: networkOf(base.ip, bigger), prefix: bigger };
    } else {
      const smaller = Math.min(32, prefix + 1 + pick(3));
      hit = { ip: base.ip + pick(2 ** (smaller - prefix)) * blockSize(smaller), prefix: smaller };
    }
    // Two that do not: one ending just before the block, one starting just after it.
    const beforePrefix = Math.min(32, prefix + pick(3));
    const before = { ip: base.ip - blockSize(beforePrefix), prefix: beforePrefix };
    const after = { ip: base.ip + size, prefix: Math.min(32, prefix + pick(3)) };
    const choices = [hit, before, after].map(cidrText);
    for (let i = choices.length - 1; i > 0; i -= 1) {    // shuffle, so the answer is not always first
      const j = pick(i + 1);
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    const how = hit.prefix > prefix ? 'sits inside it' : 'contains it';
    return {
      text: `Which of these overlaps ${cidrText(base)}?`,
      answer: cidrText(hit), input: 'choice', choices,
      explain: `CIDR blocks either nest or do not touch at all. ${cidrText(base)} runs from ${intToIp(base.ip)} `
        + `to ${intToIp(lastOf(base))}; ${cidrText(hit)} ${how}. The other two lie wholly outside that range.`,
    };
  },
};

// The questions for one drill round: level.questions of them, the kinds in level.asks
// shared out evenly and shuffled, prefixes from level.prefixes. Same level + seed = same list.
export function makeQuestions(level, seed) {
  const pick = seeded(seed);
  const [low, high] = level.prefixes;
  const kinds = [];
  for (let i = 0; i < level.questions; i += 1) kinds.push(level.asks[i % level.asks.length]);
  for (let i = kinds.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const seen = new Set();
  return kinds.map((kind) => {
    if (!MAKERS[kind]) throw new Error(`level ${level.id}: "${kind}" is not a question kind (see KINDS in logic.js)`);
    let question = MAKERS[kind](pick, low, high);
    for (let tries = 0; tries < 20 && seen.has(question.text); tries += 1) question = MAKERS[kind](pick, low, high);
    seen.add(question.text);
    return { kind, ...question };
  });
}

// Tidy what the player typed: '1,024' -> '1024', ' /23 ' -> '23', 'Yes' -> 'yes'.
function tidy(question, text) {
  const raw = String(text).trim().toLowerCase();
  if (question.input === 'number') return raw.replace(/[\s,_]/g, '');
  if (question.input === 'prefix') return raw.replace(/^\/\s*/, '');
  if (question.input === 'ip') return raw.replace(/\s*\/\s*\d{1,2}$/, '');   // '10.0.4.0/22' is fine too
  if (raw === 'y') return 'yes';
  if (raw === 'n') return 'no';
  return raw.replace(/\s+/g, '');
}

// Is this a well-formed answer for the question (right or wrong)? The page asks before sending.
export function readable(question, text) {
  const value = tidy(question, text);
  if (question.input === 'number') return /^\d{1,10}$/.test(value);
  if (question.input === 'prefix') return /^\d{1,2}$/.test(value) && Number(value) <= 32;
  if (question.input === 'ip') return ipToInt(value) !== null;
  return question.choices.includes(value);
}

export function isCorrect(question, text) {
  const value = tidy(question, text);
  if (question.input === 'number') return Number(value) === Number(question.answer);
  if (question.input === 'prefix') return `/${Number(value)}` === question.answer;
  if (question.input === 'ip') return ipToInt(value) === ipToInt(question.answer);
  return value === question.answer;
}

// --------------------------------------------------------------- 5. drill rounds

function startDrill(level, seed) {
  return { level, seed, questions: makeQuestions(level, seed), answers: [], correct: 0, status: 'playing' };
}

// The question waiting for an answer, or null when the round is over.
export function current(state) {
  return state.level.kind === 'drill' && state.status === 'playing' ? state.questions[state.answers.length] : null;
}

function answerDrill(state, text) {
  const question = current(state);
  if (!readable(question, text)) {
    throw new Error(`"${text}" is not a possible answer to question ${state.answers.length + 1} of ${state.level.id}`);
  }
  const right = isCorrect(question, text);
  const answers = [...state.answers, { given: String(text).trim(), right }];
  const correct = state.correct + (right ? 1 : 0);
  let status = 'playing';
  if (answers.length === state.questions.length) status = correct >= state.level.pass ? 'won' : 'lost';
  return { ...state, answers, correct, status };
}

// ------------------------------------------------------------- 6. carve puzzles

function startCarve(level) {
  const taken = (level.taken || []).map((item) => ({ label: item.label, ...parseCidr(item.cidr) }));
  return { level, vpc: parseCidr(level.vpc), taken, blocks: {}, problems: [], status: 'playing' };
}

// Everything wrong with the plan as it stands: a list of { need, code, text }, where need is
// the need's id. The codes: 'missing' 'range' 'misaligned' 'outside' 'small' 'overlap'.
// The page shows these as you go; 'apply' with any of them loses.
export function planProblems(state) {
  const { level, vpc, taken, blocks } = state;
  const found = [];
  const add = (need, code, text) => found.push({ need, code, text });
  for (const need of level.needs) {
    const block = blocks[need.id];
    if (!block) {
      add(need.id, 'missing', 'not placed yet');
      continue;
    }
    const cidr = cidrText(block);
    if (block.prefix < AWS_BIGGEST || block.prefix > AWS_SMALLEST) {
      add(need.id, 'range', `AWS subnets must be between /${AWS_BIGGEST} and /${AWS_SMALLEST}`);
    }
    if (!isAligned(block)) {
      const real = `${intToIp(networkOf(block.ip, block.prefix))}/${block.prefix}`;
      add(need.id, 'misaligned', `${cidr} is not on a /${block.prefix} boundary (a multiple of `
        + `${blockSize(block.prefix)} addresses). AWS would round it down to ${real}, not the block you planned`);
    }
    if (!contains(vpc, block)) add(need.id, 'outside', `not inside the VPC ${cidrText(vpc)}`);
    if (usableInAws(block.prefix) < need.hosts) {
      add(need.id, 'small', `a /${block.prefix} has ${Math.max(0, usableInAws(block.prefix))} usable `
        + `addresses in AWS; this needs ${need.hosts}`);
    }
    for (const other of level.needs) {
      const theirs = blocks[other.id];
      if (other.id !== need.id && theirs && overlap(block, theirs)) {
        add(need.id, 'overlap', `overlaps ${other.id} (${cidrText(theirs)})`);
      }
    }
    for (const item of taken) {
      if (overlap(block, item)) add(need.id, 'overlap', `overlaps ${item.label} (${cidrText(item)}), which is taken`);
    }
  }
  return found;
}

// '<need id> <cidr>' places (or moves) that need's subnet; 'apply' checks the whole plan.
function carveInput(state, input) {
  if (input === 'apply') {
    const problems = planProblems(state);
    return { ...state, problems, status: problems.length ? 'lost' : 'won' };
  }
  const [id, text, extra] = String(input).trim().split(/\s+/);
  const need = state.level.needs.find((item) => item.id === id);
  const block = parseCidr(text || '');
  if (!need || !block || extra !== undefined) {
    throw new Error(`"${input}" is not an input in ${state.level.id}: use "<need id> <cidr>" or "apply"`);
  }
  return { ...state, blocks: { ...state.blocks, [id]: block } };
}

// ----------------------------------------------- 7. start, apply, replay, stars

// The state at the start of a level. `seed` picks a drill's questions (default: the level's own).
export function start(level, seed = level.seed) {
  return level.kind === 'drill' ? startDrill(level, seed) : startCarve(level);
}

// The one way state changes. The page calls it for every answer or placement; replay() calls
// it for every recorded input. It returns a new state and never edits the old one.
export function apply(state, input) {
  if (state.status !== 'playing') return state;
  return state.level.kind === 'drill' ? answerDrill(state, input) : carveInput(state, input);
}

// Play a whole list of inputs from the start. Returns the final state.
export function replay(level, solution, seed = level.seed) {
  let state = start(level, seed);
  for (const input of solution) state = apply(state, input);
  return state;
}

// Drills: three stars with no wrong answer, two with one, one otherwise. Time never counts.
// Carve puzzles: three stars for a plan AWS would accept.
export function stars(state) {
  if (state.status !== 'won') return 0;
  if (state.level.kind !== 'drill') return 3;
  const wrong = state.answers.length - state.correct;
  return Math.max(1, 3 - wrong);
}
