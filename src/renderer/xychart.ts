// Ported from src/termaid/renderer/xychart.py.
//
// Bars and lines on labelled axes. A chart declared horizontal is only drawn that way where it holds bars alone: a
// line needs a continuous axis to say anything.

import type { XYChart } from "../model/xychart.js";
import { formatFixed } from "../pycompat.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** Rows of data in the vertical chart, and columns of it in the horizontal one. */
const CHART_H = 15;
const CHART_W = 50;
const BAR_WIDTH = 4;
const BAR_GAP = 2;
/** Columns left of the axis for the values written down it. */
const MARGIN_L = 8;
/** What tells the label apart from a subtitle: it names the axis running UP the chart. */
const Y_MARK = "↑";
const Y_MARK_ASCII = "^";
/** Turned sideways, the value axis runs across, so its mark points along it. */
const Y_MARK_H = "→";
const Y_MARK_ASCII_H = ">";
const EMPTY_SIZE = 1;
/** How many values are written along an axis, plus the one at the origin. */
const TICKS = 5;
/** Past this much of a row left over, the bar is topped with a half block. */
const HALF_BLOCK_SHARE = 0.3;
/** How many colours the sections cycle through. */
const SECTION_COLOURS = 8;
/** Decimals a value that is not whole is written with. */
const VALUE_DECIMALS = 1;

const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_AXIS_LABEL = "edge_label";
const sectionStyle = (index: number): string => `section:${index % SECTION_COLOURS}`;

