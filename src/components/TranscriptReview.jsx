import { useMemo, useState } from 'react';

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');

const fmtTime = (s) => {
  const t = Math.max(0, s || 0);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * Shows the Whisper transcript as clickable words. Words that don't appear in
 * the script are flagged (usually misheard), and any word can be corrected.
 * Corrections feed karaoke captions and can be re-aligned to the slides.
 */
export default function TranscriptReview({ words = [], slides = [], rows = [], onChangeWords, onRealign, onSeek }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // word index
  const [dirty, setDirty] = useState(false);

  const scriptWords = useMemo(() => {
    const set = new Set();
    for (const s of slides) for (const w of String(s.text || '').split(/\s+/)) { const n = norm(w); if (n) set.add(n); }
    return set;
  }, [slides]);

  const unmatched = useMemo(
    () => words.reduce((n, w) => n + (norm(String(w.text || '')) && !scriptWords.has(norm(String(w.text || ''))) ? 1 : 0), 0),
    [words, scriptWords]
  );

  const lowSlides = rows.filter((r) => r.match != null && r.match < 0.5).length;

  if (!words.length) return null;

  const commit = (i, text) => {
    const clean = text.trim();
    setEditing(null);
    if (!clean || clean === String(words[i].text).trim()) return;
    onChangeWords(words.map((w, k) => (k === i ? { ...w, text: ` ${clean}` } : w)));
    setDirty(true);
  };

  return (
    <div className="transcript-review">
      <button type="button" className="transcript-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? '▲' : '▼'} 📝 Review transcript · {words.length} words
        {unmatched > 0 && <span className="badge badge-warn">{unmatched} not in script</span>}
        {lowSlides > 0 && <span className="badge badge-warn">{lowSlides} slide(s) under 50% match</span>}
      </button>

      {open && (
        <>
          <p className="hint">
            Highlighted words don't appear in your script — often a mishearing. Click a word to fix it,
            double-click to jump there. Fixes update karaoke captions; re-align to retime the slides.
          </p>
          <div className="transcript-words">
            {words.map((w, i) => {
              const text = String(w.text || '').trim();
              const flagged = norm(text) && !scriptWords.has(norm(text));
              if (editing === i) {
                return (
                  <input
                    key={i}
                    className="transcript-edit"
                    autoFocus
                    defaultValue={text}
                    size={Math.max(3, text.length + 1)}
                    onBlur={(e) => commit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(i, e.currentTarget.value);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                );
              }
              return (
                <span
                  key={i}
                  className={`transcript-word${flagged ? ' flagged' : ''}`}
                  title={`${fmtTime(w.start)} → ${fmtTime(w.end)}${flagged ? ' · not in script' : ''}`}
                  onClick={() => setEditing(i)}
                  onDoubleClick={() => onSeek?.(w.start)}
                >
                  {text}
                </span>
              );
            })}
          </div>
          <div className="transcript-actions">
            <button
              type="button"
              className="secondary-btn"
              disabled={!dirty}
              onClick={() => { onRealign(); setDirty(false); }}
            >
              🎯 Re-align slides with corrections
            </button>
          </div>
        </>
      )}
    </div>
  );
}
