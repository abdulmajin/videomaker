// Shared frame decorations used by both the Maker renderer (renderVideo.js) and
// the Studio renderer (studioRender.js): modern animated bottom captions, colour
// grading presets, brand watermark / end card, and YouTube chapter generation.

// ─── Modern Animated Bottom Captions ─────────────────────────────────────────

const MAX_PHRASE_WORDS = 6;
const PHRASE_GAP_S = 0.55;

const LEGACY_CAPTION_MAP = {
  'karaoke': 'hormozi-pop',
  'modern-card': 'glass-glow',
  'social-pop': 'capcut-pill',
  'classic-cinema': 'cinema-rise',
  'top-banner': 'typewriter-bar',
};

export function normalizeCaptionStyle(style) {
  if (!style) return 'hormozi-pop';
  return LEGACY_CAPTION_MAP[style] || style;
}

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
    if (
      cur.length >= MAX_PHRASE_WORDS ||
      (prev && w.start - prev.end > PHRASE_GAP_S) ||
      (prev && /[.!?]$/.test(prev.text))
    ) {
      phrases.push(cur);
      cur = [];
    }
    cur.push({ text, start: w.start, end: Math.max(w.end ?? w.start, w.start + 0.06) });
  }
  if (cur.length) phrases.push(cur);
  phraseCache.set(words, phrases);
  return phrases;
}

