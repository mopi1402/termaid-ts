// Ported from src/termaid/parser/sequence.py.
//
// Events go on a stack: a `loop` or an `alt` opens a block and everything after it lands in that block until its
// `end`, an `else` swapping the top of the stack for the new section's own list.

import {
  DOTTED,
  makeParticipant,
  makeSequenceDiagram,
  SOLID,
  type Block,
  type BlockSection,
  type Event,
  type SequenceDiagram,
} from "../model/sequence.js";
import { pyRepr } from "../pycompat.js";

/** Every arrow, LONGEST first, so `-->>` is never read as `-->` followed by a stray `>`. */
const ARROW_PATTERNS: ReadonlyArray<readonly [string, string, string]> = [
  ["<<-->>", DOTTED, "bidirectional"],
  ["<<->>", SOLID, "bidirectional"],
  ["-->>", DOTTED, "arrow"],
  ["->>", SOLID, "arrow"],
  ["--x", DOTTED, "cross"],
  ["-x", SOLID, "cross"],
  ["--)", DOTTED, "async"],
  ["-)", SOLID, "async"],
  ["-->", DOTTED, "open"],
  ["->", SOLID, "open"],
];

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ARROWS = ARROW_PATTERNS.map(([arrow]) => escaped(arrow)).join("|");

const MESSAGE_RE = new RegExp(String.raw`^\s*(\S+?)\s*(${ARROWS})\s*(\S+?)\s*(?::\s*(.*?))?\s*$`, "u");

const PARTICIPANT_KIND_RE =
  /^\s*(?:create\s+)?(participant|actor|database|queue|boundary|control|entity|collections)\s+(\S+)(?:\s+as\s+(.+?))?\s*$/iu;
const NOTE_RE = /^\s*Note\s+(right\s+of|left\s+of|over)\s+(\S+?)(?:\s*,\s*(\S+?))?\s*:\s*(.*?)\s*$/iu;
const BLOCK_START_RE = /^\s*(loop|alt|opt|par|critical|break|rect)\b\s*(.*?)\s*$/iu;
const BLOCK_SECTION_RE = /^\s*(else|and|option)\b\s*(.*?)\s*$/iu;
const BLOCK_END_RE = /^\s*end\s*$/iu;
const ACTIVATE_RE = /^\s*(activate|deactivate)\s+(\S+)\s*$/iu;
const DESTROY_RE = /^\s*destroy\s+(\S+)\s*$/iu;
const BREAK_TAG_RE = /<br\s*\/?>/giu;

const HEADER = "sequenceDiagram";
const COMMENT = "%%";
const AUTONUMBER = "autonumber";
const ACTIVATE = "activate";
const NEWLINE = "\n";
const ACTIVATE_MARKER = "+";
const DEACTIVATE_MARKER = "-";
const ACTIVATION_MARKERS = ACTIVATE_MARKER + DEACTIVATE_MARKER;
/** What a `right of` becomes once its blanks are taken out. */
const POSITION_SPACE_RE = / /gu;

const arrowOf = (written: string): [string, string] => {
  for (const [pattern, lineType, arrowType] of ARROW_PATTERNS) {
    if (written === pattern) return [lineType, arrowType];
  }
  return [SOLID, "open"];
};

function ensureParticipant(diagram: SequenceDiagram, id: string): void {
  if (!diagram.participants.some((participant) => participant.id === id)) {
    diagram.participants.push(makeParticipant(id, id));
  }
}

