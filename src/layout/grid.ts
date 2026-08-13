// Ported from src/termaid/layout/grid.py.
//
// Two coordinate systems, and everything below turns on telling them apart.
//
// GRID (col, row): logical positions on a coarse grid. A node owns a 3x3 block centred on its cell, and the eight
// cells around it are border and attachment cells the routing uses.
//
// DRAW (x, y): character positions in the output. A column's width and a row's height vary with content, padding, gap
// and subgraph borders, so one grid cell can span many characters.

import { Direction, Graph, isHorizontal, normalized, type Subgraph } from "../graph/model.js";
import { adjustForNegativeBounds, computeDrawCoords } from "./coordinates.js";
import {
  assignLayers,
  computeGapExpansions,
  expandSubgraphEdges,
  orderLayers,
  separateSubgraphLayers,
} from "./layers.js";
import { computeSizes, normalizeSizes, placeNodes } from "./placement.js";
import { computeSubgraphBounds, expandGapsForSubgraphs } from "./subgraphs.js";

/** Grid distance between two node centres: three cells of block and one of gap. */
export const STRIDE = 4;

/** Characters of label before a wrap. */
export const MAX_LABEL_WIDTH = 20;
/** Caps on the per-layer normalisation, so one long label cannot stretch a whole layer without bound. */
export const MAX_NORMALIZED_WIDTH = 25;
export const MAX_NORMALIZED_HEIGHT = 7;

/** Padding between a subgraph's content and its border. */
export const SG_BORDER_PAD = 2;
/** The subgraph label and the border line under it. */
export const SG_LABEL_HEIGHT = 2;
export const SG_GAP_PER_LEVEL = SG_BORDER_PAD + SG_LABEL_HEIGHT + 1;

/** What a cell measures where nothing sized it. */
const UNSIZED = 1;

export interface GridCoord {
  col: number;
  row: number;
}

export interface NodePlacement {
  nodeId: string;
  grid: GridCoord;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

export function makePlacement(nodeId: string, grid: GridCoord): NodePlacement {
  return { nodeId, grid, drawX: 0, drawY: 0, drawWidth: 0, drawHeight: 0 };
}

export interface SubgraphBounds {
  subgraph: Subgraph;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A grid cell named the way a map can key it, since a pair is not a value in this language. */
export const cellKey = (col: number, row: number): string => `${col},${row}`;

export class GridLayout {
  placements = new Map<string, NodePlacement>();
  colWidths = new Map<number, number>();
  rowHeights = new Map<number, number>();
  /** Which node's 3x3 block owns a cell. */
  gridOccupied = new Map<string, string>();
  canvasWidth = 0;
  canvasHeight = 0;
  subgraphBounds: SubgraphBounds[] = [];
  offsetX = 0;
  offsetY = 0;

  /** Whether a cell is free of every node's block, the excluded ones counting as free. */
  isFree(col: number, row: number, exclude?: Set<string>): boolean {
    if (col < 0 || row < 0) return false;
    const owner = this.gridOccupied.get(cellKey(col, row));
    if (owner === undefined) return true;
    return exclude !== undefined && exclude.size > 0 && exclude.has(owner);
  }

  /** The TOP-LEFT character position of a grid cell. */
  gridToDraw(col: number, row: number): [number, number] {
    let x = this.offsetX;
    for (let c = 0; c < col; c++) x += this.colWidths.get(c) ?? UNSIZED;
    let y = this.offsetY;
    for (let r = 0; r < row; r++) y += this.rowHeights.get(r) ?? UNSIZED;
    return [x, y];
  }

  /** The CENTRE of a grid cell, in character positions. */
  gridToDrawCenter(col: number, row: number): [number, number] {
    const [x, y] = this.gridToDraw(col, row);
    const w = this.colWidths.get(col) ?? UNSIZED;
    const h = this.rowHeights.get(row) ?? UNSIZED;
    return [x + Math.floor(w / 2), y + Math.floor(h / 2)];
  }
}

/**
 * Layers read straight off precomputed positions rather than searched for: an architecture diagram names where every
 * node sits, so a layer is a column running one way and a row running the other.
 */
export function layerOrderFromGrid(graph: Graph): string[][] {
  const positions = graph.gridPositions;
  if (positions === null) return [];
  const horizontal = isHorizontal(normalized(graph.direction));
  const at = (id: string): [number, number] => positions.get(id) ?? [0, 0];
  const layerOf = (id: string): number => (horizontal ? at(id)[0] : at(id)[1]);
  const posOf = (id: string): number => (horizontal ? at(id)[1] : at(id)[0]);

  const byLayer = new Map<number, string[]>();
  for (const id of graph.nodeOrder) {
    const layer = layerOf(id);
    const bucket = byLayer.get(layer);
    if (bucket === undefined) byLayer.set(layer, [id]);
    else bucket.push(id);
  }

  return [...byLayer.keys()]
    .sort((a, b) => a - b)
    .map((layer) => (byLayer.get(layer) as string[]).slice().sort((a, b) => posOf(a) - posOf(b)));
}

/** The minimum a gap may be: below one, an arrow has nowhere to be drawn. */
const MIN_GAP = 1;

export interface LayoutOptions {
  paddingX: number;
  paddingY: number;
  gap: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { paddingX: 4, paddingY: 2, gap: 4 };

/**
 * The whole layout pipeline, in the order the reference runs it: layers, ordering, placement, sizing, subgraph room,
 * draw coordinates, subgraph bounds, then the canvas the renderer will fill.
 */
export function computeLayout(graph: Graph, options: Partial<LayoutOptions> = {}): GridLayout {
  const { paddingX, paddingY } = { ...DEFAULT_LAYOUT, ...options };
  const gap = Math.max(options.gap ?? DEFAULT_LAYOUT.gap, MIN_GAP);

  const layout = new GridLayout();
  const direction: Direction = normalized(graph.direction);
  if (graph.nodeOrder.length === 0) return layout;

  let layerOrder: string[][];
  let gapExpansions = new Map<number, number>();

  if (graph.gridPositions !== null && graph.gridPositions.size > 0) {
    layerOrder = layerOrderFromGrid(graph);
  } else {
    // An edge whose end is a SUBGRAPH is expanded into member-to-member edges, so it constrains the layering, then
    // taken straight back out: the graph the rest of the pipeline reads is the one the author wrote.
    const virtual = expandSubgraphEdges(graph);
    graph.edges.push(...virtual);
    let layers: Map<string, number>;
    try {
      layers = separateSubgraphLayers(graph, assignLayers(graph));
    } finally {
      if (virtual.length > 0) graph.edges.length = graph.edges.length - virtual.length;
    }
    layerOrder = orderLayers(graph, layers);
    gapExpansions = computeGapExpansions(graph, layerOrder);
  }

  placeNodes(graph, layout, layerOrder, direction, gapExpansions);
  computeSizes(graph, layout, paddingX, paddingY, gap);
  normalizeSizes(graph, layout);
  expandGapsForSubgraphs(graph, layout, direction);
  computeDrawCoords(layout);
  computeSubgraphBounds(graph, layout);
  adjustForNegativeBounds(layout);

  let maxX = 0;
  let maxY = 0;
  for (const p of layout.placements.values()) {
    maxX = Math.max(maxX, p.drawX + p.drawWidth);
    maxY = Math.max(maxY, p.drawY + p.drawHeight);
  }
  for (const sb of layout.subgraphBounds) {
    maxX = Math.max(maxX, sb.x + sb.width);
    maxY = Math.max(maxY, sb.y + sb.height);
  }
  layout.canvasWidth = maxX;
  layout.canvasHeight = maxY;
  return layout;
}
