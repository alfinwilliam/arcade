// PAGE for Packet Quest: drawing and input only.
// Every rule lives in logic.js. This file never decides what a hop does or who wins.
//
// How it is laid out:
//   1. Words and numbers you can tune (the tables at the top).
//   2. Inputs: every change of state goes through press(), which calls logic.apply
//      and records the input. Opening and closing a hop's panel is view-only.
//   3. The travelling packet: after Send, the hops light up one at a time.
//   4. Drawing: build() runs once, buildChain() once per level, update() after every input.

import { mountShell, ready, el } from '../../shared/shell.js';
import { load, save } from '../../shared/storage.js';
import { levels } from './levels.js';
import { start, apply, stars, starsLeft, activeFixes, currentHops, targetName, MAX_STARS } from './logic.js';

// ----------------------------------------------------------------- 1. tunables

const DEV = new URLSearchParams(location.search).has('dev');   // ?dev: show the recorded inputs on a win
const SAVE_KEY = 'packet-quest:stars';                          // saved as { levelId: bestStars }
const STEP_MS = 450;                                            // how long the packet rests on each hop

// What each kind of hop is called, and what it does, in one plain sentence.
const KIND_INFO = {
  dns: { label: 'DNS', does: 'Turns a name into an address. Nothing can be sent to the server until that is done.' },
  route: { label: 'Route table', does: 'Decides where a packet goes next, by looking at its destination address.' },
  firewall: { label: 'Security group', does: 'Lets in only the traffic on its list, and remembers the connections it let in.' },
  nacl: { label: 'Network ACL', does: 'Checks every packet against numbered rules, lowest number first. It remembers nothing.' },
  nat: { label: 'NAT gateway', does: 'Lends its public address to servers that have none of their own.' },
  service: { label: 'Service', does: 'A fixed address in front of pods. It forwards its own port to a port on a pod.' },
  listener: { label: 'Destination', does: 'Where the packet is going: a server or a pod with a program listening on one port.' },
  reply: { label: 'Reply', does: 'The server answers, and the packet turns round. Every hop after this one is on the way back.' },
};

// What the client sees, as a word and as a plain sentence.
const SYMPTOMS = {
  nxdomain: { word: 'NXDOMAIN', says: 'DNS answered that the name does not exist, so no connection was attempted.' },
  timeout: { word: 'TIMEOUT', says: 'No answer came back. The client waited, then gave up.' },
  refused: { word: 'CONNECTION REFUSED', says: 'An answer came back at once, and the answer was no.' },
  ok: { word: 'CONNECTED', says: 'The packet was delivered.' },
};

// How a hop card reports the last packet. A mark and a word, never colour alone.
const STATUS = {
  idle: '',
  passed: '✓ passed',
  stopped: '✗ stopped here',
  unreached: '– not reached',
  hidden: '? not inspected',
};

// ------------------------------------------------------------------ page state

const main = mountShell({ title: 'Packet Quest' });
const best = load(SAVE_KEY, {});
const view = {};          // the page elements that update() needs to reach
let levelIndex = 0;
let state = null;         // the current game state, always produced by logic.js
let recorded = [];        // every input so far, in order: exactly what replay() takes
let openHop = null;       // id of the hop whose panel is open (view only)
let shown = 0;            // how many steps of the last trace the travelling packet has reached
let timer = null;         // the interval that moves the packet; null when it is not moving
let message = '';         // one line of feedback under the Send button

// -------------------------------------------------------------------- 2. inputs

// The one way the game state changes.
function press(input) {
  if (state.status !== 'playing') return;
  stopTravel();
  const before = state;
  state = apply(state, input);
  if (state === before) return;          // nothing changed (for example: no hints left)
  recorded.push(input);
  if (input === 'send') {
    afterSend(before);
    return;
  }
  if (input.startsWith('undo:')) message = 'Put back the way it was. Press Send to try again.';
  else if (!input.includes(':') && input !== 'hint') message = 'Change made. Press Send to try it.';
  update();
}

