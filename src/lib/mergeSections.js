// Stitches Maker sections into one timeline (used by the Maker's "Merge" button
// and by the Studio when it opens a saved .videomaker.json project).

import { mergeAudioFiles } from './audio';
import { mergeWords } from './frameExtras';
import { parseScript } from './parseScript';

export function dataUrlToBlob(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  try {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

export const isReadySection = (s) => !!s.audio && s.rows?.length > 0;

/**
 * Concatenates the voice audio of every ready section and offsets its slides,
 * images, hooks, overlays, grades and word timings. Returns the merged data
 * object the Maker preview / export and the Studio work from.
 */
export async function mergeSections(sections) {
  const readySections = sections.filter(isReadySection);
  if (readySections.length === 0) {
    throw new Error('No section has voice audio and aligned slides yet.');
  }

  const mergedAudioResult = await mergeAudioFiles(readySections.map((s) => s.audio));
  if (!mergedAudioResult) throw new Error('Failed to merge audio files.');

  const rows = [];
  const slides = [];
  const imageUrls = [];
  const slideAnimations = {};
  const textOverlays = {};
  const customTextOverlays = [];
  const slideFilters = {};
  let globalSlideId = 1;
  let timeOffset = 0;

  readySections.forEach((sec, secIdx) => {
    const secSlides = sec.slides?.length ? sec.slides : parseScript(sec.scriptText || '');
    const secImages = sec.effectiveImageUrls || [];

    (sec.customTextOverlays || []).forEach((o, oIdx) => {
      customTextOverlays.push({
        ...o,
        id: `mrg-sec-${secIdx}-${o.id || oIdx}`,
        startTime: Number(((o.startTime ?? 0) + timeOffset).toFixed(2)),
        endTime: Number(((o.endTime ?? 3) + timeOffset).toFixed(2)),
      });
    });

    sec.rows.forEach((row, rowIdx) => {
      const slide = secSlides[rowIdx] || {};
      const hook = sec.textOverlays?.[rowIdx] || '';
      rows.push({
        id: globalSlideId,
        start: row.start + timeOffset,
        text: row.text || slide.text || '',
        sectionIndex: secIdx,
        sectionTitle: sec.title || `Section ${secIdx + 1}`,
      });
      slides.push({
        id: globalSlideId,
        text: slide.text || row.text || '',
        raw: slide.raw || '',
        textOverlay: hook,
        sectionIndex: secIdx,
      });
      imageUrls.push(secImages[rowIdx] || null);
      slideAnimations[globalSlideId - 1] = sec.slideAnimations?.[rowIdx] || 'auto';
      textOverlays[globalSlideId - 1] = hook;
      if (sec.slideFilters?.[rowIdx]) slideFilters[globalSlideId - 1] = sec.slideFilters[rowIdx];
      globalSlideId++;
    });

    timeOffset += sec.duration || 0;
  });

  return {
    audioFile: mergedAudioResult.blob,
    audioUrl: URL.createObjectURL(mergedAudioResult.blob),
    duration: mergedAudioResult.duration,
    rows,
    slides,
    effectiveImageUrls: imageUrls,
    slideAnimations,
    textOverlays,
    customTextOverlays,
    slideFilters,
    words: mergeWords(readySections),
  };
}

/**
 * Turns a saved Maker project (.videomaker.json) into a Studio project.
 * Needs sections that were transcribed & aligned before saving.
 */
export async function makerFileToStudioProject(data) {
  const sections = (data.sections || []).map((s) => ({
    ...s,
    audio: dataUrlToBlob(s.audioDataUrl),
    slides: parseScript(s.scriptText || ''),
    effectiveImageUrls: (s.effectiveImageDataUrls || []).map((u) => (u ? URL.createObjectURL(dataUrlToBlob(u)) : null)),
  }));
  if (!sections.some(isReadySection)) {
    throw new Error(
      'This Video Maker project has no aligned sections saved. Open it in the Video Maker, run "Transcribe & Align", then click "Open in Studio Editor" (or save it again).'
    );
  }
  const merged = await mergeSections(sections);
  const bgm = dataUrlToBlob(data.bgmDataUrl);
  return {
    name: data.projectTitle || 'Imported project',
    aspectRatio: data.aspectRatio || '16:9',
    duration: merged.duration,
    rows: merged.rows,
    slides: merged.slides,
    imageUrls: merged.effectiveImageUrls,
    audioUrl: merged.audioUrl,
    bgmUrl: bgm ? URL.createObjectURL(bgm) : null,
    bgmName: data.bgmName || '',
    bgmVolume: data.bgmVolume ?? 0.15,
    autoDuck: data.autoDuck ?? true,
    animationMode: data.animationMode || 'random',
    captionStyle: data.captionStyle || 'modern-card',
    hookStyle: data.hookStyle || 'punch-stamp',
    slideAnimations: merged.slideAnimations,
    textOverlays: merged.textOverlays,
    words: merged.words,
    colorGrade: data.colorGrade || 'none',
    slideFilters: merged.slideFilters,
    sfx: data.sfx || { mode: 'none', volume: 0.6 },
    layers: overlaysToStudioLayers(merged.customTextOverlays),
    transitions: {},
  };
}

/**
 * Converts the Maker's decorated text overlays (centre-anchored) into Studio
 * text layers (top-left anchored) so they show up and stay editable.
 */
export function overlaysToStudioLayers(overlays = []) {
  return overlays.map((o, i) => {
    const width = Math.min(1, o.width ?? 0.85);
    const bg = o.bgColor && o.bgColor !== 'transparent' ? o.bgColor : '';
    return {
      id: `layer-ovl-${i}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'text',
      text: o.textTransform === 'uppercase' ? String(o.text || '').toUpperCase() : o.text || '',
      fontSize: o.fontSize || 48,
      fontWeight: o.fontWeight || '700',
      fontFamily: o.fontFamily || 'system-ui',
      color: o.color || '#ffffff',
      textBg: bg,
      textAlign: o.textAlign || 'center',
      italic: false,
      x: Math.max(0, (o.x ?? 0.5) - width / 2),
      y: Math.max(0, (o.y ?? 0.44) - 0.06),
      width,
      height: 0.12,
      startTime: o.startTime ?? 0,
      endTime: o.endTime ?? (o.startTime ?? 0) + 3,
      zIndex: 10,
      opacity: 1,
      rotation: 0,
      animation: o.animation === 'pop' ? 'bounce' : o.animation === 'typewriter' ? 'typewriter' : 'fade-in',
      animDuration: o.animDuration ?? 0.4,
    };
  });
}

/** True when parsed JSON looks like a Maker (.videomaker.json) save file. */
export const isMakerProjectFile = (data) => Array.isArray(data?.sections) && !Array.isArray(data?.layers);
