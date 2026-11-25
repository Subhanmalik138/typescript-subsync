/**
 * WebVTT (.vtt) parsing and serialisation.
 *
 * File layout:
 *   WEBVTT [header metadata]
 *   <blank>
 *   [NOTE|STYLE|REGION blocks — skipped, not cues]
 *   [optional cue id]
 *   MM:SS.mmm --> MM:SS.mmm [settings...]
 *   one or more lines of text
 *
 * Cue settings (`line:`, `position:`, `align:`, `size:`, `vertical:`) are
 * parsed into structured fields and re-emitted on serialisation. Inline
 * voice tags such as `<v Alice>` are part of the cue text and preserved
 * verbatim. Unknown settings are dropped on a VTT→VTT round-trip only if
 * they are not one of the five recognised keys; the parser keeps the
 * recognised ones so conversion to SRT and back stays lossless for text
 * and timing.
 */

import { formatVttTimestamp, parseTimestamp } from "./time.js";
import { Cue, CueSettings, ParseError, SubtitleFile } from "./types.js";

const SETTING_KEYS = ["line", "position", "align", "size", "vertical"] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

const TIMING_RE = /^(.+?)\s*-->\s*(.+?)(?:\s+(.*))?$/;

function parseSettings(raw: string | undefined, line: number): CueSettings | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const settings: CueSettings = {};
  let recognised = false;
  for (const token of raw.trim().split(/\s+/)) {
    const colon = token.indexOf(":");
    if (colon <= 0) {
      throw new ParseError(`malformed cue setting "${token}"`, line);
    }
    const key = token.slice(0, colon);
    const value = token.slice(colon + 1);
    if ((SETTING_KEYS as readonly string[]).includes(key)) {
      (settings as Record<string, string>)[key as SettingKey] = value;
      recognised = true;
    }
    // Unknown settings are ignored: they are presentation hints, not content.
  }
  return recognised ? settings : undefined;
}

function formatSettings(settings: CueSettings): string {
  const parts: string[] = [];
  for (const key of SETTING_KEYS) {
    const value = settings[key];
    if (value !== undefined) parts.push(`${key}:${value}`);
  }
  return parts.join(" ");
}

export function parseVtt(input: string): SubtitleFile {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  if (lines.length === 0 || !/^WEBVTT($|\s)/.test(lines[0]!)) {
    throw new ParseError('file must start with a "WEBVTT" header line', 1);
  }
  const header = lines[0]!.slice("WEBVTT".length).trim() || undefined;

  const cues: Cue[] = [];
  let i = 1;
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i >= lines.length) break;

    const first = lines[i]!.trim();

    // NOTE / STYLE / REGION blocks are metadata, not cues: skip to the
    // next blank line.
    if (/^(NOTE|STYLE|REGION)(\s|-|$)/.test(first)) {
      while (i < lines.length && lines[i]!.trim() !== "") i++;
      continue;
    }

    let id: string | undefined;
    let timingLine = lines[i]!;
    if (!timingLine.includes("-->")) {
      id = timingLine.trim();
      i++;
      if (i >= lines.length) {
        throw new ParseError("cue id with no timing line", i);
      }
      timingLine = lines[i]!;
    }

    const timing = TIMING_RE.exec(timingLine.trim());
    if (!timing) {
      throw new ParseError(
        `expected a timing line ("MM:SS.mmm --> MM:SS.mmm"), got "${timingLine.trim()}"`,
        i + 1,
      );
    }
    const startMs = parseTimestamp(timing[1]!, i + 1);
    const endMs = parseTimestamp(timing[2]!, i + 1);
    if (endMs <= startMs) {
      throw new ParseError(
        `end time ${timing[2]!.trim()} is not after start time ${timing[1]!.trim()}`,
        i + 1,
      );
    }
    const settings = parseSettings(timing[3], i + 1);
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      textLines.push(lines[i]!);
      i++;
    }
    if (textLines.length === 0) {
      throw new ParseError("cue has no text", i + 1);
    }

    cues.push({ id, startMs, endMs, text: textLines.join("\n"), settings });
  }

  return { format: "vtt", cues, header };
}

export function serializeVtt(file: SubtitleFile): string {
  const out: string[] = [`WEBVTT${file.header ? ` ${file.header}` : ""}`, ""];
  file.cues.forEach((cue) => {
    if (cue.id !== undefined) out.push(cue.id);
    const withHours = cue.startMs >= 3_600_000 || cue.endMs >= 3_600_000;
    const settings = cue.settings ? formatSettings(cue.settings) : "";
    out.push(
      `${formatVttTimestamp(cue.startMs, withHours)} --> ${formatVttTimestamp(cue.endMs, withHours)}${settings ? ` ${settings}` : ""}`,
    );
    out.push(cue.text);
    out.push("");
  });
  // A trailing blank line after the last cue is the conventional file ending.
  return out.join("\n") + "\n";
}