function afterSend(before) {
  message = '';
  if (state.charged.length > before.charged.length) {
    const lostStar = starsLeft(state) < starsLeft(before);
    message = lostStar ? 'That change was not the fix: one star lost. ' : 'That change was not the fix. ';
  }
  if (state.status === 'won') rememberWin();
  startTravel();
}

// Open or close a hop's panel. Looking inside is recorded as an input the first time,
// because in fog levels it reveals what the hop did with the packet.
function selectHop(hopId) {
  openHop = openHop === hopId ? null : hopId;
  if (openHop && state.status === 'playing' && !state.inspected.includes(hopId)) press(`inspect:${hopId}`);
  else update();
}

// The Close button in a hop's panel: close it and hand focus back to the hop's card.
function closeHop(hopId) {
  openHop = null;
  update();
  view.cards[hopId].button.focus();
}

function openLevel(index, moveFocus) {
  stopTravel();
  levelIndex = index;
  state = start(levels[index]);
  recorded = [];
  openHop = null;
  shown = 0;
  message = '';
  buildChain();
  update();
  if (moveFocus) view.send.focus();
}

function rememberWin() {
  const id = state.level.id;
  best[id] = Math.max(best[id] || 0, stars(state));
  save(SAVE_KEY, best);
}

function onKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const lastLevel = levelIndex === levels.length - 1;
  if (key === 's') press('send');
  else if (key === 'h') press('hint');
  else if (key === 'r') openLevel(levelIndex, true);
  else if (key === 'n' && state.status === 'won' && !lastLevel) openLevel(levelIndex + 1, true);
}

// ------------------------------------------------------- 3. the travelling packet

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// After a send: light the hops up one at a time. With reduced motion, or in a fog level
// where the packet was lost (the page must not show where), show the outcome at once.
function startTravel() {
  const result = state.result;
  const lostInFog = state.level.fog && !result.delivered;
  if (reducedMotion() || lostInFog) {
    arrive();
    return;
  }
  shown = 0;
  // The timer is set before the first update(), because the drawing code reads
  // "timer is not null" as "the packet is still on its way".
  timer = setInterval(() => {
    shown += 1;
    if (shown >= state.result.steps.length) arrive();
    else update();
  }, STEP_MS);
  update();
}

// Stop the packet where it is and show the whole outcome.
function stopTravel() {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (state && state.result) shown = state.result.steps.length;
}

