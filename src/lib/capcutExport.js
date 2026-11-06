// CapCut Desktop Project Exporter (.capcut.zip)
// Packages aligned slides, voiceover audio, background music, and phrase-level captions
// into a ready-to-edit CapCut Desktop draft folder + SRT subtitles + NLE XML timeline.

import { createZipBlob, extFromMime, safeEntryName } from './projectZip';
import { toSrtTime } from './exportUtils';

const CAPCUT_PATH_PLACEHOLDER = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';

function uuidUpper() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().toUpperCase();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
    .toUpperCase();
}

const secToUs = (sec) => Math.max(0, Math.round((Number(sec) || 0) * 1_000_000));

async function urlToBlob(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.blob();
  } catch {
    return null;
  }
}

/**
 * Generates a clean PNG Blob placeholder when a slide does not have an image yet,
 * so the CapCut video track has zero missing-media gaps.
 */
async function createPlaceholderSlideBlob(slideNumber, slideText, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#38bdf8';
  ctx.font = `800 ${Math.round(width * 0.04)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`SLIDE ${slideNumber}`, width / 2, height * 0.38);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 ${Math.round(width * 0.025)}px system-ui, sans-serif`;
  const words = String(slideText || '').split(/\s+/);
  let line = '';
  const lines = [];
  const maxW = width * 0.78;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  lines.slice(0, 4).forEach((l, i) => {
    ctx.fillText(l, width / 2, height * 0.5 + i * Math.round(width * 0.035));
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Groups aligned words into short CapCut subtitle phrases (respecting slide boundaries & pauses).
 */
function buildCapCutCaptionPhrases(words = [], rows = [], slides = [], totalDuration = 0) {
  const MAX_WORDS = 6;
  const GAP_S = 0.22;

  if (words && words.length > 0) {
    const phrases = [];
    let cur = [];
    for (const w of words) {
      const text = String(w.text || '').trim();
      if (!text) continue;
      const prev = cur[cur.length - 1];
      const diffSlide =
        prev && w.slideIndex != null && prev.slideIndex != null && w.slideIndex !== prev.slideIndex;
      if (
        cur.length >= MAX_WORDS ||
        diffSlide ||
        (prev && w.start - prev.end > GAP_S) ||
        (prev && /[.,!?;:–—]["']?$/.test(prev.text))
      ) {
        if (cur.length) phrases.push(cur);
        cur = [];
      }
      cur.push({
        text,
        start: Math.max(0, Number(w.start) || 0),
        end: Math.max((Number(w.start) || 0) + 0.08, Number(w.end) || 0),
      });
    }
    if (cur.length) phrases.push(cur);

    if (phrases.length > 0) {
      return phrases.map((p, idx) => {
        const start = p[0].start;
        const rawEnd = p[p.length - 1].end;
        const nextStart = phrases[idx + 1] ? phrases[idx + 1][0].start : totalDuration;
        const end = Math.min(nextStart, Math.max(start + 0.15, rawEnd));
        return {
          text: p.map((x) => x.text).join(' '),
          start,
          end,
          duration: Math.max(0.1, end - start),
        };
      });
    }
  }

  // Fallback to slide-level captions
  return rows.map((row, idx) => {
    const start = row.start || 0;
    const end = rows[idx + 1] ? rows[idx + 1].start : totalDuration;
    return {
      text: String(slides[idx]?.text || `Slide ${idx + 1}`).trim(),
      start,
      end,
      duration: Math.max(0.1, end - start),
    };
  });
}

function buildPhraseSrt(phrases) {
  return phrases
    .map(
      (p, idx) =>
        `${idx + 1}\n${toSrtTime(p.start)} --> ${toSrtTime(p.end)}\n${p.text}\n`
    )
    .join('\n');
}

function buildCapCutTextContentJson(text, fontSize = 8.0, isHook = false) {
  return JSON.stringify({
    text,
    styles: [
      {
        fill: {
          content: {
            render_type: 'solid',
            solid: {
              alpha: 1.0,
              color: isHook ? [1.0, 0.88, 0.18] : [1.0, 1.0, 1.0],
            },
          },
        },
        range: [0, text.length],
        size: fontSize,
        bold: true,
        italic: false,
        strokes: [
          {
            content: {
              render_type: 'solid',
              solid: { alpha: 1.0, color: [0.0, 0.0, 0.0] },
            },
            width: 0.08,
          },
        ],
      },
    ],
  });
}

function createTextMaterial(id, text, isHook = false) {
  const clean = String(text || '').trim();
  return {
    id,
    type: isHook ? 'text' : 'subtitle',
    add_type: 0,
    alignment: 1,
    background_alpha: 0.0,
    background_color: '#000000',
    background_fill: '',
    background_height: 0.14,
    background_horizontal_offset: 0.0,
    background_round_radius: 0.0,
    background_style: 0,
    background_vertical_offset: 0.0,
    background_width: 0.14,
    bold_width: 0.0,
    border_alpha: 1.0,
    border_color: '#000000',
    border_width: 0.08,
    check_flag: 7,
    combo_info: { text_templates: [] },
    content: buildCapCutTextContentJson(clean, isHook ? 10.0 : 8.0, isHook),
    fixed_height: -1.0,
    fixed_width: -1.0,
    font_category_id: '',
    font_category_name: '',
    font_id: '',
    font_name: '',
    font_path: '',
    font_resource_id: '',
    font_size: isHook ? 10.0 : 8.0,
    font_source_platform: 0,
    font_team_id: '',
    font_title: 'none',
    font_url: '',
    fonts: [],
    force_apply_line_max_width: false,
    global_alpha: 1.0,
    group_id: '',
    has_shadow: true,
    initial_scale: 1.0,
    inner_padding: -1.0,
    is_rich_text: false,
    italic_degree: 0,
    ktv_color: '',
    language: '',
    layer_weight: 1,
    letter_spacing: 0.0,
    line_feed: 1,
    line_max_width: 0.82,
    line_spacing: 0.02,
    multi_language_current: 'none',
    name: clean.slice(0, 32),
    original_size: [],
    preset_category: '',
    preset_category_id: '',
    preset_has_set_alignment: false,
    preset_id: '',
    preset_index: 0,
    preset_name: '',
    recognize_task_id: '',
    recognize_type: 0,
    relevance_segment: [],
    shadow_alpha: 0.75,
    shadow_angle: -45.0,
    shadow_color: '#000000',
    shadow_distance: 5.0,
    shadow_point: { x: 0.636, y: -0.636 },
    shadow_smoothing: 0.45,
    shape_clip_x: false,
    shape_clip_y: false,
    style_name: '',
    sub_type: 0,
    subtitle_keywords: null,
    text_alpha: 1.0,
    text_color: isHook ? '#FDE047' : '#FFFFFF',
    text_curve: null,
    text_preset_resource_id: '',
    text_size: 30,
    text_to_audio_ids: [],
    tts_auto_update: false,
    typesetting: 0,
    underline: false,
    underline_offset: 0.22,
    underline_width: 0.05,
    use_effect_default_color: true,
    words: { end_time: [], start_time: [], text: [] },
  };
}

function createSegment({
  materialId,
  extraMaterialRefs = [],
  startUs,
  durationUs,
  sourceStartUs = 0,
  sourceDurationUs = null,
  volume = 1.0,
  transformY = 0.0,
  renderIndex = 0,
}) {
  return {
    id: uuidUpper(),
    material_id: materialId,
    extra_material_refs: extraMaterialRefs,
    source_timerange: {
      start: sourceStartUs,
      duration: sourceDurationUs != null ? sourceDurationUs : durationUs,
    },
    target_timerange: {
      start: startUs,
      duration: durationUs,
    },
    speed: 1.0,
    volume,
    visible: true,
    enable_adjust: true,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    mirror: false,
    hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: transformY },
    },
    uniform_scale: { on: true, value: 1.0 },
     keyframes: {
      alpha: [],
      adjust: [],
      audio: [],
      color: [],
      filter: [],
      handwrite: [],
      position: [],
      rotation: [],
      scale: [],
      sticker: [],
      text: [],
      video: [],
    },
    render_index: renderIndex,
    track_attribute: 0,
    track_render_index: 0,
  };
}

/**
 * Builds a Final Cut Pro 7 XML (`xmeml` v5) timeline file accepted by CapCut Pro,
 * Premiere Pro, and DaVinci Resolve as an additional NLE interchange option.
 */
function buildFcp7Xml({ projectName, width, height, fps = 30, slideAssets, voiceAssetName, totalDuration }) {
  const secToFrames = (s) => Math.max(0, Math.round(s * fps));
  const totalFrames = secToFrames(totalDuration);

  const clipItemsXml = slideAssets
    .map((sl, i) => {
      const startF = secToFrames(sl.start);
      const endF = secToFrames(sl.end);
      const durF = Math.max(1, endF - startF);
      return `          <clipitem id="clipitem-slide-${i + 1}">
            <name>${sl.fileName}</name>
            <enabled>TRUE</enabled>
            <duration>${durF}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${startF}</start>
            <end>${endF}</end>
            <in>0</in>
            <out>${durF}</out>
            <file id="file-slide-${i + 1}">
              <name>${sl.fileName}</name>
              <pathurl>media/${sl.fileName}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${durF}</duration>
              <media><video><samplecharacteristics><width>${width}</width><height>${height}</height></samplecharacteristics></video></media>
            </file>
          </clipitem>`;
    })
    .join('\n');

  const audioClipXml = voiceAssetName
    ? `        <track>
          <clipitem id="clipitem-voice-1">
            <name>${voiceAssetName}</name>
            <enabled>TRUE</enabled>
            <duration>${totalFrames}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>0</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${totalFrames}</out>
            <file id="file-voice-1">
              <name>${voiceAssetName}</name>
              <pathurl>media/${voiceAssetName}</pathurl>
              <duration>${totalFrames}</duration>
            </file>
          </clipitem>
        </track>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${projectName}</name>
    <duration>${totalFrames}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <width>${width}</width>
            <height>${height}</height>
          </samplecharacteristics>
        </format>
        <track>
${clipItemsXml}
        </track>
      </video>
      <audio>
${audioClipXml}
      </audio>
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Exports a Section or Merged Project into a CapCut Desktop Draft Bundle (.capcut.zip).
 */
export async function exportToCapCutProjectZip({
  projectName = 'My_CapCut_Project',
  aspectRatio = '16:9',
  duration = 0,
  rows = [],
  slides = [],
  effectiveImageUrls = [],
  audioBlob = null,
  audioUrl = null,
  bgmBlob = null,
  bgmUrl = null,
  bgmVolume = 0.15,
  words = [],
  textOverlays = {},
  customTextOverlays = [],
  onProgress = () => {},
}) {
  if (!rows || !rows.length) {
    throw new Error('Please run "Transcribe & Align" first so your slides have aligned timestamps for CapCut.');
  }

  const isVertical = aspectRatio === '9:16';
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const totalDuration = Math.max(
    1,
    Number(duration) || (rows[rows.length - 1]?.start || 0) + 3
  );
  const totalDurationUs = secToUs(totalDuration);

  const safeFolder = safeEntryName(projectName.trim() || 'CapCut_Project').replace(/\s+/g, '_');
  const entries = [];

  // 1. Collect & package Slide Images into media/
  const videoMaterials = [];
  const canvasMaterials = [];
  const speedMaterials = [];
  const soundChannelMaterials = [];
  const vocalSepMaterials = [];
  const videoSegments = [];
  const slideAssetsMeta = [];

  for (let i = 0; i < rows.length; i++) {
    onProgress(Math.round(((i + 1) / (rows.length + 4)) * 75), `Packing slide ${i + 1}/${rows.length} for CapCut…`);

    const row = rows[i];
    const startSec = Number(row.start) || 0;
    const endSec = rows[i + 1] ? Number(rows[i + 1].start) : totalDuration;
    const durSec = Math.max(0.1, endSec - startSec);
    const startUs = secToUs(startSec);
    const durUs = secToUs(durSec);

    const imgUrl = effectiveImageUrls?.[i] || null;
    let imgBlob = await urlToBlob(imgUrl);
    let ext = imgBlob ? extFromMime(imgBlob.type) : 'png';
    if (!imgBlob || ext === 'bin') {
      imgBlob = await createPlaceholderSlideBlob(
        slides[i]?.id ?? i + 1,
        slides[i]?.text || `Slide ${i + 1}`,
        width,
        height
      );
      ext = 'png';
    }

    const padIdx = String(i + 1).padStart(3, '0');
    const mins = String(Math.floor(startSec / 60)).padStart(2, '0');
    const secs = String(Math.floor(startSec % 60)).padStart(2, '0');
    const fileName = `slide_${padIdx}_${mins}m${secs}s.${ext}`;
    const relPath = `media/${fileName}`;

    entries.push({
      name: `${safeFolder}/${relPath}`,
      data: imgBlob,
    });

    const matId = uuidUpper();
    const speedId = uuidUpper();
    const canvasId = uuidUpper();
    const scmId = uuidUpper();
    const vsId = uuidUpper();

    videoMaterials.push({
      id: matId,
      type: 'photo',
      material_name: fileName,
      path: `${CAPCUT_PATH_PLACEHOLDER}/${relPath}`,
      duration: 10800000000, // Standard CapCut photo source duration
      width,
      height,
      crop: {
        lower_left_x: 0.0,
        lower_left_y: 1.0,
        lower_right_x: 1.0,
        lower_right_y: 1.0,
        upper_left_x: 0.0,
        upper_left_y: 0.0,
        upper_right_x: 1.0,
        upper_right_y: 0.0,
      },
      crop_ratio: 'free',
      crop_scale: 1.0,
      check_flag: 63487,
      category_name: 'local',
      has_audio: false,
      local_material_id: '',
    });

    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });
    canvasMaterials.push({ id: canvasId, type: 'canvas_color', color: '', image: '', blur: 0.0 });
    soundChannelMaterials.push({ id: scmId, type: 'none', audio_channel_mapping: 0, is_config_open: false });
    vocalSepMaterials.push({ id: vsId, type: 'vocal_separation', choice: 0, production_path: '', time_range: null });

    videoSegments.push(
      createSegment({
        materialId: matId,
        extraMaterialRefs: [speedId, canvasId, scmId, vsId],
        startUs,
        durationUs: durUs,
        sourceStartUs: 0,
        sourceDurationUs: durUs,
        volume: 1.0,
        transformY: 0.0,
        renderIndex: 0,
      })
    );

    slideAssetsMeta.push({
      index: i + 1,
      fileName,
      start: startSec,
      end: endSec,
      duration: durSec,
      text: slides[i]?.text || '',
    });
  }

  // 2. Collect & package Voiceover Audio + BGM Audio
  const audioMaterials = [];
  const audioTracks = [];
  let voiceAssetFileName = null;

  const resolvedVoiceBlob = audioBlob || (await urlToBlob(audioUrl));
  if (resolvedVoiceBlob) {
    onProgress(80, 'Packing voiceover audio for CapCut…');
    const ext = extFromMime(resolvedVoiceBlob.type) === 'bin' ? 'wav' : extFromMime(resolvedVoiceBlob.type);
    voiceAssetFileName = `voiceover.${ext}`;
    const relPath = `media/${voiceAssetFileName}`;
    entries.push({
      name: `${safeFolder}/${relPath}`,
      data: resolvedVoiceBlob,
    });

    const voiceMatId = uuidUpper();
    const speedId = uuidUpper();
    const scmId = uuidUpper();
    const vsId = uuidUpper();

    audioMaterials.push({
      id: voiceMatId,
      type: 'extract_music',
      name: voiceAssetFileName,
      path: `${CAPCUT_PATH_PLACEHOLDER}/${relPath}`,
      duration: totalDurationUs,
      check_flag: 1,
      category_name: 'local',
      local_material_id: uuidUpper(),
      music_id: uuidUpper(),
      source_platform: 0,
      wave_points: [],
    });
    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });
    soundChannelMaterials.push({ id: scmId, type: 'none', audio_channel_mapping: 0, is_config_open: false });
    vocalSepMaterials.push({ id: vsId, type: 'vocal_separation', choice: 0, production_path: '', time_range: null });

    audioTracks.push({
      id: uuidUpper(),
      type: 'audio',
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: 'Voiceover',
      segments: [
        createSegment({
          materialId: voiceMatId,
          extraMaterialRefs: [speedId, scmId, vsId],
          startUs: 0,
          durationUs: totalDurationUs,
          sourceStartUs: 0,
          sourceDurationUs: totalDurationUs,
          volume: 1.0,
        }),
      ],
    });
  }

  const resolvedBgmBlob = bgmBlob || (await urlToBlob(bgmUrl));
  if (resolvedBgmBlob) {
    onProgress(85, 'Packing background music for CapCut…');
    const ext = extFromMime(resolvedBgmBlob.type) === 'bin' ? 'mp3' : extFromMime(resolvedBgmBlob.type);
    const bgmFileName = `background_music.${ext}`;
    const relPath = `media/${bgmFileName}`;
    entries.push({
      name: `${safeFolder}/${relPath}`,
      data: resolvedBgmBlob,
    });

    const bgmMatId = uuidUpper();
    const speedId = uuidUpper();
    const scmId = uuidUpper();
    const vsId = uuidUpper();

    audioMaterials.push({
      id: bgmMatId,
      type: 'extract_music',
      name: bgmFileName,
      path: `${CAPCUT_PATH_PLACEHOLDER}/${relPath}`,
      duration: totalDurationUs,
      check_flag: 1,
      category_name: 'local',
      local_material_id: uuidUpper(),
      music_id: uuidUpper(),
      source_platform: 0,
      wave_points: [],
    });
    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });
    soundChannelMaterials.push({ id: scmId, type: 'none', audio_channel_mapping: 0, is_config_open: false });
    vocalSepMaterials.push({ id: vsId, type: 'vocal_separation', choice: 0, production_path: '', time_range: null });

    audioTracks.push({
      id: uuidUpper(),
      type: 'audio',
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: 'BGM',
      segments: [
        createSegment({
          materialId: bgmMatId,
          extraMaterialRefs: [speedId, scmId, vsId],
          startUs: 0,
          durationUs: totalDurationUs,
          sourceStartUs: 0,
          sourceDurationUs: totalDurationUs,
          volume: Math.max(0.02, Math.min(1.0, Number(bgmVolume) || 0.15)),
        }),
      ],
    });
  }

  // 3. Build Editable Captions & Hooks Track
  onProgress(90, 'Generating editable CapCut caption & text tracks…');
  const textMaterials = [];
  const captionSegments = [];
  const phrases = buildCapCutCaptionPhrases(words, rows, slides, totalDuration);

  phrases.forEach((p, idx) => {
    const textMatId = uuidUpper();
    const speedId = uuidUpper();
    textMaterials.push(createTextMaterial(textMatId, p.text, false));
    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });

    captionSegments.push(
      createSegment({
        materialId: textMatId,
        extraMaterialRefs: [speedId],
        startUs: secToUs(p.start),
        durationUs: secToUs(p.duration),
        transformY: -0.76, // Inside bottom of video frame with comfortable inner padding
        renderIndex: 14000 + idx,
      })
    );
  });

  // Also include slide text hooks / custom text overlays on a second text track if present
  const hookSegments = [];
  rows.forEach((row, idx) => {
    const rawHook = textOverlays?.[idx] || slides?.[idx]?.textOverlay || '';
    if (!rawHook || !String(rawHook).trim()) return;
    const textMatId = uuidUpper();
    const speedId = uuidUpper();
    textMaterials.push(createTextMaterial(textMatId, String(rawHook).trim(), true));
    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });

    const endSec = rows[idx + 1] ? rows[idx + 1].start : totalDuration;
    const hookDur = Math.min(1.8, Math.max(0.5, endSec - row.start));
    hookSegments.push(
      createSegment({
        materialId: textMatId,
        extraMaterialRefs: [speedId],
        startUs: secToUs(row.start),
        durationUs: secToUs(hookDur),
        transformY: 0.72,
        renderIndex: 15000 + idx,
      })
    );
  });

  (customTextOverlays || []).forEach((ov, idx) => {
    if (!ov?.text?.trim()) return;
    const textMatId = uuidUpper();
    const speedId = uuidUpper();
    textMaterials.push(createTextMaterial(textMatId, ov.text.trim(), true));
    speedMaterials.push({ id: speedId, speed: 1.0, mode: 0, type: 'speed', curve_speed: null });
    const startSec = Number(ov.startTime) || 0;
    const durSec = Math.max(0.2, (Number(ov.endTime) || startSec + 2.5) - startSec);
    hookSegments.push(
      createSegment({
        materialId: textMatId,
        extraMaterialRefs: [speedId],
        startUs: secToUs(startSec),
        durationUs: secToUs(durSec),
        transformY: 0.0,
        renderIndex: 16000 + idx,
      })
    );
  });

  // Assemble all tracks
  const tracks = [
    {
      id: uuidUpper(),
      type: 'video',
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: '',
      segments: videoSegments,
    },
    ...audioTracks,
  ];

  if (captionSegments.length > 0) {
    tracks.push({
      id: uuidUpper(),
      type: 'text',
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: 'Captions',
      segments: captionSegments,
    });
  }

  if (hookSegments.length > 0) {
    tracks.push({
      id: uuidUpper(),
      type: 'text',
      attribute: 0,
      flag: 0,
      is_default_name: true,
      name: 'Hooks',
      segments: hookSegments,
    });
  }

  const nowUs = Date.now() * 1000;
  const draftId = uuidUpper();

  const draftContent = {
    id: draftId,
    version: 360000,
    new_version: '110.0.0',
    name: safeFolder,
    duration: totalDurationUs,
    fps: 30.0,
    create_time: nowUs,
    update_time: nowUs,
    canvas_config: {
      width,
      height,
      ratio: isVertical ? '9:16' : '16:9',
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: '',
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: 'none',
      multi_language_list: [],
      multi_language_main: 'none',
      multi_language_mode: 'none',
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: '',
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
    materials: {
      ai_translates: [],
      audio_balances: [],
      audio_effects: [],
      audio_fades: [],
      audio_track_indexes: [],
      audios: audioMaterials,
      beats: [],
      canvases: canvasMaterials,
      chromas: [],
      color_curves: [],
      digital_humans: [],
      drafts: [],
      effects: [],
      flowers: [],
      green_screens: [],
      handwrites: [],
      hsl: [],
      images: [],
      log_color_wheels: [],
      loudnesses: [],
      manual_deformations: [],
      masks: [],
      material_animations: [],
      material_colors: [],
      multi_language_refs: [],
      placeholders: [],
      plugin_effects: [],
      primary_color_wheels: [],
      realtime_denoises: [],
      shapes: [],
      smart_crops: [],
      smart_relights: [],
      sound_channel_mappings: soundChannelMaterials,
      speeds: speedMaterials,
      stickers: [],
      tail_leaders: [],
      text_templates: [],
      texts: textMaterials,
      time_marks: [],
      transitions: [],
      video_effects: [],
      video_trackings: [],
      videos: videoMaterials,
      vocal_beautifys: [],
      vocal_separations: vocalSepMaterials,
    },
    mutable_config: null,
    platform: {
      app_id: 3704,
      app_source: 'lv',
      app_version: '4.0.0',
      os: 'windows',
    },
    relationships: [],
    render_index_track_mode_on: true,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks,
    extra_info: null,
  };

  const draftMetaInfo = {
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'media/slide_001.png',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_fold_path: '',
    draft_id: draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: safeFolder,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: totalDurationUs,
  };

  const phraseSrt = buildPhraseSrt(phrases);
  const slideSrt = buildPhraseSrt(
    slideAssetsMeta.map((s) => ({
      text: s.text || `Slide ${s.index}`,
      start: s.start,
      end: s.end,
    }))
  );
  const fcpXml = buildFcp7Xml({
    projectName: safeFolder,
    width,
    height,
    fps: 30,
    slideAssets: slideAssetsMeta,
    voiceAssetName: voiceAssetFileName,
    totalDuration,
  });

  const readmeText = `===================================================================
HOW TO OPEN "${safeFolder}" IN CAPCUT DESKTOP (WINDOWS / MAC)
===================================================================

METHOD 1: OPEN DIRECTLY AS A NATIVE CAPCUT DRAFT (ALL TRACKS READY)
-------------------------------------------------------------------
1. Unzip this file so you have the folder named:
   "${safeFolder}"

2. Copy that "${safeFolder}" folder into your CapCut Drafts folder:
   • Windows (press Win + R and paste):
     %LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft\\
   • Mac:
     ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/

3. Open CapCut Desktop. "${safeFolder}" will appear right in your Recent Drafts with:
   • Track 1 (Video): All ${rows.length} slide images placed at exact aligned timestamps
   • Track 2 (Audio): Voiceover audio synced to your slides
   • Track 3 (Audio): Background music (if included)
   • Track 4 (Text): All ${phrases.length} editable caption phrases synced to the voiceover

-------------------------------------------------------------------
METHOD 2: IMPORT INTO ANY EXISTING CAPCUT / PREMIERE / DAVINCI PROJECT
-------------------------------------------------------------------
• All numbered slide images & audio are inside the "media/" folder
  (each image filename includes its timestamp, e.g. slide_001_00m00s.png).
• Import "captions_phrases.srt" in CapCut via:
  Text -> Local Captions -> Import SRT (places all timed captions in 1 click).
• Or import "timeline_nle.xml" into Premiere Pro / DaVinci Resolve / CapCut.
`;

  entries.unshift(
    { name: `${safeFolder}/draft_content.json`, data: JSON.stringify(draftContent, null, 2) },
    { name: `${safeFolder}/draft_meta_info.json`, data: JSON.stringify(draftMetaInfo, null, 2) },
    { name: `${safeFolder}/draft_agency_config.json`, data: JSON.stringify({ is_auto_agency_enabled: false, is_single_agency_mode: false, resolution: 720 }) },
    { name: `${safeFolder}/draft_virtual_store.json`, data: JSON.stringify({ draft_materials: [], draft_virtual_store: [] }) },
    { name: `${safeFolder}/captions_phrases.srt`, data: phraseSrt },
    { name: `${safeFolder}/captions_slides.srt`, data: slideSrt },
    { name: `${safeFolder}/timeline_nle.xml`, data: fcpXml },
    { name: `${safeFolder}/HOW_TO_OPEN_IN_CAPCUT.txt`, data: readmeText }
  );

  onProgress(95, 'Creating CapCut ZIP bundle…');
  const zipBlob = await createZipBlob(entries);
  onProgress(100, '✓ CapCut project ready!');

  return {
    blob: zipBlob,
    filename: `${safeFolder}_CapCut_Project.zip`,
    slideCount: rows.length,
    captionCount: phrases.length,
  };
}
