// Ported from src/termaid/renderer/blockdiagram.py.
//
// The grid is explicit here, unlike a flowchart's: a block takes the cells its span asks for and wraps to the next row
// when the row it is on has no room left. Groups are drawn first, then the links, then the blocks over both.

import { NodeShape } from "../graph/shapes.js";
import type { Block, BlockDiagram, BlockLink } from "../model/blockdiagram.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";
import { ASCII, UNICODE, type CharSet } from "./charset.js";
import { SHAPE_RENDERERS } from "./shapes.js";

const BLOCK_PAD = 2;
const MIN_BLOCK_W = 12;
const MIN_BLOCK_H = 5;
const COL_GAP = 4;
const ROW_GAP = 2;
const MARGIN = 2;
/** Blank columns and rows kept inside a group, between its border and its children. */
const GROUP_PAD = 2;
/** Both borders of a box, which the group's inner size has to make room for. */
const BORDERS = 2;

/** The smallest canvas a drawing is given, so a link leaving a lone block still lands on it. */
const MIN_CANVAS_W = 20;
const MIN_CANVAS_H = 5;

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const STYLE_GROUP = "subgraph";

const SHAPE_NAMES = new Set<string>(Object.values(NodeShape));

/** One cell of the grid: what sits in it, the column it starts at, and how many it takes. */
type Cell = readonly [Block, number, number];
type Grid = Cell[][];

type Sized = Map<string, [number, number]>;
type Placed = Map<string, [number, number]>;

const sizeOf = (sizes: Sized, id: string): [number, number] => sizes.get(id) ?? [MIN_BLOCK_W, MIN_BLOCK_H];

/** How many columns a row of blocks asks for when none was declared. */
const spanned = (blocks: Block[]): number => blocks.reduce((total, block) => total + block.colSpan, 0);

export function renderBlockDiagram(diagram: BlockDiagram, useAscii = false, paddingX = BLOCK_PAD, gap = COL_GAP): Canvas {
  const cs = useAscii ? ASCII : UNICODE;
  if (diagram.blocks.length === 0) return new Canvas(1, 1);

  const columns = diagram.columns > 0 ? diagram.columns : spanned(diagram.blocks);
  const grid = layoutGrid(diagram.blocks, columns);

  const sizes: Sized = new Map();
  computeAllSizes(diagram.blocks, sizes, paddingX, gap);

  const [colWidths, rowHeights] = gridDimensions(grid, columns, sizes, gap);

  const positions: Placed = new Map();
  computePositions(grid, colWidths, rowHeights, sizes, positions, gap);

  const width = Math.max(
    MIN_CANVAS_W,
    MARGIN * 2 + colWidths.reduce((a, b) => a + b, 0) + gap * Math.max(0, columns - 1)
  );
  const height = Math.max(
    MIN_CANVAS_H,
    MARGIN * 2 + rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * Math.max(0, grid.length - 1)
  );

  const canvas = new Canvas(width, height);
  drawGroups(canvas, diagram.blocks, positions, sizes, cs);
  for (const link of diagram.links) drawLink(canvas, link, positions, sizes, cs, useAscii);
  drawBlocks(canvas, diagram.blocks, positions, sizes, cs);
  return canvas;
}

/** The blocks in rows, each one wrapping to the next row the moment its span does not fit on this one. */
function layoutGrid(blocks: Block[], columns: number): Grid {
  const grid: Grid = [];
  let row: Cell[] = [];
  let col = 0;

  for (const block of blocks) {
    const span = Math.min(block.colSpan, columns);
    if (col + span > columns) {
      if (row.length > 0) grid.push(row);
      row = [];
      col = 0;
    }
    row.push([block, col, span]);
    col += span;
  }
  if (row.length > 0) grid.push(row);
  return grid;
}

