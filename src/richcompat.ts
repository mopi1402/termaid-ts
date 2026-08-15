// The slice of the `rich` package the port stands on, the way `pycompat.ts` holds the slice of CPython.
//
// Nothing here is ported from termaid: it is what termaid's output adapter DELEGATES to Rich, and a terminal reads as
// bytes. Only what a theme or `_css_to_rich_style` can actually spell is implemented, so an unknown word raises rather
// than paints something Rich would not.

import { LIGHT_BACKGROUND, mirrorRgb, mirrorStandard, type Background } from "./background.js";
import { displayWidth } from "./utils.js";

/** Rich's escape introducer, and the sequence closing a styled run. */
const CSI = "\x1b[";
const SGR_END = "m";
const RESET = `${CSI}0${SGR_END}`;
const CODE_SEPARATOR = ";";

/**
 * Rich writes attributes in BIT order, never in the order the words were written, so `italic dim` comes out `2;3`.
 * The index in this table is the bit; the value is the code.
 */
const ATTRIBUTE_CODES: readonly string[] = [
  "1", // bold
  "2", // dim
  "3", // italic
  "4", // underline
  "5", // blink
  "6", // blink2
  "7", // reverse
  "8", // conceal
  "9", // strike
  "21", // underline2
  "51", // frame
  "52", // encircle
  "53", // overline
];

/** The words Rich reads as an attribute, and the bit each one sets. Its short spellings are kept. */
const ATTRIBUTE_BITS: ReadonlyMap<string, number> = new Map([
  ["bold", 0],
  ["b", 0],
  ["dim", 1],
  ["d", 1],
  ["italic", 2],
  ["i", 2],
  ["underline", 3],
  ["u", 3],
  ["blink", 4],
  ["blink2", 5],
  ["reverse", 6],
  ["r", 6],
  ["conceal", 7],
  ["c", 7],
  ["strike", 8],
  ["s", 8],
  ["underline2", 9],
  ["uu", 9],
  ["frame", 10],
  ["encircle", 11],
  ["overline", 12],
  ["o", 12],
]);

/** The sixteen colours a terminal names, in Rich's own order: the index below is what an SGR base is offset by. */
const STANDARD_COLORS: readonly string[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright_black",
  "bright_red",
  "bright_green",
  "bright_yellow",
  "bright_blue",
  "bright_magenta",
  "bright_cyan",
  "bright_white",
];

const STANDARD_FOREGROUND = 30;
const STANDARD_BACKGROUND = 40;
/** The eight above the first eight are written from a second base, never as `30 + 8`. */
const BRIGHT_FOREGROUND = 90;
const BRIGHT_BACKGROUND = 100;
const BRIGHT_FIRST = 8;
/** What introduces a 24 bit colour: 38 for the foreground, 48 for the background, then the `2` naming the format. */
const TRUECOLOR_FOREGROUND = "38";
const TRUECOLOR_BACKGROUND = "48";
const TRUECOLOR_FORMAT = "2";

const HEX_MARK = "#";
const HEX_RE = /^#[0-9a-f]{6}$/iu;
const HEX_BASE = 16;
const CHANNEL_WIDTH = 2;

const BACKGROUND_WORD = "on";
const NEGATION_WORD = "not";
const WORD_SEPARATOR_RE = /\s+/u;

/** A colour resolved to what a terminal is told, either an index into the sixteen or the three channels. */
type Color = { readonly kind: "standard"; readonly index: number } | { readonly kind: "truecolor"; readonly rgb: RGB };

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The three channels of a `#rrggbb`, which is the only hex spelling Rich reads. */
export function parseHex(text: string): RGB | null {
  if (!HEX_RE.test(text)) return null;
  const digits = text.slice(HEX_MARK.length);
  const channel = (at: number): number => parseInt(digits.slice(at, at + CHANNEL_WIDTH), HEX_BASE);
  return { r: channel(0), g: channel(CHANNEL_WIDTH), b: channel(CHANNEL_WIDTH * 2) };
}

/** A `#rrggbb`, written the way Rich writes one back: upper case. */
export const formatHex = (rgb: RGB): string =>
  HEX_MARK +
  [rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(HEX_BASE).toUpperCase().padStart(CHANNEL_WIDTH, "0"))
    .join("");

function parseColor(word: string): Color {
  const index = STANDARD_COLORS.indexOf(word);
  if (index >= 0) return { kind: "standard", index };
  const rgb = parseHex(word);
  if (rgb !== null) return { kind: "truecolor", rgb };
  throw new Error(`richcompat: ${word} is not a colour this port writes`);
}

function colorCodes(color: Color, foreground: boolean): string[] {
  if (color.kind === "truecolor") {
    return [
      foreground ? TRUECOLOR_FOREGROUND : TRUECOLOR_BACKGROUND,
      TRUECOLOR_FORMAT,
      String(color.rgb.r),
      String(color.rgb.g),
      String(color.rgb.b),
    ];
  }
  const bright = color.index >= BRIGHT_FIRST;
  const base = bright
    ? foreground
      ? BRIGHT_FOREGROUND
      : BRIGHT_BACKGROUND
    : foreground
      ? STANDARD_FOREGROUND
      : STANDARD_BACKGROUND;
  return [String(base + (color.index - (bright ? BRIGHT_FIRST : 0)))];
}

