import { registerSW } from "virtual:pwa-register";

/**
 * Service-worker updates. A new version is installed in the background whenever the site
 * changes; we apply it right away (reload) — EXCEPT during a live match, where a reload
 * would interrupt play. Updates are checked on launch, whenever the app comes back to the
 * foreground, and hourly, so phones never stay on an old version.
 */
let busy = false;
let pending: (() => Promise<void>) | null = null;

export function setUpdateBlocked(isBusy: boolean) {
  busy = isBusy;
  if (!busy && pending) void pending();
}

export function startPwa() {
  if (!("serviceWorker" in navigator)) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = () => updateSW(true);
      if (!busy) void pending();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) void reg.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
      setInterval(check, 60 * 60 * 1000);
    },
  });
}
