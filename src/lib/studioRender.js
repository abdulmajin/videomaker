/**
 * studioRender.js
 * Canvas frame renderer for the Studio Editor.
 * Draws slide images (with Canva-style animations), slide transitions,
 * captions, retention hooks, and all editor overlay layers
 * (text, shapes, image overlays) composited on top.
 */

import { computeSlideTransform, getSlideAnimation } from './animations.js';
import { drawModernBottomCaptions, gradeFilter, drawBrand } from './frameExtras.js';

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

// Media elements are cached by URL so dragging a layer doesn't reload it.
// Pass your own `cache` (e.g. for export) to get elements nobody else drives.
const sharedMediaCache = new Map(); // url -> Promise<HTMLImageElement|HTMLVideoElement|null>

function loadMedia(url, isVideo) {
  return new Promise((resolve) => {
    if (isVideo) {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.playsInline = true;
      v.muted = true;
      v.crossOrigin = 'anonymous';
      v.onloadeddata = () => resolve(v);
      v.onerror = () => resolve(null);
      v.src = url;
      v.load();
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }
  });
}

export async function preloadLayerImages(layers, cache = sharedMediaCache) {
  const entries = await Promise.all(
    (layers || [])
      .filter((l) => (l.type === 'image' && l.imageUrl) || (l.type === 'video' && l.videoUrl))
      .map(async (l) => {
        const url = l.type === 'video' ? l.videoUrl : l.imageUrl;
        if (!cache.has(url)) cache.set(url, loadMedia(url, l.type === 'video'));
        return [l.id, await cache.get(url)];
      })
  );
  return new Map(entries);
}

/** Seeks every visible video layer to its frame for `time` and waits for the seeks. */
export async function seekVideoLayers(layers, mediaMap, time) {
  const waits = [];
  for (const l of layers || []) {
    if (l.type !== 'video') continue;
    const v = mediaMap.get(l.id);
    if (!v || time < l.startTime || time >= l.endTime) continue;
    const target = Math.min(Math.max(0, v.duration - 0.05), time - l.startTime + (l.trimStart || 0));
    if (Math.abs(v.currentTime - target) < 0.001) continue;
    waits.push(new Promise((resolve) => {
      const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 1500);
      v.addEventListener('seeked', done);
      v.currentTime = target;
    }));
  }
  await Promise.all(waits);
}

// ─── Slide image drawing helper ───────────────────────────────────────────────

