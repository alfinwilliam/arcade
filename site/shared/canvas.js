// canvas.js: two helpers for games that draw on a <canvas>.
//
// The idea: you draw in fixed "logical" units (say 600 x 600) and never think about
// the real pixel size. CSS stretches the canvas to fit the page, and these helpers
// keep it sharp on high-density screens and translate pointer positions back.
//
//   const ctx = fitCanvas(canvas, 600, 600);   // then draw with ctx in 0..600 units
//   const { x, y } = pointerPos(event, canvas);  // where the pointer is, in the same units
//
// Give the canvas class="stage" (see base.css) so it scales with the page and
// touch gestures go to the game instead of scrolling.

const MAX_RATIO = 2;   // cap the pixel density: phones report 3 or more, which only costs frame rate

export function fitCanvas(canvas, width, height) {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_RATIO);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.dataset.logicalWidth = String(width);
  canvas.dataset.logicalHeight = String(height);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

export function pointerPos(event, canvas) {
  const box = canvas.getBoundingClientRect();
  const width = Number(canvas.dataset.logicalWidth) || canvas.width;
  const height = Number(canvas.dataset.logicalHeight) || canvas.height;
  return {
    x: ((event.clientX - box.left) / box.width) * width,
    y: ((event.clientY - box.top) / box.height) * height,
  };
}
