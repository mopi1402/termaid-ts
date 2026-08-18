// Sondes ciblées LÀ OÙ `scripts/differential.ts` ne va pas, pour séparer trois choses :
//   - une divergence VOULUE, qui doit porter un ◉ au changelog
//   - une divergence causée par une feature ◉ qui a débordé sur le chemin par défaut  (à discuter)
//   - une divergence de PORTAGE, qui se corrige sans discussion
//
// Famille A ne spawn rien : elle tient le port contre LUI-MÊME, pour vérifier la promesse du 0.8.2
// (« asking for dark, or asking for nothing, moves not a byte »).
// Familles B..F tiennent le port contre la référence VIVANTE.

import { execFile } from "node:child_process";
import { UNICODE } from "./unicode.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  printToConsole,
  render,
  renderThemedText,
  DARK_BACKGROUND,
  LIGHT_BACKGROUND,
  type Options,
} from "../src/index.js";
import { REFERENCE_COMMAND, referenceArgs } from "./reference.js";

const FIXTURES = new URL("../fixtures", import.meta.url).pathname;
const REPORT_DIR = path.join(os.tmpdir(), "termaid-probe");
const CONCURRENCY = Math.max(2, os.cpus().length - 2);
const NL = "\n";

const THEMES = [
  "default", "terra", "neon", "mono", "amber", "phosphor",
  "gruvbox", "monokai", "dracula", "nord", "solarized",
] as const;

const fixtureNames = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".mmd"))
  .map((f) => f.slice(0, -4))
  .sort();

const src = (name: string): string => fs.readFileSync(path.join(FIXTURES, `${name}.mmd`), "utf8");

/** Un échantillon qui touche chaque famille de renderer, pour ne pas payer 76 spawns par thème. */
const SAMPLE = [
  "architecture-basic", "block-shapes", "class-basic", "er-attributes", "gantt-basic",
  "gitgraph-basic", "journey-basic", "kanban-basic", "mindmap-basic", "packet-basic",
  "pie-basic", "quadrant-basic", "seq-notes", "shapes", "state-composite",
  "timeline-basic", "treemap-basic", "xychart-bars",
];

interface Divergence {
  family: string;
  label: string;
  source: string;
  expected: string;
  got: string;
}
let divergences: Divergence[] = [];
let checked = 0;

// ------------------------------------------------------------------ A : le ◉ background déborde-t-il ?

function familyA(): void {
  let mirrored = 0;
  for (const name of fixtureNames) {
    const source = src(name);
    for (const width of [40, 80]) {
      // Le chemin PLAIN ne connaît pas de couleur : `background` doit y être inerte, quelle que soit sa valeur.
      const plain = render(source, { width });
      for (const bg of [DARK_BACKGROUND, LIGHT_BACKGROUND] as const) {
        checked++;
        const withBg = render(source, { width, background: bg } as Options);
        if (withBg !== plain) {
          divergences.push({
            family: "A-plain-background-leak",
            label: `${name}@${width} background=${bg}`,
            source,
            expected: plain,
            got: withBg,
          });
        }
      }
      for (const theme of THEMES) {
        const text = renderThemedText(source, { width }, theme);
        const bare = text.toAnsi();
        const dark = text.toAnsi(DARK_BACKGROUND);
        const light = text.toAnsi(LIGHT_BACKGROUND);
        checked++;
        if (bare !== dark) {
          divergences.push({
            family: "A-default-not-dark",
            label: `${name}@${width} ${theme}`,
            source,
            expected: bare,
            got: dark,
          });
        }
        if (light !== bare) mirrored++;
      }
    }
  }
  console.log(`A : le ◉ background, ${mirrored} rendus effectivement miroités (0 voudrait dire feature morte)`);
}

// ------------------------------------------------------------------ le spawn de la référence

function spawned(argv: readonly string[], input: string, colour: boolean): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = colour ? { ...process.env, FORCE_COLOR: "1" } : process.env;
    const child = execFile(
      REFERENCE_COMMAND,
      referenceArgs(argv),
      { encoding: "utf8", env, maxBuffer: Number.MAX_SAFE_INTEGER },
      (_e, stdout, stderr) => resolve({ stdout, stderr })
    );
    child.stdin?.end(input);
  });
}

interface Probe {
  family: string;
  label: string;
  source: string;
  width: number;
  theme: string | null;
}