/** ◉ The same colour on the terminal's other side. Dark mirrors nothing: it is the side every theme was drawn for. */
const mirrored = (color: Color, background: Background | undefined): Color => {
  if (background !== LIGHT_BACKGROUND) return color;
  return color.kind === "truecolor"
    ? { kind: "truecolor", rgb: mirrorRgb(color.rgb) }
    : { kind: "standard", index: mirrorStandard(color.index) };
};

/**
 * Rich's `Style.parse` on a definition string, down to the codes a terminal is sent. An empty definition, and one
 * naming nothing a terminal can do, both come back empty: the run is then written with no escape at all.
 *
 * ◉ `background` names the side the drawing is painted onto, and is the ONE seam any colour crosses: a theme's, a
 * chart section's, and one a source declared for a node of its own. Absent, not a byte moves.
 */
export function styleCodes(definition: string, background?: Background): string {
  const words = definition.trim().split(WORD_SEPARATOR_RE).filter(Boolean);
  const set = new Set<number>();
  let color: Color | null = null;
  let bgcolor: Color | null = null;

  for (let i = 0; i < words.length; i++) {
    const word = (words[i] as string).toLowerCase();
    if (word === BACKGROUND_WORD) {
      const next = words[++i];
      if (next === undefined) throw new Error("richcompat: `on` was written with no colour after it");
      bgcolor = parseColor(next.toLowerCase());
    } else if (word === NEGATION_WORD) {
      const next = words[++i];
      if (next === undefined) throw new Error("richcompat: `not` was written with no attribute after it");
      const bit = ATTRIBUTE_BITS.get(next.toLowerCase());
      if (bit === undefined) throw new Error(`richcompat: ${next} is not an attribute`);
      set.delete(bit);
    } else {
      const bit = ATTRIBUTE_BITS.get(word);
      if (bit !== undefined) set.add(bit);
      else color = parseColor(word);
    }
  }

  const codes: string[] = [];
  for (let bit = 0; bit < ATTRIBUTE_CODES.length; bit++) {
    if (set.has(bit)) codes.push(ATTRIBUTE_CODES[bit] as string);
  }
  if (color !== null) codes.push(...colorCodes(mirrored(color, background), true));
  if (bgcolor !== null) codes.push(...colorCodes(mirrored(bgcolor, background), false));
  return codes.join(CODE_SEPARATOR);
}

/** One code point and the style written over it, which is the grain everything below works at. */
interface Cell {
  readonly ch: string;
  readonly style: string;
}

const NO_CELL_STYLE = "";
const LINE_BREAK = "\n";
const SPACE_RE = /\s/u;
const isSpace = (ch: string): boolean => SPACE_RE.test(ch);

const cellsPlain = (cells: readonly Cell[]): string => cells.map((cell) => cell.ch).join("");
const cellLen = (cells: readonly Cell[]): number => cells.reduce((total, cell) => total + displayWidth(cell.ch), 0);

/** Python's `str.rstrip()` on a run of cells. */
function rstripCells(cells: readonly Cell[]): Cell[] {
  let end = cells.length;
  while (end > 0 && isSpace((cells[end - 1] as Cell).ch)) end--;
  return cells.slice(0, end);
}

/**
 * Rich's `words`, which is `\s*\S+\s*` matched from one end to the next: a word carries the blanks that FOLLOW it, and
 * a tail of nothing but blanks matches nothing at all and ends the walk.
 */
function* words(cells: readonly Cell[]): Generator<readonly [number, readonly Cell[]]> {
  let pos = 0;
  while (pos < cells.length) {
    const start = pos;
    let at = pos;
    while (at < cells.length && isSpace((cells[at] as Cell).ch)) at++;
    if (at >= cells.length) return;
    while (at < cells.length && !isSpace((cells[at] as Cell).ch)) at++;
    while (at < cells.length && isSpace((cells[at] as Cell).ch)) at++;
    yield [start, cells.slice(start, at)];
    pos = at;
  }
}

/**
 * Rich's `chop_cells`: a word too long for any line, cut into pieces each of which FITS. Rich cuts on graphemes; the
 * port cuts on code points, which is the same thing for everything a diagram is drawn with.
 */
function chopCells(cells: readonly Cell[], width: number): Cell[][] {
  const lines: Cell[][] = [];
  let lineSize = 0;
  let offset = 0;
  for (let i = 0; i < cells.length; i++) {
    const size = displayWidth((cells[i] as Cell).ch);
    if (lineSize + size > width) {
      lines.push(cells.slice(offset, i));
      offset = i;
      lineSize = 0;
    }
    lineSize += size;
  }
  if (lineSize) lines.push(cells.slice(offset));
  return lines;
}