function blockSize(block: Block, paddingX: number, colGap: number): [number, number] {
  if (block.isSpace) return [MIN_BLOCK_W, MIN_BLOCK_H];

  if (block.children.length > 0) {
    const innerColumns = block.columns > 0 ? block.columns : spanned(block.children);
    const innerGrid = layoutGrid(block.children, innerColumns);
    const childSizes: Sized = new Map();
    computeAllSizes(block.children, childSizes, paddingX, colGap);
    const [colWidths, rowHeights] = gridDimensions(innerGrid, innerColumns, childSizes, colGap);

    const innerW = colWidths.reduce((a, b) => a + b, 0) + colGap * Math.max(0, innerColumns - 1);
    const innerH = rowHeights.reduce((a, b) => a + b, 0) + ROW_GAP * Math.max(0, innerGrid.length - 1);
    const labelRows = block.label !== "" ? 1 : 0;
    return [
      Math.max(innerW + GROUP_PAD * 2 + BORDERS, MIN_BLOCK_W),
      Math.max(innerH + GROUP_PAD * 2 + BORDERS + labelRows, MIN_BLOCK_H),
    ];
  }

  const label = block.label || block.id;
  return [Math.max(displayWidth(label) + paddingX * 2, MIN_BLOCK_W), MIN_BLOCK_H];
}

function computeAllSizes(blocks: Block[], sizes: Sized, paddingX: number, colGap: number): void {
  for (const block of blocks) {
    sizes.set(block.id, blockSize(block, paddingX, colGap));
    if (block.children.length > 0) computeAllSizes(block.children, sizes, paddingX, colGap);
  }
}

/** Every column's width and every row's height: a lone block sets its column, a spanning one widens what it covers. */
function gridDimensions(grid: Grid, colCount: number, sizes: Sized, colGap: number): [number[], number[]] {
  const colWidths = Array.from({ length: colCount }, () => MIN_BLOCK_W);
  const rowHeights = grid.map(() => MIN_BLOCK_H);

  grid.forEach((row, ri) => {
    for (const [block, startCol, span] of row) {
      const [w, h] = sizeOf(sizes, block.id);
      rowHeights[ri] = Math.max(rowHeights[ri] as number, h);
      if (span === 1) colWidths[startCol] = Math.max(colWidths[startCol] as number, w);
    }
  });

  for (const row of grid) {
    for (const [block, startCol, span] of row) {
      if (span <= 1) continue;
      const [w] = sizeOf(sizes, block.id);
      const available = colWidths.slice(startCol, startCol + span).reduce((a, b) => a + b, 0) + colGap * (span - 1);
      if (w <= available) continue;
      const extra = w - available;
      const perColumn = Math.floor(extra / span);
      const remainder = extra % span;
      for (let c = startCol; c < startCol + span; c++) {
        colWidths[c] = (colWidths[c] as number) + perColumn + (c - startCol < remainder ? 1 : 0);
      }
    }
  }

  return [colWidths, rowHeights];
}

/** Where each track starts, laid out one after another with a gap between them. */
function tracks(lengths: number[], start: number, gap: number): number[] {
  const at: number[] = [];
  let offset = start;
  for (const length of lengths) {
    at.push(offset);
    offset += length + gap;
  }
  return at;
}

function computePositions(
  grid: Grid,
  colWidths: number[],
  rowHeights: number[],
  sizes: Sized,
  positions: Placed,
  colGap: number
): void {
  const colX = tracks(colWidths, MARGIN, colGap);
  const rowY = tracks(rowHeights, MARGIN, ROW_GAP);

  grid.forEach((row, ri) => {
    for (const [block, startCol, span] of row) {
      const x = colX[startCol] as number;
      const y = rowY[ri] as number;

      // A block fills the cells it was given, so its own measured size is replaced by the room it ended up with.
      const endCol = Math.min(startCol + span - 1, colWidths.length - 1);
      const w = span > 1 ? (colX[endCol] as number) + (colWidths[endCol] as number) - x : (colWidths[startCol] as number);
      const h = rowHeights[ri] as number;
      sizes.set(block.id, [w, h]);
      positions.set(block.id, [x, y]);

      if (block.children.length > 0) positionChildren(block, x, y, sizes, positions, colGap);
    }
  });
}

