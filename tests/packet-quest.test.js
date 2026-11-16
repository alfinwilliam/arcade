// Tests for Packet Quest.
// Three parts:
//   1. Every level: the data is well formed, the untouched level fails where it says it
//      does, the solution wins, and no other fix on offer wins.
//   2. The hop rules, one small made-up level per rule (security group, network ACL ...).
//   3. The game state: stars, hints, choosing and undoing fixes.

import { test, assert } from './harness.js';
import { levels } from '../site/games/packet-quest/levels.js';
import {
  inCidr, pickRoute, prefixLength, ipToNumber, trace, replay, start, apply, stars, starsLeft,
  activeFixes, currentHops, fixIdsIn, HOP_KINDS, RESERVED_INPUTS,
} from '../site/games/packet-quest/logic.js';

// ------------------------------------------------------------------ helpers

const SYMPTOMS = ['nxdomain', 'timeout', 'refused'];
const FIRST_FOG_LEVEL = 5;      // levels from this number on hide where the packet stopped
const FIRST_REPLY_LEVEL = 6;    // levels from this number on have a reply hop

// Addresses a public repo may contain: private 10.x, the two documentation ranges, and "anywhere".
// Loopback and 0.0.0.0 appear in text about what a listening socket accepts.
const EXAMPLE_RANGES = ['10.0.0.0/8', '198.51.100.0/24', '203.0.113.0/24', '127.0.0.0/8', '0.0.0.0/32'];

// Rule codes that stand for "the level itself is built wrong" or for behaviour the game
// does not claim to know. No shipped level may reach them with any choice of fixes.
const FORBIDDEN_CODES = ['svc-no-match', 'listen-wrong-address', 'reply-misaddressed', 'nat-unknown'];

// Every way of picking `size` items from a list.
function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
  return [...withFirst, ...combinations(rest, size)];
}

// Every set of fixes a player can really have chosen: at most one fix per hop.
function reachableFixSets(level) {
  let sets = [[]];
  for (const hop of level.hops) {
    const here = level.fixes.filter((fix) => fix.hop === hop.id);
    const next = [];
    for (const set of sets) {
      next.push(set);
      for (const fix of here) next.push([...set, fix.id]);
    }
    sets = next;
  }
  return sets;
}

// Every address and range written anywhere in a level, found by walking the data.
function addressesIn(value, found = []) {
  if (typeof value === 'string') {
    for (const match of value.match(/\d+\.\d+\.\d+\.\d+(\/\d+)?/g) || []) found.push(match);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      addressesIn(key, found);
      addressesIn(inner, found);
    }
  }
  return found;
}

function isExampleAddress(text) {
  if (text === '0.0.0.0/0') return true;
  const ip = text.split('/')[0];
  return EXAMPLE_RANGES.some((range) => inCidr(ip, range));
}

// A small level for the rule tests: a dns hop, then the hops under test.
function tiny(hops, request = {}) {
  return {
    id: 'pq-test', title: 'test', fixes: [], hints: [], solution: [],
    request: { from: '198.51.100.7', fromPort: 51000, host: 'app.example.com', port: 443, ...request },
    hops: [{ id: 'dns', kind: 'dns', name: 'dns', records: { 'app.example.com': '203.0.113.20' } }, ...hops],
  };
}

const SERVER = { id: 'web', kind: 'listener', name: 'web', ip: '203.0.113.20', port: 443 };
const TURN = { id: 'turn', kind: 'reply', name: 'reply' };

function lastCode(result) {
  return result.steps[result.steps.length - 1].code;
}

// ------------------------------------------------------- 1. every level

test('there are eight levels and their ids are unique', () => {
  const ids = levels.map((level) => level.id);
  assert.equal(levels.length, 8);
  assert.equal(new Set(ids).size, ids.length);
});

