import { encodeCanvas, encodePngOptimized, FORMAT_INFO } from './encode.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const QUALITY_LADDER = [0.92, 0.85, 0.8];

export const formatMB = (bytes) => `${(bytes / 1048576).toFixed(1).replace(/\.0$/, '')} MB`;

/**
 * Encodes the canvas for upload in the user's chosen format, compressing within that format
 * until it fits. PNG stays lossless; JPEG/WEBP/PDF step down the quality ladder.
 * @returns {Promise<
 *   { ok: true, blob: Blob, format: string, quality: number|null, note: string|null } |
 *   { ok: false, reason: 'too_large', format: string, size: number,
 *     fallback: { blob: Blob, format: 'webp', quality: number } | null }
 * >}
 */
export async function prepareUpload(canvas, format, { pdfPageSize, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  if (format === 'png') {
    const [native, blob] = await Promise.all([
      new Promise((resolve) => canvas.toBlob(resolve, 'image/png')),
      encodePngOptimized(canvas),
    ]);
    if (blob.size <= maxBytes) {
      return { ok: true, blob, format, quality: null, note: `Optimized PNG ${formatMB(native.size)} → ${formatMB(blob.size)} (lossless)` };
    }
    return tooLarge(canvas, format, blob.size, maxBytes);
  }

  let size = 0;
  for (const quality of QUALITY_LADDER) {
    const blob = await encodeCanvas(canvas, format, { quality, pdfPageSize });
    if (blob.size <= maxBytes) {
      const note = quality === QUALITY_LADDER[0] ? null : `${FORMAT_INFO[format].label} compressed to ${Math.round(quality * 100)}% to fit ${formatMB(maxBytes)}`;
      return { ok: true, blob, format, quality, note };
    }
    size = blob.size;
  }
  return tooLarge(canvas, format, size, maxBytes);
}

async function tooLarge(canvas, format, size, maxBytes) {
  const fallback = format === 'webp' ? null : await fitWebp(canvas, maxBytes);
  return { ok: false, reason: 'too_large', format, size, fallback };
}

async function fitWebp(canvas, maxBytes) {
  for (const quality of QUALITY_LADDER) {
    const blob = await encodeCanvas(canvas, 'webp', { quality });
    if (blob.size <= maxBytes) return { blob, format: 'webp', quality };
  }
  return null;
}
