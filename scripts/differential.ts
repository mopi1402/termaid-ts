// The port held against the LIVE reference, which is the question the frozen takes cannot answer: those say what the
// reference drew the day the oracle ran, and a version bump invalidates every one of them at once.
//
// A case costs one spawn, never two: the reference is a subprocess, the port runs in this process. Only the CLI cases
// at the end spawn both, since a flag and an error message are the one thing the library cannot answer for.
//
// The corpus is deliberately HOSTILE. Two implementations agree on valid input long after they have stopped agreeing:
// a truncated line, an unclosed delimiter, an empty label and an arrow inside a label are where a port drifts, and the
// reference prints a malformed line in the body rather than refusing it, so the port has to be wrong the same way.
//
//     bun scripts/differential.ts            the whole corpus
//     bun scripts/differential.ts --quick    the fixtures alone, no mutants
//
// The exit code is NOT compared, once and for a written reason: the reference is reached THROUGH a runner, so what
// comes back is that runner's code and not the tool's. Its stdout and stderr are compared in full, which is what a
// terminal shows anyway.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printToConsole, render, renderThemedText, type Options } from "../src/index.js";
import { REFERENCE_COMMAND, referenceArgs } from "./reference.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE_EXT = ".mmd";
const NEWLINE = "\n";
const EMPTY = "";

/** Where a divergent pair is written, since a source that broke the port is worth more than the count that hid it. */
const REPORT_DIR = path.join(os.tmpdir(), "termaid-differential");
/** How many divergences are written out before the run stops naming them one by one. */
const REPORTED = 10;

/** How many spawns are in flight at once: the reference is mostly startup, so the wait is what parallelism buys back. */
const CONCURRENCY = Math.max(2, os.cpus().length - 2);

const QUICK_FLAG = "--quick";
const quick = process.argv.includes(QUICK_FLAG);

// ---------------------------------------------------------------------------------------------- the option matrix

/** One way of asking for a drawing, which BOTH the command line and the library call are derived from. */
interface Profile {
  label: string;
  width: number;
  /** `null` draws in plain text, a name paints. */
  theme: string | null;
  ascii?: boolean;
  gap?: number;
  paddingX?: number;
  paddingY?: number;
  sharp?: boolean;
}

const WIDTH_FLAG = "--width";
const THEME_FLAG = "--theme";
const ASCII_FLAG = "--ascii";
const GAP_FLAG = "--gap";
const PADDING_X_FLAG = "--padding-x";
const PADDING_Y_FLAG = "--padding-y";
const SHARP_FLAG = "--sharp-edges";
/** What turns the colour on: the reference writes to a pipe here, and paints nothing unless told. */
const COLOUR_ENV = { FORCE_COLOR: "1" } as const;

function argvOf(profile: Profile): string[] {
  const argv = [WIDTH_FLAG, String(profile.width)];
  if (profile.theme !== null) argv.push(THEME_FLAG, profile.theme);
  if (profile.ascii === true) argv.push(ASCII_FLAG);
  if (profile.gap !== undefined) argv.push(GAP_FLAG, String(profile.gap));
  if (profile.paddingX !== undefined) argv.push(PADDING_X_FLAG, String(profile.paddingX));
  if (profile.paddingY !== undefined) argv.push(PADDING_Y_FLAG, String(profile.paddingY));
  if (profile.sharp === true) argv.push(SHARP_FLAG);
  return argv;
}

function optionsOf(profile: Profile): Options {
  const options: Options = { width: profile.width };
  if (profile.ascii === true) options.useAscii = true;
  if (profile.gap !== undefined) options.gap = profile.gap;
  if (profile.paddingX !== undefined) options.paddingX = profile.paddingX;
  if (profile.paddingY !== undefined) options.paddingY = profile.paddingY;
  if (profile.sharp === true) options.roundedEdges = false;
  return options;
}

/** What the port writes for a profile: the same two chains `cli.ts` picks between, and a console folds a painted one. */
function drawn(source: string, profile: Profile): string {
  const options = optionsOf(profile);
  if (profile.theme === null) return render(source, options) + NEWLINE;
  return printToConsole(renderThemedText(source, options, profile.theme));
}

