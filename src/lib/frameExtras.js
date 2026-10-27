// Shared frame decorations used by both the Maker renderer (renderVideo.js) and
// the Studio renderer (studioRender.js): word-by-word karaoke captions, colour
// grading presets, brand watermark / end card, and YouTube chapter generation.

// ─── Karaoke (word-by-word) captions ─────────────────────────────────────────

const MAX_PHRASE_WORDS = 5;
const PHRASE_GAP_S = 0.6;

// Splits transcript words into short on-screen phrases. Cached per words array.
const phraseCache = new WeakMap();
function getPhrases(words) {
  let phrases = phraseCache.get(words);
  if (phrases) return phrases;
  phrases = [];
  let cur = [];
  for (const w of words) {
    const text = String(w.text || '').trim();
    if (!text) continue;
    const prev = cur[cur.length - 1];
    if (cur.length >= MAX_PHRASE_WORDS || (prev && w.start - prev.end > PHRASE_GAP_S) || (prev && /[.!?]$/.test(prev.text))) {
      phrases.push(cur);
      cur = [];
    }
    cur.push({ text, start: w.start, end: Math.max(w.end ?? w.start, w.start + 0.05) });
  }
  if (cur.length) phrases.push(cur);
  phraseCache.set(words, phrases);
  return phrases;
}

