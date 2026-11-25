import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSrt, serializeSrt } from "../src/srt.js";
import { parseVtt, serializeVtt } from "../src/vtt.js";
import {
  convertSubtitle,
  detectFormat,
  parseSubtitle,
  rescaleSubtitle,
  searchSubtitle,
  serializeSubtitle,
  shiftSubtitle,
  statsSubtitle,
  validateSubtitle,
} from "../src/subtitle.js";
import { formatSrtTimestamp, formatVttTimestamp, parseTimestamp } from "../src/time.js";
import { ParseError } from "../src/types.js";

const SRT_SAMPLE = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Hello, world.",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,000",
  "Second cue,",
  "on two lines.",
  "",
].join("\n");

const VTT_SAMPLE = [
  "WEBVTT - Example file",
  "",
  "NOTE This is a comment block",
  "spanning two lines",
  "",
  "STYLE",
  "::cue { color: lime }",
  "",
  "intro",
  "00:01.000 --> 00:04.000 line:90% align:center",
  "<v Alice>Hello, world.</v>",
  "",
  "00:05.500 --> 00:08.000",
  "Second cue,",
  "on two lines.",
  "",
].join("\n");

describe("timestamps", () => {
  test("parses SRT comma and VTT dot forms, with and without hours", () => {
    assert.equal(parseTimestamp("00:00:01,000", 1), 1000);
    assert.equal(parseTimestamp("01:02:03.456", 1), 3_723_456);
    assert.equal(parseTimestamp("02:03.456", 1), 123_456);
    assert.equal(parseTimestamp("00:00:00,001", 1), 1);
  });

  test("formats canonical SRT and VTT timestamps", () => {
    assert.equal(formatSrtTimestamp(3_723_456), "01:02:03,456");
    assert.equal(formatVttTimestamp(123_456, false), "02:03.456");
    assert.equal(formatVttTimestamp(3_723_456, false), "01:02:03.456");
    assert.equal(formatSrtTimestamp(parseTimestamp("00:00:05,500", 1)), "00:00:05,500");
  });

  test("rejects malformed and out-of-range timestamps", () => {
    assert.throws(() => parseTimestamp("00:61:00,000", 3), ParseError);
    assert.throws(() => parseTimestamp("not-a-time", 3), ParseError);
    assert.throws(() => parseTimestamp("00:00:01", 3), ParseError);
  });
});

describe("SRT parsing", () => {
  test("parses indexes, timings, and multi-line text", () => {
    const file = parseSrt(SRT_SAMPLE);
    assert.equal(file.format, "srt");
    assert.equal(file.cues.length, 2);
    assert.equal(file.cues[0]?.id, "1");
    assert.equal(file.cues[0]?.startMs, 1000);
    assert.equal(file.cues[0]?.endMs, 4000);
    assert.equal(file.cues[0]?.text, "Hello, world.");
    assert.equal(file.cues[1]?.text, "Second cue,\non two lines.");
  });

  test("tolerates CRLF, BOM, and missing indexes", () => {
    const input = "\uFEFF00:00:01,000 --> 00:00:02,000\r\nNo index here.\r\n\r\n";
    const file = parseSrt(input);
    assert.equal(file.cues.length, 1);
    assert.equal(file.cues[0]?.id, undefined);
    assert.equal(file.cues[0]?.text, "No index here.");
  });

  test("ignores trailing X1/Y1/X2/Y2 coordinates", () => {
    const file = parseSrt("1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200 Y1:300 Y2:400\nHi\n");
    assert.equal(file.cues[0]?.startMs, 1000);
  });

  test("reports the offending line for bad timing lines and empty cues", () => {
    assert.throws(() => parseSrt("1\nhello\n"), (e: unknown) => {
      assert.ok(e instanceof ParseError);
      assert.equal(e.line, 2);
      return true;
    });
    assert.throws(() => parseSrt("1\n00:00:02,000 --> 00:00:01,000\nBackwards\n"), ParseError);
    assert.throws(() => parseSrt("1\n00:00:01,000 --> 00:00:02,000\n"), ParseError);
  });

  test("serialises with sequential indexes when ids are missing", () => {
    const file = parseSrt("00:00:01,000 --> 00:00:02,000\nA\n\n00:00:03,000 --> 00:00:04,000\nB\n");
    assert.equal(serializeSrt(file), "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n\n");
  });
});

describe("WebVTT parsing", () => {
  test("parses header metadata, cue ids, settings, and voice tags", () => {
    const file = parseVtt(VTT_SAMPLE);
    assert.equal(file.format, "vtt");
    assert.equal(file.header, "- Example file");
    assert.equal(file.cues.length, 2);
    assert.equal(file.cues[0]?.id, "intro");
    assert.equal(file.cues[0]?.startMs, 1000);
    assert.equal(file.cues[0]?.settings?.line, "90%");
    assert.equal(file.cues[0]?.settings?.align, "center");
    assert.equal(file.cues[0]?.text, "<v Alice>Hello, world.</v>");
    assert.equal(file.cues[1]?.id, undefined);
  });

  test("skips NOTE, STYLE, and REGION blocks", () => {
    const input = "WEBVTT\n\nREGION\nid:fred\nwidth:40%\n\n00:01.000 --> 00:02.000\nHi\n";
    assert.equal(parseVtt(input).cues.length, 1);
  });

  test("accepts hour-form timestamps and rejects a missing header", () => {
    const file = parseVtt("WEBVTT\n\n01:00:00.000 --> 01:00:02.500\nLong\n");
    assert.equal(file.cues[0]?.startMs, 3_600_000);
    assert.throws(() => parseVtt("00:01.000 --> 00:02.000\nHi\n"), ParseError);
  });

  test("serialises settings and keeps voice tags verbatim", () => {
    const file = parseVtt(VTT_SAMPLE);
    const out = serializeVtt(file);
    assert.match(out, /^WEBVTT - Example file\n/);
    assert.match(out, /00:01\.000 --> 00:04\.000 line:90% align:center/);
    assert.match(out, /<v Alice>Hello, world\.<\/v>/);
  });
});

