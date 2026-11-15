/**
 * The game is portrait-only. Browsers can't lock orientation outside fullscreen PWAs
 * (and never on iOS Safari), so on phones held in landscape we cover the UI with a
 * rotate prompt. Pure CSS media query — see .orientation-guard in global.css.
 */
export function OrientationGuard() {
  return (
    <div className="orientation-guard" role="alert" aria-live="polite">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <p>Rotate your phone to portrait</p>
    </div>
  );
}