// The packet has reached the end of its trip (delivered or dropped).
function arrive() {
  stopTravel();
  const result = state.result;
  if (result.delivered) {
    message = '';
  } else if (state.level.fog) {
    message += 'The packet did not arrive. Open the hops to find out where it stopped.';
  } else {
    openHop = result.failsAt;
    message += `Stopped at ${hopName(result.failsAt)}. Its panel is open below.`;
  }
  update();
  if (state.status === 'won') view.primary.focus();
  else if (openHop) view.inspector.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

// --------------------------------------------------------------------- 4. drawing

function kbd(text) {
  return el('span', { class: 'kbd' }, text);
}

// Replace everything inside an element, leaving out the empty entries (null, false).
function put(parent, ...kids) {
  parent.replaceChildren(...kids.flat().filter((kid) => kid !== null && kid !== undefined && kid !== false));
}

function starText(count) {
  return '★'.repeat(count) + '☆'.repeat(MAX_STARS - count);
}

function hopName(hopId) {
  return state.level.hops.find((hop) => hop.id === hopId).name;
}

// True for hops listed after the reply hop: they are on the way back.
function onWayBack(hopIndex) {
  const turnAt = state.level.hops.findIndex((hop) => hop.kind === 'reply');
  return turnAt !== -1 && hopIndex > turnAt;
}

// Runs once: creates the parts of the page that never change shape.
function build() {
  view.picker = el('ol', { class: 'levels', 'aria-label': 'Levels' });
  view.title = el('h2');
  view.brief = el('p');
  view.fog = el('p', { class: 'pq-fog' },
    el('span', { class: 'pill' }, 'Fog'),
    ' From here on you only see what the client sees. Open the hops to find out where the packet stopped.');
  view.request = el('p', { class: 'pq-request mono' });
  view.symptom = el('p', { class: 'pq-symptom', 'aria-live': 'polite' });
  view.message = el('p', { class: 'pq-message', 'aria-live': 'polite' });
  view.send = el('button', { class: 'btn btn-primary', type: 'button', onclick: () => press('send') },
    'Send packet', kbd('S'));
  view.hint = el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => press('hint') });
  view.restart = el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openLevel(levelIndex, true) },
    'Restart', kbd('R'));
  view.stake = el('p', { class: 'muted' });
  view.hints = el('ul', { class: 'pq-hints' });
  view.chain = el('ol', { class: 'pq-chain', 'aria-label': 'The path of the packet, hop by hop' });
  view.packet = el('div', { class: 'pq-packet', 'aria-hidden': 'true', hidden: true });
  view.inspector = el('li', { class: 'pq-inspector' });
  view.result = el('section', { class: 'panel result stack', hidden: true });

  main.append(
    el('p', { class: 'how' },
      'Press Send and watch where the packet stops. Open that hop, choose a change, and send again.'),
    view.picker,
    el('section', { class: 'panel stack' },
      view.title,
      view.brief,
      view.fog,
      el('div', { class: 'pq-client' }, view.request, view.symptom),
      el('div', { class: 'row pq-actions' }, view.send, view.hint, view.restart),
      view.message,
      view.hints),
    el('section', { class: 'panel stack' },
      el('h3', {}, 'The path'),
      el('div', { class: 'pq-chain-wrap' }, view.chain, view.packet),
      view.stake),
    view.result,
  );
}

// Runs when a level opens: one card per hop, with the client at the start
// (and again at the end, when the level has a reply that must come home).
function buildChain() {
  const level = state.level;
  const hasReply = level.hops.some((hop) => hop.kind === 'reply');
  view.cards = {};

  view.startCap = el('li', { class: 'pq-hop pq-cap' },
    el('div', { class: 'pq-card' },
      el('span', { class: 'pq-kind' }, 'Client'),
      el('span', { class: 'pq-name mono' }, level.request.from),
      el('span', { class: 'pq-status' }, 'sends the packet')));
  view.endStatus = el('span', { class: 'pq-status' });
  view.endCap = !hasReply ? null : el('li', { class: 'pq-hop pq-cap pq-last', dataset: { leg: 'back' } },
    el('div', { class: 'pq-card' },
      el('span', { class: 'pq-kind' }, 'Client'),
      el('span', { class: 'pq-name mono' }, level.request.from),
      view.endStatus));

  const items = level.hops.map((hop, index) => {
    const card = {
      status: el('span', { class: 'pq-status' }),
      changed: el('span', { class: 'pq-changed', hidden: true }, 'changed'),
    };
    card.button = el('button', {
      class: 'pq-card', type: 'button', dataset: { key: `hop:${hop.id}` },
      onclick: () => selectHop(hop.id),
    },
    el('span', { class: 'pq-kind' }, (onWayBack(index) ? '↩ ' : '') + KIND_INFO[hop.kind].label),
    el('span', { class: 'pq-name' }, hop.name),
    card.status,
    card.changed);
    const last = !hasReply && index === level.hops.length - 1;
    card.item = el('li', {
      class: last ? 'pq-hop pq-last' : 'pq-hop',
      dataset: onWayBack(index) ? { leg: 'back' } : {},
    }, card.button);
    view.cards[hop.id] = card;
    return card.item;
  });

  const all = [view.startCap, ...items];
  if (view.endCap) all.push(view.endCap);
  view.chain.replaceChildren(...all);
}

