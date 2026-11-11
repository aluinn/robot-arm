---
title: "Add page metadata and a social preview image"
labels: [good first issue]
---

## Context

`index.html` has only a title, a viewport tag and an inline favicon. Sharing the link gives no description or preview image, and search engines have little to show.

## Task

Add `<meta name="description">`, Open Graph and Twitter card tags, and a theme colour. Use an existing screenshot from `docs/assets/` (copy it to a new file such as `docs/assets/social-preview.png` at 1280x640 rather than modifying the original). Keep the page free of build steps.

## Acceptance

- Pasting the deployed URL into a link-preview tool shows title, description and image (note that this needs the GitHub Pages deployment to be live).
- Absolute URLs for `og:image` use the Pages URL, with a note explaining how to change them for forks.
- `npm run build` output still contains the image.

## Pointers

- `index.html`, `scripts/build.mjs`, `docs/assets/`
