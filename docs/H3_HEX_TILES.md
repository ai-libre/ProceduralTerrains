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
- [x] Phase 2  — **Tile (flat board)** hex tiles (planar H3 patch → board XZ).
- [x] Phase 3  — **Infinite World** hex tiles (camera-following H3 disk patch, rebuilt on center-cell change).
- [x] Phase 4  — Biome coloring from the real climate classifier + water, beach band + snow caps. Verified: board now shows distinct desert/canyon/forest/water; planet shows the full biome range instead of washing to sand.
- [x] Phase 5  — Verification harness (`tools/h3verify.mjs`), perf timing, README docs.

## Verification & perf (tools/h3verify.mjs — all checks pass)
Geometry validity (finite positions, colors in range, watertight tri counts),
cell counts, and the signature-guard (identical inputs → no rebuild) all pass.
Build time / triangles (one merged mesh = one draw call), single-threaded JS:

| Mode | res 0 | res 1 (default) | res 2 (heavy) |
|---|---|---|---|
| Planet | 122 cells · ~42ms · 2.2k tris | 842 · ~98ms · 16k | 5,882 · ~408ms · 106k |
| Board  | 336 · ~56ms · 6.2k | 2,312 · ~145ms · 42k | 16,186 · ~743ms · 293k |
| Infinite | 331 · ~29ms · 6k | 631 · ~25ms · 11k | 1,027 · ~45ms · 18k |

Builds are one-time (signature-guarded), not per-frame; res 2 is flagged "heavy"
in the UI. Possible future work: off-thread build for the heavy resolutions,
distance-based LOD between H3 resolutions, and a loading overlay on toggle.

## Objective feedback loop
`tools/h3harness.mjs` drives the REAL engine modules (f32-exact CPU samplers +
real H3 helpers + production `colorForHeight`) and rasterizes board / planet /
infinite views to `.claude/shots/h3-*.png` with per-view stats — used to SEE
and iterate, since no WebGL/browser is available in this environment.
Run: `node tools/h3harness.mjs`.

### Grounded findings
- Phases 1–3 render correctly (even hex tiling on sphere, board, and an
  infinite disk patch around the camera). Verified by image inspection.
- **Color bands wash out**: `colorForHeight` maps against a fixed ceiling
  `1.35*heightScale`, but real terrain reaches only ~10–45% of it, so the
  forest/rock/snow bands rarely appear (board ≈ sand+grass; planet biased low).
  → Phase 4: color from the sampler's real biome/climate classifier (+ a height
  tint) so hex tiles match the smooth terrain's biomes.

Each phase: implement → `npm run build` green → commit → push to `claude/h3-hexagons-tiles-87cp3l`.
