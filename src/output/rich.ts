// Ported from src/termaid/output/rich.py.
//
// The canvas carries a style KEY per cell; a theme says what that key looks like, and `richcompat.ts` turns the answer
// into the bytes a terminal paints with. Python builds a `rich.text.Text` here and lets Rich print it, so the port
// builds the same object and asks it for what Rich would have written.

import { Canvas } from "../renderer/canvas.js";
import { getTheme, type Theme } from "../renderer/themes.js";
import { Graph } from "../graph/model.js";
import { renderGraphCanvas, type RenderOptions } from "../renderer/draw.js";
import { formatHex, parseHex, Text, type RGB } from "../richcompat.js";
import { rstrip } from "../pycompat.js";

const HEX_MARK = "#";
const SHORT_HEX = 3;
const FULL_HEX = 6;

/** A hex colour as Rich spells one, a three digit form doubled out. Anything else is not a colour. */
function hexToRichColor(hexColor: string): string | null {
  let h = hexColor.startsWith(HEX_MARK) ? hexColor.slice(HEX_MARK.length) : hexColor;
  if (h.length === SHORT_HEX) h = [...h].map((c) => c + c).join("");
  if (h.length === FULL_HEX) return HEX_MARK + h;
  return null;
}

/** The CSS-ish properties a `classDef`, a `style` or a `linkStyle` carries. */
export type CssProps = ReadonlyMap<string, string>;

const BACKGROUND = "on ";
const BOLD = "bold";
const DIM = "dim";
const PIXELS = "px";
/** A stroke this thin says nothing, so only a thicker one is worth a weight. */
const THIN_STROKES = new Set(["0", "1", ""]);
const STYLE_SEPARATOR = " ";

/** A mermaid style declaration as a Rich style string, or nothing when it says nothing a terminal can show. */
function cssToRichStyle(props: CssProps): string | null {
  const parts: string[] = [];

  const fill = props.get("fill") || props.get("background-color") || props.get("background");
  if (fill) {
    const color = hexToRichColor(fill);
    if (color) parts.push(BACKGROUND + color);
  }

  const stroke = props.get("stroke") || props.get("color");
  if (stroke) {
    const color = hexToRichColor(stroke);
    if (color) parts.push(color);
  }

  const strokeWidth = props.get("stroke-width");
  if (strokeWidth && !THIN_STROKES.has(strokeWidth.replaceAll(PIXELS, "").trim())) parts.push(BOLD);

  if (props.get("stroke-dasharray")) parts.push(DIM);

  return parts.length > 0 ? parts.join(STYLE_SEPARATOR) : null;
}

/** The style keys the canvas writes, kept here because more than the theme table must agree on their spelling. */
const NODE = "node";
const EDGE = "edge";
const ARROW = "arrow";
const SUBGRAPH = "subgraph";
const LABEL = "label";
const EDGE_LABEL = "edge_label";
const SUBGRAPH_LABEL = "subgraph_label";
const DEFAULT = "default";
const BOLD_LABEL = "bold_label";
const ITALIC_LABEL = "italic_label";
const CLASS_PREFIX = "class:";
const NODE_STYLE_PREFIX = "nodestyle:";
const LINK_STYLE_PREFIX = "linkstyle:";
const SECTION_PREFIX = "section:";
const SECTION_FOREGROUND_PREFIX = "sectionfg:";
const DEEP_SUFFIX = ":deep";
/** The index a `linkStyle default` is filed under, standing for every edge that names none of its own. */
const DEFAULT_LINK = -1;

const ITALIC = "italic";
const SPACE = " ";
const NEWLINE = "\n";
const EMPTY = "";

/** The rows of a canvas as printable lines, each stripped of the blank tail a grid always has. */
function trimmedLines(rows: ReadonlyArray<ReadonlyArray<readonly [string, string]>>, keepSectionTail: boolean): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const raw = row.map(([ch]) => ch).join(EMPTY);
    // A section paints its background across the whole column, so its trailing blanks are part of the drawing.
    const hasSection = keepSectionTail && row.some(([, key]) => key !== DEFAULT && key.startsWith(SECTION_PREFIX));
    lines.push(hasSection ? raw : rstrip(raw));
  }
  while (lines.length > 0 && lines[lines.length - 1] === EMPTY) lines.pop();
  return lines;
}

