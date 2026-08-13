// Ported from src/termaid/parser/piechart.py.

import { makePieChart, type PieChart } from "../model/piechart.js";
import { splitLines } from "../pycompat.js";

const SHOW_DATA = "showData";
const COMMENT = "%%";
const TITLE = "title ";
const SLICE_RE = /^\s*"([^"]+)"\s*:\s*([0-9]+(?:\.[0-9]*)?)$/;

/** Python's `repr` of a float, which is what a warning about a bad value prints. */
const floatRepr = (value: number): string =>
  Number.isInteger(value) && Number.isFinite(value) && Math.abs(value) < 1e16 ? `${value}.0` : String(value);

/** A mermaid pie chart definition. */
export function parsePieChart(text: string): PieChart {
  const lines = splitLines(text.trim());
  const chart = makePieChart();
  if (lines.length === 0) return chart;

  if ((lines[0] as string).trim().includes(SHOW_DATA)) chart.showData = true;

  for (const line of lines.slice(1)) {
    let stripped = line.trim();
    if (stripped === "") continue;

    const comment = stripped.indexOf(COMMENT);
    if (comment >= 0) {
      stripped = stripped.slice(0, comment).trim();
      if (stripped === "") continue;
    }

    if (stripped.toLowerCase().startsWith(TITLE)) {
      chart.title = stripped.slice(TITLE.length).trim();
      continue;
    }

    const slice = SLICE_RE.exec(stripped);
    if (slice !== null) {
      const label = slice[1] as string;
      const value = Number.parseFloat(slice[2] as string);
      if (value <= 0) {
        chart.warnings.push(`Pie slice value must be positive: ${label} = ${floatRepr(value)}`);
        continue;
      }
      chart.slices.push({ label, value });
      continue;
    }

    chart.warnings.push(`Unrecognized line: ${stripped}`);
  }

  return chart;
}
