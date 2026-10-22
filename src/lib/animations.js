// Canva-style Slide Animation System

export const ANIMATION_TYPES = [
  { id: 'random', label: '🎲 Random (Canva Style - Mix of all)' },
  { id: 'zoom-in', label: '🔍 Ken Burns Zoom In' },
  { id: 'zoom-out', label: '🔎 Ken Burns Zoom Out' },
  { id: 'pop', label: '✨ Pop & Bounce' },
  { id: 'breathe', label: '🫁 Breathe (Gentle Pulse)' },
  { id: 'slide-left', label: '⬅️ Slide Left' },
  { id: 'slide-right', label: '➡️ Slide Right' },
  { id: 'slide-up', label: '⬆️ Slide Up' },
  { id: 'fade', label: '🌫️ Smooth Crossfade' },
  { id: 'pan-drift', label: '🌊 Cinematic Pan & Drift' },
];

export const ACTIVE_ANIMATION_KEYS = [
  'zoom-in',
  'zoom-out',
  'pop',
  'breathe',
  'slide-left',
  'slide-right',
  'slide-up',
  'fade',
  'pan-drift',
];

// Resolves effective animation for a given slide
export function getSlideAnimation(requestedMode, slideIndex) {
  if (!requestedMode || requestedMode === 'random') {
    // Deterministic pseudo-random pattern based on slide index
    const idx = (slideIndex * 3 + 1) % ACTIVE_ANIMATION_KEYS.length;
    return ACTIVE_ANIMATION_KEYS[idx];
  }
  return requestedMode;
}

// Easing functions
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

// Computes scale, translation (dx, dy), and opacity for the image at time `time`
export function computeSlideTransform({
  animType,
  slideStart,
  slideDuration,
  time,
  canvasWidth,
  canvasHeight,
}) {
  const dur = Math.max(0.1, slideDuration);
  const elapsed = Math.max(0, time - slideStart);
  const u = Math.min(1, elapsed / dur); // 0 to 1 over slide duration
  const introDur = Math.min(0.65, dur * 0.4); // Intro entrance time
  const introProgress = Math.min(1, elapsed / introDur);

  let scale = 1.0;
  let dx = 0;
  let dy = 0;
  let opacity = 1.0;

  switch (animType) {
    case 'zoom-in': {
      // Zoom in from 1.0 to 1.15 smoothly, with entrance opacity fade
      opacity = 0.2 + 0.8 * easeOutQuad(introProgress);
      scale = 1.0 + 0.15 * u;
      break;
    }

    case 'zoom-out': {
      // Zoom out from 1.20 down to 1.04 smoothly
      opacity = 0.2 + 0.8 * easeOutQuad(introProgress);
      scale = 1.2 - 0.16 * u;
      break;
    }

    case 'pop': {
      // Canva Pop: spring scale from 0.7 to 1.06 to 1.0 in first 0.5s, then subtle breathe
      if (introProgress < 1.0) {
        scale = 0.72 + 0.28 * easeOutBack(introProgress);
        opacity = easeOutQuad(introProgress);
      } else {
        const pulse = Math.sin((elapsed - introDur) * 2.2) * 0.025;
        scale = 1.0 + pulse;
        opacity = 1.0;
      }
      break;
    }

    case 'breathe': {
      // Continuous organic gentle breathing scale (1.0 to 1.07)
      opacity = 0.3 + 0.7 * easeOutQuad(introProgress);
      const wave = (Math.sin(u * Math.PI * 2.5) + 1) / 2; // 0 to 1
      scale = 1.02 + 0.06 * wave;
      break;
    }

    case 'slide-left': {
      // Enters from right edge with smooth deceleration, plus continuous slight drift
      const enterOffset = (1 - easeOutCubic(introProgress)) * (canvasWidth * 0.18);
      dx = enterOffset - u * (canvasWidth * 0.03);
      opacity = 0.1 + 0.9 * easeOutQuad(introProgress);
      scale = 1.05;
      break;
    }

    case 'slide-right': {
      // Enters from left edge with smooth deceleration, plus continuous slight drift
      const enterOffset = -(1 - easeOutCubic(introProgress)) * (canvasWidth * 0.18);
      dx = enterOffset + u * (canvasWidth * 0.03);
      opacity = 0.1 + 0.9 * easeOutQuad(introProgress);
      scale = 1.05;
      break;
    }

    case 'slide-up': {
      // Enters from bottom with smooth spring, plus slow zoom
      const enterOffset = (1 - easeOutCubic(introProgress)) * (canvasHeight * 0.15);
      dy = enterOffset;
      opacity = 0.1 + 0.9 * easeOutQuad(introProgress);
      scale = 1.02 + 0.08 * u;
      break;
    }

    case 'fade': {
      // Gentle crossfade and slight continuous slow zoom
      opacity = 0.1 + 0.9 * easeOutCubic(introProgress);
      scale = 1.03 + 0.06 * u;
      break;
    }

    case 'pan-drift': {
      // Cinematic slow pan left-to-right with Ken Burns scale
      opacity = 0.2 + 0.8 * easeOutQuad(introProgress);
      scale = 1.14;
      dx = (u - 0.5) * (canvasWidth * 0.08);
      dy = Math.sin(u * Math.PI) * (canvasHeight * 0.02);
      break;
    }

    default: {
      scale = 1.0 + 0.08 * u;
      opacity = 0.3 + 0.7 * easeOutQuad(introProgress);
    }
  }

  return { scale, dx, dy, opacity };
}
