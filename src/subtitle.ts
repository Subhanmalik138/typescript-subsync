/**
 * Format-agnostic operations over parsed subtitle files: detection,
 * conversion, timing transforms, validation, search, and statistics.
 */

import { parseSrt, serializeSrt } from "./srt.js";
import { formatDisplay } from "./time.js";
import { Cue, ParseError, SubtitleFile, SubtitleFormat } from "./types.js";
import { parseVtt, serializeVtt } from "./vtt.js";

/** Sniff the format from content; falls back to the file extension. */
export function detectFormat(input: string, filename?: string): SubtitleFormat {
  const stripped = input.replace(/^\uFEFF/, "");
  if (/^WEBVTT($|\s)/.test(stripped)) return "vtt";
  if (filename !== undefined) {
    if (filename.toLowerCase().endsWith(".vtt")) return "vtt";
    if (filename.toLowerCase().endsWith(".srt")) return "srt";
  }
  // Default to SRT: a WEBVTT file without its header is malformed anyway,
  // and the SRT parser will report the real problem with a line number.
  return "srt";
}

export function parseSubtitle(input: string, filename?: string): SubtitleFile {
  const format = detectFormat(input, filename);
  return format === "vtt" ? parseVtt(input) : parseSrt(input);
}

export function serializeSubtitle(file: SubtitleFile, format: SubtitleFormat): string {
  return format === "vtt" ? serializeVtt(file) : serializeSrt(file);
}

/** Convert a file to the other format, keeping cues, ids, and VTT settings. */
export function convertSubtitle(file: SubtitleFile, to: SubtitleFormat): SubtitleFile {
  return { format: to, cues: file.cues, header: file.header };
}

export interface ShiftResult {
  file: SubtitleFile;
  /** Cues that ended at or before 0 ms after the shift and were dropped. */
  dropped: number;
}

/**
 * Shift every cue by `deltaMs` (positive = later, negative = earlier).
 * Cues starting before 0 are clamped to 0; cues ending at or before 0
 * are dropped, since they can never be displayed.
 */
export function shiftSubtitle(file: SubtitleFile, deltaMs: number): ShiftResult {
  const cues: Cue[] = [];
  let dropped = 0;
  for (const cue of file.cues) {
    const startMs = Math.max(0, cue.startMs + deltaMs);
    const endMs = cue.endMs + deltaMs;
    if (endMs <= 0) {
      dropped++;
      continue;
    }
    cues.push({ ...cue, startMs, endMs });
  }
  return { file: { ...file, cues }, dropped };
}

/**
 * Linear resync: every timestamp becomes `round(t * factor + offsetMs)`.
 * Useful when a subtitle track drifts against the video at a constant
 * rate (factor) or has a fixed offset. Cues that collapse to zero length
 * or fall entirely before 0 are dropped.
 */
export function rescaleSubtitle(
  file: SubtitleFile,
  factor: number,
  offsetMs = 0,
): ShiftResult {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new Error("rescale factor must be a positive finite number");
  }
  const cues: Cue[] = [];
  let dropped = 0;
  for (const cue of file.cues) {
    const startMs = Math.max(0, Math.round(cue.startMs * factor + offsetMs));
    const endMs = Math.round(cue.endMs * factor + offsetMs);
    if (endMs <= startMs) {
      dropped++;
      continue;
    }
    cues.push({ ...cue, startMs, endMs });
  }
  return { file: { ...file, cues }, dropped };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  /** 1-based cue number in file order. */
  cue: number;
  message: string;
}

/** Reading speeds above this are hard to follow for most viewers. */
export const MAX_CPS = 20;
/** Cues closer together than this leave no time to read the gap. */
export const MIN_GAP_MS = 40;

