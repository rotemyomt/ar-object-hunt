import { createServer, type Server as HttpServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { ServerConfig } from "./config.js";
import { createSocketServer, type GameServer } from "./networking/socket.js";

export interface App {
  http: HttpServer;
  io: GameServer;
  close: () => Promise<void>;
}

export function createApp(config: ServerConfig): App {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Security & privacy headers. Camera is allowed for our own origin only.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    if (config.production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, serverTime: Date.now(), version: config.version });
  });

  if (config.production && fs.existsSync(config.clientDist)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
        setHeaders(res, filePath) {
          // Hashed assets are immutable; the shell and service worker must revalidate.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    // SPA fallback (also makes /join/ABCDE invitation links work).
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(config.clientDist, "index.html"));
    });
  }

  const http = createServer(app);
  const io = createSocketServer(http, config);

  return {
    http,
    io,
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => resolve());
      }),
  };
}
