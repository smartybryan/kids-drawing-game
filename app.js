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
const BRUSHES = [3.5, 7, 15, 28];

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
  noteWork(state.drawing.id, colors.some((color) => color !== UNPAINTED));
}

function loadColors(id) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(id))) || [];
  } catch (e) {
    return [];
  }
}

/* ----------------------------------------------------- what to come back to
 *
 * The gallery is a hundred and twenty-four cards long, and a child working on
 * one picture over several sittings has to find it again every time. So the
 * pictures with work on them are repeated in a short row at the top, newest
 * first. Leaving a picture always lands back at the top of the gallery, which
 * puts the one just left under the finger that got there.
 *
 * A picture earns its place by having color on it, not by having been opened --
 * a mis-tap should not push yesterday's picture down the row -- and Start Over
 * takes it back out again.
 */
const RECENT_KEY = 'kids-drawing-game:recent';
const RECENT_KEPT = 12;             // about two rows; a longer row is a gallery again

let recent = [];                    // ids with work on them, newest first

function loadRecent() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch (e) {
    return [];
  }
}

/* Move a picture to the front of the row, or drop it if its work is gone. This
 * runs on every save, so the usual answer is to do nothing at all: the picture
 * being worked on is already at the front. */
function noteWork(id, worked) {
  if (worked ? recent[0] === id : !recent.includes(id)) return;

  recent = recent.filter((other) => other !== id);
  if (worked) recent.unshift(id);
  recent = recent.slice(0, RECENT_KEPT);

  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (e) {
    /* no room to remember it; the row is a convenience, not the work itself */
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

/* The cards of the full list, in DRAWINGS order. The gallery may hold more than
 * these -- the "keep going" row repeats a few of them, and there are headings
 * between -- so the rail counts pictures with this rather than with whatever
 * happens to be sitting in the gallery. */
let galleryCards = [];

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
  galleryCards = [];

  // the pictures with work on them, newest first, repeated above the rest
  const started = recent
    .map((id) => DRAWINGS.findIndex((drawing) => drawing.id === id))
    .filter((index) => index !== -1);

  if (started.length) {
    gallery.appendChild(galleryHeading('Keep going!'));
    started.forEach((index) => gallery.appendChild(makeCard(index)));
    gallery.appendChild(galleryHeading('All the pictures'));
  }

  DRAWINGS.forEach((drawing, index) => {
    const card = makeCard(index);
    galleryCards.push(card);
    gallery.appendChild(card);
  });

  buildJumpRail();
}

function makeCard(index) {
  const drawing = DRAWINGS[index];
  const card = document.createElement('button');
  card.className = 'card';
  card.type = 'button';
  card.dataset.drawing = index;
  card.innerHTML = `<span class="card-art"></span>` +
                   `<span class="card-name">${drawing.name}</span>`;

  card.addEventListener('click', () => openDrawing(drawing));
  if (galleryWatcher) galleryWatcher.observe(card); else drawCardArt(card);
  return card;
}

/* A full-width label between the two bands. Only there when there is something
 * to come back to -- an untouched app is one plain gallery, as it was. */
function galleryHeading(text) {
  const heading = document.createElement('h2');
  heading.className = 'gallery-heading';
  heading.textContent = text;
  return heading;
}

/* ------------------------------------------------------------- jump rail
 *
 * The gallery is over a hundred cards long, which is a lot of finger to get to
 * the bottom of. The rail down the right edge is a shortcut: every tenth
 * picture gets a number, tapping one takes the gallery there, and sliding down
 * them scrubs -- the gallery follows the finger instead of waiting for it to
 * let go.
 *
 * Nothing about it depends on how the cards are laid out, so it keeps working
 * when the columns reflow.
 */
const JUMP_EVERY = 10;

function buildJumpRail() {
  const rail = $('jump-rail');
  rail.innerHTML = '';

  // Not a picture number: the top of the gallery is above the first card, where
  // the "keep going" row is, so this one is about the scroll and not the list.
  const top = document.createElement('button');
  top.className = 'jump-tick jump-top';
  top.type = 'button';
  top.textContent = 'Top';
  top.dataset.top = '1';
  top.setAttribute('aria-label', 'Back to the top');
  rail.appendChild(top);

  for (let n = JUMP_EVERY; n <= DRAWINGS.length; n += JUMP_EVERY) {
    const tick = document.createElement('button');
    tick.className = 'jump-tick';
    tick.type = 'button';
    tick.textContent = n;
    tick.dataset.card = n - 1;                  // the number is 1-based; the row is not
    tick.setAttribute('aria-label', `Jump to picture ${n}`);
    rail.appendChild(tick);
  }
  markRail();
}

function jumpFromTick(tick, smooth) {
  if (tick.dataset.top) return jumpToTop(smooth);
  jumpToCard(Number(tick.dataset.card), smooth);
}

function jumpToTop(smooth) {
  $('gallery').scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

/* Scroll so the wanted card sits at the top of the view. Measured rather than
 * calculated: offsetTop would be relative to the screen, not to the gallery. */
function jumpToCard(index, smooth) {
  const gallery = $('gallery');
  const card = galleryCards[index];
  if (!card) return;

  const top = gallery.scrollTop +
              card.getBoundingClientRect().top - gallery.getBoundingClientRect().top;
  gallery.scrollTo({ top: Math.max(0, top - 10), behavior: smooth ? 'smooth' : 'auto' });
}

/* Which number the gallery is sitting at: the first picture of the full list
 * still showing. Measured rather than worked out from how far down the scroll
 * is, because the "keep going" row sits above the list and would throw that
 * sum out by however tall it happens to be. */
function markRail() {
  const rail = $('jump-rail');
  if (!rail.children.length || !galleryCards.length) return;

  const at = firstShowing();
  let nearest = null, bestGap = Infinity;

  for (const tick of rail.children) {
    if (tick.dataset.top) continue;
    const gap = Math.abs(Number(tick.dataset.card) - at);
    if (gap < bestGap) { bestGap = gap; nearest = tick; }
  }

  // Sitting at the very top is the one place Top is the honest answer: what is
  // on screen there is the "keep going" row, which has no number.
  if ($('gallery').scrollTop < 4) nearest = rail.firstElementChild;

  for (const tick of rail.children) tick.classList.toggle('here', tick === nearest);
}

/* A binary search, not a walk: cards later in the list are never higher up the
 * page, so seven measurements settle it instead of a hundred and twenty-four --
 * which matters when this runs on every scroll event. */
function firstShowing() {
  const top = $('gallery').getBoundingClientRect().top;
  let low = 0, high = galleryCards.length - 1, found = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (galleryCards[mid].getBoundingClientRect().bottom > top + 1) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

/* The rail is dim until the gallery moves, then bright for a moment after. */
let railTimer = null;
function showRail(hold) {
  $('jump-rail').classList.add('showing');
  clearTimeout(railTimer);
  if (!hold) railTimer = setTimeout(() => $('jump-rail').classList.remove('showing'), 1400);
}

/* Nearest tick to the finger, so the whole rail is live -- sliding between two
 * numbers still goes somewhere rather than into a gap. */
function tickNear(clientY) {
  let best = null, bestGap = Infinity;
  for (const tick of $('jump-rail').children) {
    const box = tick.getBoundingClientRect();
    const gap = Math.abs((box.top + box.bottom) / 2 - clientY);
    if (gap < bestGap) { bestGap = gap; best = tick; }
  }
  return best;
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
      armEyedropper(false);         // reaching for a crayon is not dropping
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
      armEyedropper(false);
      palette.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      showCurrentColor();
      closePalette();
    });
    palette.appendChild(swatch);
  });

  // take a color back off the page -- see the dropper section below
  const dropper = document.createElement('button');
  dropper.className = 'swatch dropper' + (eyedropper.armed ? ' armed' : '');
  dropper.type = 'button';
  dropper.id = 'btn-dropper';
  dropper.setAttribute('aria-label', 'Pick a color from the picture');
  dropper.innerHTML = DROPPER_MARK;
  dropper.addEventListener('click', (e) => { e.stopPropagation(); toggleEyedropper(); });
  palette.appendChild(dropper);

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


