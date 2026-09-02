/* ---------------------------------------------------------------------------
 * app.js  --  picker + coloring logic.
 *
 * A page works one of two ways, chosen by `mode` on the drawing entry. The
 * default is flood fill: tap a shape, it takes the current color. A page marked
 * mode: 'paint' instead gets a brush -- see the painting section below.
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

/* Brush widths in drawing units, so they look the same on every picture and on
 * every screen. The pictures are 400 units across. */
const BRUSHES = [7, 15, 28];

const isPaintPage = (drawing) => Boolean(drawing) && drawing.mode === 'paint';

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
  // A painting page gets no backdrop: it sits above the paint layer, so an
  // opaque rectangle there would hide every brush stroke.
  const backdrop = isPaintPage(drawing) ? '' :
    `<rect class="region backdrop" x="${minX}" y="${minY}" width="${width}" height="${height}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${drawing.viewBox}" ${extraAttrs}>
            ${backdrop}
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

/* Drawing a hundred-odd pictures the moment the gallery opens is a lot of work
 * to throw at a tablet, and most of them are below the fold. Each card gets its
 * size straight away (the art box is square, so nothing jumps) and its picture
 * only when it is nearly on screen. */
let galleryWatcher = null;

function buildGallery() {
  const gallery = $('gallery');
  if (galleryWatcher) galleryWatcher.disconnect();
  galleryWatcher = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries, watcher) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          watcher.unobserve(entry.target);
          drawCardArt(entry.target);
        }
      }, { root: gallery, rootMargin: '400px' })
    : null;

  gallery.innerHTML = '';

  DRAWINGS.forEach((drawing, index) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.drawing = index;
    card.innerHTML = `<span class="card-art"></span>` +
                     `<span class="card-name">${drawing.name}</span>`;

    card.addEventListener('click', () => openDrawing(drawing));
    gallery.appendChild(card);

    if (galleryWatcher) galleryWatcher.observe(card); else drawCardArt(card);
  });
}

/* Fill in one card's picture, with whatever work has already been saved on it. */
function drawCardArt(card) {
  const drawing = DRAWINGS[Number(card.dataset.drawing)];
  if (!drawing) return;

  const art = card.querySelector('.card-art');
  if (!art || art.dataset.drawn) return;
  art.dataset.drawn = '1';

  const brush = isPaintPage(drawing);
  art.innerHTML = `${brush ? '<canvas width="300" height="300"></canvas>' : ''}` +
                  `${svgMarkup(drawing)}` +
                  `${brush ? '<span class="card-badge">&#128396;</span>' : ''}`;

  if (brush) {
    const [, , vbWidth] = drawing.viewBox.trim().split(/\s+/).map(Number);
    const thumb = art.querySelector('canvas');
    replayStrokes(thumb.getContext('2d'), loadPainting(drawing.id),
                  thumb.width / vbWidth, drawing.viewBox);
  } else {
    const saved = loadColors(drawing.id);
    regionsOf(art).forEach((el, i) => {
      if (saved[i]) el.style.fill = saved[i];
      el.style.pointerEvents = 'none';
      el.style.cursor = 'inherit';
    });
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
      showCurrentColor();
      closePalette();               // a choice made is a sheet done with
    });

    palette.appendChild(swatch);
  });

  // the colors this child mixed, kept next to the fixed crayons
  mixer.colors.forEach((color) => {
    if (!color) return;
    const swatch = document.createElement('button');
    swatch.className = 'swatch' + (color === state.color ? ' selected' : '');
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', `Color ${color}`);
    swatch.addEventListener('click', () => {
      state.color = color;
      palette.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      showCurrentColor();
      closePalette();
    });
    palette.appendChild(swatch);
  });

  const mix = document.createElement('button');
  mix.className = 'swatch mix';
  mix.type = 'button';
  mix.id = 'btn-mix';
  mix.setAttribute('aria-label', 'Mix a color');
  mix.addEventListener('click', (e) => { e.stopPropagation(); openMixer(); });
  palette.appendChild(mix);

  showCurrentColor();
}

/* The collapsed picker doubles as the indicator of what is in use, which is the
 * job the open palette was doing by showing which swatch is selected. */
function showCurrentColor() {
  $('btn-color').style.background = state.color;
}

function openPalette() {
  $('palette').classList.add('open');
  $('btn-color').setAttribute('aria-expanded', 'true');
}

function closePalette() {
  $('palette').classList.remove('open');
  $('btn-color').setAttribute('aria-expanded', 'false');
}

function togglePalette() {
  if ($('palette').classList.contains('open')) closePalette(); else openPalette();
}

function closeToolMenu() {
  $('tool-menu').classList.remove('open');
  $('btn-more').setAttribute('aria-expanded', 'false');
}

function toggleToolMenu() {
  const open = $('tool-menu').classList.toggle('open');
  $('btn-more').setAttribute('aria-expanded', open ? 'true' : 'false');
}


/* ----------------------------------------------------------- mixing colors
 *
 * Hue runs around the wheel and saturation outwards from the middle; the strip
 * under it sets brightness. The strip matters more than it looks: without it
 * there is no brown, no skin tone and no dark green, which is most of what an
 * animal wants.
 *
 * Four mixed colors are kept, and they sit in the palette next to the fixed
 * crayons so a color a child made is one tap away afterwards. Mixing a fifth
 * would have to evict one, so the slot about to be overwritten is ringed and
 * can be re-aimed by tapping a different one -- nothing disappears by surprise.
 */

const CUSTOM_SLOTS = 4;

const mixer = {
  colors: new Array(CUSTOM_SLOTS).fill(null),   // one per slot; null means empty
  target: 0,         // which slot the next pick lands in
  hue: 0,
  saturation: 1,
  value: 1
};

const CUSTOM_KEY = 'kids-drawing-game:custom-colors';

/* Always four entries, empty ones held as null. Keeping the shape means a color
 * put in the third slot is still in the third slot tomorrow; filtering the empty
 * ones out would quietly shuffle everything left on the next visit. */
function loadCustomColors() {
  const slots = new Array(CUSTOM_SLOTS).fill(null);
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY));
    if (Array.isArray(saved)) {
      saved.slice(0, CUSTOM_SLOTS).forEach((color, i) => {
        if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) slots[i] = color;
      });
    }
  } catch (e) {
    /* nothing saved, or nothing readable */
  }
  return slots;
}

function saveCustomColors() {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(mixer.colors));
  } catch (e) {
    /* nothing to be done; the colors just won't outlive the tab */
  }
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const byte = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;

  let hue = 0;
  if (span) {
    if (max === r) hue = 60 * (((g - b) / span) % 6);
    else if (max === g) hue = 60 * ((b - r) / span + 2);
    else hue = 60 * ((r - g) / span + 4);
  }
  return { hue: (hue + 360) % 360, saturation: max ? span / max : 0, value: max };
}

/* Where a tap on the wheel lands, in hue and saturation. Past the rim it clamps
 * rather than missing, so a fat fingertip on the edge still picks that color. */
function wheelColorAt(x, y, size) {
  const radius = size / 2;
  const dx = (x - radius) / radius;
  const dy = (y - radius) / radius;
  const distance = Math.hypot(dx, dy);
  return {
    hue: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
    saturation: Math.min(1, distance)
  };
}

function drawWheel() {
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const image = ctx.createImageData(size, size);
  const pixels = image.data;
  const radius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - radius) / radius, dy = (y - radius) / radius;
      const distance = Math.hypot(dx, dy);
      const at = (y * size + x) * 4;
      if (distance > 1) { pixels[at + 3] = 0; continue; }

      const hex = hsvToHex((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, distance, mixer.value);
      pixels[at] = parseInt(hex.slice(1, 3), 16);
      pixels[at + 1] = parseInt(hex.slice(3, 5), 16);
      pixels[at + 2] = parseInt(hex.slice(5, 7), 16);
      pixels[at + 3] = distance > 0.97 ? Math.round((1 - distance) / 0.03 * 255) : 255;  // soft rim
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawBrightness() {
  const canvas = $('brightness');
  const ctx = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  for (let x = 0; x < width; x++) {
    ctx.fillStyle = hsvToHex(mixer.hue, mixer.saturation, x / (width - 1));
    ctx.fillRect(x, 0, 1, height);
  }
}

function currentMix() {
  return hsvToHex(mixer.hue, mixer.saturation, mixer.value);
}

/* Put the mixed color in the ringed slot and select it. While a finger is still
 * sliding around the wheel this only touches what is on screen; the write to
 * storage and the palette rebuild wait for the finger to come up, since doing
 * either per pointer-move would be dozens of times a second for nothing. */
function applyMix(commit) {
  const color = currentMix();
  mixer.colors[mixer.target] = color;
  state.color = color;
  showCurrentColor();
  $('mix-preview').style.background = color;

  const slot = $('mix-slots').children[mixer.target];
  if (slot) {
    slot.style.background = color;
    slot.classList.remove('empty');
  }

  if (commit) {
    saveCustomColors();
    buildPalette();
  }
}

function buildMixSlots() {
  const row = $('mix-slots');
  row.innerHTML = '';

  for (let slot = 0; slot < CUSTOM_SLOTS; slot++) {
    const color = mixer.colors[slot];
    const button = document.createElement('button');
    button.className = 'swatch' + (color ? '' : ' empty') + (slot === mixer.target ? ' target' : '');
    button.type = 'button';
    if (color) button.style.background = color;
    button.setAttribute('aria-label', color ? `Replace ${color}` : 'Empty slot');

    button.addEventListener('click', () => {
      mixer.target = slot;
      // Move the ring by hand rather than rebuilding the row. Rebuilding would
      // throw away the element that was just clicked, and a click on a detached
      // node reads as a click outside the mixer -- which used to close it.
      row.querySelectorAll('.swatch').forEach((s) => s.classList.remove('target'));
      button.classList.add('target');

      // A slot that already holds a color loads back into the wheel, so it can
      // be nudged rather than mixed again from scratch.
      const held = mixer.colors[slot];
      if (held) {
        const at = hexToHsv(held);
        mixer.hue = at.hue;
        mixer.saturation = at.saturation;
        mixer.value = at.value;
        state.color = held;
        showCurrentColor();
        $('mix-preview').style.background = held;
        drawWheel();
        drawBrightness();
      }
    });

    row.appendChild(button);
  }
}

function openMixer() {
  // aim at the first empty slot so the easy path never overwrites a kept color
  const empty = mixer.colors.findIndex((color) => !color);
  mixer.target = empty === -1 ? 0 : empty;

  $('mixer').classList.remove('hidden');
  $('palette').classList.remove('open');
  $('mix-preview').style.background = currentMix();
  buildMixSlots();
  drawWheel();
  drawBrightness();
}

function closeMixer() {
  $('mixer').classList.add('hidden');
}


/* -------------------------------------------------------------- coloring */

function openDrawing(drawing) {
  state.drawing = drawing;
  state.undo = [];
  state.regions = [];
  painting.strokes = [];
  painting.active = null;
  painting.layer = null;
  painting.ctx = null;

  const brush = isPaintPage(drawing);
  const canvas = $('canvas');
  canvas.classList.toggle('paint-mode', brush);
  canvas.classList.toggle('fill-mode', !brush);
  canvas.innerHTML = `<div class="stage">${brush ? '<canvas class="paint-layer"></canvas>' : ''}` +
                     `${svgMarkup(drawing)}</div>`;
  $('drawing-name').textContent = drawing.name;
  $('brushes').classList.toggle('hidden', !brush);

  if (brush) {
    painting.layer = canvas.querySelector('.paint-layer');
    painting.ctx = painting.layer.getContext('2d');
    painting.strokes = loadPainting(drawing.id);
  } else {
    state.regions = regionsOf(canvas);
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
  }

  refreshUndoButton();
  $('picker-screen').classList.add('hidden');
  $('color-screen').classList.remove('hidden');

  resetView();                 // needs the screen visible to measure the canvas
  if (brush) refreshPaintLayer();
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
  if (isPaintPage(state.drawing)) return undoStroke();
  const step = state.undo.pop();
  if (!step) return;
  setColor(state.regions[step.index], step.previousColor);
  refreshUndoButton();
  saveColors();
}

function clearDrawing() {
  if (isPaintPage(state.drawing)) return clearPainting();
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
  $('btn-undo').disabled = isPaintPage(state.drawing)
    ? painting.strokes.length === 0
    : state.undo.length === 0;
}

function goBack() {
  closePalette();
  closeToolMenu();
  closeMixer();
  if (isPaintPage(state.drawing)) savePainting(); else saveColors();
  buildGallery();                      // refresh thumbnails with the new colors
  $('color-screen').classList.add('hidden');
  $('picker-screen').classList.remove('hidden');
}


/* -------------------------------------------------------------- painting
 *
 * A painting page keeps the child's work as a list of strokes rather than as
 * pixels: each stroke is a color, a width, and a run of points in the picture's
 * own 0..400 coordinate space. Everything falls out of that one decision --
 * undo is dropping the last stroke and drawing the rest again, saving is a
 * short bit of JSON, and the same strokes redraw crisply at any zoom, on any
 * screen, because nothing was ever committed to a particular pixel grid.
 *
 * The strokes go on a <canvas> UNDER the outlines, so paint can wander outside
 * a line but can never cover one. No clipping, no masking, no hit testing.
 */

const painting = {
  strokes: [],      // [{ color, width, points: [x, y, x, y, ...] }]
  active: null,     // the stroke being drawn right now
  brush: 1,         // index into BRUSHES
  layer: null,      // the <canvas>
  ctx: null
};

function paintKey(id) {
  return `kids-drawing-game:paint:${id}`;
}

function savePainting() {
  if (!state.drawing) return;
  try {
    localStorage.setItem(paintKey(state.drawing.id), JSON.stringify(painting.strokes));
  } catch (e) {
    /* out of room or private browsing -- painting still works, it just won't keep */
  }
}

function loadPainting(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(paintKey(id)));
    return Array.isArray(saved) ? saved : [];
  } catch (e) {
    return [];
  }
}

/* Where the picture actually sits inside the canvas box.
 *
 * The box is not reliably square: it asks for a 1:1 aspect ratio but also for
 * full height, and on a tall phone the width gets clamped while the height
 * stands, so the box comes out taller than it is wide. The SVG then does what
 * SVGs do -- scales the picture to fit and centres it, leaving a band above and
 * below. Everything that converts between the screen and the picture has to go
 * through the same fit, or strokes land somewhere other than the finger. */
function pictureFit() {
  const box = stageSize();
  const [, , vbWidth, vbHeight] = state.drawing.viewBox.trim().split(/\s+/).map(Number);
  const scale = Math.min((box.width || 1) / vbWidth, (box.height || 1) / vbHeight);
  return {
    scale,
    left: ((box.width || 0) - vbWidth * scale) / 2,
    top: ((box.height || 0) - vbHeight * scale) / 2
  };
}

/* Where a stroke lands in the picture's own coordinates: undo the zoom
 * transform, then the fit of the picture into the canvas box. */
function toDrawing(clientX, clientY) {
  const stage = toStage(clientX, clientY);
  const [minX, minY] = state.drawing.viewBox.trim().split(/\s+/).map(Number);
  const fit = pictureFit();
  return {
    x: minX + ((stage.x - view.x) / view.scale - fit.left) / fit.scale,
    y: minY + ((stage.y - view.y) / view.scale - fit.top) / fit.scale
  };
}

/* Draw the strokes onto any context, given how many device pixels one drawing
 * unit is worth. Used for the page itself, the gallery thumbnails and the PNG. */
function replayStrokes(ctx, strokes, scale, viewBox, offsetX = 0, offsetY = 0) {
  const [minX, minY, vbWidth, vbHeight] = viewBox.trim().split(/\s+/).map(Number);
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offsetX - minX * scale, offsetY - minY * scale);

  // Keep paint on the picture. On a tall screen the canvas box is taller than
  // the picture, and a stroke wandering into the band beside it would show on
  // screen but be missing from the saved PNG, which crops to the picture.
  if (ctx.clip) {
    ctx.beginPath();
    ctx.rect(minX, minY, vbWidth, vbHeight);
    ctx.clip();
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    const points = stroke.points;
    if (!points || points.length < 2) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;

    if (points.length === 2) {                 // a tap: a single round dab
      ctx.beginPath();
      ctx.arc(points[0], points[1], stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
  }
  ctx.restore();
}

/* How the live paint layer maps a drawing unit onto its backing store: the same
 * fit the SVG uses, scaled up by however many device pixels the store holds per
 * CSS pixel. */
function paintTransform() {
  const box = stageSize();
  const perCssPixel = box.width ? painting.layer.width / box.width : 1;
  const fit = pictureFit();
  return {
    scale: fit.scale * perCssPixel,
    offsetX: fit.left * perCssPixel,
    offsetY: fit.top * perCssPixel
  };
}

/* Size the canvas to the zoom it is being viewed at, so brushwork stays sharp
 * when a child zooms in, then draw everything again. */
function refreshPaintLayer() {
  if (!painting.layer) return;
  const box = stageSize();
  if (!box.width || !box.height) return;

  const dpr = window.devicePixelRatio || 1;
  const sharpness = Math.min(4, Math.max(1, view.scale));
  const width = Math.round(box.width * dpr * sharpness);
  const height = Math.round(box.height * dpr * sharpness);

  if (painting.layer.width !== width || painting.layer.height !== height) {
    painting.layer.width = width;
    painting.layer.height = height;
  }
  const at = paintTransform();
  painting.ctx.setTransform(1, 0, 0, 1, 0, 0);
  painting.ctx.clearRect(0, 0, width, height);
  replayStrokes(painting.ctx, painting.strokes, at.scale, state.drawing.viewBox,
                at.offsetX, at.offsetY);
}

/* A two-finger gesture always starts as one finger down, so the first finger of
 * a pinch has already begun painting by the time the second arrives. Within this
 * long, the mark is taken back rather than kept: the child was reaching to pan,
 * not to paint. A stroke that has been going longer than this was deliberate, so
 * resting a second finger on the screen mid-stroke does not destroy it. */
const STROKE_GRACE_MS = 300;

function beginStroke(clientX, clientY) {
  const at = toDrawing(clientX, clientY);
  painting.active = {
    color: state.color,
    width: BRUSHES[painting.brush],
    startedAt: Date.now(),
    points: [round1(at.x), round1(at.y)]
  };
  painting.strokes.push(painting.active);
  drawActiveTail();
  refreshUndoButton();
}

function extendStroke(clientX, clientY) {
  if (!painting.active) return;
  const at = toDrawing(clientX, clientY);
  const points = painting.active.points;
  const dx = at.x - points[points.length - 2], dy = at.y - points[points.length - 1];
  if (Math.hypot(dx, dy) < 1.2) return;        // skip points too close to matter
  points.push(round1(at.x), round1(at.y));
  drawActiveTail();
}

function endStroke() {
  if (!painting.active) return;
  delete painting.active.startedAt;      // not worth storing
  painting.active = null;
  savePainting();
}

/* Called when a second finger lands: undo the stroke if it was only the opening
 * of a pinch, otherwise leave the finished stroke alone. */
function abandonStrokeForGesture() {
  const stroke = painting.active;
  if (!stroke) return;

  if (Date.now() - stroke.startedAt >= STROKE_GRACE_MS) return endStroke();

  const at = painting.strokes.indexOf(stroke);
  if (at !== -1) painting.strokes.splice(at, 1);
  painting.active = null;
  refreshPaintLayer();
  refreshUndoButton();
  savePainting();
}

/* Draw only the newest segment, so a long stroke does not get slower as it
 * grows. The full replay is for undo, zoom and resize. */
function drawActiveTail() {
  const stroke = painting.active;
  if (!painting.ctx || !stroke) return;
  const points = stroke.points;
  const at = paintTransform();
  const tail = points.length >= 4 ? points.slice(-4) : points.slice(-2);
  replayStrokes(painting.ctx, [{ color: stroke.color, width: stroke.width, points: tail }],
                at.scale, state.drawing.viewBox, at.offsetX, at.offsetY);
}

const round1 = (v) => Math.round(v * 10) / 10;

function undoStroke() {
  if (!painting.strokes.length) return;
  painting.strokes.pop();
  refreshPaintLayer();
  refreshUndoButton();
  savePainting();
}

function clearPainting() {
  if (!painting.strokes.length) return;
  painting.strokes = [];
  refreshPaintLayer();
  refreshUndoButton();
  savePainting();
}


/* ----------------------------------------------------------- brush picker */

function buildBrushes() {
  const bar = $('brushes');
  bar.innerHTML = '';

  BRUSHES.forEach((width, index) => {
    const button = document.createElement('button');
    button.className = 'brush' + (index === painting.brush ? ' selected' : '');
    button.type = 'button';
    button.setAttribute('aria-label', ['Thin brush', 'Medium brush', 'Thick brush'][index] || 'Brush');

    const dot = document.createElement('span');
    const size = 6 + index * 8;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    button.appendChild(dot);

    button.addEventListener('click', () => {
      painting.brush = index;
      bar.querySelectorAll('.brush').forEach((b) => b.classList.remove('selected'));
      button.classList.add('selected');
    });

    bar.appendChild(button);
  });
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
  const stage = canvas.querySelector('.stage');
  if (stage) {
    stage.classList.toggle('smooth', smooth);
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }
  schedulePaintRefresh();

  canvas.classList.toggle('zoomed', view.scale > 1);
  $('pan-pad').classList.toggle('hidden', view.scale <= 1);
  if (view.scale <= 1) stopPanning();

  $('btn-zoom-in').disabled = view.scale >= MAX_ZOOM - 0.001;
  $('btn-zoom-out').disabled = view.scale <= MIN_ZOOM + 0.001;
  $('btn-zoom-reset').disabled = view.scale <= MIN_ZOOM + 0.001;
  $('btn-zoom-reset').textContent = `${Math.round(view.scale * 10) / 10}×`;
}

/* Re-rendering brushwork on every frame of a pinch would stutter, and it is only
 * the final zoom that has to look sharp, so coalesce to one redraw. */
let paintRefreshTimer = null;
function schedulePaintRefresh() {
  if (!painting.layer) return;
  clearTimeout(paintRefreshTimer);
  paintRefreshTimer = setTimeout(refreshPaintLayer, 120);
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


/* ------------------------------------------------------------- the pan pad */

const PAN_DIRECTIONS = {              // which way the picture slides under the window
  up:    [0, 1],
  down:  [0, -1],
  left:  [1, 0],
  right: [-1, 0]
};
const PAN_SPEED = 9;                  // stage pixels per frame while held

let panHeld = null;
let panFrame = null;

function startPanning(direction) {
  const step = PAN_DIRECTIONS[direction];
  if (!step) return;
  panHeld = step;
  if (panFrame !== null) return;

  const tick = () => {
    if (!panHeld) { panFrame = null; return; }
    movePan(panHeld[0] * PAN_SPEED, panHeld[1] * PAN_SPEED);
    panFrame = requestAnimationFrame(tick);
  };
  panFrame = requestAnimationFrame(tick);
}

function stopPanning() {
  panHeld = null;
  if (panFrame !== null) { cancelAnimationFrame(panFrame); panFrame = null; }
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
    abandonStrokeForGesture();   // a second finger means pinch, not paint
    beginPinch();
    return;
  }
  if (pointers.size !== 1) return;

  // On a painting page one finger always paints, so panning moves to two
  // fingers; on a fill page a drag still pans once the picture is zoomed in.
  if (isPaintPage(state.drawing)) {
    try { $('canvas').setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    beginStroke(e.clientX, e.clientY);
  } else if (view.scale > 1) {
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (painting.active && pointers.size === 1) {
    extendStroke(e.clientX, e.clientY);
    return;
  }

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
  endStroke();

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
  svg.removeAttribute('style');        // save the whole page, not the zoomed view
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

    // Same order as on screen: paint first, outlines over the top of it.
    if (isPaintPage(state.drawing)) {
      const [, , vbWidth] = state.drawing.viewBox.trim().split(/\s+/).map(Number);
      replayStrokes(ctx, painting.strokes, size / vbWidth, state.drawing.viewBox);
    }
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

window.addEventListener('resize', () => { applyView(); schedulePaintRefresh(); });

$('pan-pad').querySelectorAll('.pan-btn').forEach((button) => {
  const direction = button.dataset.pan;
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();                 // no text selection, no ghost click
    button.setPointerCapture(e.pointerId);
    startPanning(direction);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) =>
    button.addEventListener(type, stopPanning));
  button.addEventListener('contextmenu', (e) => e.preventDefault());
});

window.addEventListener('blur', stopPanning);   // a held button with the tab gone would run forever

/* Both surfaces track a finger while it is down, so a child can slide around
 * hunting for a shade instead of tapping repeatedly. */
function trackPicker(canvas, onPick) {
  const pickFrom = (e, commit) => {
    const box = canvas.getBoundingClientRect();
    onPick((e.clientX - box.left) * (canvas.width / box.width),
           (e.clientY - box.top) * (canvas.height / box.height), commit);
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    canvas.dataset.picking = '1';
    pickFrom(e, false);
  });
  canvas.addEventListener('pointermove', (e) => { if (canvas.dataset.picking) pickFrom(e, false); });
  ['pointerup', 'pointercancel'].forEach((type) =>
    canvas.addEventListener(type, (e) => {
      if (!canvas.dataset.picking) return;
      delete canvas.dataset.picking;
      pickFrom(e, true);                 // the finger lifted: now keep it
    }));
}

trackPicker($('wheel'), (x, y, commit) => {
  const at = wheelColorAt(x, y, $('wheel').width);
  mixer.hue = at.hue;
  mixer.saturation = at.saturation;
  drawBrightness();
  applyMix(commit);
});

trackPicker($('brightness'), (x, y, commit) => {
  const width = $('brightness').width;
  mixer.value = Math.min(1, Math.max(0, x / (width - 1)));
  drawWheel();
  applyMix(commit);
});

/* Only Done, Escape, or a tap outside closes the mixer. Anything inside it --
 * the wheel, the strip, a slot -- is part of choosing a color. */
$('mixer').addEventListener('click', (e) => e.stopPropagation());

$('btn-mix-done').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMixer();
  closePalette();
});

$('btn-color').addEventListener('click', (e) => {
  e.stopPropagation();               // the document handler below would close it again
  togglePalette();
});

$('btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleToolMenu();
});

/* Anything opened over the picture closes again on the next tap elsewhere. */
document.addEventListener('click', (e) => {
  if ($('palette').classList.contains('open') &&
      !$('palette').contains(e.target) && !$('btn-color').contains(e.target)) {
    closePalette();
  }
  if ($('tool-menu').classList.contains('open') && !$('btn-more').contains(e.target)) {
    closeToolMenu();
  }
  if (!$('mixer').classList.contains('hidden') && !$('mixer').contains(e.target)) {
    closeMixer();
  }
});

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

  if (e.key === 'Escape') { closePalette(); closeToolMenu(); closeMixer(); }
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

mixer.colors = loadCustomColors();

buildGallery();
buildPalette();
buildBrushes();
applyView();          // starts the zoom buttons in their 1x state