/** Returns true when something was drawn (so callers can fall back otherwise). */
export function drawKaraokeCaptions(ctx, { width, height, time, words, isVertical }) {
  if (!words || words.length === 0) return false;
  const phrases = getPhrases(words);
  // Binary-search the phrase that is active (or the last one that started)
  let lo = 0, hi = phrases.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (phrases[mid][0].start <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return true;
  const phrase = phrases[idx];
  const phraseEnd = phrase[phrase.length - 1].end;
  if (time > phraseEnd + 0.4) return true; // silence — keep the screen clean

  const fs = isVertical ? Math.max(34, Math.round(width * 0.065)) : Math.max(30, Math.round(width * 0.038));
  ctx.save();
  ctx.font = `900 ${fs}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // Extra gap leaves room for the active word's highlight pill and pop scale
  const space = ctx.measureText(' ').width + fs * 0.3;
  const items = phrase.map((w) => ({ ...w, label: w.text.toUpperCase(), w: ctx.measureText(w.text.toUpperCase()).width }));

  // Wrap into lines that fit 88% of the width
  const maxW = width * 0.88;
  const lines = [[]];
  let lineW = 0;
  for (const it of items) {
    const add = (lines[lines.length - 1].length ? space : 0) + it.w;
    if (lineW + add > maxW && lines[lines.length - 1].length) { lines.push([it]); lineW = it.w; }
    else { lines[lines.length - 1].push(it); lineW += add; }
  }

  const lh = fs * 1.3;
  const baseY = isVertical ? height * 0.72 : height - (lines.length * lh) / 2 - 60;
  lines.forEach((line, li) => {
    const total = line.reduce((s, it, i) => s + it.w + (i ? space : 0), 0);
    let x = (width - total) / 2;
    const y = baseY + (li - (lines.length - 1) / 2) * lh;
    for (const it of line) {
      const active = time >= it.start && time < it.end;
      const spoken = time >= it.end;
      ctx.save();
      if (active) {
        const p = Math.min(1, (time - it.start) / 0.12);
        const s = 1 + 0.12 * p;
        ctx.translate(x + it.w / 2, y);
        ctx.scale(s, s);
        ctx.translate(-(x + it.w / 2), -y);
        ctx.fillStyle = 'rgba(13, 148, 136, 0.95)';
        const padX = fs * 0.18, padY = fs * 0.12;
        roundRect(ctx, x - padX, y - fs / 2 - padY, it.w + padX * 2, fs + padY * 2, fs * 0.2);
        ctx.fill();
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = Math.max(4, fs * 0.14);
      ctx.strokeText(it.label, x, y);
      ctx.fillStyle = active ? '#ffffff' : spoken ? '#fde047' : '#f8fafc';
      ctx.fillText(it.label, x, y);
      ctx.restore();
      x += it.w + space;
    }
  });
  ctx.restore();
  return true;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Offsets each section's words by its start time so they line up with the merged audio. */
export function mergeWords(sections) {
  const out = [];
  let offset = 0;
  for (const s of sections) {
    for (const w of s.words || []) out.push({ ...w, start: w.start + offset, end: (w.end ?? w.start) + offset });
    offset += s.duration || 0;
  }
  return out;
}

// ─── Colour grading ──────────────────────────────────────────────────────────

export const COLOR_GRADES = [
  { id: 'none',      label: '🎞️ Original',        filter: 'none' },
  { id: 'warm',      label: '🌅 Warm',            filter: 'sepia(0.18) saturate(1.2) brightness(1.04)' },
  { id: 'cool',      label: '❄️ Cool',            filter: 'hue-rotate(-12deg) saturate(1.05) brightness(1.02)' },
  { id: 'vivid',     label: '🌈 Vivid',           filter: 'saturate(1.45) contrast(1.08)' },
  { id: 'cinematic', label: '🎬 Cinematic',       filter: 'contrast(1.18) saturate(0.85) brightness(0.95)' },
  { id: 'vintage',   label: '📼 Vintage',         filter: 'sepia(0.45) contrast(0.92) brightness(1.05) saturate(0.85)' },
  { id: 'mono',      label: '⚫ Black & White',   filter: 'grayscale(1) contrast(1.12)' },
  { id: 'noir',      label: '🕵️ Noir',            filter: 'grayscale(1) contrast(1.45) brightness(0.9)' },
  { id: 'fade',      label: '🌫️ Faded',           filter: 'contrast(0.82) brightness(1.1) saturate(0.8)' },
];

/** ctx.filter string for a slide: per-slide override wins, then the project grade. */
export function gradeFilter(projectGrade, slideGrade) {
  const id = slideGrade && slideGrade !== 'auto' ? slideGrade : projectGrade;
  return COLOR_GRADES.find((g) => g.id === id)?.filter || 'none';
}

// ─── Brand kit: logo watermark + end card ────────────────────────────────────

export const DEFAULT_BRAND = {
  logoPosition: 'top-right', // top-left | top-right | bottom-left | bottom-right
  logoSize: 0.12,            // fraction of canvas width
  logoOpacity: 0.85,
  endCardText: '',
  endCardSeconds: 3,
  accentColor: '#0d9488',
};

export function drawBrand(ctx, { width, height, time, duration, brand, logoImg }) {
  if (!brand) return;
  const b = { ...DEFAULT_BRAND, ...brand };
  const margin = Math.round(Math.min(width, height) * 0.03);

  if (logoImg && logoImg.naturalWidth) {
    const lw = width * b.logoSize;
    const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    const x = b.logoPosition.endsWith('left') ? margin : width - lw - margin;
    const y = b.logoPosition.startsWith('top') ? margin : height - lh - margin;
    ctx.save();
    ctx.globalAlpha = b.logoOpacity;
    ctx.drawImage(logoImg, x, y, lw, lh);
    ctx.restore();
  }

  const text = (b.endCardText || '').trim();
  const start = duration - (b.endCardSeconds || 3);
  if (text && time >= start && duration > b.endCardSeconds) {
    const p = Math.min(1, (time - start) / 0.4);
    const isVertical = height > width;
    const fs = isVertical ? Math.max(30, Math.round(width * 0.06)) : Math.max(28, Math.round(width * 0.036));
    ctx.save();
    ctx.globalAlpha = p;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(0, 0, width, height);
    ctx.font = `900 ${fs}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const bw = Math.min(width * 0.9, tw + fs * 1.6), bh = fs * 2;
    const cy = height / 2 + (1 - p) * 30;
    ctx.fillStyle = b.accentColor;
    roundRect(ctx, (width - bw) / 2, cy - bh / 2, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, cy, width * 0.85);
    ctx.restore();
  }
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── YouTube chapters ────────────────────────────────────────────────────────

function chapterTime(s) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const mm = String(m).padStart(2, '0');
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Builds YouTube chapter lines from merged rows (one chapter per section).
 * Returns { text, warnings } — YouTube needs ≥3 chapters, the first at 00:00,
 * and each at least 10 seconds long.
 */
export function buildChapters(rows, duration) {
  const chapters = [];
  for (const r of rows || []) {
    const title = r.sectionTitle || `Section ${(r.sectionIndex ?? 0) + 1}`;
    if (!chapters.length || chapters[chapters.length - 1].sectionIndex !== r.sectionIndex) {
      chapters.push({ start: chapters.length ? r.start : 0, title, sectionIndex: r.sectionIndex });
    }
  }
  const warnings = [];
  if (chapters.length < 3) warnings.push(`YouTube needs at least 3 chapters — this video has ${chapters.length} section(s).`);
  chapters.forEach((c, i) => {
    const end = chapters[i + 1] ? chapters[i + 1].start : duration;
    if (end - c.start < 10) warnings.push(`"${c.title}" is shorter than 10 seconds; YouTube may ignore the chapters.`);
  });
  const text = chapters.map((c) => `${chapterTime(c.start)} ${c.title}`).join('\n');
  return { text, warnings, count: chapters.length };
}
