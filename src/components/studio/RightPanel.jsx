import { useRef } from 'react';
import { Icon } from './icons';
import { LAYER_ANIMATIONS, TRANSITION_TYPES } from '../../lib/studioRender';
import { CAPTION_STYLES, HOOK_STYLES } from '../../lib/renderVideo';
import { COLOR_GRADES } from '../../lib/frameExtras';
import { SFX_MODES } from '../../lib/sfx';
import { ANIMATION_TYPES } from '../../lib/animations';

const FONT_FAMILIES = ['system-ui', 'Arial', 'Georgia', 'Courier New', 'Impact', 'Trebuchet MS', 'Verdana'];
const FONT_WEIGHTS = [
  { label: 'Normal', value: '400' },
  { label: 'Semi Bold', value: '600' },
  { label: 'Bold', value: '700' },
  { label: 'Black', value: '900' },
];
const SHAPE_TYPES = [
  { label: 'Rectangle', value: 'rect' },
  { label: 'Circle', value: 'circle' },
  { label: 'Triangle', value: 'triangle' },
  { label: 'Line', value: 'line' },
];

const TAB_TITLES = {
  properties: 'Properties',
  effects: 'Effects',
  fade: 'Fade & transitions',
  audio: 'Audio',
  captions: 'Captions',
};

// NOTE: these helpers live at module scope on purpose. Defining components
// inside render remounts them on every keystroke and steals input focus.
function Section({ title, children }) {
  return (
    <div className="rp-section">
      {title && <div className="rp-section-title">{title}</div>}
      {children}
    </div>
  );
}

function Row({ label, children, value }) {
  return (
    <div className="rp-row">
      <span className="rp-label">{label}</span>
      <div className="rp-control">{children}</div>
      {value !== undefined && <span className="rp-val">{value}</span>}
    </div>
  );
}

