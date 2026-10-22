import { useEffect } from 'react';

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

export default function ImagePreviewModal({
  isOpen = false,
  slideIndex = 0,
  slides = [],
  rows = [],
  duration = 0,
  effectiveImageUrls = [],
  generatedImages = {},
  slidePrompts = {},
  slideAnimations = {},
  onClose = () => {},
  onSelectSlide = () => {},
  onGenerateImage = () => {},
  onDownloadImage = () => {},
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onSelectSlide((slideIndex + 1) % slides.length);
      if (e.key === 'ArrowLeft') onSelectSlide((slideIndex - 1 + slides.length) % slides.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, slideIndex, slides.length, onClose, onSelectSlide]);

  if (!isOpen || !slides.length) return null;

  const currentSlide = slides[slideIndex] || {};
  const currentRow = rows[slideIndex] || {};
  const nextRow = rows[slideIndex + 1];
  const startTime = currentRow.start ?? 0;
  const endTime = nextRow ? nextRow.start : duration;
  const imgUrl = effectiveImageUrls[slideIndex];
  const isAi = Boolean(generatedImages[slideIndex]);
  const currentPrompt = slidePrompts[slideIndex] || currentSlide.text || '';
  const currentAnim = slideAnimations[slideIndex] || 'auto';

  return (
    <div className="preview-modal-backdrop" onClick={onClose}>
      <div className="preview-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="preview-modal-header">
          <div className="modal-title-group">
            <h3>🖼️ Slide #{currentSlide.id || slideIndex + 1} Image Preview</h3>
            <span className="badge badge-info">
              {slideIndex + 1} of {slides.length}
            </span>
            {isAi ? (
              <span className="badge badge-success">✨ AI Generated</span>
            ) : imgUrl ? (
              <span className="badge">📁 Uploaded File</span>
            ) : (
              <span className="badge badge-warn">⚠️ No Image</span>
            )}
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        {/* Modal Main Body */}
        <div className="preview-modal-body">
          {/* Left / Center: Large Image Display with Navigation Arrows */}
          <div className="preview-image-stage">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={`Slide ${currentSlide.id}`}
                className="preview-modal-img"
              />
            ) : (
              <div className="preview-modal-no-img">
                <span className="no-img-icon">🖼️</span>
                <p>No image attached to this slide yet.</p>
                <button
                  type="button"
                  className="primary-btn small-btn"
                  onClick={() => onGenerateImage(slideIndex)}
                >
                  🎨 Generate with Google AI
                </button>
              </div>
            )}

            {/* Previous Arrow */}
            {slides.length > 1 && (
              <button
                type="button"
                className="modal-arrow-btn arrow-prev"
                onClick={() => onSelectSlide((slideIndex - 1 + slides.length) % slides.length)}
                title="Previous Slide (←)"
              >
                ◀
              </button>
            )}

            {/* Next Arrow */}
            {slides.length > 1 && (
              <button
                type="button"
                className="modal-arrow-btn arrow-next"
                onClick={() => onSelectSlide((slideIndex + 1) % slides.length)}
                title="Next Slide (→)"
              >
                ▶
              </button>
            )}
          </div>

          {/* Right: Slide Metadata & Quick Actions */}
          <div className="preview-modal-sidebar">
            <div className="sidebar-group">
              <label className="sidebar-label">Voiceover Timestamp:</label>
              <div className="timecode-pill">
                <span>{fmt(startTime)}</span>
                <span className="sep">→</span>
                <span>{fmt(endTime)}</span>
                <small>({(endTime - startTime).toFixed(1)}s)</small>
              </div>
            </div>

            <div className="sidebar-group">
              <label className="sidebar-label">Animation Motion:</label>
              <span className="anim-pill-badge">{currentAnim}</span>
            </div>

            <div className="sidebar-group">
              <label className="sidebar-label">Script Text:</label>
              <p className="sidebar-text-box">{currentSlide.text || <em>Empty</em>}</p>
            </div>

            <div className="sidebar-group">
              <label className="sidebar-label">Active Image Prompt:</label>
              <p className="sidebar-prompt-box">{currentPrompt || <em>No prompt</em>}</p>
            </div>

            {/* Actions */}
            <div className="modal-actions-column">
              <button
                type="button"
                className="primary-btn"
                onClick={() => onGenerateImage(slideIndex)}
              >
                {isAi ? '🔄 Re-roll AI Image' : '🎨 Generate Image with AI'}
              </button>

              {imgUrl && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onDownloadImage(slideIndex)}
                >
                  💾 Download Image (.jpg)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal Thumbnail Strip Footer */}
        <div className="preview-modal-footer">
          <div className="modal-thumb-strip">
            {slides.map((s, i) => {
              const thumbUrl = effectiveImageUrls[i];
              const isSelected = i === slideIndex;
              return (
                <div
                  key={s.id || i}
                  className={`modal-strip-item ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectSlide(i)}
                  title={`Jump to Slide #${s.id || i + 1}`}
                >
                  {thumbUrl ? (
                    <img src={thumbUrl} alt={`Slide ${s.id}`} />
                  ) : (
                    <div className="thumb-strip-empty">#{s.id || i + 1}</div>
                  )}
                  <span className="strip-item-tag">#{s.id || i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
