import { useRef, useState } from 'react';
import { getSlideAnimation } from '../lib/animations';

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

export default function SlideEllipseDrawer({
  rows = [],
  slides = [],
  duration = 0,
  currentTime = 0,
  effectiveImageUrls = [],
  generatedImages = {},
  animationMode = 'random',
  slideAnimations = {},
  slidePrompts = {},
  onSetSlideAnimation = () => {},
  onSetSlidePrompt = () => {},
  onGenerateSlideImage = () => {},
  onPreviewImage = () => {},
  onSeek = () => {},
  isGenerating = false,
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [editingPromptIndex, setEditingPromptIndex] = useState(null);
  const shelfRef = useRef(null);

  if (!rows || rows.length === 0) return null;

  const scrollShelf = (offset) => {
    if (shelfRef.current) {
      shelfRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="ellipse-drawer-container">
      {/* Drawer Toggle Header Bar */}
      <div className="ellipse-drawer-header">
        <div className="ellipse-header-left">
          <span className="drawer-icon">🎞️</span>
          <strong>Slide Images &amp; AI Prompt Shelf</strong>
          <span className="badge badge-info">{rows.length} Slides</span>
          {Object.keys(generatedImages).length > 0 && (
            <span className="badge badge-success">
              ✨ {Object.keys(generatedImages).length} AI Generated
            </span>
          )}
        </div>

        <div className="ellipse-header-right">
          {isOpen && (
            <div className="shelf-nav-buttons">
              <button
                type="button"
                className="shelf-nav-btn"
                onClick={() => scrollShelf(-320)}
                title="Scroll shelf left"
              >
                ◀
              </button>
              <button
                type="button"
                className="shelf-nav-btn"
                onClick={() => scrollShelf(320)}
                title="Scroll shelf right"
              >
                ▶
              </button>
            </div>
          )}

          {/* Toggle Button */}
          <button
            type="button"
            className="drawer-toggle-btn"
            onClick={() => setIsOpen((prev) => !prev)}
          >
            {isOpen ? '▲ Collapse Shelf' : '▼ Expand Slide Images & Animations'}
          </button>
        </div>
      </div>

      {/* Collapsible Elliptical Shelf Content */}
      {isOpen && (
        <div className="ellipse-shelf-wrapper" ref={shelfRef}>
          <div className="ellipse-cards-track">
            {rows.map((row, i) => {
              const nextStart = rows[i + 1] ? rows[i + 1].start : duration;
              const isActive = currentTime >= row.start && currentTime < nextStart;
              const imgUrl = effectiveImageUrls[i];
              const isAiGenerated = Boolean(generatedImages[i]);
              const slide = slides[i] || {};
              const currentAnim = slideAnimations[i] || 'auto';
              const assignedAutoAnim = getSlideAnimation(animationMode, i);
              const currentPrompt = slidePrompts[i] ?? slide.text ?? '';

              return (
                <div
                  key={row.id}
                  className={`ellipse-card ${isActive ? 'active-ellipse-card' : ''}`}
                  onClick={() => onSeek(row.start)}
                  title={`Click to preview Slide #${row.id}`}
                >
                  {/* Elliptical / Rounded Image Thumbnail Frame */}
                  <div
                    className="ellipse-thumb-container"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreviewImage(i);
                    }}
                    title="Click to view full-size image preview"
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`Slide ${row.id}`}
                        className="ellipse-thumb-img"
                      />
                    ) : (
                      <div className="ellipse-thumb-placeholder">
                        <span>#{row.id}</span>
                        <small>No image</small>
                      </div>
                    )}
                    <span className="ellipse-badge-pill">#{row.id}</span>

                    {isAiGenerated && (
                      <span className="ellipse-ai-badge" title="Generated with AI">
                        ✨ AI
                      </span>
                    )}
                  </div>

                  {/* Slide Timing info */}
                  <div className="ellipse-card-timing">
                    <span>{fmt(row.start)} - {fmt(nextStart)}</span>
                  </div>

                  {/* Inline Animation Style Dropdown Selector */}
                  <div className="ellipse-anim-select-box" onClick={(e) => e.stopPropagation()}>
                    <label className="ellipse-select-label">Animation:</label>
                    <select
                      className="ellipse-select-input"
                      value={currentAnim}
                      onChange={(e) => onSetSlideAnimation(i, e.target.value)}
                    >
                      <option value="auto">🎲 Auto ({assignedAutoAnim})</option>
                      <option value="zoom-in">🔍 Zoom In</option>
                      <option value="zoom-out">🔎 Zoom Out</option>
                      <option value="pop">✨ Pop &amp; Bounce</option>
                      <option value="breathe">🫁 Breathe</option>
                      <option value="slide-left">⬅️ Slide Left</option>
                      <option value="slide-right">➡️ Slide Right</option>
                      <option value="slide-up">⬆️ Slide Up</option>
                      <option value="fade">🌫️ Fade</option>
                      <option value="pan-drift">🌊 Pan &amp; Drift</option>
                    </select>
                  </div>

                  {/* AI Prompt / Script Snippet */}
                  <div className="ellipse-prompt-area" onClick={(e) => e.stopPropagation()}>
                    {editingPromptIndex === i ? (
                      <textarea
                        rows={2}
                        className="ellipse-prompt-textarea"
                        value={currentPrompt}
                        onChange={(e) => onSetSlidePrompt(i, e.target.value)}
                        onBlur={() => setEditingPromptIndex(null)}
                        autoFocus
                        placeholder="Image prompt for this slide..."
                      />
                    ) : (
                      <div
                        className="ellipse-prompt-display"
                        onClick={() => setEditingPromptIndex(i)}
                        title="Click to edit AI image prompt"
                      >
                        <span className="prompt-label">Prompt:</span>
                        <p className="ellipse-card-snippet">
                          {currentPrompt || <em>Click to add prompt…</em>}
                        </p>
                      </div>
                    )}

                    {/* Generate / Re-roll Button */}
                    <button
                      type="button"
                      className="ellipse-gen-btn"
                      disabled={isGenerating}
                      onClick={() => onGenerateSlideImage(i)}
                      title="Generate or re-roll AI image for this slide"
                    >
                      {isAiGenerated ? '🔄 Re-roll AI Image' : '🎨 Generate Image'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
