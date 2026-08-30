#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * import-svg-sheet.js  --  turn a sheet of clip art animals into coloring pages.
 *
 * Written for sheets like "Cute Animal Coloring Pages for Kids.svg": one
 * top-level <g> per animal, every path filled black, no strokes and no
 * transforms. Art like that is built the opposite way round from a coloring
 * page -- the whole animal is one black path, and it only *reads* as outlines
 * because its subpaths alternate winding: an outer contour painted black, then
 * a contour wound the other way that punches the animal back out of it.
 *
 * That winding is the whole trick. A subpath wound against the silhouette is an
 * area the artist left blank, which is exactly what a child colors in, so the
 * colorable shapes can be picked out by signed area rather than by eye. Sorting
 * them largest first also gives the right paint order for free: a shape nested
 * inside another is always the smaller of the two.
 *
 * Usage:
 *
 *   node tools/import-svg-sheet.js <sheet.svg> --list
 *       What is in the sheet: one line per <g>, with how many shapes each would
 *       give. Start here -- the groups have no names, only positions.
 *
 *   node tools/import-svg-sheet.js <sheet.svg> --group 7 --preview /tmp/e.svg
 *       Write a standalone SVG of that group with every colorable shape in a
 *       different color. Open it to check the split looks sane and to see what
 *       animal you are actually looking at.
 *
 *   node tools/import-svg-sheet.js <sheet.svg> --group 7 --id elephant --name Elephant
 *       Print the finished drawings.js entry on stdout. Read it, then paste it
 *       into the DRAWINGS array yourself -- this tool deliberately never writes
 *       to drawings.js, because pasting over an existing entry is an easy way to
 *       lose a page.
 *
 * Options:
 *   --min-share N   ignore blank shapes smaller than this fraction of the
 *                   silhouette (default 0.0008). Below roughly 0.0008 you start
 *                   picking up the white glint in an eye.
 *   --pad N         margin around the animal, in grid units (default 14).
 * ------------------------------------------------------------------------- */

'use strict';

const fs = require('fs');

const GRID = 400;                    // the book's coordinate space: 0 0 400 400
const WRAP = 92;                     // wrap path data at this column


/* --------------------------------------------------------------- path data */

/* A character scanner rather than a token regex, because path data has two
 * traps a regex walks straight into:
 *
 *   "-1.71.39"   is two numbers, -1.71 and .39. A number ends at its second
 *                dot, and exporters lean on that to save bytes.
 *   "a5 5 0 011 10"  the two arc flags are single characters and may be run
 *                together with each other and with the number after them.
 *
 * Both parse as something plausible if you tokenize naively, which is worse
 * than failing: the shape just comes out subtly wrong. */
function scanner(d) {
  let i = 0;
  const sep = () => { while (i < d.length && (d[i] === ' ' || d[i] === ',' || d[i] === '\n' ||
                                              d[i] === '\r' || d[i] === '\t')) i++; };
  return {
    done() { sep(); return i >= d.length; },
    peekCommand() { sep(); return i < d.length && /[A-Za-z]/.test(d[i]) ? d[i] : null; },
    takeCommand() { sep(); return d[i++]; },
    number() {
      sep();
      const start = i;
      if (d[i] === '+' || d[i] === '-') i++;
      let dot = false;
      while (i < d.length) {
        const c = d[i];
        if (c >= '0' && c <= '9') { i++; continue; }
        if (c === '.' && !dot) { dot = true; i++; continue; }   // a second dot starts a new number
        break;
      }
      if ((d[i] === 'e' || d[i] === 'E') && /[\d+-]/.test(d[i + 1] || '')) {
        i++;
        if (d[i] === '+' || d[i] === '-') i++;
        while (i < d.length && d[i] >= '0' && d[i] <= '9') i++;
      }
      const text = d.slice(start, i);
      if (!text || text === '-' || text === '+' || text === '.') {
        throw new Error(`bad number in path data near "${d.slice(start, start + 24)}"`);
      }
      return parseFloat(text);
    },
    flag() {                                     // arc flags: exactly one character
      sep();
      const c = d[i++];
      if (c !== '0' && c !== '1') throw new Error(`bad arc flag "${c}" in path data`);
      return c === '1' ? 1 : 0;
    },
  };
}

