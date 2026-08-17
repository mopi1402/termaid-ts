// The drawings this port answers for ALONE, frozen under `fixtures/divergences/` by `scripts/ourtakes.ts`.
//
// These bytes came off the PORT, so what they catch is a regression against ourselves and never an error: the reason
// a divergence is right is argued in CHANGELOG.md and pinned as a PROPERTY by `divergences.test.ts`. What this file
// adds is the guard the other two cannot give, and the one that matters the day someone ports the upstream again:
// a drawing that quietly goes back to the reference's own behaviour fails here.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIVERGENCES, THEME, WIDTHS, drawn, sourcePath, sources, takePath } from "../scripts/ourtakes.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE_EXT = ".mmd";

const names = sources();
const source = (name: string): string => fs.readFileSync(sourcePath(name), "utf8");

describe("what this port draws that the reference does not", () => {
  it("has a source to answer for, or the directory says nothing", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("is frozen on disk at every width and theme", () => {
    for (const name of names) {
      for (const width of WIDTHS) {
        for (const theme of [null, THEME]) expect(fs.existsSync(takePath(name, width, theme))).toBe(true);
      }
    }
  });

  // The one structural promise the whole arrangement rests on. `oracle.ts`, `differential.ts` and `parity.test.ts`
  // all list `fixtures/` WITHOUT recursing, so a divergence kept here is never claimed against the reference and
  // never mutated into the hostile corpus. A directory read that started recursing would break all three at once.
  it("is invisible to the parity corpus, which lists its own directory flat", () => {
    const flat = fs.readdirSync(FIXTURES).filter((file) => file.endsWith(SOURCE_EXT));
    for (const name of names) expect(flat).not.toContain(`${name}${SOURCE_EXT}`);
    expect(path.dirname(sourcePath(names[0] as string))).toBe(DIVERGENCES);
  });
});

describe.each(names)("%s, the drawing this port stands behind", (name) => {
  it.each(WIDTHS)("has not moved at width %i", (width) => {
    expect(drawn(source(name), width, null)).toBe(fs.readFileSync(takePath(name, width, null), "utf8"));
  });

  it.each(WIDTHS)("has not moved at width %i, colours included", (width) => {
    expect(drawn(source(name), width, THEME)).toBe(fs.readFileSync(takePath(name, width, THEME), "utf8"));
  });
});
