// ◉ The background option is this package's own, so no oracle answers for it: the reference paints for a dark
// terminal and knows no other side. What is pinned here is the PROPERTY that makes it safe to ship, and the one the
// parity bench cannot state, since it only ever renders the default: asking for the dark side, or asking for nothing,
// must not move a single byte. Everything else follows from the mirror being a flip about luminance.

import { describe, it, expect } from "bun:test";
import { render, renderThemed } from "../src/index.js";
import { styleCodes } from "../src/richcompat.js";
import type { Background } from "../src/background.js";

/** The seam under test, called the way `renderCells` calls it: one definition, one side, the codes it writes. */
const styleCodesOf = (definition: string, side: Background): string => styleCodes(definition, side);

/** A source with a node, an edge and a label, so a theme spends most of its keys drawing it. */
const SOURCE = "flowchart LR\n    A[un] --> B[deux]\n";

describe("the side a drawing is painted onto", () => {
  it("moves NOT ONE BYTE where the side is dark or unstated, which is the parity bench's own ground", () => {
    for (const theme of ["default", "dracula", "solarized", "mono"]) {
      const stated = renderThemed(SOURCE, { background: "dark" }, theme);
      expect(renderThemed(SOURCE, {}, theme)).toBe(stated);
    }
  });

  it("leaves the PLAIN drawing alone: a side is a palette, never a layout", () => {
    expect(render(SOURCE, { background: "light" })).toBe(render(SOURCE));
  });

  it("repaints on the light side, and every theme with it, none naming itself in the mirror", () => {
    for (const theme of ["default", "dracula", "terra", "neon"]) {
      const dark = renderThemed(SOURCE, {}, theme);
      const light = renderThemed(SOURCE, { background: "light" }, theme);
      expect(light).not.toBe(dark);
      // The same drawing underneath: only the escapes moved.
      expect(light.replace(/\x1b\[[0-9;]*m/gu, "")).toBe(dark.replace(/\x1b\[[0-9;]*m/gu, ""));
    }
  });
});

describe("the mirror of a colour", () => {
  it("flips a truecolour about its luminance and keeps its hue: a near-white becomes a near-black", () => {
    // #F0F0F0 sits at luminance .94; its mirror sits at .06, and a grey keeps no hue to drift on.
    expect(styleCodesOf("#F0F0F0", "light")).toBe("38;2;15;15;15");
    expect(styleCodesOf("#0F0F0F", "light")).toBe("38;2;240;240;240");
  });

  it("leaves a MID grey where it is, which is what keeps the ruled lines their weight either way round", () => {
    // The exact fixed point is 127.5, which no channel can hold, so the mirror of a mid grey lands one step off
    // and never further: the flip is about luminance, and there is none to travel here.
    const mirrored = Number(styleCodesOf("#808080", "light").split(";")[2]);
    expect(Math.abs(mirrored - 0x80)).toBeLessThanOrEqual(1);
  });

  it("keeps the hue of a saturated colour, moving its lightness alone", () => {
    // A pale sky blue mirrors onto a deep blue: still blue, no longer fog on white.
    const codes = styleCodesOf("#99CCFF", "light").split(";");
    const [r, g, b] = codes.slice(2).map(Number) as [number, number, number];
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeLessThan(0x99);
  });

  it("mirrors the NAMED colours too near an end, onto the two names a palette cannot betray", () => {
    // Never onto bright_black: a light terminal theme paints that one a PALE grey, so a label mirrored there reads
    // as fog on white, which is the very failure this option exists to end.
    expect(styleCodesOf("white", "light")).toBe("30"); // -> black, the darkest ink any palette holds
    expect(styleCodesOf("bright_white", "light")).toBe("30");
    expect(styleCodesOf("bright_black", "light")).toBe("30");
    expect(styleCodesOf("black", "light")).toBe("97"); // -> bright_white
    expect(styleCodesOf("bright_yellow", "light")).toBe("33"); // -> yellow, the darker twin
    // Mid-way names read on both sides, so they stay exactly as written.
    expect(styleCodesOf("red", "light")).toBe("31");
    expect(styleCodesOf("cyan", "light")).toBe("36");
  });

  it("mirrors a BACKGROUND colour by the same rule, a solid theme filling its regions with one", () => {
    expect(styleCodesOf("on white", "light")).toBe("40"); // the fill flips with the ink
    expect(styleCodesOf("on #F0F0F0", "light")).toBe("48;2;15;15;15");
  });

  it("carries the attributes through untouched: a mirror is about colour and nothing else", () => {
    // The attributes are what tells a label from an edge once the three near-white names collapse onto one.
    expect(styleCodesOf("bold italic white", "light")).toBe("1;3;30");
    expect(styleCodesOf("dim white", "light")).toBe("2;30");
    expect(styleCodesOf("bold italic", "light")).toBe(styleCodesOf("bold italic", "dark"));
  });
});
