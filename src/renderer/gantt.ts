// Ported from src/termaid/renderer/gantt.py.
//
// Tasks down the side, time across. Each bar is placed by where its dates fall in the whole span, so the chart says
// nothing about a task with no dates at all.

import type { Gantt } from "../model/gantt.js";
import { formatMonthDay, today, type CivilDate } from "../pydate.js";
import { displayWidth, truncateToWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** The width the chart is drawn at, which the CLI never overrides. */
const DEFAULT_WIDTH = 80;
const EMPTY_SIZE = 1;
/** The narrowest the bar area is allowed to get, whatever the labels take. */
const MIN_CHART_W = 10;
/** Columns the labels leave around themselves, left of the axis. */
const LABEL_MARGIN = 4;
/** Where a task's own label starts, indented under its section. */
const LABEL_COLUMN = 3;
/** Rows under the chart: the axis and the dates on it. */
const AXIS_ROWS = 2;
/** How many dates are written along the axis at most. */
const MAX_TICKS = 6;
const MIN_TICKS = 2;

const STYLE_LABEL = "label";
const STYLE_TASK_LABEL = "edge_label";
const STYLE_EDGE = "edge";
const STYLE_MARKER = "edge_label";
const STYLE_TODAY = "arrow";
const sectionStyle = (index: number): string => `section:${index}`;
const sectionLabelStyle = (index: number): string => `sectionfg:${index}`;

/** How a bar is drawn, which is what its tags say about it. */
type BarStyle = "milestone" | "done" | "active" | "crit" | "normal";

/** A task once it is measured: what it says, when it runs, and how it is drawn. */
type Bar = readonly [string, CivilDate | null, CivilDate | null, BarStyle];

export function renderGantt(diagram: Gantt, useAscii = false, width: number = DEFAULT_WIDTH): Canvas {
  if (diagram.sections.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const barChar = useAscii ? "#" : "█";
  const activeChar = useAscii ? "=" : "▓";
  const doneChar = useAscii ? "." : "░";
  const critChar = useAscii ? "!" : "█";
  const milestoneChar = useAscii ? "*" : "◆";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";

  const grouped: Array<readonly [string, Bar[]]> = [];
  let earliest: CivilDate | null = null;
  let latest: CivilDate | null = null;
  let labelWidth = 0;

  for (const section of diagram.sections) {
    const bars: Bar[] = [];
    for (const task of section.tasks) {
      const style: BarStyle = task.isMilestone
        ? "milestone"
        : task.isDone
          ? "done"
          : task.isActive
            ? "active"
            : task.isCrit
              ? "crit"
              : "normal";
      bars.push([task.title, task.start, task.end, style]);
      labelWidth = Math.max(labelWidth, displayWidth(task.title));
      if (task.start !== null && (earliest === null || task.start < earliest)) earliest = task.start;
      if (task.end !== null && (latest === null || task.end > latest)) latest = task.end;
    }
    grouped.push([section.title, bars]);
    labelWidth = Math.max(labelWidth, displayWidth(section.title) + 2);
  }

  if (earliest === null || latest === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const span = Math.max(1, latest - earliest);

  const marginLeft = labelWidth + LABEL_MARGIN;
  const chartWidth = Math.max(MIN_CHART_W, width - marginLeft - 1);

  const titleRows = diagram.title !== "" ? 2 : 0;
  const taskRows = grouped.reduce((sum, [title, bars]) => sum + bars.length + (title !== "" ? 1 : 0), 0);
  const totalWidth = marginLeft + chartWidth + 1;
  const canvas = new Canvas(totalWidth + 1, titleRows + taskRows + AXIS_ROWS + 1 + 1);

  /** Where a day falls across the chart. */
  const columnOf = (day: CivilDate): number => marginLeft + 1 + Math.trunc(((day - earliest) / span) * (chartWidth - 1));

  if (diagram.title !== "") {
    const at = marginLeft + Math.floor((chartWidth - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, at), diagram.title, STYLE_LABEL);
  }

  let row = titleRows;
  grouped.forEach(([sectionTitle, bars], si) => {
    if (sectionTitle !== "") {
      canvas.putText(row, 1, sectionTitle, sectionLabelStyle(si));
      row += 1;
    }

    for (const [title, start, end, style] of bars) {
      canvas.putText(row, LABEL_COLUMN, truncateToWidth(title, marginLeft - LABEL_MARGIN), STYLE_TASK_LABEL);

      if (start !== null && end !== null) {
        const from = columnOf(start);
        const to = Math.max(columnOf(end), from + 1);
        if (style === "milestone") {
          canvas.put(row, Math.floor((from + to) / 2), milestoneChar, false, sectionStyle(si));
        } else {
          const ch = style === "done" ? doneChar : style === "active" ? activeChar : style === "crit" ? critChar : barChar;
          for (let c = from; c < to; c++) if (c < totalWidth) canvas.put(row, c, ch, false, sectionStyle(si));
        }
      }

      row += 1;
    }
  });

  const axisRow = row;
  for (let r = titleRows; r < axisRow; r++) canvas.put(r, marginLeft, vertical, false, STYLE_EDGE);

  canvas.put(axisRow, marginLeft, useAscii ? "+" : "└", false, STYLE_EDGE);
  for (let c = marginLeft + 1; c < marginLeft + chartWidth; c++) canvas.put(axisRow, c, horizontal, false, STYLE_EDGE);

  const markerVertical = useAscii ? "|" : "┊";
  for (const marker of diagram.verticalMarkers) {
    const offset = marker - earliest;
    if (offset < 0 || offset > span) continue;
    const col = columnOf(marker);
    const label = formatMonthDay(marker);
    const labelRow = titleRows > 0 ? titleRows - 1 : 0;
    canvas.putText(labelRow, Math.max(marginLeft + 1, col - Math.floor(displayWidth(label) / 2)), label, STYLE_MARKER);
    // The marker only shows where the chart is empty or ruled: a bar drawn there keeps the column.
    for (let r = titleRows; r < axisRow; r++) {
      const existing = canvas.get(r, col);
      if (existing === " " || existing === horizontal) canvas.put(r, col, markerVertical, false, STYLE_MARKER);
    }
  }

  if (diagram.todayMarker) {
    const offset = today() - earliest;
    if (offset >= 0 && offset <= span) {
      const col = columnOf(today());
      for (let r = titleRows; r < axisRow; r++) {
        if (canvas.get(r, col) === " ") canvas.put(r, col, useAscii ? "|" : "▎", false, STYLE_TODAY);
      }
    }
  }

  const ticks = Math.max(MIN_TICKS, Math.min(MAX_TICKS, span));
  for (let i = 0; i <= ticks; i++) {
    const label = formatMonthDay(earliest + Math.trunc((i / ticks) * span));
    const col = marginLeft + 1 + Math.trunc((i / ticks) * (chartWidth - 2));
    canvas.put(axisRow, col, useAscii ? "+" : "┬", false, STYLE_EDGE);
    canvas.putText(axisRow + 1, Math.max(0, col - Math.floor(displayWidth(label) / 2)), label, STYLE_MARKER);
  }

  return canvas;
}
