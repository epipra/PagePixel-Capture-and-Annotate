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

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.UPLOAD_LIMITER.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429, cors);

    const maxBytes = Number(env.MAX_BYTES);
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > maxBytes) return json({ error: 'too_large' }, 413, cors);
    const body = await readCapped(request.body, maxBytes);
    if (!body) return json({ error: 'too_large' }, 413, cors);

    const type = sniffType(body);
    if (!type || (type.ext === 'pdf' && !isPagePixelPdf(body))) {
      return json({ error: 'unsupported_type' }, 415, cors);
    }

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

const PDF_HEADER = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const PDF_NAMES = new Set([
  'Type', 'Catalog', 'Pages', 'Kids', 'Count', 'Page', 'Parent', 'MediaBox', 'Resources', 'XObject', 'Im0',
  'Contents', 'Subtype', 'Image', 'Width', 'Height', 'ColorSpace', 'DeviceRGB', 'BitsPerComponent', 'Filter',
  'DCTDecode', 'Length',
]);
const OBJ_RE = /^\d+ 0 obj\n<<([ A-Za-z0-9/.\[\]<>]*)>>\n/;
const CONTENT_RE = /^q [\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm \/Im0 Do Q$/;
const TAIL_RE = /^xref\n0 \d+\n(?:\d{10} \d{5} [fn] \n)+trailer\n<< \/Size \d+ \/Root 1 0 R >>\nstartxref\n\d+\n%%EOF$/;

// Allowlist, not a blocklist: only the exact structure lib/pdf-writer.js emits is accepted
// (JPEG image pages + one fixed content stream each). Stream bodies are skipped by /Length,
// so look-alike tokens inside image data can't cause false rejections, and name escapes,
// strings, object streams or incremental updates can't slip anything past the check.
export function isPagePixelPdf(bytes) {
  if (ascii(bytes, 0, PDF_HEADER.length) !== PDF_HEADER) return false;
  let pos = PDF_HEADER.length;
  let objects = 0;
  for (;;) {
    const m = OBJ_RE.exec(ascii(bytes, pos, pos + 512));
    if (!m) break;
    const dict = m[1];
    for (const [, name] of dict.matchAll(/\/([A-Za-z0-9]+)/g)) if (!PDF_NAMES.has(name)) return false;
    pos += m[0].length;
    objects++;

    if (ascii(bytes, pos, pos + 7) === 'stream\n') {
      const len = dict.match(/\/Length (\d+) $/);
      if (!len) return false;
      const isImage = / \/Subtype \/Image /.test(dict);
      if (isImage && !/ \/Filter \/DCTDecode /.test(dict)) return false;
      if (!isImage && dict !== ` /Length ${len[1]} `) return false;
      const start = pos + 7;
      const end = start + Number(len[1]);
      if (!isImage && !CONTENT_RE.test(ascii(bytes, start, end))) return false;
      if (ascii(bytes, end, end + 18) !== '\nendstream\nendobj\n') return false;
      pos = end + 18;
    } else if (ascii(bytes, pos, pos + 7) === 'endobj\n') {
      pos += 7;
    } else {
      return false;
    }
  }
  return objects >= 3 && TAIL_RE.test(ascii(bytes, pos, bytes.length));
}

export function newKey(ext) {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${ext}`;
}
