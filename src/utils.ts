// Ported from src/termaid/utils.py.
//
// The one place the reference reaches for `unicodedata`: how many terminal columns a character eats. Everything the
// layout squares up is measured through here, so a width that disagrees with the reference misplaces every box.

import { isFullwidthOrWide } from "./data/eastasianwidth.js";

/** What the reference widens on top of East Asian Width: symbols, dingbats, emoji, variation selectors. */
const SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2600, 0x27bf],
  [0x1f300, 0x1faff],
  [0xfe00, 0xfe0f],
];

const WIDE_COLUMNS = 2;
const NARROW_COLUMNS = 1;

function inAny(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([low, high]) => cp >= low && cp <= high);
}

/** East Asian Width alone, which is what the CANVAS advances a column by: a dingbat is narrow there. */
export function isWideEastAsian(ch: string): boolean {
  return isFullwidthOrWide(ch.codePointAt(0) ?? 0);
}

/** Whether a character occupies two terminal columns, an emoji counted wide the way the reference counts it. */
export function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return isFullwidthOrWide(cp) || inAny(cp, SYMBOL_RANGES);
}

/** The terminal display width of `text`, counted the way the reference counts it. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch) ? WIDE_COLUMNS : NARROW_COLUMNS;
  return width;
}

const ELLIPSIS = ".";

/** `text` clipped to `cols` columns, never splitting a wide character in half. */
function clip(text: string, cols: number): string {
  const out: string[] = [];
  let width = 0;
  for (const ch of text) {
    const chWidth = isWide(ch) ? WIDE_COLUMNS : NARROW_COLUMNS;
    if (width + chWidth > cols) break;
    out.push(ch);
    width += chWidth;
  }
  return out.join("");
}

/** `text` cut to fit `width` columns, the ellipsis appended only where something was actually cut. */
export function truncateToWidth(text: string, width: number, ellipsis: string = ELLIPSIS): string {
  if (displayWidth(text) <= width) return text;
  const ellipsisWidth = displayWidth(ellipsis);
  if (width <= ellipsisWidth) return clip(ellipsis, width);
  return clip(text, width - ellipsisWidth) + ellipsis;
}
