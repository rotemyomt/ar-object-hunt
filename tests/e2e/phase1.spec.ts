import { expect, test, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS; // optional output dir for visual review

async function snap(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
}

async function enterMenu(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("splash")).toBeVisible();
  await snap(page, "01-splash-loading");
  await expect(page.getByText("TAP TO START")).toBeVisible({ timeout: 5000 });
  await snap(page, "02-splash-ready");
  await page.getByTestId("splash").click();
  await expect(page.getByTestId("menu")).toBeVisible();
}

test("splash → menu, connects to the server and syncs the clock", async ({ page }) => {
  await enterMenu(page);
  await expect(page.getByTestId("connection-pill")).toContainText(/Server online · \d+ ms/, { timeout: 8000 });
  await snap(page, "03-menu");
});

test("join screen validates room codes", async ({ page }) => {
  await enterMenu(page);
  await page.getByRole("button", { name: "Join Game" }).click();
  const joinBtn = page.getByRole("button", { name: "Join Room" });
  const input = page.getByTestId("room-code-input");

  await input.fill("ab0de"); // contains 0 → invalid
  await expect(page.getByRole("alert")).toContainText("isn’t valid");
  await expect(joinBtn).toBeDisabled();
  await snap(page, "04-join-invalid");

  await input.fill("ab-c2d"); // normalized to ABC2D
  await expect(input).toHaveValue("ABC2D");
  await expect(page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 8000 });
  await expect(joinBtn).toBeEnabled();
  await snap(page, "05-join-valid");
  await joinBtn.click();
  // No such room on the server → a clear error, no fake lobby.
  await expect(page.getByTestId("join-error")).toContainText("No game with that code");
});

test("invite links prefill the join screen", async ({ page }) => {
  await page.goto("/join/XY2Z9");
  await expect(page.getByText("TAP TO START")).toBeVisible({ timeout: 5000 });
  await page.getByTestId("splash").click();
  await expect(page.getByTestId("room-code-input")).toHaveValue("XY2Z9");
});

test("camera check: real getUserMedia stream feeds the analysis pipeline", async ({ page }) => {
  await enterMenu(page);
  await page.getByRole("button", { name: "Camera Check" }).click();

  // Permission is pre-granted in this test context, so the app may skip straight to the camera.
  const enable = page.getByTestId("enable-camera");
  if (await enable.isVisible().catch(() => false)) {
    await snap(page, "06-camera-permission");
    await enable.click();
  }

  await expect(page.getByTestId("camera-check")).toBeVisible();
  const video = page.getByTestId("camera-video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId("cam-res")).toHaveText(/\d+×\d+/);
  // Analysis frames are cropped to the screen aspect and capped at 320 px.
  await expect(page.getByTestId("analysis-res")).toHaveText(/\d+×320|320×\d+/, { timeout: 10_000 });
  await expect.poll(async () => parseFloat((await page.getByTestId("sample-fps").textContent()) ?? "0"), { timeout: 10_000 }).toBeGreaterThan(2);
  await expect(page.getByTestId("quality-verdict")).not.toHaveText(/Starting|Analysing/);
  await page.waitForTimeout(600);
  await snap(page, "07-camera-check");

  // Leaving releases the camera (privacy + battery).
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("menu")).toBeVisible();
  const liveTracks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("video")).flatMap((v) =>
      ((v.srcObject as MediaStream | null)?.getTracks() ?? []).filter((t) => t.readyState === "live"),
    ).length,
  );
  expect(liveTracks).toBe(0);
});

test("camera denied shows actionable recovery steps", async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  // Simulate the user tapping "Don't Allow".
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    // Make the permission pre-check report "prompt" so the app shows the permission screen.
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d: PermissionDescriptor) =>
      d.name === ("camera" as PermissionName)
        ? Promise.resolve({ state: "prompt", addEventListener() {}, removeEventListener() {} } as unknown as PermissionStatus)
        : q(d);
  });
  await enterMenu(page);
  await page.getByRole("button", { name: "Camera Check" }).click();
  await page.getByTestId("enable-camera").click();
  await expect(page.getByTestId("camera-error")).toContainText("Camera access blocked");
  await expect(page.getByTestId("enable-camera")).toHaveText("Try Again");
  await snap(page, "08-camera-denied");
  await context.close();
});

test("PWA manifest and service worker are served", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("AR Object Hunt");
  expect(manifest.orientation).toBe("portrait");
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons as Array<{ src: string }>) {
    expect((await request.get(icon.src)).status()).toBe(200);
  }
  await page.goto("/");
  const swReady = await page.evaluate(async () => {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    return !!reg?.active;
  });
  expect(swReady).toBe(true);
});
