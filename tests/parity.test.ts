// The only verdict this port answers to: the reference binary's own bytes (fixtures/expected/, written by
// scripts/oracle.mjs). A fixture is judged only once it is CLAIMED in fixtures/claimed.json, so the suite stays green
// while the port advances and the claim list is the progress: a claimed fixture that drifts fails here.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printToConsole, render, renderThemedText } from "../src/index.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const EXPECTED = path.join(FIXTURES, "expected");
const CLAIMED = path.join(FIXTURES, "claimed.json");
const SOURCE_EXT = ".mmd";
const DRAWN_EXT = ".txt";
/** The same two the oracle drew at, named here because a take it never wrote is a test that cannot run. */
const WIDTHS = [40, 80];
const THEME = "neon";

const claims = JSON.parse(fs.readFileSync(CLAIMED, "utf8")) as { plain: string[]; themed: string[] };
const claimed = [...claims.plain, ...claims.themed];
const source = (name: string): string => fs.readFileSync(path.join(FIXTURES, `${name}${SOURCE_EXT}`), "utf8");
const take = (name: string, width: number, theme: string | null): string =>
  fs.readFileSync(path.join(EXPECTED, `${name}@${width}${theme === null ? "" : `.${theme}`}${DRAWN_EXT}`), "utf8");

describe("what the reference binary draws", () => {
  it("is frozen on disk for every fixture, or the port has nothing to answer to", () => {
    const sources = fs
      .readdirSync(FIXTURES)
      .filter((file) => file.endsWith(SOURCE_EXT))
      .map((file) => file.slice(0, -SOURCE_EXT.length));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      for (const width of WIDTHS) {
        for (const theme of [null, THEME]) expect(() => take(name, width, theme)).not.toThrow();
      }
    }
  });

  it("names the version it came from, since a bump invalidates every byte of it", () => {
    expect(fs.readFileSync(path.join(EXPECTED, "reference.txt"), "utf8")).toMatch(/^termaid \d+\.\d+\.\d+/);
  });

  it("only claims fixtures that exist, so a rename cannot quietly shrink the list", () => {
    for (const name of claimed) expect(fs.existsSync(path.join(FIXTURES, `${name}${SOURCE_EXT}`))).toBe(true);
  });
});

// The reference prints its drawing, which is where the trailing newline of every take comes from.
const printed = (drawn: string): string => `${drawn}\n`;

describe.each(claims.plain)("%s, the layout drawn by the port", (name) => {
  it.each(WIDTHS)("matches the reference at width %i", (width) => {
    expect(printed(render(source(name), { width }))).toBe(take(name, width, null));
  });
});

// A painted take came off a CONSOLE, which folds the text to its width and ends it with one newline of its own.
describe.each(claims.themed)("%s, the same drawing painted", (name) => {
  it.each(WIDTHS)("matches the reference at width %i, colours included", (width) => {
    expect(printToConsole(renderThemedText(source(name), { width }, THEME))).toBe(take(name, width, THEME));
  });
});
