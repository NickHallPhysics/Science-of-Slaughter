# Science of Slaughter — Shooting Phase Resolver (React)

A React project to simulate the binomial combat probabilities of the Shooting 
Phase for Horus Heresy 3rd Edition. Future developments will include Assault 
Phase and Challenge Subphase probability visualisations.

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

Runs the Vitest suites in `src/lib/combatMath.test.js` and 
`src/lib/specialRules.test.js` once and exits. Use `npm run test:watch` 
to keep it running while you edit.

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
    specialRules.js       <- special rule definitions (the single source of truth)
    specialRules.test.js  <- Vitest suite, imports directly from specialRules.js
  App.jsx                <- UI: inputs, useMemo pipeline, Chart.js bar charts
  App.css                <- parchment/manuscript theme
  main.jsx                <- React entry point
public/
  parchment-bg.jpg        <- background texture referenced by App.css
```