import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/orbitron/600.css";
import "@fontsource/orbitron/800.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./styles/global.css";
import { App } from "./App";
import { CameraProvider } from "./camera/CameraProvider";
import { ServerProvider } from "./multiplayer/ServerProvider";
import { RoomProvider } from "./multiplayer/RoomProvider";
import { SettingsProvider } from "./game/settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <ServerProvider>
        <CameraProvider>
          <RoomProvider>
            <App />
          </RoomProvider>
        </CameraProvider>
      </ServerProvider>
    </SettingsProvider>
  </StrictMode>,
);
