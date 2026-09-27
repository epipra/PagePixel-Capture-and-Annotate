// Orchestrates Full Page capture: drives the content script through a
// scroll → wait → captureVisibleTab loop (captureVisibleTab is only callable
// from the background context, so the driving logic has to live here rather
// than in the content script) and stitches the resulting slices into one
// tall PNG using OffscreenCanvas.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

// chrome.tabs.captureVisibleTab is rate-limited (Chrome throws
// MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND if called too often) — a low
// user-configured delay can trip this on long pages, so retry with backoff
// instead of failing the whole capture.
async function captureVisibleTabWithRetry(windowId, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      const message = String((err && err.message) || err);
      if (i === attempts - 1 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message)) throw err;
      await wait(400 * (i + 1));
    }
  }
}

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * @param {chrome.tabs.Tab} tab
 * @param {{ delayMs?: number, bottomToTop?: boolean }} options
 * @param {(p: { phase: string, current: number, total: number }) => void} onProgress
 * @returns {Promise<Blob>} composited PNG blob
 */
export async function captureFullPage(tab, options = {}, onProgress = () => {}) {
  const { delayMs = 150, bottomToTop = false } = options;
  const tabId = tab.id;
  const windowId = tab.windowId;

  const metrics = await sendToTab(tabId, { type: 'PP_MEASURE' });
  const { scrollHeight, viewportHeight, initialScrollY, devicePixelRatio, scrollbarWidth = 0 } = metrics;

  await sendToTab(tabId, { type: 'PP_PREPARE_FULLPAGE' });

  const positions = [];
  let y = 0;
  const maxY = Math.max(0, scrollHeight - viewportHeight);
  while (y < maxY) {
    positions.push(y);
    y += viewportHeight;
  }
  positions.push(maxY);
  const uniquePositions = [...new Set(positions)];
  const order = bottomToTop ? [...uniquePositions].reverse() : uniquePositions;

  const slices = [];
  try {
    for (let i = 0; i < order.length; i++) {
      const pos = order[i];
      await sendToTab(tabId, { type: 'PP_SCROLL_TO', y: pos });
      await wait(delayMs);
      const dataUrl = await captureVisibleTabWithRetry(windowId);
      slices.push({ y: pos, dataUrl });
      onProgress({ phase: 'capture', current: i + 1, total: order.length });
    }
  } finally {
    await sendToTab(tabId, { type: 'PP_RESTORE_FULLPAGE', scrollY: initialScrollY }).catch(() => {});
  }

  slices.sort((a, b) => a.y - b.y);
  onProgress({ phase: 'stitch', current: 0, total: 1 });
  return stitchSlices(slices, devicePixelRatio || 1, scrollbarWidth);
}

// Every slice includes the page's scrollbar with its thumb at a different position, so the
// strip is trimmed off the right edge (the narrower canvas simply clips it).
export async function stitchSlices(slices, dpr, scrollbarWidth = 0) {
  const bitmaps = await Promise.all(slices.map((s) => createImageBitmap(dataUrlToBlob(s.dataUrl))));
  const width = Math.max(1, bitmaps[0].width - Math.round(scrollbarWidth * dpr));
  const lastIdx = slices.length - 1;
  const totalHeight = Math.round(slices[lastIdx].y * dpr) + bitmaps[lastIdx].height;

  const canvas = new OffscreenCanvas(width, Math.max(totalHeight, bitmaps[0].height));
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < slices.length; i++) {
    const destY = Math.round(slices[i].y * dpr);
    ctx.drawImage(bitmaps[i], 0, destY);
    bitmaps[i].close();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
