# PagePixel v1.1.0 — Cloud Upload: design

Status: approved in brainstorming 2026-09-28 (sections 1–3 explicitly, 4–5 under the user's "go ahead till complete end-to-end").

## Goal

Take Screenshot → Select Format → Copy / Download / Upload. Upload sends the annotated image, in the selected format, to `img.omwly.com` and opens a new tab with a permanent public URL and a Copy-link button. Works for every capture mode (Visible Area, Full Page, Selected Area) because all three end on the same result canvas.

## 1. Architecture & layout

```
PagePixel/
├── extension/            the only folder zipped for the Web Store
│   ├── lib/encode.js         NEW encodeCanvas(canvas, format, quality) → Blob; optimized lossless PNG
│   ├── lib/compress.js       NEW prepareUpload(canvas, format, pdfPageSize) → plan (5 MB budget)
│   ├── lib/upload-client.js  NEW uploadBlob(blob) → { url } | throws UploadError(code, message)
│   ├── lib/upload-config.js  gitignored { UPLOAD_ENDPOINT, UPLOAD_KEY }; example committed
│   ├── result/               + Upload button, oversize dialog, Copy in selected format, store URL fix
│   ├── share/                NEW share page: preview, URL field, Copy link, Open
│   └── help/ privacy/        rewritten for uploads
├── upload-worker/        Cloudflare Worker (Wrangler, vitest + @cloudflare/vitest-pool-workers)
├── scripts/build-zip.ps1 zips extension/ → dist/PagePixel-<version>.zip
└── docs/
```

- No new manifest permissions and still no `host_permissions` (a new host permission would disable the extension for existing users until they re-accept). The Worker answers CORS for the extension origin instead.
- Service worker, content script, popup, IndexedDB handoff and PDF writer are unchanged.
- Version 1.1.0. `STORE_LISTING_URL` → `https://chromewebstore.google.com/detail/epcfhbbgdknmhomfimblbokfejlgdgne`.

## 2. Compression layer and Worker

### Compression (`lib/compress.js`) — budget 5 MB (5,242,880 bytes), selected format is kept

| Format | Step 1 | Step 2 (only if > 5 MB) |
|---|---|---|
| PNG | Optimized lossless PNG (drop alpha when fully opaque, per-row filter choice, native `CompressionStream('deflate')`) — pixel-identical, measured 34–53% smaller than Chrome's PNG | none |
| JPEG / WEBP | quality 0.92 (same as Download) | 0.85, then 0.80 (floor) |
| PDF | `buildPdfFromCanvas(canvas, size, 0.92)` | 0.85, then 0.80 |

Still > 5 MB → in-page dialog: "This PNG is 7.1 MB even after lossless optimization (limit 5 MB)." [Upload as WEBP (~1.4 MB)] [Cancel]. The WEBP size shown is the actually-encoded blob (0.92 → 0.80 ladder). If that is also > 5 MB: "Too large to upload — use Download instead." Nothing uploads without the user's click.

The optimized PNG encoder is also used by Download and Copy for PNG (same pixels, smaller file).

### Worker — `POST https://upload.omwly.com/upload`, body = raw bytes

Checks in order:
1. `Origin` ∈ `ALLOWED_ORIGINS` (comma-separated var) → else 403 `origin_not_allowed`
2. `X-PagePixel-Key` equals secret `UPLOAD_KEY` (constant-time compare) → else 403 `bad_key`
3. Rate limit binding keyed by `CF-Connecting-IP`, 10 / 60 s → else 429 `rate_limited`
4. `Content-Length` present and ≤ `MAX_BYTES` (5,242,880), actual body length equal and ≤ cap → else 411/413 `too_large`
5. Magic bytes: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WEBP `RIFF????WEBP`, PDF `%PDF-`. PDFs containing `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile`, `/URI`, `/SubmitForm`, `/RichMedia` are rejected → else 415 `unsupported_type`. The token scan skips `stream … endstream` bodies: JPEG page data is near-random bytes and would otherwise match `/JS` by chance in roughly a third of large PDFs.
6. `BUCKET.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })` → 500 `storage_failed` on error
7. 201 `{ "url": "https://img.omwly.com/<key>" }`

- Key: 16 bytes from `crypto.getRandomValues` → base64url (22 chars) + `.png|.jpg|.webp|.pdf`. Content type derives from the sniffed bytes, never the client header.
- Only `POST /upload` and `OPTIONS /upload`; other paths 404, other methods 405.
- CORS: allowed origins are echoed in `Access-Control-Allow-Origin` with `Vary: Origin` on every response. Preflight allows `POST`, headers `Content-Type, X-PagePixel-Key`, `Max-Age: 86400`.
- Stores nothing but the image: no IPs, URLs, titles.
- Reads never touch the Worker: `img.omwly.com` is the R2 bucket's public custom domain (not modified).
- Config (`wrangler.toml`): `custom_domain` route `upload.omwly.com` (creates that one DNS record on deploy), R2 binding `BUCKET` → `img-omwly`, `ratelimits` binding `UPLOAD_LIMITER`, vars `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `MAX_BYTES`. Secret `UPLOAD_KEY` set by the user via `wrangler secret put`.

## 3. Extension UX

- Toolbar: `[format ▾] [PDF size ▾] [Copy] [Download] [☁ Upload]`.
- Copy: encode in the selected format, then decode and re-encode to PNG for the clipboard (the only image type Chrome's clipboard accepts). Toast "Copied (JPEG quality, pasted as PNG)"; plain "Copied to clipboard" for PNG. Disabled for PDF, with the title "PDF can't be copied — use Download or Upload".
- Upload: Copy, Download, Upload and the format selectors are disabled during work. The button reads "Optimizing…" then "Uploading…". On success `chrome.tabs.create(share/share.html?url=…&fmt=…&size=…)`; the result tab stays open. The toast reports compression ("Optimized PNG 5.4 → 3.6 MB, lossless").
- Share page: accepts only URLs starting with `https://img.omwly.com/`, otherwise shows an error. It shows an image preview (or a PDF card), a read-only pre-selected URL field, [Copy link] → "Copied ✓", [Open image/PDF], format · size, and "Anyone with this link can view it. Links are permanent."
- Error toasts: 429 "Too many uploads — try again in a minute."; 403 "Upload not authorized — please update PagePixel."; 411/413/415 "This file couldn't be accepted (too large or unsupported)."; network error or 60 s timeout "Couldn't reach img.omwly.com — check your connection."; other "Upload failed — please try again."
- Help: new section 10, "Upload & Share".
- Out of scope: upload history, deleting uploads, accounts.

## 4. Privacy, listing and Dashboard

- `privacy/privacy.html` is rewritten. Nothing leaves the browser unless the user clicks Upload. Upload sends only the current image (with annotations) to PagePixel's server at upload.omwly.com (Cloudflare). It is stored publicly and permanently at img.omwly.com under a random unguessable URL, and anyone with the link can view it. Nothing else is sent: no page URL, title or account. There are no analytics. The IP is used transiently for rate limiting and not stored by PagePixel; Cloudflare, as host, processes requests under its own policy. For removal, contact via the store listing with the link.
- `help.html` §9 wording is fixed, and §10 is added.
- `docs/STORE_LISTING.md`: the description gains the Upload feature, and "no backend" is removed. A Dashboard checklist is added:
  1. Privacy practices → Data usage: tick **Website content** (the uploaded screenshots). Certify: not sold, not used for purposes unrelated to the single purpose, not used for creditworthiness.
  2. Update the hosted privacy policy (the Google Doc) to match `privacy.html`.
  3. Permission justifications are unchanged (no new permissions).
  4. Upload the 1.1.0 zip and submit for review.

## 5. Testing

- Worker: vitest + `@cloudflare/vitest-pool-workers` (local R2 and rate-limit simulation). Covers: happy path for each of the 4 types (object stored with the right content type and cache control, URL returned), CORS preflight, bad origin, missing or wrong key, missing Content-Length, oversize, bad magic bytes, SVG/HTML refused, PDF with `/JavaScript` refused, rate limited (mocked limiter), unknown path and method.
- Extension logic: the HANDOFF pattern. Serve `extension/` over local HTTP, mock only `chrome.*`, drive real Chrome (DevTools MCP / Playwright) with byte and pixel assertions:
  - The optimized PNG is pixel-identical to the canvas and smaller.
  - The compression ladder picks the right quality, and the oversize path returns the WEBP offer.
  - The upload client maps each status to the right error.
  - The share page rejects a foreign URL.
  - An end-to-end upload against `wrangler dev` returns a URL that serves the same bytes.
- Manual (the user, Load unpacked): all 3 capture modes × Upload in PNG/JPEG/WEBP/PDF; share page copy link; open the link in a private window; the oversize dialog on a very long page; the rate-limit message.
