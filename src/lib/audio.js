// Audio Processing and Multi-Section Audio Merging Service

// Decodes any browser-supported audio file to mono 16 kHz samples (what Whisper expects).
export async function decodeAudio(file) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  await ctx.close();
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  return { samples: mono, duration: decoded.duration };
}

/**
 * Merges multiple audio files sequentially into a single continuous 16-bit 44.1kHz WAV Blob.
 * Also returns total duration and 16kHz mono samples for speech-to-text.
 */
export async function mergeAudioFiles(audioFiles) {
  const validFiles = (audioFiles || []).filter(Boolean);
  if (validFiles.length === 0) return null;

  if (validFiles.length === 1) {
    const single = validFiles[0];
    const { samples, duration } = await decodeAudio(single);
    return { blob: single, duration, samples };
  }

  const sampleRate = 44100;
  const numChannels = 2; // Stereo output
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });

  const decodedBuffers = [];
  for (const file of validFiles) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      decodedBuffers.push(decoded);
    } catch (err) {
      console.warn('Failed to decode an audio file in merge sequence:', err);
    }
  }

  if (decodedBuffers.length === 0) {
    await ctx.close();
    return null;
  }

  // Calculate total frame length
  const totalLength = decodedBuffers.reduce((acc, buf) => acc + buf.length, 0);
  const mergedBuffer = ctx.createBuffer(numChannels, totalLength, sampleRate);

  let frameOffset = 0;
  for (const buf of decodedBuffers) {
    for (let c = 0; c < numChannels; c++) {
      const destData = mergedBuffer.getChannelData(c);
      // If source is mono, copy channel 0 to both stereo channels
      const srcData = buf.numberOfChannels > c ? buf.getChannelData(c) : buf.getChannelData(0);
      destData.set(srcData, frameOffset);
    }
    frameOffset += buf.length;
  }

  await ctx.close();

  // Convert merged AudioBuffer to a valid WAV Blob
  const wavBlob = audioBufferToWav(mergedBuffer);
  const totalDuration = totalLength / sampleRate;

  // Also obtain 16kHz mono samples for Whisper alignment
  let whisperSamples = null;
  try {
    const dec = await decodeAudio(wavBlob);
    whisperSamples = dec.samples;
  } catch (e) {
    console.warn('Could not extract mono samples for merged audio:', e);
  }

  return {
    blob: wavBlob,
    duration: totalDuration,
    samples: whisperSamples,
  };
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

  // RIFF identifier
  writeString(0, 'RIFF');
  // RIFF chunk length
  view.setUint32(4, 36 + dataByteLength, true);
  // RIFF type
  writeString(8, 'WAVE');
  // format chunk identifier
  writeString(12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, format, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * blockAlign, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, bitDepth, true);
  // data chunk identifier
  writeString(36, 'data');
  // data chunk length
  view.setUint32(40, dataByteLength, true);

  // Write interleaved 16-bit PCM samples
  let offset = 44;
  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp between -1.0 and 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Scale to signed 16-bit integer (-32768 to 32767)
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
