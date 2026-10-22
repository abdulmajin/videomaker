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
  onSeek = () => {},
  onTogglePlay = () => {},
}) {
  const scrollViewportRef = useRef(null);
  const trackRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1.75); // 1.0 = fit min 100%, 1.75+ = exceeds screen width
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

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

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      handleSeekFromEvent(e);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleSeekFromEvent]);

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

                return (
                  <div
                    key={row.id}
                    className={`pro-slide-block ${isActive ? 'active-block' : ''} ${row.match < 0.5 ? 'low-match-block' : ''}`}
                    style={{ width: `${widthPct}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(row.start);
                    }}
                    title={`Slide ${row.id}: ${fmt(row.start)} - ${fmt(nextStart)} (${slideDur.toFixed(1)}s)`}
                  >
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
                  </div>
                );
              })}
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
