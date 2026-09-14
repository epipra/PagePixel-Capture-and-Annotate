// Minimal, dependency-free PDF writer. Builds a PDF whose pages are each a
// single embedded JPEG image (DCTDecode) — no fonts, no vector content — which
// is all PagePixel's "export screenshot as PDF" needs. Avoids vendoring a full
// PDF library for a single-purpose, well-understood binary format.

/** Page sizes in PDF points (1pt = 1/72in). Matches the 7-option dropdown. */
export const PAGE_SIZES = {
  'legal-landscape': { label: 'US Legal Landscape', w: 1008, h: 612 },
  'letter-landscape': { label: 'US Letter Landscape', w: 792, h: 612 },
  'a4-landscape': { label: 'A4 Landscape', w: 841.89, h: 595.28 },
  'letter-portrait': { label: 'US Letter Portrait', w: 612, h: 792 },
  'legal-portrait': { label: 'US Legal Portrait', w: 612, h: 1008 },
  'a4-portrait': { label: 'A4 Portrait', w: 595.28, h: 841.89 },
  'full-image': { label: 'Full Image (no pagination)', w: null, h: null },
};

const MAX_PDF_POINTS = 14400; // PDF spec page-size ceiling (~200in)

function textBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function canvasRegionToJpegBytes(sourceCanvas, sy, sHeight, quality) {
  const slice = new OffscreenCanvas(sourceCanvas.width, sHeight);
  const ctx = slice.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, sy, sourceCanvas.width, sHeight, 0, 0, sourceCanvas.width, sHeight);
  const blob = await slice.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas full annotated image
 * @param {keyof typeof PAGE_SIZES} pageSizeKey
 * @param {number} [quality] JPEG quality 0-1
 * @returns {Promise<Uint8Array>}
 */
export async function buildPdfFromCanvas(canvas, pageSizeKey, quality = 0.92) {
  const size = PAGE_SIZES[pageSizeKey] || PAGE_SIZES['letter-landscape'];
  const imgW = canvas.width;
  const imgH = canvas.height;

  /** @type {{ pageW: number, pageH: number, drawW: number, drawH: number, jpeg: Uint8Array, px: number, py: number, pw: number, ph: number }[]} */
  const pages = [];

  if (pageSizeKey === 'full-image' || !size.w) {
    // Single page sized to the image itself (1px = 1pt), clamped to the PDF
    // spec's page-size ceiling so extremely tall captures stay valid.
    let pageW = imgW;
    let pageH = imgH;
    if (pageH > MAX_PDF_POINTS) {
      const scale = MAX_PDF_POINTS / pageH;
      pageW *= scale;
      pageH = MAX_PDF_POINTS;
    }
    if (pageW > MAX_PDF_POINTS) {
      const scale = MAX_PDF_POINTS / pageW;
      pageH *= scale;
      pageW = MAX_PDF_POINTS;
    }
    const jpeg = await canvasRegionToJpegBytes(canvas, 0, imgH, quality);
    pages.push({ pageW, pageH, drawW: pageW, drawH: pageH, jpeg, pw: imgW, ph: imgH });
  } else {
    // Fit image width to page width, then paginate the image top-to-bottom
    // in page-height increments.
    const scale = size.w / imgW;
    const sliceHeightPx = Math.max(1, Math.floor(size.h / scale));
    let sy = 0;
    while (sy < imgH) {
      const thisSlicePx = Math.min(sliceHeightPx, imgH - sy);
      const jpeg = await canvasRegionToJpegBytes(canvas, sy, thisSlicePx, quality);
      const drawH = thisSlicePx * scale;
      pages.push({ pageW: size.w, pageH: size.h, drawW: size.w, drawH, jpeg, pw: imgW, ph: thisSlicePx });
      sy += thisSlicePx;
    }
  }

  return assemblePdf(pages);
}

function assemblePdf(pages) {
  const chunks = [];
  const offsets = [];
  let pos = 0;

  function push(bytesOrStr) {
    const bytes = typeof bytesOrStr === 'string' ? textBytes(bytesOrStr) : bytesOrStr;
    chunks.push(bytes);
    pos += bytes.length;
  }

  function beginObj(num) {
    offsets[num] = pos;
    push(`${num} 0 obj\n`);
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const pageCount = pages.length;
  // Object numbering: 1 = Catalog, 2 = Pages, then per page: page obj, image
  // obj, content-stream obj (3 objects each), starting at object 3.
  const pageObjNums = [];
  const imgObjNums = [];
  const contentObjNums = [];
  let next = 3;
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(next++);
    imgObjNums.push(next++);
    contentObjNums.push(next++);
  }

  beginObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  beginObj(2);
  push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i++) {
    const p = pages[i];
    beginObj(pageObjNums[i]);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pageW.toFixed(2)} ${p.pageH.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imgObjNums[i]} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>\nendobj\n`
    );

    beginObj(imgObjNums[i]);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
    );
    push(p.jpeg);
    push(`\nendstream\nendobj\n`);

    // Flush to the top-left of the page (not centered) so multi-page output
    // reads like a normal paginated document — only the last, shorter page
    // ends early rather than floating in the middle of the sheet.
    const ox = (0).toFixed(2);
    const oy = (p.pageH - p.drawH).toFixed(2);
    const content = `q ${p.drawW.toFixed(2)} 0 0 ${p.drawH.toFixed(2)} ${ox} ${oy} cm /Im0 Do Q`;
    beginObj(contentObjNums[i]);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  }

  const xrefStart = pos;
  const totalObjs = next; // object numbers used: 1..next-1
  push(`xref\n0 ${totalObjs}\n`);
  push('0000000000 65535 f \n');
  for (let i = 1; i < totalObjs; i++) {
    push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return concatBytes(chunks);
}
