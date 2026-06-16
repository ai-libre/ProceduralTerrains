import { PANEL_META, PANEL_ORDER, panelAvailable } from '../panels/index.jsx';

// Primary vertical navigation: each item opens its matching side drawer panel.
export default function LeftToolbar({ activePanel, worldMode, onSelect }) {
  return (
    <nav className="left-toolbar" aria-label="Tools">
      {PANEL_ORDER.filter((id) => panelAvailable(id, worldMode)).map((id) => {
        const meta = PANEL_META[id];
        return (
          <button
            key={id}
            type="button"
            className={`toolbar-btn${activePanel === id ? ' active' : ''}`}
            title={meta.label}
            aria-label={meta.label}
            aria-pressed={activePanel === id}
            onClick={() => onSelect(id)}
          >
            {meta.icon}
            <span className="toolbar-btn-label">{meta.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
