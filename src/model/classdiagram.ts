// Ported from src/termaid/model/classdiagram.py.

export interface Member {
  /** What is written on screen, `makeSound()` and the like. */
  name: string;
  /** `+`, `-`, `#` or `~`. */
  visibility: string;
  returnType: string;
  isMethod: boolean;
  /** `*` for abstract, `$` for static. */
  classifier: string;
}

export interface ClassDef {
  name: string;
  /** `interface`, `abstract`, `enumeration`, `service`. */
  annotation: string;
  members: Member[];
}

export interface Relationship {
  source: string;
  target: string;
  /** `<|`, `*`, `o`, `<`, or nothing. */
  sourceMarker: string;
  /** `|>`, `*`, `o`, `>`, or nothing. */
  targetMarker: string;
  lineStyle: string;
  label: string;
  sourceCard: string;
  targetCard: string;
}

export interface Note {
  /** The text as written, a literal `\n` inside it standing for a line break. */
  text: string;
  /** The class the note is attached to, or nothing at all where it floats. */
  target: string;
}

export interface ClassDiagram {
  classes: Map<string, ClassDef>;
  relationships: Relationship[];
  notes: Note[];
  direction: string;
  warnings: string[];
}

export const DEFAULT_DIRECTION = "TB";
export const SOLID = "solid";
export const DASHED = "dashed";

export const makeClassDef = (name: string): ClassDef => ({ name, annotation: "", members: [] });

export const makeClassDiagram = (): ClassDiagram => ({
  classes: new Map(),
  relationships: [],
  notes: [],
  direction: DEFAULT_DIRECTION,
  warnings: [],
});
