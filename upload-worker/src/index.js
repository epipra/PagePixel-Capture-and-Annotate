const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = isAllowedOrigin(origin, env);
    const cors = allowed ? corsHeaders(origin) : {};

    if (url.pathname !== '/upload') return json({ error: 'not_found' }, 404, cors);
    if (request.method === 'OPTIONS') {
      return allowed ? new Response(null, { status: 204, headers: preflightHeaders(origin) }) : json({ error: 'origin_not_allowed' }, 403);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
    if (!allowed) return json({ error: 'origin_not_allowed' }, 403);
    if (!(await keyMatches(request.headers.get('X-PagePixel-Key'), env.UPLOAD_KEY))) {
      return json({ error: 'bad_key' }, 403, cors);
    }

    const { success } = await env.UPLOAD_LIMITER.limit({ key: rateLimitKey(request.headers.get('CF-Connecting-IP')) });
    if (!success) return json({ error: 'rate_limited' }, 429, cors);

    const maxBytes = Number(env.MAX_BYTES);
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > maxBytes) return json({ error: 'too_large' }, 413, cors);
    const body = await readCapped(request.body, maxBytes);
    if (!body) return json({ error: 'too_large' }, 413, cors);

    const type = sniffType(body);
    if (!type || !isWellFormed(body, type.ext)) return json({ error: 'unsupported_type' }, 415, cors);

    const key = newKey(type.ext);
    try {
      await env.BUCKET.put(key, body, { httpMetadata: { contentType: type.contentType, cacheControl: CACHE_CONTROL } });
    } catch (err) {
      console.error('r2 put failed', err);
      return json({ error: 'storage_failed' }, 500, cors);
    }
    return json({ url: `${env.PUBLIC_BASE_URL}/${key}` }, 201, cors);
  },
};

// One IPv6 subscriber usually controls a whole /64, so per-address limits would be trivial
// to rotate around.
export function rateLimitKey(ip) {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).includes(origin);
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function preflightHeaders(origin) {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-PagePixel-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// Hash first so the comparison is constant-time regardless of input length.
async function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Content-Length can be absent or wrong, so the cap is enforced on the bytes actually read.
async function readCapped(stream, maxBytes) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const startsWith = (bytes, sig, at = 0) => sig.every((b, i) => bytes[at + i] === b);
const ascii = (bytes, start, end) => String.fromCharCode.apply(null, bytes.subarray(start, Math.min(end, bytes.length)));

export function sniffType(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', contentType: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' };
  if (ascii(bytes, 0, 5) === '%PDF-') return { ext: 'pdf', contentType: 'application/pdf' };
  return null;
}

// Structure checks stop a valid header being used as a wrapper for arbitrary bytes (a zip,
// an executable) that would then be hosted permanently on img.omwly.com.
function isWellFormed(bytes, ext) {
  if (ext === 'png') return isWellFormedPng(bytes);
  if (ext === 'jpg') return endsWithJpegEoi(bytes, 0, bytes.length);
  if (ext === 'webp') return bytes.length >= 12 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) + 8 === bytes.length;
  return isPagePixelPdf(bytes);
}

const endsWithJpegEoi = (bytes, start, end) =>
  end - start >= 4 && bytes[start] === 0xff && bytes[start + 1] === 0xd8 && bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9;

// Chrome's canvas encoder and PagePixel's optimized encoder only emit IHDR/IDAT/IEND.
const PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

function isWellFormedPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let first = true;
  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = ascii(bytes, pos + 4, pos + 8);
    if (!PNG_CHUNKS.has(type) || (first && type !== 'IHDR')) return false;
    const next = pos + 12 + len;
    if (next > bytes.length) return false;
    if (type === 'IEND') return len === 0 && next === bytes.length;
    first = false;
    pos = next;
  }
  return false;
}

const PDF_HEADER = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const PDF_NAMES = new Set([
  'Type', 'Catalog', 'Pages', 'Kids', 'Count', 'Page', 'Parent', 'MediaBox', 'Resources', 'XObject', 'Im0',
  'Contents', 'Subtype', 'Image', 'Width', 'Height', 'ColorSpace', 'DeviceRGB', 'BitsPerComponent', 'Filter',
  'DCTDecode', 'Length',
]);
const OBJ_RE = /^(\d+) 0 obj\n<<([ A-Za-z0-9/.\[\]<>]*)>>\n/;
const CONTENT_RE = /^q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/Im0 Do Q$/;
const TAIL_RE = /^xref\n0 (\d+)\n0000000000 65535 f \n((?:\d{10} 00000 n \n)+)trailer\n<< \/Size (\d+) \/Root 1 0 R >>\nstartxref\n(\d+)\n%%EOF$/;
const MAX_PDF_TAIL = 64 * 1024;

// Allowlist, not a blocklist: only the exact structure lib/pdf-writer.js emits is accepted
// (JPEG image pages + one fixed content stream each). Objects are parsed front to back with
// stream bodies skipped by /Length, and because viewers locate objects through the xref
// table rather than by reading in order, every xref offset must point exactly at an object
// we parsed. Otherwise an object hidden inside unchecked image bytes could become the
// document's real Catalog. Name escapes, strings, object streams and incremental updates
// all fail the patterns.
export function isPagePixelPdf(bytes) {
  if (ascii(bytes, 0, PDF_HEADER.length) !== PDF_HEADER) return false;
  let pos = PDF_HEADER.length;
  const offsets = [];
  const refs = [];
  for (;;) {
    const m = OBJ_RE.exec(ascii(bytes, pos, pos + 512));
    if (!m) break;
    if (Number(m[1]) !== offsets.length + 1) return false;
    offsets.push(pos);
    const dict = m[2];
    for (const [, name] of dict.matchAll(/\/([A-Za-z0-9]+)/g)) if (!PDF_NAMES.has(name)) return false;
    for (const [, ref] of dict.matchAll(/(\d+) 0 R/g)) refs.push(Number(ref));
    pos += m[0].length;

    if (ascii(bytes, pos, pos + 7) === 'stream\n') {
      const len = dict.match(/\/Length (\d+) $/);
      if (!len) return false;
      const isImage = / \/Subtype \/Image /.test(dict);
      if (isImage && !/ \/Filter \/DCTDecode /.test(dict)) return false;
      if (!isImage && dict !== ` /Length ${len[1]} `) return false;
      const start = pos + 7;
      const end = start + Number(len[1]);
      if (isImage ? !endsWithJpegEoi(bytes, start, end) : !CONTENT_RE.test(ascii(bytes, start, end))) return false;
      if (ascii(bytes, end, end + 18) !== '\nendstream\nendobj\n') return false;
      pos = end + 18;
    } else if (ascii(bytes, pos, pos + 7) === 'endobj\n') {
      pos += 7;
    } else {
      return false;
    }
  }

  const count = offsets.length;
  if (count < 3 || refs.some((r) => r < 1 || r > count)) return false;
  if (bytes.length - pos > MAX_PDF_TAIL) return false;
  const tail = TAIL_RE.exec(ascii(bytes, pos, bytes.length));
  if (!tail || Number(tail[1]) !== count + 1 || Number(tail[3]) !== count + 1 || Number(tail[4]) !== pos) return false;
  const entries = tail[2].match(/\d{10}/g);
  return entries.length === count && entries.every((e, i) => Number(e) === offsets[i]);
}

export function newKey(ext) {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${ext}`;
}
