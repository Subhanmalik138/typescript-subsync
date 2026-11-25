/**
 * SubRip (.srt) parsing and serialisation.
 *
 * A cue block is:
 *   <index>                                  (optional — auto-numbered if missing)
 *   HH:MM:SS,mmm --> HH:MM:SS,mmm [X1 Y1 X2 Y2]   (trailing coordinates ignored)
 *   one or more lines of text
 *
 * Blocks are separated by blank lines. The parser tolerates CRLF, a UTF-8
 * BOM, missing indexes, and extra whitespace; anything else is a
 * ParseError carrying the offending line number.
 */

import { formatSrtTimestamp, parseTimestamp } from "./time.js";
import { Cue, ParseError, SubtitleFile } from "./types.js";

const TIMING_RE = /^(.+?)\s*-->\s*(.+?)\s*$/;
// Trailing display coordinates some players emit, e.g. "X1:100 X2:200 Y1:300 Y2:400".
const COORDS_SUFFIX_RE = /\s+X1[:=]\d+\s+X2[:=]\d+\s+Y1[:=]\d+\s+Y2[:=]\d+\s*$/;

export function parseSrt(input: string): SubtitleFile {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const cues: Cue[] = [];

  // Walk the file block by block, tracking 1-based line numbers so errors
  // point at the real line in the source file.
  let i = 0;
  while (i < lines.length) {
    // Skip blank separator lines.
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i >= lines.length) break;

    const blockStart = i + 1;
    let id: string | undefined;
    let timingLine = lines[i]!;

    // An all-digits line is the cue index; anything else must be the timing line.
    if (/^\d+$/.test(timingLine.trim())) {
      id = timingLine.trim();
      i++;
      if (i >= lines.length) {
        throw new ParseError("cue index with no timing line", blockStart);
      }
      timingLine = lines[i]!;
    }

    const timing = TIMING_RE.exec(timingLine.trim().replace(COORDS_SUFFIX_RE, ""));
    if (!timing) {
      throw new ParseError(
        `expected a timing line ("HH:MM:SS,mmm --> HH:MM:SS,mmm"), got "${timingLine.trim()}"`,
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
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      textLines.push(lines[i]!);
      i++;
    }
    if (textLines.length === 0) {
      throw new ParseError("cue has no text", i + 1);
    }

    cues.push({ id, startMs, endMs, text: textLines.join("\n") });
  }

  return { format: "srt", cues };
}

export function serializeSrt(file: SubtitleFile): string {
  const out: string[] = [];
  file.cues.forEach((cue, index) => {
    out.push(String(cue.id ?? index + 1));
    out.push(
      `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
    );
    out.push(cue.text);
    out.push("");
  });
  // A trailing blank line after the last cue is the conventional file ending.
  return out.join("\n") + "\n";
}
