// Ported from src/termaid/renderer/classdiagram.py.
//
// Classes are laid out in layers walked out from the ones nothing inherits from, notes push the whole drawing over to
// make room, and the boxes are drawn LAST so a relationship never runs across one.

import {
  DASHED,
  type ClassDef,
  type ClassDiagram,
  type Member,
  type Note,
  type Relationship,
} from "../model/classdiagram.js";
import { pyCompare } from "../pycompat.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";
import { ASCII, UNICODE, type CharSet } from "./charset.js";

const CLASS_PAD = 2;
const MIN_BOX_WIDTH = 16;
const SIBLING_GAP = 4;
const MARGIN = 2;
const EMPTY_SIZE = 1;

/** Blank columns kept around a label written between two classes. */
const LABEL_ROOM = 4;
/** Columns two relationships leaving the same class are pulled apart by. */
const EXIT_SPREAD = 3;
/** Blank columns inside a note's border, and the room a note is given beside what it belongs to. */
const NOTE_PAD = 2;
const NOTE_ROOM = 2;

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const STYLE_ARROW = "arrow";
const STYLE_NOTE = "note";

const LR = "LR";
const KEY_SEP = " ";
const SIDE_SIDE = "side";
const SIDE_BOTTOM = "bottom";

/** What wraps an annotation on screen, which mermaid draws in guillemets. */
const ANNOTATION_OPEN = "«";
const ANNOTATION_CLOSE = "»";

/** A note's text is one string, and a literal backslash-n inside it is where it breaks. */
const NOTE_BREAK = "\\n";

/** Which way an end of a relationship points, which is what picks the marker drawn there. */
type Heading = "up" | "down" | "left" | "right";

const INHERITANCE: Readonly<Record<Heading, string>> = { down: "▽", up: "△", right: "▷", left: "◁" };
const DEPENDENCY: Readonly<Record<Heading, string>> = { down: "▼", up: "▲", right: "►", left: "◄" };
const COMPOSITION = "◆";
const AGGREGATION = "◇";

const ASCII_ARROW_IN = "<";
const ASCII_ARROW_OUT = ">";

function markerChar(marker: string, heading: Heading): string {
  if (marker === "|>" || marker === "<|") return INHERITANCE[heading];
  if (marker === ">" || marker === "<") return DEPENDENCY[heading];
  if (marker === "*") return COMPOSITION;
  if (marker === "o") return AGGREGATION;
  return "";
}

function formatMember(member: Member): string {
  let text = "";
  if (member.visibility !== "") text += member.visibility;
  if (member.returnType !== "" && !member.isMethod) text += `${member.returnType} `;
  text += member.name;
  if (member.isMethod && member.returnType !== "") text += ` ${member.returnType}`;
  if (member.classifier !== "") text += member.classifier;
  return text;
}

const annotationText = (cls: ClassDef): string => `${ANNOTATION_OPEN}${cls.annotation}${ANNOTATION_CLOSE}`;

/** The attributes and the methods of a class, in the two runs a box draws them in. */
const partitioned = (cls: ClassDef): [Member[], Member[]] => [
  cls.members.filter((member) => !member.isMethod),
  cls.members.filter((member) => member.isMethod),
];

function boxSize(cls: ClassDef, paddingX: number): [number, number] {
  const heading = cls.annotation !== "" ? [annotationText(cls), cls.name] : [cls.name];
  const [attributes, methods] = partitioned(cls);
  const rows = [...heading, ...attributes.map(formatMember), ...methods.map(formatMember)];

  const widest = rows.length === 0 ? 0 : Math.max(...rows.map(displayWidth));
  const width = Math.max(widest + paddingX * 2, MIN_BOX_WIDTH);

  let height = 2 + heading.length;
  if (attributes.length > 0 || methods.length > 0) {
    height += 1 + attributes.length + methods.length;
    if (attributes.length > 0 && methods.length > 0) height += 1;
  }
  return [width, height];
}

/** The four borders of a box, which a class and a note are both drawn inside. */
function drawFrame(canvas: Canvas, x: number, y: number, width: number, height: number, cs: CharSet, style: string) {
  canvas.put(y, x, cs.topLeft, true, style);
  canvas.put(y, x + width - 1, cs.topRight, true, style);
  canvas.put(y + height - 1, x, cs.bottomLeft, true, style);
  canvas.put(y + height - 1, x + width - 1, cs.bottomRight, true, style);
  for (let c = x + 1; c < x + width - 1; c++) {
    canvas.put(y, c, cs.horizontal, true, style);
    canvas.put(y + height - 1, c, cs.horizontal, true, style);
  }
  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x, cs.vertical, true, style);
    canvas.put(r, x + width - 1, cs.vertical, true, style);
  }
}

