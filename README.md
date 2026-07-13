# Fire Solution — Shooting Phase Resolver (React)

A React + Vite rebuild of the combat probability calculator. The probability
math lives in one real module (`src/lib/combatMath.js`) that is imported
directly by both the UI (`src/App.jsx`) and the test suite
(`src/lib/combatMath.test.js`) — no more duplicated logic to keep in sync.

## Setup

```bash
npm install
```

## Run the app locally

```bash
npm run dev
```

This starts a Vite dev server (usually http://localhost:5173) with hot reload.

## Run the tests

```bash
npm test
```

Runs the Vitest suite in `src/lib/combatMath.test.js` once and exits.
Use `npm run test:watch` to keep it running while you edit.

## Build for deployment

```bash
npm run build
```

Outputs a static site to `dist/`, which you can deploy anywhere that serves
static files (Netlify, Vercel, GitHub Pages, S3, etc.). Preview the build
locally with `npm run preview`.

## Project layout

```
src/
  lib/
    combatMath.js       <- pure probability functions (the single source of truth)
    combatMath.test.js  <- Vitest suite, imports directly from combatMath.js
  App.jsx                <- UI: inputs, useMemo pipeline, Chart.js bar charts
  App.css                <- parchment/manuscript theme
  main.jsx                <- React entry point
public/
  parchment-bg.jpg        <- background texture referenced by App.css
```

## Why this fixes the "duplicated logic" problem

In the single-file HTML version, the math had to be copy-pasted into the
page for it to work standalone, with no way to `import` it into a test file.
Here, `combatMath.js` is a normal ES module:

- `App.jsx` imports it to compute the four probability distributions shown
  in the UI.
- `combatMath.test.js` imports the exact same file to test it.

Change the math once in `combatMath.js`, and both the app and the tests
pick it up automatically — there's nothing to keep in sync by hand.