/* Sample an elliptical arc, converting SVG's endpoint form to the centre form
 * (F.6.5 in the SVG spec) so it can be measured like any other curve. */
function sampleArc(x1, y1, rx, ry, rotation, largeArc, sweep, x2, y2, onPoint) {
  if (!rx || !ry) { onPoint(x2, y2); return; }               // degenerate: a straight line
  rx = Math.abs(rx); ry = Math.abs(ry);

  const phi = (rotation * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy, py = -sin * dx + cos * dy;

  const scale = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (scale > 1) { const s = Math.sqrt(scale); rx *= s; ry *= s; }

  const num = rx*rx*ry*ry - rx*rx*py*py - ry*ry*px*px;
  const den = rx*rx*py*py + ry*ry*px*px;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * (rx * py) / ry, cyp = coef * -(ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const ux = (px - cxp) / rx, uy = (py - cyp) / ry;
  const vx = (-px - cxp) / rx, vy = (-py - cyp) / ry;

  const start = angle(1, 0, ux, uy);
  let sweepAngle = angle(ux, uy, vx, vy);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const steps = Math.max(6, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 12)));
  for (let s = 1; s <= steps; s++) {
    const t = start + (sweepAngle * s) / steps;
    onPoint(cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx,
            sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy);
  }
}

/* Walk a path, reporting flattened points (for measuring) and raw segments (for
 * rewriting). `kind` tells the rewriter how to read a segment's arguments:
 * coordinate pairs, a lone x or y, or an arc's radii-flags-endpoint mixture. */
function walk(d, onPoint, onSegment) {
  const s = scanner(d);
  let cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCubic = null, lastQuad = null;         // for the smooth (S/T) shorthands

  const emit = (name, rel, abs, kind) => onSegment && onSegment(name, rel, abs, kind);

  while (!s.done()) {
    if (s.peekCommand()) cmd = s.takeCommand();
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    const upper = cmd.toUpperCase();

    switch (upper) {
      case 'M': case 'L': {
        const x = ox + s.number(), y = oy + s.number();
        if (upper === 'M') { sx = x; sy = y; }
        emit(cmd, [x - ox, y - oy], [x, y], 'pairs');
        onPoint(x, y);
        cx = x; cy = y; lastCubic = lastQuad = null;
        if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';   // repeats are implicit linetos
        break;
      }
      case 'H': {
        const x = ox + s.number();
        emit(cmd, [x - ox], [x], 'x');
        onPoint(x, cy); cx = x; lastCubic = lastQuad = null;
        break;
      }
      case 'V': {
        const y = oy + s.number();
        emit(cmd, [y - oy], [y], 'y');
        onPoint(cx, y); cy = y; lastCubic = lastQuad = null;
        break;
      }
      case 'C': case 'S': {
        let x1, y1;
        if (upper === 'C') { x1 = ox + s.number(); y1 = oy + s.number(); }
        else { x1 = lastCubic ? 2 * cx - lastCubic[0] : cx;             // reflect the last control point
               y1 = lastCubic ? 2 * cy - lastCubic[1] : cy; }
        const x2 = ox + s.number(), y2 = oy + s.number(),
              x = ox + s.number(), y = oy + s.number();

        for (let t = 0.05; t <= 1.0001; t += 0.05) {
          const u = 1 - t;
          onPoint(u*u*u*cx + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x,
                  u*u*u*cy + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y);
        }
        if (upper === 'C') emit(cmd, [x1-ox, y1-oy, x2-ox, y2-oy, x-ox, y-oy], [x1, y1, x2, y2, x, y], 'pairs');
        else emit(cmd, [x2-ox, y2-oy, x-ox, y-oy], [x2, y2, x, y], 'pairs');
        cx = x; cy = y; lastCubic = [x2, y2]; lastQuad = null;
        break;
      }
      case 'Q': case 'T': {
        let x1, y1;
        if (upper === 'Q') { x1 = ox + s.number(); y1 = oy + s.number(); }
        else { x1 = lastQuad ? 2 * cx - lastQuad[0] : cx;
               y1 = lastQuad ? 2 * cy - lastQuad[1] : cy; }
        const x = ox + s.number(), y = oy + s.number();

        for (let t = 0.05; t <= 1.0001; t += 0.05) {
          const u = 1 - t;
          onPoint(u*u*cx + 2*u*t*x1 + t*t*x, u*u*cy + 2*u*t*y1 + t*t*y);
        }
        if (upper === 'Q') emit(cmd, [x1-ox, y1-oy, x-ox, y-oy], [x1, y1, x, y], 'pairs');
        else emit(cmd, [x-ox, y-oy], [x, y], 'pairs');
        cx = x; cy = y; lastQuad = [x1, y1]; lastCubic = null;
        break;
      }
      case 'A': {
        const rx = s.number(), ry = s.number(), rotation = s.number();
        const largeArc = s.flag(), sweep = s.flag();
        const x = ox + s.number(), y = oy + s.number();

        sampleArc(cx, cy, rx, ry, rotation, largeArc, sweep, x, y, onPoint);
        emit(cmd, [rx, ry, rotation, largeArc, sweep, x - ox, y - oy],
                  [rx, ry, rotation, largeArc, sweep, x, y], 'arc');
        cx = x; cy = y; lastCubic = lastQuad = null;
        break;
      }
      case 'Z': {
        emit('Z', [], [], 'none');
        cx = sx; cy = sy; lastCubic = lastQuad = null;
        break;
      }
      default:
        throw new Error(`path command "${cmd}" is not supported`);
    }
  }
}

