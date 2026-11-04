// Precision Hybrid Acoustic + Lexical + Prosody Slide & Caption Alignment Engine
// Combines:
//  1. Direct 16kHz Acoustic Speech-Segment & Pause Detection (VAD energy envelope)
//  2. Syllable & Clause Prosody Modeling of each script slide
//  3. Sanitized Content-Word-Weighted Whisper Lexical Anchors (immune to first-chunk DTW collapse)
//  4. Exact Sub-Clause Word Retiming so bottom captions match both the script and voice 100%

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

const US_UK_MAP = {
  favour: 'favor',
  favours: 'favors',
  favourite: 'favorite',
  colour: 'color',
  colours: 'colors',
  behaviour: 'behavior',
  honour: 'honor',
  realise: 'realize',
  realised: 'realized',
  recognise: 'recognize',
  apologise: 'apologize',
  centre: 'center',
  defence: 'defense',
  offence: 'offense',
  travelling: 'traveling',
  cancelled: 'canceled',
};

const norm = (w) => {
  const cleaned = String(w || '')
    .toLowerCase()
    .replace(/[^a-z0-9']/g, '')
    .replace(/^'+|'+$/g, '');
  return US_UK_MAP[cleaned] || NUMBER_MAP[cleaned] || cleaned;
};

const tokenize = (s) =>
  String(s || '')
    .replace(/[-–—/]/g, ' ')
    .replace(/%/g, ' percent ')
    .split(/\s+/)
    .map(norm)
    .filter(Boolean);

function stem(w) {
  if (w.length <= 4) return w;
  return w
    .replace(/(ingly|edly|ment|ness|tion|sion)$/, '')
    .replace(/(ing|ers|ies|ied|es|ed|ly|s)$/, (m) => (w.length - m.length >= 3 ? '' : m));
}

export function countSyllables(word) {
  const w = norm(word).replace(/[^a-z]/g, '');
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = cleaned.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

export function analyzeSlideProsody(text) {
  const clean = String(text || '').trim();
  const rawWords = clean.split(/\s+/).filter(Boolean);
  let syllables = 0;
  let internalClauses = 0;
  rawWords.forEach((rw, idx) => {
    syllables += countSyllables(rw);
    if (idx < rawWords.length - 1 && /[,;:–—.!?]$/.test(rw)) {
      internalClauses++;
    }
  });
  const endsStrong = /[.!?]["']?$/.test(clean);
  return {
    syllables: Math.max(1, syllables),
    wordCount: Math.max(1, rawWords.length),
    expectedSegs: 1 + internalClauses,
    endsStrong,
  };
}

/**
 * Extracts acoustic speech segments and silence pauses directly from 16kHz mono PCM audio samples.
 * Immune to Whisper DTW timestamp glitches on early chunks.
 */
export function extractSpeechSegments(samples, sampleRate = 16000, targetMinSegments = 0) {
  if (!samples || !samples.length) return [];
  const totalDur = samples.length / sampleRate;
  const hop = Math.round(sampleRate * 0.02); // 20ms frame
  const numFrames = Math.floor(samples.length / hop);
  if (numFrames < 5) return [];

  const rms = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = samples[base + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / hop);
  }

  const sorted = Array.from(rms).sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0.05;
  const p15 = sorted[Math.floor(sorted.length * 0.15)] || 0;
  const thresh = Math.max(0.006, p15 + (p90 - p15) * 0.075);

  const buildSegsWithPauseMin = (minPauseSec) => {
    const silences = [];
    let inSilence = true;
    let silStart = 0;
    for (let f = 0; f < numFrames; f++) {
      const isSilent = rms[f] < thresh;
      if (isSilent && !inSilence) {
        inSilence = true;
        silStart = f * 0.02;
      } else if (!isSilent && inSilence) {
        const silEnd = f * 0.02;
        if (silEnd - silStart >= minPauseSec) {
          silences.push({ start: silStart, end: silEnd, dur: silEnd - silStart });
        }
        inSilence = false;
      }
    }
    if (inSilence) {
      const silEnd = numFrames * 0.02;
      if (silEnd - silStart >= minPauseSec) {
        silences.push({ start: silStart, end: silEnd, dur: silEnd - silStart });
      }
    }

    let segStart = silences[0]?.start === 0 ? silences[0].end : 0;
    const rawSegs = [];
    for (const p of silences) {
      if (p.start > segStart + 0.08) {
        rawSegs.push({
          start: round(segStart),
          end: round(p.start),
          speechDur: round(p.start - segStart),
          pauseAfter: round(p.dur),
        });
      } else if (rawSegs.length > 0) {
        rawSegs[rawSegs.length - 1].pauseAfter = round(rawSegs[rawSegs.length - 1].pauseAfter + p.dur);
      }
      segStart = p.end;
    }
    if (totalDur > segStart + 0.08) {
      rawSegs.push({
        start: round(segStart),
        end: round(totalDur),
        speechDur: round(totalDur - segStart),
        pauseAfter: 0,
      });
    }

    // Merge micro-segments (< 0.28s, e.g. a single breath/consonant pop) into next segment if pauseAfter < 0.42s
    const merged = [];
    for (let i = 0; i < rawSegs.length; i++) {
      const cur = { ...rawSegs[i] };
      if (cur.speechDur < 0.28 && cur.pauseAfter < 0.42 && i + 1 < rawSegs.length) {
        rawSegs[i + 1].start = cur.start;
        rawSegs[i + 1].speechDur = round(rawSegs[i + 1].end - cur.start);
        continue;
      }
      merged.push(cur);
    }
    return merged;
  };

  let segs = buildSegsWithPauseMin(0.20);
  if (targetMinSegments > 0 && segs.length < targetMinSegments) {
    const finer = buildSegsWithPauseMin(0.12);
    if (finer.length > segs.length) segs = finer;
  }

  // If still fewer segments than targetMinSegments, split longest segments at local energy valleys
  while (targetMinSegments > 0 && segs.length > 0 && segs.length < targetMinSegments) {
    let longestIdx = -1;
    let longestDur = 1.6;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].speechDur > longestDur) {
        longestDur = segs[i].speechDur;
        longestIdx = i;
      }
    }
    if (longestIdx === -1) break;
    const target = segs[longestIdx];
    const startFrame = Math.floor((target.start + target.speechDur * 0.28) / 0.02);
    const endFrame = Math.min(numFrames - 1, Math.ceil((target.end - target.speechDur * 0.28) / 0.02));
    if (endFrame <= startFrame + 4) break;

    let minF = Math.floor((startFrame + endFrame) / 2);
    let minVal = Infinity;
    for (let f = startFrame; f <= endFrame; f++) {
      const windowAvg = (rms[Math.max(0, f - 1)] + rms[f] + rms[Math.min(numFrames - 1, f + 1)]) / 3;
      if (windowAvg < minVal) {
        minVal = windowAvg;
        minF = f;
      }
    }
    const splitTime = round(minF * 0.02);
    const firstHalf = {
      start: target.start,
      end: splitTime,
      speechDur: round(splitTime - target.start),
      pauseAfter: 0.08,
    };
    const secondHalf = {
      start: splitTime,
      end: target.end,
      speechDur: round(target.end - splitTime),
      pauseAfter: target.pauseAfter,
    };
    segs.splice(longestIdx, 1, firstHalf, secondHalf);
  }

  return segs;
}

