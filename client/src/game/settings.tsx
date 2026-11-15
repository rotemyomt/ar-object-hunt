import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { sound } from "../audio/sound";
import { setHapticsEnabled } from "../audio/haptics";

interface Settings {
  muted: boolean;
  haptics: boolean;
  /** Reduce analysis rate to save battery (used by the vision pipeline). */
  batterySaver: boolean;
  playerName: string;
}

interface SettingsContextValue extends Settings {
  update: (patch: Partial<Settings>) => void;
  toggleMute: () => void;
}

const KEY = "aoh.settings.v1";
const DEFAULTS: Settings = { muted: false, haptics: true, batterySaver: false, playerName: "" };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode / storage disabled — settings just won't persist */
    }
    sound.setMuted(settings.muted);
    setHapticsEnabled(settings.haptics);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const toggleMute = useCallback(() => setSettings((s) => ({ ...s, muted: !s.muted })), []);

  const value = useMemo(() => ({ ...settings, update, toggleMute }), [settings, update, toggleMute]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