/** A graph painted by a theme, as the Rich text the reference prints. */
export function renderRich(
  graph: Graph,
  options: Partial<RenderOptions> = {},
  theme: string = DEFAULT
): Text {
  const canvas = renderGraphCanvas(graph, options);
  if (canvas === null) return new Text(EMPTY);

  const th = getTheme(theme);

  const styleMap = new Map<string, string>([
    [NODE, th.node],
    [EDGE, th.edge],
    [ARROW, th.arrow],
    [SUBGRAPH, th.subgraph],
    [LABEL, th.label],
    [EDGE_LABEL, th.edgeLabel],
    [SUBGRAPH_LABEL, th.subgraphLabel],
    [DEFAULT, th.default],
    [BOLD_LABEL, `${BOLD} ${th.label}`],
    [ITALIC_LABEL, `${ITALIC} ${th.label}`],
  ]);

  for (const [className, props] of graph.classDefs) {
    const style = cssToRichStyle(props);
    if (style) styleMap.set(CLASS_PREFIX + className, style);
  }

  for (const [nodeId, props] of graph.nodeStyles) {
    const style = cssToRichStyle(props);
    if (style) styleMap.set(NODE_STYLE_PREFIX + nodeId, style);
  }

  const defaultLinkProps = graph.linkStyles.get(DEFAULT_LINK);
  for (const [index, props] of graph.linkStyles) {
    if (index < 0) continue;
    const style = cssToRichStyle(props);
    if (style) styleMap.set(LINK_STYLE_PREFIX + index, style);
  }
  if (defaultLinkProps !== undefined && defaultLinkProps.size > 0) {
    const style = cssToRichStyle(defaultLinkProps);
    if (style) {
      // Every edge that named no style of its own falls back to the one `linkStyle default` declared.
      for (let i = 0; i < graph.edges.length; i++) {
        const key = LINK_STYLE_PREFIX + i;
        if (!styleMap.has(key)) styleMap.set(key, style);
      }
    }
  }

  const styledPairs = canvas.toStyledPairs();
  const lines = trimmedLines(styledPairs, false);
  const text = new Text(lines.join(NEWLINE));

  const isSolid = th.isSolid;

  let pos = 0;
  for (let rowIndex = 0; rowIndex < styledPairs.length; rowIndex++) {
    if (rowIndex >= lines.length) break;
    const line = [...(lines[rowIndex] as string)];
    const row = styledPairs[rowIndex] as ReadonlyArray<readonly [string, string]>;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (colIndex >= line.length) break;
      const [ch, styleKey] = row[colIndex] as readonly [string, string];
      if (isSolid) {
        let styleStr: string;
        if (styleKey.startsWith(SECTION_FOREGROUND_PREFIX)) {
          // A foreground-only section fills nothing, so a blank cell of it is left bare.
          styleStr = ch !== SPACE ? (styleMap.get(styleKey) ?? EMPTY) : EMPTY;
        } else {
          let bg: string;
          if (
            styleKey === NODE ||
            styleKey === LABEL ||
            styleKey === BOLD_LABEL ||
            styleKey === ITALIC_LABEL ||
            styleKey.startsWith(NODE_STYLE_PREFIX) ||
            styleKey.startsWith(CLASS_PREFIX)
          ) {
            bg = th.bgNode;
          } else if (styleKey === SUBGRAPH || styleKey === SUBGRAPH_LABEL) {
            bg = th.bgSubgraph;
          } else {
            bg = th.bgDefault;
          }
          const fg = ch !== SPACE ? (styleMap.get(styleKey) ?? EMPTY) : EMPTY;
          styleStr = fg ? `${fg} ${bg}`.trim() : bg;
        }
        if (styleStr) text.stylize(styleStr, pos + colIndex, pos + colIndex + 1);
      } else {
        const style = styleMap.get(styleKey);
        if (style) {
          if (ch !== SPACE || styleKey.startsWith(SECTION_PREFIX)) {
            text.stylize(style, pos + colIndex, pos + colIndex + 1);
          }
        }
      }
    }
    pos += line.length + NEWLINE.length;
  }

  return text;
}

