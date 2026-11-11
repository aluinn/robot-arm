# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/aluinn/robot-arm/security/advisories/new)**
(repository **Security** tab, **Report a vulnerability**). Please do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the browser and version you used. This is a hobby-scale project maintained in spare time, so replies may take a few days; reports are taken seriously and you will be credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` (and the latest release, if any) receives fixes.

## Scope and design notes

The app is a static, client-side page. There is no server, no account system and no data leaves the browser. What is worth knowing:

- **Third-party code from a CDN.** Three.js and cannon-es are loaded from jsDelivr through an import map with exact versions pinned. The script URLs do not carry Subresource Integrity hashes, so a compromise of the CDN would affect users. Vendoring the dependencies is tracked in the [issue drafts](docs/issues/09-vendor-dependencies-offline.md).
- **Imported recordings are untrusted input.** Recording files are parsed with `JSON.parse` and validated for shape, ranges and length (`validate()` in `src/recorder.js`) before use. They are never evaluated as code.
- **Local storage.** The last recording and best challenge times are stored in `localStorage` under `robotarm.*` keys. Nothing sensitive is stored.
- **`?debug` query parameter.** Exposes `window.__app` for tests. It only exposes objects already in the page and has no effect on other origins.

Out of scope: denial of service through a very large or deliberately slow recording on your own machine (imports are capped at 5 minutes of simulated time), and issues that require a malicious browser extension.
