// Ported from src/termaid/layout/coordinates.py.
//
// Grid positions turned into character positions, and the whole drawing pushed back into positive space where a
// subgraph's border would otherwise sit off the left or the top of the canvas.

import type { GridLayout } from "./grid.js";

/** A cell nothing sized. */
const UNSIZED = 1;
/** The margin a negative bound is pushed past, so a border lands ON the canvas and not against its edge. */
const CLEARANCE = 1;

/** Each node's 3x3 block, in characters: its top-left corner and the three columns and rows it spans. */
export function computeDrawCoords(layout: GridLayout): void {
  for (const placement of layout.placements.values()) {
    const { col, row } = placement.grid;
    const [x, y] = layout.gridToDraw(col - 1, row - 1);
    let width = 0;
    let height = 0;
    for (let d = -1; d <= 1; d++) {
      width += layout.colWidths.get(col + d) ?? UNSIZED;
      height += layout.rowHeights.get(row + d) ?? UNSIZED;
    }
    placement.drawX = x;
    placement.drawY = y;
    placement.drawWidth = width;
    placement.drawHeight = height;
  }
}

/** Everything shifted where a subgraph bound reaches into negative space. */
export function adjustForNegativeBounds(layout: GridLayout): void {
  if (layout.subgraphBounds.length === 0) return;

  let minX = 0;
  let minY = 0;
  for (const sb of layout.subgraphBounds) {
    minX = Math.min(minX, sb.x);
    minY = Math.min(minY, sb.y);
  }
  if (minX >= 0 && minY >= 0) return;

  const dx = minX < 0 ? -minX + CLEARANCE : 0;
  const dy = minY < 0 ? -minY + CLEARANCE : 0;

  for (const p of layout.placements.values()) {
    p.drawX += dx;
    p.drawY += dy;
  }
  for (const sb of layout.subgraphBounds) {
    sb.x += dx;
    sb.y += dy;
  }
  layout.offsetX += dx;
  layout.offsetY += dy;
}
