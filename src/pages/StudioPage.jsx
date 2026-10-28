import { useState, useRef, useEffect, useCallback } from 'react';
import LeftPanel from '../components/studio/LeftPanel';
import RightPanel from '../components/studio/RightPanel';
import StudioCanvas from '../components/studio/StudioCanvas';
import StudioTimeline from '../components/studio/StudioTimeline';
import { Icon } from '../components/studio/icons';
import { preloadImages } from '../lib/renderVideo';
import { drawStudioFrame, preloadLayerImages } from '../lib/studioRender';
import { loadImage } from '../lib/frameExtras';
import { makerFileToStudioProject, isMakerProjectFile } from '../lib/mergeSections';

const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|avi)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

function kindOf(file) {
  const t = file.type || '';
  if (t.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (t.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  if (t.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (t === 'application/json' || /\.json$/i.test(file.name)) return 'project';
  return null;
}

// Reads a video's length; rejects if the browser can't decode the file.
function probeVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const timer = setTimeout(() => reject(new Error('timed out reading the video')), 15000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      if (!v.videoWidth) { reject(new Error('no playable video track')); return; }
      resolve(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 5);
    };
    v.onerror = () => { clearTimeout(timer); reject(new Error('unsupported format or codec')); };
    v.src = url;
  });
}
import { exportStudioVideo } from '../lib/studioExport';
import { getSnapshotInfo, loadSnapshot, deleteSnapshot } from '../lib/autosave';
import { useAutosave } from '../lib/useAutosave';
import RecoveryBanner, { autosaveLabel } from '../components/RecoveryBanner';

const DEFAULT_PROJECT = {
  name: 'Untitled project',
  aspectRatio: '16:9',
  duration: 60,
  rows: [],
  slides: [],
  imageUrls: [],
  audioUrl: null,
  bgmUrl: null,
  bgmName: '',
  bgmVolume: 0.15,
  autoDuck: true,
  animationMode: 'random',
  captionStyle: 'modern-card',
  hookStyle: 'punch-stamp',
  slideAnimations: {},
  textOverlays: {},
  layers: [],
  transitions: {},
  words: [],
  colorGrade: 'none',
  slideFilters: {},
  brand: null,
  logoUrl: null,
  sfx: { mode: 'none', volume: 0.6 },
};

// Far-left tool rail (opens the left drawer)
const LEFT_TABS = [
  { id: 'media',       label: 'My media',    icon: 'media' },
  { id: 'scenes',      label: 'Scenes',      icon: 'scenes' },
  { id: 'text',        label: 'Text',        icon: 'text' },
  { id: 'shapes',      label: 'Shapes',      icon: 'shapes' },
  { id: 'transitions', label: 'Transitions', icon: 'transitions' },
  { id: 'project',     label: 'Project',     icon: 'folder' },
];

// Far-right tool rail (opens the properties drawer)
const RIGHT_TABS = [
  { id: 'properties', label: 'Properties', icon: 'sliders' },
  { id: 'effects',    label: 'Effects',    icon: 'sparkles' },
  { id: 'fade',       label: 'Fade',       icon: 'moon' },
  { id: 'audio',      label: 'Audio',      icon: 'audio' },
  { id: 'captions',   label: 'Captions',   icon: 'captions' },
];

const HISTORY_LIMIT = 60;
const HISTORY_DEBOUNCE_MS = 350;

function buildProject(source) {
  return {
    ...DEFAULT_PROJECT,
    ...(source || {}),
    layers: (source && source.layers) || [],
    transitions: (source && source.transitions) || {},
  };
}

