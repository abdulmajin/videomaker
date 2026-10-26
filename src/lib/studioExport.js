/**
 * studioExport.js
 * Video export for the Studio Editor.
 * Composites slides + all overlay layers (text, shapes, images) + audio + BGM
 * using MediaRecorder and the drawStudioFrame canvas renderer.
 */

import { preloadStudioImages, preloadLayerImages, drawStudioFrame } from './studioRender.js';
import { getSupportedVideoMime } from './renderVideo.js';

/**
 * Export the studio project to an mp4/webm video file.
 *
 * @param {Object} params
 * @param {Array}   params.rows               - Slide timing rows [{id, start, text}]
 * @param {Array}   params.slides             - Slide data [{id, text, textOverlay}]
 * @param {Array}   params.imageUrls          - Per-slide image URLs
 * @param {Array}   params.layers             - Studio overlay layers
 * @param {Object}  params.transitions        - Per-slide transition types
 * @param {string}  params.audioUrl           - Voiceover audio URL (blob: or data:)
 * @param {string}  [params.bgmUrl]           - Background music URL
 * @param {number}  [params.bgmVolume=0.15]   - BGM volume 0–1
 * @param {boolean} [params.autoDuck=true]    - Auto-duck BGM during speech
 * @param {string}  [params.animationMode]    - Slide animation mode
 * @param {Object}  [params.slideAnimations]  - Per-slide animation overrides
 * @param {string}  [params.captionStyle]     - Caption style id
 * @param {string}  [params.hookStyle]        - Hook style id
 * @param {Object}  [params.textOverlays]     - Per-slide text overlays
 * @param {number}  params.duration           - Total video duration in seconds
 * @param {number}  [params.width=1280]       - Output canvas width
 * @param {number}  [params.height=720]       - Output canvas height
 * @param {number}  [params.fps=30]           - Frames per second
 * @param {string}  [params.title='video']    - Output filename base
 * @param {Function}[params.onProgress]       - (pct: number, msg: string) => void
 * @param {AbortSignal} [params.abortSignal]  - Cancellation signal
 *
 * @returns {Promise<{blob: Blob, mimeType: string, filename: string}>}
 */
export async function exportStudioVideo({
  rows = [],
  slides = [],
  imageUrls = [],
  layers = [],
  transitions = {},
  audioUrl = null,
  bgmUrl = null,
  bgmVolume = 0.15,
  autoDuck = true,
  animationMode = 'random',
  slideAnimations = {},
  captionStyle = 'modern-card',
  hookStyle = 'punch-stamp',
  textOverlays = {},
  duration,
  width = 1280,
  height = 720,
  fps = 30,
  title = 'video',
  onProgress = () => {},
  abortSignal = null,
}) {
  if (!duration || duration <= 0) throw new Error('Duration must be greater than 0.');
  if (!audioUrl) throw new Error('No audio track provided. Please record or import audio first.');

  // ── 1. Preload all images ────────────────────────────────────────────────
  onProgress(2, 'Preloading slide images…');
  const preloadedSlideImages = await preloadStudioImages(imageUrls);

  onProgress(4, 'Preloading layer images…');
  const preloadedLayerImages = await preloadLayerImages(layers);

  if (abortSignal?.aborted) throw new Error('Render cancelled');

  // ── 2. Decode voiceover audio ────────────────────────────────────────────
  onProgress(6, 'Decoding voiceover audio…');
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Fetch audio URL → ArrayBuffer → AudioBuffer
  const audioArrayBuffer = await (await fetch(audioUrl)).arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);

  if (abortSignal?.aborted) { await audioContext.close(); throw new Error('Render cancelled'); }

  // ── 3. Set up canvas ─────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // ── 4. Audio routing: voiceover → MediaStreamDestination ─────────────────
  const voiceSource = audioContext.createBufferSource();
  voiceSource.buffer = audioBuffer;
  const audioDest = audioContext.createMediaStreamDestination();
  voiceSource.connect(audioDest);

  // ── 5. BGM routing (optional) ─────────────────────────────────────────────
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

  // ── 6. Set up MediaRecorder ───────────────────────────────────────────────
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

  // ── 7. Render loop promise ────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    let animId = null;

    const cleanup = () => {
      if (animId) cancelAnimationFrame(animId);
      try { voiceSource.stop(); } catch (_) {}
      try { if (bgmSource) bgmSource.stop(); } catch (_) {}
      try { audioContext.close(); } catch (_) {}
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
      const blob = new Blob(chunks, { type: mimeType });
      const safeTitle = (title || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      resolve({ blob, mimeType, filename: `${safeTitle}_studio.${ext}` });
    };

    mediaRecorder.onerror = (err) => {
      cleanup();
      reject(err);
    };

    // Start recording
    mediaRecorder.start(100);
    voiceSource.start(0);
    if (bgmSource) bgmSource.start(0);
    const audioStartTime = audioContext.currentTime;

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
        bgmGain.gain.setValueAtTime(
          isSpeaking ? bgmVolume * 0.25 : bgmVolume,
          audioContext.currentTime
        );
      }

      // Draw frame
      drawStudioFrame({
        ctx, width, height,
        time: elapsed,
        duration,
        rows, slides,
        preloadedSlideImages,
        preloadedLayerImages,
        animationMode,
        slideAnimations,
        captionStyle,
        hookStyle,
        textOverlays,
        layers,
        transitions,
      });

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
