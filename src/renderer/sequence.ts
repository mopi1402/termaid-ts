// Ported from src/termaid/renderer/sequence.py.
//
// Nothing here goes through the grid layout or the edge routing a flowchart uses: a participant is a column, an event
// is a row, and the whole drawing is a walk down a list of events flattened out of its blocks.

import type {
  ActivateEvent,
  Block,
  BlockSection,
  DestroyEvent,
  Event,
  Message,
  Note,
  Participant,
  SequenceDiagram,
} from "../model/sequence.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";
import { ASCII, UNICODE, type CharSet } from "./charset.js";
import { drawCylinder, drawRectangle } from "./shapes.js";

const BOX_PAD = 4;
const BOX_HEIGHT = 3;
/** The head, the body, the legs, a blank row and the label under them. */
const ACTOR_HEIGHT = 5;
const MIN_GAP = 16;
const EVENT_ROW_H = 2;
const BLOCK_START_H = 3;
const BLOCK_SECTION_H = 2;
const BLOCK_END_H = 2;
const TOP_MARGIN = 0;
const BOTTOM_MARGIN = 1;
const EMPTY_SIZE = 1;

/** The height a symbol other than the plain box is drawn at. */
const SYMBOL_HEIGHT = 5;
/** Blank columns a note keeps inside its own border, the room asked of the gap it sits in, and its offset. */
const NOTE_PAD = 4;
const NOTE_GAP_ROOM = 4;
const NOTE_OFFSET = 2;
/** How far a block's frame reaches past the outermost lifelines, and what each nesting level pulls it in by. */
const FRAME_REACH = 6;
const FRAME_INDENT = 2;
/** The smallest loop a self-message is drawn as, and the room its label is given inside one. */
const SELF_LOOP_MIN = 8;
const SELF_LOOP_PAD = 4;
/** Room kept around a message's label, which is what pushes two lifelines apart. */
const LABEL_ROOM = 6;
/** Where a block's frame falls back to when there is no participant to hang it off. */
const EMPTY_FRAME_RIGHT = 20;

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const STYLE_ARROW = "arrow";

const DOTTED = "dotted";
const RIGHT_OF = "rightof";
const LEFT_OF = "leftof";
const OVER = "over";

/** How tall each kind of participant is drawn, which is what sets the header's height. */
const KIND_HEIGHT: Readonly<Record<string, number>> = {
  participant: 3,
  actor: 5,
  database: 5,
  queue: 5,
  boundary: 5,
  control: 5,
  entity: 5,
  collections: 5,
};
const DEFAULT_KIND_HEIGHT = 3;

/** A block's boundaries, which take a row of their own once the events are laid out in a line. */
interface BlockStart {
  type: "blockStart";
  block: Block;
  depth: number;
}
interface BlockSectionBreak {
  type: "blockSection";
  section: BlockSection;
  depth: number;
}
interface BlockEnd {
  type: "blockEnd";
  block: Block;
  depth: number;
}
type FlatEvent = Exclude<Event, Block> | BlockStart | BlockSectionBreak | BlockEnd;

/** Every event in one line, a block becoming a start marker, its contents, its sections and an end marker. */
function flattenEvents(events: Event[], depth = 0): FlatEvent[] {
  const flat: FlatEvent[] = [];
  for (const event of events) {
    if (event.type !== "block") {
      flat.push(event);
      continue;
    }
    flat.push({ type: "blockStart", block: event, depth });
    flat.push(...flattenEvents(event.events, depth + 1));
    for (const section of event.sections) {
      flat.push({ type: "blockSection", section, depth });
      flat.push(...flattenEvents(section.events, depth + 1));
    }
    flat.push({ type: "blockEnd", block: event, depth });
  }
  return flat;
}

const noteLines = (note: Note): string[] => (note.text.includes("\n") ? note.text.split("\n") : [note.text]);

const noteWidth = (note: Note): number => Math.max(...noteLines(note).map(displayWidth)) + NOTE_PAD;

