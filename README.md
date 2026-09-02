# Color Me

A little coloring book for the grandkids. Pick an animal, pick a color, tap a
part of the picture to fill it in.

## Running it

There is no build step and no server needed — just double-click `index.html`,
or drag it into a browser. It works the same on a laptop, a tablet, or a phone.

To put it on a tablet the kids can use, any static host works (GitHub Pages,
Netlify, a folder served by `python3 -m http.server`). Copy all four files.

## What it does

- **124 pictures**, of two kinds. 24 are *coloring* pages: tap a shape and it
  fills. The other 100 are *painting* pages with a brush instead — see **Two
  kinds of page** below. Every page from the safari set is a painting page.
- **16 colors**, including white, which acts as an eraser, plus a color wheel
  for mixing four more that are kept between visits.
- **The background is colorable too** — tap any empty space around the animal.
- **Three brush sizes** on the painting pages.
- **Zoom and pan** — pinch or scroll, two fingers to drag, or the pan pad.
- **Undo** (also Ctrl/Cmd-Z) and **Start Over**.
- **Zoom and pan** for pictures with small parts — pinch or scroll to zoom, drag
  to move around, or use the round buttons in the corner of the page. See
  *Zooming in* below.
- **Save** writes a PNG to the downloads folder — good for printing or
  emailing to grandma.
- Colors are remembered per picture, so closing the tab doesn't lose the work.
  The gallery thumbnails show each picture as it was last left.

## Two kinds of page

A drawing entry with `mode: 'paint'` behaves completely differently from the
default. It is worth knowing why both exist.

Tap-to-fill is the better toy for the youngest child: no motor skill at all, and
the result is always tidy. But it demands art built out of closed shapes, one
per thing you would want to color. A lot of clip art is not built that way — see
**Using clip art from somewhere else** — and for those pictures flood fill either
has nothing to fill or fills several unrelated features at once.

A brush does not care. It needs no shapes, so any drawing at all can become a
painting page, and it suits an older child who wants to choose where the color
goes. The pictures that could not be made into coloring pages became painting
pages instead.

Switching a page between the two is just the `mode` flag and re-importing the
art (`--paint` drops the fillable shapes and keeps the outlines). The two kinds
save under different keys, so work done one way is left alone rather than
overwritten if a page is ever switched back.

**How it works.** The child paints on a `<canvas>` that sits *underneath* the
outlines, which are drawn over the top of it. So paint can wander across a line —
that is what coloring outside the lines is — but it can never cover one. No
clipping, no masking, no hit testing; the whole "don't paint over the outlines"
requirement is just the stacking order.

**Where the picture is** matters more than it sounds. The canvas box asks for a
1:1 aspect ratio *and* full height, and on a tall phone the width gets clamped
while the height stands — so the box comes out taller than it is wide, and the
SVG fits the picture to the width and centres it, leaving a band above and below.
Anything converting between the screen and the picture has to go through that
same fit. Assuming the picture filled the box put strokes progressively above the
finger down the page: about right at the top, tens of pixels out at the bottom.
`pictureFit()` is now the single answer to "where is the picture", and the
pointer maths, the paint layer and its redraws all read it.

Paint is clipped to the picture, so a stroke that strays into the band does not
appear on screen and then go missing from the saved PNG, which crops to the
picture.

**What is stored** is a list of strokes — a color, a width, and a run of points
in the picture's own `0 0 400 400` space — not a grid of pixels. Everything falls
out of that: undo is dropping the last stroke and drawing the rest again, saving
is a little JSON, and the same strokes redraw sharply at any zoom and on any
screen, because they were never committed to a particular pixel grid.

**Gestures.** One finger always paints, so panning moves to two fingers (which
also pinch to zoom). On a coloring page a one-finger drag still pans, as before.

Every two-finger gesture begins as one finger down, so the first finger of a
pinch has already started painting by the time the second arrives. A stroke less
than 300ms old is therefore taken back rather than kept when a second finger
lands — the child was reaching to pan. A stroke older than that was deliberate,
and resting a second finger mid-stroke will not destroy it.

That leaves the mouse, which has no second finger and so cannot pan a painting
page at all. Hence the **pan pad** in the bottom-left corner: hold a direction
and the picture glides. It appears only when the picture is zoomed in, and it is
deliberately a separate control rather than a hand/pan *mode* — a mode means a
child taps expecting to pan and paints instead, which is the confusion worth
avoiding.

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

A painting page uses none of these except `ink`: it has no fillable shapes at
all, only outlines, and gets no backdrop rectangle — an opaque one would hide the
brushwork underneath it.

## Mixing colors

Sixteen crayons cannot make a brown, a skin tone, or the muddy greens most of
these animals want, so the palette also has a wheel. Hue runs around it and
saturation outwards; the strip underneath sets brightness, and that strip is
what earns the feature — orange only becomes brown by pulling it dark, and
without it the wheel would just be the sixteen crayons again with gaps filled in.

