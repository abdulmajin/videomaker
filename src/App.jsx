import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { decodeAudio, mergeAudioFiles } from './lib/audio';
import {
  downloadText,
  downloadBlob,
  generateSrt,
  generateVtt,
  generateTimelineJson,
} from './lib/exportUtils';
import {
  renderVideo,
  preloadImages,
  drawVideoFrame,
  CAPTION_STYLES,
  HOOK_STYLES,
  createDefaultTextOverlay,
} from './lib/renderVideo';
import { ANIMATION_TYPES } from './lib/animations';
import {
  IMAGE_ENGINES,
  IMAGE_STYLES,
  verifyGoogleApiKey,
} from './lib/imageGen';
import SectionEditor from './components/SectionEditor';
import VisualTimeline from './components/VisualTimeline';
import SlideEllipseDrawer from './components/SlideEllipseDrawer';
import ImagePreviewModal from './components/ImagePreviewModal';
import MasterPromptModal from './components/MasterPromptModal';
import TextOverlayEditorModal from './components/TextOverlayEditorModal';
import StudioPage from './pages/StudioPage';

// ─── Helpers: blob URL ↔ base64 data URL (for project save/restore) ──────────
async function blobUrlToDataUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function dataUrlToBlobUrl(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const [header, b64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const byteStr = atob(b64);
    const ab = new ArrayBuffer(byteStr.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    return URL.createObjectURL(new Blob([ab], { type: mime }));
  } catch {
    return null;
  }
}

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Tiny, English (fast, rougher)' },
  { id: 'Xenova/whisper-base.en', label: 'Base, English (slower, better)' },
];

function transcribe(samples, model, onStatus) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/whisper.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        const p = data.p;
        if (p.status === 'progress') onStatus(`Downloading model… ${Math.round(p.progress)}%`);
        else if (p.status === 'transcribing') onStatus('Transcribing audio…');
      } else if (data.type === 'done') {
        worker.terminate();
        resolve(data.words);
      } else {
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.postMessage({ audio: samples, model }, [samples.buffer]);
  });
}

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

function createNewSection(index) {
  return {
    id: `sec-${Date.now()}-${index}`,
    title: `Section ${index}`,
    audio: null,
    audioUrl: null,
    duration: 0,
    scriptText: '',
    uploadedDocName: '',
    inputMode: 'doc',
    images: [],
    slidePrompts: {},
    textOverlays: {},
    customTextOverlays: [],
    generatedImages: {},
    manualImages: {},
    slideAnimations: {},
    rows: [],
    slides: [],
    effectiveImageUrls: [],
    isCollapsed: false,
  };
}

