// Ported from src/termaid/parser/erdiagram.py.
//
// A relationship is matched BEFORE an entity, because `CUSTOMER ||--o{ ORDER : places` starts with what a standalone
// entity line looks like and would be swallowed by it.

import {
  makeERDiagram,
  makeEntity,
  type Attribute,
  type ERDiagram,
  type Relationship,
} from "../model/erdiagram.js";
import { PY_WORD, pyRepr, stripChars } from "../pycompat.js";

const W = PY_WORD;
const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;

const DIRECTION_RE = new RegExp(String.raw`^\s*direction\s+(TB|LR|BT|RL|TD)\s*$`, "iu");
const ENTITY_BRACE_RE = new RegExp(String.raw`^\s*(${W}+(?:-${W}+)*)(?:\[("[^"]*"|${W}+)\])?\s*\{\s*$`, "u");
const ENTITY_STANDALONE_RE = new RegExp(String.raw`^\s*(${W}+(?:-${W}+)*)(?:\[("[^"]*"|${W}+)\])?\s*$`, "u");
const QUOTED_ENTITY = String.raw`(?:"([^"]+)"|(${W}+(?:-${W}+)*))`;

const ATTR_RE = new RegExp(
  String.raw`^\s*(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$`,
  "u"
);

const REL_RE = new RegExp(
  String.raw`^\s*${QUOTED_ENTITY}\s+([|}][|o])(--|\.\.)([o|][|{])\s+${QUOTED_ENTITY}\s*:\s*(.+?)\s*$`,
  "u"
);

const REL_WORD_RE = new RegExp(
  String.raw`^\s*${QUOTED_ENTITY}\s+(.+?)\s+(to|optionally\s+to)\s+(.+?)\s+${QUOTED_ENTITY}\s*:\s*(.+?)\s*$`,
  "iu"
);

const SKIP_RE = /^\s*(?:style\s|classDef\s|%%)/iu;

/** The cardinalities an author may write in words, and the marker each stands for on the left and on the right. */
const CARD_ALIASES: ReadonlyArray<readonly [string, string, string]> = [
  ["zero or one", "|o", "o|"],
  ["one or zero", "|o", "o|"],
  ["zero or more", "}o", "o{"],
  ["zero or many", "}o", "o{"],
  ["many(0)", "}o", "o{"],
  ["0+", "}o", "o{"],
  ["one or more", "}|", "|{"],
  ["one or many", "}|", "|{"],
  ["many(1)", "}|", "|{"],
  ["1+", "}|", "|{"],
  ["only one", "||", "||"],
  ["1", "||", "||"],
];

const LINE_ALIASES: Readonly<Record<string, string>> = { to: "--", "optionally to": ".." };

const DASHED_LINE = "..";
const SOLID = "solid";
const DASHED = "dashed";
const QUOTE = '"';
const HEADER = "erDiagram";
const COMMENT = "%%";
const CLOSING_BRACE = "}";
const FRONTMATTER_FENCE = "---";
const KEYWORDS = new Set(["erdiagram", "direction"]);
const LEFT = "left";

const styleOf = (line: string): string => (line === DASHED_LINE ? DASHED : SOLID);

/** The marker a written-out cardinality stands for, or nothing at all where it names none. */
function resolveCardAlias(text: string, side: string): string {
  const wanted = text.trim().toLowerCase();
  for (const [alias, leftSymbol, rightSymbol] of CARD_ALIASES) {
    if (wanted === alias) return side === LEFT ? leftSymbol : rightSymbol;
  }
  return "";
}

/** The name out of a quoted-or-bare pair of groups. */
const entityName = (quoted: string | undefined, bare: string | undefined): string => (quoted ?? bare ?? "").trim();

function ensureEntity(diagram: ERDiagram, name: string): void {
  if (!diagram.entities.has(name)) diagram.entities.set(name, makeEntity(name));
}