Four mixed colors are kept, in `localStorage`, and they sit in the palette beside
the fixed crayons so a color a child made is one tap away afterwards. Mixing a
fifth has to evict one, so the slot about to be overwritten wears a ring and can
be re-aimed by tapping a different one. Nothing a child made disappears without
them choosing it. Tapping a slot that already holds a color also loads it back
into the wheel, so a shade can be nudged rather than mixed again from scratch.

The slots are positional: four entries, empty ones held as `null`. Dropping the
empty ones when saving would have quietly shuffled a color out of the third slot
and into the first on the next visit.

Only **Done**, Escape, or a tap outside closes the mixer. Everything inside it is
part of choosing a color, so the panel stays put while a child hunts around.

While a finger is sliding around the wheel only the screen is updated; the write
to storage and the palette rebuild wait for the finger to lift, since either one
per pointer-move would be dozens of times a second for nothing.

## Small screens

Sixteen swatches and the brush row eat about a third of a phone's height, and
most of it sits idle. Under 720px wide (or 620px tall) two things fold away:

- the **palette** collapses to a single round button showing the color in use,
- **Start Over** and **Save** move behind a `⋯` button — the two rarest things on
  the bar and the two most annoying to hit by accident.

Both open **over** the picture rather than by growing the bar: resizing the
canvas would mean re-rendering a painting page's strokes every time. Picking a
color closes the palette, as does tapping the picture or pressing Escape.

On a laptop both stay out where they are. Hiding them there would cost a tap and
buy nothing.

With 124 pages, the gallery would be slow if it drew every thumbnail at once, so
each card takes its size immediately (the art box is square, so nothing jumps as
you scroll) and its picture only when it is nearly on screen.

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
| the pan pad | hold a direction to glide the picture; appears only when zoomed in |

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

`tools/import-svg-sheet.js` does this for a sheet of them. It never writes to
`drawings.js` — it prints an entry for you to read and paste in:

```
node tools/import-svg-sheet.js sheet.svg --list              # what's in there
node tools/import-svg-sheet.js sheet.svg --group 7 --preview /tmp/a.svg
node tools/import-svg-sheet.js sheet.svg --group 7 --id fox --name Fox
node tools/import-svg-sheet.js sheet.svg --group 7 --paint --id fox --name Fox
```

`--paint` makes a painting page instead, and skips every check below: a brush
needs no closed shapes, so a drawing that is hopeless for flood fill converts
fine. If a picture you want fails the checks, that is the fallback.

The preview colors every shape it found differently, which is how you check the
split before committing to it — and how you work out which animal group 7 even
is, since the groups usually have no names.

What it is doing, and what to do by hand if a sheet is built differently (the
lion came in this way):

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

## The icon, and putting it on a tablet

The icon is a bear's face with one half coloured in and the other still blank
paper, which is the app in one picture. It is drawn in the same language as the
pages — thick outlines, palette colors, no gradients — so it survives being
shrunk to 16 pixels, where a rotated crayon (the obvious first idea) turns into
an ambiguous diagonal smudge.

There are two versions of it on purpose:

    favicon.svg          rounded tile — browsers draw it as-is in the tab
    icon.svg             the same art full bleed, and the source for the PNGs
    apple-touch-icon.png 180px, what an iPad home screen actually shows
    icon-192/512.png     for the manifest

The home-screen one must be **full bleed**: iOS and Android round the corners
themselves, and a pre-rounded tile leaves transparent corners that get filled
with black.

`manifest.json` sets `display: standalone`, so added to a home screen it launches
without browser chrome — no address bar for a small child to wander into, and it
behaves like an app rather than a web page. Two things to know about that:

- The manifest is fetched, so it only works over `http(s)`. Opening
  `index.html` straight off the disk still runs the app fine; the browser just
  logs a complaint about the manifest.
- A home-screen app may keep its saved colorings **separately** from the same
  page in the browser, so work done in Safari may not appear in the installed
  copy. Worth checking before the kids invest an afternoon in a picture.

## Files

    index.html                 the two screens (gallery, coloring page)
    styles.css                 layout, big touch targets, the crayon palette
    drawings.js                the pictures (about 5MB — see below)
    app.js                     picking, filling, painting, undo, saving
    manifest.json              name, colors and icons for a home-screen launch
    favicon.svg, icon.svg      the icon; see above for why there are two
    tools/import-svg-sheet.js  turns clip art into pages; not loaded by the app

`drawings.js` is large because every picture is vector path data, and 124 of them
adds up. It is still the right shape for this: the pages stay sharp at any zoom,
they print well, and there is nothing to fetch at runtime. If it ever needs to
shrink, the painting pages could drop to fewer decimal places without anyone
noticing, since nothing about them is clicked.
