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
