// Ported from src/termaid/renderer/treemap.py.
//
// Nested rectangles, each one as wide as its share of the whole. A node holding children is drawn dashed and its
// children laid out inside it; a leaf is drawn solid and carries its value.

import { totalValue, treemapTotal, type Treemap, type TreemapNode } from "../model/treemap.js";
import { formatG, pyRound } from "../pycompat.js";
import { displayWidth, truncateToWidth } from "../utils.js";
import { Canvas } from "./canvas.js";
import { ASCII, UNICODE, type CharSet } from "./charset.js";

const MIN_BOX_W = 4;
const MIN_BOX_H = 3;
/** The blank column left between two boxes side by side. */
const GAP = 1;
const EMPTY_SIZE = 1;

/** The canvas is widened past the minimum for readability, and capped so a deep tree does not run off a terminal. */
const WIDTH_FACTOR = 1.6;
const WIDTH_FLOOR = 60;
const WIDTH_CEILING = 120;

/** Rows a box spends on itself: its two borders, its label, and one line for a value or a child area. */
const BOX_ROWS = 4;
/** How many passes the width sharing takes before it is called stable. */
const BALANCE_PASSES = 3;

const STYLE_SUBGRAPH = "subgraph";
const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_VALUE = "edge_label";
const ELLIPSIS = "…";

export function renderTreemap(diagram: Treemap, useAscii = false): Canvas {
  const cs = useAscii ? ASCII : UNICODE;
  if (diagram.roots.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  if (treemapTotal(diagram) <= 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const height = computeHeight(diagram.roots);
  const minWidth = computeMinWidth(diagram.roots);
  const width = Math.max(minWidth, Math.min(WIDTH_CEILING, Math.max(WIDTH_FLOOR, Math.trunc(minWidth * WIDTH_FACTOR))));

  const canvas = new Canvas(width, height);
  layoutNodes(canvas, cs, diagram.roots, 0, 0, width, height);
  return canvas;
}

/** The tallest of the siblings, a node holding children being as tall as its children plus its own frame. */
function computeHeight(nodes: TreemapNode[]): number {
  let tallest = 0;
  for (const node of nodes) {
    const own = node.children.length > 0 ? computeHeight(node.children) + BOX_ROWS : BOX_ROWS;
    tallest = Math.max(tallest, own);
  }
  return tallest;
}

/** What the siblings need side by side: their own frames, their children, and the gaps between them. */
function computeMinWidth(nodes: TreemapNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total +=
      node.children.length > 0 ? computeMinWidth(node.children) + 2 : Math.max(MIN_BOX_W, displayWidth(node.label) + 2);
  }
  return total + GAP * Math.max(0, nodes.length - 1);
}

function layoutNodes(canvas: Canvas, cs: CharSet, nodes: TreemapNode[], x: number, y: number, w: number, h: number): void {
  if (nodes.length === 0 || w < MIN_BOX_W || h < MIN_BOX_H) return;
  const total = nodes.reduce((sum, n) => sum + totalValue(n), 0);
  if (total <= 0) return;

  // Biggest first, which is what makes the row read as a proportion rather than as a list.
  const sorted = [...nodes].sort((a, b) => totalValue(b) - totalValue(a));
  sliceLayout(canvas, cs, sorted, x, y, w, h, total);
}

function sliceLayout(
  canvas: Canvas,
  cs: CharSet,
  nodes: TreemapNode[],
  x: number,
  y: number,
  w: number,
  h: number,
  total: number
): void {
  let gaps = nodes.length - 1;
  let usable = w - GAP * gaps;
  // Where the gaps would starve the boxes themselves, the gaps go.
  if (usable < MIN_BOX_W * nodes.length) {
    usable = w;
    gaps = 0;
  }

  const minimums = nodes.map((node) => (node.children.length > 0 ? computeMinWidth(node.children) + 2 : MIN_BOX_W));
  const sizes = nodes.map((node) => (totalValue(node) / total) * usable);

  // A box under its minimum is raised to it, and what it took is charged to the boxes with room to spare.
  for (let pass = 0; pass < BALANCE_PASSES; pass++) {
    let deficit = 0;
    let surplus = 0;
    for (let i = 0; i < sizes.length; i++) {
      const minimum = minimums[i] as number;
      const size = sizes[i] as number;
      if (size < minimum) {
        deficit += minimum - size;
        sizes[i] = minimum;
      } else {
        surplus += size - minimum;
      }
    }
    if (deficit > 0 && surplus > 0) {
      const scale = Math.max(0, 1 - deficit / surplus);
      for (let i = 0; i < sizes.length; i++) {
        const minimum = minimums[i] as number;
        const size = sizes[i] as number;
        if (size > minimum) sizes[i] = minimum + (size - minimum) * scale;
      }
    }
  }

  const widths = sizes.map((size, i) => Math.max(minimums[i] as number, pyRound(size)));
  const drawn = widths.reduce((sum, width) => sum + width, 0);
  if (drawn !== usable) {
    // Whatever the rounding lost or gained lands on the widest box, which is where it shows least.
    let largest = 0;
    for (let i = 1; i < widths.length; i++) if ((widths[i] as number) > (widths[largest] as number)) largest = i;
    widths[largest] = Math.max(minimums[largest] as number, (widths[largest] as number) + (usable - drawn));
  }

  let left = x;
  nodes.forEach((node, i) => {
    const width = Math.min(widths[i] as number, x + w - left);
    if (width < MIN_BOX_W) return;
    drawNode(canvas, cs, node, left, y, width, h);
    left += width + (i < gaps ? GAP : 0);
  });
}

function drawNode(canvas: Canvas, cs: CharSet, node: TreemapNode, x: number, y: number, w: number, h: number): void {
  if (w < MIN_BOX_W || h < MIN_BOX_H) return;

  const isSection = node.children.length > 0;
  const horizontal = isSection ? cs.lineDottedH : cs.horizontal;
  const vertical = isSection ? cs.lineDottedV : cs.vertical;
  const style = isSection ? STYLE_SUBGRAPH : STYLE_NODE;

  canvas.put(y, x, cs.topLeft, false, style);
  for (let c = x + 1; c < x + w - 1; c++) canvas.put(y, c, horizontal, false, style);
  canvas.put(y, x + w - 1, cs.topRight, false, style);

  canvas.put(y + h - 1, x, cs.bottomLeft, false, style);
  for (let c = x + 1; c < x + w - 1; c++) canvas.put(y + h - 1, c, horizontal, false, style);
  canvas.put(y + h - 1, x + w - 1, cs.bottomRight, false, style);

  for (let r = y + 1; r < y + h - 1; r++) {
    canvas.put(r, x, vertical, false, style);
    canvas.put(r, x + w - 1, vertical, false, style);
  }

  const inner = w - 2;
  const label = truncateToWidth(node.label, inner, ELLIPSIS);
  canvas.putText(y + 1, x + 1 + Math.max(0, Math.floor((inner - displayWidth(label)) / 2)), label, STYLE_LABEL);

  if (!isSection && node.value > 0 && h >= BOX_ROWS) {
    const written = [...formatG(node.value)].slice(0, inner).join("");
    canvas.putText(y + 2, x + 1 + Math.max(0, Math.floor((inner - [...written].length) / 2)), written, STYLE_VALUE);
  }

  if (isSection) {
    // The children start below the label and stop above the bottom border.
    const innerHeight = h - 3;
    if (inner >= MIN_BOX_W && innerHeight >= MIN_BOX_H) {
      layoutNodes(canvas, cs, node.children, x + 1, y + 2, inner, innerHeight);
    }
  }
}