levels.forEach((level, index) => {
  const number = index + 1;
  const neededFixes = fixIdsIn(level.solution);
  const hasReply = level.hops.some((hop) => hop.kind === 'reply');

  test(`${level.id}: has every field a level needs`, () => {
    assert.ok(level.id.startsWith('pq-'), 'id starts with pq-');
    for (const field of ['title', 'brief', 'lesson', 'term', 'command', 'reveals']) {
      assert.ok(typeof level[field] === 'string' && level[field].length > 0, `${field} is text`);
    }
    assert.ok(level.hints.length >= 1 && level.hints.length <= 2, 'one or two hints');
    assert.ok(SYMPTOMS.includes(level.expect.symptom), 'expect.symptom is a known symptom');
    assert.ok(level.request.from && level.request.host && level.request.port, 'request is complete');
    assert.equal(level.fog, number >= FIRST_FOG_LEVEL, 'fog starts at level 5');
  });

  test(`${level.id}: hops are well formed`, () => {
    const ids = level.hops.map((hop) => hop.id);
    assert.equal(new Set(ids).size, ids.length, 'hop ids are unique');
    assert.equal(level.hops[0].kind, 'dns', 'the first hop is dns');
    for (const hop of level.hops) {
      assert.ok(HOP_KINDS.includes(hop.kind), `hop ${hop.id} has a known kind`);
      assert.ok(typeof hop.name === 'string' && hop.name.length > 0, `hop ${hop.id} has a name`);
      assert.ok(!hop.id.includes(':'), `hop id ${hop.id} has no colon`);
    }
    // The packet must end at a program: the last hop before the reply (or the last hop) is a listener.
    const turnAt = level.hops.findIndex((hop) => hop.kind === 'reply');
    const lastForward = turnAt === -1 ? level.hops[level.hops.length - 1] : level.hops[turnAt - 1];
    assert.equal(lastForward.kind, 'listener', 'the way there ends at a listener');
  });

  test(`${level.id}: levels 1 to 5 go one way, levels 6 to 8 have a reply`, () => {
    assert.equal(hasReply, number >= FIRST_REPLY_LEVEL);
    if (hasReply) assert.ok(level.request.fromPort > 1023, 'a reply level names the client port');
  });

  test(`${level.id}: fixes are well formed`, () => {
    const ids = level.fixes.map((fix) => fix.id);
    assert.equal(new Set(ids).size, ids.length, 'fix ids are unique');
    assert.ok(level.fixes.length >= 2, 'at least one wrong fix is on offer');
    for (const fix of level.fixes) {
      const hop = level.hops.find((candidate) => candidate.id === fix.hop);
      assert.ok(hop, `fix ${fix.id} names a hop that exists`);
      assert.ok(!fix.id.includes(':') && !RESERVED_INPUTS.includes(fix.id), `fix id ${fix.id} is allowed`);
      assert.ok(typeof fix.label === 'string' && fix.label.length > 0, `fix ${fix.id} has a label`);
      // A fix may only replace fields its hop already has (or add a note). This catches typos.
      for (const field of Object.keys(fix.set)) {
        assert.ok(field === 'note' || field in hop, `fix ${fix.id} sets "${field}", which hop ${hop.id} has`);
      }
    }
  });

  test(`${level.id}: uses example addresses only, and all of them are valid`, () => {
    for (const address of addressesIn(level)) {
      assert.ok(isExampleAddress(address), `${address} is an example address`);
      if (address.includes('/')) prefixLength(address);
      ipToNumber(address.split('/')[0]);
    }
  });

  test(`${level.id}: untouched, it fails where it says with the symptom it says`, () => {
    const result = trace(level, []);
    assert.equal(result.delivered, false);
    assert.equal(result.failsAt, level.expect.failsAt);
    assert.equal(result.symptom, level.expect.symptom);
  });

  test(`${level.id}: the solution wins with three stars`, () => {
    const end = replay(level, level.solution);
    assert.equal(end.status, 'won');
    assert.equal(stars(end), 3);
    assert.ok(neededFixes.length >= 1, 'the solution uses at least one fix');
  });

  test(`${level.id}: doing nothing, or only pressing Send, does not win`, () => {
    assert.equal(replay(level, []).status, 'playing');
    assert.equal(replay(level, ['send']).status, 'playing');
  });

  test(`${level.id}: of every combination of fixes up to the solution's size, only the solution delivers`, () => {
    const allIds = level.fixes.map((fix) => fix.id);
    const winners = [];
    for (let size = 0; size <= neededFixes.length; size += 1) {
      for (const combo of combinations(allIds, size)) {
        if (trace(level, combo).delivered) winners.push(combo);
      }
    }
    assert.equal(winners.length, 1, 'exactly one combination delivers');
    assert.deepEqual([...winners[0]].sort(), [...neededFixes].sort());
  });

  test(`${level.id}: no reachable set of fixes delivers without the solution's fixes`, () => {
    // (The solution's fixes plus a wrong one may still fail: a wrong fix can break things.)
    for (const set of reachableFixSets(level)) {
      if (!trace(level, set).delivered) continue;
      const hasAll = neededFixes.every((id) => set.includes(id));
      assert.ok(hasAll, `fixes [${set.join(', ')}] deliver without the solution`);
    }
  });

  test(`${level.id}: no reachable set of fixes hits a rule the game does not vouch for`, () => {
    for (const set of reachableFixSets(level)) {
      for (const step of trace(level, set).steps) {
        assert.ok(!FORBIDDEN_CODES.includes(step.code), `fixes [${set.join(', ')}] reach ${step.code}`);
        // "Refused" is only modelled on the way there; a reply level must not depend on it.
        if (hasReply) assert.ok(step.code !== 'listen-refused', `fixes [${set.join(', ')}] reach listen-refused`);
      }
    }
  });

  test(`${level.id}: every hint and wrong fix costs a star, but never the last one`, () => {
    const wrong = level.fixes.find((fix) => !neededFixes.includes(fix.id));
    const withHint = replay(level, ['hint', ...level.solution]);
    assert.equal(stars(withHint), 2);
    const withWrong = replay(level, [wrong.id, 'send', `undo:${wrong.hop}`, ...level.solution]);
    assert.equal(withWrong.status, 'won');
    assert.equal(stars(withWrong), 2);
    const worst = replay(level, ['hint', 'hint', 'hint', wrong.id, 'send', 'send', `undo:${wrong.hop}`, ...level.solution]);
    assert.equal(worst.status, 'won');
    assert.ok(stars(worst) >= 1);
  });
});

