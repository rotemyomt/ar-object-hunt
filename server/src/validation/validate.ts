import {
  DESCRIPTOR_MAX_LENGTH,
  LABEL_MAX_LENGTH,
  PLAYER_NAME_MAX,
  isValidRoomCode,
  MIN_VIEWS,
  SUPPORTED_LABELS,
  decodeDescriptor,
  type DetectionReport,
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
  if (!SUPPORTED_LABELS.has(label.trim().toLowerCase())) throw bad("That kind of object isn't supported.");
  if (!Array.isArray(descriptor) || descriptor.length === 0 || descriptor.length > DESCRIPTOR_MAX_LENGTH) {
    throw bad("Invalid object signature.");
  }
  for (const x of descriptor) if (typeof x !== "number" || !Number.isFinite(x)) throw bad("Invalid object signature.");
  if (typeof views !== "number" || !Number.isInteger(views) || views < 1 || views > 32) throw bad("Invalid view count.");
  const sig = decodeDescriptor(descriptor as number[]);
  if (!sig) throw bad("Invalid object signature.");
  if (sig.views.length !== views || views < MIN_VIEWS) throw bad(`Scan the object from at least ${MIN_VIEWS} angles.`);
  return { label: label.trim().toLowerCase(), descriptor: descriptor as number[], views };
}

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function parseDetection(v: unknown): DetectionReport {
  if (!isObject(v)) throw bad("Invalid detection.");
  const { round, at, label, box, view, score, ownScore, hits } = v as Record<string, unknown>;
  if (!num(round, 1, 1e6) || !Number.isInteger(round)) throw bad("Invalid detection.");
  if (!num(at, 0, 1e15)) throw bad("Invalid detection.");
  if (typeof label !== "string" || label.length > LABEL_MAX_LENGTH) throw bad("Invalid detection.");
  if (!isObject(box) || !num(box.x, 0, 1) || !num(box.y, 0, 1) || !num(box.w, 0.01, 1) || !num(box.h, 0.01, 1)) throw bad("Invalid detection.");
  if (!isObject(view) || !num(view.width, 100, 10000) || !num(view.height, 100, 10000)) throw bad("Invalid detection.");
  if (!num(score, 0, 1.0001) || !num(ownScore, -1, 1.0001) || !num(hits, 0, 100)) throw bad("Invalid detection.");
  return {
    round: round as number,
    at: at as number,
    label,
    box: { x: box.x as number, y: box.y as number, w: box.w as number, h: box.h as number },
    view: { width: view.width as number, height: view.height as number },
    score: score as number,
    ownScore: ownScore as number,
    hits: hits as number,
  };
}
