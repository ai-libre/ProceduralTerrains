import { useState } from 'react';
import { ToggleRow, SelectRow } from './controls.jsx';

function SectionTitle({ children }) {
  return <div className="settings-section-title">{children}</div>;
}

export default function ExportModal({ open, params, onClose, onExport }) {
  if (!open) return null;

  const [options, setOptions] = useState({
    format: 'glb',
    meshRes: '512',
    includeMesh: true,
    includeSkirts: true,
    includeBase: true,
    bakeColor: true,
    texRes: '2048',
    bakeLighting: false,
    bakeNormal: true,
    exportHeightmap: false,
    exportSplat: false,
    exportCollision: false,
    collisionRes: '128',
    exportWater: false,
    exportPreset: true,
  });

  const [exporting, setExporting] = useState(false);

  const setOption = (key, val) => {
    setOptions((prev) => ({ ...prev, [key]: val }));
  };

  const handleExportClick = async () => {
    setExporting(true);
    try {
      await onExport(options);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  const formatOptions = [
    { value: 'glb', label: 'GLB / GLTF (Recommended)' },
    { value: 'obj', label: 'OBJ (Wavefront)' },
  ];

  const resolutionOptions = [
    { value: '64', label: '64 × 64 (Low-poly)' },
    { value: '128', label: '128 × 128' },
    { value: '256', label: '256 × 256' },
    { value: '512', label: '512 × 512 (Standard)' },
    { value: '1024', label: '1024 × 1024 (High-end)' },
  ];

  const textureResolutionOptions = [
    { value: '512', label: '512 × 512' },
    { value: '1024', label: '1024 × 1024' },
    { value: '2048', label: '2048 × 2048 (Crisp)' },
    { value: '4096', label: '4096 × 4096 (UHD)' },
  ];

  const collisionResolutionOptions = [
    { value: '32', label: '32 × 32' },
    { value: '64', label: '64 × 64' },
    { value: '128', label: '128 × 128 (Recommended)' },
    { value: '256', label: '256 × 256' },
  ];

  const showTextureSettings = options.bakeColor || options.bakeNormal || options.exportHeightmap;

  return (
    <div className="modal" onClick={(e) => e.target.classList.contains('modal') && !exporting && onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <span>Export 3D Terrain Board</span>
          <button onClick={onClose} disabled={exporting}>✕</button>
        </div>
        <div className="modal-body">
          <SectionTitle>Format &amp; Resolution</SectionTitle>
          <SelectRow
            label="Format"
            value={options.format}
            options={formatOptions}
            onChange={(v) => setOption('format', v)}
          />
          <ToggleRow
            label="Include Terrain Mesh"
            value={options.includeMesh}
            onChange={(v) => setOption('includeMesh', v)}
          />

          {options.includeMesh && (
            <>
              <SelectRow
                label="Mesh Resolution"
                value={options.meshRes}
                options={resolutionOptions}
                onChange={(v) => setOption('meshRes', v)}
              />
              <ToggleRow
                label="Include Side Skirts"
                value={options.includeSkirts}
                onChange={(v) => setOption('includeSkirts', v)}
              />
              {options.includeSkirts && (
                <ToggleRow
                  label="Include Base Slab (watertight block)"
                  value={options.includeBase}
                  onChange={(v) => setOption('includeBase', v)}
                />
              )}
            </>
          )}

          <SectionTitle>Texture Baking</SectionTitle>
          <ToggleRow
            label="Bake Color Texture"
            value={options.bakeColor}
            onChange={(v) => setOption('bakeColor', v)}
          />
          {options.bakeColor && (
            <ToggleRow
              label="Bake Dynamic Lighting into Color"
              value={options.bakeLighting}
              onChange={(v) => setOption('bakeLighting', v)}
            />
          )}
          <ToggleRow
            label="Bake Normal Map"
            value={options.bakeNormal}
            onChange={(v) => setOption('bakeNormal', v)}
          />
          
          {showTextureSettings && (
            <SelectRow
              label="Texture Size"
              value={options.texRes}
              options={textureResolutionOptions}
              onChange={(v) => setOption('texRes', v)}
            />
          )}

          <SectionTitle>Additional Assets</SectionTitle>
          <ToggleRow
            label="Export Grayscale Heightmap"
            value={options.exportHeightmap}
            onChange={(v) => setOption('exportHeightmap', v)}
          />
          {options.exportHeightmap && (
            <ToggleRow
              label="Include Biome Splat Map"
              value={options.exportSplat}
              onChange={(v) => setOption('exportSplat', v)}
            />
          )}
          <ToggleRow
            label="Export Collision Mesh"
            value={options.exportCollision}
            onChange={(v) => setOption('exportCollision', v)}
          />
          {options.exportCollision && (
            <SelectRow
              label="Collision Resolution"
              value={options.collisionRes}
              options={collisionResolutionOptions}
              onChange={(v) => setOption('collisionRes', v)}
            />
          )}
          <ToggleRow
            label="Include Water Plane"
            value={options.exportWater}
            onChange={(v) => setOption('exportWater', v)}
          />
          <ToggleRow
            label="Export Preset parameters (JSON)"
            value={options.exportPreset}
            onChange={(v) => setOption('exportPreset', v)}
          />

          <button
            type="button"
            className="wide-btn primary"
            style={{ marginTop: '20px', height: '36px', fontWeight: 'bold' }}
            onClick={handleExportClick}
            disabled={exporting}
          >
            {exporting ? 'Generating files, please wait...' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