/** A solid theme is in the set on purpose: it is the only thing that reaches the `is_solid` half of the rich adapter. */
const PROFILES: readonly Profile[] = [
  { label: "plain@40", width: 40, theme: null },
  { label: "plain@80", width: 80, theme: null },
  { label: "plain@120", width: 120, theme: null },
  { label: "neon@40", width: 40, theme: "neon" },
  { label: "neon@80", width: 80, theme: "neon" },
  // Past 80 the console folds what the width let through, which no other profile exercises.
  { label: "neon@120", width: 120, theme: "neon" },
  { label: "dracula@80", width: 80, theme: "dracula" },
  { label: "ascii@80", width: 80, theme: null, ascii: true },
  { label: "tight@80", width: 80, theme: null, gap: 1, paddingX: 0, paddingY: 1 },
  { label: "sharp@60", width: 60, theme: null, sharp: true },
];

/** The profiles a mutant is run through: two are enough to catch a divergence, and there are far more mutants. */
const MUTANT_PROFILES: readonly Profile[] = [
  { label: "plain@80", width: 80, theme: null },
  { label: "neon@80", width: 80, theme: "neon" },
];

// ---------------------------------------------------------------------------------------------- the corpus

interface Case {
  name: string;
  source: string;
}

const fixtures = (): Case[] =>
  fs
    .readdirSync(FIXTURES)
    .filter((file) => file.endsWith(SOURCE_EXT))
    .sort()
    .map((file) => ({
      name: file.slice(0, -SOURCE_EXT.length),
      source: fs.readFileSync(path.join(FIXTURES, file), "utf8"),
    }));

/** A deterministic generator, so a divergence found today is the same case tomorrow. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A code point outside the Latin range, whose width the reference measures with its own table. */
const WIDE_CHAR = "漢";
const STRAY_DELIMITERS = ["]", "}", ")", "|", '"'];
const LABEL_RE = /\[[^\]]*\]/;
const ARROW = "-->";

/** Every way a line is broken. Each takes a line and gives back what a half-written source would carry instead. */
const MUTATIONS: ReadonlyArray<readonly [string, (line: string, pick: () => number) => string]> = [
  ["cut", (line) => line.slice(0, Math.max(0, Math.floor(line.length / 2)))],
  ["drop-last", (line) => line.slice(0, -1)],
  ["stray", (line, pick) => line + (STRAY_DELIMITERS[Math.floor(pick() * STRAY_DELIMITERS.length)] as string)],
  ["empty-label", (line) => line.replace(LABEL_RE, "[]")],
  ["arrow-in-label", (line) => line.replace(LABEL_RE, `[a ${ARROW} b]`)],
  ["wide", (line) => line.replace(/[A-Za-z]/, WIDE_CHAR)],
  ["blank", () => EMPTY],
  ["tabs", (line) => line.replace(/ {2}/g, "\t")],
  ["doubled", (line) => line + line.trim()],
];

/** How many mutants each fixture yields. */
const MUTANTS_PER_FIXTURE = 6;

function mutants(base: Case, index: number): Case[] {
  const lines = base.source.split(NEWLINE);
  const out: Case[] = [];
  for (let n = 0; n < MUTANTS_PER_FIXTURE; n++) {
    const pick = seeded(index * 1000 + n);
    // Never line 0: blanking the header turns every fixture into the same unreadable source.
    const at = 1 + Math.floor(pick() * Math.max(1, lines.length - 1));
    const [label, mutate] = MUTATIONS[Math.floor(pick() * MUTATIONS.length)] as (typeof MUTATIONS)[number];
    if (at >= lines.length) continue;
    const changed = [...lines];
    changed[at] = mutate(lines[at] as string, pick);
    out.push({ name: `${base.name}~${label}@${at}`, source: changed.join(NEWLINE) });
  }
  return out;
}

