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
  imageUrls = [],
  animationMode = 'random',
  slideAnimations = {},
  onSetSlideAnimation = () => {},
  onSeek = () => {},
}) {
  const [isOpen, setIsOpen] = useState(true);
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
          <strong>Slide Images &amp; Animation Shelf</strong>
          <span className="badge badge-info">{rows.length} Slides</span>
        </div>

        <div className="ellipse-header-right">
          {isOpen && (
            <div className="shelf-nav-buttons">
              <button
                type="button"
                className="shelf-nav-btn"
                onClick={() => scrollShelf(-300)}
                title="Scroll shelf left"
              >
                ◀
              </button>
              <button
                type="button"
                className="shelf-nav-btn"
                onClick={() => scrollShelf(300)}
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
              const imgUrl = imageUrls[i];
              const slide = slides[i] || {};
              const currentAnim = slideAnimations[i] || 'auto';
              const assignedAutoAnim = getSlideAnimation(animationMode, i);

              return (
                <div
                  key={row.id}
                  className={`ellipse-card ${isActive ? 'active-ellipse-card' : ''}`}
                  onClick={() => onSeek(row.start)}
                  title={`Click to preview Slide #${row.id}`}
                >
                  {/* Elliptical / Rounded Image Thumbnail Frame */}
                  <div className="ellipse-thumb-container">
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`Slide ${row.id}`}
                        className="ellipse-thumb-img"
                      />
                    ) : (
                      <div className="ellipse-thumb-placeholder">
                        #{row.id}
                      </div>
                    )}
                    <span className="ellipse-badge-pill">#{row.id}</span>
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

                  {/* Text snippet preview */}
                  <p className="ellipse-card-snippet">
                    {slide.text ? (slide.text.length > 55 ? `${slide.text.slice(0, 55)}…` : slide.text) : <em>No text</em>}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
