// Ported from src/termaid/parser/piechart.py.

import { makePieChart, type PieChart } from "../model/piechart.js";
import { pyStrip, splitLines } from "../pycompat.js";

const SHOW_DATA = "showData";
const COMMENT = "%%";
const TITLE = "title ";
const SLICE_RE = /^\s*"([^"]+)"\s*:\s*([0-9]+(?:\.[0-9]*)?)$/;

/**
 * ◉ The title mermaid allows on the HEADER line, which the reference drops on the floor. `parser/piechart.py:26` reads
 * `lines[0]` for the word `showData` and for nothing else, and the loop that reads a title starts at `lines[1:]`, so
 * everything else written after `pie` is gone with no warning: its "unrecognized line" branch never sees the header.
 *
 * A title that vanishes is not a divergence worth reproducing, it is information the author wrote and the reader never
 * gets. So this port reads it, and diverges here on purpose.
 */
const HEADER_TITLE_RE = /\btitle\s+(.+)$/iu;

/** Python's `repr` of a float, which is what a warning about a bad value prints. */
const floatRepr = (value: number): string =>
  Number.isInteger(value) && Number.isFinite(value) && Math.abs(value) < 1e16 ? `${value}.0` : String(value);

/** A mermaid pie chart definition. */
export function parsePieChart(text: string): PieChart {
  const lines = splitLines(pyStrip(text));
  const chart = makePieChart();
  if (lines.length === 0) return chart;

  const header = pyStrip(lines[0] as string);
  if (header.includes(SHOW_DATA)) chart.showData = true;
  const headerTitle = HEADER_TITLE_RE.exec(header);
  if (headerTitle !== null) chart.title = pyStrip(headerTitle[1] as string);

  for (const line of lines.slice(1)) {
    let stripped = pyStrip(line);
    if (stripped === "") continue;

    const comment = stripped.indexOf(COMMENT);
    if (comment >= 0) {
      stripped = pyStrip(stripped.slice(0, comment));
      if (stripped === "") continue;
    }

    if (stripped.toLowerCase().startsWith(TITLE)) {
      chart.title = pyStrip(stripped.slice(TITLE.length));
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
