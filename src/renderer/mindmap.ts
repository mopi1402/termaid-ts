// Ported from src/termaid/renderer/mindmap.py.
//
// A tree radiating from its root, children branching right. Past a threshold the first few spill LEFT instead, so a
// root with many children stays balanced. Each subtree is rendered as a block of lines plus the row its parent joins.

import type { Mindmap, MindmapNode } from "../model/mindmap.js";
import { makeMindmapNode } from "../model/mindmap.js";
import { ljust, rjust } from "../pycompat.js";
import { displayWidth } from "../utils.js";
import { Canvas } from "./canvas.js";

/** Past this many children on the root, some of them spill to the left. */
const OVERFLOW_THRESHOLD = 6;
/** What fraction of the children spill: a third of them. */
const OVERFLOW_SHARE = 3;
const EMPTY_SIZE = 1;
const STYLE_NODE = "node";
const BLANK = " ";

/** The characters a branch is drawn with, mirrored for the side that runs the other way. */
interface Chars {
  h: string;
  v: string;
  tl: string;
  bl: string;
  tee: string;
  /** Where the row the parent joins falls BETWEEN two children rather than on one. */
  tj: string;
  tr: string;
  br: string;
  teeL: string;
  tjL: string;
}

function makeChars(useAscii: boolean, rounded: boolean): Chars {
  if (useAscii) {
    return { h: "-", v: "|", tl: "+", bl: "+", tee: "+", tj: "+", tr: "+", br: "+", teeL: "+", tjL: "+" };
  }
  if (rounded) {
    return { h: "─", v: "│", tl: "╭", bl: "╰", tee: "├", tj: "┤", tr: "╮", br: "╯", teeL: "┤", tjL: "├" };
  }
  return { h: "─", v: "│", tl: "┌", bl: "└", tee: "├", tj: "┤", tr: "┐", br: "┘", teeL: "┤", tjL: "├" };
}

/** A block of drawn lines and the row a parent connects to. */
type Block = readonly [string[], number];

