// The ORACLE: what the reference binary draws, frozen on disk so the port is judged against bytes and never against a
// reading of the Python. Run it once per reference version; the fixtures it writes are versioned with the port.
//
// Two takes per source and width: PLAIN, which is the layout alone and the only thing the first half of the port owes,
// and NEON, which is the layout plus the colours a theme paints on it.
//
// A fixture must draw the same thing on any day, so a gantt one spans PAST dates alone: today's marker then never
// falls inside the chart, and the frozen take cannot rot.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const EXPECTED = path.join(FIXTURES, "expected");
const SOURCE_EXT = ".mmd";
const DRAWN_EXT = ".txt";

/** The widths a terminal actually is, near enough: one that forces the layout to compact and one that does not. */
export const WIDTHS = [40, 80];
const WIDTH_FLAG = "--width";
const THEME_FLAG = "--theme";
/** The theme cc-views renders with, so parity is judged on the drawing its users see. */
const THEME = "neon";
/** What turns the colour on: the renderer writes to a pipe here, and paints nothing unless told. */
const COLOUR_ENV = { FORCE_COLOR: "1" };
const VERSION_FLAG = "--version";
const REFERENCE = "@tayomi/termaid-bin";
/** The reference's own name for what it drew, kept beside the fixtures: a bump invalidates every byte below. */
const STAMP = "reference.txt";

/** Where a take lands. The name says everything it depends on, so a stale file is a visible one. */
export function expectedPath(name: string, width: number, theme: string | null): string {
  return path.join(EXPECTED, `${name}@${width}${theme === null ? "" : `.${theme}`}${DRAWN_EXT}`);
}

export function sources(): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((file) => file.endsWith(SOURCE_EXT))
    .map((file) => file.slice(0, -SOURCE_EXT.length))
    .sort();
}

export const sourcePath = (name: string): string => path.join(FIXTURES, `${name}${SOURCE_EXT}`);

function reference(): string {
  const { termaidPath } = createRequire(import.meta.url)(REFERENCE) as { termaidPath(): string | null };
  const bin = termaidPath();
  if (bin === null) throw new Error(`${REFERENCE}: no binary for this platform`);
  return bin;
}

function drawn(bin: string, source: string, width: number, theme: string | null): string {
  const args = [WIDTH_FLAG, String(width), ...(theme === null ? [] : [THEME_FLAG, theme])];
  return execFileSync(bin, args, {
    input: source,
    encoding: "utf8",
    env: theme === null ? process.env : { ...process.env, ...COLOUR_ENV },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

const bin = reference();
fs.mkdirSync(EXPECTED, { recursive: true });
let written = 0;
for (const name of sources()) {
  const source = fs.readFileSync(sourcePath(name), "utf8");
  for (const width of WIDTHS) {
    for (const theme of [null, THEME]) {
      fs.writeFileSync(expectedPath(name, width, theme), drawn(bin, source, width, theme));
      written++;
    }
  }
}
fs.writeFileSync(path.join(EXPECTED, STAMP), execFileSync(bin, [VERSION_FLAG], { encoding: "utf8" }));
console.log(`oracle: ${written} takes from ${execFileSync(bin, [VERSION_FLAG], { encoding: "utf8" }).trim()}`);
