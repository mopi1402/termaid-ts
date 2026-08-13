// Ported from src/termaid/renderer/shapes/__init__.py.
//
// One drawing routine per node shape, each one putting its own border on the canvas and centring the label inside it.

import { NodeShape } from "../graph/shapes.js";
import { displayWidth } from "../utils.js";
import type { Canvas } from "./canvas.js";
import type { CharSet } from "./charset.js";

export type ShapeRenderer = (
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  cs: CharSet,
  style?: string
) => void;

/** What tells a UNICODE character set from the ASCII one, read off the one character both spell differently. */
const isUnicode = (cs: CharSet): boolean => cs.horizontal === "─";

/** The style key a label carries, which is only set where the node itself carries one. */
const LABEL_STYLE = "label";
/** A label written by the flowchart wrapper carries a literal `\n`; one from a note carries a real newline. */
const LITERAL_NEWLINE = "\\n";
const NEWLINE = "\n";

/** The label, centred in both directions inside the shape. */
function drawLabel(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  style = ""
): void {
  const labelStyle = style !== "" ? LABEL_STYLE : "";
  const lines = label.includes(NEWLINE)
    ? label.split(NEWLINE)
    : label.includes(LITERAL_NEWLINE)
      ? label.split(LITERAL_NEWLINE)
      : [label];
  const startRow = y + Math.floor((height - lines.length) / 2);
  lines.forEach((line, i) => {
    const row = startRow + i;
    const col = x + Math.floor((width - displayWidth(line)) / 2);
    if (row >= 0 && row < canvas.height) canvas.putText(row, col, line, labelStyle);
  });
}

/** The four sides of a box, its own characters at the corners. */
function frame(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  cs: CharSet,
  style: string,
  corners: readonly [string, string, string, string],
  sides: readonly [string, string] = [cs.vertical, cs.vertical]
): void {
  const [topLeft, topRight, bottomLeft, bottomRight] = corners;
  canvas.put(y, x, topLeft, true, style);
  canvas.put(y, x + width - 1, topRight, true, style);
  canvas.put(y + height - 1, x, bottomLeft, true, style);
  canvas.put(y + height - 1, x + width - 1, bottomRight, true, style);
  for (let c = x + 1; c < x + width - 1; c++) {
    canvas.put(y, c, cs.horizontal, true, style);
    canvas.put(y + height - 1, c, cs.horizontal, true, style);
  }
  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x, sides[0], true, style);
    canvas.put(r, x + width - 1, sides[1], true, style);
  }
}

export const drawRectangle: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  frame(canvas, x, y, width, height, cs, style, [cs.topLeft, cs.topRight, cs.bottomLeft, cs.bottomRight]);
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawRounded: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  frame(canvas, x, y, width, height, cs, style, [
    cs.roundTopLeft,
    cs.roundTopRight,
    cs.roundBottomLeft,
    cs.roundBottomRight,
  ]);
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawStadium: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  frame(
    canvas,
    x,
    y,
    width,
    height,
    cs,
    style,
    [cs.roundTopLeft, cs.roundTopRight, cs.roundBottomLeft, cs.roundBottomRight],
    ["(", ")"]
  );
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawSubroutine: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  drawRectangle(canvas, x, y, width, height, label, cs, style);
  if (width <= 4) return;
  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x + 1, cs.vertical, true, style);
    canvas.put(r, x + width - 2, cs.vertical, true, style);
  }
};

export const drawDiamond: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  const cx = x + Math.floor(width / 2);
  const marker = isUnicode(cs) ? "◇" : "*";
  frame(canvas, x, y, width, height, cs, style, [cs.topLeft, cs.topRight, cs.bottomLeft, cs.bottomRight]);
  canvas.put(y, cx, marker, false, style);
  canvas.put(y + height - 1, cx, marker, false, style);
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawHexagon: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  canvas.put(y, x + 1, "/", true, style);
  for (let c = x + 2; c < x + width - 2; c++) canvas.put(y, c, cs.horizontal, true, style);
  canvas.put(y, x + width - 2, "\\", true, style);

  canvas.put(y + height - 1, x + 1, "\\", true, style);
  for (let c = x + 2; c < x + width - 2; c++) canvas.put(y + height - 1, c, cs.horizontal, true, style);
  canvas.put(y + height - 1, x + width - 2, "/", true, style);

  const side = isUnicode(cs) ? cs.vertical : "|";
  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x, side, true, style);
    canvas.put(r, x + width - 1, side, true, style);
  }
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawCircle: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  const cx = x + Math.floor(width / 2);
  const marker = isUnicode(cs) ? "◯" : "O";
  drawRounded(canvas, x, y, width, height, label, cs, style);
  canvas.put(y, cx, marker, false, style);
  canvas.put(y + height - 1, cx, marker, false, style);
};

