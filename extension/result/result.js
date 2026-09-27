import { getCapture, deleteCapture } from '../lib/idb-store.js';
import { buildPdfFromCanvas, PAGE_SIZES } from '../lib/pdf-writer.js';

// Placeholder until this extension has a real Chrome Web Store listing —
// update after publishing (guide §7). Used by the Feedback button and the
// star-rating widget, both of which just deep-link out to the store listing.
const STORE_LISTING_URL = 'https://chromewebstore.google.com/detail/REPLACE_WITH_EXTENSION_ID';

const MAX_HISTORY = 25;

const els = {
  editToggleBtn: document.getElementById('editToggleBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomLabel: document.getElementById('zoomLabel'),
  formatSelect: document.getElementById('formatSelect'),
  pdfPageSizeSelect: document.getElementById('pdfPageSizeSelect'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  helpBtn: document.getElementById('helpBtn'),
  feedbackBtn: document.getElementById('feedbackBtn'),
  ratingWidget: document.getElementById('ratingWidget'),
  annotateBar: document.getElementById('annotateBar'),
  toolGroup: document.getElementById('toolGroup'),
  colorPicker: document.getElementById('colorPicker'),
  brushSize: document.getElementById('brushSize'),
  brushSizeLabel: document.getElementById('brushSizeLabel'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  cropApplyBtn: document.getElementById('cropApplyBtn'),
  cropCancelBtn: document.getElementById('cropCancelBtn'),
  doneEditBtn: document.getElementById('doneEditBtn'),
  canvasArea: document.getElementById('canvasArea'),
  canvasWrap: document.getElementById('canvasWrap'),
  canvas: document.getElementById('mainCanvas'),
  overlay: document.getElementById('overlayCanvas'),
  textInput: document.getElementById('textInput'),
  emptyState: document.getElementById('emptyState'),
  toast: document.getElementById('toast'),
  sourceLabel: document.getElementById('sourceLabel'),
};

const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
const octx = els.overlay.getContext('2d');

const state = {
  captureId: null,
  captureMeta: null,
  editing: false,
  tool: null,
  color: '#ff7a45',
  brushSize: 4,
  zoom: 100,
  history: [],
  redo: [],
  dragStart: null,
  pendingCrop: null,
  toastTimer: null,
};

init();

async function init() {
  populatePdfPageSizes();
  bindToolbar();
  bindEditor();

  const params = new URLSearchParams(location.search);
  state.captureId = params.get('captureId');

  if (!state.captureId) {
    showEmptyState();
    return;
  }

  const record = await getCapture(state.captureId).catch(() => null);
  if (!record || !record.blob) {
    showEmptyState();
    return;
  }

  state.captureMeta = record;
  els.sourceLabel.textContent = record.sourceTitle ? `Captured from: ${record.sourceTitle}` : '';

  const bitmap = await createImageBitmap(record.blob);
  els.canvas.width = bitmap.width;
  els.canvas.height = bitmap.height;
  els.overlay.width = bitmap.width;
  els.overlay.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  pushHistory();
  fitZoomToViewport();
  applyZoom();

  // The IndexedDB blob was only a transfer buffer between the background
  // worker and this page — nothing else reads it, so free it now.
  deleteCapture(state.captureId).catch(() => {});
}

function showEmptyState() {
  els.canvasArea.querySelector('.pp-canvas-wrap').hidden = true;
  els.emptyState.hidden = false;
}

// ---------------------------------------------------------------- toolbar --

function populatePdfPageSizes() {
  for (const [key, size] of Object.entries(PAGE_SIZES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = size.label;
    if (key === 'letter-landscape') opt.selected = true;
    els.pdfPageSizeSelect.appendChild(opt);
  }
}

function bindToolbar() {
  els.editToggleBtn.addEventListener('click', () => setEditing(!state.editing));

  els.zoomInBtn.addEventListener('click', () => setZoom(state.zoom + 25));
  els.zoomOutBtn.addEventListener('click', () => setZoom(state.zoom - 25));

  els.formatSelect.addEventListener('change', () => {
    els.pdfPageSizeSelect.hidden = els.formatSelect.value !== 'pdf';
  });

  els.copyBtn.addEventListener('click', copyToClipboard);
  els.downloadBtn.addEventListener('click', downloadExport);

  els.helpBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('help/help.html') });
  });
  els.feedbackBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: STORE_LISTING_URL });
  });
  els.ratingWidget.addEventListener('click', (e) => {
    if (e.target.closest('button')) chrome.tabs.create({ url: STORE_LISTING_URL });
  });
}

