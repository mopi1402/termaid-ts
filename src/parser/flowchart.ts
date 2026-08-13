// Ported from src/termaid/parser/flowchart.py.
//
// Recursive descent over mermaid flowchart syntax: the graph/flowchart header and its directions, every node shape,
// every edge form, edge labels, subgraphs, classDef, comments, chained arrows and the `&` operator.

import {
  ArrowType,
  Direction,
  EdgeStyle,
  Graph,
  makeEdge,
  makeNode,
  makeSubgraph,
  type LabelSegment,
  type Node,
  type Subgraph,
} from "../graph/model.js";
import { NodeShape } from "../graph/shapes.js";

/** Node shape delimiters, MOST SPECIFIC FIRST: `((` must be tried before `(` or a circle reads as a rounded box. */
const SHAPE_PATTERNS: ReadonlyArray<readonly [string, string, NodeShape]> = [
  ["(((", ")))", NodeShape.DOUBLE_CIRCLE],
  ["((", "))", NodeShape.CIRCLE],
  ["([", "])", NodeShape.STADIUM],
  ["[(", ")]", NodeShape.CYLINDER],
  ["[[", "]]", NodeShape.SUBROUTINE],
  ["[/", "\\]", NodeShape.TRAPEZOID],
  ["[\\", "/]", NodeShape.TRAPEZOID_ALT],
  ["[/", "/]", NodeShape.PARALLELOGRAM],
  ["[\\", "\\]", NodeShape.PARALLELOGRAM_ALT],
  ["{{", "}}", NodeShape.HEXAGON],
  ["{", "}", NodeShape.DIAMOND],
  ["(", ")", NodeShape.ROUNDED],
  [">", "]", NodeShape.ASYMMETRIC],
  ["[", "]", NodeShape.RECTANGLE],
];

/** What `@{shape: name}` may name. */
const AT_SHAPE_MAP: ReadonlyMap<string, NodeShape> = new Map([
  ["rect", NodeShape.RECTANGLE],
  ["rectangle", NodeShape.RECTANGLE],
  ["rounded", NodeShape.ROUNDED],
  ["circle", NodeShape.CIRCLE],
  ["circ", NodeShape.CIRCLE],
  ["diam", NodeShape.DIAMOND],
  ["diamond", NodeShape.DIAMOND],
  ["hex", NodeShape.HEXAGON],
  ["hexagon", NodeShape.HEXAGON],
  ["stadium", NodeShape.STADIUM],
  ["terminal", NodeShape.STADIUM],
  ["cyl", NodeShape.CYLINDER],
  ["cylinder", NodeShape.CYLINDER],
  ["db", NodeShape.CYLINDER],
  ["subroutine", NodeShape.SUBROUTINE],
  ["lean-r", NodeShape.PARALLELOGRAM],
  ["lean-l", NodeShape.PARALLELOGRAM_ALT],
  ["trap-t", NodeShape.TRAPEZOID],
  ["trap-b", NodeShape.TRAPEZOID_ALT],
  ["dbl-circ", NodeShape.DOUBLE_CIRCLE],
]);

const COMMENT = "%%";
const QUOTE = '"';
const SEMICOLON = ";";
const PIPE = "|";
const AMPERSAND = "&";
const OPENERS = "([{";
const CLOSERS = ")]}";
const HEADER_KEYWORDS = ["graph", "flowchart"];
/** A base arrow, `-->` or `==>`, spends this many repeating characters; every extra one lengthens the edge. */
const HEADED_BASE = 2;
const OPEN_BASE = 3;
const MIN_LENGTH = 1;
/** The index `linkStyle default` writes under. */
const DEFAULT_LINK_STYLE = -1;

const count = (text: string, ch: string): number => text.split(ch).length - 1;

/** Python's `str.strip(chars)`, which strips a SET of characters and not a prefix. */
function stripChars(text: string, chars: string, left: boolean, right: boolean): string {
  let start = 0;
  let end = text.length;
  if (left) while (start < end && chars.includes(text[start] as string)) start++;
  if (right) while (end > start && chars.includes(text[end - 1] as string)) end--;
  return text.slice(start, end);
}

