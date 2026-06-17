import { SelectRow, SliderCtl } from '../controls.jsx';

const TOOL_OPTIONS = [
  { value: 'raise', label: 'Raise Height' },
  { value: 'lower', label: 'Lower Height' },
  { value: 'smooth', label: 'Smooth Terrain' },
  { value: 'flatten', label: 'Flatten Terrain' },
  { value: 'setHeight', label: 'Set Height' },
  { value: 'biome', label: 'Paint Biome' },
  { value: 'riverCarve', label: 'Carve River' },
  { value: 'propsPaint', label: 'Paint Props' },
  { value: 'erase', label: 'Erase Paint' },
];

const BIOME_OPTIONS = [
  { value: 'desert', label: 'Desert' },
  { value: 'canyon', label: 'Canyon' },
  { value: 'wetland', label: 'Wetland' },
  { value: 'mountains', label: 'Mountains' },
];

const BRUSH_SHAPE_OPTIONS = [
  { value: 'round', label: 'Round' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'organic', label: 'Organic' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'ribbon', label: 'Ribbon' },
];

const PROP_OPTIONS = [
  { value: 'mixed', label: 'Mixed Grass + Flowers' },
  { value: 'grass', label: 'Grass' },
  { value: 'flowers', label: 'Flowers' },
  { value: 'eraseProps', label: 'Erase Props' },
];

const defs = {
  brushSize: { label: 'Brush Size', min: 4, max: 900, step: 1, digits: 0, unit: ' u' },
  strength: { label: 'Strength', min: 0.01, max: 1, step: 0.01, digits: 2 },
  falloff: { label: 'Falloff', min: 0, max: 1, step: 0.01, digits: 2 },
  brushRotation: { label: 'Brush Rotation', min: -180, max: 180, step: 1, digits: 0, unit: ' deg' },
  brushScatter: { label: 'Scatter Amount', min: 0.05, max: 1, step: 0.01, digits: 2 },
  brushSpacing: { label: 'Stroke Spacing', min: 0.08, max: 1, step: 0.01, digits: 2 },
  targetHeight: { label: 'Target Height', min: -120, max: 900, step: 1, digits: 0, unit: ' u' },
  riverDepth: { label: 'River Depth', min: 1, max: 220, step: 1, digits: 0, unit: ' u' },
  riverBankSoftness: { label: 'Bank Softness', min: 0.05, max: 1, step: 0.01, digits: 2 },
  layerOpacity: { label: 'Layer Opacity', min: 0, max: 1, step: 0.01, digits: 2 },
};

export default function PaintPanel({ paintState, onSetting, onClear, onExit }) {
  const state = paintState ?? {};
  const set = (key) => (value) => onSetting(key, value);
  return (
    <aside className="paint-panel">
      <div className="paint-panel-header">
        <div>
          <div className="paint-kicker">Terrain Paint Mode</div>
          <h2>Paint Layers</h2>
        </div>
        <button className="paint-exit" type="button" onClick={onExit}>Exit</button>
      </div>

      <div className="paint-section">
        <div className="subsection-label">Tool</div>
        <SelectRow label="Brush Tool" value={state.tool ?? 'raise'} options={TOOL_OPTIONS} onChange={set('tool')} />
        {(state.tool === 'biome') && (
          <SelectRow label="Biome Mask" value={state.biome ?? 'desert'} options={BIOME_OPTIONS} onChange={set('biome')} />
        )}
        {(state.tool === 'propsPaint') && (
          <SelectRow label="Prop Mask" value={state.propType ?? 'mixed'} options={PROP_OPTIONS} onChange={set('propType')} />
        )}
        {(state.tool === 'flatten' || state.tool === 'setHeight') && (
          <SliderCtl def={defs.targetHeight} value={state.targetHeight ?? 120} onChange={set('targetHeight')} />
        )}
        {(state.tool === 'riverCarve') && (
          <>
            <SliderCtl def={defs.riverDepth} value={state.riverDepth ?? 28} onChange={set('riverDepth')} />
            <SliderCtl def={defs.riverBankSoftness} value={state.riverBankSoftness ?? 0.65} onChange={set('riverBankSoftness')} />
          </>
        )}
      </div>

      <div className="paint-section">
        <div className="subsection-label">Brush</div>
        <SelectRow label="Brush Shape" value={state.brushShape ?? 'round'} options={BRUSH_SHAPE_OPTIONS} onChange={set('brushShape')} />
        <SliderCtl def={defs.brushSize} value={state.brushSize ?? 90} onChange={set('brushSize')} />
        <SliderCtl def={defs.strength} value={state.strength ?? 0.35} onChange={set('strength')} />
        <SliderCtl def={defs.falloff} value={state.falloff ?? 0.75} onChange={set('falloff')} />
        {(state.brushShape === 'ellipse' || state.brushShape === 'ribbon') && (
          <SliderCtl def={defs.brushRotation} value={state.brushRotation ?? 0} onChange={set('brushRotation')} />
        )}
        {(state.brushShape === 'scatter') && (
          <SliderCtl def={defs.brushScatter} value={state.brushScatter ?? 0.55} onChange={set('brushScatter')} />
        )}
        <SliderCtl def={defs.brushSpacing} value={state.brushSpacing ?? 0.35} onChange={set('brushSpacing')} />
        <p className="section-hint">Hold <b>Shift</b> and scroll to resize the brush. Right-click drag still orbits the Studio camera.</p>
      </div>

      <div className="paint-section">
        <div className="subsection-label">Layer</div>
        <SliderCtl def={defs.layerOpacity} value={state.layerOpacity ?? 1} onChange={set('layerOpacity')} />
        <button className="wide-btn danger" type="button" onClick={onClear}>Clear Painted Layers</button>
        <p className="section-hint">Paint is stored as override layers. Procedural generation remains intact and can be changed or regenerated underneath.</p>
      </div>
    </aside>
  );
}
