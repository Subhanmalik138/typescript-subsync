/** Shared model for a parsed subtitle file. */

export interface CueSettings {
  /** Vertical position, e.g. "line:90%" or "line:3". */
  line?: string;
  /** Horizontal position, e.g. "position:50%". */
  position?: string;
  /** Text alignment: start | center | end | left | right. */
  align?: string;
  /** Cue box width, e.g. "size:80%". */
  size?: string;
  /** Vertical writing mode, e.g. "vertical:rl". */
  vertical?: string;
}

export interface Cue {
  /** Optional cue identifier (SRT index or WebVTT cue id). */
  id?: string | undefined;
  /** Start time in milliseconds from the beginning of the media. */
  startMs: number;
  /** End time in milliseconds from the beginning of the media. */
  endMs: number;
  /** Cue text, lines joined with "\n". Inline tags (e.g. <i>, <v Speaker>) are preserved verbatim. */
  text: string;
  /** WebVTT-only cue settings; undefined for cues parsed from SRT. */
  settings?: CueSettings | undefined;
}

export type SubtitleFormat = "srt" | "vtt";

export interface SubtitleFile {
  format: SubtitleFormat;
  cues: Cue[];
  /** Raw WebVTT header metadata (text after "WEBVTT" on the first line, if any). */
  header?: string | undefined;
}

/** A parse failure that knows exactly where it happened. */
export class ParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.name = "ParseError";
    this.line = line;
  }
}
