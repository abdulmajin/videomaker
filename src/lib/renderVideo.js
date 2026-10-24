// In-browser video rendering using HTML5 Canvas, Web Audio API, and MediaRecorder
// Features Canva-style slide animations, kinetic text overlays/retention hooks, BGM mixer, and customizable captions

import { computeSlideTransform, getSlideAnimation } from './animations';

export const CAPTION_STYLES = [
  { id: 'modern-card', label: '🪪 Modern Card (Frosted Pill with Badge)' },
  { id: 'social-pop', label: '🔥 Social Pop (TikTok / Reels Bold Yellow)' },
  { id: 'classic-cinema', label: '🎬 Classic Cinema (Clean Drop-Shadow Subtitles)' },
  { id: 'top-banner', label: '📰 Top Banner (Header Bar)' },
  { id: 'none', label: '🚫 None (No Subtitles)' },
];

export const HOOK_STYLES = [
  { id: 'punch-stamp', label: '💥 TikTok Center Punch Stamp' },
  { id: 'chapter-pill', label: '⚡ Chapter / Scene Top Pill' },
  { id: 'bottom-badge', label: '🏷️ Bottom Subtitle Header' },
  { id: 'none', label: '🚫 None (No Hooks)' },
];

export function getSupportedVideoMime() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return 'video/webm';
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = words[0] || '';
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Preloads image elements for the canvas renderer
export async function preloadImages(imageUrls) {
  const promises = (imageUrls || []).map(
    (url) =>
      new Promise((resolve) => {
        if (!url) return resolve(null);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      })
  );
  return Promise.all(promises);
}

