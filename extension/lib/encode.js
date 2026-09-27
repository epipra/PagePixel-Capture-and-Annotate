import { buildPdfFromCanvas } from './pdf-writer.js';

export const FORMAT_INFO = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WEBP' },
  pdf: { mime: 'application/pdf', ext: 'pdf', label: 'PDF' },
};

export const DEFAULT_QUALITY = 0.92;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {'png'|'jpeg'|'webp'|'pdf'} format
 * @param {{ quality?: number, pdfPageSize?: string }} [options]
 * @returns {Promise<Blob>}
 */
export async function encodeCanvas(canvas, format, { quality = DEFAULT_QUALITY, pdfPageSize = 'letter-landscape' } = {}) {
  if (format === 'png') return encodePngOptimized(canvas);
  if (format === 'pdf') {
    const bytes = await buildPdfFromCanvas(canvas, pdfPageSize, quality);
    return new Blob([bytes], { type: FORMAT_INFO.pdf.mime });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed'))), FORMAT_INFO[format].mime, quality);
  });
}

// ------------------------------------------------------ optimized PNG writer --
// Chrome's canvas PNG encoder favours speed. This one is lossless too but picks the best
// filter per row, drops the alpha channel when every pixel is opaque, and deflates with the
// browser's native CompressionStream — typically 30–50% smaller on screenshots.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function isOpaque(px) {
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
  return true;
}

// Writes PNG filter type `f` of row `cur` into `out` and returns its cost (sum of absolute
// signed residuals). Stops early once the cost reaches `cutoff`, leaving `out` incomplete.
function applyFilter(f, cur, prev, bpp, out, cutoff = Infinity) {
  let cost = 0;
  for (let i = 0; i < cur.length; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let p;
    if (f === 0) p = 0;
    else if (f === 1) p = a;
    else if (f === 2) p = b;
    else if (f === 3) p = (a + b) >> 1;
    else {
      const pp = a + b - c;
      const pa = Math.abs(pp - a);
      const pb = Math.abs(pp - b);
      const pc = Math.abs(pp - c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    const v = (cur[i] - p) & 0xff;
    out[i] = v;
    cost += v < 128 ? v : 256 - v;
    if (cost >= cutoff) return Infinity;
  }
  return cost;
}

/** @param {HTMLCanvasElement} canvas @returns {Promise<Blob>} */
export async function encodePngOptimized(canvas) {
  const { width, height } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const opaque = isOpaque(px);
  const bpp = opaque ? 3 : 4;
  const stride = width * bpp;
  const rowBytes = stride + 1;

  const deflate = new CompressionStream('deflate');
  const compressed = new Response(deflate.readable).arrayBuffer();
  const writer = deflate.writable.getWriter();

  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const scratch = new Uint8Array(stride);
  // Rows go to the compressor in ~1 MB batches so memory stays near the ImageData size even
  // for very tall full-page captures.
  const rowsPerBatch = Math.max(1, Math.floor((1 << 20) / rowBytes));
  let batch = new Uint8Array(rowsPerBatch * rowBytes);
  let batchRows = 0;

  for (let y = 0; y < height; y++) {
    const base = y * width * 4;
    if (opaque) {
      for (let x = 0, j = 0; x < width; x++) {
        const s = base + x * 4;
        cur[j++] = px[s];
        cur[j++] = px[s + 1];
        cur[j++] = px[s + 2];
      }
    } else {
      cur.set(px.subarray(base, base + stride));
    }

    let best = 0;
    let bestCost = Infinity;
    for (let f = 0; f < 5; f++) {
      const cost = applyFilter(f, cur, prev, bpp, scratch, bestCost);
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    const off = batchRows * rowBytes;
    batch[off] = best;
    applyFilter(best, cur, prev, bpp, batch.subarray(off + 1, off + rowBytes));
    batchRows++;

    if (batchRows === rowsPerBatch || y === height - 1) {
      await writer.ready;
      await writer.write(batch.subarray(0, batchRows * rowBytes));
      batch = new Uint8Array(rowsPerBatch * rowBytes);
      batchRows = 0;
    }
    [prev, cur] = [cur, prev];
  }
  await writer.close();
  const idat = new Uint8Array(await compressed);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return new Blob(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))],
    { type: 'image/png' }
  );
}
