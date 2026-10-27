import { useState, useMemo, useEffect } from 'react';
import { TEXT_STYLE_PRESETS, createDefaultTextOverlay } from '../lib/renderVideo';

const FONT_FAMILIES = [
  { id: 'Impact', label: 'Impact (Viral / Punchy)' },
  { id: 'system-ui', label: 'System UI (Modern Sans)' },
  { id: 'Arial', label: 'Arial (Clean)' },
  { id: 'Georgia', label: 'Georgia (Cinematic Serif)' },
  { id: 'Courier New', label: 'Courier New (Typewriter)' },
  { id: 'Verdana', label: 'Verdana (Bold Legible)' },
];

const ANIMATION_OPTIONS = [
  { id: 'bounce', label: '🏀 Bouncy Pop' },
  { id: 'pop', label: '💥 Quick Pop' },
  { id: 'fade-in', label: '🌫️ Smooth Fade' },
  { id: 'slide-up', label: '⬆️ Slide Up' },
  { id: 'typewriter', label: '⌨️ Typewriter' },
  { id: 'none', label: '🚫 None (Static)' },
];

const POSITION_PRESETS = [
  { id: 'top', label: '🔝 Top Banner', y: 0.12 },
  { id: 'center', label: '🎯 Center Hook', y: 0.44 },
  { id: 'lower-third', label: '📌 Lower Third', y: 0.72 },
  { id: 'bottom', label: '⬇️ Bottom Subtitle', y: 0.84 },
  { id: 'custom', label: '📐 Custom Position' },
];

