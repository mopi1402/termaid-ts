// Ported from src/termaid/layout/placement.py.
//
// Where each node's 3x3 block lands on the grid, how wide a column and how tall a row must be to hold what it carries,
// and the room a labelled edge needs in the gap between two layers.

import { Direction, isHorizontal, isVertical, normalized, type Graph } from "../graph/model.js";
import { NodeShape } from "../graph/shapes.js";
import { displayWidth } from "../utils.js";
import {
  cellKey,
  makePlacement,
  MAX_LABEL_WIDTH,
  MAX_NORMALIZED_HEIGHT,
  MAX_NORMALIZED_WIDTH,
  STRIDE,
  type GridCoord,
  type GridLayout,
  type NodePlacement,
} from "./grid.js";

/** A cell nothing sized. */
const UNSIZED = 1;
/** The smallest a node box may be, whatever its label. */
const MIN_CONTENT_WIDTH = 3;
const MIN_CONTENT_HEIGHT = 1;
/** What a gap row must hold for a label to sit beside a vertical segment. */
const LABEL_GAP_ROWS = 3;
/** Rows a label costs where several labelled edges leave one node, plus the spacing between them. */
const ROWS_PER_LABEL = 2;
/** A label written in mermaid with a literal `\n`, which is two characters and not a newline. */
const LITERAL_NEWLINE = "\\n";
const DEFAULT_GAP = 4;

/** Whether the 3x3 block centred here is free of every other node. */
function canPlace(layout: GridLayout, at: GridCoord): boolean {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) if (!layout.isFree(at.col + dc, at.row + dr)) return false;
  }
  return true;
}

/**
 * Every node on the grid, one layer after another, `gapExpansions` widening a gap that has crossing edges to route.
 * A block that would land on another is pushed ACROSS the flow until it finds room.
 */
export function placeNodes(
  graph: Graph,
  layout: GridLayout,
  layerOrder: string[][],
  direction: Direction,
  gapExpansions: Map<number, number> = new Map()
): void {
  const horizontal = isHorizontal(direction);
  let extra = 0;
  layerOrder.forEach((nodes, layer) => {
    if (layer > 0) extra += gapExpansions.get(layer - 1) ?? 0;
    nodes.forEach((id, pos) => {
      let at: GridCoord = horizontal
        ? { col: layer * STRIDE + 1 + extra, row: pos * STRIDE + 1 }
        : { col: pos * STRIDE + 1, row: layer * STRIDE + 1 + extra };

      while (!canPlace(layout, at)) {
        at = horizontal ? { col: at.col, row: at.row + STRIDE } : { col: at.col + STRIDE, row: at.row };
      }

      layout.placements.set(id, makePlacement(id, at));
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) layout.gridOccupied.set(cellKey(at.col + dc, at.row + dr), id);
      }
    });
  });
}

