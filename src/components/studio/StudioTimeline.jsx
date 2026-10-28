import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Icon } from './icons';
import { TRANSITION_TYPES } from '../../lib/studioRender';
import { useWaveform } from '../../lib/waveform';

// ─── Layout constants ───────────────────────────────────────────────────────
const LABEL_W   = 132;  // px, sticky track-label column
const END_PAD   = 48;   // px of empty space after the last second
const LANE_H    = 28;   // px per stacked lane in overlay tracks
const MIN_ZOOM  = 2;    // px per second
const MAX_ZOOM  = 400;
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const SNAP_PX   = 8;    // snap distance in screen pixels
const TL_HEIGHT_KEY = 'studioTimelineHeight';
const TL_MIN_H  = 110;  // px; the canvas monitor gets whatever space is left

function storedTimelineHeight() {
  try { const v = parseInt(localStorage.getItem(TL_HEIGHT_KEY), 10); return Number.isFinite(v) ? v : 240; } catch { return 240; }
}

// ─── Time formatting ────────────────────────────────────────────────────────
const pad = (n) => String(Math.floor(n)).padStart(2, '0');

function formatClock(secs) {
  const s = Math.max(0, secs || 0);
  return `${pad(s / 60)}:${pad(s % 60)}`;
}

function formatRuler(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return Number.isInteger(s) ? `${m}:${pad(s)}` : `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Deterministic pseudo-random waveform heights
function waveHeight(i) {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  const r = v - Math.floor(v);
  return 0.25 + 0.75 * Math.abs(Math.sin(i * 0.35)) * (0.55 + 0.45 * r);
}

// Greedy lane assignment so overlapping layers don't hide each other
function assignLanes(list) {
  const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
  const laneEnds = [];
  const laneOf = {};
  for (const l of sorted) {
    let lane = laneEnds.findIndex(end => end <= l.startTime + 1e-6);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(l.endTime); }
    else laneEnds[lane] = l.endTime;
    laneOf[l.id] = lane;
  }
  return { laneOf, lanes: Math.max(1, laneEnds.length) };
}

const LAYER_META = {
  text:  { cls: 'text-block',  icon: 'text',   name: 'Text',    add: '+ Add text',    tab: 'text' },
  shape: { cls: 'shape-block', icon: 'square', name: 'Shapes',  add: '+ Add shape',   tab: 'shapes' },
  image: { cls: 'image-block', icon: 'image',  name: 'Overlays', add: '+ Add overlay', tab: 'media' },
  video: { cls: 'video-block', icon: 'film',   name: 'Clips',    add: '+ Add video clip', tab: 'media' },
};

function blockLabel(l) {
  if (l.type === 'text') return l.text || 'Text';
  if (l.type === 'shape') return l.shape || 'Shape';
  if (l.type === 'video') return l.name || 'Video clip';
  return l.name || 'Image overlay';
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN COMPONENT (transport bar + multi-track timeline)
// ─────────────────────────────────────────────────────────────────────────────
export default function StudioTimeline({
  project,
  currentTime,
  isPlaying,
  selectedLayerId,
  onSeek,
  onTogglePlay,
  onSelectLayer,
  onUpdateLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onSplitLayer,
  onSetTransition,
  onOpenLeftTab,
  onUpdateRowsAndDuration,
  onImportMedia,
}) {
  const {
    duration = 30, rows = [], layers = [], audioUrl, bgmUrl, bgmName,
    imageUrls = [], transitions = {},
  } = project ?? {};

  // ── Local state ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(20);                 // px per second
  const [transitionMenu, setTransitionMenu] = useState(null); // { index, x, y }
  const [trimFeedback, setTrimFeedback] = useState(null); // { index, mode, newDur, delta }
  const [snapOn, setSnapOn] = useState(true);
  const [snapGuide, setSnapGuide] = useState(null);       // time of the active snap line
  const [tlHeight, setTlHeight] = useState(storedTimelineHeight);
  const splitRef = useRef(null);

  // Divider between the canvas monitor and the timeline (drag to resize; double-click resets)
  const onSplitDown = (e) => {
    e.preventDefault();
    splitRef.current = { y: e.clientY, h: tlHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSplitMove = (e) => {
    const d = splitRef.current;
    if (!d) return;
    const maxH = Math.max(TL_MIN_H, window.innerHeight - 52 - 48 - 160); // keep >=160px of canvas
    d.last = Math.max(TL_MIN_H, Math.min(maxH, d.h - (e.clientY - d.y)));
    setTlHeight(d.last);
  };
  const onSplitUp = () => {
    const d = splitRef.current;
    if (!d) return;
    splitRef.current = null;
    try { localStorage.setItem(TL_HEIGHT_KEY, String(d.last ?? d.h)); } catch { /* not remembered */ }
  };
  const resetSplit = () => {
    setTlHeight(240);
    try { localStorage.removeItem(TL_HEIGHT_KEY); } catch { /* ignore */ }
  };

  // ── Refs ───────────────────────────────────────────────────────────────────
  const scrollRef    = useRef(null);
  const scrubRef     = useRef(null);  // { el } while scrubbing the ruler/track
  const blockDragRef = useRef(null);  // { layerId, mode, startX, startTime, endTime }
  const sceneTrimRef = useRef(null);  // { index, mode, startX, initialRows, initialDuration, oldStart, oldEnd, oldDur }

  const timelineWidth = Math.max(1, duration * zoom);

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  const fitZoom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !duration) return;
    const avail = el.clientWidth - LABEL_W - END_PAD;
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, avail / duration)));
  }, [duration]);

  // Fit the whole project on first render / when the duration changes
  useEffect(() => { fitZoom(); }, [fitZoom]);

  const zoomBy = (factor) => setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the playhead in view during playback
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const x = currentTime * zoom;
    const viewStart = el.scrollLeft;
    const viewW = el.clientWidth - LABEL_W;
    if (x < viewStart || x > viewStart + viewW - 40) {
      el.scrollLeft = Math.max(0, x - viewW * 0.25);
    }
  }, [currentTime, zoom, isPlaying]);

  // ── Ruler ticks ────────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const step = RULER_STEPS.find(s => s * zoom >= 72) ?? 600;
    const minor = step / 5;
    const out = [];
    for (let t = 0; t <= duration + 1e-6; t += minor) {
      const isMajor = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      out.push({ t, isMajor });
      if (out.length > 4000) break;
    }
    return out;
  }, [zoom, duration]);

  // ── Seeking / scrubbing ────────────────────────────────────────────────────
  const timeFromEvent = useCallback((e, el) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (e.clientX - rect.left) / zoom));
  }, [duration, zoom]);

  const startScrub = useCallback((e, deselect = false) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    scrubRef.current = { el };
    onSeek(timeFromEvent(e, el));
    if (deselect) onSelectLayer(null);
    setTransitionMenu(null);
  }, [onSeek, onSelectLayer, timeFromEvent]);

  // ── Block drag start (overlay layers) ──────────────────────────────────────
  const handleBlockMouseDown = useCallback((e, layer, mode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const snapTargets = [0, duration, currentTime, ...rows.map(r => r.start ?? 0)];
    for (const l of layers) if (l.id !== layer.id) snapTargets.push(l.startTime, l.endTime);
    blockDragRef.current = {
      layerId:   layer.id,
      mode,                       // 'move' | 'trim-start' | 'trim-end'
      startX:    e.clientX,
      startTime: layer.startTime,
      endTime:   layer.endTime,
      isVideo:   layer.type === 'video',
      trimStart: layer.trimStart || 0,
      sourceDuration: layer.sourceDuration || 0,
      snapTargets,
    };
    onSelectLayer(layer.id);
  }, [onSelectLayer, duration, currentTime, rows, layers]);

  // ── Scene trim start (video track slides with auto gap-closing ripple) ─────
  const handleSceneTrimStart = useCallback((e, index, mode) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    const initialRows = rows.map(r => ({ ...r }));
    const initialDuration = duration;
    const oldStart = initialRows[index].start ?? 0;
    const oldEnd = initialRows[index + 1] ? initialRows[index + 1].start : initialDuration;
    const oldDur = Math.max(0.1, oldEnd - oldStart);

    sceneTrimRef.current = {
      index,
      mode, // 'trim-end' (right handle) | 'trim-start' (left handle)
      startX: e.clientX,
      initialRows,
      initialDuration,
      oldStart,
      oldEnd,
      oldDur,
    };

    setTrimFeedback({
      index,
      mode,
      newDur: oldDur,
      delta: 0,
    });
    onSelectLayer(null);
  }, [rows, duration, onSelectLayer]);

  // ── Global mousemove / mouseup ─────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      // 1. Scrubbing timeline ruler
      if (scrubRef.current) {
        onSeek(timeFromEvent(e, scrubRef.current.el));
        return;
      }

      // 2. Scene trimming with auto gap-closing ripple
      const st = sceneTrimRef.current;
      if (st) {
        const dt = (e.clientX - st.startX) / zoom;
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

          setTrimFeedback({
            index,
            mode,
            newDur,
            delta,
          });

          onUpdateRowsAndDuration?.(newRows, newDuration);
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

          setTrimFeedback({
            index,
            mode,
            newDur,
            delta: -delta,
          });

          onUpdateRowsAndDuration?.(newRows, initialDuration);
          onSeek(Number(targetStart.toFixed(2)));
        }
        return;
      }

      // 3. Overlay layer drag & trim (snaps to playhead, scene cuts and other layers; Alt bypasses)
      const bd = blockDragRef.current;
      if (!bd) return;
      const dt  = (e.clientX - bd.startX) / zoom;
      const dur = bd.endTime - bd.startTime;
      const snapping = snapOn && !e.altKey;
      const tol = SNAP_PX / zoom;
      const snap = (t) => {
        if (!snapping) return { t, hit: null };
        let best = null;
        for (const c of bd.snapTargets) {
          if (Math.abs(c - t) <= tol && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
        }
        return best === null ? { t, hit: null } : { t: best, hit: best };
      };
      if (bd.mode === 'trim-end') {
        const { t, hit } = snap(bd.endTime + dt);
        setSnapGuide(hit);
        let endTime = Math.max(bd.startTime + 0.2, Math.min(duration, t));
        // A clip can't run past the end of its source video
        if (bd.isVideo && bd.sourceDuration) endTime = Math.min(endTime, bd.startTime + bd.sourceDuration - bd.trimStart);
        onUpdateLayer(bd.layerId, { endTime });
      } else if (bd.mode === 'trim-start') {
        const { t, hit } = snap(bd.startTime + dt);
        setSnapGuide(hit);
        let startTime = Math.max(0, Math.min(bd.endTime - 0.2, t));
        if (bd.isVideo) {
          // Trimming the head of a clip also moves where playback starts in the source
          startTime = Math.max(startTime, bd.startTime - bd.trimStart);
          onUpdateLayer(bd.layerId, { startTime, trimStart: Math.max(0, bd.trimStart + (startTime - bd.startTime)) });
        } else {
          onUpdateLayer(bd.layerId, { startTime });
        }
      } else {
        let newStart = Math.max(0, Math.min(duration - dur, bd.startTime + dt));
        const a = snap(newStart), b = snap(newStart + dur);
        if (a.hit !== null && (b.hit === null || Math.abs(a.t - newStart) <= Math.abs(b.t - newStart - dur))) {
          newStart = a.t; setSnapGuide(a.hit);
        } else if (b.hit !== null) {
          newStart = b.t - dur; setSnapGuide(b.hit);
        } else {
          setSnapGuide(null);
        }
        newStart = Math.max(0, Math.min(duration - dur, newStart));
        onUpdateLayer(bd.layerId, { startTime: newStart, endTime: newStart + dur });
      }
    };

    const onUp = () => {
      scrubRef.current = null;
      blockDragRef.current = null;
      sceneTrimRef.current = null;
      setTrimFeedback(null);
      setSnapGuide(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, duration, snapOn, onSeek, onUpdateLayer, onUpdateRowsAndDuration, timeFromEvent]);

  // Close transition menu on outside click
  useEffect(() => {
    if (!transitionMenu) return undefined;
    const close = () => setTransitionMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [transitionMenu]);

  // ── Layer groups ───────────────────────────────────────────────────────────
  const groups = ['video', 'text', 'shape', 'image'].map(type => {
    const list = layers.filter(l => l.type === type);
    return { type, list, ...assignLanes(list) };
  });

  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;
  const canSplit = !!(selectedLayer && currentTime > selectedLayer.startTime + 0.1 && currentTime < selectedLayer.endTime - 0.1);

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderLayerTrack = ({ type, list, laneOf, lanes }) => {
    const meta = LAYER_META[type];
    const height = lanes * LANE_H + 8;
    return (
      <div className="tl-row" key={type} style={{ height }}>
        <div className="tl-label">
          <Icon name={meta.icon} size={14} />
          <span>{meta.name}</span>
          {list.length > 0 && <span className="tl-count">{list.length}</span>}
        </div>
        <div className="tl-body" style={{ width: timelineWidth }} onMouseDown={(e) => startScrub(e, true)}>
          {list.length === 0 && (
            <button
              className="tl-add-placeholder"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => ((type === 'video' || type === 'image') && onImportMedia ? onImportMedia() : onOpenLeftTab?.(meta.tab))}
            >
              {meta.add}
            </button>
          )}
          {list.map(layer => {
            const left  = layer.startTime * zoom;
            const width = Math.max(6, (layer.endTime - layer.startTime) * zoom);
            const isSelected = layer.id === selectedLayerId;
            return (
              <div
                key={layer.id}
                className={`timeline-block tl-block ${meta.cls}${isSelected ? ' selected' : ''}`}
                style={{ left, width, top: 4 + laneOf[layer.id] * LANE_H, height: LANE_H - 4 }}
                onMouseDown={(e) => handleBlockMouseDown(e, layer, 'move')}
                onDoubleClick={() => onSeek(layer.startTime)}
                title={`${blockLabel(layer)} · ${layer.startTime.toFixed(1)}s → ${layer.endTime.toFixed(1)}s`}
              >
                <div className="tl-trim tl-trim--start" onMouseDown={(e) => handleBlockMouseDown(e, layer, 'trim-start')} />
                {type === 'image' && layer.imageUrl && <img className="tl-block-thumb" src={layer.imageUrl} alt="" />}
                {type === 'text' && <span className="tl-block-glyph">T</span>}
                {type === 'video' && <Icon name="film" size={12} />}
                <span className="tl-block-text">{blockLabel(layer)}</span>
                <div className="tl-trim tl-trim--end" onMouseDown={(e) => handleBlockMouseDown(e, layer, 'trim-end')} />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const bars = Math.min(900, Math.floor(timelineWidth / 5));
  const voiceWave = useWaveform(audioUrl, bars, duration);
  const bgmWave = useWaveform(bgmUrl, bars, duration, true);
  const waveBar = (wave, i, fallback) => (wave ? Math.max(0.04, wave[i]) : fallback);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Resize divider: drag up for a bigger canvas ── */}
      <div
        className="studio-split-handle"
        title="Drag to resize the canvas and timeline (double-click to reset)"
        onPointerDown={onSplitDown}
        onPointerMove={onSplitMove}
        onPointerUp={onSplitUp}
        onPointerCancel={onSplitUp}
        onDoubleClick={resetSplit}
      />

      {/* ── Playback transport ── */}
      <div className="studio-transport">
        <div className="transport-left">
          <button className="transport-btn" onClick={() => onSplitLayer?.(selectedLayerId, currentTime)} disabled={!canSplit} title="Split selected layer at playhead">
            <Icon name="scissors" />
          </button>
          <button className="transport-btn" onClick={() => selectedLayerId && onDuplicateLayer?.(selectedLayerId)} disabled={!selectedLayer} title="Duplicate selected layer">
            <Icon name="copy" />
          </button>
          <button className="transport-btn danger" onClick={() => selectedLayerId && onDeleteLayer(selectedLayerId)} disabled={!selectedLayer} title="Delete selected layer">
            <Icon name="trash" />
          </button>
        </div>

        <div className="transport-center">
          <button className="transport-btn" onClick={() => onSeek(0)} title="Go to start">
            <Icon name="skipBack" />
          </button>
          <button className="transport-btn" onClick={() => onSeek(currentTime - 5)} title="Back 5s (Shift+←)">
            <Icon name="rewind" />
          </button>
          <button className="transport-play-btn" onClick={onTogglePlay} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
            <Icon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <button className="transport-btn" onClick={() => onSeek(currentTime + 5)} title="Forward 5s (Shift+→)">
            <Icon name="forward" />
          </button>
          <div className="transport-time">
            <span className="transport-time-current">{formatClock(currentTime)}</span>
            <span>/</span>
            <span className="transport-time-total">{formatClock(duration)}</span>
          </div>
        </div>

        <div className="transport-right">
          <button
            className={`transport-btn${snapOn ? ' active' : ''}`}
            onClick={() => setSnapOn(v => !v)}
            title={snapOn ? 'Snapping on: edges snap to playhead, cuts and layers (hold Alt to bypass)' : 'Snapping off'}
          >
            <Icon name="magnet" />
          </button>
          <button className="transport-btn" onClick={() => zoomBy(1 / 1.4)} title="Zoom out (Ctrl+wheel)">
            <Icon name="zoomOut" />
          </button>
          <button className="transport-btn" onClick={() => zoomBy(1.4)} title="Zoom in (Ctrl+wheel)">
            <Icon name="zoomIn" />
          </button>
          <button className="transport-btn" onClick={fitZoom} title="Fit timeline to view">
            <Icon name="fit" />
          </button>
        </div>
      </div>

      {/* ── Multi-track timeline ── */}
      <div className="studio-timeline" style={{ height: tlHeight }}>
        <div className="timeline-scroll-area tl-scroll" ref={scrollRef}>
          <div className="tl-content" style={{ width: LABEL_W + timelineWidth + END_PAD }}>
            {/* Ruler row (sticky top) */}
            <div className="tl-ruler-row">
              <div className="tl-corner">
                <Icon name="layers" size={14} />
                <span>Tracks</span>
              </div>
              <div className="tl-ruler" style={{ width: timelineWidth }} onMouseDown={(e) => startScrub(e)}>
                {ticks.map(({ t, isMajor }) => (
                  <div key={t.toFixed(3)} className={`tl-tick${isMajor ? ' major' : ''}`} style={{ left: t * zoom }}>
                    {isMajor && <span>{formatRuler(t)}</span>}
                  </div>
                ))}
                <div className="tl-playhead-knob" style={{ left: currentTime * zoom }} />
              </div>
            </div>

            {/* Overlay layer tracks */}
            {groups.map(renderLayerTrack)}

            {/* Video (scenes) track */}
            <div className="tl-row tl-row--video">
              <div className="tl-label tl-label--strong">
                <Icon name="video" size={14} />
                <span>Video 1</span>
                {rows.length > 0 && <span className="tl-count">{rows.length}</span>}
              </div>
              <div className="tl-body" style={{ width: timelineWidth }} onMouseDown={(e) => startScrub(e, true)}>
                {rows.length === 0 && (
                  <button className="tl-add-placeholder" onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpenLeftTab?.('media')}>
                    No scenes yet — open a merged project from the Video Maker
                  </button>
                )}
                {rows.length > 0 && (
                  <div className="tl-filmstrip" style={{ width: timelineWidth }}>
                    {rows.map((row, i) => {
                      const start = row.start ?? 0;
                      const end   = rows[i + 1]?.start ?? duration;
                      const slideDur = Math.max(0.1, end - start);
                      const url   = imageUrls[i];
                      const isTrimmingThis = trimFeedback?.index === i;
                      return (
                        <div
                          key={row.id ?? i}
                          className={`tl-scene${isTrimmingThis ? ' trimming' : ''}`}
                          style={{
                            left: start * zoom,
                            width: Math.max(6, slideDur * zoom),
                            backgroundImage: url ? `url("${url}")` : undefined,
                          }}
                          title={`Slide ${i + 1}: ${(row.text || '').slice(0, 80)} (${slideDur.toFixed(2)}s)`}
                          onClick={() => onSeek(start)}
                        >
                          {(end - start) * zoom > 34 && (
                            <span className="tl-scene-badge">
                              {i + 1} · {slideDur.toFixed(1)}s
                            </span>
                          )}

                          {/* Left Trim Handle (for i > 0, boundary with previous slide) */}
                          {i > 0 && (
                            <div
                              className="tl-scene-trim tl-scene-trim--start"
                              title="Drag left/right to trim scene start (auto-closes gap)"
                              onMouseDown={(e) => handleSceneTrimStart(e, i, 'trim-start')}
                            >
                              <span className="tl-trim-grip" />
                            </div>
                          )}

                          {/* Right Trim Handle (ripples next slides to auto-close gap) */}
                          <div
                            className="tl-scene-trim tl-scene-trim--end"
                            title="Drag forward/back to edit length (subsequent slides auto-close gap)"
                            onMouseDown={(e) => handleSceneTrimStart(e, i, 'trim-end')}
                          >
                            <span className="tl-trim-grip" />
                          </div>
                        </div>
                      );
                    })}

                    {/* Live floating trim feedback pill */}
                    {trimFeedback && (
                      <div
                        className="tl-trim-floating-pill"
                        style={{
                          left: Math.max(
                            8,
                            (rows[trimFeedback.index]?.start ?? 0) * zoom +
                              (trimFeedback.mode === 'trim-end' ? trimFeedback.newDur * zoom : 0)
                          ),
                        }}
                      >
                        <span className="pill-title">Slide {trimFeedback.index + 1}</span>
                        <span className="pill-dur">{trimFeedback.newDur.toFixed(2)}s</span>
                        <span className={trimFeedback.delta >= 0 ? 'pill-delta-pos' : 'pill-delta-neg'}>
                          {trimFeedback.delta >= 0
                            ? `+${trimFeedback.delta.toFixed(2)}s`
                            : `${trimFeedback.delta.toFixed(2)}s`}
                        </span>
                        <span className="pill-hint">gap auto-closed</span>
                      </div>
                    )}
                  </div>
                )}
                {/* Transition diamonds at each cut */}
                {rows.map((row, i) => {
                  if (i === 0) return null;
                  const t = transitions[i] || 'none';
                  return (
                    <button
                      key={`tr-${i}`}
                      className={`tl-transition${t !== 'none' ? ' set' : ''}`}
                      style={{ left: (row.start ?? 0) * zoom }}
                      title={`Transition into scene ${i + 1}: ${TRANSITION_TYPES.find(x => x.id === t)?.label ?? t}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setTransitionMenu(m => (m?.index === i ? null : { index: i, x: r.left + r.width / 2, y: r.top }));
                      }}
                    >
                      <Icon name="transitions" size={10} strokeWidth={2.4} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Voiceover track */}
            <div className="tl-row">
              <div className="tl-label">
                <Icon name="mic" size={14} />
                <span>Voiceover</span>
              </div>
              <div className="tl-body" style={{ width: timelineWidth }} onMouseDown={(e) => startScrub(e, true)}>
                {audioUrl ? (
                  <div className="timeline-block audio-block tl-audio" style={{ left: 0, width: timelineWidth }}>
                    <Icon name="audio" size={13} />
                    <span className="tl-block-text tl-audio-name">Voiceover narration</span>
                    <div className="tl-wave">
                      {Array.from({ length: bars }, (_, i) => (
                        <i key={i} style={{ height: `${Math.round(waveBar(voiceWave, i, waveHeight(i) * 0.3) * 100)}%` }} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="tl-empty-note">No voiceover</span>
                )}
              </div>
            </div>

            {/* BGM track */}
            <div className="tl-row">
              <div className="tl-label">
                <Icon name="music" size={14} />
                <span>Music</span>
              </div>
              <div className="tl-body" style={{ width: timelineWidth }} onMouseDown={(e) => startScrub(e, true)}>
                {bgmUrl ? (
                  <div className="timeline-block bgm-block tl-audio" style={{ left: 0, width: timelineWidth }}>
                    <Icon name="music" size={13} />
                    <span className="tl-block-text tl-audio-name">{bgmName || 'Background music'}</span>
                    <div className="tl-wave tl-wave--soft">
                      {Array.from({ length: bars }, (_, i) => (
                        <i key={i} style={{ height: `${Math.round(waveBar(bgmWave, i, 0.15) * 100)}%` }} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <button className="tl-add-placeholder" onMouseDown={(e) => e.stopPropagation()} onClick={() => onOpenLeftTab?.('media')}>
                    + Add audio
                  </button>
                )}
              </div>
            </div>

            {/* Snap guide */}
            {snapGuide !== null && <div className="tl-snap-guide" style={{ left: LABEL_W + snapGuide * zoom }} />}

            {/* Playhead line */}
            <div className="tl-playhead" style={{ left: LABEL_W + currentTime * zoom }} />
          </div>
        </div>
      </div>

      {/* Transition picker popup (fixed, so it never gets clipped) */}
      {transitionMenu && (
        <div
          className="transition-picker-popup"
          style={{ position: 'fixed', left: transitionMenu.x, top: transitionMenu.y - 8, transform: 'translate(-50%, -100%)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="tp-popup-title">Transition into scene {transitionMenu.index + 1}</div>
          {TRANSITION_TYPES.map(opt => {
            const active = (transitions[transitionMenu.index] || 'none') === opt.id;
            return (
              <div
                key={opt.id}
                className={`transition-picker-item${active ? ' active' : ''}`}
                onClick={() => {
                  onSetTransition(transitionMenu.index, opt.id);
                  setTransitionMenu(null);
                }}
              >
                {opt.label}
                {active && <Icon name="check" size={14} className="tp-check-icon" />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
