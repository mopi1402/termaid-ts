// Ported from src/termaid/cli.py.
//
// Two things here have no Python to be faithful to. `argparse` is the standard library, so its parsing is rebuilt for
// exactly the flags below and its diagnostics are written in its shape, not copied word for word. And `--tui` opens a
// Textual app, which is a Python TUI framework: the flag is kept so the surface is the same, and it says what it is.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonToMermaid } from "./ingest.js";
import { parse, render, renderThemedText, type Options } from "./index.js";
import { printToConsole, Text } from "./richcompat.js";
import { ljust } from "./pycompat.js";
import { displayWidth } from "./utils.js";

const PROGRAM = "termaid";
const NEWLINE = "\n";
const OK = 0;
const FAILED = 1;
/** What a command line a parser cannot read exits with, which is argparse's own code. */
const MISUSED = 2;

/** The width a console falls back to when nothing on either end of the pipe says otherwise. */
const FALLBACK_WIDTH = 80;

const THEME_NAMES = [
  "default",
  "terra",
  "neon",
  "mono",
  "amber",
  "phosphor",
  "gruvbox",
  "monokai",
  "dracula",
  "nord",
  "solarized",
] as const;

const JSON_TYPES = ["treemap", "pie", "mindmap", "flowchart", "xychart"] as const;

const DEFAULT_PADDING_X = 4;
const DEFAULT_PADDING_Y = 2;
const DEFAULT_GAP = 4;
const ALL = "all";

interface Args {
  file: string | null;
  ascii: boolean;
  paddingX: number;
  paddingY: number;
  gap: number;
  width: number | null;
  sharpEdges: boolean;
  theme: string | null;
  tui: boolean;
  noAutoFit: boolean;
  output: string | null;
  showIds: boolean;
  json: string | null;
  themes: boolean;
  demo: string | null;
}

const DEFAULTS: Args = {
  file: null,
  ascii: false,
  paddingX: DEFAULT_PADDING_X,
  paddingY: DEFAULT_PADDING_Y,
  gap: DEFAULT_GAP,
  width: null,
  sharpEdges: false,
  theme: null,
  tui: false,
  noAutoFit: false,
  output: null,
  showIds: false,
  json: null,
  themes: false,
  demo: null,
};

const HELP = `usage: ${PROGRAM} [-h] [--ascii] [--padding-x PADDING_X] [--padding-y PADDING_Y]
               [--gap GAP] [--width WIDTH] [--sharp-edges] [--theme THEME]
               [--tui] [--no-auto-fit] [-o FILE] [--show-ids] [--json TYPE]
               [--themes] [--demo [TYPE]] [--version]
               [file]

Render Mermaid diagrams as Unicode art in the terminal

positional arguments:
  file                  Mermaid diagram file (.mmd). Reads from stdin if not provided.

options:
  -h, --help            show this help message and exit
  --ascii               Use ASCII characters instead of Unicode box-drawing
  --padding-x PADDING_X
                        Horizontal padding inside node boxes (default: 4)
  --padding-y PADDING_Y
                        Vertical padding inside node boxes (default: 2)
  --gap GAP             Space between nodes (default: 4). Use 1 or 2 for compact diagrams.
  --width WIDTH         Max output width. Re-renders with smaller gap/padding if exceeded.
  --sharp-edges         Use sharp corners on edge turns instead of rounded
  --theme THEME         Color theme.
  --tui                 Launch interactive TUI viewer.
  --no-auto-fit         Disable automatic compaction when diagram exceeds terminal width
  -o FILE, --output FILE
                        Write output to file instead of stdout
  --show-ids            Show node IDs alongside labels (e.g. 'A: Start') for debugging.
  --json TYPE           Read JSON/tabular data from stdin and render as TYPE.
  --themes              List available color themes and exit.
  --demo [TYPE]         Render sample diagrams. Use 'all' or a type name (flowchart, sequence, etc.).
  --version             show program's version number and exit`;