/** Ce que le port écrit, par les deux mêmes chaînes que `cli.ts` choisit. */
function portDraw(p: Probe): string {
  try {
    const options: Options = { width: p.width };
    if (p.theme === null) return render(p.source, options) + NL;
    return printToConsole(renderThemedText(p.source, options, p.theme));
  } catch (e) {
    return `THROWN: ${(e as Error).message}`;
  }
}

async function run(probes: Probe[]): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = next++;
      if (index >= probes.length) return;
      const p = probes[index] as Probe;
      const argv = ["--width", String(p.width), ...(p.theme === null ? [] : ["--theme", p.theme])];
      const { stdout, stderr } = await spawned(argv, p.source, p.theme !== null);
      const expected = stderr.length > 0 && stdout.length === 0 ? `<refus>\n${stderr}` : stdout;
      const got = portDraw(p);
      checked++;
      if (got !== expected) {
        divergences.push({ family: p.family, label: p.label, source: p.source, expected, got });
      }
    }
  });
  await Promise.all(workers);
}

// ------------------------------------------------------------------ B : les onze thèmes

const familyB = (): Probe[] =>
  SAMPLE.flatMap((name) =>
    THEMES.map((theme) => ({
      family: "B-themes",
      label: `${name}@80.${theme}`,
      source: src(name),
      width: 80,
      theme: theme as string,
    }))
  );

// ------------------------------------------------------------------ C : les largeurs extrêmes

const EXTREME_WIDTHS = [1, 2, 3, 5, 10, 200, 500];

const familyC = (): Probe[] =>
  SAMPLE.slice(0, 12).flatMap((name) =>
    EXTREME_WIDTHS.map((width) => ({
      family: "C-widths",
      label: `${name}@${width}`,
      source: src(name),
      width,
      theme: null,
    }))
  );

// ------------------------------------------------------------------ D : l'arithmétique des nombres

/** Là où l'arrondi du banquier, `%g` et la division entière de CPython se voient : des pourcentages et des axes. */
const NUMERIC: ReadonlyArray<readonly [string, string]> = [
  ["pie-halves", 'pie\n    title H\n    "A" : 12.5\n    "B" : 12.5\n    "C" : 25\n    "D" : 50\n'],
  ["pie-thirds", 'pie\n    title T\n    "A" : 1\n    "B" : 1\n    "C" : 1\n'],
  ["pie-sevenths", 'pie\n    title S\n    "A" : 1\n    "B" : 1\n    "C" : 1\n    "D" : 1\n    "E" : 1\n    "F" : 1\n    "G" : 1\n'],
  ["pie-zero", 'pie\n    title Z\n    "A" : 0\n    "B" : 100\n'],
  ["pie-all-zero", 'pie\n    title Z\n    "A" : 0\n    "B" : 0\n'],
  ["pie-negative", 'pie\n    title N\n    "A" : -10\n    "B" : 110\n'],
  ["pie-huge", 'pie\n    title H\n    "A" : 1e18\n    "B" : 1\n'],
  ["pie-tiny", 'pie\n    title T\n    "A" : 0.0000001\n    "B" : 99.9999999\n'],
  ["pie-many", `pie\n    title M\n${Array.from({ length: 40 }, (_, i) => `    "s${i}" : ${i + 1}`).join(NL)}\n`],
  ["pie-showdata-halves", 'pie showData\n    title H\n    "A" : 2.5\n    "B" : 7.5\n'],
  ["xy-floats", "xychart-beta\n    title X\n    x-axis [a, b, c]\n    y-axis 0.05 --> 0.15\n    line [0.05, 0.1, 0.15]\n"],
  ["xy-negative", "xychart-beta\n    title X\n    x-axis [a, b, c]\n    bar [-5, 0, 5]\n"],
  ["xy-flat", "xychart-beta\n    x-axis [a, b]\n    line [7, 7]\n"],
  ["xy-huge", "xychart-beta\n    x-axis [a, b]\n    bar [1000000, 2000000]\n"],
  ["xy-single", "xychart-beta\n    x-axis [a]\n    line [1]\n"],
  ["gantt-day-boundary", "gantt\n    title G\n    dateFormat YYYY-MM-DD\n    section S\n    a :2020-02-28, 2d\n    b :2020-03-01, 1d\n"],
  ["gantt-leap", "gantt\n    title G\n    dateFormat YYYY-MM-DD\n    section S\n    a :2020-02-29, 1d\n"],
  ["gantt-zero-len", "gantt\n    title G\n    dateFormat YYYY-MM-DD\n    section S\n    a :2020-01-01, 0d\n"],
  ["treemap-floats", 'treemap-beta\n"root"\n    "a": 0.1\n    "b": 0.2\n'],
  ["packet-overflow", "packet-beta\n0-7: \"a\"\n8-64: \"b\"\n"],
];

