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

/* Walk a path, reporting flattened points (for measuring) and raw segments (for
 * rewriting). Everything this art uses, and nothing it doesn't: an arc or a
 * shorthand curve throws rather than being silently mangled. */
function walk(d, onPoint, onSegment) {
  const tokens = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) || [];
  let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;

    switch (cmd.toUpperCase()) {
      case 'M': case 'L': {
        const x = ox + num(), y = oy + num();
        if (cmd.toUpperCase() === 'M') { sx = x; sy = y; }
        onSegment && onSegment(cmd, [x - ox, y - oy], [x, y]);
        onPoint(x, y);
        cx = x; cy = y;
        if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';  // repeats are implicit linetos
        break;
      }
      case 'C': {
        const x1 = ox + num(), y1 = oy + num(),
              x2 = ox + num(), y2 = oy + num(),
              x = ox + num(), y = oy + num();
        for (let t = 0.05; t <= 1.0001; t += 0.05) {      // flatten for measuring
          const u = 1 - t;
          onPoint(u*u*u*cx + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x,
                  u*u*u*cy + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y);
        }
        onSegment && onSegment(cmd, [x1-ox, y1-oy, x2-ox, y2-oy, x-ox, y-oy], [x1, y1, x2, y2, x, y]);
        cx = x; cy = y;
        break;
      }
      case 'H': { const x = ox + num(); onSegment && onSegment(cmd, [x-ox], [x]); onPoint(x, cy); cx = x; break; }
      case 'V': { const y = oy + num(); onSegment && onSegment(cmd, [y-oy], [y]); onPoint(cx, y); cy = y; break; }
      case 'Z': { onSegment && onSegment('Z', [], []); cx = sx; cy = sy; break; }
      default:
        throw new Error(
          `path command "${cmd}" is not supported (only M L H V C Z are).\n` +
          `Re-export the sheet with curves flattened to cubics and no arcs.`);
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
  return [...svg.matchAll(/<g>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
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
  return { silhouette, regions, dropped, total };
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

  return (d) => {
    const out = [];
    walk(d, () => {}, (cmd, relArgs, absArgs) => {
      if (cmd === 'Z') { out.push('Z'); return; }
      const rel = cmd === cmd.toLowerCase();
      out.push(cmd);
      (rel ? relArgs : absArgs).forEach((v, i) => {
        const isY = /[HV]/i.test(cmd) ? cmd.toUpperCase() === 'V' : i % 2 === 1;
        out.push(+(rel ? v * k : (v - (isY ? y0 : x0)) * k).toFixed(2));
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
    console.log('  group  paths  shapes  dropped  largest shape');
    groups.forEach((g, i) => {
      const paths = pathsOf(g);
      let line;
      try {
        const split = classify(paths, opts.minShare);
        const biggest = split.regions.length ? (100 * split.regions[0].share).toFixed(1) + '%' : '-';
        line = `${String(paths.length).padStart(7)}${String(split.regions.length).padStart(8)}` +
               `${String(split.dropped.length).padStart(9)}${biggest.padStart(15)}`;
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
  const split = classify(paths, opts.minShare);
  const fit = fitter(paths, opts.pad);

  if (opts.preview) {
    fs.writeFileSync(opts.preview, previewFor(paths, split, fit));
    console.error(`wrote ${opts.preview}: ${split.regions.length} colorable shapes` +
                  (split.dropped.length ? `, ${split.dropped.length} too small to keep` : ''));
    if (!opts.id) return;
  }

  if (!opts.id || !opts.name) {
    console.error('--id and --name are both needed to print an entry');
    process.exit(2);
  }

  console.error(`${split.regions.length} colorable shapes` +
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

module.exports = { walk, bbox, signedArea, subpathsOf, readGroups, pathsOf, classify, fitter, entryFor };