export function renderMindmap(diagram: Mindmap, useAscii = false, rounded = true): Canvas {
  const root = diagram.root;
  if (root === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const ch = makeChars(useAscii, rounded);
  let lines: string[];

  if (root.children.length === 0) {
    lines = [root.label];
  } else {
    const [left, right] = splitChildren(root.children);
    if (left.length === 0) lines = subtreeRight(makeMindmapNode(root.label, right), ch)[0];
    else lines = bothSides(root.label, left, right, ch);
  }

  const widths = lines.map(displayWidth);
  const width = widths.length === 0 ? EMPTY_SIZE : Math.max(...widths);
  const canvas = new Canvas(width + 1, lines.length);
  lines.forEach((line, r) => canvas.putText(r, 0, line, STYLE_NODE));
  return canvas;
}

/** The children that spill left, and those that stay right. */
function splitChildren(children: MindmapNode[]): readonly [MindmapNode[], MindmapNode[]] {
  if (children.length <= OVERFLOW_THRESHOLD) return [[], children];
  const left = Math.max(1, Math.min(Math.floor(children.length / OVERFLOW_SHARE), children.length - 1));
  return [children.slice(0, left), children.slice(left)];
}

function subtreeRight(node: MindmapNode, ch: Chars): Block {
  if (node.children.length === 0) return [[node.label], 0];

  const [block, connect] = stackRight(node.children, ch);
  const connector = `${node.label} ${ch.h}${ch.h}`;
  const pad = BLANK.repeat([...connector].length);
  return [block.map((line, i) => (i === connect ? connector : pad) + line), connect];
}

function stackRight(children: MindmapNode[], ch: Chars): Block {
  const only = children[0];
  if (children.length === 1 && only !== undefined) {
    const [sub, connect] = subtreeRight(only, ch);
    return [sub.map((line, i) => (i === connect ? `${ch.h}${ch.h} ` : "   ") + line), connect];
  }

  const blocks = children.map((child) => subtreeRight(child, ch));
  const result: string[] = [];
  const connects: number[] = [];

  blocks.forEach(([block, connect], idx) => {
    const first = idx === 0;
    const last = idx === blocks.length - 1;
    const base = result.length;
    block.forEach((line, li) => {
      if (li !== connect) {
        result.push(`${ch.v}  ${line}`);
        return;
      }
      connects.push(base + li);
      result.push(`${first ? ch.tl : last ? ch.bl : ch.tee}${ch.h} ${line}`);
    });
  });

  // The trunk only runs BETWEEN the first and last connection: above and below it, the line is wiped.
  const firstConnect = connects[0] as number;
  const lastConnect = connects[connects.length - 1] as number;
  for (let i = 0; i < firstConnect; i++) if ((result[i] as string)[0] === ch.v) result[i] = BLANK + (result[i] as string).slice(1);
  for (let i = lastConnect + 1; i < result.length; i++) {
    if ((result[i] as string)[0] === ch.v) result[i] = BLANK + (result[i] as string).slice(1);
  }

  const mid = Math.floor((firstConnect + lastConnect) / 2);
  if (!connects.includes(mid) && (result[mid] as string)[0] === ch.v) {
    result[mid] = ch.tj + (result[mid] as string).slice(1);
  }

  return [result, mid];
}

function subtreeLeft(node: MindmapNode, ch: Chars): Block {
  if (node.children.length === 0) return [[node.label], 0];

  const [block, connect] = stackLeft(node.children, ch);
  const width = Math.max(...block.map(displayWidth));
  const padded = block.map((line) => rjust(line, width));

  const connector = `${ch.h}${ch.h} ${node.label}`;
  const pad = BLANK.repeat([...connector].length);
  return [padded.map((line, i) => line + (i === connect ? connector : pad)), connect];
}

function stackLeft(children: MindmapNode[], ch: Chars): Block {
  const only = children[0];
  if (children.length === 1 && only !== undefined) {
    const [sub, connect] = subtreeLeft(only, ch);
    const width = Math.max(...sub.map(displayWidth));
    return [sub.map((line, i) => rjust(line, width) + (i === connect ? ` ${ch.h}${ch.h}` : "   ")), connect];
  }

  const blocks = children.map((child) => subtreeLeft(child, ch));
  const maxWidth = Math.max(...blocks.map(([block]) => Math.max(...block.map(displayWidth))));
  const result: string[] = [];
  const connects: number[] = [];

  blocks.forEach(([block, connect], idx) => {
    const first = idx === 0;
    const last = idx === blocks.length - 1;
    const base = result.length;
    block.forEach((line, li) => {
      const padded = rjust(line, maxWidth);
      if (li !== connect) {
        result.push(padded + (last ? "   " : `  ${ch.v}`));
        return;
      }
      connects.push(base + li);
      result.push(`${padded} ${ch.h}${first ? ch.tr : last ? ch.br : ch.teeL}`);
    });
  });

  const firstConnect = connects[0] as number;
  const lastConnect = connects[connects.length - 1] as number;
  const wipe = (i: number): void => {
    const line = result[i] as string;
    if (line.endsWith(ch.v)) result[i] = line.slice(0, -1) + BLANK;
  };
  for (let i = 0; i < firstConnect; i++) wipe(i);
  for (let i = lastConnect + 1; i < result.length; i++) wipe(i);

  const mid = Math.floor((firstConnect + lastConnect) / 2);
  const middle = result[mid] as string;
  if (!connects.includes(mid) && middle.endsWith(ch.v)) result[mid] = middle.slice(0, -1) + ch.tjL;

  return [result, mid];
}

/** The root in the middle, one stack of children each side of it. */
function bothSides(rootLabel: string, left: MindmapNode[], right: MindmapNode[], ch: Chars): string[] {
  const [rightBlock] = stackRight(right, ch);
  const [leftBlock] = stackLeft(left, ch);

  const leftWidths = leftBlock.map(displayWidth);
  const leftWidth = leftWidths.length === 0 ? 0 : Math.max(...leftWidths);
  const total = Math.max(rightBlock.length, leftBlock.length);
  const rightOffset = Math.floor((total - rightBlock.length) / 2);
  const leftOffset = Math.floor((total - leftBlock.length) / 2);
  const rootRow = Math.floor(total / 2);

  const rootPart = `${ch.h}${ch.h} ${rootLabel} ${ch.h}${ch.h}`;
  const pad = BLANK.repeat([...rootPart].length);

  const result: string[] = [];
  for (let row = 0; row < total; row++) {
    const li = row - leftOffset;
    const leftLine = li >= 0 && li < leftBlock.length ? ljust(leftBlock[li] as string, leftWidth) : BLANK.repeat(leftWidth);
    const ri = row - rightOffset;
    const rightLine = ri >= 0 && ri < rightBlock.length ? (rightBlock[ri] as string) : "";
    result.push(leftLine + (row === rootRow ? rootPart : pad) + rightLine);
  }
  return result;
}
