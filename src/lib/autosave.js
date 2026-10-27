// ─── IndexedDB autosave & crash recovery ─────────────────────────────────────
// Projects are stored as structured-clone snapshots. Every Blob / File and every
// `blob:` URL inside a snapshot is swapped for a { __vmBlob: id } reference and
// the binary data goes to a separate `blobs` store, written once per id. This
// keeps each autosave cheap even when sections hold large audio files.

const DB_NAME = 'video-maker-autosave';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const BLOBS = 'blobs';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// All DB work runs one operation at a time so garbage collection can never
// race a save that re-references a blob it is about to delete.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// ── Blob identity bookkeeping (shared across Maker & Studio snapshots) ───────
const blobIds = new WeakMap();   // Blob -> id
const urlIds = new Map();        // blob: URL -> id
const idBlobs = new Map();       // id -> Blob (for URLs we already fetched)
const storedIds = new Set();     // ids known to exist in the BLOBS store

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function idForBlob(blob) {
  let id = blobIds.get(blob);
  if (!id) {
    id = newId();
    blobIds.set(blob, id);
    idBlobs.set(id, blob);
  }
  return id;
}

async function idForUrl(url) {
  const known = urlIds.get(url);
  if (known) return known;
  try {
    const blob = await (await fetch(url)).blob();
    const id = idForBlob(blob);
    urlIds.set(url, id);
    return id;
  } catch {
    return null; // URL was revoked — nothing to keep
  }
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

async function pack(value, used) {
  if (typeof value === 'string') {
    if (!value.startsWith('blob:')) return value;
    const id = await idForUrl(value);
    if (!id) return null;
    used.add(id);
    return { __vmBlob: id, as: 'url' };
  }
  if (value instanceof Blob) {
    const id = idForBlob(value);
    used.add(id);
    return { __vmBlob: id, as: 'blob' };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => pack(v, used).then((p) => (p === undefined ? null : p))));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = await pack(v, used);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)
      && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    return undefined; // DOM nodes, AudioBuffers, class instances — not persistable
  }
  return value;
}

function unpack(value, blobsById, urlCache) {
  if (Array.isArray(value)) return value.map((v) => unpack(v, blobsById, urlCache));
  if (isPlainObject(value)) {
    if (typeof value.__vmBlob === 'string') {
      const blob = blobsById.get(value.__vmBlob);
      if (!blob) return null;
      if (value.as === 'blob') return blob;
      let url = urlCache.get(value.__vmBlob);
      if (!url) {
        url = URL.createObjectURL(blob);
        urlCache.set(value.__vmBlob, url);
        urlIds.set(url, value.__vmBlob);
      }
      return url;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = unpack(v, blobsById, urlCache);
    return out;
  }
  return value;
}

// Delete blobs no saved project references any more.
async function collectGarbage(db) {
  const tx = db.transaction([PROJECTS, BLOBS], 'readwrite');
  const records = await reqToPromise(tx.objectStore(PROJECTS).getAll());
  const keep = new Set(records.flatMap((r) => r.blobIds || []));
  const keys = await reqToPromise(tx.objectStore(BLOBS).getAllKeys());
  for (const key of keys) {
    if (!keep.has(key)) {
      tx.objectStore(BLOBS).delete(key);
      storedIds.delete(key);
    }
  }
  await txDone(tx);
}

/** Save a snapshot under `key` ('maker' | 'studio'). Returns the savedAt timestamp. */
export function saveSnapshot(key, data, meta = {}) {
  return enqueue(() => saveNow(key, data, meta));
}

async function saveNow(key, data, meta) {
  const db = await openDb();
  const used = new Set();
  const packed = await pack(data, used);
  const savedAt = Date.now();

  const tx = db.transaction([PROJECTS, BLOBS], 'readwrite');
  const blobStore = tx.objectStore(BLOBS);
  const fresh = [];
  for (const id of used) {
    if (!storedIds.has(id)) {
      blobStore.put(idBlobs.get(id), id);
      fresh.push(id);
    }
  }
  tx.objectStore(PROJECTS).put({ key, savedAt, meta, data: packed, blobIds: [...used] }, key);
  await txDone(tx);
  fresh.forEach((id) => storedIds.add(id));

  await collectGarbage(db).catch((e) => console.warn('Autosave cleanup failed:', e));
  return savedAt;
}

/** Peek at a snapshot's metadata without restoring blobs. */
export function getSnapshotInfo(key) {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(PROJECTS, 'readonly');
    const rec = await reqToPromise(tx.objectStore(PROJECTS).get(key));
    return rec ? { savedAt: rec.savedAt, meta: rec.meta || {} } : null;
  });
}

/** Load and fully rehydrate a snapshot (blob refs become Blobs / fresh blob: URLs). */
export function loadSnapshot(key) {
  return enqueue(() => loadNow(key));
}

async function loadNow(key) {
  const db = await openDb();
  const tx = db.transaction([PROJECTS, BLOBS], 'readonly');
  const rec = await reqToPromise(tx.objectStore(PROJECTS).get(key));
  if (!rec) return null;
  const blobStore = tx.objectStore(BLOBS);
  const blobsById = new Map();
  await Promise.all((rec.blobIds || []).map(async (id) => {
    const blob = await reqToPromise(blobStore.get(id));
    if (blob) {
      blobsById.set(id, blob);
      blobIds.set(blob, id);
      idBlobs.set(id, blob);
      storedIds.add(id);
    }
  }));
  const data = unpack(rec.data, blobsById, new Map());
  return { savedAt: rec.savedAt, meta: rec.meta || {}, data };
}

export function deleteSnapshot(key) {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(PROJECTS, 'readwrite');
    tx.objectStore(PROJECTS).delete(key);
    await txDone(tx);
    await collectGarbage(db);
  });
}

export function formatSavedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `today at ${time}` : `${d.toLocaleDateString()} ${time}`;
}
