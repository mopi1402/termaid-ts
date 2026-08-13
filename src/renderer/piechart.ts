// Ported from src/termaid/renderer/piechart.py.
//
// A pie has no honest form in a terminal, so the reference draws bars: one stacked band showing the parts of the whole,
// then one bar per slice.

import type { PieChart } from "../model/piechart.js";
import { formatFixed, formatG, pyRound, rjust } from "../pycompat.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

const FILL_CHARS = ["█", "░", "▒", "▚", "▞", "▄", "▀", "▌"];
const FILL_CHARS_ASCII = ["#", "*", "+", "~", ":", ".", "o", "="];

const BAR_WIDTH = 40;
const MARGIN = 2;
const EMPTY_SIZE = 1;
const PERCENT = 100;
/** The column the percentage is padded to, and the decimals it keeps: `f"{pct:5.1f}%"`. */
const PERCENT_COLUMNS = 5;
const PERCENT_DECIMALS = 1;
/** Rows the stacked band and its labels take before the per-slice bars start. */
const STACKED_ROWS = 4;
/** Below this many columns a segment gets no label at all, not even its percentage. */
const MIN_LABELLED_SEGMENT = 4;

const STYLE_LABEL = "label";
const STYLE_NODE = "node";
const STYLE_EDGE = "edge";

/** A segment of the stacked band: where it starts, how wide it is, and the label it would carry. */
type Segment = readonly [number, number, string];

export function renderPieChart(diagram: PieChart, useAscii = false): Canvas {
  if (diagram.slices.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const total = diagram.slices.reduce((sum, s) => sum + s.value, 0);
  const fills = useAscii ? FILL_CHARS_ASCII : FILL_CHARS;
  const share = (value: number): number => (value / total) * PERCENT;

  const maxLabelLen = Math.max(...diagram.slices.map((s) => displayWidth(s.label)));
  const labelColumns = maxLabelLen + MARGIN;

  const suffixes = diagram.slices.map((s) => {
    const percent = ` ${rjust(formatFixed(share(s.value), PERCENT_DECIMALS), PERCENT_COLUMNS)}%`;
    return diagram.showData ? `${percent}  [${formatG(s.value)}]` : percent;
  });
  const maxSuffixLen = Math.max(...suffixes.map((s) => [...s].length));

  const barLeft = labelColumns;
  const canvasWidth = barLeft + BAR_WIDTH + maxSuffixLen + MARGIN;
  const titleRows = diagram.title !== "" ? 2 : 0;
  const stackedTop = MARGIN + titleRows;
  const barsTop = stackedTop + STACKED_ROWS;
  const canvas = new Canvas(canvasWidth, barsTop + diagram.slices.length + MARGIN);

  if (diagram.title !== "") {
    const column = Math.max(0, Math.floor((canvasWidth - [...diagram.title].length) / 2));
    canvas.putText(MARGIN, column, diagram.title, STYLE_LABEL);
  }

  const stackedLeft = barLeft + 1;
  let column = 0;
  const segments: Segment[] = [];
  diagram.slices.forEach((s, i) => {
    const fill = fills[i % fills.length] as string;
    // The last segment takes whatever is left, so the band is exactly full however the others rounded.
    const segmentWidth =
      i === diagram.slices.length - 1 ? BAR_WIDTH - column : Math.max(1, pyRound((s.value / total) * BAR_WIDTH));
    if (segmentWidth <= 0) return;
    for (let c = 0; c < segmentWidth; c++) canvas.put(stackedTop, stackedLeft + column + c, fill, false, STYLE_NODE);
    segments.push([column, segmentWidth, `${s.label} ${formatFixed(share(s.value), 0)}%`]);
    column += segmentWidth;
  });

  const labelRow = stackedTop + 1;
  for (const [start, segmentWidth, label] of segments) {
    const labelWidth = displayWidth(label);
    if (labelWidth <= segmentWidth) {
      canvas.putText(labelRow, stackedLeft + start + Math.floor((segmentWidth - labelWidth) / 2), label, STYLE_LABEL);
    } else if (segmentWidth >= MIN_LABELLED_SEGMENT) {
      const percentOnly = label.split(/\s+/).filter((p) => p !== "").pop() as string;
      const percentWidth = displayWidth(percentOnly);
      if (percentWidth <= segmentWidth) {
        const at = stackedLeft + start + Math.floor((segmentWidth - percentWidth) / 2);
        canvas.putText(labelRow, at, percentOnly, STYLE_LABEL);
      }
    }
  }

  diagram.slices.forEach((s, i) => {
    const row = barsTop + i;
    const fill = fills[i % fills.length] as string;
    const barLength = Math.max(1, pyRound((s.value / total) * BAR_WIDTH));

    canvas.putText(row, MARGIN, rjust(s.label, maxLabelLen), STYLE_LABEL);
    canvas.put(row, barLeft, useAscii ? "|" : "┃", false, STYLE_EDGE);
    for (let c = 0; c < barLength; c++) canvas.put(row, barLeft + 1 + c, fill, false, STYLE_NODE);
    canvas.putText(row, barLeft + 1 + barLength, suffixes[i] as string, STYLE_LABEL);
  });

  return canvas;
}