/** Python's `str.split()` with no argument: on runs of whitespace, empties dropped. */
const words = (line: string): string[] => line.split(/\s+/).filter((w) => w !== "");

/** Python's `str.split(None, maxsplit)`: the tail keeps its own spacing. */
function splitWords(line: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = line.trimStart();
  while (out.length < maxsplit && rest !== "") {
    const at = rest.search(/\s/);
    if (at === -1) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest !== "") out.push(rest);
  return out;
}

/** How long an edge runs: a base arrow is one, and every repeated character past the base adds one. */
export function computeArrowLength(arrowText: string, style: EdgeStyle): number {
  const hasHead = arrowText.trimEnd().endsWith(">") || arrowText.trimStart().startsWith("<");
  const s = stripChars(stripChars(arrowText, "<ox", true, false), ">ox", false, true);
  if (style === EdgeStyle.DOTTED) return Math.max(MIN_LENGTH, count(s, "."));
  if (style === EdgeStyle.THICK) {
    const base = hasHead ? HEADED_BASE : OPEN_BASE;
    return Math.max(MIN_LENGTH, count(s, "=") - base + 1);
  }
  if (style === EdgeStyle.SOLID) {
    const base = hasHead ? HEADED_BASE : OPEN_BASE;
    return Math.max(MIN_LENGTH, count(s, "-") - base + 1);
  }
  return MIN_LENGTH;
}

/** `key: value` pairs out of an `@{...}` body, a comma inside quotes belonging to the value. */
function parseAtShapeProps(body: string): Map<string, string> {
  const props = new Map<string, string>();
  const parts: string[] = [];
  let current: string[] = [];
  let inQuote = false;
  for (const ch of body) {
    if (ch === QUOTE) {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      parts.push(current.join(""));
      current = [];
      continue;
    }
    current.push(ch);
  }
  if (current.length > 0) parts.push(current.join(""));

  for (const raw of parts) {
    const part = raw.trim();
    const at = part.indexOf(":");
    if (at === -1) continue;
    props.set(part.slice(0, at).trim(), stripChars(part.slice(at + 1).trim(), QUOTE, true, true));
  }
  return props;
}

const stripComments = (line: string): string => {
  const at = line.indexOf(COMMENT);
  return at >= 0 ? line.slice(0, at) : line;
};

/** A backtick-quoted markdown label, or null where the label is ordinary text. */
export function parseMarkdownLabel(text: string): { plain: string; segments: LabelSegment[] } | null {
  const stripped = text.trim();
  if (!(stripped.startsWith('"`') && stripped.endsWith('`"'))) return null;

  const md = stripped.slice(2, -2);
  const segments: LabelSegment[] = [];
  const plainParts: string[] = [];
  let i = 0;
  while (i < md.length) {
    if (md.slice(i, i + 2) === "**") {
      const end = md.indexOf("**", i + 2);
      if (end !== -1) {
        const inner = md.slice(i + 2, end);
        segments.push({ text: inner, bold: true, italic: false });
        plainParts.push(inner);
        i = end + 2;
        continue;
      }
    }
    if (md[i] === "*") {
      const end = md.indexOf("*", i + 1);
      if (end !== -1) {
        const inner = md.slice(i + 1, end);
        segments.push({ text: inner, bold: false, italic: true });
        plainParts.push(inner);
        i = end + 1;
        continue;
      }
    }
    let j = i;
    while (j < md.length && md[j] !== "*") j++;
    segments.push({ text: md.slice(i, j), bold: false, italic: false });
    plainParts.push(md.slice(i, j));
    i = j;
  }
  return { plain: plainParts.join(""), segments };
}

/** `prop1:val1,prop2:val2` read as a map. */
function parseCssProps(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const prop of text.split(",")) {
    const at = prop.indexOf(":");
    if (at === -1) continue;
    props.set(prop.slice(0, at).trim(), prop.slice(at + 1).trim());
  }
  return props;
}