/* ------------------------------------------------- taking a color off the page
 *
 * Sixteen crayons and four mixed slots, and still the color wanted is often one
 * already on the picture -- the green mixed twenty strokes ago, or a shade the
 * page came with. The dropper takes it straight back: arm it, tap the color,
 * and that color is the one in hand. It is deliberately not written to a mixed
 * slot, so grabbing a color off the page never pushes one out of the box.
 */

const eyedropper = { armed: false };

const DROPPER_MARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M17.6 2.9a2.9 2.9 0 0 1 4.1 4.1l-2.4 2.4-4.1-4.1 2.4-2.4z"/>' +   // the bulb
  '<path d="M14.4 6.7l3.6 3.6"/>' +                                           // its collar
  '<path d="M16 8.3l-8.6 8.6L6 21l4.1-1.4 8.6-8.6z"/>' +                      // barrel and drip
  '</svg>';

function armEyedropper(on) {
  eyedropper.armed = on;
  $('canvas').classList.toggle('dropper-armed', on);
  $('btn-color').classList.toggle('armed', on);
  const button = $('btn-dropper');
  if (button) button.classList.toggle('armed', on);
}

function toggleEyedropper() {
  if (eyedropper.armed) return armEyedropper(false);
  armEyedropper(true);
  closeMixer();
  closePalette();                  // the picture has to be reachable to tap
  toast(isPaintPage(state.drawing) ? 'Tap some paint to grab its color!'
                                   : 'Tap a color in the picture!');
}

