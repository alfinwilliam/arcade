// RULES for Pod Packer. Pure: no page, no storage, no timers, no randomness.
// The page (main.js) and the tests both go through apply(), so they follow the same rules.
//
// A move is a short text, the same text that is stored in a level's `solution`:
//   "buy small"          buy one node of that type; it gets the next id (n1, n2, ...)
//   "place web-1 n1"     put a Pending pod on a node
//   "drain n1"           evict every pod on the node and remove the node. Real `kubectl drain`
//                        cordons the node (no new pods) and evicts its pods, then you delete the
//                        empty node yourself; the game does both in one move so it stops being billed.
//                        An evicted pod is gone: its controller makes a replacement, which starts
//                        Pending (see replacementFor below).
//   "end"                end the turn: see endTurn() below for exactly what happens
//
// The state (never edit one by hand; apply() returns a new one each time):
//   level       the level being played
//   turn        1, 2, ... up to level.turns
//   bill        rupees charged so far
//   nodes       live nodes: { id, type, cpu, mem, price, taint, label, spot, pods: [...] }
//   pending     pods waiting for a node: a copy of the level's pod plus `waited` (turn ends spent Pending)
//   nextNode    the number the next bought node gets
//   status      'playing', 'won' or 'lost'
//   lostReason  a sentence, when status is 'lost'
//   news        what happened when the last turn ended, as sentences for the page

export const MAX_NODES = 9;             // most nodes alive at once (so number keys 1-9 reach every node)
export const STAR_SLACK_PERCENT = 15;   // two stars if the bill is within this much of the reference bill

// ------------------------------------------------------------ units as text

// 500 -> "0.5 CPU", 2000 -> "2 CPU". (1000 millicores is one CPU.)
export function cpuText(millicores) {
  return `${millicores / 1000} CPU`;
}

// 512 -> "512Mi", 1536 -> "1.5Gi", 2048 -> "2Gi".
export function memText(mebibytes) {
  const halfGi = 512;
  if (mebibytes >= 1024 && mebibytes % halfGi === 0) return `${mebibytes / 1024}Gi`;
  return `${mebibytes}Mi`;
}

// --------------------------------------------------------- the scheduler rule

// What is left on a node: its size minus the requests of the pods already on it.
export function freeOn(node) {
  let cpu = node.cpu;
  let mem = node.mem;
  for (const pod of node.pods) {
    cpu -= pod.cpu;
    mem -= pod.mem;
  }
  return { cpu, mem };
}

// Can this pod go on this node? Returns { ok, reason }.
// The four checks, as the Kubernetes scheduler would make them:
//   node selector   a pod with `needs` only goes on a node whose label matches
//   taint           a tainted node only takes pods that tolerate that taint
//   cpu, memory     both requests must fit in what is left on the node
// Note that a toleration appears only in the taint check: it lets a pod onto a tainted
// node, it never sends the pod there.
// The reason lists every check that failed, in the scheduler's own words.
export function fits(pod, node) {
  const free = freeOn(node);
  const reasons = [];
  if (pod.needs && node.label !== pod.needs) {
    reasons.push(`Didn't match the pod's node selector (it needs a "${pod.needs}" node)`);
  }
  if (node.taint && pod.tolerates !== node.taint) {
    reasons.push(`Untolerated taint "${node.taint}"`);
  }
  if (pod.cpu > free.cpu) {
    reasons.push(`Insufficient cpu (requests ${cpuText(pod.cpu)}, ${cpuText(free.cpu)} free)`);
  }
  if (pod.mem > free.mem) {
    reasons.push(`Insufficient memory (requests ${memText(pod.mem)}, ${memText(free.mem)} free)`);
  }
  return { ok: reasons.length === 0, reason: reasons.join('; ') };
}

// ------------------------------------------------------------------- start

// The pods that arrive at the start of a turn, as fresh copies.
function arrivals(level, turn) {
  const pods = [];
  for (const wave of level.arrivals) {
    if (wave.turn !== turn) continue;
    for (const pod of wave.pods) pods.push({ ...pod, waited: 0 });
  }
  return pods;
}

// The state at the start of a level: turn 1, nothing bought, the first pods waiting.
export function start(level) {
  return {
    level, turn: 1, bill: 0, nodes: [], pending: arrivals(level, 1), nextNode: 1,
    status: 'playing', lostReason: '', news: [],
  };
}

// ------------------------------------------------------- is this move allowed?