function positionChildren(group: Block, gx: number, gy: number, sizes: Sized, positions: Placed, colGap: number): void {
  const labelRows = group.label !== "" ? 1 : 0;
  const innerColumns = group.columns > 0 ? group.columns : spanned(group.children);
  const innerGrid = layoutGrid(group.children, innerColumns);
  const [colWidths, rowHeights] = gridDimensions(innerGrid, innerColumns, sizes, colGap);

  const colX = tracks(colWidths, gx + GROUP_PAD + 1, colGap);
  const rowY = tracks(rowHeights, gy + GROUP_PAD + 1 + labelRows, ROW_GAP);

  innerGrid.forEach((row, ri) => {
    for (const [block, startCol, span] of row) {
      const x = colX[startCol] as number;
      const y = rowY[ri] as number;
      const endCol = startCol + span - 1;
      const w = span > 1 && endCol < colWidths.length ? (colX[endCol] as number) + (colWidths[endCol] as number) - x : (colWidths[startCol] as number);
      sizes.set(block.id, [w, rowHeights[ri] as number]);
      positions.set(block.id, [x, y]);
      if (block.children.length > 0) positionChildren(block, x, y, sizes, positions, colGap);
    }
  });
}

function drawBlocks(canvas: Canvas, blocks: Block[], positions: Placed, sizes: Sized, cs: CharSet): void {
  for (const block of blocks) {
    if (block.isSpace) continue;
    const at = positions.get(block.id);
    if (at === undefined) continue;
    if (block.children.length > 0) {
      drawBlocks(canvas, block.children, positions, sizes, cs);
      continue;
    }

    const [w, h] = sizeOf(sizes, block.id);
    const name = block.shape.toUpperCase();
    const shape = SHAPE_NAMES.has(name) ? (name as NodeShape) : NodeShape.RECTANGLE;
    const draw = SHAPE_RENDERERS.get(shape) ?? SHAPE_RENDERERS.get(NodeShape.RECTANGLE);
    draw?.(canvas, at[0], at[1], w, h, block.label || block.id, cs, STYLE_NODE);
  }
}

function drawGroups(canvas: Canvas, blocks: Block[], positions: Placed, sizes: Sized, cs: CharSet): void {
  for (const block of blocks) {
    if (block.children.length === 0) continue;
    const at = positions.get(block.id);
    if (at === undefined) continue;

    const [x, y] = at;
    const [w, h] = sizeOf(sizes, block.id);

    canvas.put(y, x, cs.sgTopLeft, true, STYLE_GROUP);
    canvas.put(y, x + w - 1, cs.sgTopRight, true, STYLE_GROUP);
    canvas.put(y + h - 1, x, cs.sgBottomLeft, true, STYLE_GROUP);
    canvas.put(y + h - 1, x + w - 1, cs.sgBottomRight, true, STYLE_GROUP);
    for (let c = x + 1; c < x + w - 1; c++) {
      canvas.put(y, c, cs.sgHorizontal, true, STYLE_GROUP);
      canvas.put(y + h - 1, c, cs.sgHorizontal, true, STYLE_GROUP);
    }
    for (let r = y + 1; r < y + h - 1; r++) {
      canvas.put(r, x, cs.sgVertical, true, STYLE_GROUP);
      canvas.put(r, x + w - 1, cs.sgVertical, true, STYLE_GROUP);
    }

    // An anonymous group has no label of its own, and writes none.
    if (block.label !== "") {
      canvas.putText(y + 1, x + Math.floor((w - displayWidth(block.label)) / 2), block.label, STYLE_LABEL);
    }

    drawGroups(canvas, block.children, positions, sizes, cs);
  }
}

