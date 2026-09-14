# Testing status

## Methodology

This build's automated Chrome install (`chrome --load-extension=...`) is blocked by Google Chrome's own policy in this environment — Chrome's internal log records `--disable-extensions-except is not allowed in Google Chrome, ignoring` and silently drops `--load-extension` too. This restriction targets command-line/CI-driven extension loading specifically; it does **not** affect the normal "Load unpacked" button in `chrome://extensions`, so manual testing (below) is unaffected.

A downloaded, unbranded Chromium build (Playwright's bundled browser) was tried as a workaround, launched successfully a few times, then got silently deleted from disk mid-session — almost certainly quarantined by local security software as an unsigned/newly-downloaded binary. Microsoft Edge hung indefinitely on launch. None of these are extension bugs; they're this specific environment's browser-automation restrictions.

Given that, testing pivoted to what's both reliable here and highest-value: nearly all of the extension's actual logic — the canvas annotation editor, PDF export, IndexedDB handoff, and the content script's page-measurement/scroll/selection-overlay code — is plain browser JS with no dependency on `chrome.tabs`/`chrome.scripting`/`chrome.runtime` messaging. That code was loaded for real (via a local HTTP server serving the actual source files, with `chrome.tabs.create`/`chrome.downloads.download`/`chrome.runtime.getURL` mocked) and driven end-to-end with Playwright against a real, reliably-launching Chrome, with pixel-level and byte-level assertions, not just "did it throw."

The one thing this couldn't reach is the `chrome.tabs.captureVisibleTab` / `chrome.scripting.executeScript` orchestration itself (`background/service-worker.js`, `background/fullpage-capture.js`, the tab-query line in `popup.js`) — that needs an actually-installed extension. That code got a careful manual line-by-line audit instead (see commit history / conversation) and is comparatively low-risk: thin, well-documented Chrome API calls with an explicit message-passing contract, versus the freehand canvas/PDF-byte math that carried the real risk and got the live testing.

## Bugs found via live testing and fixed

1. **Annotation toolbar and crop buttons were visible by default, before ever clicking the edit icon.** The `hidden` HTML attribute's default `display:none` has the same CSS specificity as a class selector, so `.pp-annotate-bar { display: flex }` and `.pp-btn { display: inline-flex }` silently won over `[hidden]`. Confirmed via screenshot (toolbar fully visible immediately on load) and fixed by adding a `[hidden] { display: none !important; }` rule to `styles/theme.css`. Re-verified via `getComputedStyle` before/after entering edit mode.
2. **The Text annotation tool was completely non-functional.** Clicking to place text never showed the floating input. Root cause: `openTextInput()` calls `.focus()` on the input from inside the `pointerdown` handler, but without `event.preventDefault()`, the browser's native default mousedown action then blurs it again (the click target, an unfocusable `<canvas>`, triggers a focus-shift that steals it right back). Fixed by calling `e.preventDefault()` before `openTextInput()` in `result/result.js`. Re-verified end-to-end: input opens, accepts typed text, commits on Enter, and the glyphs land on the canvas in the selected color (confirmed both by pixel sampling and a screenshot).

## Verified live, with pixel/byte-level assertions (not just "no error thrown")

- **Annotation editor**: pen (incremental stroke), rectangle, circle, line, arrow, text (post-fix), blur, pixelate, crop, undo/redo (button-state *and* pixel-level before/after/redo verified), zoom (25–300% clamping verified at both ends).
- **PDF export**: all 7 page-size options produce a well-formed PDF (`%PDF-1.4` header, `%%EOF` trailer) with the correct page count for each — verified the pagination math empirically (e.g. a 580×680px image paginates to 2 pages on landscape sizes, 1 on portrait/full-image, matching hand-derived expectations) and the extreme-aspect-ratio clamp (very tall and very wide source canvases both clamp to ≤14400pt while preserving aspect ratio).
- **IndexedDB transfer buffer** (`lib/idb-store.js`): put → get → delete round-trip verified, including that a deleted record correctly returns `null` afterward.
- **PNG/JPEG/WEBP export**: real `canvas.toBlob()` calls verified to produce non-empty blobs with correct MIME types — no tainted-canvas errors.
- **Download flow**: correct filename pattern (`PagePixel_<slugified-title>_<timestamp>.<ext>`) and correct `chrome.downloads.download` call shape, for both an image format and PDF.
- **Copy to clipboard**: a real `navigator.clipboard.write()` call succeeds (granted clipboard permissions).
- **Help / Feedback / rating**: each opens the correct URL (`help/help.html` via `chrome.runtime.getURL`, and the Chrome Web Store placeholder URL for feedback/rating).
- **`content/content-script.js`**, driven against a real fixture page with a `position: fixed` header and known scroll height: `PP_MEASURE` reported exact expected `scrollHeight`; `PP_PREPARE_FULLPAGE` hid exactly the one fixed header and `PP_RESTORE_FULLPAGE` correctly restored its visibility and scroll position; `PP_SCROLL_TO` scrolled precisely; the drag-to-select overlay computed the exact expected rectangle from real mouse events and sent `PP_SELECTION_MADE`, then cleaned itself up.

## Manual checks still needed (require an actually-installed extension)

- [ ] Load unpacked (`chrome://extensions` → Developer mode → Load unpacked) and run all 3 capture modes on: a short static page, a long article, an infinite-scroll feed, a page with a sticky header, a page with lazy-loaded images.
- [ ] Confirm "Bottom to Top" fixes at least one page where the default direction breaks.
- [ ] Confirm PNG/JPEG/WEBP/PDF files actually saved to disk (this session verified the *generation* of correct bytes and the correct `chrome.downloads.download` call, but not a real disk write, since that API only exists in a real extension).
- [ ] Confirm copy-to-clipboard paste into an external app (Paint, Slack desktop, etc.) — this session verified `clipboard.write()` succeeds, not the paste side.
- [ ] Check the service worker's own console (`chrome://extensions` → "Inspect views: service worker") for errors during a real capture — this is the one execution path that couldn't be exercised at all this session.
- [ ] Test on Edge (Chromium-based) as well as Chrome stable.
- [ ] Basic accessibility pass: keyboard navigation through the popup and result-page toolbar, and contrast check on coral-on-white and white-on-teal text/icons.

## Known risk areas worth extra attention when testing live

- **`chrome.tabs.captureVisibleTab` rate limiting** — `background/fullpage-capture.js` retries with backoff on `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, but this was never exercised against the real API; worth confirming on a very long page with the delay set near 0.
- **Full-page stitching math** — slice placement is `Math.round(sliceY * devicePixelRatio)`; verify there's no visible seam/gap on a high-DPI display or a page with a non-standard zoom level.
- **Sticky/fixed-element hiding** — confirmed correct against the test fixture (see above), but is a by-design tradeoff: legitimate sticky headers won't appear at all in the final Full Page image (to avoid duplicates). Confirm this reads as expected rather than as a bug on a page that leans heavily on a sticky header for context.
- **Blur edge softening** — the blur tool draws the cropped region through a CSS `filter: blur()`, which samples outside the region as transparent and can leave a faint transparent fringe at the edge of the blurred box; acceptable for MVP but worth a visual check.
