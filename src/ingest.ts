// Ported from src/termaid/ingest.py.
//
// JSON into mermaid, so the output of another tool can be piped straight in:
//     du -d1 -k /var | termaid --json treemap
//     echo '{"A":30,"B":70}' | termaid --json pie
//
// Python tells an int from a float and writes them differently, `30` against `30.0`, so the JSON read here keeps the
// distinction its literals carry: `JSON.parse` alone would flatten both onto one number and print the wrong one.

import { pyFloat, pyFloatStr, pyRepr, splitLines } from "./pycompat.js";

/** A number as Python holds one: its value, and the text `str()` writes for it. */
interface PyNumber {
  readonly num: true;
  readonly value: number;
  readonly text: string;
}

interface PyMapping {
  readonly [key: string]: PyValue;
}

type PyValue = PyNumber | string | null | PyValue[] | PyMapping;

const isNumber = (value: PyValue): value is PyNumber => typeof value === "object" && value !== null && "num" in value;
const isMapping = (value: PyValue): value is PyMapping =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !isNumber(value);
/** Python's truthiness, which an empty string and a zero both fail. */
const truthy = (value: PyValue | undefined): boolean =>
  value !== undefined && value !== null && value !== "" && (!isNumber(value) || value.value !== 0);

const NONE = "None";
const TRUE = "True";
const FALSE = "False";
/** A float literal is one written with a point or an exponent; anything else JSON calls a number is an int. */
const FLOAT_LITERAL_RE = /[.eE]/;

