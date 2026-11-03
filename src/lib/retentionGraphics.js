// Auto-Retention Graphic Automation Engine
// Provides 6 modular, canvas-rendered graphic automations that can be enabled
// individually, in any multi-select combination, or all 6 combined.

export const RETENTION_GRAPHIC_OPTIONS = [
  {
    id: 'punchZoom',
    num: 1,
    icon: '🔍',
    label: '1. Continuous Camera + Punch-Zoom',
    shortLabel: '1. Punch-Zoom Camera',
    badge: 'Auto Camera',
    desc: 'Smooth Ken Burns glide so slides never freeze + automatic 1.09x camera Punch-Zoom on emphasis words & numbers.',
  },
  {
    id: 'statCallouts',
    num: 2,
    icon: '📊',
    label: '2. Auto Stat, Number & Keyword Callouts',
    shortLabel: '2. Auto Stat Callouts',
    badge: 'Data Cards',
    desc: 'Detects numbers, percentages, and key points in your script and pops an animated circular gauge & counter card.',
  },
  {
    id: 'iconPops',
    num: 3,
    icon: '🎯',
    label: '3. Auto Contextual Icon / Emoji Pop-Ins',
    shortLabel: '3. Auto Icon Pop-Ins',
    badge: 'Voice Synced',
    desc: 'Matches spoken keywords (heart, brain, warning, money, time, check, etc.) to floating animated icon badges.',
  },
  {
    id: 'livingFrame',
    num: 4,
    icon: '✨',
    label: '4. Living Frame (Particles & Voice Wave)',
    shortLabel: '4. Particles & Voice Wave',
    badge: 'Ambient + Audio',
    desc: 'Renders floating glow particles, a soft moving light sweep, and a live audio-reactive voice equalizer.',
  },
  {
    id: 'progressPill',
    num: 5,
    icon: '📈',
    label: '5. Auto Progress Bar & Topic Pill',
    shortLabel: '5. Progress & Topic Pill',
    badge: 'Watch-Time',
    desc: 'Adds a glowing top progress bar with slide chapter ticks + a sleek section/topic indicator pill.',
  },
  {
    id: 'patternInterrupts',
    num: 6,
    icon: '⚡',
    label: '6. Auto Pattern-Interrupt Transitions + SFX',
    shortLabel: '6. Transitions + SFX',
    badge: 'Visual Reset',
    desc: 'Inserts whip-pan, zoom-snap flash, and slide-wipe transitions between slides with synced whoosh & pop SFX.',
  },
  {
    id: 'cinemaHandheld',
    num: 7,
    icon: '🎥',
    label: '7. 3D Handheld Cinema Rig & Perspective Tilt',
    shortLabel: '7. 3D Handheld Tilt',
    badge: 'Modern Motion',
    desc: 'Adds organic figure-8 handheld camera float, smooth micro-rotation tilt (±1.3°), and live lens depth breathing.',
  },
  {
    id: 'spotlightFocus',
    num: 8,
    icon: '🔦',
    label: '8. Dynamic Spotlight Focus & Studio Vignette',
    shortLabel: '8. Spotlight Focus',
    badge: 'Vox Documentary',
    desc: 'Moving studio spotlight that tracks across the slide and tightens onto the subject on key words with a soft vignette.',
  },
  {
    id: 'doodleStrokes',
    num: 9,
    icon: '✍️',
    label: '9. Auto Hand-Drawn Circle, Arrow & Sketch Callouts',
    shortLabel: '9. Sketch Circle & Arrow',
    badge: 'Animated Ink',
    desc: 'Automatically draws animated red/gold circles, curved pointer arrows, and highlighter strokes around key action.',
  },
  {
    id: 'actionBurst',
    num: 10,
    icon: '💥',
    label: '10. Kinetic Speed-Lines, Impact Shake & Focus HUD',
    shortLabel: '10. Speed-Lines & Shake',
    badge: 'High Energy',
    desc: 'Triggers radial comic speed-lines, a crisp camera impact micro-shake, and lock-on HUD brackets on emphasis words.',
  },
  {
    id: 'bentoDepth',
    num: 11,
    icon: '🖼️',
    label: '11. Floating 3D Bento Card & Blurred Motion Backdrop',
    shortLabel: '11. 3D Bento Frame',
    badge: 'Ali Abdaal Look',
    desc: 'Transforms slides into a floating 3D rounded glass card over a live blurred motion backdrop with deep shadow.',
  },
  {
    id: 'kineticRibbon',
    num: 12,
    icon: '🎞️',
    label: '12. Kinetic Split-Mask Key-Phrase Ribbon',
    shortLabel: '12. Kinetic Text Ribbon',
    badge: 'Modern Type',
    desc: 'Slides in a sleek modern kinetic typography ribbon with an animated neon accent bar for each slide’s core phrase.',
  },
];

export const DEFAULT_RETENTION_GRAPHICS = {
  punchZoom: false,
  statCallouts: false,
  iconPops: false,
  livingFrame: false,
  progressPill: false,
  patternInterrupts: false,
  cinemaHandheld: false,
  spotlightFocus: false,
  doodleStrokes: false,
  actionBurst: false,
  bentoDepth: false,
  kineticRibbon: false,
};

export const ALL_RETENTION_GRAPHICS = {
  punchZoom: true,
  statCallouts: true,
  iconPops: true,
  livingFrame: true,
  progressPill: true,
  patternInterrupts: true,
  cinemaHandheld: true,
  spotlightFocus: true,
  doodleStrokes: true,
  actionBurst: true,
  bentoDepth: true,
  kineticRibbon: true,
};

