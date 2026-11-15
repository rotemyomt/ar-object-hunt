import { expect, test, type Browser, type Page } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;
const snap = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};

async function phone(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ["camera"],
  });
  const page = await context.newPage();
  return { context, page };
}

async function tapThroughSplash(page: Page) {
  await expect(page.getByText("TAP TO START")).toBeVisible({ timeout: 6000 });
  await page.getByTestId("splash").click();
}

async function hostGame(page: Page, name: string) {
  await page.goto("/");
  await tapThroughSplash(page);
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.getByTestId("player-name").fill(name);
  await expect(page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 8000 });
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("lobby")).toBeAttached();
  const code = (await page.getByTestId("room-code").innerText()).replace(/\s/g, "");
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return code;
}

test("two phones: create, join by code, live lobby, reconnect, host leaves", async ({ browser }) => {
  const host = await phone(browser);
  const guest = await phone(browser);

  const code = await hostGame(host.page, "Alice");
  await expect(host.page.getByTestId("player-card-2")).toContainText("Waiting for player 2");
  await expect(host.page.getByAltText(/QR code to join/)).toBeVisible();
  await snap(host.page, "10-lobby-waiting");

  // Guest joins by typing the code (lower-case on purpose).
  await guest.page.goto("/");
  await tapThroughSplash(guest.page);
  await guest.page.getByRole("button", { name: "Join Game" }).click();
  await guest.page.getByTestId("room-code-input").fill(code.toLowerCase());
  await guest.page.getByTestId("player-name").fill("Bob");
  await expect(guest.page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 8000 });
  await guest.page.getByTestId("join-room").click();

  // Both devices see both players connected.
  for (const p of [host.page, guest.page]) {
    await expect(p.getByTestId("p1-connection")).toHaveText("Player 1: Connected");
    await expect(p.getByTestId("p2-connection")).toHaveText("Player 2: Connected");
    await expect(p.getByTestId("player-card-1")).toContainText("Alice");
    await expect(p.getByTestId("player-card-2")).toContainText("Bob");
  }
  await expect(guest.page.getByTestId("player-card-2")).toContainText("YOU");
  // Camera permission is reported to the other phone.
  await expect(host.page.getByTestId("player-card-2")).toContainText("Camera ready");
  await snap(host.page, "11-lobby-host");
  await snap(guest.page, "12-lobby-guest");

  // Guest reloads (or loses network) → seat is kept and resumed automatically.
  await guest.page.reload();
  await expect(host.page.getByTestId("p2-connection")).toHaveText(/Reconnecting|Player 2: Connected/);
  await tapThroughSplash(guest.page);
  await expect(guest.page.getByTestId("lobby")).toBeAttached({ timeout: 8000 });
  await expect(host.page.getByTestId("p2-connection")).toHaveText("Player 2: Connected");
  await expect(guest.page.getByTestId("player-card-2")).toContainText("YOU");

  // Host leaves → guest is told the game ended and returns to the menu.
  await host.page.getByRole("button", { name: "Back" }).click();
  await host.page.getByTestId("confirm-leave").click();
  await expect(host.page.getByTestId("menu")).toBeVisible();
  await expect(guest.page.getByTestId("room-closed")).toContainText("The host ended the game");
  await snap(guest.page, "13-room-closed");
  await guest.page.getByRole("button", { name: "OK" }).click();
  await expect(guest.page.getByTestId("menu")).toBeVisible();

  await host.context.close();
  await guest.context.close();
});

test("invite link opens straight into joining that room", async ({ browser }) => {
  const host = await phone(browser);
  const guest = await phone(browser);
  const code = await hostGame(host.page, "Host");

  await guest.page.goto(`/join/${code}`);
  await tapThroughSplash(guest.page);
  await expect(guest.page.getByTestId("room-code-input")).toHaveValue(code);
  await expect(guest.page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 8000 });
  await guest.page.getByTestId("join-room").click();
  await expect(host.page.getByTestId("p2-connection")).toHaveText("Player 2: Connected");

  // A third phone can't join a full room.
  const third = await phone(browser);
  await third.page.goto(`/join/${code}`);
  await tapThroughSplash(third.page);
  await expect(third.page.getByTestId("connection-pill")).toContainText("Server online", { timeout: 8000 });
  await third.page.getByTestId("join-room").click();
  await expect(third.page.getByTestId("join-error")).toContainText("already has two players");

  for (const c of [host, guest, third]) await c.context.close();
});

test("losing the server connection shows a reconnect overlay", async ({ browser }) => {
  test.setTimeout(70_000);
  const host = await phone(browser);
  await hostGame(host.page, "Solo");
  await host.context.setOffline(true);
  // Force the socket to notice immediately rather than waiting for a ping timeout.
  await host.page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(host.page.getByTestId("connection-lost")).toBeVisible({ timeout: 25_000 });
  await snap(host.page, "14-connection-lost");
  await host.context.setOffline(false);
  await expect(host.page.getByTestId("connection-lost")).toBeHidden({ timeout: 20_000 });
  await expect(host.page.getByTestId("p1-connection")).toHaveText("Player 1: Connected");
  await host.context.close();
});
