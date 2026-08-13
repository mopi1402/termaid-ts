// Ported from src/termaid/renderer/gitgraph.py.
//
// One line per branch, one marker per commit, with the vertical joins where a branch forks or is merged back. Markers
// and labels are drawn LAST, so a line never runs over the commit it belongs to.

import type { Commit, CommitType, GitGraph } from "../model/gitgraph.js";
import { Canvas } from "./canvas.js";
import { ASCII, UNICODE, type CharSet } from "./charset.js";
import { displayWidth } from "../utils.js";

/** The least room between two commit markers, whatever their labels take. */
const MIN_COMMIT_GAP = 6;
const BRANCH_GAP = 2;
const MARGIN = 2;
/** Blank columns kept between the labels of two commits side by side. */
const LABEL_PAD = 2;
const EMPTY_SIZE = 1;

const MARKERS: Readonly<Record<CommitType, string>> = { NORMAL: "●", REVERSE: "✖", HIGHLIGHT: "■" };
const MARKERS_ASCII: Readonly<Record<CommitType, string>> = { NORMAL: "o", REVERSE: "X", HIGHLIGHT: "#" };

const STYLE_BRANCH = "subgraph";
const STYLE_EDGE = "edge";
const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_TAG = "edge_label";

/** Where the main branch sorts, which is before every other however they were ordered. */
const MAIN_FIRST = -2;
/** Where a branch with no declared order sorts: after every declared one, in the order it appeared. */
const UNORDERED_BASE = 1000;

/** Rows a branch takes, its line and the gap under it. */
const ROW_HEIGHT = BRANCH_GAP + 1;
/** Rows between two commits down a vertical drawing, and the columns a label is given. */
const TB_ROW_GAP = 4;
const TB_MIN_COL_GAP = 10;
const TB_LABEL_ROOM = 4;
const TB_LABEL_MARGIN = 2;
/** Columns the two brackets of a tag take. */
const TAG_BRACKETS = 2;

const markerOf = (type: CommitType, useAscii: boolean): string =>
  (useAscii ? MARKERS_ASCII : MARKERS)[type] ?? (useAscii ? MARKERS_ASCII.NORMAL : MARKERS.NORMAL);

const tagText = (tag: string): string => `[${tag}]`;

/** Main first, then whatever order was asked for, then the order they were written in. */
function sortedBranches(diagram: GitGraph): string[] {
  return diagram.branches
    .map((branch, i) => ({
      key: branch.name === diagram.mainBranchName ? MAIN_FIRST : branch.order >= 0 ? branch.order : UNORDERED_BASE + i,
      i,
      name: branch.name,
    }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ name }) => name);
}

/** Half of the widest thing written under or over a commit, which is what keeps two of them apart. */
function footprint(commit: Commit): number {
  let width = [...commit.id].length;
  if (commit.tag !== "") width = Math.max(width, [...commit.tag].length + TAG_BRACKETS);
  return Math.floor((width + 1) / 2);
}

