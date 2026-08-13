// Ported from src/termaid/parser/treemap.py.
//
// The tree is written by INDENTATION: a line deeper than the one above it is its child.

import { makeTreemap, makeTreemapNode, type Treemap, type TreemapNode } from "../model/treemap.js";
import { splitLines } from "../pycompat.js";

const COMMENT = "%%";
const NODE_RE = /^(\s*)"([^"]+)"(?:\s*:\s*([0-9]+(?:\.[0-9]*)?))?/;

/** A mermaid treemap definition. */
export function parseTreemap(text: string): Treemap {
  const lines = splitLines(text.trim());
  const treemap = makeTreemap();
  if (lines.length === 0) return treemap;

  const body: Array<readonly [number, string, number]> = [];
  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const node = NODE_RE.exec(line);
    if (node === null) continue;
    const written = node[3];
    body.push([(node[1] as string).length, node[2] as string, written === undefined ? 0 : Number.parseFloat(written)]);
  }
  if (body.length === 0) return treemap;

  const stack: Array<readonly [number, TreemapNode]> = [];
  for (const [indent, label, value] of body) {
    const node = makeTreemapNode(label, value);
    while (stack.length > 0 && (stack[stack.length - 1] as readonly [number, TreemapNode])[0] >= indent) stack.pop();

    const parent = stack[stack.length - 1];
    if (parent === undefined) treemap.roots.push(node);
    else parent[1].children.push(node);

    stack.push([indent, node]);
  }

  return treemap;
}