const participantIndex = (diagram: SequenceDiagram, id: string): number =>
  diagram.participants.findIndex((participant) => participant.id === id);

/** The label a message shows, which carries its number where the diagram asked to be numbered. */
function effectiveLabel(message: Message, number: number | null): string {
  if (number === null) return message.label;
  const prefix = `${number}: `;
  return message.label !== "" ? prefix + message.label : prefix.trimEnd();
}

interface Layout {
  colCenters: number[];
  boxWidths: number[];
  width: number;
  height: number;
  headerHeight: number;
  rowOffsets: number[];
}

/** How tall one event is drawn, an activation taking no row of its own. */
function eventHeight(event: FlatEvent): number {
  switch (event.type) {
    case "activate":
      return 0;
    case "destroy":
      return EVENT_ROW_H;
    case "note":
      return noteLines(event).length + 2 + 1;
    case "blockStart":
      return BLOCK_START_H;
    case "blockSection":
      return BLOCK_SECTION_H;
    case "blockEnd":
      return BLOCK_END_H;
    case "message":
      // A self-message loops back under its own label row.
      return event.source === event.target ? EVENT_ROW_H + 1 : EVENT_ROW_H;
    default:
      return 0;
  }
}

function computeLayout(
  diagram: SequenceDiagram,
  autonumber: boolean,
  flat: FlatEvent[],
  paddingX: number,
  minGap: number
): Layout {
  const n = diagram.participants.length;
  if (n === 0) return { colCenters: [], boxWidths: [], width: 0, height: 0, headerHeight: 0, rowOffsets: [] };

  // Two more columns than the label takes, for the borders around it.
  const boxWidths = diagram.participants.map((p) => displayWidth(p.label) + paddingX + 2);
  const headerHeight = Math.max(...diagram.participants.map((p) => KIND_HEIGHT[p.kind] ?? DEFAULT_KIND_HEIGHT));

  const heights: number[] = [];
  const labels: string[] = [];
  let counter = 0;
  for (const event of flat) {
    if (event.type === "message") {
      counter += 1;
      labels.push(effectiveLabel(event, autonumber ? counter : null));
    } else {
      labels.push("");
    }
    heights.push(eventHeight(event));
  }

  const gaps = n > 1 ? Array.from({ length: n - 1 }, () => minGap) : [];
  for (let i = 0; i < n - 1; i++) {
    const needed = Math.floor(((boxWidths[i] as number) + (boxWidths[i + 1] as number)) / 2) + 2;
    gaps[i] = Math.max(gaps[i] as number, needed);
  }

  /** What one span of gaps has to carry between two columns, shared out over the gaps it crosses. */
  const spread = (low: number, high: number, needed: number): void => {
    const spans = high - low;
    const perGap = Math.floor((needed + spans - 1) / spans);
    for (let g = low; g < high; g++) gaps[g] = Math.max(gaps[g] as number, perGap);
  };

  flat.forEach((event, index) => {
    if (event.type === "note") {
      const width = noteWidth(event);
      for (const id of event.participants) {
        const at = participantIndex(diagram, id);
        if (at < 0) continue;
        if (event.position === RIGHT_OF && at < n - 1) gaps[at] = Math.max(gaps[at] as number, width + NOTE_GAP_ROOM);
        else if (event.position === LEFT_OF && at > 0) {
          gaps[at - 1] = Math.max(gaps[at - 1] as number, width + NOTE_GAP_ROOM);
        }
      }
      if (event.position === OVER && event.participants.length === 2) {
        const first = participantIndex(diagram, event.participants[0] as string);
        const second = participantIndex(diagram, event.participants[1] as string);
        if (first >= 0 && second >= 0) spread(Math.min(first, second), Math.max(first, second), width);
      }
      return;
    }

    if (event.type !== "message") return;
    const source = participantIndex(diagram, event.source);
    const target = participantIndex(diagram, event.target);
    if (source < 0 || target < 0 || source === target) return;
    const needed = displayWidth(labels[index] as string) + LABEL_ROOM;
    spread(Math.min(source, target), Math.max(source, target), needed);
  });

  const colCenters = [Math.floor((boxWidths[0] as number) / 2) + 1];
  for (let i = 1; i < n; i++) colCenters.push((colCenters[i - 1] as number) + (gaps[i - 1] as number));

  let maxRight = (colCenters[n - 1] as number) + Math.floor((boxWidths[n - 1] as number) / 2) + 2;
  for (const event of flat) {
    if (event.type === "message") {
      const at = participantIndex(diagram, event.source);
      if (at >= 0 && at === participantIndex(diagram, event.target)) {
        maxRight = Math.max(maxRight, (colCenters[at] as number) + selfLoopWidth(event.label) + 1);
      }
      continue;
    }

    if (event.type === "note") {
      const width = noteWidth(event);
      for (const id of event.participants) {
        const at = participantIndex(diagram, id);
        if (at >= 0 && event.position === RIGHT_OF) {
          maxRight = Math.max(maxRight, (colCenters[at] as number) + NOTE_OFFSET + width + 1);
        }
      }
      if (event.position !== OVER) continue;

      // A note drawn over its participants is clamped to the left edge, so what it reserves has to be clamped too.
      if (event.participants.length === 2) {
        const first = participantIndex(diagram, event.participants[0] as string);
        const second = participantIndex(diagram, event.participants[1] as string);
        if (first < 0 || second < 0) continue;
        const centre = Math.floor(((colCenters[first] as number) + (colCenters[second] as number)) / 2);
        const spanned = Math.abs((colCenters[first] as number) - (colCenters[second] as number)) + NOTE_PAD;
        const drawn = Math.max(width, spanned);
        maxRight = Math.max(maxRight, Math.max(0, centre - Math.floor(drawn / 2)) + drawn + 1);
      } else if (event.participants.length === 1) {
        const at = participantIndex(diagram, event.participants[0] as string);
        if (at < 0) continue;
        const left = Math.max(0, (colCenters[at] as number) - Math.floor(width / 2));
        maxRight = Math.max(maxRight, left + width + 1);
      }
      continue;
    }

    if (event.type === "blockStart") {
      maxRight = Math.max(maxRight, frameBounds(colCenters, event.depth)[1] + 1);
    }
  }

  const rowOffsets: number[] = [];
  let row = TOP_MARGIN + headerHeight + 1;
  for (const height of heights) {
    rowOffsets.push(row);
    row += height;
  }

  return { colCenters, boxWidths, width: maxRight, height: row + BOTTOM_MARGIN, headerHeight, rowOffsets };
}

