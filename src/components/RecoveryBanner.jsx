import { formatSavedAt } from '../lib/autosave';

// Shown when an autosaved session is found. Autosave stays paused until the
// user picks one option, so the recovered snapshot is never overwritten.
export default function RecoveryBanner({ what, detail, savedAt, busy, onRestore, onDiscard }) {
  return (
    <div className="recovery-banner" role="alert">
      <div className="recovery-banner-text">
        <strong>Unsaved {what} found</strong>
        <span>
          Autosaved {formatSavedAt(savedAt)}{detail ? ` · ${detail}` : ''}. Autosave is paused until you choose.
        </span>
      </div>
      <div className="recovery-banner-actions">
        <button type="button" className="recovery-btn recovery-btn--primary" disabled={busy} onClick={onRestore}>
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button type="button" className="recovery-btn" disabled={busy} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

export function autosaveLabel({ status, savedAt }) {
  if (status === 'saving') return 'Autosaving…';
  if (status === 'error') return '⚠ Autosave failed';
  if (status === 'saved' && savedAt) return `✓ Autosaved ${formatSavedAt(savedAt)}`;
  return '';
}