export function renderXYChart(diagram: XYChart, useAscii = false, rounded = true): Canvas {
  if (diagram.datasets.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const hasLine = diagram.datasets.some((ds) => ds.chartType === "line");
  if (diagram.horizontal && !hasLine) return renderHorizontal(diagram, useAscii);
  return renderVertical(diagram, useAscii, rounded);
}

/** The value range the chart is drawn against, and how many points sit along it. */
function measured(diagram: XYChart): { low: number; span: number; points: number } | null {
  const values = diagram.datasets.flatMap((ds) => ds.values);
  if (values.length === 0) return null;

  let high = Math.max(...values);
  let low = Math.min(0, ...values);
  if (diagram.yRange !== null) [low, high] = diagram.yRange;
  const span = high - low === 0 ? 1 : high - low;

  return { low, span, points: Math.max(...diagram.datasets.map((ds) => ds.values.length)) };
}

/** The names under the points: the ones declared, then the range spread over them, then plain numbering. */
function categoriesOf(diagram: XYChart, points: number): string[] {
  const categories = diagram.xCategories.slice(0, points);
  if (diagram.xRange !== null && categories.length === 0) {
    const [low, high] = diagram.xRange;
    const step = (high - low) / Math.max(points - 1, 1);
    for (let i = 0; i < points; i++) categories.push(formatValue(low + i * step));
  }
  while (categories.length < points) categories.push(String(categories.length + 1));
  return categories;
}

function renderVertical(diagram: XYChart, useAscii: boolean, rounded: boolean): Canvas {
  const barChar = useAscii ? "#" : "█";
  const barHalf = useAscii ? "=" : "▄";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const corner = useAscii ? "+" : "└";
  const tick = useAscii ? "+" : "┬";
  const leftTick = useAscii ? "+" : "┤";

  const scale = measured(diagram);
  if (scale === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const { low, span, points } = scale;

  const categories = categoriesOf(diagram, points);
  const categoryWidth = categories.length > 0 ? Math.max(...categories.map(displayWidth)) : 2;
  const columnWidth = Math.max(BAR_WIDTH, categoryWidth + 1);

  const chartWidth = points * (columnWidth + BAR_GAP) - BAR_GAP;
  const titleRows = diagram.title !== "" ? 2 : 0;
  // ◉ The y-axis label, parsed into the model by both sides and read by neither renderer: `renderer/xychart.py` names
  // `x_label` six times and `y_label` not once. Given a line of its own under the title, marked with the axis it
  // names, and costing a row only where a chart declares one.
  const yLabelLine = diagram.yLabel === "" ? "" : `${useAscii ? Y_MARK_ASCII : Y_MARK} ${diagram.yLabel}`;
  const headRows = titleRows + (yLabelLine === "" ? 0 : 1);
  const canvas = new Canvas(MARGIN_L + 1 + chartWidth + 2 + 1, CHART_H + 4 + headRows + 1);

  if (diagram.title !== "") {
    const at = MARGIN_L + Math.floor((chartWidth - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, at), diagram.title, STYLE_LABEL);
  }

  if (yLabelLine !== "") canvas.putText(titleRows, 0, yLabelLine, STYLE_AXIS_LABEL);

  for (let i = 0; i <= TICKS; i++) {
    const label = formatValue(low + (span * (TICKS - i)) / TICKS);
    const row = headRows + Math.floor((i * CHART_H) / TICKS);
    canvas.putText(row, Math.max(0, MARGIN_L - displayWidth(label) - 1), label, STYLE_AXIS_LABEL);
    canvas.put(row, MARGIN_L, leftTick, false, STYLE_EDGE);
  }

  for (let r = headRows; r <= headRows + CHART_H; r++) canvas.put(r, MARGIN_L, vertical, false, STYLE_EDGE);

  const axisRow = headRows + CHART_H;
  canvas.put(axisRow, MARGIN_L, corner, false, STYLE_EDGE);
  for (let c = MARGIN_L + 1; c < MARGIN_L + 1 + chartWidth; c++) canvas.put(axisRow, c, horizontal, false, STYLE_EDGE);

  const columnOf = (i: number): number => MARGIN_L + 1 + i * (columnWidth + BAR_GAP);
  const heightOf = (value: number): number => Math.trunc(((value - low) / span) * CHART_H);

  for (const ds of diagram.datasets) {
    ds.values.forEach((value, i) => {
      if (i >= points) return;
      const left = columnOf(i);
      const bars = heightOf(value);

      if (ds.chartType === "bar") {
        for (let r = 0; r < bars; r++) {
          for (let c = 0; c < columnWidth; c++) {
            canvas.put(headRows + CHART_H - 1 - r, left + c, barChar, false, sectionStyle(i));
          }
        }
        const leftover = ((value - low) / span) * CHART_H - bars;
        if (leftover > HALF_BLOCK_SHARE && bars < CHART_H) {
          for (let c = 0; c < columnWidth; c++) {
            canvas.put(headRows + CHART_H - 1 - bars, left + c, barHalf, false, sectionStyle(i));
          }
        }
        return;
      }

      const row = headRows + CHART_H - 1 - Math.max(0, bars - 1);
      const middle = left + Math.floor(columnWidth / 2);
      canvas.put(row, middle, horizontal, false, STYLE_EDGE);

      if (i > 0) {
        const previous = heightOf(ds.values[i - 1] as number);
        const previousRow = headRows + CHART_H - 1 - Math.max(0, previous - 1);
        const previousMiddle = columnOf(i - 1) + Math.floor(columnWidth / 2);
        connect(canvas, previousMiddle, previousRow, middle, row, useAscii, rounded);
      }
    });
  }

  categories.forEach((category, i) => {
    const at = columnOf(i) + Math.floor(columnWidth / 2);
    canvas.put(axisRow, at, tick, false, STYLE_EDGE);
    canvas.putText(axisRow + 1, Math.max(0, at - Math.floor(displayWidth(category) / 2)), category, STYLE_AXIS_LABEL);
  });

  if (diagram.xLabel !== "") {
    const at = MARGIN_L + 1 + Math.floor((chartWidth - displayWidth(diagram.xLabel)) / 2);
    canvas.putText(axisRow + 2, Math.max(0, at), diagram.xLabel, STYLE_AXIS_LABEL);
  }

  return canvas;
}

function renderHorizontal(diagram: XYChart, useAscii: boolean): Canvas {
  const barChar = useAscii ? "#" : "█";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const corner = useAscii ? "+" : "└";
  const bottomTick = useAscii ? "+" : "┬";

  const scale = measured(diagram);
  if (scale === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const { low, span, points } = scale;

  const categories = categoriesOf(diagram, points);
  const categoryWidth = categories.length > 0 ? Math.max(...categories.map(displayWidth)) : 2;
  const marginLeft = categoryWidth + 2;

  // One row per bar, one blank row between them.
  const chartHeight = points * 2 - 1;
  const titleRows = diagram.title !== "" ? 2 : 0;
  // ◉ Same label, same silence on the reference's side, and the same line of its own here. Turned sideways the value
  // axis is the one running ACROSS, so the mark points the way this chart actually reads.
  const yLabelLine = diagram.yLabel === "" ? "" : `${useAscii ? Y_MARK_ASCII_H : Y_MARK_H} ${diagram.yLabel}`;
  const headRows = titleRows + (yLabelLine === "" ? 0 : 1);
  const canvas = new Canvas(marginLeft + 1 + CHART_W + 2 + 1, headRows + chartHeight + 3 + 1);

  if (diagram.title !== "") {
    const at = marginLeft + Math.floor((CHART_W - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, at), diagram.title, STYLE_LABEL);
  }
  if (yLabelLine !== "") canvas.putText(titleRows, 0, yLabelLine, STYLE_AXIS_LABEL);

  for (let r = headRows; r <= headRows + chartHeight; r++) canvas.put(r, marginLeft, vertical, false, STYLE_EDGE);

  const axisRow = headRows + chartHeight;
  canvas.put(axisRow, marginLeft, corner, false, STYLE_EDGE);
  for (let c = marginLeft + 1; c < marginLeft + 1 + CHART_W; c++) canvas.put(axisRow, c, horizontal, false, STYLE_EDGE);

  for (let i = 0; i <= TICKS; i++) {
    const label = formatValue(low + (span * i) / TICKS);
    const col = marginLeft + 1 + Math.trunc((i / TICKS) * (CHART_W - 1));
    canvas.put(axisRow, col, bottomTick, false, STYLE_EDGE);
    canvas.putText(axisRow + 1, Math.max(0, col - Math.floor(displayWidth(label) / 2)), label, STYLE_AXIS_LABEL);
  }

  if (diagram.xLabel !== "") {
    const at = marginLeft + 1 + Math.floor((CHART_W - displayWidth(diagram.xLabel)) / 2);
    canvas.putText(axisRow + 2, Math.max(0, at), diagram.xLabel, STYLE_AXIS_LABEL);
  }

  for (const ds of diagram.datasets) {
    ds.values.forEach((value, i) => {
      if (i >= points) return;
      const row = headRows + i * 2;
      const bars = Math.trunc(((value - low) / span) * CHART_W);

      const category = categories[i] ?? "";
      canvas.putText(row, Math.max(0, marginLeft - displayWidth(category) - 1), category, STYLE_AXIS_LABEL);
      for (let c = 0; c < bars; c++) canvas.put(row, marginLeft + 1 + c, barChar, false, sectionStyle(i));
    });
  }

  return canvas;
}

/** The elbow between two points of a line, drawn halfway along and then down or up. */
function connect(
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  useAscii: boolean,
  rounded: boolean
): void {
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const [topLeft, topRight, bottomLeft, bottomRight] = useAscii
    ? ["+", "+", "+", "+"]
    : rounded
      ? ["╭", "╮", "╰", "╯"]
      : ["┌", "┐", "└", "┘"];

  if (y1 === y2) {
    for (let x = x1 + 1; x < x2; x++) canvas.put(y1, x, horizontal, false, STYLE_EDGE);
    return;
  }

  const middle = Math.floor((x1 + x2) / 2);
  const up = y2 < y1;

  for (let x = x1 + 1; x < middle; x++) canvas.put(y1, x, horizontal, false, STYLE_EDGE);
  canvas.put(y1, middle, (up ? bottomRight : topRight) as string, false, STYLE_EDGE);
  for (let r = Math.min(y1, y2) + 1; r < Math.max(y1, y2); r++) canvas.put(r, middle, vertical, false, STYLE_EDGE);
  canvas.put(y2, middle, (up ? topLeft : bottomLeft) as string, false, STYLE_EDGE);
  for (let x = middle + 1; x < x2; x++) canvas.put(y2, x, horizontal, false, STYLE_EDGE);
}

/** A value as the axis writes it: whole numbers bare, everything else to one decimal. */
function formatValue(value: number): string {
  return value === Math.trunc(value) ? String(Math.trunc(value)) : formatFixed(value, VALUE_DECIMALS);
}
