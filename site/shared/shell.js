// shell.js: what every page shares. Each page loads this file first, before its own script.
//
//   mountShell({ title })     adds the top bar (back link + title) and returns the <main> to build in
//   ready()                   call once, when the first frame is on screen
//   el(tag, props, ...kids)   small DOM builder. Text only: nothing here ever parses HTML
//   svg(tag, props, ...kids)  the same, for inline SVG elements
//   token(name)               read a colour from base.css, e.g. token('--accent'), for canvas drawing
//
// It also catches any uncaught error on the page and shows it in a red banner, so a typo
// in a data file gives you a message instead of a blank screen.

const root = document.documentElement;

// ---------------------------------------------------------------- DOM builders

function fill(node, props, kids, asAttributes) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.setAttribute('class', value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) {
        if (name.startsWith('--')) node.style.setProperty(name, v);
        else node.style[name] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!asAttributes && key in node && typeof value !== 'string') {
      node[key] = value;                         // e.g. disabled: true, hidden: true, tabIndex: 0
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : String(kid));   // strings become text, never markup
  }
  return node;
}

// el('button', { class: 'btn', onclick: go }, 'Start')
export function el(tag, props, ...kids) {
  return fill(document.createElement(tag), props, kids, false);
}

// svg('circle', { cx: 10, cy: 10, r: 4 })
export function svg(tag, props, ...kids) {
  return fill(document.createElementNS('http://www.w3.org/2000/svg', tag), props, kids, true);
}

// ------------------------------------------------------------------- colours

// token('--accent') -> '#6cb4ff'. Read it when you draw, not once at load,
// so a canvas follows the light or dark theme.
export function token(name) {
  return getComputedStyle(root).getPropertyValue(name).trim();
}

// --------------------------------------------------------------- error banner

function showError(message) {
  root.dataset.error = message;                  // tests/smoke.html looks for this
  let banner = document.getElementById('shell-error');
  if (!banner) {
    banner = el('div', { id: 'shell-error', class: 'shell-error', role: 'alert' });
    (document.body || root).prepend(banner);
  }
  banner.textContent = `Something broke: ${message}. The browser console (F12) has the file and line.`;
}

window.addEventListener('error', (event) => {
  const failedFile = event.target && event.target !== window && (event.target.src || event.target.href);
  showError(event.message || (failedFile ? `could not load ${failedFile}` : 'a file failed to load'));
}, true);

window.addEventListener('unhandledrejection', (event) => {
  showError(String((event.reason && event.reason.message) || event.reason));
});

// ------------------------------------------------------------------ page frame

// Adds the top bar and returns the <main> element. Pass home: null on the hub itself.
export function mountShell({ title = 'Arcade', home = '../../index.html' } = {}) {
  document.title = home ? `${title} · Arcade` : title;
  const bar = el('header', { class: 'shell-bar' },
    home ? el('a', { class: 'shell-home', href: home }, '← Arcade') : null,
    el('h1', { class: 'shell-title' }, title));
  let main = document.querySelector('main');
  if (!main) {
    main = el('main');
    document.body.append(main);
  }
  document.body.prepend(bar);
  return main;
}

// Call once the first frame is drawn. The smoke test waits for this flag.
export function ready() {
  root.dataset.ready = '1';
}
