# PagePixel — Capture & Annotate

A Manifest V3 Chrome extension for full-page / visible-area / selected-region screenshot capture, canvas-based annotation, PNG/JPEG/WEBP/PDF export, and one-click upload to a public link on `img.omwly.com`. Developed by **AdxFuel**.

Published: https://chromewebstore.google.com/detail/epcfhbbgdknmhomfimblbokfejlgdgne · Current version: **1.1.0**

## Repository layout

```
extension/        The shippable extension — the only folder that goes into the Web Store zip
upload-worker/    Cloudflare Worker behind https://upload.omwly.com/upload (stores into R2 img-omwly)
scripts/          build-zip.ps1 — packages extension/ into dist/PagePixel-<version>.zip
tests/extension/  In-browser tests for the extension's library modules
docs/             Store listing copy + Dashboard checklist, testing notes, design specs and plans
```

### extension/

```
manifest.json              MV3 manifest — permissions, icons, entry points
icons/                     16/32/48/128px action + manifest icons
assets/branding/           512px icon + wordmark lockups (help/privacy headers)
styles/theme.css           Shared design tokens (blue-teal gradient + coral accent) used by every page
popup/                     Toolbar popup — capture-mode picker + delay/direction options
content/content-script.js  Injected on demand (activeTab + scripting) — page measurement, scroll driver, drag-select overlay
background/service-worker.js       Message router; owns every chrome.tabs.captureVisibleTab call
background/fullpage-capture.js     Scroll → capture → stitch loop for Full Page mode
lib/idb-store.js           IndexedDB transfer buffer handing a capture from the worker to the result tab
lib/pdf-writer.js          Dependency-free PDF writer (JPEG pages via DCTDecode)
lib/encode.js              encodeCanvas() for every format + a lossless optimized PNG writer
lib/compress.js            prepareUpload(): fit the selected format under 5 MB, or measure a WEBP fallback
lib/upload-client.js       POST to the upload Worker, timeout, user-facing error messages
lib/upload-config.js       Endpoint + shared key (gitignored; copy upload-config.example.js)
result/                    Result tab — export toolbar (Copy / Download / Upload) + canvas annotation editor
share/                     Opened after an upload — preview, public URL, Copy link
help/help.html             In-app help, 10-section accordion
privacy/privacy.html       In-app privacy policy (a hosted copy is the Store's privacy URL — keep in sync)
_locales/en/messages.json  i18n strings (chrome.i18n)
```

## Load it locally

1. Create `extension/lib/upload-config.js` from `upload-config.example.js` (it holds the upload key and is never committed).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.
3. The unpacked build's ID is derived from its folder path. The Worker allows `chrome-extension://nokaihkhpnkfakngppmlgbnfajecnpem` (the ID for `F:\browser-extensions\PagePixel\extension`); if `chrome://extensions` shows a different ID, add it to `ALLOWED_ORIGINS` in `upload-worker/wrangler.toml` and redeploy.

## Architecture notes

- **No host permissions.** Capture is triggered by a user click (`activeTab`) and the content script is injected on demand via `scripting`. Uploads are ordinary CORS requests to `upload.omwly.com`, which answers for the extension's origin — so v1.1.0 adds no permissions and existing users aren't asked to re-approve anything.
- **`chrome.tabs.captureVisibleTab` only runs in the background service worker**, so all three capture modes route through `background/service-worker.js`.
- **Large images move via IndexedDB, not runtime messages** (`lib/idb-store.js`).
- **Every export goes through `lib/encode.js`.** Copy writes PNG (the only image type Chrome's clipboard accepts) after encoding in the selected format; Download and Upload keep the selected format.
- **Uploads:** `lib/compress.js` keeps the selected format and fits it under 5 MB (PNG is optimized losslessly; JPEG/WEBP/PDF step down 92% → 85% → 80%). If it still can't fit, the user is offered a measured WEBP. The Worker checks origin, shared key, a per-IP rate limit (10/min), the 5 MB cap and the file's magic bytes (PDFs must match `pdf-writer.js`'s exact structure), then stores the file in R2 under a random 22-character key. Images are served straight from R2 at `https://img.omwly.com/<key>`, permanently.
- **PDF export is hand-rolled** — no bundler, no third-party dependency.

## Upload Worker

```bash
cd upload-worker
npm install          # npm 11 may ask to approve workerd/esbuild install scripts: npm approve-scripts workerd esbuild
npm test             # vitest in the Workers runtime (local R2)
npx wrangler dev     # local server on :8787 using .dev.vars (UPLOAD_KEY=...)
npx wrangler deploy  # production; creates the upload.omwly.com custom-domain DNS record on first deploy
```

The shared key lives in the Worker secret `UPLOAD_KEY` (`npx wrangler secret put UPLOAD_KEY`) and in `extension/lib/upload-config.js`; the two must match. It ships inside the extension, so it only slows abuse down — the rate limit, size cap and type checks are the real protection.

## Tests

- Worker: `cd upload-worker && npm test`.
- Extension library: serve the repo root (`python -m http.server 8843`), open `http://127.0.0.1:8843/tests/extension/index.html` in Chrome and run `await runTests()` in the console.
- Manual checklist and history: `docs/TESTING.md`.

## Release

1. Bump `version` in `extension/manifest.json`.
2. `powershell -ExecutionPolicy Bypass -File scripts/build-zip.ps1` → `dist/PagePixel-<version>.zip`.
3. Follow the Dashboard checklist in `docs/STORE_LISTING.md`.
