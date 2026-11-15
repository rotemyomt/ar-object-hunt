# AR Object Hunt

Real-time two-player AR hide-and-seek for phones. Each player registers a physical object, hides it, and hunts for the opponent's object with their camera while a radar sweep blacks out the screen. The first phone to recognise the opponent's object wins.

> **Build status: Phases 1–2 of 7 complete.**
> Live: **https://rotemyomt.github.io/ar-object-hunt/**
> Working now: mobile UI, live camera pipeline, PWA, the server clock, and **real multiplayer**: create a room, join by code, QR or invite link, a live lobby on both phones, reconnection, and ready-state sync.
> Next: object scanning and recognition (Phase 3), countdown and gameplay screens (Phase 4), the sweep (Phase 5), polish (Phase 6) and launch hardening (Phase 7).
> Until Phase 3, "Scan My Object" is visibly disabled, so the ready step can't be reached from the UI yet. The server side of readiness is complete and tested.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Client | React 18 + TypeScript + Vite | Fast mobile builds, typed end to end |
| Camera | `getUserMedia` (WebRTC media capture) | Works in iOS Safari 14.3+, Android Chrome and Samsung Internet. Not WebXR, which iOS lacks |
| Vision | On-device, in the browser (Phase 3: TensorFlow.js COCO-SSD + MobileNet embeddings) | No video is ever uploaded |
| Realtime | Socket.IO 4 (WebSocket with long-polling fallback) | Works across different Wi-Fi and cellular networks, with reconnection and recovery |
| Server | Node 20 + Express + Socket.IO | Server-authoritative match state |
| PWA | vite-plugin-pwa (Workbox) | Install to home screen, fullscreen, offline shell |

## Project structure

```
ar-object-hunt/
├─ shared/src/            # Single source of truth used by client AND server
│  ├─ constants.ts        # 60 s match, 3 s countdown, room-code alphabet…
│  ├─ types.ts            # RoomState, PlayerState, MatchOutcome
│  ├─ protocol.ts         # Typed Socket.IO event contract
│  ├─ roomCode.ts         # Generate / normalise / validate room codes
│  ├─ timeSync.ts         # Server-clock offset estimation
│  └─ obstruction.ts      # Sweep geometry: equal-AREA coverage + visibility mask
├─ server/src/
│  ├─ app.ts              # Express: health check, security headers, static client
│  ├─ networking/socket.ts# Socket.IO events → RoomManager, per-event rate limits
│  ├─ rooms/RoomManager.ts# Server-authoritative room & match state machine
│  ├─ validation/         # Payload validation, rate limiter
│  └─ index.ts
├─ client/
│  ├─ public/icons/       # PWA icons (regenerate: npm run icons)
│  └─ src/
│     ├─ camera/          # CameraProvider, CameraView, FrameSampler, geometry, errors
│     ├─ vision/          # frameQuality (Phase 3 adds detector + matcher)
│     ├─ multiplayer/     # ServerProvider (socket + clock), RoomProvider (session, resume)
│     ├─ game/            # navigation, settings
│     ├─ audio/           # synthesized SFX (Web Audio), haptics
│     ├─ components/      # UI kit, radar logo, reticle…
│     ├─ screens/         # Splash, Menu, HowToPlay, Create, Join, Lobby, CameraPermission, CameraCheck
│     └─ styles/global.css
├─ tests/e2e/             # Playwright: real browser, fake camera device
├─ playwright.config.ts
└─ .env.example
```

## What Phase 2 delivers (multiplayer)

- **Rooms:** "Create Game" gets a 5-character code from the server. Codes avoid 0/O/1/I/L so they're easy to read aloud. Players join by code, by scanning the QR shown in the lobby, or with an invite link (`…/join/CODE`, shared through the phone's share sheet).
- **Live lobby on both phones:** each player's name, connection, camera permission, object registration and ready state, all updated in real time.
- **Membership is authenticated:** joining issues a secret session token. Every room event is checked against the socket's membership, and nobody can act for a seat they don't hold.
- **Reconnection:** if a phone reloads, switches networks or briefly loses signal, it rejoins its seat automatically using the token saved in the tab. The other phone sees "Reconnecting…" meanwhile, and a full-screen overlay explains what's happening.
- **Readiness (server side complete):** once both objects are registered, both players press "I'm Ready". The server then fixes one official timeline (`countdownStartsAt`, `matchStartsAt`, `matchEndsAt`) and runs countdown → playing → finished on its own clock. Each phone privately receives its opponent's object signature as its target. Signatures are never broadcast or included in room state.
- **Fairness rules enforced on the server:** a match ends exactly once, and late timers or duplicate events can't overwrite the result. Leaving or disconnecting for more than 15 s during a match forfeits. Registering a new object resets both players' readiness. Rematch starts a new round.
- **Abuse protection:** validated payloads (name, code, signature length and finite numbers), per-event rate limits, capped message size, and empty or idle rooms deleted automatically.

