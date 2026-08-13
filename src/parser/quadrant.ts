// Ported from src/termaid/parser/quadrant.py.

import { makeQuadrantChart, type QuadrantChart } from "../model/quadrant.js";
import { splitLines } from "../pycompat.js";

const COMMENT = "%%";
const TITLE = "title ";
const X_AXIS = "x-axis ";
const Y_AXIS = "y-axis ";
/** The four corner names, in the order their keywords are spelled. */
const QUADRANTS = ["quadrant-1 ", "quadrant-2 ", "quadrant-3 ", "quadrant-4 "] as const;
/** The arrow an axis label is written with, shortened for the one line it has to fit on. */
const AXIS_ARROW = " --> ";
const AXIS_DASH = " -> ";
const POINT_RE = /^(.+?):\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/;

/** A mermaid quadrant chart definition. */
export function parseQuadrant(text: string): QuadrantChart {
  const lines = splitLines(text.trim());
  const chart = makeQuadrantChart();
  if (lines.length === 0) return chart;

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = line.trim();
    if (stripped === "") continue;
    const lower = stripped.toLowerCase();
    const after = (keyword: string): string => stripped.slice(keyword.length).trim();

    if (lower.startsWith(TITLE)) {
      chart.title = after(TITLE);
    } else if (lower.startsWith(X_AXIS)) {
      chart.xLabel = after(X_AXIS).replaceAll(AXIS_ARROW, AXIS_DASH);
    } else if (lower.startsWith(Y_AXIS)) {
      chart.yLabel = after(Y_AXIS).replaceAll(AXIS_ARROW, AXIS_DASH);
    } else if (lower.startsWith(QUADRANTS[0])) {
      chart.quadrant1 = after(QUADRANTS[0]);
    } else if (lower.startsWith(QUADRANTS[1])) {
      chart.quadrant2 = after(QUADRANTS[1]);
    } else if (lower.startsWith(QUADRANTS[2])) {
      chart.quadrant3 = after(QUADRANTS[2]);
    } else if (lower.startsWith(QUADRANTS[3])) {
      chart.quadrant4 = after(QUADRANTS[3]);
    } else {
      const point = POINT_RE.exec(stripped);
      if (point !== null) {
        chart.points.push({
          label: (point[1] as string).trim(),
          x: Number.parseFloat(point[2] as string),
          y: Number.parseFloat(point[3] as string),
        });
      }
    }
  }

  return chart;
}
