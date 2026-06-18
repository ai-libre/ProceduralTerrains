const MODES = [
  { id: 'studio', label: 'Tile' },
  { id: 'infinite', label: 'Infinite World' },
  { id: 'planet', label: 'Planet' },
];

export default function WorldModeBar({ worldMode, onSetWorldMode, modeLocked, floating = false }) {
  if (floating) {
    return (
      <div className="viewport-mode-bar" role="group" aria-label="World mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`camera-bar-btn mode-bar-btn${worldMode === m.id ? ' active' : ''}`}
            onClick={() => onSetWorldMode(m.id)}
            disabled={modeLocked}
            aria-pressed={worldMode === m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="tb-segment" role="group" aria-label="World mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`tb-mode${worldMode === m.id ? ' active' : ''}`}
          onClick={() => onSetWorldMode(m.id)}
          disabled={modeLocked}
          aria-pressed={worldMode === m.id}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