## What Phase 1 delivers

- **Screens:** Splash (tap to unlock audio), Main Menu, How to Play, Create Game, Join Game (5-box code entry and `/join/CODE` invite links), Camera Permission, and Camera Check (live).
- **Camera:** rear camera by default with ~720p/30 fps `ideal` constraints and a relaxed fallback for older Android phones. Errors come with steps for each platform (iOS, Android, Samsung). The camera is released when the app is backgrounded and resumes when you return. It is also turned off whenever no screen needs it.
- **Frame pipeline (`FrameSampler`):** crops each frame to exactly what is on screen (the `object-fit: cover` region), downscales it to 320 px, and runs at an adjustable rate (10 fps, or 4 fps in battery saver). It never overlaps work and idles while the app is hidden. Phase 3 plugs the detector into this. Camera Check shows the analysis frame live, along with real brightness and sharpness measurements.
- **Server clock sync:** an NTP-style 8-sample estimate, refreshed every 30 s. `serverNow()` is what the countdown, timer and sweep will use, so both phones run on the same clock.
- **Sweep geometry (built early because it drives fairness):** on a tall phone screen, equal sweep angles don't cover equal areas. `angleForCoveredFraction` solves for the angle so that 25/50/75/100% coverage at 15/30/45/60 s is exact by area. `visibleFractionOfBox` will be used to reject detections behind the sweep.
- **PWA:** manifest, maskable icons, service worker, fullscreen portrait, notch/safe-area support, and a rotate-to-portrait prompt.
- **Security baseline:** `Permissions-Policy: camera=(self)`, HSTS in production, nosniff, no-referrer, frame-deny, rate-limited socket events, 64 KB socket payload cap. There are no secrets in the frontend.

---

## Running it

### Requirements
- Node.js 20+ and npm 10+
- Two phones and a computer on the same Wi-Fi (for local testing), or a deployed HTTPS URL

### Install
```bash
cd ar-object-hunt
npm install
cp .env.example .env      # optional; defaults work
```

### Local development
```bash
npm run dev
```
This starts the server on `:3001` and the Vite dev server on **https://localhost:5173**, which proxies `/socket.io` and `/api` to the server.

The dev server uses a self-signed HTTPS certificate on purpose: **phones only allow camera access on HTTPS**.

### Open it on a phone (same Wi-Fi)
1. Find your computer's LAN IP. On macOS run `ipconfig getifaddr en0`; on Windows run `ipconfig`; on Linux run `hostname -I`. Vite also prints it as "Network: https://192.168.x.x:5173".
2. On the phone, open `https://<that-IP>:5173`.
3. Accept the certificate warning:
   - **iPhone (Safari):** tap *Show Details* → *visit this website* → *Visit Website*.
   - **Android (Chrome / Samsung Internet):** tap *Advanced* → *Proceed to … (unsafe)*.
4. Tap the splash, then go to **Camera Check** and allow the camera.

If the certificate warning is a problem (some corporate networks block it), use a tunnel that gives you real HTTPS instead, e.g. `npx cloudflared tunnel --url https://localhost:5173 --no-tls-verify`, and open the `https://…trycloudflare.com` URL it prints. A tunnel also lets a phone on cellular data reach your laptop.

### Install as an app (PWA)
- **iPhone:** in Safari, tap Share → *Add to Home Screen*.
- **Android:** in Chrome, open the ⋮ menu → *Install app* (or *Add to Home screen*).

### Hosting with no computer (current setup)

- **Client → GitHub Pages.** `.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`. One-time setup: Settings → Pages → Source: GitHub Actions.
- **Game server → Render (free).** Render → New → Blueprint → choose this repo; `render.yaml` does the rest. Copy the service URL (e.g. `https://ar-object-hunt-server.onrender.com`).
- **Connect them:** in GitHub go to Settings → Secrets and variables → Actions → Variables, and add `VITE_SERVER_URL` with that URL. Then re-run the Pages workflow. The server only accepts browsers from the origins in `CORS_ORIGINS`.
- **Free-plan caveat:** the server sleeps after about 15 minutes of no use. The first player to open the game wakes it, which takes up to a minute, and the app shows "Waking up server…" meanwhile.