// ------------------------------------------------------------------ E : ce que mesure une largeur de caractère

// ------------------------------------------------------------------ F : les deux bugs connus de la référence

const KNOWN: ReadonlyArray<readonly [string, string]> = [
  ["mindmap-root-round", "mindmap\n  root((Central))\n    Branch\n"],
  ["mindmap-root-square", "mindmap\n  root[Central]\n    Branch\n"],
  ["mindmap-root-cloud", "mindmap\n  root)Central(\n    Branch\n"],
  ["pie-title-inline", 'pie title Where the time goes\n    "A" : 60\n    "B" : 40\n'],
  ["pie-showdata-title-inline", 'pie showData title T\n    "A" : 1\n'],
];

const handwritten = (family: string, cases: ReadonlyArray<readonly [string, string]>): Probe[] =>
  cases.flatMap(([label, source]) =>
    [
      { family, label: `${label}@80`, source, width: 80, theme: null },
      { family, label: `${label}@40`, source, width: 40, theme: null },
      { family, label: `${label}@80.neon`, source, width: 80, theme: "neon" as string | null },
    ] as Probe[]
  );

// ------------------------------------------------------------------ le rapport

/** Là où le port diverge EXPRÈS. Le cas est toujours rendu et comparé : seul le verdict change. */
const ASSUMED: ReadonlyArray<readonly [string, string]> = [
  ["bom-leading", "un BOM en tête est retiré avant la lecture de l'entête, quand la référence le garde et perd le diagramme (◉ 0.8.0)"],
  ["pie-title-inline", "un titre `pie` écrit sur la ligne d'entête est lu, quand la référence le laisse tomber (◉ 0.8.3)"],
  ["pie-showdata-title-inline", "le même titre d'entête, derrière `showData` (◉ 0.8.3)"],
  ["mindmap-root-", "un id devant une forme est un pointeur et non un mot, quand la référence dessine les deux (◉ 0.8.3)"],
];

const assumedFor = (label: string): string | undefined => ASSUMED.find(([at]) => label.startsWith(at))?.[1];

function report(): void {
  const assumed = divergences.filter((d) => assumedFor(d.label) !== undefined);
  divergences = divergences.filter((d) => assumedFor(d.label) === undefined);

  if (assumed.length > 0) {
    console.log(`\ndivergences assumees : ${assumed.length}`);
    for (const [at, why] of ASSUMED) {
      const hits = assumed.filter((d) => d.label.startsWith(at));
      if (hits.length > 0) console.log(`  ${at} (${hits.length}) : ${why}`);
    }
  }
  for (const [at] of ASSUMED) {
    if (!assumed.some((d) => d.label.startsWith(at))) console.log(`allowance perimee, ce cas ne diverge plus : ${at}`);
  }

  const byFamily = new Map<string, number>();
  for (const d of divergences) byFamily.set(d.family, (byFamily.get(d.family) ?? 0) + 1);
  console.log(`\nsonde : ${checked - divergences.length}/${checked} identiques`);
  if (divergences.length === 0) return;
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const [family, count] of [...byFamily].sort()) console.log(`  ${family} : ${count}`);
  console.log("");
  for (const [index, d] of divergences.entries()) {
    const stem = path.join(REPORT_DIR, `${String(index).padStart(3, "0")}-${d.family}-${d.label.replace(/[^\w.@-]/g, "_")}`);
    fs.writeFileSync(`${stem}.source`, d.source);
    fs.writeFileSync(`${stem}.expected`, d.expected);
    fs.writeFileSync(`${stem}.got`, d.got);
  }
  console.log(`paires ecrites dans ${REPORT_DIR}`);
  for (const d of divergences.slice(0, 40)) console.log(`  ${d.family}  ${d.label}`);
  if (divergences.length > 40) console.log(`  ... et ${divergences.length - 40} de plus`);
}

familyA();
const probes = [
  ...familyB(),
  ...familyC(),
  ...handwritten("D-numeric", NUMERIC),
  ...handwritten("E-unicode", UNICODE),
  ...handwritten("F-known-reference-bugs", KNOWN),
];
console.log(`sonde : ${probes.length} rendus contre la reference vivante, ${CONCURRENCY} en parallele`);
await run(probes);
report();
process.exit(divergences.length === 0 ? 0 : 1);
