// Synthesized sound effects for slide transitions and retention-hook pops.
// Generated with the Web Audio API so no audio assets need to ship.

export const SFX_MODES = [
  { id: 'none',   label: '🔇 None' },
  { id: 'whoosh', label: '💨 Whoosh on slide change' },
  { id: 'pop',    label: '🫧 Pop on retention hooks' },
  { id: 'both',   label: '🎧 Whoosh + Pop' },
];

function noiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Band-passed noise sweeping upward with a soft attack and tail.
function playWhoosh(ctx, dest, when, volume) {
  const dur = 0.45;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(350, when);
  bp.frequency.exponentialRampToValueAtTime(3200, when + dur * 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.5 * volume, when + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(bp).connect(g).connect(dest);
  src.start(when);
  src.stop(when + dur);
}

// Short sine blip with a fast pitch drop.
function playPop(ctx, dest, when, volume) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, when);
  osc.frequency.exponentialRampToValueAtTime(180, when + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.6 * volume, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + 0.18);
}

/**
 * Schedules effects on any BaseAudioContext (live or offline).
 * `offset` is the context time that corresponds to video time 0.
 */
export function scheduleSfx(ctx, dest, { rows = [], slides = [], textOverlays = {}, hookStyle = 'none', sfx, offset = 0, fromTime = 0 }) {
  const mode = sfx?.mode || 'none';
  if (mode === 'none') return;
  const volume = sfx?.volume ?? 0.6;
  rows.forEach((row, i) => {
    const t = row.start;
    if (t < fromTime) return;
    if ((mode === 'whoosh' || mode === 'both') && i > 0) {
      playWhoosh(ctx, dest, offset + Math.max(0, t - 0.2), volume);
    }
    const hook = textOverlays?.[i] || slides[i]?.textOverlay || '';
    if ((mode === 'pop' || mode === 'both') && hookStyle !== 'none' && hook.trim()) {
      playPop(ctx, dest, offset + t + 0.05, volume);
    }
  });
}