export default function TextOverlayEditorModal({
  isOpen,
  onClose,
  currentTime = 0,
  duration = 30,
  overlays = [],
  onChangeOverlays,
  selectedOverlayId,
  onSelectOverlay,
  onSeek,
  isVertical = false,
}) {
  const [animKey, setAnimKey] = useState(0);
  const [activeId, setActiveId] = useState(() => {
    if (selectedOverlayId && overlays.some((o) => o.id === selectedOverlayId)) {
      return selectedOverlayId;
    }
    return overlays[0]?.id || null;
  });

  // Keep internal activeId pinned when selectedOverlayId changes from props or modal opens
  useEffect(() => {
    if (selectedOverlayId && overlays.some((o) => o.id === selectedOverlayId)) {
      setActiveId(selectedOverlayId);
    } else if (activeId && !overlays.some((o) => o.id === activeId) && overlays.length > 0) {
      setActiveId(overlays[0].id);
    }
  }, [selectedOverlayId, overlays, isOpen]);

  const activeOverlay = useMemo(() => {
    if (!overlays.length) return null;
    return overlays.find((o) => o.id === activeId) || overlays[0];
  }, [overlays, activeId]);

  if (!isOpen) return null;

  const updateActive = (changes) => {
    if (!activeOverlay) return;
    const targetId = activeOverlay.id;
    const updated = overlays.map((o) => (o.id === targetId ? { ...o, ...changes } : o));
    onChangeOverlays(updated);
  };

  const handleAddNew = () => {
    const newOverlay = createDefaultTextOverlay(currentTime, `TEXT HOOK #${overlays.length + 1}`);
    onChangeOverlays([...overlays, newOverlay]);
    setActiveId(newOverlay.id);
    onSelectOverlay?.(newOverlay.id);
  };

  const handleDeleteActive = () => {
    if (!activeOverlay) return;
    const deletedId = activeOverlay.id;
    const nextList = overlays.filter((o) => o.id !== deletedId);
    onChangeOverlays(nextList);
    const nextActiveId = nextList[0]?.id || null;
    setActiveId(nextActiveId);
    if (nextActiveId) onSelectOverlay?.(nextActiveId);
  };

  const handleApplyPreset = (preset) => {
    updateActive({
      stylePreset: preset.id,
      fontFamily: preset.fontFamily,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight,
      color: preset.color,
      strokeColor: preset.strokeColor,
      strokeWidth: preset.strokeWidth,
      shadowColor: preset.shadowColor,
      shadowBlur: preset.shadowBlur,
      shadowOffsetY: preset.shadowOffsetY,
      bgColor: preset.bgColor,
      bgRadius: preset.bgRadius,
      bgPaddingX: preset.bgPaddingX,
      bgPaddingY: preset.bgPaddingY,
      bgBorderColor: preset.bgBorderColor,
      bgBorderWidth: preset.bgBorderWidth,
      textTransform: preset.textTransform,
      animation: preset.animation,
      animDuration: preset.animDuration,
      presetPosition: preset.presetPosition || activeOverlay.presetPosition,
    });
    setAnimKey((k) => k + 1);
  };

  const hasBg = Boolean(activeOverlay?.bgColor && activeOverlay.bgColor !== 'transparent' && activeOverlay.bgColor !== 'none');
  const hasBorder = Boolean(hasBg && (activeOverlay?.bgBorderWidth || 0) > 0 && activeOverlay?.bgBorderColor && activeOverlay.bgBorderColor !== 'transparent');

  // Compute normalized coords for live preview
  let previewX = activeOverlay?.presetPosition === 'custom' && activeOverlay?.x !== undefined ? activeOverlay.x : 0.5;
  let previewY = 0.5;
  if (activeOverlay?.presetPosition === 'top') {
    previewY = isVertical ? 0.12 : 0.10;
  } else if (activeOverlay?.presetPosition === 'center') {
    previewY = isVertical ? 0.44 : 0.42;
  } else if (activeOverlay?.presetPosition === 'lower-third') {
    previewY = isVertical ? 0.72 : 0.68;
  } else if (activeOverlay?.presetPosition === 'bottom') {
    previewY = isVertical ? 0.84 : 0.82;
  } else if (activeOverlay?.presetPosition === 'custom' && activeOverlay?.y !== undefined) {
    previewY = activeOverlay.y;
  }

  // Handle click on the live preview screen to position text
  const handleStageClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0.08, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const clickY = Math.max(0.08, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    updateActive({
      presetPosition: 'custom',
      x: Number(clickX.toFixed(3)),
      y: Number(clickY.toFixed(3)),
    });
  };

  return (
    <div className="text-editor-modal-backdrop" onClick={onClose}>
      <div className="text-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="text-editor-header">
          <div className="text-editor-title-wrap">
            <span className="text-editor-icon">✨</span>
            <div>
              <h3>Timeline Text & Hook Overlays</h3>
              <p>Add multiple decorated texts at any timestamp and place anywhere on the slide.</p>
            </div>
          </div>
          <button type="button" className="text-editor-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Overlays Selector Bar */}
        <div className="text-overlays-nav-bar">
          <div className="text-overlays-chips-scroll">
            {overlays.map((o, idx) => {
              const isSel = o.id === activeOverlay?.id;
              const dur = Math.max(0.1, (o.endTime ?? 0) - (o.startTime ?? 0));
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`text-overlay-chip ${isSel ? 'active' : ''}`}
                  onClick={() => {
                    setActiveId(o.id);
                    onSelectOverlay?.(o.id);
                    onSeek?.(o.startTime ?? 0);
                  }}
                >
                  <span className="chip-time">{o.startTime.toFixed(1)}s</span>
                  <span className="chip-label">
                    {o.text ? o.text.slice(0, 16) + (o.text.length > 16 ? '…' : '') : `Text ${idx + 1}`}
                  </span>
                  <span className="chip-dur">({dur.toFixed(1)}s)</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="add-text-btn-accent"
            onClick={handleAddNew}
            title="Add new text at current playhead"
          >
            + Add Text
          </button>
        </div>

        {/* Modal Body */}
        {activeOverlay ? (
          <div className="text-editor-body">
            {/* ── TOP: Live Decoration Preview Screen Before Done & Apply ── */}
            <div className="modal-live-preview-section">
              <div className="modal-preview-header">
                <span className="preview-tag">
                  📺 Live Decoration & Placement Preview (Click anywhere on screen to reposition)
                </span>
                <button
                  type="button"
                  className="replay-anim-btn"
                  onClick={() => setAnimKey((k) => k + 1)}
                  title="Replay entrance kinetic animation"
                >
                  🔄 Replay Animation
                </button>
              </div>

              {/* Simulated Slide Canvas Stage */}
              <div
                className={`modal-preview-stage ${isVertical ? 'vertical-stage' : ''}`}
                onClick={handleStageClick}
                title="Click anywhere to reposition text on slide"
              >
                {/* Background Grid Pattern & Aspect Indicator */}
                <div className="stage-aspect-indicator">{isVertical ? '9:16 Story / Reel' : '16:9 Landscape'}</div>
                <div className="stage-center-guideline" />

                {/* Rendered Animated Decorated Text Overlay */}
                <div
                  key={animKey}
                  className={`modal-preview-rendered-text anim-${activeOverlay.animation || 'bounce'}`}
                  style={{
                    left: `${previewX * 100}%`,
                    top: `${previewY * 100}%`,
                    fontFamily: `${activeOverlay.fontFamily || 'Impact'}, sans-serif`,
                    fontSize: `${Math.round((activeOverlay.fontSize || 44) * 0.65)}px`,
                    fontWeight: activeOverlay.fontWeight || '800',
                    color: activeOverlay.color || '#ffffff',
                    WebkitTextStroke:
                      activeOverlay.strokeWidth && activeOverlay.strokeWidth > 0
                        ? `${Math.max(1, Math.round(activeOverlay.strokeWidth * 0.6))}px ${activeOverlay.strokeColor || '#000'}`
                        : 'none',
                    textShadow:
                      activeOverlay.shadowBlur && activeOverlay.shadowBlur > 0
                        ? `0 3px ${activeOverlay.shadowBlur}px ${activeOverlay.shadowColor || 'rgba(0,0,0,0.8)'}`
                        : 'none',
                    background: hasBg ? activeOverlay.bgColor : 'transparent',
                    borderRadius: hasBg ? `${activeOverlay.bgRadius !== undefined ? activeOverlay.bgRadius : 10}px` : '0px',
                    padding: hasBg ? `${(activeOverlay.bgPaddingY || 10) * 0.65}px ${(activeOverlay.bgPaddingX || 20) * 0.65}px` : '4px 8px',
                    border: hasBorder ? `${activeOverlay.bgBorderWidth}px solid ${activeOverlay.bgBorderColor}` : 'none',
                    textTransform: activeOverlay.textTransform || 'uppercase',
                    textAlign: activeOverlay.textAlign || 'center',
                    animationDuration: `${activeOverlay.animDuration || 0.35}s`,
                  }}
                >
                  {activeOverlay.text || 'YOUR TEXT HERE'}
                </div>
              </div>

              {/* Position Alignment Quick Action Bar */}
              <div className="preview-alignment-bar">
                <span className="alignment-label">📐 Quick Align:</span>
                <div className="alignment-btn-group">
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'custom', x: 0.18 })}
                    title="Align Left"
                  >
                    ⇤ Left
                  </button>
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'custom', x: 0.5 })}
                    title="Center Horizontally"
                  >
                    ↔ Center
                  </button>
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'custom', x: 0.82 })}
                    title="Align Right"
                  >
                    ⇥ Right
                  </button>
                </div>

                <div className="alignment-btn-group">
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'top', y: isVertical ? 0.12 : 0.10, x: 0.5 })}
                    title="Top Banner"
                  >
                    🔝 Top
                  </button>
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'center', y: isVertical ? 0.44 : 0.42, x: 0.5 })}
                    title="Center Hook"
                  >
                    🎯 Middle
                  </button>
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'lower-third', y: isVertical ? 0.72 : 0.68, x: 0.5 })}
                    title="Lower Third"
                  >
                    📌 Lower-3rd
                  </button>
                  <button
                    type="button"
                    className="align-tool-btn"
                    onClick={() => updateActive({ presetPosition: 'bottom', y: isVertical ? 0.84 : 0.82, x: 0.5 })}
                    title="Bottom Subtitle"
                  >
                    ⬇️ Bottom
                  </button>
                </div>
              </div>
            </div>

            {/* Left Column: Text & Presets */}
            <div className="text-editor-left-col">
              <div className="editor-group">
                <div className="editor-group-title">
                  <span>✍️ Text Content</span>
                  <button
                    type="button"
                    className="delete-text-link"
                    onClick={handleDeleteActive}
                    title="Delete this text overlay"
                  >
                    🗑️ Delete Text
                  </button>
                </div>
                <textarea
                  className="text-input-field"
                  rows={3}
                  value={activeOverlay.text || ''}
                  onChange={(e) => updateActive({ text: e.target.value })}
                  placeholder="Enter text to display..."
                />
              </div>

              {/* Decorative Style Presets */}
              <div className="editor-group">
                <div className="editor-group-title">🎨 One-Click Decorative Presets</div>
                <div className="style-presets-grid">
                  {TEXT_STYLE_PRESETS.map((p) => {
                    const isActive = activeOverlay.stylePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`style-preset-btn ${isActive ? 'selected' : ''}`}
                        onClick={() => handleApplyPreset(p)}
                        title={p.description}
                      >
                        <span className="preset-name">{p.name}</span>
                        <span className="preset-desc">{p.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Placement & Position on Slide */}
              <div className="editor-group">
                <div className="editor-group-title">📍 Placement on Slide</div>
                <div className="position-presets-row">
                  {POSITION_PRESETS.map((pos) => {
                    const isPos = activeOverlay.presetPosition === pos.id;
                    return (
                      <button
                        key={pos.id}
                        type="button"
                        className={`pos-preset-btn ${isPos ? 'active' : ''}`}
                        onClick={() => {
                          if (pos.id === 'custom') {
                            updateActive({ presetPosition: 'custom' });
                          } else {
                            updateActive({ presetPosition: pos.id, y: pos.y, x: 0.5 });
                          }
                        }}
                      >
                        {pos.label}
                      </button>
                    );
                  })}
                </div>

                {activeOverlay.presetPosition === 'custom' && (
                  <div className="custom-pos-sliders">
                    <div className="slider-row">
                      <span>Vertical Y: {Math.round((activeOverlay.y ?? 0.5) * 100)}%</span>
                      <input
                        type="range"
                        min="0.05"
                        max="0.95"
                        step="0.02"
                        value={activeOverlay.y ?? 0.5}
                        onChange={(e) => updateActive({ y: parseFloat(e.target.value) })}
                      />
                    </div>
                    <div className="slider-row">
                      <span>Horizontal X: {Math.round((activeOverlay.x ?? 0.5) * 100)}%</span>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.02"
                        value={activeOverlay.x ?? 0.5}
                        onChange={(e) => updateActive({ x: parseFloat(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Timing, Styling & Decoration Details */}
            <div className="text-editor-right-col">
              {/* Timing on Timeline */}
              <div className="editor-group">
                <div className="editor-group-title">
                  <span>⏱️ Timeline Timing & Duration</span>
                  <button
                    type="button"
                    className="sync-playhead-btn"
                    onClick={() => {
                      const dur = Math.max(0.5, (activeOverlay.endTime ?? 3) - (activeOverlay.startTime ?? 0));
                      updateActive({
                        startTime: Number(currentTime.toFixed(2)),
                        endTime: Number((currentTime + dur).toFixed(2)),
                      });
                    }}
                    title="Move start timestamp to current playhead"
                  >
                    📍 Set Start to Playhead ({currentTime.toFixed(1)}s)
                  </button>
                </div>
                <div className="timing-inputs-grid">
                  <label className="timing-box">
                    <span>Start Timestamp</span>
                    <div className="num-with-unit">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max={Math.max(0, (activeOverlay.endTime ?? 1) - 0.2)}
                        value={activeOverlay.startTime ?? 0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          updateActive({ startTime: Math.max(0, val) });
                          onSeek?.(val);
                        }}
                      />
                      <em>sec</em>
                    </div>
                  </label>

                  <label className="timing-box">
                    <span>Duration</span>
                    <div className="num-with-unit">
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        max="60"
                        value={Number(
                          Math.max(0.1, (activeOverlay.endTime ?? 3) - (activeOverlay.startTime ?? 0)).toFixed(2)
                        )}
                        onChange={(e) => {
                          const d = parseFloat(e.target.value) || 0.5;
                          updateActive({
                            endTime: Number(((activeOverlay.startTime ?? 0) + Math.max(0.2, d)).toFixed(2)),
                          });
                        }}
                      />
                      <em>sec</em>
                    </div>
                  </label>

                  <label className="timing-box">
                    <span>End Timestamp</span>
                    <div className="num-with-unit readonly">
                      <input type="text" readOnly value={`${(activeOverlay.endTime ?? 3).toFixed(1)}s`} />
                    </div>
                  </label>
                </div>
              </div>

              {/* Typography & Decoration Options */}
              <div className="editor-group">
                <div className="editor-group-title">🔤 Typography & Appearance</div>

                <div className="two-cols-row">
                  <label className="field-group">
                    <span>Font Family</span>
                    <select
                      value={activeOverlay.fontFamily || 'Impact'}
                      onChange={(e) => updateActive({ fontFamily: e.target.value })}
                    >
                      {FONT_FAMILIES.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Text Case</span>
                    <select
                      value={activeOverlay.textTransform || 'uppercase'}
                      onChange={(e) => updateActive({ textTransform: e.target.value })}
                    >
                      <option value="uppercase">UPPERCASE</option>
                      <option value="none">Normal (As typed)</option>
                      <option value="lowercase">lowercase</option>
                    </select>
                  </label>
                </div>

                <div className="slider-row">
                  <span>Font Size: {activeOverlay.fontSize || 44}px</span>
                  <input
                    type="range"
                    min="20"
                    max="84"
                    step="2"
                    value={activeOverlay.fontSize || 44}
                    onChange={(e) => updateActive({ fontSize: parseInt(e.target.value, 10) })}
                  />
                </div>

                <div className="color-pickers-row">
                  <label className="color-item">
                    <span>Fill Color</span>
                    <input
                      type="color"
                      value={activeOverlay.color || '#fde047'}
                      onChange={(e) => updateActive({ color: e.target.value })}
                    />
                  </label>

                  <label className="color-item">
                    <span>Outline Stroke</span>
                    <input
                      type="color"
                      value={activeOverlay.strokeColor || '#000000'}
                      onChange={(e) => updateActive({ strokeColor: e.target.value })}
                    />
                  </label>

                  <label className="color-item">
                    <span>Glow / Shadow</span>
                    <input
                      type="color"
                      value={
                        activeOverlay.shadowColor?.startsWith('#')
                          ? activeOverlay.shadowColor
                          : '#38bdf8'
                      }
                      onChange={(e) => updateActive({ shadowColor: e.target.value })}
                    />
                  </label>

                </div>

                <div className="two-cols-row" style={{ marginTop: '10px' }}>
                  <label className="field-group">
                    <span>Stroke Width: {activeOverlay.strokeWidth || 0}px</span>
                    <input
                      type="range"
                      min="0"
                      max="12"
                      value={activeOverlay.strokeWidth || 0}
                      onChange={(e) => updateActive({ strokeWidth: parseInt(e.target.value, 10) })}
                    />
                  </label>

                  <label className="field-group">
                    <span>Glow Blur: {activeOverlay.shadowBlur || 0}px</span>
                    <input
                      type="range"
                      min="0"
                      max="30"
                      value={activeOverlay.shadowBlur || 0}
                      onChange={(e) => updateActive({ shadowBlur: parseInt(e.target.value, 10) })}
                    />
                  </label>
                </div>
              </div>

              {/* Box Background & Border Options */}
              <div className="editor-group">
                <div className="editor-group-title">
                  <span>📦 Box Background & Border</span>
                  <div className="quick-bg-toggles">
                    <button
                      type="button"
                      className={`pill-toggle-btn ${!hasBg ? 'active' : ''}`}
                      onClick={() =>
                        updateActive({
                          bgColor: 'transparent',
                          bgBorderWidth: 0,
                          bgBorderColor: 'transparent',
                        })
                      }
                      title="No background or border - Just clean text"
                    >
                      🚫 No Background (Just Text)
                    </button>
                    <button
                      type="button"
                      className={`pill-toggle-btn ${hasBg && (activeOverlay.bgRadius || 0) < 50 ? 'active' : ''}`}
                      onClick={() =>
                        updateActive({
                          bgColor:
                            activeOverlay.bgColor && activeOverlay.bgColor !== 'transparent'
                              ? activeOverlay.bgColor
                              : 'rgba(0,0,0,0.85)',
                          bgRadius: 10,
                          bgPaddingX: 20,
                          bgPaddingY: 10,
                        })
                      }
                      title="Solid Card Box"
                    >
                      ⬛ Solid Card
                    </button>
                    <button
                      type="button"
                      className={`pill-toggle-btn ${hasBg && (activeOverlay.bgRadius || 0) >= 50 ? 'active' : ''}`}
                      onClick={() =>
                        updateActive({
                          bgColor:
                            activeOverlay.bgColor && activeOverlay.bgColor !== 'transparent'
                              ? activeOverlay.bgColor
                              : 'rgba(15,23,42,0.92)',
                          bgRadius: 999,
                          bgPaddingX: 24,
                          bgPaddingY: 12,
                        })
                      }
                      title="Rounded Pill Capsule"
                    >
                      💊 Pill Capsule
                    </button>
                  </div>
                </div>

                {hasBg ? (
                  <div className="bg-settings-expanded">
                    <div className="color-pickers-row">
                      <label className="color-item">
                        <span>Background Color</span>
                        <input
                          type="color"
                          value={
                            activeOverlay.bgColor?.startsWith('#')
                              ? activeOverlay.bgColor
                              : '#0f172a'
                          }
                          onChange={(e) => updateActive({ bgColor: e.target.value })}
                        />
                      </label>

                      <label className="color-item">
                        <span>Border Color</span>
                        <input
                          type="color"
                          value={
                            activeOverlay.bgBorderColor?.startsWith('#')
                              ? activeOverlay.bgBorderColor
                              : '#38bdf8'
                          }
                          onChange={(e) => updateActive({ bgBorderColor: e.target.value })}
                        />
                      </label>
                    </div>

                    <div className="two-cols-row" style={{ marginTop: '10px' }}>
                      <label className="field-group">
                        <div className="field-label-row">
                          <span>Border Width: {activeOverlay.bgBorderWidth || 0}px</span>
                          <button
                            type="button"
                            className="text-link-mini"
                            onClick={() =>
                              updateActive({ bgBorderWidth: 0, bgBorderColor: 'transparent' })
                            }
                            title="Remove border completely"
                          >
                            Remove Border (0px)
                          </button>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="8"
                          value={activeOverlay.bgBorderWidth || 0}
                          onChange={(e) => {
                            const bw = parseInt(e.target.value, 10);
                            updateActive({
                              bgBorderWidth: bw,
                              bgBorderColor:
                                bw > 0 &&
                                (!activeOverlay.bgBorderColor ||
                                  activeOverlay.bgBorderColor === 'transparent')
                                  ? '#38bdf8'
                                  : activeOverlay.bgBorderColor,
                            });
                          }}
                        />
                      </label>

                      <label className="field-group">
                        <span>Corner Radius: {activeOverlay.bgRadius ?? 10}px</span>
                        <input
                          type="range"
                          min="0"
                          max="40"
                          value={activeOverlay.bgRadius ?? 10}
                          onChange={(e) => updateActive({ bgRadius: parseInt(e.target.value, 10) })}
                        />
                      </label>
                    </div>

                    <div className="two-cols-row" style={{ marginTop: '8px' }}>
                      <label className="field-group">
                        <span>Horizontal Padding: {activeOverlay.bgPaddingX ?? 20}px</span>
                        <input
                          type="range"
                          min="6"
                          max="48"
                          value={activeOverlay.bgPaddingX ?? 20}
                          onChange={(e) => updateActive({ bgPaddingX: parseInt(e.target.value, 10) })}
                        />
                      </label>

                      <label className="field-group">
                        <span>Vertical Padding: {activeOverlay.bgPaddingY ?? 10}px</span>
                        <input
                          type="range"
                          min="4"
                          max="28"
                          value={activeOverlay.bgPaddingY ?? 10}
                          onChange={(e) => updateActive({ bgPaddingY: parseInt(e.target.value, 10) })}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="no-bg-info-badge">
                    <span>✨ No Background: Text renders cleanly directly over the video with zero box or border.</span>
                  </div>
                )}
              </div>

              {/* Entrance Animation */}
              <div className="editor-group">
                <div className="editor-group-title">🎬 Entrance Kinetic Animation</div>
                <div className="two-cols-row">
                  <label className="field-group">
                    <span>Animation Type</span>
                    <select
                      value={activeOverlay.animation || 'bounce'}
                      onChange={(e) => updateActive({ animation: e.target.value })}
                    >
                      {ANIMATION_OPTIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Animation Duration: {(activeOverlay.animDuration || 0.35).toFixed(2)}s</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      value={activeOverlay.animDuration || 0.35}
                      onChange={(e) => updateActive({ animDuration: parseFloat(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-editor-empty">
            <span style={{ fontSize: '36px' }}>✍️</span>
            <h4>No Text Overlays Yet</h4>
            <p>Click below to add your first decorated text at {currentTime.toFixed(1)}s on the timeline.</p>
            <button type="button" className="primary-btn" onClick={handleAddNew}>
              + Add First Text Overlay
            </button>
          </div>
        )}

        {/* Modal Footer */}
        <div className="text-editor-footer">
          <span className="footer-status-pill">
            {overlays.length} Text {overlays.length === 1 ? 'Overlay' : 'Overlays'} on Timeline
          </span>
          <button type="button" className="primary-btn" onClick={onClose}>
            ✓ Done & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