/** How much lighter a card sits than the column it is laid on. */
const CARD_LIFT = 30;
const CHANNEL_MAX = 255;
/** What a foreground-only section is brightened by, a background colour being far too dark to read as text. */
const FOREGROUND_GAIN = 3;
const WHITE_ON = `${BOLD} white on `;

const lift = (rgb: RGB, by: number): RGB => ({
  r: Math.min(CHANNEL_MAX, rgb.r + by),
  g: Math.min(CHANNEL_MAX, rgb.g + by),
  b: Math.min(CHANNEL_MAX, rgb.b + by),
});

const gain = (rgb: RGB, by: number): RGB => ({
  r: Math.min(CHANNEL_MAX, rgb.r * by),
  g: Math.min(CHANNEL_MAX, rgb.g * by),
  b: Math.min(CHANNEL_MAX, rgb.b * by),
});

/** A canvas a specialised renderer already drew, painted by a theme. */
export function renderSequenceRich(canvas: Canvas, theme: string = DEFAULT): Text {
  const th: Theme = getTheme(theme);
  const sectionColors = th.sectionColors;

  const styleMap = new Map<string, string>([
    [NODE, th.node],
    [EDGE, th.edge],
    [ARROW, th.arrow],
    [LABEL, th.label],
    [EDGE_LABEL, th.edgeLabel],
    [DEFAULT, th.default],
  ]);

  for (let i = 0; i < sectionColors.length; i++) {
    const base = sectionColors[i % sectionColors.length] as string;
    styleMap.set(`${SECTION_PREFIX}${i}`, WHITE_ON + base);
    const rgb = parseHex(base);
    if (rgb === null) continue;
    styleMap.set(`${SECTION_PREFIX}${i}${DEEP_SUFFIX}`, WHITE_ON + formatHex(lift(rgb, CARD_LIFT)));
    styleMap.set(`${SECTION_FOREGROUND_PREFIX}${i}`, `${BOLD} ${formatHex(gain(rgb, FOREGROUND_GAIN))}`);
  }

  const styledPairs = canvas.toStyledPairs();
  const lines = trimmedLines(styledPairs, true);
  const text = new Text(lines.join(NEWLINE));

  const isSolid = th.isSolid;

  let pos = 0;
  for (let rowIndex = 0; rowIndex < styledPairs.length; rowIndex++) {
    if (rowIndex >= lines.length) break;
    const line = [...(lines[rowIndex] as string)];
    const row = styledPairs[rowIndex] as ReadonlyArray<readonly [string, string]>;
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      if (colIndex >= line.length) break;
      const [ch, styleKey] = row[colIndex] as readonly [string, string];
      if (isSolid) {
        let styleStr: string;
        if (styleKey.startsWith(SECTION_FOREGROUND_PREFIX)) {
          styleStr = ch !== SPACE ? (styleMap.get(styleKey) ?? EMPTY) : EMPTY;
        } else if (styleKey.startsWith(SECTION_PREFIX)) {
          styleStr =
            styleMap.get(styleKey) ?? styleMap.get(styleKey.split(DEEP_SUFFIX)[0] as string) ?? th.bgDefault;
        } else if (styleKey === NODE || styleKey === LABEL) {
          const fg = ch !== SPACE ? (styleMap.get(styleKey) ?? EMPTY) : EMPTY;
          styleStr = fg ? `${fg} ${th.bgNode}`.trim() : th.bgNode;
        } else {
          // A blank cell outside a section is left transparent, so only what was drawn takes a colour.
          styleStr = ch !== SPACE ? (styleMap.get(styleKey) ?? EMPTY) : EMPTY;
        }
        if (styleStr) text.stylize(styleStr, pos + colIndex, pos + colIndex + 1);
      } else {
        const style = styleMap.get(styleKey);
        if (style && (ch !== SPACE || styleKey.startsWith(SECTION_PREFIX))) {
          text.stylize(style, pos + colIndex, pos + colIndex + 1);
        }
      }
    }
    pos += line.length + NEWLINE.length;
  }

  return text;
}
