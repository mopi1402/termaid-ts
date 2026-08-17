// Ported from src/termaid/parser/mindmap.py.

import { makeMindmap, makeMindmapNode, type Mindmap, type MindmapNode } from "../model/mindmap.js";
import { lstrip, pyStrip, rstrip, splitLines } from "../pycompat.js";

const COMMENT = "%%";

/**
 * The shape a mermaid author may wrap a label in, none of which a mindmap draws: only the text inside is kept.
 *
 * Mermaid names all six, and lets an ID sit in FRONT of any of them: the id is a handle the author writes for the
 * node, never a word the node says, so it is dropped with the delimiters. The circle is tried before the rounded
 * square, both opening on the same character, and a label wrapped in nothing at all matches none of them.
 */
const SHAPES: readonly RegExp[] = [
  /^[\w-]*\(\((.+)\)\)$/,
  /^[\w-]*\[(.+)\]$/,
  /^[\w-]*\{\{(.+)\}\}$/,
  /^[\w-]*\((.+)\)$/,
  /^[\w-]*\)(.+)\($/,
  /^[\w-]*!(.+)!$/,
];

/** A mermaid mindmap definition. */
export function parseMindmap(text: string): Mindmap {
  const lines = splitLines(pyStrip(text));
  const mindmap = makeMindmap();
  if (lines.length === 0) return mindmap;

  const body: Array<readonly [number, string]> = [];
  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = rstrip(line);
    if (pyStrip(stripped) === "") continue;

    let label = pyStrip(stripped);
    for (const shape of SHAPES) {
      const wrapped = shape.exec(label);
      if (wrapped !== null) {
        label = wrapped[1] as string;
        break;
      }
    }

    body.push([stripped.length - lstrip(stripped).length, label]);
  }
  if (body.length === 0) return mindmap;

  const stack: Array<readonly [number, MindmapNode]> = [];
  for (const [indent, label] of body) {
    const node = makeMindmapNode(label);
    while (stack.length > 0 && (stack[stack.length - 1] as readonly [number, MindmapNode])[0] >= indent) stack.pop();

    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent[1].children.push(node);
    else if (mindmap.root === null) mindmap.root = node;
    // A second root is not a second tree: it hangs off the first, which is the only one drawn.
    else mindmap.root.children.push(node);

    stack.push([indent, node]);
  }

  return mindmap;
}
