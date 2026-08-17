// Ported from src/termaid/parser/classdiagram.py.
//
// A class may be declared by a `class` line, by a brace body, or by nothing at all: naming it in a relationship or in
// a `Name : member` line brings it into being.

import {
  DASHED,
  makeClassDef,
  makeClassDiagram,
  SOLID,
  type ClassDiagram,
  type Member,
} from "../model/classdiagram.js";
import { PY_WORD, pyRepr, pyStrip, stripChars } from "../pycompat.js";

const W = PY_WORD;
const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

const DIRECTION_RE = new RegExp(String.raw`^\s*direction\s+(TB|LR|BT|RL|TD)\s*$`, "iu");
const CLASS_BRACE_RE = new RegExp(String.raw`^\s*class\s+(${W}+)(?:\s*~[^~]+~)?(?:\s*(<<${W}+>>))?\s*\{\s*$`, "u");
const CLASS_SIMPLE_RE = new RegExp(String.raw`^\s*class\s+(${W}+)(?:\s*~[^~]+~)?(?:\s*(<<${W}+>>))?\s*$`, "u");
const ANNOTATION_RE = new RegExp(String.raw`^\s*<<(${W}+)>>\s*$`, "u");
const ANNOTATION_LINE_RE = new RegExp(String.raw`^\s*<<(${W}+)>>\s+(${W}+)\s*$`, "u");
const COLON_MEMBER_RE = new RegExp(String.raw`^\s*(${W}+)\s*:\s*(.+?)\s*$`, "u");

const REL_RE = new RegExp(
  String.raw`^\s*(${W}+)\s*(?:"([^"]*)")?\s*((?:<\||[<*o])?)(--|\.\.|--\*|\.\.)((?:\|>|[>*o])?)\s*(?:"([^"]*)")?\s*(${W}+)(?:\s*:\s*(.+?))?\s*$`,
  "u"
);

const NOTE_FOR_RE = new RegExp(String.raw`^\s*note\s+for\s+(${W}+)\s+"([^"]*)"\s*$`, "iu");
const NOTE_RE = /^\s*note\s+"([^"]*)"\s*$/iu;
const SKIP_RE = /^\s*(?:namespace\s|style\s|classDef\s|cssClass\s|click\s|callback\s|link\s)/iu;

/** A member written as `Type name` rather than as a bare name, where the type is not spelt with a capital. */
const LOWERCASE_TYPES = new Set(["int", "bool", "str", "float", "void", "string"]);
const VISIBILITIES = "+-#~";
const CLASSIFIERS = "$*";
const ANNOTATION_BRACKETS = "<>";
const HEADER = "classDiagram";
const COMMENT = "%%";
const CLOSING_BRACE = "}";
const FRONTMATTER_FENCE = "---";
/** A name split off its first whitespace run, the way Python's `split(None, 1)` does it. */
const FIRST_WORD_RE = /^(\S+)\s+([\s\S]*)$/u;

const stripBrackets = (text: string): string => stripChars(text, ANNOTATION_BRACKETS);

/** Python's `str.isupper()` on one character, which a character with no case at all fails. */
const isUpper = (ch: string): boolean => ch.toLowerCase() !== ch.toUpperCase() && ch === ch.toUpperCase();

/** One member line: its visibility, its classifier, whether it is a method, and what it returns. */
function parseMemberText(written: string): Member {
  let text = pyStrip(written);
  let visibility = "";
  let classifier = "";

  if (text !== "" && VISIBILITIES.includes(text[0] as string)) {
    visibility = text[0] as string;
    text = text.slice(1);
  }
  if (text !== "" && CLASSIFIERS.includes(text[text.length - 1] as string)) {
    classifier = text[text.length - 1] as string;
    text = text.slice(0, -1);
  }
  text = pyStrip(text);

  const isMethod = text.includes("(") && text.includes(")");
  let returnType = "";

  if (isMethod) {
    // What follows the closing parenthesis is what the method returns.
    const end = text.lastIndexOf(")");
    const after = pyStrip(text.slice(end + 1));
    if (after !== "") {
      returnType = after;
      text = text.slice(0, end + 1);
    }
  } else {
    const split = FIRST_WORD_RE.exec(text);
    if (split !== null) {
      const first = split[1] as string;
      // `String name` declares a type, `my name` does not: a capital, or one of the types spelt without one.
      if (isUpper(first[0] as string) || LOWERCASE_TYPES.has(first)) {
        returnType = first;
        text = split[2] as string;
      }
    }
  }

  return { name: pyStrip(text), visibility, returnType, isMethod, classifier };
}

