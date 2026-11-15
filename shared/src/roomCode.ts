import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants.js";

const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Normalize user input into a candidate room code: uppercase, strip spaces/dashes and anything
 * outside A–Z/0–9, truncate to the code length. Ambiguous glyphs (0, O, 1, I, L) are never
 * generated, so if a user types one the code simply fails validation and the UI says so.
 */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return VALID.test(code);
}

/** Generate a room code using a caller-supplied source of random integers (use crypto). */
export function generateRoomCode(randomInt: (maxExclusive: number) => number): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return out;
}
