/** AR scanning reticle drawn over the camera feed. `state` drives colour/animation. */
export function Reticle({ state = "scanning" }: { state?: "scanning" | "locked" | "idle" }) {
  return (
    <div className={`reticle reticle-${state}`} aria-hidden>
      <svg viewBox="0 0 240 240">
        <g fill="none" strokeWidth="4" strokeLinecap="round">
          <path d="M20 70V20h50M170 20h50v50M220 170v50h-50M70 220H20v-50" />
        </g>
        <circle className="reticle-ring" cx="120" cy="120" r="56" fill="none" strokeWidth="1.5" strokeDasharray="6 10" />
        <path d="M120 106v-10M120 134v10M106 120h-10M134 120h10" strokeWidth="2" strokeLinecap="round" />
        <circle cx="120" cy="120" r="3" />
      </svg>
      <div className="reticle-scanline" />
    </div>
  );
}