### Production build
```bash
npm run build        # builds client → client/dist, server → server/dist
npm start            # NODE_ENV must be production to serve the client:
NODE_ENV=production PORT=3001 npm start
```
In production the Node server serves the built client and Socket.IO from one origin (no CORS needed). Put it behind any HTTPS-terminating host. **WebSockets must be enabled**, and **run a single instance**, because room state lives in memory. Full deployment recipes (Render, Fly.io, a VPS with Caddy) come in Phase 7.

---

## Tests

```bash
npm run typecheck    # all three packages
npm test             # unit + integration: shared (11), server (33), client (8)
npm run build && npm run test:e2e   # 9 end-to-end tests in real browsers (incl. two-phone sessions)
```
E2E tests need a Chromium browser. Run `npx playwright install chromium` once, or point at an installed Chrome with `CHROME_PATH=/path/to/chrome`. Set `E2E_SCREENSHOTS=/some/dir` to save screenshots of each screen.

What is covered automatically today:

| Area | Test |
|---|---|
| Room codes | generation, normalisation, ambiguous-character rejection |
| Clock sync | offset recovery under latency, outlier robustness, live round-trip against the server |
| Sweep geometry | exact 25/50/75/100% area at 15/30/45/60 s on iPhone, Pixel and square sizes; monotonic; visibility mask on points and boxes |
| Camera | real `getUserMedia` stream (Chrome fake device) → analysis frames at ≥2 fps, cropped and ≤320 px; the camera is fully released on exit; the denied-permission flow shows recovery steps |
| Server | health check, security headers, malformed-payload rejection, rate limiter |
| PWA | manifest, all icons, service worker activates |
| Rooms (server, fake clock) | create/join/full/wrong code, token-only resume, stale-socket handling, host/guest leave, registration → ready_check, un-ready, no start while opponent offline, official timeline, private targets, countdown → playing → timeout, forgiven short disconnect, forfeit on long disconnect or leave, result can't change, rematch, idle cleanup |
| Multiplayer (real sockets) | two clients join by code and see each other, error codes, signature validation, synchronized ready → identical timestamps on both → timeout → rematch, resume after drop, forged token rejected, host leave closes room, rate limiting |
| Multiplayer (two browsers) | host + guest phones: lobby on both, camera status relayed, reload → automatic seat resume, host leaves → guest notified; invite link join; third phone refused; offline → reconnect overlay → recovery |

**These need real phones (they can't be verified in CI):** iOS Safari camera-permission UX and autoplay, Samsung Internet, the camera released and resumed when switching apps, haptics (Android only, since iOS has no Vibration API), audio unlock on first tap, and safe-area layout on notched devices. Checklist for Phase 1:
1. iPhone, Safari: splash → Camera Check → allow. The live rear camera shows and the "Light/Sharp" values change as you move.
2. Lock the phone and unlock it again. The camera resumes, and the green camera indicator turned off while it was locked.
3. Android, Chrome: same as step 1. Also check that the battery-saver toggle drops the rate to about 4 fps.
4. Join Game: the code boxes don't trigger zoom on focus, and the keyboard shows capital letters.
5. Rotate to landscape: the rotate prompt appears.

---

## Honest limits (and the plan for them)

- **Recognising one specific object, not just a category.** COCO-SSD alone would treat every bottle as the target. Phase 3 combines a category detector (COCO-SSD, ~80 classes) with an *instance* matcher: MobileNet embeddings from 5–8 registration shots taken at different angles, plus colour-histogram signatures. During play, each detected box must match the opponent's signature above a calibrated threshold on several consecutive frames, inside the visible area, and must *not* match your own object better. The supported list of objects will be documented. Two objects that look alike (two identical white mugs) cannot be reliably told apart; registration will warn about this when it detects it.
- **Server-side checking of detections.** The server can't re-run vision without receiving video, which this design avoids for privacy. Instead it checks the match phase, round, timestamp against its own clock, rate limits, and that the reported box lies in the visible area of the sweep at that moment. This blocks forged or impossible victory messages, but a modified client could still lie about what its camera saw. This is a casual game played face to face, so that trade-off is documented rather than hidden.
- **Single server instance.** Rooms are in memory. Scaling horizontally would need Redis and the Socket.IO Redis adapter; this is noted for Phase 7.

## Privacy
Camera frames are processed only in the browser's memory. Nothing is recorded or uploaded. Rooms will be temporary and deleted after inactivity (`ROOM_IDLE_TIMEOUT_MIN`). The only personal data is an optional nickname, kept on the device and in the temporary room.
