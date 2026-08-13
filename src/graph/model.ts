// Ported from src/termaid/graph/model.py.
//
// What a parsed diagram IS, before anything is placed or drawn: nodes by id in the order they were written, edges in
// the order they were read, and the subgraph tree. The layout below reads nothing else.

import { NodeShape } from "./shapes.js";

/** A note attached to a node, `position` being "rightof" or "leftof". */
export interface GraphNote {
  text: string;
  position: string;
  target: string;
}

/** A run of a node's label carrying its own emphasis. */
export interface LabelSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** What an edge ends with. */
export enum ArrowType {
  ARROW = "ARROW", // -->
  CIRCLE = "CIRCLE", // --o
  CROSS = "CROSS", // --x
}

/** What an edge is drawn with. */
export enum EdgeStyle {
  SOLID = "SOLID", // -->
  DOTTED = "DOTTED", // -.->
  THICK = "THICK", // ==>
  INVISIBLE = "INVISIBLE", // ~~~
}

/** The direction a graph runs, spelled the way its header spells it. */
export enum Direction {
  TB = "TB",
  TD = "TD",
  LR = "LR",
  BT = "BT",
  RL = "RL",
}

export const isVertical = (d: Direction): boolean =>
  d === Direction.TB || d === Direction.TD || d === Direction.BT;

export const isHorizontal = (d: Direction): boolean => d === Direction.LR || d === Direction.RL;

export const isReversed = (d: Direction): boolean => d === Direction.BT || d === Direction.RL;

/** The non-reversed equivalent: BT reads as TB, RL as LR, and TD is TB under another name. */
export function normalized(d: Direction): Direction {
  if (d === Direction.BT) return Direction.TB;
  if (d === Direction.RL) return Direction.LR;
  if (d === Direction.TD) return Direction.TB;
  return d;
}

export interface Node {
  id: string;
  label: string;
  shape: NodeShape;
  styleClass: string | null;
  labelSegments: LabelSegment[] | null;
}

export function makeNode(id: string, label: string, fields: Partial<Node> = {}): Node {
  return { id, label, shape: NodeShape.RECTANGLE, styleClass: null, labelSegments: null, ...fields };
}

export interface Edge {
  source: string;
  target: string;
  label: string;
  style: EdgeStyle;
  hasArrowStart: boolean;
  hasArrowEnd: boolean;
  arrowTypeStart: ArrowType;
  arrowTypeEnd: ArrowType;
  minLength: number;
  sourceIsSubgraph: boolean;
  targetIsSubgraph: boolean;
}

export function makeEdge(source: string, target: string, fields: Partial<Edge> = {}): Edge {
  return {
    source,
    target,
    label: "",
    style: EdgeStyle.SOLID,
    hasArrowStart: false,
    hasArrowEnd: true,
    arrowTypeStart: ArrowType.ARROW,
    arrowTypeEnd: ArrowType.ARROW,
    minLength: 1,
    sourceIsSubgraph: false,
    targetIsSubgraph: false,
    ...fields,
  };
}

export const isBidirectional = (e: Edge): boolean => e.hasArrowStart && e.hasArrowEnd;
export const isSelfReference = (e: Edge): boolean => e.source === e.target;

export interface Subgraph {
  id: string;
  label: string;
  nodeIds: string[];
  children: Subgraph[];
  direction: Direction | null;
  parent: Subgraph | null;
}

export function makeSubgraph(id: string, label: string, fields: Partial<Subgraph> = {}): Subgraph {
  return { id, label, nodeIds: [], children: [], direction: null, parent: null, ...fields };
}

export class Graph {
  direction: Direction = Direction.TB;
  nodes = new Map<string, Node>();
  edges: Edge[] = [];
  subgraphs: Subgraph[] = [];
  nodeOrder: string[] = [];
  classDefs = new Map<string, Map<string, string>>();
  nodeStyles = new Map<string, Map<string, string>>();
  linkStyles = new Map<number, Map<string, string>>();
  warnings: string[] = [];
  notes: GraphNote[] = [];
  /** Precomputed (col, row), which only an architecture diagram fills in. */
  gridPositions: Map<string, [number, number]> | null = null;

  /** A second sight of the same id ENRICHES the first: a later label or shape wins, a default never overwrites. */
  addNode(node: Node): void {
    const existing = this.nodes.get(node.id);
    if (existing === undefined) {
      this.nodes.set(node.id, node);
      this.nodeOrder.push(node.id);
      return;
    }
    if (node.label !== node.id && existing.label === existing.id) existing.label = node.label;
    if (node.shape !== NodeShape.RECTANGLE) existing.shape = node.shape;
    if (node.styleClass) existing.styleClass = node.styleClass;
  }

  addEdge(edge: Edge): void {
    this.edges.push(edge);
  }

  /** Nodes nothing points at, in definition order, falling back to the first node so a cycle still has a start. */
  getRoots(): string[] {
    const targets = new Set(this.edges.map((e) => e.target));
    const roots = this.nodeOrder.filter((id) => !targets.has(id));
    if (roots.length > 0) return roots;
    const first = this.nodeOrder[0];
    return first === undefined ? [] : [first];
  }

  /** Where this node's outgoing edges land, in order, each target once and never itself. */
  getChildren(nodeId: string): string[] {
    const seen = new Set<string>();
    const children: string[] = [];
    for (const e of this.edges) {
      if (e.source === nodeId && e.target !== nodeId && !seen.has(e.target)) {
        seen.add(e.target);
        children.push(e.target);
      }
    }
    return children;
  }

  findSubgraphById(id: string): Subgraph | null {
    const search = (subs: Subgraph[]): Subgraph | null => {
      for (const sg of subs) {
        if (sg.id === id) return sg;
        const found = search(sg.children);
        if (found !== null) return found;
      }
      return null;
    };
    return search(this.subgraphs);
  }

  /** The INNERMOST subgraph holding the node, children searched before their parent. */
  findSubgraphForNode(nodeId: string): Subgraph | null {
    const search = (subs: Subgraph[]): Subgraph | null => {
      for (const sg of subs) {
        const found = search(sg.children);
        if (found !== null) return found;
        if (sg.nodeIds.includes(nodeId)) return sg;
      }
      return null;
    };
    return search(this.subgraphs);
  }
}
