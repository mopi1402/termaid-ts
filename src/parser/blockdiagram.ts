// Ported from src/termaid/parser/blockdiagram.py.
//
// A line is a row of the grid, and a token on it is a block. `block:id` and a bare `block` open a nested group that
// runs to its own `end`, so the parse is recursive and every group carries its own column count.

import {
  AUTO_COLUMNS,
  DEFAULT_SHAPE,
  makeBlock,
  makeBlockDiagram,
  type Block,
  type BlockDiagram,
  type BlockLink,
} from "../model/blockdiagram.js";
import { PY_WORD, PY_WORD_CHARS, pyStrip } from "../pycompat.js";

const W = PY_WORD;

/** Every shape a token may be written in, LONGEST delimiter first so `((` is never read as two `(`. */
const SHAPE_PATTERNS: ReadonlyArray<readonly [string, string, string]> = [
  ["(((", ")))", "double_circle"],
  ["((", "))", "circle"],
  ["([", "])", "stadium"],
  ["[(", ")]", "cylinder"],
  ["[[", "]]", "subroutine"],
  ["[/", "\\]", "trapezoid"],
  ["[\\", "/]", "trapezoid_alt"],
  ["[/", "/]", "parallelogram"],
  ["[\\", "\\]", "parallelogram_alt"],
  ["{{", "}}", "hexagon"],
  ["{", "}", "diamond"],
  ["(", ")", "rounded"],
  [">", "]", "asymmetric"],
  ["[", "]", "rectangle"],
];

const LINK_LABEL_RE = /^(\S+)\s*--\s*"([^"]*)"\s*-->\s*(\S+)$/u;
const LINK_SIMPLE_RE = /^(\S+)\s*-->\s*(\S+)$/u;
const HEADER_RE = /^block(-beta)?$/iu;
const COLUMNS_RE = /^columns\s+(\d+)/iu;
const NAMED_GROUP_RE = new RegExp(String.raw`^block\s*:\s*(${W}+)(?:\s*:\s*(\d+))?$`, "iu");
const SPACE_RE = /^space(?::(\d+))?$/iu;
const BLOCK_ARROW_RE = new RegExp(String.raw`^(${W}+)<\["([^"]*)"\]>\([^)]+\)$`, "u");
const SPAN_SUFFIX_RE = /:(\d+)$/u;
const BARE_ID_RE = new RegExp(String.raw`^${W}[${PY_WORD_CHARS}.-]*$`, "u");

const COMMENT = "%%";
const END = "end";
const GROUP = "block";
const DIRECTIVES = ["classdef ", "style ", "class "];
const OPENERS = "([{";
const CLOSERS = ")]}";
const QUOTE = '"';
const DEFAULT_SPAN = 1;

/** What a `&nbsp;` and its kind stand for, which mermaid authors write inside a block arrow's label. */
const ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ["&nbsp;", " "],
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
];

/** A mermaid block-beta definition. */
export function parseBlockDiagram(text: string): BlockDiagram {
  return new BlockParser(preprocess(text)).parse();
}

/** The lines that carry something: no comment, no blank, and no header. */
function preprocess(text: string): string[] {
  const result: string[] = [];
  for (const raw of pyStrip(text).split("\n")) {
    let line = pyStrip(raw);
    if (line === "") continue;
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) {
      line = pyStrip(line.slice(0, comment));
      if (line === "") continue;
    }
    result.push(line);
  }
  if (result.length > 0 && HEADER_RE.test(result[0] as string)) result.shift();
  return result;
}

/** What one group's lines came to, and the line its `end` was on. */
interface Group {
  blocks: Block[];
  links: BlockLink[];
  columns: number;
  next: number;
}

class BlockParser {
  private anonCount = 0;
  private spaceCount = 0;

  constructor(private lines: string[]) {}

  parse(): BlockDiagram {
    const { blocks, links, columns } = this.group(0);
    return makeBlockDiagram({ blocks, links, columns });
  }

  private group(start: number): Group {
    const blocks: Block[] = [];
    const links: BlockLink[] = [];
    let columns = AUTO_COLUMNS;
    let i = start;

    while (i < this.lines.length) {
      const line = this.lines[i] as string;
      const lower = pyStrip(line.toLowerCase());

      if (lower === END) return { blocks, links, columns, next: i + 1 };

      if (DIRECTIVES.some((directive) => lower.startsWith(directive))) {
        i += 1;
        continue;
      }

      const declared = COLUMNS_RE.exec(line);
      if (declared !== null) {
        columns = Number.parseInt(declared[1] as string, 10);
        i += 1;
        continue;
      }

      const named = NAMED_GROUP_RE.exec(line);
      if (named !== null) {
        const id = named[1] as string;
        const nested = this.group(i + 1);
        blocks.push(
          makeBlock(id, {
            label: id,
            colSpan: named[2] === undefined ? DEFAULT_SPAN : Number.parseInt(named[2], 10),
            children: nested.blocks,
            columns: nested.columns,
          })
        );
        links.push(...nested.links);
        i = nested.next;
        continue;
      }

      if (lower === GROUP) {
        this.anonCount += 1;
        const nested = this.group(i + 1);
        blocks.push(
          makeBlock(`_anon_group_${this.anonCount}`, { children: nested.blocks, columns: nested.columns })
        );
        links.push(...nested.links);
        i = nested.next;
        continue;
      }

      const link = parseLink(line);
      if (link !== null) {
        // An endpoint may CARRY the block's definition, so a token seen for the first time here declares it.
        const known = collectBlocks(blocks);
        for (const token of link.tokens) {
          const parsed = this.blockToken(token);
          if (parsed === null) continue;
          const existing = known.get(parsed.id);
          if (existing === undefined) {
            blocks.push(parsed);
            known.set(parsed.id, parsed);
          } else if (parsed.shape !== DEFAULT_SHAPE || parsed.label !== parsed.id) {
            existing.shape = parsed.shape;
            existing.label = parsed.label;
          }
        }
        links.push(link.link);
        i += 1;
        continue;
      }

      for (const token of tokenize(line)) {
        const block = this.blockToken(token);
        if (block !== null) blocks.push(block);
      }
      i += 1;
    }

    return { blocks, links, columns, next: i };
  }