function bbox(ds) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  ds.forEach((d) => walk(d, (x, y) => {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
  }));
  return b;
}

/* Positive or negative depending on which way the subpath winds -- that sign is
 * what separates a blank area from the black around it. */
function signedArea(d) {
  const pts = [];
  walk(d, (x, y) => pts.push([x, y]));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const subpathsOf = (d) => d.split(/(?=M)/).filter(Boolean).map((s) => s.trim());


/* ------------------------------------------------------------------- sheet */

function readGroups(file) {
  const svg = fs.readFileSync(file, 'utf8');
  if (/<(?:linearGradient|radialGradient|clipPath|mask|image|use)\b/.test(svg)) {
    console.error('warning: this sheet uses gradients, clipping, masks or <use>; ' +
                  'none of that survives the conversion.');
  }
  if (/\stransform=/.test(svg)) {
    console.error('warning: this sheet has transform attributes, which this tool ' +
                  'does not flatten. The output will be in the wrong place.');
  }
  const groups = [...svg.matchAll(/<g>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
  if (groups.length) return groups;

  // A file with no groups at all is one animal on its own -- which is how the
  // safari set is packaged, one SVG per animal.
  const body = svg.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  return /<path\b/.test(body) ? [body] : [];
}

const pathsOf = (group) =>
  [...group.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());


/* ---------------------------------------------------------------- the split */

function classify(paths, minShare) {
  const shapes = [];
  paths.forEach((d, pathIndex) => subpathsOf(d).forEach((sub) => {
    shapes.push({ pathIndex, d: sub, signed: signedArea(sub) });
  }));
  if (!shapes.length) throw new Error('that group has no paths in it');

  const silhouette = shapes.reduce((a, b) => (Math.abs(b.signed) > Math.abs(a.signed) ? b : a));
  const total = Math.abs(silhouette.signed);
  const outward = Math.sign(silhouette.signed);

  for (const s of shapes) {
    s.share = Math.abs(s.signed) / total;
    s.blank = Math.sign(s.signed) !== outward;   // wound against the silhouette
  }

  const regions = shapes
    .filter((s) => s !== silhouette && s.blank && s.share >= minShare)
    .sort((a, b) => b.share - a.share);          // biggest first == back to front

  const dropped = shapes.filter((s) => s !== silhouette && s.blank && s.share < minShare);

  /* How much of the animal a child can actually color, measured against the
   * figure's own footprint rather than against the silhouette -- see the note on
   * ribbon art in checkFillable(). */
  const box = bbox(paths);
  const footprint = (box.maxX - box.minX) * (box.maxY - box.minY);
  const fillable = regions.reduce((n, r) => n + Math.abs(r.signed), 0) / (footprint || 1);

  return { silhouette, regions, dropped, total, fillable };
}

/* Not all clip art is built as a silhouette with holes punched in it. The other
 * common construction expands each drawn line into a filled ribbon, so the art
 * is a pile of thin closed bands and the areas a child would color are the gaps
 * between them -- gaps that belong to no path and so cannot be pulled out this
 * way. Both kinds convert without complaint; only one of them is colorable
 * afterwards, which is why this is checked rather than left to be noticed later.
 *
 * Known-good files here measure 0.51 to 0.62; known-bad ones 0.03 to 0.08. */
const FILLABLE_FLOOR = 0.25;

function checkFillable(split) {
  if (split.fillable >= FILLABLE_FLOOR) return null;
  return `only ${(100 * split.fillable).toFixed(0)}% of this animal came out colorable ` +
         `(a usable page is 50% or more).\n` +
         `Its outlines are almost certainly drawn as filled ribbons rather than as a\n` +
         `silhouette with holes, and the areas between those ribbons belong to no path,\n` +
         `so there is nothing here to turn into a region. Pass --force to convert it\n` +
         `anyway and get a page that is mostly line art.`;
}


/* ------------------------------------------ does each region read as one area? */

/* A blank shape in the source is not always one shape on the page. Some artists
 * divide an area by drawing black shapes *over* it rather than by bounding it,
 * and then a single hole in the geometry covers several features that look
 * separate -- tap the hair and the horns, an ear and the nose all change color
 * with it. Nothing in the path data says so; it only shows up once you draw the
 * thing and look at what is left uncovered.
 *
 * So: rasterize what a child would actually see of each region (its shape, minus
 * the line art, minus every region painted on top of it) and count the separate
 * pieces. */

function polygonsOf(d) {
  const polys = [];
  let current = null;
  walk(d, (x, y) => { if (!current) { current = []; polys.push(current); } current.push([x, y]); },
          (cmd) => { if (cmd === 'M' || cmd === 'm') current = null; });
  return polys.filter((p) => p.length > 2);
}

/* Scanline fill, nonzero winding, across all the polygons handed in at once
 * (which is how one path's subpaths fill: together, not separately). */
function fillMask(polys, win, N, mask) {
  const edges = [];
  for (const pts of polys)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
    }
  for (let r = 0; r < N; r++) {
    const y = win.y0 + ((r + 0.5) * win.h) / N;
    const xs = [];
    for (const [x1, y1, x2, y2] of edges)
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y))
        xs.push([x1 + ((y - y1) / (y2 - y1)) * (x2 - x1), y2 > y1 ? 1 : -1]);
    xs.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      winding += xs[i][1];
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil(((xs[i][0] - win.x0) / win.w) * N - 0.5));
      const to = Math.min(N - 1, Math.floor(((xs[i + 1][0] - win.x0) / win.w) * N - 0.5));
      for (let c = from; c <= to; c++) mask[r * N + c] = 1;
    }
  }
}