/** A mermaid sequence diagram definition. */
export function parseSequenceDiagram(text: string): SequenceDiagram {
  const diagram = makeSequenceDiagram();

  // The top of the stack is where the next event goes, which an open block moves.
  const eventStack: Event[][] = [diagram.events];
  const blockStack: Block[] = [];
  const target = (): Event[] => eventStack[eventStack.length - 1] as Event[];

  for (const line of text.split(NEWLINE)) {
    const stripped = line.trim();

    if (stripped === "" || stripped.startsWith(HEADER) || stripped.startsWith(COMMENT)) continue;

    if (stripped.toLowerCase() === AUTONUMBER) {
      diagram.autonumber = true;
      continue;
    }

    if (BLOCK_END_RE.test(stripped)) {
      if (blockStack.length > 0) {
        blockStack.pop();
        eventStack.pop();
      }
      continue;
    }

    const section = BLOCK_SECTION_RE.exec(stripped);
    if (section !== null && blockStack.length > 0) {
      const opened: BlockSection = { label: (section[2] as string).trim(), events: [] };
      (blockStack[blockStack.length - 1] as Block).sections.push(opened);
      eventStack[eventStack.length - 1] = opened.events;
      continue;
    }

    const started = BLOCK_START_RE.exec(stripped);
    if (started !== null) {
      const block: Block = {
        type: "block",
        kind: (started[1] as string).toLowerCase(),
        label: (started[2] as string).trim(),
        events: [],
        sections: [],
      };
      target().push(block);
      blockStack.push(block);
      eventStack.push(block.events);
      continue;
    }

    const activation = ACTIVATE_RE.exec(stripped);
    if (activation !== null) {
      const id = activation[2] as string;
      ensureParticipant(diagram, id);
      target().push({
        type: "activate",
        participant: id,
        active: (activation[1] as string).toLowerCase() === ACTIVATE,
      });
      continue;
    }

    const note = NOTE_RE.exec(stripped);
    if (note !== null) {
      const first = note[2] as string;
      const second = note[3];
      const participants = second === undefined ? [first] : [first, second];
      for (const id of participants) ensureParticipant(diagram, id);
      target().push({
        type: "note",
        text: (note[4] as string).trim().replace(BREAK_TAG_RE, NEWLINE),
        position: (note[1] as string).toLowerCase().replace(POSITION_SPACE_RE, ""),
        participants,
      });
      continue;
    }

    const destroyed = DESTROY_RE.exec(stripped);
    if (destroyed !== null) {
      const id = destroyed[1] as string;
      ensureParticipant(diagram, id);
      target().push({ type: "destroy", participant: id });
      continue;
    }

    const declared = PARTICIPANT_KIND_RE.exec(stripped);
    if (declared !== null) {
      const kind = (declared[1] as string).toLowerCase();
      const id = declared[2] as string;
      const label = declared[3] === undefined ? id : declared[3].trim();
      const existing = diagram.participants.find((participant) => participant.id === id);
      if (existing === undefined) diagram.participants.push(makeParticipant(id, label, kind));
      else {
        existing.label = label;
        existing.kind = kind;
      }
      continue;
    }

    const message = MESSAGE_RE.exec(stripped);
    if (message !== null) {
      // A `+` or a `-` written against an end is an activation asked for on the message line itself.
      const [source, sourceMarker] = splitMarker(message[1] as string);
      const [messageTarget, targetMarker] = splitMarker(message[3] as string);

      ensureParticipant(diagram, source);
      ensureParticipant(diagram, messageTarget);
      const [lineType, arrowType] = arrowOf(message[2] as string);
      target().push({
        type: "message",
        source,
        target: messageTarget,
        label: message[4] === undefined ? "" : message[4].trim(),
        lineType,
        arrowType,
      });

      // A `+` activates the end it is written against, a `-` deactivates the SENDER either way.
      if (sourceMarker !== "") {
        target().push({ type: "activate", participant: source, active: sourceMarker === ACTIVATE_MARKER });
      }
      if (targetMarker === ACTIVATE_MARKER) {
        target().push({ type: "activate", participant: messageTarget, active: true });
      } else if (targetMarker === DEACTIVATE_MARKER) {
        target().push({ type: "activate", participant: source, active: false });
      }
      continue;
    }

    diagram.warnings.push(`Unrecognized line: ${pyRepr(stripped)}`);
  }

  return diagram;
}

/** A participant written with an activation marker against it, and the marker taken off. */
function splitMarker(written: string): [string, string] {
  const first = written.slice(0, 1);
  if (first !== "" && ACTIVATION_MARKERS.includes(first)) return [written.slice(1), first];
  return [written, ""];
}
