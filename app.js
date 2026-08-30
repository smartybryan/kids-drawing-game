/* ---------------------------------------------------------------------------
 * app.js  --  picker + coloring logic.
 *
 * Fills are written to element.style.fill (an inline style) rather than the
 * fill attribute, because the .region CSS rule would otherwise win over a
 * presentation attribute and every shape would stay white.
 * ------------------------------------------------------------------------- */

const PALETTE = [
  '#e53935', '#fb8c00', '#fdd835', '#c0ca33',
  '#43a047', '#00897b', '#29b6f6', '#1e88e5',
  '#3949ab', '#8e24aa', '#ec407a', '#f8bbd0',
  '#8d6e63', '#d7ccc8', '#9e9e9e', '#ffffff'
];

const UNPAINTED = '#ffffff';

const state = {
  drawing: null,     // the DRAWINGS entry currently open
  regions: [],       // its clickable shapes, in save order (see regionsOf)
  color: PALETTE[0], // currently selected crayon
  undo: []           // [{ index, previousColor }, ...]
};

const $ = (id) => document.getElementById(id);

/* The CSSOM re-serializes colors ("#e53935" reads back as "rgb(229, 57, 53)"),
 * so the chosen color is kept verbatim in a data attribute and that is treated
 * as the source of truth everywhere below. */
function getColor(el) {
  return el.dataset.color || UNPAINTED;
}

function setColor(el, color) {
  el.dataset.color = color;
  el.style.fill = color;
}


/* ------------------------------------------------------------------ helpers */

/* Every picture gets a backdrop covering the whole viewBox, added here rather
 * than in drawings.js so new pictures pick it up for free. It is painted first,
 * so it sits behind the animal. */
