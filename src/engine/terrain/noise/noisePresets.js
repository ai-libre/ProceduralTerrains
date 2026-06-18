// ============================================================================
// Built-in Noise Stack presets. Each is just a NoiseStack the user can apply
// and then freely edit — NOT a locked terrain style. The default (Classic
// Terrain) lives in NoiseStack.defaultLegacyStack().
// ============================================================================

import { makeStack, makeLayer } from './NoiseStack.js';

const L = (type, over) => makeLayer(type, over);

export const NOISE_STACK_PRESETS = {
  classic: {
    label: 'Classic Terrain',
    build: () => makeStack([L('legacy', { name: 'Classic Terrain', blendMode: 'replace' })]),
  },
  rollingHills: {
    label: 'Rolling Hills',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.5, params: { scale: 1.0, octaves: 4, persistence: 0.5 } }),
      L('billow', { name: 'Soft Hills', blendMode: 'add', strength: 0.25, params: { scale: 2.2, octaves: 3 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.06, params: { scale: 6.0, octaves: 3 } }),
    ]),
  },
  sharpMountains: {
    label: 'Sharp Mountains',
    build: () => makeStack([
      L('fbm', { name: 'Continents', blendMode: 'add', strength: 0.45, params: { scale: 0.6, octaves: 4 } }),
      L('domainWarp', { name: 'Breakup Warp', blendMode: 'add', strength: 0.6, params: { scale: 1.2 } }),
      L('ridged', { name: 'Mountain Ridges', blendMode: 'add', strength: 0.9, params: { scale: 2.4, octaves: 5, sharpness: 2.5 } }),
      L('fbm', { name: 'Small Details', blendMode: 'add', strength: 0.05, params: { scale: 8.0, octaves: 3 } }),
    ]),
  },
  canyonTerraces: {
    label: 'Canyon Terraces',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.5, params: { scale: 0.8, octaves: 4 } }),
      L('ridged', { name: 'Mesa Edges', blendMode: 'add', strength: 0.35, params: { scale: 2.0, octaves: 4, sharpness: 3.0 } }),
      L('terrace', { name: 'Strata', blendMode: 'replace', strength: 0.9, params: { count: 14, smoothness: 0.35 } }),
    ]),
  },
  desertDunes: {
    label: 'Desert Dunes',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.3, params: { scale: 0.6, octaves: 3 } }),
      L('dune', { name: 'Dunes', blendMode: 'add', strength: 0.35, params: { scale: 1.4 } }),
      L('white', { name: 'Grain', blendMode: 'add', strength: 0.02, params: { scale: 10.0 } }),
    ]),
  },
  moonCraters: {
    label: 'Moon Craters',
    build: () => makeStack([
      L('fbm', { name: 'Regolith', blendMode: 'add', strength: 0.25, params: { scale: 1.2, octaves: 4 } }),
      L('crater', { name: 'Large Craters', blendMode: 'add', strength: 0.7, params: { scale: 1.0, density: 0.5, depth: 0.7, rim: 0.35 } }),
      L('crater', { name: 'Small Craters', blendMode: 'add', strength: 0.35, params: { scale: 3.5, density: 0.4, depth: 0.4, rim: 0.2 } }),
    ]),
  },
  alienCellular: {
    label: 'Alien Cellular',
    build: () => makeStack([
      L('fbm', { name: 'Base', blendMode: 'add', strength: 0.3, params: { scale: 0.8, octaves: 3 } }),
      L('voronoi', { name: 'Plates', blendMode: 'add', strength: 0.5, params: { scale: 1.8, jitter: 1.0, outputMode: 3 } }),
      L('domainWarp', { name: 'Twist', blendMode: 'add', strength: 0.8, params: { scale: 1.5 } }),
    ]),
  },
  islandContinents: {
    label: 'Island Continents',
    build: () => makeStack([
      L('fbm', { name: 'Continents', blendMode: 'add', strength: 0.7, params: { scale: 0.4, octaves: 5 } }),
      L('billow', { name: 'Coastal Hills', blendMode: 'add', strength: 0.15, params: { scale: 2.0, octaves: 3 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.05, params: { scale: 7.0, octaves: 3 } }),
    ]),
  },
  erodedValleys: {
    label: 'Eroded Valleys',
    build: () => makeStack([
      L('ridged', { name: 'Highlands', blendMode: 'add', strength: 0.7, params: { scale: 1.4, octaves: 5, sharpness: 1.8 } }),
      L('flow', { name: 'River Carving', blendMode: 'subtract', strength: 0.4, params: { scale: 0.8 } }),
      L('fbm', { name: 'Detail', blendMode: 'add', strength: 0.06, params: { scale: 8.0, octaves: 3 } }),
    ]),
  },
};

export const NOISE_STACK_PRESET_KEYS = Object.keys(NOISE_STACK_PRESETS);

export function buildNoiseStackPreset(key) {
  const p = NOISE_STACK_PRESETS[key];
  return p ? p.build() : null;
}
