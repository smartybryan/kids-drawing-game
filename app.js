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


/* ------------------------------------------------------------ save as PNG */

function savePng() {
  const svg = $('canvas').querySelector('svg').cloneNode(true);

  // Inline the styles the CSS file was providing, so the standalone copy of
  // the SVG we hand to the browser still looks right.
  svg.querySelectorAll('.region').forEach((el) => {
    el.setAttribute('fill', getColor(el));
    el.setAttribute('stroke', isBackdrop(el) ? 'none' : '#23262b');
    el.setAttribute('stroke-width', '4');
    el.setAttribute('stroke-linejoin', 'round');
    el.removeAttribute('style');
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

$('btn-back').addEventListener('click', goBack);
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', clearDrawing);
$('btn-save').addEventListener('click', savePng);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
  }
});

buildGallery();
buildPalette();
