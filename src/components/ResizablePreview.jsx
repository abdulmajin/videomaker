import { useEffect, useRef, useState } from 'react';

// Display-only sizing for the preview frame. The canvas inside keeps its own
// width/height attributes, so render and export resolution never change.
const STORAGE_KEY = 'previewDisplayWidth';
const MIN_W = { landscape: 320, vertical: 200 };

function readStored(kind) {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')[kind];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(kind, value) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[kind] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable (private mode): size just won't be remembered
  }
}

// One listener per page keeps every preview in step with the same size
const listeners = new Set();
function broadcast(kind, value) {
  listeners.forEach((fn) => fn(kind, value));
}

export default function ResizablePreview({ isVertical = false, className = '', children }) {
  const kind = isVertical ? 'vertical' : 'landscape';
  const [width, setWidth] = useState(() => readStored(kind)); // null = fit to column
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const hostRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => { setWidth(readStored(kind)); }, [kind]);

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    const onShared = (k, v) => { if (k === kind) setWidth(v); };
    window.addEventListener('resize', onResize);
    listeners.add(onShared);
    return () => {
      window.removeEventListener('resize', onResize);
      listeners.delete(onShared);
    };
  }, [kind]);

  const maxW = Math.max(MIN_W[kind], viewportW * 0.96);
  const columnW = hostRef.current?.clientWidth || 0;
  const defaultW = isVertical ? Math.min(380, columnW || 380) : columnW;
  const shownW = width == null ? null : Math.max(MIN_W[kind], Math.min(maxW, width));

  const apply = (value) => {
    setWidth(value);
    writeStored(kind, value);
    broadcast(kind, value);
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = shownW ?? (defaultW || hostRef.current?.clientWidth || 640);
    dragRef.current = { x: e.clientX, startW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // The frame is centred, so each side grows by the pointer delta
    const next = Math.round(d.startW + (e.clientX - d.x) * 2);
    setWidth(Math.max(MIN_W[kind], Math.min(maxW, next)));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setWidth((w) => { writeStored(kind, w); broadcast(kind, w); return w; });
  };

  const presets = isVertical
    ? [{ label: 'Fit', value: null }, { label: 'Large', value: 520 }, { label: 'Tall', value: Math.round(Math.min(maxW, window.innerHeight * 0.85 * 9 / 16)) }]
    : [{ label: 'Fit', value: null }, { label: 'Large', value: 1280 }, { label: 'Theater', value: Math.round(maxW) }];

  const sliderMin = MIN_W[kind];
  const sliderVal = Math.round(shownW ?? (defaultW || sliderMin));

  const frameStyle = shownW == null ? undefined : {
    width: shownW,
    maxWidth: 'none',
    // Centre on the column even when wider than it
    marginLeft: `calc(50% - ${shownW / 2}px)`,
    marginRight: 0,
  };

  return (
    <div className="resizable-preview" ref={hostRef}>
      <div className="preview-size-bar">
        <span className="preview-size-label">Preview size</span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`preview-size-pill${(p.value == null ? width == null : width === p.value) ? ' active' : ''}`}
            onClick={() => apply(p.value)}
          >
            {p.label}
          </button>
        ))}
        <input
          type="range"
          min={sliderMin}
          max={Math.round(maxW)}
          step={10}
          value={sliderVal}
          onChange={(e) => apply(parseInt(e.target.value, 10))}
          aria-label="Preview display width"
        />
        <small>{width == null ? 'fit' : `${sliderVal}px`} · export resolution unchanged</small>
      </div>

      <div
        className={`${className} resizable-frame${shownW != null ? ' is-sized' : ''}`}
        style={frameStyle}
      >
        {children}
        <div
          className="preview-resize-handle"
          title="Drag to resize the preview (double-click to fit)"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => apply(null)}
        />
      </div>
    </div>
  );
}
