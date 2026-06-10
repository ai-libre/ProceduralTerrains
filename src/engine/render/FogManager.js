import * as THREE from 'three';

// ============================================================================
// FogManager: centralized fog control for infinite mode. Computes fog density
// from terrain render distance and coordinates fog color across terrain,
// water, and sky materials.
// ============================================================================

export class FogManager {
  /**
   * @param {Object} terrainUniforms — shared terrain/water uniform objects
   * @param {THREE.Scene} scene
   */
  constructor(terrainUniforms, scene) {
    this.uniforms = terrainUniforms;
    this.scene = scene;

    // Fog parameters
    this.baseDensityFactor = 1.8;  // tuning constant for distance-based density
    this._fogColor = new THREE.Color();
  }

  /**
   * Compute fog density from the terrain render distance so far chunks
   * fade out smoothly toward the horizon.
   *
   * @param {number} viewRadius — chunk view radius
   * @param {number} chunkSize  — world units per chunk
   */
  updateFromViewDistance(viewRadius, chunkSize) {
    const maxDist = viewRadius * chunkSize;
    const density = this.baseDensityFactor / maxDist;
    this.uniforms.uFogDensity.value = density;
  }

  /**
   * Update fog color from TimeOfDay evaluation result.
   * Also updates the scene background to match.
   *
   * @param {Object} tod — result from evaluateTimeOfDay()
   */
  updateFromTimeOfDay(tod) {
    this._fogColor.setRGB(tod.fogColor[0], tod.fogColor[1], tod.fogColor[2]);
    this.uniforms.uFogColor.value.copy(this._fogColor);

    // Scene background matches fog for seamless horizon
    this.scene.background = this._fogColor.clone();
  }

  /**
   * Set fog color directly (for cases without TimeOfDay).
   * @param {number} r
   * @param {number} g
   * @param {number} b
   */
  setFogColor(r, g, b) {
    this._fogColor.setRGB(r, g, b);
    this.uniforms.uFogColor.value.copy(this._fogColor);
    this.scene.background = this._fogColor.clone();
  }

  /**
   * Set a density multiplier for quality presets.
   * Higher = more fog = cheaper (hides distant detail).
   * @param {number} factor — 1.0 is default, >1 = more fog, <1 = less fog
   */
  setDensityMultiplier(factor) {
    this.baseDensityFactor = 1.8 * factor;
  }
}
