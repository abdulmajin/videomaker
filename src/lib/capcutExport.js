// CapCut Desktop Project Export Kit (.capcut.zip)
//
// Why this structure:
// CapCut Desktop 6.0+ / 9.4.0+ blocks third-party generated `draft_content.json` folders
// with: "Can't use project. Current project is from an unusual path and cannot be used currently."
//
// To work 100% natively in CapCut 9.4.0+ with ZERO manual slide timing:
//  1. `1_slides_timed_mp4/` contains an individual H.264 MP4 clip for every slide
//     (`001_slide_00m00s.mp4`, `002_slide_00m04s.mp4`, ...) encoded to that slide's
//     EXACT aligned voiceover duration (e.g. 4.04s, 4.46s, 5.50s...).
//     When you select all clips in `1_slides_timed_mp4/` and drag them onto CapCut's timeline,
//     every slide is a separate editable clip that automatically lands at its exact voice timestamp!
//  2. `2_audio/` contains `voiceover.wav` (and `background_music` if present) to drop on the audio track at 00:00.
//  3. `3_captions_srt/` contains `captions_phrases.srt` & `captions_slides.srt` to import in 1 click
//     via CapCut's official "Text -> Local captions -> Import".
//  4. `4_raw_slide_images/` contains the original full-resolution slide images.

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  QUALITY_HIGH,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { createZipBlob, extFromMime, safeEntryName } from './projectZip';
import { toSrtTime } from './exportUtils';
import { preloadImages } from './renderVideo';
import { gradeFilter } from './frameExtras';

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
 * Draws a single slide image full-bleed (100% edge-to-edge) onto `canvas`,
 * or a clean numbered placeholder if no image is assigned to the slide.
 */
function drawSlideToCanvas(ctx, width, height, img, slideNumber, slideText, filterStr = 'none') {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  if (img && img.naturalWidth && img.naturalHeight) {
    ctx.filter = filterStr || 'none';
    ctx.drawImage(img, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#38bdf8';
    ctx.font = `800 ${Math.round(width * 0.042)}px system-ui, sans-serif`;
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
      ctx.fillText(l, width / 2, height * 0.5 + i * Math.round(width * 0.036));
    });
  }
  ctx.restore();
}

/**
 * Encodes a single slide canvas into an H.264 MP4 Blob with the exact duration `durationSec`.
 */
async function encodeTimedSlideClipMp4(canvas, videoCodec, durationSec, fps = 30) {
  const safeDur = Math.max(0.2, Number(durationSec) || 1.0);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });
  await output.start();

  // Emit a frame sample every ~0.5s (and exact tail duration) so CapCut scrubbing is instant
  // and the clip's total duration matches `safeDur` down to the millisecond.
  let t = 0;
  const maxStep = 0.5;
  while (t < safeDur - 0.005) {
    const dt = Math.min(maxStep, safeDur - t);
    await videoSource.add(t, dt);
    t += dt;
  }

  await output.finalize();
  return new Blob([output.target.buffer], { type: 'video/mp4' });
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

function buildSrtFromItems(items) {
  return items
    .map(
      (item, idx) =>
        `${idx + 1}\n${toSrtTime(item.start)} --> ${toSrtTime(item.end)}\n${item.text}\n`
    )
    .join('\n');
}