function wordMatchScore(swObj, twObj) {
  const a = swObj.w;
  const b = twObj.w;
  if (!a || !b) return 0;

  if (a === b) {
    return swObj.isStop ? 0.35 : 2.6;
  }
  if (swObj.isStop || twObj.isStop || a.length < 4 || b.length < 4) {
    return 0;
  }
  if (swObj.stem === twObj.stem && swObj.stem.length >= 3) {
    return 2.2;
  }
  if (a.length >= 5 && b.length >= 5) {
    if (a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2) {
      return 1.6;
    }
  }
  return 0;
}

/**
 * Detects and repairs Whisper DTW timestamp bunching/collapse where multiple words
 * are stamped at identical or near-zero-span timestamps (common in chunk 0 of whisper-tiny.en).
 */
function sanitizeWhisperWords(transcript, totalDur) {
  if (!transcript || !transcript.length) return [];
  const raw = [];
  let lastValid = 0;

  for (const item of transcript) {
    const pieces = tokenize(item?.text || '');
    if (!pieces.length) continue;
    const rawStart = typeof item.start === 'number' && !isNaN(item.start) ? item.start : lastValid;
    const start = Math.max(0, Math.min(totalDur, rawStart));
    const rawEnd = typeof item.end === 'number' && item.end >= start ? item.end : start + 0.16;
    const end = Math.max(start, Math.min(totalDur, rawEnd));
    lastValid = Math.max(lastValid, start);

    const span = (end - start) / pieces.length;
    pieces.forEach((w, idx) => {
      raw.push({
        w,
        stem: stem(w),
        isStop: STOPWORDS.has(w),
        start: start + idx * span,
        end: start + (idx + 1) * span,
        collapsed: false,
      });
    });
  }

  if (raw.length < 3) return raw;

  // Enforce non-decreasing order
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].start < raw[i - 1].start) {
      raw[i].start = raw[i - 1].start;
    }
    if (raw[i].end < raw[i].start) {
      raw[i].end = raw[i].start;
    }
  }

  // Detect bunched clusters: e.g. >= 5 words squeezed into < 0.11s per word (> 9 words/sec)
  let i = 0;
  while (i < raw.length) {
    let j = i + 1;
    while (
      j < raw.length &&
      (raw[j].start - raw[i].start) / Math.max(1, j - i) < 0.11
    ) {
      j++;
    }
    const clusterLen = j - i;
    if (clusterLen >= 4) {
      for (let k = i; k < j; k++) raw[k].collapsed = true;
      const tStart = i > 0 ? Math.max(raw[i - 1].end, raw[i].start) : raw[i].start;
      const nextValidStart = j < raw.length ? raw[j].start : totalDur;
      const availableSpan = Math.max(clusterLen * 0.22, nextValidStart - tStart);
      const step = Math.min(0.32, availableSpan / clusterLen);
      for (let k = i; k < j; k++) {
        raw[k].start = Math.min(totalDur, tStart + (k - i) * step);
        raw[k].end = Math.min(totalDur, raw[k].start + step * 0.9);
      }
    }
    i = Math.max(i + 1, j);
  }

  return raw;
}

