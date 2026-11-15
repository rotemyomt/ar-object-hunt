import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { http, io, close } = createApp(config);

http.listen(config.port, () => {
  console.log(
    `[aoh] server v${config.version} listening on :${config.port} (${config.production ? "production" : "development"})`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[aoh] ${signal} received, closing`);
  io.emit("room:closed", { reason: "server_shutdown" });
  await close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
