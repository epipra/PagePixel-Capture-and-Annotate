import { captureFullPage, dataUrlToBlob } from './fullpage-capture.js';
import { putCapture, newCaptureId } from '../lib/idb-store.js';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[PagePixel]', err);
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    });
  return true; // keep the message channel open for the async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'PP_CAPTURE_VISIBLE':
      return captureVisible(message.tabId, message.delayMs);
    case 'PP_CAPTURE_FULLPAGE':
      return runFullPageCapture(message.tabId, message.options);
    case 'PP_SELECTION_MADE':
      return captureSelection(sender.tab, message.rect, message.devicePixelRatio, message.delayMs);
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

async function storeAndOpen(blob, mode, tab) {
  const id = newCaptureId();
  await putCapture(id, {
    blob,
    mode,
    sourceUrl: tab?.url || '',
    sourceTitle: tab?.title || 'Untitled page',
    createdAt: Date.now(),
  });
  const url = chrome.runtime.getURL(
    `result/result.html?captureId=${encodeURIComponent(id)}&mode=${encodeURIComponent(mode)}`
  );
  await chrome.tabs.create({ url });
  return { ok: true, captureId: id };
}

async function captureVisible(tabId, delayMs = 150) {
  const tab = await chrome.tabs.get(tabId);
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return storeAndOpen(dataUrlToBlob(dataUrl), 'visible', tab);
}

async function runFullPageCapture(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId);
  const reportProgress = (progress) => {
    chrome.runtime.sendMessage({ type: 'PP_PROGRESS', ...progress }).catch(() => {});
  };
  const blob = await captureFullPage(tab, options, reportProgress);
  return storeAndOpen(blob, 'fullpage', tab);
}

async function captureSelection(tab, rect, devicePixelRatio, delayMs = 150) {
  if (!tab) throw new Error('No source tab for selection capture.');
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));

  const dpr = devicePixelRatio || 1;
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return storeAndOpen(croppedBlob, 'selection', tab);
}
