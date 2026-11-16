// RULES for Packet Quest. Pure: no page, no storage, no timers, no randomness.
// Because of that, the tests can run these rules directly and get the same answer every time.
//
// What is in this file, top to bottom:
//   1. Addresses      inCidr, pickRoute            (is this address in that range? which route wins?)
//   2. Hop rules      one small function per kind  (what a security group, a route table ... does)
//   3. trace          walks one packet along a level's hops and says where it stopped
//   4. Game state     start, apply, replay, stars  (fixes chosen, hints used, stars)
//
// Every rule here is the simplified textbook version. Where the real world has more
// detail, a comment says what was left out.

// ---------------------------------------------------------------- tunable numbers

export const MAX_STARS = 3;
export const MIN_STARS = 1;
export const DEFAULT_CLIENT_PORT = 50000;   // the client's own port, when a level's request gives no fromPort

// Words a fix id may not use, because they are inputs of their own (see apply).
export const RESERVED_INPUTS = ['send', 'hint'];

// The names of route targets. A target that is not listed is shown as typed.
export const TARGET_NAMES = {
  local: 'local',
  igw: 'internet gateway',
  nat: 'NAT gateway',
  pcx: 'peering connection',
  vgw: 'VPN gateway',
};

export function targetName(target) {
  return TARGET_NAMES[target] || target;
}

// The end of a sentence about where a route sends a packet.
function goesTo(target) {
  if (target === 'local') return 'the packet stays inside the VPC';
  return `the packet goes to the ${targetName(target)}`;
}

// ------------------------------------------------------------------- 1. addresses

// '10.0.1.10' -> one whole number, so two addresses can be compared.
export function ipToNumber(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) throw new Error(`"${ip}" is not an IPv4 address`);
  let number = 0;
  for (const part of parts) {
    const value = Number(part);
    if (part === '' || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`"${ip}" is not an IPv4 address`);
    }
    number = number * 256 + value;
  }
  return number;
}

// '10.1.2.0/24' -> 24. The prefix length: how many leading bits of the address are fixed.
export function prefixLength(cidr) {
  const parts = String(cidr).split('/');
  const bits = Number(parts[1]);
  if (parts.length !== 2 || parts[1] === '' || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new Error(`"${cidr}" is not a CIDR range like 10.0.0.0/16`);
  }
  return bits;
}

// Is this address inside this range?  inCidr('10.0.1.10', '10.0.0.0/16') -> true
// A /16 fixes the first 16 bits, which leaves 2^16 addresses in the range. Two addresses
// are in the same /16 when dividing each by 2^16 gives the same whole number.
export function inCidr(ip, cidr) {
  const bits = prefixLength(cidr);
  const size = 2 ** (32 - bits);
  const base = ipToNumber(cidr.split('/')[0]);
  return Math.floor(ipToNumber(ip) / size) === Math.floor(base / size);
}

// Which route does a route table use for this destination?
// Of all the routes whose range contains the address, the one with the longest prefix
// (the narrowest range) wins. The order of the list does not matter. No match: null.
export function pickRoute(routes, ip) {
  let best = null;
  for (const route of routes) {
    if (!inCidr(ip, route.dest)) continue;
    if (best === null || prefixLength(route.dest) > prefixLength(best.dest)) best = route;
  }
  return best;
}

// ------------------------------------------------------------------- 2. hop rules
//
// A packet is { src, srcPort, dst, dstPort, reply, natFrom }.
//   reply    false on the way there, true once a "reply" hop has turned it round
//   natFrom  the private address a NAT gateway is holding for this conversation, or null
//
// Each rule returns either pass(...) or drop(...):
//   code     a short fixed word for the rule that fired (the tests check these)
//   text     the same thing as a sentence for the player
//   symptom  only on a drop: what the client sees ('nxdomain', 'timeout' or 'refused')
//   packet   only on a pass that rewrote the packet

function pass(code, text, packet) {
  return { outcome: 'pass', code, text, packet: packet || null };
}

function drop(code, text, symptom) {
  return { outcome: 'drop', code, text, symptom };
}

// DNS: turn the name into an address. A name that does not exist gives NXDOMAIN,
// and then no packet is sent to the server (the DNS question and answer are the only traffic).
// Left out: a name that exists but has no record of the type asked for gives an
// empty answer (not NXDOMAIN). No level uses that case.
function visitDns(hop, packet, request) {
  const address = hop.records[request.host];
  if (!address) {
    return drop('dns-nxdomain',
      `There is no record for ${request.host}. The answer is NXDOMAIN: the name does not exist. No packet is sent to the server.`,
      'nxdomain');
  }
  return pass('dns-found',
    `${request.host} is at ${address}. The packet is now addressed to ${address}.`,
    { ...packet, dst: address });
}