  /** One token: a space, a block arrow, a shaped block, or a bare id, each of which may carry a column span. */
  private blockToken(written: string): Block | null {
    if (written === "") return null;

    const space = SPACE_RE.exec(written);
    if (space !== null) {
      this.spaceCount += 1;
      return makeBlock(`_space_${this.spaceCount}`, {
        isSpace: true,
        colSpan: space[1] === undefined ? DEFAULT_SPAN : Number.parseInt(space[1], 10),
      });
    }

    const arrow = BLOCK_ARROW_RE.exec(written);
    if (arrow !== null) {
      const label = unescapeHtml(arrow[2] as string);
      // A block arrow labelled with nothing but blanks is a connector, so it takes a cell and draws nothing.
      if (pyStrip(label) === "") return makeBlock(arrow[1] as string, { isSpace: true });
      return makeBlock(arrow[1] as string, { label });
    }

    let token = written;
    let colSpan = DEFAULT_SPAN;
    const span = SPAN_SUFFIX_RE.exec(token);
    if (span !== null) {
      colSpan = Number.parseInt(span[1] as string, 10);
      token = token.slice(0, span.index);
    }

    for (const [open, close, shape] of SHAPE_PATTERNS) {
      const at = token.indexOf(open);
      if (at <= 0) continue;
      const rest = token.slice(at + open.length);
      if (!rest.endsWith(close)) continue;
      const id = pyStrip(token.slice(0, at));
      if (id === "") continue;
      return makeBlock(id, { label: stripQuotes(pyStrip(rest.slice(0, rest.length - close.length))), shape, colSpan });
    }

    const id = pyStrip(token);
    if (id !== "" && BARE_ID_RE.test(id)) return makeBlock(id, { label: id, colSpan });
    return null;
  }
}

/** Every block of a tree by id, a child's entry overwriting a parent's where the two share one. */
function collectBlocks(blocks: Block[]): Map<string, Block> {
  const found = new Map<string, Block>();
  for (const block of blocks) {
    found.set(block.id, block);
    for (const [id, child] of collectBlocks(block.children)) found.set(id, child);
  }
  return found;
}

/** A link and the two tokens it was written between, which may declare their blocks. */
function parseLink(line: string): { link: BlockLink; tokens: [string, string] } | null {
  const labelled = LINK_LABEL_RE.exec(line);
  if (labelled !== null) {
    const tokens: [string, string] = [labelled[1] as string, labelled[3] as string];
    return { link: { source: blockId(tokens[0]), target: blockId(tokens[1]), label: labelled[2] as string }, tokens };
  }
  const simple = LINK_SIMPLE_RE.exec(line);
  if (simple !== null) {
    const tokens: [string, string] = [simple[1] as string, simple[2] as string];
    return { link: { source: blockId(tokens[0]), target: blockId(tokens[1]), label: "" }, tokens };
  }
  return null;
}

/** The id out of a token that may carry a shape after it. */
function blockId(token: string): string {
  for (const [open] of SHAPE_PATTERNS) {
    const at = token.indexOf(open);
    if (at > 0) return pyStrip(token.slice(0, at));
  }
  return pyStrip(token);
}

/** A line split on the blanks that are OUTSIDE every bracket, so a label may hold spaces of its own. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;

  const flush = (): void => {
    const token = pyStrip(current);
    if (token !== "") tokens.push(token);
    current = "";
  };

  for (const ch of line) {
    if (OPENERS.includes(ch) || ch === "<") {
      depth += 1;
      current += ch;
    } else if (CLOSERS.includes(ch)) {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === ">" && depth > 0) {
      depth -= 1;
      current += ch;
    } else if (ch === " " && depth === 0) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}

const stripQuotes = (text: string): string =>
  text.length >= 2 && text.startsWith(QUOTE) && text.endsWith(QUOTE) ? text.slice(1, -1) : text;

function unescapeHtml(text: string): string {
  let out = text;
  for (const [entity, ch] of ENTITIES) out = out.replaceAll(entity, ch);
  return out;
}
