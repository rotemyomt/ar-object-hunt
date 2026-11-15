import { useRef, useState } from "react";
import { PLAYER_NAME_MAX, ROOM_CODE_LENGTH, isValidRoomCode, normalizeRoomCode } from "@aoh/shared";
import { Icon, NeonButton, ScreenShell } from "../components/ui";
import { ConnectionPill } from "../components/ConnectionPill";
import { PhaseNotice } from "../components/PhaseNotice";
import { useSettings } from "../game/settings";
import { useServer } from "../multiplayer/ServerProvider";

export function JoinGameScreen({ onBack, initialCode }: { onBack: () => void; initialCode?: string }) {
  const { playerName, update } = useSettings();
  const { status } = useServer();
  const [name, setName] = useState(playerName);
  const [code, setCode] = useState(initialCode ?? "");
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const valid = isValidRoomCode(code);
  const showError = touched && code.length === ROOM_CODE_LENGTH && !valid;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    update({ playerName: name.trim() });
    // Phase 2 replaces this with socket.emit("room:join") and navigation to the lobby.
    setNotice(true);
  };

  return (
    <ScreenShell
      title="Join Game"
      onBack={onBack}
      footer={
        <NeonButton block variant="secondary" icon={<Icon.Enter />} disabled={!valid || status !== "online"} onClick={submit}>
          Join Room
        </NeonButton>
      }
    >
      <section className="card form-card">
        <span className="field-label" id="code-label">Room code</span>
        <div className="code-input" onClick={() => inputRef.current?.focus()}>
          {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
            <span key={i} className={`code-cell${i === code.length ? " active" : ""}${code[i] ? " filled" : ""}${showError ? " invalid" : ""}`}>
              {code[i] ?? ""}
            </span>
          ))}
          <input
            ref={inputRef}
            className="code-input-native"
            aria-labelledby="code-label"
            data-testid="room-code-input"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH + 4}
            onChange={(e) => {
              setCode(normalizeRoomCode(e.target.value));
              setTouched(true);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <p className={`field-hint${showError ? " error" : ""}`} role={showError ? "alert" : undefined}>
          {showError ? "That code isn’t valid — codes never use zero, the letter O, one, I or L." : "Ask the host for the code on their screen, or scan their QR invite with your camera app."}
        </p>
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={PLAYER_NAME_MAX}
            placeholder="Player 2"
            autoComplete="nickname"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </section>
      <div className="center-row">
        <ConnectionPill />
      </div>
      {notice && <PhaseNotice onClose={() => setNotice(false)} />}
    </ScreenShell>
  );
}
