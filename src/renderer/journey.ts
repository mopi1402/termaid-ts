// Ported from src/termaid/renderer/journey.py.
//
// One line of tasks running left to right, grouped under section bars, each task carrying the actors who took part and
// a face for how it went.

import { DEFAULT_SCORE, type Journey } from "../model/journey.js";
import { pySorted } from "../pycompat.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** How a score reads: a face per level, and three characters where the terminal has no emoji. */
const FACE: Record<number, string> = { 1: "😞", 2: "😟", 3: "😐", 4: "😊", 5: "😄" };
const FACE_ASCII: Record<number, string> = { 1: ":((", 2: ":( ", 3: ":-|", 4: ":) ", 5: ":D " };

/** One symbol per actor, so a task says who took part without naming them again. */
const ACTOR_SYMBOLS = ["●", "◆", "■", "▲", "★", "◉", "◈", "▶"];
const ACTOR_SYMBOLS_ASCII = ["*", "+", "#", "^", "@", "o", "x", ">"];

const EMPTY_SIZE = 1;
/** The narrowest a task box may be, and what the padding is multiplied by to widen it. */
const MIN_TASK_WIDTH = 8;
const TASK_WIDTH_FACTOR = 4;
/** Where the first section starts, and the room left past the last one. */
const LEFT_MARGIN = 2;
const RIGHT_MARGIN = 4;
/** Two columns more than the gap between tasks, so a section reads as a group. */
const SECTION_EXTRA_GAP = 2;
/** Rows a task box takes, and how far below it the face sits. */
const TASK_ROWS = 3;

const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const sectionStyle = (index: number): string => `section:${index}`;
const actorStyle = (index: number): string => `sectionfg:${index}`;

/** A task once it is measured: what it says, how it went, who was there, and how wide its box is. */
interface Placed {
  title: string;
  score: number;
  actors: string[];
  width: number;
  x: number;
  section: number;
}

export function renderJourney(diagram: Journey, useAscii = false, paddingX = 2, gap = 1, rounded = true): Canvas {
  if (diagram.sections.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const faces = useAscii ? FACE_ASCII : FACE;
  const symbols = useAscii ? ACTOR_SYMBOLS_ASCII : ACTOR_SYMBOLS;
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const [topLeft, topRight, bottomLeft, bottomRight] = useAscii
    ? ["+", "+", "+", "+"]
    : rounded
      ? ["╭", "╮", "╰", "╯"]
      : ["┌", "┐", "└", "┘"];
  const arrow = useAscii ? ">" : "►";

  const taskWidth = Math.max(MIN_TASK_WIDTH, paddingX * TASK_WIDTH_FACTOR);
  const actors = new Set<string>();

  const placed: Placed[] = [];
  const spans: Array<readonly [number, number, string]> = [];
  let x = LEFT_MARGIN;

  diagram.sections.forEach((section, si) => {
    if (si > 0) x += gap + SECTION_EXTRA_GAP;
    const start = x;
    for (const task of section.tasks) {
      const width = Math.max(taskWidth, displayWidth(task.title) + paddingX * 2);
      placed.push({ title: task.title, score: task.score, actors: task.actors, width, x, section: si });
      for (const actor of task.actors) actors.add(actor);
      x += width + gap;
    }
    spans.push([start, x - gap, section.title]);
  });

  const totalWidth = x + RIGHT_MARGIN;
  const legend = pySorted(actors);

  const actorRow = diagram.title !== "" ? 2 : 0;
  const sectionRow = actorRow + legend.length + 1;
  const timelineRow = sectionRow + 2;
  const faceRow = timelineRow + TASK_ROWS;
  const canvas = new Canvas(totalWidth + 1, faceRow + 2 + 1);

  if (diagram.title !== "") canvas.putText(0, LEFT_MARGIN, diagram.title, STYLE_LABEL);

  legend.forEach((actor, ai) => {
    const style = actorStyle(ai);
    canvas.put(actorRow + ai, LEFT_MARGIN, symbols[ai % symbols.length] as string, false, style);
    canvas.putText(actorRow + ai, LEFT_MARGIN + 2, actor, style);
  });

  spans.forEach(([start, end, title], si) => {
    const style = sectionStyle(si);
    canvas.put(sectionRow, start, topLeft as string, false, style);
    for (let c = start + 1; c < end; c++) canvas.put(sectionRow, c, horizontal, false, style);
    canvas.put(sectionRow, end, topRight as string, false, style);

    const at = Math.max(start + 1, start + Math.floor((end - start - displayWidth(title)) / 2));
    // The bar is cut open where the title lands, or the rule would run straight through the word.
    for (let c = at - 1; c < at + displayWidth(title) + 1; c++) {
      if (c > start && c < end) canvas.clearChar(sectionRow, c);
    }
    canvas.putText(sectionRow, at, title, style);
  });

  // The timeline is drawn BEFORE the boxes, which then clear their own interior over it.
  for (let c = 1; c < totalWidth - 1; c++) canvas.put(timelineRow + 1, c, horizontal, false, STYLE_EDGE);
  canvas.put(timelineRow + 1, totalWidth - 1, arrow, false, STYLE_EDGE);

  for (const task of placed) {
    const style = sectionStyle(task.section);
    const { x: left, width } = task;

    canvas.put(timelineRow, left, topLeft as string, false, style);
    for (let c = left + 1; c < left + width - 1; c++) canvas.put(timelineRow, c, horizontal, false, style);
    canvas.put(timelineRow, left + width - 1, topRight as string, false, style);

    canvas.put(timelineRow + 1, left, vertical, false, style);
    canvas.put(timelineRow + 1, left + width - 1, vertical, false, style);

    canvas.put(timelineRow + 2, left, bottomLeft as string, false, style);
    for (let c = left + 1; c < left + width - 1; c++) canvas.put(timelineRow + 2, c, horizontal, false, style);
    canvas.put(timelineRow + 2, left + width - 1, bottomRight as string, false, style);

    for (let c = left + 1; c < left + width - 1; c++) canvas.clearChar(timelineRow + 1, c);
    canvas.putText(timelineRow + 1, left + Math.floor((width - displayWidth(task.title)) / 2), task.title, style);

    let actorX = left + 1;
    legend.forEach((actor, ai) => {
      if (!task.actors.includes(actor)) return;
      canvas.put(timelineRow, actorX, symbols[ai % symbols.length] as string, false, actorStyle(ai));
      actorX += 1;
    });

    const face = faces[task.score] ?? (faces[DEFAULT_SCORE] as string);
    canvas.putText(faceRow, left + Math.floor((width - displayWidth(face)) / 2), face, STYLE_EDGE_LABEL);
  }

  return canvas;
}