// ------------------------------------------------------- 2. the hop rules

test('inCidr: an address is in a range when its leading bits match', () => {
  assert.ok(inCidr('10.0.1.10', '10.0.0.0/16'));
  assert.ok(!inCidr('10.1.1.10', '10.0.0.0/16'));
  assert.ok(inCidr('10.1.2.50', '10.1.2.0/24'));
  assert.ok(inCidr('10.1.3.255', '10.1.2.0/23'));
  assert.ok(!inCidr('10.1.4.0', '10.1.2.0/23'));
  assert.ok(inCidr('203.0.113.20', '203.0.113.20/32'));
  assert.ok(!inCidr('203.0.113.21', '203.0.113.20/32'));
});

test('inCidr: 0.0.0.0/0 contains every address', () => {
  assert.ok(inCidr('198.51.100.7', '0.0.0.0/0'));
  assert.ok(inCidr('10.0.0.1', '0.0.0.0/0'));
  assert.ok(inCidr('255.255.255.255', '0.0.0.0/0'));
});

test('inCidr: text that is not an address or a range is rejected', () => {
  assert.throws(() => inCidr('10.0.0', '10.0.0.0/16'));
  assert.throws(() => inCidr('10.0.0.256', '10.0.0.0/16'));
  assert.throws(() => inCidr('10.0.0.1', '10.0.0.0'));
  assert.throws(() => inCidr('10.0.0.1', '10.0.0.0/33'));
});

test('pickRoute: the longest matching prefix wins, whatever the order of the list', () => {
  const routes = [
    { dest: '0.0.0.0/0', target: 'igw' },
    { dest: '10.1.2.0/24', target: 'vgw' },
    { dest: '10.1.0.0/16', target: 'pcx' },
  ];
  assert.equal(pickRoute(routes, '10.1.2.50').target, 'vgw');
  assert.equal(pickRoute([...routes].reverse(), '10.1.2.50').target, 'vgw');
  assert.equal(pickRoute(routes, '10.1.9.9').target, 'pcx');
  assert.equal(pickRoute(routes, '198.51.100.7').target, 'igw');
});

test('pickRoute: no matching route gives null', () => {
  assert.equal(pickRoute([{ dest: '10.0.0.0/16', target: 'local' }], '198.51.100.7'), null);
  assert.equal(pickRoute([], '10.0.0.1'), null);
});

test('dns: a name with no record is NXDOMAIN and nothing else is visited', () => {
  const result = trace(tiny([SERVER], { host: 'nope.example.com' }), []);
  assert.equal(result.symptom, 'nxdomain');
  assert.equal(result.failsAt, 'dns');
  assert.equal(result.steps.length, 1);
});

