// Ported from src/termaid/parser/kanban.py.
//
// A board is written by INDENTATION alone: the shallowest lines are the columns, everything deeper is a card.

import { makeKanban, makeKanbanColumn, type Kanban, type KanbanColumn } from "../model/kanban.js";
import { lstrip, PY_WORD, rstrip, splitLines, stripChars } from "../pycompat.js";

const COMMENT = "%%";
/** The `id[Title]` form, where only the bracketed half is shown. */
const TITLED_RE = new RegExp(String.raw`^(?:${PY_WORD}|-)*\[(.+)\]$`, "u");
/** The quotes a title is unwrapped from once its brackets are gone. */
const QUOTES = "\"'";
/** What opens a tag or an assignee at the end of a card's line. */
const TAG = "@";

/** A line's own text, the `id[Title]` wrapper and the quotes taken off. */
function cleanTitle(text: string): string {
  const titled = TITLED_RE.exec(text);
  return stripChars((titled === null ? text : (titled[1] as string)).trim(), QUOTES);
}

/** A mermaid kanban definition. */
export function parseKanban(text: string): Kanban {
  const lines = splitLines(text.trim());
  const board = makeKanban();
  if (lines.length === 0) return board;

  const body: Array<readonly [number, string]> = [];
  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = rstrip(line);
    if (stripped.trim() === "") continue;
    body.push([stripped.length - lstrip(stripped).length, stripped.trim()]);
  }
  if (body.length === 0) return board;

  const columnIndent = Math.min(...body.map(([indent]) => indent));
  let column: KanbanColumn | null = null;

  for (const [indent, written] of body) {
    if (indent <= columnIndent) {
      column = makeKanbanColumn(cleanTitle(written));
      board.columns.push(column);
      continue;
    }

    // A card written before any column still belongs somewhere, so an unnamed one opens here.
    if (column === null) {
      column = makeKanbanColumn("");
      board.columns.push(column);
    }

    // The tag is taken off BEFORE the `id[Title]` wrapper, or an `@` inside the brackets would end the title.
    let title = written;
    let metadata = "";
    const at = title.lastIndexOf(TAG);
    if (at >= 0) {
      metadata = TAG + title.slice(at + TAG.length).trim();
      title = title.slice(0, at).trim();
    }

    column.cards.push({ title: cleanTitle(title), metadata });
  }

  return board;
}
