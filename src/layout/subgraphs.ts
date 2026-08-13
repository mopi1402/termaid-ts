// Ported from src/termaid/layout/subgraphs.py.
//
// The room a subgraph's border and label take between two layers, and the box each subgraph ends up occupying once
// its nodes are placed.

import { Direction, type Graph, type Subgraph } from "../graph/model.js";
import { displayWidth } from "../utils.js";
import { SG_BORDER_PAD, SG_GAP_PER_LEVEL, SG_LABEL_HEIGHT, type GridLayout, type SubgraphBounds } from "./grid.js";

/** What a cross-direction gap holds where two sibling subgraphs meet: two borders and the space between them. */
const SIBLING_GAP = 8;
/** What a gap cell measures before anything widened it, running down and running across. */
const UNSIZED_ROW = 1;
const UNSIZED_COL = 2;
/** The label sits inside the border, with a space either side of it. */
const LABEL_MARGIN = 4;

/** Every subgraph a node sits in, innermost first and up through its parents. */
function chainOf(graph: Graph, nodeId: string): Set<string> {
  const chain = new Set<string>();
  let sg = graph.findSubgraphForNode(nodeId);
  while (sg !== null) {
    chain.add(sg.id);
    sg = sg.parent;
  }
  return chain;
}

/** How many ids are in one set and not the other, which is exactly the number of borders drawn between them. */
function symmetricDifference(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const id of a) if (!b.has(id)) count++;
  for (const id of b) if (!a.has(id)) count++;
  return count;
}

const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

/** Gap cells widened for the borders, labels and nesting a subgraph brings. */
export function expandGapsForSubgraphs(graph: Graph, layout: GridLayout, direction: Direction): void {
  if (graph.subgraphs.length === 0) return;

  const chains = new Map<string, Set<string>>();
  for (const id of graph.nodeOrder) chains.set(id, chainOf(graph, id));

  const vertical = direction === Direction.TB || direction === Direction.TD;

  const flowGroups = new Map<number, string[]>();
  const crossGroups = new Map<number, string[]>();
  const into = (groups: Map<number, string[]>, key: number, id: string): void => {
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [id]);
    else bucket.push(id);
  };
  for (const [id, p] of layout.placements) {
    into(flowGroups, vertical ? p.grid.row : p.grid.col, id);
    into(crossGroups, vertical ? p.grid.col : p.grid.row, id);
  }

  const sortedFlow = [...flowGroups.keys()].sort((a, b) => a - b);
  const sortedCross = [...crossGroups.keys()].sort((a, b) => a - b);

  // A subgraph holding nodes on one side of a gap and not the other has a border IN that gap.
  for (let i = 0; i < sortedFlow.length - 1; i++) {
    const first = sortedFlow[i] as number;
    const second = sortedFlow[i + 1] as number;
    const before = new Set<string>();
    for (const id of flowGroups.get(first) ?? []) for (const sg of chains.get(id) ?? []) before.add(sg);
    const after = new Set<string>();
    for (const id of flowGroups.get(second) ?? []) for (const sg of chains.get(id) ?? []) after.add(sg);

    const borders = symmetricDifference(before, after);
    if (borders === 0) continue;
    const extra = borders * SG_GAP_PER_LEVEL;
    for (let gap = first + 2; gap <= second - 2; gap++) {
      if (vertical) layout.rowHeights.set(gap, Math.max(layout.rowHeights.get(gap) ?? UNSIZED_ROW, extra));
      else layout.colWidths.set(gap, Math.max(layout.colWidths.get(gap) ?? UNSIZED_COL, extra));
    }
  }

  // Across the flow, two neighbours in different subgraphs need room for a border apiece.
  for (let i = 0; i < sortedCross.length - 1; i++) {
    const first = sortedCross[i] as number;
    const second = sortedCross[i + 1] as number;
    const innerOf = (ids: string[]): Set<string> => {
      const inner = new Set<string>();
      for (const id of ids) {
        const sg = graph.findSubgraphForNode(id);
        if (sg !== null) inner.add(sg.id);
      }
      return inner;
    };
    const before = innerOf(crossGroups.get(first) ?? []);
    const after = innerOf(crossGroups.get(second) ?? []);
    if ((before.size === 0 && after.size === 0) || sameSet(before, after)) continue;
    for (let gap = first + 2; gap <= second - 2; gap++) {
      if (vertical) layout.colWidths.set(gap, Math.max(layout.colWidths.get(gap) ?? UNSIZED_COL, SIBLING_GAP));
      else layout.rowHeights.set(gap, Math.max(layout.rowHeights.get(gap) ?? UNSIZED_ROW, SIBLING_GAP));
    }
  }
}

function gatherAllNodes(sg: Subgraph, into: Set<string>): void {
  for (const id of sg.nodeIds) into.add(id);
  for (const child of sg.children) gatherAllNodes(child, into);
}

/** The box each subgraph draws, children measured first since a parent has to contain them. */
export function computeSubgraphBounds(graph: Graph, layout: GridLayout): void {
  const compute = (sg: Subgraph): SubgraphBounds | null => {
    const childBounds: SubgraphBounds[] = [];
    for (const child of sg.children) {
      const bounds = compute(child);
      if (bounds === null) continue;
      childBounds.push(bounds);
      layout.subgraphBounds.push(bounds);
    }

    const ids = new Set(sg.nodeIds);
    for (const child of sg.children) gatherAllNodes(child, ids);
    if (ids.size === 0 && childBounds.length === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;
    for (const id of ids) {
      const p = layout.placements.get(id);
      if (p === undefined) continue;
      minX = Math.min(minX, p.drawX);
      minY = Math.min(minY, p.drawY);
      maxX = Math.max(maxX, p.drawX + p.drawWidth);
      maxY = Math.max(maxY, p.drawY + p.drawHeight);
    }
    for (const cb of childBounds) {
      minX = Math.min(minX, cb.x);
      minY = Math.min(minY, cb.y);
      maxX = Math.max(maxX, cb.x + cb.width);
      maxY = Math.max(maxY, cb.y + cb.height);
    }
    if (minX === Number.POSITIVE_INFINITY) return null;

    const contentWidth = maxX - minX + SG_BORDER_PAD * 2;
    const labelWidth = displayWidth(sg.label) + LABEL_MARGIN;
    return {
      subgraph: sg,
      x: minX - SG_BORDER_PAD,
      y: minY - SG_BORDER_PAD - SG_LABEL_HEIGHT,
      width: Math.max(contentWidth, labelWidth),
      height: maxY - minY + SG_BORDER_PAD * 2 + SG_LABEL_HEIGHT,
    };
  };

  for (const sg of graph.subgraphs) {
    const bounds = compute(sg);
    if (bounds !== null) layout.subgraphBounds.push(bounds);
  }
}
