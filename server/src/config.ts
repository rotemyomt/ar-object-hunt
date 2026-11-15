import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface ServerConfig {
  port: number;
  production: boolean;
  corsOrigins: string[];
  roomIdleTimeoutMs: number;
  /** Directory of the built client, served in production. */
  clientDist: string;
  version: string;
}

export function loadConfig(): ServerConfig {
  return {
    port: intEnv("PORT", 3001),
    production: process.env.NODE_ENV === "production",
    corsOrigins: (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    roomIdleTimeoutMs: intEnv("ROOM_IDLE_TIMEOUT_MIN", 15) * 60_000,
    // Works from both src/ (tsx) and dist/ (bundled): both sit one level under server/.
    clientDist: process.env.CLIENT_DIST ?? path.resolve(here, "../../client/dist"),
    version: process.env.npm_package_version ?? "0.1.0",
  };
}