/** Python's `str()` of a value, which is what an f-string writes for it. */
function str(value: PyValue): string {
  if (value === null) return NONE;
  if (typeof value === "string") return value;
  if (isNumber(value)) return value.text;
  if (Array.isArray(value)) return `[${value.map(repr).join(", ")}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${repr(key)}: ${repr(item)}`)
    .join(", ")}}`;
}

/** Python's `repr()`, which a container writes its items with. */
const repr = (value: PyValue): string => (typeof value === "string" ? pyRepr(value) : str(value));

/**
 * A JSON document as Python's `json` module reads one. `true` and `false` come back as Python's booleans, which are
 * INTS there: a boolean handed to a chart is counted as a number and printed `True`, and that is not a slip to fix.
 */
function loads(data: string): PyValue {
  return JSON.parse(data, function reviver(_key: string, value: unknown, context?: { source?: string }): unknown {
    if (typeof value === "number") {
      const source = context?.source ?? String(value);
      return {
        num: true,
        value,
        text: FLOAT_LITERAL_RE.test(source) ? pyFloatStr(value) : BigInt(source).toString(),
      } satisfies PyNumber;
    }
    if (typeof value === "boolean") {
      return { num: true, value: value ? 1 : 0, text: value ? TRUE : FALSE } satisfies PyNumber;
    }
    return value;
  }) as PyValue;
}

const NEWLINE = "\n";
const TREEMAP_INDENT = 4;
const MINDMAP_INDENT = 2;
const QUOTE = '"';
const SAFE_QUOTE = "'";

const pad = (indent: number): string => " ".repeat(indent);

/** A treemap, whose nesting is the JSON's own. */
function toTreemap(data: PyValue): string {
  const lines = ["treemap-beta"];

  const walk = (obj: PyValue, indent: number = TREEMAP_INDENT): void => {
    if (isMapping(obj)) {
      for (const [key, val] of Object.entries(obj)) {
        if (isMapping(val)) {
          lines.push(`${pad(indent)}"${key}"`);
          walk(val, indent + TREEMAP_INDENT);
        } else if (Array.isArray(val)) {
          lines.push(`${pad(indent)}"${key}"`);
          for (const item of val) walk(item, indent + TREEMAP_INDENT);
        } else {
          // A number and a bare value are written the same way, so the two branches the reference keeps apart meet.
          lines.push(`${pad(indent)}"${key}": ${str(val)}`);
        }
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item, indent);
    }
  };

  walk(data);
  return lines.join(NEWLINE);
}

function toPie(data: PyValue): string {
  const lines = ["pie"];

  const slice = (key: string, val: PyValue): void => {
    if (isNumber(val)) lines.push(`${pad(TREEMAP_INDENT)}"${key}" : ${val.text}`);
  };

  if (isMapping(data)) {
    for (const [key, val] of Object.entries(data)) slice(key, val);
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (isMapping(item)) for (const [key, val] of Object.entries(item)) slice(key, val);
    }
  }

  return lines.join(NEWLINE);
}

function toMindmap(data: PyValue): string {
  const lines = ["mindmap"];

  const walk = (obj: PyValue, indent: number = MINDMAP_INDENT): void => {
    if (isMapping(obj)) {
      for (const [key, val] of Object.entries(obj)) {
        lines.push(`${pad(indent)}${key}`);
        if (isMapping(val)) walk(val, indent + MINDMAP_INDENT);
        else if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string") lines.push(`${pad(indent)}  ${item}`);
            else if (isMapping(item)) walk(item, indent + MINDMAP_INDENT);
          }
        }
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === "string") lines.push(`${pad(indent)}${item}`);
        else if (isMapping(item)) walk(item, indent);
      }
    }
  };

  walk(data);
  return lines.join(NEWLINE);
}

/** A flowchart, from a list of edges or from an object holding one. */
function toFlowchart(data: PyValue): string {
  const lines = ["graph TD"];
  const room = pad(TREEMAP_INDENT);

  const first = (item: PyMapping, ...keys: string[]): PyValue | undefined => {
    for (const key of keys) {
      if (truthy(item[key])) return item[key];
    }
    return undefined;
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!isMapping(item)) continue;
      const src = first(item, "from", "source", "src");
      const tgt = first(item, "to", "target", "dst");
      const label = item["label"] ?? "";
      if (src !== undefined && tgt !== undefined) {
        if (truthy(label)) lines.push(`${room}${str(src)}-->|${str(label)}|${str(tgt)}`);
        else lines.push(`${room}${str(src)}-->${str(tgt)}`);
      }
    }
  } else if (isMapping(data)) {
    const edges = data["edges"] ?? [];
    if (Array.isArray(edges)) {
      for (const item of edges) {
        if (!isMapping(item)) continue;
        const src = first(item, "from", "source");
        const tgt = first(item, "to", "target");
        if (src !== undefined && tgt !== undefined) lines.push(`${room}${str(src)}-->${str(tgt)}`);
      }
    }
  }

  return lines.join(NEWLINE);
}

const DATASETS = ["bar", "line"] as const;
const LIST_SEPARATOR = ", ";

/** An xy chart, from a bare list of numbers, from categories, or from one series per dataset name. */
function toXYChart(data: PyValue): string {
  const lines = ["xychart-beta"];
  const room = pad(TREEMAP_INDENT);
  const axis = (categories: string[]): string => `${room}x-axis [${categories.join(LIST_SEPARATOR)}]`;
  const counted = (length: number): string[] => Array.from({ length }, (_, i) => String(i + 1));

  if (Array.isArray(data) && data.every(isNumber)) {
    lines.push(axis(counted(data.length)));
    lines.push(`${room}bar [${data.map((v) => v.text).join(LIST_SEPARATOR)}]`);
  } else if (isMapping(data)) {
    if (DATASETS.some((name) => name in data)) {
      let maxLength = 0;
      for (const name of DATASETS) {
        const series = data[name];
        if (Array.isArray(series)) maxLength = Math.max(maxLength, series.length);
      }
      lines.push(axis(counted(maxLength)));
      for (const name of DATASETS) {
        const series = data[name];
        if (Array.isArray(series)) lines.push(`${room}${name} [${series.map(str).join(LIST_SEPARATOR)}]`);
      }
    } else {
      const categories = Object.keys(data);
      const values = categories.map((key) => data[key] as PyValue).filter(isNumber);
      lines.push(axis(categories));
      lines.push(`${room}bar [${values.map((v) => v.text).join(LIST_SEPARATOR)}]`);
    }
  }

  return lines.join(NEWLINE);
}

/** A name split off its first whitespace run, the way Python's `split(None, 1)` does it. */
const FIRST_FIELD_RE = /^(\S+)\s+([\s\S]*)$/u;

/** Tabular input, one `number<space>label` per line, which is the shape `du` and its kind write. */
function fromTabular(data: string, diagramType: string): string {
  const entries: Array<readonly [string, number]> = [];
  for (const raw of splitLines(data.trim())) {
    const line = raw.trim();
    if (line === "") continue;
    const parts = FIRST_FIELD_RE.exec(line);
    if (parts === null) continue;
    const [, head, tail] = parts as unknown as [string, string, string];
    const value = pyFloat(head);
    if (value !== null) entries.push([tail, value]);
    else {
      // The columns may be the other way round, a label first and its number after.
      const reversed = pyFloat(tail);
      if (reversed !== null) entries.push([head, reversed]);
    }
  }

  if (entries.length === 0) throw new Error("Could not parse input as JSON or tabular data");

  const safe = (label: string): string => label.replaceAll(QUOTE, SAFE_QUOTE);

  if (diagramType === "treemap") {
    const lines = ["treemap-beta", `${pad(TREEMAP_INDENT)}"data"`];
    for (const [label, value] of entries) {
      lines.push(`${pad(TREEMAP_INDENT * 2)}"${safe(label)}": ${pyFloatStr(value)}`);
    }
    return lines.join(NEWLINE);
  }

  if (diagramType === "pie") {
    const lines = ["pie"];
    for (const [label, value] of entries) {
      lines.push(`${pad(TREEMAP_INDENT)}"${safe(label)}" : ${pyFloatStr(value)}`);
    }
    return lines.join(NEWLINE);
  }

  throw new Error(`Tabular input not supported for ${diagramType}`);
}

/** The diagram types data can be turned into, in the order the error message lists them. */
const CONVERTERS: ReadonlyMap<string, (data: PyValue) => string> = new Map([
  ["xychart", toXYChart],
  ["treemap", toTreemap],
  ["pie", toPie],
  ["mindmap", toMindmap],
  ["flowchart", toFlowchart],
]);

/** A JSON document as the mermaid source for the given diagram type, falling back to tabular input. */
export function jsonToMermaid(data: string, diagramType: string): string {
  const converter = CONVERTERS.get(diagramType);
  if (converter === undefined) {
    const supported = [...CONVERTERS.keys()].join(LIST_SEPARATOR);
    throw new Error(`Unsupported JSON diagram type: ${diagramType}. Supported: ${supported}`);
  }

  try {
    return converter(loads(data));
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  return fromTabular(data, diagramType);
}
