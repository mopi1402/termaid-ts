// ◉ This package's own: the SIDE a drawing is painted onto, and what a colour becomes there.
//
// Every theme this port ships was drawn for a dark terminal, the reference having no notion of a light one: the pale
// foregrounds that read on black turn to fog on white. So a light terminal is served by MIRRORING each resolved
// colour, luminance flipped and hue kept, which covers all eleven themes and any theme a later release adds, because
// nothing here knows a theme's name.
//
// Luminance and not a per-theme repaint, for two reasons the alternative fails on: a table of light palettes drifts
// from the dark ones it was derived from, and it says nothing about the colours a SOURCE declares (a node styled
// `fill:#222` in the diagram's own text), which arrive at the same seam and need the same treatment.
//
// Pure arithmetic on purpose, holding no Rich vocabulary: `richcompat.ts` owns what a colour IS, and calls in here
// for what it BECOMES.

import type { RGB } from "./richcompat.js";

/** The two sides a terminal can be. `dark` is what every theme was drawn for, so it mirrors nothing. */
export const DARK_BACKGROUND = "dark";
export const LIGHT_BACKGROUND = "light";
export type Background = typeof DARK_BACKGROUND | typeof LIGHT_BACKGROUND;

const CHANNEL_MAX = 255;
/** Hue is an angle, in the six sectors a hex describes. */
const SECTORS = 6;
const FULL_TURN = 1;

/**
 * A channel triple as hue, saturation and luminance, each in `0..1`. The standard conversion, spelled out rather than
 * pulled in: three functions is a smaller debt than a dependency in a package that has none.
 */
function toHsl(rgb: RGB): { h: number; s: number; l: number } {
  const r = rgb.r / CHANNEL_MAX;
  const g = rgb.g / CHANNEL_MAX;
  const b = rgb.b / CHANNEL_MAX;
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const l = (high + low) / 2;
  const span = high - low;
  if (span === 0) return { h: 0, s: 0, l }; // a grey has no hue to keep
  const s = span / (1 - Math.abs(2 * l - 1));
  const h =
    high === r
      ? ((g - b) / span + (g < b ? SECTORS : 0)) / SECTORS
      : high === g
        ? ((b - r) / span + 2) / SECTORS
        : ((r - g) / span + 4) / SECTORS;
  return { h, s, l };
}

/** The inverse, Rich's own spelling of a colour on the other end. */
function toRgb(h: number, s: number, l: number): RGB {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h * SECTORS;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = l - chroma / 2;
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const channel = (value: number): number => Math.round((value + base) * CHANNEL_MAX);
  return { r: channel(r), g: channel(g), b: channel(b) };
}

/**
 * The same colour on the other side: as far from white as it was from black, its hue and saturation untouched. A mid
 * grey is its own mirror, which is why the ruled lines a diagram is built from keep their weight either way round.
 */
export function mirrorRgb(rgb: RGB): RGB {
  const { h, s, l } = toHsl(rgb);
  return toRgb(h, s, FULL_TURN - l);
}

/**
 * The mirror of each of the sixteen NAMED colours, by index into Rich's own order. Named colours are the TERMINAL's
 * to define, and no arithmetic can reach them, so what is stated here is the same flip in intent, spelled in the two
 * indices a palette cannot betray: `black` is the darkest ink a palette holds and `bright_white` the palest, on both
 * sides of the world. Every other index is a promise the palette may break, `bright_black` first of all, which a
 * light theme paints a PALE grey (measured 2026-08-15, a label mirrored onto it reading as fog on white).
 *
 * So the three near-white names collapse onto `black` rather than shading between themselves: what tells a label
 * from an edge afterwards is the attribute the definition carries, `bold` against `dim`, which the mirror never
 * touches. Red through cyan sit mid-way and read on both sides, so they stay put, and the bright six fall back to
 * their plain twin, the darker of the pair on every palette.
 */
const MIRRORED: ReadonlyMap<number, number> = new Map([
  [0, 15], // black -> bright_white, the one name as pale as black is dark
  [7, 0], // white -> black
  [8, 0], // bright_black -> black
  [15, 0], // bright_white -> black
  [9, 1], // bright_red -> red
  [10, 2], // bright_green -> green
  [11, 3], // bright_yellow -> yellow
  [12, 4], // bright_blue -> blue
  [13, 5], // bright_magenta -> magenta
  [14, 6], // bright_cyan -> cyan
]);

/** The mirror of a named colour, or the index itself where the name already reads on both sides. */
export const mirrorStandard = (index: number): number => MIRRORED.get(index) ?? index;
