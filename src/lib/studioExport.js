/**
 * studioExport.js
 * Video export for the Studio Editor.
 * Composites slides + all overlay layers (text, shapes, images, video clips) +
 * audio + BGM + sound effects with the drawStudioFrame canvas renderer.
 * Uses offline WebCodecs encoding when the browser supports it and falls back
 * to real-time MediaRecorder capture otherwise.
 */

import { preloadStudioImages, preloadLayerImages, seekVideoLayers, drawStudioFrame } from './studioRender.js';
import { getSupportedVideoMime } from './renderVideo.js';
import { supportsFastExport, mixAudioOffline, encodeMp4 } from './fastExport.js';
import { scheduleSfx } from './sfx.js';
import { loadImage } from './frameExtras.js';

/**
 * Export the studio project to an mp4/webm video file.
 *
 * Accepts every project field (rows, slides, imageUrls, layers, transitions,
 * audioUrl, bgmUrl, bgmVolume, autoDuck, animationMode, slideAnimations,
 * captionStyle, hookStyle, textOverlays, words, colorGrade, slideFilters,
 * brand, logoUrl, sfx, duration) plus width, height, fps, title, onProgress
 * and abortSignal.
 *
 * @returns {Promise<{blob: Blob, mimeType: string, filename: string}>}
 */
export async function exportStudioVideo(options) {
  if (!options.duration || options.duration <= 0) throw new Error('Duration must be greater than 0.');
  if (!options.audioUrl) throw new Error('No audio track provided. Please record or import audio first.');

  if (supportsFastExport() && !options.forceRealtime) {
    try {
      return await exportFast(options);
    } catch (err) {
      if (err.message === 'Render cancelled') throw err;
      console.warn('[studioExport] Fast export failed, falling back to real time:', err);
      options.onProgress?.(0, 'Fast export unavailable — recording in real time…');
    }
  }
  return exportRealtime(options);
}

async function prepare(options) {
  const { imageUrls = [], layers = [], logoUrl = null, onProgress = () => {} } = options;
  onProgress(2, 'Preloading slide images…');
  const preloadedSlideImages = await preloadStudioImages(imageUrls);
  onProgress(4, 'Preloading layers…');
  // Export gets its own media elements so it never fights the preview player
  const preloadedLayerImages = await preloadLayerImages(layers, new Map());
  const logoImg = await loadImage(logoUrl);
  return { preloadedSlideImages, preloadedLayerImages, logoImg };
}

function frameParams(o, media) {
  return {
    duration: o.duration,
    rows: o.rows || [],
    slides: o.slides || [],
    preloadedSlideImages: media.preloadedSlideImages,
    preloadedLayerImages: media.preloadedLayerImages,
    animationMode: o.animationMode,
    slideAnimations: o.slideAnimations || {},
    captionStyle: o.captionStyle,
    hookStyle: o.hookStyle,
    textOverlays: o.textOverlays || {},
    layers: o.layers || [],
    transitions: o.transitions || {},
    words: o.words || [],
    colorGrade: o.colorGrade,
    slideFilters: o.slideFilters || {},
    brand: o.brand,
    logoImg: media.logoImg,
  };
}

function outputName(title, ext) {
  const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
  return `${safeTitle}_studio.${ext}`;
}

async function exportFast(o) {
  const { width = 1280, height = 720, fps = 30, onProgress = () => {}, abortSignal = null } = o;
  const media = await prepare(o);
  if (abortSignal?.aborted) throw new Error('Render cancelled');

  onProgress(6, 'Mixing voice, music, clips & sound effects…');
  const audioBuffer = await mixAudioOffline({
    voice: o.audioUrl,
    bgm: o.bgmUrl,
    bgmVolume: o.bgmVolume ?? 0.15,
    autoDuck: o.autoDuck ?? true,
    rows: o.rows || [],
    words: o.words || [],
    duration: o.duration,
    sfxOptions: { rows: o.rows || [], slides: o.slides || [], textOverlays: o.textOverlays || {}, hookStyle: o.hookStyle, sfx: o.sfx },
    clips: (o.layers || [])
      .filter((l) => l.type === 'video' && !l.muted && (l.volume ?? 1) > 0)
      .map((l) => ({ src: l.videoUrl, start: l.startTime, offset: l.trimStart || 0, duration: l.endTime - l.startTime, volume: l.volume ?? 1 })),
  });
  if (abortSignal?.aborted) throw new Error('Render cancelled');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const params = frameParams(o, media);

  const { blob, mimeType, extension } = await encodeMp4({
    canvas, fps, duration: o.duration, audioBuffer, onProgress, abortSignal,
    renderFrame: async (time) => {
      await seekVideoLayers(params.layers, media.preloadedLayerImages, time);
      drawStudioFrame({ ctx, width, height, time, ...params });
    },
  });
  return { blob, mimeType, filename: outputName(o.title, extension) };
}