export default function StudioPage({ initialProject, onBack }) {
  const [project, setProject] = useState(() => buildProject(initialProject));
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [preloadedSlideImages, setPreloadedSlideImages] = useState([]);
  const [preloadedLayerImages, setPreloadedLayerImages] = useState(new Map());
  const [leftTab, setLeftTab] = useState('media');
  const [rightTab, setRightTab] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importing, setImporting] = useState('');
  const mediaInputRef = useRef(null);

  const audioRef = useRef(null);
  const bgmRef = useRef(null);
  const loadFileInputRef = useRef(null);
  const timeRef = useRef(0);

  // ── Undo / redo history (debounced snapshots of `project`) ─────────────────
  const historyRef = useRef({ past: [], future: [], last: null, skip: false });
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    const h = historyRef.current;
    if (h.last === null) { h.last = project; return; }
    if (h.skip) { h.skip = false; h.last = project; return; }
    const timer = setTimeout(() => {
      if (h.last !== project) {
        h.past = [...h.past, h.last].slice(-HISTORY_LIMIT);
        h.future = [];
        h.last = project;
        setHistoryTick(t => t + 1);
      }
    }, HISTORY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project]);

  const handleUndo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [h.last, ...h.future];
    h.last = prev;
    h.skip = true;
    setProject(prev);
    setHistoryTick(t => t + 1);
  }, []);

  const handleRedo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past, h.last];
    h.last = next;
    h.skip = true;
    setProject(next);
    setHistoryTick(t => t + 1);
  }, []);

  const canUndo = historyTick >= 0 && historyRef.current.past.length > 0;
  const canRedo = historyTick >= 0 && historyRef.current.future.length > 0;

  // Sync initialProject changes into state
  useEffect(() => {
    if (initialProject) {
      setProject(buildProject(initialProject));
      historyRef.current = { past: [], future: [], last: null, skip: false };
    }
  }, [initialProject]);

  // ── Autosave & crash recovery (IndexedDB) ──────────────────────────────────
  // Coming back to the same hand-off from the Maker (or opening Studio empty)
  // restores the autosave silently; opening a different project asks first.
  const sessionKey = initialProject?._openedAt ?? null;
  const [recovery, setRecovery] = useState({ phase: 'checking', info: null, busy: false });

  const applySnapshot = useCallback(async () => {
    const snap = await loadSnapshot('studio');
    if (snap?.data) {
      setProject(buildProject(snap.data));
      historyRef.current = { past: [], future: [], last: null, skip: false };
      setHistoryTick(t => t + 1);
      setSelectedLayerId(null);
    }
    return snap;
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSnapshotInfo('studio')
      .then(async (info) => {
        if (cancelled) return;
        if (!info) { setRecovery({ phase: 'ready', info: null, busy: false }); return; }
        const silent = !initialProject || info.meta?.sessionKey === sessionKey;
        if (!silent) { setRecovery({ phase: 'prompt', info, busy: false }); return; }
        await applySnapshot();
        if (cancelled) return;
        setRecovery({ phase: 'ready', info: null, busy: false });
        if (!initialProject) {
          setSaveNotice('✓ Restored autosaved session');
          setTimeout(() => setSaveNotice(''), 3000);
        }
      })
      .catch((err) => {
        console.warn('Studio autosave unavailable:', err);
        if (!cancelled) setRecovery({ phase: 'unavailable', info: null, busy: false });
      });
    return () => { cancelled = true; };
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const studioAutosave = useAutosave({
    key: 'studio',
    data: project,
    meta: { sessionKey, name: project.name, layerCount: project.layers.length },
    enabled: recovery.phase === 'ready',
  });

  const handleRestoreAutosave = async () => {
    setRecovery(r => ({ ...r, busy: true }));
    try {
      await applySnapshot();
      setRecovery({ phase: 'ready', info: null, busy: false });
      setSaveNotice('✓ Restored autosaved session');
      setTimeout(() => setSaveNotice(''), 3000);
    } catch (err) {
      console.error('Studio restore failed:', err);
      setRecovery(r => ({ ...r, busy: false }));
      setSaveNotice('⚠ Could not restore autosave');
      setTimeout(() => setSaveNotice(''), 3000);
    }
  };

  const handleDiscardAutosave = async () => {
    setRecovery(r => ({ ...r, busy: true }));
    await deleteSnapshot('studio').catch(err => console.warn('Discard failed:', err));
    setRecovery({ phase: 'ready', info: null, busy: false });
  };

  // Preload slide images
  useEffect(() => {
    if (!project.imageUrls || project.imageUrls.length === 0) {
      setPreloadedSlideImages([]);
      return;
    }
    preloadImages(project.imageUrls)
      .then(setPreloadedSlideImages)
      .catch(console.error);
  }, [project.imageUrls]);

  // Preload layer media (images + video clips; cached by URL)
  useEffect(() => {
    const mediaLayers = (project.layers || []).filter(l => (l.type === 'image' && l.imageUrl) || (l.type === 'video' && l.videoUrl));
    if (mediaLayers.length === 0) return;
    preloadLayerImages(mediaLayers)
      .then(setPreloadedLayerImages)
      .catch(console.error);
  }, [project.layers]);

  // Brand logo for the watermark
  const [logoImg, setLogoImg] = useState(null);
  useEffect(() => {
    let active = true;
    loadImage(project.logoUrl).then(img => { if (active) setLogoImg(img); });
    return () => { active = false; };
  }, [project.logoUrl]);

  // Keep video clips in step with the playhead during preview
  useEffect(() => {
    for (const l of project.layers || []) {
      if (l.type !== 'video') continue;
      const v = preloadedLayerImages.get(l.id);
      if (!v) continue;
      v.muted = !!l.muted;
      v.volume = Math.max(0, Math.min(1, l.volume ?? 1));
      const inRange = currentTime >= l.startTime && currentTime < l.endTime;
      const target = currentTime - l.startTime + (l.trimStart || 0);
      if (!inRange) { if (!v.paused) v.pause(); continue; }
      if (isPlaying) {
        if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
        if (v.paused) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
      }
    }
  }, [currentTime, isPlaying, project.layers, preloadedLayerImages]);

  // Redraw once a seeked clip frame is ready (the canvas only redraws on time changes)
  const [frameTick, setFrameTick] = useState(0);
  useEffect(() => {
    const vids = (project.layers || []).filter(l => l.type === 'video').map(l => preloadedLayerImages.get(l.id)).filter(Boolean);
    const bump = () => setFrameTick(t => t + 1);
    vids.forEach(v => v.addEventListener('seeked', bump));
    return () => vids.forEach(v => v.removeEventListener('seeked', bump));
  }, [project.layers, preloadedLayerImages]);

  // ── Playback clock ─────────────────────────────────────────────────────────
  // Uses the voiceover element as the master clock when available, otherwise
  // advances with requestAnimationFrame so projects without audio still play.
  const seek = useCallback((t) => {
    const clamped = Math.max(0, Math.min(project.duration || 0, t));
    timeRef.current = clamped;
    setCurrentTime(clamped);
    if (audioRef.current) audioRef.current.currentTime = clamped;
    if (bgmRef.current && bgmRef.current.duration) {
      bgmRef.current.currentTime = clamped % bgmRef.current.duration;
    }
  }, [project.duration]);

  useEffect(() => {
    const audio = audioRef.current;
    const bgm = bgmRef.current;
    if (!isPlaying) {
      audio?.pause();
      bgm?.pause();
      return undefined;
    }
    if (timeRef.current >= (project.duration || 0) - 0.05) seek(0);
    if (audio) {
      audio.currentTime = timeRef.current;
      audio.play().catch(() => {});
    }
    if (bgm) bgm.play().catch(() => {});

    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      let t;
      if (audio && !audio.paused && audio.currentTime < (audio.duration || Infinity)) {
        t = audio.currentTime;
      } else {
        t = timeRef.current + dt;
      }
      if (t >= project.duration) {
        timeRef.current = project.duration;
        setCurrentTime(project.duration);
        setIsPlaying(false);
        return;
      }
      timeRef.current = t;
      setCurrentTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, project.duration, seek]);

  // BGM volume (preview) with simple ducking while voiceover is present
  useEffect(() => {
    if (!bgmRef.current) return;
    const vol = project.bgmVolume ?? 0.15;
    bgmRef.current.volume = Math.max(0, Math.min(1, project.audioUrl && project.autoDuck ? vol * 0.6 : vol));
  }, [project.bgmVolume, project.autoDuck, project.audioUrl, project.bgmUrl]);

  // ---- HANDLERS ----

  const updateProject = useCallback((changes) => {
    setProject(p => ({ ...p, ...changes }));
  }, []);

  const handleUpdateRowsAndDuration = useCallback((newRows, newDuration) => {
    updateProject({
      rows: newRows,
      duration: newDuration,
    });
  }, [updateProject]);

  const handleAddLayer = useCallback((layerData) => {
    const newLayer = {
      ...layerData,
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setProject(p => ({ ...p, layers: [...p.layers, newLayer] }));
    setSelectedLayerId(newLayer.id);
    setRightTab('properties');
  }, []);

  const handleUpdateLayer = useCallback((id, changes) => {
    setProject(p => ({
      ...p,
      layers: p.layers.map(l => (l.id === id ? { ...l, ...changes } : l)),
    }));
  }, []);

  const handleDeleteLayer = useCallback((id) => {
    setProject(p => ({ ...p, layers: p.layers.filter(l => l.id !== id) }));
    setSelectedLayerId(prev => (prev === id ? null : prev));
  }, []);

  const handleDuplicateLayer = useCallback((id) => {
    setProject(p => {
      const src = p.layers.find(l => l.id === id);
      if (!src) return p;
      const newL = {
        ...src,
        id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        x: Math.min(1 - src.width, src.x + 0.02),
        y: Math.min(1 - src.height, src.y + 0.02),
        zIndex: (src.zIndex ?? 0) + 1,
      };
      setSelectedLayerId(newL.id);
      return { ...p, layers: [...p.layers, newL] };
    });
  }, []);

  const handleSplitLayer = useCallback((id, atTime) => {
    setProject(p => {
      const src = p.layers.find(l => l.id === id);
      if (!src || atTime <= src.startTime + 0.1 || atTime >= src.endTime - 0.1) return p;
      const second = {
        ...src,
        id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        startTime: atTime,
        animation: 'none',
      };
      // The second half of a clip continues from where the split happened in the source
      if (src.type === 'video') second.trimStart = (src.trimStart || 0) + (atTime - src.startTime);
      return {
        ...p,
        layers: [...p.layers.map(l => (l.id === id ? { ...l, endTime: atTime } : l)), second],
      };
    });
  }, []);

  const handleReorderLayer = useCallback((id, direction) => {
    setProject(p => {
      const zs = p.layers.map(l => l.zIndex ?? 0);
      const maxZ = Math.max(0, ...zs);
      const minZ = Math.min(0, ...zs);
      return {
        ...p,
        layers: p.layers.map(l => (l.id === id
          ? { ...l, zIndex: direction === 'front' ? maxZ + 1 : minZ - 1 }
          : l)),
      };
    });
  }, []);

  const flashNotice = useCallback((msg, ms = 3500) => {
    setSaveNotice(msg);
    setTimeout(() => setSaveNotice(''), ms);
  }, []);

  const handleAddImageLayer = useCallback(async (file) => {
    const url = URL.createObjectURL(file);
    if (kindOf(file) === 'video') {
      let sourceDuration;
      try {
        sourceDuration = await probeVideo(url);
      } catch (err) {
        URL.revokeObjectURL(url);
        flashNotice(`⚠ Can't play "${file.name}" (${err.message}). Use MP4 (H.264) or WebM.`, 6000);
        return;
      }
      const start = timeRef.current;
      const end = start + sourceDuration;
      // A project without scenes grows to fit its clips
      if (!(project.rows || []).length) {
        const layerEnd = Math.max(0, ...(project.layers || []).map(l => l.endTime || 0));
        updateProject({ duration: Math.max(end, layerEnd, 1) });
      }
      handleAddLayer({
        type: 'video',
        name: file.name,
        videoUrl: url,
        x: 0, y: 0, width: 1, height: 1,
        rotation: 0, opacity: 1, zIndex: 2,
        animation: 'none', animDuration: 0.4,
        startTime: start,
        endTime: (project.rows || []).length ? Math.min(end, Math.max(project.duration, start + 0.5)) : end,
        trimStart: 0,
        sourceDuration,
        volume: 1,
        muted: false,
      });
      return;
    }
    handleAddLayer({
      type: 'image',
      name: file.name,
      imageUrl: url,
      x: 0.3,
      y: 0.25,
      width: 0.4,
      height: 0.4,
      rotation: 0,
      opacity: 1,
      zIndex: 20,
      animation: 'fade-in',
      animDuration: 0.4,
      startTime: timeRef.current,
      endTime: Math.min(timeRef.current + 5, project.duration),
    });
  }, [project.duration, project.rows, project.layers, handleAddLayer, updateProject, flashNotice]);

  const handleImportBgm = useCallback((file) => {
    const url = URL.createObjectURL(file);
    updateProject({ bgmUrl: url, bgmName: file.name });
    setSaveNotice('✓ Background music added');
    setTimeout(() => setSaveNotice(''), 2500);
  }, [updateProject]);

  const handleSetTransition = useCallback((slideIdx, transitionId) => {
    setProject(p => ({
      ...p,
      transitions: { ...p.transitions, [slideIdx]: transitionId },
    }));
  }, []);

  const handleSaveProject = useCallback(async () => {
    // Blob URLs die on refresh — inline them as data URLs so the file round-trips.
    const toDataUrl = async (url) => {
      if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return url;
      try {
        const blob = await (await fetch(url)).blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    };
    setSaveNotice('Saving…');
    const payload = {
      version: 'studio-1.0',
      savedAt: new Date().toISOString(),
      ...project,
      imageUrls: await Promise.all((project.imageUrls || []).map(toDataUrl)),
      audioUrl: await toDataUrl(project.audioUrl),
      bgmUrl: await toDataUrl(project.bgmUrl),
      logoUrl: await toDataUrl(project.logoUrl),
      layers: await Promise.all(project.layers.map(async l => (
        l.type === 'image' ? { ...l, imageUrl: await toDataUrl(l.imageUrl) }
          : l.type === 'video' ? { ...l, videoUrl: await toDataUrl(l.videoUrl) }
            : l
      ))),
    };
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project.name || 'studio-project').replace(/[^\w\- ]+/g, '').trim() || 'studio-project'}.studio.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotice('✓ Project saved');
    setTimeout(() => setSaveNotice(''), 3000);
  }, [project]);

  const openProjectFile = useCallback(async (file) => {
    try {
      setImporting(`Opening ${file.name}…`);
      const data = JSON.parse(await file.text());
      let next;
      if (isMakerProjectFile(data)) {
        setImporting('Merging Video Maker sections…');
        next = await makerFileToStudioProject(data);
      } else if (Array.isArray(data.rows) || Array.isArray(data.layers)) {
        next = data;
      } else {
        throw new Error('This file is not a Studio or Video Maker project.');
      }
      setProject(buildProject(next));
      historyRef.current = { past: [], future: [], last: null, skip: false };
      setSelectedLayerId(null);
      seek(0);
      flashNotice(`✓ Opened "${next.name || file.name}"`);
    } catch (err) {
      console.error('Failed to load project:', err);
      flashNotice(`⚠ ${err.message || 'Failed to load project'}`, 8000);
    } finally {
      setImporting('');
    }
  }, [seek, flashNotice]);

  const handleLoadProject = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openProjectFile(file);
  }, [openProjectFile]);

  // Any mix of files from the picker or drag & drop
  const handleImportFiles = useCallback(async (fileList) => {
    const files = [...(fileList || [])];
    const skipped = [];
    for (const file of files) {
      const kind = kindOf(file);
      if (kind === 'video' || kind === 'image') await handleAddImageLayer(file);
      else if (kind === 'audio') handleImportBgm(file);
      else if (kind === 'project') await openProjectFile(file);
      else skipped.push(file.name);
    }
    if (skipped.length) flashNotice(`⚠ Skipped unsupported file(s): ${skipped.join(', ')}`, 6000);
  }, [handleAddImageLayer, handleImportBgm, openProjectFile, flashNotice]);

  const handleDragOver = useCallback((e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDrop = useCallback((e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setIsDragOver(false);
    handleImportFiles(e.dataTransfer.files);
  }, [handleImportFiles]);

  const handleExport = useCallback(async () => {
    if (isExporting) return;
    setIsPlaying(false);
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Preparing export…');
    const isVertical = project.aspectRatio === '9:16';
    const [w, h] = isVertical ? [720, 1280] : [1280, 720];
    try {
      const { blob, filename } = await exportStudioVideo({
        rows: project.rows,
        slides: project.slides,
        imageUrls: project.imageUrls,
        layers: project.layers,
        transitions: project.transitions,
        audioUrl: project.audioUrl,
        bgmUrl: project.bgmUrl,
        bgmVolume: project.bgmVolume,
        autoDuck: project.autoDuck,
        animationMode: project.animationMode,
        slideAnimations: project.slideAnimations,
        captionStyle: project.captionStyle,
        hookStyle: project.hookStyle,
        textOverlays: project.textOverlays,
        words: project.words,
        colorGrade: project.colorGrade,
        slideFilters: project.slideFilters,
        brand: project.brand,
        logoUrl: project.logoUrl,
        sfx: project.sfx,
        duration: project.duration,
        width: w,
        height: h,
        fps: 30,
        title: project.name || 'studio-export',
        onProgress: (pct, status) => {
          setExportProgress(pct);
          if (status) setExportStatus(status);
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus('✓ Export complete!');
    } catch (err) {
      console.error('Export failed:', err);
      setExportStatus(`⚠ Export failed: ${err.message}`);
    } finally {
      setTimeout(() => setIsExporting(false), 1500);
    }
  }, [isExporting, project]);

  // Stable drawFrame callback — matches signature expected by StudioCanvas:
  // drawFrame({ ctx, width, height, time, duration, ...projectFields })
  const drawFrame = useCallback((params) => {
    drawStudioFrame({
      ...params,
      rows: project.rows,
      slides: project.slides,
      preloadedSlideImages,
      preloadedLayerImages,
      animationMode: project.animationMode,
      slideAnimations: project.slideAnimations,
      captionStyle: project.captionStyle,
      hookStyle: project.hookStyle,
      textOverlays: project.textOverlays,
      layers: project.layers,
      transitions: project.transitions,
      duration: project.duration,
      words: project.words,
      colorGrade: project.colorGrade,
      slideFilters: project.slideFilters,
      brand: project.brand,
      logoImg,
    });
  }, [project, preloadedSlideImages, preloadedLayerImages, logoImg, frameTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedLayer = project.layers.find(l => l.id === selectedLayerId) || null;

  const rows = project.rows || [];
  let currentSlideIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (currentTime >= (rows[i].start ?? 0)) currentSlideIdx = i;
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(p => !p);
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      } else if (!mod && e.key.toLowerCase() === 's' && selectedLayerId) {
        e.preventDefault();
        handleSplitLayer(selectedLayerId, timeRef.current);
      } else if (mod && e.key.toLowerCase() === 'd' && selectedLayerId) {
        e.preventDefault();
        handleDuplicateLayer(selectedLayerId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId) {
        e.preventDefault();
        handleDeleteLayer(selectedLayerId);
      } else if (e.key === 'Escape') {
        setSelectedLayerId(null);
      } else if (e.key === 'ArrowLeft' && !selectedLayerId) {
        seek(timeRef.current - (e.shiftKey ? 5 : 1));
      } else if (e.key === 'ArrowRight' && !selectedLayerId) {
        seek(timeRef.current + (e.shiftKey ? 5 : 1));
      } else if (selectedLayerId && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 0.02 : 0.005;
        const l = project.layers.find(x => x.id === selectedLayerId);
        if (!l) return;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        handleUpdateLayer(selectedLayerId, { x: l.x + dx, y: l.y + dy });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedLayerId, project.layers, handleUndo, handleRedo, handleDeleteLayer, handleDuplicateLayer, handleUpdateLayer, handleSplitLayer, seek]);

  const handleSelectLayer = useCallback((id) => {
    setSelectedLayerId(id);
    if (id) setRightTab(t => t || 'properties');
  }, []);

  const toggleLeftTab = (id) => setLeftTab(t => (t === id ? null : id));
  const toggleRightTab = (id) => setRightTab(t => (t === id ? null : id));

  return (
    <div
      className={`studio-page${isDragOver ? ' is-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v"
        style={{ display: 'none' }}
        onChange={(e) => { handleImportFiles(e.target.files); e.target.value = ''; }}
      />
      {isDragOver && (
        <div className="studio-drop-overlay">
          <div className="studio-drop-card">
            <Icon name="upload" size={34} />
            <strong>Drop to import</strong>
            <span>Videos &amp; images become layers · audio becomes music · .json opens a project</span>
          </div>
        </div>
      )}
      {importing && <div className="studio-import-toast">{importing}</div>}
      {/* ── TOP NAV ── */}
      <header className="studio-topnav">
        <div className="studio-topnav-left">
          <button className="cs-nav-icon-btn" onClick={onBack} title="Back to Video Maker">
            <Icon name="grid" />
          </button>
          <div className="studio-brand">
            <div className="studio-brand-icon"><Icon name="film" /></div>
            <span className="studio-brand-name">ClipStudio</span>
          </div>
          {editingName ? (
            <input
              className="studio-project-name-input"
              autoFocus
              defaultValue={project.name}
              onBlur={e => { updateProject({ name: e.target.value.trim() || 'Untitled project' }); setEditingName(false); }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingName(false); }}
            />
          ) : (
            <button className="studio-project-name" onClick={() => setEditingName(true)} title="Rename project">
              <span className="studio-project-name-text">{project.name}</span>
              <Icon name="pencil" size={12} />
            </button>
          )}
          <div className="cs-nav-history">
            <button className="cs-nav-icon-btn" onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
              <Icon name="undo" />
            </button>
            <button className="cs-nav-icon-btn" onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
              <Icon name="redo" />
            </button>
          </div>
        </div>

        <div className="studio-topnav-actions">
          {saveNotice
            ? <span className="save-notice">{saveNotice}</span>
            : <span className="cs-saved-hint"><Icon name="layers" size={14} /> {project.layers.length} layer{project.layers.length === 1 ? '' : 's'}</span>}
          {autosaveLabel(studioAutosave) && <span className="autosave-hint">{autosaveLabel(studioAutosave)}</span>}
          <input
            ref={loadFileInputRef}
            type="file"
            accept=".json,.studio.json,.videomaker.json"
            style={{ display: 'none' }}
            onChange={handleLoadProject}
          />
          <button className="studio-topnav-btn" onClick={() => loadFileInputRef.current?.click()} title="Open a Studio (.studio.json) or Video Maker (.videomaker.json) project">
            <Icon name="folder" size={14} /> Open
          </button>
          <button className="studio-topnav-btn" onClick={handleSaveProject} title="Save project to a .studio.json file">
            <Icon name="save" size={14} /> Save
          </button>
          <button
            className="studio-topnav-btn studio-topnav-btn--export"
            disabled={isExporting}
            onClick={handleExport}
          >
            <Icon name="upload" size={14} /> {isExporting ? `Exporting ${exportProgress}%` : 'Export'}
          </button>
          <div className="cs-nav-divider" />
          <button className="cs-nav-icon-btn" onClick={onBack} title="Back to Video Maker">
            <Icon name="back" />
          </button>
        </div>
      </header>

      {recovery.phase === 'prompt' && (
        <RecoveryBanner
          what="Studio session"
          detail={[recovery.info?.meta?.name, `${recovery.info?.meta?.layerCount ?? 0} layer(s)`].filter(Boolean).join(' · ')}
          savedAt={recovery.info?.savedAt}
          busy={recovery.busy}
          onRestore={handleRestoreAutosave}
          onDiscard={handleDiscardAutosave}
        />
      )}

      {/* ── MAIN BODY ── */}
      <div className="studio-body">
        {/* Far-left icon rail */}
        <nav className="studio-icon-sidebar">
          {LEFT_TABS.map(t => (
            <button
              key={t.id}
              className={`cs-icon-btn${leftTab === t.id ? ' active' : ''}`}
              onClick={() => toggleLeftTab(t.id)}
              title={t.label}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {/* Left drawer */}
        {leftTab && (
          <LeftPanel
            activeTab={leftTab}
            project={project}
            currentTime={currentTime}
            currentSlideIdx={currentSlideIdx}
            onClose={() => setLeftTab(null)}
            onAddLayer={handleAddLayer}
            onAddImageLayer={handleAddImageLayer}
            onImportFiles={handleImportFiles}
            onImportBgm={handleImportBgm}
            onLoadProject={() => loadFileInputRef.current?.click()}
            onSaveProject={handleSaveProject}
            onBack={onBack}
            onSeek={seek}
            onSetTransition={handleSetTransition}
            onUpdateProject={updateProject}
            onOpenTab={setLeftTab}
          />
        )}

        {/* Center: canvas + transport + timeline */}
        <div className="studio-center">
          <StudioCanvas
            project={project}
            currentTime={currentTime}
            selectedLayerId={selectedLayerId}
            preloadedSlideImages={preloadedSlideImages}
            preloadedLayerImages={preloadedLayerImages}
            onSelectLayer={handleSelectLayer}
            onUpdateLayer={handleUpdateLayer}
            onDeleteLayer={handleDeleteLayer}
            onDuplicateLayer={handleDuplicateLayer}
            onReorderLayer={handleReorderLayer}
            onChangeAspect={(ar) => updateProject({ aspectRatio: ar })}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
            drawFrame={drawFrame}
          />

          <StudioTimeline
            project={project}
            currentTime={currentTime}
            isPlaying={isPlaying}
            selectedLayerId={selectedLayerId}
            onSeek={seek}
            onTogglePlay={() => setIsPlaying(p => !p)}
            onSelectLayer={handleSelectLayer}
            onUpdateLayer={handleUpdateLayer}
            onDeleteLayer={handleDeleteLayer}
            onDuplicateLayer={handleDuplicateLayer}
            onSplitLayer={handleSplitLayer}
            onImportMedia={() => mediaInputRef.current?.click()}
            onSetTransition={handleSetTransition}
            onOpenLeftTab={setLeftTab}
            onUpdateRowsAndDuration={handleUpdateRowsAndDuration}
          />
        </div>

        {/* Right properties drawer */}
        {rightTab && (
          <RightPanel
            activeTab={rightTab}
            layer={selectedLayer}
            project={project}
            currentSlideIdx={currentSlideIdx}
            onClose={() => setRightTab(null)}
            onUpdateLayer={handleUpdateLayer}
            onDeleteLayer={handleDeleteLayer}
            onDuplicateLayer={handleDuplicateLayer}
            onReorderLayer={handleReorderLayer}
            onUpdateProject={updateProject}
            onSetTransition={handleSetTransition}
            onImportBgm={handleImportBgm}
          />
        )}

        {/* Far-right icon rail */}
        <nav className="studio-right-toolbar">
          {RIGHT_TABS.map(t => (
            <button
              key={t.id}
              className={`cs-icon-btn${rightTab === t.id ? ' active' : ''}`}
              onClick={() => toggleRightTab(t.id)}
              title={t.label}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Hidden media elements (preview playback) */}
      {project.audioUrl && (
        <audio
          ref={audioRef}
          src={project.audioUrl}
          preload="auto"
          style={{ display: 'none' }}
        />
      )}
      {project.bgmUrl && (
        <audio
          ref={bgmRef}
          src={project.bgmUrl}
          preload="auto"
          loop
          style={{ display: 'none' }}
        />
      )}

      {/* Export overlay */}
      {isExporting && (
        <div className="export-overlay">
          <div className="export-modal">
            <h3>Exporting video…</h3>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <p className="export-status">{exportStatus}</p>
          </div>
        </div>
      )}
    </div>
  );
}
