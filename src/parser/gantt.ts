// Ported from src/termaid/parser/gantt.py.

import {
  makeGantt,
  makeGanttSection,
  makeGanttTask,
  type Gantt,
  type GanttSection,
  type GanttTask,
} from "../model/gantt.js";
import { PY_WORD, pyInt, splitLines } from "../pycompat.js";
import { fromYMD, strptime, type CivilDate } from "../pydate.js";

const COMMENT = "%%";
const TITLE = "title ";
const DATE_FORMAT = "dateformat ";
/** Directives that say how to PRINT the chart, which this renderer does not read. */
const IGNORED = ["axisformat ", "excludes ", "tickinterval ", "weekend "];
const TODAY_MARKER = "todaymarker ";
const OFF = "off";
const VERTICAL = "vert ";
const SECTION = "section ";
const AFTER = "after ";
const FIELD = ":";
const SEPARATOR = ",";

/** The tags a task may carry before its fields. */
const DONE = "done";
const ACTIVE = "active";
const CRIT = "crit";
const MILESTONE = "milestone";

/** dayjs tokens as the strptime directives they mean, longest first so `YYYY` is never read as two `YY`. */
const FORMAT_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ["YYYY", "%Y"],
  ["YY", "%y"],
  ["MM", "%m"],
  ["DD", "%d"],
  ["HH", "%H"],
  ["mm", "%M"],
  ["ss", "%S"],
  ["M", "%m"],
  ["D", "%d"],
  ["H", "%H"],
];
const FORMAT_TOKEN_RE = /YYYY|YY|MM|DD|HH|mm|ss|M|D|H/g;

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const DURATION_RE = /^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/;
const ID_RE = new RegExp(String.raw`^[a-zA-Z_]${PY_WORD}*$`, "u");
const NOT_ID_CHAR_RE = /[^a-zA-Z0-9]/g;
/** How long an id made up from the title may be. */
const GENERATED_ID_LENGTH = 20;

const DAYS_PER_WEEK = 7;
/** What a month is worth here, which is a flat count and never a calendar month. */
const DAYS_PER_MONTH = 30;

