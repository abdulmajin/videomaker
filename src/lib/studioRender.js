/**
 * studioRender.js
 * Canvas frame renderer for the Studio Editor.
 * Draws slide images (with Canva-style animations), slide transitions,
 * captions, retention hooks, and all editor overlay layers
 * (text, shapes, image overlays) composited on top.
 */

import { computeSlideTransform, getSlideAnimation } from './animations.js';

// ─── Exported constants ────────────────────────────────────────────────────────

export const TRANSITION_TYPES = [
  { id: 'none',             label: '✂️ Cut (No Transition)' },
  { id: 'crossfade',        label: '🌫️ Crossfade / Dissolve' },
  { id: 'wipe-left',        label: '◀️ Wipe Left' },
  { id: 'wipe-right',       label: '▶️ Wipe Right' },
  { id: 'zoom-blend',       label: '🔍 Zoom Blend' },
  { id: 'slide-push-left',  label: '⬅️ Push Left' },
  { id: 'slide-push-right', label: '➡️ Push Right' },
];

export const LAYER_ANIMATIONS = [
  { id: 'none',        label: '🚫 None (Static)' },
  { id: 'fade-in',     label: '🌫️ Fade In' },
  { id: 'slide-left',  label: '⬅️ Slide In from Right' },
  { id: 'slide-right', label: '➡️ Slide In from Left' },
  { id: 'slide-up',    label: '⬆️ Slide Up' },
  { id: 'zoom-in',     label: '🔍 Zoom In' },
  { id: 'typewriter',  label: '⌨️ Typewriter' },
  { id: 'bounce',      label: '🏀 Bounce Pop' },
];

// ─── Easing helpers ────────────────────────────────────────────────────────────

function easeOutCubic(t) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

function easeOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const tc = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(tc - 1, 3) + c1 * Math.pow(tc - 1, 2);
}

function easeOutQuad(t) {
  const tc = Math.min(1, Math.max(0, t));
  return 1 - (1 - tc) * (1 - tc);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const test = current + ' ' + words[i];
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Image preloading ─────────────────────────────────────────────────────────

export async function preloadStudioImages(imageUrls) {
  return Promise.all(
    (imageUrls || []).map(
      (url) =>
        new Promise((resolve) => {
          if (!url) return resolve(null);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = url;
        })
    )
  );
}

export async function preloadLayerImages(layers) {
  const entries = await Promise.all(
    (layers || [])
      .filter((l) => l.type === 'image' && l.imageUrl)
      .map(
        (l) =>
          new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve([l.id, img]);
            img.onerror = () => resolve([l.id, null]);
            img.src = l.imageUrl;
          })
      )
  );
  return new Map(entries.filter(Boolean));
}

// ─── Slide image drawing helper ───────────────────────────────────────────────

