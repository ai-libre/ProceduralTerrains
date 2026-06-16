import { createContext } from 'react';

// When true, ControlSection renders as a plain, always-open labelled group
// (no collapsable folder chrome). The side drawer provides this so the legacy
// ControlSection-wrapped panels (World, Clouds, Environment, Camera, LOD…)
// reuse cleanly without the dense folder navigation.
export const FlatPanelContext = createContext(false);
