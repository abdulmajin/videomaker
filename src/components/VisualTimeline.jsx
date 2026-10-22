import { useRef } from 'react';

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export default function VisualTimeline({
  rows = [],
  slides = [],
  duration = 0,
  currentTime = 0,
  imageUrls = [],
  onSeek = () => {},
}) {
  const containerRef = useRef(null);

  if (!rows.length || duration <= 0) return null;

  const playheadPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  function handleTimelineClick(e) {
    if (!containerRef.current || duration <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, clickX / rect.width));
    const targetTime = ratio * duration;
    onSeek(targetTime);
  }

  return (
    <div className="visual-timeline-container">
      <div className="timeline-header">
        <div className="timeline-title">
          <span className="timeline-icon">⏱️</span>
          <strong>Interactive Slide Timeline</strong>
        </div>
        <div className="timeline-time-badge">
          <span className="current-t">{fmt(currentTime)}</span>
          <span className="sep">/</span>
          <span className="total-t">{fmt(duration)}</span>
        </div>
      </div>

      <div
        className="timeline-track"
        ref={containerRef}
        onClick={handleTimelineClick}
        title="Click anywhere to jump playhead"
      >
        {/* Slide Blocks */}
        {rows.map((row, i) => {
          const nextStart = rows[i + 1] ? rows[i + 1].start : duration;
          const slideDur = Math.max(0.1, nextStart - row.start);
          const widthPct = (slideDur / duration) * 100;
          const isActive = currentTime >= row.start && currentTime < nextStart;
          const imgUrl = imageUrls[i];

          return (
            <div
              key={row.id}
              className={`timeline-slide-block ${isActive ? 'active' : ''} ${row.match < 0.5 ? 'low-match' : ''}`}
              style={{ width: `${widthPct}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(row.start);
              }}
              title={`Slide ${row.id}: ${fmt(row.start)} - ${fmt(nextStart)} (${slideDur.toFixed(1)}s)`}
            >
              <div className="block-content">
                {imgUrl ? (
                  <img src={imgUrl} alt={`Slide ${row.id}`} className="block-thumb" />
                ) : (
                  <div className="block-thumb-placeholder">#{row.id}</div>
                )}
                <div className="block-info">
                  <span className="block-label">Slide {row.id}</span>
                  <span className="block-duration">{slideDur.toFixed(1)}s</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Real-time Playhead Cursor */}
        <div
          className="timeline-playhead"
          style={{ left: `${playheadPercent}%` }}
        >
          <div className="playhead-needle" />
          <div className="playhead-tag">{fmt(currentTime)}</div>
        </div>
      </div>

      <div className="timeline-ticks">
        <span>0:00</span>
        <span>{fmt(duration * 0.25)}</span>
        <span>{fmt(duration * 0.5)}</span>
        <span>{fmt(duration * 0.75)}</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}
