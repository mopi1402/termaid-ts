// Ported from src/termaid/renderer/timeline.py.
//
// A vertical line, its sections and events hung off it. Nothing here is laid out or routed: the drawing is the text.

import type { Timeline } from "../model/timeline.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** The style keys a theme paints these lines from. */
const STYLE_LABEL = "label";
const STYLE_DEFAULT = "default";
const STYLE_DETAIL = "edge_label";
/** Per section, so two sections next to each other are told apart by colour alone. */
const sectionStyle = (index: number): string => `sectionfg:${index}`;

const EMPTY_SIZE = 1;
/** One column past the longest line, which is what the reference leaves. */
const RIGHT_MARGIN = 1;

/** A line of the drawing and the style key it carries. */
type StyledLine = readonly [string, string];

export function renderTimeline(diagram: Timeline, useAscii = false): Canvas {
  if (diagram.sections.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const vertical = useAscii ? "|" : "│";
  const horizontal = useAscii ? "-" : "─";
  const bullet = useAscii ? "o" : "●";
  const rule = useAscii ? "=" : "═";

  const lines: StyledLine[] = [];

  if (diagram.title !== "") {
    lines.push([diagram.title, STYLE_LABEL]);
    lines.push(["", STYLE_DEFAULT]);
  }

  diagram.sections.forEach((section, si) => {
    const style = sectionStyle(si);

    if (section.title !== "") {
      lines.push([` ${rule}${rule} ${section.title} ${rule}${rule}`, style]);
      lines.push([` ${vertical}`, style]);
    }

    section.events.forEach((event, ei) => {
      const lastEvent = ei === section.events.length - 1;
      const lastSection = si === diagram.sections.length - 1;

      lines.push([` ${bullet}${horizontal}${horizontal} ${event.title}`, style]);
      for (const detail of event.details) lines.push([` ${vertical}   ${detail}`, STYLE_DETAIL]);
      // The line goes on below every event but the very last one, which has nothing left to reach.
      if (!(lastEvent && lastSection)) lines.push([` ${vertical}`, style]);
    });
  });

  const widths = lines.map(([text]) => displayWidth(text));
  const width = (widths.length === 0 ? EMPTY_SIZE : Math.max(...widths)) + RIGHT_MARGIN;
  const canvas = new Canvas(width, lines.length);
  lines.forEach(([text, style], row) => canvas.putText(row, 0, text, style));
  return canvas;
}