/**
 * Runs lexical DP matching between script slides and sanitized Whisper words.
 */
function matchWhisperLexical(slides, transcript, totalDur) {
  const tw = sanitizeWhisperWords(transcript, totalDur);
  const sw = [];
  const counts = Array(slides.length).fill(0);

  slides.forEach((s, k) => {
    const tokens = tokenize(s.text);
    counts[k] = tokens.length;
    tokens.forEach((w, posInSlide) => {
      sw.push({
        w,
        stem: stem(w),
        isStop: STOPWORDS.has(w),
        k,
        posInSlide,
      });
    });
  });

  const n = sw.length;
  const m = tw.length;
  const slideMatches = Array.from({ length: slides.length }, () => []);
  if (!n || !m) return { slideMatches, counts, tw };

  const W = m + 1;
  const dp = new Float32Array((n + 1) * W);
  const pick = new Uint8Array((n + 1) * W);

  for (let i = 1; i <= n; i++) {
    const swItem = sw[i - 1];
    const expectedRatio = (i - 0.5) / n;
    const rowOffset = i * W;
    const prevRowOffset = (i - 1) * W;

    for (let j = 1; j <= m; j++) {
      const twItem = tw[j - 1];
      const baseScore = wordMatchScore(swItem, twItem);

      let best = dp[prevRowOffset + j];
      let dir = 2;

      const left = dp[rowOffset + j - 1];
      if (left > best) {
        best = left;
        dir = 3;
      }

      if (baseScore > 0) {
        const actualRatio = (j - 0.5) / m;
        const drift = Math.abs(expectedRatio - actualRatio);
        const maxAllowedDrift = swItem.isStop ? 0.14 : 0.38;
        if (drift <= maxAllowedDrift) {
          const driftFactor = 1 - (drift / maxAllowedDrift) * (swItem.isStop ? 0.8 : 0.35);
          const collapsePenalty = twItem.collapsed ? 0.45 : 1.0;
          const diag = dp[prevRowOffset + j - 1] + baseScore * driftFactor * collapsePenalty;
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

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const d = pick[i * W + j];
    if (d === 1) {
      const swItem = sw[i - 1];
      const twItem = tw[j - 1];
      slideMatches[swItem.k].push({
        w: swItem.w,
        start: twItem.start,
        end: twItem.end,
        posInSlide: swItem.posInSlide,
        isStop: swItem.isStop,
        collapsed: twItem.collapsed,
      });
      i--;
      j--;
    } else if (d === 2) {
      i--;
    } else {
      j--;
    }
  }

  slideMatches.forEach((arr) => arr.reverse());
  return { slideMatches, counts, tw };
}

/**
 * Aligns script slides to voice audio using Hybrid Acoustic Speech-Segments + Prosody + Whisper Lexical DP.
 * Accepts optional 4th parameter `speechSegmentsOrSamples` (either pre-extracted speechSegments array or Float32Array samples).
 */
export function alignSlides(slides, transcript, duration, speechSegmentsOrSamples = null) {
  if (!slides || !slides.length) return [];
  const totalDur = Math.max(0.5, Number(duration) || slides.length * 3);
  const K = slides.length;

  const prosody = slides.map((s) => analyzeSlideProsody(s.text));
  const totalSyllables = prosody.reduce((acc, p) => acc + p.syllables, 0) || 1;

  // Obtain acoustic speech segments if provided
  let segs = [];
  if (Array.isArray(speechSegmentsOrSamples) && speechSegmentsOrSamples.length > 0) {
    segs = speechSegmentsOrSamples;
  } else if (speechSegmentsOrSamples instanceof Float32Array && speechSegmentsOrSamples.length > 0) {
    segs = extractSpeechSegments(speechSegmentsOrSamples, 16000, K);
  }

  const { slideMatches, counts } = matchWhisperLexical(slides, transcript, totalDur);

  // Extract reliable (non-collapsed) Whisper content-word anchor ranges per slide
  const whisperAnchors = slides.map((_, k) => {
    const contentHits = (slideMatches[k] || []).filter((m) => !m.isStop && !m.collapsed);
    if (!contentHits.length) return null;
    const first = contentHits[0];
    const last = contentHits[contentHits.length - 1];
    const leadIn = Math.min(0.4, first.posInSlide * 0.22);
    return {
      estStart: Math.max(0, first.start - leadIn),
      estEnd: last.end,
      hitCount: contentHits.length,
    };
  });

  // ── PATH A: Hybrid Acoustic Speech-Segment + Prosody + Whisper DP (when S >= K) ──
  if (segs.length >= K) {
    const S = segs.length;
    const totalSpeechDur = segs.reduce((acc, s) => acc + s.speechDur, 0) || totalDur * 0.78;
    const avgSecPerSyllable = totalSpeechDur / totalSyllables;

    const dp = Array.from({ length: K + 1 }, () => new Float64Array(S + 1).fill(Infinity));
    const parent = Array.from({ length: K + 1 }, () => new Int32Array(S + 1).fill(-1));
    dp[0][0] = 0;

    for (let k = 1; k <= K; k++) {
      const p = prosody[k - 1];
      const expectedSpeechDur = p.syllables * avgSecPerSyllable;
      const wAnchor = whisperAnchors[k - 1];

      for (let b = k; b <= S - (K - k); b++) {
        let cumSpeechDur = 0;
        for (let a = b; a >= k; a--) {
          const seg = segs[a - 1];
          cumSpeechDur += seg.speechDur;
          const numSegs = b - a + 1;
          if (numSegs > Math.max(6, p.expectedSegs + 4)) break;

          // 1. Spoken syllable duration match cost
          const durDiff = Math.abs(cumSpeechDur - expectedSpeechDur);
          const relDiff = durDiff / Math.max(0.8, expectedSpeechDur);
          const durCost = durDiff * 2.2 + relDiff * relDiff * 3.5;

          // 2. Clause / sub-segment count match cost
          const segCountDiff = Math.abs(numSegs - p.expectedSegs);
          const segCountCost = segCountDiff * 0.65;

          // 3. Penalty for swallowing a long sentence pause (> 0.78s) inside a single slide
          let internalPausePenalty = 0;
          for (let m = a; m < b; m++) {
            const pa = segs[m - 1].pauseAfter;
            if (pa > 0.78) {
              internalPausePenalty += (pa - 0.65) * 6.5;
            }
          }

          // 4. Boundary pause reward after segs[b-1]
          const endPause = segs[b - 1].pauseAfter;
          let boundaryCost = 0;
          if (k < K) {
            if (endPause < 0.35) boundaryCost += (0.45 - endPause) * 3.5;
            else boundaryCost -= Math.min(1.2, endPause) * 1.4;
          }

          // 5. Whisper lexical anchor confirmation bonus (only when consistent with acoustic segment)
          let lexicalBonus = 0;
          if (wAnchor) {
            const segStart = segs[a - 1].start;
            const segEnd = segs[b - 1].end;
            const anchorDiff = Math.abs(segStart - wAnchor.estStart);
            if (anchorDiff < 1.2) {
              lexicalBonus = -Math.min(1.2, wAnchor.hitCount * 0.35) * (1 - anchorDiff / 1.2);
            }
          }

          const totalCost =
            dp[k - 1][a - 1] +
            durCost +
            segCountCost +
            internalPausePenalty +
            boundaryCost +
            lexicalBonus;

          if (totalCost < dp[k][b]) {
            dp[k][b] = totalCost;
            parent[k][b] = a - 1;
          }
        }
      }
    }

    if (dp[K][S] < Infinity) {
      const slideSegRange = Array(K);
      let curS = S;
      for (let k = K; k >= 1; k--) {
        const prevS = parent[k][curS];
        slideSegRange[k - 1] = [prevS, curS - 1];
        curS = prevS;
      }

      return slides.map((s, idx) => {
        const [a, b] = slideSegRange[idx];
        const speechStart = segs[a].start;
        const speechEnd = segs[b].end;
        const start = idx === 0 ? 0 : round(speechStart);
        const rawHits = slideMatches[idx]?.length || 0;
        const matchRatio = counts[idx]
          ? Math.max(0.85, Math.min(1, rawHits / counts[idx]))
          : 1;
        return {
          id: s.id,
          start,
          speechStart: round(speechStart),
          speechEnd: round(speechEnd),
          segRange: [a, b],
          match: round(matchRatio),
        };
      });
    }
  }

  // ── PATH B: Prosody-Constrained Whisper + Syllable Alignment (fallback when raw PCM segments unavailable) ──
  const rawStarts = Array(K).fill(null);
  rawStarts[0] = 0;

  let prevSlideEnd = 0;
  let cumSyllables = 0;

  for (let k = 0; k < K; k++) {
    const p = prosody[k];
    const expectedStartRatio = cumSyllables / totalSyllables;
    const expectedStart = expectedStartRatio * totalDur;
    const expectedDur = (p.syllables / totalSyllables) * totalDur;
    cumSyllables += p.syllables;

    const matches = (slideMatches[k] || []).filter(
      (m) => !m.collapsed && (!m.isStop || m.start >= prevSlideEnd - 0.05)
    );

    if (matches.length > 0 && k > 0) {
      const first = matches[0];
      const last = matches[matches.length - 1];
      const leadIn = Math.min(0.42, first.posInSlide * 0.22);
      const candidateStart = Math.max(prevSlideEnd, first.start - leadIn);

      // Reject candidateStart if it drifts implausibly far from syllable prosody expectation
      // (protects Slides 1-10 when Whisper's first 30s chunk collapses timestamps)
      const maxProsodyDrift = Math.max(3.2, totalDur * 0.08);
      if (Math.abs(candidateStart - expectedStart) <= maxProsodyDrift) {
        rawStarts[k] = candidateStart;
        prevSlideEnd = Math.max(
          candidateStart + Math.max(0.6, expectedDur * 0.55),
          last.end
        );
        continue;
      }
    }

    // Prosody advance forprevSlideEnd
    prevSlideEnd = Math.max(prevSlideEnd + expectedDur * 0.65, expectedStart + expectedDur * 0.7);
  }

  // Interpolate any missing slides strictly by syllable weight (plus pause weight)
  const slideWeights = prosody.map((p) => p.syllables + (p.endsStrong ? 2.2 : 1.0));
  const start = rawStarts.slice();
  start[0] = 0;
  let k = 1;
  while (k < K) {
    if (start[k] != null) {
      k++;
      continue;
    }
    const a = k - 1;
    let b = k;
    while (b < K && start[b] == null) b++;
    const t0 = start[a];
    const t1 = b < K ? start[b] : totalDur;
    const spanTime = Math.max(0.1, t1 - t0);

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

  // Enforce realistic syllable-based minimum slide durations
  const totalWeight = slideWeights.reduce((a, b) => a + b, 0) || 1;
  const minSlideDur = (idx) => {
    const expected = (slideWeights[idx] / totalWeight) * totalDur;
    return Math.max(0.75, expected * 0.62);
  };

  for (let pass = 0; pass < 3; pass++) {
    for (let x = 1; x < K; x++) {
      const req = minSlideDur(x - 1);
      if (start[x] - start[x - 1] < req) {
        start[x] = start[x - 1] + req;
      }
    }
    const lastReq = minSlideDur(K - 1);
    if (start[K - 1] > totalDur - lastReq && K > 1) {
      const excess = start[K - 1] - (totalDur - lastReq);
      for (let x = 1; x < K; x++) {
        start[x] = Math.max(0, start[x] - excess * (x / (K - 1)));
      }
    }
  }

  start[0] = 0;
  for (let x = 1; x < K; x++) {
    start[x] = Math.max(start[x - 1] + 0.35, Math.min(totalDur - 0.25, start[x]));
  }

  return slides.map((s, idx) => {
    const st = round(start[idx]);
    const nextSt = idx + 1 < K ? round(start[idx + 1]) : round(totalDur);
    const hits = slideMatches[idx]?.length || 0;
    return {
      id: s.id,
      start: st,
      speechStart: st,
      speechEnd: round(Math.max(st + 0.3, nextSt - 0.35)),
      match: counts[idx] ? round(Math.min(1, hits / counts[idx])) : 0,
    };
  });
}

/**
 * Generates clean, script-locked word timestamps (`[{ text, start, end, slideIndex }]`)
 * aligned to each slide's acoustic speech sub-segments (`segs[a..b]`) and clause punctuation.
 * Guarantees that bottom captions match both the voice and the active slide 100%.
 */
export function alignWordsToSlides(slides, alignedRows, transcript = [], duration = 0, speechSegments = []) {
  if (!slides || !slides.length || !alignedRows || !alignedRows.length) {
    return transcript || [];
  }

  const totalDur = Math.max(0.5, Number(duration) || slides.length * 3);
  const segs = Array.isArray(speechSegments) ? speechSegments : [];
  const outWords = [];

  for (let k = 0; k < slides.length; k++) {
    const slide = slides[k];
    const row = alignedRows[k] || { start: 0 };
    const nextRow = alignedRows[k + 1];
    const slideStart = row.start ?? 0;
    const slideEnd = nextRow ? nextRow.start : totalDur;

    const cleanText = String(slide.text || '').trim();
    if (!cleanText) continue;
    const rawTokens = cleanText.split(/\s+/).filter(Boolean);
    if (!rawTokens.length) continue;

    // Identify acoustic sub-segments belonging to this slide
    let slideSegs = [];
    if (Array.isArray(row.segRange) && segs.length > row.segRange[1]) {
      const [a, b] = row.segRange;
      slideSegs = segs.slice(a, b + 1);
    } else if (segs.length > 0) {
      slideSegs = segs.filter(
        (sg) => sg.end > slideStart + 0.08 && sg.start < slideEnd - 0.08
      );
    }

    if (!slideSegs.length) {
      const spStart = row.speechStart ?? slideStart;
      const spEnd = row.speechEnd ?? Math.max(spStart + 0.3, slideEnd - 0.3);
      slideSegs = [{ start: spStart, end: spEnd, speechDur: Math.max(0.2, spEnd - spStart) }];
    }

    // Split rawTokens into clause groups at punctuation (comma, period, colon, semicolon, dash)
    const clauses = [];
    let curClause = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      curClause.push(tok);
      if (i < rawTokens.length - 1 && /[,;:–—.!?]["']?$/.test(tok)) {
        clauses.push(curClause);
        curClause = [];
      }
    }
    if (curClause.length) clauses.push(curClause);

    // Map clauses to slideSegs
    if (slideSegs.length > 1 && clauses.length > 1) {
      // Partition clauses across slideSegs proportionally by syllable count
      const clauseSylls = clauses.map((cl) =>
        cl.reduce((sum, w) => sum + countSyllables(w), 0)
      );
      const totalClauseSylls = clauseSylls.reduce((a, b) => a + b, 0) || 1;
      const segDurs = slideSegs.map((sg) => Math.max(0.1, sg.end - sg.start));
      const totalSegDur = segDurs.reduce((a, b) => a + b, 0) || 1;

      // Assign each clause to the best matching segment or group of segments
      if (clauses.length === slideSegs.length) {
        for (let c = 0; c < clauses.length; c++) {
          distributeWordsInWindow(clauses[c], slideSegs[c].start, slideSegs[c].end, k, outWords);
        }
      } else {
        // Flatten words across slideSegs respecting pause gaps between slideSegs
        distributeWordsAcrossSegments(rawTokens, slideSegs, k, outWords, totalClauseSylls, totalSegDur);
      }
    } else {
      // Single clause or single segment: distribute across slideSegs respecting inter-segment pauses
      const totalSylls = rawTokens.reduce((sum, w) => sum + countSyllables(w), 0) || 1;
      const totalSegDur = slideSegs.reduce((sum, sg) => sum + Math.max(0.1, sg.end - sg.start), 0) || 1;
      distributeWordsAcrossSegments(rawTokens, slideSegs, k, outWords, totalSylls, totalSegDur);
    }
  }

  return outWords;
}

function distributeWordsInWindow(tokens, winStart, winEnd, slideIndex, outWords) {
  const dur = Math.max(0.08, winEnd - winStart);
  const weights = tokens.map(
    (w, idx) =>
      Math.max(1, countSyllables(w)) +
      (idx < tokens.length - 1 && /[,;:–—.!?]$/.test(w) ? 0.55 : 0)
  );
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = winStart;
  for (let i = 0; i < tokens.length; i++) {
    const span = (weights[i] / totalW) * dur;
    const start = round(cursor);
    const end = round(cursor + Math.max(0.05, span));
    cursor += span;
    outWords.push({
      text: ` ${tokens[i]}`,
      start,
      end,
      slideIndex,
    });
  }
}

function distributeWordsAcrossSegments(tokens, slideSegs, slideIndex, outWords) {
  if (slideSegs.length === 1) {
    distributeWordsInWindow(tokens, slideSegs[0].start, slideSegs[0].end, slideIndex, outWords);
    return;
  }

  const wordWeights = tokens.map(
    (w, idx) =>
      Math.max(1, countSyllables(w)) +
      (idx < tokens.length - 1 && /[,;:–—.!?]$/.test(w) ? 0.8 : 0)
  );
  const totalWordWeight = wordWeights.reduce((a, b) => a + b, 0) || 1;
  const segDurs = slideSegs.map((sg) => Math.max(0.1, sg.end - sg.start));
  const totalSegDur = segDurs.reduce((a, b) => a + b, 0) || 1;

  // Partition tokens into slideSegs.length buckets matching segment duration ratios
  let tokIdx = 0;
  let cumSegDur = 0;
  let cumWordWeight = 0;

  for (let s = 0; s < slideSegs.length; s++) {
    cumSegDur += segDurs[s];
    const targetWeight = (cumSegDur / totalSegDur) * totalWordWeight;
    const bucket = [];

    while (
      tokIdx < tokens.length &&
      (s === slideSegs.length - 1 ||
        bucket.length === 0 ||
        cumWordWeight + wordWeights[tokIdx] * 0.55 <= targetWeight)
    ) {
      // Leave at least 1 token for each remaining segment
      const remainingTokens = tokens.length - tokIdx;
      const remainingSegs = slideSegs.length - 1 - s;
      if (remainingTokens <= remainingSegs) break;

      bucket.push(tokens[tokIdx]);
      cumWordWeight += wordWeights[tokIdx];
      tokIdx++;

      // Prefer breaking right at punctuation when near targetWeight
      if (
        s < slideSegs.length - 1 &&
        /[,;:–—.!?]["']?$/.test(bucket[bucket.length - 1]) &&
        cumWordWeight >= targetWeight * 0.65
      ) {
        break;
      }
    }

    if (bucket.length > 0) {
      distributeWordsInWindow(bucket, slideSegs[s].start, slideSegs[s].end, slideIndex, outWords);
    }
  }
}

const round = (n) => Math.round(n * 100) / 100;
