import { useEffect, useState } from "react";
import { RadarLogo } from "../components/RadarLogo";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

/**
 * First screen. Waits for fonts (so the title never flashes in a fallback font), then asks
 * for a tap — that tap is the user gesture that unlocks audio on iOS/Android.
 */
export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const minDelay = new Promise((r) => setTimeout(r, 1200));
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void Promise.all([minDelay, fonts]).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const go = () => {
    if (!ready) return;
    sound.unlock();
    sound.play("join");
    haptic("tap");
    onContinue();
  };

  return (
    <div
      className="screen splash"
      role="button"
      tabIndex={0}
      aria-label="Tap to start"
      onClick={go}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go()}
      data-testid="splash"
    >
      <div className="splash-center">
        <RadarLogo size={200} />
        <h1 className="title-display">
          <span className="title-ar">AR</span> OBJECT HUNT
        </h1>
        <p className="tagline">Hide it. Hunt it. Beat the sweep.</p>
      </div>
      <div className="splash-bottom">
        {ready ? (
          <span className="tap-to-start">TAP TO START</span>
        ) : (
          <div className="loading-bar" aria-label="Loading">
            <div className="loading-bar-fill" />
          </div>
        )}
      </div>
    </div>
  );
}