// Draws a single frame onto a canvas with animation, captions & retention hooks
export function drawVideoFrame({
  ctx,
  width,
  height,
  time,
  duration,
  rows = [],
  slides = [],
  preloadedImages = [],
  animationMode = 'random',
  slideAnimations = {},
  captionStyle = 'modern-card',
  hookStyle = 'punch-stamp',
  textOverlays = {},
  title = '',
}) {
  const isVertical = height > width;

  // 1. Clean Background
  ctx.fillStyle = '#0a0f1d';
  ctx.fillRect(0, 0, width, height);

  if (!rows || rows.length === 0) return;

  // 2. Determine current active slide
  let activeIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    if (time >= rows[i].start) {
      activeIndex = i;
    } else {
      break;
    }
  }

  const activeRow = rows[activeIndex];
  const nextRow = rows[activeIndex + 1];
  const slideStart = activeRow ? activeRow.start : 0;
  const slideEnd = nextRow ? nextRow.start : duration;
  const slideDuration = Math.max(0.1, slideEnd - slideStart);

  const activeSlide = slides[activeIndex];
  const activeImg = preloadedImages ? preloadedImages[activeIndex] : null;

  // 3. Compute Slide Animation Transform (Rule: <= 2.5s skipped, entry only, no exit)
  const slideOverride = slideAnimations && slideAnimations[activeIndex];
  const effectiveMode = slideOverride && slideOverride !== 'auto' ? slideOverride : animationMode;
  const animType = getSlideAnimation(effectiveMode, activeIndex);

  const transform = computeSlideTransform({
    animType,
    slideStart,
    slideDuration,
    time,
    canvasWidth: width,
    canvasHeight: height,
  });

  // Target image bounding box
  const hasBottomCaptions =
    captionStyle === 'modern-card' ||
    captionStyle === 'social-pop' ||
    captionStyle === 'classic-cinema';

  const maxImgHeight = isVertical
    ? height * 0.58
    : hasBottomCaptions
    ? height * 0.72
    : height * 0.88;
  const maxImgWidth = isVertical ? width * 0.96 : width * 0.94;
  const centerY = isVertical
    ? height * 0.40
    : hasBottomCaptions
    ? 36 + maxImgHeight / 2
    : height / 2;
  const centerX = width / 2;

  // 4. Render Animated Slide Image
  if (activeImg && activeImg.naturalWidth && activeImg.naturalHeight) {
    const hRatio = maxImgWidth / activeImg.naturalWidth;
    const vRatio = maxImgHeight / activeImg.naturalHeight;
    const baseRatio = Math.min(hRatio, vRatio);

    const dw = activeImg.naturalWidth * baseRatio;
    const dh = activeImg.naturalHeight * baseRatio;

    ctx.save();
    // Soft vignette/shadow around slide
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;

    // Apply animation translation, scale, and opacity
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));

    ctx.drawImage(activeImg, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    // Placeholder card
    ctx.save();
    ctx.translate(centerX + transform.dx, centerY + transform.dy);
    ctx.scale(transform.scale, transform.scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, transform.opacity));

    ctx.fillStyle = '#1e293b';
    const boxW = isVertical ? width * 0.85 : width * 0.58;
    const boxH = isVertical ? height * 0.38 : height * 0.44;
    drawRoundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 16);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Slide ${activeSlide ? activeSlide.id : activeIndex + 1}`, 0, 0);
    ctx.restore();
  }

  // 5. Kinetic Text Overlay / Retention Hook
  const rawOverlay = textOverlays?.[activeIndex] || activeSlide?.textOverlay || '';
  if (hookStyle !== 'none' && rawOverlay.trim()) {
    drawRetentionHook(ctx, {
      width,
      height,
      time,
      slideStart,
      text: rawOverlay.trim(),
      style: hookStyle,
      isVertical,
    });
  }

  // 6. Draw Selected Caption Style (clean subtitles)
  if (captionStyle !== 'none' && activeSlide && activeSlide.text) {
    drawCaptions(ctx, {
      width,
      height,
      captionStyle,
      slideNumber: activeSlide.id || activeIndex + 1,
      totalSlides: slides.length,
      text: activeSlide.text,
      isVertical,
    });
  }
}

// Kinetic Retention Hook Renderer
function drawRetentionHook(ctx, { width, height, time, slideStart, text, style, isVertical }) {
  const elapsed = time - slideStart;
  const hookDuration = 1.8; // Displays during first 1.8s of the slide

  if (elapsed < 0 || elapsed > hookDuration) return;

  // Entrance pop (0 -> 0.35s) and exit fade (1.5s -> 1.8s)
  let scale = 1.0;
  let opacity = 1.0;

  if (elapsed < 0.35) {
    const p = elapsed / 0.35;
    scale = 0.7 + 0.35 * Math.sin(p * Math.PI * 0.7); // Bouncy pop
    opacity = Math.min(1, p * 1.5);
  } else if (elapsed > 1.5) {
    opacity = Math.max(0, (hookDuration - elapsed) / 0.3);
  }

  ctx.save();
  ctx.globalAlpha = opacity;

  if (style === 'chapter-pill') {
    // ⚡ Chapter / Scene Top Pill
    const fontSize = Math.max(16, Math.round(width * 0.024));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textToDraw = text.toUpperCase().startsWith('⚡') ? text.toUpperCase() : `⚡ ${text.toUpperCase()}`;
    const textWidth = ctx.measureText(textToDraw).width;
    const padX = 22;
    const padY = 8;
    const boxW = textWidth + padX * 2;
    const boxH = fontSize + padY * 2;
    const boxX = width / 2;
    const boxY = isVertical ? height * 0.12 : 50;

    ctx.translate(boxX, boxY);
    ctx.scale(scale, scale);

    // Glowing pill badge
    ctx.shadowColor = 'rgba(245, 158, 11, 0.75)';
    ctx.shadowBlur = 18;

    ctx.fillStyle = '#b45309';
    drawRoundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, boxH / 2);
    ctx.fill();

    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.fillText(textToDraw, 0, 0);

  } else if (style === 'bottom-badge') {
    // 🏷️ Bottom Subtitle Header
    const fontSize = Math.max(18, Math.round(width * 0.026));
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(text.toUpperCase()).width;
    const padX = 18;
    const padY = 6;
    const boxW = textWidth + padX * 2;
    const boxH = fontSize + padY * 2;
    const boxX = width / 2;
    const boxY = height - (isVertical ? 220 : 160);

    ctx.translate(boxX, boxY);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    drawRoundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 8);
    ctx.fill();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.fillText(text.toUpperCase(), 0, 0);

  } else {
    // 💥 TikTok Center Punch Stamp (Default)
    const fontSize = isVertical
      ? Math.max(34, Math.round(width * 0.075))
      : Math.max(30, Math.round(width * 0.040));
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textUpper = text.toUpperCase();
    const textWidth = ctx.measureText(textUpper).width;
    const padX = 28;
    const padY = 14;
    const boxW = textWidth + padX * 2;
    const boxH = fontSize + padY * 2;
    const boxX = width / 2;
    const boxY = isVertical ? height * 0.48 : height * 0.44;

    ctx.translate(boxX, boxY);
    ctx.scale(scale, scale);

    // Dark high-contrast stamp with vibrant border
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    drawRoundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 14);
    ctx.fill();

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Bold yellow punch text
    ctx.fillStyle = '#fde047';
    ctx.shadowBlur = 0;
    ctx.fillText(textUpper, 0, 0);
  }

  ctx.restore();
}

// Subtitle & Caption Style Drawer
function drawCaptions(ctx, { width, height, captionStyle, slideNumber, text, isVertical }) {
  ctx.save();

  if (captionStyle === 'social-pop') {
    // 🔥 TikTok / Reels Punchy Pop: Bold uppercase text with yellow highlight
    const fontSize = isVertical
      ? Math.max(30, Math.round(width * 0.048))
      : Math.max(26, Math.round(width * 0.028));
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxTextWidth = width * 0.88;
    const lines = wrapText(ctx, text.toUpperCase(), maxTextWidth);
    const lineHeight = fontSize * 1.35;
    const totalTextHeight = lines.length * lineHeight;
    const startY = height - totalTextHeight - (isVertical ? 110 : 50);

    lines.forEach((line, idx) => {
      const lineY = startY + idx * lineHeight;
      const textWidth = ctx.measureText(line).width;
      const padX = 18;
      const padY = 6;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      drawRoundedRect(
        ctx,
        width / 2 - textWidth / 2 - padX,
        lineY - fontSize / 2 - padY,
        textWidth + padX * 2,
        fontSize + padY * 2,
        8
      );
      ctx.fill();

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.strokeText(line, width / 2, lineY);

      ctx.fillStyle = '#fde047';
      ctx.fillText(line, width / 2, lineY);
    });
  } else if (captionStyle === 'classic-cinema') {
    // 🎬 Classic Cinema: Clean bottom subtitles with soft shadow
    const fontSize = isVertical
      ? Math.max(26, Math.round(width * 0.040))
      : Math.max(22, Math.round(width * 0.024));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const maxTextWidth = width * 0.84;
    const lines = wrapText(ctx, text, maxTextWidth);
    const lineHeight = fontSize * 1.3;
    const startY = height - (lines.length - 1) * lineHeight - (isVertical ? 90 : 36);

    lines.forEach((line, idx) => {
      const lineY = startY + idx * lineHeight;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(line, width / 2, lineY);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, width / 2, lineY);
    });
  } else if (captionStyle === 'top-banner') {
    // 📰 Top Banner: Headline style header bar
    const bannerH = isVertical ? 65 : 54;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(0, 0, width, bannerH);
    ctx.fillStyle = '#0d9488';
    ctx.fillRect(0, bannerH - 3, width, 3);

    ctx.fillStyle = '#14b8a6';
    const tagText = `SLIDE ${slideNumber}:`;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tagText, 18, bannerH / 2);

    const tagWidth = ctx.measureText(tagText).width;
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillText(text.slice(0, 110) + (text.length > 110 ? '…' : ''), 28 + tagWidth, bannerH / 2);
  } else {
    // 🪪 Modern Card (Default): Frosted pill card with badge
    const maxTextWidth = width * (isVertical ? 0.88 : 0.82);
    const fontSize = isVertical
      ? Math.max(24, Math.round(width * 0.038))
      : Math.max(22, Math.round(width * 0.023));
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;

    const lines = wrapText(ctx, text, maxTextWidth);
    const lineHeight = fontSize * 1.35;
    const badgeHeight = 22;
    const padY = 16;
    const padX = 26;
    const boxHeight = lines.length * lineHeight + padY * 2 + badgeHeight;
    const boxWidth = Math.min(width * 0.94, maxTextWidth + padX * 2);
    const boxX = (width - boxWidth) / 2;
    const boxY = height - boxHeight - (isVertical ? 70 : 34);

    // Card background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 14);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Slide pill badge
    ctx.fillStyle = '#0d9488';
    drawRoundedRect(ctx, boxX + padX, boxY + padY, 88, 20, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`SLIDE ${slideNumber}`, boxX + padX + 44, boxY + padY + 10);

    // Subtitle text lines
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let lineY = boxY + padY + badgeHeight + fontSize;
    for (const line of lines) {
      ctx.fillText(line, boxX + padX, lineY);
      lineY += lineHeight;
    }
  }

  ctx.restore();
}

// Renders the full video and returns a Blob (with optional BGM and auto-ducking)
export async function renderVideo({
  audioFile,
  rows,
  slides,
  imageUrls,
  duration,
  title = '',
  width = 1280,
  height = 720,
  fps = 30,
  animationMode = 'random',
  slideAnimations = {},
  captionStyle = 'modern-card',
  hookStyle = 'punch-stamp',
  textOverlays = {},
  bgmFile = null,
  bgmVolume = 0.15,
  autoDuck = true,
  onProgress = () => {},
  abortSignal = null,
}) {
  onProgress(2, 'Preloading slide images…');
  const preloadedImages = await preloadImages(imageUrls);

  if (abortSignal?.aborted) throw new Error('Render cancelled');

  onProgress(5, 'Decoding audio for video…');
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await audioFile.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  if (abortSignal?.aborted) {
    await audioContext.close();
    throw new Error('Render cancelled');
  }

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Audio routing to MediaStreamDestination
  const audioSource = audioContext.createBufferSource();
  audioSource.buffer = audioBuffer;
  const audioDestination = audioContext.createMediaStreamDestination();
  audioSource.connect(audioDestination);

  // Background Music (BGM) Routing with Auto-Ducking
  let bgmSource = null;
  let bgmGain = null;

  if (bgmFile) {
    try {
      const bgmBuffer = await audioContext.decodeAudioData(await bgmFile.arrayBuffer());
      bgmSource = audioContext.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;

      bgmGain = audioContext.createGain();
      bgmGain.gain.setValueAtTime(bgmVolume, audioContext.currentTime);

      bgmSource.connect(bgmGain);
      bgmGain.connect(audioDestination);
    } catch (e) {
      console.warn('Could not load BGM audio for export:', e);
    }
  }

  // Capture canvas stream
  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  const mimeType = getSupportedVideoMime();
  const mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: height > 1000 ? 5_500_000 : 3_800_000,
  });

  const chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    let animId = null;

    const cleanup = () => {
      if (animId) cancelAnimationFrame(animId);
      try {
        audioSource.stop();
      } catch (_) {}
      try {
        if (bgmSource) bgmSource.stop();
      } catch (_) {}
      try {
        audioContext.close();
      } catch (_) {}
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        cleanup();
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        reject(new Error('Render cancelled'));
      });
    }

    mediaRecorder.onstop = () => {
      cleanup();
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      resolve({ blob, mimeType, filename: `${safeTitle}.${extension}` });
    };

    mediaRecorder.onerror = (err) => {
      cleanup();
      reject(err);
    };

    // Start recording & audio
    mediaRecorder.start(100);
    audioSource.start(0);
    if (bgmSource) bgmSource.start(0);
    const audioStartCtxTime = audioContext.currentTime;

    function renderLoop() {
      if (abortSignal?.aborted) return;

      const elapsed = audioContext.currentTime - audioStartCtxTime;
      const progress = Math.min(100, Math.round((elapsed / duration) * 100));
      onProgress(progress, `Recording video… ${progress}% (${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s)`);

      // BGM Auto-Ducking calculation
      if (bgmGain && autoDuck) {
        let isSpeaking = false;
        for (let i = 0; i < rows.length; i++) {
          const rStart = rows[i].start;
          const rEnd = rows[i + 1] ? rows[i + 1].start : duration;
          if (elapsed >= rStart && elapsed <= rEnd) {
            isSpeaking = true;
            break;
          }
        }
        const targetVol = isSpeaking ? bgmVolume * 0.25 : bgmVolume;
        bgmGain.gain.setValueAtTime(targetVol, audioContext.currentTime);
      }

      drawVideoFrame({
        ctx,
        width,
        height,
        time: elapsed,
        duration,
        rows,
        slides,
        preloadedImages,
        animationMode,
        slideAnimations,
        captionStyle,
        hookStyle,
        textOverlays,
        title,
      });

      if (elapsed >= duration + 0.25) {
        onProgress(100, 'Finalizing video file…');
        mediaRecorder.stop();
      } else {
        animId = requestAnimationFrame(renderLoop);
      }
    }

    audioSource.onended = () => {
      setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          onProgress(100, 'Finalizing video file…');
          mediaRecorder.stop();
        }
      }, 300);
    };

    animId = requestAnimationFrame(renderLoop);
  });
}