function setZoom(value) {
  state.zoom = Math.min(300, Math.max(25, Math.round(value / 5) * 5));
  applyZoom();
}

function applyZoom() {
  const scale = state.zoom / 100;
  const w = `${els.canvas.width * scale}px`;
  const h = `${els.canvas.height * scale}px`;
  els.canvas.style.width = w;
  els.canvas.style.height = h;
  els.overlay.style.width = w;
  els.overlay.style.height = h;
  els.zoomLabel.textContent = `${state.zoom}%`;
}

function fitZoomToViewport() {
  const available = els.canvasArea.clientWidth - 56;
  if (els.canvas.width > available && available > 0) {
    const fit = Math.max(25, Math.floor((available / els.canvas.width) * 100 / 5) * 5);
    state.zoom = Math.min(100, fit);
  } else {
    state.zoom = 100;
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => (els.toast.hidden = true), 2200);
}

// ----------------------------------------------------------------- export --

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function buildFilename(ext) {
  const rawTitle = (state.captureMeta && state.captureMeta.sourceTitle) || 'screenshot';
  const slug =
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 60) || 'screenshot';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `PagePixel_${slug}_${ts}.${ext}`;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

async function copyToClipboard() {
  try {
    const blob = await canvasToBlob(els.canvas, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Copied to clipboard');
  } catch (err) {
    console.error('[PagePixel]', err);
    showToast('Copy failed — try again');
  }
}

async function downloadExport() {
  const format = els.formatSelect.value;
  try {
    if (format === 'pdf') {
      const pageSizeKey = els.pdfPageSizeSelect.value;
      const bytes = await buildPdfFromCanvas(els.canvas, pageSizeKey);
      triggerDownload(new Blob([bytes], { type: 'application/pdf' }), buildFilename('pdf'));
    } else {
      const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const quality = format === 'png' ? undefined : 0.92;
      const blob = await canvasToBlob(els.canvas, mime, quality);
      triggerDownload(blob, buildFilename(format));
    }
    showToast('Download started');
  } catch (err) {
    console.error('[PagePixel]', err);
    showToast('Export failed — try again');
  }
}

// ----------------------------------------------------------------- editor --

function bindEditor() {
  els.toolGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tool]');
    if (!btn) return;
    setTool(state.tool === btn.dataset.tool ? null : btn.dataset.tool);
  });

  els.colorPicker.addEventListener('input', () => (state.color = els.colorPicker.value));
  els.brushSize.addEventListener('input', () => {
    state.brushSize = Number(els.brushSize.value);
    els.brushSizeLabel.textContent = `${state.brushSize}px`;
  });

  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);
  els.doneEditBtn.addEventListener('click', () => setEditing(false));
  els.cropApplyBtn.addEventListener('click', applyPendingCrop);
  els.cropCancelBtn.addEventListener('click', cancelPendingCrop);

  els.overlay.addEventListener('pointerdown', onPointerDown);
  els.overlay.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });

  els.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitTextInput();
    if (e.key === 'Escape') cancelTextInput();
  });
  els.textInput.addEventListener('blur', commitTextInput);
}

function setEditing(on) {
  state.editing = on;
  els.editToggleBtn.setAttribute('aria-pressed', String(on));
  els.editToggleBtn.classList.toggle('pp-btn--active', on);
  els.annotateBar.hidden = !on;
  els.canvasWrap.classList.toggle('pp-editing', on);
  if (!on) setTool(null);
}

