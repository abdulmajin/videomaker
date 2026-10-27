import { useRef, useState, useEffect } from 'react';
import { Icon } from './icons';
import { TRANSITION_TYPES } from '../../lib/studioRender';

const TAB_TITLES = {
  media: 'My media',
  scenes: 'Scenes',
  text: 'Text',
  shapes: 'Shapes',
  transitions: 'Transitions',
  project: 'Project',
};

// Text presets
const TEXT_PRESETS = [
  { label: 'Title', fontSize: 64, fontWeight: '900', color: '#ffffff', text: 'Add Title', sample: 'Title' },
  { label: 'Subtitle', fontSize: 38, fontWeight: '600', color: '#e2e8f0', text: 'Add Subtitle', sample: 'Subtitle' },
  { label: 'Caption', fontSize: 24, fontWeight: '400', color: '#f1f5f9', text: 'Add caption text', sample: 'Caption text' },
  { label: 'Bold Pop', fontSize: 52, fontWeight: '900', color: '#fde047', textBg: 'rgba(0,0,0,0.7)', text: 'BOLD TEXT', sample: 'BOLD POP' },
  { label: 'Accent', fontSize: 40, fontWeight: '700', color: '#38bdf8', text: 'Accent Text', sample: 'Accent' },
  { label: 'Lower third', fontSize: 30, fontWeight: '700', color: '#ffffff', textBg: 'rgba(124,58,237,0.85)', text: 'Name • Title', sample: 'Lower third', y: 0.78, x: 0.05, width: 0.5 },
];

// Shape configs
const SHAPES = [
  { shape: 'rect', label: 'Rectangle', icon: 'square' },
  { shape: 'circle', label: 'Circle', icon: 'circle' },
  { shape: 'triangle', label: 'Triangle', icon: 'triangle' },
  { shape: 'line', label: 'Line', icon: 'line' },
];

const SHAPE_COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#0F172A', '#FFFFFF'];