/** The shapes no fixture has, written by hand because a mutation of a valid source never reaches them. */
const ADVERSARIAL: readonly Case[] = [
  { name: "adv-header-only", source: "graph LR\n" },
  { name: "adv-one-node", source: "graph LR\n  A\n" },
  { name: "adv-unclosed-bracket", source: "graph LR\n  A[unclosed --> B\n" },
  { name: "adv-unclosed-brace", source: "graph LR\n  A{unclosed --> B\n" },
  { name: "adv-nested-brackets", source: "graph LR\n  A[a [b] c] --> B\n" },
  { name: "adv-empty-label", source: "graph LR\n  A[] --> B[]\n" },
  { name: "adv-quotes", source: 'graph LR\n  A["a \\"quoted\\" label"] --> B\n' },
  { name: "adv-wide-ids", source: `graph LR\n  ${WIDE_CHAR}${WIDE_CHAR} --> ${WIDE_CHAR}\n` },
  { name: "adv-emoji", source: "graph LR\n  A[done 😄] --> B[failed 😞]\n" },
  { name: "adv-long-label", source: `graph LR\n  A[${"x".repeat(200)}] --> B\n` },
  { name: "adv-many-nodes", source: `graph LR\n${Array.from({ length: 30 }, (_, i) => `  N${i} --> N${i + 1}`).join(NEWLINE)}\n` },
  { name: "adv-self-loop", source: "graph LR\n  A --> A\n" },
  { name: "adv-unknown-type", source: "unknownDiagram\n  A --> B\n" },
  { name: "adv-frontmatter", source: "---\ntitle: t\n---\ngraph LR\n  A --> B\n" },
  { name: "adv-crlf", source: "graph LR\r\n  A --> B\r\n" },
  { name: "adv-trailing-spaces", source: "graph LR   \n  A --> B   \n" },
  { name: "adv-comment-only", source: "graph LR\n  %% nothing here\n" },
  { name: "adv-classdef", source: "graph LR\n  A --> B\n  classDef hot fill:#f00,stroke:#0f0,stroke-width:3px\n  class A hot\n" },
  { name: "adv-linkstyle", source: "graph LR\n  A --> B --> C\n  linkStyle 0 stroke:#0ff,stroke-dasharray:3\n" },
  { name: "adv-seq-unclosed", source: "sequenceDiagram\n  loop forever\n    A->>B: hi\n" },
];

// ---------------------------------------------------------------------------------------------- the run

interface Divergence {
  label: string;
  source: string;
  expected: string;
  got: string;
}

let divergences: Divergence[] = [];
/**
 * Cases where the REFERENCE does not agree with itself. `parser/architecture.py` collects the edges a junction
 * collapses into a `set` and iterates it, so their order follows CPython's randomised string hashing: which of two
 * crossing lines wins the cell then changes from one run to the next. A direction merge hides it everywhere the
 * charset has box-drawing characters, and `--ascii` is where it shows. Not a divergence, and nothing the port can
 * match: `PYTHONHASHSEED=0` and `PYTHONHASHSEED=1` draw two different diagrams.
 */
const unstable: string[] = [];
/** How many times the reference is asked again before its own answer is called stable. */
const RECHECKS = 6;
/** Anything the reference says on stderr that is neither the auto-fit warning nor a refusal. */
const noisy: string[] = [];
const AUTO_FIT_WARNING = /^Warning: diagram is \d+ cols wide but target is \d+\./;
/**
 * A source the reference gives up on. It is matched by a REFUSAL and never by bytes: what follows the colon is
 * CPython's own diagnostic, and forging a `re.error` text is copying the standard library, not porting termaid.
 */
const REFUSAL = /^Error rendering diagram: /m;
let refused = 0;
let checked = 0;

/** The reference reads stdin, so each spawn is fed and closed by hand rather than through execFile's options. */
function referenceOutput(source: string, profile: Profile): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      REFERENCE_COMMAND,
      referenceArgs(argvOf(profile)),
      { encoding: "utf8", env: { ...process.env, ...COLOUR_ENV }, maxBuffer: Number.MAX_SAFE_INTEGER },
      (_error, stdout, stderr) => resolve({ stdout, stderr })
    );
    child.stdin?.end(source);
  });
}

async function pooled(work: ReadonlyArray<() => Promise<void>>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
    while (next < work.length) {
      const at = next++;
      await (work[at] as () => Promise<void>)();
    }
  });
  await Promise.all(workers);
}

async function check(entry: Case, profile: Profile): Promise<void> {
  const label = `${entry.name} [${profile.label}]`;
  const { stdout, stderr } = await referenceOutput(entry.source, profile);
  const refusal = stdout === EMPTY && REFUSAL.test(stderr);
  if (stderr !== EMPTY && !AUTO_FIT_WARNING.test(stderr) && !refusal) noisy.push(`${label}: ${stderr.trim()}`);

  let got: string;
  let threw = false;
  try {
    got = drawn(entry.source, profile);
  } catch (e) {
    threw = true;
    got = `THROWN: ${(e as Error).message}`;
  }

  checked++;

  if (refusal) {
    if (threw) refused++;
    else divergences.push({ label, source: entry.source, expected: `<refus>\n${stderr}`, got });
    return;
  }

  if (got === stdout) return;

  // The reference is asked again before the port is blamed: a case it answers two ways is its own, not a divergence.
  const answers = new Set([stdout]);
  for (let i = 0; i < RECHECKS; i++) answers.add((await referenceOutput(entry.source, profile)).stdout);
  if (answers.size > 1) {
    unstable.push(`${label}${answers.has(got) ? EMPTY : " (et le port ne dit ni l'un ni l'autre)"}`);
    return;
  }

  divergences.push({ label, source: entry.source, expected: stdout, got });
}