async function exportRealtime(o) {
  const {
    rows = [], duration, bgmUrl = null, bgmVolume = 0.15, autoDuck = true,
    width = 1280, height = 720, fps = 30, onProgress = () => {}, abortSignal = null,
  } = o;
  const media = await prepare(o);
  const params = frameParams(o, media);

  if (abortSignal?.aborted) throw new Error('Render cancelled');

  // ── Decode voiceover audio ───────────────────────────────────────────────
  onProgress(6, 'Decoding voiceover audio…');
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioArrayBuffer = await (await fetch(o.audioUrl)).arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);

  if (abortSignal?.aborted) { await audioContext.close(); throw new Error('Render cancelled'); }

  // ── Canvas ───────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // ── Audio routing: voiceover → MediaStreamDestination ────────────────────
  const voiceSource = audioContext.createBufferSource();
  voiceSource.buffer = audioBuffer;
  const audioDest = audioContext.createMediaStreamDestination();
  voiceSource.connect(audioDest);

  // ── BGM routing (optional) ───────────────────────────────────────────────
  let bgmSource = null;
  let bgmGain   = null;

  if (bgmUrl) {
    try {
      onProgress(8, 'Decoding background music…');
      const bgmArrayBuffer = await (await fetch(bgmUrl)).arrayBuffer();
      const bgmBuffer = await audioContext.decodeAudioData(bgmArrayBuffer);
      bgmSource = audioContext.createBufferSource();
      bgmSource.buffer = bgmBuffer;
      bgmSource.loop = true;
      bgmGain = audioContext.createGain();
      bgmGain.gain.setValueAtTime(bgmVolume, audioContext.currentTime);
      bgmSource.connect(bgmGain);
      bgmGain.connect(audioDest);
    } catch (e) {
      console.warn('[studioExport] Could not decode BGM:', e);
    }
  }

  // ── MediaRecorder ────────────────────────────────────────────────────────
  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDest.stream.getAudioTracks(),
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

  const videoLayers = params.layers.filter((l) => l.type === 'video');

  return new Promise((resolve, reject) => {
    let animId = null;

    const cleanup = () => {
      if (animId) cancelAnimationFrame(animId);
      try { voiceSource.stop(); } catch (_) {}
      try { if (bgmSource) bgmSource.stop(); } catch (_) {}
      try { audioContext.close(); } catch (_) {}
      for (const l of videoLayers) media.preloadedLayerImages.get(l.id)?.pause();
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
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType, filename: outputName(o.title, ext) });
    };

    mediaRecorder.onerror = (err) => {
      cleanup();
      reject(err);
    };

    mediaRecorder.start(100);
    voiceSource.start(0);
    if (bgmSource) bgmSource.start(0);
    const audioStartTime = audioContext.currentTime;
    scheduleSfx(audioContext, audioDest, {
      rows, slides: params.slides, textOverlays: params.textOverlays, hookStyle: o.hookStyle, sfx: o.sfx, offset: audioStartTime,
    });

    function renderLoop() {
      if (abortSignal?.aborted) return;

      const elapsed = audioContext.currentTime - audioStartTime;
      const progress = Math.min(99, Math.round((elapsed / duration) * 95) + 5);
      onProgress(progress, `Rendering… ${Math.round(elapsed)}s / ${Math.round(duration)}s`);

      // BGM auto-ducking
      if (bgmGain && autoDuck) {
        let isSpeaking = false;
        for (let i = 0; i < rows.length; i++) {
          const rStart = rows[i].start;
          const rEnd = rows[i + 1] ? rows[i + 1].start : duration;
          if (elapsed >= rStart && elapsed <= rEnd) { isSpeaking = true; break; }
        }
        bgmGain.gain.setValueAtTime(isSpeaking ? bgmVolume * 0.25 : bgmVolume, audioContext.currentTime);
      }

      // Keep video clips roughly in sync (clip audio isn't captured in this mode)
      for (const l of videoLayers) {
        const v = media.preloadedLayerImages.get(l.id);
        if (!v) continue;
        if (elapsed >= l.startTime && elapsed < l.endTime) {
          const target = elapsed - l.startTime + (l.trimStart || 0);
          if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
          if (v.paused) v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      }

      drawStudioFrame({ ctx, width, height, time: elapsed, ...params });

      if (elapsed >= duration + 0.25) {
        onProgress(100, 'Finalizing video file…');
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      } else {
        animId = requestAnimationFrame(renderLoop);
      }
    }

    voiceSource.onended = () => {
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
