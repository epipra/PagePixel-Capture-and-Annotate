# PagePixel v1.1.0 Cloud Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Upload (selected format, ≤ 5 MB after compression) to the PagePixel result page, backed by a Cloudflare Worker at upload.omwly.com that stores into R2 `img-omwly`. The link opens on a share page with Copy link.

**Architecture:** The extension encodes and compresses in the result page (`lib/encode.js`, `lib/compress.js`), then POSTs raw bytes (`lib/upload-client.js`) to the Worker. The Worker checks origin → key → rate limit → size → magic bytes, then puts the file into R2. Images are served by the bucket's existing public domain img.omwly.com.

**Tech Stack:** Chrome MV3 vanilla ES modules (no bundler); Cloudflare Workers JS, Wrangler 4.142, vitest 4.1 + @cloudflare/vitest-pool-workers 0.22 (`cloudflareTest()` plugin).

**Spec:** `docs/superpowers/specs/2026-09-28-cloud-upload-design.md`

## Global Constraints

- Upload budget and Worker `MAX_BYTES`: 5,242,880 bytes.
- Formats: png, jpeg (`.jpg`), webp, pdf. The selected format is kept; switching to WEBP happens only on the user's click in the oversize dialog.
- Quality ladder for JPEG/WEBP/PDF: 0.92 → 0.85 → 0.80 (floor).
- No new manifest permissions and no `host_permissions`. The manifest version is `1.1.0`.
- Public base URL: `https://img.omwly.com/`. Endpoint: `https://upload.omwly.com/upload`.
- Store origin: `chrome-extension://epcfhbbgdknmhomfimblbokfejlgdgne`.
- Never create or change the `img` DNS record. Deploying, DNS changes, pushing and store submission each need the user's approval.
- Code style: vanilla JS modules, minimal comments (only non-obvious WHY), no new runtime dependencies in the extension.

---

### Task 1: Upload Worker

**Files:**
- Create: `upload-worker/package.json`, `upload-worker/wrangler.toml`, `upload-worker/vitest.config.js`, `upload-worker/src/index.js`, `upload-worker/test/index.test.js`, `upload-worker/.gitignore`, `upload-worker/.dev.vars.example`
- Modify: `.gitignore` (root, new)

**Interfaces:**
- Produces: HTTP contract. `POST /upload` → `201 {url}`, or `4xx/5xx {error: code}`, where code ∈ `origin_not_allowed | bad_key | rate_limited | length_required | too_large | unsupported_type | storage_failed | not_found | method_not_allowed`. `OPTIONS /upload` → 204 with CORS.
- Exported helpers (unit-tested): `sniffType(bytes: Uint8Array) → {ext, contentType} | null`, `pdfHasActiveContent(bytes: Uint8Array) → boolean`, `newKey(ext) → string`.

- [ ] Step 1: Write `test/index.test.js` covering:
  - 201 for each of the 4 types: R2 object exists, the content type matches the sniffed bytes (not the client header), cacheControl is immutable, the key matches `/^[A-Za-z0-9_-]{22}\.(png|jpg|webp|pdf)$/`.
  - Preflight 204 with ACAO echo.
  - 403 for a bad origin (no ACAO); 403 for a missing or wrong key.
  - 429 when the limiter returns `{success:false}`.
  - 411 when there's no Content-Length; 413 for 5,242,881 bytes.
  - 415 for SVG, HTML, and PDF with `/JavaScript` in its dictionary.
  - 201 for a PDF whose *stream data* contains `/JS`.
  - 404 for other paths; 405 for GET.
- [ ] Step 2: `npm test` → fails (no src).
- [ ] Step 3: Implement `src/index.js` per spec §2.
- [ ] Step 4: `npm test` → all pass.
- [ ] Step 5: Commit `feat(worker): upload endpoint with origin/key/rate/size/type checks`.

### Task 2: Encoding + optimized PNG (`extension/lib/encode.js`)

**Interfaces:**
- Produces: `encodeCanvas(canvas, format, {quality, pdfPageSize}) → Promise<Blob>`, where format ∈ `png|jpeg|webp|pdf`. `encodePngOptimized(canvas) → Promise<Blob>`. `FORMAT_INFO[format] = {mime, ext, label}`.