/** Whether a position sits inside a double-quoted run. */
function insideQuotes(text: string, pos: number): boolean {
  let inQuote = false;
  for (let i = 0; i < pos; i++) if (text[i] === QUOTE) inQuote = !inQuote;
  return inQuote;
}

const stripQuotes = (text: string): string =>
  text.length >= 2 && text.startsWith(QUOTE) && text.endsWith(QUOTE) ? text.slice(1, -1) : text;

/** One line cut into statements at every semicolon OUTSIDE quotes. */
function splitOnSemicolons(line: string): string[] {
  const parts: string[] = [];
  let buf: string[] = [];
  let inQuote = false;
  for (const ch of line) {
    if (ch === QUOTE) {
      inQuote = !inQuote;
      buf.push(ch);
    } else if (ch === SEMICOLON && !inQuote) {
      parts.push(buf.join(""));
      buf = [];
    } else {
      buf.push(ch);
    }
  }
  parts.push(buf.join(""));
  return parts;
}

/** A piece of a parsed line: either a group of nodes or the arrow between two of them. */
interface Segment {
  text: string;
  isArrow: boolean;
  edgeStyle: EdgeStyle;
  hasArrowStart: boolean;
  hasArrowEnd: boolean;
  arrowTypeStart: ArrowType;
  arrowTypeEnd: ArrowType;
  label: string;
  minLength: number;
}

function makeSegment(fields: Partial<Segment> & { text: string }): Segment {
  return {
    isArrow: false,
    edgeStyle: EdgeStyle.SOLID,
    hasArrowStart: false,
    hasArrowEnd: true,
    arrowTypeStart: ArrowType.ARROW,
    arrowTypeEnd: ArrowType.ARROW,
    label: "",
    minLength: MIN_LENGTH,
    ...fields,
  };
}

/** What a found arrow is: where it sits in the line, and everything the edge it makes will carry. */
interface ArrowMatch {
  pos: number;
  end: number;
  style: EdgeStyle;
  hasStart: boolean;
  hasEnd: boolean;
  label: string;
  length: number;
  typeStart: ArrowType;
  typeEnd: ArrowType;
}

