import { NeonButton } from "./ui";

/**
 * Shown when an action belongs to a later build phase. Kept honest on purpose: this build
 * never pretends a room exists or that an opponent connected.
 */
export function PhaseNotice({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="phase-notice-title" onClick={onClose}>
      <div className="sheet card" onClick={(e) => e.stopPropagation()} data-testid="phase-notice">
        <h2 id="phase-notice-title">Multiplayer arrives in Phase 2</h2>
        <p>
          This build is the foundation: interface, camera, server connection and clock sync. Real rooms, joining and
          the lobby are implemented in the next phase.
        </p>
        <NeonButton block variant="secondary" onClick={onClose}>
          OK
        </NeonButton>
      </div>
    </div>
  );
}