// Runs after every input: copies the state onto the page, keeping keyboard focus
// on the same control even when that control was rebuilt.
function update() {
  const focused = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.key : null;

  drawPicker();
  drawMission();
  drawChain();
  drawInspector();
  drawPacket();
  drawResult();

  if (!focused) return;
  for (const node of main.querySelectorAll('[data-key]')) {
    if (node.dataset.key === focused) node.focus();
  }
}

function drawPicker() {
  const chips = levels.map((level, i) => {
    const earned = best[level.id] || 0;
    return el('li', {},
      el('button', {
        class: 'btn level-chip', type: 'button', dataset: { key: `level:${i}` },
        'aria-current': i === levelIndex ? 'true' : null,
        'aria-label': `Level ${i + 1}, ${level.title}, ${earned} of ${MAX_STARS} stars`,
        onclick: () => openLevel(i, true),
      }, String(i + 1), el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(earned))));
  });
  view.picker.replaceChildren(...chips);
}

// What the client sees, as a short piece of text. While the packet is still
// travelling, it says so instead.
function symptomNode() {
  if (state.result && timer !== null) return el('span', { class: 'muted' }, 'Sending…');
  if (state.result) {
    const seen = SYMPTOMS[state.result.symptom];
    return el('span', {},
      el('strong', { class: state.result.delivered ? 'pq-good' : 'pq-bad' }, seen.word),
      ` ${seen.says}`);
  }
  if (state.sends > 0 || activeFixes(state).length > 0) {
    return el('span', { class: 'muted' }, 'Not sent since the last change.');
  }
  return el('span', { class: 'muted' }, 'Not sent yet.');
}

function drawMission() {
  const level = state.level;
  const playing = state.status === 'playing';

  view.title.textContent = `${levelIndex + 1}. ${level.title}`;
  view.brief.textContent = level.brief;
  view.fog.hidden = !level.fog;
  view.request.textContent = `Client ${level.request.from} → ${level.request.host}, port ${level.request.port}`;

  view.symptom.replaceChildren(symptomNode());

  view.message.textContent = message;
  view.message.hidden = message === '';

  const hintsLeft = level.hints.length - state.hints;
  view.send.disabled = !playing;
  view.hint.disabled = !playing || hintsLeft === 0;
  view.hint.replaceChildren(hintsLeft === 0 ? 'No hints left' : 'Hint (costs a star)', kbd('H'));
  view.hints.replaceChildren(...level.hints.slice(0, state.hints).map((hint) => el('li', {}, hint)));
  view.hints.hidden = state.hints === 0;

  const atStake = starsLeft(state);
  view.stake.replaceChildren(
    el('span', { class: 'stars', 'aria-hidden': 'true' }, starText(atStake)),
    ` ${atStake} of ${MAX_STARS} stars left. Each hint, and each wrong change you send, costs one.`);
  view.stake.hidden = !playing;
}

// What a hop card says about the last packet: one of the keys of STATUS.
function hopStatus(hopIndex) {
  const result = state.result;
  if (!result) return 'idle';
  if (timer !== null && hopIndex >= shown) return 'idle';       // the packet has not got this far yet
  const hop = state.level.hops[hopIndex];
  const lostInFog = state.level.fog && !result.delivered;
  if (lostInFog && !state.inspected.includes(hop.id)) return 'hidden';
  const step = result.steps[hopIndex];
  if (!step) return 'unreached';
  return step.outcome === 'pass' ? 'passed' : 'stopped';
}

function drawChain() {
  state.level.hops.forEach((hop, index) => {
    const card = view.cards[hop.id];
    const status = hopStatus(index);
    card.item.dataset.status = status;
    card.status.textContent = STATUS[status];
    card.changed.hidden = !state.fixes[hop.id];
    card.button.setAttribute('aria-expanded', openHop === hop.id ? 'true' : 'false');
  });

  if (view.endCap) {
    const home = state.result && state.result.delivered && timer === null;
    view.endCap.dataset.status = home ? 'passed' : 'idle';
    view.endStatus.textContent = home ? '✓ reply received' : 'waits for the reply';
  }
}