function yes() {
  return { ok: true, reason: '' };
}

function no(reason) {
  return { ok: false, reason };
}

function checkBuy(state, typeName) {
  if (!Object.prototype.hasOwnProperty.call(state.level.nodeTypes, typeName)) {
    return no(`This level has no node type called "${typeName}".`);
  }
  if (state.nodes.length >= MAX_NODES) return no(`You can run at most ${MAX_NODES} nodes at once.`);
  return yes();
}

function checkPlace(state, podId, nodeId) {
  const pod = state.pending.find((p) => p.id === podId);
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!pod) return no(`${podId} is not Pending.`);
  if (!node) return no(`There is no node ${nodeId}.`);
  return fits(pod, node);
}

function checkDrain(state, nodeId) {
  if (!state.nodes.some((n) => n.id === nodeId)) return no(`There is no node ${nodeId}.`);
  return yes();
}

// How many words each move has: "buy small", "place web-1 n1", "drain n1", "end".
const WORDS = { buy: 2, place: 3, drain: 2, end: 1 };

// Would apply() accept this move? Returns { ok, reason }. The page calls this first,
// so it can show the reason instead of crashing.
export function check(state, move) {
  if (state.status !== 'playing') return no('This level is over.');
  const words = String(move).split(' ');
  const [verb, a, b] = words;
  if (words.length !== WORDS[verb]) return no(`"${move}" is not a move.`);
  if (verb === 'buy') return checkBuy(state, a);
  if (verb === 'place') return checkPlace(state, a, b);
  if (verb === 'drain') return checkDrain(state, a);
  return yes();   // "end"
}

// ------------------------------------------------------------ doing the move

// A copy that is safe to change: the old state stays as it was.
function copy(state) {
  return {
    ...state,
    nodes: state.nodes.map((node) => ({ ...node, pods: node.pods.map((pod) => ({ ...pod })) })),
    pending: state.pending.map((pod) => ({ ...pod })),
  };
}

function buy(state, typeName) {
  const type = state.level.nodeTypes[typeName];
  state.nodes.push({
    id: `n${state.nextNode}`, type: typeName,
    cpu: type.cpu, mem: type.mem, price: type.price,
    taint: type.taint || '', label: type.label || '', spot: Boolean(type.spot),
    pods: [],
  });
  state.nextNode += 1;
}

function place(state, podId, nodeId) {
  const pod = state.pending.find((p) => p.id === podId);
  const node = state.nodes.find((n) => n.id === nodeId);
  state.pending = state.pending.filter((p) => p.id !== podId);
  node.pods.push(pod);
}

// An evicted pod is deleted; its controller (a Deployment, a Job) creates a replacement.
// The game keeps the name so the player can follow it, but the replacement is a fresh copy
// from the level data: it has not waited yet, and a job starts its work again from the top.
function replacementFor(level, podId) {
  for (const wave of level.arrivals) {
    const original = wave.pods.find((pod) => pod.id === podId);
    if (original) return { ...original, waited: 0 };
  }
  throw new Error(`No pod ${podId} in level ${level.id}.`);
}

// Take a node away. Its pods are evicted, and their replacements are Pending.
function removeNode(state, nodeId) {
  const node = state.nodes.find((n) => n.id === nodeId);
  state.nodes = state.nodes.filter((n) => n.id !== nodeId);
  state.pending.push(...node.pods.map((pod) => replacementFor(state.level, pod.id)));
  return node;
}

// The one way state changes. Returns a new state and never edits the old one.
// A move that is not allowed throws, with the reason as the message.
export function apply(state, move) {
  if (state.status !== 'playing') return state;
  const verdict = check(state, move);
  if (!verdict.ok) throw new Error(`"${move}" was rejected: ${verdict.reason}`);

  const next = copy(state);
  const [verb, a, b] = move.split(' ');
  if (verb === 'buy') buy(next, a);
  if (verb === 'place') place(next, a, b);
  if (verb === 'drain') removeNode(next, a);
  if (verb === 'end') endTurn(next);
  return next;
}

// --------------------------------------------------------- ending the turn

function lose(state, reason) {
  state.status = 'lost';
  state.lostReason = reason;
}

// Step 1: every live node is charged its price.
function billNodes(state) {
  let charge = 0;
  for (const node of state.nodes) charge += node.price;
  state.bill += charge;
  const count = state.nodes.length;
  state.news.push(`Billed ₹${charge} for ${count} ${count === 1 ? 'node' : 'nodes'}.`);
}

