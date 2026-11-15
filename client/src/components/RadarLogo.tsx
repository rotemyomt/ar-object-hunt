/** Animated radar emblem used on the splash and menu. Pure SVG + CSS animation. */
export function RadarLogo({ size = 180 }: { size?: number }) {
  return (
    <div className="radar-logo" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <radialGradient id="rl-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0a2a3a" />
            <stop offset="100%" stopColor="#04060c" />
          </radialGradient>
          <linearGradient id="rl-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#rl-bg)" stroke="#00e5ff" strokeOpacity="0.5" strokeWidth="2" />
        {[72, 48, 24].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#00e5ff" strokeOpacity="0.22" strokeWidth="1.5" />
        ))}
        <path d="M100 4v192M4 100h192" stroke="#00e5ff" strokeOpacity="0.15" strokeWidth="1" />
        <g className="radar-logo-sweep">
          <path d="M100 100 L100 4 A96 96 0 0 1 183 52 Z" fill="url(#rl-sweep)" />
          <line x1="100" y1="100" x2="100" y2="4" stroke="#7df9ff" strokeWidth="2.5" />
        </g>
        <circle className="radar-blip" cx="138" cy="64" r="5" fill="#ff3dcb" />
        <circle cx="100" cy="100" r="5" fill="#7df9ff" />
      </svg>
    </div>
  );
}