function drawSlideImage({ ctx, img, activeIndex, activeSlide, animType, slideStart, slideDuration, time, width, height, captionAreaReserved }) {
  const isVertical = height > width;
  const maxImgHeight = isVertical ? height * 0.58 : captionAreaReserved ? height * 0.72 : height * 0.88;
  const maxImgWidth  = isVertical ? width * 0.96 : width * 0.94;
  const centerX = width / 2;
  const centerY = isVertical ? height * 0.40 : captionAreaReserved ? 36 + maxImgHeight / 2 : height / 2;

  const transform = computeSlideTransform({ animType, slideStart, slideDuration, time, canvasWidth: width, canvasHeight: height });

  ctx.save();
  if (img && img.naturalWidth) {
    const ratio = Math.min(maxImgWidth / img.naturalWidth, maxImgHeight / img.naturalHeight);
    const dw = img.naturalWidth * ratio;
    const dh = img.naturalHeight * ratio;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    ctx.fillStyle = '#1e293b';
    const bw = isVertical ? width * 0.85 : width * 0.58;
    const bh = isVertical ? height * 0.38 : height * 0.44;
    drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 16);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Slide ${activeSlide ? activeSlide.id : activeIndex + 1}`, 0, 0);
  }
  ctx.restore();
}

// ─── Caption drawing ──────────────────────────────────────────────────────────

function drawCaptions(ctx, { width, height, captionStyle, slideNumber, text, isVertical }) {
  if (!text) return;
  ctx.save();

  if (captionStyle === 'social-pop') {
    const fs = isVertical ? Math.max(30, Math.round(width * 0.048)) : Math.max(26, Math.round(width * 0.028));
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapText(ctx, text.toUpperCase(), width * 0.88);
    const lh = fs * 1.35;
    const startY = height - lines.length * lh - (isVertical ? 110 : 50);
    lines.forEach((line, i) => {
      const ly = startY + i * lh;
      const tw = ctx.measureText(line).width;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      drawRoundedRect(ctx, width / 2 - tw / 2 - 18, ly - fs / 2 - 6, tw + 36, fs + 12, 8);
      ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.strokeText(line, width / 2, ly);
      ctx.fillStyle = '#fde047';
      ctx.fillText(line, width / 2, ly);
    });
  } else if (captionStyle === 'classic-cinema') {
    const fs = isVertical ? Math.max(26, Math.round(width * 0.040)) : Math.max(22, Math.round(width * 0.024));
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const lines = wrapText(ctx, text, width * 0.84);
    const lh = fs * 1.3;
    const startY = height - (lines.length - 1) * lh - (isVertical ? 90 : 36);
    lines.forEach((line, i) => {
      const ly = startY + i * lh;
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
      ctx.strokeText(line, width / 2, ly);
      ctx.fillStyle = '#fff'; ctx.fillText(line, width / 2, ly);
    });
  } else if (captionStyle === 'top-banner') {
    const bh = isVertical ? 65 : 54;
    ctx.fillStyle = 'rgba(15,23,42,0.92)'; ctx.fillRect(0, 0, width, bh);
    ctx.fillStyle = '#0d9488'; ctx.fillRect(0, bh - 3, width, 3);
    const tag = `SLIDE ${slideNumber}:`;
    ctx.font = '700 13px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#14b8a6'; ctx.fillText(tag, 18, bh / 2);
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = '#fff'; ctx.font = '500 15px system-ui';
    ctx.fillText(text.slice(0, 110) + (text.length > 110 ? '…' : ''), 28 + tw, bh / 2);
  } else if (captionStyle !== 'none') {
    // modern-card (default)
    const fs = isVertical ? Math.max(24, Math.round(width * 0.038)) : Math.max(22, Math.round(width * 0.023));
    ctx.font = `500 ${fs}px system-ui, sans-serif`;
    const lines = wrapText(ctx, text, width * (isVertical ? 0.88 : 0.82));
    const lh = fs * 1.35;
    const badgeH = 22; const padY = 16; const padX = 26;
    const boxH = lines.length * lh + padY * 2 + badgeH;
    const boxW = Math.min(width * 0.94, width * (isVertical ? 0.88 : 0.82) + padX * 2);
    const boxX = (width - boxW) / 2;
    const boxY = height - boxH - (isVertical ? 70 : 34);
    ctx.fillStyle = 'rgba(15,23,42,0.88)';
    drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#0d9488';
    drawRoundedRect(ctx, boxX + padX, boxY + padY, 88, 20, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`SLIDE ${slideNumber}`, boxX + padX + 44, boxY + padY + 10);
    ctx.fillStyle = '#fff'; ctx.font = `500 ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let ly = boxY + padY + badgeH + fs;
    for (const line of lines) { ctx.fillText(line, boxX + padX, ly); ly += lh; }
  }
  ctx.restore();
}