function NumField({ label, value, onChange, step = 1, suffix }) {
  return (
    <label className="rp-num">
      <span>{label}</span>
      <input
        className="rp-input"
        type="number"
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

function NeedsLayer({ what }) {
  return (
    <div className="rp-empty">
      <Icon name="cursor" size={28} />
      <p>Select a text, shape or image on the canvas or timeline to edit its {what}.</p>
    </div>
  );
}

// Convert rgba()/hex to a hex value usable by <input type="color">
function toHex(color, fallback = '#000000') {
  if (!color) return fallback;
  if (color.startsWith('#')) return color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color.slice(0, 7);
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const [r, g, b] = m[1].split(',').map(v => parseInt(v, 10));
  return `#${[r, g, b].map(v => (v || 0).toString(16).padStart(2, '0')).join('')}`;
}

function alphaOf(color) {
  const m = color && color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export default function RightPanel({
  activeTab = 'properties',
  layer,
  project,
  currentSlideIdx,
  onClose,
  onUpdateLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onReorderLayer,
  onUpdateProject,
  onSetTransition,
  onImportBgm,
}) {
  const replaceImageRef = useRef(null);
  const bgmInputRef = useRef(null);

  const upd = (changes) => layer && onUpdateLayer(layer.id, changes);
  const pct = (v) => Math.round((v || 0) * 100);

  const handleReplaceImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upd({ imageUrl: URL.createObjectURL(file), name: file.name });
    e.target.value = '';
  };

  // ── PROPERTIES ────────────────────────────────────────────────────────────
  const renderProperties = () => {
    if (!layer) return <NeedsLayer what="properties" />;
    return (
      <>
        <div className="rp-layer-head">
          <span className={`rp-type-badge rp-type-badge--${layer.type}`}>{layer.type}</span>
          <span className="rp-layer-name">
            {layer.type === 'text' ? (layer.text || 'Text') : layer.type === 'shape' ? (layer.shape || 'Shape') : (layer.name || (layer.type === 'video' ? 'Video clip' : 'Image'))}
          </span>
        </div>

        {layer.type === 'text' && (
          <Section title="Text">
            <textarea
              className="rp-textarea"
              rows={3}
              maxLength={500}
              value={layer.text || ''}
              onChange={e => upd({ text: e.target.value })}
            />
            <Row label="Font">
              <select className="rp-select" value={layer.fontFamily || 'system-ui'} onChange={e => upd({ fontFamily: e.target.value })}>
                {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Row>
            <Row label="Weight">
              <select className="rp-select" value={layer.fontWeight || '400'} onChange={e => upd({ fontWeight: e.target.value })}>
                {FONT_WEIGHTS.map(fw => <option key={fw.value} value={fw.value}>{fw.label}</option>)}
              </select>
            </Row>
            <Row label="Size" value={`${layer.fontSize || 32}px`}>
              <input className="rp-range" type="range" min="8" max="200" value={layer.fontSize || 32}
                onChange={e => upd({ fontSize: parseInt(e.target.value, 10) })} />
            </Row>
            <Row label="Colour">
              <input className="rp-color" type="color" value={toHex(layer.color, '#ffffff')} onChange={e => upd({ color: e.target.value })} />
              <div className="rp-align-group">
                {['left', 'center', 'right'].map(a => (
                  <button
                    key={a}
                    className={`rp-align-btn${(layer.textAlign || 'center') === a ? ' active' : ''}`}
                    onClick={() => upd({ textAlign: a })}
                    title={`Align ${a}`}
                  >
                    {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                  </button>
                ))}
                <button className={`rp-align-btn${layer.italic ? ' active' : ''}`} onClick={() => upd({ italic: !layer.italic })} title="Italic">
                  <i>I</i>
                </button>
              </div>
            </Row>
            <Row label="Highlight">
              <label className="rp-check">
                <input type="checkbox" checked={!!layer.textBg} onChange={e => upd({ textBg: e.target.checked ? 'rgba(0,0,0,0.6)' : '' })} />
                On
              </label>
              {layer.textBg && (
                <>
                  <input className="rp-color" type="color" value={toHex(layer.textBg)}
                    onChange={e => upd({ textBg: hexToRgba(e.target.value, alphaOf(layer.textBg)) })} />
                  <input className="rp-range" type="range" min="0.1" max="1" step="0.05" value={alphaOf(layer.textBg)}
                    title="Highlight opacity"
                    onChange={e => upd({ textBg: hexToRgba(toHex(layer.textBg), parseFloat(e.target.value)) })} />
                </>
              )}
            </Row>
          </Section>
        )}

        {layer.type === 'shape' && (
          <Section title="Shape">
            <Row label="Type">
              <select className="rp-select" value={layer.shape || 'rect'} onChange={e => upd({ shape: e.target.value })}>
                {SHAPE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Row>
            <Row label="Fill">
              <input className="rp-color" type="color" value={toHex(layer.fill === 'transparent' ? '' : layer.fill, '#7c3aed')}
                disabled={layer.fill === 'transparent'} onChange={e => upd({ fill: e.target.value })} />
              <label className="rp-check">
                <input type="checkbox" checked={layer.fill === 'transparent'}
                  onChange={e => upd({ fill: e.target.checked ? 'transparent' : '#7c3aed' })} />
                None
              </label>
            </Row>
            <Row label="Stroke">
              <input className="rp-color" type="color" value={toHex(layer.stroke, '#ffffff')} onChange={e => upd({ stroke: e.target.value })} />
              <input className="rp-range" type="range" min="0" max="20" value={layer.strokeWidth ?? 2}
                onChange={e => upd({ strokeWidth: parseInt(e.target.value, 10) })} />
              <span className="rp-val">{layer.strokeWidth ?? 2}</span>
            </Row>
            {(layer.shape === 'rect' || !layer.shape) && (
              <Row label="Radius" value={layer.borderRadius ?? 0}>
                <input className="rp-range" type="range" min="0" max="50" value={layer.borderRadius ?? 0}
                  onChange={e => upd({ borderRadius: parseInt(e.target.value, 10) })} />
              </Row>
            )}
          </Section>
        )}

        {layer.type === 'image' && (
          <Section title="Image">
            {layer.imageUrl && <img src={layer.imageUrl} alt="Layer" className="rp-img-thumb" />}
            <input ref={replaceImageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleReplaceImage} />
            <button className="rp-dup-btn rp-full" onClick={() => replaceImageRef.current?.click()}>
              Replace image
            </button>
          </Section>
        )}

        {layer.type === 'video' && (
          <Section title="Video clip">
            <Row label="Volume" value={layer.muted ? 'Muted' : `${Math.round((layer.volume ?? 1) * 100)}%`}>
              <input className="rp-range" type="range" min="0" max="100" value={Math.round((layer.volume ?? 1) * 100)}
                disabled={layer.muted} onChange={e => upd({ volume: parseInt(e.target.value, 10) / 100 })} />
            </Row>
            <Row label="Sound">
              <label className="rp-check">
                <input type="checkbox" checked={!!layer.muted} onChange={e => upd({ muted: e.target.checked })} />
                Mute clip audio
              </label>
            </Row>
            <div className="rp-duration">
              Starts <strong>{(layer.trimStart || 0).toFixed(1)}s</strong> into the source
              {layer.sourceDuration ? <> · source <strong>{layer.sourceDuration.toFixed(1)}s</strong></> : null}
            </div>
          </Section>
        )}

        <Section title="Position & size">
          <div className="rp-grid-2">
            <NumField label="X" suffix="%" value={pct(layer.x)} onChange={v => upd({ x: (v || 0) / 100 })} />
            <NumField label="Y" suffix="%" value={pct(layer.y)} onChange={v => upd({ y: (v || 0) / 100 })} />
            <NumField label="W" suffix="%" value={pct(layer.width)} onChange={v => upd({ width: Math.max(1, v || 1) / 100 })} />
            <NumField label="H" suffix="%" value={pct(layer.height)} onChange={v => upd({ height: Math.max(1, v || 1) / 100 })} />
          </div>
          <Row label="Rotate" value={`${Math.round(layer.rotation || 0)}°`}>
            <input className="rp-range" type="range" min="-180" max="180" value={layer.rotation || 0}
              onChange={e => upd({ rotation: parseFloat(e.target.value) })} />
          </Row>
          <Row label="Opacity" value={`${Math.round((layer.opacity ?? 1) * 100)}%`}>
            <input className="rp-range" type="range" min="0" max="100" value={Math.round((layer.opacity ?? 1) * 100)}
              onChange={e => upd({ opacity: parseFloat(e.target.value) / 100 })} />
          </Row>
          <div className="rp-align-group rp-full">
            <button className="rp-align-btn" onClick={() => upd({ x: 0.5 - layer.width / 2 })} title="Centre horizontally">↔ Centre</button>
            <button className="rp-align-btn" onClick={() => upd({ y: 0.5 - layer.height / 2 })} title="Centre vertically">↕ Middle</button>
          </div>
        </Section>

        <Section title="Timing">
          <div className="rp-grid-2">
            <NumField label="Start" suffix="s" step={0.1} value={(layer.startTime ?? 0).toFixed(1)}
              onChange={v => upd({ startTime: Math.max(0, Math.min((layer.endTime ?? 5) - 0.1, v || 0)) })} />
            <NumField label="End" suffix="s" step={0.1} value={(layer.endTime ?? 5).toFixed(1)}
              onChange={v => upd({ endTime: Math.max((layer.startTime ?? 0) + 0.1, Math.min(project.duration, v || 0)) })} />
          </div>
          <div className="rp-duration">
            Duration <strong>{((layer.endTime ?? 5) - (layer.startTime ?? 0)).toFixed(1)}s</strong>
          </div>
        </Section>

        <Section title="Arrange">
          <div className="rp-action-row">
            <button className="rp-dup-btn" onClick={() => onReorderLayer(layer.id, 'front')}>Bring front</button>
            <button className="rp-dup-btn" onClick={() => onReorderLayer(layer.id, 'back')}>Send back</button>
          </div>
          <div className="rp-action-row">
            <button className="rp-dup-btn" onClick={() => onDuplicateLayer(layer.id)}>Duplicate</button>
            <button className="rp-del-btn" onClick={() => onDeleteLayer(layer.id)}>Delete</button>
          </div>
        </Section>
      </>
    );
  };

  // ── EFFECTS (entrance animation) ──────────────────────────────────────────
  const renderEffects = () => (
    <>
      {layer ? (
        <Section title="Entrance animation">
          <div className="rp-effect-grid">
            {LAYER_ANIMATIONS.map(a => (
              <button
                key={a.id}
                className={`rp-effect-tile${(layer.animation || 'none') === a.id ? ' active' : ''}`}
                onClick={() => upd({ animation: a.id })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <Row label="Speed" value={`${(layer.animDuration ?? 0.4).toFixed(2)}s`}>
            <input className="rp-range" type="range" min="0.1" max="1.5" step="0.05" value={layer.animDuration ?? 0.4}
              onChange={e => upd({ animDuration: parseFloat(e.target.value) })} />
          </Row>
        </Section>
      ) : <NeedsLayer what="animation" />}
      <Section title="Scene image motion">
        <Row label="Mode">
          <select className="rp-select" value={project.animationMode || 'random'} onChange={e => onUpdateProject({ animationMode: e.target.value })}>
            {ANIMATION_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Row>
      </Section>
      <Section title="Color grade">
        <Row label="All scenes">
          <select className="rp-select" value={project.colorGrade || 'none'} onChange={e => onUpdateProject({ colorGrade: e.target.value })}>
            {COLOR_GRADES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Row>
        {currentSlideIdx >= 0 && (
          <Row label={`Scene ${currentSlideIdx + 1}`}>
            <select className="rp-select" value={project.slideFilters?.[currentSlideIdx] || 'auto'}
              onChange={e => onUpdateProject({ slideFilters: { ...(project.slideFilters || {}), [currentSlideIdx]: e.target.value } })}>
              <option value="auto">Same as all scenes</option>
              {COLOR_GRADES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </Row>
        )}
      </Section>
    </>
  );

  // ── FADE / TRANSITIONS ────────────────────────────────────────────────────
  const renderFade = () => {
    const rows = project.rows || [];
    const idx = currentSlideIdx;
    return (
      <>
        {idx > 0 ? (
          <Section title={`Transition into scene ${idx + 1}`}>
            <div className="rp-effect-grid">
              {TRANSITION_TYPES.map(t => (
                <button
                  key={t.id}
                  className={`rp-effect-tile${(project.transitions?.[idx] || 'none') === t.id ? ' active' : ''}`}
                  onClick={() => onSetTransition(idx, t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Section>
        ) : (
          <div className="rp-empty">
            <Icon name="transitions" size={28} />
            <p>{rows.length < 2 ? 'Add at least two scenes to use transitions.' : 'Move the playhead past the first scene to set the transition into that scene.'}</p>
          </div>
        )}
        {layer && (
          <Section title="Selected layer fade-in">
            <Row label="Fade in">
              <label className="rp-check">
                <input type="checkbox" checked={layer.animation === 'fade-in'}
                  onChange={e => upd({ animation: e.target.checked ? 'fade-in' : 'none' })} />
                Enabled
              </label>
            </Row>
            <Row label="Length" value={`${(layer.animDuration ?? 0.4).toFixed(2)}s`}>
              <input className="rp-range" type="range" min="0.1" max="1.5" step="0.05" value={layer.animDuration ?? 0.4}
                onChange={e => upd({ animDuration: parseFloat(e.target.value) })} />
            </Row>
          </Section>
        )}
      </>
    );
  };

  // ── AUDIO ─────────────────────────────────────────────────────────────────
  const renderAudio = () => (
    <>
      <Section title="Voiceover">
        <div className="rp-audio-line">
          <span className="sp-audio-icon voice"><Icon name="mic" size={15} /></span>
          <span>{project.audioUrl ? 'Narration attached' : 'No voiceover in this project'}</span>
        </div>
      </Section>
      <Section title="Background music">
        <input ref={bgmInputRef} type="file" accept="audio/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onImportBgm(f); e.target.value = ''; }} />
        <div className="rp-audio-line">
          <span className="sp-audio-icon bgm"><Icon name="music" size={15} /></span>
          <span className="rp-audio-name">{project.bgmUrl ? (project.bgmName || 'Background music') : 'No music'}</span>
        </div>
        <div className="rp-action-row">
          <button className="rp-dup-btn" onClick={() => bgmInputRef.current?.click()}>{project.bgmUrl ? 'Replace' : 'Add music'}</button>
          {project.bgmUrl && <button className="rp-del-btn" onClick={() => onUpdateProject({ bgmUrl: null, bgmName: '' })}>Remove</button>}
        </div>
        <Row label="Volume" value={`${Math.round((project.bgmVolume ?? 0.15) * 100)}%`}>
          <input className="rp-range" type="range" min="0" max="100" value={Math.round((project.bgmVolume ?? 0.15) * 100)}
            onChange={e => onUpdateProject({ bgmVolume: parseInt(e.target.value, 10) / 100 })} />
        </Row>
        <Row label="Auto-duck">
          <label className="rp-check">
            <input type="checkbox" checked={!!project.autoDuck} onChange={e => onUpdateProject({ autoDuck: e.target.checked })} />
            Lower music under voice
          </label>
        </Row>
      </Section>
      <Section title="Sound effects">
        <Row label="Effects">
          <select className="rp-select" value={project.sfx?.mode || 'none'}
            onChange={e => onUpdateProject({ sfx: { volume: 0.6, ...(project.sfx || {}), mode: e.target.value } })}>
            {SFX_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Row>
        {project.sfx?.mode && project.sfx.mode !== 'none' && (
          <Row label="Volume" value={`${Math.round((project.sfx.volume ?? 0.6) * 100)}%`}>
            <input className="rp-range" type="range" min="0" max="100" value={Math.round((project.sfx.volume ?? 0.6) * 100)}
              onChange={e => onUpdateProject({ sfx: { ...project.sfx, volume: parseInt(e.target.value, 10) / 100 } })} />
          </Row>
        )}
        <div className="rp-duration">Mixed into the exported video.</div>
      </Section>
    </>
  );

  // ── CAPTIONS ──────────────────────────────────────────────────────────────
  const renderCaptions = () => (
    <>
      <Section title="Caption style">
        <div className="rp-effect-grid">
          {CAPTION_STYLES.map(c => (
            <button
              key={c.id}
              className={`rp-effect-tile${project.captionStyle === c.id ? ' active' : ''}`}
              onClick={() => onUpdateProject({ captionStyle: c.id })}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Retention hook">
        <Row label="Style">
          <select className="rp-select" value={project.hookStyle || 'none'} onChange={e => onUpdateProject({ hookStyle: e.target.value })}>
            {HOOK_STYLES.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </Row>
      </Section>
    </>
  );

  const body = {
    properties: renderProperties,
    effects: renderEffects,
    fade: renderFade,
    audio: renderAudio,
    captions: renderCaptions,
  }[activeTab];

  return (
    <aside className="studio-right-panel">
      <div className="sp-panel-header">
        <h2>{TAB_TITLES[activeTab] || ''}</h2>
        <button onClick={onClose} title="Close panel"><Icon name="x" size={16} /></button>
      </div>
      {body ? body() : null}
    </aside>
  );
}
