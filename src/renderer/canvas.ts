// Ported from src/termaid/renderer/canvas.py.
//
// The sheet everything is drawn on, indexed row then column. A cell remembers which DIRECTIONS it connects, so two box
// characters landing on the same cell merge into the junction that carries both instead of one wiping out the other.

import { isWideEastAsian } from "../utils.js";

/** The four directions a cell can connect, as bits. */
export const UP = 1;
export const DOWN = 2;
export const LEFT = 4;
export const RIGHT = 8;

const BLANK = " ";
/** What a cell holds where a wide character's second column falls: nothing at all, so the line keeps its width. */
const SHADOW = "";
export const DEFAULT_STYLE = "default";

/** The character a set of directions draws as. A single direction still draws its own line. */
const DIRECTION_TO_CHAR: ReadonlyMap<number, string> = new Map([
  [LEFT | RIGHT, "─"],
  [UP | DOWN, "│"],
  [RIGHT | DOWN, "┌"],
  [LEFT | DOWN, "┐"],
  [RIGHT | UP, "└"],
  [LEFT | UP, "┘"],
  [LEFT | RIGHT | DOWN, "┬"],
  [LEFT | RIGHT | UP, "┴"],
  [UP | DOWN | RIGHT, "├"],
  [UP | DOWN | LEFT, "┤"],
  [LEFT | RIGHT | UP | DOWN, "┼"],
  [RIGHT, "─"],
  [LEFT, "─"],
  [UP, "│"],
  [DOWN, "│"],
]);

/** The directions a character already carries, for a caller that placed one without saying. */
const CHAR_TO_DIRECTIONS: ReadonlyMap<string, number> = new Map([
  ["─", LEFT | RIGHT],
  ["│", UP | DOWN],
  ["┌", RIGHT | DOWN],
  ["┐", LEFT | DOWN],
  ["└", RIGHT | UP],
  ["┘", LEFT | UP],
  ["├", UP | DOWN | RIGHT],
  ["┤", UP | DOWN | LEFT],
  ["┬", LEFT | RIGHT | DOWN],
  ["┴", LEFT | RIGHT | UP],
  ["┼", LEFT | RIGHT | UP | DOWN],
  ["╭", RIGHT | DOWN],
  ["╮", LEFT | DOWN],
  ["╰", RIGHT | UP],
  ["╯", LEFT | UP],
  ["═", LEFT | RIGHT],
  ["║", UP | DOWN],
  ["╔", RIGHT | DOWN],
  ["╗", LEFT | DOWN],
  ["╚", RIGHT | UP],
  ["╝", LEFT | UP],
  ["━", LEFT | RIGHT],
  ["┃", UP | DOWN],
  ["╋", LEFT | RIGHT | UP | DOWN],
  ["┄", LEFT | RIGHT],
  ["┆", UP | DOWN],
]);

/** What a character becomes when the whole drawing is turned upside down, and left to right. */
const FLIP_VERTICAL_MAP: ReadonlyMap<string, string> = new Map([
  ["┌", "└"],
  ["┐", "┘"],
  ["└", "┌"],
  ["┘", "┐"],
  ["├", "├"],
  ["┤", "┤"],
  ["┬", "┴"],
  ["┴", "┬"],
  ["▼", "▲"],
  ["▲", "▼"],
  ["╭", "╰"],
  ["╮", "╯"],
  ["╰", "╭"],
  ["╯", "╮"],
  ["v", "^"],
  ["^", "v"],
  ["╔", "╚"],
  ["╗", "╝"],
  ["╚", "╔"],
  ["╝", "╗"],
]);

const FLIP_HORIZONTAL_MAP: ReadonlyMap<string, string> = new Map([
  ["┌", "┐"],
  ["┐", "┌"],
  ["└", "┘"],
  ["┘", "└"],
  ["├", "┤"],
  ["┤", "├"],
  ["┬", "┬"],
  ["┴", "┴"],
  ["►", "◄"],
  ["◄", "►"],
  ["╭", "╮"],
  ["╮", "╭"],
  ["╰", "╯"],
  ["╯", "╰"],
  [">", "<"],
  ["<", ">"],
  ["╔", "╗"],
  ["╗", "╔"],
  ["╚", "╝"],
  ["╝", "╚"],
]);

