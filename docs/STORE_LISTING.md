# Chrome Web Store listing — draft copy

Fill these into the Developer Dashboard when submitting (build guide §7). Everything here is a draft the account holder should review/edit before publishing — nothing has been submitted.

## Basics

- **Extension name:** PagePixel — Capture & Annotate
- **Category:** Productivity (Tools is the fallback if Productivity doesn't fit)
- **Language:** English (add more once `_locales/` grows beyond `en`)

## Short summary (~132 chars)

> Capture full-page, visible, or selected screenshots, annotate them, then export as PNG/JPEG/WEBP/PDF or upload for a public link.

(129 characters — v1.1.0)

## Full description (draft)

> **PagePixel — Capture & Annotate** is a fast, privacy-respecting screenshot tool for Chrome.
>
> **Capture exactly what you need**
> - Visible Area — grab what's on screen in one click
> - Full Page — auto-scrolls and stitches the entire page, even past sticky headers
> - Selected Area — drag to capture just a region
>
> **Annotate before you share**
> Open the built-in editor to draw with a pen, add shapes and arrows, drop in text, blur or pixelate sensitive info, crop, and zoom from 25% to 300% — all with undo/redo.
>
> **Export your way**
> Download as PNG, JPEG, or WEBP, export a print-ready PDF (7 page-size options, including a single continuous "Full Image" page for long captures), or copy straight to your clipboard — no forced file saves.
>
> **Upload & share in one click** (new in 1.1)
> Click Upload to get a permanent public link on img.omwly.com — it opens in a new tab with a one-click Copy link. Works for every capture mode and every format. PagePixel optimizes the file first (lossless for PNG) so uploads stay small and fast. No account needed.
>
> **Your data stays yours**
> PagePixel collects no browsing data and has no analytics. Captures and edits happen locally in your browser; an image only leaves your device when you click Upload, and then only that image is sent. Uploaded links are public — anyone with the link can view them. See the privacy policy for details.
>
> Developed by AdxFuel.

## Store icon

Pulled automatically from `manifest.json`'s 128×128 icon (`icons/icon128.png`) — no separate upload needed.

## Screenshots (1280×800 or 640×400 — at least 1 required, up to 5 recommended)

Not yet captured — this requires a live Chrome session (Load unpacked, per the README) and can't be produced from this environment. Suggested shots, in priority order:

1. Popup with the three capture-mode options visible.
2. Result screen mid-annotation (a shape + text + a blurred region visible) — this is the strongest differentiator vs. Chrome's native screenshot tools.
3. The PDF export page-size dropdown open, showing all 7 options.
4. Full-page capture of a long page, zoomed out, to show stitching quality.
5. The help page's accordion, expanded.

## Promo tile images (optional)

Small tile 440×300 and marquee 1400×560 — can be composed from `assets/branding/wordmark_on_white.png` / `wordmark_on_dark.png` plus one of the screenshots above once captured. Not yet produced.

## Privacy

- **Privacy policy URL (required):** The Store dashboard requires a URL reachable *outside* the extension — `chrome-extension://…` URLs aren't accepted. The policy content lives at `privacy/privacy.html` (in-package) and `/root/extension-development/privacy-policy.html` (standalone, for public hosting). Currently hosted as a Google Doc: https://docs.google.com/document/d/14vQEE5CEm0Y5mSzAeQjL8Ve4oPGsGx_e6ERgZyEEoDs — **use the Publish-to-web or view-only link, not the `/edit` link**, when pasting into the Dashboard, so the public can't modify it. Keep all copies in sync if the policy changes.
- **Privacy practices tab — permission justifications** (plain-language, one line each, ready to paste in):
  - `activeTab` — "Captures and, for Full Page/Selected Area, briefly scrolls only the tab you click the extension on."
  - `scripting` — "Injects the on-page helper that measures the page, scrolls it for Full Page capture, and draws the drag-to-select overlay — only runs when you trigger a capture."
  - `downloads` — "Saves your exported screenshot/PDF to disk when you click Download."
  - `clipboardWrite` — "Copies the current image to your clipboard when you click Copy."
  - `storage` — "Remembers your last-used capture mode, delay, and direction settings locally, so the popup opens with your preferences next time."
- **Data collection disclosure (changed in 1.1.0):** v1.0.0 declared "no data collected". With Upload, the screenshot a user chooses to upload is transmitted and stored, so the Data Usage section must now declare it (see the checklist below).

## v1.1.0 Dashboard checklist (account holder)

1. **Privacy practices → Data usage:** tick **Website content** (the screenshots users choose to upload). Leave everything else unticked: no personally identifiable info, health, financial, authentication, personal communications, location, web history, or user activity is collected.
2. Tick all three certifications: data is **not sold** to third parties, **not used or transferred for purposes unrelated to the item's single purpose**, and **not used to determine creditworthiness or for lending**.
3. **Single purpose** description (if asked to update): "Capture, annotate, and export or share screenshots of the current web page."
4. **Permission justifications:** unchanged — v1.1.0 adds no permissions and no host permissions (uploads use a CORS request to upload.omwly.com).
5. **Remote code:** still "No" — the extension only sends image bytes to its upload endpoint and never loads or executes remote code.
6. **Privacy policy URL:** update the hosted Google Doc to match `extension/privacy/privacy.html` (the Uploading and sharing section, the new Data sharing wording, and the September 28, 2026 date) *before* submitting. Use the Publish-to-web/view-only link.
7. **Store listing:** paste the new short summary and full description above; optionally add a screenshot of the share page.
8. **Package:** upload `dist/PagePixel-1.1.0.zip` (built by `scripts/build-zip.ps1`) and submit for review.

## Visibility

Recommend starting **Unlisted** for a first internal/self test pass, then switching to **Public** once satisfied.

## Listing URL

Published as https://chromewebstore.google.com/detail/epcfhbbgdknmhomfimblbokfejlgdgne. `STORE_LISTING_URL` in `extension/result/result.js` (Feedback button and star rating) points there as of v1.1.0.