// Route table: pick the most specific matching route. No matching route: dropped.
// `hop.toward` is the target that really leads to the next hop of this level. A packet
// sent to any other target ends up somewhere that cannot deliver it.
function visitRoute(hop, packet) {
  const matches = hop.routes.filter((route) => inCidr(packet.dst, route.dest));
  const route = pickRoute(hop.routes, packet.dst);
  if (!route) {
    return drop('route-none',
      `No route matches ${packet.dst}. A packet with no matching route is dropped.`,
      'timeout');
  }
  let chosen = `The route ${route.dest} matches ${packet.dst}, so ${goesTo(route.target)}.`;
  if (matches.length > 1) {
    const list = matches.map((match) => match.dest).join(', ');
    chosen = `${matches.length} routes match ${packet.dst}: ${list}. The most specific one wins: ${route.dest}, so ${goesTo(route.target)}.`;
  }
  if (route.target !== hop.toward) {
    const why = (hop.deadEnds && hop.deadEnds[route.target]) || 'That is not the way to the destination, so the packet is lost.';
    return drop('route-dead-end', `${chosen} ${why}`, 'timeout');
  }
  return pass('route-ok', chosen);
}

// Security group (kind "firewall"): a list of what is allowed in. No deny rules.
// Anything not allowed is dropped silently, so the client sees a timeout.
// Stateful: the reply to a connection that was allowed passes with no rule of its own.
// Left out: outbound rules (a new security group allows all outbound traffic).
function visitFirewall(hop, packet) {
  if (packet.reply) {
    return pass('sg-reply',
      'A security group is stateful: it remembers the connection, so the reply passes automatically. No rule is needed.');
  }
  const rule = hop.allow.find((r) => r.port === packet.dstPort && inCidr(packet.src, r.from));
  if (!rule) {
    return drop('sg-drop',
      `No rule allows port ${packet.dstPort} from ${packet.src}. The packet is dropped silently: nothing is sent back.`,
      'timeout');
  }
  return pass('sg-allow', `The rule "port ${rule.port} from ${rule.from}" allows it.`);
}

// Network ACL: numbered rules, checked from the lowest number up. The first rule that
// matches decides (allow or deny). If none matches, the final "*" rule denies.
// Stateless: a reply is checked like any new packet, so it needs its own rule.
//   direction 'inbound'   the rule's cidr is compared with where the packet comes from
//   direction 'outbound'  the rule's cidr is compared with where the packet is going
// The port checked is always the packet's destination port.
function visitNacl(hop, packet) {
  const inbound = hop.direction === 'inbound';
  const address = inbound ? packet.src : packet.dst;
  const way = inbound ? `from ${address}` : `to ${address}`;
  const memory = packet.reply ? 'A network ACL does not remember the request, so the reply is checked like a new packet. ' : '';

  const ordered = [...hop.rules].sort((a, b) => a.num - b.num);
  const rule = ordered.find((r) =>
    packet.dstPort >= r.ports[0] && packet.dstPort <= r.ports[1] && inCidr(address, r.cidr));

  if (!rule) {
    return drop('nacl-default-deny',
      `${memory}No ${hop.direction} rule matches port ${packet.dstPort} ${way}, so the final rule (*) denies it. The packet is dropped silently.`,
      'timeout');
  }
  if (rule.action === 'deny') {
    return drop('nacl-deny',
      `${memory}Rule ${rule.num} is the first ${hop.direction} rule that matches port ${packet.dstPort} ${way}, and it says deny. The packet is dropped silently.`,
      'timeout');
  }
  return pass('nacl-allow',
    `${memory}Rule ${rule.num} is the first ${hop.direction} rule that matches port ${packet.dstPort} ${way}, and it says allow.`);
}

// NAT gateway. On the way out it puts its own public address in as the sender and
// remembers the private address. On the way back it puts the private address in again.
// Left out: a real NAT gateway also rewrites the sender's port, and it swaps in its own
// private address; the internet gateway then swaps that for the Elastic IP. Shown as one swap.
function visitNat(hop, packet) {
  if (!packet.reply) {
    return pass('nat-out',
      `The sender is rewritten from ${packet.src} to the NAT gateway's public address ${hop.publicIp}. The gateway remembers who really asked.`,
      { ...packet, src: hop.publicIp, natFrom: packet.src });
  }
  if (packet.dst !== hop.publicIp || !packet.natFrom) {
    return drop('nat-unknown',
      'The NAT gateway has no note of a conversation this reply belongs to, so it drops it.',
      'timeout');
  }
  return pass('nat-back',
    `The reply came to ${hop.publicIp}. The gateway looks up who asked and rewrites the destination back to ${packet.natFrom}.`,
    { ...packet, dst: packet.natFrom, natFrom: null });
}

