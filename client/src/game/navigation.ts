import { isValidRoomCode, normalizeRoomCode } from "@aoh/shared";

/**
 * App-level screen state. Phase 2 adds lobby/registration/ready screens; Phase 4 adds
 * countdown/gameplay/result screens — each as a new variant here.
 */
export type Screen =
  | { name: "splash" }
  | { name: "menu" }
  | { name: "how-to-play" }
  | { name: "create" }
  | { name: "join"; code?: string }
  | { name: "camera-permission"; then: Screen }
  | { name: "camera-check" };

export type NavAction = { type: "go"; to: Screen } | { type: "back" };

export interface NavState {
  stack: Screen[];
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "go":
      // Menu is a root: going to it clears history so Back never returns into a stale flow.
      if (action.to.name === "menu") return { stack: [action.to] };
      return { stack: [...state.stack, action.to] };
    case "back":
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
  }
}

export function currentScreen(state: NavState): Screen {
  return state.stack[state.stack.length - 1] ?? { name: "menu" };
}

/**
 * Invitation links look like https://host/<base>/join/ABCDE (or ?room=ABCDE).
 * `base` is the deploy sub-path (e.g. "/ar-object-hunt/" on GitHub Pages).
 */
export function roomCodeFromLocation(loc: Pick<Location, "pathname" | "search">, base = "/"): string | null {
  const path = base !== "/" && loc.pathname.startsWith(base) ? `/${loc.pathname.slice(base.length)}` : loc.pathname;
  const fromPath = /^\/join\/([^/]+)\/?$/i.exec(path)?.[1];
  const fromQuery = new URLSearchParams(loc.search).get("room");
  const raw = fromPath ?? fromQuery;
  if (!raw) return null;
  const code = normalizeRoomCode(decodeURIComponent(raw));
  return isValidRoomCode(code) ? code : null;
}