const selfLoopWidth = (label: string): number => Math.max(displayWidth(label) + SELF_LOOP_PAD, SELF_LOOP_MIN);

/** A stick figure, standing on the row its label is written under. */
function drawActor(canvas: Canvas, cx: number, y: number, label: string): void {
  canvas.put(y, cx, "O", false, STYLE_NODE);
  canvas.put(y + 1, cx - 1, "/", false, STYLE_NODE);
  canvas.put(y + 1, cx, "|", false, STYLE_NODE);
  canvas.put(y + 1, cx + 1, "\\", false, STYLE_NODE);
  canvas.put(y + 2, cx - 1, "/", false, STYLE_NODE);
  canvas.put(y + 2, cx + 1, "\\", false, STYLE_NODE);
  canvas.putText(y + 4, cx - Math.floor(displayWidth(label) / 2), label, STYLE_LABEL);
}

/** A box whose right border is doubled, which is how a queue is told from a plain participant. */
function drawQueue(canvas: Canvas, cx: number, y: number, width: number, label: string, cs: CharSet, ascii: boolean) {
  const bx = cx - Math.floor(width / 2);
  const h = SYMBOL_HEIGHT;

  canvas.put(y, bx, cs.topLeft, true, STYLE_NODE);
  canvas.put(y, bx + width - 1, ascii ? cs.topRight : cs.roundTopRight, true, STYLE_NODE);
  canvas.put(y + h - 1, bx, cs.bottomLeft, true, STYLE_NODE);
  canvas.put(y + h - 1, bx + width - 1, ascii ? cs.bottomRight : cs.roundBottomRight, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) {
    canvas.put(y, c, cs.horizontal, true, STYLE_NODE);
    canvas.put(y + h - 1, c, cs.horizontal, true, STYLE_NODE);
  }
  for (let r = y + 1; r < y + h - 1; r++) {
    canvas.put(r, bx, cs.vertical, true, STYLE_NODE);
    if (ascii) canvas.put(r, bx + width - 1, cs.vertical, true, STYLE_NODE);
    else canvas.put(r, bx + width - 1, "║", false, STYLE_NODE);
  }

  const at = bx + Math.floor((width - displayWidth(label)) / 2);
  canvas.putText(y + Math.floor(h / 2), at, label, STYLE_LABEL);
}

