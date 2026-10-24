// Built-in Voice Generation (AI TTS & Live Microphone Voiceover Recording)
import { decodeAudio } from './audio';

/**
 * Splits long script text into natural sentence chunks <= 160 characters
 * for high-quality audio synthesis.
 */
function splitIntoChunks(text, maxLen = 160) {
  const sentences = text
    .replace(/^slide\s*\d+\s*[:\-.]\s*/gim, '') // Strip Slide 1: prefixes
    .split(/(?<=[.?!,;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let cur = '';

  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length <= maxLen) {
      cur = (cur + ' ' + s).trim();
    } else {
      if (cur) chunks.push(cur);
      cur = s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

/**
 * Synthesizes script text into a high-quality audio WAV Blob.
 */
export async function synthesizeSpeechToWav(scriptText, { lang = 'en', onProgress = () => {} } = {}) {
  const chunks = splitIntoChunks(scriptText);
  if (!chunks.length) throw new Error('No script text provided for speech generation.');

  const sampleRate = 44100;
  const numChannels = 2;
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  const decodedBuffers = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    onProgress(Math.round(((i + 1) / chunks.length) * 100), `Synthesizing part ${i + 1} of ${chunks.length}…`);

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
      lang
    )}&q=${encodeURIComponent(chunk)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`TTS service error (${res.status}) on part ${i + 1}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    decodedBuffers.push(decoded);

    // Subtle pause between sentences
    if (i < chunks.length - 1) {
      const pauseDuration = 0.35; // 350ms natural pause
      const pauseBuffer = audioCtx.createBuffer(numChannels, Math.round(sampleRate * pauseDuration), sampleRate);
      decodedBuffers.push(pauseBuffer);
    }
  }

  // Concatenate all buffers
  const totalLength = decodedBuffers.reduce((sum, b) => sum + b.length, 0);
  const mergedBuffer = audioCtx.createBuffer(numChannels, totalLength, sampleRate);

  let frameOffset = 0;
  for (const buf of decodedBuffers) {
    for (let c = 0; c < numChannels; c++) {
      const dest = mergedBuffer.getChannelData(c);
      const src = buf.numberOfChannels > c ? buf.getChannelData(c) : buf.getChannelData(0);
      dest.set(src, frameOffset);
    }
    frameOffset += buf.length;
  }

  await audioCtx.close();

  // Convert to 16-bit PCM WAV Blob
  const wavBlob = audioBufferToWav(mergedBuffer);
  const totalDuration = totalLength / sampleRate;

  // Extract mono samples for whisper alignment
  const { samples } = await decodeAudio(wavBlob);

  return {
    blob: wavBlob,
    duration: totalDuration,
    samples,
  };
}

/**
 * Live Microphone Audio Recorder
 */
export function startMicrophoneRecording() {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.start(100);

      const stop = () => {
        return new Promise((res) => {
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const { samples, duration } = await decodeAudio(blob);
            res({ blob, samples, duration });
          };
          mediaRecorder.stop();
        });
      };

      resolve({ stop });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Encodes an AudioBuffer into standard 16-bit PCM RIFF WAV format.
 */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = buffer.length * blockAlign;
  const bufferSize = 44 + dataByteLength;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  let offset = 44;
  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