test('listener: the right port delivers, any other port is refused', () => {
  assert.equal(trace(tiny([SERVER]), []).delivered, true);
  const refused = trace(tiny([SERVER], { port: 8080 }), []);
  assert.equal(refused.symptom, 'refused');
  assert.equal(refused.failsAt, 'web');
});

test('route: a packet with no matching route is dropped (timeout)', () => {
  const table = { id: 'rt', kind: 'route', name: 'rt', toward: 'igw', routes: [{ dest: '10.0.0.0/16', target: 'local' }] };
  const result = trace(tiny([table, SERVER]), []);
  assert.equal(result.symptom, 'timeout');
  assert.equal(lastCode(result), 'route-none');
});

test('route: the chosen route must lead toward the next hop', () => {
  const routes = [{ dest: '0.0.0.0/0', target: 'igw' }, { dest: '203.0.113.0/24', target: 'vgw' }];
  const wrongWay = { id: 'rt', kind: 'route', name: 'rt', toward: 'igw', routes };
  const rightWay = { ...wrongWay, toward: 'vgw' };
  assert.equal(lastCode(trace(tiny([wrongWay, SERVER]), [])), 'route-dead-end');
  assert.equal(trace(tiny([wrongWay, SERVER]), []).symptom, 'timeout');
  assert.equal(trace(tiny([rightWay, SERVER]), []).delivered, true);
});

test('security group: a port or a source that is not on the list is dropped silently (timeout)', () => {
  const wrongPort = { id: 'sg', kind: 'firewall', name: 'sg', allow: [{ port: 80, from: '0.0.0.0/0' }] };
  const wrongSource = { id: 'sg', kind: 'firewall', name: 'sg', allow: [{ port: 443, from: '10.0.0.0/16' }] };
  const open = { id: 'sg', kind: 'firewall', name: 'sg', allow: [{ port: 443, from: '198.51.100.0/24' }] };
  assert.equal(trace(tiny([wrongPort, SERVER]), []).symptom, 'timeout');
  assert.equal(trace(tiny([wrongSource, SERVER]), []).symptom, 'timeout');
  assert.equal(trace(tiny([open, SERVER]), []).delivered, true);
});

test('security group: stateful, so the reply passes with no rule for it', () => {
  const noRules = { id: 'sg-back', kind: 'firewall', name: 'sg', allow: [] };
  const result = trace(tiny([SERVER, TURN, noRules]), []);
  assert.equal(result.delivered, true);
  assert.equal(lastCode(result), 'sg-reply');
});

