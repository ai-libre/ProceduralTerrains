import { APP_NAME, APP_VERSION } from '../constants/app.js';

export function randomSessionSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function Logo({ size = 40, className = '' }) {
  return (
    <svg
      className={`landing-logo ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 18 L9 7 L13 13 L16 9 L21 18 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="5.5" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function LandingVersionTile() {
  return (
    <div className="landing-stat-tile landing-stat-version" title={APP_NAME}>
      <span className="landing-stat-label">Version</span>
      <span className="landing-stat-value">v{APP_VERSION}</span>
    </div>
  );
}

export function LandingSeedTile({ seed }) {
  if (seed == null) return null;
  return (
    <div className="landing-stat-tile landing-stat-seed" title="Session seed">
      <span className="landing-stat-label">Seed</span>
      <span className="landing-stat-value">{seed}</span>
    </div>
  );
}

export const FEATURES = [
  { title: '100% GPU', desc: 'Height, normals and biomes computed in shaders — no CPU heightmap.' },
  { title: 'Deterministic', desc: 'Same seed and params produce the same terrain every time.' },
  { title: 'Live editing', desc: 'Every slider updates shader uniforms in real time.' },
  { title: 'Exports', desc: 'PNG screenshots and orthographic heightmaps from the same shader.' },
];

export const MODES = [
  { id: 'studio', name: 'Tile', desc: 'Fixed board with per-chunk LOD — ideal for painting and exporting.' },
  { id: 'infinite', name: 'Infinite World', desc: 'Streamed infinite world with FPS exploration.' },
  { id: 'planet', name: 'Planet', desc: 'Procedural sphere with atmosphere, clouds and orbit camera.' },
];
