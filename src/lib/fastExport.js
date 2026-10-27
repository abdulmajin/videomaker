// Faster-than-real-time export: frames are drawn one by one and encoded with
// WebCodecs (via Mediabunny), and the soundtrack is mixed with an
// OfflineAudioContext. Unlike MediaRecorder this never drops frames when the
// tab is in the background, and the output is always a real MP4.

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  QUALITY_HIGH,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
} from 'mediabunny';
import { scheduleSfx } from './sfx';

const SAMPLE_RATE = 48000;

export function supportsFastExport() {
  return typeof VideoEncoder !== 'undefined'
    && typeof AudioEncoder !== 'undefined'
    && typeof OfflineAudioContext !== 'undefined';
}

async function toArrayBuffer(src) {
  if (!src) return null;
  if (src instanceof Blob) return src.arrayBuffer();
  return (await fetch(src)).arrayBuffer();
}

// Speech intervals used for BGM ducking: word timestamps when we have them,
// otherwise the span covered by the slides (matching the live renderer).
function speechIntervals(words, rows, duration) {
  if (words && words.length) {
    const out = [];
    for (const w of words) {
      const s = Math.max(0, w.start - 0.15);
      const e = Math.min(duration, (w.end ?? w.start) + 0.3);
      const last = out[out.length - 1];
      if (last && s - last[1] < 0.5) last[1] = Math.max(last[1], e);
      else out.push([s, e]);
    }
    return out;
  }
  return rows && rows.length ? [[rows[0].start, duration]] : [];
}

/**
 * Mixes voiceover + looping BGM (with auto-ducking) + sound effects into one
 * stereo AudioBuffer. `voice` / `bgm` may be Blobs or URLs.
 */
export async function mixAudioOffline({
  voice, bgm = null, bgmVolume = 0.15, autoDuck = true,
  rows = [], words = [], duration, sfxOptions = null, clips = [],
}) {
  const length = Math.max(1, Math.ceil(duration * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);

  const voiceData = await toArrayBuffer(voice);
  if (voiceData) {
    const src = ctx.createBufferSource();
    src.buffer = await ctx.decodeAudioData(voiceData);
    src.connect(ctx.destination);
    src.start(0);
  }

  if (bgm) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = await ctx.decodeAudioData(await toArrayBuffer(bgm));
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(bgmVolume, 0);
      if (autoDuck) {
        for (const [s, e] of speechIntervals(words, rows, duration)) {
          gain.gain.setTargetAtTime(bgmVolume * 0.25, Math.max(0, s - 0.05), 0.08);
          gain.gain.setTargetAtTime(bgmVolume, e, 0.2);
        }
      }
      src.connect(gain).connect(ctx.destination);
      src.start(0);
    } catch (e) {
      console.warn('Could not decode BGM for export:', e);
    }
  }

  // Soundtracks of video clips placed on the timeline: { src, start, offset, duration, volume }
  for (const clip of clips) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = await ctx.decodeAudioData(await toArrayBuffer(clip.src));
      const gain = ctx.createGain();
      gain.gain.value = clip.volume ?? 1;
      src.connect(gain).connect(ctx.destination);
      src.start(clip.start, clip.offset || 0, Math.max(0, clip.duration));
    } catch {
      // Clip has no audio track (or an undecodable one) — skip it
    }
  }

  if (sfxOptions) scheduleSfx(ctx, ctx.destination, { ...sfxOptions, offset: 0 });

  return ctx.startRendering();
}

/**
 * Encodes `duration` seconds of video by calling `renderFrame(time)` for each
 * frame, which must draw onto `canvas`. Returns { blob, mimeType, extension }.
 */
export async function encodeMp4({
  canvas, fps = 30, duration, renderFrame, audioBuffer = null,
  onProgress = () => {}, abortSignal = null, progressFrom = 10,
}) {
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {
    width: canvas.width, height: canvas.height,
  });
  if (!videoCodec) throw new Error('This browser cannot encode video with WebCodecs.');

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });

  let audioSource = null;
  if (audioBuffer) {
    const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: audioBuffer.numberOfChannels, sampleRate: audioBuffer.sampleRate,
    });
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    } else {
      console.warn('No encodable audio codec — exporting without sound.');
    }
  }

  await output.start();
  if (audioSource) await audioSource.add(audioBuffer);

  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const started = performance.now();
  for (let i = 0; i < totalFrames; i++) {
    if (abortSignal?.aborted) {
      await output.cancel();
      throw new Error('Render cancelled');
    }
    const t = i / fps;
    await renderFrame(t);
    await videoSource.add(t, 1 / fps);

    if (i % 15 === 0 || i === totalFrames - 1) {
      const done = (i + 1) / totalFrames;
      const pct = Math.round(progressFrom + done * (98 - progressFrom));
      const speed = (t + 1 / fps) / ((performance.now() - started) / 1000);
      onProgress(pct, `Encoding frame ${i + 1}/${totalFrames} (${speed.toFixed(1)}× real time)…`);
      await new Promise((r) => setTimeout(r, 0)); // let the UI repaint
    }
  }

  onProgress(99, 'Finalizing MP4…');
  await output.finalize();
  return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), mimeType: 'video/mp4', extension: 'mp4' };
}
