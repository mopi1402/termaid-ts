// Ported from src/termaid/renderer/packet.py.
//
// Bit-aligned boxes, wrapping to a new strip every row of bits. A label too long for its field is cut and spelled out
// in full underneath, so nothing is lost to the width of the field it sits in.

import { fieldBits, type Packet } from "../model/packet.js";
import { displayWidth, truncateToWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** Character columns one bit takes. */
const BITS_PER_COL = 3;
/** The column the strip starts at. */
const MARGIN = 1;
const EMPTY_SIZE = 1;
/** Rows a strip spends outside its content: the bit numbers and the two borders. */
const STRIP_FRAME = 3;
/** A field narrower than this gets no boundary number: they would run into each other. */
const MIN_NUMBERED_COLS = 4;
/** Room left under the last strip for the legend, before it is measured properly. */
const LEGEND_SLACK = 10;
const CANVAS_SLACK = 4;
/** Columns a label gives up to the two borders around it. */
const LABEL_FRAME = 2;

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_NUMBER = "edge_label";

/** A field's span inside ONE strip: the first and last column, and the label, which only the first strip carries. */
type Span = readonly [number, number, string];

export function renderPacket(diagram: Packet, useAscii = false, rounded = true, paddingY = 1): Canvas {
  if (diagram.fields.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const rowBits = diagram.rowBits;
  const colsPerRow = rowBits * BITS_PER_COL;

  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const [topLeft, topRight, bottomLeft, bottomRight, topJoin, bottomJoin] = useAscii
    ? ["+", "+", "+", "+", "+", "+"]
    : rounded
      ? ["╭", "╮", "╰", "╯", "┬", "┴"]
      : ["┌", "┐", "└", "┘", "┬", "┴"];

  const rows: Span[][] = [];
  for (const field of diagram.fields) {
    let bit = field.start;
    let label = field.label;
    while (bit <= field.end) {
      const index = Math.floor(bit / rowBits);
      const column = bit % rowBits;
      const bits = Math.min(field.end - bit + 1, rowBits - column);
      while (rows.length <= index) rows.push([]);
      (rows[index] as Span[]).push([column, column + bits - 1, label]);
      // A field spilling into the next strip is drawn there without its name: it has already been named above.
      label = "";
      bit += bits;
    }
  }
  while (rows.length > 0 && (rows[rows.length - 1] as Span[]).every(([, , label]) => label === "")) rows.pop();

  const rowHeight = STRIP_FRAME + paddingY;
  const height = rows.length * rowHeight;
  const canvas = new Canvas(MARGIN + colsPerRow + 1 + CANVAS_SLACK, height + LEGEND_SLACK);

  rows.forEach((spans, ri) => {
    const yNumbers = ri * rowHeight;
    const yTop = yNumbers + 1;
    const yBottom = yNumbers + 2 + paddingY;
    const yContent = yTop + Math.floor((paddingY + 1) / 2);
    const rowStartBit = ri * rowBits;

    // Where a number has already been written, so the next one does not land on top of it.
    const taken = new Set<number>();
    const first = spans[0];
    const last = spans[spans.length - 1];

    if (last !== undefined) {
      const label = String(rowStartBit + last[1]);
      const at = MARGIN + (last[1] + 1) * BITS_PER_COL - displayWidth(label);
      canvas.putText(yNumbers, at, label, STYLE_NUMBER);
      for (let px = at; px <= at + displayWidth(label); px++) taken.add(px);
    }

    if (first !== undefined) {
      const label = String(rowStartBit + first[0]);
      const at = MARGIN + first[0] * BITS_PER_COL;
      canvas.putText(yNumbers, at, label, STYLE_NUMBER);
      for (let px = at; px < at + displayWidth(label); px++) taken.add(px);
    }

    for (let fi = 1; fi < spans.length; fi++) {
      const [start, end] = spans[fi] as Span;
      const [previousStart, previousEnd] = spans[fi - 1] as Span;

      if ((previousEnd - previousStart + 1) * BITS_PER_COL >= MIN_NUMBERED_COLS) {
        const label = String(rowStartBit + previousEnd);
        const at = MARGIN + (previousEnd + 1) * BITS_PER_COL - displayWidth(label);
        const columns = range(at, at + displayWidth(label) + 1);
        if (!columns.some((px) => taken.has(px))) {
          canvas.putText(yNumbers, at, label, STYLE_NUMBER);
          for (const px of columns) taken.add(px);
        }
      }

      if ((end - start + 1) * BITS_PER_COL >= MIN_NUMBERED_COLS) {
        const label = String(rowStartBit + start);
        const at = MARGIN + start * BITS_PER_COL + 1;
        const columns = range(at, at + displayWidth(label));
        if (!columns.some((px) => taken.has(px))) {
          canvas.putText(yNumbers, at, label, STYLE_NUMBER);
          for (const px of columns) taken.add(px);
        }
      }
    }

    canvas.put(yTop, MARGIN, topLeft as string, false, STYLE_NODE);
    for (let c = 1; c < colsPerRow; c++) canvas.put(yTop, MARGIN + c, horizontal, false, STYLE_NODE);
    canvas.put(yTop, MARGIN + colsPerRow, topRight as string, false, STYLE_NODE);
    for (const [start] of spans) {
      if (start > 0) canvas.put(yTop, MARGIN + start * BITS_PER_COL, topJoin as string, false, STYLE_NODE);
    }

    for (let py = 0; py < paddingY; py++) {
      const row = yTop + 1 + py;
      canvas.put(row, MARGIN, vertical, false, STYLE_NODE);
      canvas.put(row, MARGIN + colsPerRow, vertical, false, STYLE_NODE);
      for (const [start] of spans) {
        if (start > 0) canvas.put(row, MARGIN + start * BITS_PER_COL, vertical, false, STYLE_NODE);
      }
    }

    for (const [start, end, label] of spans) {
      if (label === "") continue;
      const from = MARGIN + start * BITS_PER_COL;
      const available = MARGIN + (end + 1) * BITS_PER_COL - from - LABEL_FRAME;
      const shown = truncateToWidth(label, available);
      canvas.putText(yContent, from + 1 + Math.floor((available - displayWidth(shown)) / 2), shown, STYLE_LABEL);
    }

    canvas.put(yBottom, MARGIN, bottomLeft as string, false, STYLE_NODE);
    for (let c = 1; c < colsPerRow; c++) canvas.put(yBottom, MARGIN + c, horizontal, false, STYLE_NODE);
    canvas.put(yBottom, MARGIN + colsPerRow, bottomRight as string, false, STYLE_NODE);
    for (const [start] of spans) {
      if (start > 0) canvas.put(yBottom, MARGIN + start * BITS_PER_COL, bottomJoin as string, false, STYLE_NODE);
    }
  });

  const cut = diagram.fields.filter(
    (field) => field.label !== "" && fieldBits(field) * BITS_PER_COL - LABEL_FRAME < displayWidth(field.label)
  );

  if (cut.length > 0) {
    const yLegend = height + 1;
    const needed = yLegend + cut.length + 1;
    if (needed > canvas.height) canvas.resize(canvas.width, needed);
    cut.forEach((field, i) => {
      const available = fieldBits(field) * BITS_PER_COL - LABEL_FRAME;
      const bits = field.start === field.end ? `[${field.start}]` : `[${field.start}-${field.end}]`;
      const shown = `${truncateToWidth(field.label, available)} = ${field.label} ${bits}`;
      canvas.putText(yLegend + i, MARGIN, shown, STYLE_NUMBER);
    });
  }

  return canvas;
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