// One line of a hop's settings, e.g. "port 443 from 0.0.0.0/0".
function line(text) {
  return el('li', {}, text);
}

function portText(ports) {
  return ports[0] === ports[1] ? `port ${ports[0]}` : `ports ${ports[0]}-${ports[1]}`;
}

// A hop's settings as a titled list. `hop` already has the chosen fix applied.
function describeHop(hop) {
  if (hop.kind === 'dns') {
    return ['Records', Object.entries(hop.records).map(([name, address]) => line(`${name} → ${address}`))];
  }
  if (hop.kind === 'route') {
    return ['Routes (destination → target)',
      hop.routes.map((route) => line(`${route.dest} → ${targetName(route.target)}`))];
  }
  if (hop.kind === 'firewall') {
    const rules = hop.allow.map((rule) => line(`allow port ${rule.port} from ${rule.from}`));
    return ['Inbound rules (anything not listed is dropped)', rules];
  }
  if (hop.kind === 'nacl') {
    const way = hop.direction === 'inbound' ? 'from' : 'to';
    const ordered = [...hop.rules].sort((a, b) => a.num - b.num);
    const rules = ordered.map((rule) => line(`${rule.num}: ${rule.action} ${portText(rule.ports)} ${way} ${rule.cidr}`));
    return [`${hop.direction === 'inbound' ? 'Inbound' : 'Outbound'} rules (lowest number first)`,
      [...rules, line('*: deny everything else')]];
  }
  if (hop.kind === 'nat') {
    return ['Settings', [line(`public address ${hop.publicIp}`)]];
  }
  if (hop.kind === 'service') {
    return ['Settings', [
      line(`address ${hop.ip}`),
      line(`port ${hop.port} (where clients connect)`),
      line(`targetPort ${hop.targetPort} (where it forwards to)`),
      line(`pod behind it: ${hop.endpoint}`),
    ]];
  }
  if (hop.kind === 'listener') {
    return ['Settings', [line(`address ${hop.ip}`), line(`a program is listening on port ${hop.port}`)]];
  }
  return ['Settings', [line('nothing to set: the server simply answers')]];
}

// What this hop did with the last packet, as a sentence.
function verdictText(hopIndex) {
  const result = state.result;
  if (!result) return 'Press Send to see what this hop does with the packet.';
  const step = result.steps[hopIndex];
  return step ? step.text : 'The packet did not get this far.';
}

function fixButton(fix) {
  const active = state.fixes[fix.hop] === fix.id;
  const playing = state.status === 'playing';
  return el('li', {},
    el('button', {
      class: 'btn pq-fix', type: 'button', dataset: { key: `fix:${fix.id}` },
      'aria-pressed': active ? 'true' : 'false',
      disabled: !playing,
      onclick: () => press(active ? `undo:${fix.hop}` : fix.id),
    }, active ? '✓ In place: ' : '', fix.label, active && playing ? el('span', { class: 'pq-undo' }, 'press to put back') : null));
}

// The panel for the open hop. It sits in the list right after that hop's card,
// so on a phone it opens directly under the card you tapped.
function drawInspector() {
  const level = state.level;
  const hopIndex = level.hops.findIndex((hop) => hop.id === openHop);
  if (hopIndex === -1) {
    view.inspector.remove();
    return;
  }

  const hop = currentHops(state)[hopIndex];
  const [heading, lines] = describeHop(hop);
  const fixes = level.fixes.filter((fix) => fix.hop === hop.id);

  put(view.inspector,
    el('div', { class: 'pq-inspector-head' },
      el('h3', {}, hop.name),
      el('button', { class: 'btn btn-quiet', type: 'button', onclick: () => closeHop(hop.id) }, 'Close')),
    el('p', { class: 'muted' }, `${KIND_INFO[hop.kind].label}. ${KIND_INFO[hop.kind].does}`),
    el('div', {},
      el('p', { class: 'pq-label' }, heading),
      el('ul', { class: 'pq-config mono' }, lines.length > 0 ? lines : line('(none)'))),
    hop.note ? el('p', { class: 'pq-note' }, hop.note) : null,
    el('div', {},
      el('p', { class: 'pq-label' }, 'The last packet'),
      el('p', { class: 'pq-verdict' }, verdictText(hopIndex))),
    el('div', {},
      el('p', { class: 'pq-label' }, 'Changes you can make here'),
      fixes.length > 0
        ? el('ul', { class: 'pq-fixes' }, fixes.map(fixButton))
        : el('p', { class: 'muted' }, 'Nothing to change at this hop.')),
    // A second Send button, so on a phone you need not scroll back to the top one.
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn-primary', type: 'button', dataset: { key: 'send-here' },
        disabled: state.status !== 'playing',
        onclick: () => press('send'),
      }, 'Send packet'),
      el('p', { class: 'pq-seen' }, 'Client sees: ', symptomNode())),
  );
  view.cards[hop.id].item.after(view.inspector);
}