/** Rich's `divide_line`: the offsets a line is broken at so each piece fits the width. */
function divideLine(cells: readonly Cell[], width: number, fold: boolean): number[] {
  const breaks: number[] = [];
  let cellOffset = 0;

  for (const [wordStart, word] of words(cells)) {
    let start = wordStart;
    // The blanks a word trails do not have to fit: a line may end on them.
    const wordLength = cellLen(rstripCells(word));
    const remaining = width - cellOffset;

    if (remaining >= wordLength) {
      cellOffset += cellLen(word);
    } else if (wordLength > width) {
      if (fold) {
        const folded = chopCells(word, width);
        for (let i = 0; i < folded.length; i++) {
          const piece = folded[i] as Cell[];
          if (start) breaks.push(start);
          if (i === folded.length - 1) cellOffset = cellLen(piece);
          else start += piece.length;
        }
      } else {
        if (start) breaks.push(start);
        cellOffset = cellLen(word);
      }
    } else if (cellOffset && start) {
      breaks.push(start);
      cellOffset = cellLen(word);
    }
  }

  return breaks;
}

/** Rich's `Text.rstrip_end`: the blanks a line trails PAST the width, and only those, are cut. */
function rstripEnd(cells: readonly Cell[], size: number): Cell[] {
  if (cells.length <= size) return [...cells];
  const excess = cells.length - size;
  const stripped = rstripCells(cells);
  const blanks = cells.length - stripped.length;
  return cells.slice(0, cells.length - Math.min(blanks, excess));
}

/** Rich's `set_cell_size` on the cropping side: what still fits the width, a straddling wide cell dropped. */
function cropToCells(cells: readonly Cell[], width: number): Cell[] {
  const kept: Cell[] = [];
  let size = 0;
  for (const cell of cells) {
    const next = size + displayWidth(cell.ch);
    if (next > width) break;
    kept.push(cell);
    size = next;
  }
  return kept;
}

/**
 * Rich's `Text`: a plain string with styles laid over spans of it. A SEGMENT is cut at every span boundary and not at
 * every change of style, so two neighbouring spans painting the same colour are still opened and closed one by one.
 * That is why a ruled line comes out one escape per character, and matching it is the whole point of this class.
 *
 * The port never writes a span longer than one character and never overlaps two, so a cell per code point holds
 * everything a span list would, and the wrapping below has somewhere to carry the styles across a break.
 */
export class Text {
  private readonly cells: Cell[];

  constructor(plain: string) {
    this.cells = [...plain].map((ch) => ({ ch, style: NO_CELL_STYLE }));
  }

  get plain(): string {
    return cellsPlain(this.cells);
  }

  stylize(style: string, start: number, end: number): void {
    for (let at = start; at < end && at < this.cells.length; at++) {
      this.cells[at] = { ch: (this.cells[at] as Cell).ch, style };
    }
  }

  /** What a terminal is sent, with no console around it: every styled cell opened and closed on its own. */
  toAnsi(background?: Background): string {
    return renderCells(this.cells, background);
  }

  /** Rich's `Text.wrap` at the given width, each source line broken into the pieces that fit. */
  wrap(width: number, fold: boolean = true): Cell[][] {
    const out: Cell[][] = [];
    for (const line of splitCells(this.cells)) {
      const offsets = divideLine(line, width, fold);
      const pieces: Cell[][] = [];
      let previous = 0;
      for (const offset of offsets) {
        pieces.push(line.slice(previous, offset));
        previous = offset;
      }
      pieces.push(line.slice(previous));
      for (const piece of pieces) {
        const trimmed = rstripEnd(piece, width);
        out.push(cellLen(trimmed) > width ? cropToCells(trimmed, width) : trimmed);
      }
    }
    return out;
  }
}

/** The lines of a cell run, the breaks themselves dropped. A blank line is kept, the way `allow_blank` keeps one. */
function splitCells(cells: readonly Cell[]): Cell[][] {
  const lines: Cell[][] = [];
  let current: Cell[] = [];
  for (const cell of cells) {
    if (cell.ch === LINE_BREAK) {
      lines.push(current);
      current = [];
    } else current.push(cell);
  }
  lines.push(current);
  return lines;
}

/** A run of cells as the bytes Rich writes: one escape per styled cell, the unstyled stretches written bare. */
function renderCells(cells: readonly Cell[], background?: Background): string {
  let out = "";
  let bare = "";
  for (const cell of cells) {
    if (cell.style === NO_CELL_STYLE) {
      bare += cell.ch;
      continue;
    }
    out += bare;
    bare = "";
    const codes = styleCodes(cell.style, background);
    out += codes === "" ? cell.ch : `${CSI}${codes}${SGR_END}${cell.ch}${RESET}`;
  }
  return out + bare;
}

/**
 * What Rich's `Console.print` writes for a text: the lines wrapped to the console's width, joined, and one newline
 * closing the lot. A console fed by a pipe is 80 columns wide, which is what the reference's own takes were drawn at.
 */
export const CONSOLE_WIDTH = 80;

export function printToConsole(text: Text, width: number = CONSOLE_WIDTH, background?: Background): string {
  return text.wrap(width).map((cells) => renderCells(cells, background)).join(LINE_BREAK) + LINE_BREAK;
}