function ensureClass(diagram: ClassDiagram, name: string): void {
  if (!diagram.classes.has(name)) diagram.classes.set(name, makeClassDef(name));
}

/** A mermaid class diagram definition. */
export function parseClassDiagram(text: string): ClassDiagram {
  const diagram = makeClassDiagram();
  const lines = text.replace(FRONTMATTER_RE, "").split("\n");
  let i = 0;

  while (i < lines.length) {
    const stripped = pyStrip((lines[i] as string));
    i += 1;

    if (
      stripped === "" ||
      stripped.startsWith(HEADER) ||
      stripped.startsWith(COMMENT) ||
      stripped === FRONTMATTER_FENCE
    ) {
      continue;
    }

    if (SKIP_RE.test(stripped)) {
      diagram.warnings.push(`Unsupported directive (ignored): ${pyRepr(stripped)}`);
      continue;
    }
    if (stripped === CLOSING_BRACE) continue;

    const noteFor = NOTE_FOR_RE.exec(stripped);
    if (noteFor !== null) {
      diagram.notes.push({ text: noteFor[2] as string, target: noteFor[1] as string });
      continue;
    }

    const note = NOTE_RE.exec(stripped);
    if (note !== null) {
      diagram.notes.push({ text: note[1] as string, target: "" });
      continue;
    }

    const annotated = ANNOTATION_LINE_RE.exec(stripped);
    if (annotated !== null) {
      const name = annotated[2] as string;
      ensureClass(diagram, name);
      (diagram.classes.get(name) as ReturnType<typeof makeClassDef>).annotation = annotated[1] as string;
      continue;
    }

    const direction = DIRECTION_RE.exec(stripped);
    if (direction !== null) {
      const written = (direction[1] as string).toUpperCase();
      diagram.direction = written === "TD" ? "TB" : written;
      continue;
    }

    const braced = CLASS_BRACE_RE.exec(stripped);
    if (braced !== null) {
      const name = braced[1] as string;
      ensureClass(diagram, name);
      const cls = diagram.classes.get(name) as ReturnType<typeof makeClassDef>;
      if (braced[2] !== undefined) cls.annotation = stripBrackets(braced[2]);

      while (i < lines.length) {
        const body = pyStrip((lines[i] as string));
        i += 1;
        if (body === CLOSING_BRACE) break;
        if (body === "") continue;
        const inner = ANNOTATION_RE.exec(body);
        if (inner !== null) {
          cls.annotation = inner[1] as string;
          continue;
        }
        cls.members.push(parseMemberText(body));
      }
      continue;
    }

    const simple = CLASS_SIMPLE_RE.exec(stripped);
    if (simple !== null) {
      const name = simple[1] as string;
      ensureClass(diagram, name);
      if (simple[2] !== undefined) {
        (diagram.classes.get(name) as ReturnType<typeof makeClassDef>).annotation = stripBrackets(simple[2]);
      }
      continue;
    }

    const relationship = REL_RE.exec(stripped);
    if (relationship !== null) {
      const source = relationship[1] as string;
      const target = relationship[7] as string;
      ensureClass(diagram, source);
      ensureClass(diagram, target);
      diagram.relationships.push({
        source,
        target,
        sourceMarker: relationship[3] ?? "",
        targetMarker: relationship[5] ?? "",
        lineStyle: (relationship[4] as string).includes("..") ? DASHED : SOLID,
        label: pyStrip((relationship[8] ?? "")),
        sourceCard: relationship[2] ?? "",
        targetCard: relationship[6] ?? "",
      });
      continue;
    }

    const colon = COLON_MEMBER_RE.exec(stripped);
    if (colon !== null) {
      const name = colon[1] as string;
      ensureClass(diagram, name);
      (diagram.classes.get(name) as ReturnType<typeof makeClassDef>).members.push(
        parseMemberText(colon[2] as string)
      );
      continue;
    }

    diagram.warnings.push(`Unrecognized line: ${pyRepr(stripped)}`);
  }

  return diagram;
}
