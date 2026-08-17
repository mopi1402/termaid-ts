// The two places this port refuses to reproduce the reference, and no oracle can answer for either: what the Python
// draws there is the thing being rejected. Both are the same judgement, that INFORMATION THE AUTHOR WROTE and the
// reader never gets is a bug and not a behaviour, so neither is a divergence of taste.
//
// Held HERE and never under `fixtures/`, on purpose. A fixture is the parity corpus: `scripts/differential.ts` derives
// six mutants from every one of them, so a fixture that diverges spreads its divergence across the whole family and no
// exclusion list can name what a generator produces. A test of its own costs the corpus nothing.
//
// What each pins is the PROPERTY, never the drawing: the bytes belong to the layout and would rot on the next change.

import { describe, it, expect } from "bun:test";
import { declaredType, render } from "../src/index.js";
import { parsePieChart } from "../src/parser/piechart.js";

const BOM = "﻿";

describe("◉ a leading BOM, which the reference keeps and loses the diagram to", () => {
  // The reference reads `﻿pie` as the first word, matches no type, and hands the source to the flowchart parser,
  // which draws the pie's own syntax as boxes. Measured 2026-08-17 on termaid 0.8.0 for every type below.
  const declared: ReadonlyArray<readonly [string, string]> = [
    ["pie", 'pie\n    title T\n    "A" : 60\n    "B" : 40\n'],
    ["sequenceDiagram", "sequenceDiagram\n    Alice->>Bob: hi\n"],
    ["gantt", "gantt\n    dateFormat YYYY-MM-DD\n    section S\n    a :2020-01-01, 3d\n"],
    ["mindmap", "mindmap\n  Root\n    Branch\n"],
    ["classDiagram", "classDiagram\n    class Dog {\n      +bark()\n    }\n"],
  ];

  it.each(declared)("still reads %s as its own type", (type, source) => {
    expect(declaredType(BOM + source)).toBe(type);
  });

  it.each(declared)("draws %s exactly as it would without the mark", (_type, source) => {
    expect(render(BOM + source, { width: 60 })).toBe(render(source, { width: 60 }));
  });

  it("keeps a flowchart's direction, which the reference falls back to TD on", () => {
    const source = "graph LR\n  A[Start] --> B[End]\n";
    expect(render(BOM + source, { width: 60 })).toBe(render(source, { width: 60 }));
  });

  // The mark is the FIRST character of a file and nothing else, so one anywhere later stays where Python leaves it:
  // this is what keeps the divergence to the input accepted, rather than letting it reach the drawing.
  it("takes off the leading one alone, a later one being ordinary text", () => {
    const trailing = `graph LR\n  A --> B\n${BOM}`;
    expect(render(trailing, { width: 60 })).toContain(BOM);
  });
});

describe("◉ a pie title written on the header line, which the reference drops", () => {
  // `parser/piechart.py:26` reads lines[0] for `showData` and nothing else, and the loop that reads a title starts at
  // lines[1:]. Its own `--demo` writes `pie title Languages` and comes out untitled.
  it("reads the title mermaid allows after the keyword", () => {
    expect(parsePieChart("pie title Where the time goes\n").title).toBe("Where the time goes");
  });

  it("reads it after showData too, which is the order mermaid writes them in", () => {
    const chart = parsePieChart('pie showData title Languages\n  "Go" : 30\n');
    expect(chart.title).toBe("Languages");
    expect(chart.showData).toBe(true);
  });

  it("puts the title in the drawing, not merely in the model", () => {
    expect(render('pie title Languages\n  "Go" : 30\n  "Rust" : 70\n', { width: 60 })).toContain("Languages");
  });

  it("leaves the two-line form alone, which is the one the reference already reads", () => {
    expect(parsePieChart('pie\n    title Languages\n    "Go" : 30\n').title).toBe("Languages");
  });

  it("invents no title where the header carries none", () => {
    expect(parsePieChart('pie showData\n  "Go" : 30\n').title).toBe("");
  });
});