// ---------------------------------------------------------------------------------------------- the CLI surface

/** A variable held at `undefined` is REMOVED from the child's environment, which is not the same as an empty one. */
type CaseEnv = Readonly<Record<string, string | undefined>>;

interface CliCase {
  label: string;
  argv: string[];
  input: string;
  env?: CaseEnv;
}

/** What only a command line answers for: a flag read wrong, a message, a file written. Both sides spawn here. */
const FLAG_CASES: ReadonlyArray<CliCase> = [
  { label: "themes", argv: ["--themes"], input: EMPTY },
  { label: "demo-all", argv: ["--demo"], input: EMPTY },
  { label: "demo-one", argv: ["--demo", "er"], input: EMPTY },
  { label: "demo-unknown", argv: ["--demo", "nope"], input: EMPTY },
  { label: "demo-themed", argv: ["--demo", "git", "--theme", "neon"], input: EMPTY },
  { label: "empty-input", argv: [], input: "   \n " },
  { label: "missing-file", argv: [path.join(os.tmpdir(), "termaid-absent.mmd")], input: EMPTY },
  { label: "show-ids", argv: ["--show-ids", "--width", "80"], input: "graph LR\n  A[Start] --> B[End]\n" },
  { label: "json-pie", argv: ["--json", "pie", "--width", "60"], input: '{"A":30,"B":70.5,"C":true}' },
  { label: "json-treemap", argv: ["--json", "treemap", "--width", "60"], input: '{"src":{"a":10,"b":20.5}}' },
  { label: "json-tabular", argv: ["--json", "pie", "--width", "60"], input: "1024\tvar\n2048\tlog\n" },
  { label: "json-unparsable", argv: ["--json", "pie", "--width", "60"], input: "@@@" },
  { label: "too-wide", argv: ["--width", "10"], input: "graph LR\n  A[a long label] --> B[another one]\n" },
  { label: "themed", argv: ["--width", "80", "--theme", "neon"], input: "graph LR\n  A --> B\n" },
];

// Whether a theme actually PAINTS is the console's decision and never the flag's, so the same command line answers
// differently from one environment to the next. Every child here writes to a pipe, which leaves one branch out of
// reach: what a real terminal does is measured by hand, since nothing spawned from a script can be one.
const COLOR_ARGV = ["--width", "40", "--theme", "neon"];
const COLOR_SOURCE = "graph LR\n  A --> B\n";
const COLOR_CASES: ReadonlyArray<{ label: string; env: CaseEnv }> = [
  { label: "pipe-bare", env: { FORCE_COLOR: undefined } },
  { label: "force-1", env: { FORCE_COLOR: "1" } },
  { label: "force-0", env: { FORCE_COLOR: "0" } },
  { label: "force-empty", env: { FORCE_COLOR: "" } },
  { label: "no-color-alone", env: { FORCE_COLOR: undefined, NO_COLOR: "1" } },
  { label: "no-color-beats-force", env: { FORCE_COLOR: "1", NO_COLOR: "1" } },
  { label: "no-color-empty-beats-force", env: { FORCE_COLOR: "1", NO_COLOR: "" } },
  { label: "term-dumb", env: { FORCE_COLOR: "1", TERM: "dumb" } },
  { label: "term-unknown", env: { FORCE_COLOR: "1", TERM: "unknown" } },
  { label: "term-xterm", env: { FORCE_COLOR: "1", TERM: "xterm" } },
];

const CLI_CASES: ReadonlyArray<CliCase> = [
  ...FLAG_CASES,
  ...COLOR_CASES.map(({ label, env }) => ({ label: `color-${label}`, argv: COLOR_ARGV, input: COLOR_SOURCE, env })),
];

const PORT_ENTRY = path.join(ROOT, "src", "main.ts");
const BUN = "bun";

function childEnv(caseEnv: CaseEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...COLOUR_ENV };
  for (const [key, value] of Object.entries(caseEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function spawned(
  command: string,
  argv: readonly string[],
  input: string,
  caseEnv: CaseEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      argv as string[],
      { encoding: "utf8", env: childEnv(caseEnv), maxBuffer: Number.MAX_SAFE_INTEGER },
      (_error, stdout, stderr) => resolve({ stdout, stderr })
    );
    child.stdin?.end(input);
  });
}