/** A small box with a bar running out to its left. */
function drawBoundary(canvas: Canvas, cx: number, y: number, label: string, cs: CharSet, ascii: boolean): void {
  const left = cx - 1;
  const right = cx + 1;

  canvas.put(y, left, cs.topLeft, true, STYLE_NODE);
  canvas.put(y, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, right, cs.topRight, true, STYLE_NODE);

  const barStart = cx - 3;
  canvas.put(y + 1, barStart, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 1, barStart + 1, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 1, left, ascii ? cs.vertical : cs.teeLeft, true, STYLE_NODE);
  canvas.put(y + 1, cx, " ", false, STYLE_NODE);
  canvas.put(y + 1, right, cs.vertical, true, STYLE_NODE);

  canvas.put(y + 2, left, cs.bottomLeft, true, STYLE_NODE);
  canvas.put(y + 2, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 2, right, cs.bottomRight, true, STYLE_NODE);

  canvas.putText(y + 4, cx - Math.floor(displayWidth(label) / 2), label, STYLE_LABEL);
}

/** A small rounded box with an arrowhead over it. */
function drawControl(canvas: Canvas, cx: number, y: number, label: string, cs: CharSet, ascii: boolean): void {
  canvas.put(y, cx, ascii ? "<" : "◁", false, STYLE_NODE);
  canvas.put(y + 1, cx - 1, ascii ? cs.topLeft : cs.roundTopLeft, true, STYLE_NODE);
  canvas.put(y + 1, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, cx + 1, ascii ? cs.topRight : cs.roundTopRight, true, STYLE_NODE);
  canvas.put(y + 2, cx - 1, ascii ? cs.bottomLeft : cs.roundBottomLeft, true, STYLE_NODE);
  canvas.put(y + 2, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 2, cx + 1, ascii ? cs.bottomRight : cs.roundBottomRight, true, STYLE_NODE);
  canvas.putText(y + 4, cx - Math.floor(displayWidth(label) / 2), label, STYLE_LABEL);
}

/** A small rounded box with a rule under it. */
function drawEntity(canvas: Canvas, cx: number, y: number, label: string, cs: CharSet, ascii: boolean): void {
  canvas.put(y, cx - 1, ascii ? cs.topLeft : cs.roundTopLeft, true, STYLE_NODE);
  canvas.put(y, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, cx + 1, ascii ? cs.topRight : cs.roundTopRight, true, STYLE_NODE);
  canvas.put(y + 1, cx - 1, ascii ? cs.bottomLeft : cs.roundBottomLeft, true, STYLE_NODE);
  canvas.put(y + 1, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, cx + 1, ascii ? cs.bottomRight : cs.roundBottomRight, true, STYLE_NODE);
  for (let c = cx - 1; c <= cx + 1; c++) canvas.put(y + 2, c, cs.horizontal, false, STYLE_NODE);
  canvas.putText(y + 4, cx - Math.floor(displayWidth(label) / 2), label, STYLE_LABEL);
}

