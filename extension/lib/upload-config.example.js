// Copy to upload-config.js (gitignored) and set UPLOAD_KEY to the Worker's UPLOAD_KEY secret.
// The key ships inside the extension, so it only slows abuse down; the Worker's rate limit,
// size cap and type checks are the real protection.
export const UPLOAD_ENDPOINT = 'https://upload.omwly.com/upload';
export const UPLOAD_KEY = 'replace-with-the-worker-secret';
