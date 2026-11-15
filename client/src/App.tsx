import { useCallback, useEffect, useReducer } from "react";
import { currentScreen, navReducer, roomCodeFromLocation, type Screen } from "./game/navigation";
import { useCamera } from "./camera/CameraProvider";
import { SplashScreen } from "./screens/SplashScreen";
import { MenuScreen } from "./screens/MenuScreen";
import { HowToPlayScreen } from "./screens/HowToPlayScreen";
import { CreateGameScreen } from "./screens/CreateGameScreen";
import { JoinGameScreen } from "./screens/JoinGameScreen";
import { CameraPermissionScreen } from "./screens/CameraPermissionScreen";
import { CameraCheckScreen } from "./screens/CameraCheckScreen";
import { OrientationGuard } from "./components/OrientationGuard";
import { LobbyScreen } from "./screens/LobbyScreen";
import { RoomOverlays } from "./components/RoomOverlays";
import { useRoom } from "./multiplayer/RoomProvider";

const inviteCode = typeof window !== "undefined" ? roomCodeFromLocation(window.location, import.meta.env.BASE_URL) : null;

export function App() {
  const [nav, dispatch] = useReducer(navReducer, { stack: [{ name: "splash" }] });
  const screen = currentScreen(nav);
  const { permission, status: cameraStatus } = useCamera();
  const room = useRoom();
  const inRoom = room.state !== null;

  // The room drives navigation: entering a room shows the lobby, leaving returns to the menu.
  useEffect(() => {
    if (screen.name === "splash") return; // let the player tap through first (unlocks audio)
    const roomScreens = ["lobby", "camera-permission", "camera-check"];
    if (inRoom && !roomScreens.includes(screen.name)) dispatch({ type: "go", to: { name: "lobby" } });
    if (!inRoom && screen.name === "lobby") dispatch({ type: "go", to: { name: "menu" } });
  }, [inRoom, screen.name]);

  const go = useCallback((to: Screen) => dispatch({ type: "go", to }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);

  /** Route through the permission screen only when the camera isn't already usable. */
  const withCamera = useCallback(
    (then: Screen) => {
      if (permission === "granted" || cameraStatus === "live") go(then);
      else go({ name: "camera-permission", then });
    },
    [permission, cameraStatus, go],
  );

  // Undo any scroll the mobile keyboard left behind when the screen changes.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>(".app, .screen-host").forEach((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
  }, [nav.stack.length, screen.name]);

  // Android hardware/gesture back → in-app back instead of leaving the game.
  useEffect(() => {
    history.replaceState({ aoh: true }, "");
    history.pushState({ aoh: true }, "");
    const onPop = () => {
      dispatch({ type: "back" });
      history.pushState({ aoh: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  let content: JSX.Element;
  switch (screen.name) {
    case "splash":
      content = (
        <SplashScreen
          onContinue={() => {
            go({ name: "menu" });
            if (inviteCode) go({ name: "join", code: inviteCode });
          }}
        />
      );
      break;
    case "menu":
      content = (
        <MenuScreen
          onCreate={() => go({ name: "create" })}
          onJoin={() => go({ name: "join" })}
          onCameraCheck={() => withCamera({ name: "camera-check" })}
          onHowToPlay={() => go({ name: "how-to-play" })}
        />
      );
      break;
    case "how-to-play":
      content = <HowToPlayScreen onBack={back} />;
      break;
    case "create":
      content = <CreateGameScreen onBack={back} />;
      break;
    case "join":
      content = <JoinGameScreen onBack={back} initialCode={screen.code} />;
      break;
    case "camera-permission": {
      const then = screen.then;
      content = (
        <CameraPermissionScreen
          onBack={back}
          onGranted={() => {
            back();
            go(then);
          }}
        />
      );
      break;
    }
    case "camera-check":
      content = <CameraCheckScreen onBack={back} />;
      break;
    case "lobby":
      content = inRoom ? <LobbyScreen onCameraSetup={() => go({ name: "camera-permission", then: { name: "lobby" } })} /> : <></>;
      break;
  }

  return (
    <div className="app">
      <div className="bg-grid" aria-hidden />
      {/* key forces the enter animation on every navigation */}
      <div className="screen-host" key={`${nav.stack.length}:${screen.name}`}>
        {content}
      </div>
      <RoomOverlays />
      <OrientationGuard />
    </div>
  );
}
