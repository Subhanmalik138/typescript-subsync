# SubSync — Subtitle Parser & Converter CLI

A zero-dependency TypeScript toolkit for SRT and WebVTT subtitle files: parse,
convert, shift, resync, validate, search, and gather statistics — from the
command line or as a library.

## Why this exists

Video editors, translators, and accessibility workflows constantly shuffle
subtitle files between formats and fix timing drift. Most tools for that are
either heavyweight desktop apps or Python scripts with loose parsing. SubSync
is a small, strict, typed tool: it parses both formats into one model,
reports parse errors with exact line numbers, and never silently drops a cue.

## Install

Requires Node.js ≥ 22.6.

```bash
npm install
npm run build
npm link          # makes `subsync` available globally
```

## Usage

```bash
# Convert SRT to WebVTT (format is inferred from the extension)
subsync convert episode.srt episode.vtt

# Convert from stdin, print to stdout
cat episode.srt | subsync convert - --to vtt > episode.vtt

# Shift every cue 1.5 seconds later (negative values move earlier)
subsync shift episode.srt --by 1500 --out episode-fixed.srt

# Fix a track that drifts: stretch timings by 1.002 and add a 250 ms offset
subsync resync episode.srt --factor 1.002 --offset 250 --out episode-fixed.srt

# Check a file for overlaps, ordering, and readability problems
subsync validate episode.vtt
# OK: 142 cue(s), no issues

# Find every cue mentioning a name
subsync search "Martha" episode.srt

# Word counts and reading speed
subsync stats episode.srt
```

Exit codes: `0` success, `1` parse or usage error, `2` validation found errors
(warnings alone still exit `0`).

## Design decisions

1. **One model, two formats.** SRT and WebVTT parse into the same `Cue`
   structure (`startMs`, `endMs`, `text`, optional `settings`), so conversion
   is a pure re-serialisation — no information is lost in either direction
   except SRT's numeric indexes, which WebVTT doesn't have.
2. **Strict parsing with line numbers.** A malformed timing line fails with
   the exact line, instead of the parser guessing. Tolerances are explicit
   and few: CRLF, a UTF-8 BOM, missing SRT indexes, and trailing SRT
   coordinates are accepted; everything else is an error.
3. **Timing is integer milliseconds.** All arithmetic is done in integer ms,
   so shifting and rescaling never accumulate floating-point drift. Resync
   rounds once, at the end.
4. **Validation separates errors from warnings.** Overlaps, out-of-order
   cues, duplicate ids, and empty text are errors; reading speed above 20
   chars/sec and gaps under 40 ms are warnings, because a fast cue is
   sometimes intentional (a song lyric, a shout).

## What it handles

- **SRT:** optional indexes, multi-line cues, CRLF/BOM, trailing `X1/Y1/X2/Y2`
  coordinates.
- **WebVTT:** header metadata, `NOTE`/`STYLE`/`REGION` blocks, cue ids,
  cue settings (`line`, `position`, `align`, `size`, `vertical`), voice
  tags (`<v Speaker>`), timestamps with or without hours.
- **Transforms:** shift with clamping at 0 (cues ending before 0 are dropped
  and reported), linear resync with factor + offset.
- **Validation:** overlaps, ordering, duplicate ids, empty text, reading
  speed, tiny gaps.
- **Search:** case-insensitive substring by default, `--regex` and
  `--case-sensitive` available; `--json` output for scripting.

## Library use

```ts
import { parseSubtitle, shiftSubtitle, serializeSubtitle, validateSubtitle } from "typescript-subsync";

const file = parseSubtitle(await readFile("episode.srt", "utf-8"), "episode.srt");
const { file: shifted, dropped } = shiftSubtitle(file, 1500);
console.log(serializeSubtitle(shifted, "vtt"));
console.log(validateSubtitle(file));
```

## Tests

```bash
npm test   # builds, then runs node:test suites (unit + CLI end-to-end)
```

## License

MIT — see [LICENSE](LICENSE).