// Put the packet marker on the hop it has reached. The marker moves with a CSS
// transition (see style.css); with reduced motion the transition is switched off.
function drawPacket() {
  const result = state.result;
  const lostInFog = result && state.level.fog && !result.delivered;
  if (!result || lostInFog) {
    view.packet.hidden = true;
    return;
  }

  const finished = timer === null;
  let target = view.startCap;
  if (shown > 0) target = view.cards[result.steps[shown - 1].hop].item;
  if (finished && result.delivered && view.endCap) target = view.endCap;

  let mark = '●';
  if (finished) mark = result.delivered ? '✓' : '✗';
  view.packet.textContent = mark;
  view.packet.dataset.state = finished ? (result.delivered ? 'delivered' : 'stopped') : 'moving';
  view.packet.hidden = false;
  const x = target.offsetLeft + target.offsetWidth - view.packet.offsetWidth + 6;
  const y = target.offsetTop - 10;
  view.packet.style.transform = `translate(${x}px, ${y}px)`;
}

function drawResult() {
  const won = state.status === 'won' && timer === null;
  view.result.hidden = !won;
  if (!won) return;

  const level = state.level;
  const lastLevel = levelIndex === levels.length - 1;
  const earned = stars(state);

  if (lastLevel) {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', dataset: { key: 'primary' }, onclick: () => openLevel(levelIndex, true) },
      'Play again', kbd('R'));
  } else {
    view.primary = el('button', { class: 'btn btn-primary', type: 'button', dataset: { key: 'primary' }, onclick: () => openLevel(levelIndex + 1, true) },
      'Next level', kbd('N'));
  }

  put(view.result,
    el('h2', {}, 'Delivered!'),
    el('p', { class: 'stars pq-big-stars', role: 'img', 'aria-label': `${earned} of ${MAX_STARS} stars` }, starText(earned)),
    el('div', {},
      el('p', { class: 'pq-label' }, 'What happened'),
      el('p', {}, level.lesson)),
    el('div', {},
      el('p', { class: 'pq-label' }, 'What it is called'),
      el('p', {}, level.term)),
    el('div', {},
      el('p', { class: 'pq-label' }, 'The command that would have found it'),
      el('pre', { class: 'pq-command mono' }, level.command),
      el('p', { class: 'muted' }, level.reveals)),
    lastLevel ? el('p', {}, 'That was the last level. You can now read a broken path hop by hop, there and back.') : null,
    el('div', { class: 'row' }, view.primary),
    DEV ? el('pre', { class: 'dev' },
      `solution: ${JSON.stringify([...activeFixes(state), 'send'])}\nrecorded: ${JSON.stringify(recorded)}`) : null,
  );
}

// -------------------------------------------------------------------- start

function firstUnsolved() {
  const index = levels.findIndex((level) => !best[level.id]);
  return index === -1 ? 0 : index;
}

build();
openLevel(firstUnsolved(), false);
document.addEventListener('keydown', onKey);
window.addEventListener('resize', drawPacket);
ready();