const out = (line: string): void => {
  process.stdout.write(line + NEWLINE);
};
const err = (line: string): void => {
  process.stderr.write(line + NEWLINE);
};

/** The package's own version, which is where the reference reads its metadata. */
function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
    try {
      return (JSON.parse(fs.readFileSync(candidate, "utf8")) as { version: string }).version;
    } catch {
      continue;
    }
  }
  return "0.0.0";
}

/** Thrown where argparse would print a usage line and stop. */
class UsageError extends Error {}

const asInteger = (flag: string, text: string): number => {
  if (!/^[+-]?\d+$/.test(text.trim())) throw new UsageError(`argument ${flag}: invalid int value: '${text}'`);
  return Number.parseInt(text, 10);
};

const asChoice = (flag: string, text: string, choices: readonly string[]): string => {
  if (!choices.includes(text)) {
    throw new UsageError(`argument ${flag}: invalid choice: '${text}' (choose from ${choices.map((c) => `'${c}'`).join(", ")})`);
  }
  return text;
};

/** What `--flag=value` and `--flag value` both mean, the second reading the argument that follows. */
interface Reader {
  next(flag: string, inline: string | undefined): string;
}

/** The command line, as far as this program's own flags go. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { ...DEFAULTS };
  let at = 0;
  const reader: Reader = {
    next(flag, inline) {
      if (inline !== undefined) return inline;
      const value = argv[++at];
      if (value === undefined) throw new UsageError(`argument ${flag}: expected one argument`);
      return value;
    },
  };
  /** An optional argument is taken only when what follows is not itself a flag. */
  const optional = (inline: string | undefined): string | null => {
    if (inline !== undefined) return inline;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("-")) return null;
    at++;
    return value;
  };

  for (; at < argv.length; at++) {
    const token = argv[at] as string;
    if (!token.startsWith("-") || token === "-") {
      if (args.file !== null) throw new UsageError(`unrecognized arguments: ${token}`);
      args.file = token;
      continue;
    }

    const split = token.indexOf("=");
    const flag = split < 0 ? token : token.slice(0, split);
    const inline = split < 0 ? undefined : token.slice(split + 1);

    switch (flag) {
      case "-h":
      case "--help":
        out(HELP);
        process.exit(OK);
        break;
      case "--version":
        out(`${PROGRAM} ${version()}`);
        process.exit(OK);
        break;
      case "--ascii":
        args.ascii = true;
        break;
      case "--padding-x":
        args.paddingX = asInteger(flag, reader.next(flag, inline));
        break;
      case "--padding-y":
        args.paddingY = asInteger(flag, reader.next(flag, inline));
        break;
      case "--gap":
        args.gap = asInteger(flag, reader.next(flag, inline));
        break;
      case "--width":
        args.width = asInteger(flag, reader.next(flag, inline));
        break;
      case "--sharp-edges":
        args.sharpEdges = true;
        break;
      case "--theme":
        args.theme = asChoice(flag, reader.next(flag, inline), THEME_NAMES);
        break;
      case "--tui":
        args.tui = true;
        break;
      case "--no-auto-fit":
        args.noAutoFit = true;
        break;
      case "-o":
      case "--output":
        args.output = reader.next(flag, inline);
        break;
      case "--show-ids":
        args.showIds = true;
        break;
      case "--json":
        args.json = asChoice(flag, reader.next(flag, inline), JSON_TYPES);
        break;
      case "--themes":
        args.themes = true;
        break;
      case "--demo":
        args.demo = optional(inline) ?? ALL;
        break;
      default:
        throw new UsageError(`unrecognized arguments: ${token}`);
    }
  }

  return args;
}

const maxLineWidth = (text: string): number => Math.max(0, ...text.split(NEWLINE).map(displayWidth));

/** The plain view of a result, which is what a width is measured on: a painted one carries escapes that take no room. */
const plainOf = (result: string | Text): string => (typeof result === "string" ? result : result.plain);

