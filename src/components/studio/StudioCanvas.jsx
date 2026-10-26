import {
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { Icon } from './icons';

// ─────────────────────────────────────────────
//  Helper: is a layer visible at a given time?
// ─────────────────────────────────────────────
function isLayerVisible(layer, time) {
  return time >= layer.startTime && time <= layer.endTime;
}

// ─────────────────────────────────────────────
//  Resize handle descriptors
//  id: identifies which edge/corner is grabbed
//  cursor: CSS cursor value
//  nx/ny: normalised position inside the box (0–1)
// ─────────────────────────────────────────────
const HANDLES = [
  { id: 'tl', cursor: 'nwse-resize', nx: 0,   ny: 0   },
  { id: 't',  cursor: 'ns-resize',   nx: 0.5, ny: 0   },
  { id: 'tr', cursor: 'nesw-resize', nx: 1,   ny: 0   },
  { id: 'r',  cursor: 'ew-resize',   nx: 1,   ny: 0.5 },
  { id: 'br', cursor: 'nwse-resize', nx: 1,   ny: 1   },
  { id: 'b',  cursor: 'ns-resize',   nx: 0.5, ny: 1   },
  { id: 'bl', cursor: 'nesw-resize', nx: 0,   ny: 1   },
  { id: 'l',  cursor: 'ew-resize',   nx: 0,   ny: 0.5 },
];

const HANDLE_SIZE = 10; // px
const STAGE_PADDING = 48; // px of breathing room around the stage

function layerLabel(layer) {
  if (!layer) return '';
  if (layer.type === 'text') return layer.text?.slice(0, 22) || 'Text';
  if (layer.type === 'shape') return layer.shape || 'Shape';
  return layer.name || 'Image';
}

export default function StudioCanvas({
  project,
  currentTime,
  selectedLayerId,
  preloadedSlideImages,
  preloadedLayerImages,
  onSelectLayer,
  onUpdateLayer,
  onDeleteLayer,
  onDuplicateLayer,
  onReorderLayer,
  onChangeAspect,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  drawFrame,
}) {
  const areaRef      = useRef(null);
  const wrapperRef   = useRef(null);
  const canvasRef    = useRef(null);
  const overlayRef   = useRef(null);
  const rafRef       = useRef(null);
  const dragRef      = useRef(null); // { type:'move'|'resize'|'rotate', layerId, ... }
  const [isDragging, setIsDragging] = useState(false);
  const [aspectMenu, setAspectMenu] = useState(false);

  // ── Canvas dimensions ────────────────────────────────────────────────────
  const isVertical  = project?.aspectRatio === '9:16';
  const renderW     = isVertical ? 720  : 1280;
  const renderH     = isVertical ? 1280 : 720;
  const ratio       = renderW / renderH;

  // ── Fit the stage inside the available area ──────────────────────────────
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setAreaSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const availW = Math.max(120, areaSize.w - STAGE_PADDING * 2);
  const availH = Math.max(80, areaSize.h - STAGE_PADDING * 2);
  let stageW = availW;
  let stageH = stageW / ratio;
  if (stageH > availH) { stageH = availH; stageW = stageH * ratio; }
  stageW = Math.floor(stageW);
  stageH = Math.floor(stageH);

  // ── Draw on canvas ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawFrame) return;
    const ctx = canvas.getContext('2d');
    drawFrame({
      ctx,
      width:  renderW,
      height: renderH,
      time:   currentTime,
      ...project,
      preloadedSlideImages,
      preloadedLayerImages,
    });
  }, [currentTime, project, preloadedSlideImages, preloadedLayerImages, drawFrame, renderW, renderH]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // ── Selected layer (for overlay handles) ─────────────────────────────────
  const selectedLayer = project?.layers?.find((l) => l.id === selectedLayerId) ?? null;
  const layerVisible  = selectedLayer ? isLayerVisible(selectedLayer, currentTime) : false;

  // ── Hit testing (click on overlay background) ─────────────────────────────
  const hitTest = useCallback(
    (mx, my) => {
      if (!project?.layers || stageW === 0) return null;
      const nx = mx / stageW;
      const ny = my / stageH;
      const visible = project.layers
        .filter((l) => isLayerVisible(l, currentTime))
        .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
      for (const layer of visible) {
        if (
          nx >= layer.x &&
          nx <= layer.x + layer.width &&
          ny >= layer.y &&
          ny <= layer.y + layer.height
        ) {
          return layer;
        }
      }
      return null;
    },
    [project, currentTime, stageW, stageH]
  );

  const beginMove = useCallback((e, layer) => {
    dragRef.current = {
      type:       'move',
      layerId:    layer.id,
      startMX:    e.clientX,
      startMY:    e.clientY,
      startLayer: { ...layer },
      overlayW:   stageW,
      overlayH:   stageH,
    };
    setIsDragging(true);
  }, [stageW, stageH]);

  // ── Mouse event handlers ──────────────────────────────────────────────────

  /** Click on the raw overlay (not on a handle box): select + start dragging */
  const handleOverlayMouseDown = useCallback(
    (e) => {
      if (e.target !== overlayRef.current) return; // bubbled from handle box
      const rect = overlayRef.current.getBoundingClientRect();
      const hit  = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      onSelectLayer(hit ? hit.id : null);
      if (hit) beginMove(e, hit);
    },
    [hitTest, onSelectLayer, beginMove]
  );

  /** Start moving the selected layer */
  const handleMoveStart = useCallback(
    (e) => {
      e.stopPropagation();
      if (!selectedLayer) return;
      beginMove(e, selectedLayer);
    },
    [selectedLayer, beginMove]
  );

  /** Start resizing via a corner/edge handle */
  const handleResizeStart = useCallback(
    (e, handleId) => {
      e.stopPropagation();
      if (!selectedLayer) return;
      dragRef.current = {
        type:       'resize',
        handleId,
        layerId:    selectedLayer.id,
        startMX:    e.clientX,
        startMY:    e.clientY,
        startLayer: { ...selectedLayer },
        overlayW:   stageW,
        overlayH:   stageH,
      };
      setIsDragging(true);
    },
    [selectedLayer, stageW, stageH]
  );

  /** Rotation handle start */
  const handleRotateStart = useCallback(
    (e) => {
      e.stopPropagation();
      if (!selectedLayer || !overlayRef.current) return;
      const rect = overlayRef.current.getBoundingClientRect();
      const cx   = (selectedLayer.x + selectedLayer.width  / 2) * stageW + rect.left;
      const cy   = (selectedLayer.y + selectedLayer.height / 2) * stageH + rect.top;
      dragRef.current = {
        type:       'rotate',
        layerId:    selectedLayer.id,
        cx, cy,
        startLayer: { ...selectedLayer },
      };
      setIsDragging(true);
    },
    [selectedLayer, stageW, stageH]
  );

  // Global mousemove / mouseup
  useEffect(() => {
    const onMove = (e) => {
      const dr = dragRef.current;
      if (!dr) return;
      const dx = e.clientX - dr.startMX;
      const dy = e.clientY - dr.startMY;

      if (dr.type === 'move') {
        const dnx = dx / dr.overlayW;
        const dny = dy / dr.overlayH;
        let nx = dr.startLayer.x + dnx;
        let ny = dr.startLayer.y + dny;
        // Soft snap to the stage centre lines (hold Alt to disable)
        if (!e.altKey) {
          const cx = nx + dr.startLayer.width / 2;
          const cy = ny + dr.startLayer.height / 2;
          if (Math.abs(cx - 0.5) < 0.012) nx = 0.5 - dr.startLayer.width / 2;
          if (Math.abs(cy - 0.5) < 0.012) ny = 0.5 - dr.startLayer.height / 2;
        }
        onUpdateLayer(dr.layerId, {
          x: Math.max(-dr.startLayer.width * 0.9, Math.min(1 - dr.startLayer.width * 0.1, nx)),
          y: Math.max(-dr.startLayer.height * 0.9, Math.min(1 - dr.startLayer.height * 0.1, ny)),
        });
      } else if (dr.type === 'resize') {
        const { handleId, startLayer, overlayW, overlayH } = dr;
        const dnx = dx / overlayW;
        const dny = dy / overlayH;
        let { x, y, width, height } = startLayer;

        if (handleId.includes('r')) { width  = Math.max(0.02, width  + dnx); }
        if (handleId.includes('b')) { height = Math.max(0.02, height + dny); }
        if (handleId.includes('l')) {
          const newW = Math.max(0.02, width - dnx);
          x = x + (width - newW);
          width = newW;
        }
        if (handleId.includes('t')) {
          const newH = Math.max(0.02, height - dny);
          y = y + (height - newH);
          height = newH;
        }
        // Shift + corner = keep aspect ratio
        if (e.shiftKey && handleId.length === 2) {
          const k = startLayer.width / startLayer.height;
          height = width / k;
          if (handleId.includes('t')) y = startLayer.y + startLayer.height - height;
        }
        onUpdateLayer(dr.layerId, { x, y, width, height });
      } else if (dr.type === 'rotate') {
        let angle = Math.atan2(e.clientY - dr.cy, e.clientX - dr.cx) * (180 / Math.PI) + 90;
        if (angle > 180) angle -= 360;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15;
        onUpdateLayer(dr.layerId, { rotation: Math.round(angle) });
      }
    };

    const onUp = () => {
      if (dragRef.current) setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [onUpdateLayer]);

  const handleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  // ── Build handle-box display rect ─────────────────────────────────────────
  let handleBox = null;
  if (selectedLayer && layerVisible && stageW > 0) {
    const { x, y, width, height, rotation = 0 } = selectedLayer;
    handleBox = {
      dLeft:   x      * stageW,
      dTop:    y      * stageH,
      dWidth:  width  * stageW,
      dHeight: height * stageH,
      rotation,
    };
  }

  return (
    <div className="studio-canvas-area" ref={areaRef}>
      {/* Top-left: undo / redo */}
      <div className="cs-canvas-history">
        <button className="cs-float-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={16} />
        </button>
        <button className="cs-float-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Icon name="redo" size={16} />
        </button>
      </div>

      {/* Top-right: aspect ratio + fullscreen */}
      <div className="cs-aspect-badge">
        <div style={{ position: 'relative' }}>
          <button className="cs-aspect-pill" onClick={() => setAspectMenu(m => !m)}>
            <Icon name={isVertical ? 'smartphone' : 'monitor'} size={14} />
            {project.aspectRatio}
            <Icon name="chevronDown" size={12} />
          </button>
          {aspectMenu && (
            <div className="cs-dropdown-menu cs-dropdown-menu--right" onMouseLeave={() => setAspectMenu(false)}>
              {[
                { id: '16:9', label: '16:9 Landscape', icon: 'monitor' },
                { id: '9:16', label: '9:16 Vertical', icon: 'smartphone' },
              ].map(o => (
                <button
                  key={o.id}
                  className={project.aspectRatio === o.id ? 'active' : ''}
                  onClick={() => { onChangeAspect(o.id); setAspectMenu(false); }}
                >
                  <Icon name={o.icon} size={15} /> {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="cs-float-btn" onClick={handleFullscreen} title="Fullscreen preview">
          <Icon name="maximize" size={16} />
        </button>
      </div>

      {/* The stage */}
      <div
        ref={wrapperRef}
        className="studio-canvas-wrapper"
        style={{ width: stageW, height: stageH, visibility: areaSize.w ? 'visible' : 'hidden' }}
      >
        <canvas
          ref={canvasRef}
          width={renderW}
          height={renderH}
          style={{ width: '100%', height: '100%' }}
        />

        {/* Corner dots (Clipchamp-style stage frame) */}
        <span className="cs-stage-dot tl" /><span className="cs-stage-dot tr" />
        <span className="cs-stage-dot bl" /><span className="cs-stage-dot br" />

        {/* Transparent overlay for hit-testing & handles */}
        <div
          ref={overlayRef}
          className="canvas-overlay"
          onMouseDown={handleOverlayMouseDown}
        >
          {/* ── Selection / transform box ── */}
          {handleBox && (
            <div
              className={`layer-handle-box${isDragging ? ' dragging' : ''}`}
              style={{
                left:      handleBox.dLeft,
                top:       handleBox.dTop,
                width:     handleBox.dWidth,
                height:    handleBox.dHeight,
                transform: `rotate(${handleBox.rotation}deg)`,
                cursor:    'move',
                pointerEvents: 'all',
              }}
              onMouseDown={handleMoveStart}
            >
              <div className="layer-handle-label">{layerLabel(selectedLayer)}</div>

              {/* Rotation handle (top-center) */}
              <div className="cs-rotate-stem" />
              <div
                className="rotate-handle"
                style={{ top: -30, bottom: 'auto' }}
                onMouseDown={handleRotateStart}
                title="Rotate (Shift = 15° steps)"
              />

              {/* Resize handles */}
              {HANDLES.map(({ id, cursor, nx, ny }) => (
                <div
                  key={id}
                  className="resize-handle"
                  style={{
                    left:   `calc(${nx * 100}% - ${HANDLE_SIZE / 2}px)`,
                    top:    `calc(${ny * 100}% - ${HANDLE_SIZE / 2}px)`,
                    width:  HANDLE_SIZE,
                    height: HANDLE_SIZE,
                    cursor,
                  }}
                  onMouseDown={(e) => handleResizeStart(e, id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating element toolbar (right edge) */}
      {selectedLayer && (
        <div className="cs-canvas-toolbar">
          <button onClick={() => onDuplicateLayer(selectedLayer.id)} title="Duplicate (Ctrl+D)"><Icon name="copy" /></button>
          <button onClick={() => onReorderLayer(selectedLayer.id, 'front')} title="Bring to front"><Icon name="bringFront" /></button>
          <button onClick={() => onReorderLayer(selectedLayer.id, 'back')} title="Send to back"><Icon name="sendBack" /></button>
          <button
            onClick={() => onUpdateLayer(selectedLayer.id, {
              x: 0.5 - selectedLayer.width / 2,
              y: 0.5 - selectedLayer.height / 2,
            })}
            title="Center on stage"
          >
            <Icon name="fit" />
          </button>
          <div className="cs-canvas-toolbar-sep" />
          <button className="danger" onClick={() => onDeleteLayer(selectedLayer.id)} title="Delete (Del)"><Icon name="trash" /></button>
        </div>
      )}

      {selectedLayer && !layerVisible && (
        <div className="cs-canvas-hint">
          “{layerLabel(selectedLayer)}” isn’t visible at the playhead — it shows from {selectedLayer.startTime.toFixed(1)}s to {selectedLayer.endTime.toFixed(1)}s.
        </div>
      )}
    </div>
  );
}