export default function App() {
  // ── Page navigation ────────────────────────────────────────────────────────
  const [page, setPage] = useState('maker'); // 'maker' | 'studio'
  const [studioInitialProject, setStudioInitialProject] = useState(null);

  const [projectTitle, setProjectTitle] = useState('My Video Project');
  const [model, setModel] = useState(MODELS[0].id);

  // Aspect Ratio & Layout
  const [aspectRatio, setAspectRatio] = useState('16:9'); // '16:9' | '9:16'

  // Global AI Engine & API Key
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('google_ai_key') || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [imageEngine, setImageEngine] = useState('google-imagen');
  const [visualStyle, setVisualStyle] = useState('cinematic');

  // Animation, Captions & Retention Hooks
  const [animationMode, setAnimationMode] = useState('random');
  const [captionStyle, setCaptionStyle] = useState('modern-card');
  const [hookStyle, setHookStyle] = useState('punch-stamp'); // 'punch-stamp' | 'chapter-pill' | 'bottom-badge' | 'none'

  // Background Music (BGM) & Auto-Ducking
  const [bgmFile, setBgmFile] = useState(null);
  const [bgmUrl, setBgmUrl] = useState(null);
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [autoDuck, setAutoDuck] = useState(true);

  // Multi-Section Video Architecture State
  const [sections, setSections] = useState(() => [createNewSection(1)]);
  const [mergedData, setMergedData] = useState(null);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergedPlaying, setMergedPlaying] = useState(false);
  const [mergedCurrentTime, setMergedCurrentTime] = useState(0);
  const [mergedTextEditorOpen, setMergedTextEditorOpen] = useState(false);
  const [selectedMergedTextOverlayId, setSelectedMergedTextOverlayId] = useState(null);

  // Video Export
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [resolution, setResolution] = useState('720p');

  // Master Prompt In-App Generator Modal
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);

  // Lightbox Modal
  const [previewModalData, setPreviewModalData] = useState(null);

  // Auto-save banner feedback
  const [saveNotice, setSaveNotice] = useState('');

  const mergedAudioRef = useRef(null);
  const mergedBgmAudioRef = useRef(null);
  const mergedCanvasRef = useRef(null);
  const mergedAnimFrameRef = useRef(null);
  const preloadedMergedImagesRef = useRef([]);
  const abortControllerRef = useRef(null);
  const loadFileInputRef = useRef(null);

  // Save API key
  const handleApiKeyChange = (val) => {
    setApiKey(val);
    localStorage.setItem('google_ai_key', val.trim());
    setApiKeyStatus(null);
  };

  const handleVerifyApiKey = async () => {
    if (!apiKey.trim()) {
      setApiKeyStatus({ valid: false, message: 'Please enter an API key first.' });
      return;
    }
    setIsVerifying(true);
    setApiKeyStatus(null);
    try {
      const result = await verifyGoogleApiKey(apiKey);
      setApiKeyStatus(result);
    } catch (e) {
      setApiKeyStatus({ valid: false, message: `Verification error: ${e.message}` });
    } finally {
      setIsVerifying(false);
    }
  };

  // Sections Provision: Adjust number of sections
  const setSectionCount = (targetCount) => {
    const count = Math.max(1, targetCount);
    setSections((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        const next = [...prev];
        for (let i = prev.length + 1; i <= count; i++) {
          next.push(createNewSection(i));
        }
        return next;
      } else {
        return prev.slice(0, count);
      }
    });
  };

  const handleAddSection = () => {
    setSections((prev) => [...prev, createNewSection(prev.length + 1)]);
  };

  const handleRemoveSection = (idx) => {
    if (sections.length <= 1) return;
    setSections((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateSection = (idx, updater) => {
    setSections((prev) => {
      const next = [...prev];
      const current = next[idx];
      next[idx] = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return next;
    });
  };

  // Background Music (BGM) upload
  const handleBgmChange = (file) => {
    if (!file) return;
    setBgmFile(file);
    const url = URL.createObjectURL(file);
    setBgmUrl(url);
  };

  // Preload merged images when mergedData changes
  useEffect(() => {
    if (!mergedData?.effectiveImageUrls) return;
    let active = true;
    preloadImages(mergedData.effectiveImageUrls).then((imgs) => {
      if (active) preloadedMergedImagesRef.current = imgs;
    });
    return () => {
      active = false;
    };
  }, [mergedData?.effectiveImageUrls]);

  // Master Merged Canvas Frame Renderer
  const renderMergedPreview = useCallback(
    (t) => {
      const canvas = mergedCanvasRef.current;
      if (!canvas || !mergedData?.rows?.length) return;
      const ctx = canvas.getContext('2d');
      drawVideoFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        time: t,
        duration: mergedData.duration || 1,
        rows: mergedData.rows,
        slides: mergedData.slides,
        preloadedImages: preloadedMergedImagesRef.current,
        animationMode,
        slideAnimations: mergedData.slideAnimations || {},
        captionStyle,
        hookStyle,
        textOverlays: mergedData.textOverlays || {},
        customTextOverlays: mergedData.customTextOverlays || [],
        title: '',
      });
    },
    [mergedData, animationMode, captionStyle, hookStyle]
  );

  // Playback loop for master merged video
  useEffect(() => {
    if (!mergedPlaying) {
      if (mergedAnimFrameRef.current) cancelAnimationFrame(mergedAnimFrameRef.current);
      renderMergedPreview(mergedCurrentTime);
      if (mergedBgmAudioRef.current) mergedBgmAudioRef.current.pause();
      return;
    }

    if (mergedBgmAudioRef.current && bgmUrl) {
      mergedBgmAudioRef.current.play().catch(() => {});
    }

    function loop() {
      if (mergedAudioRef.current) {
        const t = mergedAudioRef.current.currentTime;
        setMergedCurrentTime(t);
        renderMergedPreview(t);

        // BGM live ducking
        if (mergedBgmAudioRef.current && autoDuck) {
          let isSpeaking = false;
          if (mergedData?.rows) {
            for (let i = 0; i < mergedData.rows.length; i++) {
              const rStart = mergedData.rows[i].start;
              const rEnd = mergedData.rows[i + 1] ? mergedData.rows[i + 1].start : mergedData.duration;
              if (t >= rStart && t <= rEnd) {
                isSpeaking = true;
                break;
              }
            }
          }
          mergedBgmAudioRef.current.volume = isSpeaking ? bgmVolume * 0.25 : bgmVolume;
        }
      }
      mergedAnimFrameRef.current = requestAnimationFrame(loop);
    }

    mergedAnimFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (mergedAnimFrameRef.current) cancelAnimationFrame(mergedAnimFrameRef.current);
    };
  }, [mergedPlaying, renderMergedPreview, mergedCurrentTime, bgmUrl, autoDuck, bgmVolume, mergedData]);

  const handleMergedSeek = (t) => {
    const clamped = Math.max(0, Math.min(mergedData?.duration || 1, t));
    setMergedCurrentTime(clamped);
    if (mergedAudioRef.current) mergedAudioRef.current.currentTime = clamped;
    if (mergedBgmAudioRef.current) mergedBgmAudioRef.current.currentTime = clamped % (mergedBgmAudioRef.current.duration || 1);
    renderMergedPreview(clamped);
  };

  // Merge All Sections into Final Video
  const handleMergeAllSections = async () => {
    const readySections = sections.filter((s) => s.audio && s.rows?.length > 0);
    if (readySections.length === 0) {
      setMergeError(
        'Please ensure at least one section has voice audio and aligned slides before merging.'
      );
      return;
    }

    setMergeError('');
    setIsMerging(true);

    try {
      // 1. Merge audio files sequentially into one seamless WAV Blob
      const audioFiles = readySections.map((s) => s.audio);
      const mergedAudioResult = await mergeAudioFiles(audioFiles);
      if (!mergedAudioResult) {
        throw new Error('Failed to merge audio files.');
      }

      const mergedAudioUrl = URL.createObjectURL(mergedAudioResult.blob);

      // 2. Stitch rows, slides, images, and retention hooks with cumulative time offsets
      const mergedRows = [];
      const mergedSlides = [];
      const mergedImageUrls = [];
      const mergedSlideAnimations = {};
      const mergedTextOverlays = {};
      const mergedCustomTextOverlays = [];
      let globalSlideId = 1;
      let timeOffset = 0;

      readySections.forEach((sec, secIdx) => {
        const secRows = sec.rows || [];
        const secSlides = sec.slides || [];
        const secImages = sec.effectiveImageUrls || [];
        const secOverlays = sec.customTextOverlays || [];

        secOverlays.forEach((o, oIdx) => {
          mergedCustomTextOverlays.push({
            ...o,
            id: `mrg-sec-${secIdx}-${o.id || oIdx}`,
            startTime: Number(((o.startTime ?? 0) + timeOffset).toFixed(2)),
            endTime: Number(((o.endTime ?? 3) + timeOffset).toFixed(2)),
          });
        });

        secRows.forEach((row, rowIdx) => {
          const slide = secSlides[rowIdx] || {};
          const imgUrl = secImages[rowIdx] || null;
          const anim = sec.slideAnimations?.[rowIdx] || 'auto';
          const hook = sec.textOverlays?.[rowIdx] || '';

          mergedRows.push({
            id: globalSlideId,
            start: row.start + timeOffset,
            text: row.text || slide.text || '',
            sectionIndex: secIdx,
            sectionTitle: sec.title || `Section ${secIdx + 1}`,
          });

          mergedSlides.push({
            id: globalSlideId,
            text: slide.text || row.text || '',
            raw: slide.raw || '',
            textOverlay: hook,
            sectionIndex: secIdx,
          });

          mergedImageUrls.push(imgUrl);
          mergedSlideAnimations[globalSlideId - 1] = anim;
          mergedTextOverlays[globalSlideId - 1] = hook;
          globalSlideId++;
        });

        timeOffset += sec.duration;
      });

      setMergedData({
        audioFile: mergedAudioResult.blob,
        audioUrl: mergedAudioUrl,
        duration: mergedAudioResult.duration,
        rows: mergedRows,
        slides: mergedSlides,
        effectiveImageUrls: mergedImageUrls,
        slideAnimations: mergedSlideAnimations,
        textOverlays: mergedTextOverlays,
        customTextOverlays: mergedCustomTextOverlays,
      });

      setTimeout(() => renderMergedPreview(0), 100);
    } catch (err) {
      setMergeError(`Merge failed: ${err.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // Video Export for Merged Video
  const handleExportMergedVideo = async () => {
    if (!mergedData?.audioFile || !mergedData?.rows?.length) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Starting video render…');
    abortControllerRef.current = new AbortController();

    const isVertical = aspectRatio === '9:16';
    let [w, h] = resolution === '1080p' ? [1920, 1080] : [1280, 720];
    if (isVertical) {
      [w, h] = resolution === '1080p' ? [1080, 1920] : [720, 1280];
    }

    try {
      const { blob, filename } = await renderVideo({
        audioFile: mergedData.audioFile,
        rows: mergedData.rows,
        slides: mergedData.slides,
        imageUrls: mergedData.effectiveImageUrls,
        duration: mergedData.duration,
        title: projectTitle,
        width: w,
        height: h,
        fps: 30,
        animationMode,
        slideAnimations: mergedData.slideAnimations,
        captionStyle,
        hookStyle,
        textOverlays: mergedData.textOverlays,
        customTextOverlays: mergedData.customTextOverlays || [],
        bgmFile,
        bgmVolume,
        autoDuck,
        onProgress: (pct, msg) => {
          setExportProgress(pct);
          setExportStatus(msg);
        },
        abortSignal: abortControllerRef.current.signal,
      });

      downloadBlob(blob, filename);
      setExportStatus(`Export complete! Saved as ${filename}`);
    } catch (err) {
      if (err.message !== 'Render cancelled') {
        setExportStatus(`Export error: ${err.message}`);
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Subtitle Exporters for Merged Video
  const handleExportSrt = () => {
    if (!mergedData) return;
    const text = generateSrt(mergedData.rows, mergedData.slides, mergedData.duration);
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.srt`, 'text/plain;charset=utf-8');
  };

  const handleExportVtt = () => {
    if (!mergedData) return;
    const text = generateVtt(mergedData.rows, mergedData.slides, mergedData.duration);
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(text, `${safeTitle}.vtt`, 'text/vtt;charset=utf-8');
  };

  const handleExportJson = () => {
    if (!mergedData) return;
    const json = generateTimelineJson(
      projectTitle,
      mergedData.rows,
      mergedData.slides,
      mergedData.duration,
      [],
      mergedData.slideAnimations
    );
    const safeTitle = (projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(json, `${safeTitle}_timeline.json`, 'application/json;charset=utf-8');
  };

  // Download All Images across all sections
  const handleDownloadAllImages = () => {
    if (!mergedData?.effectiveImageUrls) return;
    mergedData.effectiveImageUrls.forEach((url, idx) => {
      if (!url) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `slide_${idx + 1}.jpg`;
        a.click();
      }, idx * 250);
    });
  };

  // Project Save & Load
  const handleSaveProject = async () => {
    setSaveNotice('⏳ Serializing audio & images…');

    // Serialize each section's audio and images to base64 data URLs
    const serializedSections = await Promise.all(
      sections.map(async (s) => {
        // Audio
        const audioDataUrl = s.audioUrl ? await blobUrlToDataUrl(s.audioUrl) : null;

        // Generated images (AI-produced)
        const generatedImages = {};
        for (const [idx, imgObj] of Object.entries(s.generatedImages || {})) {
          const dataUrl = imgObj?.url ? await blobUrlToDataUrl(imgObj.url) : null;
          if (dataUrl) generatedImages[idx] = { ...imgObj, url: dataUrl };
        }

        // Manual images (user-replaced)
        const manualImages = {};
        for (const [idx, imgObj] of Object.entries(s.manualImages || {})) {
          const dataUrl = imgObj?.url ? await blobUrlToDataUrl(imgObj.url) : null;
          if (dataUrl) manualImages[idx] = { ...imgObj, url: dataUrl };
        }

        return {
          id: s.id,
          title: s.title,
          scriptText: s.scriptText,
          inputMode: s.inputMode,
          slidePrompts: s.slidePrompts,
          textOverlays: s.textOverlays,
          slideAnimations: s.slideAnimations,
          audioDataUrl,
          generatedImages,
          manualImages,
        };
      })
    );

    const projectPayload = {
      version: '2.1',
      savedAt: new Date().toISOString(),
      projectTitle,
      aspectRatio,
      animationMode,
      captionStyle,
      hookStyle,
      imageEngine,
      visualStyle,
      bgmVolume,
      autoDuck,
      sections: serializedSections,
    };

    const json = JSON.stringify(projectPayload, null, 2);
    const safeTitle = (projectTitle || 'project').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
    downloadText(json, `${safeTitle}.videomaker.json`, 'application/json');
    setSaveNotice('✓ Project saved to file!');
    setTimeout(() => setSaveNotice(''), 3000);
  };

  const handleLoadProjectFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be reloaded
    e.target.value = '';

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.projectTitle) setProjectTitle(data.projectTitle);
      if (data.aspectRatio) setAspectRatio(data.aspectRatio);
      if (data.animationMode) setAnimationMode(data.animationMode);
      if (data.captionStyle) setCaptionStyle(data.captionStyle);
      if (data.hookStyle) setHookStyle(data.hookStyle);
      if (data.imageEngine) setImageEngine(data.imageEngine);
      if (data.visualStyle) setVisualStyle(data.visualStyle);
      if (data.bgmVolume != null) setBgmVolume(data.bgmVolume);
      if (data.autoDuck != null) setAutoDuck(data.autoDuck);

      if (Array.isArray(data.sections) && data.sections.length > 0) {
        const restoredSections = data.sections.map((s, idx) => {
          // Restore audio blob URL from base64 data URL
          const audioUrl = s.audioDataUrl ? dataUrlToBlobUrl(s.audioDataUrl) : null;
          const audio = audioUrl ? null : null; // audio Blob not restored (URL is sufficient for playback)

          // Restore generated image URLs
          const generatedImages = {};
          for (const [imgIdx, imgObj] of Object.entries(s.generatedImages || {})) {
            const url = imgObj?.url ? dataUrlToBlobUrl(imgObj.url) : null;
            if (url) generatedImages[imgIdx] = { ...imgObj, url };
          }

          // Restore manual image URLs
          const manualImages = {};
          for (const [imgIdx, imgObj] of Object.entries(s.manualImages || {})) {
            const url = imgObj?.url ? dataUrlToBlobUrl(imgObj.url) : null;
            if (url) manualImages[imgIdx] = { ...imgObj, url };
          }

          return {
            ...createNewSection(idx + 1),
            ...s,
            id: s.id || `sec-${Date.now()}-${idx + 1}`,
            audioUrl,
            generatedImages,
            manualImages,
            // duration will be recalculated when audio loads
          };
        });
        setSections(restoredSections);
      }

      setSaveNotice('✓ Project loaded successfully!');
      setTimeout(() => setSaveNotice(''), 3000);
    } catch (err) {
      alert(`Could not parse project file: ${err.message}`);
    }
  };

  const isVertical = aspectRatio === '9:16';

  // ── Open merged project in Studio ─────────────────────────────────────────
  const handleOpenInStudio = () => {
    if (!mergedData) return;
    setStudioInitialProject({
      aspectRatio,
      duration: mergedData.duration,
      rows: mergedData.rows,
      slides: mergedData.slides,
      imageUrls: mergedData.effectiveImageUrls,
      audioUrl: mergedData.audioUrl,
      bgmUrl: bgmUrl || null,
      bgmVolume,
      autoDuck,
      animationMode,
      captionStyle,
      hookStyle,
      slideAnimations: mergedData.slideAnimations || {},
      textOverlays: mergedData.textOverlays || {},
      layers: [],
      transitions: {},
    });
    setPage('studio');
  };

  // ── Studio Page ────────────────────────────────────────────────────────────
  if (page === 'studio') {
    return (
      <StudioPage
        initialProject={studioInitialProject}
        onBack={() => setPage('maker')}
      />
    );
  }

  return (
    <main>
      {/* App-level Navigation */}
      <div className="app-nav-bar">
        <button
          type="button"
          className={`app-nav-pill ${page === 'maker' ? 'active' : ''}`}
          onClick={() => setPage('maker')}
        >
          🎙️ Video Maker
        </button>
        <button
          type="button"
          className={`app-nav-pill ${page === 'studio' ? 'active' : ''}`}
          onClick={() => {
            if (!studioInitialProject && mergedData) handleOpenInStudio();
            else setPage('studio');
          }}
        >
          🎬 Studio Editor
        </button>
      </div>

      <header>
        <div className="header-badge">Video Maker Studio Pro v2.0</div>
        <h1>Multi-Section Video Maker</h1>
        <p>
          Organize your video into sections, generate character-consistent AI storyboards, apply retention hooks, mix BGM, and export in 16:9 or 9:16 vertical!
        </p>

        {/* Studio Quick Actions Bar */}
        <div className="studio-top-bar">
          <button
            type="button"
            className="primary-btn pulse-glow"
            onClick={() => setIsPromptModalOpen(true)}
          >
            ✨ In-App Master Storyboard Generator
          </button>

          <div className="aspect-ratio-selector">
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8' }}>Format:</span>
            <button
              type="button"
              className={`aspect-pill ${aspectRatio === '16:9' ? 'active' : ''}`}
              onClick={() => setAspectRatio('16:9')}
            >
              🖥️ 16:9 YouTube
            </button>
            <button
              type="button"
              className={`aspect-pill ${aspectRatio === '9:16' ? 'active' : ''}`}
              onClick={() => setAspectRatio('9:16')}
            >
              📱 9:16 TikTok / Shorts
            </button>
          </div>

          <div className="project-file-actions">
            <button
              type="button"
              className="ghost small-btn"
              onClick={handleSaveProject}
              title="Save project to .videomaker.json"
            >
              💾 Save Project
            </button>

            <button
              type="button"
              className="ghost small-btn"
              onClick={() => loadFileInputRef.current?.click()}
              title="Load saved .videomaker.json"
            >
              📂 Load Project
            </button>
            <input
              type="file"
              ref={loadFileInputRef}
              accept=".json,.videomaker.json"
              style={{ display: 'none' }}
              onChange={handleLoadProjectFile}
            />
          </div>
        </div>

        {saveNotice && <div className="status-banner">{saveNotice}</div>}
      </header>

      {/* Global Project Configuration */}
      <section className="global-config-section">
        <div className="section-header-row">
          <div>
            <h2>Global Settings, Audio &amp; Retention Hooks</h2>
            <p className="hint">Configure project metadata, AI image generation, animation, and caption styles.</p>
          </div>
        </div>

        <div className="grid-2">
          <label>
            Project Title:
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              placeholder="e.g. History of Space Exploration"
            />
          </label>

          <label>
            Whisper Speech-to-Text Model:
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Background Music (BGM) & Auto-Ducking Row */}
        <div className="bgm-control-box" style={{ marginTop: '14px' }}>
          <div className="bgm-header-row">
            <span style={{ fontWeight: 700, fontSize: '0.90rem' }}>🎵 Background Music (BGM) Track:</span>
            <label className="autoduck-checkbox">
              <input
                type="checkbox"
                checked={autoDuck}
                onChange={(e) => setAutoDuck(e.target.checked)}
              />
              <span>Auto-Duck (quieter during speech, louder in pauses)</span>
            </label>
          </div>

          <div className="bgm-inputs-row">
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => handleBgmChange(e.target.files[0])}
            />
            {bgmFile && <span className="badge badge-success">✓ {bgmFile.name}</span>}

            <div className="volume-slider-group">
              <span style={{ fontSize: '0.80rem' }}>BGM Vol:</span>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.02"
                value={bgmVolume}
                onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
              />
              <span style={{ fontSize: '0.80rem' }}>{Math.round(bgmVolume * 200)}%</span>
            </div>
          </div>
        </div>

        {/* AI Studio & Engine Row */}
        <div className="image-gen-grid" style={{ marginTop: '14px' }}>
          <label>
            Image Generation Engine:
            <select
              value={imageEngine}
              onChange={(e) => setImageEngine(e.target.value)}
            >
              {IMAGE_ENGINES.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Visual Style Preset:
            <select
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value)}
            >
              {IMAGE_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Google AI Studio API Key with Verify Button */}
        {imageEngine === 'google-imagen' && (
          <div className="api-key-box">
            <label>
              Google AI Studio API Key:
              <div className="api-key-input-row">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="AIzaSy..."
                  className="api-key-input"
                />
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={() => setShowApiKey((v) => !v)}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  className="ghost small-btn"
                  disabled={isVerifying || !apiKey.trim()}
                  onClick={handleVerifyApiKey}
                  title="Test your API key to make sure it works"
                >
                  {isVerifying ? '⏳ Verifying…' : '🔑 Verify'}
                </button>
              </div>
              {apiKeyStatus && (
                <div className={`api-key-status ${apiKeyStatus.valid ? 'valid' : 'invalid'}`}>
                  {apiKeyStatus.message}
                </div>
              )}
              <small>
                Get your key at{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="link-highlight"
                >
                  aistudio.google.com
                </a>{' '}
                (saved in browser localStorage).
              </small>
            </label>
          </div>
        )}

        {/* Global Animation, Subtitles & Retention Hooks */}
        <div className="animation-options-grid" style={{ marginTop: '14px' }}>
          <label>
            Slide Entry Animation Mode:
            <select
              value={animationMode}
              onChange={(e) => setAnimationMode(e.target.value)}
            >
              {ANIMATION_TYPES.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <small className="hint">
              Rules: Entry only (no exit transitions). ≤ 2.5s duration skips animation.
            </small>
          </label>

          <label>
            Caption / Subtitle Style:
            <select
              value={captionStyle}
              onChange={(e) => setCaptionStyle(e.target.value)}
            >
              {CAPTION_STYLES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Kinetic Retention Hook Style:
            <select
              value={hookStyle}
              onChange={(e) => setHookStyle(e.target.value)}
            >
              {HOOK_STYLES.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
            <small className="hint">
              Pops bold hook keywords on-screen for the first 1.8s of each slide.
            </small>
          </label>
        </div>
      </section>

      {/* Sections Control Panel */}
      <section className="sections-control-panel">
        <div className="sections-control-header">
          <div>
            <h2>Video Sections ({sections.length})</h2>
            <p className="hint">
              Each section has its own voiceover, script, images, and video preview.
            </p>
          </div>

          <button
            type="button"
            className="add-section-btn"
            onClick={handleAddSection}
            title="Add a new section"
          >
            + Add New Section
          </button>
        </div>

        {/* Quick Section Count Selector Pills */}
        <div className="section-selector-pills">
          <span style={{ fontSize: '0.82rem', color: '#94a3b8', marginRight: '4px' }}>
            Quick Count:
          </span>
          {[1, 2, 3, 4, 5, 6].map((num) => (
            <button
              key={num}
              type="button"
              className={`section-count-pill ${sections.length === num ? 'active' : ''}`}
              onClick={() => setSectionCount(num)}
            >
              {num} {num === 1 ? 'Section' : 'Sections'}
            </button>
          ))}
        </div>
      </section>

      {/* Section Editors List */}
      <div className="sections-container">
        {sections.map((section, idx) => (
          <SectionEditor
            key={section.id}
            section={section}
            sectionIndex={idx}
            totalSections={sections.length}
            apiKey={apiKey}
            imageEngine={imageEngine}
            visualStyle={visualStyle}
            animationMode={animationMode}
            captionStyle={captionStyle}
            hookStyle={hookStyle}
            aspectRatio={aspectRatio}
            whisperModel={model}
            transcribeFn={transcribe}
            onUpdateSection={(updater) => handleUpdateSection(idx, updater)}
            onRemoveSection={() => handleRemoveSection(idx)}
            onPreviewImage={(url, title) => setPreviewModalData({ url, title })}
          />
        ))}
      </div>

      {/* Big Action Bar: Merge All Sections into Final Video */}
      <div className="merge-action-card">
        <button
          type="button"
          className="big-merge-btn"
          disabled={isMerging}
          onClick={handleMergeAllSections}
        >
          {isMerging ? '⏳ Merging Audio & Slides…' : '🎬 Merge All Sections into Final Video'}
        </button>
        <p className="hint" style={{ marginTop: '8px' }}>
          Stitches voice recordings, timestamps, slides, retention hooks, and visuals of all {sections.length} sections into one master video.
        </p>
        {mergeError && <div className="error-banner">{mergeError}</div>}
      </div>

      {/* Master Merged Final Video Studio */}
      {mergedData && (
        <section className="merged-studio-section">
          <div className="merged-header-bar">
            <div>
              <h2>🌟 Master Merged Video Studio ({aspectRatio})</h2>
              <span className="badge badge-success">
                {mergedData.rows.length} Total Slides • {fmt(mergedData.duration)} Total Duration
              </span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                type="button"
                className="secondary-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setMergedTextEditorOpen(true)}
                title="Add and decorate multiple text overlays on the timeline"
              >
                ✨ Text Overlays {mergedData.customTextOverlays?.length ? `(${mergedData.customTextOverlays.length})` : ''}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handleOpenInStudio}
                title="Open this merged video in the full Studio Editor"
              >
                🎬 Open in Studio Editor
              </button>
            </div>
          </div>

          <p className="hint">
            All sections have been concatenated seamlessly! Preview the complete video, scrub through the master timeline, or export in full quality.
          </p>

          {/* Master Canvas Video Preview */}
          <div className={`video-player-frame ${isVertical ? 'vertical-frame' : ''}`}>
            <canvas
              ref={mergedCanvasRef}
              width={isVertical ? 720 : 1280}
              height={isVertical ? 1280 : 720}
              className={`preview-canvas ${isVertical ? 'vertical-canvas' : ''}`}
            />
          </div>

          {/* Hidden Audio Players for Merged Playback */}
          {mergedData.audioUrl && (
            <audio
              ref={mergedAudioRef}
              src={mergedData.audioUrl}
              onPlay={() => setMergedPlaying(true)}
              onPause={() => setMergedPlaying(false)}
              onEnded={() => setMergedPlaying(false)}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setMergedCurrentTime(t);
                if (!mergedPlaying) renderMergedPreview(t);
              }}
              style={{ display: 'none' }}
            />
          )}

          {bgmUrl && (
            <audio
              ref={mergedBgmAudioRef}
              src={bgmUrl}
              loop
              style={{ display: 'none' }}
            />
          )}

          {/* Master Visual Timeline */}
          <VisualTimeline
            rows={mergedData.rows}
            slides={mergedData.slides}
            duration={mergedData.duration}
            currentTime={mergedCurrentTime}
            isPlaying={mergedPlaying}
            imageUrls={mergedData.effectiveImageUrls}
            animationMode={animationMode}
            slideAnimations={mergedData.slideAnimations}
            onSeek={handleMergedSeek}
            onTogglePlay={() => {
              if (mergedAudioRef.current) {
                if (mergedAudioRef.current.paused) mergedAudioRef.current.play();
                else mergedAudioRef.current.pause();
              }
            }}
            onUpdateRows={(newRows, newDuration) => {
              setMergedData(prev => prev ? ({ ...prev, rows: newRows, duration: newDuration }) : prev);
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
            customTextOverlays={mergedData.customTextOverlays || []}
            selectedTextOverlayId={selectedMergedTextOverlayId}
            onSelectTextOverlay={setSelectedMergedTextOverlayId}
            onOpenTextEditor={() => setMergedTextEditorOpen(true)}
            onAddTextOverlay={(t) => {
              const newO = createDefaultTextOverlay(t, `HOOK #${(mergedData.customTextOverlays?.length || 0) + 1}`);
              const nextList = [...(mergedData.customTextOverlays || []), newO];
              setMergedData(prev => ({ ...prev, customTextOverlays: nextList }));
              setSelectedMergedTextOverlayId(newO.id);
              setMergedTextEditorOpen(true);
              setTimeout(() => renderMergedPreview(t), 20);
            }}
            onUpdateCustomTextOverlays={(nextList) => {
              setMergedData(prev => ({ ...prev, customTextOverlays: nextList }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
          />

          {/* Master Slide Ellipse Drawer with Manual Replace Option & Hooks */}
          <SlideEllipseDrawer
            drawerTitle="Master Slides, Hooks &amp; Visuals Shelf"
            rows={mergedData.rows}
            slides={mergedData.slides}
            duration={mergedData.duration}
            currentTime={mergedCurrentTime}
            effectiveImageUrls={mergedData.effectiveImageUrls}
            generatedImages={{}}
            manualImages={{}}
            animationMode={animationMode}
            slideAnimations={mergedData.slideAnimations}
            slidePrompts={{}}
            textOverlays={mergedData.textOverlays || {}}
            onSetSlideAnimation={(idx, anim) => {
              setMergedData((prev) => ({
                ...prev,
                slideAnimations: { ...prev.slideAnimations, [idx]: anim },
              }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
            onSetSlidePrompt={() => {}}
            onSetTextOverlay={(idx, hook) => {
              setMergedData((prev) => ({
                ...prev,
                textOverlays: { ...(prev.textOverlays || {}), [idx]: hook },
              }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
            onGenerateSlideImage={() => {}}
            onReplaceSlideImage={(idx, file) => {
              const url = URL.createObjectURL(file);
              setMergedData((prev) => {
                const nextUrls = [...prev.effectiveImageUrls];
                nextUrls[idx] = url;
                return { ...prev, effectiveImageUrls: nextUrls };
              });
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 30);
            }}
            onPreviewImage={(idx) => {
              const url = mergedData.effectiveImageUrls[idx];
              if (url) setPreviewModalData({ url, title: `Merged Slide #${idx + 1}` });
            }}
            onSeek={handleMergedSeek}
          />

          {/* Master Text Overlay Editor Modal */}
          <TextOverlayEditorModal
            isOpen={mergedTextEditorOpen}
            onClose={() => setMergedTextEditorOpen(false)}
            currentTime={mergedCurrentTime}
            duration={mergedData.duration || 1}
            overlays={mergedData.customTextOverlays || []}
            onChangeOverlays={(nextList) => {
              setMergedData(prev => ({ ...prev, customTextOverlays: nextList }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
            selectedOverlayId={selectedMergedTextOverlayId}
            onSelectOverlay={setSelectedMergedTextOverlayId}
            onSeek={handleMergedSeek}
          />

          {/* Master Export Controls */}
          <div className="export-controls-bar" style={{ marginTop: '24px' }}>
            <div className="export-options-row">
              <label>
                Export Resolution:
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={isExporting}
                >
                  <option value="720p">720p HD ({isVertical ? '720x1280' : '1280x720'})</option>
                  <option value="1080p">1080p Full HD ({isVertical ? '1080x1920' : '1920x1080'})</option>
                </select>
              </label>

              <button
                type="button"
                className="primary-btn export-btn"
                disabled={isExporting}
                onClick={handleExportMergedVideo}
              >
                {isExporting ? '⏳ Rendering Video…' : `📥 Export ${aspectRatio} Video`}
              </button>

              <button
                type="button"
                className="ghost"
                onClick={handleExportSrt}
              >
                📄 Subtitles (.srt)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleExportVtt}
              >
                📄 Subtitles (.vtt)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleExportJson}
              >
                📊 Timeline (.json)
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleDownloadAllImages}
              >
                💾 Download All Images
              </button>
            </div>

            {isExporting && (
              <div className="export-progress-panel">
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill animated"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <div className="export-progress-info">
                  <span>{exportStatus}</span>
                  <strong>{exportProgress}%</strong>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* In-App Master Storyboard & Prompt Generator Modal */}
      <MasterPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        sections={sections}
        activeSectionIndex={0}
        onApplyToSection={(sectionIdx, data) => {
          handleUpdateSection(sectionIdx, (prev) => ({
            ...prev,
            scriptText: data.scriptText,
            uploadedDocName: data.uploadedDocName || prev.uploadedDocName,
            slidePrompts: { ...(prev.slidePrompts || {}), ...(data.slidePrompts || {}) },
            textOverlays: { ...(prev.textOverlays || {}), ...(data.textOverlays || {}) },
            rows: [],
          }));
          setSaveNotice(`✓ Storyboard & Prompts applied to Section #${sectionIdx + 1}!`);
          setTimeout(() => setSaveNotice(''), 3500);
        }}
      />

      {/* Full-Screen Image Lightbox Modal */}
      {previewModalData && (
        <ImagePreviewModal
          isOpen={Boolean(previewModalData)}
          images={[previewModalData.url]}
          currentIndex={0}
          onClose={() => setPreviewModalData(null)}
          onSelectIndex={() => {}}
        />
      )}
    </main>
  );
}