async function checkCli(): Promise<void> {
  for (const entry of CLI_CASES) {
    const expected = await spawned(REFERENCE_COMMAND, referenceArgs(entry.argv), entry.input, entry.env ?? {});
    const got = await spawned(BUN, [PORT_ENTRY, ...entry.argv], entry.input, entry.env ?? {});
    checked++;
    if (expected.stdout !== got.stdout || expected.stderr !== got.stderr) {
      divergences.push({
        label: `cli:${entry.label}`,
        source: `${entry.argv.join(" ")}\n<<<\n${entry.input}`,
        expected: expected.stdout + expected.stderr,
        got: got.stdout + got.stderr,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------- the report

/**
 * Where the port diverges ON PURPOSE, each entry carrying the reason it does. A case named here is still run and still
 * compared: only the verdict changes. So the day one of them stops diverging, this list is what says so out loud,
 * which is the whole reason an allowance is written here rather than the case being dropped from the corpus.
 *
 * Nothing in `fixtures/` belongs here: a divergence covered by a fixture would spread to every mutant derived from it,
 * so an assumed one is covered by a test of its own under `tests/` instead, and the corpus stays the parity corpus.
 */
const ASSUMED: ReadonlyArray<readonly [string, string]> = [
  [
    "cli:demo-all",
    "the demo's own pie writes `pie title Languages` on its header line, and the reference drops it (◉ 0.8.3)",
  ],
  // Matched on the PREFIX, so one reason covers a case at every profile it is run through rather than once per line.
  [
    "state-direction~",
    "a back edge's label is written INSIDE a node box by the reference, and given a clear row here (◉ 0.8.3)",
  ],
  [
    "state-endpoints~",
    "a back edge's label is written INSIDE a node box by the reference, and given a clear row here (◉ 0.8.3)",
  ],
];

/** The reason this case is allowed to diverge, or nothing at all where it is not. */
const assumedFor = (label: string): string | undefined => ASSUMED.find(([at]) => label.startsWith(at))?.[1];

function report(): void {
  const assumed = divergences.filter((d) => assumedFor(d.label) !== undefined);
  divergences = divergences.filter((d) => assumedFor(d.label) === undefined);

  if (assumed.length > 0) {
    console.log(`divergences assumees : ${assumed.length}`);
    for (const [at, why] of ASSUMED) {
      const hits = assumed.filter((d) => d.label.startsWith(at));
      if (hits.length > 0) console.log(`  ${at} (${hits.length}) : ${why}`);
    }
  }
  // An allowance nobody needs any more is a claim gone stale, and saying so is the only thing that retires it.
  for (const [at] of ASSUMED) {
    if (!assumed.some((d) => d.label.startsWith(at))) console.log(`allocation perimee, ce cas ne diverge plus : ${at}`);
  }

  if (divergences.length > 0) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    for (const [index, d] of divergences.slice(0, REPORTED).entries()) {
      const stem = path.join(REPORT_DIR, String(index).padStart(2, "0"));
      fs.writeFileSync(`${stem}.source`, d.source, "utf8");
      fs.writeFileSync(`${stem}.expected`, d.expected, "utf8");
      fs.writeFileSync(`${stem}.got`, d.got, "utf8");
      console.log(`  ${d.label}`);
    }
    if (divergences.length > REPORTED) console.log(`  ... et ${divergences.length - REPORTED} de plus`);
    console.log(`  paires ecrites dans ${REPORT_DIR}`);
  }

  if (unstable.length > 0) {
    console.log(`reference non deterministe : ${unstable.length} cas, hachage de CPython (voir le commentaire)`);
    for (const label of unstable.slice(0, REPORTED)) console.log(`  ${label}`);
  }

  if (noisy.length > 0) {
    console.log(`reference bavarde sur stderr, hors avertissement d'ajustement : ${noisy.length} cas`);
    for (const line of noisy.slice(0, REPORTED)) console.log(`  ${line}`);
  }

  if (refused > 0) console.log(`sources refusees des deux cotes : ${refused}`);

  const compared = checked - unstable.length;
  console.log(`differentiel : ${compared - divergences.length}/${compared} identiques`);
}

const base = fixtures();
const corpus: Array<readonly [Case, readonly Profile[]]> = [
  ...base.map((entry) => [entry, PROFILES] as const),
  ...ADVERSARIAL.map((entry) => [entry, PROFILES] as const),
  ...(quick ? [] : base.flatMap((entry, i) => mutants(entry, i).map((m) => [m, MUTANT_PROFILES] as const))),
];

const work = corpus.flatMap(([entry, profiles]) => profiles.map((profile) => () => check(entry, profile)));
console.log(`differentiel : ${work.length} rendus + ${CLI_CASES.length} cas CLI, ${CONCURRENCY} en parallele`);

await pooled(work);
await checkCli();
report();

process.exit(divergences.length === 0 ? 0 : 1);