// Synthesizes word timings proportionally from slideText across [slideStart, slideEnd]
// when Whisper word-level timestamps are unavailable for the current slide.
function buildSyntheticPhrases(slideText, slideStart = 0, slideEnd = 0) {
  const clean = String(slideText || '').trim();
  if (!clean) return [];
  const rawWords = clean.split(/\s+/).filter(Boolean);
  if (!rawWords.length) return [];

  const dur = Math.max(0.4, (slideEnd > slideStart ? slideEnd - slideStart : 3.0) * 0.96);
  const weights = rawWords.map((w) => Math.max(2, w.length) + (/[,.;!?]$/.test(w) ? 2.5 : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

  let cursor = slideStart;
  const timedWords = rawWords.map((text, idx) => {
    const span = (weights[idx] / totalWeight) * dur;
    const start = cursor;
    const end = cursor + Math.max(0.06, span);
    cursor = end;
    return { text, start, end };
  });

  const phrases = [];
  let cur = [];
  for (const w of timedWords) {
    const prev = cur[cur.length - 1];
    if (cur.length >= MAX_PHRASE_WORDS || (prev && /[.!?]$/.test(prev.text))) {
      phrases.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);
  return phrases;
}

function resolveActivePhrase({ time, words, slideText, slideStart = 0, slideEnd = 0 }) {
  // 1. Try Whisper word timestamps first if available in the current slide window
  if (words && words.length > 0) {
    const phrases = getPhrases(words);
    let lo = 0,
      hi = phrases.length - 1,
      idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (phrases[mid][0].start <= time + 0.05) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx >= 0) {
      const phrase = phrases[idx];
      const phraseEnd = phrase[phrase.length - 1].end;
      if (time <= phraseEnd + 0.45) {
        return phrase;
      }
    }
  }

  // 2. Fall back to synthetic timed phrases built from slideText
  if (slideText && String(slideText).trim()) {
    const synth = buildSyntheticPhrases(slideText, slideStart, slideEnd);
    if (!synth.length) return null;
    for (let i = synth.length - 1; i >= 0; i--) {
      if (time >= synth[i][0].start - 0.05) {
        return synth[i];
      }
    }
    return synth[0];
  }

  return null;
}

function easeOutCubic(t) {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function easeOutBack(t) {
  const c = Math.max(0, Math.min(1, t));
  const s = 1.70158;
  const p = c - 1;
  return p * p * ((s + 1) * p + s) + 1;
}

/**
 * Draws modern animated captions at the bottom of the video.
 * Supports 7 distinct styles & animations:
 *  - hormozi-pop    : Word-by-word elastic bounce & yellow highlight pop
 *  - capcut-pill    : Dynamic sliding gradient pill around active spoken word
 *  - glass-glow     : Frosted dark glass capsule with gradient border & slide-up
 *  - neon-pulse     : Cyber neon glow aura with kinetic wave motion
 *  - typewriter-bar : Live progressive typewriter reveal with blinking cursor
 *  - cinema-rise    : Smooth word-by-word upward rise & fade
 *  - fire-stamp     : High-impact fiery orange-red stamp with tilt bounce
 */
export function drawModernBottomCaptions(
  ctx,
  {
    width,
    height,
    time,
    words = [],
    slideText = '',
    slideStart = 0,
    slideEnd = 0,
    captionStyle = 'hormozi-pop',
    isVertical = false,
  }
) {
  const style = normalizeCaptionStyle(captionStyle);
  if (!style || style === 'none') return false;

  const phrase = resolveActivePhrase({ time, words, slideText, slideStart, slideEnd });
  if (!phrase || phrase.length === 0) return false;

  const phraseStart = phrase[0].start;
  const phraseEnd = phrase[phrase.length - 1].end;
  const phraseElapsed = Math.max(0, time - phraseStart);
  const phraseRemaining = Math.max(0, phraseEnd + 0.35 - time);

  // Entrance and exit animation progress
  const enterP = Math.min(1, phraseElapsed / 0.22);
  const exitAlpha = phraseRemaining < 0.16 ? Math.max(0, phraseRemaining / 0.16) : 1;

  // Determine active spoken word index (stays locked during tiny inter-word pauses)
  let activeWordIdx = 0;
  for (let i = 0; i < phrase.length; i++) {
    if (time >= phrase[i].start) {
      activeWordIdx = i;
    }
  }
  const activeWordObj = phrase[activeWordIdx];
  const wordElapsed = activeWordObj ? Math.max(0, time - activeWordObj.start) : 0;
  const wordDur = activeWordObj ? Math.max(0.08, activeWordObj.end - activeWordObj.start) : 0.25;
  const wordPopP = Math.min(1, wordElapsed / 0.15);

  const isUppercase =
    style === 'hormozi-pop' ||
    style === 'capcut-pill' ||
    style === 'neon-pulse' ||
    style === 'fire-stamp';

  // Font sizing responsive to canvas resolution and aspect ratio
  const fs = isVertical
    ? Math.max(30, Math.round(width * (style === 'hormozi-pop' || style === 'fire-stamp' ? 0.062 : 0.054)))
    : Math.max(26, Math.round(width * (style === 'hormozi-pop' || style === 'fire-stamp' ? 0.036 : 0.031)));

  const fontFamily =
    style === 'hormozi-pop' || style === 'fire-stamp'
      ? 'Impact, "Arial Black", system-ui, sans-serif'
      : style === 'typewriter-bar'
      ? '"Courier New", ui-monospace, system-ui, monospace'
      : 'system-ui, -apple-system, "Segoe UI", sans-serif';

  const fontWeight = style === 'cinema-rise' || style === 'glass-glow' ? '700' : '900';

  ctx.save();
  ctx.font = `${fontWeight} ${fs}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const space = ctx.measureText(' ').width + fs * 0.26;
  const items = phrase.map((w, idx) => {
    let label = isUppercase ? w.text.toUpperCase() : w.text;
    // For typewriter-bar, slice active word progressively and hide future words
    if (style === 'typewriter-bar') {
      if (idx > activeWordIdx) {
        label = '';
      } else if (idx === activeWordIdx) {
        const charCount = Math.max(1, Math.ceil(Math.min(1, wordElapsed / wordDur) * label.length));
        label = label.slice(0, charCount);
      }
    }
    return {
      ...w,
      idx,
      label,
      fullLabel: isUppercase ? w.text.toUpperCase() : w.text,
      w: ctx.measureText(isUppercase ? w.text.toUpperCase() : w.text).width,
      curW: ctx.measureText(label).width,
    };
  });

  // Wrap into 1-2 lines fitting within 86% of canvas width
  const maxW = width * (isVertical ? 0.88 : 0.82);
  const lines = [[]];
  let lineW = 0;
  for (const it of items) {
    const add = (lines[lines.length - 1].length ? space : 0) + it.w;
    if (lineW + add > maxW && lines[lines.length - 1].length) {
      lines.push([it]);
      lineW = it.w;
    } else {
      lines[lines.length - 1].push(it);
      lineW += add;
    }
  }

  const lh = fs * 1.34;
  const totalTextH = lines.length * lh;

  // Measure widest line for backdrop capsule
  let maxLineW = 0;
  for (const line of lines) {
    const lw = line.reduce((s, it, i) => s + it.w + (i ? space : 0), 0);
    if (lw > maxLineW) maxLineW = lw;
  }

  // Anchor cleanly at the bottom of the video
  const bottomMargin = isVertical ? Math.round(height * 0.085) : Math.round(height * 0.055);
  const baseY = height - bottomMargin - totalTextH / 2;

  // Phrase-level entrance transform
  let blockOffsetY = 0;
  let blockScale = 1;
  let blockAlpha = exitAlpha;

  if (style === 'hormozi-pop' || style === 'fire-stamp') {
    blockScale = 0.82 + 0.18 * easeOutBack(enterP);
    blockAlpha *= Math.min(1, enterP * 1.6);
  } else if (style === 'glass-glow' || style === 'capcut-pill' || style === 'cinema-rise') {
    blockOffsetY = (1 - easeOutCubic(enterP)) * (fs * 0.75);
    blockAlpha *= easeOutCubic(enterP);
  } else {
    blockAlpha *= Math.min(1, enterP * 1.5);
  }

  ctx.globalAlpha = Math.max(0, Math.min(1, blockAlpha));
  ctx.translate(width / 2, baseY + blockOffsetY);
  ctx.scale(blockScale, blockScale);
  ctx.translate(-width / 2, -baseY);

  // Draw bottom container pill / bar per style
  const padX = Math.round(fs * 0.65);
  const padY = Math.round(fs * 0.38);
  const boxW = Math.min(width * 0.94, maxLineW + padX * 2);
  const boxH = totalTextH + padY * 2;
  const boxX = (width - boxW) / 2;
  const boxY = baseY - boxH / 2;

  if (style === 'glass-glow') {
    ctx.save();
    ctx.shadowColor = 'rgba(2, 6, 23, 0.65)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    roundRect(ctx, boxX, boxY, boxW, boxH, Math.min(22, boxH / 2));
    ctx.fill();

    const grad = ctx.createLinearGradient(boxX, boxY, boxX + boxW, boxY + boxH);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.5, '#818cf8');
    grad.addColorStop(1, '#2dd4bf');
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, fs * 0.06);
    ctx.stroke();
    ctx.restore();
  } else if (style === 'capcut-pill' || style === 'hormozi-pop' || style === 'cinema-rise') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle =
      style === 'hormozi-pop'
        ? 'rgba(9, 13, 22, 0.72)'
        : style === 'cinema-rise'
        ? 'rgba(9, 13, 22, 0.78)'
        : 'rgba(15, 23, 42, 0.84)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 16);
    ctx.fill();
    ctx.restore();
  } else if (style === 'neon-pulse') {
    ctx.save();
    ctx.shadowColor = 'rgba(168, 85, 247, 0.55)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(6, 10, 25, 0.88)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  } else if (style === 'typewriter-bar') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(10, 15, 29, 0.92)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 12);
    ctx.fill();

    // Left vertical gold accent bar
    ctx.fillStyle = '#f59e0b';
    roundRect(ctx, boxX + 6, boxY + 6, 6, boxH - 12, 3);
    ctx.fill();
    ctx.restore();
  } else if (style === 'fire-stamp') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 7;
    ctx.fillStyle = 'rgba(12, 12, 18, 0.92)';
    roundRect(ctx, boxX, boxY, boxW, boxH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Render each line and word with its per-style animation
  lines.forEach((line, li) => {
    const total = line.reduce((s, it, i) => s + it.w + (i ? space : 0), 0);
    let x = (width - total) / 2;
    const y = baseY + (li - (lines.length - 1) / 2) * lh;

    for (const it of line) {
      const isActive = it.idx === activeWordIdx;
      const isSpoken = it.idx < activeWordIdx;

      if (style === 'typewriter-bar' && !it.label) {
        x += it.w + space;
        continue;
      }

      ctx.save();

      // Compute word-level animation transforms
      let wScale = 1;
      let wDy = 0;
      let wRot = 0;
      let wAlpha = 1;

      if (style === 'hormozi-pop') {
        if (isActive) {
          const bounce = Math.sin(wordPopP * Math.PI * 0.65);
          wScale = 1 + 0.22 * bounce;
          wDy = -fs * 0.1 * bounce;
        }
      } else if (style === 'capcut-pill') {
        if (isActive) {
          wScale = 1 + 0.12 * easeOutBack(wordPopP);
        }
      } else if (style === 'glass-glow') {
        if (isActive) {
          wScale = 1 + 0.08 * easeOutCubic(wordPopP);
          wDy = -fs * 0.07 * easeOutCubic(wordPopP);
        }
      } else if (style === 'neon-pulse') {
        wDy = Math.sin(time * 5.5 + it.idx * 0.85) * (fs * 0.06);
        if (isActive) {
          wScale = 1 + 0.15 * easeOutBack(wordPopP);
        }
      } else if (style === 'cinema-rise') {
        if (isActive) {
          const riseP = easeOutCubic(wordPopP);
          wDy = (1 - riseP) * (fs * 0.32);
          wScale = 1 + 0.06 * riseP;
        } else if (!isSpoken) {
          wDy = fs * 0.18;
          wAlpha = 0.42;
        }
      } else if (style === 'fire-stamp') {
        if (isActive) {
          const bounce = easeOutBack(wordPopP);
          wScale = 1 + 0.18 * bounce;
          wRot = (it.idx % 2 === 0 ? -1 : 1) * 0.045 * bounce;
        }
      }

      const wordCenterX = x + it.w / 2;
      ctx.translate(wordCenterX, y + wDy);
      if (wRot !== 0) ctx.rotate(wRot);
      if (wScale !== 1) ctx.scale(wScale, wScale);
      ctx.translate(-wordCenterX, -(y + wDy));
      ctx.globalAlpha *= wAlpha;

      // Active word background highlight pill (for CapCut Pill & Fire Stamp)
      if (isActive && (style === 'capcut-pill' || style === 'fire-stamp')) {
        const pillPadX = fs * 0.22;
        const pillPadY = fs * 0.13;
        const px = x - pillPadX;
        const py = y + wDy - fs / 2 - pillPadY;
        const pw = it.w + pillPadX * 2;
        const ph = fs + pillPadY * 2;

        const pGrad = ctx.createLinearGradient(px, py, px + pw, py + ph);
        if (style === 'capcut-pill') {
          pGrad.addColorStop(0, '#ec4899');
          pGrad.addColorStop(1, '#8b5cf6');
          ctx.shadowColor = 'rgba(236, 72, 153, 0.65)';
        } else {
          pGrad.addColorStop(0, '#f97316');
          pGrad.addColorStop(1, '#dc2626');
          ctx.shadowColor = 'rgba(249, 115, 22, 0.7)';
        }
        ctx.shadowBlur = 14;
        ctx.fillStyle = pGrad;
        roundRect(ctx, px, py, pw, ph, fs * 0.24);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Word stroke / glow
      if (style === 'neon-pulse') {
        ctx.shadowColor = isActive ? '#22d3ee' : '#a855f7';
        ctx.shadowBlur = isActive ? 22 : 10;
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
        ctx.lineWidth = Math.max(3, fs * 0.11);
        ctx.lineJoin = 'round';
        ctx.strokeText(it.label, x, y + wDy);
      } else if (style === 'hormozi-pop' || style === 'capcut-pill' || style === 'fire-stamp') {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
        ctx.lineWidth = Math.max(4, fs * 0.16);
        ctx.strokeText(it.label, x, y + wDy);
      } else {
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = Math.max(2.5, fs * 0.09);
        ctx.strokeText(it.label, x, y + wDy);
      }

      // Word fill color per style
      if (style === 'hormozi-pop') {
        ctx.fillStyle = isActive ? '#fde047' : isSpoken ? '#ffffff' : '#cbd5e1';
      } else if (style === 'capcut-pill') {
        ctx.fillStyle = '#ffffff';
      } else if (style === 'glass-glow') {
        ctx.fillStyle = isActive ? '#38bdf8' : isSpoken ? '#f8fafc' : '#94a3b8';
      } else if (style === 'neon-pulse') {
        ctx.fillStyle = isActive ? '#22d3ee' : isSpoken ? '#ffffff' : '#e2e8f0';
      } else if (style === 'typewriter-bar') {
        ctx.fillStyle = isActive ? '#fbbf24' : '#f8fafc';
      } else if (style === 'cinema-rise') {
        ctx.fillStyle = isActive ? '#fef08a' : '#ffffff';
      } else if (style === 'fire-stamp') {
        ctx.fillStyle = isActive ? '#ffffff' : isSpoken ? '#fde047' : '#f1f5f9';
      } else {
        ctx.fillStyle = '#ffffff';
      }

      ctx.fillText(it.label, x, y + wDy);

      // Blinking cursor for typewriter-bar on active word
      if (style === 'typewriter-bar' && isActive) {
        const blink = Math.floor(time * 4) % 2 === 0;
        if (blink) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(x + it.curW + 3, y + wDy - fs * 0.42, Math.max(3, fs * 0.1), fs * 0.84);
        }
      }

      ctx.restore();
      x += it.w + space;
    }
  });

  ctx.restore();
  return true;
}

/** Alias kept for backward compatibility. */
export function drawKaraokeCaptions(ctx, opts) {
  return drawModernBottomCaptions(ctx, { ...opts, captionStyle: opts?.captionStyle || 'hormozi-pop' });
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
