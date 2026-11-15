import {
  DESCRIPTOR_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  PLAYER_NAME_MAX,
  isValidRoomCode,
  normalizeRoomCode,
  type CameraStatus,
  type ObjectRegistration,
  type PlayerSlot,
  type SessionCredentials,
} from "@aoh/shared";
import { GameError } from "../rooms/RoomManager.js";

/**
 * Every inbound payload is untrusted. These guards reject anything malformed before it
 * reaches game logic, with a BAD_REQUEST the client can display.
 */
const bad = (msg: string) => new GameError("BAD_REQUEST", msg);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseName(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > PLAYER_NAME_MAX * 4) throw bad("Invalid name.");
  return v;
}

export function parseCreate(req: unknown): { name: string } {
  if (!isObject(req)) throw bad("Invalid request.");
  return { name: parseName(req.name) };
}

export function parseJoin(req: unknown): { code: string; name: string } {
  if (!isObject(req) || typeof req.code !== "string" || req.code.length > 32) throw bad("Invalid request.");
  const code = normalizeRoomCode(req.code);
  if (!isValidRoomCode(code)) throw new GameError("ROOM_NOT_FOUND", "That room code isn't valid.");
  return { code, name: parseName(req.name) };
}

export function parseCredentials(req: unknown): SessionCredentials {
  if (!isObject(req)) throw bad("Invalid request.");
  const { roomCode, slot, sessionToken } = req;
  if (typeof roomCode !== "string" || !isValidRoomCode(roomCode)) throw new GameError("UNAUTHORIZED", "Session expired.");
  if (slot !== 1 && slot !== 2) throw new GameError("UNAUTHORIZED", "Session expired.");
  if (typeof sessionToken !== "string" || sessionToken.length < 16 || sessionToken.length > 128) {
    throw new GameError("UNAUTHORIZED", "Session expired.");
  }
  return { roomCode, slot: slot as PlayerSlot, sessionToken };
}

const CAMERA: ReadonlySet<CameraStatus> = new Set(["unknown", "granted", "denied", "unavailable"]);
export function parseCamera(v: unknown): CameraStatus {
  if (typeof v !== "string" || !CAMERA.has(v as CameraStatus)) throw bad("Invalid camera status.");
  return v as CameraStatus;
}

export function parseBoolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw bad("Expected true or false.");
  return v;
}

export function parseRegistration(v: unknown): ObjectRegistration {
  if (!isObject(v)) throw bad("Invalid registration.");
  const { label, descriptor, views } = v;
  if (typeof label !== "string" || label.trim().length === 0 || label.length > LABEL_MAX_LENGTH) throw bad("Invalid object label.");
  if (!Array.isArray(descriptor) || descriptor.length === 0 || descriptor.length > DESCRIPTOR_MAX_LENGTH) {
    throw bad("Invalid object signature.");
  }
  for (const x of descriptor) if (typeof x !== "number" || !Number.isFinite(x)) throw bad("Invalid object signature.");
  if (typeof views !== "number" || !Number.isInteger(views) || views < 1 || views > 32) throw bad("Invalid view count.");
  return { label: label.trim().toLowerCase(), descriptor: descriptor as number[], views };
}
