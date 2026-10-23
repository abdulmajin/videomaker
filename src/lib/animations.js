// Canva-style Slide Animation System
// Professional entry-only animations: No exit transitions, No movement after enter.
// Skip animations if timestamp duration <= 2.5s.

export const ANIMATION_TYPES = [
  { id: 'random', label: '🎲 Random (Subtle Entry Mix)' },
  { id: 'zoom-in', label: '🔍 Subtle Zoom In' },
  { id: 'zoom-out', label: '🔎 Soft Zoom Settle' },
  { id: 'pop', label: '✨ Pop & Settle' },
  { id: 'breathe', label: '🫁 Gentle Ease-In' },
  { id: 'slide-left', label: '⬅️ Slide In Left' },
  { id: 'slide-right', label: '➡️ Slide In Right' },
  { id: 'slide-up', label: '⬆️ Slide In Up' },
  { id: 'fade', label: '🌫️ Smooth Crossfade' },
  { id: 'pan-drift', label: '🌊 Soft Pan Settle' },
  { id: 'none', label: '🚫 Static (No Animation)' },
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
  if (requestedMode === 'none') return 'none';
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
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Computes scale, translation (dx, dy), and opacity for the image at time `time`.
 *
 * RULES APPLIED:
 * 1. If voice timestamp duration <= 2.5s: Skip all animation (static display for professional look).
 * 2. Animate ONLY entry, NO exit: Settle into static resting position (scale 1.0, dx 0, dy 0, opacity 1.0).
 *    No drift or transition between images.
 */
export function computeSlideTransform({
  animType,
  slideStart,
  slideDuration,
  time,
  canvasWidth,
  canvasHeight,
}) {
  const dur = Math.max(0.1, slideDuration);

  // RULE 1: If voice duration <= 2.5s, no animation should be added because it is not professional
  if (dur <= 2.5 || animType === 'none') {
    return { scale: 1.0, dx: 0, dy: 0, opacity: 1.0 };
  }

  const elapsed = Math.max(0, time - slideStart);

  // RULE 2: Animate only entry (first ~0.5s), no exit transition, no ongoing drift
  const enterDur = Math.min(0.55, dur * 0.35); // Clean subtle entrance window

  // Once entrance finishes, remain 100% static until next slide
  if (elapsed >= enterDur) {
    return { scale: 1.0, dx: 0, dy: 0, opacity: 1.0 };
  }

  const p = easeOutCubic(elapsed / enterDur); // 0 to 1 smooth deceleration

  let scale = 1.0;
  let dx = 0;
  let dy = 0;
  let opacity = 1.0;

  switch (animType) {
    case 'zoom-in': {
      // Subtle zoom in entrance from 0.95 to 1.00
      opacity = 0.35 + 0.65 * p;
      scale = 0.95 + 0.05 * p;
      break;
    }

    case 'zoom-out': {
      // Subtle settle from 1.05 down to 1.00
      opacity = 0.35 + 0.65 * p;
      scale = 1.05 - 0.05 * p;
      break;
    }

    case 'pop': {
      // Subtle soft spring to 1.00
      opacity = easeOutQuad(p);
      scale = 0.92 + 0.08 * easeOutBack(p);
      break;
    }

    case 'breathe': {
      // Gentle settle into view
      opacity = 0.4 + 0.6 * p;
      scale = 0.97 + 0.03 * p;
      break;
    }

    case 'slide-left': {
      // Enters from slight right offset and settles into center
      dx = (1 - p) * (canvasWidth * 0.06);
      opacity = 0.2 + 0.8 * p;
      scale = 1.0;
      break;
    }

    case 'slide-right': {
      // Enters from slight left offset and settles into center
      dx = -(1 - p) * (canvasWidth * 0.06);
      opacity = 0.2 + 0.8 * p;
      scale = 1.0;
      break;
    }

    case 'slide-up': {
      // Enters from slight bottom offset and settles into center
      dy = (1 - p) * (canvasHeight * 0.06);
      opacity = 0.2 + 0.8 * p;
      scale = 1.0;
      break;
    }

    case 'fade': {
      // Clean smooth crossfade only
      opacity = 0.2 + 0.8 * p;
      scale = 1.0;
      break;
    }

    case 'pan-drift': {
      // Subtle gentle pan settle into center
      dx = (1 - p) * (canvasWidth * 0.04);
      opacity = 0.3 + 0.7 * p;
      scale = 1.0;
      break;
    }

    default: {
      // Clean subtle fade
      opacity = 0.3 + 0.7 * p;
      scale = 1.0;
    }
  }

  return { scale, dx, dy, opacity };
}
