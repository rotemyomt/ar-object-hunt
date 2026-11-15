import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  Ack,
  AckResult,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@aoh/shared";
import type { ServerConfig } from "../config.js";
import { RateLimiter } from "../validation/rateLimit.js";
import { DEFAULT_TIMING, GameError, RoomManager, type Timing } from "../rooms/RoomManager.js";
import {
  parseBoolean,
  parseCamera,
  parseCreate,
  parseCredentials,
  parseJoin,
  parseRegistration,
} from "../validation/validate.js";

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const channel = (code: string) => `room:${code}`;

/** Per-event limits: [burst, refill per second]. Generous for humans, tight for scripts. */
const LIMITS: Record<string, [number, number]> = {
  time: [20, 10],
  membership: [6, 0.5], // create / join / resume
  status: [20, 4], // camera / ready / register / rematch / leave
};

export function createSocketServer(
  http: HttpServer,
  config: ServerConfig,
  timing: Timing = DEFAULT_TIMING,
): { io: GameServer; rooms: RoomManager } {
  const io: GameServer = new Server(http, {
    cors: config.corsOrigins.length ? { origin: config.corsOrigins, methods: ["GET", "POST"] } : undefined,
    // Room events are tiny; registration descriptors are the largest payload (~4096 numbers).
    maxHttpBufferSize: 128 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const rooms = new RoomManager(
    {
      stateChanged: (code, state) => io.to(channel(code)).emit("room:state", state),
      targetsAssigned: (_code, targets) => {
        // Each player only ever receives their own target — never broadcast.
        for (const { socketId, target } of targets) if (socketId) io.to(socketId).emit("match:target", target);
      },
      roomClosed: (code, reason, socketIds) => {
        for (const id of socketIds) {
          const s = io.sockets.sockets.get(id);
          if (!s) continue;
          s.emit("room:closed", { reason });
          void s.leave(channel(code));
          s.data.roomCode = undefined;
          s.data.slot = undefined;
        }
      },
    },
    timing,
  );
  rooms.startSweeper();

  const buckets = new Map(Object.entries(LIMITS).map(([k, [cap, rate]]) => [k, new RateLimiter(cap, rate)]));
  const allow = (socket: GameSocket, kind: keyof typeof LIMITS) => buckets.get(kind)!.take(socket.id);

  /** Run a handler, translating GameErrors into structured acks and never throwing out. */
  function handle<T>(socket: GameSocket, kind: keyof typeof LIMITS, ack: unknown, fn: () => T) {
    const reply = typeof ack === "function" ? (ack as Ack<T>) : undefined;
    let result: AckResult<T>;
    if (!allow(socket, kind)) {
      result = { ok: false, error: "RATE_LIMITED", message: "Slow down a little and try again." };
    } else {
      try {
        result = { ok: true, data: fn() };
      } catch (e) {
        if (e instanceof GameError) result = { ok: false, error: e.code, message: e.message };
        else {
          console.error("[aoh] handler error", e);
          result = { ok: false, error: "INTERNAL", message: "Something went wrong on the server." };
        }
      }
    }
    reply?.(result);
  }

  function requireMember(socket: GameSocket) {
    const { roomCode, slot } = socket.data;
    if (!roomCode || !slot) throw new GameError("NOT_IN_ROOM", "You're not in a game.");
    return { roomCode, slot };
  }

  function bind(socket: GameSocket, roomCode: string, slot: 1 | 2) {
    if (socket.data.roomCode && socket.data.roomCode !== roomCode) void socket.leave(channel(socket.data.roomCode));
    socket.data.roomCode = roomCode;
    socket.data.slot = slot;
    void socket.join(channel(roomCode));
  }

  io.on("connection", (socket) => {
    socket.emit("server:hello", { serverTime: Date.now(), version: config.version });

    socket.on("time:sync", (clientSentAt, ack) => {
      if (typeof ack !== "function") return;
      if (typeof clientSentAt !== "number" || !Number.isFinite(clientSentAt)) return;
      if (!allow(socket, "time")) return;
      ack(Date.now());
    });

    socket.on("room:create", (req, ack) =>
      handle(socket, "membership", ack, () => {
        if (socket.data.roomCode) throw new GameError("INVALID_PHASE", "Leave your current game first.");
        const { name } = parseCreate(req);
        const res = rooms.create(name, socket.id);
        bind(socket, res.roomCode, res.slot);
        return res;
      }),
    );

    socket.on("room:join", (req, ack) =>
      handle(socket, "membership", ack, () => {
        if (socket.data.roomCode) throw new GameError("INVALID_PHASE", "Leave your current game first.");
        const { code, name } = parseJoin(req);
        const res = rooms.join(code, name, socket.id);
        bind(socket, res.roomCode, res.slot);
        return res;
      }),
    );

    socket.on("room:resume", (req, ack) =>
      handle(socket, "membership", ack, () => {
        const creds = parseCredentials(req);
        const res = rooms.resume(creds.roomCode, creds.slot, creds.sessionToken, socket.id);
        bind(socket, creds.roomCode, creds.slot);
        // The same seat opened elsewhere (second tab, old connection): retire the old socket.
        if (res.previousSocket && res.previousSocket !== socket.id) {
          const old = io.sockets.sockets.get(res.previousSocket);
          if (old) {
            old.data.roomCode = undefined;
            old.data.slot = undefined;
            void old.leave(channel(creds.roomCode));
            old.disconnect(true);
          }
        }
        return { state: res.state, target: res.target };
      }),
    );

    socket.on("room:leave", (ack) =>
      handle(socket, "status", ack, () => {
        const { roomCode, slot } = requireMember(socket);
        void socket.leave(channel(roomCode));
        socket.data.roomCode = undefined;
        socket.data.slot = undefined;
        rooms.leave(roomCode, slot);
        return null;
      }),
    );

    socket.on("player:camera", (status) =>
      handle(socket, "status", undefined, () => {
        const { roomCode, slot } = requireMember(socket);
        return rooms.setCamera(roomCode, slot, parseCamera(status));
      }),
    );

    socket.on("object:register", (reg, ack) =>
      handle(socket, "status", ack, () => {
        const { roomCode, slot } = requireMember(socket);
        return { state: rooms.register(roomCode, slot, parseRegistration(reg)) };
      }),
    );

    socket.on("object:clear", (ack) =>
      handle(socket, "status", ack, () => {
        const { roomCode, slot } = requireMember(socket);
        return { state: rooms.clearRegistration(roomCode, slot) };
      }),
    );

    socket.on("player:ready", (ready, ack) =>
      handle(socket, "status", ack, () => {
        const { roomCode, slot } = requireMember(socket);
        return { state: rooms.setReady(roomCode, slot, parseBoolean(ready)) };
      }),
    );

    socket.on("match:rematch", (ack) =>
      handle(socket, "status", ack, () => {
        const { roomCode, slot } = requireMember(socket);
        return { state: rooms.rematch(roomCode, slot) };
      }),
    );

    socket.on("disconnect", () => {
      const { roomCode, slot } = socket.data;
      if (roomCode && slot) rooms.disconnect(roomCode, slot, socket.id);
      for (const b of buckets.values()) b.clear(socket.id);
    });
  });

  return { io, rooms };
}