describe("format detection and conversion", () => {
  test("sniffs WEBVTT content and falls back to extension", () => {
    assert.equal(detectFormat(VTT_SAMPLE), "vtt");
    assert.equal(detectFormat(SRT_SAMPLE), "srt");
    assert.equal(detectFormat(SRT_SAMPLE, "subs.vtt"), "vtt");
  });

  test("SRT -> VTT -> SRT round-trip preserves cues, text, and timing", () => {
    const original = parseSubtitle(SRT_SAMPLE);
    const vtt = serializeSubtitle(convertSubtitle(original, "vtt"), "vtt");
    const back = parseSubtitle(vtt);
    assert.equal(back.format, "vtt");
    assert.equal(back.cues.length, original.cues.length);
    back.cues.forEach((cue, i) => {
      assert.equal(cue.startMs, original.cues[i]?.startMs);
      assert.equal(cue.endMs, original.cues[i]?.endMs);
      assert.equal(cue.text, original.cues[i]?.text);
    });
    const srtAgain = serializeSubtitle(convertSubtitle(back, "srt"), "srt");
    assert.equal(parseSubtitle(srtAgain).cues.length, 2);
  });
});

describe("timing transforms", () => {
  test("shift moves cues and clamps/drops at zero", () => {
    const file = parseSubtitle(SRT_SAMPLE);
    const { file: shifted, dropped } = shiftSubtitle(file, 1500);
    assert.equal(shifted.cues[0]?.startMs, 2500);
    assert.equal(dropped, 0);

    const { file: early, dropped: droppedEarly } = shiftSubtitle(file, -1500);
    assert.equal(early.cues[0]?.startMs, 0);
    assert.equal(early.cues[0]?.endMs, 2500);
    assert.equal(droppedEarly, 0);

    const { file: gone, dropped: droppedAll } = shiftSubtitle(file, -9000);
    assert.equal(gone.cues.length, 0);
    assert.equal(droppedAll, 2);
  });

  test("rescale applies a linear factor plus offset", () => {
    const file = parseSubtitle(SRT_SAMPLE);
    const { file: rescaled, dropped } = rescaleSubtitle(file, 2, 500);
    assert.equal(rescaled.cues[0]?.startMs, 2500);
    assert.equal(rescaled.cues[0]?.endMs, 8500);
    assert.equal(dropped, 0);
    assert.throws(() => rescaleSubtitle(file, 0), /positive finite/);
    assert.throws(() => rescaleSubtitle(file, -1), /positive finite/);
  });
});

describe("validation", () => {
  test("clean file has no issues", () => {
    assert.deepEqual(validateSubtitle(parseSubtitle(SRT_SAMPLE)), []);
  });

  test("flags overlaps, out-of-order cues, duplicates, and empty text", () => {
    const file = parseSubtitle(
      "1\n00:00:05,000 --> 00:00:06,000\nLate first.\n\n" +
        "1\n00:00:01,000 --> 00:00:07,000\nOverlaps everything.\n\n" +
        "3\n00:00:08,000 --> 00:00:09,000\n<i></i>\n",
    );
    const issues = validateSubtitle(file);
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("out-of-order"));
    assert.ok(codes.includes("overlap"));
    assert.ok(codes.includes("duplicate-id"));
    assert.ok(codes.includes("empty-text"));
    assert.ok(issues.filter((i) => i.severity === "error").length >= 4);
  });

  test("warns on unreadably fast cues and tiny gaps", () => {
    const file = parseSubtitle(
      "1\n00:00:01,000 --> 00:00:01,500\nThis is a very long sentence packed into half a second of screen time.\n\n" +
        "2\n00:00:01,510 --> 00:00:03,000\nNext.\n",
    );
    const codes = validateSubtitle(file).map((i) => i.code);
    assert.ok(codes.includes("fast-reading"));
    assert.ok(codes.includes("tiny-gap"));
  });
});

describe("search and stats", () => {
  test("search finds case-insensitive matches and regex matches", () => {
    const file = parseSubtitle(SRT_SAMPLE);
    assert.equal(searchSubtitle(file, "hello").length, 1);
    assert.equal(searchSubtitle(file, "HELLO", { caseSensitive: true }).length, 0);
    assert.equal(searchSubtitle(file, "^Second", { regex: true }).length, 1);
    assert.equal(searchSubtitle(file, "missing").length, 0);
    assert.throws(() => searchSubtitle(file, "(", { regex: true }), ParseError);
  });

  test("stats count words, characters, span, and reading speed", () => {
    const stats = statsSubtitle(parseSubtitle(SRT_SAMPLE));
    assert.equal(stats.cues, 2);
    assert.equal(stats.words, 7);
    assert.equal(stats.spanMs, 7000);
    assert.ok(stats.avgCps > 0 && stats.maxCps >= stats.avgCps);
    assert.deepEqual(statsSubtitle({ format: "srt", cues: [] }), {
      cues: 0,
      words: 0,
      characters: 0,
      spanMs: 0,
      avgDurationMs: 0,
      avgCps: 0,
      maxCps: 0,
    });
  });
});