export function validateSubtitle(file: SubtitleFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, number>();

  file.cues.forEach((cue, index) => {
    const n = index + 1;
    if (cue.id !== undefined) {
      const first = seenIds.get(cue.id);
      if (first !== undefined) {
        issues.push({
          severity: "error",
          code: "duplicate-id",
          cue: n,
          message: `duplicate cue id "${cue.id}" (first seen at cue ${first})`,
        });
      } else {
        seenIds.set(cue.id, n);
      }
    }
    if (cue.endMs <= cue.startMs) {
      issues.push({
        severity: "error",
        code: "non-positive-duration",
        cue: n,
        message: `cue ends at ${formatDisplay(cue.endMs)} but starts at ${formatDisplay(cue.startMs)}`,
      });
    }
    const plain = stripTags(cue.text);
    if (plain.trim() === "") {
      issues.push({
        severity: "error",
        code: "empty-text",
        cue: n,
        message: "cue has no visible text",
      });
    }
    const durationS = (cue.endMs - cue.startMs) / 1000;
    if (durationS > 0) {
      const cps = plain.replace(/\s+/g, "").length / durationS;
      if (cps > MAX_CPS) {
        issues.push({
          severity: "warning",
          code: "fast-reading",
          cue: n,
          message: `reading speed ${cps.toFixed(1)} chars/sec exceeds ${MAX_CPS} — viewers may not finish it`,
        });
      }
    }
    if (index > 0) {
      const prev = file.cues[index - 1]!;
      if (cue.startMs < prev.startMs) {
        issues.push({
          severity: "error",
          code: "out-of-order",
          cue: n,
          message: `cue starts at ${formatDisplay(cue.startMs)}, before cue ${n - 1} at ${formatDisplay(prev.startMs)}`,
        });
      }
      // Interval overlap is checked independently: a cue can be both
      // out of order and overlapping, and both facts matter.
      if (cue.startMs < prev.endMs && cue.endMs > prev.startMs) {
        issues.push({
          severity: "error",
          code: "overlap",
          cue: n,
          message: `cue overlaps cue ${n - 1} (starts ${formatDisplay(cue.startMs)}, previous ends ${formatDisplay(prev.endMs)})`,
        });
      } else if (cue.startMs >= prev.endMs && cue.startMs - prev.endMs < MIN_GAP_MS) {
        issues.push({
          severity: "warning",
          code: "tiny-gap",
          cue: n,
          message: `only ${cue.startMs - prev.endMs} ms between cue ${n - 1} and this cue`,
        });
      }
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Search & statistics
// ---------------------------------------------------------------------------

export interface SearchHit {
  cue: number;
  startMs: number;
  endMs: number;
  text: string;
}

export function searchSubtitle(
  file: SubtitleFile,
  query: string,
  options: { regex?: boolean; caseSensitive?: boolean } = {},
): SearchHit[] {
  let matcher: (text: string) => boolean;
  if (options.regex) {
    const flags = options.caseSensitive ? "" : "i";
    let re: RegExp;
    try {
      re = new RegExp(query, flags);
    } catch (err) {
      throw new ParseError(`invalid regular expression: ${(err as Error).message}`, 0);
    }
    matcher = (text) => re.test(text);
  } else if (options.caseSensitive) {
    matcher = (text) => text.includes(query);
  } else {
    const needle = query.toLowerCase();
    matcher = (text) => text.toLowerCase().includes(needle);
  }

  const hits: SearchHit[] = [];
  file.cues.forEach((cue, index) => {
    if (matcher(cue.text)) {
      hits.push({ cue: index + 1, startMs: cue.startMs, endMs: cue.endMs, text: cue.text });
    }
  });
  return hits;
}

export interface SubtitleStats {
  cues: number;
  words: number;
  characters: number;
  /** Milliseconds from the first cue start to the last cue end. */
  spanMs: number;
  avgDurationMs: number;
  /** Characters per second across the whole file. */
  avgCps: number;
  /** Fastest single cue, in characters per second. */
  maxCps: number;
}

export function statsSubtitle(file: SubtitleFile): SubtitleStats {
  let words = 0;
  let characters = 0;
  let totalDurationMs = 0;
  let maxCps = 0;
  for (const cue of file.cues) {
    const plain = stripTags(cue.text);
    words += plain.trim() === "" ? 0 : plain.trim().split(/\s+/).length;
    characters += plain.replace(/\s+/g, "").length;
    const durationMs = cue.endMs - cue.startMs;
    totalDurationMs += durationMs;
    if (durationMs > 0) {
      maxCps = Math.max(maxCps, (plain.replace(/\s+/g, "").length / durationMs) * 1000);
    }
  }
  const spanMs =
    file.cues.length === 0
      ? 0
      : file.cues[file.cues.length - 1]!.endMs - file.cues[0]!.startMs;
  return {
    cues: file.cues.length,
    words,
    characters,
    spanMs,
    avgDurationMs: file.cues.length === 0 ? 0 : totalDurationMs / file.cues.length,
    avgCps: totalDurationMs === 0 ? 0 : (characters / totalDurationMs) * 1000,
    maxCps,
  };
}

/** Remove inline formatting/voice tags so counts reflect visible text. */
export function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}