function drawDivider(canvas: Canvas, row: number, x: number, width: number, cs: CharSet): void {
  canvas.put(row, x, cs.teeRight, true, STYLE_NODE);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(row, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(row, x + width - 1, cs.teeLeft, true, STYLE_NODE);
}

function drawClassBox(canvas: Canvas, x: number, y: number, cls: ClassDef, cs: CharSet, paddingX: number): void {
  const [width, height] = boxSize(cls, paddingX);
  drawFrame(canvas, x, y, width, height, cs, STYLE_NODE);

  let row = y + 1;
  if (cls.annotation !== "") {
    const text = annotationText(cls);
    canvas.putText(row, x + Math.floor((width - displayWidth(text)) / 2), text, STYLE_LABEL);
    row += 1;
  }
  canvas.putText(row, x + Math.floor((width - displayWidth(cls.name)) / 2), cls.name, STYLE_LABEL);
  row += 1;

  const [attributes, methods] = partitioned(cls);
  if (attributes.length === 0 && methods.length === 0) return;

  drawDivider(canvas, row, x, width, cs);
  row += 1;
  for (const member of attributes) {
    canvas.putText(row, x + paddingX, formatMember(member), STYLE_LABEL);
    row += 1;
  }
  if (attributes.length > 0 && methods.length > 0) {
    drawDivider(canvas, row, x, width, cs);
    row += 1;
  }
  for (const member of methods) {
    canvas.putText(row, x + paddingX, formatMember(member), STYLE_LABEL);
    row += 1;
  }
}

/**
 * The classes in layers, walked out breadth first from the ones nothing points at. The marker names the PARENT:
 * `Animal <|-- Duck` and `Duck --|> Animal` both make Animal the one Duck hangs under.
 */
function assignLayers(diagram: ClassDiagram): string[][] {
  const names = [...diagram.classes.keys()];
  if (names.length === 0) return [];

  const children = new Map<string, string[]>(names.map((name) => [name, []]));
  const hasParent = new Set<string>();

  for (const rel of diagram.relationships) {
    if (rel.sourceMarker === "<|" || rel.targetMarker === "|>") {
      const inherits = rel.sourceMarker === "<|";
      const parent = inherits ? rel.source : rel.target;
      const child = inherits ? rel.target : rel.source;
      children.get(parent)?.push(child);
      hasParent.add(child);
    } else {
      children.get(rel.source)?.push(rel.target);
      hasParent.add(rel.target);
    }
  }

  let roots = names.filter((name) => !hasParent.has(name));
  if (roots.length === 0) roots = [names[0] as string];

  const assigned = new Set<string>(roots);
  const layers: string[][] = [];
  let queue = roots;

  while (queue.length > 0) {
    const layer = queue;
    layers.push(layer);
    queue = [];
    for (const node of layer) {
      for (const child of children.get(node) ?? []) {
        if (!assigned.has(child)) {
          assigned.add(child);
          queue.push(child);
        }
      }
    }
  }

  const loose = names.filter((name) => !assigned.has(name));
  if (loose.length > 0) layers.push(loose);
  return layers;
}

const pairKey = (a: string, b: string): string => (pyCompare(a, b) <= 0 ? `${a}${KEY_SEP}${b}` : `${b}${KEY_SEP}${a}`);

interface Layout {
  positions: Map<string, [number, number]>;
  sizes: Map<string, [number, number]>;
  width: number;
  height: number;
  layerOf: Map<string, number>;
}

function computeLayout(diagram: ClassDiagram, paddingX: number, gap: number): Layout {
  const layers = assignLayers(diagram);
  const positions = new Map<string, [number, number]>();
  const sizes = new Map<string, [number, number]>();
  const layerOf = new Map<string, number>();
  if (layers.length === 0) return { positions, sizes, width: EMPTY_SIZE, height: EMPTY_SIZE, layerOf };

  for (const [name, cls] of diagram.classes) sizes.set(name, boxSize(cls, paddingX));
  layers.forEach((layer, index) => {
    for (const name of layer) layerOf.set(name, index);
  });

  const pairGap = new Map<string, number>();
  for (const rel of diagram.relationships) {
    const source = layerOf.get(rel.source);
    const target = layerOf.get(rel.target);
    if (source === undefined || target === undefined || source !== target) continue;
    const needed = Math.max(rel.label !== "" ? displayWidth(rel.label) + LABEL_ROOM : gap, gap);
    const key = pairKey(rel.source, rel.target);
    pairGap.set(key, Math.max(pairGap.get(key) ?? gap, needed));
  }

  const isLR = diagram.direction === LR;
  let width: number;
  let height: number;

  if (isLR) {
    let columnX = MARGIN;
    let tallest = 0;
    for (const layer of layers) {
      const layerWidth = Math.max(...layer.map((name) => (sizes.get(name) as [number, number])[0]));
      let rowY = MARGIN;
      for (const name of layer) {
        const [w, h] = sizes.get(name) as [number, number];
        positions.set(name, [columnX + Math.floor((layerWidth - w) / 2), rowY]);
        rowY += h + gap;
      }
      tallest = Math.max(tallest, rowY - gap + MARGIN);
      columnX += layerWidth + gap;
    }
    width = columnX - gap + MARGIN;
    height = tallest;
  } else {
    let rowY = MARGIN;
    let widest = 0;
    for (const layer of layers) {
      const layerHeight = Math.max(...layer.map((name) => (sizes.get(name) as [number, number])[1]));
      let columnX = MARGIN;
      layer.forEach((name, index) => {
        const [w, h] = sizes.get(name) as [number, number];
        positions.set(name, [columnX, rowY + Math.floor((layerHeight - h) / 2)]);
        const next = layer[index + 1];
        columnX += next === undefined ? w : w + (pairGap.get(pairKey(name, next)) ?? gap);
      });
      widest = Math.max(widest, columnX + MARGIN);
      rowY += layerHeight + gap;
    }
    width = widest;
    height = rowY - gap + MARGIN;
  }

  for (const layer of layers) {
    const along = layer.reduce((sum, name) => sum + (sizes.get(name) as [number, number])[isLR ? 1 : 0], 0);
    const span = along + gap * (layer.length - 1);
    const offset = Math.floor(((isLR ? height : width) - 2 * MARGIN - span) / 2);
    if (offset <= 0) continue;
    for (const name of layer) {
      const [x, y] = positions.get(name) as [number, number];
      positions.set(name, isLR ? [x, y + offset] : [x + offset, y]);
    }
  }

  return { positions, sizes, width, height, layerOf };
}

/** A line between two points, straight where it can be and bent halfway down where it cannot. */
function drawRoutedLine(
  canvas: Canvas,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  hChar: string,
  vChar: string,
  useAscii: boolean
): void {
  if (c1 === c2) {
    canvas.drawVertical(c1, r1, r2, vChar, STYLE_EDGE);
    return;
  }
  if (r1 === r2) {
    canvas.drawHorizontal(r1, c1, c2, hChar, STYLE_EDGE);
    return;
  }

  const midRow = Math.floor((r1 + r2) / 2);
  canvas.drawVertical(c1, r1, midRow, vChar, STYLE_EDGE);
  canvas.drawHorizontal(midRow, c1, c2, hChar, STYLE_EDGE);
  canvas.drawVertical(c2, midRow, r2, vChar, STYLE_EDGE);
  if (useAscii) return;

  // The corners go on after the lines, so a crossing edge does not merge into them.
  const leftward = c2 < c1;
  canvas.put(midRow, c1, r1 < midRow ? (leftward ? "┘" : "└") : leftward ? "┐" : "┌", false, STYLE_EDGE);
  canvas.put(midRow, c2, r2 > midRow ? (leftward ? "┌" : "┐") : leftward ? "└" : "┘", false, STYLE_EDGE);
}

function drawRelationship(
  canvas: Canvas,
  rel: Relationship,
  layout: Layout,
  cs: CharSet,
  useAscii: boolean,
  colOffset: number,
  isLR: boolean
): void {
  const { positions, sizes, layerOf } = layout;
  const source = positions.get(rel.source);
  const target = positions.get(rel.target);
  if (source === undefined || target === undefined) return;

  const [sx, sy] = source;
  const [sw, sh] = sizes.get(rel.source) as [number, number];
  const [tx, ty] = target;
  const [tw, th] = sizes.get(rel.target) as [number, number];

  const sourceMidCol = sx + Math.floor(sw / 2);
  const sourceMidRow = sy + Math.floor(sh / 2);
  const targetMidCol = tx + Math.floor(tw / 2);
  const targetMidRow = ty + Math.floor(th / 2);

  const sameLayer = (layerOf.get(rel.source) ?? -1) === (layerOf.get(rel.target) ?? -2);
  const horizontal = isLR ? !sameLayer : sameLayer;

  let startCol: number;
  let startRow: number;
  let endCol: number;
  let endRow: number;
  let sourceHeading: Heading;
  let targetHeading: Heading;

  if (!horizontal) {
    const downward = targetMidRow - sourceMidRow > 0;
    startCol = sourceMidCol + colOffset;
    startRow = downward ? sy + sh : sy - 1;
    endCol = targetMidCol;
    endRow = downward ? ty - 1 : ty + th;
    // A marker points BACK at the end it belongs to, so the source's is the target's reversed.
    sourceHeading = downward ? "up" : "down";
    targetHeading = downward ? "down" : "up";
  } else {
    const rightward = targetMidCol - sourceMidCol > 0;
    startCol = rightward ? sx + sw : sx - 1;
    startRow = sourceMidRow;
    endCol = rightward ? tx - 1 : tx + tw;
    endRow = targetMidRow;
    sourceHeading = rightward ? "left" : "right";
    targetHeading = rightward ? "right" : "left";
  }

  const hChar = rel.lineStyle === DASHED ? cs.lineDottedH : cs.lineHorizontal;
  const vChar = rel.lineStyle === DASHED ? cs.lineDottedV : cs.lineVertical;
  drawRoutedLine(canvas, startRow, startCol, endRow, endCol, hChar, vChar, useAscii);

  if (!useAscii) {
    const atSource = markerChar(rel.sourceMarker, sourceHeading);
    const atTarget = markerChar(rel.targetMarker, targetHeading);
    if (atSource !== "") canvas.put(startRow, startCol, atSource, false, STYLE_ARROW);
    if (atTarget !== "") canvas.put(endRow, endCol, atTarget, false, STYLE_ARROW);
  } else {
    if (rel.sourceMarker === "<|" || rel.sourceMarker === "<") {
      canvas.put(startRow, startCol, ASCII_ARROW_IN, false, STYLE_ARROW);
    } else if (rel.sourceMarker === "*" || rel.sourceMarker === "o") {
      canvas.put(startRow, startCol, rel.sourceMarker, false, STYLE_ARROW);
    }
    if (rel.targetMarker === "|>" || rel.targetMarker === ">") {
      canvas.put(endRow, endCol, ASCII_ARROW_OUT, false, STYLE_ARROW);
    } else if (rel.targetMarker === "*" || rel.targetMarker === "o") {
      canvas.put(endRow, endCol, rel.targetMarker, false, STYLE_ARROW);
    }
  }

  if (rel.label !== "") {
    const midRow = Math.floor((startRow + endRow) / 2);
    const midCol = Math.floor((startCol + endCol) / 2);
    if (startRow === endRow) {
      canvas.putText(midRow - 1, midCol - Math.floor(displayWidth(rel.label) / 2), rel.label, STYLE_EDGE_LABEL);
    } else {
      canvas.putText(midRow, midCol + 2, rel.label, STYLE_EDGE_LABEL);
    }
  }

  if (rel.sourceCard !== "") canvas.putText(startRow, startCol + 1, rel.sourceCard, STYLE_EDGE_LABEL);
  if (rel.targetCard !== "") canvas.putText(endRow, endCol + 1, rel.targetCard, STYLE_EDGE_LABEL);
}

/** Where each relationship leaves its source, so two of them out of the same box do not leave by the same column. */
function computeExitOffsets(diagram: ClassDiagram, layerOf: Map<string, number>): Map<number, number> {
  const groups = new Map<string, number[]>();
  diagram.relationships.forEach((rel, index) => {
    const sameLayer = (layerOf.get(rel.source) ?? -1) === (layerOf.get(rel.target) ?? -2);
    const key = `${rel.source}${KEY_SEP}${sameLayer ? SIDE_SIDE : SIDE_BOTTOM}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [index]);
    else group.push(index);
  });

  const offsets = new Map<number, number>();
  for (const indices of groups.values()) {
    if (indices.length <= 1) {
      for (const index of indices) offsets.set(index, 0);
      continue;
    }
    indices.forEach((index, j) => offsets.set(index, (j - (indices.length - 1) / 2) * EXIT_SPREAD));
  }
  return offsets;
}

const noteLines = (note: Note): string[] => note.text.split(NOTE_BREAK);

function noteBoxSize(note: Note): [number, number] {
  const lines = noteLines(note);
  const widest = lines.length === 0 ? 0 : Math.max(...lines.map(displayWidth));
  return [Math.max(widest + NOTE_PAD * 2, MIN_BOX_WIDTH), lines.length + 2];
}

function drawNoteBox(canvas: Canvas, x: number, y: number, note: Note, cs: CharSet): void {
  const [width, height] = noteBoxSize(note);
  drawFrame(canvas, x, y, width, height, cs, STYLE_NOTE);
  noteLines(note).forEach((line, index) => canvas.putText(y + 1 + index, x + NOTE_PAD, line, STYLE_LABEL));
}

/** Where every note goes, and where the classes end up once they have been pushed clear of them. */
function layoutNotes(
  diagram: ClassDiagram,
  positions: Map<string, [number, number]>,
  sizes: Map<string, [number, number]>,
  gap: number
): { notes: Array<[number, number]>; positions: Map<string, [number, number]>; width: number; height: number } {
  const bounds = (placed: Map<string, [number, number]>): [number, number] => {
    let right = 0;
    let bottom = 0;
    for (const [name, [x, y]] of placed) {
      const [w, h] = sizes.get(name) as [number, number];
      right = Math.max(right, x + w);
      bottom = Math.max(bottom, y + h);
    }
    return [right, bottom];
  };

  if (diagram.notes.length === 0) {
    const [right, bottom] = bounds(positions);
    return { notes: [], positions, width: right + MARGIN, height: bottom + MARGIN };
  }

  const targeted: Array<[number, Note]> = [];
  const floating: Array<[number, Note]> = [];
  diagram.notes.forEach((note, index) => {
    if (note.target !== "" && positions.has(note.target)) targeted.push([index, note]);
    else floating.push([index, note]);
  });

  // Floating notes sit in a row above everything, and a targeted one beside what it belongs to.
  const shiftY = floating.length === 0 ? 0 : Math.max(...floating.map(([, note]) => noteBoxSize(note)[1])) + NOTE_ROOM;
  const shiftX = targeted.length === 0 ? 0 : Math.max(...targeted.map(([, note]) => noteBoxSize(note)[0])) + NOTE_ROOM;

  const adjusted = new Map<string, [number, number]>();
  for (const [name, [x, y]] of positions) adjusted.set(name, [x + shiftX, y + shiftY]);

  const notes: Array<[number, number]> = diagram.notes.map(() => [-1, -1]);
  let floatX = MARGIN;
  for (const [index, note] of floating) {
    notes[index] = [floatX, MARGIN];
    floatX += noteBoxSize(note)[0] + gap;
  }
  for (const [index, note] of targeted) {
    const [nw] = noteBoxSize(note);
    const [tx, ty] = adjusted.get(note.target) as [number, number];
    notes[index] = [Math.max(MARGIN, tx - nw - NOTE_ROOM), ty];
  }

  let [right, bottom] = bounds(adjusted);
  diagram.notes.forEach((note, index) => {
    const [nx, ny] = notes[index] as [number, number];
    const [nw, nh] = noteBoxSize(note);
    right = Math.max(right, nx + nw);
    bottom = Math.max(bottom, ny + nh);
  });

  return { notes, positions: adjusted, width: right + MARGIN, height: bottom + MARGIN };
}

export function renderClassDiagram(
  diagram: ClassDiagram,
  useAscii = false,
  paddingX = CLASS_PAD,
  gap = SIBLING_GAP
): Canvas {
  const cs = useAscii ? ASCII : UNICODE;
  const layout = computeLayout(diagram, paddingX, gap);
  if (layout.width <= 1 && diagram.notes.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const placed = layoutNotes(diagram, layout.positions, layout.sizes, gap);
  layout.positions = placed.positions;
  let width = placed.width;

  // A label written beside a vertical line still has to land on the canvas.
  for (const rel of diagram.relationships) {
    const source = layout.positions.get(rel.source);
    const target = layout.positions.get(rel.target);
    if (rel.label === "" || source === undefined || target === undefined) continue;
    const [sw] = layout.sizes.get(rel.source) as [number, number];
    const [tw] = layout.sizes.get(rel.target) as [number, number];
    const middle = Math.floor((source[0] + Math.floor(sw / 2) + target[0] + Math.floor(tw / 2)) / 2);
    width = Math.max(width, middle + 2 + displayWidth(rel.label) + MARGIN);
  }

  const offsets = computeExitOffsets(diagram, layout.layerOf);
  const canvas = new Canvas(width, placed.height);
  const isLR = diagram.direction === LR;

  diagram.relationships.forEach((rel, index) => {
    drawRelationship(canvas, rel, layout, cs, useAscii, Math.trunc(offsets.get(index) ?? 0), isLR);
  });

  for (const [name, cls] of diagram.classes) {
    const at = layout.positions.get(name);
    if (at !== undefined) drawClassBox(canvas, at[0], at[1], cls, cs, paddingX);
  }

  diagram.notes.forEach((note, index) => {
    const at = placed.notes[index];
    if (at !== undefined) drawNoteBox(canvas, at[0], at[1], note, cs);
  });

  return canvas;
}
