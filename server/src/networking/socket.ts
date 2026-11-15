import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@aoh/shared";
import type { ServerConfig } from "../config.js";
import { RateLimiter } from "../validation/rateLimit.js";

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Socket.IO setup. Phase 1 provides the connection handshake and the time-sync
 * endpoint used to align every device to the server clock. Room and match handlers
 * are attached here in Phase 2.
 */
export function createSocketServer(http: HttpServer, config: ServerConfig): GameServer {
  const io: GameServer = new Server(http, {
    // Same-origin by default; explicit allow-list for split deployments.
    cors: config.corsOrigins.length ? { origin: config.corsOrigins } : undefined,
    // Small payloads only — the game never streams video to the server.
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    // Lets a briefly-disconnected phone resume the same socket session and missed events.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: true },
  });

  const limiter = new RateLimiter(20, 10);

  io.on("connection", (socket) => {
    socket.emit("server:hello", { serverTime: Date.now(), version: config.version });

    socket.on("time:sync", (clientSentAt, ack) => {
      if (typeof ack !== "function") return;
      if (typeof clientSentAt !== "number" || !Number.isFinite(clientSentAt)) return;
      if (!limiter.take(`${socket.id}:time`)) return;
      ack(Date.now());
    });

    socket.on("disconnect", () => limiter.clear(`${socket.id}:`));
  });

  return io;
}