function setTool(tool) {
  cancelPendingCrop();
  state.tool = tool;
  els.toolGroup.querySelectorAll('button[data-tool]').forEach((btn) => {
    btn.classList.toggle('pp-btn--active', btn.dataset.tool === tool);
  });
  octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

function getCanvasPoint(e) {
  const rect = els.overlay.getBoundingClientRect();
  const scaleX = els.canvas.width / rect.width;
  const scaleY = els.canvas.height / rect.height;
  return {
    x: Math.min(els.canvas.width, Math.max(0, (e.clientX - rect.left) * scaleX)),
    y: Math.min(els.canvas.height, Math.max(0, (e.clientY - rect.top) * scaleY)),
  };
}

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

// -- pointer-driven drawing --

function onPointerDown(e) {
  if (!state.editing || !state.tool) return;
  const pt = getCanvasPoint(e);

  if (state.tool === 'text') {
    // Without this, the browser's default mousedown action blurs the
    // canvas-relative text input right after focus() below, because the
    // click target (the overlay <canvas>) isn't itself focusable.
    e.preventDefault();
    openTextInput(pt);
    return;
  }

  state.dragStart = pt;
  if (state.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }
  els.overlay.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!state.dragStart) return;
  const pt = getCanvasPoint(e);

  if (state.tool === 'pen') {
    ctx.strokeStyle = state.color;
    ctx.lineWidth = state.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    return;
  }

  octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (['rect', 'circle', 'line', 'arrow'].includes(state.tool)) {
    drawShape(octx, state.tool, state.dragStart, pt);
  } else if (state.tool === 'blur' || state.tool === 'pixelate' || state.tool === 'crop') {
    drawSelectionBox(octx, state.dragStart, pt, state.tool === 'crop');
  }
}

function onPointerUp(e) {
  if (!state.dragStart) return;
  const pt = getCanvasPoint(e);
  const from = state.dragStart;
  state.dragStart = null;

  if (state.tool === 'pen') {
    pushHistory();
  } else if (['rect', 'circle', 'line', 'arrow'].includes(state.tool)) {
    octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
    drawShape(ctx, state.tool, from, pt);
    pushHistory();
  } else if (state.tool === 'blur' || state.tool === 'pixelate') {
    octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
    const rect = normalizeRect(from, pt);
    if (rect.width > 2 && rect.height > 2) {
      applyRegionEffect(state.tool, rect);
      pushHistory();
    }
  } else if (state.tool === 'crop') {
    const rect = normalizeRect(from, pt);
    if (rect.width > 4 && rect.height > 4) {
      state.pendingCrop = rect;
      drawSelectionBox(octx, from, pt, true);
      els.cropApplyBtn.hidden = false;
      els.cropCancelBtn.hidden = false;
    }
  }
}

