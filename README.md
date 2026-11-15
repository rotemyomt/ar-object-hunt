# AR Object Hunt

Real-time, two-player AR hide-and-seek for phones. Each player scans a physical object
(a bottle, cup, book…) and hides it. Both then hunt for the **opponent's** object with their
camera while a radar sweep blacks out the screen. The first phone to genuinely recognise
the opponent's object wins. If nobody does within 60 seconds, both lose.

**Play:** https://rotemyomt.github.io/ar-object-hunt/ — open it on two phones, one taps **Create Game**, the other scans the QR code.

Status: all 7 build phases implemented, with 73 unit/integration tests and 12 end-to-end
browser tests passing. See [Honest limits](#honest-limits) for what still needs real-phone testing.

---

## How a game works

1. **Pair up.** Player 1 creates a room and gets a 5-character code plus a QR invite. Player 2 joins by scanning the QR, opening the invite link or typing the code. Different Wi-Fi or mobile networks work.
2. **Scan your object.** Each player scans their own object from 3–6 angles. Each angle becomes a numeric visual signature. Images never leave the phone.
3. **Ready.** "Object Registered — Waiting for Opponent", then both press **I'm Ready**. The server fixes one official timeline, and both phones show a synchronized **3 — 2 — 1 — GO!**
4. **Hunt.** 60 seconds. Each camera looks for the opponent's object. A rotating radar line sweeps the screen and covers 25/50/75/100% of it (by area) at 15/30/45/60 s.
5. **Result.** The server validates the first genuine detection and ends the match. The winner sees **You Won! :)** with confetti; the loser sees **You Lost! :(**. If time runs out: **Time's Up! — No Winner — Both Players Lost**. Then rematch.

## Architecture

```
ar-object-hunt/
├─ shared/src/              Single source of truth for client AND server
│  ├─ protocol.ts           Typed Socket.IO events (rooms, readiness, detection reports)
│  ├─ types.ts, constants.ts
│  ├─ obstruction.ts        Sweep geometry: equal-AREA coverage + visibility mask
│  ├─ descriptor.ts         Object signatures + matching maths (appearance + colour)
│  ├─ categories.ts         COCO labels, supported objects, confusable groups
│  ├─ timeSync.ts           Server-clock offset estimation
│  └─ roomCode.ts
├─ server/src/              Node 20 + Express + Socket.IO (server-authoritative)
│  ├─ rooms/RoomManager.ts  Room & match state machine, timers, winner validation
│  ├─ networking/socket.ts  Event handlers, per-event rate limits
│  └─ validation/           Payload validation, rate limiter
├─ client/                  React 18 + TypeScript + Vite PWA
│  ├─ public/models/        On-device vision models (see below)
│  └─ src/
│     ├─ vision/            Web Worker (ONNX Runtime), matcher, live detection hook
│     ├─ camera/            getUserMedia provider, frame sampler, cover-crop geometry
│     ├─ animations/        Sweep obstruction (canvas), confetti
│     ├─ multiplayer/       Server connection + clock, room session & resume
│     ├─ screens/           Splash, Menu, HowToPlay, Create, Join, Lobby, Camera permission,
│     │                     Camera check, Scan object, Confirm object, Match (countdown,
│     │                     gameplay, win/lose/timeout), Recognition test
│     ├─ audio/             Synthesized sound effects (Web Audio), haptics
│     └─ styles/global.css
├─ scripts/                 Model fetch (pinned + SHA-256) and embedder derivation
├─ tests/e2e/               Playwright: real browsers, real models, virtual camera
├─ render.yaml              Free server hosting blueprint
└─ .github/workflows/       Pages deploy, model fetch
```

## Object recognition (the important part)

A generic "bottle detector" isn't enough, because both players might use bottles. Recognition here has two stages, both **on the phone** (in a Web Worker, with ONNX Runtime Web / WebAssembly):

| Stage | Model | What it does |
|---|---|---|
| Detect | **D-FINE nano** (COCO-80, Apache-2.0), 480 px input, adaptive down to 320 px on slow phones | Finds objects and their boxes |
| Identify | **MobileNetV2** pooled features (1280-d, Apache-2.0) + a 36-bin colour signature | Tells *this* cup apart from *that* cup |

**Registration** stores 3–6 views (one per angle). Each view has an appearance embedding and a colour signature. The app rejects views that are near-duplicates or of a different object, and rates "Recognition strength" by how consistent the views are.

**During the hunt**, a sighting counts as a hit only if **all** of these hold:
1. It's in the same category group as the target. Confusable categories are grouped, so a mug seen as "vase" still counts as a cup.
2. Its score clears the target's pass mark. Score = 0.7 × appearance + 0.3 × colour. The pass mark is calibrated per object from its own registration consistency, clamped to 0.55–0.80.
3. It matches the target **clearly better than your own object** (margin 0.08). You can never win with your own object, or with a look-alike of it.
4. At least 60% of its box is **outside the sweep obstruction** at the moment the frame was captured.

A **win needs 3 hits within the last 5 analysed frames (≤ 2.5 s)** on spatially consistent boxes. One lucky frame never wins.

**The server re-checks every claimed win** without seeing any video. It checks:
- the match phase and round;
- the capture time against its own clock;
- the category;
- the hit count;
- the score margin over the player's own object;
- that the box was in the visible region, by recomputing the sweep geometry at that time.

The first valid report processed wins. Node handles events one at a time, so two near-simultaneous claims are strictly ordered, and the second gets "already decided". A match can never have two winners.

**Supported objects** (detector categories): bottle, cup, glass, vase, bowl, book, phone, remote, mouse, ball, apple, orange, banana, frisbee, soft toy, clock, scissors, toothbrush, spoon, hair dryer.

### Models are pinned and self-hosted
`scripts/models.json` pins exact Hugging Face revisions and SHA-256 checksums. The **Fetch vision models** workflow downloads them, verifies the checksums, derives the embedder (`scripts/make_embedder.py` cuts the classifier off MobileNetV2), and commits the results to `client/public/models/`. The app therefore never depends on a third-party CDN at runtime.

The service worker caches the models (about 20 MB) and the inference runtime on first use, so later games start instantly and work offline.

## The sweep obstruction

- **Exact coverage.** On a tall screen, equal angles don't cover equal areas, so the app solves for the angle whose covered area is exactly 25/50/75/100%. The same function drives the drawing, the client's detection mask and the server's re-check.
- **A real barrier.** It's drawn on a canvas over the camera: opaque fill with a faint grid, a glowing sweep line and a radar trail.
- **Synchronized.** It's timed from `matchStartsAt` and `matchEndsAt` on the server clock. Each phone estimates its offset from the server clock using 8 round trips, refreshed every 30 s.

## Multiplayer

- **Server-authoritative.** The server decides phases (lobby → ready_check → countdown → playing → finished), timestamps and the winner. Clients render the server's state and never decide results themselves.
- **Sessions.** Joining issues a secret session token. If a phone reloads or switches networks, it rejoins its seat automatically. During a match, a disconnect lasting more than 15 s forfeits.
- **Privacy.** Each phone receives only its own target signature. Signatures are never broadcast or included in room state.
- **Abuse protection.** Validated payloads, per-event rate limits, capped message size, and empty or idle rooms deleted automatically.
- **Look-alike warning.** When the two registered objects are very similar, the lobby warns both players.

## Running it

### Play now (no computer needed)
The live site uses **GitHub Pages** for the game and **Render (free)** for the game server.

- **iPhone (Safari)** or **Android (Chrome / Samsung Internet):** open https://rotemyomt.github.io/ar-object-hunt/ and allow the camera when asked.
- **Install as an app:** on iPhone, Share → Add to Home Screen. On Android, ⋮ → Install app.
- **Two phones:** phone 1 taps Create Game. Phone 2 scans the QR with its camera app (or taps Join Game and types the code).
- **Recognition models:** the first time you open the lobby, about 20 MB downloads with a progress bar, so use Wi-Fi if you can. After that it's cached.
- **Free server sleeps** after about 15 idle minutes. The first player then waits up to a minute and sees "Waking up server…".

### Local development
```bash
npm install
python3 scripts/fetch_models.py && pip install onnx && python3 scripts/make_embedder.py   # only if client/public/models is empty
npm run dev          # server :3001 + https://localhost:5173 (self-signed HTTPS so phones can use the camera)
```
On a phone on the same Wi-Fi, open `https://<computer-LAN-IP>:5173` and accept the certificate warning.
- **iPhone:** Show Details → visit this website.
- **Android:** Advanced → Proceed.

### Production
```bash
npm run build
NODE_ENV=production PORT=3001 npm start     # serves the built client + Socket.IO from one origin
```
**Split hosting (the current setup).** `render.yaml` hosts the server (Render → New → Blueprint). Set the GitHub repo variable `VITE_SERVER_URL` to the server URL; the Pages workflow builds the client with it. Set `CORS_ORIGINS` on the server to the Pages origin.

Keep **one server instance**: rooms live in memory. Scaling out would need Redis plus the Socket.IO Redis adapter.

## Tests

```bash
npm run typecheck
npm test                                  # 73 unit/integration tests (shared 16, server 40, client 17)
npm run build && npm run test:e2e         # 12 end-to-end tests (~5 min); CHROME_PATH=… to use system Chrome
```

The end-to-end tests run the real production build in Chromium. A **virtual camera** feeds real photos, and everything downstream is real game code: the ONNX models, matching, the sweep mask, the server and the network.

| Requirement | Automated test |
|---|---|
| Two phones join one room, lobby on both | `multiplayer.spec` (two browser contexts) |
| Object registration on both devices | `game.spec` (multi-angle scan of real photos) |
| Ready-state + countdown sync | `game.spec`; server integration test asserts identical timestamps on both clients |
| 60 s timer + obstruction progression | `game.spec` timeout test measures canvas coverage ≈25/50/75% at 15/30/45 s, then "Time's Up!" |
| Detection accuracy / false-positive prevention | `game.spec` + practice test: the *recoloured identical cup* scores 35% (needs ~70%) and never confirms; the real one scores ~93% and confirms. Own object shows "That's YOUR object!" and never wins |
| Player 1 / Player 2 winning | `game.spec` (P1 wins on both phones); server unit tests cover both slots |
| Simultaneous detections | server unit test: first processed wins, second refused, single outcome |
| Detections behind the sweep | server unit test (rejected using server geometry) + client matcher test |
| Network interruption / reconnection | `multiplayer.spec` (reload → seat resumed; offline → overlay → recovery); server tests for forfeit vs forgiven drop |
| Rematch | `game.spec` + server tests |
| PWA / camera errors | `phase1.spec` |

**Needs real phones (can't be verified in CI):**
- iOS Safari and Samsung Internet camera behaviour, autoplay and audio unlock;
- inference speed on your devices (≈250 ms per frame on one desktop core; phones roughly 2–4 frames per second);
- recognition accuracy with your real objects, lighting and motion;
- haptics (Android only; iOS has no Vibration API);
- the screen wake lock;
- notched-screen layout.

**Real-phone checklist:**
1. **Camera Check → Test recognition** with the objects you plan to use. Show the scanned object, then other objects; only the scanned one should confirm.
2. **A full match on two phones** on different networks (one on Wi-Fi, one on mobile data).
3. **Airplane mode** for 5 s mid-match. You should rejoin; staying away more than 15 s forfeits.
4. **Lock and unlock** the phone in the lobby. The camera should turn off and resume.

## Honest limits

- **Look-alike objects.** Two identical white mugs can't be reliably told apart by any camera-only system. The app warns when the registered objects look alike. Different colours or shapes work best, and the colour signature helps a lot.
- **Real-world accuracy isn't measured on a dataset.** It was verified on real photos in the tests, but not across your lighting and objects. The pass mark adapts to each object, and Practice mode shows live scores so you can judge it yourself.
- **Trust model.** The server re-checks everything it can without receiving video (privacy by design). A modified client could still fake "I saw it". That's acceptable for a casual face-to-face game, and documented rather than hidden.
- **Speed.** GitHub Pages can't enable cross-origin isolation, so inference runs single-threaded WebAssembly (with SIMD). A host that sends COOP/COEP headers enables multi-threading automatically. WebGPU could be added later.
- **Requirements.** iOS 16.4+ / recent Android Chrome (OffscreenCanvas in workers, module workers, WebAssembly SIMD).

## Privacy & security
- **Camera:** used only after explicit permission. Frames are processed in memory on the device and never recorded or uploaded. The camera is released when the app is hidden or not needed.
- **What's shared:** only a numeric object signature (no images) and an optional nickname. Rooms are temporary and deleted when idle.
- **Server:** HTTPS everywhere, validated and rate-limited events, authenticated seats, `Permissions-Policy: camera=(self)`, and no secrets in frontend code.

## Credits
D-FINE (ustc-community, Apache-2.0) · MobileNetV2 (Google, Apache-2.0) · ONNX Runtime Web (MIT) · Socket.IO · React · Vite.
