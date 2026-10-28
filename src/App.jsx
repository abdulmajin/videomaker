import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { decodeAudio } from './lib/audio';
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
import VideoTextCanvasInteractiveLayer from './components/VideoTextCanvasInteractiveLayer';
import StudioPage from './pages/StudioPage';
import RecoveryBanner, { autosaveLabel } from './components/RecoveryBanner';
import { getSnapshotInfo, loadSnapshot, deleteSnapshot } from './lib/autosave';
import { useAutosave } from './lib/useAutosave';
import { useUndoHistory } from './lib/useUndoHistory';
import { COLOR_GRADES, DEFAULT_BRAND, buildChapters, loadImage } from './lib/frameExtras';
import { SFX_MODES } from './lib/sfx';
import { supportsFastExport } from './lib/fastExport';
import { mergeSections, isReadySection, dataUrlToBlob, overlaysToStudioLayers } from './lib/mergeSections';

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

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
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

export function getDefaultSectionTitle(index) {
  return index === 0 ? 'Intro' : `Section ${index}`;
}

function createNewSection(index) {
  return {
    id: `sec-${Date.now()}-${index}`,
    title: getDefaultSectionTitle(index),
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

// Two Maker snapshots are "the same" when nothing but SectionEditor's derived
// fields (slides, effectiveImageUrls) changed — those updates aren't user edits.
const DERIVED_SECTION_KEYS = new Set(['slides', 'effectiveImageUrls']);
function undoSnapshotsEqual(a, b) {
  for (const key of Object.keys(a)) {
    if (key === 'sections') continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((sa, i) => {
    const sb = b.sections[i];
    if (sa === sb) return true;
    const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
    for (const k of keys) if (!DERIVED_SECTION_KEYS.has(k) && !Object.is(sa[k], sb[k])) return false;
    return true;
  });
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

  // Look, Brand Kit & Sound Effects
  const [colorGrade, setColorGrade] = useState('none');
  const [brand, setBrand] = useState(() => ({ ...DEFAULT_BRAND, logoFile: null }));
  const [sfx, setSfx] = useState({ mode: 'none', volume: 0.6 });
  const [chapters, setChapters] = useState(null); // { text, warnings }

  // Background Music (BGM) & Auto-Ducking
  const [bgmFile, setBgmFile] = useState(null);
  const [bgmUrl, setBgmUrl] = useState(null);
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [autoDuck, setAutoDuck] = useState(true);

  // Multi-Section Video Architecture State (starts with Intro)
  const [sections, setSections] = useState(() => [createNewSection(0)]);
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
  const [mergedImagesReady, setMergedImagesReady] = useState(0);
  const abortControllerRef = useRef(null);
  const loadFileInputRef = useRef(null);

  // Brand logo → object URL → decoded image for the canvas renderers
  const logoUrl = useMemo(() => (brand.logoFile ? URL.createObjectURL(brand.logoFile) : null), [brand.logoFile]);
  const [logoImg, setLogoImg] = useState(null);
  useEffect(() => {
    let active = true;
    loadImage(logoUrl).then((img) => { if (active) setLogoImg(img); });
    return () => { active = false; };
  }, [logoUrl]);
  const look = useMemo(() => ({ colorGrade, brand, logoImg }), [colorGrade, brand, logoImg]);
  const updateBrand = (changes) => setBrand((b) => ({ ...b, ...changes }));

  // ── Autosave & crash recovery (IndexedDB) ──────────────────────────────────
  // 'checking' → looking for a snapshot; 'prompt' → asking the user; 'ready' → autosaving
  const [recovery, setRecovery] = useState({ phase: 'checking', info: null, busy: false });

  useEffect(() => {
    getSnapshotInfo('maker')
      .then((info) => setRecovery({ phase: info?.meta?.hasContent ? 'prompt' : 'ready', info, busy: false }))
      .catch((err) => {
        console.warn('Autosave unavailable:', err);
        setRecovery({ phase: 'unavailable', info: null, busy: false });
      });
  }, []);

  // Derived fields (slides, effectiveImageUrls) are rebuilt by SectionEditor, and
  // blob URLs that just point at a stored File are recreated on restore.
  const makerSnapshot = useMemo(() => ({
    projectTitle, model, aspectRatio, imageEngine, visualStyle,
    animationMode, captionStyle, hookStyle, resolution, colorGrade, brand, sfx,
    bgmFile, bgmUrl: bgmFile ? null : bgmUrl, bgmVolume, autoDuck,
    sections: sections.map(({ slides, effectiveImageUrls, ...s }) => ({
      ...s,
      audioUrl: s.audio ? null : s.audioUrl,
    })),
    mergedData: mergedData ? { ...mergedData, audioFile: null } : null,
  }), [projectTitle, model, aspectRatio, imageEngine, visualStyle, animationMode, captionStyle,
    hookStyle, resolution, colorGrade, brand, sfx, bgmFile, bgmUrl, bgmVolume, autoDuck, sections, mergedData]);

  const makerAutosave = useAutosave({
    key: 'maker',
    data: makerSnapshot,
    meta: {
      title: projectTitle,
      sectionCount: sections.length,
      // An untouched default project isn't worth a recovery prompt
      hasContent: projectTitle !== 'My Video Project' || !!bgmFile || !!mergedData || sections.some((s) =>
        s.scriptText || s.audio || s.audioUrl || s.images?.length || s.customTextOverlays?.length
        || Object.keys(s.generatedImages || {}).length || Object.keys(s.manualImages || {}).length),
    },
    enabled: recovery.phase === 'ready',
  });

  const handleRestoreAutosave = async () => {
    setRecovery((r) => ({ ...r, busy: true }));
    try {
      const snap = await loadSnapshot('maker');
      const d = snap?.data;
      if (d) {
        if (d.projectTitle) setProjectTitle(d.projectTitle);
        if (d.model) setModel(d.model);
        if (d.aspectRatio) setAspectRatio(d.aspectRatio);
        if (d.imageEngine) setImageEngine(d.imageEngine);
        if (d.visualStyle) setVisualStyle(d.visualStyle);
        if (d.animationMode) setAnimationMode(d.animationMode);
        if (d.captionStyle) setCaptionStyle(d.captionStyle);
        if (d.hookStyle) setHookStyle(d.hookStyle);
        if (d.resolution) setResolution(d.resolution);
        if (d.colorGrade) setColorGrade(d.colorGrade);
        if (d.brand) setBrand({ ...DEFAULT_BRAND, logoFile: null, ...d.brand });
        if (d.sfx) setSfx(d.sfx);
        if (d.bgmVolume != null) setBgmVolume(d.bgmVolume);
        if (d.autoDuck != null) setAutoDuck(d.autoDuck);
        if (d.bgmFile) {
          setBgmFile(d.bgmFile);
          setBgmUrl(URL.createObjectURL(d.bgmFile));
        } else if (d.bgmUrl) {
          setBgmUrl(d.bgmUrl);
        }
        if (Array.isArray(d.sections) && d.sections.length > 0) {
          setSections(d.sections.map((s, idx) => ({
            ...createNewSection(idx),
            ...s,
            images: (s.images || []).filter(Boolean),
            audioUrl: s.audio ? URL.createObjectURL(s.audio) : s.audioUrl,
          })));
        }
        if (d.mergedData?.audioUrl) {
          const audioFile = await (await fetch(d.mergedData.audioUrl)).blob();
          setMergedData({ ...d.mergedData, audioFile });
        }
      }
      setRecovery({ phase: 'ready', info: null, busy: false });
      history.reset();
      setSaveNotice('✓ Restored your autosaved project');
      setTimeout(() => setSaveNotice(''), 3000);
    } catch (err) {
      console.error('Restore failed:', err);
      setRecovery((r) => ({ ...r, busy: false }));
      alert(`Could not restore the autosaved project: ${err.message}`);
    }
  };

  const handleDiscardAutosave = async () => {
    setRecovery((r) => ({ ...r, busy: true }));
    await deleteSnapshot('maker').catch((err) => console.warn('Discard failed:', err));
    setRecovery({ phase: 'ready', info: null, busy: false });
  };

  // ── Undo / redo for the Maker page ─────────────────────────────────────────
  const undoSnapshot = useMemo(() => ({
    projectTitle, aspectRatio, animationMode, captionStyle, hookStyle, colorGrade, brand, sfx,
    bgmFile, bgmUrl, bgmVolume, autoDuck, sections, mergedData,
  }), [projectTitle, aspectRatio, animationMode, captionStyle, hookStyle, colorGrade, brand, sfx,
    bgmFile, bgmUrl, bgmVolume, autoDuck, sections, mergedData]);

  const applyUndoSnapshot = useCallback((snap) => {
    setProjectTitle(snap.projectTitle);
    setAspectRatio(snap.aspectRatio);
    setAnimationMode(snap.animationMode);
    setCaptionStyle(snap.captionStyle);
    setHookStyle(snap.hookStyle);
    setColorGrade(snap.colorGrade);
    setBrand(snap.brand);
    setSfx(snap.sfx);
    setBgmFile(snap.bgmFile);
    setBgmUrl(snap.bgmUrl);
    setBgmVolume(snap.bgmVolume);
    setAutoDuck(snap.autoDuck);
    setMergedData(snap.mergedData);
    // Keep SectionEditor's derived fields; it recomputes them when their inputs change
    setSections((cur) => snap.sections.map((sec) => {
      const live = cur.find((c) => c.id === sec.id);
      return live ? { ...sec, slides: live.slides, effectiveImageUrls: live.effectiveImageUrls } : sec;
    }));
  }, []);

  const history = useUndoHistory(undoSnapshot, applyUndoSnapshot, undoSnapshotsEqual);

  useEffect(() => {
    if (page !== 'maker') return undefined;
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); history.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, history]);

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

  // Sections Provision: Adjust number of sections (Intro, Section 1, Section 2, ..., Section 5)
  const setSectionCount = (targetCount) => {
    const count = Math.max(1, targetCount);
    setSections((prev) => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        const next = [...prev];
        for (let i = prev.length; i < count; i++) {
          next.push(createNewSection(i));
        }
        return next;
      } else {
        return prev.slice(0, count);
      }
    });
  };

  const handleAddSection = () => {
    setSections((prev) => [...prev, createNewSection(prev.length)]);
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
      if (!active) return;
      preloadedMergedImagesRef.current = imgs;
      setMergedImagesReady((n) => n + 1);
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
        words: mergedData.words || [],
        colorGrade,
        slideFilters: mergedData.slideFilters || {},
        brand,
        logoImg,
      });
    },
    [mergedData, animationMode, captionStyle, hookStyle, colorGrade, brand, logoImg, mergedImagesReady] // eslint-disable-line react-hooks/exhaustive-deps
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
    if (!sections.some(isReadySection)) {
      setMergeError(
        'Please ensure at least one section has voice audio and aligned slides before merging.'
      );
      return;
    }

    setMergeError('');
    setIsMerging(true);

    try {
      setMergedData(await mergeSections(sections));
      setChapters(null);
      setTimeout(() => renderMergedPreview(0), 100);
    } catch (err) {
      setMergeError(`Merge failed: ${err.message}`);
    } finally {
      setIsMerging(false);
    }
  };

  // Video Export for Merged Video
  // formats: list of aspect ratios to render, e.g. ['16:9'] or ['16:9', '9:16']
  const handleExportMergedVideo = async (formats = [aspectRatio]) => {
    if (!mergedData?.audioFile || !mergedData?.rows?.length) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Starting video render…');
    abortControllerRef.current = new AbortController();
    const saved = [];

    try {
      for (let fi = 0; fi < formats.length; fi++) {
        const fmtRatio = formats[fi];
        const vertical = fmtRatio === '9:16';
        let [w, h] = resolution === '1080p' ? [1920, 1080] : [1280, 720];
        if (vertical) [w, h] = resolution === '1080p' ? [1080, 1920] : [720, 1280];
        const label = formats.length > 1 ? `[${fi + 1}/${formats.length} · ${fmtRatio}] ` : '';
        const suffix = formats.length > 1 ? (vertical ? '_vertical' : '_widescreen') : '';

        const { blob, filename } = await renderVideo({
          audioFile: mergedData.audioFile,
          rows: mergedData.rows,
          slides: mergedData.slides,
          imageUrls: mergedData.effectiveImageUrls,
          duration: mergedData.duration,
          title: `${projectTitle}${suffix}`,
          width: w,
          height: h,
          fps: 30,
          animationMode,
          slideAnimations: mergedData.slideAnimations,
          captionStyle,
          hookStyle,
          textOverlays: mergedData.textOverlays,
          // Overlays were placed for the current format; skip them on the other one
          customTextOverlays: fmtRatio === aspectRatio ? mergedData.customTextOverlays || [] : [],
          bgmFile,
          bgmVolume,
          autoDuck,
          words: mergedData.words || [],
          colorGrade,
          slideFilters: mergedData.slideFilters || {},
          brand,
          logoImg,
          sfx,
          onProgress: (pct, msg) => {
            setExportProgress(Math.round((fi * 100 + pct) / formats.length));
            setExportStatus(label + msg);
          },
          abortSignal: abortControllerRef.current.signal,
        });

        downloadBlob(blob, filename);
        saved.push(filename);
      }
      setExportStatus(`Export complete! Saved as ${saved.join(', ')}`);
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

  // YouTube chapters (one per section)
  const handleBuildChapters = () => {
    if (!mergedData) return;
    setChapters(buildChapters(mergedData.rows, mergedData.duration));
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

        // Images actually shown per slide, and the uploaded originals
        const effectiveImageDataUrls = await Promise.all(
          (s.effectiveImageUrls || []).map((u) => (u ? blobUrlToDataUrl(u) : null))
        );
        const uploadedImages = await Promise.all(
          (s.images || []).map(async (f) => ({ name: f.name, type: f.type, dataUrl: await blobToDataUrl(f) }))
        );

        return {
          id: s.id,
          title: s.title,
          scriptText: s.scriptText,
          inputMode: s.inputMode,
          uploadedDocName: s.uploadedDocName,
          slidePrompts: s.slidePrompts,
          textOverlays: s.textOverlays,
          slideAnimations: s.slideAnimations,
          slideFilters: s.slideFilters,
          customTextOverlays: s.customTextOverlays,
          audioDataUrl,
          duration: s.duration,
          rows: s.rows,
          words: s.words,
          generatedImages,
          manualImages,
          effectiveImageDataUrls,
          uploadedImages,
        };
      })
    );

    const projectPayload = {
      version: '2.2',
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
      bgmName: bgmFile?.name || '',
      bgmDataUrl: bgmFile ? await blobToDataUrl(bgmFile) : null,
      colorGrade,
      sfx,
      brand: { ...brand, logoFile: null, logoName: brand.logoFile?.name || '' },
      logoDataUrl: brand.logoFile ? await blobToDataUrl(brand.logoFile) : null,
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
      if (data.colorGrade) setColorGrade(data.colorGrade);
      if (data.sfx) setSfx(data.sfx);
      const bgmBlob = dataUrlToBlob(data.bgmDataUrl);
      if (bgmBlob) {
        const f = new File([bgmBlob], data.bgmName || 'music', { type: bgmBlob.type });
        setBgmFile(f);
        setBgmUrl(URL.createObjectURL(f));
      }
      if (data.brand) {
        const logoBlob = dataUrlToBlob(data.logoDataUrl);
        setBrand({
          ...DEFAULT_BRAND,
          ...data.brand,
          logoFile: logoBlob ? new File([logoBlob], data.brand.logoName || 'logo', { type: logoBlob.type }) : null,
        });
      }
      setMergedData(null);

      if (Array.isArray(data.sections) && data.sections.length > 0) {
        const restoredSections = data.sections.map((s, idx) => {
          // Restore the voice audio as a Blob (merging needs it) plus a playback URL
          const audio = dataUrlToBlob(s.audioDataUrl);
          const audioUrl = audio ? URL.createObjectURL(audio) : null;
          const images = (s.uploadedImages || [])
            .map((img) => {
              const b = dataUrlToBlob(img.dataUrl);
              return b ? new File([b], img.name, { type: img.type || b.type }) : null;
            })
            .filter(Boolean);

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
            ...createNewSection(idx),
            ...s,
            id: s.id || `sec-${Date.now()}-${idx}`,
            audio,
            audioUrl,
            images,
            rows: s.rows || [],
            words: s.words || [],
            duration: s.duration || 0,
            effectiveImageDataUrls: undefined,
            uploadedImages: undefined,
            audioDataUrl: undefined,
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
  // Which merged data the Studio was last opened with (so edits trigger a fresh hand-off)
  const studioSourceRef = useRef(null);

  const handleOpenInStudio = (source) => {
    const data = source && source.rows ? source : mergedData;
    if (!data) return;
    studioSourceRef.current = data;
    setStudioInitialProject({
      name: projectTitle || 'Untitled project',
      aspectRatio,
      duration: data.duration,
      rows: data.rows,
      slides: data.slides,
      imageUrls: data.effectiveImageUrls,
      audioUrl: data.audioUrl,
      bgmUrl: bgmUrl || null,
      bgmName: bgmFile?.name || '',
      bgmVolume,
      autoDuck,
      animationMode,
      captionStyle,
      hookStyle,
      slideAnimations: data.slideAnimations || {},
      textOverlays: data.textOverlays || {},
      // Text overlays placed in the Maker become editable Studio text layers
      layers: overlaysToStudioLayers(data.customTextOverlays || []),
      transitions: {},
      words: data.words || [],
      colorGrade,
      slideFilters: data.slideFilters || {},
      brand: { ...brand, logoFile: null },
      logoUrl,
      sfx,
      // Identifies this hand-off so Studio can tell "returning to the same
      // session" (restore its autosave silently) from "opened a new project".
      _openedAt: Date.now(),
    });
    setPage('studio');
  };

  // Top nav "Studio Editor": always show the current project. Merges first when
  // sections are aligned but haven't been merged yet (e.g. right after loading a file).
  const handleGoToStudio = async () => {
    let data = mergedData;
    if (!data && sections.some(isReadySection)) {
      try {
        setSaveNotice('⏳ Merging sections for the Studio…');
        data = await mergeSections(sections);
        setMergedData(data);
        setSaveNotice('');
      } catch (err) {
        setSaveNotice(`⚠ Could not merge sections: ${err.message}`);
        setTimeout(() => setSaveNotice(''), 5000);
      }
    }
    if (data && studioSourceRef.current !== data) handleOpenInStudio(data);
    else setPage('studio');
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
          onClick={handleGoToStudio}
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
              onClick={history.undo}
              disabled={!history.canUndo}
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="ghost small-btn"
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Redo (Ctrl+Y)"
            >
              ↷ Redo
            </button>
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
            {autosaveLabel(makerAutosave) && (
              <span className="autosave-hint">{autosaveLabel(makerAutosave)}</span>
            )}
          </div>
        </div>

        {recovery.phase === 'prompt' && (
          <RecoveryBanner
            what="project"
            detail={[recovery.info?.meta?.title, recovery.info?.meta?.sectionCount && `${recovery.info.meta.sectionCount} section(s)`].filter(Boolean).join(' · ')}
            savedAt={recovery.info?.savedAt}
            busy={recovery.busy}
            onRestore={handleRestoreAutosave}
            onDiscard={handleDiscardAutosave}
          />
        )}
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

      {/* Look, Brand Kit & Sound */}
      <section className="global-config-section">
        <div className="section-header-row">
          <div>
            <h2>Look, Brand Kit &amp; Sound Effects</h2>
            <p className="hint">Applied to every preview and export. Per-slide colour grades can be set in each slide shelf.</p>
          </div>
        </div>

        <div className="animation-options-grid">
          <label>
            Color Grade (all slides):
            <select value={colorGrade} onChange={(e) => setColorGrade(e.target.value)}>
              {COLOR_GRADES.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </select>
          </label>

          <label>
            Sound Effects:
            <select value={sfx.mode} onChange={(e) => setSfx((x) => ({ ...x, mode: e.target.value }))}>
              {SFX_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {sfx.mode !== 'none' && (
              <span className="inline-range">
                <input
                  type="range" min="0" max="1" step="0.05" value={sfx.volume}
                  onChange={(e) => setSfx((x) => ({ ...x, volume: parseFloat(e.target.value) }))}
                />
                <small>{Math.round(sfx.volume * 100)}%</small>
              </span>
            )}
            <small className="hint">Synthesized whooshes/pops, mixed into the export.</small>
          </label>

          <label>
            End Card Text (last seconds):
            <input
              value={brand.endCardText}
              onChange={(e) => updateBrand({ endCardText: e.target.value })}
              placeholder="e.g. Subscribe for more!"
            />
            {brand.endCardText.trim() && (
              <span className="inline-range">
                <input
                  type="range" min="2" max="8" step="0.5" value={brand.endCardSeconds}
                  onChange={(e) => updateBrand({ endCardSeconds: parseFloat(e.target.value) })}
                />
                <small>{brand.endCardSeconds}s</small>
                <input
                  type="color" value={brand.accentColor} title="End card colour"
                  onChange={(e) => updateBrand({ accentColor: e.target.value })}
                />
              </span>
            )}
          </label>
        </div>

        <div className="bgm-control-box" style={{ marginTop: '14px' }}>
          <div className="bgm-header-row">
            <span style={{ fontWeight: 700, fontSize: '0.90rem' }}>🏷️ Logo Watermark:</span>
            {brand.logoFile && (
              <button type="button" className="ghost small-btn" onClick={() => updateBrand({ logoFile: null })}>
                Remove logo
              </button>
            )}
          </div>
          <div className="bgm-inputs-row">
            <input type="file" accept="image/*" onChange={(e) => e.target.files[0] && updateBrand({ logoFile: e.target.files[0] })} />
            {brand.logoFile && <span className="badge badge-success">✓ {brand.logoFile.name}</span>}
            {brand.logoFile && (
              <>
                <select value={brand.logoPosition} onChange={(e) => updateBrand({ logoPosition: e.target.value })}>
                  <option value="top-left">↖ Top left</option>
                  <option value="top-right">↗ Top right</option>
                  <option value="bottom-left">↙ Bottom left</option>
                  <option value="bottom-right">↘ Bottom right</option>
                </select>
                <div className="volume-slider-group">
                  <span style={{ fontSize: '0.80rem' }}>Size:</span>
                  <input type="range" min="0.05" max="0.3" step="0.01" value={brand.logoSize}
                    onChange={(e) => updateBrand({ logoSize: parseFloat(e.target.value) })} />
                  <span style={{ fontSize: '0.80rem' }}>Opacity:</span>
                  <input type="range" min="0.2" max="1" step="0.05" value={brand.logoOpacity}
                    onChange={(e) => updateBrand({ logoOpacity: parseFloat(e.target.value) })} />
                </div>
              </>
            )}
          </div>
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
              {num === 1 ? '1 (Intro)' : num === 6 ? '6 (Intro + 1-5)' : `${num} Sections`}
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
            look={look}
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
                onClick={() => handleOpenInStudio()}
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
            {/* Direct On-Screen Click & Drag Interaction Layer */}
            <VideoTextCanvasInteractiveLayer
              canvasRef={mergedCanvasRef}
              currentTime={mergedCurrentTime}
              overlays={mergedData.customTextOverlays || []}
              selectedOverlayId={selectedMergedTextOverlayId}
              onSelectOverlay={setSelectedMergedTextOverlayId}
              onUpdateOverlays={(nextList) => {
                setMergedData((prev) => ({ ...prev, customTextOverlays: nextList }));
                setTimeout(() => renderMergedPreview(mergedCurrentTime), 10);
              }}
              onOpenEditor={(targetId) => {
                if (targetId) setSelectedMergedTextOverlayId(targetId);
                setMergedTextEditorOpen(true);
              }}
              isVertical={isVertical}
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
            slideFilters={mergedData.slideFilters || {}}
            onSetSlideFilter={(idx, grade) => {
              setMergedData((prev) => ({ ...prev, slideFilters: { ...(prev.slideFilters || {}), [idx]: grade } }));
              setTimeout(() => renderMergedPreview(mergedCurrentTime), 20);
            }}
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
            isVertical={isVertical}
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
                onClick={() => handleExportMergedVideo()}
              >
                {isExporting ? '⏳ Rendering Video…' : `📥 Export ${aspectRatio} Video`}
              </button>

              <button
                type="button"
                className="secondary-btn"
                disabled={isExporting}
                onClick={() => handleExportMergedVideo(['16:9', '9:16'])}
                title="Render a 16:9 widescreen and a 9:16 vertical version one after the other"
              >
                🎞️ Export 16:9 + 9:16
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
                onClick={handleBuildChapters}
                title="Timestamps for your YouTube description, one chapter per section"
              >
                📑 YouTube Chapters
              </button>
              <button
                type="button"
                className="ghost"
                onClick={handleDownloadAllImages}
              >
                💾 Download All Images
              </button>
            </div>

            <p className="hint" style={{ marginTop: '6px' }}>
              {supportsFastExport()
                ? '⚡ Fast export: frames are encoded offline to MP4 (faster than real time, safe in a background tab).'
                : '⏺ This browser lacks WebCodecs, so export records in real time — keep this tab in front.'}
            </p>

            {chapters && (
              <div className="chapters-box">
                <div className="chapters-head">
                  <strong>📑 YouTube Chapters</strong>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="ghost small-btn" onClick={() => navigator.clipboard?.writeText(chapters.text)}>
                      Copy
                    </button>
                    <button
                      type="button"
                      className="ghost small-btn"
                      onClick={() => downloadText(chapters.text, `${(projectTitle || 'video').trim().replace(/[^a-zA-Z0-9_\-]/g, '_')}_chapters.txt`)}
                    >
                      Download .txt
                    </button>
                    <button type="button" className="ghost small-btn" onClick={() => setChapters(null)}>✕</button>
                  </div>
                </div>
                <textarea readOnly rows={Math.min(10, chapters.count + 1)} value={chapters.text} />
                {chapters.warnings.map((w) => (
                  <div key={w} className="chapters-warning">⚠ {w}</div>
                ))}
              </div>
            )}

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