function drawShape(context, tool, from, to) {
  context.save();
  context.strokeStyle = state.color;
  context.fillStyle = state.color;
  context.lineWidth = state.brushSize;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const { x, y, width: w, height: h } = normalizeRect(from, to);

  if (tool === 'rect') {
    context.strokeRect(x, y, w, h);
  } else if (tool === 'circle') {
    context.beginPath();
    context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (tool === 'line') {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  } else if (tool === 'arrow') {
    drawArrow(context, from, to);
  }
  context.restore();
}

function drawArrow(context, from, to) {
  const headLen = Math.max(10, state.brushSize * 3);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

function drawSelectionBox(context, from, to, dimOutside) {
  const { x, y, width: w, height: h } = normalizeRect(from, to);
  if (dimOutside) {
    context.save();
    context.fillStyle = 'rgba(11, 31, 51, 0.45)';
    context.fillRect(0, 0, els.overlay.width, y);
    context.fillRect(0, y + h, els.overlay.width, els.overlay.height - (y + h));
    context.fillRect(0, y, x, h);
    context.fillRect(x + w, y, els.overlay.width - (x + w), h);
    context.restore();
  }
  context.save();
  context.strokeStyle = '#ff7a45';
  context.lineWidth = 2;
  context.setLineDash([6, 4]);
  context.strokeRect(x, y, w, h);
  context.restore();
}

function applyRegionEffect(tool, rect) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const w = Math.min(els.canvas.width - x, Math.round(rect.width));
  const h = Math.min(els.canvas.height - y, Math.round(rect.height));
  if (w < 2 || h < 2) return;

  if (tool === 'pixelate') {
    const blockSize = Math.max(4, Math.round(state.brushSize));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(w / blockSize));
    small.height = Math.max(1, Math.round(h / blockSize));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(els.canvas, x, y, w, h, 0, 0, small.width, small.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
    ctx.restore();
  } else if (tool === 'blur') {
    const blurAmount = Math.max(2, Math.round(state.brushSize));
    const region = document.createElement('canvas');
    region.width = w;
    region.height = h;
    region.getContext('2d').drawImage(els.canvas, x, y, w, h, 0, 0, w, h);
    ctx.save();
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(region, x, y);
    ctx.restore();
  }
}

function applyPendingCrop() {
  if (!state.pendingCrop) return;
  const { x, y, width: w, height: h } = state.pendingCrop;
  const cropped = document.createElement('canvas');
  cropped.width = Math.round(w);
  cropped.height = Math.round(h);
  cropped.getContext('2d').drawImage(els.canvas, x, y, w, h, 0, 0, w, h);

  els.canvas.width = cropped.width;
  els.canvas.height = cropped.height;
  els.overlay.width = cropped.width;
  els.overlay.height = cropped.height;
  ctx.drawImage(cropped, 0, 0);

  cancelPendingCrop();
  pushHistory();
  fitZoomToViewport();
  applyZoom();
}

function cancelPendingCrop() {
  state.pendingCrop = null;
  els.cropApplyBtn.hidden = true;
  els.cropCancelBtn.hidden = true;
  octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

// -- text tool --

function openTextInput(pt) {
  const rect = els.overlay.getBoundingClientRect();
  const scale = state.zoom / 100;
  els.textInput.hidden = false;
  els.textInput.value = '';
  els.textInput.style.left = `${pt.x * scale}px`;
  els.textInput.style.top = `${pt.y * scale}px`;
  els.textInput.style.color = state.color;
  els.textInput.style.fontSize = `${Math.max(12, state.brushSize * 4)}px`;
  els.textInput.dataset.x = String(pt.x);
  els.textInput.dataset.y = String(pt.y);
  els.textInput.focus();
}

function commitTextInput() {
  if (els.textInput.hidden) return;
  const value = els.textInput.value.trim();
  if (value) {
    const x = Number(els.textInput.dataset.x);
    const y = Number(els.textInput.dataset.y);
    const fontSize = Math.max(12, state.brushSize * 4);
    ctx.save();
    ctx.fillStyle = state.color;
    ctx.font = `600 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillText(value, x, y);
    ctx.restore();
    pushHistory();
  }
  cancelTextInput();
}

function cancelTextInput() {
  els.textInput.hidden = true;
  els.textInput.value = '';
}

// -- undo / redo --

function pushHistory() {
  state.redo.length = 0;
  state.history.push(els.canvas.toDataURL('image/png'));
  if (state.history.length > MAX_HISTORY) state.history.shift();
  updateUndoRedoButtons();
}

async function undo() {
  if (state.history.length < 2) return;
  state.redo.push(state.history.pop());
  await restoreSnapshot(state.history[state.history.length - 1]);
  updateUndoRedoButtons();
}

async function redo() {
  if (!state.redo.length) return;
  const snap = state.redo.pop();
  state.history.push(snap);
  await restoreSnapshot(snap);
  updateUndoRedoButtons();
}

function restoreSnapshot(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      els.canvas.width = img.naturalWidth;
      els.canvas.height = img.naturalHeight;
      els.overlay.width = img.naturalWidth;
      els.overlay.height = img.naturalHeight;
      ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
      ctx.drawImage(img, 0, 0);
      applyZoom();
      resolve();
    };
    img.src = dataUrl;
  });
}

function updateUndoRedoButtons() {
  els.undoBtn.disabled = state.history.length < 2;
  els.redoBtn.disabled = state.redo.length === 0;
}