function drawSlideImage({ ctx, img, activeIndex, activeSlide, animType, slideStart, slideDuration, time, width, height, filter = 'none' }) {
  const isVertical = height > width;
  const maxImgHeight = height * 0.88;
  const maxImgWidth  = isVertical ? width * 0.96 : width * 0.94;
  const centerX = width / 2;
  const centerY = height / 2;

  const transform = computeSlideTransform({ animType, slideStart, slideDuration, time, canvasWidth: width, canvasHeight: height });

  let blockBottom = centerY + maxImgHeight / 2;
  let blockWidth = maxImgWidth;

  ctx.save();
  if (img && img.naturalWidth) {
    const ratio = Math.min(maxImgWidth / img.naturalWidth, maxImgHeight / img.naturalHeight);
    const dw = img.naturalWidth * ratio;
    const dh = img.naturalHeight * ratio;
    blockBottom = centerY + dh / 2;
    blockWidth = dw;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    ctx.filter = filter;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    ctx.fillStyle = '#1e293b';
    const bw = isVertical ? width * 0.88 : width * 0.78;
    const bh = isVertical ? height * 0.68 : height * 0.76;
    blockBottom = centerY + bh / 2;
    blockWidth = bw;
    drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 16);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Slide ${activeSlide ? activeSlide.id : activeIndex + 1}`, 0, 0);
  }
  ctx.restore();
  return { blockBottom, blockWidth };
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
  else if (layer.type === 'image' || layer.type === 'video') drawImageLayer(ctx, layer, layerImgMap ? layerImgMap.get(layer.id) : null, ap, px, py, pw, ph, cx, cy);
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
  const iw = img ? (img.naturalWidth || img.videoWidth) : 0;
  const ih = img ? (img.naturalHeight || img.videoHeight) : 0;
  if (iw && ih) {
    const ratio = Math.min(pw / iw, ph / ih);
    const dw = iw * ratio, dh = ih * ratio;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = 'rgba(30,41,59,0.7)';
    drawRoundedRect(ctx, px, py, pw, ph, 8); ctx.fill();
    ctx.fillStyle = '#64748b'; ctx.font = '600 14px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(layer.type === 'video' ? '🎬 Video' : '🖼 Image', cx, cy);
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
  captionStyle = 'hormozi-pop',
  hookStyle = 'punch-stamp',
  textOverlays = {},
  layers = [],
  transitions = {},
  words = [],
  colorGrade = 'none',
  slideFilters = {},
  brand = null,
  logoImg = null,
}) {
  const isVertical = height > width;

  // Background
  ctx.fillStyle = '#0a0f1d';
  ctx.fillRect(0, 0, width, height);

  if (!rows || rows.length === 0) {
    // No scenes: still composite layers (e.g. a clips-only project)
    ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, width, height);
    if (!layers || layers.length === 0) {
      ctx.fillStyle = '#475569'; ctx.font = `600 ${Math.round(width * 0.02)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No slides — Import from Video Maker to get started', width / 2, height / 2);
    }
    drawVisibleLayers(ctx, layers, time, width, height, preloadedLayerImages);
    drawBrand(ctx, { width, height, time, duration, brand, logoImg });
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
    drawSlideImage({ ctx, img: pImg, activeIndex: prevIdx, activeSlide: pSlide, animType: getSlideAnimation(pMode, prevIdx), slideStart: pStart, slideDuration: pDur, time: pStart + pDur * 0.99, width, height, captionAreaReserved: hasCaptions, filter: gradeFilter(colorGrade, slideFilters[prevIdx]) });
  };

  const drawActiveEntering = () => {
    const override = slideAnimations[activeIndex];
    const mode = override && override !== 'auto' ? override : animationMode;
    drawSlideImage({ ctx, img: activeImg, activeIndex, activeSlide, animType: getSlideAnimation(mode, activeIndex), slideStart, slideDuration: slideDur, time: slideStart, width, height, captionAreaReserved: hasCaptions, filter: gradeFilter(colorGrade, slideFilters[activeIndex]) });
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
    drawSlideImage({ ctx, img: activeImg, activeIndex, activeSlide, animType: getSlideAnimation(mode, activeIndex), slideStart, slideDuration: slideDur, time, width, height, captionAreaReserved: hasCaptions, filter: gradeFilter(colorGrade, slideFilters[activeIndex]) });
  }

  // Retention hook
  const rawOverlay = textOverlays?.[activeIndex] || activeSlide?.textOverlay || '';
  if (hookStyle !== 'none' && rawOverlay.trim()) {
    drawRetentionHook(ctx, { width, height, time, slideStart, text: rawOverlay.trim(), style: hookStyle, isVertical });
  }

  // Compute active slide bounds so captions render INSIDE the video block near its bottom
  const maxImgHeight = height * 0.88;
  const maxImgWidth = isVertical ? width * 0.96 : width * 0.94;
  let videoBlockBottom = height / 2 + maxImgHeight / 2;
  let videoBlockWidth = maxImgWidth;
  if (activeImg && activeImg.naturalWidth && activeImg.naturalHeight) {
    const ratio = Math.min(maxImgWidth / activeImg.naturalWidth, maxImgHeight / activeImg.naturalHeight);
    videoBlockBottom = height / 2 + (activeImg.naturalHeight * ratio) / 2;
    videoBlockWidth = activeImg.naturalWidth * ratio;
  } else {
    videoBlockBottom = height / 2 + (isVertical ? height * 0.68 : height * 0.76) / 2;
    videoBlockWidth = isVertical ? width * 0.88 : width * 0.78;
  }

  // Modern Animated Bottom Captions (rendered inside the video block with bottom padding)
  if (captionStyle && captionStyle !== 'none') {
    drawModernBottomCaptions(ctx, {
      width,
      height,
      time,
      words,
      slideText: activeSlide?.text || '',
      slideStart,
      slideEnd,
      captionStyle,
      isVertical,
      videoBlockBottom,
      videoBlockWidth,
    });
  }

  drawVisibleLayers(ctx, layers, time, width, height, preloadedLayerImages);
  drawBrand(ctx, { width, height, time, duration, brand, logoImg });
}

function drawVisibleLayers(ctx, layers, time, width, height, mediaMap) {
  const visibleLayers = (layers || [])
    .filter((l) => time >= l.startTime && time < l.endTime)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const layer of visibleLayers) {
    drawLayer(ctx, layer, time, width, height, mediaMap);
  }
}
