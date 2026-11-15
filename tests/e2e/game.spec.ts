import { expect, test, type Browser, type Page } from "@playwright/test";
import { installVirtualCamera, setScene, type Scene } from "./virtualCamera";

/**
 * Full two-player games through the real UI, real ONNX models and the real server.
 * Host's object: a brown coffee cup (photo). Guest's object: the same cup recoloured
 * blue — the hardest fair case: same category, must be told apart by appearance/colour.
 */
const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

async function phone(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await installVirtualCamera(page);
  return { context, page };
}

async function enter(page: Page) {
  await page.goto("/");
  await expect(page.getByText("TAP TO START")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("splash").click();
}

const ANGLES: Scene[] = [
  { image: null, scale: 1 },
  { image: null, scale: 1.15, dx: 0.04, rotate: -8 },
  { image: null, scale: 0.9, dx: -0.05, rotate: 7, brightness: 0.85 },
  { image: null, scale: 1.05, dy: 0.04, mirror: true, brightness: 1.1 },
];

async function registerObject(page: Page, image: string, tag: string) {
  await page.getByTestId("scan-object").click();
  await expect(page.getByTestId("register-object")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    // Like a person: aim, wait for the lock, tap; if the tap didn't take (lock flickered or
    // "same angle" was refused), nudge the object slightly and tap again.
    for (let attempt = 0; ; attempt++) {
      await setScene(page, { ...ANGLES[i]!, image, dx: (ANGLES[i]!.dx ?? 0) + attempt * 0.02, rotate: (ANGLES[i]!.rotate ?? 0) + attempt * 3 });
      await expect(page.getByTestId("capture-view")).toBeEnabled({ timeout: 60_000 });
      if (i === 1 && attempt === 0) await snap(page, `20-${tag}-scanning`);
      await page.getByTestId("capture-view").click({ timeout: 2000 }).catch(() => {});
      const ok = await expect(page.locator(".view-slot.filled"))
        .toHaveCount(i + 1, { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (ok) break;
      if (attempt >= 5) throw new Error(`capture ${i + 1} kept failing: ${await page.getByTestId("scan-hint").innerText()}`);
    }
  }
  await page.getByTestId("finish-scan").click();
  await expect(page.getByTestId("confirm-label")).toHaveText(/cup|glass|vase|bowl|bottle/i);
  await snap(page, `21-${tag}-confirm`);
  await page.getByTestId("confirm-register").click();
  await expect(page.getByTestId("lobby")).toBeAttached({ timeout: 10_000 });
}

async function setupMatch(browser: Browser) {
  const host = await phone(browser);
  const guest = await phone(browser);
  await enter(host.page);
  await host.page.getByRole("button", { name: "Create Game" }).click();
  await host.page.getByTestId("player-name").fill("Alice");
  await expect(host.page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 10_000 });
  await host.page.getByTestId("create-room").click();
  const code = (await host.page.getByTestId("room-code").innerText()).replace(/\s/g, "");

  await guest.page.goto(`/join/${code}`);
  await expect(guest.page.getByText("TAP TO START")).toBeVisible({ timeout: 8000 });
  await guest.page.getByTestId("splash").click();
  await guest.page.getByTestId("player-name").fill("Bob");
  await expect(guest.page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 10_000 });
  await guest.page.getByTestId("join-room").click();
  await expect(host.page.getByTestId("p2-connection")).toHaveText("Player 2: Connected");

  await registerObject(host.page, "coffee.png", "host");
  await expect(host.page.getByTestId("lobby-status")).toHaveText("Object Registered — Waiting for Opponent");
  await snap(host.page, "22-host-waiting");
  await registerObject(guest.page, "coffee-blue.png", "guest");
  return { host, guest };
}

async function readyUp(host: Page, guest: Page) {
  await expect(host.getByTestId("ready")).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByTestId("ready")).toBeVisible({ timeout: 10_000 });
  await host.getByTestId("ready").click();
  await expect(host.getByTestId("lobby-status")).toHaveText("Ready — Waiting for Player 2");
  await guest.getByTestId("ready").click();
  // Server-synchronized countdown on both phones.
  await expect(host.getByTestId("countdown")).toBeVisible({ timeout: 5000 });
  await expect(guest.getByTestId("countdown")).toBeVisible({ timeout: 5000 });
}

/** Fraction of the sweep canvas that is painted (covered), sampled on a grid. */
async function coveredFraction(page: Page): Promise<number> {
  return page.getByTestId("sweep").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let covered = 0;
    let n = 0;
    for (let y = 4; y < c.height; y += 16)
      for (let x = 4; x < c.width; x += 16) {
        n++;
        if (d[(y * c.width + x) * 4 + 3]! > 200) covered++;
      }
    return covered / n;
  });
}