export function normalizeRetentionGraphics(rg) {
  if (!rg || typeof rg !== 'object') return { ...DEFAULT_RETENTION_GRAPHICS };
  return {
    punchZoom: Boolean(rg.punchZoom),
    statCallouts: Boolean(rg.statCallouts),
    iconPops: Boolean(rg.iconPops),
    livingFrame: Boolean(rg.livingFrame),
    progressPill: Boolean(rg.progressPill),
    patternInterrupts: Boolean(rg.patternInterrupts),
    cinemaHandheld: Boolean(rg.cinemaHandheld),
    spotlightFocus: Boolean(rg.spotlightFocus),
    doodleStrokes: Boolean(rg.doodleStrokes),
    actionBurst: Boolean(rg.actionBurst),
    bentoDepth: Boolean(rg.bentoDepth),
    kineticRibbon: Boolean(rg.kineticRibbon),
  };
}

export function countEnabledRetentionGraphics(rg) {
  if (!rg) return 0;
  return RETENTION_GRAPHIC_OPTIONS.reduce((n, opt) => n + (rg[opt.id] ? 1 : 0), 0);
}

export function areAllRetentionGraphicsEnabled(rg) {
  return countEnabledRetentionGraphics(rg) === RETENTION_GRAPHIC_OPTIONS.length;
}

// ─── Keyword & Stat Detection Dictionaries ────────────────────────────────────

const ICON_KEYWORD_RULES = [
  { re: /^(heart|hearts|cardiac|pulse|beat|artery|arteries|vein|veins|circulation)$/i, icon: '❤️' },
  { re: /^(blood|pressure|hypertension|doctor|doctors|medical|medicine|clinic|hospital|symptom|symptoms|health|healthy|patient|cure|treat|treatment)$/i, icon: '🩺' },
  { re: /^(brain|mind|mental|stroke|memory|focus|think|thinking|neuro|head|stress|anxiety)$/i, icon: '🧠' },
  { re: /^(warn|warning|danger|dangerous|risk|risky|silent|alert|critical|emergency|deadly|fatal|toxic|damage|harm|fail|failure)$/i, icon: '⚠️' },
  { re: /^(money|cash|dollar|dollars|price|cost|wealth|rich|income|profit|finance|financial|bank|invest|saving|savings|pay)$/i, icon: '💰' },
  { re: /^(time|minute|minutes|hour|hours|second|seconds|day|days|daily|fast|quick|wait|clock|early|late|schedule)$/i, icon: '⏱️' },
  { re: /^(check|checked|normal|safe|protect|protection|shield|good|great|success|proven|true|correct|right|healthy)$/i, icon: '✅' },
  { re: /^(power|powerful|energy|boost|impact|action|force|shock|shocking|electric|instant)$/i, icon: '⚡' },
  { re: /^(food|eat|eating|diet|nutrition|meal|salt|sodium|sugar|water|drink|fruit|vegetable|vitamin)$/i, icon: '🥗' },
  { re: /^(sleep|sleeping|rest|tired|fatigue|night|wake|dream|insomnia)$/i, icon: '😴' },
  { re: /^(grow|growth|increase|increasing|high|higher|rise|rising|up|double|triple|more|gain|peak)$/i, icon: '📈' },
  { re: /^(drop|low|lower|reduce|reducing|down|fall|falling|less|loss|cut)$/i, icon: '📉' },
  { re: /^(secret|secrets|hidden|unlock|key|mystery|unknown|private)$/i, icon: '🔓' },
  { re: /^(idea|ideas|tip|tips|learn|know|fact|facts|smart|wisdom|truth|reason|why)$/i, icon: '💡' },
  { re: /^(fire|burn|burning|hot|viral|inflammation|calorie|calories)$/i, icon: '🔥' },
  { re: /^(star|best|top|number|winner|award|champion|perfect|ultimate)$/i, icon: '⭐' },
  { re: /^(stop|never|avoid|dont|no|wrong|mistake|bad|quit)$/i, icon: '🛑' },
  { re: /^(eye|eyes|see|look|watch|vision|visible|sign|signs)$/i, icon: '👀' },
  { re: /^(body|human|people|person|adult|adults|men|women|life|living)$/i, icon: '🧍' },
];

const EMPHASIS_WORDS = new Set([
  'never', 'always', 'warning', 'danger', 'critical', 'secret', 'shocking',
  'proven', 'instant', 'immediately', 'stop', 'important', 'essential',
  'massive', 'million', 'billion', 'percent', 'double', 'triple', 'zero',
  'nobody', 'everyone', 'mistake', 'deadly', 'silent', 'urgent', 'truth',
  'high', 'pressure', 'risk', 'protect', 'first', 'best', 'worst', 'why',
]);

