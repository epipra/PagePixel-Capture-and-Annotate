# Testing status

## v1.1.0 — Cloud Upload (2026-09-28)

### Automated, passing

- **Upload Worker — 46 vitest tests** in the real Workers runtime with local R2 (`cd upload-worker && npm test`):
  - Each of PNG/JPEG/WEBP/PDF is stored with the content type taken from its bytes (not the client header), immutable cache control, and byte-identical content; the URL has a 22-char key.
  - CORS preflight works; unknown or missing Origin gets 403 with no CORS headers.
  - Missing or wrong key → 403. The rate limiter is called with `CF-Connecting-IP` → 429.
  - 5 MB + 1 byte → 413; exactly 5 MB → 201; an oversized Content-Length → 413 early.
  - Empty/SVG/HTML/GIF/non-WEBP RIFF → 415; unknown path → 404; GET → 405; R2 failure → 500.
  - The PDF allowlist accepts both real `pdf-writer.js` layouts, including look-alike `/JS` bytes inside image data. It rejects OpenAction, hex-escaped `/J#53`, string literals, `/URI`, non-DCT filters, data appended after `%%EOF`, a wrong `/Length`, and an altered content stream.
  - After the security review: xref offsets, startxref, references and JPEG SOI/EOI inside PDFs are checked (a Catalog hidden in image bytes and targeted by the xref is rejected); PNG trailing data, unknown chunks and a non-IHDR first chunk, JPEG without EOI or with trailing data, and a mismatched WEBP RIFF size → 415; a 3 MB PDF tail is rejected without throwing; IPv6 is rate-limited per /64.
  - Mutation checks confirmed the tests fail when the rate-limit, PDF-name, xref-offset or PNG-IEND check is removed.
  - Re-run against `wrangler dev` after hardening: 8 real PagePixel outputs (full-page PNG and multi-page PDF, transparent PNG, JPEG, WEBP, lossless WEBP, full-image and A4 PDFs) are all accepted.
- **Extension library — 25 in-browser tests** in real Chrome 154 (`tests/extension/index.html`):
  - The optimized PNG is pixel-identical to Chrome's PNG (opaque, transparent, 1×1 and odd sizes) and smaller.
  - `encodeCanvas` MIME types are correct for all 4 formats, and lower quality gives smaller files.
  - Quality ladder: 0.92 when it fits, then 0.85, then the 0.80 floor for PDF. Oversize PNG → measured WEBP fallback; none if even WEBP 0.80 doesn't fit; WEBP never offers itself.
  - The upload client maps 429/403/413/415/500/502/network/timeout/foreign-URL responses to the specified messages.
- **Real-page measurement**: a 1234×50157 full-page capture of developer.chrome.com:
  - Chrome PNG 6.5 MB → optimized PNG 4.3 MB, lossless, which fits the 5 MB limit (~8 s).
  - On a 16,000 px slice: −34% (2.07 → 1.36 MB), pixel-identical.
  - Chrome 154 handled the 50,157 px canvas without hitting a size limit.
- **Result + share pages** (served source; only `chrome.*` and the upload `fetch` mocked):
  - Feedback opens the real listing URL. Copy is disabled for PDF, with its tooltip.
  - Upload in each of the 4 formats sends the right bytes, type and key, then opens `share/share.html?url=…&fmt=…&size=…`, with busy labels and restored buttons.
  - A 429 shows "Too many uploads…" and opens no tab. Download still works.
  - Oversize: a 6.4 MB noise PNG opens the dialog. Cancel uploads nothing; accept uploads the measured 1.9 MB WEBP.
  - The share page rejects `https://evil.example/x.png` and shows the PDF card, a pre-selected URL and "Open PDF".
- **Local end-to-end against `wrangler dev`** (the real Worker with local R2), using the real `upload-client.js` and key:
  - The 50,157 px real capture uploaded as PNG (4.49 MB, lossless), as a multi-page PDF (0.85) and as JPEG (0.85). SHA-256 of each stored R2 object equals the bytes sent.
  - Wrong key → `bad_key`; an SVG labelled `image/png` → `unsupported_type`.
  - The rate limit trips after 10 uploads per minute.
- `scripts/build-zip.ps1` produces a 33-entry zip. `manifest.json` is at the root, all paths use forward slashes, and there are no docs, tests or example config inside.

### Manual checks for v1.1.0 (need the installed extension — Load unpacked `extension/`)

- [ ] `chrome://extensions` shows ID `nokaihkhpnkfakngppmlgbnfajecnpem` for the unpacked build (otherwise add the shown ID to `ALLOWED_ORIGINS` and redeploy).
- [ ] Visible Area, Full Page and Selected Area captures → Upload works for each, in PNG, JPEG, WEBP and PDF; the share tab opens.
- [ ] Share tab → Copy link → paste the link in an incognito window: it opens without signing in.
- [ ] Copy with JPEG selected → paste into Paint/Slack works; toast says "pasted as PNG".
- [ ] A very long Full Page capture → the oversize dialog (or a lossless fit) behaves as described.
- [ ] Offline (DevTools → Network → Offline on the result tab) → "Couldn't reach img.omwly.com…".
- [ ] 11 uploads within a minute → "Too many uploads…".
- [ ] The service worker console shows no errors during capture.

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
