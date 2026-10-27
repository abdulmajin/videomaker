import { useRef, useState, useEffect, useCallback } from 'react';

export default function VideoTextCanvasInteractiveLayer({
  canvasRef,
  currentTime = 0,
  overlays = [],
  selectedOverlayId = null,
  onSelectOverlay = () => {},
  onUpdateOverlays = () => {},
  onOpenEditor = () => {},
  isVertical = false,
}) {
  const containerRef = useRef(null);
  const dragRef = useRef(null); // { id, startX, startY, origX, origY, rect }
  const [isDragging, setIsDragging] = useState(false);
  const [showCenterGuide, setShowCenterGuide] = useState(false);

  // Calculate normalized X and Y for an overlay
  const getOverlayCoords = useCallback(
    (item) => {
      let posX = item.presetPosition === 'custom' && item.x !== undefined ? item.x : 0.5;
      let posY = 0.5;

      if (item.presetPosition === 'top') {
        posY = isVertical ? 0.12 : 0.10;
      } else if (item.presetPosition === 'center') {
        posY = isVertical ? 0.44 : 0.42;
      } else if (item.presetPosition === 'lower-third') {
        posY = isVertical ? 0.72 : 0.68;
      } else if (item.presetPosition === 'bottom') {
        posY = isVertical ? 0.84 : 0.82;
      } else if (item.presetPosition === 'custom' && item.y !== undefined) {
        posY = item.y;
      }

      return { x: posX, y: posY };
    },
    [isVertical]
  );

  // Find overlays visible at current timestamp (or currently selected)
  const visibleOverlays = overlays.filter((o) => {
    const isVisibleNow = currentTime >= (o.startTime ?? 0) && currentTime <= (o.endTime ?? 0);
    const isSelected = o.id === selectedOverlayId;
    return isVisibleNow || isSelected;
  });

  // Handle Drag Start
  const handleMouseDown = (e, item) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const coords = getOverlayCoords(item);

    dragRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: coords.x,
      origY: coords.y,
      rect,
    };

    setIsDragging(true);
    onSelectOverlay(item.id);
  };

  // Global mousemove & mouseup for drag repositioning
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const dr = dragRef.current;
      if (!dr) return;

      const { id, startX, startY, origX, origY, rect } = dr;
      const dx = (e.clientX - startX) / rect.width;
      const dy = (e.clientY - startY) / rect.height;

      let newX = Math.max(0.06, Math.min(0.94, origX + dx));
      let newY = Math.max(0.06, Math.min(0.94, origY + dy));

      // Snap guides: Snap to horizontal center if within 3%
      if (Math.abs(newX - 0.5) < 0.03) {
        newX = 0.5;
        setShowCenterGuide(true);
      } else {
        setShowCenterGuide(false);
      }

      // Snap to common vertical positions if close
      const topY = isVertical ? 0.12 : 0.10;
      const centerY = isVertical ? 0.44 : 0.42;
      const lowerY = isVertical ? 0.72 : 0.68;
      const botY = isVertical ? 0.84 : 0.82;

      let presetPos = 'custom';
      if (Math.abs(newY - topY) < 0.02) {
        newY = topY;
        presetPos = 'top';
      } else if (Math.abs(newY - centerY) < 0.025) {
        newY = centerY;
        presetPos = 'center';
      } else if (Math.abs(newY - lowerY) < 0.02) {
        newY = lowerY;
        presetPos = 'lower-third';
      } else if (Math.abs(newY - botY) < 0.02) {
        newY = botY;
        presetPos = 'bottom';
      }

      const updated = overlays.map((o) =>
        o.id === id ? { ...o, presetPosition: presetPos, x: Number(newX.toFixed(3)), y: Number(newY.toFixed(3)) } : o
      );
      onUpdateOverlays(updated);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setShowCenterGuide(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, overlays, onUpdateOverlays, isVertical]);

  // Quick preset snap handler from on-screen toolbar
  const handleSnapPosition = (item, presetId, yVal) => {
    const updated = overlays.map((o) =>
      o.id === item.id ? { ...o, presetPosition: presetId, x: 0.5, y: yVal } : o
    );
    onUpdateOverlays(updated);
  };

  const handleDeleteOverlay = (item) => {
    const nextList = overlays.filter((o) => o.id !== item.id);
    onUpdateOverlays(nextList);
    onSelectOverlay(null);
  };

  // Auto-deselect when clicking empty space, outside the text box, or pressing Escape
  useEffect(() => {
    if (!selectedOverlayId) return;

    const handleGlobalPointerDown = (e) => {
      // Don't deselect if clicking inside:
      // - The interactive text box or its drag handles
      // - The floating action toolbar (Edit, Top, Center, Bottom, Delete)
      // - The Text Overlay Editor Modal
      // - Timeline overlay badges or card controls
      if (
        e.target.closest('.interactive-text-box') ||
        e.target.closest('.interactive-floating-actions') ||
        e.target.closest('.modal-overlay') ||
        e.target.closest('.text-overlay-editor-modal') ||
        e.target.closest('.timeline-text-overlay-badge') ||
        e.target.closest('.text-overlay-card') ||
        e.target.closest('.btn-add-text-overlay') ||
        e.target.closest('.btn-edit-overlay')
      ) {
        return;
      }

      // User clicked on white/empty space or outside the text overlay
      onSelectOverlay(null);
    };

    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        onSelectOverlay(null);
      }
    };

    window.addEventListener('pointerdown', handleGlobalPointerDown);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [selectedOverlayId, onSelectOverlay]);

  return (
    <div
      ref={containerRef}
      className="video-text-interactive-layer"
      onPointerDown={(e) => {
        // Direct click on the empty canvas or whitespace inside the video layer
        if (e.target === containerRef.current || e.target.classList.contains('video-text-interactive-layer')) {
          onSelectOverlay(null);
        }
      }}
      onClick={(e) => {
        if (e.target === containerRef.current || e.target.classList.contains('video-text-interactive-layer')) {
          onSelectOverlay(null);
        }
      }}
    >
      {/* Center line snap guide indicator */}
      {showCenterGuide && <div className="interactive-center-guide-line" />}

      {visibleOverlays.map((item) => {
        const isSelected = item.id === selectedOverlayId;
        const coords = getOverlayCoords(item);

        return (
          <div
            key={item.id}
            className={`interactive-text-box ${isSelected ? 'selected' : ''} ${isDragging && isSelected ? 'dragging' : ''}`}
            style={{
              left: `${coords.x * 100}%`,
              top: `${coords.y * 100}%`,
            }}
            onMouseDown={(e) => handleMouseDown(e, item)}
            onClick={(e) => {
              e.stopPropagation();
              onSelectOverlay(item.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpenEditor();
            }}
            title="Click and drag to reposition text on screen. Double click to style."
          >
            {/* Box Header Badge */}
            <div className="interactive-box-label">
              <span className="box-icon">✨</span>
              <span className="box-text-name">{item.text || 'Text Hook'}</span>
              <span className="box-coords-badge">
                X:{Math.round(coords.x * 100)}% Y:{Math.round(coords.y * 100)}%
              </span>
            </div>

            {/* Corner Drag Grips */}
            <span className="box-corner tl" />
            <span className="box-corner tr" />
            <span className="box-corner bl" />
            <span className="box-corner br" />

            {/* Floating Action Bar when Selected */}
            {isSelected && (
              <div
                className="interactive-floating-actions"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="interactive-action-btn edit"
                  onClick={onOpenEditor}
                  title="Open Text Style & Decoration Editor"
                >
                  🎨 Edit Style
                </button>
                <button
                  type="button"
                  className="interactive-action-btn snap"
                  onClick={() => handleSnapPosition(item, 'top', isVertical ? 0.12 : 0.10)}
                  title="Snap to Top Banner"
                >
                  🔝 Top
                </button>
                <button
                  type="button"
                  className="interactive-action-btn snap"
                  onClick={() => handleSnapPosition(item, 'center', isVertical ? 0.44 : 0.42)}
                  title="Snap to Center Hook"
                >
                  🎯 Center
                </button>
                <button
                  type="button"
                  className="interactive-action-btn snap"
                  onClick={() => handleSnapPosition(item, 'bottom', isVertical ? 0.84 : 0.82)}
                  title="Snap to Bottom Subtitle"
                >
                  ⬇️ Bottom
                </button>
                <button
                  type="button"
                  className="interactive-action-btn delete"
                  onClick={() => handleDeleteOverlay(item)}
                  title="Delete this text overlay"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
