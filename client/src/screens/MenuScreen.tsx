import { RadarLogo } from "../components/RadarLogo";
import { Icon, MuteButton, NeonButton, StatusPill } from "../components/ui";
import { ConnectionPill } from "../components/ConnectionPill";

interface Props {
  onCreate: () => void;
  onJoin: () => void;
  onCameraCheck: () => void;
  onHowToPlay: () => void;
}

export function MenuScreen({ onCreate, onJoin, onCameraCheck, onHowToPlay }: Props) {
  return (
    <div className="screen screen-enter menu" data-testid="menu">
      <header className="screen-header">
        <div className="header-slot" />
        <div className="header-slot header-slot-end">
          <MuteButton />
        </div>
      </header>
      <main className="menu-body">
        <div className="menu-hero">
          <RadarLogo size={132} />
          <h1 className="title-display title-sm">
            <span className="title-ar">AR</span> OBJECT HUNT
          </h1>
          <p className="tagline">2 players · 2 phones · 60 seconds</p>
        </div>
        <nav className="menu-actions" aria-label="Main menu">
          <NeonButton block icon={<Icon.Plus />} onClick={onCreate}>
            Create Game
          </NeonButton>
          <NeonButton block variant="secondary" icon={<Icon.Enter />} onClick={onJoin}>
            Join Game
          </NeonButton>
          <div className="menu-row">
            <NeonButton variant="ghost" icon={<Icon.Camera />} onClick={onCameraCheck}>
              Camera Check
            </NeonButton>
            <NeonButton variant="ghost" icon={<Icon.Help />} onClick={onHowToPlay}>
              How to Play
            </NeonButton>
          </div>
        </nav>
      </main>
      <footer className="menu-footer">
        <ConnectionPill />
        <StatusPill tone="idle">v0.1 · Phase 1</StatusPill>
      </footer>
    </div>
  );
}
