// Ported from src/termaid/model/sequence.py.
//
// Python tells its events apart with `isinstance`; here each one carries the tag it is read by.

export interface Participant {
  id: string;
  label: string;
  /** `participant`, `actor`, `database`, `queue`, `boundary`, `control`, `entity` or `collections`. */
  kind: string;
}

export interface Message {
  type: "message";
  source: string;
  target: string;
  label: string;
  /** `solid` or `dotted`. */
  lineType: string;
  /** `arrow`, `cross`, `open`, `async` or `bidirectional`. */
  arrowType: string;
}

export interface Note {
  type: "note";
  text: string;
  /** `rightof`, `leftof` or `over`. */
  position: string;
  participants: string[];
}

export interface ActivateEvent {
  type: "activate";
  participant: string;
  active: boolean;
}

export interface DestroyEvent {
  type: "destroy";
  participant: string;
}

export interface BlockSection {
  label: string;
  events: Event[];
}

export interface Block {
  type: "block";
  /** `loop`, `alt`, `opt`, `par`, `critical`, `break` or `rect`. */
  kind: string;
  label: string;
  events: Event[];
  sections: BlockSection[];
}

export type Event = Message | Note | ActivateEvent | Block | DestroyEvent;

export interface SequenceDiagram {
  participants: Participant[];
  events: Event[];
  autonumber: boolean;
  warnings: string[];
}

export const DEFAULT_KIND = "participant";
export const SOLID = "solid";
export const DOTTED = "dotted";

export const makeParticipant = (id: string, label: string, kind: string = DEFAULT_KIND): Participant => ({
  id,
  label,
  kind,
});

export const makeSequenceDiagram = (): SequenceDiagram => ({
  participants: [],
  events: [],
  autonumber: false,
  warnings: [],
});
