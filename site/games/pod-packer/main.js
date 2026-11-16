// PAGE for Pod Packer: drawing and input only.
// Every rule lives in logic.js. This file never decides what fits, what is billed or who wins.
//
// How it is put together:
//   1. build() creates the fixed parts of the page once.
//   2. Every input (a tap or a key) ends in tryMove(), which asks logic.js whether the move
//      is allowed, applies it and records it. `recorded` is exactly what replay() takes.
//   3. update() redraws everything from the state after every input.
//
// Add ?dev to the URL to see the recorded moves on the win screen, ready to paste into
// levels.js as a level's `solution`.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import {
  start, apply, check, replay, fits, freeOn, stars, referenceBill,
  notices, comingNext, turnCost, patienceOf, cpuText, memText,
} from './logic.js';

const DEV = new URLSearchParams(location.search).has('dev');
const SAVE_KEY = 'pod-packer:best';   // saved as { levelId: { stars, bill } }
const POD_COLOURS = 6;                // base.css has --accent-1 to --accent-6
const HOW = 'Tap a pod, then a node to run it there. Run every pod, end the turn, keep the bill under the cap.';
const KEYS = 'Keys: ← → choose a pod · 1-9 put it on the node with that key · B buy · D then a number drains and removes that node · E end turn · U undo · R restart';