/** Two boxes one behind the other, which is how a collection is drawn. */
function drawCollections(
  canvas: Canvas,
  cx: number,
  y: number,
  width: number,
  label: string,
  cs: CharSet,
  ascii: boolean
): void {
  const bx = cx - Math.floor(width / 2);
  const h = SYMBOL_HEIGHT;

  for (let c = bx + 2; c <= bx + width; c++) canvas.put(y, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, bx + 1, cs.topLeft, true, STYLE_NODE);
  canvas.put(y, bx + width, cs.topRight, true, STYLE_NODE);
  canvas.put(y + 1, bx + width, cs.vertical, true, STYLE_NODE);

  canvas.put(y + 1, bx, cs.topLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y + 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, bx + width - 1, cs.topRight, true, STYLE_NODE);

  canvas.put(y + 2, bx + width, cs.bottomRight, true, STYLE_NODE);
  for (let r = y + 2; r < y + h - 1; r++) {
    canvas.put(r, bx, cs.vertical, true, STYLE_NODE);
    canvas.put(r, bx + width - 1, cs.vertical, true, STYLE_NODE);
  }
  canvas.put(y + 2, bx + width - 1, ascii ? cs.vertical : cs.teeLeft, true, STYLE_NODE);
  canvas.put(y + 2, bx + width, cs.bottomRight, true, STYLE_NODE);

  canvas.put(y + h - 1, bx, cs.bottomLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y + h - 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + h - 1, bx + width - 1, cs.bottomRight, true, STYLE_NODE);

  const at = bx + Math.floor((width - displayWidth(label)) / 2);
  canvas.putText(y + 1 + Math.floor((h - 1) / 2), at, label, STYLE_LABEL);
}

function drawParticipantHeader(
  canvas: Canvas,
  cx: number,
  boxWidth: number,
  headerHeight: number,
  participant: Participant,
  cs: CharSet,
  ascii: boolean
): void {
  const { kind, label } = participant;
  const symbolY = TOP_MARGIN + (headerHeight - SYMBOL_HEIGHT);

  if (kind === "actor") drawActor(canvas, cx, TOP_MARGIN + (headerHeight - ACTOR_HEIGHT), label);
  else if (kind === "database") {
    drawCylinder(canvas, cx - Math.floor(boxWidth / 2), symbolY, boxWidth, SYMBOL_HEIGHT, label, cs, STYLE_NODE);
  } else if (kind === "queue") drawQueue(canvas, cx, symbolY, boxWidth, label, cs, ascii);
  else if (kind === "boundary") drawBoundary(canvas, cx, symbolY, label, cs, ascii);
  else if (kind === "control") drawControl(canvas, cx, symbolY, label, cs, ascii);
  else if (kind === "entity") drawEntity(canvas, cx, symbolY, label, cs, ascii);
  else if (kind === "collections") drawCollections(canvas, cx, symbolY, boxWidth, label, cs, ascii);
  else {
    const boxY = TOP_MARGIN + (headerHeight - BOX_HEIGHT);
    drawRectangle(canvas, cx - Math.floor(boxWidth / 2), boxY, boxWidth, BOX_HEIGHT, label, cs, STYLE_NODE);
  }
}

/** Every stretch of rows a participant is active over, an activation still open at the end running to the last row. */
function computeActivationRanges(flat: FlatEvent[], rowOffsets: number[]): Map<string, Array<[number, number]>> {
  const open = new Map<string, number[]>();
  const ranges = new Map<string, Array<[number, number]>>();

  const record = (id: string, range: [number, number]): void => {
    const found = ranges.get(id);
    if (found === undefined) ranges.set(id, [range]);
    else found.push(range);
  };

  flat.forEach((event, index) => {
    if (event.type !== "activate") return;
    const row = rowOffsets[index] as number;
    if (event.active) {
      const starts = open.get(event.participant);
      if (starts === undefined) open.set(event.participant, [row]);
      else starts.push(row);
      return;
    }
    // A deactivation closes the activation opened LAST, so a nested pair closes inside out.
    const starts = open.get(event.participant);
    const start = starts?.pop();
    if (start !== undefined) record(event.participant, [start, row]);
  });

  const lastRow = rowOffsets.length === 0 ? 0 : Math.max(...rowOffsets) + 1;
  for (const [id, starts] of open) for (const start of starts) record(id, [start, lastRow]);

  return ranges;
}