function cleanToken(w) {
  return String(w || '').replace(/^[^a-zA-Z0-9%#]+|[^a-zA-Z0-9%]+$/g, '');
}

function matchWordIcon(rawWord) {
  const cleaned = cleanToken(rawWord).toLowerCase();
  if (!cleaned) return null;
  for (const rule of ICON_KEYWORD_RULES) {
    if (rule.re.test(cleaned)) return rule.icon;
  }
  return null;
}

function isEmphasisToken(rawWord) {
  const str = String(rawWord || '').trim();
  if (!str) return false;
  if (/\d/.test(str) || /[%#!]/.test(str)) return true;
  const cleaned = cleanToken(str).toLowerCase();
  return EMPHASIS_WORDS.has(cleaned);
}

// Builds timed words for a slide [slideStart, slideEnd], using Whisper words if available
// or proportional synthetic timing from slideText.
function getSlideTimedWords({ words = [], slideText = '', slideStart = 0, slideEnd = 0, slideIndex = 0 }) {
  const dur = Math.max(0.4, slideEnd > slideStart ? slideEnd - slideStart : 3.0);
  let list = [];

  if (Array.isArray(words) && words.length > 0) {
    const inRange = words.filter(
      (w) => w && typeof w.start === 'number' && w.start >= slideStart - 0.15 && w.start < slideEnd + 0.15
    );
    if (inRange.length > 0) {
      list = inRange.map((w) => ({
        text: String(w.text || '').trim(),
        start: w.start,
        end: Math.max(w.end ?? w.start + 0.2, w.start + 0.08),
      }));
    }
  }

  if (list.length === 0 && slideText && String(slideText).trim()) {
    const rawTokens = String(slideText).trim().split(/\s+/).filter(Boolean);
    const weights = rawTokens.map((w) => Math.max(2, w.length) + (/[,.;!?]$/.test(w) ? 2.2 : 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = slideStart;
    list = rawTokens.map((text, idx) => {
      const span = (weights[idx] / totalWeight) * (dur * 0.95);
      const start = cursor;
      const end = cursor + Math.max(0.08, span);
      cursor = end;
      return { text, start, end };
    });
  }

  // Annotate emphasis, icons, and stats
  let hasIcon = false;
  let hasEmphasis = false;
  let statAssigned = false;

  const annotated = list.map((w, idx) => {
    const icon = matchWordIcon(w.text);
    const emphasis = isEmphasisToken(w.text);
    if (icon) hasIcon = true;
    if (emphasis) hasEmphasis = true;

    let stat = null;
    const token = cleanToken(w.text);
    if (!statAssigned && /\d/.test(token)) {
      statAssigned = true;
      const numMatch = token.match(/(\d+(?:\.\d+)?)/);
      const numVal = numMatch ? parseFloat(numMatch[1]) : 75;
      const isPct = token.includes('%') || /^percent/i.test(cleanToken(list[idx + 1]?.text || ''));
      const displayVal = isPct && !token.includes('%') ? `${token}%` : token.toUpperCase();
      const nextWords = list
        .slice(idx + 1, idx + 4)
        .map((x) => cleanToken(x.text))
        .filter(Boolean)
        .join(' ')
        .toUpperCase();
      stat = {
        display: displayVal,
        numVal,
        isPct,
        gaugeRatio: isPct ? Math.min(1, Math.max(0.15, numVal / 100)) : 0.78,
        subtitle: nextWords || `SLIDE #${slideIndex + 1} METRIC`,
      };
    }

    return { ...w, idx, icon, emphasis, stat };
  });

  // Fallback guarantees so enabled options always visibly activate on every slide
  if (annotated.length > 0) {
    if (!hasEmphasis) {
      const mid = Math.min(annotated.length - 1, Math.max(1, Math.floor(annotated.length * 0.35)));
      annotated[mid].emphasis = true;
    }
    if (!hasIcon) {
      const fallbackIcons = ['💡', '⚡', '🎯', '🔥', '✨', '📌'];
      const targetIdx = Math.min(annotated.length - 1, Math.max(0, Math.floor(annotated.length * 0.4)));
      annotated[targetIdx].icon = fallbackIcons[slideIndex % fallbackIcons.length];
    }
    if (!statAssigned) {
      // Pick the longest meaningful keyword in the slide for a Key Insight callout card
      let bestIdx = Math.min(annotated.length - 1, Math.floor(annotated.length * 0.25));
      let bestLen = 0;
      annotated.forEach((w, i) => {
        const c = cleanToken(w.text);
        if (c.length > bestLen) {
          bestLen = c.length;
          bestIdx = i;
        }
      });
      const keyword = cleanToken(annotated[bestIdx].text).toUpperCase().slice(0, 10) || `POINT #${slideIndex + 1}`;
      annotated[bestIdx].stat = {
        display: `#${slideIndex + 1}`,
        numVal: slideIndex + 1,
        isPct: false,
        gaugeRatio: Math.min(1, ((slideIndex % 5) + 1) / 5),
        subtitle: `KEY FOCUS: ${keyword}`,
      };
    }
  }

  return annotated;
}

// ─── Easing & Drawing Helpers ─────────────────────────────────────────────────

function easeOutCubic(t) {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function easeOutBack(t) {
  const c = Math.max(0, Math.min(1, t));
  const s = 1.70158;
  const p = c - 1;
  return p * p * ((s + 1) * p + s) + 1;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// Deterministic particle pool for Option 4 (Living Frame)
const PARTICLES = Array.from({ length: 28 }, (_, i) => ({
  nx: ((i * 73 + 19) % 100) / 100,
  ny: ((i * 47 + 31) % 100) / 100,
  r: 2.2 + (i % 4) * 1.4,
  vx: (i % 2 === 0 ? 1 : -1) * (0.015 + (i % 5) * 0.004),
  vy: -(0.025 + (i % 6) * 0.006),
  color: i % 3 === 0 ? '#38bdf8' : i % 3 === 1 ? '#fde047' : '#2dd4bf',
}));

/**
 * Computes camera motion for Options 1 (`punchZoom`), 7 (`cinemaHandheld`), and 10 (`actionBurst`).
 * Returns { scaleMultiplier, dxOffset, dyOffset, rotationRad, activePunchProgress }
 */
export function computeRetentionCameraTransform({
  retentionGraphics,
  time,
  slideStart,
  slideEnd,
  slideIndex = 0,
  width,
  height,
  words = [],
  slideText = '',
}) {
  if (
    !retentionGraphics?.punchZoom &&
    !retentionGraphics?.cinemaHandheld &&
    !retentionGraphics?.actionBurst
  ) {
    return {
      scaleMultiplier: 1.0,
      dxOffset: 0,
      dyOffset: 0,
      rotationRad: 0,
      activePunchProgress: 0,
    };
  }

  const dur = Math.max(0.5, slideEnd - slideStart);
  const elapsed = Math.max(0, time - slideStart);
  const p = Math.min(1, elapsed / dur);
  const dir = slideIndex % 2 === 0 ? 1 : -1;

  let scaleMultiplier = 1.0;
  let dxOffset = 0;
  let dyOffset = 0;
  let rotationRad = 0;

  // Option 1: Continuous Ken Burns glide
  if (retentionGraphics.punchZoom) {
    scaleMultiplier = Math.max(scaleMultiplier, 1.035 + 0.035 * Math.sin(p * Math.PI));
    dxOffset += dir * Math.sin(elapsed * 0.65) * (width * 0.014);
    dyOffset += Math.cos(elapsed * 0.55) * (height * 0.01);
  }

  // Option 7: 3D Handheld Cinema Rig (organic figure-8 sway + smooth rotation roll)
  if (retentionGraphics.cinemaHandheld) {
    scaleMultiplier = Math.max(
      scaleMultiplier,
      1.055 + 0.022 * Math.sin(time * 1.4 + slideIndex)
    );
    dxOffset += Math.sin(time * 1.7 + slideIndex * 1.3) * (width * 0.016);
    dyOffset += Math.sin(time * 3.4 + slideIndex * 0.7) * (height * 0.011);
    rotationRad += dir * Math.sin(time * 1.35 + slideIndex * 0.9) * 0.022; // ~±1.25 deg
  }

  // Check if an emphasis word is currently being spoken for Punch-Zoom & Action Burst Shake
  const timedWords = getSlideTimedWords({ words, slideText, slideStart, slideEnd, slideIndex });
  let activePunchProgress = 0;

  for (const w of timedWords) {
    if (!w.emphasis) continue;
    const wDur = Math.max(0.28, Math.min(0.65, w.end - w.start + 0.18));
    const wEl = time - w.start;
    if (wEl >= 0 && wEl <= wDur) {
      const wp = wEl / wDur;
      const bump = Math.sin(wp * Math.PI);
      if (retentionGraphics.punchZoom) {
        scaleMultiplier += 0.085 * bump;
      }
      activePunchProgress = Math.max(activePunchProgress, wp);

      // Option 10: Crisp camera impact micro-shake during the first 0.22s of emphasis
      if (retentionGraphics.actionBurst && wEl <= 0.22) {
        const decay = 1 - wEl / 0.22;
        dxOffset += Math.sin(time * 95) * width * 0.009 * decay;
        dyOffset += Math.cos(time * 110) * height * 0.009 * decay;
        scaleMultiplier = Math.max(scaleMultiplier, 1.045);
      }
    }
  }

  return { scaleMultiplier, dxOffset, dyOffset, rotationRad, activePunchProgress };
}

/**
 * Option 11: Floating 3D Bento Card & Blurred Motion Backdrop (`bentoDepth`).
 * Renders the slide image over a live blurred/darkened motion backdrop inside a
 * floating 3D rounded glass card with glowing border and deep drop shadow.
 */
export function drawBentoDepthSlide({
  ctx,
  img,
  slideIndex = 0,
  slides = [],
  time = 0,
  width,
  height,
  dx = 0,
  dy = 0,
  rotationRad = 0,
  scale = 1.0,
  alpha = 1.0,
  filterStr = 'none',
}) {
  const sl = slides[slideIndex];
  const scaleUnit = Math.min(width, height) / 720;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  // 1. Animated blurred & darkened motion backdrop filling 100% of screen resolution
  ctx.save();
  const bgScale = 1.18 + 0.04 * Math.sin(time * 0.9);
  const bgDx = Math.cos(time * 0.7) * width * 0.025;
  const bgDy = Math.sin(time * 0.6) * height * 0.02;
  ctx.translate(width / 2 + bgDx, height / 2 + bgDy);
  ctx.scale(bgScale, bgScale);
  if (img && img.naturalWidth && img.naturalHeight) {
    ctx.filter = `${filterStr !== 'none' ? filterStr + ' ' : ''}blur(${Math.round(18 * scaleUnit)}px) brightness(0.42) saturate(1.35)`;
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = '#090f1d';
    ctx.fillRect(-width / 2, -height / 2, width, height);
  }
  ctx.restore();

  // Subtle ambient radial glow behind the floating 3D Bento card
  ctx.save();
  const glowGrad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.08,
    width / 2,
    height / 2,
    width * 0.58
  );
  glowGrad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
  glowGrad.addColorStop(0.6, 'rgba(20, 184, 166, 0.08)');
  glowGrad.addColorStop(1, 'rgba(2, 6, 23, 0.55)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // 2. Floating 3D Bento Card container (smooth hover float + micro-tilt)
  const floatY = Math.sin(time * 2.1 + slideIndex) * (8 * scaleUnit);
  const floatRot = rotationRad + Math.sin(time * 1.3 + slideIndex) * 0.01;
  const cardW = Math.round(width * 0.88);
  const cardH = Math.round(height * 0.86);
  const radius = Math.round(24 * scaleUnit);

  ctx.save();
  ctx.translate(width / 2 + dx * 0.45, height / 2 + dy * 0.45 + floatY);
  ctx.rotate(floatRot);

  // Deep 3D elevation shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 42 * scaleUnit;
  ctx.shadowOffsetY = 18 * scaleUnit;
  ctx.fillStyle = '#0f172a';
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, radius);
  ctx.fill();
  ctx.restore();

  // Clip inside rounded Bento card and draw the animated slide
  ctx.save();
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, radius);
  ctx.clip();

  const innerScale = Math.max(1.0, (scale - 1) * 0.65 + 1.02);
  ctx.scale(innerScale, innerScale);
  ctx.filter = filterStr;
  if (img && img.naturalWidth && img.naturalHeight) {
    ctx.drawImage(img, -cardW / 2, -cardH / 2, cardW, cardH);
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Slide ${sl ? sl.id : slideIndex + 1}`, 0, 0);
  }
  ctx.restore();

  // Glowing glass rim border around the 3D Bento Card
  const rimGrad = ctx.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
  rimGrad.addColorStop(0, 'rgba(56, 189, 248, 0.85)');
  rimGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
  rimGrad.addColorStop(1, 'rgba(45, 212, 191, 0.85)');
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = Math.max(2, 3 * scaleUnit);
  roundRect(ctx, -cardW / 2, -cardH / 2, cardW, cardH, radius);
  ctx.stroke();

  ctx.restore();
  ctx.restore();
}

/**
 * 6. Renders Pattern-Interrupt Slide Transition when `patternInterrupts` is enabled
 * during the first 0.42s of a new slide (activeIndex > 0).
 * Returns true if it handled drawing the slide image transition.
 */
export function drawPatternInterruptSlideTransition({
  ctx,
  retentionGraphics,
  activeIndex,
  time,
  slideStart,
  width,
  height,
  prevImg,
  activeImg,
  drawSingleSlideFn,
}) {
  if (!retentionGraphics?.patternInterrupts || activeIndex <= 0) return false;
  const transDur = 0.42;
  const elapsed = time - slideStart;
  if (elapsed < 0 || elapsed >= transDur) return false;

  const p = easeOutCubic(elapsed / transDur);
  const mode = activeIndex % 3; // Rotate between 3 high-retention pattern interrupts

  if (mode === 0) {
    // Pattern Interrupt A: Whip-Pan Slide Cut + Cyan Energy Flash
    ctx.save();
    ctx.translate(-width * p, 0);
    drawSingleSlideFn(prevImg, activeIndex - 1);
    ctx.restore();

    ctx.save();
    ctx.translate(width * (1 - p), 0);
    drawSingleSlideFn(activeImg, activeIndex);
    ctx.restore();

    const flash = Math.sin((elapsed / transDur) * Math.PI) * 0.42;
    ctx.save();
    ctx.fillStyle = `rgba(56, 189, 248, ${flash.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else if (mode === 1) {
    // Pattern Interrupt B: Zoom-Snap Impact Cut + Golden Flash
    ctx.save();
    ctx.globalAlpha = 1 - p;
    drawSingleSlideFn(prevImg, activeIndex - 1);
    ctx.restore();

    ctx.save();
    const z = 1.18 - 0.18 * p;
    ctx.globalAlpha = p;
    ctx.translate(width / 2, height / 2);
    ctx.scale(z, z);
    ctx.translate(-width / 2, -height / 2);
    drawSingleSlideFn(activeImg, activeIndex);
    ctx.restore();

    const flash = Math.sin((elapsed / transDur) * Math.PI) * 0.38;
    ctx.save();
    ctx.fillStyle = `rgba(253, 224, 71, ${flash.toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else {
    // Pattern Interrupt C: Diagonal Split Wipe + Glowing Seam
    drawSingleSlideFn(prevImg, activeIndex - 1);

    ctx.save();
    const sweep = (width + height * 0.4) * p;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(sweep, 0);
    ctx.lineTo(sweep - height * 0.35, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.clip();
    drawSingleSlideFn(activeImg, activeIndex);
    ctx.restore();

    // Glowing diagonal laser seam
    ctx.save();
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.85)';
    ctx.lineWidth = Math.max(4, width * 0.005);
    ctx.shadowColor = '#2dd4bf';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(sweep, 0);
    ctx.lineTo(sweep - height * 0.35, height);
    ctx.stroke();
    ctx.restore();
  }

  return true;
}

/**
 * Draws all enabled foreground Auto-Retention Graphic overlays (Options 1–5):
 *  - Option 1: Punch-Zoom shockwave ring
 *  - Option 2: Auto Stat, Number & Keyword Callout Card
 *  - Option 3: Auto Contextual Icon / Emoji Pop-Ins
 *  - Option 4: Living Frame (Particles, Light Sweep & Audio-Reactive Voice Equalizer)
 *  - Option 5: Auto Retention Progress Bar & Topic Pill
 */
export function drawRetentionGraphicOverlays(
  ctx,
  {
    retentionGraphics,
    width,
    height,
    time,
    duration = 1,
    rows = [],
    slides = [],
    activeIndex = 0,
    slideStart = 0,
    slideEnd = 0,
    words = [],
    isVertical = false,
    activePunchProgress = 0,
  }
) {
  if (!retentionGraphics || !countEnabledRetentionGraphics(retentionGraphics)) return;

  const activeSlide = slides[activeIndex];
  const slideText = activeSlide?.text || '';
  const timedWords = getSlideTimedWords({
    words,
    slideText,
    slideStart,
    slideEnd,
    slideIndex: activeIndex,
  });

  const scaleUnit = Math.min(width, height) / 720;

  // ── Option 1: Punch-Zoom Radial Shockwave Ring ─────────────────────────────
  if (retentionGraphics.punchZoom && activePunchProgress > 0 && activePunchProgress < 0.75) {
    const rp = activePunchProgress / 0.75;
    ctx.save();
    ctx.strokeStyle = `rgba(250, 204, 21, ${((1 - rp) * 0.55).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, 5 * (1 - rp) * scaleUnit);
    ctx.beginPath();
    ctx.arc(
      width / 2,
      height * 0.45,
      (70 + rp * 260) * scaleUnit,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }

  // ── Option 4: Living Frame (Particles, Light Sweep & Voice Equalizer) ──────
  if (retentionGraphics.livingFrame) {
    ctx.save();
    // Soft moving cinematic light sweep
    const sweepX = ((time * width * 0.22) % (width * 1.4)) - width * 0.2;
    const sweepW = width * 0.22;
    const sweepGrad = ctx.createLinearGradient(sweepX - sweepW, 0, sweepX + sweepW, height);
    sweepGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sweepGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.10)');
    sweepGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(0, 0, width, height);

    // Floating glowing bokeh / energy particles
    for (const pt of PARTICLES) {
      const px = ((pt.nx + time * pt.vx) % 1 + 1) % 1 * width;
      const py = ((pt.ny + time * pt.vy) % 1 + 1) % 1 * height;
      const radius = pt.r * scaleUnit * (isVertical ? 1.15 : 1);
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 2.8 + pt.nx * 10);
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 8 * scaleUnit;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Audio-Reactive Voice Equalizer Pill (top-right)
    ctx.save();
    const pillW = Math.round(126 * scaleUnit);
    const pillH = Math.round(34 * scaleUnit);
    const pillX = width - pillW - Math.round(20 * scaleUnit);
    const pillY = Math.round((retentionGraphics.progressPill ? 24 : 18) * scaleUnit);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12 * scaleUnit;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.55)';
    ctx.lineWidth = Math.max(1.5, 1.8 * scaleUnit);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const bars = 9;
    const barGap = (pillW - 28 * scaleUnit) / bars;
    const barW = Math.max(3, Math.round(4.5 * scaleUnit));
    for (let b = 0; b < bars; b++) {
      const wave = Math.abs(Math.sin(time * 11.5 + b * 0.85)) * Math.cos(time * 4.2 - b * 0.4);
      const bh = Math.max(5 * scaleUnit, (6 + Math.abs(wave) * 18) * scaleUnit);
      ctx.fillStyle = b % 2 === 0 ? '#2dd4bf' : '#38bdf8';
      roundRect(
        ctx,
        pillX + 14 * scaleUnit + b * barGap,
        pillY + pillH / 2 - bh / 2,
        barW,
        bh,
        barW / 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Option 2: Auto Stat, Number & Keyword Callout Card ─────────────────────
  if (retentionGraphics.statCallouts && timedWords.length > 0) {
    let activeStatWord = null;
    for (const w of timedWords) {
      if (w.stat && time >= w.start && time <= w.start + 2.6) {
        activeStatWord = w;
      }
    }

    if (activeStatWord && activeStatWord.stat) {
      const st = activeStatWord.stat;
      const el = Math.max(0, time - activeStatWord.start);
      const enterP = easeOutBack(Math.min(1, el / 0.34));
      const fadeOut = el > 2.2 ? Math.max(0, (2.6 - el) / 0.4) : 1;
      const countP = easeOutCubic(Math.min(1, el / 0.75));

      const cardW = Math.round(256 * scaleUnit);
      const cardH = Math.round(88 * scaleUnit);
      const cardX = Math.round(22 * scaleUnit);
      const cardY = Math.round((retentionGraphics.progressPill ? 64 : 24) * scaleUnit);

      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.translate(cardX + cardW / 2, cardY + cardH / 2);
      ctx.scale(0.65 + 0.35 * enterP, 0.65 + 0.35 * enterP);
      ctx.translate(-(cardX + cardW / 2), -(cardY + cardH / 2));

      ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
      ctx.shadowBlur = 20 * scaleUnit;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      roundRect(ctx, cardX, cardY, cardW, cardH, 16 * scaleUnit);
      ctx.fill();

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = Math.max(1.5, 2.2 * scaleUnit);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Circular progress gauge
      const cx = cardX + Math.round(46 * scaleUnit);
      const cy = cardY + Math.round(cardH / 2);
      const r = Math.round(25 * scaleUnit);

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = Math.max(4, 6 * scaleUnit);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = Math.max(4, 6 * scaleUnit);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * st.gaugeRatio * countP);
      ctx.stroke();

      // Stat main value (live counting for numbers/percentages)
      const valFont = Math.round(25 * scaleUnit);
      ctx.fillStyle = '#fde047';
      ctx.font = `900 ${valFont}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const dispVal = st.isPct
        ? `${Math.round(st.numVal * countP)}%`
        : st.display;
      ctx.fillText(dispVal, cardX + Math.round(84 * scaleUnit), cardY + Math.round(35 * scaleUnit));

      // Subtitle label
      const subFont = Math.round(11.5 * scaleUnit);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `700 ${subFont}px system-ui, sans-serif`;
      ctx.fillText(
        st.subtitle.slice(0, 22),
        cardX + Math.round(84 * scaleUnit),
        cardY + Math.round(62 * scaleUnit)
      );
      ctx.restore();
    }
  }

  // ── Option 3: Auto Contextual Icon / Emoji Pop-Ins ─────────────────────────
  if (retentionGraphics.iconPops && timedWords.length > 0) {
    timedWords.forEach((w, idx) => {
      if (!w.icon) return;
      const el = time - w.start;
      const showDur = 1.4;
      if (el < 0 || el > showDur) return;

      const popP = easeOutBack(Math.min(1, el / 0.28));
      const fadeOut = el > showDur - 0.35 ? Math.max(0, (showDur - el) / 0.35) : 1;

      const badgeR = Math.round(32 * scaleUnit);
      const posX =
        idx % 2 === 0
          ? width - Math.round(92 * scaleUnit)
          : width - Math.round(176 * scaleUnit);
      const basePosY = Math.round((115 + (idx % 3) * 38) * scaleUnit);
      const posY = basePosY - el * 18 * scaleUnit;

      ctx.save();
      ctx.globalAlpha = fadeOut;
      ctx.translate(posX, posY);
      ctx.scale(popP, popP);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 16 * scaleUnit;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, badgeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = Math.max(2, 2.6 * scaleUnit);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.font = `${Math.round(31 * scaleUnit)}px system-ui, "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(w.icon, 0, Math.round(2 * scaleUnit));
      ctx.restore();
    });
  }

  // ── Option 5: Auto Retention Progress Bar & Topic Pill ─────────────────────
  if (retentionGraphics.progressPill) {
    ctx.save();
    const barH = Math.max(6, Math.round(8 * scaleUnit));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(0, 0, width, barH);

    const prog = Math.max(0, Math.min(1, time / Math.max(0.1, duration)));
    const pGrad = ctx.createLinearGradient(0, 0, width, 0);
    pGrad.addColorStop(0, '#14b8a6');
    pGrad.addColorStop(0.5, '#38bdf8');
    pGrad.addColorStop(1, '#fde047');
    ctx.fillStyle = pGrad;
    ctx.fillRect(0, 0, width * prog, barH);

    // Chapter marker ticks along the top progress bar
    if (rows && rows.length > 1 && duration > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (let i = 1; i < rows.length; i++) {
        const tx = Math.round((rows[i].start / duration) * width);
        ctx.fillRect(tx - 1, 0, 2, barH + 2);
      }
    }

    // Compact Topic / Slide Indicator Pill in top-left
    const sectionPrefix = rows[activeIndex]?.sectionTitle
      ? `${rows[activeIndex].sectionTitle.toUpperCase()} • `
      : '';
    const topicLabel = `⚡ ${sectionPrefix}SLIDE ${activeIndex + 1} OF ${Math.max(1, rows.length)}`;
    const pillFont = Math.max(11, Math.round(12.5 * scaleUnit));
    ctx.font = `800 ${pillFont}px system-ui, sans-serif`;
    const tw = ctx.measureText(topicLabel).width;
    const pw = tw + Math.round(26 * scaleUnit);
    const ph = Math.round(28 * scaleUnit);
    const px = Math.round(18 * scaleUnit);
    const py = barH + Math.round(10 * scaleUnit);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 10 * scaleUnit;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    roundRect(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = Math.max(1.2, 1.5 * scaleUnit);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(topicLabel, px + Math.round(13 * scaleUnit), py + ph / 2);
    ctx.restore();
  }

  // ── Option 8: Dynamic Spotlight Focus & Studio Vignette (`spotlightFocus`) ─
  if (retentionGraphics.spotlightFocus) {
    ctx.save();
    // Spotlight smoothly glides across the focal area and tightens on emphasis words
    const tighten = activePunchProgress > 0 ? Math.sin(activePunchProgress * Math.PI) * 0.16 : 0;
    const spotX = width * (0.5 + 0.11 * Math.sin(time * 0.95 + activeIndex * 1.2));
    const spotY = height * (0.44 + 0.07 * Math.cos(time * 0.8 + activeIndex * 0.9));
    const innerR = Math.max(width, height) * Math.max(0.14, 0.24 - tighten);
    const outerR = Math.max(width, height) * (0.72 - tighten * 0.3);

    const spotGrad = ctx.createRadialGradient(spotX, spotY, innerR, spotX, spotY, outerR);
    spotGrad.addColorStop(0, 'rgba(255, 250, 220, 0.08)');
    spotGrad.addColorStop(0.45, 'rgba(15, 23, 42, 0.0)');
    spotGrad.addColorStop(1, 'rgba(2, 6, 23, 0.56)');
    ctx.fillStyle = spotGrad;
    ctx.fillRect(0, 0, width, height);

    // Subtle glowing focus ring around spotlight center when emphasis hits
    if (activePunchProgress > 0) {
      const ringAlpha = Math.sin(activePunchProgress * Math.PI) * 0.45;
      ctx.strokeStyle = `rgba(56, 189, 248, ${ringAlpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, 2.5 * scaleUnit);
      ctx.setLineDash([10 * scaleUnit, 8 * scaleUnit]);
      ctx.beginPath();
      ctx.arc(spotX, spotY, innerR * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Option 9: Auto Hand-Drawn Circle, Arrow & Highlighter Strokes (`doodleStrokes`) ─
  if (retentionGraphics.doodleStrokes) {
    const slideEl = Math.max(0, time - slideStart);
    const slideDur = Math.max(0.8, slideEnd - slideStart);

    // 9a. Animated hand-drawn double-loop circle around center focal area
    const circleStart = Math.min(0.35, slideDur * 0.12);
    const circleEnd = Math.min(slideDur - 0.15, circleStart + 2.4);
    if (slideEl >= circleStart && slideEl <= circleEnd) {
      const cp = Math.min(1, (slideEl - circleStart) / 0.55);
      const fade = slideEl > circleEnd - 0.35 ? Math.max(0, (circleEnd - slideEl) / 0.35) : 1;
      const cx = width * (0.5 + (activeIndex % 2 === 0 ? -0.04 : 0.04));
      const cy = height * 0.43;
      const rx = width * 0.17;
      const ry = height * 0.21;

      ctx.save();
      ctx.globalAlpha = fade * 0.92;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(3, 5 * scaleUnit);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(239, 68, 68, 0.35)';
      ctx.shadowBlur = 8 * scaleUnit;

      // Hand-drawn sketchy double loop
      const maxAngle = Math.PI * 2.25 * easeOutCubic(cp);
      ctx.beginPath();
      const steps = 48;
      for (let s = 0; s <= steps; s++) {
        const a = -Math.PI * 0.65 + (maxAngle * s) / steps;
        const wobble = 1 + 0.035 * Math.sin(a * 3 + activeIndex);
        const px = cx + Math.cos(a) * rx * wobble;
        const py = cy + Math.sin(a) * ry * wobble;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 9b. Animated curved sketch pointer arrow (draws in mid-slide or on emphasis)
    const arrowStart = Math.min(0.75, slideDur * 0.25);
    const arrowEnd = Math.min(slideDur - 0.1, arrowStart + 2.3);
    if (slideEl >= arrowStart && slideEl <= arrowEnd) {
      const ap = easeOutCubic(Math.min(1, (slideEl - arrowStart) / 0.45));
      const fade = slideEl > arrowEnd - 0.35 ? Math.max(0, (arrowEnd - slideEl) / 0.35) : 1;
      const fromLeft = activeIndex % 2 === 0;
      const startX = fromLeft ? width * 0.18 : width * 0.82;
      const startY = height * 0.26;
      const ctrlX = fromLeft ? width * 0.28 : width * 0.72;
      const ctrlY = height * 0.16;
      const endX = fromLeft ? width * 0.38 : width * 0.62;
      const endY = height * 0.34;

      ctx.save();
      ctx.globalAlpha = fade * 0.95;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(3.5, 5.5 * scaleUnit);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 8 * scaleUnit;

      ctx.beginPath();
      const segs = 28;
      let tipX = startX;
      let tipY = startY;
      let prevX = startX;
      let prevY = startY;
      for (let i = 0; i <= segs; i++) {
        const t = (i / segs) * ap;
        const inv = 1 - t;
        const x = inv * inv * startX + 2 * inv * t * ctrlX + t * t * endX;
        const y = inv * inv * startY + 2 * inv * t * ctrlY + t * t * endY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (i === segs - 2) {
          prevX = x;
          prevY = y;
        }
        tipX = x;
        tipY = y;
      }
      ctx.stroke();

      // Arrowhead wings once curve reaches >65%
      if (ap > 0.65) {
        const headP = Math.min(1, (ap - 0.65) / 0.35);
        const angle = Math.atan2(tipY - prevY, tipX - prevX);
        const headLen = 18 * scaleUnit * headP;
        ctx.beginPath();
        ctx.moveTo(
          tipX - headLen * Math.cos(angle - 0.55),
          tipY - headLen * Math.sin(angle - 0.55)
        );
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(
          tipX - headLen * Math.cos(angle + 0.55),
          tipY - headLen * Math.sin(angle + 0.55)
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── Option 10: Kinetic Speed-Lines, Impact Shake & Focus HUD (`actionBurst`) ─
  if (retentionGraphics.actionBurst) {
    const slideEl = Math.max(0, time - slideStart);
    const introBurst = slideEl < 0.48 ? 1 - slideEl / 0.48 : 0;
    const empBurst = activePunchProgress > 0 ? Math.sin(activePunchProgress * Math.PI) : 0;
    const burstIntensity = Math.max(introBurst, empBurst);

    if (burstIntensity > 0.04) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, burstIntensity * 0.78);
      const cx = width / 2;
      const cy = height * 0.46;
      const maxDiag = Math.hypot(width, height) * 0.62;
      const innerClear = Math.min(width, height) * 0.36;

      // Radial high-energy speed-lines around perimeter
      const lineCount = 36;
      for (let i = 0; i < lineCount; i++) {
        const angle = (i / lineCount) * Math.PI * 2 + Math.floor(time * 18) * 0.09;
        const seed = Math.sin(i * 19.7 + Math.floor(time * 16));
        const rStart = innerClear * (0.92 + 0.18 * Math.abs(seed));
        const rEnd = maxDiag;

        ctx.strokeStyle = i % 3 === 0 ? '#fde047' : 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = (i % 4 === 0 ? 3.2 : 1.8) * scaleUnit;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rStart, cy + Math.sin(angle) * rStart);
        ctx.lineTo(cx + Math.cos(angle) * rEnd, cy + Math.sin(angle) * rEnd);
        ctx.stroke();
      }

      // Lock-on HUD Corner Focus Brackets
      const insetX = width * (0.14 + (1 - burstIntensity) * 0.03);
      const insetY = height * (0.14 + (1 - burstIntensity) * 0.03);
      const boxW = width - insetX * 2;
      const boxH = height * 0.68 - insetY;
      const arm = Math.round(26 * scaleUnit);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = Math.max(2.5, 3.5 * scaleUnit);
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10 * scaleUnit;

      ctx.beginPath();
      // Top-left bracket
      ctx.moveTo(insetX, insetY + arm);
      ctx.lineTo(insetX, insetY);
      ctx.lineTo(insetX + arm, insetY);
      // Top-right bracket
      ctx.moveTo(insetX + boxW - arm, insetY);
      ctx.lineTo(insetX + boxW, insetY);
      ctx.lineTo(insetX + boxW, insetY + arm);
      // Bottom-left bracket
      ctx.moveTo(insetX, insetY + boxH - arm);
      ctx.lineTo(insetX, insetY + boxH);
      ctx.lineTo(insetX + arm, insetY + boxH);
      // Bottom-right bracket
      ctx.moveTo(insetX + boxW - arm, insetY + boxH);
      ctx.lineTo(insetX + boxW, insetY + boxH);
      ctx.lineTo(insetX + boxW, insetY + boxH - arm);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Option 12: Kinetic Split-Mask Key-Phrase Ribbon (`kineticRibbon`) ──────
  if (retentionGraphics.kineticRibbon && timedWords.length > 0) {
    const slideEl = Math.max(0, time - slideStart);
    const slideDur = Math.max(0.8, slideEnd - slideStart);
    const ribStart = Math.min(0.25, slideDur * 0.08);
    const ribEnd = Math.min(slideDur - 0.15, ribStart + 2.5);

    if (slideEl >= ribStart && slideEl <= ribEnd) {
      const enterP = easeOutCubic(Math.min(1, (slideEl - ribStart) / 0.38));
      const exitP = slideEl > ribEnd - 0.35 ? Math.max(0, (ribEnd - slideEl) / 0.35) : 1;
      const visP = Math.min(enterP, exitP);

      // Extract punchiest 2-3 word key phrase from the slide
      const focusIdx = Math.max(
        0,
        timedWords.findIndex((w) => w.emphasis)
      );
      const phraseTokens = timedWords
        .slice(focusIdx, focusIdx + 3)
        .map((w) => cleanToken(w.text))
        .filter(Boolean);
      const ribbonText = (phraseTokens.join(' ') || `SLIDE ${activeIndex + 1}`).toUpperCase();

      const fontSz = Math.round(20 * scaleUnit);
      ctx.save();
      ctx.font = `900 ${fontSz}px system-ui, -apple-system, sans-serif`;
      const textW = ctx.measureText(ribbonText).width;
      const rW = Math.round(textW + 42 * scaleUnit);
      const rH = Math.round(40 * scaleUnit);
      const rX = width - rW - Math.round(22 * scaleUnit);
      const rY = Math.round((retentionGraphics.livingFrame ? 64 : 22) * scaleUnit);

      // Clip mask for smooth kinetic slide-in reveal
      ctx.beginPath();
      ctx.rect(rX, rY, rW * visP, rH);
      ctx.clip();

      ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
      ctx.shadowBlur = 16 * scaleUnit;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      roundRect(ctx, rX, rY, rW, rH, 10 * scaleUnit);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Left neon accent bar
      const barGrad = ctx.createLinearGradient(rX, rY, rX, rY + rH);
      barGrad.addColorStop(0, '#f59e0b');
      barGrad.addColorStop(1, '#ec4899');
      ctx.fillStyle = barGrad;
      ctx.fillRect(rX, rY, Math.round(7 * scaleUnit), rH);

      // Kinetic phrase text
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        ribbonText,
        rX + Math.round(18 * scaleUnit) - (1 - enterP) * 24 * scaleUnit,
        rY + rH / 2
      );
      ctx.restore();
    }
  }
}
