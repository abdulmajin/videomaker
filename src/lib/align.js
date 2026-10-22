const norm = (w) =>
  w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
const split = (s) => s.split(/\s+/).map(norm).filter(Boolean);

// Aligns script words to transcript words (longest common subsequence),
// then reads each slide's start time from its first matched word.
// Returns [{ id, start, match }] where match is 0..1 (how much of the slide was found).
export function alignSlides(slides, transcript, duration) {
  const sw = [];
  slides.forEach((s, k) => split(s.text).forEach((w) => sw.push({ w, k })));
  const tw = transcript
    .map((t) => ({ ...t, w: norm(t.text) }))
    .filter((t) => t.w);
  const n = sw.length;
  const m = tw.length;

  if (!n || !m) {
    return slides.map((s, k) => ({ id: s.id, start: round((duration / slides.length) * k), match: 0 }));
  }

  const W = m + 1;
  const dp = new Uint16Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * W + j] =
        sw[i - 1].w === tw[j - 1].w
          ? dp[(i - 1) * W + j - 1] + 1
          : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
    }
  }

  const first = Array(slides.length).fill(null);
  const hits = Array(slides.length).fill(0);
  const counts = Array(slides.length).fill(0);
  sw.forEach(({ k }) => counts[k]++);

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (sw[i - 1].w === tw[j - 1].w) {
      const k = sw[i - 1].k;
      first[k] = tw[j - 1].start; // walking backwards, so the last write is the earliest word
      hits[k]++;
      i--;
      j--;
    } else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) i--;
    else j--;
  }

  const start = first.slice();
  start[0] = 0;
  let k = 1;
  while (k < start.length) {
    if (start[k] != null) {
      k++;
      continue;
    }
    const a = k - 1;
    let b = k;
    while (b < start.length && start[b] == null) b++;
    const t0 = start[a];
    const t1 = b < start.length ? start[b] : duration;
    for (let x = k; x < b; x++) start[x] = t0 + ((t1 - t0) * (x - a)) / (b - a);
    k = b;
  }
  for (let x = 1; x < start.length; x++) start[x] = Math.max(start[x], start[x - 1]);

  return slides.map((s, idx) => ({
    id: s.id,
    start: round(start[idx]),
    match: counts[idx] ? hits[idx] / counts[idx] : 0,
  }));
}

const round = (n) => Math.round(n * 100) / 100;
