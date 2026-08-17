// Ported from src/termaid/parser/packet.py.

import { makePacket, type Packet } from "../model/packet.js";
import { pyStrip, splitLines } from "../pycompat.js";

const COMMENT = "%%";
/** `start-end: "label"`, the two bounds written out. */
const RANGE_RE = /^(\d+)\s*-\s*(\d+)\s*:\s*"?([^"]*)"?/;
/** `+N: "label"`, which takes the next N bits wherever the last field left off. */
const RELATIVE_RE = /^\+(\d+)\s*:\s*"?([^"]*)"?/;
/** `start: "label"`, one bit. */
const SINGLE_RE = /^(\d+)\s*:\s*"?([^"]*)"?/;

/** A mermaid packet diagram definition. */
export function parsePacket(text: string): Packet {
  const lines = splitLines(pyStrip(text));
  const packet = makePacket();
  if (lines.length === 0) return packet;

  let next = 0;

  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = pyStrip(line);
    if (stripped === "") continue;

    const range = RANGE_RE.exec(stripped);
    if (range !== null) {
      const end = Number.parseInt(range[2] as string, 10);
      packet.fields.push({ start: Number.parseInt(range[1] as string, 10), end, label: pyStrip((range[3] as string)) });
      next = end + 1;
      continue;
    }

    const relative = RELATIVE_RE.exec(stripped);
    if (relative !== null) {
      const end = next + Number.parseInt(relative[1] as string, 10) - 1;
      packet.fields.push({ start: next, end, label: pyStrip((relative[2] as string)) });
      next = end + 1;
      continue;
    }

    const single = SINGLE_RE.exec(stripped);
    if (single !== null) {
      const start = Number.parseInt(single[1] as string, 10);
      packet.fields.push({ start, end: start, label: pyStrip((single[2] as string)) });
      next = start + 1;
    }
  }

  return packet;
}