/** A mermaid gantt definition. */
export function parseGantt(text: string): Gantt {
  const lines = splitLines(text.trim());
  const gantt = makeGantt();
  if (lines.length === 0) return gantt;

  let section: GanttSection | null = null;
  const byId = new Map<string, GanttTask>();

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = line.trim();
    if (stripped === "") continue;
    const lower = stripped.toLowerCase();

    if (lower.startsWith(TITLE)) {
      gantt.title = stripped.slice(TITLE.length).trim();
      continue;
    }

    if (lower.startsWith(DATE_FORMAT)) {
      gantt.dateFormat = stripped.slice(DATE_FORMAT.length).trim();
      continue;
    }

    if (IGNORED.some((directive) => lower.startsWith(directive))) continue;

    if (lower.startsWith(TODAY_MARKER)) {
      if (lower.includes(OFF)) gantt.todayMarker = false;
      continue;
    }

    if (lower.startsWith(VERTICAL)) {
      const marker = parseDate(stripped.slice(VERTICAL.length).trim(), gantt.dateFormat);
      if (marker !== null) gantt.verticalMarkers.push(marker);
      continue;
    }

    if (lower.startsWith(SECTION)) {
      section = makeGanttSection(stripped.slice(SECTION.length).trim());
      gantt.sections.push(section);
      continue;
    }

    if (!stripped.includes(FIELD)) continue;
    const task = parseTask(stripped, gantt.dateFormat);
    if (task === null) continue;

    if (section === null) {
      section = makeGanttSection("");
      gantt.sections.push(section);
    }

    // A task saying nothing about when it starts follows the one written before it.
    const previous = section.tasks[section.tasks.length - 1];
    if (task.start === null && task.after === "" && previous !== undefined && previous.end !== null) {
      task.start = previous.end;
      if (task.end === null && task.durationDays !== undefined) task.end = task.start + task.durationDays;
    }

    section.tasks.push(task);
    if (task.id !== "") byId.set(task.id, task);
  }

  // A chain of `after` resolves one link per pass, so the whole chain needs as many passes as there are tasks.
  for (let pass = 0; pass < byId.size + 1; pass++) {
    let changed = false;
    for (const sec of gantt.sections) {
      for (const task of sec.tasks) {
        if (task.after === "" || task.start !== null) continue;
        let latest: CivilDate | null = null;
        let resolved = true;
        for (const id of task.after.split(/\s+/).filter((part) => part !== "")) {
          const dependency = byId.get(id);
          if (dependency !== undefined && dependency.end !== null) {
            if (latest === null || dependency.end > latest) latest = dependency.end;
          } else {
            resolved = false;
          }
        }
        if (resolved && latest !== null) {
          task.start = latest;
          if (task.end === null && task.durationDays !== undefined) task.end = task.start + task.durationDays;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return gantt;
}

/** One task line: `Title :done, id, 2024-01-01, 2024-01-14`. */
function parseTask(line: string, dateFormat: string): GanttTask | null {
  const at = line.indexOf(FIELD);
  if (at < 0) return null;

  const task = makeGanttTask(line.slice(0, at).trim());
  const parts = line
    .slice(at + 1)
    .trim()
    .split(SEPARATOR)
    .map((part) => part.trim());

  const remaining: string[] = [];
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === DONE) task.isDone = true;
    else if (low === ACTIVE) task.isActive = true;
    else if (low === CRIT) task.isCrit = true;
    else if (low === MILESTONE) task.isMilestone = true;
    else remaining.push(part);
  }

  for (const part of remaining) {
    if (part.toLowerCase().startsWith(AFTER)) {
      task.after = part.slice(AFTER.length).trim();
      continue;
    }

    const duration = parseDuration(part);
    if (duration !== null) {
      task.durationDays = duration;
      if (task.start !== null) task.end = task.start + duration;
      continue;
    }

    const when = parseDate(part, dateFormat);
    if (when !== null) {
      if (task.start === null) task.start = when;
      else task.end = when;
      continue;
    }

    if (task.id === "" && ID_RE.test(part)) task.id = part;
  }

  if (task.id === "") {
    task.id = [...task.title.toLowerCase().replace(NOT_ID_CHAR_RE, "_")].slice(0, GENERATED_ID_LENGTH).join("");
  }

  return task;
}

/** A date, read first the way the diagram said to read it, then as ISO, then as the American order. */
function parseDate(text: string, dateFormat: string): CivilDate | null {
  const stripped = text.trim();

  if (dateFormat !== "") {
    const format = dateFormat.replace(FORMAT_TOKEN_RE, (token) => {
      const known = FORMAT_TOKENS.find(([name]) => name === token);
      return known === undefined ? token : known[1];
    });
    const declared = strptime(stripped, format);
    if (declared !== null) return declared;
  }

  const iso = ISO_RE.exec(stripped);
  if (iso !== null) {
    return fromYMD(
      Number.parseInt(iso[1] as string, 10),
      Number.parseInt(iso[2] as string, 10),
      Number.parseInt(iso[3] as string, 10)
    );
  }

  const american = US_RE.exec(stripped);
  if (american !== null) {
    return fromYMD(
      Number.parseInt(american[3] as string, 10),
      Number.parseInt(american[1] as string, 10),
      Number.parseInt(american[2] as string, 10)
    );
  }

  return null;
}

/** A duration such as `30d`, `2w` or `3m`, always in days. */
function parseDuration(text: string): number | null {
  const duration = DURATION_RE.exec(text.trim().toLowerCase());
  if (duration === null) return null;
  const value = pyInt(duration[1] as string);
  if (value === null) return null;
  const unit = (duration[2] as string)[0];
  if (unit === "d") return value;
  if (unit === "w") return value * DAYS_PER_WEEK;
  if (unit === "m") return value * DAYS_PER_MONTH;
  return null;
}
