const TRANSITIONS = [
  { id: 'none',             emoji: '✂️',  label: 'Cut (No Transition)' },
  { id: 'crossfade',        emoji: '🌫️', label: 'Crossfade / Dissolve' },
  { id: 'wipe-left',        emoji: '◀️', label: 'Wipe Left' },
  { id: 'wipe-right',       emoji: '▶️', label: 'Wipe Right' },
  { id: 'zoom-blend',       emoji: '🔍', label: 'Zoom Blend' },
  { id: 'slide-push-left',  emoji: '⬅️', label: 'Push Left' },
  { id: 'slide-push-right', emoji: '➡️', label: 'Push Right' },
];

export default function TransitionPicker({ slideIndex, currentTransition, onChange, onClose }) {
  const handleSelect = (id) => {
    onChange(slideIndex, id);
    onClose();
  };

  return (
    <div className="transition-picker" role="listbox" aria-label="Choose transition">
      <div className="tp-header">
        <span className="tp-title">Transition — Slide {slideIndex + 1}</span>
        <button className="tp-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <ul className="tp-list">
        {TRANSITIONS.map((t) => {
          const isActive = (currentTransition || 'none') === t.id;
          return (
            <li key={t.id}>
              <button
                className={`tp-option${isActive ? ' tp-option--active' : ''}`}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(t.id)}
              >
                <span className="tp-emoji">{t.emoji}</span>
                <span className="tp-label">{t.label}</span>
                {isActive && <span className="tp-check">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
