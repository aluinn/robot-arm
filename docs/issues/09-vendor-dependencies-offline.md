---
title: "Vendor Three.js and cannon-es for offline use"
labels: [enhancement]
---

## Context

`index.html` loads Three.js 0.170.0 and cannon-es 0.20.0 from jsDelivr through an import map. The app does not start without network access, and the CDN is a trust dependency (see `SECURITY.md`).

## Task

Make the dependencies available locally without introducing a bundler: copy the needed files (`three.module.js`, the used `examples/jsm` files such as `OrbitControls`, `RoundedBoxGeometry`, `RoomEnvironment`, and `cannon-es.js`) into a `vendor/` folder, fetched by a small script from the pinned versions so they stay in sync with `devDependencies`. Point the import map at `vendor/`.

## Acceptance

- The app loads with the network disabled (check with Playwright `context.setOffline(true)` after serving locally).
- Versions come from one place, and `docs` explains how to update them.
- `npm run build` includes `vendor/` and the Pages deployment still works.
- Three.js and cannon-es licences are included alongside the files.

## Pointers

- `index.html` (import map), `package.json`, `scripts/build.mjs`, `tests/e2e/`
