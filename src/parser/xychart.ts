// Ported from src/termaid/parser/xychart.py.

import { makeXYChart, makeXYDataset, type XYChart } from "../model/xychart.js";
import { pyFloat, splitLines } from "../pycompat.js";

const COMMENT = "%%";
const HORIZONTAL = "horizontal";
const TITLE = "title ";
const X_AXIS = "x-axis ";
const Y_AXIS = "y-axis ";
const BAR = "bar ";
const LINE = "line ";
const QUOTE = '"';
const SEPARATOR = ",";

/** A number `float()` is guaranteed to accept, which rejects the likes of `0.1.2`. */
const NUM = String.raw`-?\d+(?:\.\d+)?`;
const TITLED_LIST_RE = /^"([^"]+)"\s*\[(.+)\]/;
const BRACKET_LIST_RE = /^\[(.+)\]/;
const TITLED_RANGE_RE = new RegExp(String.raw`^(?:"([^"]+)"|(\S+))\s+(${NUM})\s*-->\s*(${NUM})`);
const RANGE_RE = new RegExp(String.raw`^(${NUM})\s*-->\s*(${NUM})`);

/** A mermaid XY chart definition. */
export function parseXYChart(text: string): XYChart {
  const lines = splitLines(text.trim());
  const chart = makeXYChart();
  if (lines.length === 0) return chart;

  if ((lines[0] as string).trim().toLowerCase().includes(HORIZONTAL)) chart.horizontal = true;

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = line.trim();
    if (stripped === "") continue;
    const lower = stripped.toLowerCase();

    if (lower.startsWith(TITLE)) {
      chart.title = stripQuotes(stripped.slice(TITLE.length).trim());
    } else if (lower.startsWith(X_AXIS)) {
      parseAxis(stripped.slice(X_AXIS.length).trim(), chart, true);
    } else if (lower.startsWith(Y_AXIS)) {
      parseAxis(stripped.slice(Y_AXIS.length).trim(), chart, false);
    } else if (lower.startsWith(BAR)) {
      const values = parseNumberList(stripped.slice(BAR.length).trim());
      if (values.length > 0) chart.datasets.push(makeXYDataset(values, "bar"));
    } else if (lower.startsWith(LINE)) {
      const values = parseNumberList(stripped.slice(LINE.length).trim());
      if (values.length > 0) chart.datasets.push(makeXYDataset(values, "line"));
    }
  }

  return chart;
}

/** An axis line, which is a title, a list of categories, a numeric range, or a title and a range together. */
function parseAxis(rest: string, chart: XYChart, isX: boolean): void {
  const titledList = TITLED_LIST_RE.exec(rest);
  if (titledList !== null) {
    if (isX) {
      chart.xLabel = titledList[1] as string;
      chart.xCategories = (titledList[2] as string).split(SEPARATOR).map((c) => stripQuotes(c.trim()));
    } else {
      chart.yLabel = titledList[1] as string;
    }
    return;
  }

  const list = parseBracketList(rest);
  if (list !== null) {
    if (isX) chart.xCategories = list;
    return;
  }

  const titledRange = TITLED_RANGE_RE.exec(rest);
  if (titledRange !== null) {
    const label = (titledRange[1] ?? titledRange[2]) as string;
    const bounds = [Number.parseFloat(titledRange[3] as string), Number.parseFloat(titledRange[4] as string)] as const;
    if (isX) {
      chart.xLabel = label;
      chart.xRange = bounds;
    } else {
      chart.yLabel = label;
      chart.yRange = bounds;
    }
    return;
  }

  const range = RANGE_RE.exec(rest);
  if (range !== null) {
    const bounds = [Number.parseFloat(range[1] as string), Number.parseFloat(range[2] as string)] as const;
    if (isX) chart.xRange = bounds;
    else chart.yRange = bounds;
    return;
  }

  if (isX) chart.xLabel = stripQuotes(rest);
  else chart.yLabel = stripQuotes(rest);
}

const stripQuotes = (text: string): string =>
  text.length >= 2 && text.startsWith(QUOTE) && text.endsWith(QUOTE) ? text.slice(1, -1) : text;

/** `[one, two]` as its items, or nothing at all where the text is not a list. */
function parseBracketList(text: string): string[] | null {
  const list = BRACKET_LIST_RE.exec(text);
  if (list === null) return null;
  return (list[1] as string)
    .split(SEPARATOR)
    .filter((item) => item.trim() !== "")
    .map((item) => stripQuotes(item.trim()));
}

/** `[1, 2, 3]` as numbers, anything unreadable simply left out. */
function parseNumberList(text: string): number[] {
  const list = BRACKET_LIST_RE.exec(text);
  if (list === null) return [];
  const values: number[] = [];
  for (const item of (list[1] as string).split(SEPARATOR)) {
    const value = pyFloat(item.trim().replace(/^\++/, ""));
    if (value !== null) values.push(value);
  }
  return values;
}