// Kubernetes Service: clients connect to its own address and `port`; it forwards
// them to `targetPort` on a pod.
// Left out: more than one pod behind a Service, and the way back through a Service.
// The first branch (a packet for a port the Service does not have) depends on how the
// cluster is set up, so no level is allowed to reach it; the tests check that.
function visitService(hop, packet) {
  if (packet.dst !== hop.ip || packet.dstPort !== hop.port) {
    return drop('svc-no-match',
      `This Service answers on ${hop.ip} port ${hop.port}, but the packet is for ${packet.dst} port ${packet.dstPort}.`,
      'timeout');
  }
  return pass('svc-forward',
    `The Service takes the packet on port ${hop.port} and forwards it to targetPort ${hop.targetPort} on the pod at ${hop.endpoint}.`,
    { ...packet, dst: hop.endpoint, dstPort: hop.targetPort });
}

// A host with a program listening on one port. A packet for any other port reached
// the host, but nothing is listening there: the host answers with a TCP reset and the
// client reports "connection refused" straight away.
// The first branch (a packet for a different address) is a guard against a mistake in
// a level; no level is allowed to reach it, and the tests check that.
function visitListener(hop, packet) {
  if (packet.dst !== hop.ip) {
    return drop('listen-wrong-address',
      `The packet is addressed to ${packet.dst}, but this host is ${hop.ip}. Nothing answers.`,
      'timeout');
  }
  if (packet.dstPort !== hop.port) {
    return drop('listen-refused',
      `The packet arrived, but nothing is listening on port ${packet.dstPort} (the program here listens on ${hop.port}). The host answers with a reset, and the client reports "connection refused".`,
      'refused');
  }
  return pass('listen-ok', `A program is listening on port ${hop.port} and accepts the connection.`);
}

// Reply: the server answers. Sender and destination swap places, and so do the ports:
// the reply goes back to the port the client sent from.
function visitReply(hop, packet) {
  return pass('reply',
    `The server answers. The reply goes from ${packet.dst} port ${packet.dstPort} back to ${packet.src} port ${packet.srcPort}.`,
    { ...packet, src: packet.dst, srcPort: packet.dstPort, dst: packet.src, dstPort: packet.srcPort, reply: true });
}

const VISIT = {
  dns: visitDns,
  route: visitRoute,
  firewall: visitFirewall,
  nacl: visitNacl,
  nat: visitNat,
  service: visitService,
  listener: visitListener,
  reply: visitReply,
};

export const HOP_KINDS = Object.keys(VISIT);

// ----------------------------------------------------------------------- 3. trace

// The level's hops with the given fixes applied. A fix replaces whole fields of its hop
// (a shallow copy); the level itself is never edited.
export function hopsWithFixes(level, fixIds) {
  let hops = level.hops;
  for (const fixId of fixIds) {
    const fix = level.fixes.find((candidate) => candidate.id === fixId);
    if (!fix) throw new Error(`"${fixId}" is not a fix in level ${level.id}`);
    hops = hops.map((hop) => (hop.id === fix.hop ? { ...hop, ...fix.set } : hop));
  }
  return hops;
}

function firstPacket(request) {
  return {
    src: request.from,
    srcPort: request.fromPort || DEFAULT_CLIENT_PORT,
    dst: null,                 // not known until a dns hop has looked the name up
    dstPort: request.port,
    reply: false,
    natFrom: null,
  };
}

// Send one packet along the level's hops, with the given fixes applied.
// Returns:
//   delivered  true if it got all the way (and, where there is a reply hop, all the way back)
//   symptom    'ok', or what the client sees: 'nxdomain', 'timeout', 'refused'
//   failsAt    the id of the hop that stopped it, or null
//   steps      one entry per hop visited: { hop, outcome, code, text, packet }
//              (packet = the packet as it leaves that hop)
export function trace(level, fixIds) {
  const steps = [];
  let packet = firstPacket(level.request);

  for (const hop of hopsWithFixes(level, fixIds)) {
    const visit = VISIT[hop.kind];
    if (!visit) throw new Error(`level ${level.id}: hop "${hop.id}" has unknown kind "${hop.kind}"`);
    if (packet.dst === null && hop.kind !== 'dns') {
      throw new Error(`level ${level.id}: the first hop must be a dns hop, so the packet has an address`);
    }
    const result = visit(hop, packet, level.request);
    packet = result.packet || packet;
    steps.push({ hop: hop.id, outcome: result.outcome, code: result.code, text: result.text, packet });
    if (result.outcome === 'drop') {
      return { delivered: false, symptom: result.symptom, failsAt: hop.id, steps };
    }
  }

  // A reply only counts if it ends up addressed to the client that asked.
  if (packet.reply && packet.dst !== level.request.from) {
    const last = steps[steps.length - 1];
    last.outcome = 'drop';
    last.code = 'reply-misaddressed';
    last.text += ` But the reply is addressed to ${packet.dst}, not to the client ${level.request.from}, so it never arrives.`;
    return { delivered: false, symptom: 'timeout', failsAt: last.hop, steps };
  }
  return { delivered: true, symptom: 'ok', failsAt: null, steps };
}

