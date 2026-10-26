import { useState, useRef, useEffect, useCallback } from 'react';
import LeftPanel from '../components/studio/LeftPanel';
import RightPanel from '../components/studio/RightPanel';
import StudioCanvas from '../components/studio/StudioCanvas';
import StudioTimeline from '../components/studio/StudioTimeline';
import { Icon } from '../components/studio/icons';
import { preloadImages } from '../lib/renderVideo';
import { drawStudioFrame, preloadLayerImages } from '../lib/studioRender';
import { exportStudioVideo } from '../lib/studioExport';

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

  // Preload layer images
  useEffect(() => {
    const imageLayers = (project.layers || []).filter(l => l.type === 'image' && l.imageUrl);
    if (imageLayers.length === 0) return;
    preloadLayerImages(imageLayers)
      .then(setPreloadedLayerImages)
      .catch(console.error);
  }, [project.layers]);

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

  const handleAddImageLayer = useCallback((file) => {
    const url = URL.createObjectURL(file);
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
  }, [project.duration, handleAddLayer]);

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
      layers: await Promise.all(project.layers.map(async l => (
        l.type === 'image' ? { ...l, imageUrl: await toDataUrl(l.imageUrl) } : l
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

  const handleLoadProject = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setProject(buildProject(data));
      setSelectedLayerId(null);
      seek(0);
      setSaveNotice('✓ Project loaded');
      setTimeout(() => setSaveNotice(''), 3000);
    } catch (err) {
      console.error('Failed to load project:', err);
      setSaveNotice('⚠ Failed to load project');
      setTimeout(() => setSaveNotice(''), 3000);
    }
    e.target.value = '';
  }, [seek]);

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
    });
  }, [project, preloadedSlideImages, preloadedLayerImages]);

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
  }, [selectedLayerId, project.layers, handleUndo, handleRedo, handleDeleteLayer, handleDuplicateLayer, handleUpdateLayer, seek]);

  const handleSelectLayer = useCallback((id) => {
    setSelectedLayerId(id);
    if (id) setRightTab(t => t || 'properties');
  }, []);

  const toggleLeftTab = (id) => setLeftTab(t => (t === id ? null : id));
  const toggleRightTab = (id) => setRightTab(t => (t === id ? null : id));

  return (
    <div className="studio-page">
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
          <input
            ref={loadFileInputRef}
            type="file"
            accept=".json,.studio.json"
            style={{ display: 'none' }}
            onChange={handleLoadProject}
          />
          <button className="studio-topnav-btn" onClick={() => loadFileInputRef.current?.click()} title="Open a .studio.json project">
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
            onSetTransition={handleSetTransition}
            onOpenLeftTab={setLeftTab}
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
