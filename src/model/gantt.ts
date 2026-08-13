// Ported from src/termaid/model/gantt.py.

import type { CivilDate } from "../pydate.js";

/** The default a `dateFormat` directive overrides, spelled in dayjs tokens the way mermaid spells it. */
export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

export interface GanttTask {
  id: string;
  title: string;
  start: CivilDate | null;
  end: CivilDate | null;
  isDone: boolean;
  isActive: boolean;
  isCrit: boolean;
  isMilestone: boolean;
  /** The id, or ids, this task waits on. */
  after: string;
  /** A duration read off the line, kept until a start is known and the end can be worked out. */
  durationDays?: number;
}

export interface GanttSection {
  title: string;
  tasks: GanttTask[];
}

export interface Gantt {
  title: string;
  dateFormat: string;
  sections: GanttSection[];
  verticalMarkers: CivilDate[];
  todayMarker: boolean;
  warnings: string[];
}

export const makeGantt = (): Gantt => ({
  title: "",
  dateFormat: DEFAULT_DATE_FORMAT,
  sections: [],
  verticalMarkers: [],
  todayMarker: true,
  warnings: [],
});

export const makeGanttSection = (title: string): GanttSection => ({ title, tasks: [] });

export const makeGanttTask = (title: string): GanttTask => ({
  id: "",
  title,
  start: null,
  end: null,
  isDone: false,
  isActive: false,
  isCrit: false,
  isMilestone: false,
  after: "",
});