// ------------------------------------------------------------------ 4. game state
//
// The inputs a player can give, as plain text. A level's `solution` is a list of them.
//   'send'             send the packet with the fixes chosen so far
//   'hint'             reveal the next hint
//   'inspect:<hopId>'  look inside a hop (free; in a fog level it shows what that hop did
//                      with the last packet, until the next Send)
//   'undo:<hopId>'     put a hop back the way it was
//   '<fixId>'          choose that fix for its hop (it replaces any other fix on the same hop)

// The state at the start of a level.
export function start(level) {
  return {
    level,
    fixes: {},        // { hopId: fixId }: at most one fix per hop
    inspected: [],    // ids of the hops looked inside since the last Send (fog levels show only these)
    hints: 0,         // how many hints have been revealed
    charged: [],      // wrong fixes that have already cost a star
    sends: 0,         // how many times Send was pressed
    result: null,     // what trace() said for the last send; null after any change of fix
    status: 'playing',
  };
}

// The fix ids in force, in the order of the level's hops.
export function activeFixes(state) {
  return state.level.hops.map((hop) => state.fixes[hop.id]).filter(Boolean);
}

// The level's hops as they are right now, with the chosen fixes applied.
export function currentHops(state) {
  return hopsWithFixes(state.level, activeFixes(state));
}

// The fix ids inside a list of inputs (everything that is not send, hint, inspect or undo).
export function fixIdsIn(inputs) {
  return inputs.filter((input) => !RESERVED_INPUTS.includes(input) && !input.includes(':'));
}

function send(state) {
  const active = activeFixes(state);
  const result = trace(state.level, active);
  // A wrong fix is one the level's solution does not use. Sending with it costs a star, once.
  const needed = fixIdsIn(state.level.solution);
  const newlyWrong = active.filter((id) => !needed.includes(id) && !state.charged.includes(id));
  return {
    ...state,
    result,
    // A new packet: in a fog level the player has seen none of its hops yet. Without this,
    // opening every hop once (even before the first Send) would lift the fog for good.
    inspected: [],
    sends: state.sends + 1,
    charged: [...state.charged, ...newlyWrong],
    status: result.delivered ? 'won' : 'playing',
  };
}

function takeHint(state) {
  if (state.hints >= state.level.hints.length) return state;
  return { ...state, hints: state.hints + 1 };
}

function findHop(state, hopId) {
  const hop = state.level.hops.find((candidate) => candidate.id === hopId);
  if (!hop) throw new Error(`"${hopId}" is not a hop in level ${state.level.id}`);
  return hop;
}

function inspect(state, hopId) {
  findHop(state, hopId);
  if (state.inspected.includes(hopId)) return state;
  return { ...state, inspected: [...state.inspected, hopId] };
}

function undoFix(state, hopId) {
  findHop(state, hopId);
  if (!state.fixes[hopId]) return state;
  const fixes = { ...state.fixes };
  delete fixes[hopId];
  return { ...state, fixes, result: null };
}

function chooseFix(state, fixId) {
  const fix = state.level.fixes.find((candidate) => candidate.id === fixId);
  if (!fix) throw new Error(`"${fixId}" is not an input or a fix in level ${state.level.id}`);
  if (state.fixes[fix.hop] === fixId) return state;
  return { ...state, fixes: { ...state.fixes, [fix.hop]: fixId }, result: null };
}

// The one way state changes. The page calls this for every button press and replay()
// calls it for every recorded input, so both follow exactly the same rules.
// It returns a new state and never edits the old one.
export function apply(state, input) {
  if (state.status !== 'playing') return state;
  if (input === 'send') return send(state);
  if (input === 'hint') return takeHint(state);
  if (input.startsWith('inspect:')) return inspect(state, input.slice('inspect:'.length));
  if (input.startsWith('undo:')) return undoFix(state, input.slice('undo:'.length));
  return chooseFix(state, input);
}

// Play a whole list of inputs from the start. Returns the final state.
export function replay(level, inputs) {
  let state = start(level);
  for (const input of inputs) state = apply(state, input);
  return state;
}

// The stars still on offer: three, minus one for each wrong fix sent and each hint used,
// never below one.
export function starsLeft(state) {
  return Math.max(MIN_STARS, MAX_STARS - state.charged.length - state.hints);
}

// The stars earned: nothing until the level is won.
export function stars(state) {
  return state.status === 'won' ? starsLeft(state) : 0;
}
