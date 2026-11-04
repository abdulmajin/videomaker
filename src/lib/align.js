// Precision Script-to-Voice Slide Alignment Engine
// Prevents slide bunching/packing by:
//  1. Weighting content words (verbs/nouns) much higher than stopwords ("the", "a", "and")
//  2. Fuzzy stem/prefix & number-word matching ("75%" <-> "seventy five", "walked" <-> "walking")
//  3. Banded position prior so words in later slides cannot latch onto early slides
//  4. Anchoring each slide start between the previous slide's end and current slide's content words
//  5. Word-count-proportional interpolation and minimum slide duration guards

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'with', 'about', 'as', 'into', 'like', 'through',
  'after', 'over', 'between', 'out', 'against', 'during', 'without', 'before',
  'under', 'around', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'it', 'its', 'that', 'this', 'these',
  'those', 'he', 'him', 'his', 'she', 'her', 'hers', 'they', 'them', 'their',
  'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'from', 'up', 'down',
]);

const NUMBER_MAP = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
  '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty', '30': 'thirty',
  '40': 'forty', '50': 'fifty', '60': 'sixty', '70': 'seventy',
  '75': 'seventy', '80': 'eighty', '90': 'ninety', '100': 'hundred',
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth',
};

const norm = (w) => {
  const cleaned = String(w || '')
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
  return NUMBER_MAP[cleaned] || cleaned;
};

// Splits a string into normalized word tokens (splitting hyphens & slashes cleanly)
const tokenize = (s) =>
  String(s || '')
    .replace(/[-–—/]/g, ' ')
    .replace(/%/g, ' percent ')
    .split(/\s+/)
    .map(norm)
    .filter(Boolean);

// Simple suffix stemmer so "walked"/"walking"/"walks" or "realizes"/"realized" match
function stem(w) {
  if (w.length <= 4) return w;
  return w
    .replace(/(ingly|edly|ment|ness|tion|sion)$/, '')
    .replace(/(ing|ers|ies|ied|es|ed|ly|s)$/, (m) => (w.length - m.length >= 3 ? '' : m));
}

// Returns match score between a script token and a transcript token (0 if no match)
function wordMatchScore(swObj, twObj) {
  const a = swObj.w;
  const b = twObj.w;
  if (!a || !b) return 0;

  if (a === b) {
    return swObj.isStop ? 0.35 : 2.5;
  }

  // Never fuzzy-match stopwords or tiny words
  if (swObj.isStop || twObj.isStop || a.length < 4 || b.length < 4) {
    return 0;
  }

  // Stem match (e.g. "realizes" vs "realized", "notices" vs "noticed")
  if (swObj.stem === twObj.stem && swObj.stem.length >= 3) {
    return 2.1;
  }

  // Prefix / 1-char typo match for longer content words
  if (a.length >= 5 && b.length >= 5) {
    if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2) {
      return 1.6;
    }
  }

  return 0;
}

/**
 * Aligns script slides to Whisper transcript words with content-word weighting,
 * monotonic slide boundary constraints, and word-count-proportional interpolation.
 * Returns [{ id, start, match }] where match is 0..1.
 */
