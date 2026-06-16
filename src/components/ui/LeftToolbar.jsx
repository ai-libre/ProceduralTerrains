import { PANEL_META, PANEL_ORDER, panelAvailable, getPanelDisplay } from '../panels/index.jsx';

// Primary vertical navigation: each item opens its matching side drawer panel.
export default function LeftToolbar({ activePanel, worldMode, onSelect }) {
  return (
    <nav className="left-toolbar" aria-label="Tools">
      {PANEL_ORDER.filter((id) => panelAvailable(id, worldMode)).map((id) => {
        const meta = PANEL_META[id];
        const display = getPanelDisplay(id, worldMode);
        return (
          <button
            key={id}
            type="button"
            className={`toolbar-btn${activePanel === id ? ' active' : ''}`}
            title={display.label}
            aria-label={display.label}
            aria-pressed={activePanel === id}
            onClick={() => onSelect(id)}
          >
            {meta.icon}
            <span className="toolbar-btn-label">{display.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
