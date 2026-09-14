# Chrome Web Store listing — draft copy

Fill these into the Developer Dashboard when submitting (build guide §7). Everything here is a draft the account holder should review/edit before publishing — nothing has been submitted.

## Basics

- **Extension name:** PagePixel — Capture & Annotate
- **Category:** Productivity (Tools is the fallback if Productivity doesn't fit)
- **Language:** English (add more once `_locales/` grows beyond `en`)

## Short summary (~132 chars)

> Capture full-page, visible-area, or selected screenshots, annotate them, and export as PNG/JPEG/WEBP/PDF — right in your browser.

(131 characters)

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
> **Your data stays yours**
> PagePixel collects no browsing data, no analytics, and has no backend. Every capture and edit happens locally in your browser. See the privacy policy for details.
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

- **Privacy policy URL (required):** The Store dashboard requires a URL reachable *outside* the extension — `chrome-extension://…` URLs aren't accepted. The policy content already lives at `privacy/privacy.html` in this package; **host that page publicly (e.g. GitHub Pages) before submission** and paste the resulting URL into the dashboard's Privacy Policy field. Keep the two copies in sync if the policy changes.
- **Privacy practices tab — permission justifications** (plain-language, one line each, ready to paste in):
  - `activeTab` — "Captures and, for Full Page/Selected Area, briefly scrolls only the tab you click the extension on."
  - `scripting` — "Injects the on-page helper that measures the page, scrolls it for Full Page capture, and draws the drag-to-select overlay — only runs when you trigger a capture."
  - `downloads` — "Saves your exported screenshot/PDF to disk when you click Download."
  - `clipboardWrite` — "Copies the current image to your clipboard when you click Copy."
  - `storage` — "Remembers your last-used capture mode, delay, and direction settings locally, so the popup opens with your preferences next time."
- **Data collection disclosure:** none — no data is collected, transmitted, or sold. State this plainly in the Data Usage section of the Privacy Practices tab.

## Visibility

Recommend starting **Unlisted** for a first internal/self test pass, then switching to **Public** once satisfied.

## After first publish

- Note the generated Chrome Web Store item URL and replace the `STORE_LISTING_URL` placeholder in `result/result.js` (used by the Feedback button and star-rating widget) with the real listing URL, then ship that as a `1.0.1` update.