test('network ACL: stateless, so the reply needs an outbound rule for the client port', () => {
  const only443 = { id: 'out', kind: 'nacl', name: 'out', direction: 'outbound',
    rules: [{ num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' }] };
  const ephemeral = { ...only443,
    rules: [{ num: 100, action: 'allow', ports: [1024, 65535], cidr: '0.0.0.0/0' }] };
  const blocked = trace(tiny([SERVER, TURN, only443]), []);
  assert.equal(blocked.symptom, 'timeout');
  assert.equal(blocked.failsAt, 'out');
  assert.equal(lastCode(blocked), 'nacl-default-deny');
  assert.equal(trace(tiny([SERVER, TURN, ephemeral]), []).delivered, true);
});

test('network ACL: rules are checked lowest number first and the first match decides', () => {
  const allow = { num: 100, action: 'allow', ports: [443, 443], cidr: '0.0.0.0/0' };
  const denyLate = { num: 200, action: 'deny', ports: [0, 65535], cidr: '0.0.0.0/0' };
  const denyEarly = { num: 50, action: 'deny', ports: [0, 65535], cidr: '0.0.0.0/0' };
  const acl = (rules) => ({ id: 'in', kind: 'nacl', name: 'in', direction: 'inbound', rules });
  // The order the rules are written in does not matter; the numbers do.
  assert.equal(trace(tiny([acl([denyLate, allow]), SERVER]), []).delivered, true);
  const denied = trace(tiny([acl([allow, denyEarly]), SERVER]), []);
  assert.equal(denied.symptom, 'timeout');
  assert.equal(lastCode(denied), 'nacl-deny');
});

test('network ACL: inbound rules look at the source, outbound rules at the destination', () => {
  const fromClient = { num: 100, action: 'allow', ports: [443, 443], cidr: '198.51.100.0/24' };
  const fromElsewhere = { num: 100, action: 'allow', ports: [443, 443], cidr: '10.0.0.0/16' };
  const acl = (rule) => ({ id: 'in', kind: 'nacl', name: 'in', direction: 'inbound', rules: [rule] });
  assert.equal(trace(tiny([acl(fromClient), SERVER]), []).delivered, true);
  assert.equal(trace(tiny([acl(fromElsewhere), SERVER]), []).symptom, 'timeout');

  const toClient = { id: 'out', kind: 'nacl', name: 'out', direction: 'outbound',
    rules: [{ num: 100, action: 'allow', ports: [1024, 65535], cidr: '198.51.100.0/24' }] };
  const toElsewhere = { ...toClient,
    rules: [{ num: 100, action: 'allow', ports: [1024, 65535], cidr: '10.0.0.0/16' }] };
  assert.equal(trace(tiny([SERVER, TURN, toClient]), []).delivered, true);
  assert.equal(trace(tiny([SERVER, TURN, toElsewhere]), []).symptom, 'timeout');
});

test('reply: sender and destination swap, and so do the ports', () => {
  const result = trace(tiny([SERVER, TURN]), []);
  const reply = result.steps[result.steps.length - 1].packet;
  assert.equal(reply.src, '203.0.113.20');
  assert.equal(reply.srcPort, 443);
  assert.equal(reply.dst, '198.51.100.7');
  assert.equal(reply.dstPort, 51000);
  assert.equal(reply.reply, true);
});

test('NAT gateway: rewrites the sender on the way out and puts it back on the way back', () => {
  const out = { id: 'nat-out', kind: 'nat', name: 'nat', publicIp: '203.0.113.9' };
  const back = { id: 'nat-back', kind: 'nat', name: 'nat', publicIp: '203.0.113.9' };
  const result = trace(tiny([out, SERVER, TURN, back], { from: '10.0.2.15' }), []);
  assert.equal(result.delivered, true);
  assert.equal(result.steps[1].packet.src, '203.0.113.9');        // as the server sees it
  assert.equal(result.steps[3].packet.dst, '203.0.113.9');        // the reply goes to the NAT gateway
  assert.equal(result.steps[4].packet.dst, '10.0.2.15');          // and is handed back to the real sender
});

test('NAT gateway: a reply that never comes back through it does not reach a private client', () => {
  const out = { id: 'nat-out', kind: 'nat', name: 'nat', publicIp: '203.0.113.9' };
  const result = trace(tiny([out, SERVER, TURN], { from: '10.0.2.15' }), []);
  assert.equal(result.delivered, false);
  assert.equal(result.symptom, 'timeout');
});

test('Service: forwards its port to targetPort on the pod', () => {
  const service = { id: 'svc', kind: 'service', name: 'svc', ip: '203.0.113.20', port: 443, targetPort: 8443, endpoint: '10.244.1.5' };
  const pod = (port) => ({ id: 'pod', kind: 'listener', name: 'pod', ip: '10.244.1.5', port });
  const good = trace(tiny([service, pod(8443)]), []);
  assert.equal(good.delivered, true);
  assert.equal(good.steps[1].packet.dst, '10.244.1.5');
  assert.equal(good.steps[1].packet.dstPort, 8443);
  const bad = trace(tiny([service, pod(3000)]), []);
  assert.equal(bad.symptom, 'refused');
  assert.equal(bad.failsAt, 'pod');
});

test('trace: a level whose first hop is not dns is reported as a mistake', () => {
  const level = tiny([]);
  level.hops = [SERVER];
  assert.throws(() => trace(level, []));
});

test('trace: an unknown fix id is reported as a mistake', () => {
  assert.throws(() => trace(levels[0], ['no-such-fix']));
});

// ------------------------------------------------------- 3. the game state

const first = levels[0];                                   // DNS level: one right fix, two wrong ones
const rightFix = fixIdsIn(first.solution)[0];
const wrongFixes = first.fixes.filter((fix) => fix.id !== rightFix);
const wrongSameHop = wrongFixes.find((fix) => fix.hop === first.fixes.find((f) => f.id === rightFix).hop);
const wrongOtherHop = wrongFixes.find((fix) => fix.hop !== wrongSameHop.hop);

test('state: choosing a fix does nothing until Send is pressed', () => {
  const chosen = replay(first, [rightFix]);
  assert.equal(chosen.status, 'playing');
  assert.equal(chosen.result, null);
  assert.equal(replay(first, [rightFix, 'send']).status, 'won');
});

test('state: a second fix on the same hop replaces the first', () => {
  const state = replay(first, [wrongSameHop.id, rightFix]);
  assert.deepEqual(activeFixes(state), [rightFix]);
});

test('state: undo puts a hop back the way it was', () => {
  const state = replay(first, [rightFix, `undo:${wrongSameHop.hop}`]);
  assert.deepEqual(activeFixes(state), []);
  assert.deepEqual(currentHops(state), first.hops);
  assert.equal(replay(first, [rightFix, `undo:${wrongSameHop.hop}`, 'send']).status, 'playing');
});

test('state: changing a fix clears the last result, so the page asks for a new Send', () => {
  const sent = replay(first, ['send']);
  assert.ok(sent.result !== null);
  assert.equal(apply(sent, rightFix).result, null);
});

test('state: a wrong fix costs a star only when it is sent, and only once', () => {
  assert.deepEqual(replay(first, [wrongSameHop.id]).charged, []);
  assert.deepEqual(replay(first, [wrongSameHop.id, 'send']).charged, [wrongSameHop.id]);
  assert.deepEqual(replay(first, [wrongSameHop.id, 'send', 'send', 'send']).charged, [wrongSameHop.id]);
});

test('state: a wrong fix left in place beside the right one still costs its star', () => {
  const end = replay(first, [wrongOtherHop.id, rightFix, 'send']);
  assert.equal(end.status, 'won');
  assert.equal(stars(end), 2);
});

test('state: stars never drop below one', () => {
  const end = replay(first, ['hint', 'hint', wrongSameHop.id, 'send', wrongOtherHop.id, 'send', rightFix, 'send']);
  assert.equal(end.status, 'won');
  assert.equal(stars(end), 1);
});

test('state: hints stop at the number the level has', () => {
  const state = replay(first, ['hint', 'hint', 'hint', 'hint', 'hint']);
  assert.equal(state.hints, first.hints.length);
});

test('state: inspecting is free and remembered once', () => {
  const state = replay(first, ['inspect:dns', 'inspect:web', 'inspect:dns', ...first.solution]);
  assert.deepEqual(state.inspected, ['dns', 'web']);
  assert.equal(stars(state), 3);
});

test('state: stars are zero until the level is won', () => {
  assert.equal(stars(start(first)), 0);
  assert.equal(stars(replay(first, ['send'])), 0);
});

test('state: starsLeft counts down while playing, and stars pays it out on the win', () => {
  assert.equal(starsLeft(start(first)), 3);
  assert.equal(starsLeft(replay(first, ['hint'])), 2);
  assert.equal(starsLeft(replay(first, ['hint', wrongSameHop.id, 'send'])), 1);
  assert.equal(starsLeft(replay(first, ['hint', 'hint', wrongSameHop.id, 'send'])), 1);
  const won = replay(first, ['hint', ...first.solution]);
  assert.equal(stars(won), starsLeft(won));
});

test('state: nothing changes after the level is won', () => {
  const won = replay(first, first.solution);
  assert.deepEqual(apply(won, 'send'), won);
  assert.deepEqual(apply(won, 'hint'), won);
  assert.deepEqual(apply(won, wrongSameHop.id), won);
});

test('state: an input the level does not have is rejected', () => {
  assert.throws(() => apply(start(first), 'no-such-fix'));
  assert.throws(() => apply(start(first), 'inspect:no-such-hop'));
  assert.throws(() => apply(start(first), 'undo:no-such-hop'));
});

test('state: apply returns a new state and leaves the old one alone', () => {
  const before = start(first);
  const copy = JSON.stringify(before);
  apply(before, rightFix);
  apply(before, 'send');
  apply(before, 'hint');
  apply(before, 'inspect:dns');
  assert.equal(JSON.stringify(before), copy);
});

test('fixIdsIn: picks the fix ids out of a list of inputs', () => {
  assert.deepEqual(fixIdsIn(['inspect:dns', 'open-443', 'hint', 'undo:dns', 'send']), ['open-443']);
});
