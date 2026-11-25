/**
 * Timestamp handling.
 *
 * SRT uses `HH:MM:SS,mmm` (comma separator). WebVTT uses `MM:SS.mmm` or
 * `HH:MM:SS.mmm` (dot separator, hours optional). Both are parsed to
 * integer milliseconds; both serializers emit the canonical form for
 * their format.
 */

import { ParseError } from "./types.js";

/** Matches `MM:SS.mmm`, `HH:MM:SS.mmm`, and the comma variant. */
const TIMESTAMP_RE =
  /^(?:(\d+):)?(\d{1,2}):(\d{1,2})([.,])(\d{1,3})$/;

export function parseTimestamp(raw: string, line: number): number {
  const m = TIMESTAMP_RE.exec(raw.trim());
  if (!m) {
    throw new ParseError(`malformed timestamp "${raw}"`, line);
  }
  const hours = m[1] === undefined ? 0 : Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const millis = Number(m[5]!.padEnd(3, "0"));
  if (minutes > 59 || seconds > 59) {
    throw new ParseError(`timestamp out of range "${raw}"`, line);
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `HH:MM:SS,mmm` — the SRT canonical form (hours always present). */
export function formatSrtTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const millis = ms % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

/**
 * `MM:SS.mmm` when under an hour, `HH:MM:SS.mmm` otherwise — the WebVTT
 * canonical form. Hours are kept when the source cue had them, so a
 * round-trip preserves the author's style.
 */
export function formatVttTimestamp(ms: number, withHours: boolean): string {
  const totalSeconds = Math.floor(ms / 1000);
  const millis = ms % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (withHours || hours > 0) {
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
  }
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

/** "00:01:23,456" style display used in human-readable output. */
export function formatDisplay(ms: number): string {
  return formatSrtTimestamp(ms).replace(",", ".");
}