const fmt = (s) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function LeftPanel({
  activeTab,
  project,
  currentTime,
  currentSlideIdx,
  onClose,
  onAddLayer,
  onAddImageLayer,
  onImportBgm,
  onLoadProject,
  onSaveProject,
  onBack,
  onSeek,
  onSetTransition,
  onUpdateProject,
  onOpenTab,
}) {
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [shapeColor, setShapeColor] = useState(SHAPE_COLORS[0]);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const bgmInputRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const rows = project.rows || [];
  const imageUrls = project.imageUrls || [];
  const duration = project.duration || 0;
  const endFor = (start) => Math.min(start + 5, duration || start + 5);

  const handleAddText = (preset) => {
    onAddLayer({
      type: 'text',
      text: preset.text,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight,
      color: preset.color,
      textBg: preset.textBg || '',
      x: preset.x ?? 0.1,
      y: preset.y ?? 0.4,
      width: preset.width ?? 0.8,
      height: 0.12,
      startTime: currentTime,
      endTime: endFor(currentTime),
      zIndex: 10,
      opacity: 1,
      rotation: 0,
      animDuration: 0.4,
      animation: 'fade-in',
      fontFamily: 'system-ui',
      textAlign: 'center',
      italic: false,
    });
  };

  const handleAddShape = (shape) => {
    onAddLayer({
      type: 'shape',
      shape: shape.shape,
      x: 0.3,
      y: 0.3,
      width: shape.shape === 'line' ? 0.4 : 0.3,
      height: shape.shape === 'line' ? 0.02 : 0.3,
      fill: shapeColor,
      stroke: '#ffffff',
      strokeWidth: shape.shape === 'line' ? 4 : 0,
      borderRadius: 0,
      startTime: currentTime,
      endTime: endFor(currentTime),
      zIndex: 5,
      opacity: 1,
      rotation: 0,
      animation: 'fade-in',
      animDuration: 0.4,
    });
  };

  const handleSlideAsOverlay = (url, i) => {
    onAddLayer({
      type: 'image',
      name: `Scene ${i + 1}`,
      imageUrl: url,
      x: 0.6, y: 0.06, width: 0.34, height: 0.34,
      rotation: 0, opacity: 1, zIndex: 20,
      animation: 'zoom-in', animDuration: 0.4,
      startTime: currentTime,
      endTime: endFor(currentTime),
    });
  };

  const handleImageFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onAddImageLayer(file);
    e.target.value = '';
  };

  const handleBgmFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onImportBgm(file);
    e.target.value = '';
  };

  const hiddenInputs = (
    <>
      <input ref={imageInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleImageFile} />
      <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleImageFile} />
      <input ref={bgmInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleBgmFile} />
    </>
  );

  // ── Tab: My media ─────────────────────────────────────────────────────────
  const renderMedia = () => {
    const showImages = filter === 'all' || filter === 'images';
    const showAudio = filter === 'all' || filter === 'audio';
    const imageLayers = (project.layers || []).filter(l => l.type === 'image');
    const videoLayers = (project.layers || []).filter(l => l.type === 'video');
    const hasAny = imageUrls.some(Boolean) || project.audioUrl || project.bgmUrl || imageLayers.length > 0 || videoLayers.length > 0;
    return (
      <>
        <div className="sp-import-btn-wrap" ref={menuRef}>
          <div className="sp-import-btn-group">
            <button className="sp-import-btn-main" onClick={() => imageInputRef.current?.click()}>
              <Icon name="plus" size={16} /> Import media
            </button>
            <button className="sp-import-btn-dropdown" onClick={() => setMenuOpen(o => !o)} aria-label="More import options">
              <Icon name="chevronDown" size={16} />
            </button>
          </div>
          {menuOpen && (
            <div className="cs-dropdown-menu">
              <button onClick={() => { setMenuOpen(false); imageInputRef.current?.click(); }}>
                <Icon name="image" size={15} /> Image overlay
              </button>
              <button onClick={() => { setMenuOpen(false); videoInputRef.current?.click(); }}>
                <Icon name="video" size={15} /> Video clip (B-roll)
              </button>
              <button onClick={() => { setMenuOpen(false); bgmInputRef.current?.click(); }}>
                <Icon name="music" size={15} /> Background music
              </button>
              <button onClick={() => { setMenuOpen(false); onLoadProject(); }}>
                <Icon name="folder" size={15} /> Studio project (.json)
              </button>
            </div>
          )}
        </div>

        <div className="sp-filter-tabs">
          {['all', 'images', 'audio'].map(f => (
            <button key={f} className={`sp-filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'images' ? 'Images' : 'Audio'}
            </button>
          ))}
        </div>

        <div className="sp-media-body">
          {!hasAny && (
            <div className="sp-empty-card">
              <Icon name="media" size={28} />
              <p>No media yet. Open a merged project from the Video Maker, or import files.</p>
            </div>
          )}

          {showImages && imageUrls.some(Boolean) && (
            <>
              <div className="sp-media-label">Scene images · {imageUrls.filter(Boolean).length}</div>
              <div className="sp-media-grid">
                {imageUrls.map((url, i) => url && (
                  <div
                    key={i}
                    className={`sp-media-card${i === currentSlideIdx ? ' active' : ''}`}
                    onClick={() => onSeek(rows[i]?.start ?? 0)}
                    title={`Jump to scene ${i + 1}`}
                  >
                    <img src={url} alt={`Scene ${i + 1}`} />
                    <span className="sp-media-badge">{fmt(rows[i]?.start)}</span>
                    {i === currentSlideIdx && <span className="sp-media-check"><Icon name="check" size={10} strokeWidth={3} /></span>}
                    <button
                      className="sp-media-add"
                      title="Add as overlay at playhead"
                      onClick={(e) => { e.stopPropagation(); handleSlideAsOverlay(url, i); }}
                    >
                      <Icon name="plus" size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {showImages && imageLayers.length > 0 && (
            <>
              <div className="sp-media-label">Overlays · {imageLayers.length}</div>
              <div className="sp-media-grid">
                {imageLayers.map(l => (
                  <div key={l.id} className="sp-media-card" onClick={() => onSeek(l.startTime)} title={l.name || 'Image overlay'}>
                    <img src={l.imageUrl} alt={l.name || 'Overlay'} />
                    <span className="sp-media-badge">{fmt(l.startTime)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {showImages && videoLayers.length > 0 && (
            <>
              <div className="sp-media-label">Video clips · {videoLayers.length}</div>
              <div className="sp-media-grid">
                {videoLayers.map(l => (
                  <div key={l.id} className="sp-media-card" onClick={() => onSeek(l.startTime)} title={l.name || 'Video clip'}>
                    <video src={l.videoUrl} muted preload="metadata" />
                    <span className="sp-media-badge">{fmt(l.startTime)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {showAudio && (project.audioUrl || project.bgmUrl) && (
            <>
              <div className="sp-media-label">Audio</div>
              {project.audioUrl && (
                <div className="sp-audio-item">
                  <span className="sp-audio-icon voice"><Icon name="mic" size={15} /></span>
                  <div className="sp-audio-meta">
                    <strong>Voiceover narration</strong>
                    <small>{fmt(duration)}</small>
                  </div>
                </div>
              )}
              {project.bgmUrl && (
                <div className="sp-audio-item">
                  <span className="sp-audio-icon bgm"><Icon name="music" size={15} /></span>
                  <div className="sp-audio-meta">
                    <strong>{project.bgmName || 'Background music'}</strong>
                    <small>Vol {Math.round((project.bgmVolume ?? 0.15) * 100)}%</small>
                  </div>
                  <button className="sp-audio-remove" title="Remove music" onClick={() => onUpdateProject({ bgmUrl: null, bgmName: '' })}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )}
            </>
          )}

          <div className="sp-components-grid">
            <p>Add components directly</p>
            <div className="sp-shape-grid">
              <button className="sp-tool-btn" onClick={() => handleAddText(TEXT_PRESETS[0])}>
                <Icon name="text" size={14} /> Text
              </button>
              <button className="sp-tool-btn" onClick={() => imageInputRef.current?.click()}>
                <Icon name="image" size={14} /> Image Overlay
              </button>
              <button className="sp-tool-btn" onClick={() => videoInputRef.current?.click()}>
                <Icon name="video" size={14} /> Video Clip
              </button>
              <button className="sp-tool-btn" onClick={() => bgmInputRef.current?.click()}>
                <Icon name="music" size={14} /> BGM Track
              </button>
              <button className="sp-tool-btn" onClick={() => handleAddShape(SHAPES[0])}>
                <Icon name="square" size={14} /> Shape/Box
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ── Tab: Scenes ───────────────────────────────────────────────────────────
  const renderScenes = () => (
    <div className="sp-section-body">
      {rows.length === 0 && (
        <div className="sp-empty-card">
          <Icon name="scenes" size={28} />
          <p>No scenes. Merge a project in the Video Maker and open it in the Studio.</p>
        </div>
      )}
      <div className="sp-slide-list">
        {rows.map((row, i) => {
          const imgUrl = imageUrls[i];
          const label = (row.text || row.caption || '').slice(0, 60) || `Scene ${i + 1}`;
          return (
            <div
              key={row.id ?? i}
              className={`sp-slide-item${i === currentSlideIdx ? ' active' : ''}`}
              onClick={() => onSeek(row.start ?? 0)}
            >
              {imgUrl
                ? <img src={imgUrl} alt={`Scene ${i + 1}`} className="sp-slide-thumb" />
                : <div className="sp-slide-thumb sp-slide-thumb--empty">{i + 1}</div>}
              <div className="sp-slide-label">
                <div className="sp-slide-num">#{i + 1} · {fmt(row.start)}</div>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Tab: Text ─────────────────────────────────────────────────────────────
  const renderText = () => (
    <div className="sp-section-body">
      <p className="sp-hint">Click a style to add it at the playhead ({fmt(currentTime)}).</p>
      {TEXT_PRESETS.map(preset => (
        <button key={preset.label} className="sp-text-preset" onClick={() => handleAddText(preset)}>
          <span
            className="sp-text-preset-sample"
            style={{
              color: preset.color,
              fontWeight: preset.fontWeight,
              fontSize: Math.max(12, Math.min(22, preset.fontSize / 2.6)),
              background: preset.textBg || 'transparent',
            }}
          >
            {preset.sample}
          </span>
          <span className="sp-text-preset-label">{preset.label}</span>
        </button>
      ))}
    </div>
  );

  // ── Tab: Shapes ───────────────────────────────────────────────────────────
  const renderShapes = () => (
    <div className="sp-section-body">
      <div className="sp-media-label" style={{ padding: 0 }}>Fill colour</div>
      <div className="sp-swatches">
        {SHAPE_COLORS.map(c => (
          <button
            key={c}
            className={`sp-swatch${shapeColor === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => setShapeColor(c)}
            aria-label={c}
          />
        ))}
      </div>
      <div className="sp-shape-tiles">
        {SHAPES.map(s => (
          <button key={s.shape} className="sp-shape-tile" onClick={() => handleAddShape(s)}>
            <span style={{ color: shapeColor === '#FFFFFF' ? '#94A3B8' : shapeColor }}>
              <Icon name={s.icon} size={30} strokeWidth={s.shape === 'line' ? 3 : 1.6} />
            </span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Tab: Transitions ──────────────────────────────────────────────────────
  const renderTransitions = () => {
    const transitions = project.transitions || {};
    const applyAll = (id) => {
      const next = {};
      rows.forEach((_, i) => { if (i > 0) next[i] = id; });
      onUpdateProject({ transitions: next });
    };
    return (
      <div className="sp-section-body">
        {rows.length < 2 ? (
          <div className="sp-empty-card">
            <Icon name="transitions" size={28} />
            <p>Transitions appear between scenes. You need at least two scenes.</p>
          </div>
        ) : (
          <>
            <div className="sp-media-label" style={{ padding: 0 }}>Apply to all cuts</div>
            <div className="sp-transition-chips">
              {TRANSITION_TYPES.map(t => (
                <button key={t.id} className="sp-chip" onClick={() => applyAll(t.id)}>{t.label}</button>
              ))}
            </div>
            <div className="sp-media-label" style={{ padding: '8px 0 0' }}>Per scene</div>
            {rows.map((row, i) => i > 0 && (
              <div key={row.id ?? i} className={`sp-transition-row${i === currentSlideIdx ? ' active' : ''}`}>
                <button className="sp-transition-jump" onClick={() => onSeek(row.start ?? 0)} title="Jump to cut">
                  {i} → {i + 1}
                </button>
                <select
                  className="rp-select"
                  value={transitions[i] || 'none'}
                  onChange={e => onSetTransition(i, e.target.value)}
                >
                  {TRANSITION_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  // ── Tab: Project ──────────────────────────────────────────────────────────
  const renderProject = () => (
    <div className="sp-section-body">
      <label className="rp-label" htmlFor="sp-project-name">Project name</label>
      <input
        id="sp-project-name"
        className="rp-input"
        value={project.name || ''}
        onChange={e => onUpdateProject({ name: e.target.value })}
      />
      <div className="sp-stats">
        <div><strong>{rows.length}</strong><span>Scenes</span></div>
        <div><strong>{(project.layers || []).length}</strong><span>Layers</span></div>
        <div><strong>{fmt(duration)}</strong><span>Length</span></div>
      </div>
      <button className="sp-tool-btn" onClick={onSaveProject}><Icon name="save" size={14} /> Save studio project</button>
      <button className="sp-tool-btn" onClick={onLoadProject}><Icon name="folder" size={14} /> Open studio project</button>
      <button className="sp-tool-btn" onClick={onBack}><Icon name="back" size={14} /> Back to Video Maker</button>
      <p className="sp-hint">To import a new script, merge it in the Video Maker and click <b>Open in Studio</b>.</p>
    </div>
  );

  const body = {
    media: renderMedia,
    scenes: renderScenes,
    text: renderText,
    shapes: renderShapes,
    transitions: renderTransitions,
    project: renderProject,
  }[activeTab];

  return (
    <aside className="studio-left-panel">
      {hiddenInputs}
      <div className="sp-panel-header">
        <h2>{TAB_TITLES[activeTab] || ''}</h2>
        <button onClick={onClose} title="Collapse panel"><Icon name="chevronsLeft" size={18} /></button>
      </div>
      {body ? body() : null}
      {(activeTab === 'scenes' || activeTab === 'transitions') && rows.length === 0 && onOpenTab && (
        <div className="sp-section-body">
          <button className="sp-tool-btn" onClick={() => onOpenTab('media')}><Icon name="media" size={14} /> Go to My media</button>
        </div>
      )}
    </aside>
  );
}