/** Plain arrows, tried in order of specificity and the EARLIEST match winning. */
const PLAIN_ARROWS: ReadonlyArray<{
  re: RegExp;
  style: EdgeStyle;
  hasStart: boolean;
  hasEnd: boolean;
  typeStart: ArrowType;
  typeEnd: ArrowType;
}> = [
  { re: /<-\.+->/, style: EdgeStyle.DOTTED, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /<=+=>/, style: EdgeStyle.THICK, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /<-+->/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /o-+o/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.CIRCLE, typeEnd: ArrowType.CIRCLE },
  { re: /x-+x/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.CROSS, typeEnd: ArrowType.CROSS },
  { re: /-\.+->/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /=+=>/, style: EdgeStyle.THICK, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-+->/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-+o(?=\s|$)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.CIRCLE },
  { re: /-+x(?=\s|$)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.CROSS },
  { re: /~~~/, style: EdgeStyle.INVISIBLE, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-\.-/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /={3,}/, style: EdgeStyle.THICK, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-{3,}/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
];

/** An arrow carrying its label between pipes. */
const PIPED_ARROW = /(<--|<-\.|-\.|-+|=+|<)([-=.]+)(>?)(\|)([^|]*)(\|)/;

/** An arrow carrying its label BETWEEN its halves: `-- text -->`. */
const SPLIT_ARROWS: ReadonlyArray<{ re: RegExp; style: EdgeStyle; hasStart: boolean; hasEnd: boolean }> = [
  { re: /(--)(\s+.+?\s+)(-->)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true },
  { re: /(==)(\s+.+?\s+)(==>)/, style: EdgeStyle.THICK, hasStart: false, hasEnd: true },
  { re: /(-\.)(\s+.+?\s+)(\.+->)/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: true },
];

const AT_SHAPE_RE = /^([a-zA-Z_]\w*)\s*@\{([\s\S]+)\}$/;
const SUBGRAPH_BRACKET_RE = /^(\S+)\s+\[(.+)\]/;
const PLAIN_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const STYLE_CLASS_MARK = ":::";

class FlowchartParser {
  private readonly graph = new Graph();
  private readonly subgraphStack: Subgraph[] = [];
  /** Nodes written with an explicit shape, which is what tells a real node from a subgraph reference. */
  private readonly shapedNodeIds = new Set<string>();

  constructor(private readonly text: string) {}

  parse(): Graph {
    const lines = this.preprocess(this.text);
    const header = lines[0];
    if (header === undefined) return this.graph;
    this.parseHeader(header);
    for (const line of lines.slice(1)) this.parseLine(line);
    this.resolveSubgraphEdges();
    return this.graph;
  }

  private preprocess(text: string): string[] {
    const raw: string[] = [];
    for (const line of text.split("\n")) raw.push(...splitOnSemicolons(line));
    return raw.map((line) => stripComments(line).trim()).filter((line) => line !== "");
  }

  private parseHeader(line: string): void {
    const parts = words(line);
    const keyword = (parts[0] ?? "").toLowerCase();
    if (!HEADER_KEYWORDS.includes(keyword)) return;
    const named = (parts[1] ?? "").toUpperCase();
    this.graph.direction = named in Direction ? (Direction as Record<string, Direction>)[named] as Direction : Direction.TB;
  }

  private parseLine(line: string): void {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith("subgraph")) return this.parseSubgraph(line);
    if (lower === "end") return this.closeSubgraph();
    if (lower.startsWith("direction ")) return this.parseDirectionOverride(line);
    if (lower.startsWith("classdef ")) return this.parseClassDef(line);
    if (lower.startsWith("class ")) return this.parseClassAssignment(line);
    if (lower.startsWith("linkstyle ")) return this.parseLinkStyle(line);
    if (lower.startsWith("style ")) return this.parseStyle(line);
    if (lower.startsWith("click ")) return;
    this.parseStatement(line);
  }

  private parseSubgraph(line: string): void {
    const rest = line.slice("subgraph".length).trim();
    let id = rest;
    let label = rest;
    const bracket = SUBGRAPH_BRACKET_RE.exec(rest);
    if (bracket !== null) {
      id = bracket[1] as string;
      label = bracket[2] as string;
    } else if (rest.includes(" ")) {
      id = words(rest)[0] as string;
      label = rest;
    }

    const parent = this.subgraphStack[this.subgraphStack.length - 1] ?? null;
    const sg = makeSubgraph(stripQuotes(id), stripQuotes(label), { parent });
    if (parent === null) this.graph.subgraphs.push(sg);
    else parent.children.push(sg);
    this.subgraphStack.push(sg);
  }

  private closeSubgraph(): void {
    this.subgraphStack.pop();
  }

  private parseDirectionOverride(line: string): void {
    const parts = words(line);
    const current = this.subgraphStack[this.subgraphStack.length - 1];
    const named = (parts[1] ?? "").toUpperCase();
    if (parts.length >= 2 && current !== undefined && named in Direction) {
      current.direction = (Direction as Record<string, Direction>)[named] as Direction;
    }
  }

  private parseClassDef(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    this.graph.classDefs.set(parts[1] as string, parseCssProps(parts[2] as string));
  }

  private parseClassAssignment(line: string): void {
    const parts = words(line);
    if (parts.length < 3) return;
    const node = this.graph.nodes.get(parts[1] as string);
    if (node !== undefined) node.styleClass = parts[2] as string;
  }

  private parseStyle(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    this.graph.nodeStyles.set(parts[1] as string, parseCssProps(parts[2] as string));
  }

  private parseLinkStyle(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    const indices = parts[1] as string;
    const props = parseCssProps(parts[2] as string);
    if (indices.toLowerCase() === "default") {
      this.graph.linkStyles.set(DEFAULT_LINK_STYLE, props);
      return;
    }
    for (const raw of indices.split(",")) {
      const index = raw.trim();
      if (/^\d+$/.test(index)) this.graph.linkStyles.set(Number.parseInt(index, 10), props);
    }
  }

  private parseStatement(line: string): void {
    const segments = this.splitByArrows(line);

    if (segments.length === 1) {
      for (const text of this.splitAmpersand((segments[0] as Segment).text)) {
        const node = this.parseNode(text.trim());
        if (node === null) continue;
        this.graph.addNode(node);
        this.registerInSubgraph(node.id);
      }
      return;
    }

    let prevNodes: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as Segment;
      if (seg.isArrow) continue;

      const currentNodes: string[] = [];
      for (const text of this.splitAmpersand(seg.text)) {
        const node = this.parseNode(text.trim());
        if (node === null) continue;
        this.graph.addNode(node);
        this.registerInSubgraph(node.id);
        currentNodes.push(node.id);
      }

      if (prevNodes.length > 0 && i > 0) {
        const arrow = segments[i - 1] as Segment;
        for (const source of prevNodes) {
          for (const target of currentNodes) {
            this.graph.addEdge(
              makeEdge(source, target, {
                label: arrow.label,
                style: arrow.edgeStyle,
                hasArrowStart: arrow.hasArrowStart,
                hasArrowEnd: arrow.hasArrowEnd,
                arrowTypeStart: arrow.arrowTypeStart,
                arrowTypeEnd: arrow.arrowTypeEnd,
                minLength: arrow.minLength,
              })
            );
          }
        }
      }
      prevNodes = currentNodes;
    }
  }

  private registerInSubgraph(nodeId: string): void {
    const sg = this.subgraphStack[this.subgraphStack.length - 1];
    if (sg !== undefined && !sg.nodeIds.includes(nodeId)) sg.nodeIds.push(nodeId);
  }

  /**
   * An edge naming a SUBGRAPH is written exactly like an edge naming a node, so the node it auto-created is spurious:
   * the edge is marked and the node taken back out, wherever it was registered.
   */
  private resolveSubgraphEdges(): void {
    const ids = new Set<string>();
    const collect = (subs: Subgraph[]): void => {
      for (const sg of subs) {
        ids.add(sg.id);
        collect(sg.children);
      }
    };
    collect(this.graph.subgraphs);
    if (ids.size === 0) return;

    const toRemove = new Set<string>();
    for (const edge of this.graph.edges) {
      if (ids.has(edge.source) && !this.shapedNodeIds.has(edge.source)) {
        edge.sourceIsSubgraph = true;
        toRemove.add(edge.source);
      }
      if (ids.has(edge.target) && !this.shapedNodeIds.has(edge.target)) {
        edge.targetIsSubgraph = true;
        toRemove.add(edge.target);
      }
    }

    const removeFrom = (subs: Subgraph[], id: string): void => {
      for (const sg of subs) {
        const at = sg.nodeIds.indexOf(id);
        if (at !== -1) sg.nodeIds.splice(at, 1);
        removeFrom(sg.children, id);
      }
    };
    for (const id of toRemove) {
      this.graph.nodes.delete(id);
      const at = this.graph.nodeOrder.indexOf(id);
      if (at !== -1) this.graph.nodeOrder.splice(at, 1);
      removeFrom(this.graph.subgraphs, id);
    }
  }

  /** `A & B & C` into three, an `&` inside a label being part of the label. */
  private splitAmpersand(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current: string[] = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i] as string;
      if (OPENERS.includes(ch)) {
        depth++;
        current.push(ch);
      } else if (CLOSERS.includes(ch)) {
        depth = Math.max(0, depth - 1);
        current.push(ch);
      } else if (depth === 0 && ch === AMPERSAND && i > 0 && text[i - 1] === " ") {
        if (i + 1 < text.length && text[i + 1] === " ") {
          const part = current.join("").trimEnd();
          if (part !== "") parts.push(part);
          current = [];
          i += 2;
          continue;
        }
        current.push(ch);
      } else {
        current.push(ch);
      }
      i++;
    }
    const last = current.join("").trim();
    if (last !== "") parts.push(last);
    return parts;
  }

  /** Quoted content blanked out, so an arrow spelled inside a label is not an arrow. */
  private static maskQuotes(text: string): string {
    const out = [...text];
    let inQuote = false;
    for (let i = 0; i < out.length; i++) {
      const ch = out[i] as string;
      if (!inQuote && ch === QUOTE) inQuote = true;
      else if (inQuote && ch === QUOTE) inQuote = false;
      else if (inQuote) out[i] = " ";
    }
    return out.join("");
  }

  /** One line as alternating node groups and arrows. */
  private splitByArrows(line: string): Segment[] {
    const segments: Segment[] = [];
    let remaining = line.trim();

    while (remaining !== "") {
      // Positions come from the MASKED text, the label from the original, or a quoted label would come back blanked.
      const masked = FlowchartParser.maskQuotes(remaining);
      let best: ArrowMatch | null = null;

      const labelled = FlowchartParser.findLabelledArrow(masked);
      if (labelled !== null) {
        const span = remaining.slice(labelled.pos, labelled.end);
        const pipeStart = span.indexOf(PIPE);
        const pipeEnd = span.lastIndexOf(PIPE);
        const label =
          pipeStart >= 0 && pipeEnd > pipeStart ? stripQuotes(span.slice(pipeStart + 1, pipeEnd).trim()) : labelled.label;
        best = { ...labelled, label };
      }

      const plain = FlowchartParser.findPlainArrow(masked);
      if (plain !== null && (best === null || plain.pos < best.pos)) best = plain;

      if (best === null) {
        const text = remaining.trim();
        if (text !== "") segments.push(makeSegment({ text }));
        break;
      }

      const before = remaining.slice(0, best.pos).trim();
      if (before !== "") segments.push(makeSegment({ text: before }));

      segments.push(
        makeSegment({
          text: remaining.slice(best.pos, best.end),
          isArrow: true,
          edgeStyle: best.style,
          hasArrowStart: best.hasStart,
          hasArrowEnd: best.hasEnd,
          arrowTypeStart: best.typeStart,
          arrowTypeEnd: best.typeEnd,
          label: best.label,
          minLength: best.length,
        })
      );

      remaining = remaining.slice(best.end).trim();
    }

    return segments.length > 0 ? segments : [makeSegment({ text: line.trim() })];
  }

  /** An arrow carrying a label, either between pipes or between its two halves. */
  private static findLabelledArrow(text: string): ArrowMatch | null {
    const piped = PIPED_ARROW.exec(text);
    if (piped !== null) {
      const whole = piped[0] as string;
      const arrowPart = text.slice(piped.index, piped.index + whole.indexOf(PIPE));
      const { style, hasStart, hasEnd, typeStart, typeEnd } = FlowchartParser.classifyArrow(`${arrowPart}>`);
      return {
        pos: piped.index,
        end: piped.index + whole.length,
        style,
        hasStart,
        hasEnd,
        label: (piped[5] as string).trim(),
        length: computeArrowLength(arrowPart, style),
        typeStart,
        typeEnd,
      };
    }

    for (const { re, style, hasStart, hasEnd } of SPLIT_ARROWS) {
      const m = re.exec(text);
      if (m === null) continue;
      return {
        pos: m.index,
        end: m.index + (m[0] as string).length,
        style,
        hasStart,
        hasEnd,
        label: (m[2] as string).trim(),
        length: computeArrowLength((m[1] as string) + (m[3] as string), style),
        typeStart: ArrowType.ARROW,
        typeEnd: ArrowType.ARROW,
      };
    }
    return null;
  }

  /** The first plain arrow, the earliest position winning over the more specific pattern. */
  private static findPlainArrow(text: string): ArrowMatch | null {
    let best: ArrowMatch | null = null;
    for (const { re, style, hasStart, hasEnd, typeStart, typeEnd } of PLAIN_ARROWS) {
      const m = re.exec(text);
      if (m === null || (best !== null && m.index >= best.pos)) continue;
      best = {
        pos: m.index,
        end: m.index + (m[0] as string).length,
        style,
        hasStart,
        hasEnd,
        label: "",
        length: MIN_LENGTH,
        typeStart,
        typeEnd,
      };
    }
    if (best === null) return null;
    return { ...best, length: computeArrowLength(text.slice(best.pos, best.end), best.style) };
  }

  /** What an arrow string says about itself: its style, whether each end carries a head, and which head. */
  private static classifyArrow(arrow: string): {
    style: EdgeStyle;
    hasStart: boolean;
    hasEnd: boolean;
    typeStart: ArrowType;
    typeEnd: ArrowType;
  } {
    const s = arrow.trim();
    const hasStart = s.startsWith("<") || s.startsWith("o") || s.startsWith("x");
    const hasEnd = s.endsWith(">") || s.endsWith("x") || s.endsWith("o");
    let typeStart = ArrowType.ARROW;
    let typeEnd = ArrowType.ARROW;
    if (s.startsWith("o")) typeStart = ArrowType.CIRCLE;
    else if (s.startsWith("x")) typeStart = ArrowType.CROSS;
    if (s.endsWith("o")) typeEnd = ArrowType.CIRCLE;
    else if (s.endsWith("x")) typeEnd = ArrowType.CROSS;

    if (s.includes(".")) return { style: EdgeStyle.DOTTED, hasStart, hasEnd, typeStart, typeEnd };
    if (s.includes("=")) return { style: EdgeStyle.THICK, hasStart, hasEnd, typeStart, typeEnd };
    if (s.includes("~")) return { style: EdgeStyle.INVISIBLE, hasStart, hasEnd, typeStart, typeEnd };
    return { style: EdgeStyle.SOLID, hasStart, hasEnd, typeStart, typeEnd };
  }

  /** One node declaration: `A`, `A[label]`, `A{label}`, `A@{shape: diamond}`, with an optional `:::class`. */
  private parseNode(raw: string): Node | null {
    if (raw === "") return null;
    let text = stripChars(raw.trim(), SEMICOLON, false, true);

    let styleClass: string | null = null;
    const classAt = text.lastIndexOf(STYLE_CLASS_MARK);
    if (classAt !== -1) {
      styleClass = text.slice(classAt + STYLE_CLASS_MARK.length).trim();
      text = text.slice(0, classAt).trim();
    }

    const at = AT_SHAPE_RE.exec(text);
    if (at !== null) {
      const id = at[1] as string;
      const props = parseAtShapeProps(at[2] as string);
      const shape = AT_SHAPE_MAP.get(props.get("shape") ?? "rect") ?? NodeShape.RECTANGLE;
      this.shapedNodeIds.add(id);
      return makeNode(id, props.get("label") ?? id, { shape, styleClass });
    }

    for (const [open, close, shape] of SHAPE_PATTERNS) {
      const idx = text.indexOf(open);
      if (idx <= 0 || insideQuotes(text, idx)) continue;
      const rest = text.slice(idx + open.length);
      if (!rest.endsWith(close)) continue;
      const id = text.slice(0, idx).trim();
      if (id === "") continue;
      const rawLabel = rest.slice(0, -close.length).trim();
      this.shapedNodeIds.add(id);
      const md = parseMarkdownLabel(rawLabel);
      if (md !== null) return makeNode(id, md.plain, { shape, styleClass, labelSegments: md.segments });
      return makeNode(id, stripQuotes(rawLabel), { shape, styleClass });
    }

    let id = text.trim();
    if (id === "" || !PLAIN_ID_RE.test(id)) {
      id = stripQuotes(id);
      if (id === "") return null;
    }
    return makeNode(id, id, { shape: NodeShape.RECTANGLE, styleClass });
  }
}

export function parseFlowchart(text: string): Graph {
  return new FlowchartParser(text).parse();
}

/**
 * Whether this text DECLARES the flowchart header, read the way parse() reads it: the first word of the first
 * effective line, comments and blanks skipped. Exported for the dispatch's `declaredType`, since the header words are
 * this parser's own; the parser itself never asks, drawing headerless text being the reference's behaviour.
 */
export function declaresFlowchart(text: string): boolean {
  for (const raw of text.split("\n")) {
    const line = stripComments(raw).trim();
    if (line === "") continue;
    return HEADER_KEYWORDS.includes((words(line)[0] ?? "").toLowerCase());
  }
  return false;
}