const main = mountShell({ title: 'Pod Packer' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every accepted move so far, in order
let selectedPod = '';     // id of the Pending pod that the next node tap will place
let keyMode = 'place';    // what a number key does next: 'place', 'buy' or 'drain'
let confirmEnd = false;   // true after a warning that ending the turn now would lose
let message = { kind: 'info', text: '' };   // the feedback line; kind is 'info', 'good' or 'bad'
let flash = { nodeId: '', kind: '' };       // one node to animate on the next draw: 'good', 'bad' or 'new'
let families = [];        // pod name stems in this level ("web", "api"), used to give pods a colour
let biggest = { cpu: 1, mem: 1 };           // the largest node on sale, used to scale the small pod bars

// ------------------------------------------------------------ small helpers

function rupees(amount) {
  return `₹${amount}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Width of `part` out of `whole` as a CSS percentage, never more than 100%.
function share(part, whole) {
  return `${Math.min(100, (part / whole) * 100)}%`;
}

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(3 - count);
}

function say(kind, text) {
  message = { kind, text };
}

function playing() {
  return state.status === 'playing';
}

function pickedPod() {
  return state.pending.find((pod) => pod.id === selectedPod) || null;
}

// "web-2" -> "web". Pods of one family share a colour.
function familyOf(podId) {
  return podId.replace(/-\d+$/, '');
}

// The colour for a pod, as a style for el(): it sets the CSS variable --pod.
function podColour(pod) {
  const number = (Math.max(0, families.indexOf(familyOf(pod.id))) % POD_COLOURS) + 1;
  return { '--pod': `var(--accent-${number})` };
}

// ------------------------------------------------------------------- inputs

// Every change to the game goes through here. Returns logic.js's verdict { ok, reason }.
function tryMove(move) {
  const verdict = check(state, move);
  confirmEnd = false;
  if (verdict.ok) {
    state = apply(state, move);
    recorded.push(move);
    if (state.status === 'won') rememberWin();
  }
  return verdict;
}

function selectPod(podId) {
  selectedPod = podId;
  keyMode = 'place';
  say('info', `${podId} selected. Now choose a node for it.`);
  update();
}

// Arrow keys: move the selection to the next or previous Pending pod.
function cyclePod(step) {
  const ids = state.pending.map((pod) => pod.id);
  if (!playing() || ids.length === 0) return;
  const at = ids.indexOf(selectedPod);
  selectPod(ids[(at + step + ids.length) % ids.length]);
}

function placeOn(nodeId) {
  keyMode = 'place';
  const podId = selectedPod;
  if (!podId) {
    say('info', 'No pod is waiting. End the turn when you are ready.');
    return update();
  }
  const verdict = tryMove(`place ${podId} ${nodeId}`);
  flash = { nodeId, kind: verdict.ok ? 'good' : 'bad' };
  if (verdict.ok) say('good', `${podId} is running on ${nodeId}.${isPacked(nodeId) ? ` ${nodeId} is packed tight: nothing wasted.` : ''}`);
  else say('bad', `${podId} cannot go on ${nodeId}. ${verdict.reason}.`);
  return update();
}

function isPacked(nodeId) {
  const node = state.nodes.find((n) => n.id === nodeId);
  const free = node ? freeOn(node) : { cpu: 1, mem: 1 };
  return free.cpu === 0 && free.mem === 0;
}

function buyNode(typeName) {
  keyMode = 'place';
  const verdict = tryMove(`buy ${typeName}`);
  if (verdict.ok) {
    const node = state.nodes[state.nodes.length - 1];
    flash = { nodeId: node.id, kind: 'new' };
    say('good', `Bought ${node.id}, a ${typeName} node, for ${rupees(node.price)} a turn.`);
  } else {
    say('bad', verdict.reason);
  }
  update();
}

function drainNode(nodeId) {
  keyMode = 'place';
  const node = state.nodes.find((n) => n.id === nodeId);
  const verdict = tryMove(`drain ${nodeId}`);
  if (!verdict.ok) {
    say('bad', verdict.reason);
  } else if (node.pods.length === 0) {
    say('good', `Removed the empty node ${nodeId}. It will not be billed.`);
  } else {
    const names = node.pods.map((pod) => pod.id);
    say('good', `Drained and removed ${nodeId}. Its pods were evicted; replacements are Pending: ${names.join(', ')}.`);
  }
  update();
}

// Ending a turn that would lose asks first: the warning is shown, and a second press does it.
function endTurn() {
  keyMode = 'place';
  if (!playing()) return;
  const preview = apply(state, 'end');   // ask logic.js what would happen; nothing is changed yet
  if (preview.status === 'lost' && !confirmEnd) {
    confirmEnd = true;
    say('bad', `Ending the turn now would lose the level: "${preview.lostReason}" Press End turn again to do it anyway.`);
    update();
    return;
  }
  tryMove('end');
  say('info', playing() ? `Turn ${state.turn} begins. ${state.news.join(' ')}` : state.news.join(' '));
  update();
}

function undo() {
  if (recorded.length === 0 || state.status === 'won') return;
  const move = recorded.pop();
  state = replay(state.level, recorded);   // rebuild the state from the moves that remain
  keyMode = 'place';
  confirmEnd = false;
  say('info', `Undid "${move}".`);
  update();
}

function openLevel(index, moveFocus) {
  const level = levels[index];
  levelIndex = index;
  state = start(level);
  recorded = [];
  selectedPod = '';
  keyMode = 'place';
  confirmEnd = false;
  families = [...new Set(level.arrivals.flatMap((wave) => wave.pods.map((pod) => familyOf(pod.id))))];
  const types = Object.values(level.nodeTypes);
  biggest = { cpu: Math.max(...types.map((type) => type.cpu)), mem: Math.max(...types.map((type) => type.mem)) };
  say('info', `${plural(state.pending.length, 'pod')} waiting. Buy a node, then put the pods on it.`);
  update();
  if (moveFocus) focusFallback();
}

function nextLevel() {
  if (state.status === 'won' && levelIndex < levels.length - 1) openLevel(levelIndex + 1, true);
}

// Keep the best (lowest) winning bill for each level.
function rememberWin() {
  const id = state.level.id;
  const old = best[id];
  if (old && old.bill <= state.bill) return;
  best[id] = { stars: stars(state), bill: state.bill };
  save(SAVE_KEY, best);
}

// ----------------------------------------------------------------- keyboard

// B: with one node type it buys at once; with several it waits for a number.
function startBuying() {
  if (!playing()) return;
  const names = Object.keys(state.level.nodeTypes);
  if (names.length === 1) return buyNode(names[0]);
  keyMode = 'buy';
  say('info', `Buy which node? Press ${names.map((name, i) => `${i + 1} for ${name}`).join(', ')}. Esc cancels.`);
  return update();
}

// D: waits for the number of the node to drain.
function startDraining() {
  if (!playing()) return;
  if (state.nodes.length === 0) say('info', 'There is no node to drain.');
  else {
    keyMode = 'drain';
    say('info', 'Drain and remove which node? Press its number. Esc cancels.');
  }
  update();
}

function cancelMode() {
  if (keyMode === 'place') return;
  keyMode = 'place';
  say('info', 'Cancelled.');
  update();
}

// A number key means different things after B (which type to buy) and after D (which node to drain).
// For nodes, the number is the node's place in the list (shown as a key on its card), not
// the number in its name: after drains the names go n3, n5, ... but the keys stay 1, 2, ...
function onDigit(number) {
  if (!playing()) return;
  const mode = keyMode;
  keyMode = 'place';
  if (mode === 'buy') return buyByNumber(number);
  const node = state.nodes[number - 1];
  if (!node) {
    say('bad', `No node has key ${number}. Press B to buy one.`);
    return update();
  }
  return mode === 'drain' ? drainNode(node.id) : placeOn(node.id);
}

function buyByNumber(number) {
  const name = Object.keys(state.level.nodeTypes)[number - 1];
  if (name) return buyNode(name);
  say('bad', `There is no node type number ${number}.`);
  return update();
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key >= '1' && key <= '9' && key.length === 1) onDigit(Number(key));
  else if (key === 'b') startBuying();
  else if (key === 'd') startDraining();
  else if (key === 'e') endTurn();
  else if (key === 'u') undo();
  else if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n') nextLevel();
  else if (key === 'escape') cancelMode();
  else if (key === 'arrowright' || key === 'arrowleft') {
    event.preventDefault();
    cyclePod(key === 'arrowright' ? 1 : -1);
  }
}

// -------------------------------------------------------------------- focus
// Most of the page is rebuilt on every update, which would drop keyboard focus.
// Buttons carry a data-key ("pod:web-1", "node:n1", "buy:small"); after a redraw we
// focus the button with the same key again, or a sensible next one if it is gone.

function focusedKey() {
  const active = document.activeElement;
  return (active && active.dataset && active.dataset.key) || '';
}

function byKey(key) {
  return [...main.querySelectorAll('[data-key]')].find((node) => node.dataset.key === key) || null;
}

function focusFallback() {
  const target = byKey(`pod:${selectedPod}`) || view.end;
  target.focus();
}

function restoreFocus(key) {
  if (!playing()) return view.primary.focus();
  if (!key) return undefined;
  if (key.startsWith('pod:')) return focusFallback();   // focus follows the selected pod
  const same = byKey(key);
  if (same && !same.disabled) return same.focus();
  return focusFallback();
}

// ------------------------------------------------------- drawing: fixed parts

function actionButton(label, key, onclick, extraClass) {
  return el('button', { class: `btn ${extraClass}`, type: 'button', onclick }, label, kbd(key));
}

// Runs once: creates every element that stays on the page.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.result = el('section', { class: 'panel result stack', hidden: true });
  view.title = el('h2');
  view.turn = el('div', { class: 'pp-turn' });
  view.hint = el('p', { class: 'pp-hint' });
  view.notice = el('p', { class: 'pp-notice', role: 'status', hidden: true });
  view.tray = el('div', { class: 'pp-tray' });
  view.next = el('p', { class: 'pp-next muted' });
  view.nodes = el('div', { class: 'pp-nodes' });
  view.shop = el('div', { class: 'pp-shop' });
  view.message = el('p', { class: 'pp-message', 'aria-live': 'polite' });
  view.end = actionButton('End turn', 'E', endTurn, 'btn-primary');
  view.undo = actionButton('Undo', 'U', undo, 'btn-quiet');
  view.restart = actionButton('Restart', 'R', () => openLevel(levelIndex, true), 'btn-quiet');

  view.actions = el('div', { class: 'pp-actions' },
    view.message,
    el('div', { class: 'row' }, view.end, view.undo, view.restart));

  main.append(
    el('p', { class: 'how' }, HOW),
    view.picker,
    view.result,
    el('section', { class: 'panel stack' },
      el('div', { class: 'pp-head' }, view.title, view.turn),
      view.hint,
      buildBill(),
      view.notice,
      el('div', { class: 'pp-board' },
        el('section', { class: 'stack', 'aria-label': 'Pending pods' },
          el('h3', {}, 'Pending pods'), view.tray, view.next),
        el('section', { class: 'stack', 'aria-label': 'Nodes' },
          el('h3', {}, 'Nodes'), view.shop, view.nodes)),
      view.actions),
    el('p', { class: 'pp-keys muted' }, KEYS),
  );
}

// The bill meter keeps its elements between draws, so its bars can slide (see style.css).
function buildBill() {
  view.billNow = el('strong', { class: 'pp-bill-now' });
  view.billCap = el('span');
  view.billAdd = el('span', { class: 'pp-bill-add' });
  view.billPaid = el('span', { class: 'pp-meter-paid' });
  view.billNext = el('span', { class: 'pp-meter-next' });
  view.billMark = el('span', { class: 'pp-meter-mark' });
  view.billGoal = el('span', { class: 'pp-bill-goal muted' });
  view.meter = el('div', { class: 'pp-meter', role: 'img' }, view.billPaid, view.billNext, view.billMark);
  return el('div', { class: 'pp-bill' },
    el('div', { class: 'pp-bill-top' }, el('span', {}, 'Bill ', view.billNow, view.billCap), view.billAdd),
    view.meter,
    view.billGoal);
}

// ---------------------------------------------- drawing: after every input

function update() {
  const key = focusedKey();
  if (!pickedPod()) selectedPod = state.pending.length > 0 ? state.pending[0].id : '';
  drawHead();
  drawBill();
  drawNotice();
  drawTray();
  drawNodes();
  drawShop();
  drawActions();
  drawPicker();
  drawResult();
  flash = { nodeId: '', kind: '' };
  restoreFocus(key);
}

function drawHead() {
  const level = state.level;
  const done = state.status === 'won' ? level.turns : state.turn - 1;
  const pips = [];
  for (let turn = 1; turn <= level.turns; turn += 1) {
    const when = turn <= done ? 'done' : turn === state.turn ? 'now' : 'later';
    pips.push(el('span', { class: `pp-pip pp-pip-${when}` }));
  }
  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.hint.textContent = level.hint;
  view.turn.replaceChildren(`Turn ${state.turn} of ${level.turns}`, el('span', { class: 'pp-pips', 'aria-hidden': 'true' }, pips));
}

function drawBill() {
  const level = state.level;
  const cost = playing() ? turnCost(state) : 0;
  const over = state.bill + cost > level.maxBill;
  const reference = referenceBill(level);
  view.billNow.textContent = rupees(state.bill);
  view.billCap.textContent = ` of ${rupees(level.maxBill)} cap`;
  if (!playing()) view.billAdd.textContent = '';
  else view.billAdd.textContent = over ? `⚠ +${rupees(cost)} this turn would break the cap` : `+${rupees(cost)} when this turn ends`;
  view.billAdd.className = over ? 'pp-bill-add pp-over' : 'pp-bill-add';
  view.billPaid.style.width = share(state.bill, level.maxBill);
  view.billNext.style.width = share(cost, level.maxBill);
  view.billNext.className = over ? 'pp-meter-next pp-over' : 'pp-meter-next';
  view.billMark.style.left = share(reference, level.maxBill);
  view.billGoal.textContent = `★★★ for a final bill of ${rupees(reference)} or less`;
  view.meter.setAttribute('aria-label', `Bill ${rupees(state.bill)} of a ${rupees(level.maxBill)} cap`);
}

// The one-turn warning before a spot reclaim.
function drawNotice() {
  const lines = notices(state).map((notice) => {
    const every = `every ${notice.type} node alive when this turn ends will be reclaimed`;
    if (notice.nodeIds.length === 0) return `${every}.`;
    const ids = notice.nodeIds.join(' and ');
    return `${every} (now: ${ids}). Buy a node of another type, then drain ${ids} so ${notice.nodeIds.length === 1 ? 'its' : 'their'} pods are replaced there.`;
  });
  view.notice.hidden = lines.length === 0 || !playing();
  view.notice.textContent = `⚠ Spot interruption notice: ${lines.join(' ')}`;
}

// ------------------------------------------------------------ drawing: pods

function tagRow(tags) {
  if (tags.length === 0) return null;
  return el('span', { class: 'pp-tags' }, tags.map((text) => el('span', { class: 'pp-tag' }, text)));
}

// The facts about a pod that change where it can go or how long it stays.
function podTags(pod) {
  const tags = [];
  if (pod.needs) tags.push(`needs ${pod.needs} node`);
  if (pod.tolerates) tags.push(`tolerates ${pod.tolerates}`);
  if (pod.runs) tags.push(`job: ${plural(pod.runs, 'turn')}`);
  return tags;
}

function pendingTags(pod) {
  const canWait = patienceOf(state.level, pod) - pod.waited;
  return canWait > 0 ? [...podTags(pod), `can wait ${plural(canWait, 'turn')}`] : podTags(pod);
}

// One small bar showing how big a request is next to the largest node on sale.
function sizeBar(name, amount, whole, text) {
  return el('span', { class: 'pp-size' },
    el('span', {}, name),
    el('span', { class: 'pp-size-track' }, el('span', { class: 'pp-size-fill', style: { width: share(amount, whole) } })),
    el('span', {}, text));
}

function podChip(pod) {
  const picked = pod.id === selectedPod;
  return el('button', {
    class: 'pp-pod', type: 'button', disabled: !playing(),
    'aria-pressed': picked ? 'true' : 'false',
    dataset: { key: `pod:${pod.id}` }, style: podColour(pod),
    onclick: () => selectPod(pod.id),
  },
  el('span', { class: 'pp-pod-name' }, pod.id, picked ? el('span', { class: 'pp-picked' }, 'selected') : null),
  sizeBar('CPU', pod.cpu, biggest.cpu, String(pod.cpu / 1000)),
  sizeBar('MEM', pod.mem, biggest.mem, memText(pod.mem)),
  tagRow(pendingTags(pod)));
}

function nextText() {
  if (state.turn >= state.level.turns) return 'This is the last turn.';
  const pods = comingNext(state);
  if (pods.length === 0) return 'Next turn: no new pods.';
  return `Next turn: ${pods.map((pod) => `${pod.id} (${cpuText(pod.cpu)}, ${memText(pod.mem)})`).join(', ')}.`;
}

function drawTray() {
  const chips = state.pending.map(podChip);
  const empty = el('p', { class: 'pp-empty' }, playing() ? '✓ Every pod is running. End the turn.' : 'Nothing is waiting.');
  view.tray.replaceChildren(...(chips.length > 0 ? chips : [empty]));
  view.next.textContent = playing() ? nextText() : '';
}

// ----------------------------------------------------------- drawing: nodes

// One usage bar (CPU or memory) of a node: a block per pod, plus a dashed "ghost"
// block showing where the selected pod would go if it fits.
function usageBar(name, node, field, ghost, newest) {
  const free = freeOn(node)[field];
  const blocks = node.pods.map((pod) => el('span', {
    class: pod.id === newest ? 'pp-seg pp-seg-new' : 'pp-seg',
    style: { ...podColour(pod), width: share(pod[field], node[field]) },
  }, pod.id));
  if (ghost) {
    blocks.push(el('span', { class: 'pp-seg pp-seg-ghost', style: { ...podColour(ghost), width: share(ghost[field], node[field]) } }, ghost.id));
  }
  const freeText = field === 'cpu' ? String(free / 1000) : memText(free);
  return el('span', { class: 'pp-use' },
    el('span', {}, name),
    el('span', { class: 'pp-bar' }, blocks),
    el('span', { class: 'pp-use-free' }, free === 0 ? 'full' : `${freeText} free`));
}

function nodeHead(node, key, packed, doomed) {
  return el('span', { class: 'pp-node-head' },
    kbd(key),
    el('strong', {}, node.id),
    el('span', {}, node.type),
    el('span', { class: 'pp-node-price' }, `${rupees(node.price)}/turn`),
    node.taint ? el('span', { class: 'pp-tag' }, `taint: ${node.taint}`) : null,
    node.label ? el('span', { class: 'pp-tag' }, `label: ${node.label}`) : null,
    packed ? el('span', { class: 'pp-badge pp-badge-packed' }, '✓ packed') : null,
    doomed ? el('span', { class: 'pp-badge pp-badge-doomed' }, '⚠ reclaimed at turn end') : null);
}

// The line on a node that says whether the selected pod fits, in the scheduler's words.
function verdictLine(pod, verdict) {
  if (!pod) return el('span', { class: 'pp-verdict' });
  if (verdict.ok) return el('span', { class: 'pp-verdict pp-yes' }, `✓ ${pod.id} fits here`);
  return el('span', { class: 'pp-verdict pp-no' }, `✗ ${verdict.reason}`);
}

// The pods on a node as small labels; jobs show how long they still run.
function podList(node) {
  if (node.pods.length === 0) return el('span', { class: 'pp-tags muted' }, 'empty');
  return el('span', { class: 'pp-tags' }, node.pods.map((pod) => {
    const extra = pod.runs ? ` · ${plural(pod.runs, 'turn')} left` : '';
    return el('span', { class: 'pp-tag pp-tag-pod', style: podColour(pod) }, pod.id + extra);
  }));
}

function nodeClass(verdict, packed, doomed, flashKind) {
  const names = ['pp-node'];
  if (packed) names.push('pp-packed');
  if (doomed) names.push('pp-doomed');
  if (verdict) names.push(verdict.ok ? 'pp-fit' : 'pp-nofit');
  if (flashKind) names.push(`pp-flash-${flashKind}`);
  return names.join(' ');
}

// `index` is the card's place in the list: its number key is index + 1.
function nodeCard(node, index) {
  const pod = playing() ? pickedPod() : null;
  const verdict = pod ? fits(pod, node) : null;
  const ghost = verdict && verdict.ok ? pod : null;
  const free = freeOn(node);
  const packed = free.cpu === 0 && free.mem === 0;
  const doomed = playing() && notices(state).some((notice) => notice.nodeIds.includes(node.id));
  const flashKind = flash.nodeId === node.id ? flash.kind : '';
  const newest = flashKind === 'good' ? node.pods[node.pods.length - 1].id : '';
  const key = String(index + 1);

  return el('div', { class: nodeClass(verdict, packed, doomed, flashKind) },
    el('button', {
      class: 'pp-node-main', type: 'button', disabled: !playing(),
      dataset: { key: `node:${node.id}` }, onclick: () => placeOn(node.id),
    },
    nodeHead(node, key, packed, doomed),
    usageBar('CPU', node, 'cpu', ghost, newest),
    usageBar('MEM', node, 'mem', ghost, newest),
    verdictLine(pod, verdict)),
    el('div', { class: 'pp-node-foot' },
      podList(node),
      el('button', {
        class: 'btn btn-quiet pp-drain', type: 'button', disabled: !playing(),
        dataset: { key: `drain:${node.id}` }, 'aria-label': `Drain and remove ${node.id}`,
        onclick: () => drainNode(node.id),
      }, 'Drain & remove', keyMode === 'drain' ? kbd(key) : null)));
}

function drawNodes() {
  const cards = state.nodes.map(nodeCard);
  const empty = el('p', { class: 'pp-empty' }, 'No nodes yet. Buy one above.');
  view.nodes.replaceChildren(...(cards.length > 0 ? cards : [empty]));
}

// ------------------------------------------------- drawing: shop and actions

function typeFacts(type) {
  const facts = [cpuText(type.cpu), memText(type.mem)];
  if (type.taint) facts.push(`taint: ${type.taint}`);
  if (type.label) facts.push(`label: ${type.label}`);
  if (type.spot) facts.push('can be reclaimed');
  return facts.join(' · ');
}

function drawShop() {
  const names = Object.keys(state.level.nodeTypes);
  const buttons = names.map((name, i) => {
    const type = state.level.nodeTypes[name];
    return el('button', {
      class: 'btn pp-buy', type: 'button', disabled: !playing(),
      dataset: { key: `buy:${name}` }, onclick: () => buyNode(name),
    },
    el('span', { class: 'pp-buy-top' },
      `+ Buy ${name}`, el('strong', {}, `${rupees(type.price)}/turn`),
      kbd('B'), names.length > 1 ? kbd(String(i + 1)) : null),
    el('span', { class: 'pp-buy-facts' }, typeFacts(type)));
  });
  view.shop.className = keyMode === 'buy' ? 'pp-shop pp-armed' : 'pp-shop';
  view.shop.replaceChildren(...buttons);
}

function drawActions() {
  const icon = { good: '✓ ', bad: '✗ ', info: '' }[message.kind];
  view.message.className = `pp-message pp-message-${message.kind}`;
  view.message.textContent = icon + message.text;
  view.undo.disabled = recorded.length === 0;
  view.actions.hidden = !playing();   // once the level is over, the result panel has the buttons
}

// ------------------------------------------------- drawing: picker and result

function drawPicker() {
  const chips = levels.map((level, i) => {
    const saved = best[level.id];
    const earned = saved ? saved.stars : 0;
    const label = `Level ${i + 1}, ${level.title}, ${earned} of 3 stars${saved ? `, best bill ${rupees(saved.bill)}` : ''}`;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button',
        'aria-current': i === levelIndex ? 'true' : null, 'aria-label': label,
        dataset: { key: `level:${i}` }, onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

function starLine(earned, bill, reference) {
  if (bill < reference) return `You beat the reference bill of ${rupees(reference)}.`;
  if (earned === 3) return `You matched the reference bill of ${rupees(reference)}.`;
  if (earned === 2) return `Close: the reference bill is ${rupees(reference)}. One more saving earns the third star.`;
  return `The reference bill is ${rupees(reference)}. There is a cheaper way.`;
}

function resultButton(label, key, onclick, extraClass, focusKey) {
  return el('button', { class: `btn ${extraClass}`, type: 'button', dataset: { key: focusKey }, onclick }, label, kbd(key));
}

function wonParts() {
  const level = state.level;
  const earned = stars(state);
  const last = levelIndex === levels.length - 1;
  const again = () => openLevel(levelIndex, true);
  view.primary = last
    ? resultButton('Play again', 'R', again, 'btn-primary', 'result:primary')
    : resultButton('Next level', 'N', nextLevel, 'btn-primary', 'result:primary');
  return [
    el('h2', {}, `Level ${levelIndex + 1} cleared`),
    el('p', { class: 'pp-stars', role: 'img', 'aria-label': `${earned} of 3 stars` }, starText(earned)),
    el('p', {}, `Final bill ${rupees(state.bill)} of a ${rupees(level.maxBill)} cap. ${starLine(earned, state.bill, referenceBill(level))}`),
    el('p', { class: 'pp-lesson' }, el('strong', {}, 'What this shows: '), level.lesson),
    last ? el('p', {}, 'That was the last level. Every star is a real saving.') : null,
    el('div', { class: 'row' }, view.primary, last ? null : resultButton('Play again', 'R', again, 'btn-quiet', 'result:again')),
    DEV ? el('pre', { class: 'dev' }, `solution: [${recorded.map((move) => `'${move}'`).join(', ')}],`) : null,
  ];
}

function lostParts() {
  view.primary = resultButton('Try again', 'R', () => openLevel(levelIndex, true), 'btn-primary', 'result:primary');
  return [
    el('h2', {}, 'Level lost'),
    el('p', {}, state.lostReason),
    el('div', { class: 'row' }, view.primary, resultButton('Undo last move', 'U', undo, 'btn-quiet', 'result:undo')),
  ];
}

function drawResult() {
  view.result.hidden = playing();
  if (playing()) return view.result.replaceChildren();
  const won = state.status === 'won';
  view.result.className = won ? 'panel result stack pp-won' : 'panel result lost stack';
  return view.result.replaceChildren(...(won ? wonParts() : lostParts()).filter(Boolean));
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

build();
openLevel(firstUnsolved(), false);
document.addEventListener('keydown', onKey);
ready();
