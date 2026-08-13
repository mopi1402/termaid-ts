// Ported from src/termaid/renderer/charset.py.

/** Every character a drawing is made of, so the same layout can be drawn in box characters or in plain ASCII. */
export interface CharSet {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;

  roundTopLeft: string;
  roundTopRight: string;
  roundBottomLeft: string;
  roundBottomRight: string;

  arrowRight: string;
  arrowLeft: string;
  arrowDown: string;
  arrowUp: string;

  lineHorizontal: string;
  lineVertical: string;
  lineDottedH: string;
  lineDottedV: string;
  lineThickH: string;
  lineThickV: string;

  cornerTopLeft: string;
  cornerTopRight: string;
  cornerBottomLeft: string;
  cornerBottomRight: string;

  teeRight: string;
  teeLeft: string;
  teeDown: string;
  teeUp: string;

  cross: string;

  diamondTop: string;
  diamondBottom: string;
  diamondLeft: string;
  diamondRight: string;

  circleEndpoint: string;
  crossEndpoint: string;

  sgTopLeft: string;
  sgTopRight: string;
  sgBottomLeft: string;
  sgBottomRight: string;
  sgHorizontal: string;
  sgVertical: string;
}

export const UNICODE: CharSet = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  roundTopLeft: "╭",
  roundTopRight: "╮",
  roundBottomLeft: "╰",
  roundBottomRight: "╯",
  arrowRight: "►",
  arrowLeft: "◄",
  arrowDown: "▼",
  arrowUp: "▲",
  lineHorizontal: "─",
  lineVertical: "│",
  lineDottedH: "┄",
  lineDottedV: "┆",
  lineThickH: "━",
  lineThickV: "┃",
  cornerTopLeft: "┌",
  cornerTopRight: "┐",
  cornerBottomLeft: "└",
  cornerBottomRight: "┘",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
  diamondTop: "◇",
  diamondBottom: "◇",
  diamondLeft: "◇",
  diamondRight: "◇",
  circleEndpoint: "○",
  crossEndpoint: "×",
  sgTopLeft: "┌",
  sgTopRight: "┐",
  sgBottomLeft: "└",
  sgBottomRight: "┘",
  sgHorizontal: "─",
  sgVertical: "│",
};

export const ASCII: CharSet = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  roundTopLeft: "+",
  roundTopRight: "+",
  roundBottomLeft: "+",
  roundBottomRight: "+",
  arrowRight: ">",
  arrowLeft: "<",
  arrowDown: "v",
  arrowUp: "^",
  lineHorizontal: "-",
  lineVertical: "|",
  lineDottedH: ".",
  lineDottedV: ":",
  lineThickH: "=",
  lineThickV: "H",
  cornerTopLeft: "+",
  cornerTopRight: "+",
  cornerBottomLeft: "+",
  cornerBottomRight: "+",
  teeRight: "+",
  teeLeft: "+",
  teeDown: "+",
  teeUp: "+",
  cross: "+",
  diamondTop: "/",
  diamondBottom: "\\",
  diamondLeft: "/",
  diamondRight: "\\",
  circleEndpoint: "o",
  crossEndpoint: "x",
  sgTopLeft: "+",
  sgTopRight: "+",
  sgBottomLeft: "+",
  sgBottomRight: "+",
  sgHorizontal: "-",
  sgVertical: "|",
};
