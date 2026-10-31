// ─── Minimal dependency-free ZIP writer / reader for project bundles ─────────
//
// Why: saving a project as a single JSON string with base64-embedded images and
// audio hits the browser's maximum string length (~512 MB in Chromium) and
// crashes with "RangeError: Invalid string length".
//
// A ZIP bundle keeps a tiny `project.json` plus every asset as raw binary.
// Entries use the STORE method (no compression) — images/audio are already
// compressed formats, so deflating them gains almost nothing and costs time.
//
// The output is assembled as a Blob from parts (original Blobs are referenced,
// not copied into one big buffer), so memory stays low even for huge projects.

// ── CRC-32 ───────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, crc = 0) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Compute CRC over a Blob in chunks so very large audio files don't need one huge buffer
async function crc32OfBlob(blob) {
  const CHUNK = 8 * 1024 * 1024;
  let crc = 0;
  for (let offset = 0; offset < blob.size; offset += CHUNK) {
    const buf = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
    crc = crc32(buf, crc);
  }
  return crc;
}

// ── DOS date/time ────────────────────────────────────────────────────────────
function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: time & 0xffff, day: day & 0xffff };
}

const MAX_U32 = 0xffffffff;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Build a ZIP Blob.
 * @param {Array<{name: string, data: Blob|string}>} entries
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function createZipBlob(entries, onProgress) {
  const parts = [];
  const central = [];
  const { time, day } = dosDateTime();
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const blob =
      typeof entry.data === 'string'
        ? new Blob([textEncoder.encode(entry.data)])
        : entry.data;
    const nameBytes = textEncoder.encode(entry.name);
    const size = blob.size;
    const crc = await crc32OfBlob(blob);

    if (size >= MAX_U32 || offset >= MAX_U32) {
      throw new Error('Project is larger than 4 GB, which exceeds the ZIP format limit.');
    }

    // Local file header (30 bytes + name)
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: UTF-8 filenames
    local.setUint16(8, 0, true); // method: STORE
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length

    parts.push(local.buffer, nameBytes, blob);

    // Central directory record (46 bytes + name)
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, day, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // comment
    cd.setUint16(34, 0, true); // disk number
    cd.setUint16(36, 0, true); // internal attrs
    cd.setUint32(38, 0, true); // external attrs
    cd.setUint32(42, offset, true); // local header offset
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + size;
    onProgress?.(i + 1, entries.length);
  }

  const cdStart = offset;
  const cdSize = central.reduce((sum, p) => sum + p.byteLength, 0);
  if (cdStart + cdSize >= MAX_U32 || entries.length > 0xffff) {
    throw new Error('Project is too large for the ZIP format (over 4 GB or 65,535 files).');
  }

  // End of central directory (22 bytes)
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
}

/** True when the Blob starts with the ZIP local-file-header signature "PK\x03\x04". */
export async function isZipBlob(blob) {
  if (!blob || blob.size < 4) return false;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * Read a ZIP Blob lazily. Returns a Map of entry name → { size, getBlob(type?) , getText() }.
 * Only the central directory is read up front; entry data is sliced on demand.
 * Supports STORE (0) and DEFLATE (8, via DecompressionStream) entries.
 */
export async function readZip(blob) {
  // Locate the End Of Central Directory record (within the last 64 KB + 22 bytes)
  const tailSize = Math.min(blob.size, 0xffff + 22);
  const tailStart = blob.size - tailSize;
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocdPos = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error('Not a valid project ZIP (end of central directory not found).');

  const count = tail.getUint16(eocdPos + 10, true);
  const cdSize = tail.getUint32(eocdPos + 12, true);
  const cdOffset = tail.getUint32(eocdPos + 16, true);
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());

  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt project ZIP (bad central directory).');
    const method = cd.getUint16(p + 10, true);
    const compSize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const localOffset = cd.getUint32(p + 42, true);
    const name = textDecoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry

    const getRaw = async () => {
      // Local header has its own name/extra lengths which may differ from the central record
      const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
      if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`Corrupt entry: ${name}`);
      const dataStart = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      return blob.slice(dataStart, dataStart + compSize);
    };

    const getBlob = async (type = '') => {
      const raw = await getRaw();
      if (method === 0) return type ? new Blob([raw], { type }) : raw;
      if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const out = await new Response(stream).blob();
        return type ? new Blob([out], { type }) : out;
      }
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    };

    entries.set(name, {
      name,
      size,
      getBlob,
      getText: async () => (await getBlob()).text(),
    });
  }
  return entries;
}

// ── MIME helpers ─────────────────────────────────────────────────────────────
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

const EXT_MIME = Object.fromEntries(
  Object.entries(MIME_EXT).reverse().map(([mime, ext]) => [ext, mime])
);

export function extFromMime(mime) {
  return MIME_EXT[(mime || '').split(';')[0].trim().toLowerCase()] || 'bin';
}

export function mimeFromName(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || '';
}

/** Sanitize a user file name for use inside the ZIP. */
export function safeEntryName(name) {
  return (name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
}
