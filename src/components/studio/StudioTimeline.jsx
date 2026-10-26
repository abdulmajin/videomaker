import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Icon } from './icons';
import { TRANSITION_TYPES } from '../../lib/studioRender';

// ─── Layout constants ───────────────────────────────────────────────────────
const LABEL_W   = 132;  // px, sticky track-label column
const END_PAD   = 48;   // px of empty space after the last second
const LANE_H    = 28;   // px per stacked lane in overlay tracks
const MIN_ZOOM  = 2;    // px per second
const MAX_ZOOM  = 400;
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

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
};

function blockLabel(l) {
  if (l.type === 'text') return l.text || 'Text';
  if (l.type === 'shape') return l.shape || 'Shape';
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
}) {
  const {
    duration = 30, rows = [], layers = [], audioUrl, bgmUrl, bgmName,
    imageUrls = [], transitions = {},
  } = project ?? {};

  // ── Local state ────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(20);                 // px per second
  const [transitionMenu, setTransitionMenu] = useState(null); // { index, x, y }

  // ── Refs ───────────────────────────────────────────────────────────────────
  const scrollRef    = useRef(null);
  const scrubRef     = useRef(null);  // { el } while scrubbing the ruler/track
  const blockDragRef = useRef(null);  // { layerId, mode, startX, startTime, endTime }

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

  // ── Block drag start ───────────────────────────────────────────────────────
  const handleBlockMouseDown = useCallback((e, layer, mode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    blockDragRef.current = {
      layerId:   layer.id,
      mode,                       // 'move' | 'trim-start' | 'trim-end'
      startX:    e.clientX,
      startTime: layer.startTime,
      endTime:   layer.endTime,
    };
    onSelectLayer(layer.id);
  }, [onSelectLayer]);

  // ── Global mousemove / mouseup ─────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      if (scrubRef.current) {
        onSeek(timeFromEvent(e, scrubRef.current.el));
        return;
      }
      const bd = blockDragRef.current;
      if (!bd) return;
      const dt  = (e.clientX - bd.startX) / zoom;
      const dur = bd.endTime - bd.startTime;
      if (bd.mode === 'trim-end') {
        onUpdateLayer(bd.layerId, { endTime: Math.max(bd.startTime + 0.2, Math.min(duration, bd.endTime + dt)) });
      } else if (bd.mode === 'trim-start') {
        onUpdateLayer(bd.layerId, { startTime: Math.max(0, Math.min(bd.endTime - 0.2, bd.startTime + dt)) });
      } else {
        const newStart = Math.max(0, Math.min(duration - dur, bd.startTime + dt));
        onUpdateLayer(bd.layerId, { startTime: newStart, endTime: newStart + dur });
      }
    };
    const onUp = () => {
      scrubRef.current = null;
      blockDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [zoom, duration, onSeek, onUpdateLayer, timeFromEvent]);

  // Close transition menu on outside click
  useEffect(() => {
    if (!transitionMenu) return undefined;
    const close = () => setTransitionMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [transitionMenu]);

  // ── Layer groups ───────────────────────────────────────────────────────────
  const groups = ['text', 'shape', 'image'].map(type => {
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
              onClick={() => onOpenLeftTab?.(meta.tab)}
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
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
      <div className="studio-timeline">
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
                      const url   = imageUrls[i];
                      return (
                        <div
                          key={row.id ?? i}
                          className="tl-scene"
                          style={{
                            left: start * zoom,
                            width: Math.max(2, (end - start) * zoom),
                            backgroundImage: url ? `url("${url}")` : undefined,
                          }}
                          title={`Scene ${i + 1}: ${(row.text || '').slice(0, 80)}`}
                        >
                          {(end - start) * zoom > 34 && <span className="tl-scene-badge">{i + 1}</span>}
                        </div>
                      );
                    })}
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
                        <i key={i} style={{ height: `${Math.round(waveHeight(i) * 100)}%` }} />
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
                        <i key={i} style={{ height: `${Math.round((0.35 + 0.4 * waveHeight(i + 7)) * 100)}%` }} />
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