export function renderGitGraph(diagram: GitGraph, useAscii = false): Canvas {
  const cs = useAscii ? ASCII : UNICODE;
  if (diagram.commits.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  if (diagram.direction === "TB" || diagram.direction === "BT") {
    return drawVertical(diagram, useAscii, cs, diagram.direction === "BT");
  }
  return drawHorizontal(diagram, useAscii, cs);
}

/** Each commit's own column, spaced so its label never runs into the one before it. */
function columnsOf(commits: Commit[], leftOffset: number): Map<string, number> {
  const columns = new Map<string, number>();
  const first = commits[0];
  if (first === undefined) return columns;

  columns.set(first.id, leftOffset + footprint(first));
  for (let i = 1; i < commits.length; i++) {
    const previous = commits[i - 1] as Commit;
    const current = commits[i] as Commit;
    const gap = Math.max(MIN_COMMIT_GAP, footprint(previous) + LABEL_PAD + footprint(current));
    columns.set(current.id, (columns.get(previous.id) as number) + gap);
  }
  return columns;
}

/** The commits of each branch, in the order the branches are drawn. */
function grouped(diagram: GitGraph, branches: string[]): Map<string, Commit[]> {
  const byBranch = new Map<string, Commit[]>();
  for (const name of branches) byBranch.set(name, []);
  for (const commit of diagram.commits) byBranch.get(commit.branch)?.push(commit);
  return byBranch;
}

function drawHorizontal(diagram: GitGraph, useAscii: boolean, cs: CharSet): Canvas {
  const branches = sortedBranches(diagram);
  const rows = new Map<string, number>();
  branches.forEach((name, i) => rows.set(name, MARGIN + i * ROW_HEIGHT));

  const labelWidth = Math.max(0, ...branches.map((name) => [...name].length));
  const leftOffset = MARGIN + labelWidth + 2;
  const columns = columnsOf(diagram.commits, leftOffset);

  const last = diagram.commits[diagram.commits.length - 1];
  const lastColumn = columns.size === 0 ? leftOffset : Math.max(...columns.values());
  const width = lastColumn + (last === undefined ? 0 : footprint(last)) + MARGIN + 1;
  const canvas = new Canvas(width, MARGIN + branches.length * ROW_HEIGHT + MARGIN);

  const byBranch = grouped(diagram, branches);
  const byId = new Map(diagram.commits.map((commit) => [commit.id, commit]));
  const lineStart = MARGIN + labelWidth + 1;

  // Each branch line runs from its first commit to its last, then out to any commit that merged it.
  const extents = new Map<string, [number, number]>();
  for (const [name, commits] of byBranch) {
    const first = commits[0];
    const final = commits[commits.length - 1];
    if (first === undefined || final === undefined) continue;
    const start = name === diagram.mainBranchName ? lineStart : (columns.get(first.id) as number);
    extents.set(name, [start, (columns.get(final.id) as number) + 1]);
  }
  for (const commit of diagram.commits) {
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.branch === commit.branch) continue;
      const extent = extents.get(parent.branch);
      if (extent !== undefined) extent[1] = Math.max(extent[1], columns.get(commit.id) as number);
    }
  }

  for (const name of branches) canvas.putText(rows.get(name) as number, MARGIN, name, STYLE_BRANCH);

  for (const name of branches) {
    const extent = extents.get(name);
    if (extent === undefined) continue;
    canvas.drawHorizontal(rows.get(name) as number, extent[0], extent[1], cs.lineHorizontal, STYLE_EDGE);
  }

  for (const commit of diagram.commits) {
    const column = columns.get(commit.id) as number;
    const to = rows.get(commit.branch) as number;
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.branch === commit.branch) continue;
      const from = rows.get(parent.branch) as number;
      if (from === to) continue;
      for (let r = Math.min(from, to); r <= Math.max(from, to); r++) {
        canvas.put(r, column, cs.lineVertical, true, STYLE_EDGE);
      }
    }
  }

  for (const commit of diagram.commits) {
    const column = columns.get(commit.id) as number;
    const row = rows.get(commit.branch) as number;
    canvas.put(row, column, markerOf(commit.type, useAscii), false, STYLE_NODE);
    canvas.putText(row + 1, column - Math.floor(displayWidth(commit.id) / 2), commit.id, STYLE_LABEL);
    if (commit.tag !== "") {
      const tag = tagText(commit.tag);
      canvas.putText(row - 1, column - Math.floor(displayWidth(tag) / 2), tag, STYLE_TAG);
    }
  }

  return canvas;
}

