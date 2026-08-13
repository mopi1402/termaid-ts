// Ported from src/termaid/parser/statediagram.py.
//
// A state diagram is read into the SAME Graph the flowchart produces, so it reaches the layout, the routing and the
// canvas already written: the only thing new here is the syntax.

import {
  Direction,
  Graph,
  makeEdge,
  makeNode,
  makeSubgraph,
  type Subgraph,
  EdgeStyle,
} from "../graph/model.js";
import { NodeShape } from "../graph/shapes.js";
import { PY_WORD } from "../pycompat.js";

const START_ID = "[*]_start";
const END_ID = "[*]_end";
const HEADER = "stateDiagram";
const COMMENT = "%%";
const CLOSE_BRACE = "}";
const START_MARK = "[*]";

/** What `[*]` is drawn as, entering and leaving. */
const START_LABEL = "●";
const END_LABEL = "◉";

const WORD = PY_WORD;

const NOTE_RE = new RegExp(String.raw`^note\s+(right\s+of|left\s+of)\s+(\S+)\s*:\s*(.*)`, "iu");
const NOTE_PREFIX = "note ";
const BR_RE = /<br\s*\/?>/gi;
const ALIAS_RE = new RegExp(String.raw`^state\s+"([^"]+)"\s+as\s+(\S+)\s*(<<${WORD}+>>)?`, "u");
const STEREOTYPE_RE = new RegExp(String.raw`^state\s+(\S+)\s+(<<${WORD}+>>)`, "u");
const COMPOSITE_RE = /^state\s+"?([^"{}]+)"?\s*\{/u;
const TRANSITION_RE = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.+))?$/u;
const PLAIN_STATE_RE = new RegExp(String.raw`^[a-zA-Z_]${WORD}*$`, "u");
const DIRECTION_PREFIX = "direction ";

const DIRECTIONS = new Set<string>(Object.values(Direction));

/** A mermaid state diagram as a Graph. */
export function parseStateDiagram(text: string): Graph {
  return new StateDiagramParser(text).parse();
}

class StateDiagramParser {
  private graph = new Graph();
  /** An alias to the label it displays under. */
  private aliases = new Map<string, string>();
  private subgraphStack: Subgraph[] = [];
  private startCount = 0;
  private endCount = 0;

  constructor(private text: string) {}

  parse(): Graph {
    const lines = this.preprocess(this.text);
    if (lines.length === 0) return this.graph;

    const header = (lines[0] as string).trim();
    if (header.startsWith(HEADER)) this.graph.direction = Direction.TB;

    for (const line of lines.slice(1)) this.parseLine(line);
    return this.graph;
  }

  /** The lines that carry something, comments cut off wherever they open. */
  private preprocess(text: string): string[] {
    const result: string[] = [];
    for (let line of text.split("\n")) {
      const idx = line.indexOf(COMMENT);
      if (idx >= 0) line = line.slice(0, idx);
      const stripped = line.trim();
      if (stripped !== "") result.push(stripped);
    }
    return result;
  }

  private parseLine(line: string): void {
    const lower = line.trim().toLowerCase();

    if (lower.startsWith(DIRECTION_PREFIX)) {
      const parts = line.split(/\s+/).filter((p) => p !== "");
      const named = (parts[1] ?? "").toUpperCase();
      if (parts.length >= 2 && DIRECTIONS.has(named)) this.graph.direction = named as Direction;
      return;
    }

    if (lower === CLOSE_BRACE) {
      this.subgraphStack.pop();
      return;
    }

    const note = NOTE_RE.exec(line);
    if (note !== null) {
      const position = (note[1] as string).toLowerCase().replaceAll(" ", "");
      const target = note[2] as string;
      const text = (note[3] as string).trim().replace(BR_RE, "\n");
      if (!this.graph.nodes.has(target)) {
        this.ensureNode(target, this.aliases.get(target) ?? target, NodeShape.ROUNDED);
      }
      this.graph.notes.push({ text, position, target });
      return;
    }
    // Every other note form is read and dropped, rather than fall through to the transition matcher below.
    if (lower.startsWith(NOTE_PREFIX)) return;

    const alias = ALIAS_RE.exec(line);
    if (alias !== null) {
      const label = alias[1] as string;
      const id = alias[2] as string;
      this.aliases.set(id, label);
      this.ensureNode(id, label, stereotypeToShape(alias[3]));
      return;
    }

    const stereotyped = STEREOTYPE_RE.exec(line);
    if (stereotyped !== null) {
      const id = stereotyped[1] as string;
      this.ensureNode(id, id, stereotypeToShape(stereotyped[2]));
      return;
    }

    const composite = COMPOSITE_RE.exec(line);
    if (composite !== null) {
      const label = (composite[1] as string).trim();
      const parent = this.subgraphStack[this.subgraphStack.length - 1] ?? null;
      const sg = makeSubgraph(label.replaceAll(" ", "_"), label, { parent });
      if (parent !== null) parent.children.push(sg);
      else this.graph.subgraphs.push(sg);
      this.subgraphStack.push(sg);
      return;
    }

    const transition = TRANSITION_RE.exec(line);
    if (transition !== null) {
      const source = this.resolveState((transition[1] as string).trim(), true);
      const target = this.resolveState((transition[2] as string).trim(), false);
      const label = (transition[3] ?? "").trim();
      this.graph.addEdge(makeEdge(source, target, { label, style: EdgeStyle.SOLID, hasArrowEnd: true }));
      return;
    }

    if (PLAIN_STATE_RE.test(line.trim())) {
      const id = line.trim();
      if (!this.graph.nodes.has(id)) this.ensureNode(id, id, NodeShape.ROUNDED);
    }
  }

  /** `[*]` becomes a fresh endpoint per sighting, so two exits are two circles rather than one shared one. */
  private resolveState(raw: string, isSource: boolean): string {
    if (raw === START_MARK) {
      if (isSource) {
        this.startCount += 1;
        const id = `${START_ID}_${this.startCount}`;
        this.ensureNode(id, START_LABEL, NodeShape.CIRCLE);
        return id;
      }
      this.endCount += 1;
      const id = `${END_ID}_${this.endCount}`;
      this.ensureNode(id, END_LABEL, NodeShape.CIRCLE);
      return id;
    }

    // A shape is only set on a node NEW here, or a stereotype declared earlier would be overwritten by the default.
    if (!this.graph.nodes.has(raw)) {
      this.ensureNode(raw, this.aliases.get(raw) ?? raw, NodeShape.ROUNDED);
    }
    return raw;
  }

  private ensureNode(id: string, label: string, shape: NodeShape): void {
    this.graph.addNode(makeNode(id, label, { shape }));
    const sg = this.subgraphStack[this.subgraphStack.length - 1];
    if (sg !== undefined && !sg.nodeIds.includes(id)) sg.nodeIds.push(id);
  }
}

function stereotypeToShape(stereotype: string | undefined): NodeShape {
  if (stereotype === undefined || stereotype === "") return NodeShape.ROUNDED;
  const s = stereotype.toLowerCase();
  if (s.includes("choice")) return NodeShape.DIAMOND;
  if (s.includes("fork") || s.includes("join")) return NodeShape.FORK_JOIN;
  return NodeShape.ROUNDED;
}