export const drawDoubleCircle: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  drawRounded(canvas, x, y, width, height, label, cs, style);
  if (width <= 4 || height <= 2) return;
  canvas.put(y + 1, x + 1, cs.roundTopLeft, true, style);
  for (let c = x + 2; c < x + width - 2; c++) canvas.put(y + 1, c, cs.horizontal, true, style);
  canvas.put(y + 1, x + width - 2, cs.roundTopRight, true, style);

  canvas.put(y + height - 2, x + 1, cs.roundBottomLeft, true, style);
  for (let c = x + 2; c < x + width - 2; c++) canvas.put(y + height - 2, c, cs.horizontal, true, style);
  canvas.put(y + height - 2, x + width - 2, cs.roundBottomRight, true, style);
};

export const drawAsymmetric: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  const cy = y + Math.floor(height / 2);
  for (let r = y; r < y + height; r++) {
    canvas.put(r, x, r < cy ? "\\" : r === cy ? ">" : "/", true, style);
  }
  canvas.put(y, x + width - 1, cs.topRight, true, style);
  canvas.put(y + height - 1, x + width - 1, cs.bottomRight, true, style);
  for (let r = y + 1; r < y + height - 1; r++) canvas.put(r, x + width - 1, cs.vertical, true, style);
  for (let c = x + 1; c < x + width - 1; c++) {
    canvas.put(y, c, cs.horizontal, true, style);
    canvas.put(y + height - 1, c, cs.horizontal, true, style);
  }
  drawLabel(canvas, x, y, width, height, label, style);
};

export const drawCylinder: ShapeRenderer = (canvas, x, y, width, height, label, cs, style = "") => {
  canvas.put(y, x, cs.roundTopLeft, true, style);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y, c, cs.horizontal, true, style);
  canvas.put(y, x + width - 1, cs.roundTopRight, true, style);

  canvas.put(y + 1, x, cs.roundBottomLeft, true, style);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y + 1, c, cs.horizontal, true, style);
  canvas.put(y + 1, x + width - 1, cs.roundBottomRight, true, style);

  for (let r = y + 2; r < y + height - 1; r++) {
    canvas.put(r, x, cs.vertical, true, style);
    canvas.put(r, x + width - 1, cs.vertical, true, style);
  }

  canvas.put(y + height - 1, x, cs.roundBottomLeft, true, style);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y + height - 1, c, cs.horizontal, true, style);
  canvas.put(y + height - 1, x + width - 1, cs.roundBottomRight, true, style);

  drawLabel(canvas, x, y, width, height, label, style);
};

/** The four slanted shapes, which differ only in the character each corner takes. */
function slanted(corners: readonly [string, string, string, string]): ShapeRenderer {
  return (canvas, x, y, width, height, label, cs, style = "") => {
    frame(canvas, x, y, width, height, cs, style, corners);
    drawLabel(canvas, x, y, width, height, label, style);
  };
}

export const drawTrapezoid = slanted(["/", "\\", "\\", "/"]);
export const drawTrapezoidAlt = slanted(["\\", "/", "/", "\\"]);
export const drawParallelogram = slanted(["/", "/", "/", "/"]);
export const drawParallelogramAlt = slanted(["\\", "\\", "\\", "\\"]);

export const drawStartState: ShapeRenderer = (canvas, x, y, width, height, _label, cs, style = "") => {
  canvas.put(y + Math.floor(height / 2), x + Math.floor(width / 2), isUnicode(cs) ? "●" : "*", true, style);
};

export const drawEndState: ShapeRenderer = (canvas, x, y, width, height, _label, cs, style = "") => {
  canvas.put(y + Math.floor(height / 2), x + Math.floor(width / 2), isUnicode(cs) ? "◉" : "@", true, style);
};

export const drawForkJoin: ShapeRenderer = (canvas, x, y, width, height, _label, cs, style = "") => {
  const bar = isUnicode(cs) ? "━" : "=";
  for (let r = y; r < y + height; r++) for (let c = x; c < x + width; c++) canvas.put(r, c, bar, true, style);
};

/** A junction is a routing point and draws nothing at all. */
const drawJunction: ShapeRenderer = () => undefined;

export const SHAPE_RENDERERS: ReadonlyMap<NodeShape, ShapeRenderer> = new Map([
  [NodeShape.RECTANGLE, drawRectangle],
  [NodeShape.ROUNDED, drawRounded],
  [NodeShape.STADIUM, drawStadium],
  [NodeShape.SUBROUTINE, drawSubroutine],
  [NodeShape.DIAMOND, drawDiamond],
  [NodeShape.HEXAGON, drawHexagon],
  [NodeShape.CIRCLE, drawCircle],
  [NodeShape.DOUBLE_CIRCLE, drawDoubleCircle],
  [NodeShape.ASYMMETRIC, drawAsymmetric],
  [NodeShape.CYLINDER, drawCylinder],
  [NodeShape.PARALLELOGRAM, drawParallelogram],
  [NodeShape.PARALLELOGRAM_ALT, drawParallelogramAlt],
  [NodeShape.TRAPEZOID, drawTrapezoid],
  [NodeShape.TRAPEZOID_ALT, drawTrapezoidAlt],
  [NodeShape.START_STATE, drawStartState],
  [NodeShape.END_STATE, drawEndState],
  [NodeShape.FORK_JOIN, drawForkJoin],
  [NodeShape.JUNCTION, drawJunction],
]);
