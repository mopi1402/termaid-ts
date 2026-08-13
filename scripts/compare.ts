// Every fixture drawn by the port and held against the take the reference left on disk, byte for byte.
//
// Two takes per source and width, and they do NOT go through the same chain: the PLAIN one is what `render` returns
// and a shell prints, the NEON one is what a theme paints and a CONSOLE then folds to its width, which is what the
// reference's CLI does with the Rich text it is handed.

import fs from "node:fs";
import path from "node:path";
import { printToConsole, render, renderThemedText } from "../src/index.js";

const F = new URL("../fixtures", import.meta.url).pathname;
const THEME = "neon";
const WIDTHS = [40, 80];

const names = fs
  .readdirSync(F)
  .filter((f) => f.endsWith(".mmd"))
  .map((f) => f.slice(0, -4))
  .sort();

const thrown = (e: unknown): string => `THROWN: ${(e as Error).message}`;

for (const [label, suffix, draw] of [
  ["plain", "", (src: string, width: number) => render(src, { width }) + "\n"],
  ["neon ", `.${THEME}`, (src: string, width: number) => printToConsole(renderThemedText(src, { width }, THEME))],
] as const) {
  let ok = 0;
  let total = 0;
  const fails: string[] = [];
  for (const name of names) {
    const src = fs.readFileSync(path.join(F, `${name}.mmd`), "utf8");
    for (const width of WIDTHS) {
      total++;
      const expected = fs.readFileSync(path.join(F, "expected", `${name}@${width}${suffix}.txt`), "utf8");
      let got = "";
      try {
        got = draw(src, width);
      } catch (e) {
        got = thrown(e);
      }
      if (got === expected) ok++;
      else fails.push(`${name}@${width}`);
    }
  }
  console.log(`${label} : ${ok}/${total}${fails.length > 0 ? `\n  echecs : ${fails.join(" ")}` : ""}`);
}