const isActivated = (ranges: Map<string, Array<[number, number]>>, id: string, row: number): boolean =>
  (ranges.get(id) ?? []).some(([start, end]) => start <= row && row <= end);

/** How far a block's frame reaches, pulled in by two columns per level it is nested at. */
function frameBounds(colCenters: number[], depth: number): [number, number] {
  const indent = depth * FRAME_INDENT;
  if (colCenters.length === 0) return [indent, EMPTY_FRAME_RIGHT - indent];
  // The base is clamped to the canvas edge and the indent added ON TOP, so nesting stays visible where the
  // participants sit so tight that the base would land on column zero.
  return [
    Math.max(0, (colCenters[0] as number) - FRAME_REACH) + indent,
    (colCenters[colCenters.length - 1] as number) + FRAME_REACH - indent,
  ];
}

export function renderSequence(diagram: SequenceDiagram, useAscii = false, paddingX = BOX_PAD, gap = MIN_GAP): Canvas {
  const cs = useAscii ? ASCII : UNICODE;
  const flat = flattenEvents(diagram.events);
  const layout = computeLayout(diagram, diagram.autonumber, flat, paddingX, gap);
  if (layout.width === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const { colCenters, boxWidths, headerHeight, rowOffsets } = layout;
  const canvas = new Canvas(layout.width, layout.height);
  const ranges = computeActivationRanges(flat, rowOffsets);

  diagram.participants.forEach((participant, i) => {
    drawParticipantHeader(
      canvas,
      colCenters[i] as number,
      boxWidths[i] as number,
      headerHeight,
      participant,
      cs,
      useAscii
    );
  });

  const destroyed = new Map<string, number>();
  flat.forEach((event, index) => {
    if (event.type === "destroy" && !destroyed.has(event.participant)) {
      destroyed.set(event.participant, rowOffsets[index] as number);
    }
  });

  const lifelineStart = TOP_MARGIN + headerHeight;
  const lifelineEnd = layout.height - BOTTOM_MARGIN - 1;
  const lifelineChar = useAscii ? ":" : "┆";
  const activeChar = useAscii ? "[" : "║";
  diagram.participants.forEach((participant, i) => {
    const cx = colCenters[i] as number;
    const end = destroyed.get(participant.id) ?? lifelineEnd + 1;
    for (let r = lifelineStart; r < Math.min(end, lifelineEnd + 1); r++) {
      canvas.put(r, cx, isActivated(ranges, participant.id, r) ? activeChar : lifelineChar, false, STYLE_EDGE);
    }
  });

  // A block's sides are drawn in one pass, so a frame is unbroken between its own two markers.
  const frames: Array<[number, number, number]> = [];
  flat.forEach((event, index) => {
    if (event.type === "blockStart") {
      const [left, right] = frameBounds(colCenters, event.depth);
      frames.push([left, right, rowOffsets[index] as number]);
      return;
    }
    if (event.type !== "blockEnd") return;
    const frame = frames.pop();
    if (frame === undefined) return;
    const [left, right, start] = frame;
    for (let r = start + 1; r < (rowOffsets[index] as number); r++) {
      canvas.put(r, left, cs.vertical, false, STYLE_NODE);
      if (right < canvas.width) canvas.put(r, right, cs.vertical, false, STYLE_NODE);
    }
  });

  let counter = 0;
  flat.forEach((event, index) => {
    const row = rowOffsets[index] as number;

    switch (event.type) {
      case "activate":
        return;
      case "destroy": {
        const at = participantIndex(diagram, event.participant);
        if (at >= 0) canvas.put(row, colCenters[at] as number, useAscii ? "X" : "╳", false, STYLE_ARROW);
        return;
      }
      case "note":
        drawNote(canvas, event, row, colCenters, diagram, cs);
        return;
      case "blockStart":
        drawBlockStart(canvas, event, row, colCenters, cs);
        return;
      case "blockSection":
        drawBlockSection(canvas, event, row, colCenters, cs, useAscii);
        return;
      case "blockEnd":
        drawBlockEnd(canvas, event, row, colCenters, cs);
        return;
      case "message": {
        counter += 1;
        const label = effectiveLabel(event, diagram.autonumber ? counter : null);
        const source = participantIndex(diagram, event.source);
        const target = participantIndex(diagram, event.target);
        if (source < 0 || target < 0) return;
        if (source === target) drawSelfMessage(canvas, colCenters[source] as number, row, event, label, useAscii);
        else {
          drawMessage(canvas, colCenters[source] as number, colCenters[target] as number, row, event, label, useAscii);
        }
        return;
      }
      default:
        return;
    }
  });

  return canvas;
}

function drawBlockStart(canvas: Canvas, event: BlockStart, row: number, colCenters: number[], cs: CharSet): void {
  const [left, right] = frameBounds(colCenters, event.depth);

  canvas.put(row, left, cs.topLeft, false, STYLE_NODE);
  for (let c = left + 1; c < Math.min(right, canvas.width); c++) canvas.put(row, c, cs.horizontal, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.topRight, false, STYLE_NODE);

  if (row + 1 >= canvas.height) return;
  const { kind, label } = event.block;
  const written = label !== "" ? `[${kind}] ${label}` : `[${kind}]`;

  // The row is wiped first, or the lifelines already drawn would show through the label.
  canvas.put(row + 1, left, cs.vertical, false, STYLE_NODE);
  for (let c = left + 1; c < Math.min(right, canvas.width); c++) canvas.clearChar(row + 1, c);
  if (right < canvas.width) canvas.put(row + 1, right, cs.vertical, false, STYLE_NODE);
  canvas.putText(row + 1, left + 1, written, STYLE_EDGE_LABEL);
}

function drawBlockSection(
  canvas: Canvas,
  event: BlockSectionBreak,
  row: number,
  colCenters: number[],
  cs: CharSet,
  useAscii: boolean
): void {
  const [left, right] = frameBounds(colCenters, event.depth);
  const dash = useAscii ? "." : "┄";

  canvas.put(row, left, cs.vertical, false, STYLE_NODE);
  for (let c = left + 1; c < Math.min(right, canvas.width); c++) canvas.put(row, c, dash, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.vertical, false, STYLE_NODE);

  if (event.section.label !== "") canvas.putText(row, left + 2, `[${event.section.label}]`, STYLE_EDGE_LABEL);
}

function drawBlockEnd(canvas: Canvas, event: BlockEnd, row: number, colCenters: number[], cs: CharSet): void {
  const [left, right] = frameBounds(colCenters, event.depth);
  canvas.put(row, left, cs.bottomLeft, false, STYLE_NODE);
  for (let c = left + 1; c < Math.min(right, canvas.width); c++) canvas.put(row, c, cs.horizontal, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.bottomRight, false, STYLE_NODE);
}

function drawNote(
  canvas: Canvas,
  note: Note,
  row: number,
  colCenters: number[],
  diagram: SequenceDiagram,
  cs: CharSet
): void {
  const lines = noteLines(note);
  let width = noteWidth(note);
  const height = lines.length + 2;
  let x: number;

  if (note.position === RIGHT_OF || note.position === LEFT_OF) {
    const at = participantIndex(diagram, note.participants[0] as string);
    if (at < 0) return;
    x =
      note.position === RIGHT_OF
        ? (colCenters[at] as number) + NOTE_OFFSET
        : (colCenters[at] as number) - NOTE_OFFSET - width;
  } else if (note.position === OVER) {
    let centre: number;
    if (note.participants.length === 2) {
      const first = participantIndex(diagram, note.participants[0] as string);
      const second = participantIndex(diagram, note.participants[1] as string);
      if (first < 0 || second < 0) return;
      centre = Math.floor(((colCenters[first] as number) + (colCenters[second] as number)) / 2);
      // A note written over two participants has to reach both their lifelines.
      width = Math.max(width, Math.abs((colCenters[first] as number) - (colCenters[second] as number)) + NOTE_PAD);
    } else {
      const at = participantIndex(diagram, note.participants[0] as string);
      if (at < 0) return;
      centre = colCenters[at] as number;
    }
    x = centre - Math.floor(width / 2);
  } else {
    return;
  }

  x = Math.max(0, x);
  for (let r = row; r < row + height; r++) for (let c = x; c < x + width; c++) canvas.clearChar(r, c);
  drawRectangle(canvas, x, row, width, height, note.text, cs, STYLE_NODE);
}

function drawMessage(
  canvas: Canvas,
  sourceCol: number,
  targetCol: number,
  row: number,
  message: Message,
  label: string,
  useAscii: boolean
): void {
  const left = Math.min(sourceCol, targetCol);
  const right = Math.max(sourceCol, targetCol);
  const rightward = targetCol > sourceCol;
  const hChar = message.lineType === DOTTED ? (useAscii ? "." : "┄") : useAscii ? "-" : "─";

  // The two ends are left alone here: they carry the lifeline, and the arrowhead goes over one of them.
  for (let c = left + 1; c < right; c++) canvas.put(row, c, hChar, false, STYLE_EDGE);

  const head = (col: number, ch: string): void => canvas.put(row, col, ch, false, STYLE_ARROW);
  const tail = (col: number): void => canvas.put(row, col, hChar, false, STYLE_EDGE);

  if (message.arrowType === "bidirectional") {
    head(left, useAscii ? "<" : "◄");
    head(right, useAscii ? ">" : "►");
  } else if (message.arrowType === "arrow") {
    if (rightward) {
      head(right, useAscii ? ">" : "►");
      tail(left);
    } else {
      head(left, useAscii ? "<" : "◄");
      tail(right);
    }
  } else if (message.arrowType === "cross") {
    head(rightward ? right : left, "x");
    tail(rightward ? left : right);
  } else if (message.arrowType === "async") {
    head(rightward ? right : left, rightward ? ")" : "(");
    tail(rightward ? left : right);
  } else {
    tail(left);
    tail(right);
  }

  if (label !== "") canvas.putText(row - 1, left + 2, label, STYLE_EDGE_LABEL);
}

/** A message a participant sends itself, drawn as a loop out to the right and back. */
function drawSelfMessage(
  canvas: Canvas,
  col: number,
  row: number,
  message: Message,
  label: string,
  useAscii: boolean
): void {
  const width = selfLoopWidth(label);
  const dotted = message.lineType === DOTTED;
  const hChar = dotted ? (useAscii ? "." : "┄") : useAscii ? "-" : "─";
  const vChar = dotted ? (useAscii ? ":" : "┆") : useAscii ? "|" : "│";
  const rightCol = col + width - 1;

  for (let c = col + 1; c < col + width; c++) canvas.put(row, c, hChar, false, STYLE_EDGE);
  canvas.put(row + 1, rightCol, vChar, false, STYLE_EDGE);
  for (let c = col + 1; c < col + width; c++) canvas.put(row + 1, c, hChar, false, STYLE_EDGE);

  if (message.arrowType === "arrow") canvas.put(row + 1, col, useAscii ? "<" : "◄", false, STYLE_ARROW);
  else if (message.arrowType === "cross") canvas.put(row + 1, col, "x", false, STYLE_ARROW);
  else if (message.arrowType === "async") canvas.put(row + 1, col, "(", false, STYLE_ARROW);
  else canvas.put(row + 1, col, hChar, false, STYLE_EDGE);

  canvas.put(row, rightCol, useAscii ? "+" : "┐", false, STYLE_EDGE);
  canvas.put(row + 1, rightCol, useAscii ? "+" : "┘", false, STYLE_EDGE);

  if (label !== "") canvas.putText(row - 1, col + 2, label, STYLE_EDGE_LABEL);
}
