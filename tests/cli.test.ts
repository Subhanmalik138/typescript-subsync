import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = new URL("../src/cli.js", import.meta.url).pathname;

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Hello, world.",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,000",
  "Second cue.",
  "",
].join("\n");

async function withTempSrt(body: string = SRT): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "subsync-test-"));
  const path = join(dir, "sample.srt");
  await writeFile(path, body, "utf-8");
  return path;
}

describe("subsync CLI", () => {
  test("convert SRT to WebVTT on stdout", async () => {
    const path = await withTempSrt();
    const { stdout } = await run(process.execPath, [CLI, "convert", path]);
    assert.match(stdout, /^WEBVTT\n\n1\n00:01\.000 --> 00:04\.000\nHello, world\./);
  });

  test("convert writes to an output file with --to", async () => {
    const path = await withTempSrt();
    const out = join(path.replace("sample.srt", ""), "out.vtt");
    await run(process.execPath, [CLI, "convert", path, out, "--to", "vtt"]);
    const text = await readFile(out, "utf-8");
    assert.match(text, /^WEBVTT/);
    assert.match(text, /Second cue\./);
  });

  test("shift moves timings and reports dropped cues on stderr", async () => {
    const path = await withTempSrt();
    const { stdout, stderr } = await run(process.execPath, [
      CLI,
      "shift",
      path,
      "--by",
      "-6000",
    ]);
    assert.match(stdout, /00:00:00,000 --> 00:00:02,000/);
    assert.match(stderr, /dropped 1 cue/);
  });

  test("resync scales timings", async () => {
    const path = await withTempSrt();
    const { stdout } = await run(process.execPath, [
      CLI,
      "resync",
      path,
      "--factor",
      "2",
    ]);
    assert.match(stdout, /00:00:02,000 --> 00:00:08,000/);
  });

  test("validate passes a clean file and fails an overlapping one", async () => {
    const clean = await withTempSrt();
    const { stdout } = await run(process.execPath, [CLI, "validate", clean]);
    assert.match(stdout, /OK: 2 cue\(s\)/);

    const bad = await withTempSrt(
      "1\n00:00:05,000 --> 00:00:06,000\nLate.\n\n2\n00:00:01,000 --> 00:00:02,000\nEarly.\n",
    );
    await assert.rejects(run(process.execPath, [CLI, "validate", bad]), (err: unknown) => {
      const e = err as { code: number; stdout: string };
      assert.equal(e.code, 2);
      assert.match(e.stdout, /out-of-order/);
      return true;
    });
  });

  test("search finds matches and prints timestamps", async () => {
    const path = await withTempSrt();
    const { stdout } = await run(process.execPath, [CLI, "search", "second", path]);
    assert.match(stdout, /cue 2/);
    assert.match(stdout, /00:00:05\.500 --> 00:00:08\.000/);
    const { stdout: none } = await run(process.execPath, [CLI, "search", "zzz", path]);
    assert.match(none, /no matches/);
  });

  test("stats reports counts in text and JSON", async () => {
    const path = await withTempSrt();
    const { stdout } = await run(process.execPath, [CLI, "stats", path]);
    assert.match(stdout, /cues:\s+2/);
    const { stdout: json } = await run(process.execPath, [CLI, "stats", path, "--json"]);
    const parsed = JSON.parse(json) as { cues: number; words: number };
    assert.equal(parsed.cues, 2);
    assert.equal(parsed.words, 4);
  });

  test("parse errors exit 1 with the line number", async () => {
    const bad = await withTempSrt("1\nnot a timing line\n");
    await assert.rejects(run(process.execPath, [CLI, "convert", bad]), (err: unknown) => {
      const e = err as { code: number; stderr: string };
      assert.equal(e.code, 1);
      assert.match(e.stderr, /line 2/);
      return true;
    });
  });

  test("reads from stdin with - and converts", async () => {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [CLI, "convert", "-"]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`exit ${code}: ${stderr}`)),
        );
        child.stdin.end(SRT);
      },
    );
    assert.match(stdout, /^WEBVTT/);
  });

  test("--help and --version exit 0", async () => {
    const { stdout: help } = await run(process.execPath, [CLI, "--help"]);
    assert.match(help, /subsync/);
    const { stdout: version } = await run(process.execPath, [CLI, "--version"]);
    assert.match(version.trim(), /^\d+\.\d+\.\d+$/);
  });
});