function svgMarkup(drawing, extraAttrs = '') {
  const [minX, minY, width, height] = drawing.viewBox.trim().split(/\s+/).map(Number);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${drawing.viewBox}" ${extraAttrs}>
            <rect class="region backdrop" x="${minX}" y="${minY}"
                  width="${width}" height="${height}"/>
            ${drawing.svg}
          </svg>`;
}

/* Regions in the order colors are saved. The backdrop is drawn FIRST but stored
 * LAST, so every other shape keeps the index it had before the backdrop
 * existed and pictures colored earlier still load correctly. */
function regionsOf(root) {
  const all = Array.from(root.querySelectorAll('.region'));
  return all.filter((el) => !isBackdrop(el)).concat(all.filter(isBackdrop));
}

function isBackdrop(el) {
  return el.classList.contains('backdrop');
}

function storageKey(id) {
  return `kids-drawing-game:${id}`;
}

function saveColors() {
  if (!state.drawing) return;
  const colors = state.regions.map(getColor);
  try {
    localStorage.setItem(storageKey(state.drawing.id), JSON.stringify(colors));
  } catch (e) {
    /* private browsing / storage full -- colouring still works, just not saved */
  }
}

function loadColors(id) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id))) || [];
  } catch (e) {
    return [];
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}


/* ------------------------------------------------------------ picker screen */

function buildGallery() {
  const gallery = $('gallery');
  gallery.innerHTML = '';

  for (const drawing of DRAWINGS) {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.innerHTML = svgMarkup(drawing) + `<span class="card-name">${drawing.name}</span>`;

    // Thumbnails show any colors already saved for that page.
    const saved = loadColors(drawing.id);
    regionsOf(card).forEach((el, i) => {
      if (saved[i]) el.style.fill = saved[i];
      el.style.pointerEvents = 'none';
      el.style.cursor = 'inherit';
    });

    card.addEventListener('click', () => openDrawing(drawing));
    gallery.appendChild(card);
  }
}


/* ---------------------------------------------------------------- palette */

function buildPalette() {
  const palette = $('palette');
  palette.innerHTML = '';

  PALETTE.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'swatch' + (color === state.color ? ' selected' : '');
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', `Color ${color}`);

    swatch.addEventListener('click', () => {
      state.color = color;
      palette.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });

    palette.appendChild(swatch);
  });
}


/* -------------------------------------------------------------- coloring */

function openDrawing(drawing) {
  state.drawing = drawing;
  state.undo = [];

  $('canvas').innerHTML = svgMarkup(drawing);
  $('drawing-name').textContent = drawing.name;
  resetView();

  state.regions = regionsOf($('canvas'));
  const saved = loadColors(drawing.id);

  state.regions.forEach((el, index) => {
    setColor(el, saved[index] || UNPAINTED);
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('click', () => paint(el, index));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        paint(el, index);
      }
    });
  });

  refreshUndoButton();
  $('picker-screen').classList.add('hidden');
  $('color-screen').classList.remove('hidden');
}

function paint(el, index) {
  const previous = getColor(el);
  if (previous === state.color) return;

  state.undo.push({ index, previousColor: previous });
  setColor(el, state.color);

  if (!isBackdrop(el)) {               // scaling the whole background reads as a glitch
    el.classList.remove('popping');
    void el.getBoundingClientRect();   // restart the animation
    el.classList.add('popping');
  }

  refreshUndoButton();
  saveColors();
}

function undo() {
  const step = state.undo.pop();
  if (!step) return;
  setColor(state.regions[step.index], step.previousColor);
  refreshUndoButton();
  saveColors();
}

function clearDrawing() {
  state.regions.forEach((el, index) => {
    if (getColor(el) !== UNPAINTED) {
      state.undo.push({ index, previousColor: getColor(el) });
    }
    setColor(el, UNPAINTED);
  });
  refreshUndoButton();
  saveColors();
}

function refreshUndoButton() {
  $('btn-undo').disabled = state.undo.length === 0;
}

function goBack() {
  saveColors();
  buildGallery();                      // refresh thumbnails with the new colors
  $('color-screen').classList.add('hidden');
  $('picker-screen').classList.remove('hidden');
}


/* ------------------------------------------------------------- zoom & pan
 *
 * The whole <svg> is moved with a CSS transform instead of rewriting its
 * viewBox: strokes, hit testing and the pop animation all keep working as they
 * did, and the browser does the scaling on the GPU.
 *
 * Coordinates below are "stage" pixels -- the canvas content box, top-left
 * corner (0, 0), which is exactly where an unzoomed picture sits. The transform
 * is always translate(view.x, view.y) scale(view.scale) with a 0 0 origin, so
 * stage point p lands on screen at p * scale + offset.
 *
 * Panning is deliberately dead at 1x. Zoomed out, every drag is a child aiming
 * at a shape; only once the picture is bigger than its window does dragging
 * start moving the paper.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.6;   // one press of + or -
const DRAG_SLOP = 8;     // px a pointer may wander before a tap becomes a pan

const view = { scale: 1, x: 0, y: 0 };

const pointers = new Map();   // pointerId -> { x, y }  (client coords)
let pan = null;               // { id, x, y, moved } while a drag is in flight
let pinch = null;             // { distance, scale, x, y } while two fingers are down
let swallowClick = false;     // a pan just ended -- don't paint where it stopped

function stageSize() {
  const canvas = $('canvas');
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

/* Client coordinates -> stage coordinates. clientLeft/clientTop skip the border,
 * which getBoundingClientRect() includes. */
function toStage(clientX, clientY) {
  const canvas = $('canvas');
  const box = canvas.getBoundingClientRect();
  return {
    x: clientX - box.left - canvas.clientLeft,
    y: clientY - box.top - canvas.clientTop
  };
}

/* Keep the picture covering its window: no empty margins once zoomed in, and
 * centered while it is smaller than the window (which only happens at 1x). */
function clampView() {
  view.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale));

  const { width, height } = stageSize();
  const slackX = width - width * view.scale;
  const slackY = height - height * view.scale;

  view.x = slackX >= 0 ? slackX / 2 : Math.min(0, Math.max(slackX, view.x));
  view.y = slackY >= 0 ? slackY / 2 : Math.min(0, Math.max(slackY, view.y));
}

function applyView({ smooth = false } = {}) {
  clampView();

  const canvas = $('canvas');
  const svg = canvas.querySelector('svg');
  if (svg) {
    svg.classList.toggle('smooth', smooth);
    svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  canvas.classList.toggle('zoomed', view.scale > 1);

  $('btn-zoom-in').disabled = view.scale >= MAX_ZOOM - 0.001;
  $('btn-zoom-out').disabled = view.scale <= MIN_ZOOM + 0.001;
  $('btn-zoom-reset').disabled = view.scale <= MIN_ZOOM + 0.001;
  $('btn-zoom-reset').textContent = `${Math.round(view.scale * 10) / 10}×`;
}

/* Zoom by `factor`, holding the stage point under (x, y) still. */
function zoomAt(factor, x, y, options) {
  const before = view.scale;
  view.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before * factor));

  const applied = view.scale / before;
  view.x = x - (x - view.x) * applied;
  view.y = y - (y - view.y) * applied;

  applyView(options);
}

/* Zoom from the middle of the window -- what the buttons and keyboard use. */
function zoomFromCenter(factor) {
  const { width, height } = stageSize();
  zoomAt(factor, width / 2, height / 2, { smooth: true });
}

function resetView(options) {
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  applyView(options);
}

function movePan(dx, dy) {
  view.x += dx;
  view.y += dy;
  applyView();
}


/* --------------------------------------------------------- pointer gestures */

function midpoint() {
  const [a, b] = Array.from(pointers.values());
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function spread() {
  const [a, b] = Array.from(pointers.values());
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function beginPinch() {
  pan = null;
  const center = midpoint();
  pinch = { distance: spread(), scale: view.scale, x: center.x, y: center.y };
}

function onPointerDown(e) {
  if (pointers.size === 0) swallowClick = false;   // fresh gesture, fresh slate
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    beginPinch();
  } else if (pointers.size === 1 && view.scale > 1) {
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinch && pointers.size >= 2) {
    const distance = spread();
    if (!distance) return;

    const center = midpoint();
    const stage = toStage(center.x, center.y);
    const target = pinch.scale * (distance / pinch.distance);

    // Follow the fingers first (so the picture tracks a two-finger drag), then
    // scale about where they now sit.
    view.x += center.x - pinch.x;
    view.y += center.y - pinch.y;
    pinch.x = center.x;
    pinch.y = center.y;

    zoomAt(target / view.scale, stage.x, stage.y);
    return;
  }

  if (!pan || pan.id !== e.pointerId) return;

  const dx = e.clientX - pan.x;
  const dy = e.clientY - pan.y;

  if (!pan.moved) {
    if (Math.hypot(dx, dy) < DRAG_SLOP) return;
    pan.moved = true;
    swallowClick = true;
    $('canvas').classList.add('panning');
    try { $('canvas').setPointerCapture(e.pointerId); } catch (err) { /* mouse left the window */ }
  }

  pan.x = e.clientX;
  pan.y = e.clientY;
  movePan(dx, dy);
}

function onPointerUp(e) {
  pointers.delete(e.pointerId);

  if (pinch && pointers.size < 2) {
    pinch = null;
    // A pinch is never a paint, and the finger still down shouldn't yank the
    // picture from wherever the other one left it.
    swallowClick = true;
    if (pointers.size === 1) {
      const [id] = Array.from(pointers.keys());
      const point = pointers.get(id);
      pan = { id, x: point.x, y: point.y, moved: true };
    }
  }

  if (pan && pan.id === e.pointerId) {
    pan = null;
    $('canvas').classList.remove('panning');
  }
}

function onWheel(e) {
  e.preventDefault();                       // no page scroll, no browser zoom
  const stage = toStage(e.clientX, e.clientY);
  // deltaMode 1 is lines rather than pixels (Firefox); 16px is a fair line.
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  zoomAt(Math.exp(-delta * 0.0018), stage.x, stage.y);
}


/* ------------------------------------------------------------ save as PNG */

function savePng() {
  const svg = $('canvas').querySelector('svg').cloneNode(true);
  svg.style.transform = '';            // save the whole page, not the zoomed view
  svg.classList.remove('smooth');

  // Inline the styles the CSS file was providing, so the standalone copy of
  // the SVG we hand to the browser still looks right.
  svg.querySelectorAll('.region').forEach((el) => {
    el.setAttribute('fill', getColor(el));
    el.setAttribute('stroke', isBackdrop(el) ? 'none' : '#23262b');
    el.setAttribute('stroke-width', '4');
    el.setAttribute('stroke-linejoin', 'round');
    el.removeAttribute('style');
  });
  svg.querySelectorAll('.paper').forEach((el) => {
    el.setAttribute('fill', '#ffffff');
    el.setAttribute('stroke', 'none');
  });
  svg.querySelectorAll('.ink').forEach((el) => el.setAttribute('fill', '#23262b'));
  svg.querySelectorAll('.line').forEach((el) => {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', '#23262b');
    el.setAttribute('stroke-width', '4');
    el.setAttribute('stroke-linecap', 'round');
  });

  const filename = `${state.drawing.id}.png`;

  const size = 1000;
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);

  const source = new XMLSerializer().serializeToString(svg);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);

  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);

    try {
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Saved to your downloads!');
    } catch (e) {
      toast("Couldn't save this picture.");
    }
  };
  image.onerror = () => toast("Couldn't save this picture.");
  image.src = url;
}


/* ------------------------------------------------------------------- wire up */

const canvasEl = $('canvas');

canvasEl.addEventListener('pointerdown', onPointerDown);
canvasEl.addEventListener('pointermove', onPointerMove);
canvasEl.addEventListener('pointerup', onPointerUp);
canvasEl.addEventListener('pointercancel', onPointerUp);
canvasEl.addEventListener('wheel', onWheel, { passive: false });
canvasEl.addEventListener('dragstart', (e) => e.preventDefault());

/* Capture phase: a click that ends a pan must never reach the region under it. */
canvasEl.addEventListener('click', (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

window.addEventListener('resize', () => applyView());

$('btn-zoom-in').addEventListener('click', () => zoomFromCenter(ZOOM_STEP));
$('btn-zoom-out').addEventListener('click', () => zoomFromCenter(1 / ZOOM_STEP));
$('btn-zoom-reset').addEventListener('click', () => resetView({ smooth: true }));

$('btn-back').addEventListener('click', goBack);
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', clearDrawing);
$('btn-save').addEventListener('click', savePng);

const PAN_KEYS = {
  ArrowLeft:  [ 60,   0],
  ArrowRight: [-60,   0],
  ArrowUp:    [  0,  60],
  ArrowDown:  [  0, -60]
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  if ($('color-screen').classList.contains('hidden')) return;

  if (e.key === '+' || e.key === '=') {
    zoomFromCenter(ZOOM_STEP);
  } else if (e.key === '-' || e.key === '_') {
    zoomFromCenter(1 / ZOOM_STEP);
  } else if (e.key === '0') {
    resetView({ smooth: true });
  } else if (PAN_KEYS[e.key] && view.scale > 1) {
    e.preventDefault();                // arrows would otherwise scroll the page
    movePan(...PAN_KEYS[e.key]);
  }
});

buildGallery();
buildPalette();
applyView();          // starts the zoom buttons in their 1x state
