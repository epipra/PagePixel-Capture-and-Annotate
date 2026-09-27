import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { sniffType, isPagePixelPdf, newKey } from '../src/index.js';
import { LETTER_PORTRAIT, FULL_IMAGE } from './fixtures/pdfs.js';

const STORE_ORIGIN = 'chrome-extension://epcfhbbgdknmhomfimblbokfejlgdgne';
const KEY = 'test-upload-key';
const KEY_RE = /^https:\/\/img\.omwly\.com\/([A-Za-z0-9_-]{22}\.(png|jpg|webp|pdf))$/;

const bytes = (...parts) => {
  const chunks = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const latin1 = (u8) => new TextDecoder('latin1').decode(u8);
const fromLatin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest-of-png');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'rest-of-jpeg');
const WEBP = bytes('RIFF', [0x10, 0, 0, 0], 'WEBPVP8 rest');
const PDF = b64(LETTER_PORTRAIT);

function request(body, { origin = STORE_ORIGIN, key = KEY, method = 'POST', path = '/upload', headers = {} } = {}) {
  const h = new Headers(headers);
  if (origin) h.set('Origin', origin);
  if (key) h.set('X-PagePixel-Key', key);
  return new Request(`https://upload.omwly.com${path}`, { method, headers: h, body });
}

const allowAll = { limit: async () => ({ success: true }) };
const call = (req, overrides = {}) => worker.fetch(req, { ...env, UPLOAD_LIMITER: allowAll, ...overrides });

async function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: code });
}

describe('POST /upload — happy path', () => {
  for (const [name, body, ext, contentType] of [
    ['png', PNG, 'png', 'image/png'],
    ['jpeg', JPEG, 'jpg', 'image/jpeg'],
    ['webp', WEBP, 'webp', 'image/webp'],
    ['pdf', PDF, 'pdf', 'application/pdf'],
  ]) {
    it(`stores a ${name} and returns its public URL`, async () => {
      // Client-declared type is deliberately wrong: the stored type must come from the bytes.
      const res = await call(request(body, { headers: { 'Content-Type': 'text/html' } }));
      expect(res.status).toBe(201);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STORE_ORIGIN);
      const { url } = await res.json();
      const m = url.match(KEY_RE);
      expect(m).not.toBeNull();
      expect(m[2]).toBe(ext);

      const obj = await env.BUCKET.get(m[1]);
      expect(obj).not.toBeNull();
      expect(obj.httpMetadata.contentType).toBe(contentType);
      expect(obj.httpMetadata.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(new Uint8Array(await obj.arrayBuffer())).toEqual(body);
    });
  }

  it('accepts the full-image PDF layout too', async () => {
    const res = await call(request(b64(FULL_IMAGE)));
    expect(res.status).toBe(201);
  });

  it('accepts the unpacked dev origin', async () => {
    const res = await call(request(PNG, { origin: 'chrome-extension://nokaihkhpnkfakngppmlgbnfajecnpem' }));
    expect(res.status).toBe(201);
  });
});

