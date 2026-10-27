import { useEffect, useState } from 'react';

// Decodes an audio URL once and keeps normalised peak values for drawing.
const PEAK_COUNT = 4000;
const cache = new Map(); // url -> Promise<Float32Array>

export function loadPeaks(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    const data = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(data);
    const ch = buf.getChannelData(0);
    const n = Math.min(PEAK_COUNT, ch.length);
    const block = ch.length / n;
    const peaks = new Float32Array(n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.floor((i + 1) * block);
      for (let j = Math.floor(i * block); j < end; j += 4) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
      peaks[i] = m;
      if (m > max) max = m;
    }
    if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
    return { peaks, duration: buf.duration };
  })().catch((err) => {
    console.warn('Waveform decode failed:', err);
    cache.delete(url);
    return null;
  });
  cache.set(url, p);
  return p;
}

/** Returns `bars` heights (0..1) for the first `seconds` of the audio, or null while loading. */
export function useWaveform(url, bars, seconds, loop = false) {
  const [wave, setWave] = useState(null);
  useEffect(() => {
    let active = true;
    setWave(null);
    loadPeaks(url).then((w) => { if (active) setWave(w); });
    return () => { active = false; };
  }, [url]);
  if (!wave || !bars) return null;
  const { peaks, duration } = wave;
  const span = seconds > 0 ? seconds : duration;
  const out = new Array(bars);
  for (let i = 0; i < bars; i++) {
    let t0 = (i / bars) * span, t1 = ((i + 1) / bars) * span;
    if (loop && t0 >= duration) { const shift = Math.floor(t0 / duration) * duration; t0 -= shift; t1 -= shift; }
    if (t0 >= duration) { out[i] = 0; continue; }
    const a = Math.floor((t0 / duration) * peaks.length);
    const b = Math.max(a + 1, Math.floor((Math.min(t1, duration) / duration) * peaks.length));
    let m = 0;
    for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > m) m = peaks[k];
    out[i] = m;
  }
  return out;
}
