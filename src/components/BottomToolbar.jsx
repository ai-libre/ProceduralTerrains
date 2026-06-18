export default function BottomToolbar({ camMode, onTopDown, onAngled, onResetCamera, playerMode, onTogglePlayer }) {
  return (
    <div className="viewport-camera-bar" role="toolbar" aria-label="Camera views">
      <button
        type="button"
        className={`camera-bar-btn${camMode === 'topdown' ? ' active' : ''}`}
        onClick={onTopDown}
        aria-label="Top-down view"
        title="Top-down view"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 7h10M7 3v10" stroke="currentColor" strokeWidth="0.8" opacity=".6" />
        </svg>
        <span className="camera-bar-label">Top-down</span>
      </button>
      <button
        type="button"
        className={`camera-bar-btn${camMode !== 'topdown' ? ' active' : ''}`}
        onClick={onAngled}
        aria-label="Angled view"
        title="Angled view"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M2 11 8 4l6 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M2 11h12" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span className="camera-bar-label">Angled</span>
      </button>
      <button
        type="button"
        className="camera-bar-btn"
        onClick={onResetCamera}
        aria-label="Reset camera"
        title="Reset camera"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="1.6" fill="currentColor" />
        </svg>
        <span className="camera-bar-label">Reset Camera</span>
      </button>
      <button
        type="button"
        className={`camera-bar-btn${playerMode ? ' active' : ''}`}
        onClick={onTogglePlayer}
        aria-label={playerMode ? 'Exit walk mode' : 'Walk mode'}
        title="Walk on the terrain: gravity, jumping, swimming (click viewport to lock mouse)"
      >
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="3.2" r="1.6" fill="currentColor" />
          <path d="M8 5v4M8 9l-2.5 4M8 9l2.5 4M5.5 6.6 8 6l2.5.6"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="camera-bar-label">{playerMode ? 'Exit Walk' : 'Walk'}</span>
      </button>
    </div>
  );
}
