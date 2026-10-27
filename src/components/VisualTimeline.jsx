import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { getSlideAnimation } from '../lib/animations';

const fmt = (s) => {
  if (isNaN(s) || s < 0) s = 0;
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(1);
  return `${String(mins).padStart(2, '0')}:${secs.padStart(4, '0')}`;
};

export default function VisualTimeline({
  rows = [],
  slides = [],
  duration = 0,
  currentTime = 0,
  isPlaying = false,
  imageUrls = [],
  animationMode = 'random',
  slideAnimations = {},
  customTextOverlays = [],
  onSeek = () => {},
  onTogglePlay = () => {},
  onUpdateRows = null,
  onUpdateCustomTextOverlays = null,
  onOpenTextEditor = null,
  selectedTextOverlayId = null,
  onSelectTextOverlay = null,
  onAddTextOverlay = null,
}) {
  const scrollViewportRef = useRef(null);
  const trackRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1.75); // 1.0 = fit min 100%, 1.75+ = exceeds screen width
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [trimFeedback, setTrimFeedback] = useState(null); // { index, mode, newDur, delta }

  const slideTrimRef = useRef(null); // { index, mode, startX, initialRows, initialDuration, oldStart, oldEnd, oldDur, pxPerSec }
  const textDragRef = useRef(null); // { id, mode, startX, initialStart, initialEnd, pxPerSec }

  // Calculate track width in pixels based on zoom level
  // Base width ensures it exceeds window width when zoom > 1
  const trackWidth = useMemo(() => {
    if (duration <= 0) return 1200;
    // Scale: approx 45px per second at zoom 1.0, multiplied by zoomLevel
    const calculatedPx = Math.round(duration * 48 * zoomLevel);
    // Minimum 1400px so it comfortably exceeds window screen and enables horizontal scrolling
    return Math.max(1400, calculatedPx);
  }, [duration, zoomLevel]);

  // Handle click or drag seek on the timeline track
  const handleSeekFromEvent = useCallback(
    (e) => {
      if (!trackRef.current || duration <= 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTime = ratio * duration;
      onSeek(targetTime);
    },
    [duration, onSeek]
  );

  const handleMouseDown = (e) => {
    setIsDragging(true);
    handleSeekFromEvent(e);
  };

  // ── Slide Trim Drag Start (Ripple Edit with Auto Gap-Closing) ──────────────
  const handleSlideTrimStart = useCallback((e, index, mode) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0 || !onUpdateRows) return;

    const initialRows = rows.map(r => ({ ...r }));
    const initialDuration = duration;
    const oldStart = initialRows[index].start ?? 0;
    const oldEnd = initialRows[index + 1] ? initialRows[index + 1].start : initialDuration;
    const oldDur = Math.max(0.1, oldEnd - oldStart);

    const pxPerSec = trackWidth / (duration || 1);

    slideTrimRef.current = {
      index,
      mode, // 'trim-end' | 'trim-start'
      startX: e.clientX,
      initialRows,
      initialDuration,
      oldStart,
      oldEnd,
      oldDur,
      pxPerSec,
    };

    setTrimFeedback({ index, mode, newDur: oldDur, delta: 0 });
  }, [rows, duration, trackWidth, onUpdateRows]);

  // ── Text Overlay Drag & Trim Start ─────────────────────────────────────────
  const handleTextDragStart = useCallback((e, item, mode) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0 || !onUpdateCustomTextOverlays) return;

    const pxPerSec = trackWidth / (duration || 1);
    textDragRef.current = {
      id: item.id,
      mode, // 'move' | 'trim-start' | 'trim-end'
      startX: e.clientX,
      initialStart: item.startTime ?? 0,
      initialEnd: item.endTime ?? ((item.startTime ?? 0) + 3),
      pxPerSec,
    };

    onSelectTextOverlay?.(item.id);
  }, [trackWidth, duration, onUpdateCustomTextOverlays, onSelectTextOverlay]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      // 1. Trimming slide with ripple edit
      const st = slideTrimRef.current;
      if (st) {
        const dt = (e.clientX - st.startX) / (st.pxPerSec || 48);
        const { index, mode, initialRows, initialDuration, oldStart, oldEnd, oldDur } = st;

        if (mode === 'trim-end') {
          // Dragging right edge forward/back -> edit slide length, subsequent slides auto close gap
          const newDur = Math.max(0.2, Number((oldDur + dt).toFixed(2)));
          const delta = Number((newDur - oldDur).toFixed(2));

          const newRows = initialRows.map((r, k) => {
            if (k <= index) return { ...r };
            return {
              ...r,
              start: Number(Math.max(0, r.start + delta).toFixed(2)),
            };
          });

          const newDuration = Math.max(0.5, Number((initialDuration + delta).toFixed(2)));

          setTrimFeedback({ index, mode, newDur, delta });
          onUpdateRows?.(newRows, newDuration);
          onSeek(Number(Math.max(0, oldStart + newDur).toFixed(2)));
        } else if (mode === 'trim-start') {
          // Dragging left edge -> boundary adjustment with previous slide, gaps remain 0
          const prevStart = initialRows[index - 1]?.start ?? 0;
          const minStart = prevStart + 0.2;
          const maxStart = oldEnd - 0.2;
          const targetStart = Math.max(minStart, Math.min(maxStart, oldStart + dt));
          const delta = Number((targetStart - oldStart).toFixed(2));
          const newDur = Number((oldEnd - targetStart).toFixed(2));

          const newRows = initialRows.map((r, k) => {
            if (k === index) {
              return { ...r, start: Number(targetStart.toFixed(2)) };
            }
            return { ...r };
          });

          setTrimFeedback({ index, mode, newDur, delta: -delta });
          onUpdateRows?.(newRows, initialDuration);
          onSeek(Number(targetStart.toFixed(2)));
        }
        return;
      }

      // 2. Dragging/trimming text overlay
      const td = textDragRef.current;
      if (td) {
        const dt = (e.clientX - td.startX) / (td.pxPerSec || 48);
        const { id, mode, initialStart, initialEnd } = td;
        const oldDur = initialEnd - initialStart;

        let newStart = initialStart;
        let newEnd = initialEnd;

        if (mode === 'trim-start') {
          newStart = Math.max(0, Math.min(initialEnd - 0.2, Number((initialStart + dt).toFixed(2))));
        } else if (mode === 'trim-end') {
          newEnd = Math.max(initialStart + 0.2, Math.min(duration, Number((initialEnd + dt).toFixed(2))));
        } else if (mode === 'move') {
          newStart = Math.max(0, Math.min(duration - oldDur, Number((initialStart + dt).toFixed(2))));
          newEnd = Number((newStart + oldDur).toFixed(2));
        }

        const nextOverlays = customTextOverlays.map((o) =>
          o.id === id ? { ...o, startTime: newStart, endTime: newEnd } : o
        );
        onUpdateCustomTextOverlays?.(nextOverlays);
        onSeek(newStart);
        return;
      }

      // 3. Dragging playhead seek
      if (isDragging) {
        handleSeekFromEvent(e);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      slideTrimRef.current = null;
      textDragRef.current = null;
      setTrimFeedback(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleSeekFromEvent, onUpdateRows, onSeek, customTextOverlays, onUpdateCustomTextOverlays, duration]);

  // Smoothly follow playhead when playing
  useEffect(() => {
    if (isPlaying && followPlayhead && scrollViewportRef.current && duration > 0) {
      const vp = scrollViewportRef.current;
      const playheadPx = (currentTime / duration) * trackWidth;
      const viewCenter = vp.clientWidth / 2;
      const targetScroll = playheadPx - viewCenter;
      vp.scrollLeft = targetScroll;
    }
  }, [currentTime, isPlaying, followPlayhead, trackWidth, duration]);

  // Horizontal scroll button handlers
  const scrollLeftBy = (px) => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollBy({ left: -px, behavior: 'smooth' });
    }
  };

  const scrollRightBy = (px) => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollBy({ left: px, behavior: 'smooth' });
    }
  };

  if (!rows.length || duration <= 0) return null;

  const playheadPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  // Generate dynamic time ruler ticks (every 1s, 5s, or 10s depending on trackWidth)
  const tickInterval = trackWidth / duration > 80 ? 1 : trackWidth / duration > 30 ? 5 : 10;
  const numTicks = Math.floor(duration / tickInterval) + 1;
  const ticks = [];
  for (let i = 0; i <= numTicks; i++) {
    const timeSec = i * tickInterval;
    if (timeSec <= duration) {
      ticks.push(timeSec);
    }
  }

  return (
    <div className="pro-timeline-container">
      {/* 1. Video Player Transport Controls & Navigation Bar */}
      <div className="timeline-transport-bar">
        <div className="transport-left-controls">
          <button
            className="transport-btn play-pause-btn"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause Video' : 'Play Video'}
          >
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>

          <button
            className="transport-btn icon-btn"
            onClick={() => onSeek(0)}
            title="Jump to Start (0:00)"
          >
            ⏮
          </button>

          <button
            className="transport-btn icon-btn"
            onClick={() => onSeek(Math.max(0, currentTime - 5))}
            title="Rewind 5 seconds"
          >
            ⏪ -5s
          </button>

          <button
            className="transport-btn icon-btn"
            onClick={() => onSeek(Math.min(duration, currentTime + 5))}
            title="Forward 5 seconds"
          >
            ⏩ +5s
          </button>

          <div className="transport-timecode">
            <span className="current-tc">{fmt(currentTime)}</span>
            <span className="sep-tc">/</span>
            <span className="total-tc">{fmt(duration)}</span>
          </div>
        </div>

        {/* Center / Right: Horizontal Scroll & Zoom Controls */}
        <div className="transport-right-controls">
          {/* Horizontal Navigation Buttons */}
          <div className="scroll-nav-group">
            <button
              className="scroll-nav-btn"
              onClick={() => scrollLeftBy(350)}
              title="Scroll timeline left"
            >
              ◀ Scroll Left
            </button>
            <button
              className="scroll-nav-btn"
              onClick={() => scrollRightBy(350)}
              title="Scroll timeline right"
            >
              Scroll Right ▶
            </button>
          </div>

          {/* Quick Add / Manage Text Overlays Button */}
          <button
            type="button"
            className="transport-add-text-btn"
            onClick={() => (onAddTextOverlay ? onAddTextOverlay(currentTime) : onOpenTextEditor?.())}
            title="Add decorated text overlay at current playhead"
          >
            ✨ + Text Overlay {customTextOverlays.length > 0 ? `(${customTextOverlays.length})` : ''}
          </button>

          <button
            className={`follow-toggle-btn ${followPlayhead ? 'active' : ''}`}
            onClick={() => setFollowPlayhead((prev) => !prev)}
            title="Automatically scroll to follow the playhead"
          >
            📍 {followPlayhead ? 'Follow ON' : 'Follow OFF'}
          </button>

          <div className="zoom-control-group">
            <span className="zoom-label">🔍 Zoom:</span>
            <button
              className="zoom-btn"
              onClick={() => setZoomLevel((z) => Math.max(0.75, Number((z - 0.35).toFixed(2))))}
              title="Zoom Out"
            >
              −
            </button>
            <input
              type="range"
              min="0.75"
              max="4.0"
              step="0.1"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="zoom-slider"
              title={`Zoom: ${Math.round(zoomLevel * 100)}%`}
            />
            <button
              className="zoom-btn"
              onClick={() => setZoomLevel((z) => Math.min(4.0, Number((z + 0.35).toFixed(2))))}
              title="Zoom In"
            >
              +
            </button>
            <button
              className="zoom-fit-btn"
              onClick={() => setZoomLevel(1.0)}
              title="Reset Zoom to 100%"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Timeline Area with Track Headers & Scrollable Content */}
      <div className="pro-timeline-main">
        {/* Fixed Left Track Headers Column */}
        <div className="track-headers-column">
          <div className="track-header-spacer" />

          {/* Text Overlays Track Header */}
          <div className="track-header track-header-text">
            <span className="track-icon">✨</span>
            <span className="track-name">T1 (Text)</span>
            {customTextOverlays.length > 0 && (
              <span className="track-count-badge">{customTextOverlays.length}</span>
            )}
            <button
              type="button"
              className="track-inline-add-btn"
              onClick={(e) => {
                e.stopPropagation();
                onAddTextOverlay ? onAddTextOverlay(currentTime) : onOpenTextEditor?.();
              }}
              title="Add text at current playhead"
            >
              +
            </button>
          </div>

          <div className="track-header track-header-video">
            <span className="track-icon">🎞️</span>
            <span className="track-name">V1 (Slides)</span>
          </div>
          <div className="track-header track-header-audio">
            <span className="track-icon">🔊</span>
            <span className="track-name">A1 (Voice)</span>
          </div>
        </div>

        {/* Scrollable Viewport (Exceeds Screen Width with Horizontal Scrollbar) */}
        <div className="timeline-scroll-viewport" ref={scrollViewportRef}>
          <div
            className="timeline-tracks-wrapper"
            ref={trackRef}
            style={{ width: `${trackWidth}px` }}
            onMouseDown={handleMouseDown}
          >
            {/* Top Time Ruler */}
            <div className="timeline-ruler">
              {ticks.map((t) => {
                const tickLeft = (t / duration) * 100;
                return (
                  <div
                    key={t}
                    className="ruler-tick-mark"
                    style={{ left: `${tickLeft}%` }}
                  >
                    <span className="tick-label">{fmt(t)}</span>
                  </div>
                );
              })}
            </div>

            {/* Track 0: Decorated Text Overlays Track */}
            <div className="timeline-text-track" onMouseDown={(e) => e.stopPropagation()}>
              {customTextOverlays.length === 0 ? (
                <button
                  type="button"
                  className="timeline-empty-text-hint"
                  onClick={() =>
                    onAddTextOverlay ? onAddTextOverlay(currentTime) : onOpenTextEditor?.()
                  }
                  title="Click to add custom styled text on the timeline"
                >
                  ✨ + Add Decorated Text at {fmt(currentTime)}
                </button>
              ) : (
                customTextOverlays.map((item) => {
                  const start = item.startTime ?? 0;
                  const end = item.endTime ?? (start + 3);
                  const dur = Math.max(0.2, end - start);
                  const leftPct = (start / (duration || 1)) * 100;
                  const widthPct = Math.max(1, (dur / (duration || 1)) * 100);
                  const isSelected = selectedTextOverlayId === item.id;
                  const isCurrent = currentTime >= start && currentTime <= end;

                  return (
                    <div
                      key={item.id}
                      className={`timeline-text-block ${isSelected ? 'selected' : ''} ${
                        isCurrent ? 'active' : ''
                      }`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      onMouseDown={(e) => handleTextDragStart(e, item, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTextOverlay?.(item.id);
                        onOpenTextEditor?.();
                      }}
                      title={`"${item.text}" (${dur.toFixed(1)}s, ${start.toFixed(1)}s - ${end.toFixed(1)}s)`}
                    >
                      {/* Left Trim Handle */}
                      <div
                        className="text-trim-handle text-trim--start"
                        title="Drag to adjust start timestamp"
                        onMouseDown={(e) => handleTextDragStart(e, item, 'trim-start')}
                      />

                      {/* Text Label */}
                      <div className="timeline-text-inner">
                        <span className="text-tag-icon">✨</span>
                        <span className="text-tag-content">{item.text || 'Text'}</span>
                        <span className="text-tag-dur">{dur.toFixed(1)}s</span>
                      </div>

                      {/* Right Trim Handle */}
                      <div
                        className="text-trim-handle text-trim--end"
                        title="Drag to adjust duration / end timestamp"
                        onMouseDown={(e) => handleTextDragStart(e, item, 'trim-end')}
                      />
                    </div>
                  );
                })
              )}
            </div>

            {/* Track 1: Video / Slide Blocks */}
            <div className="timeline-video-track">
              {rows.map((row, i) => {
                const nextStart = rows[i + 1] ? rows[i + 1].start : duration;
                const slideDur = Math.max(0.1, nextStart - row.start);
                const widthPct = (slideDur / duration) * 100;
                const isActive = currentTime >= row.start && currentTime < nextStart;
                const imgUrl = imageUrls[i];
                const overrideAnim = slideAnimations[i];
                const activeAnim = getSlideAnimation(
                  overrideAnim && overrideAnim !== 'auto' ? overrideAnim : animationMode,
                  i
                );
                const isTrimmingThis = trimFeedback?.index === i;

                return (
                  <div
                    key={row.id}
                    className={`pro-slide-block ${isActive ? 'active-block' : ''} ${
                      row.match < 0.5 ? 'low-match-block' : ''
                    } ${isTrimmingThis ? 'trimming-block' : ''}`}
                    style={{ width: `${widthPct}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(row.start);
                    }}
                    title={`Slide ${row.id}: ${fmt(row.start)} - ${fmt(nextStart)} (${slideDur.toFixed(2)}s)`}
                  >
                    {/* Left Trim Handle (for i > 0) */}
                    {i > 0 && onUpdateRows && (
                      <div
                        className="pro-slide-trim-handle pro-slide-trim--start"
                        title="Drag left/right to trim start (auto-closes gap)"
                        onMouseDown={(e) => handleSlideTrimStart(e, i, 'trim-start')}
                      >
                        <span className="pro-trim-grip" />
                      </div>
                    )}

                    <div className="pro-block-inner">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={`Slide ${row.id}`}
                          className="pro-block-thumbnail"
                        />
                      ) : (
                        <div className="pro-block-placeholder">#{row.id}</div>
                      )}
                      <div className="pro-block-meta">
                        <span className="pro-block-title">Slide {row.id}</span>
                        <span className="pro-block-anim-tag">{activeAnim}</span>
                      </div>
                      <span className="pro-block-duration">{slideDur.toFixed(1)}s</span>
                    </div>

                    {/* Right Trim Handle (ripples next slides to auto close gap) */}
                    {onUpdateRows && (
                      <div
                        className="pro-slide-trim-handle pro-slide-trim--end"
                        title="Drag forward/back to edit length (next slides auto-close gap)"
                        onMouseDown={(e) => handleSlideTrimStart(e, i, 'trim-end')}
                      >
                        <span className="pro-trim-grip" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Floating Trim Feedback Pill */}
              {trimFeedback && (
                <div
                  className="pro-trim-floating-pill"
                  style={{
                    left: `${Math.min(
                      96,
                      Math.max(
                        2,
                        (((rows[trimFeedback.index]?.start ?? 0) +
                          (trimFeedback.mode === 'trim-end' ? trimFeedback.newDur : 0)) /
                          (duration || 1)) *
                          100
                      )
                    )}%`,
                  }}
                >
                  <span className="pro-pill-title">Slide {trimFeedback.index + 1}</span>
                  <span className="pro-pill-dur">{trimFeedback.newDur.toFixed(2)}s</span>
                  <span className={trimFeedback.delta >= 0 ? 'pro-pill-delta-pos' : 'pro-pill-delta-neg'}>
                    {trimFeedback.delta >= 0
                      ? `+${trimFeedback.delta.toFixed(2)}s`
                      : `${trimFeedback.delta.toFixed(2)}s`}
                  </span>
                  <span className="pro-pill-tag">gap auto-closed</span>
                </div>
              )}
            </div>

            {/* Track 2: Visualized Audio Track */}
            <div className="timeline-audio-track">
              <div className="audio-wave-strip">
                {/* Visual Audio Waveform Simulation bars */}
                <div className="audio-wave-pattern" />
              </div>
            </div>

            {/* Red Laser Playhead Needle & Scrubber Head */}
            <div
              className="pro-playhead"
              style={{ left: `${playheadPercent}%` }}
            >
              <div className="playhead-head">
                <span className="playhead-head-time">{fmt(currentTime)}</span>
              </div>
              <div className="playhead-line" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
