// storage.js: remember small things (best scores, last level) in the browser.
//
//   load('pod-packer:stars', {})      -> the saved value, or the fallback if there is none
//   save('pod-packer:stars', value)   -> true if it was saved
//
// Storage can be missing or blocked (private windows, strict settings), so both
// functions swallow errors. A game must still work when nothing is ever saved.
// Start every key with your game's folder name so games never collide.

const PREFIX = 'arcade:';

export function load(key, fallback) {
  try {
    const text = localStorage.getItem(PREFIX + key);
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