function drawLink(
  canvas: Canvas,
  link: BlockLink,
  positions: Placed,
  sizes: Sized,
  cs: CharSet,
  useAscii: boolean
): void {
  const source = positions.get(link.source);
  const target = positions.get(link.target);
  if (source === undefined || target === undefined) return;

  const [sx, sy] = source;
  const [sw, sh] = sizeOf(sizes, link.source);
  const [tx, ty] = target;
  const [tw, th] = sizeOf(sizes, link.target);

  const sourceMidCol = sx + Math.floor(sw / 2);
  const targetMidCol = tx + Math.floor(tw / 2);
  const sourceMidRow = sy + Math.floor(sh / 2);
  const targetMidRow = ty + Math.floor(th / 2);

  // Which way the link runs is read off the OVERLAP of the two boxes, not off the distance between their centres.
  const horizontalOverlap = Math.min(sx + sw, tx + tw) - Math.max(sx, tx);
  const verticalOverlap = Math.min(sy + sh, ty + th) - Math.max(sy, ty);
  const vertical =
    horizontalOverlap > 0 ||
    (verticalOverlap <= 0 && Math.abs(targetMidCol - sourceMidCol) <= Math.abs(targetMidRow - sourceMidRow));

  let r1: number;
  let c1: number;
  let r2: number;
  let c2: number;

  if (!vertical) {
    const rightward = targetMidCol - sourceMidCol > 0;
    r1 = sourceMidRow;
    c1 = rightward ? sx + sw : sx - 1;
    r2 = targetMidRow;
    c2 = rightward ? tx - 1 : tx + tw;
    drawRoutedLine(canvas, r1, c1, r2, c2, cs.lineHorizontal, cs.lineVertical, useAscii);
    canvas.put(r2, c2, rightward ? cs.arrowRight : cs.arrowLeft, false, STYLE_EDGE);
  } else {
    const downward = targetMidRow - sourceMidRow > 0;
    const exitCol = sourceMidCol;
    // The entry is pulled back inside the target unless the two boxes already share columns.
    const enterCol = horizontalOverlap > 0 ? exitCol : Math.max(tx, Math.min(targetMidCol, sx + sw - 1));

    r1 = downward ? sy + sh : sy - 1;
    c1 = exitCol;
    r2 = downward ? ty - 1 : ty + th;
    c2 = enterCol;

    if (c1 === c2) {
      canvas.drawVertical(c1, r1, r2, cs.lineVertical, STYLE_EDGE);
    } else {
      canvas.drawVertical(c1, r1, r2, cs.lineVertical, STYLE_EDGE);
      canvas.drawHorizontal(r2, c1, c2, cs.lineHorizontal, STYLE_EDGE);
      if (!useAscii) {
        const leftward = c2 < c1;
        canvas.put(r2, c1, r1 < r2 ? (leftward ? "┘" : "└") : leftward ? "┐" : "┌", true, STYLE_EDGE);
      }
    }
    canvas.put(r2, c2, downward ? cs.arrowDown : cs.arrowUp, false, STYLE_EDGE);
  }

  if (link.label === "") return;
  const at = Math.floor((c1 + c2) / 2) - Math.floor(displayWidth(link.label) / 2);
  canvas.putText(Math.floor((r1 + r2) / 2), at, link.label, STYLE_EDGE_LABEL);
}

/** A line between two points, straight where it can be and bent halfway down where it cannot. */
function drawRoutedLine(
  canvas: Canvas,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  hChar: string,
  vChar: string,
  useAscii: boolean
): void {
  if (c1 === c2) {
    canvas.drawVertical(c1, r1, r2, vChar, STYLE_EDGE);
    return;
  }
  if (r1 === r2) {
    canvas.drawHorizontal(r1, c1, c2, hChar, STYLE_EDGE);
    return;
  }

  const midRow = Math.floor((r1 + r2) / 2);
  canvas.drawVertical(c1, r1, midRow, vChar, STYLE_EDGE);
  canvas.drawHorizontal(midRow, c1, c2, hChar, STYLE_EDGE);
  canvas.drawVertical(c2, midRow, r2, vChar, STYLE_EDGE);
  if (useAscii) return;

  const leftward = c2 < c1;
  canvas.put(midRow, c1, r1 < midRow ? (leftward ? "┘" : "└") : leftward ? "┐" : "┌", true, STYLE_EDGE);
  canvas.put(midRow, c2, r2 > midRow ? (leftward ? "┌" : "┐") : leftward ? "└" : "┘", true, STYLE_EDGE);
}