/** A label cut at word boundaries, each line kept under `maxWidth` where a word allows it. */
function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [text];

  const lines: string[] = [];
  let current = words[0] as string;
  for (const word of words.slice(1)) {
    if (displayWidth(current) + 1 + displayWidth(word) <= maxWidth) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

/** Every column a node's block spans, from its width, and every row from its height. */
export function computeSizes(
  graph: Graph,
  layout: GridLayout,
  paddingX: number,
  paddingY: number,
  gap: number = DEFAULT_GAP
): void {
  for (const [id, placement] of layout.placements) {
    const node = graph.nodes.get(id);
    if (node === undefined) continue;
    const { col, row } = placement.grid;

    if (node.shape === NodeShape.JUNCTION) {
      layout.colWidths.set(col, Math.max(layout.colWidths.get(col) ?? UNSIZED, 1));
      layout.rowHeights.set(row, Math.max(layout.rowHeights.get(row) ?? UNSIZED, 1));
      continue;
    }

    const lines = node.label.includes(LITERAL_NEWLINE) ? node.label.split(LITERAL_NEWLINE) : [node.label];
    const wrapped: string[] = [];
    for (const line of lines) {
      if (displayWidth(line) <= MAX_LABEL_WIDTH) wrapped.push(line);
      else wrapped.push(...wordWrap(line, MAX_LABEL_WIDTH));
    }
    // The wrap is kept ON the node: the renderer draws the label this sizing measured, never the original line.
    if (wrapped.length > 1 && wrapped.join(LITERAL_NEWLINE) !== lines.join(LITERAL_NEWLINE)) {
      node.label = wrapped.join(LITERAL_NEWLINE);
    }

    const textWidth = wrapped.length > 0 ? Math.max(...wrapped.map(displayWidth)) : 0;
    const contentWidth = Math.max(textWidth + paddingX, MIN_CONTENT_WIDTH);
    const contentHeight = Math.max(wrapped.length + paddingY, MIN_CONTENT_HEIGHT);

    layout.colWidths.set(col, Math.max(layout.colWidths.get(col) ?? UNSIZED, contentWidth));
    layout.rowHeights.set(row, Math.max(layout.rowHeights.get(row) ?? UNSIZED, contentHeight));
  }

  const allCols = new Set<number>();
  const allRows = new Set<number>();
  for (const placement of layout.placements.values()) {
    for (let d = -1; d <= 1; d++) {
      allCols.add(placement.grid.col + d);
      allRows.add(placement.grid.row + d);
    }
  }
  for (const c of allCols) if (!layout.colWidths.has(c)) layout.colWidths.set(c, 1);
  for (const r of allRows) if (!layout.rowHeights.has(r)) layout.rowHeights.set(r, 1);

  const maxCol = allCols.size > 0 ? Math.max(...allCols) : 0;
  const maxRow = allRows.size > 0 ? Math.max(...allRows) : 0;
  for (let c = 0; c < maxCol + 2; c++) if (!layout.colWidths.has(c)) layout.colWidths.set(c, gap);
  for (let r = 0; r < maxRow + 2; r++) if (!layout.rowHeights.has(r)) layout.rowHeights.set(r, Math.max(gap - 1, 1));

  expandGapsForEdgeLabels(graph, layout);
}

/** The room a labelled edge needs: a wider gap column running across, a taller gap row running down. */
function expandGapsForEdgeLabels(graph: Graph, layout: GridLayout): void {
  const horizontal = isHorizontal(normalized(graph.direction));

  for (const edge of graph.edges) {
    if (edge.label === "") continue;
    const labelLength = displayWidth(edge.label);
    const source = layout.placements.get(edge.source);
    const target = layout.placements.get(edge.target);
    if (source === undefined || target === undefined) continue;

    if (horizontal) {
      const start = Math.min(source.grid.col, target.grid.col) + 2;
      const end = Math.max(source.grid.col, target.grid.col) - 2;
      if (start > end) continue;
      layout.colWidths.set(start, Math.max(layout.colWidths.get(start) ?? DEFAULT_GAP, labelLength + 1));
      continue;
    }

    const start = Math.min(source.grid.row, target.grid.row) + 2;
    const end = Math.max(source.grid.row, target.grid.row) - 2;
    if (start > end) continue;
    layout.rowHeights.set(start, Math.max(layout.rowHeights.get(start) ?? LABEL_GAP_ROWS, LABEL_GAP_ROWS));

    // The line runs in a border column and the label sits one to its right, which lands in the gap column after it.
    const gapCols = new Set<number>();
    if (target.grid.col >= source.grid.col) gapCols.add(source.grid.col + 2);
    if (target.grid.col <= source.grid.col) gapCols.add(source.grid.col - 2);
    const low = Math.min(source.grid.col, target.grid.col);
    const high = Math.max(source.grid.col, target.grid.col);
    for (let c = low + 2; c < high; c += STRIDE) gapCols.add(c);
    for (const c of gapCols) {
      if (c < 0 || !layout.colWidths.has(c)) continue;
      layout.colWidths.set(c, Math.max(layout.colWidths.get(c) as number, labelLength + 1));
    }
  }

  if (horizontal) return;

  // Several labelled edges leaving one node stack their labels in the same gap row, which has to hold them all.
  const labelled = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.label === "") continue;
    labelled.set(edge.source, (labelled.get(edge.source) ?? 0) + 1);
  }
  for (const [id, count] of labelled) {
    if (count < 2) continue;
    const source = layout.placements.get(id);
    if (source === undefined) continue;
    const gapRow = source.grid.row + 2;
    const needed = count * ROWS_PER_LABEL + 1;
    layout.rowHeights.set(gapRow, Math.max(layout.rowHeights.get(gapRow) ?? LABEL_GAP_ROWS, needed));
  }
}

/** Nodes of one layer squared up to the same perpendicular size, so a row of boxes reads as a row. */
export function normalizeSizes(graph: Graph, layout: GridLayout): void {
  const vertical = isVertical(normalized(graph.direction));
  const groups = new Map<number, NodePlacement[]>();
  for (const [id, placement] of layout.placements) {
    const node = graph.nodes.get(id);
    if (node !== undefined && node.shape === NodeShape.JUNCTION) continue;
    const key = vertical ? placement.grid.row : placement.grid.col;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [placement]);
    else bucket.push(placement);
  }

  for (const placements of groups.values()) {
    if (placements.length < 2) continue;
    if (vertical) {
      const cols = new Set(placements.map((p) => p.grid.col));
      const widest = Math.max(...[...cols].map((c) => layout.colWidths.get(c) ?? UNSIZED));
      const target = Math.min(widest, MAX_NORMALIZED_WIDTH);
      for (const c of cols) layout.colWidths.set(c, Math.max(layout.colWidths.get(c) ?? UNSIZED, target));
    } else {
      const rows = new Set(placements.map((p) => p.grid.row));
      const tallest = Math.max(...[...rows].map((r) => layout.rowHeights.get(r) ?? UNSIZED));
      const target = Math.min(tallest, MAX_NORMALIZED_HEIGHT);
      for (const r of rows) layout.rowHeights.set(r, Math.max(layout.rowHeights.get(r) ?? UNSIZED, target));
    }
  }
}
