// The oracle's counterpart for the drawings this port answers for ALONE: the handful of places it refuses to
// reproduce the reference, each because the reference loses something its author wrote.
//
// The takes it freezes come from the PORT, so what they can catch is a regression against ourselves and never an
// error, which is exactly why they live apart from `fixtures/expected/`. What makes a divergence right is argued in
// CHANGELOG.md and pinned by `tests/divergences.test.ts`, which states the PROPERTY; these bytes only say that the
// drawing has not moved since the day it was agreed.
//
// They sit under `fixtures/divergences/`, a directory the parity machinery cannot see: `oracle.ts`, `differential.ts`
// and `tests/parity.test.ts` all list `fixtures/` without recursing, so nothing here is claimed, drawn by the oracle,
// or mutated into the hostile corpus.
//
//     bun scripts/ourtakes.ts            rewrite every take
//     bun scripts/ourtakes.ts --check    fail instead, naming what moved

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printToConsole, render, renderThemedText } from "../src/index.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DIVERGENCES = path.join(ROOT, "fixtures", "divergences");
const SOURCE_EXT = ".mmd";
const DRAWN_EXT = ".txt";

/** The same two widths the oracle draws at, so a divergence is judged compact and roomy alike. */
export const WIDTHS = [40, 80];
export const THEME = "neon";
const CHECK_FLAG = "--check";

export const sources = (): string[] =>
  fs
    .readdirSync(DIVERGENCES)
    .filter((file) => file.endsWith(SOURCE_EXT))
    .map((file) => file.slice(0, -SOURCE_EXT.length))
    .sort();

export const sourcePath = (name: string): string => path.join(DIVERGENCES, `${name}${SOURCE_EXT}`);

export const takePath = (name: string, width: number, theme: string | null): string =>
  path.join(DIVERGENCES, `${name}@${width}${theme === null ? "" : `.${theme}`}${DRAWN_EXT}`);

/** What the port writes, by the same two chains `cli.ts` picks between. */
export function drawn(source: string, width: number, theme: string | null): string {
  if (theme === null) return `${render(source, { width })}\n`;
  return printToConsole(renderThemedText(source, { width }, THEME));
}

const check = process.argv.includes(CHECK_FLAG);
const moved: string[] = [];
let written = 0;

for (const name of sources()) {
  const source = fs.readFileSync(sourcePath(name), "utf8");
  for (const width of WIDTHS) {
    for (const theme of [null, THEME]) {
      const target = takePath(name, width, theme);
      const take = drawn(source, width, theme);
      if (check) {
        const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
        if (current !== take) moved.push(path.basename(target));
        continue;
      }
      fs.writeFileSync(target, take);
      written++;
    }
  }
}

if (check) {
  console.log(moved.length === 0 ? "nos takes : aucun n'a bouge" : `nos takes : ${moved.length} ont bouge`);
  for (const name of moved) console.log(`  ${name}`);
  process.exit(moved.length === 0 ? 0 : 1);
}
console.log(`nos takes : ${written} ecrits pour ${sources().length} sources`);