// Step 2: a running job (a pod with `runs`) has one turn less to go; at zero it finishes
// and leaves, which frees its CPU and memory. A Pending job does not make progress.
function finishJobs(state) {
  for (const node of state.nodes) {
    for (const pod of node.pods) {
      if (pod.runs) pod.runs -= 1;
      if (pod.runs === 0) state.news.push(`${pod.id} finished and left ${node.id}.`);
    }
    node.pods = node.pods.filter((pod) => pod.runs !== 0);
  }
}

// Step 3: a reclaim event for this turn takes away every live node of that type.
function reclaimNodes(state) {
  for (const event of state.level.events) {
    if (event.turn !== state.turn) continue;
    const doomed = state.nodes.filter((node) => node.type === event.reclaim);
    for (const node of doomed) {
      removeNode(state, node.id);
      const lost = node.pods.map((pod) => pod.id).join(', ') || 'nothing';
      state.news.push(`${node.id} (${node.type}) was reclaimed. Replacements Pending: ${lost}.`);
    }
  }
}

// How many turn ends this pod may spend Pending: its own `patience` if it has one,
// otherwise the level's.
export function patienceOf(level, pod) {
  return pod.patience === undefined ? level.patience : pod.patience;
}

// Step 4: every Pending pod has now waited one more turn end. Returns the first pod
// that has waited longer than the level allows, or null.
function agePending(state) {
  let late = null;
  for (const pod of state.pending) {
    pod.waited += 1;
    if (pod.waited > patienceOf(state.level, pod) && !late) late = pod;
  }
  return late;
}

function lateReason(level, pod) {
  const allowed = patienceOf(level, pod);
  if (allowed === 0) return `${pod.id} was still Pending when the turn ended.`;
  return `${pod.id} was Pending for more than ${allowed} turn ${allowed === 1 ? 'end' : 'ends'}.`;
}

// Ending a turn, in order: bill the nodes, check the cap, finish jobs, reclaim nodes,
// check for pods that have been Pending too long, then either win or start the next turn.
function endTurn(state) {
  const level = state.level;
  state.news = [];

  billNodes(state);
  if (state.bill > level.maxBill) {
    return lose(state, `The bill reached ₹${state.bill}, which is over the cap of ₹${level.maxBill}.`);
  }

  finishJobs(state);
  reclaimNodes(state);

  const late = agePending(state);
  if (late) return lose(state, lateReason(level, late));

  if (state.turn === level.turns) {
    if (state.pending.length > 0) {
      return lose(state, `${state.pending[0].id} was still Pending when the last turn ended.`);
    }
    state.status = 'won';
    return undefined;
  }

  state.turn += 1;
  const fresh = arrivals(level, state.turn);
  state.pending.push(...fresh);
  if (fresh.length > 0) state.news.push(`${fresh.length} new ${fresh.length === 1 ? 'pod' : 'pods'} arrived.`);
  return undefined;
}

// ------------------------------------------------------- helpers for the page

// The reclaims that will happen when the current turn ends: [{ type, nodeIds }].
// This is the "one turn ahead" warning.
export function notices(state) {
  return state.level.events
    .filter((event) => event.turn === state.turn)
    .map((event) => ({
      type: event.reclaim,
      nodeIds: state.nodes.filter((node) => node.type === event.reclaim).map((node) => node.id),
    }));
}

// The pods that will arrive at the start of the next turn (empty on the last turn).
export function comingNext(state) {
  if (state.turn >= state.level.turns) return [];
  return arrivals(state.level, state.turn + 1);
}

// What ending the turn right now would add to the bill.
export function turnCost(state) {
  let cost = 0;
  for (const node of state.nodes) cost += node.price;
  return cost;
}

// ---------------------------------------------------------- replay and stars

// Play a whole list of moves from the start. Returns the final state.
export function replay(level, solution) {
  let state = start(level);
  for (const move of solution) state = apply(state, move);
  return state;
}

// The bill of the level's own solution: the bill to match for three stars.
export function referenceBill(level) {
  return replay(level, level.solution).bill;
}

// 3 stars: the bill is no higher than the reference. 2: within STAR_SLACK_PERCENT. 1: any other win.
export function stars(state) {
  if (state.status !== 'won') return 0;
  const reference = referenceBill(state.level);
  if (state.bill <= reference) return 3;
  if (state.bill * 100 <= reference * (100 + STAR_SLACK_PERCENT)) return 2;
  return 1;
}