/** The columns a terminal has, or the fallback nothing contradicts. */
function terminalWidth(): number {
  const declared = process.env["COLUMNS"];
  if (declared !== undefined && /^\d+$/.test(declared)) return Number.parseInt(declared, 10);
  return process.stdout.columns ?? FALLBACK_WIDTH;
}

/** The width Rich gives a console: a real terminal's, and 80 where every stream is a pipe. */
function consoleWidth(): number {
  const declared = process.env["COLUMNS"];
  if (declared !== undefined && /^\d+$/.test(declared)) return Number.parseInt(declared, 10);
  for (const stream of [process.stdin, process.stdout, process.stderr] as const) {
    const columns = (stream as { columns?: number }).columns;
    if (columns !== undefined && columns > 0) return columns;
  }
  return FALLBACK_WIDTH;
}

/**
 * The width a drawing is asked to fit in: the one named on the command line, or the terminal's, and none at all when
 * the output is a pipe or the caller turned the fitting off.
 */
function targetWidth(args: Args): number | undefined {
  if (args.width !== null) return args.width;
  if (args.noAutoFit || process.stdout.isTTY !== true) return undefined;
  return terminalWidth();
}

const TOO_WIDE = (actual: number, target: number): string =>
  `Warning: diagram is ${actual} cols wide but target is ${target}. ` +
  `Try: less -S, or use 'graph TD' for vertical layout.`;

/** The diagram source, from a file or from what was piped in. */
function readSource(args: Args): string | null {
  if (args.file !== null) {
    try {
      return fs.readFileSync(args.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") err(`Error: File not found: ${args.file}`);
      else err(`Error reading file: ${(e as Error).message}`);
      return null;
    }
  }
  if (process.stdin.isTTY !== true) return fs.readFileSync(0, "utf8");
  err("Error: No input provided. Pass a file or pipe input.");
  err(`Usage: ${PROGRAM} diagram.mmd`);
  err(`       echo 'graph LR; A-->B' | ${PROGRAM}`);
  return null;
}

/** The TERM values Rich reads as a terminal that cannot show a colour, whatever else the environment says. */
const DUMB_TERMS: ReadonlySet<string> = new Set(["dumb", "unknown"]);
const NO_COLOR_VAR = "NO_COLOR";
const FORCE_COLOR_VAR = "FORCE_COLOR";
const TERM_VAR = "TERM";

/**
 * Rich's own decision, measured against the reference binary rather than read off its source. Three things in order:
 * NO_COLOR beats everything and is answered by its PRESENCE, empty string included; a dumb TERM comes next; and what
 * is left paints on a terminal alone, or where FORCE_COLOR holds something non-empty. FORCE_COLOR's value is never
 * read, so "0" forces just as "1" does, and only "" is the same as unset.
 */
function consoleShowsColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[NO_COLOR_VAR] !== undefined) return false;
  if (DUMB_TERMS.has(env[TERM_VAR] ?? "")) return false;
  const forced = env[FORCE_COLOR_VAR];
  if (forced !== undefined && forced !== "") return true;
  return process.stdout.isTTY === true;
}

/** A theme paints only where a console would show it: asking for one is not the same as having somewhere to draw it. */
const useColor = (args: Args): boolean => args.theme !== null && consoleShowsColor();

const QUOTE = '"';
const SAFE_QUOTE = "'";

/** The source rewritten so each node shows its id beside its label, which only a flowchart can be. */
function applyShowIds(source: string): string {
  let graph;
  try {
    graph = parse(source);
  } catch {
    return source;
  }

  const extra: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.label !== id) extra.push(`  ${id}["${`${id}: ${node.label}`.replaceAll(QUOTE, SAFE_QUOTE)}"]`);
  }
  if (extra.length === 0) return source;

  // The redefinitions go straight after the header line, where the parser still reads them as node declarations.
  const lines = source.split(NEWLINE);
  return [lines[0] as string, ...extra, ...lines.slice(1)].join(NEWLINE);
}