function drawVertical(diagram: GitGraph, useAscii: boolean, cs: CharSet, bottomToTop: boolean): Canvas {
  const branches = sortedBranches(diagram);
  const byBranch = grouped(diagram, branches);
  const byId = new Map(diagram.commits.map((commit) => [commit.id, commit]));

  let widest = 0;
  for (const name of branches) widest = Math.max(widest, [...name].length);
  for (const commit of diagram.commits) {
    widest = Math.max(widest, [...commit.id].length);
    if (commit.tag !== "") widest = Math.max(widest, [...commit.tag].length + TAG_BRACKETS);
  }
  const columnGap = Math.max(widest + TB_LABEL_ROOM, TB_MIN_COL_GAP);

  const columns = new Map<string, number>();
  branches.forEach((name, i) => columns.set(name, MARGIN + i * columnGap));

  const count = diagram.commits.length;
  const rows = new Map<string, number>();
  let height: number;
  let labelRow: number;

  if (bottomToTop) {
    labelRow = MARGIN + count * TB_ROW_GAP + TB_LABEL_MARGIN;
    height = labelRow + 2 + MARGIN;
    diagram.commits.forEach((commit, i) => rows.set(commit.id, MARGIN + (count - 1 - i) * TB_ROW_GAP + 2));
  } else {
    labelRow = MARGIN;
    const top = MARGIN + 2;
    height = top + count * TB_ROW_GAP + MARGIN;
    diagram.commits.forEach((commit, i) => rows.set(commit.id, top + i * TB_ROW_GAP));
  }

  const canvas = new Canvas(MARGIN + branches.length * columnGap + MARGIN, height);

  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const [name, commits] of byBranch) {
    if (commits.length === 0) continue;
    const at = commits.map((commit) => rows.get(commit.id) as number);
    const lowest = Math.min(...at);
    const highest = Math.max(...at);
    if (name === diagram.mainBranchName) {
      starts.set(name, bottomToTop ? lowest - 1 : MARGIN + 1);
      ends.set(name, bottomToTop ? labelRow - 1 : highest + 1);
    } else {
      starts.set(name, lowest);
      ends.set(name, highest + 1);
    }
  }
  for (const commit of diagram.commits) {
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.branch === commit.branch || !ends.has(parent.branch)) continue;
      const at = rows.get(commit.id) as number;
      starts.set(parent.branch, Math.min(starts.get(parent.branch) as number, at));
      ends.set(parent.branch, Math.max(ends.get(parent.branch) as number, at));
    }
  }

  for (const name of branches) {
    canvas.putText(labelRow, (columns.get(name) as number) - Math.floor([...name].length / 2), name, STYLE_BRANCH);
  }

  for (const name of branches) {
    if (!starts.has(name)) continue;
    canvas.drawVertical(
      columns.get(name) as number,
      starts.get(name) as number,
      ends.get(name) as number,
      cs.lineVertical,
      STYLE_EDGE
    );
  }

  for (const commit of diagram.commits) {
    const row = rows.get(commit.id) as number;
    const to = columns.get(commit.branch) as number;
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.branch === commit.branch) continue;
      const from = columns.get(parent.branch) as number;
      if (from === to) continue;
      for (let c = Math.min(from, to); c <= Math.max(from, to); c++) {
        canvas.put(row, c, cs.lineHorizontal, true, STYLE_EDGE);
      }
    }
  }

  for (const commit of diagram.commits) {
    const row = rows.get(commit.id) as number;
    const column = columns.get(commit.branch) as number;
    canvas.put(row, column, markerOf(commit.type, useAscii), false, STYLE_NODE);

    const labelColumn = column - Math.floor([...commit.id].length / 2);
    const tag = tagText(commit.tag);
    const tagColumn = column - Math.floor(displayWidth(tag) / 2);
    if (bottomToTop) {
      canvas.putText(row - 1, labelColumn, commit.id, STYLE_LABEL);
      if (commit.tag !== "") canvas.putText(row + 1, tagColumn, tag, STYLE_TAG);
    } else {
      canvas.putText(row + 1, labelColumn, commit.id, STYLE_LABEL);
      if (commit.tag !== "") canvas.putText(row - 1, tagColumn, tag, STYLE_TAG);
    }
  }

  return canvas;
}
