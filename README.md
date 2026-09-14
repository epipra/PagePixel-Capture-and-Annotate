# PagePixel — Capture & Annotate

A Manifest V3 Chrome extension for full-page / visible-area / selected-region screenshot capture, canvas-based annotation, and PNG/JPEG/WEBP/PDF export. Developed by **AdxFuel**.

Full product spec and rationale: `../PagePixel-BUILD-GUIDE.md` (one level up, in the repo root). This folder is the self-contained, shippable extension package — everything Chrome needs to load and everything a reviewer needs to understand it lives in here.

## Load it locally

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`PagePixel Capture and Annotate/`).
4. Pin the PagePixel icon from the extensions toolbar overflow menu for quick access.

To reload after edits: click the refresh icon on the extension's card in `chrome://extensions`. If you edited `background/service-worker.js` or its imports, that's enough — service workers reload automatically on next use, but a manual refresh guarantees it.

## Project layout

```
manifest.json              MV3 manifest — permissions, icons, entry points
icons/                     16/32/48/128px action + manifest icons
assets/branding/           512px icon + wordmark lockups (not manifest-required, used in help/privacy headers)
styles/theme.css           Shared design tokens (blue-teal gradient + coral accent) used by every page
popup/                     Toolbar popup — capture-mode picker + delay/direction options
content/content-script.js  Injected on demand (activeTab + scripting) — page measurement, scroll driver, drag-select overlay
background/service-worker.js       Message router; owns every chrome.tabs.captureVisibleTab call
background/fullpage-capture.js     Scroll → capture → stitch loop for Full Page mode
lib/idb-store.js           IndexedDB transfer buffer handing a capture from the worker to the result tab
lib/pdf-writer.js          Dependency-free PDF writer (JPEG pages via DCTDecode) for the PDF export option
result/                    Result tab — export toolbar + canvas annotation editor
help/help.html             In-app help, 9-section accordion
privacy/privacy.html       In-app privacy policy (also needs external hosting for the Store dashboard — see docs/STORE_LISTING.md)
_locales/en/messages.json  i18n strings (chrome.i18n) — add more locale folders here as translations land
docs/                      Store listing draft + testing checklist status
```

## Architecture notes

- **No broad host permissions.** Capture is triggered by a user click (`activeTab`), and the content script is injected on demand via `scripting` rather than declared as a static content script — this is what keeps `host_permissions` empty.
- **`chrome.tabs.captureVisibleTab` only runs in the background service worker** (it's not available to content scripts), so all three capture modes route through `background/service-worker.js`, which drives the content script over `chrome.tabs.sendMessage` for scrolling and the selection overlay.
- **Large images move via IndexedDB, not runtime messages.** A composited full-page screenshot can be many megabytes — passing that through `chrome.runtime.sendMessage` or `chrome.storage` risks size limits, so the background worker writes the final blob into a shared IndexedDB store (`lib/idb-store.js`, no extra permission required) and opens `result.html?captureId=...`, which reads it back and deletes the temp record. The `storage` permission itself is used for something much smaller: remembering the popup's last-used capture mode/delay/direction via `chrome.storage.local`.
- **PDF export is hand-rolled**, not a vendored library. The extension only ever needs to place JPEG-encoded pages on a PDF canvas, so `lib/pdf-writer.js` builds that narrow PDF structure directly — no bundler, no third-party dependency to audit or keep patched.

## What's implemented (MVP — build guide §3.1 / §3.3.1)

- Visible Area, Full Page (with configurable delay + bottom-to-top toggle, sticky/fixed-element hiding), and Selected Area capture.
- Result screen with zoom (25–300%), PNG/JPEG/WEBP/PDF export (7 PDF page-size options incl. "Full Image"), copy-to-clipboard, and a canvas annotation editor (pen, rectangle/circle/line/arrow, text, blur, pixelate, crop, color + brush size, undo/redo with keyboard shortcuts).
- Help page (9 sections) and an in-extension privacy policy.
- Minimal permission set: `activeTab`, `scripting`, `downloads`, `clipboardWrite`, `storage`.

**Not built yet — intentionally deferred to Phase 2** (build guide §3.2/§3.3.2): batch/multi-tab capture, scheduled capture, element-picker capture, watermarking, redaction regex, device-frame mockups, cloud upload/share, SVG export, screenshot history/gallery, OCR, context-menu shortcuts, custom global keyboard shortcuts.

## Before publishing

See `docs/STORE_LISTING.md` for the fields to fill in on the Chrome Web Store Developer Dashboard, and `docs/TESTING.md` for the manual test pass to run first. Account registration, the zip upload, and clicking "Submit for review" are dashboard actions only the account holder can do.