const THEME_NAME_WIDTH = 12;
const THEME_KIND_WIDTH = 8;

const THEME_LIST: ReadonlyArray<readonly [string, string, string]> = [
  ["default", "text", "Cyan nodes, yellow arrows, white labels"],
  ["terra", "text", "Warm earth tones (browns, oranges)"],
  ["neon", "text", "Magenta nodes, green arrows, cyan edges"],
  ["mono", "text", "White/gray monochrome"],
  ["amber", "text", "Amber/gold CRT-style"],
  ["phosphor", "text", "Green phosphor terminal"],
  ["gruvbox", "solid", "Gruvbox dark palette"],
  ["monokai", "solid", "Monokai dark with pink/green accents"],
  ["dracula", "solid", "Dracula purple/pink/green palette"],
  ["nord", "solid", "Nord muted blue/cyan arctic palette"],
  ["solarized", "solid", "Solarized dark blue/yellow/cyan"],
];

function listThemes(): number {
  for (const [name, kind, description] of THEME_LIST) {
    out(`  ${ljust(name, THEME_NAME_WIDTH)} ${ljust(`[${kind}]`, THEME_KIND_WIDTH)} ${description}`);
  }
  return OK;
}

const DEMO_SOURCES: ReadonlyMap<string, readonly [string, string]> = new Map([
  [
    "flowchart",
    ["Flowchart", "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Process]\n  B -->|No| D[End]\n  C --> D"],
  ],
  [
    "sequence",
    [
      "Sequence diagram",
      "sequenceDiagram\n  Client->>Server: GET /api\n  Server->>DB: SELECT\n  DB-->>Server: rows\n  Server-->>Client: 200 JSON",
    ],
  ],
  [
    "class",
    [
      "Class diagram",
      "classDiagram\n  class Animal {\n    +String name\n    +makeSound()\n  }\n  class Dog {\n    +fetch()\n  }\n  Animal <|-- Dog",
    ],
  ],
  ["er", ["ER diagram", "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains"]],
  [
    "state",
    ["State diagram", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Done : complete\n  Done --> [*]"],
  ],
  ["block", ["Block diagram", "block-beta\n  columns 3\n  Frontend API Database"]],
  [
    "git",
    ["Git graph", "gitGraph\n  commit\n  branch develop\n  commit\n  commit\n  checkout main\n  merge develop\n  commit"],
  ],
  ["pie", ["Pie chart", 'pie title Languages\n  "Python" : 45\n  "Go" : 30\n  "Rust" : 25']],
  [
    "treemap",
    ["Treemap", 'treemap-beta\n  "Backend"\n    "API": 35\n    "Auth": 15\n  "Frontend"\n    "React": 30\n    "CSS": 10'],
  ],
  [
    "mindmap",
    [
      "Mindmap",
      "mindmap\n  Project\n    Design\n      Wireframes\n      Mockups\n    Development\n      Frontend\n      Backend\n    Testing",
    ],
  ],
  [
    "timeline",
    [
      "Timeline",
      "timeline\n    title Roadmap\n    section Q1\n        Research : Analysis\n        Design : Wireframes\n    section Q2\n        Build : Frontend, Backend\n        Launch : Beta",
    ],
  ],
  [
    "kanban",
    [
      "Kanban",
      "kanban\n    Todo\n        Design homepage\n        Fix login bug\n    In Progress\n        API integration\n    Done\n        Project setup",
    ],
  ],
  [
    "journey",
    [
      "User journey",
      "journey\n    title My working day\n    section Go to work\n        Make tea: 5: Me\n        Go upstairs: 3: Me\n        Do work: 1: Me, Cat\n    section Go home\n        Go downstairs: 5: Me\n        Sit down: 5: Me",
    ],
  ],
  [
    "xychart",
    [
      "XY chart",
      'xychart-beta\n    title "Monthly Revenue"\n    x-axis [Jan, Feb, Mar, Apr, May, Jun]\n    y-axis "Revenue (k)"\n    bar [12, 18, 25, 20, 30, 35]',
    ],
  ],
  [
    "quadrant",
    [
      "Quadrant chart",
      "quadrantChart\n    title Priority Matrix\n    x-axis Low Effort --> High Effort\n    y-axis Low Impact --> High Impact\n    quadrant-1 Do First\n    quadrant-2 Schedule\n    quadrant-3 Delegate\n    quadrant-4 Eliminate\n    Task A: [0.3, 0.8]\n    Task B: [0.8, 0.9]\n    Task C: [0.2, 0.2]",
    ],
  ],
]);

function runDemo(args: Args): number {
  const demoType = (args.demo as string).toLowerCase();
  let keys: string[];
  if (demoType === ALL) keys = [...DEMO_SOURCES.keys()];
  else if (DEMO_SOURCES.has(demoType)) keys = [demoType];
  else {
    err(`Unknown demo type: ${demoType}`);
    err(`Available: all, ${[...DEMO_SOURCES.keys()].join(", ")}`);
    return FAILED;
  }

  const color = useColor(args);
  for (const key of keys) {
    const [title, source] = DEMO_SOURCES.get(key) as readonly [string, string];
    out(`=== ${title} ===`);
    if (color) process.stdout.write(printToConsole(renderThemedText(source, {}, args.theme as string), consoleWidth()));
    else out(render(source));
    out("");
  }

  return OK;
}

/** What the reference passes on from the command line to a render. */
const renderOptions = (args: Args): Options => ({
  useAscii: args.ascii,
  paddingX: args.paddingX,
  paddingY: args.paddingY,
  roundedEdges: !args.sharpEdges,
  gap: args.gap,
});

export function main(argv: readonly string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`usage: ${PROGRAM} [-h] ... [file]`);
    err(`${PROGRAM}: error: ${e.message}`);
    return MISUSED;
  }

  if (args.themes) return listThemes();
  if (args.demo !== null) return runDemo(args);

  let source = readSource(args);
  if (source === null) return FAILED;

  source = source.trim();
  if (source === "") {
    err("Error: Empty input.");
    return FAILED;
  }

  if (args.json !== null) {
    try {
      source = jsonToMermaid(source, args.json);
    } catch (e) {
      err(`Error converting JSON to ${args.json}: ${(e as Error).message}`);
      return FAILED;
    }
  }

  if (args.tui) {
    // The reference opens a Textual app here, which is a Python TUI framework with nothing to port it onto.
    err("Error: --tui is not part of the TypeScript port.");
    return FAILED;
  }

  const renderSource = args.showIds ? applyShowIds(source) : source;
  const target = targetWidth(args);
  const options: Options = { ...renderOptions(args), ...(target === undefined ? {} : { width: target }) };

  try {
    const result: string | Text = useColor(args)
      ? renderThemedText(renderSource, options, args.theme as string)
      : render(renderSource, options);

    const actual = maxLineWidth(plainOf(result));
    if (target !== undefined && actual > target) err(TOO_WIDE(actual, target));

    if (args.output !== null) {
      try {
        // A file is written at the drawing's OWN width, so nothing in it is folded that a terminal would not fold.
        const body =
          typeof result === "string" ? result + NEWLINE : printToConsole(result, Math.max(actual, FALLBACK_WIDTH));
        fs.writeFileSync(args.output, body, "utf8");
      } catch (e) {
        err(`Error writing to ${args.output}: ${(e as Error).message}`);
        return FAILED;
      }
    } else if (typeof result === "string") out(result);
    else process.stdout.write(printToConsole(result, consoleWidth()));
  } catch (e) {
    err(`Error rendering diagram: ${(e as Error).message}`);
    return FAILED;
  }

  return OK;
}