/** A mermaid ER definition. */
export function parseERDiagram(text: string): ERDiagram {
  const diagram = makeERDiagram();
  const lines = text.replace(FRONTMATTER_RE, "").split("\n");
  let i = 0;

  while (i < lines.length) {
    const stripped = (lines[i] as string).trim();
    i += 1;

    if (
      stripped === "" ||
      stripped.startsWith(HEADER) ||
      stripped.startsWith(COMMENT) ||
      stripped === FRONTMATTER_FENCE
    ) {
      continue;
    }
    if (SKIP_RE.test(stripped)) continue;
    if (stripped === CLOSING_BRACE) continue;

    const direction = DIRECTION_RE.exec(stripped);
    if (direction !== null) {
      const written = (direction[1] as string).toUpperCase();
      diagram.direction = written === "TD" ? "TB" : written;
      continue;
    }

    const symbols = REL_RE.exec(stripped);
    if (symbols !== null) {
      diagram.relationships.push(
        related(diagram, {
          entity1: entityName(symbols[1], symbols[2]),
          entity2: entityName(symbols[6], symbols[7]),
          card1: symbols[3] as string,
          card2: symbols[5] as string,
          lineStyle: styleOf(symbols[4] as string),
          label: stripChars((symbols[8] as string).trim(), QUOTE),
        })
      );
      continue;
    }

    const words = REL_WORD_RE.exec(stripped);
    if (words !== null) {
      const card1 = resolveCardAlias(words[3] as string, LEFT);
      const card2 = resolveCardAlias(words[5] as string, "right");
      const line = LINE_ALIASES[(words[4] as string).trim().toLowerCase()] ?? "--";

      // A line naming no cardinality this side of the arrow is not a relationship, so it falls through to the entity
      // matchers below rather than being recorded as one.
      if (card1 !== "" && card2 !== "") {
        diagram.relationships.push(
          related(diagram, {
            entity1: entityName(words[1], words[2]),
            entity2: entityName(words[6], words[7]),
            card1,
            card2,
            lineStyle: styleOf(line),
            label: stripChars((words[8] as string).trim(), QUOTE),
          })
        );
        continue;
      }
    }

    const braced = ENTITY_BRACE_RE.exec(stripped);
    if (braced !== null) {
      const name = braced[1] as string;
      ensureEntity(diagram, name);
      const entity = diagram.entities.get(name) as ReturnType<typeof makeEntity>;
      const alias = stripChars(braced[2] ?? "", QUOTE);
      if (alias !== "") entity.alias = alias;

      while (i < lines.length) {
        const body = (lines[i] as string).trim();
        i += 1;
        if (body === CLOSING_BRACE) break;
        if (body === "") continue;
        const attribute = ATTR_RE.exec(body);
        if (attribute !== null) entity.attributes.push(attributeOf(attribute));
      }
      continue;
    }

    const standalone = ENTITY_STANDALONE_RE.exec(stripped);
    if (standalone !== null) {
      const name = standalone[1] as string;
      if (!KEYWORDS.has(name.toLowerCase())) {
        ensureEntity(diagram, name);
        const alias = stripChars(standalone[2] ?? "", QUOTE);
        if (alias !== "") (diagram.entities.get(name) as ReturnType<typeof makeEntity>).alias = alias;
      }
      continue;
    }

    diagram.warnings.push(`Unrecognized line: ${pyRepr(stripped)}`);
  }

  return diagram;
}

/** A relationship, both of whose ends are declared entities by the time it is recorded. */
function related(diagram: ERDiagram, relationship: Relationship): Relationship {
  ensureEntity(diagram, relationship.entity1);
  ensureEntity(diagram, relationship.entity2);
  return relationship;
}

function attributeOf(match: RegExpExecArray): Attribute {
  const written = match[3] ?? "";
  return {
    type: match[1] as string,
    name: match[2] as string,
    keys: written === "" ? [] : written.split(",").map((key) => key.trim()).filter((key) => key !== ""),
    comment: match[4] ?? "",
  };
}
