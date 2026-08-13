// Ported from src/termaid/renderer/kanban.py.
//
// Columns side by side, cards stacked inside each one. Every column is drawn to the FULL height of the board, so the
// frames line up whatever each one holds.

import type { Kanban, KanbanColumn } from "../model/kanban.js";
import { displayWidth, truncateToWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** Inset of a card from its column's edges. */
const COL_PAD = 2;
/** The renderer's own default horizontal padding, which is what it keeps unless a caller overrides it. */
const CARD_PAD = 1;
const COL_GAP = 2;
const CARD_GAP = 1;
const EMPTY_SIZE = 1;

/** The narrowest a column is allowed to be, however short its title. */
const MIN_COLUMN = 10;
/** A title needs the two borders and a space each side; a card needs its own two borders inside the column inset. */
const TITLE_FRAME = 4;
const CARD_FRAME = 2;
/** Rows a column spends before its first card: top border, title, separator. */
const HEADER_ROWS = 3;
/** Rows one card takes: top, content, bottom. */
const CARD_ROWS = 3;

/** A card is painted one step in from its column, which is what the theme reads off the suffix. */
const DEEP = ":deep";
const sectionStyle = (index: number): string => `section:${index}`;

export function renderKanban(diagram: Kanban, useAscii = false, paddingX: number = CARD_PAD, gap: number = COL_GAP): Canvas {
  if (diagram.columns.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const widths = diagram.columns.map((col) => {
    const titleWidth = displayWidth(col.title);
    const cardWidths = col.cards.map(
      (card) => displayWidth(card.title) + (card.metadata !== "" ? displayWidth(card.metadata) + 1 : 0)
    );
    const cardWidth = cardWidths.length === 0 ? 0 : Math.max(...cardWidths);
    const need = Math.max(titleWidth + TITLE_FRAME, cardWidth + CARD_FRAME + 2 * COL_PAD);
    return Math.max(need + (paddingX - CARD_PAD) * 2, MIN_COLUMN);
  });

  const heights = diagram.columns.map((col) => {
    const cards = col.cards.length;
    return HEADER_ROWS + cards * CARD_ROWS + Math.max(0, cards - 1) * CARD_GAP + 1;
  });

  const height = Math.max(...heights);
  const width = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  const canvas = new Canvas(width + 1, height + 1);

  let x = 0;
  diagram.columns.forEach((col, i) => {
    const columnWidth = widths[i] as number;
    drawColumn(canvas, col, x, 0, columnWidth, height, useAscii, sectionStyle(i));
    x += columnWidth + gap;
  });

  return canvas;
}

function drawColumn(
  canvas: Canvas,
  col: KanbanColumn,
  x: number,
  y: number,
  w: number,
  h: number,
  useAscii: boolean,
  sectionStyleKey: string
): void {
  const topLeft = useAscii ? "+" : "╭";
  const topRight = useAscii ? "+" : "╮";
  const bottomLeft = useAscii ? "+" : "╰";
  const bottomRight = useAscii ? "+" : "╯";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";

  const cardStyle = sectionStyleKey + DEEP;

  // The whole interior carries the column's colour first, so a theme painting a solid background has no gaps in it.
  for (let r = y + 1; r < y + h - 1; r++) {
    for (let c = x + 1; c < x + w - 1; c++) canvas.setStyle(r, c, sectionStyleKey);
  }

  canvas.putText(y, x, topLeft + horizontal.repeat(w - 2) + topRight, sectionStyleKey);
  canvas.putText(y + h - 1, x, bottomLeft + horizontal.repeat(w - 2) + bottomRight, sectionStyleKey);
  for (let r = y + 1; r < y + h - 1; r++) {
    canvas.put(r, x, vertical, false, sectionStyleKey);
    canvas.put(r, x + w - 1, vertical, false, sectionStyleKey);
  }

  const title = truncateToWidth(col.title, w - TITLE_FRAME);
  canvas.putText(y + 1, x + Math.floor((w - displayWidth(title)) / 2), title, sectionStyleKey);
  canvas.putText(y + 2, x + 1, horizontal.repeat(w - 2), sectionStyleKey);

  const cardTopLeft = useAscii ? "+" : "┌";
  const cardTopRight = useAscii ? "+" : "┐";
  const cardBottomLeft = useAscii ? "+" : "└";
  const cardBottomRight = useAscii ? "+" : "┘";

  let cardY = y + HEADER_ROWS;
  for (const card of col.cards) {
    const cw = w - 2 * COL_PAD;
    const cx = x + COL_PAD;

    canvas.putText(cardY, cx, cardTopLeft + horizontal.repeat(cw - 2) + cardTopRight, cardStyle);
    canvas.put(cardY + 1, cx, vertical, false, cardStyle);
    canvas.put(cardY + 1, cx + cw - 1, vertical, false, cardStyle);
    canvas.putText(cardY + 2, cx, cardBottomLeft + horizontal.repeat(cw - 2) + cardBottomRight, cardStyle);
    for (let c = cx + 1; c < cx + cw - 1; c++) canvas.setStyle(cardY + 1, c, cardStyle);

    const text = card.metadata !== "" ? `${card.title} ${card.metadata}` : card.title;
    canvas.putText(cardY + 1, cx + 1, truncateToWidth(text, cw - CARD_FRAME), cardStyle);

    cardY += CARD_ROWS + CARD_GAP;
  }
}