/**
 * Builds a Final Cut Pro 7 XML (`xmeml` v5) timeline file referencing the pre-timed MP4 clips.
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
            <name>${sl.mp4FileName}</name>
            <enabled>TRUE</enabled>
            <duration>${durF}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${startF}</start>
            <end>${endF}</end>
            <in>0</in>
            <out>${durF}</out>
            <file id="file-slide-${i + 1}">
              <name>${sl.mp4FileName}</name>
              <pathurl>1_slides_timed_mp4/${sl.mp4FileName}</pathurl>
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
              <pathurl>2_audio/${voiceAssetName}</pathurl>
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
 * Exports a Section or Merged Project into a CapCut Desktop Editing Kit (.zip)
 * that works in CapCut 9.4.0+ without triggering "unusual path" draft restrictions.
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
  words = [],
  textOverlays = {},
  customTextOverlays = [],
  colorGrade = 'none',
  slideFilters = {},
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

  const safeFolder = safeEntryName(projectName.trim() || 'CapCut_Project').replace(/\s+/g, '_');
  const entries = [];

  onProgress(3, 'Preloading slide images…');
  const preloadedImages = await preloadImages(effectiveImageUrls || []);

  // Check if WebCodecs H.264 MP4 encoding is available for pre-timed slide video clips
  let videoCodec = null;
  if (typeof VideoEncoder !== 'undefined') {
    try {
      videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height });
    } catch {
      videoCodec = null;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const slideAssetsMeta = [];

  // 1. Generate Pre-Timed MP4 Slide Clips (`1_slides_timed_mp4/`) + Raw Images (`4_raw_slide_images/`)
  for (let i = 0; i < rows.length; i++) {
    const pct = Math.round(5 + ((i + 1) / rows.length) * 75);
    onProgress(pct, `Creating timed CapCut slide clip ${i + 1}/${rows.length}…`);

    const row = rows[i];
    const startSec = Number(row.start) || 0;
    const endSec = rows[i + 1] ? Number(rows[i + 1].start) : totalDuration;
    const durSec = Math.max(0.2, endSec - startSec);

    const padIdx = String(i + 1).padStart(3, '0');
    const mins = String(Math.floor(startSec / 60)).padStart(2, '0');
    const secs = String(Math.floor(startSec % 60)).padStart(2, '0');
    const durLabel = durSec.toFixed(2) + 's';

    const img = preloadedImages?.[i] || null;
    const filterStr = gradeFilter(colorGrade, slideFilters?.[i]);
    drawSlideToCanvas(
      ctx,
      width,
      height,
      img,
      slides[i]?.id ?? i + 1,
      slides[i]?.text || `Slide ${i + 1}`,
      filterStr
    );

    // 1A. Encode pre-timed MP4 clip (`1_slides_timed_mp4/001_slide_00m00s_4.04s.mp4`)
    const mp4FileName = `${padIdx}_slide_${mins}m${secs}s_${durLabel}.mp4`;
    if (videoCodec) {
      const mp4Blob = await encodeTimedSlideClipMp4(canvas, videoCodec, durSec, 30);
      entries.push({
        name: `${safeFolder}/1_slides_timed_mp4/${mp4FileName}`,
        data: mp4Blob,
      });
    }

    // 1B. Save original or rendered PNG image in `4_raw_slide_images/`
    const rawImgBlob = await urlToBlob(effectiveImageUrls?.[i]);
    const rawExt = rawImgBlob && extFromMime(rawImgBlob.type) !== 'bin' ? extFromMime(rawImgBlob.type) : 'png';
    const finalImgBlob =
      rawImgBlob && extFromMime(rawImgBlob.type) !== 'bin'
        ? rawImgBlob
        : await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));

    const imgFileName = `${padIdx}_slide_${mins}m${secs}s.${rawExt}`;
    entries.push({
      name: `${safeFolder}/4_raw_slide_images/${imgFileName}`,
      data: finalImgBlob,
    });

    slideAssetsMeta.push({
      index: i + 1,
      mp4FileName,
      imgFileName,
      start: startSec,
      end: endSec,
      duration: durSec,
      text: slides[i]?.text || '',
    });

    // Yield briefly so UI progress bar updates smoothly
    if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  // 2. Package Voiceover Audio + BGM Audio (`2_audio/`)
  onProgress(84, 'Packing voiceover & background music…');
  let voiceAssetFileName = null;
  const resolvedVoiceBlob = audioBlob || (await urlToBlob(audioUrl));
  if (resolvedVoiceBlob) {
    const ext = extFromMime(resolvedVoiceBlob.type) === 'bin' ? 'wav' : extFromMime(resolvedVoiceBlob.type);
    voiceAssetFileName = `voiceover.${ext}`;
    entries.push({
      name: `${safeFolder}/2_audio/${voiceAssetFileName}`,
      data: resolvedVoiceBlob,
    });
  }

  const resolvedBgmBlob = bgmBlob || (await urlToBlob(bgmUrl));
  if (resolvedBgmBlob) {
    const ext = extFromMime(resolvedBgmBlob.type) === 'bin' ? 'mp3' : extFromMime(resolvedBgmBlob.type);
    entries.push({
      name: `${safeFolder}/2_audio/background_music.${ext}`,
      data: resolvedBgmBlob,
    });
  }

  // 3. Build SRT Subtitle Files (`3_captions_srt/`)
  onProgress(90, 'Building CapCut SRT caption files…');
  const phrases = buildCapCutCaptionPhrases(words, rows, slides, totalDuration);
  const phraseSrt = buildSrtFromItems(phrases);
  const slideSrt = buildSrtFromItems(
    slideAssetsMeta.map((s) => ({
      text: s.text || `Slide ${s.index}`,
      start: s.start,
      end: s.end,
    }))
  );

  entries.push(
    { name: `${safeFolder}/3_captions_srt/captions_phrases.srt`, data: phraseSrt },
    { name: `${safeFolder}/3_captions_srt/captions_slides.srt`, data: slideSrt }
  );

  // Optional hooks / overlays SRT
  const hookItems = [];
  rows.forEach((row, idx) => {
    const rawHook = textOverlays?.[idx] || slides?.[idx]?.textOverlay || '';
    if (!rawHook || !String(rawHook).trim()) return;
    const endSec = rows[idx + 1] ? rows[idx + 1].start : totalDuration;
    hookItems.push({
      text: String(rawHook).trim(),
      start: row.start,
      end: Math.min(endSec, row.start + 1.8),
    });
  });
  (customTextOverlays || []).forEach((ov) => {
    if (!ov?.text?.trim()) return;
    hookItems.push({
      text: ov.text.trim(),
      start: Number(ov.startTime) || 0,
      end: Number(ov.endTime) || (Number(ov.startTime) || 0) + 2.5,
    });
  });
  if (hookItems.length > 0) {
    entries.push({
      name: `${safeFolder}/3_captions_srt/hooks_overlays.srt`,
      data: buildSrtFromItems(hookItems),
    });
  }

  // 4. Build NLE XML Timeline + Timestamp Table + Step-by-Step Guide
  const fcpXml = buildFcp7Xml({
    projectName: safeFolder,
    width,
    height,
    fps: 30,
    slideAssets: slideAssetsMeta,
    voiceAssetName: voiceAssetFileName,
    totalDuration,
  });

  const timingTableTxt = slideAssetsMeta
    .map(
      (s) =>
        `Slide ${String(s.index).padStart(3, '0')} | ${toSrtTime(s.start)} -> ${toSrtTime(s.end)} (dur: ${s.duration.toFixed(2)}s) | ${s.mp4FileName} | "${s.text}"`
    )
    .join('\n');

  const readmeText = `======================================================================
HOW TO OPEN & EDIT "${safeFolder}" IN CAPCUT DESKTOP (10-SECOND SETUP)
======================================================================
Why this kit works in ALL CapCut versions (including CapCut 9.4.0+):
Newer versions of CapCut block third-party draft folders with the error:
"Current project is from an unusual path and cannot be used currently."

Instead, each slide in "1_slides_timed_mp4/" is already encoded as an
individual MP4 clip with its EXACT voice-aligned duration!

----------------------------------------------------------------------
4 SIMPLE STEPS IN CAPCUT DESKTOP (ZERO MANUAL TIMING NEEDED):
----------------------------------------------------------------------

STEP 1: Create a New Project in CapCut Desktop
  • Open CapCut Desktop and click "+ Create project".
  • (Optional: If you previously copied a folder into CapCut's internal
    com.lveditor.draft folder, delete that folder so CapCut's home screen stays clean.)

STEP 2: Drop All Pre-Timed Slide Clips onto Track 1 (Video Track)
  • Click "Import" in CapCut -> open the "1_slides_timed_mp4" folder.
  • Select ALL ${rows.length} MP4 clips (001_slide... to ${String(rows.length).padStart(3, '0')}_slide...)
    and drag them onto the Video Timeline Track all at once.
  • Because each MP4 clip ALREADY has its exact aligned voiceover duration
    (e.g. 4.04s, 4.46s, 5.50s...), every slide automatically lines up to the
    exact millisecond of your voiceover—and every slide is a separate clip so
    you can add CapCut transitions, effects, keyframes, or edits to any slide!

STEP 3: Drop Your Voiceover onto the Audio Track at 00:00
  • Import "2_audio/${voiceAssetFileName || 'voiceover.wav'}" (and background_music if included)
    and drag it onto the Audio Track starting at 00:00.

STEP 4: Import Your Editable Captions in 1 Click (.SRT)
  • In CapCut's top menu, click:
    Text -> Local captions -> Import
  • Select "3_captions_srt/captions_phrases.srt" (for short dynamic phrases)
    OR "3_captions_srt/captions_slides.srt" (for full slide sentences).
  • Drag the imported captions onto your timeline starting at the first spoken word.
    All ${phrases.length} captions are now 100% editable on CapCut's Text Track!
======================================================================
`;

  entries.unshift(
    { name: `${safeFolder}/HOW_TO_IMPORT_IN_CAPCUT.txt`, data: readmeText },
    { name: `${safeFolder}/slide_timings_reference.txt`, data: timingTableTxt },
    { name: `${safeFolder}/timeline_nle.xml`, data: fcpXml }
  );

  onProgress(95, 'Creating CapCut ZIP bundle…');
  const zipBlob = await createZipBlob(entries);
  onProgress(100, '✓ CapCut kit ready!');

  return {
    blob: zipBlob,
    filename: `${safeFolder}_CapCut_Kit.zip`,
    slideCount: rows.length,
    captionCount: phrases.length,
  };
}
