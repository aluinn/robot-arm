---
title: "Remember UI preferences across visits"
labels: [good first issue]
---

## Context

Only the last recording (`robotarm.recording.v1`) and challenge best times (`robotarm.best`) are stored in `localStorage`. Sound, auto-orbit, trail visibility, clean mode, the controls hint, the camera preset and which panel cards are collapsed all reset on every visit.

## Task

Persist a small set of preferences (sound on/off, trail, hint, preset, card open/closed state) under one new key, for example `robotarm.prefs.v1`, and apply them at startup. Storage can throw (private windows, blocked storage), so wrap reads and writes in try/catch as `challenge.js` does.

## Acceptance

- Reloading restores the saved preferences.
- With `localStorage` blocked, the app still loads with defaults and no console errors.
- Unit test for the parse/validate function (reject unknown keys and wrong types).
- Mention the new key in `SECURITY.md` under local storage.

## Pointers

- `src/main.js` (`actions`, startup block near `ui.setHint(true)`), `src/ui.js` (`_card`), `src/challenge.js` (existing storage pattern)