export type StyledCell = readonly [string, string];

export class Canvas {
  private grid: string[][];
  private styles: string[][];
  private protectedCells: boolean[][];
  private directions: number[][];

  constructor(
    public width: number,
    public height: number
  ) {
    const rows = <T,>(value: T): T[][] =>
      Array.from({ length: height }, () => Array.from({ length: width }, () => value));
    this.grid = rows(BLANK);
    this.styles = rows(DEFAULT_STYLE);
    this.protectedCells = rows(false);
    this.directions = rows(0);
  }

  /** Grown, never shrunk: a drawing that turned out bigger than its first estimate keeps what is already on it. */
  resize(newWidth: number, newHeight: number): void {
    if (newWidth <= this.width && newHeight <= this.height) return;
    const width = Math.max(this.width, newWidth);
    const height = Math.max(this.height, newHeight);
    for (let r = 0; r < this.height; r++) {
      const extra = width - this.width;
      for (let i = 0; i < extra; i++) {
        (this.grid[r] as string[]).push(BLANK);
        (this.styles[r] as string[]).push(DEFAULT_STYLE);
        (this.protectedCells[r] as boolean[]).push(false);
        (this.directions[r] as number[]).push(0);
      }
    }
    for (let r = this.height; r < height; r++) {
      this.grid.push(Array.from({ length: width }, () => BLANK));
      this.styles.push(Array.from({ length: width }, () => DEFAULT_STYLE));
      this.protectedCells.push(Array.from({ length: width }, () => false));
      this.directions.push(Array.from({ length: width }, () => 0));
    }
    this.width = width;
    this.height = height;
  }

  private inside(row: number, col: number): boolean {
    return row >= 0 && row < this.height && col >= 0 && col < this.width;
  }

  get(row: number, col: number): string {
    return this.inside(row, col) ? ((this.grid[row] as string[])[col] as string) : BLANK;
  }

  /** A node's border, which an edge line may only JOIN, never overwrite. */
  protect(row: number, col: number): void {
    if (this.inside(row, col)) (this.protectedCells[row] as boolean[])[col] = true;
  }

  isProtected(row: number, col: number): boolean {
    return this.inside(row, col) ? ((this.protectedCells[row] as boolean[])[col] as boolean) : false;
  }

  /**
   * One character on the canvas. Where both the cell and the character carry directions, the two are OR'd and the
   * junction that carries the pair is drawn instead. A protected cell accepts nothing else.
   */
  put(row: number, col: number, ch: string, merge = true, style = ""): void {
    if (!this.inside(row, col) || ch === BLANK) return;

    const newDirs = CHAR_TO_DIRECTIONS.get(ch) ?? 0;
    const existing = (this.grid[row] as string[])[col] as string;
    const existingDirs = (this.directions[row] as number[])[col] as number;

    if (existing === BLANK) {
      (this.grid[row] as string[])[col] = ch;
      (this.directions[row] as number[])[col] = newDirs;
    } else if (merge && existingDirs !== 0 && newDirs !== 0) {
      const combined = existingDirs | newDirs;
      if (this.isProtected(row, col) && combined === existingDirs) return;
      const derived = DIRECTION_TO_CHAR.get(combined);
      if (derived !== undefined) {
        (this.grid[row] as string[])[col] = derived;
        (this.directions[row] as number[])[col] = combined;
      } else if (this.isProtected(row, col)) {
        return;
      } else {
        (this.grid[row] as string[])[col] = ch;
        (this.directions[row] as number[])[col] = newDirs;
      }
    } else if (this.isProtected(row, col)) {
      return;
    } else {
      (this.grid[row] as string[])[col] = ch;
      (this.directions[row] as number[])[col] = newDirs;
    }

    if (style !== "") (this.styles[row] as string[])[col] = style;
  }

  /** A string from one cell rightwards, a wide character taking two columns and blanking the second. */
  putText(row: number, col: number, text: string, style = ""): void {
    let offset = 0;
    for (const ch of text) {
      this.put(row, col + offset, ch, false, style);
      if (isWideEastAsian(ch)) {
        this.blankShadowCell(row, col + offset + 1, style);
        offset += 2;
      } else {
        offset += 1;
      }
    }
  }

