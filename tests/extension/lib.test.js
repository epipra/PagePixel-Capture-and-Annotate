import { test, assert, eq, rejects } from './harness.js';
import { makeCanvas, decodePixels, canvasBlob, headText } from './fixtures.js';
import { encodeCanvas, encodePngOptimized, FORMAT_INFO } from '../../extension/lib/encode.js';
import { prepareUpload, MAX_UPLOAD_BYTES, QUALITY_LADDER } from '../../extension/lib/compress.js';
import { uploadBlob, UploadError } from '../../extension/lib/upload-client.js';

const samePixels = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ------------------------------------------------------------------ encode --

test('encode: optimized PNG is pixel-identical to Chrome PNG (opaque) and smaller', async () => {
  const c = makeCanvas({ noise: true });
  const native = await canvasBlob(c, 'image/png');
  const mine = await encodePngOptimized(c);
  eq(mine.type, 'image/png');
  eq(await headText(mine, 8), '\x89PNG\r\n\x1a\n', 'signature');
  assert(samePixels(await decodePixels(mine, c.width, c.height), await decodePixels(native, c.width, c.height)), 'pixels differ');
  assert(mine.size < native.size, `not smaller: ${mine.size} vs ${native.size}`);
});

test('encode: optimized PNG keeps transparency pixel-identical', async () => {
  const c = makeCanvas({ transparent: true });
  const native = await canvasBlob(c, 'image/png');
  const mine = await encodePngOptimized(c);
  assert(samePixels(await decodePixels(mine, c.width, c.height), await decodePixels(native, c.width, c.height)), 'pixels differ');
});

test('encode: odd sizes and a 1x1 canvas round-trip', async () => {
  for (const [w, h] of [[1, 1], [3, 7], [257, 33]]) {
    const c = makeCanvas({ width: w, height: h });
    const native = await canvasBlob(c, 'image/png');
    const mine = await encodePngOptimized(c);
    assert(samePixels(await decodePixels(mine, w, h), await decodePixels(native, w, h)), `pixels differ at ${w}x${h}`);
  }
});

test('encode: encodeCanvas returns the right type per format', async () => {
  const c = makeCanvas();
  eq((await encodeCanvas(c, 'png')).type, 'image/png');
  eq((await encodeCanvas(c, 'jpeg')).type, 'image/jpeg');
  eq((await encodeCanvas(c, 'webp')).type, 'image/webp');
  const pdf = await encodeCanvas(c, 'pdf', { pdfPageSize: 'a4-portrait' });
  eq(pdf.type, 'application/pdf');
  eq(await headText(pdf, 5), '%PDF-');
});

test('encode: lower quality gives a smaller JPEG/WEBP/PDF', async () => {
  const c = makeCanvas({ noise: true });
  for (const f of ['jpeg', 'webp', 'pdf']) {
    const hi = await encodeCanvas(c, f, { quality: 0.92 });
    const lo = await encodeCanvas(c, f, { quality: 0.8 });
    assert(lo.size < hi.size, `${f}: ${lo.size} !< ${hi.size}`);
  }
});

test('encode: FORMAT_INFO maps format to mime/ext/label', () => {
  eq(FORMAT_INFO.jpeg.ext, 'jpg');
  eq(FORMAT_INFO.jpeg.mime, 'image/jpeg');
  eq(FORMAT_INFO.pdf.label, 'PDF');
  eq(FORMAT_INFO.webp.mime, 'image/webp');
});

// ---------------------------------------------------------------- compress --

test('compress: constants match the spec', () => {
  eq(MAX_UPLOAD_BYTES, 5242880);
  eq(JSON.stringify(QUALITY_LADDER), '[0.92,0.85,0.8]');
});

test('compress: a PNG that fits is uploaded as lossless PNG with a size note', async () => {
  const c = makeCanvas();
  const r = await prepareUpload(c, 'png');
  eq(r.ok, true);
  eq(r.format, 'png');
  eq(r.quality, null);
  eq(r.blob.type, 'image/png');
  assert(/^Optimized PNG .* MB → .* MB \(lossless\)$/.test(r.note), r.note);
});

test('compress: JPEG steps down to 0.85 when 0.92 is over the budget', async () => {
  const c = makeCanvas({ noise: true });
  const s085 = (await encodeCanvas(c, 'jpeg', { quality: 0.85 })).size;
  const r = await prepareUpload(c, 'jpeg', { maxBytes: s085 });
  eq(r.ok, true);
  eq(r.format, 'jpeg');
  eq(r.quality, 0.85);
  eq(r.blob.size, s085);
  assert(/^JPEG compressed to 85% to fit [\d.]+ MB$/.test(r.note), r.note);
});

