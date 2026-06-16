import { useEffect, useState } from 'react';
import { FlatPanelContext } from '../panels/PanelContext.js';
import { renderPanel } from '../panels/index.jsx';

// Right-edge drawer that hosts ONE panel at a time. Floats over the viewport
// (does not consume a layout column) so the 3D view stays the visual center.
// Also owns the global hover-tooltip logic (data-tooltip) for its content.
export default function SideDrawer({ activePanel, ctx, onClose }) {
  const [tooltip, setTooltip] = useState(null);

  // Escape closes the active panel.
  useEffect(() => {
    if (!activePanel) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePanel, onClose]);

  // Global tooltip (data-tooltip attributes inside the drawer).
  useEffect(() => {
    const over = (e) => {
      const t = e.target.closest('[data-tooltip]');
      if (t) {
        const text = t.getAttribute('data-tooltip');
        if (text) setTooltip({ text, rect: t.getBoundingClientRect() });
      }
    };
    const out = (e) => { if (e.target.closest('[data-tooltip]')) setTooltip(null); };
    const scroll = () => setTooltip(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      window.removeEventListener('scroll', scroll, true);
    };
  }, []);

  useEffect(() => { setTooltip(null); }, [activePanel]);

  const open = !!activePanel;
  const popLeft = tooltip && tooltip.rect.left > window.innerWidth / 2;
  const tooltipStyle = tooltip ? {
    position: 'fixed',
    top: tooltip.rect.top + tooltip.rect.height / 2,
    left: popLeft ? tooltip.rect.left - 8 : tooltip.rect.left + tooltip.rect.width + 8,
    transform: popLeft ? 'translate(-100%, -50%)' : 'translate(0, -50%)',
  } : null;

  return (
    <>
      <aside className={`side-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <FlatPanelContext.Provider value={true}>
          {open && renderPanel(activePanel, { ...ctx, onClose })}
        </FlatPanelContext.Provider>
      </aside>

      {tooltip && open && (
        <div className="global-tooltip" style={tooltipStyle}>
          {popLeft ? (
            <>
              <div className="global-tooltip-content">{tooltip.text}</div>
              <div className="global-tooltip-arrow right" />
            </>
          ) : (
            <>
              <div className="global-tooltip-arrow left" />
              <div className="global-tooltip-content">{tooltip.text}</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
