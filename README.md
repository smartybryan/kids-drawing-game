# Kids' Drawing Game

A little coloring book for the grandkids. Pick an animal, pick a color, tap a
part of the picture to fill it in.

## Running it

There is no build step and no server needed — just double-click `index.html`,
or drag it into a browser. It works the same on a laptop, a tablet, or a phone.

To put it on a tablet the kids can use, any static host works (GitHub Pages,
Netlify, a folder served by `python3 -m http.server`). Copy all four files.

## What it does

- **Six pictures** to choose from: fish, cat, butterfly, turtle, owl, giraffe.
- **16 colors**, including white, which acts as an eraser.
- **The background is colorable too** — tap any empty space around the animal.
- **Undo** (also Ctrl/Cmd-Z) and **Start Over**.
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

Two things to keep in mind while drawing:

- **Shapes paint in the order they are listed.** Put things that belong
  *behind* the body — tails, wings, fins, ears — before it, and details after.
- **Let the body cover the joins.** A fin or tail looks attached when the edge
  where it meets the body sits just *inside* the body outline, so the body's
  fill hides the seam.

## Files

    index.html    the two screens (gallery, coloring page)
    styles.css    layout, big touch targets, the crayon palette
    drawings.js   the pictures
    app.js        picking, filling, undo, saving