function useColorFromPicture(color) {
  state.color = color;
  armEyedropper(false);
  buildPalette();                  // move the ring onto that crayon, or off them all
  toast('Got it!');
}

/* On a painting page the colors are pixels on the canvas rather than shapes, so
 * the dropper reads one. Round caps leave a soft edge, so only a solid pixel
 * counts, and the search widens a few pixels -- a tap near the rim of a stroke
 * finds the color rather than a half-transparent blend of it. Nothing outside
 * a stroke answers, which is what keeps the dropper from picking up the paper.
 */
function pickFromPainting(clientX, clientY) {
  const color = sampleStroke(clientX, clientY);
  if (!color) return toast('No paint there -- try again!');
  useColorFromPicture(color);
}

function sampleStroke(clientX, clientY) {
  if (!painting.layer || !painting.ctx) return null;

  const box = painting.layer.getBoundingClientRect();
  if (!box.width || !box.height) return null;

  const perCssPixel = painting.layer.width / box.width;   // the rect is post-zoom, so this is exact
  const x = Math.round((clientX - box.left) * perCssPixel);
  const y = Math.round((clientY - box.top) * (painting.layer.height / box.height));

  const reach = Math.max(2, Math.round(perCssPixel * 4));
  const left = Math.max(0, x - reach), top = Math.max(0, y - reach);
  const right = Math.min(painting.layer.width - 1, x + reach);
  const bottom = Math.min(painting.layer.height - 1, y + reach);
  if (right < left || bottom < top) return null;

  const width = right - left + 1;
  let pixels;
  try {
    pixels = painting.ctx.getImageData(left, top, width, bottom - top + 1).data;
  } catch (e) {
    return null;                   // no reading the canvas; nothing to be done
  }

  let best = -1, bestDistance = Infinity;
  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const at = ((py - top) * width + (px - left)) * 4;
      if (pixels[at + 3] < 250) continue;               // paper, or a stroke's soft edge
      const distance = (px - x) * (px - x) + (py - y) * (py - y);
      if (distance < bestDistance) { bestDistance = distance; best = at; }
    }
  }
  if (best === -1) return null;

  const byte = (n) => n.toString(16).padStart(2, '0');
  return `#${byte(pixels[best])}${byte(pixels[best + 1])}${byte(pixels[best + 2])}`;
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
  armEyedropper(false);
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
  painting.history = [];
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
  closeConfirm();
  $('picker-screen').classList.add('hidden');
  $('color-screen').classList.remove('hidden');

  resetView();                 // needs the screen visible to measure the canvas
  if (brush) refreshPaintLayer();
}

