import type { ButtonHTMLAttributes, ReactNode } from "react";
import { sound, type SoundName } from "../audio/sound";
import { haptic } from "../audio/haptics";
import { useSettings } from "../game/settings";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface NeonButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  sfx?: SoundName | null;
  block?: boolean;
}

export function NeonButton({ variant = "primary", icon, sfx = "click", block, className, onClick, children, ...rest }: NeonButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${block ? " btn-block" : ""}${className ? ` ${className}` : ""}`}
      onClick={(e) => {
        if (sfx) sound.play(sfx);
        haptic("tap");
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <span className="btn-icon" aria-hidden>{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ label, onClick, children, sfx = "click" }: { label: string; onClick: () => void; children: ReactNode; sfx?: SoundName }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      onClick={() => {
        sound.play(sfx);
        haptic("tap");
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function MuteButton() {
  const { muted, toggleMute } = useSettings();
  return (
    <IconButton label={muted ? "Unmute sound" : "Mute sound"} onClick={toggleMute}>
      {muted ? <Icon.SoundOff /> : <Icon.SoundOn />}
    </IconButton>
  );
}

export function StatusPill({ tone, children, testId }: { tone: "ok" | "warn" | "bad" | "idle"; children: ReactNode; testId?: string }) {
  return (
    <span className={`pill pill-${tone}`} data-testid={testId}>
      <span className="pill-dot" aria-hidden />
      {children}
    </span>
  );
}

/** Standard screen frame: safe-area aware header (back · title · mute) and scrollable body. */
export function ScreenShell({
  title,
  onBack,
  children,
  footer,
  className,
}: {
  title?: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`screen screen-enter${className ? ` ${className}` : ""}`}>
      <header className="screen-header">
        <div className="header-slot">
          {onBack && (
            <IconButton label="Back" onClick={onBack} sfx="back">
              <Icon.Back />
            </IconButton>
          )}
        </div>
        {title && <h1 className="screen-title">{title}</h1>}
        <div className="header-slot header-slot-end">
          <MuteButton />
        </div>
      </header>
      <main className="screen-body">{children}</main>
      {footer && <footer className="screen-footer">{footer}</footer>}
    </div>
  );
}

const svg = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  Back: () => (<svg {...svg}><path d="M15 18l-6-6 6-6" /></svg>),
  SoundOn: () => (<svg {...svg}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" /></svg>),
  SoundOff: () => (<svg {...svg}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></svg>),
  Plus: () => (<svg {...svg}><path d="M12 5v14M5 12h14" /></svg>),
  Enter: () => (<svg {...svg}><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>),
  Camera: () => (<svg {...svg}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>),
  Flip: () => (<svg {...svg}><path d="M20 7h-4l-2-3h-4L8 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" /><path d="M9 13a3 3 0 015-2.2M15 13a3 3 0 01-5 2.2M14 9v2h-2M10 17v-2h2" /></svg>),
  Help: () => (<svg {...svg}><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" /></svg>),
  Shield: () => (<svg {...svg}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>),
  Bolt: () => (<svg {...svg}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>),
  Share: () => (<svg {...svg}><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v14" /></svg>),
  Target: () => (<svg {...svg}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>),
};