export function alignSlides(slides, transcript, duration) {
  if (!slides || !slides.length) return [];
  const totalDur = Math.max(0.5, Number(duration) || slides.length * 3);

  // Count spoken weight (words/characters) per slide for proportional timing
  const slideWeights = slides.map((s) => {
    const tokens = tokenize(s.text);
    const charWeight = tokens.reduce((sum, t) => sum + Math.max(2, t.length), 0);
    return Math.max(3, charWeight);
  });
  const totalSlideWeight = slideWeights.reduce((a, b) => a + b, 0) || 1;

  // Build flat script words array
  const sw = [];
  slides.forEach((s, k) => {
    const tokens = tokenize(s.text);
    tokens.forEach((w, posInSlide) => {
      sw.push({
        w,
        stem: stem(w),
        isStop: STOPWORDS.has(w),
        k,
        posInSlide,
        isFirstContentInSlide: false,
      });
    });
  });

  // Mark the first content word of each slide (gives extra bonus when anchoring slide start)
  const seenSlideContent = new Set();
  for (const item of sw) {
    if (!item.isStop && !seenSlideContent.has(item.k)) {
      item.isFirstContentInSlide = true;
      seenSlideContent.add(item.k);
    }
  }

  // Expand transcript chunks into clean monotonic word tokens
  const tw = [];
  let lastValidTime = 0;
  for (const rawT of transcript || []) {
    const pieces = tokenize(rawT?.text || '');
    if (!pieces.length) continue;
    const rawStart = typeof rawT.start === 'number' && !isNaN(rawT.start) ? rawT.start : lastValidTime;
    const start = Math.max(lastValidTime, Math.min(totalDur, rawStart));
    const rawEnd = typeof rawT.end === 'number' && rawT.end >= start ? rawT.end : start + 0.18;
    const end = Math.max(start + 0.04, Math.min(totalDur, rawEnd));
    lastValidTime = start;

    const pieceSpan = (end - start) / pieces.length;
    pieces.forEach((w, idx) => {
      tw.push({
        w,
        stem: stem(w),
        isStop: STOPWORDS.has(w),
        start: start + idx * pieceSpan,
        end: start + (idx + 1) * pieceSpan,
      });
    });
  }

  const n = sw.length;
  const m = tw.length;

  // Fallback if no script words or no transcript words: proportional by slide word length
  if (!n || !m) {
    let acc = 0;
    return slides.map((s, k) => {
      const st = (acc / totalSlideWeight) * totalDur;
      acc += slideWeights[k];
      return { id: s.id, start: k === 0 ? 0 : round(st), match: 0 };
    });
  }

  // Weighted DP alignment with position-drift penalty so distant stopwords never cross-match
  const W = m + 1;
  const dp = new Float32Array((n + 1) * W);
  const pick = new Uint8Array((n + 1) * W); // 1 = match(diag), 2 = up(i-1), 3 = left(j-1)

  for (let i = 1; i <= n; i++) {
    const swItem = sw[i - 1];
    const expectedRatio = (i - 0.5) / n;
    const rowOffset = i * W;
    const prevRowOffset = (i - 1) * W;

    for (let j = 1; j <= m; j++) {
      const twItem = tw[j - 1];
      const baseScore = wordMatchScore(swItem, twItem);

      let best = dp[prevRowOffset + j];
      let dir = 2; // skip script word

      const left = dp[rowOffset + j - 1];
      if (left > best) {
        best = left;
        dir = 3; // skip transcript word
      }

      if (baseScore > 0) {
        const actualRatio = (j - 0.5) / m;
        const drift = Math.abs(expectedRatio - actualRatio);
        // Penalize matches that drift far from expected timeline position (especially stopwords)
        const maxAllowedDrift = swItem.isStop ? 0.16 : 0.42;
        if (drift <= maxAllowedDrift) {
          const driftFactor = 1 - (drift / maxAllowedDrift) * (swItem.isStop ? 0.75 : 0.35);
          const firstBonus = swItem.isFirstContentInSlide || swItem.posInSlide === 0 ? 1.2 : 1.0;
          const diag = dp[prevRowOffset + j - 1] + baseScore * driftFactor * firstBonus;
          if (diag >= best) {
            best = diag;
            dir = 1;
          }
        }
      }

      dp[rowOffset + j] = best;
      pick[rowOffset + j] = dir;
    }
  }

  // Backtrack to collect all matched transcript words per slide
  const slideMatches = Array.from({ length: slides.length }, () => []);
  const counts = Array(slides.length).fill(0);
  sw.forEach(({ k }) => counts[k]++);

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const d = pick[i * W + j];
    if (d === 1) {
      const swItem = sw[i - 1];
      const twItem = tw[j - 1];
      slideMatches[swItem.k].push({
        start: twItem.start,
        end: twItem.end,
        posInSlide: swItem.posInSlide,
        isStop: swItem.isStop,
      });
      i--;
      j--;
    } else if (d === 2) {
      i--;
    } else {
      j--;
    }
  }

  // Reverse each slide's matched list so it's in chronological order
  slideMatches.forEach((arr) => arr.reverse());

  // Determine reliable start & end anchor per slide
  const rawStarts = Array(slides.length).fill(null);
  const hits = Array(slides.length).fill(0);
  rawStarts[0] = 0;

  let prevSlideLastEnd = 0;
  for (let k = 0; k < slides.length; k++) {
    const matches = slideMatches[k];
    hits[k] = matches.length;
    if (!matches.length) continue;

    // Filter out stray stopword matches that happened BEFORE the previous slide finished
    const validMatches = matches.filter(
      (m) => !m.isStop || m.start >= prevSlideLastEnd - 0.05
    );
    const chosen = validMatches.length > 0 ? validMatches : matches;

    if (k > 0) {
      // Estimate where slide k truly started by extrapolating back from its first reliable matched word
      const firstMatch = chosen[0];
      const leadIn = Math.min(0.45, firstMatch.posInSlide * 0.22);
      const estimatedStart = Math.max(prevSlideLastEnd, firstMatch.start - leadIn);
      rawStarts[k] = estimatedStart;
    }

    const lastMatch = chosen[chosen.length - 1];
    prevSlideLastEnd = Math.max(prevSlideLastEnd, lastMatch.end);
  }

  // Fill in any unmatched slides using word-count-weighted interpolation (NOT uniform equal slices)
  const start = rawStarts.slice();
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
    const t1 = b < start.length ? start[b] : totalDur;
    const spanTime = Math.max(0.1, t1 - t0);

    // Sum weights for slides a..b-1
    let spanWeight = 0;
    for (let x = a; x < b; x++) spanWeight += slideWeights[x];
    spanWeight = spanWeight || 1;

    let accWeight = slideWeights[a];
    for (let x = k; x < b; x++) {
      start[x] = t0 + (accWeight / spanWeight) * spanTime;
      accWeight += slideWeights[x];
    }
    k = b;
  }

  // Final Anti-Bunching Pass:
  // If two consecutive slides are packed unrealistically close (< minDur based on word count),
  // smoothly redistribute the local cluster proportionally to slide word counts.
  const minSlideDur = (idx) => {
    const avgDur = (slideWeights[idx] / totalSlideWeight) * totalDur;
    return Math.min(1.2, Math.max(0.45, avgDur * 0.38));
  };

  for (let pass = 0; pass < 3; pass++) {
    for (let x = 1; x < start.length; x++) {
      const requiredGap = minSlideDur(x - 1);
      if (start[x] - start[x - 1] < requiredGap) {
        start[x] = start[x - 1] + requiredGap;
      }
    }
    // If pushing forward exceeded totalDur at the end, compress back proportionally from the end
    const lastMinTail = minSlideDur(start.length - 1);
    if (start[start.length - 1] > totalDur - lastMinTail && start.length > 1) {
      const excess = start[start.length - 1] - (totalDur - lastMinTail);
      for (let x = 1; x < start.length; x++) {
        const ratio = x / (start.length - 1);
        start[x] = Math.max(0, start[x] - excess * ratio);
      }
    }
  }

  start[0] = 0;
  for (let x = 1; x < start.length; x++) {
    start[x] = Math.max(start[x - 1] + 0.25, Math.min(totalDur - 0.2, start[x]));
  }

  return slides.map((s, idx) => ({
    id: s.id,
    start: round(start[idx]),
    match: counts[idx] ? Math.min(1, hits[idx] / counts[idx]) : 0,
  }));
}

const round = (n) => Math.round(n * 100) / 100;