function drawRetentionHook(ctx, { width, height, time, slideStart, text, style, isVertical }) {
  const elapsed = time - slideStart;
  if (elapsed < 0 || elapsed > 1.8) return;
  let scale = 1, opacity = 1;
  if (elapsed < 0.35) { const p = elapsed / 0.35; scale = 0.7 + 0.35 * Math.sin(p * Math.PI * 0.7); opacity = Math.min(1, p * 1.5); }
  else if (elapsed > 1.5) { opacity = Math.max(0, (1.8 - elapsed) / 0.3); }
  ctx.save(); ctx.globalAlpha = opacity;
  if (style === 'chapter-pill') {
    const fs = Math.max(16, Math.round(width * 0.024));
    ctx.font = `800 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t2 = `⚡ ${text.toUpperCase()}`; const tw = ctx.measureText(t2).width;
    const bw = tw + 44; const bh = fs + 16;
    ctx.translate(width / 2, isVertical ? height * 0.12 : 50); ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(245,158,11,0.75)'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#b45309'; drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.shadowBlur = 0; ctx.fillText(t2, 0, 0);
  } else if (style === 'bottom-badge') {
    const fs = Math.max(18, Math.round(width * 0.026));
    ctx.font = `900 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tu = text.toUpperCase(); const tw = ctx.measureText(tu).width;
    const bw = tw + 36; const bh = fs + 12;
    ctx.translate(width / 2, height - (isVertical ? 220 : 160)); ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(15,23,42,0.95)'; drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#38bdf8'; ctx.fillText(tu, 0, 0);
  } else {
    const fs = isVertical ? Math.max(34, Math.round(width * 0.075)) : Math.max(30, Math.round(width * 0.040));
    ctx.font = `900 ${fs}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tu = text.toUpperCase(); const tw = ctx.measureText(tu).width;
    const bw = tw + 56; const bh = fs + 28;
    ctx.translate(width / 2, isVertical ? height * 0.48 : height * 0.44); ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.92)'; drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.fillStyle = '#fde047'; ctx.shadowBlur = 0; ctx.fillText(tu, 0, 0);
  }
  ctx.restore();
}

// ─── Layer drawing ────────────────────────────────────────────────────────────

function drawLayer(ctx, layer, time, width, height, layerImgMap) {
  const elapsed = time - layer.startTime;
  if (elapsed < 0 || time > layer.endTime) return;
  const ad = Math.max(0.05, layer.animDuration || 0.4);
  const ap = layer.animation === 'none' ? 1 : easeOutCubic(Math.min(1, elapsed / ad));
  const px = layer.x * width, py = layer.y * height;
  const pw = layer.width * width, ph = layer.height * height;
  const cx = px + pw / 2, cy = py + ph / 2;

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  if (layer.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  if (layer.type === 'text') drawTextLayer(ctx, layer, ap, px, py, pw, ph, cx, cy, width);
  else if (layer.type === 'shape') drawShapeLayer(ctx, layer, ap, px, py, pw, ph, cx, cy);
  else if (layer.type === 'image') drawImageLayer(ctx, layer, layerImgMap ? layerImgMap.get(layer.id) : null, ap, px, py, pw, ph, cx, cy);
  ctx.restore();
}

function drawTextLayer(ctx, layer, ap, px, py, pw, ph, cx, cy, canvasWidth) {
  const scaledFs = (layer.fontSize || 32) * (canvasWidth / 1280);
  let offsetX = 0, offsetY = 0, scale = 1, opacity = layer.opacity ?? 1;
  switch (layer.animation) {
    case 'fade-in':    opacity = ap * (layer.opacity ?? 1); break;
    case 'slide-left': offsetX = (1 - ap) * 80; opacity = ap; break;
    case 'slide-right':offsetX = -(1 - ap) * 80; opacity = ap; break;
    case 'slide-up':   offsetY = (1 - ap) * 60; opacity = ap; break;
    case 'zoom-in':    scale = 0.85 + 0.15 * ap; opacity = ap; break;
    case 'bounce':     scale = 0.7 + 0.3 * easeOutBack(ap); opacity = easeOutQuad(ap); break;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (scale !== 1) { ctx.translate(cx + offsetX, cy + offsetY); ctx.scale(scale, scale); ctx.translate(-(cx + offsetX), -(cy + offsetY)); }
  ctx.translate(offsetX, offsetY);
  const fontParts = [layer.italic ? 'italic' : '', `${layer.fontWeight || '600'}`, `${scaledFs}px`, `${layer.fontFamily || 'system-ui'}, sans-serif`].filter(Boolean).join(' ');
  ctx.font = fontParts;
  ctx.textAlign = layer.textAlign || 'center';
  ctx.textBaseline = 'top';
  let displayText = layer.text || '';
  if (layer.animation === 'typewriter') displayText = displayText.slice(0, Math.max(1, Math.floor(ap * displayText.length)));
  const lines = wrapText(ctx, displayText, pw);
  const lh = scaledFs * 1.35;
  const totalH = lines.length * lh;
  if (layer.textBg) {
    ctx.fillStyle = layer.textBg;
    drawRoundedRect(ctx, px - 12, py - 8, pw + 24, totalH + 16, 8);
    ctx.fill();
  }
  ctx.fillStyle = layer.color || '#ffffff';
  const textX = layer.textAlign === 'center' ? cx : layer.textAlign === 'right' ? px + pw : px;
  let lineY = py;
  for (const line of lines) {
    ctx.fillText(line, textX, lineY);
    lineY += lh;
  }
  ctx.restore();
}

function drawShapeLayer(ctx, layer, ap, px, py, pw, ph, cx, cy) {
  let opacity = layer.opacity ?? 1, scale = 1;
  switch (layer.animation) {
    case 'fade-in': opacity = ap * (layer.opacity ?? 1); break;
    case 'zoom-in': scale = 0.85 + 0.15 * ap; opacity = ap; break;
    case 'bounce':  scale = 0.7 + 0.3 * easeOutBack(ap); opacity = easeOutQuad(ap); break;
    default: break;
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  ctx.beginPath();
  if (layer.shape === 'rect') {
    layer.borderRadius ? drawRoundedRect(ctx, px, py, pw, ph, layer.borderRadius) : ctx.rect(px, py, pw, ph);
  } else if (layer.shape === 'circle') {
    ctx.ellipse(cx, cy, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  } else if (layer.shape === 'triangle') {
    ctx.moveTo(cx, py); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px, py + ph); ctx.closePath();
  } else if (layer.shape === 'line') {
    ctx.moveTo(px, cy); ctx.lineTo(px + pw, cy);
  }
  if (layer.fill && layer.fill !== 'transparent') { ctx.fillStyle = layer.fill; ctx.fill(); }
  if ((layer.strokeWidth || 0) > 0 && layer.stroke) { ctx.strokeStyle = layer.stroke; ctx.lineWidth = layer.strokeWidth; ctx.stroke(); }
  ctx.restore();
}

function drawImageLayer(ctx, layer, img, ap, px, py, pw, ph, cx, cy) {
  const opacity = layer.animation === 'fade-in' ? ap * (layer.opacity ?? 1) : (layer.opacity ?? 1);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (img && img.naturalWidth) {
    const ratio = Math.min(pw / img.naturalWidth, ph / img.naturalHeight);
    const dw = img.naturalWidth * ratio, dh = img.naturalHeight * ratio;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(30,41,59,0.7)';
    drawRoundedRect(ctx, px, py, pw, ph, 8); ctx.fill();
    ctx.fillStyle = '#64748b'; ctx.font = '600 14px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🖼 Image', cx, cy);
  }
  ctx.restore();
}

// ─── Main frame renderer ──────────────────────────────────────────────────────

export function drawStudioFrame({
  ctx, width, height, time, duration,
  rows = [], slides = [],
  preloadedSlideImages = [],
  preloadedLayerImages = new Map(),
  animationMode = 'random',
  slideAnimations = {},
  captionStyle = 'modern-card',
  hookStyle = 'punch-stamp',
  textOverlays = {},
  layers = [],
  transitions = {},
}) {
  const isVertical = height > width;

  // Background
  ctx.fillStyle = '#0a0f1d';
  ctx.fillRect(0, 0, width, height);

  if (!rows || rows.length === 0) {
    ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#475569'; ctx.font = `600 ${Math.round(width * 0.02)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No slides — Import from Video Maker to get started', width / 2, height / 2);
    return;
  }

  // Active slide index
  let activeIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (time >= rows[i].start) activeIndex = i; else break;
  }

  const slideStart = rows[activeIndex].start;
  const slideEnd   = rows[activeIndex + 1] ? rows[activeIndex + 1].start : duration;
  const slideDur   = Math.max(0.1, slideEnd - slideStart);
  const activeSlide = slides[activeIndex];
  const activeImg   = preloadedSlideImages[activeIndex] || null;
  const hasCaptions = captionStyle !== 'none' && activeSlide && activeSlide.text;

  // Transition
  const transType    = transitions[activeIndex] || 'none';
  const TRANS_DUR    = 0.5;
  const transElapsed = time - slideStart;
  const inTransition = transType !== 'none' && transElapsed < TRANS_DUR && activeIndex > 0;

  const drawPrevAtRest = (prevIdx) => {
    const pr = rows[prevIdx];
    const pn = rows[prevIdx + 1];
    const pStart = pr ? pr.start : 0;
    const pEnd   = pn ? pn.start : duration;
    const pDur   = Math.max(0.1, pEnd - pStart);
    const pImg   = preloadedSlideImages[prevIdx] || null;
    const pSlide = slides[prevIdx];
    const pOverride = slideAnimations[prevIdx];
    const pMode  = pOverride && pOverride !== 'auto' ? pOverride : animationMode;
    drawSlideImage({ ctx, img: pImg, activeIndex: prevIdx, activeSlide: pSlide, animType: getSlideAnimation(pMode, prevIdx), slideStart: pStart, slideDuration: pDur, time: pStart + pDur * 0.99, width, height, captionAreaReserved: hasCaptions });
  };

  const drawActiveEntering = () => {
    const override = slideAnimations[activeIndex];
    const mode = override && override !== 'auto' ? override : animationMode;
    drawSlideImage({ ctx, img: activeImg, activeIndex, activeSlide, animType: getSlideAnimation(mode, activeIndex), slideStart, slideDuration: slideDur, time: slideStart, width, height, captionAreaReserved: hasCaptions });
  };

  if (inTransition) {
    const p = easeOutCubic(transElapsed / TRANS_DUR);
    const prevIdx = activeIndex - 1;
    if (transType === 'crossfade') {
      ctx.save(); ctx.globalAlpha = 1 - p; drawPrevAtRest(prevIdx); ctx.restore();
      ctx.save(); ctx.globalAlpha = p; drawActiveEntering(); ctx.restore();
    } else if (transType === 'wipe-left') {
      drawPrevAtRest(prevIdx);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width * p, height); ctx.clip(); drawActiveEntering(); ctx.restore();
    } else if (transType === 'wipe-right') {
      drawPrevAtRest(prevIdx);
      const clipX = width * (1 - p);
      ctx.save(); ctx.beginPath(); ctx.rect(clipX, 0, width - clipX, height); ctx.clip(); drawActiveEntering(); ctx.restore();
    } else if (transType === 'zoom-blend') {
      ctx.save(); ctx.globalAlpha = 1 - p; drawPrevAtRest(prevIdx); ctx.restore();
      ctx.save(); ctx.globalAlpha = p; const s = 1.15 - 0.15 * p;
      ctx.translate(width / 2, height / 2); ctx.scale(s, s); ctx.translate(-width / 2, -height / 2);
      drawActiveEntering(); ctx.restore();
    } else if (transType === 'slide-push-left') {
      ctx.save(); ctx.translate(-width * p, 0); drawPrevAtRest(prevIdx); ctx.restore();
      ctx.save(); ctx.translate(width * (1 - p), 0); drawActiveEntering(); ctx.restore();
    } else if (transType === 'slide-push-right') {
      ctx.save(); ctx.translate(width * p, 0); drawPrevAtRest(prevIdx); ctx.restore();
      ctx.save(); ctx.translate(-width * (1 - p), 0); drawActiveEntering(); ctx.restore();
    }
  } else {
    const override = slideAnimations[activeIndex];
    const mode = override && override !== 'auto' ? override : animationMode;
    drawSlideImage({ ctx, img: activeImg, activeIndex, activeSlide, animType: getSlideAnimation(mode, activeIndex), slideStart, slideDuration: slideDur, time, width, height, captionAreaReserved: hasCaptions });
  }

  // Retention hook
  const rawOverlay = textOverlays?.[activeIndex] || activeSlide?.textOverlay || '';
  if (hookStyle !== 'none' && rawOverlay.trim()) {
    drawRetentionHook(ctx, { width, height, time, slideStart, text: rawOverlay.trim(), style: hookStyle, isVertical });
  }

  // Captions
  if (hasCaptions) {
    drawCaptions(ctx, { width, height, captionStyle, slideNumber: activeSlide.id || activeIndex + 1, totalSlides: slides.length, text: activeSlide.text, isVertical });
  }

  // Overlay layers
  const visibleLayers = (layers || [])
    .filter((l) => time >= l.startTime && time < l.endTime)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const layer of visibleLayers) {
    drawLayer(ctx, layer, time, width, height, preloadedLayerImages);
  }
}
