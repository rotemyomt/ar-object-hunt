/** Game-wide constants shared by client and server. The server is authoritative for all timing. */

export const MAX_PLAYERS = 2;

/** Gameplay window, in milliseconds. */
export const MATCH_DURATION_MS = 60_000;

/** Length of the synchronized "3 — 2 — 1 — GO!" countdown. */
export const COUNTDOWN_MS = 3_000;

/** Extra lead time the server adds before the countdown so every device receives the start time first. */
export const START_LEAD_MS = 800;

/** Room codes avoid ambiguous characters (0/O, 1/I/L) so they can be read aloud across a room. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

/** How long a disconnected player has to come back during a live match before forfeiting. */
export const MATCH_DISCONNECT_GRACE_MS = 15_000;

/** How long a room survives with nobody connected (outside a match). */
export const EMPTY_ROOM_TTL_MS = 3 * 60_000;

/** Player display names. */
export const PLAYER_NAME_MAX = 16;

/** Number of time-sync round trips used to estimate the server clock offset. */
export const TIME_SYNC_SAMPLES = 8;
