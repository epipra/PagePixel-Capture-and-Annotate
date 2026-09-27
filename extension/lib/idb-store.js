// Shared IndexedDB transfer buffer for handing a captured image (which can be
// many megabytes) from the background service worker to result.html without
// bumping into runtime.sendMessage payload limits or chrome.storage quotas.
const DB_NAME = 'pagepixel';
const DB_VERSION = 1;
const STORE = 'captures';

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} id
 * @param {{blob: Blob, mode: string, sourceUrl: string, sourceTitle: string, createdAt: number}} record
 */
export async function putCapture(id, record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, ...record });
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** @param {string} id */
export async function getCapture(id) {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return record;
}

/** @param {string} id */
export async function deleteCapture(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function newCaptureId() {
  return `cap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