describe('CORS', () => {
  it('answers preflight for an allowed origin', async () => {
    const res = await call(request(null, { method: 'OPTIONS', key: null }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STORE_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-PagePixel-Key');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('refuses preflight for an unknown origin without CORS headers', async () => {
    const res = await call(request(null, { method: 'OPTIONS', key: null, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('rejections', () => {
  it('403 for an unknown origin', async () => {
    const res = await call(request(PNG, { origin: 'https://evil.example' }));
    await expectError(res, 403, 'origin_not_allowed');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('403 when Origin is missing', async () => {
    await expectError(await call(request(PNG, { origin: null })), 403, 'origin_not_allowed');
  });

  it('403 for a missing key', async () => {
    await expectError(await call(request(PNG, { key: null })), 403, 'bad_key');
  });

  it('403 for a wrong key (same length and different length)', async () => {
    await expectError(await call(request(PNG, { key: 'test-upload-kez' })), 403, 'bad_key');
    await expectError(await call(request(PNG, { key: 'short' })), 403, 'bad_key');
  });

  it('429 when the rate limiter says no, keyed by client IP', async () => {
    let seenKey;
    const limiter = { limit: async ({ key }) => ((seenKey = key), { success: false }) };
    const res = await call(request(PNG, { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), { UPLOAD_LIMITER: limiter });
    await expectError(res, 429, 'rate_limited');
    expect(seenKey).toBe('203.0.113.7');
  });

  it('413 when the body is one byte over 5 MB', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    await expectError(await call(request(big)), 413, 'too_large');
  });

  it('accepts a body of exactly 5 MB', async () => {
    const max = new Uint8Array(5 * 1024 * 1024);
    max.set(PNG);
    expect((await call(request(max))).status).toBe(201);
  });

  it('413 early when Content-Length declares more than 5 MB', async () => {
    const res = await call(request(PNG, { headers: { 'Content-Length': String(6 * 1024 * 1024) } }));
    await expectError(res, 413, 'too_large');
  });

  for (const [name, body] of [
    ['empty body', new Uint8Array()],
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['HTML', bytes('<!doctype html><title>x</title>')],
    ['GIF', bytes('GIF89a....')],
    ['RIFF that is not WEBP', bytes('RIFF', [0, 0, 0, 0], 'AVI LIST')],
  ]) {
    it(`415 for ${name}`, async () => {
      await expectError(await call(request(body)), 415, 'unsupported_type');
    });
  }

  it('404 for other paths, 405 for other methods', async () => {
    await expectError(await call(request(PNG, { path: '/' })), 404, 'not_found');
    await expectError(await call(request(null, { method: 'GET' })), 405, 'method_not_allowed');
  });

  it('500 when storage fails', async () => {
    const broken = { put: async () => { throw new Error('r2 down'); } };
    await expectError(await call(request(PNG), { BUCKET: broken }), 500, 'storage_failed');
  });
});

describe('PDF allowlist', () => {
  const text = latin1(PDF);
  const tamper = (from, to) => fromLatin1(text.replace(from, to));

  it('accepts real PagePixel PDFs', () => {
    expect(isPagePixelPdf(PDF)).toBe(true);
    expect(isPagePixelPdf(b64(FULL_IMAGE))).toBe(true);
  });

  it('ignores look-alike tokens inside image data (skipped by /Length)', () => {
    const start = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length;
    const junk = '/JS /OpenAction endstream endobj ';
    const edited = text.slice(0, start + 100) + junk + text.slice(start + 100 + junk.length);
    expect(isPagePixelPdf(fromLatin1(edited))).toBe(true);
  });

  for (const [name, from, to] of [
    ['an OpenAction', '/Type /Catalog /Pages 2 0 R', '/Type /Catalog /Pages 2 0 R /OpenAction 3 0 R'],
    ['a hex-escaped /JS name', '/Type /Catalog', '/Type /Catalog /J#53 3 0 R'],
    ['a string literal', '/Type /Catalog', '/Type /Catalog /Title (hi)'],
    ['a URI action', '/Type /Catalog', '/Type /Catalog /URI 3 0 R'],
    ['a non-JPEG image filter', '/DCTDecode', '/FlateDecode'],
    ['data appended after %%EOF', /%%EOF$/, '%%EOF\n1 0 obj\n<< /OpenAction 3 0 R >>\nendobj\n'],
    ['a wrong stream /Length', /\/Length (\d+) >>\nstream/, (m, n) => `/Length ${Number(n) + 5} >>\nstream`],
    ['a different content stream', /q ([\d.]+) 0 0/, 'q $1 0 1'],
  ]) {
    it(`rejects a PDF with ${name}`, async () => {
      const pdf = tamper(from, to);
      expect(isPagePixelPdf(pdf)).toBe(false);
      await expectError(await call(request(pdf)), 415, 'unsupported_type');
    });
  }
});

describe('helpers', () => {
  it('sniffType maps magic bytes to extension + content type', () => {
    expect(sniffType(PNG)).toEqual({ ext: 'png', contentType: 'image/png' });
    expect(sniffType(JPEG)).toEqual({ ext: 'jpg', contentType: 'image/jpeg' });
    expect(sniffType(WEBP)).toEqual({ ext: 'webp', contentType: 'image/webp' });
    expect(sniffType(PDF)).toEqual({ ext: 'pdf', contentType: 'application/pdf' });
    expect(sniffType(bytes('hello'))).toBeNull();
  });

  it('newKey returns 22 URL-safe chars + extension and does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newKey('png')));
    expect(keys.size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{22}\.png$/);
  });
});