  /** The same, each run carrying its own style key. */
  putStyledText(row: number, col: number, segments: Array<readonly [string, string]>): void {
    let offset = 0;
    for (const [text, style] of segments) {
      for (const ch of text) {
        this.put(row, col + offset, ch, false, style);
        if (isWideEastAsian(ch)) {
          this.blankShadowCell(row, col + offset + 1, style);
          offset += 2;
        } else {
          offset += 1;
        }
      }
    }
  }

  private blankShadowCell(row: number, col: number, style: string): void {
    if (row >= 0 && row < this.height && col >= 1 && col < this.width) {
      (this.grid[row] as string[])[col] = SHADOW;
      (this.styles[row] as string[])[col] = style;
    }
  }

  /**
   * A cell wiped back to a blank, its style and its directions left as they were. `put` refuses a space, so this is
   * the only way to CLEAR one: a renderer drawing a box over a line already there wipes the interior first.
   */
  clearChar(row: number, col: number): void {
    if (this.inside(row, col)) (this.grid[row] as string[])[col] = BLANK;
  }

  /**
   * A cell's style with no character of its own, which is how a chart paints a BACKGROUND: `put` refuses a space, so a
   * renderer wanting a coloured blank writes the style alone. The reference does it by reaching into the style grid.
   */
  setStyle(row: number, col: number, style: string): void {
    if (this.inside(row, col)) (this.styles[row] as string[])[col] = style;
  }

  getStyle(row: number, col: number): string {
    return this.inside(row, col) ? ((this.styles[row] as string[])[col] as string) : DEFAULT_STYLE;
  }

  /** Every cell as its character and its style key, which is what a theme paints from. */
  toStyledPairs(): StyledCell[][] {
    const result: StyledCell[][] = [];
    for (let r = 0; r < this.height; r++) {
      const row: StyledCell[] = [];
      for (let c = 0; c < this.width; c++) {
        row.push([(this.grid[r] as string[])[c] as string, (this.styles[r] as string[])[c] as string]);
      }
      result.push(row);
    }
    return result;
  }

  drawHorizontal(row: number, colStart: number, colEnd: number, ch: string, style = ""): void {
    for (let c = Math.min(colStart, colEnd); c <= Math.max(colStart, colEnd); c++) this.put(row, c, ch, true, style);
  }

  drawVertical(col: number, rowStart: number, rowEnd: number, ch: string, style = ""): void {
    for (let r = Math.min(rowStart, rowEnd); r <= Math.max(rowStart, rowEnd); r++) this.put(r, col, ch, true, style);
  }

  /** The drawing, each line right-trimmed and the empty lines at the bottom dropped. */
  toString(): string {
    const lines = this.grid.map((row) => row.join("").replace(/\s+$/, ""));
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  /** Upside down, for a graph running bottom to top. */
  flipVertical(): void {
    this.grid.reverse();
    this.styles.reverse();
    this.directions.reverse();
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        const ch = (this.grid[r] as string[])[c] as string;
        const flipped = FLIP_VERTICAL_MAP.get(ch);
        if (flipped !== undefined) (this.grid[r] as string[])[c] = flipped;
        const d = (this.directions[r] as number[])[c] as number;
        if (d === 0) continue;
        let next = d & (LEFT | RIGHT);
        if ((d & UP) !== 0) next |= DOWN;
        if ((d & DOWN) !== 0) next |= UP;
        (this.directions[r] as number[])[c] = next;
      }
    }
  }

  /** Mirrored, for a graph running right to left. */
  flipHorizontal(): void {
    for (let r = 0; r < this.height; r++) {
      (this.grid[r] as string[]).reverse();
      (this.styles[r] as string[]).reverse();
      (this.directions[r] as number[]).reverse();
    }
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        const ch = (this.grid[r] as string[])[c] as string;
        const flipped = FLIP_HORIZONTAL_MAP.get(ch);
        if (flipped !== undefined) (this.grid[r] as string[])[c] = flipped;
        const d = (this.directions[r] as number[])[c] as number;
        if (d === 0) continue;
        let next = d & (UP | DOWN);
        if ((d & LEFT) !== 0) next |= RIGHT;
        if ((d & RIGHT) !== 0) next |= LEFT;
        (this.directions[r] as number[])[c] = next;
      }
    }
  }
}
