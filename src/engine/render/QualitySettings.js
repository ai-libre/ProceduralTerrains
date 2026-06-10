// ============================================================================
// QualitySettings: defines quality presets for infinite mode performance
// tuning. Each preset adjusts view distance, LOD quality, pixel ratio,
// chunk streaming rate, and fog density.
//
// Quality changes do NOT rebuild terrain geometry — they adjust view radius,
// LOD thresholds, throttle rates, and rendering parameters at runtime.
// ============================================================================

export const QUALITY_PRESETS = {
  performance: {
    label: 'Performance',
    viewRadius: 6,
    maxCreatesPerFrame: 4,
    pixelRatio: 0.75,
    fogDensityMultiplier: 0.9,
    // LOD: shift thresholds inward so chunks drop to lower LOD sooner
    lodMultiplier: 0.5,           // LOD0 only very close, most chunks at LOD2-3
  },
  balanced: {
    label: 'Balanced',
    viewRadius: 10,
    maxCreatesPerFrame: 6,
    pixelRatio: 1.0,
    fogDensityMultiplier: 0.7,
    lodMultiplier: 0.75,          // moderate LOD distances
  },
  high: {
    label: 'High',
    viewRadius: 12,
    maxCreatesPerFrame: 8,
    pixelRatio: 0,                // 0 = auto (device pixel ratio)
    fogDensityMultiplier: 0.6,
    lodMultiplier: 1.0,           // default LOD thresholds
  },
  ultra: {
    label: 'Ultra',
    viewRadius: 16,
    maxCreatesPerFrame: 12,
    pixelRatio: 0,                // 0 = auto
    fogDensityMultiplier: 0.5,
    lodMultiplier: 1.4,           // keep high-detail LOD much farther out
  },
};

/**
 * Get the settings object for a quality preset key.
 * @param {string} key — one of 'performance', 'balanced', 'high', 'ultra'
 * @returns {Object} — the preset settings, or balanced if key is invalid
 */
export function getQualitySettings(key) {
  return QUALITY_PRESETS[key] || QUALITY_PRESETS.balanced;
}

/**
 * Get ordered list of quality preset keys for UI dropdowns.
 */
export function getQualityKeys() {
  return ['performance', 'balanced', 'high', 'ultra'];
}