function piecesOf(mask, N) {
  const seen = new Uint8Array(N * N), out = [];
  for (let i = 0; i < N * N; i++) {
    if (seen[i] || !mask[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let n = 0, r0 = N, r1 = 0, c0 = N, c1 = 0;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const r = (p / N) | 0, c = p % N;
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (c < c0) c0 = c; if (c > c1) c1 = c;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        const q = rr * N + cc;
        if (!seen[q] && mask[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push({ n, r0, r1, c0, c1 });
  }
  return out.sort((a, b) => b.n - a.n);
}

const BLEED_SHARE = 0.10;        // small regions bleeding a little is not worth a complaint

function bleedReport(paths, regions, N = 260) {
  const b = bbox(paths);
  const margin = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.02;
  const win = { x0: b.minX - margin, y0: b.minY - margin,
                w: (b.maxX - b.minX) + 2 * margin, h: (b.maxY - b.minY) + 2 * margin };

  const ink = new Uint8Array(N * N);
  for (const d of paths) fillMask(polygonsOf(d), win, N, ink);

  const masks = regions.map((r) => {
    const m = new Uint8Array(N * N);
    fillMask(polygonsOf(r.d), win, N, m);
    return m;
  });

  return regions.map((r, i) => {
    const visible = Uint8Array.from(masks[i]);
    for (let k = i + 1; k < regions.length; k++)
      for (let j = 0; j < visible.length; j++) if (masks[k][j]) visible[j] = 0;
    for (let j = 0; j < visible.length; j++) if (ink[j]) visible[j] = 0;

    /* A piece counts if a child could see and tap it. Measure that against the
     * picture, not against the region it came from: a leaf is a couple of
     * percent of a koala's head but perfectly visible, and dropping it hides
     * exactly the bleed worth catching. Antialiasing slivers along an edge come
     * out far smaller than this. */
    const all = piecesOf(visible, N);
    const solid = all.filter((p) => p.n >= N * N * 0.002);

    // Two pieces that mirror across the animal's axis are usually a left/right
    // pair -- both arms, both feet -- and coloring them together is what you
    // want. Keep this tight: a loose match lets a tail pair up with a chest
    // stripe and reports a page as clean when it is not.
    const axis = N / 2, tol = N * 0.06;
    const mirrored = solid.length === 2 &&
      Math.abs(solid[0].r0 - solid[1].r0) < tol && Math.abs(solid[0].r1 - solid[1].r1) < tol &&
      Math.abs((2 * axis - solid[0].c1) - solid[1].c0) < tol;

    return { index: i, share: r.share, pieces: solid.length, mirrored,
             // three or more scattered pieces in a big region is the unambiguous case
             broken: solid.length >= 3 && r.share >= BLEED_SHARE,
             odd: solid.length === 2 && r.share >= BLEED_SHARE && !mirrored };
  });
}


/* ------------------------------------------------- onto the book's own grid */

/* Returns a function that rewrites one path onto 0 0 GRID GRID, squared up and
 * centred on the art with `pad` units of margin. */
function fitter(paths, pad) {
  const b = bbox(paths);
  const side = Math.max(b.maxX - b.minX, b.maxY - b.minY) * (GRID / (GRID - 2 * pad));
  const x0 = (b.minX + b.maxX) / 2 - side / 2;
  const y0 = (b.minY + b.maxY) / 2 - side / 2;
  const k = GRID / side;

  const round = (v) => +v.toFixed(2);

  return (d) => {
    const out = [];
    walk(d, () => {}, (cmd, relArgs, absArgs, kind) => {
      if (kind === 'none') { out.push('Z'); return; }
      const rel = cmd === cmd.toLowerCase();
      const args = rel ? relArgs : absArgs;
      out.push(cmd);

      if (kind === 'arc') {
        // radii scale with everything else; the rotation and the two flags are
        // untouched by a uniform scale, and only the endpoint moves.
        out.push(round(args[0] * k), round(args[1] * k), args[2], args[3], args[4],
                 round(rel ? args[5] * k : (args[5] - x0) * k),
                 round(rel ? args[6] * k : (args[6] - y0) * k));
        return;
      }
      args.forEach((v, i) => {
        const isY = kind === 'x' ? false : kind === 'y' ? true : i % 2 === 1;
        out.push(round(rel ? v * k : (v - (isY ? y0 : x0)) * k));
      });
    });

    let text = '', line = '';
    for (const token of out) {
      const piece = /[A-Za-z]/.test(String(token)) ? String(token)
        : (line && !/[A-Za-z]$/.test(line) ? ' ' : '') + token;
      if (line.length + piece.length > WRAP) { text += line.trimEnd() + '\n'; line = ''; }
      line += piece;
    }
    return (text + line).trim();
  };
}


/* ----------------------------------------------------------------- output */

const indentTo = (d, n) => d.split('\n').join('\n' + ' '.repeat(n));

function entryFor(paths, split, fit, id, name) {
  const PAPER = '      <path class="paper" d="';
  const REGION = '      <path class="region" d="';
  const INK = '      <path class="ink" d="';

  let body = '';
  body += '      <!-- the sheet under the animal: not colorable, it just keeps taps on\n';
  body += '           the outlines from falling through to the background -->\n';
  body += PAPER + indentTo(fit(split.silhouette.d), PAPER.length) + '"/>\n\n';

  body += '      <!-- the shapes the artist left blank, biggest first so the small ones\n';
  body += '           land on top of the big ones they sit inside -->\n';
  for (const r of split.regions) body += REGION + indentTo(fit(r.d), REGION.length) + '"/>\n';

  body += '\n      <!-- the original outlines, drawn over the fills -->\n';
  for (const d of paths) body += INK + indentTo(fit(d), INK.length) + '"/>\n';

  const rule = '-'.repeat(Math.max(3, 72 - name.length)) + ' ' + name.toUpperCase();
  return `  /* ${rule} */\n` +
         `  {\n    id: '${id}',\n    name: '${name}',\n    viewBox: '0 0 ${GRID} ${GRID}',\n` +
         '    svg: `\n' + body.trimEnd() + '\n    `\n  }';
}

/* A painting page needs none of the shape analysis: the child paints on a canvas
 * underneath and the art is only ever drawn on top, so every path goes in as
 * ink and any drawing at all will do -- including the ribbon-outlined ones that
 * have nothing fillable in them. */
function paintEntryFor(paths, fit, id, name) {
  const INK = '      <path class="ink" d="';
  let body = '      <!-- outlines only: the painting goes on a canvas below them -->\n';
  for (const d of paths) body += INK + indentTo(fit(d), INK.length) + '"/>\n';

  const rule = '-'.repeat(Math.max(3, 72 - name.length)) + ' ' + name.toUpperCase();
  return `  /* ${rule} */\n` +
         `  {\n    id: '${id}',\n    name: '${name}',\n    mode: 'paint',\n` +
         `    viewBox: '0 0 ${GRID} ${GRID}',\n` +
         '    svg: `\n' + body.trimEnd() + '\n    `\n  }';
}

/* A standalone SVG for eyeballing: every colorable shape in its own color. */
function previewFor(paths, split, fit) {
  const PALETTE = ['#e53935', '#fb8c00', '#fdd835', '#c0ca33', '#43a047', '#00897b',
                   '#29b6f6', '#1e88e5', '#3949ab', '#8e24aa', '#ec407a', '#8d6e63',
                   '#ff8a65', '#9ccc65', '#4dd0e1', '#ba68c8'];
  const parts = [
    `<rect width="${GRID}" height="${GRID}" fill="#bfe9ff"/>`,
    `<path d="${fit(split.silhouette.d)}" fill="#ffffff"/>`,
    ...split.regions.map((r, i) => `<path d="${fit(r.d)}" fill="${PALETTE[i % PALETTE.length]}"/>`),
    ...paths.map((d) => `<path d="${fit(d)}" fill="#23262b"/>`),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" ` +
         `width="500" height="500">\n${parts.join('\n')}\n</svg>\n`;
}


/* -------------------------------------------------------------------- cli */

function parseArgs(argv) {
  const opts = { minShare: 0.0008, pad: 14 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--group') opts.group = Number(argv[++i]);
    else if (a === '--id') opts.id = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--preview') opts.preview = argv[++i];
    else if (a === '--min-share') opts.minShare = Number(argv[++i]);
    else if (a === '--pad') opts.pad = Number(argv[++i]);
    else if (a === '--force') opts.force = true;
    else if (a === '--paint') opts.paint = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) throw new Error('unknown option ' + a);
    else rest.push(a);
  }
  opts.file = rest[0];
  return opts;
}

function usage() {
  console.log([
    'Usage:',
    '  node tools/import-svg-sheet.js <sheet.svg> --list',
    '  node tools/import-svg-sheet.js <sheet.svg> --group N --preview out.svg',
    '  node tools/import-svg-sheet.js <sheet.svg> --group N --id fox --name Fox',
    '',
    'Options:',
    '  --min-share N   smallest blank shape to keep, as a fraction of the',
    '                  silhouette (default 0.0008)',
    '  --pad N         margin around the animal in grid units (default 14)',
    '  --force         convert even if almost nothing came out colorable',
    '  --paint         make a brush-painting page instead: outlines only, no',
    '                  fillable shapes, so any drawing works',
  ].join('\n'));
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exit(2); }

  if (opts.help || !opts.file) { usage(); process.exit(opts.file ? 0 : 2); }

  const groups = readGroups(opts.file);
  if (!groups.length) {
    console.error('no top-level <g> elements found -- is this the right kind of sheet?');
    process.exit(1);
  }

  if (opts.list || opts.group === undefined) {
    console.log(`${groups.length} groups in ${opts.file}\n`);
    console.log('  group  paths  shapes  colorable');
    groups.forEach((g, i) => {
      const paths = pathsOf(g);
      let line;
      try {
        const split = classify(paths, opts.minShare);
        const pct = (100 * split.fillable).toFixed(0) + '%';
        line = `${String(paths.length).padStart(7)}${String(split.regions.length).padStart(8)}` +
               `${pct.padStart(11)}` + (checkFillable(split) ? '   <- ribbon art, not colorable' : '');
      } catch (e) {
        line = '  ' + e.message.split('\n')[0];
      }
      console.log(String(i).padStart(7) + line);
    });
    console.log('\nPick one with --group N, then --preview out.svg to see what it is.');
    return;
  }

  const group = groups[opts.group];
  if (!group) { console.error(`no group ${opts.group}; the sheet has 0..${groups.length - 1}`); process.exit(1); }

  const paths = pathsOf(group);
  const fit = fitter(paths, opts.pad);

  if (opts.paint) {
    if (!opts.id || !opts.name) {
      console.error('--id and --name are both needed to print an entry');
      process.exit(2);
    }
    console.error(`painting page: ${paths.length} outline paths, nothing to classify`);
    console.log(paintEntryFor(paths, fit, opts.id, opts.name));
    return;
  }

  const split = classify(paths, opts.minShare);

  if (opts.preview) {
    fs.writeFileSync(opts.preview, previewFor(paths, split, fit));
    console.error(`wrote ${opts.preview}: ${split.regions.length} colorable shapes covering ` +
                  `${(100 * split.fillable).toFixed(0)}% of the animal` +
                  (split.dropped.length ? `, ${split.dropped.length} too small to keep` : ''));
    const warn = checkFillable(split);
    if (warn) console.error(warn);
    else for (const r of bleedReport(paths, split.regions).filter((r) => r.broken || r.odd))
      console.error(`  shape ${r.index} (${(100 * r.share).toFixed(0)}% of the animal) paints in ` +
                    `${r.pieces} separate places` + (r.mirrored ? ' (a left/right pair)' : ''));
    if (!opts.id) return;
  }

  if (!opts.id || !opts.name) {
    console.error('--id and --name are both needed to print an entry');
    process.exit(2);
  }

  const complaint = checkFillable(split);
  if (complaint && !opts.force) { console.error(complaint); process.exit(1); }
  if (complaint) console.error('forced: ' + complaint.split('\n')[0]);

  const bleed = bleedReport(paths, split.regions);
  for (const r of bleed.filter((r) => r.odd))
    console.error(`note: shape ${r.index} (${(100 * r.share).toFixed(0)}% of the animal) paints in ` +
                  `2 places that are not a left/right pair -- worth a look at the preview.`);
  const broken = bleed.filter((r) => r.broken);
  if (broken.length && !opts.force) {
    console.error(broken.map((r) =>
      `shape ${r.index} is ${(100 * r.share).toFixed(0)}% of the animal and paints in ` +
      `${r.pieces} separate places.`).join('\n') + '\n' +
      'Its divisions are drawn as black shapes laid over one blank area rather than\n' +
      'bounding it, so one tap colors several features that look separate. There is no\n' +
      'way to split it without redrawing. Pass --force to convert it anyway.');
    process.exit(1);
  }

  console.error(`${split.regions.length} colorable shapes covering ` +
                `${(100 * split.fillable).toFixed(0)}% of the animal` +
                (split.dropped.length ? `, ${split.dropped.length} dropped as too small` : ''));
  console.log(entryFor(paths, split, fit, opts.id, opts.name));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);          // a bad path command is the user's problem, not a crash
    process.exit(1);
  }
}

module.exports = { walk, bbox, signedArea, subpathsOf, readGroups, pathsOf, classify,
                   checkFillable, bleedReport, fitter, entryFor, paintEntryFor };
