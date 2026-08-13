// Ported from src/termaid/renderer/quadrant.py.
//
// A 2x2 grid, its four corners named and its points plotted where their coordinates fall. The chart is built in a plain
// character grid first and copied onto the canvas at the end, blanks included, so each quadrant carries its own colour.

import type { QuadrantChart } from "../model/quadrant.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

const CHART_W = 60;
const CHART_H = 20;
/** Left margin, which is where the y-axis label would go. */
const MARGIN_L = 2;
const BLANK = " ";

const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
/** One per quadrant, numbered as the reference numbers them: top right, top left, bottom left, bottom right. */
const sectionStyle = (index: number): string => `section:${index}`;

export function renderQuadrant(diagram: QuadrantChart, useAscii = false): Canvas {
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const cross = useAscii ? "+" : "┼";
  const marker = useAscii ? "*" : "●";

  const titleLines: string[] = [];
  if (diagram.title !== "") {
    const pad = Math.floor((MARGIN_L + CHART_W - [...diagram.title].length) / 2);
    titleLines.push(BLANK.repeat(Math.max(0, pad)) + diagram.title);
    titleLines.push("");
  }

  const halfW = Math.floor(CHART_W / 2);
  const halfH = Math.floor(CHART_H / 2);

  const grid: string[][] = Array.from({ length: CHART_H }, () => Array.from({ length: CHART_W }, () => BLANK));

  placeLabel(grid, diagram.quadrant2, Math.floor(halfW / 2), Math.floor(halfH / 2));
  placeLabel(grid, diagram.quadrant1, halfW + Math.floor(halfW / 2), Math.floor(halfH / 2));
  placeLabel(grid, diagram.quadrant3, Math.floor(halfW / 2), halfH + Math.floor(halfH / 2));
  placeLabel(grid, diagram.quadrant4, halfW + Math.floor(halfW / 2), halfH + Math.floor(halfH / 2));

  for (let c = 0; c < CHART_W; c++) (grid[halfH] as string[])[c] = horizontal;
  for (let r = 0; r < CHART_H; r++) (grid[r] as string[])[halfW] = vertical;
  (grid[halfH] as string[])[halfW] = cross;

  for (const point of diagram.points) {
    const px = Math.min(CHART_W - 1, Math.max(0, Math.trunc(point.x * (CHART_W - 1))));
    // The row runs the other way from the coordinate: y grows upwards, rows grow downwards.
    const py = Math.min(CHART_H - 1, Math.max(0, Math.trunc((1 - point.y) * (CHART_H - 1))));
    (grid[py] as string[])[px] = marker;

    const label = BLANK + point.label;
    const width = displayWidth(label);
    // To the right of the marker, or to its left where the right no longer has room.
    const start = px + 1 + width > CHART_W ? px - width : px + 1;
    if (start >= 0) {
      [...label].forEach((ch, i) => {
        const x = start + i;
        if (x >= 0 && x < CHART_W) (grid[py] as string[])[x] = ch;
      });
    }
  }

  const styles: string[][] = Array.from({ length: CHART_H }, (_, r) =>
    Array.from({ length: CHART_W }, (_, c) => {
      if (r < halfH) return sectionStyle(c < halfW ? 1 : 0);
      return sectionStyle(c < halfW ? 2 : 3);
    })
  );
  for (let c = 0; c < CHART_W; c++) (styles[halfH] as string[])[c] = STYLE_EDGE;
  for (let r = 0; r < CHART_H; r++) (styles[r] as string[])[halfW] = STYLE_EDGE;

  let xLabelLine = "";
  if (diagram.xLabel !== "") {
    const pad = MARGIN_L + Math.floor((CHART_W - [...diagram.xLabel].length) / 2);
    xLabelLine = BLANK.repeat(Math.max(0, pad)) + diagram.xLabel;
  }

  const height = titleLines.length + CHART_H + (xLabelLine !== "" ? 2 : 0);
  const canvas = new Canvas(MARGIN_L + CHART_W + 1, height);

  titleLines.forEach((line, r) => canvas.putText(r, 0, line, STYLE_LABEL));

  // Every cell is written, blanks included: `put` refuses a space, so a blank carries its colour through the style.
  for (let r = 0; r < CHART_H; r++) {
    for (let c = 0; c < CHART_W; c++) {
      const row = titleLines.length + r;
      const col = MARGIN_L + c;
      const ch = (grid[r] as string[])[c] as string;
      const style = (styles[r] as string[])[c] as string;
      if (ch !== BLANK) canvas.put(row, col, ch, false, style);
      else canvas.setStyle(row, col, style);
    }
  }

  if (xLabelLine !== "") canvas.putText(titleLines.length + CHART_H + 1, 0, xLabelLine, STYLE_EDGE_LABEL);

  return canvas;
}

/** A label centred on a column, written straight into the grid and clipped at its edges. */
function placeLabel(grid: string[][], label: string, cx: number, cy: number): void {
  const startX = cx - Math.floor(displayWidth(label) / 2);
  const width = grid.length > 0 ? (grid[0] as string[]).length : 0;
  [...label].forEach((ch, i) => {
    const x = startX + i;
    if (x >= 0 && x < width && cy >= 0 && cy < grid.length) (grid[cy] as string[])[x] = ch;
  });
}
