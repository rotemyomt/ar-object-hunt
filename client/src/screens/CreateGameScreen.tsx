import { useState } from "react";
import { PLAYER_NAME_MAX } from "@aoh/shared";
import { Icon, NeonButton, ScreenShell } from "../components/ui";
import { ConnectionPill } from "../components/ConnectionPill";
import { useSettings } from "../game/settings";
import { useServer } from "../multiplayer/ServerProvider";
import { useRoom } from "../multiplayer/RoomProvider";
import { sound } from "../audio/sound";
import { haptic } from "../audio/haptics";

export function CreateGameScreen({ onBack }: { onBack: () => void }) {
  const { playerName, update } = useSettings();
  const { status } = useServer();
  const { create } = useRoom();
  const [name, setName] = useState(playerName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    update({ playerName: name.trim() });
    const r = await create(name.trim());
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      sound.play("error");
      haptic("error");
    }
    // On success the app switches to the lobby automatically.
  };

  return (
    <ScreenShell
      title="Create Game"
      onBack={onBack}
      footer={
        <NeonButton block icon={<Icon.Plus />} disabled={status !== "online" || busy} onClick={() => void submit()} data-testid="create-room">
          {busy ? "Creating…" : "Create Room"}
        </NeonButton>
      }
    >
      <section className="card form-card">
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            placeholder="Player 1"
            autoComplete="nickname"
            enterKeyHint="go"
            data-testid="player-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </label>
        <ul className="feature-list">
          <li><Icon.Target /> You get a 5-character room code and a QR invite.</li>
          <li><Icon.Bolt /> Works across different Wi-Fi and mobile networks.</li>
          <li><Icon.Shield /> Rooms are temporary and deleted after the match.</li>
        </ul>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="center-row">
        <ConnectionPill />
      </div>
    </ScreenShell>
  );
}
