import { NeonButton, ScreenShell } from "../components/ui";
import { MATCH_DURATION_MS } from "@aoh/shared";

const STEPS: Array<{ title: string; body: string }> = [
  { title: "Pair up", body: "One player creates a game and shares the room code. The other joins from their own phone — any network works." },
  { title: "Register your object", body: "Each player scans a physical object (bottle, cup, book, toy…) from a few angles so the game learns that exact object." },
  { title: "Get ready", body: "When both objects are registered, both tap “I’m Ready”. A synced 3 — 2 — 1 — GO! starts on both phones." },
  { title: "Hide & hunt", body: `Hide your object on your body. Move around your opponent and get their object in your camera. You have ${MATCH_DURATION_MS / 1000} seconds.` },
  { title: "Beat the sweep", body: "A radar sweep slowly blacks out your screen. Only what you can still see counts — be fast." },
  { title: "Win", body: "The first phone to recognise the opponent’s object wins instantly. If nobody does, you both lose." },
];

export function HowToPlayScreen({ onBack }: { onBack: () => void }) {
  return (
    <ScreenShell title="How to Play" onBack={onBack} footer={<NeonButton block onClick={onBack}>Got it</NeonButton>}>
      <ol className="howto">
        {STEPS.map((s, i) => (
          <li key={s.title} className="howto-step card" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="howto-num">{i + 1}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="fineprint">
        Fair play: you can never win by scanning your own object, and detections hidden behind the sweep don’t count.
      </p>
    </ScreenShell>
  );
}
