# Kids' Drawing Game

A little coloring book for the grandkids. Pick an animal, pick a color, tap a
part of the picture to fill it in.

## Running it

There is no build step and no server needed — just double-click `index.html`,
or drag it into a browser. It works the same on a laptop, a tablet, or a phone.

To put it on a tablet the kids can use, any static host works (GitHub Pages,
Netlify, a folder served by `python3 -m http.server`). Copy all four files.

## What it does

- **25 pictures** to choose from: the five original hand-drawn ones (fish, cat,
  butterfly, turtle, owl) plus twenty animals converted from a clip art sheet —
  lion, elephant, rabbit, gorilla, penguin, tiger, zebra, monkey, giraffe, fox,
  deer, lamb, hedgehog, puppy, bear, teddy bear, duckling, chick, and a baby owl
  and baby turtle.
- **16 colors**, including white, which acts as an eraser.
- **The background is colorable too** — tap any empty space around the animal.
- **Undo** (also Ctrl/Cmd-Z) and **Start Over**.
- **Zoom and pan** for pictures with small parts — pinch or scroll to zoom, drag
  to move around, or use the round buttons in the corner of the page. See
  *Zooming in* below.
- **Save** writes a PNG to the downloads folder — good for printing or
  emailing to grandma.
- Colors are remembered per picture, so closing the tab doesn't lose the work.
  The gallery thumbnails show each picture as it was last left.

## How the coloring works

Each picture is an SVG whose colorable parts are separate closed shapes. A tap
sets the fill on the shape that was tapped. That's why the color never bleeds
past a line and why the pictures stay sharp on a retina screen — there is no
pixel flood-fill anywhere.

Three CSS classes carry all the meaning:

| class | what it is | clickable? |
| --- | --- | --- |
| `region` | a shape a child can fill with color | yes |
| `backdrop` | the background sheet — a `region` with no outline | yes |
| `ink` | solid black detail, like a pupil | no |
| `line` | a stroke-only detail, like a whisker | no |
| `paper` | blank sheet under a picture that carries its own outlines | no |

## Zooming in

A detailed picture can have parts too small for a small finger, so the coloring
page zooms up to 8×:

| gesture | what it does |
| --- | --- |
| pinch (touch) | zoom in and out around the fingers |
| scroll wheel / trackpad | zoom in and out around the pointer |
| drag | move the picture — only once it is zoomed in |
| `+` `-` `0` keys | zoom in, zoom out, fit the whole picture |
| arrow keys | move the picture when zoomed in |
| the round buttons | zoom in, zoom out; the middle one shows the zoom and taps back to fit |

At 1× a drag does nothing, so every tap on an unzoomed picture is a paint —
which is what a small child expects. Once zoomed in, a drag pans and the tap
that ends it is swallowed rather than painting a random shape. Zoom resets each
time a picture is opened, and **Save** always writes the whole page, not the
part currently on screen.

## Adding another picture

Add an entry to the `DRAWINGS` array in `drawings.js` and it shows up in the
gallery automatically. Don't draw a background — `app.js` adds one to every
picture, so a new one gets it for free:

```js
{
  id: 'ladybug',            // also the filename when saving a PNG
  name: 'Ladybug',          // shown under the thumbnail
  viewBox: '0 0 400 400',
  svg: `
    <circle class="region" cx="200" cy="200" r="120"/>
    <circle class="ink" cx="160" cy="170" r="18"/>
  `
}
```

A bigger `viewBox` (say `0 0 1200 1200`) is fine for a more detailed picture —
it is scaled to fit either way, and the kids can zoom in on the fiddly parts.
Keep the stroke widths in the CSS in mind: they are in user units, so lines on a
1200-unit grid look three times finer than the same lines on a 400-unit one.

Two things to keep in mind while drawing:

- **Shapes paint in the order they are listed.** Put things that belong
  *behind* the body — tails, wings, fins, ears — before it, and details after.
- **Let the body cover the joins.** A fin or tail looks attached when the edge
  where it meets the body sits just *inside* the body outline, so the body's
  fill hides the seam.

## Using clip art from somewhere else

Outline clip art is usually built the opposite way round from these pages: the
whole drawing is *one* black path whose closed subpaths cut the holes that read
as lines. Dropped in as-is it is a black silhouette — nothing to color, and the
`region`/`ink` classes have nothing to attach to.

Turning one into a coloring page (the lion came in this way):

1. **Fix the grid.** Clip art is rarely drawn on a 0–400 grid; the lion's art
   sat between 1220 and 1970 on x, which put all of it outside the `viewBox`, so
   the page came up blank. Either set `viewBox` to the art's real bounding box or
   rescale the coordinates onto the 400 grid — rescaling is better, because the
   stroke widths in the CSS are in user units and only match the other pages at
   that size.
2. **Split the big path on its `M` commands**, then read the winding. Art like
   this is black everywhere *except* where a subpath is wound against the outer
   contour and punches a hole back out of it. Those holes are the areas the
   artist left blank — which is exactly the set of shapes a child colors in. A
   signed area (shoelace) per subpath tells you which is which, so picking the
   colorable shapes is mechanical rather than a matter of taste. Sort them
   largest first and the paint order comes out right too, because a shape nested
   inside another is always the smaller of the two.

   Drop anything under about 0.08% of the silhouette — at that size you are
   picking up the white glint in an eye, not a shape worth coloring.
3. **List the inner subpaths back to front** — mane, body, face, ears, tail —
   and give each `class="region"`. Those are the fills.
4. **Put the whole original path back on top as `class="ink"`.** It is the line
   art, and drawing it over the fills is what makes every edge land exactly
   where the artist drew it. Solid black details (eyes, nose) are `ink` too.
5. **Give the outer silhouette `class="paper"` and list it first.** Two reasons:
   it backs the fills so no seam shows between them, and because `ink` is
   pointer-transparent, it is what catches a tap that lands on a thick outline —
   without it that tap falls through to the backdrop and paints the whole
   background.

Don't be tempted to make that silhouette a `region`. The outer contour and the
inner ones are the two *edges of the same drawn line*, so a colorable silhouette
shows up as a hairline rim tracing the whole animal, and tapping near an edge
colors the rim instead of the part next to it.

One trap: an SVG comment may not contain a double hyphen. Browsers forgive it,
but **Save** serializes the SVG strictly and a `--` inside a comment makes the
PNG fail silently.

## Files

    index.html    the two screens (gallery, coloring page)
    styles.css    layout, big touch targets, the crayon palette
    drawings.js   the pictures
    app.js        picking, filling, undo, saving