test("full match: own object never counts; finding the opponent's object wins for exactly one player", async ({ browser }) => {
  test.setTimeout(240_000);
  const { host, guest } = await setupMatch(browser);
  await expect(host.page.getByTestId("p2-object")).toContainText("Object:");
  await readyUp(host.page, guest.page);
  await host.page.waitForTimeout(1600);
  await snap(host.page, "23-countdown");

  // Both players hide their objects; each camera initially sees ITS OWN object only.
  await setScene(host.page, { image: "coffee.png", scale: 0.95 });
  await setScene(guest.page, { image: "coffee-blue.png", scale: 0.95 });
  await expect(host.page.getByTestId("target-chip")).toBeVisible({ timeout: 10_000 });
  await expect(host.page.getByTestId("target-chip")).toContainText("Bob's");

  // Showing your own object is recognised as such and never wins.
  await expect(host.page.getByTestId("verdict")).toHaveText("That's YOUR object!", { timeout: 30_000 });
  await snap(host.page, "24-own-object");
  await host.page.waitForTimeout(4000);
  await expect(host.page.getByTestId("result")).toHaveCount(0);

  // The obstruction is real and progressing on the server clock.
  const c1 = await coveredFraction(host.page);
  expect(c1).toBeGreaterThan(0.02);
  expect(c1).toBeLessThan(0.6);

  // Alice finds Bob's (blue) cup → Alice wins, Bob loses, on both phones.
  await setScene(host.page, { image: "coffee-blue.png", scale: 1.0, dx: -0.12, dy: 0.08 });
  await expect(host.page.getByTestId("result")).toContainText("You Won! :)", { timeout: 40_000 });
  await expect(guest.page.getByTestId("result")).toContainText("You Lost! :(", { timeout: 10_000 });
  await snap(host.page, "25-victory");
  await snap(guest.page, "26-defeat");

  // Rematch returns both to the ready check with objects kept.
  await host.page.getByTestId("rematch").click();
  await expect(host.page.getByTestId("ready")).toBeVisible({ timeout: 10_000 });
  await expect(guest.page.getByTestId("ready")).toBeVisible({ timeout: 10_000 });

  await host.context.close();
  await guest.context.close();
});

test("timeout: the sweep closes in 60 s, nobody wins when neither finds the other's object", async ({ browser }) => {
  test.setTimeout(300_000);
  const { host, guest } = await setupMatch(browser);
  await readyUp(host.page, guest.page);
  await setScene(host.page, { image: "chelsea.png" }); // a cat: not a target
  await setScene(guest.page, { image: null });
  await expect(host.page.getByTestId("sweep")).toBeVisible({ timeout: 10_000 });

  // Coverage follows ~25/50/75 % at 15/30/45 s (sampled, ±8 %).
  const start = Date.now();
  for (const [t, expected] of [[15, 0.25], [30, 0.5], [45, 0.75]] as const) {
    await host.page.waitForTimeout(Math.max(0, start + t * 1000 - Date.now()));
    const f = await coveredFraction(host.page);
    expect(Math.abs(f - expected)).toBeLessThan(0.08);
    if (t === 30) await snap(host.page, "27-sweep-half");
  }

  await expect(host.page.getByTestId("result")).toContainText("Time's Up!", { timeout: 25_000 });
  await expect(host.page.getByTestId("result")).toContainText("No Winner — Both Players Lost");
  await expect(guest.page.getByTestId("result")).toContainText("Time's Up!");
  await snap(host.page, "28-timeout");
  await host.context.close();
  await guest.context.close();
});

test("practice mode: recognises the scanned object and never confirms a look-alike of another colour", async ({ browser }) => {
  test.setTimeout(180_000);
  const p = await phone(browser);
  await enter(p.page);
  await p.page.getByRole("button", { name: "Camera Check" }).click();
  await p.page.getByTestId("practice-start").click();
  await expect(p.page.getByTestId("register-object")).toBeVisible();
  // Reuse the scanning helper's capture loop without a lobby.
  for (let i = 0; i < 3; i++) {
    for (let attempt = 0; ; attempt++) {
      await setScene(p.page, { ...ANGLES[i]!, image: "coffee.png", dx: (ANGLES[i]!.dx ?? 0) + attempt * 0.02 });
      await expect(p.page.getByTestId("capture-view")).toBeEnabled({ timeout: 60_000 });
      await p.page.getByTestId("capture-view").click({ timeout: 2000 }).catch(() => {});
      const ok = await expect(p.page.locator(".view-slot.filled")).toHaveCount(i + 1, { timeout: 3000 }).then(() => true, () => false);
      if (ok || attempt >= 5) break;
    }
  }
  await p.page.getByTestId("finish-scan").click();
  await p.page.getByTestId("confirm-register").click();
  await expect(p.page.getByTestId("practice")).toBeVisible();

  // The blue look-alike: plenty of frames, zero confirmations.
  await setScene(p.page, { image: "coffee-blue.png", scale: 1.05, dx: 0.03 });
  await expect(p.page.getByTestId("practice-verdict")).toContainText("Not a match", { timeout: 30_000 });
  await p.page.waitForTimeout(6000);
  await expect(p.page.getByTestId("practice-confirmations")).toHaveText("0");
  await snap(p.page, "29-practice-lookalike");

  // The real object from a new position: confirmed.
  await setScene(p.page, { image: "coffee.png", scale: 0.95, dx: -0.06, rotate: 5 });
  await expect(p.page.getByTestId("practice-confirmations")).not.toHaveText("0", { timeout: 30_000 });
  await snap(p.page, "30-practice-match");
  await p.context.close();
});
