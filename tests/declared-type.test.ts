// declaredType is this package's ONE addition over the reference, so no oracle answers for it: the Python draws an
// unknown type as a flowchart of its own syntax and says nothing, and this export exists precisely so a caller can.
// What is pinned here is agreement with the DISPATCH: a type this says null for is one painted() would hand to the
// fallback, and a name it returns is the prefix that routes.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { declaredType } from "../src/index.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE_EXT = ".mmd";

describe("what a source declares", () => {
  it("names the routed prefix for every specialised type", () => {
    expect(declaredType("sequenceDiagram\n  A->>B: hi\n")).toBe("sequenceDiagram");
    expect(declaredType("gantt\n  title t\n")).toBe("gantt");
    // The -beta suffixes route by prefix, and the answer is the PREFIX: the name the dispatch acts on.
    expect(declaredType("xychart-beta\n  bar [1]\n")).toBe("xychart");
    expect(declaredType("block-beta\n  a b\n")).toBe("block");
  });

  it("reads a gitGraph out of its init directive, the one type that may not lead with its own word", () => {
    expect(declaredType('%%{init: {"gitGraph": {}} }%%\ngitGraph\n  commit\n')).toBe("gitGraph");
  });

  it("names stateDiagram for both spellings, the route parse() takes before the fallback", () => {
    expect(declaredType("stateDiagram\n  [*] --> A\n")).toBe("stateDiagram");
    expect(declaredType("stateDiagram-v2\n  [*] --> A\n")).toBe("stateDiagram");
  });

  it("names flowchart for either header word, whatever its case, the way the parser reads its own header", () => {
    expect(declaredType("flowchart TD\n  A --> B\n")).toBe("flowchart");
    expect(declaredType("graph LR\n  A --> B\n")).toBe("flowchart");
    expect(declaredType("GRAPH TD\n  A --> B\n")).toBe("flowchart");
  });

  it("skips what the flowchart parser skips: a comment or a blank above the header hides nothing", () => {
    expect(declaredType("%% a comment\n\nflowchart TD\n  A --> B\n")).toBe("flowchart");
  });

  it("drops YAML frontmatter before reading, the way every render does", () => {
    expect(declaredType("---\ntitle: t\n---\nsequenceDiagram\n  A->>B: hi\n")).toBe("sequenceDiagram");
  });

  it("answers null for a type this renderer does not know, which the dispatch would draw as a flowchart of nonsense", () => {
    // The whole reason the export exists: a NEWER mermaid's type must be tellable apart from a diagram.
    expect(declaredType("sankey-beta\n  A,B,10\n")).toBeNull();
    expect(declaredType("radar\n  axis a, b, c\n")).toBeNull();
  });

  it("answers null for prose and for nothing at all, neither of which declares anything", () => {
    expect(declaredType("ceci est une phrase, pas un diagramme.\n")).toBeNull();
    expect(declaredType("")).toBeNull();
  });

  it("does not read a WORD OPENING ON a header keyword as the header: the first word matches whole or not at all", () => {
    // The near-miss: `startsWith` would take it, which is why the flowchart half reads words and not prefixes.
    expect(declaredType("graphique\n  A --> B\n")).toBeNull();
  });

  it("declares a known type for every fixture of the parity suite, or the suite exercises a source this would refuse", () => {
    const sources = fs.readdirSync(FIXTURES).filter((name) => name.endsWith(SOURCE_EXT));
    for (const name of sources) {
      const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
      expect(declaredType(text), name).not.toBeNull();
    }
  });
});
