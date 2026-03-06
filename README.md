# Doter

A small GitHub Pages-friendly prototype for a Dotter-style interactive dot matrix viewer.

## What it does

- Parses two FASTA-like sequence inputs in the browser.
- Supports drag-and-drop loading of one or two FASTA/text files.
- Precomputes a windowed similarity matrix once.
- Renders the matrix as a grayscale canvas image.
- Lets you hover to inspect coordinates with an immediate crosshair and diagonal trace.
- Includes a mini alignment panel centered on the hovered position.
- Supports zoom, pan, fit-to-view, and redraw-only threshold adjustments.
- Exports the current matrix view to PNG or SVG.
- Uses a Web Worker for score-matrix computation so interaction stays responsive.
- Works as a static site with no backend.

## Why this matches the Dotter workflow

The key interaction is preserved:

1. compute the score image once
2. render it to pixels
3. do real-time interaction on top of that precomputed image

That means the UI feels immediate when exploring diagonals and internal repeats.

## Files

- `index.html` — UI shell and controls
- `styles.css` — layout and dark visual style
- `src/app.js` — FASTA parsing, score precompute, rendering, and hover interaction
- `src/worker.js` — background scoring worker

## Publish on GitHub Pages

Because this is plain static HTML/CSS/JS, you can publish it directly from a repository.

### Quick start

Open `index.html` in a browser, or serve the folder with any static host.

For a local preview using Python:

```bash
cd /home/sk4386/Downloads/doter
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Current algorithm

This prototype uses a simple diagonal sliding-window score:

- `identity`: exact matches contribute `1`, mismatches `0`
- `dna-simple`: exact matches contribute `+1`, mismatches `-1`

For each cell `(i, j)`, the score sums characters across a small diagonal window centered on that cell and normalizes the result for display.

## Interaction model

- `Threshold`, `Pixel size`, and `Zoom` redraw instantly from the existing score image.
- `Window`, `Mode`, and `Reverse complement B` change the scoring model and require recalculation.
- Hold `Ctrl` while using the mouse wheel over the viewer to zoom quickly.
- Drag inside the viewer to pan around large matrices.
- Hovering updates the mini alignment panel immediately so you can inspect the local neighborhood like Dotter/Staden.

## GitHub Pages

This repo is already structured as a plain static site, so it can be published from the repository root using GitHub Pages.

For a repo like `Toki-bio/doter`, the simplest setup is:

1. push these files to the `main` branch
2. enable GitHub Pages from the repository settings
3. choose `Deploy from a branch`
4. select branch `main` and folder `/ (root)`

## Practical limits

This pure browser implementation is comfortable for sequences in the low tens of kilobases, depending on the machine and browser.

## Useful next upgrades

- add banded scoring / suffix seeding for faster large-repeat inspection
- improve the alignment panel with gap-aware local alignment
- add protein substitution matrices
- add tiled rendering for very large sequences
- enable saved sessions / sharable URLs