test('compress: JPEG at 0.92 that fits has no note', async () => {
  const r = await prepareUpload(makeCanvas(), 'jpeg');
  eq(r.ok, true);
  eq(r.quality, 0.92);
  eq(r.note, null);
});

test('compress: PDF steps down to the 0.80 floor', async () => {
  const c = makeCanvas({ noise: true });
  const s080 = (await encodeCanvas(c, 'pdf', { quality: 0.8, pdfPageSize: 'letter-portrait' })).size;
  const r = await prepareUpload(c, 'pdf', { maxBytes: s080, pdfPageSize: 'letter-portrait' });
  eq(r.ok, true);
  eq(r.quality, 0.8);
  eq(r.blob.type, 'application/pdf');
});

test('compress: oversize PNG offers a measured WEBP fallback', async () => {
  const c = makeCanvas({ noise: true });
  const png = await encodePngOptimized(c);
  const webp = await encodeCanvas(c, 'webp', { quality: 0.92 });
  assert(webp.size < png.size, 'fixture: webp should be smaller than png');
  const r = await prepareUpload(c, 'png', { maxBytes: webp.size });
  eq(r.ok, false);
  eq(r.reason, 'too_large');
  eq(r.format, 'png');
  eq(r.size, png.size);
  eq(r.fallback.format, 'webp');
  eq(r.fallback.quality, 0.92);
  eq(r.fallback.blob.size, webp.size);
});

test('compress: no fallback when even WEBP at 0.80 is too big', async () => {
  const r = await prepareUpload(makeCanvas({ noise: true }), 'jpeg', { maxBytes: 100 });
  eq(r.ok, false);
  eq(r.fallback, null);
});

test('compress: an oversize WEBP never offers itself as the fallback', async () => {
  const r = await prepareUpload(makeCanvas({ noise: true }), 'webp', { maxBytes: 100 });
  eq(r.ok, false);
  eq(r.fallback, null);
});

// ----------------------------------------------------------- upload client --

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const respond = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opts = (fetchImpl) => ({ fetchImpl, endpoint: 'https://upload.test/upload', key: 'k' });

test('upload: 201 resolves with the public URL and sends key + type', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return respond(201, { url: 'https://img.omwly.com/abcdefghijklmnopqrstuv.png' })();
  };
  const r = await uploadBlob(png, opts(fetchImpl));
  eq(r.url, 'https://img.omwly.com/abcdefghijklmnopqrstuv.png');
  eq(seen.url, 'https://upload.test/upload');
  eq(seen.init.method, 'POST');
  eq(seen.init.headers['X-PagePixel-Key'], 'k');
  eq(seen.init.headers['Content-Type'], 'image/png');
  eq(seen.init.body, png);
});

for (const [status, error, code, message] of [
  [429, 'rate_limited', 'rate_limited', 'Too many uploads — try again in a minute.'],
  [403, 'bad_key', 'bad_key', 'Upload not authorized — please update PagePixel.'],
  [403, 'origin_not_allowed', 'origin_not_allowed', 'Upload not authorized — please update PagePixel.'],
  [413, 'too_large', 'too_large', "This file couldn't be accepted (too large or unsupported)."],
  [415, 'unsupported_type', 'unsupported_type', "This file couldn't be accepted (too large or unsupported)."],
  [500, 'storage_failed', 'storage_failed', 'Upload failed — please try again.'],
  [502, undefined, 'server', 'Upload failed — please try again.'],
]) {
  test(`upload: ${status} ${error || '(no body)'} → ${code}`, async () => {
    await rejects(uploadBlob(png, opts(respond(status, error ? { error } : {}))), (err) => {
      assert(err instanceof UploadError, 'not an UploadError');
      eq(err.code, code);
      eq(err.message, message);
    });
  });
}

test('upload: network failure → network', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  await rejects(uploadBlob(png, opts(fetchImpl)), (err) => {
    eq(err.code, 'network');
    eq(err.message, "Couldn't reach img.omwly.com — check your connection.");
  });
});

test('upload: timeout aborts the request → network', async () => {
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await rejects(uploadBlob(png, { ...opts(fetchImpl), timeoutMs: 20 }), (err) => eq(err.code, 'network'));
});

test('upload: a URL outside img.omwly.com is refused', async () => {
  await rejects(uploadBlob(png, opts(respond(201, { url: 'https://evil.example/x.png' }))), (err) => eq(err.code, 'bad_response'));
});
