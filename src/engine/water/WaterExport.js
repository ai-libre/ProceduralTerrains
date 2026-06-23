// ============================================================================
// WaterExport — helpers for exporting water meshes and mask maps.
// ============================================================================

import * as THREE from 'three';
import { generateWaterMasks, downloadMaskPng } from './WaterMasks.js';
import { isWaterActive } from './WaterSettings.js';

/**
 * Export water mask PNGs from a height sampler.
 */
export function exportWaterMasks({
  sampleHeight,
  seaLevel,
  size,
  resolution = 512,
  origin,
  options = {},
}) {
  if (!isWaterActive(options.waterMode ?? 'legacy', seaLevel)) return [];
  const masks = generateWaterMasks({ sampleHeight, seaLevel, size, resolution, origin });
  const prefix = options.filenamePrefix ?? 'water';
  const files = [];

  if (options.exportWaterMask !== false) {
    downloadMaskPng(masks.waterMask, masks.resolution, `${prefix}-water-mask.png`);
    files.push('water-mask');
  }
  if (options.exportDepthMap) {
    downloadMaskPng(masks.depthMap, masks.resolution, `${prefix}-depth-map.png`, { colorize: true });
    files.push('depth-map');
  }
  if (options.exportShorelineMask) {
    downloadMaskPng(masks.shorelineMask, masks.resolution, `${prefix}-shoreline-mask.png`);
    files.push('shoreline-mask');
  }
  if (options.exportFoamMask) {
    downloadMaskPng(masks.foamMask, masks.resolution, `${prefix}-foam-mask.png`);
    files.push('foam-mask');
  }
  return files;
}

/**
 * Build a simple water plane mesh for GLB export (separate named object).
 */
export function buildExportWaterPlane({ size, seaLevel, name = 'Water' }) {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a4a6e,
    transparent: true,
    opacity: 0.75,
    roughness: 0.2,
    metalness: 0.1,
    name: 'WaterMaterial',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.y = seaLevel;
  return mesh;
}

export function buildWaterMetadata(params) {
  return {
    waterMode: params.waterMode,
    seaLevel: params.seaLevel,
    waterEnabled: params.waterEnabled,
    preset: params.waterQualityPreset,
  };
}
