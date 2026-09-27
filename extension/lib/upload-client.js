import { UPLOAD_ENDPOINT, UPLOAD_KEY } from './upload-config.js';

const PUBLIC_URL_PREFIX = 'https://img.omwly.com/';

const MESSAGES = {
  rate_limited: 'Too many uploads — try again in a minute.',
  bad_key: 'Upload not authorized — please update PagePixel.',
  origin_not_allowed: 'Upload not authorized — please update PagePixel.',
  too_large: "This file couldn't be accepted (too large or unsupported).",
  unsupported_type: "This file couldn't be accepted (too large or unsupported).",
  network: "Couldn't reach img.omwly.com — check your connection.",
};
const FALLBACK_MESSAGE = 'Upload failed — please try again.';
const SERVER_CODES = new Set(['rate_limited', 'bad_key', 'origin_not_allowed', 'too_large', 'unsupported_type', 'storage_failed']);

export class UploadError extends Error {
  constructor(code) {
    super(MESSAGES[code] || FALLBACK_MESSAGE);
    this.name = 'UploadError';
    this.code = code;
  }
}

export function isPublicUploadUrl(url) {
  return typeof url === 'string' && url.startsWith(PUBLIC_URL_PREFIX) && !/[\s"'<>]/.test(url);
}

/**
 * @param {Blob} blob already-encoded image or PDF
 * @returns {Promise<{ url: string }>}
 */
export async function uploadBlob(blob, { fetchImpl = (...args) => fetch(...args), endpoint = UPLOAD_ENDPOINT, key = UPLOAD_KEY, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': blob.type, 'X-PagePixel-Key': key },
      body: blob,
      signal: controller.signal,
    });
  } catch {
    throw new UploadError('network');
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 201) {
    if (isPublicUploadUrl(data.url)) return { url: data.url };
    throw new UploadError('bad_response');
  }
  throw new UploadError(SERVER_CODES.has(data.error) ? data.error : 'server');
}