function paint(el, index) {
  if (eyedropper.armed) return useColorFromPicture(getColor(el));

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

/* Is there anything on this page worth protecting? Confirming a Start Over on a
 * picture nobody has touched is just a question with one sensible answer. */
function hasWork() {
  if (isPaintPage(state.drawing)) return painting.strokes.length > 0;
  return state.regions.some((el) => getColor(el) !== UNPAINTED);
}

function askToClear() {
  closeToolMenu();
  if (!hasWork()) return;               // nothing to lose, nothing to ask

  const painty = isPaintPage(state.drawing);
  $('confirm-text').textContent = painty
    ? 'This clears all the painting.'
    : 'This clears all the colors.';
  $('btn-keep').textContent = painty ? 'Keep painting' : 'Keep coloring';

  $('confirm').classList.remove('hidden');
  if ($('btn-keep').focus) $('btn-keep').focus();   // the safe answer, ready for Enter
}

function closeConfirm() {
  $('confirm').classList.add('hidden');
}

function refreshUndoButton() {
  $('btn-undo').disabled = isPaintPage(state.drawing)
    ? painting.history.length === 0
    : state.undo.length === 0;
}

function goBack() {
  armEyedropper(false);
  closePalette();
  closeToolMenu();
  closeMixer();
  closeConfirm();
  if (isPaintPage(state.drawing)) savePainting(); else saveColors();
  buildGallery();                      // refresh thumbnails with the new colors
  $('color-screen').classList.add('hidden');
  $('picker-screen').classList.remove('hidden');

  /* Back to the top, where the row of pictures with work on them is -- and the
   * one just left is the first card in it.
   *
   * This has to come after the screen is shown. Emptying the gallery and
   * refilling it happens in one go, so the browser never lays out the empty
   * version and never drops the scroll itself; and a screen that is still
   * display:none has no scroll to set, so doing this any earlier is a no-op the
   * browser undoes when the gallery comes back. */
  $('gallery').scrollTop = 0;
  markRail();
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
  /* What Undo walks back. A finished stroke leaves a 'stroke' behind; Start Over
   * leaves a 'clear' holding everything it took away, so the whole picture comes
   * back in one press instead of being gone for good. */
  history: [],      // [{ type: 'stroke' } | { type: 'clear', strokes: [...] }]
  brush: 2,         // index into BRUSHES
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
  noteWork(state.drawing.id, painting.strokes.length > 0);
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
  painting.history.push({ type: 'stroke' });
  refreshUndoButton();
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
  const step = painting.history.pop();
  if (!step) return;

  if (step.type === 'clear') painting.strokes = step.strokes;   // the whole picture, back
  else painting.strokes.pop();

  refreshPaintLayer();
  refreshUndoButton();
  savePainting();
}

function clearPainting() {
  if (!painting.strokes.length) return;
  painting.history.push({ type: 'clear', strokes: painting.strokes });
  painting.strokes = [];                 // a new array, so the old one stays intact
  refreshPaintLayer();
  refreshUndoButton();
  savePainting();
}


/* ----------------------------------------------------------- brush picker */

/* The dot each button shows is drawn a little fatter than the brush really is,
 * so the thinnest one is still an easy target for a small finger. */
const BRUSH_LABELS = ['Tiny brush', 'Thin brush', 'Medium brush', 'Thick brush'];
const BRUSH_DOTS = [4, 8, 15, 22];

function buildBrushes() {
  const bar = $('brushes');
  bar.innerHTML = '';

  BRUSHES.forEach((width, index) => {
    const button = document.createElement('button');
    button.className = 'brush' + (index === painting.brush ? ' selected' : '');
    button.type = 'button';
    button.setAttribute('aria-label', BRUSH_LABELS[index] || 'Brush');

    const dot = document.createElement('span');
    const size = BRUSH_DOTS[index] || 6;
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
    if (eyedropper.armed) return pickFromPainting(e.clientX, e.clientY);
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


/* ------------------------------------------------------- getting an update
 *
 * Added to a home screen this app runs without browser chrome: no address bar,
 * no reload button, no pull-to-refresh. A new version put on the server can
 * therefore sit unseen behind the copy the device has cached, and there is no
 * way in from outside. Hence a refresh of our own.
 *
 * location.reload() would not do it -- that request is answered out of the very
 * cache holding the old copy. Loading an address the device has never fetched
 * has to go to the network, and the index.html that comes back carries the
 * current ?v= stamps, so the script and the stylesheet follow it down.
 */
const FRESH_KEY = 'fresh';

function refreshApp() {
  closeToolMenu();
  if (state.drawing) {                  // the reload keeps every color; save first anyway
    if (isPaintPage(state.drawing)) savePainting(); else saveColors();
  }
  const here = location.href.split('#')[0].split('?')[0];
  location.replace(`${here}?${FRESH_KEY}=${Date.now()}`);
}

/* Arriving on the busted address fixes this visit only: the home screen icon
 * still points at the plain one, and the device still has the old page stored
 * under it. Asking for that address again with cache: 'reload' goes to the
 * network AND replaces what is stored, so the next launch starts new too.
 *
 * Then the marker comes off the address, leaving the app back at its own URL. */
function settleAfterRefresh() {
  if (!new URLSearchParams(location.search).has(FRESH_KEY)) return;

  try {
    fetch(location.pathname, { cache: 'reload' }).catch(() => {});
    history.replaceState(null, '', location.pathname);
  } catch (e) {
    /* an old browser, or a page opened straight off disk -- either way this
     * visit is already the fresh one, which was the point */
  }
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

/* ------------------------------------------------------------ the jump rail */

$('gallery').addEventListener('scroll', () => { showRail(); markRail(); }, { passive: true });

/* One handler for tapping a number and for sliding down them: a tap is just a
 * scrub that ended where it started. Sliding jumps outright rather than gliding,
 * because a smooth scroll per finger-move would be a queue of animations racing
 * the finger. */
let railDrag = false;

$('jump-rail').addEventListener('pointerdown', (e) => {
  const tick = tickNear(e.clientY);
  if (!tick) return;
  e.preventDefault();
  railDrag = true;
  try { $('jump-rail').setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  showRail(true);
  jumpFromTick(tick, false);
  markRail();
});

$('jump-rail').addEventListener('pointermove', (e) => {
  if (!railDrag) return;
  const tick = tickNear(e.clientY);
  if (!tick) return;
  jumpFromTick(tick, false);
  markRail();
});

['pointerup', 'pointercancel'].forEach((type) =>
  $('jump-rail').addEventListener(type, () => {
    if (!railDrag) return;
    railDrag = false;
    showRail();                      // let it fade again now the finger is off
  }));

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
$('btn-clear').addEventListener('click', askToClear);
$('btn-keep').addEventListener('click', closeConfirm);
$('btn-confirm-clear').addEventListener('click', () => {
  closeConfirm();
  clearDrawing();
});

/* Tapping the dimmed area behind the card is a no, like tapping Keep. */
$('confirm').addEventListener('click', (e) => {
  if (e.target === $('confirm')) closeConfirm();
});
$('btn-save').addEventListener('click', savePng);
$('btn-refresh').addEventListener('click', refreshApp);
$('btn-refresh-bar').addEventListener('click', refreshApp);

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

  if (e.key === 'Escape') {
    armEyedropper(false);
    closePalette(); closeToolMenu(); closeMixer(); closeConfirm();
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

settleAfterRefresh();

mixer.colors = loadCustomColors();
recent = loadRecent();

buildGallery();
showRail();           // one look at the rail on the way in, so it is not a secret
buildPalette();
buildBrushes();
applyView();          // starts the zoom buttons in their 1x state