- [ ] Step 1: Browser test page `tests/extension/encode.test.html` (served over local HTTP): the optimized PNG decodes pixel-identical to the source canvas (opaque and transparent cases) and is smaller than `toBlob('image/png')` on text/UI content; JPEG/WEBP produce the correct MIME; PDF starts with `%PDF-`.
- [ ] Step 2: Run in Chrome via DevTools MCP → fails (module missing).
- [ ] Step 3: Implement (the encoder from the brainstorming spike: opaque → RGB, per-row min-sum-abs filter choice, `CompressionStream('deflate')`, CRC32 chunks).
- [ ] Step 4: Re-run → pass.
- [ ] Step 5: Commit.

### Task 3: Compression plan (`extension/lib/compress.js`)

**Interfaces:**
- Consumes: `encodeCanvas`.
- Produces: `MAX_UPLOAD_BYTES = 5242880`, `QUALITY_LADDER = [0.92, 0.85, 0.80]`. `prepareUpload(canvas, format, {pdfPageSize, maxBytes}) → Promise<{ ok: true, blob, format, quality, note } | { ok: false, reason: 'too_large', size, format, fallback: {blob, format:'webp', quality} | null }>`.

- [ ] Step 1: Tests (same harness), using a small `maxBytes` to force the paths: a PNG that fits → ok, quality null; JPEG over the budget at 0.92 but under at 0.85 → quality 0.85; everything over the budget → ok:false with a webp fallback; fallback also too big → fallback null.
- [ ] Step 2–4: fail → implement → pass.
- [ ] Step 5: Commit.

### Task 4: Upload client (`extension/lib/upload-client.js`, `upload-config.example.js`)

**Interfaces:**
- Consumes: `lib/upload-config.js` exporting `UPLOAD_ENDPOINT`, `UPLOAD_KEY`.
- Produces: `uploadBlob(blob, {fetchImpl, timeoutMs}) → Promise<{url}>`, which throws `UploadError {code, message}` (codes as in the Worker, plus `network`, `bad_response`); `UPLOAD_MESSAGES[code]` holds the user-facing strings from spec §3.

- [ ] Step 1: Tests with a stubbed `fetchImpl`: 201 → url; 429/403/413/415/500 → the right message; a rejected fetch → network; a url outside img.omwly.com → bad_response.
- [ ] Step 2–4: fail → implement → pass.
- [ ] Step 5: Commit.

### Task 5: Result page integration and share page

**Files:** `extension/result/result.{html,js,css}`, `extension/share/share.{html,js,css}`, `extension/manifest.json` (1.1.0), `.gitignore`.

- [ ] Add the Upload button, the oversize `<dialog>`, and busy states. Copy uses the selected format and is disabled for PDF. Download uses `encodeCanvas`. Set `STORE_LISTING_URL` to the real URL.
- [ ] Share page: validates the `url` param prefix, shows a preview or PDF card, Copy link, Open.
- [ ] Browser test: with mocked `chrome.tabs.create` and a stubbed fetch, clicking Upload opens `share/share.html?url=…`; the share page rejects `https://evil.example/x.png`; Copy is disabled for PDF.
- [ ] Commit.

### Task 6: Docs, privacy, help, packaging

- [ ] Rewrite `privacy.html` (spec §4); add help §10; update help §9; update `STORE_LISTING.md` plus the Dashboard checklist; update `TESTING.md` and `README.md`; add `scripts/build-zip.ps1` (fails if `upload-config.js` is missing; zips `extension/` → `dist/`); point `.claude/launch.json` at `extension/`.
- [ ] Commit.

### Task 7: Local end-to-end

- [ ] `wrangler dev` (local R2) with `.dev.vars` `UPLOAD_KEY`. Point a test copy of `upload-config` at `http://localhost:8787/upload`, upload from the served result page, then GET the object from local R2 and assert its bytes equal the uploaded blob.

### Task 8: Deploy (user-gated)

- [ ] The user runs `npx wrangler login` and `npx wrangler secret put UPLOAD_KEY`, then approves `npx wrangler deploy` (creates the upload.omwly.com record).
- [ ] Smoke test: preflight + a tiny PNG upload with the real key → the returned URL serves over img.omwly.com (resolved via DoH).
- [ ] Build the zip.
