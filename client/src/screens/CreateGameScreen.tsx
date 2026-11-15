import { useState } from "react";
import { PLAYER_NAME_MAX } from "@aoh/shared";
import { Icon, NeonButton, ScreenShell } from "../components/ui";
import { ConnectionPill } from "../components/ConnectionPill";
import { useSettings } from "../game/settings";
import { useServer } from "../multiplayer/ServerProvider";
import { PhaseNotice } from "../components/PhaseNotice";

export function CreateGameScreen({ onBack }: { onBack: () => void }) {
  const { playerName, update } = useSettings();
  const { status } = useServer();
  const [name, setName] = useState(playerName);
  const [notice, setNotice] = useState(false);

  const submit = () => {
    update({ playerName: name.trim() });
    // Phase 2 replaces this with socket.emit("room:create") and navigation to the lobby.
    setNotice(true);
  };

  return (
    <ScreenShell
      title="Create Game"
      onBack={onBack}
      footer={
        <NeonButton block icon={<Icon.Plus />} disabled={status !== "online"} onClick={submit}>
          Create Room
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
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ul className="feature-list">
          <li><Icon.Target /> You get a 5-character room code and a QR invite.</li>
          <li><Icon.Bolt /> Works across different Wi-Fi and mobile networks.</li>
          <li><Icon.Shield /> Rooms are temporary and deleted after the match.</li>
        </ul>
      </section>
      <div className="center-row">
        <ConnectionPill />
      </div>
      {notice && <PhaseNotice onClose={() => setNotice(false)} />}
    </ScreenShell>
  );
}
