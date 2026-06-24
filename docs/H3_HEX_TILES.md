# Goal: Real H3 hexagons as the discrete tile base (all three modes)

## Objective
Use **Uber's H3** geospatial hexagonal grid (`h3-js`, the official binding) as the
base tiling for the world, rendered as **discrete hex tiles (board-game look)** —
each H3 cell is one flat-topped hex column whose **height + biome** come from the
existing **Noise Stack** layers, sampled at the cell center.

Target: **all three world modes** — Planet (sphere), Tile (flat board), Infinite World.

## Why this design fits the codebase
- Terrain is a deterministic pure function of position + the Noise Stack. The CPU
  samplers already evaluate that exact field:
  - `PlanetHeightSampler.heightAt3D(dir)` / biome — for the sphere (H3's natural home).
  - `TerrainHeightSampler.sampleSurfaceInfo(x, z)` — for the flat board / infinite plane.
- H3 cells map naturally to lat/lng → unit directions (planet) or projected XZ
  (board / infinite). So each cell's column gets a real, on-field height + color.
- The hex layer is an **additive, toggleable renderer**: when ON, hide the smooth
  terrain mesh and show merged hex-prism meshes. Existing modes keep working.

## Real H3
`git clone github.com/uber/h3*` is blocked by this session's egress policy (403 on
github.com). The npm registry is allowlisted, so we depend on the official
`h3-js@4.4.0` (WASM-backed) via `package.json` — the proper, updatable dependency.

## Modules
- `src/engine/h3/h3util.js`   — cell selection (planet global / planar patch) + lat-lng↔dir helpers.
- `src/engine/h3/HexTileMesh.js` — builds a merged, flat-shaded BufferGeometry of hex columns.
- `src/engine/h3/HexTileLayer.js` — manager: build/show/hide/dispose for a mode + sampler + palette.

## Phases (self-loop)
- [x] Phase 0  — Understand codebase; install `h3-js`; write this goal.
- [x] Phase 1  — Core: `h3util` + `HexTileMesh` + `HexTileLayer`; wire **Planet** mode behind a `hexTiles` toggle + `hexResolution`; UI toggle. Build green.
- [ ] Phase 2  — **Tile (flat board)** hex tiles (planar H3 patch → board XZ).
- [ ] Phase 3  — **Infinite World** hex tiles (camera-following H3 patch, streamed).
- [ ] Phase 4  — Biome coloring from the live palette + water (cells below sea level), sun-baked flat shading, polish.
- [ ] Phase 5  — Perf (LOD by H3 resolution / distance), verification, README/docs.

Each phase: implement → `npm run build` green → commit → push to `claude/h3-hexagons-tiles-87cp3l`.
