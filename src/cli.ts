#!/usr/bin/env node
/**
 * subsync — subtitle parser & converter CLI.
 *
 *   subsync convert <in.srt|.vtt> [out] [--to srt|vtt]
 *   subsync shift   <file> --by <ms> [--out <file>]
 *   subsync resync  <file> --factor <n> [--offset <ms>] [--out <file>]
 *   subsync validate <file> [--json]
 *   subsync search  <query> <file> [--regex] [--case-sensitive] [--json]
 *   subsync stats   <file> [--json]
 *
 * Input may be "-" to read from stdin. Output defaults to stdout for
 * convert/shift/resync, so `subsync convert a.srt` can be piped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import {
  convertSubtitle,
  formatDisplay,
  parseSubtitle,
  ParseError,
  rescaleSubtitle,
  searchSubtitle,
  serializeSubtitle,
  shiftSubtitle,
  statsSubtitle,
  validateSubtitle,
} from "./index.js";
import type { SubtitleFormat } from "./index.js";

const VERSION = "1.0.0";

const USAGE = `subsync ${VERSION} — SRT / WebVTT subtitle toolkit

Usage:
  subsync convert <input> [output] [--to srt|vtt]   Convert between SRT and WebVTT
  subsync shift   <input> --by <ms> [--out <file>]  Shift all cues by milliseconds
  subsync resync  <input> --factor <n> [--offset <ms>] [--out <file>]
                                                     Linear resync (drift fix)
  subsync validate <input> [--json]                 Check ordering, overlaps, readability
  subsync search  <query> <input> [--regex] [--case-sensitive] [--json]
                                                     Find cues containing text
  subsync stats   <input> [--json]                  Cue/word counts and reading speed

<input> may be "-" to read from stdin. Without --out, converted/shifted
subtitles are written to stdout; use --out to write in place-safe files.
Exit code is 1 on parse errors and 2 when validation finds errors.`;

interface Flags {
  positional: string[];
  by?: number;
  factor?: number;
  offset?: number;
  out?: string;
  to?: SubtitleFormat;
  json: boolean;
  regex: boolean;
  caseSensitive: boolean;
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { positional: [], json: false, regex: false, caseSensitive: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--regex") flags.regex = true;
    else if (arg === "--case-sensitive") flags.caseSensitive = true;
    else if (arg === "--by" || arg === "--factor" || arg === "--offset") {
      const raw = args[++i];
      if (raw === undefined) fail(`missing value for ${arg}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) fail(`${arg} must be a number, got "${raw}"`);
      if (arg === "--by") flags.by = value;
      else if (arg === "--factor") flags.factor = value;
      else flags.offset = value;
    } else if (arg === "--out") {
      const raw = args[++i];
      if (raw === undefined) fail("missing value for --out");
      flags.out = raw;
    } else if (arg === "--to") {
      const raw = args[++i];
      if (raw !== "srt" && raw !== "vtt") fail(`--to must be "srt" or "vtt", got "${raw ?? ""}"`);
      flags.to = raw;
    } else if (arg.startsWith("--")) {
      fail(`unknown option "${arg}"`);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function fail(message: string): never {
  console.error(`subsync: ${message}`);
  process.exit(1);
}

async function readInput(path: string): Promise<string> {
  if (path === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf-8");
  }
  try {
    return readFileSync(path, "utf-8");
  } catch {
    fail(`cannot read "${path}"`);
  }
}

function writeOutput(text: string, out?: string): void {
  if (out) {
    writeFileSync(out, text, "utf-8");
  } else {
    process.stdout.write(text);
  }
}

function requirePositional(flags: Flags, count: number, usage: string): string[] {
  if (flags.positional.length !== count) fail(`usage: ${usage}`);
  return flags.positional;
}

function parseOrFail(input: string, filename: string) {
  try {
    return parseSubtitle(input, filename === "-" ? undefined : filename);
  } catch (err) {
    if (err instanceof ParseError) fail(`parse error in "${filename}": ${err.message}`);
    throw err;
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }

  const flags = parseFlags(rest);

  switch (command) {
    case "convert": {
      if (flags.positional.length < 1 || flags.positional.length > 2) {
        fail("usage: subsync convert <input> [output] [--to srt|vtt]");
      }
      const input = flags.positional[0]!;
      const outPath = flags.positional[1] ?? flags.out;
      const raw = await readInput(input);
      const file = parseOrFail(raw, input);
      const to: SubtitleFormat =
        flags.to ??
        (input.toLowerCase().endsWith(".srt")
          ? "vtt"
          : input.toLowerCase().endsWith(".vtt")
            ? "srt"
            : file.format === "srt"
              ? "vtt"
              : "srt");
      if (to === file.format && outPath === undefined && input !== "-") {
        console.error(`subsync: "${input}" is already ${to}; pass --to ${to === "srt" ? "vtt" : "srt"} or an output file`);
        return 1;
      }
      writeOutput(serializeSubtitle(convertSubtitle(file, to), to), outPath);
      return 0;
    }

    case "shift": {
      const [input] = requirePositional(flags, 1, "subsync shift <input> --by <ms> [--out <file>]");
      if (flags.by === undefined) fail("shift requires --by <ms>");
      const raw = await readInput(input!);
      const file = parseOrFail(raw, input!);
      const { file: shifted, dropped } = shiftSubtitle(file, flags.by);
      writeOutput(serializeSubtitle(shifted, file.format), flags.out);
      if (dropped > 0) {
        console.error(`subsync: dropped ${dropped} cue(s) that ended before 0 ms`);
      }
      return 0;
    }

    case "resync": {
      const [input] = requirePositional(flags, 1, "subsync resync <input> --factor <n> [--offset <ms>] [--out <file>]");
      if (flags.factor === undefined) fail("resync requires --factor <n>");
      const raw = await readInput(input!);
      const file = parseOrFail(raw, input!);
      let rescaled;
      try {
        rescaled = rescaleSubtitle(file, flags.factor, flags.offset ?? 0);
      } catch (err) {
        fail((err as Error).message);
      }
      writeOutput(serializeSubtitle(rescaled.file, file.format), flags.out);
      if (rescaled.dropped > 0) {
        console.error(`subsync: dropped ${rescaled.dropped} cue(s) that collapsed or fell before 0 ms`);
      }
      return 0;
    }

    case "validate": {
      const [input] = requirePositional(flags, 1, "subsync validate <input> [--json]");
      const raw = await readInput(input!);
      const file = parseOrFail(raw, input!);
      const issues = validateSubtitle(file);
      if (flags.json) {
        console.log(JSON.stringify({ file: input, cues: file.cues.length, issues }, null, 2));
      } else if (issues.length === 0) {
        console.log(`OK: ${file.cues.length} cue(s), no issues`);
      } else {
        for (const issue of issues) {
          console.log(`${issue.severity.toUpperCase()} cue ${issue.cue} [${issue.code}]: ${issue.message}`);
        }
      }
      return issues.some((i) => i.severity === "error") ? 2 : 0;
    }

    case "search": {
      const [query, input] = requirePositional(flags, 2, "subsync search <query> <input> [--regex] [--json]");
      const raw = await readInput(input!);
      const file = parseOrFail(raw, input!);
      let hits;
      try {
        hits = searchSubtitle(file, query!, {
          regex: flags.regex,
          caseSensitive: flags.caseSensitive,
        });
      } catch (err) {
        if (err instanceof ParseError) fail(err.message);
        throw err;
      }
      if (flags.json) {
        console.log(JSON.stringify(hits, null, 2));
      } else if (hits.length === 0) {
        console.log("no matches");
      } else {
        for (const hit of hits) {
          console.log(
            `[${formatDisplay(hit.startMs)} --> ${formatDisplay(hit.endMs)}] cue ${hit.cue}: ${hit.text.replace(/\n/g, " / ")}`,
          );
        }
      }
      return 0;
    }

    case "stats": {
      const [input] = requirePositional(flags, 1, "subsync stats <input> [--json]");
      const raw = await readInput(input!);
      const file = parseOrFail(raw, input!);
      const stats = statsSubtitle(file);
      if (flags.json) {
        console.log(JSON.stringify({ file: input, ...stats }, null, 2));
      } else {
        console.log(`cues:            ${stats.cues}`);
        console.log(`words:           ${stats.words}`);
        console.log(`characters:      ${stats.characters}`);
        console.log(`span:            ${(stats.spanMs / 1000).toFixed(1)}s`);
        console.log(`avg duration:    ${(stats.avgDurationMs / 1000).toFixed(2)}s`);
        console.log(`avg reading:     ${stats.avgCps.toFixed(1)} chars/sec`);
        console.log(`fastest cue:     ${stats.maxCps.toFixed(1)} chars/sec`);
      }
      return 0;
    }

    default:
      console.error(`subsync: unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`subsync: ${(err as Error).message}`);
    process.exit(1);
  },
);
