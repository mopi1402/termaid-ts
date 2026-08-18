// Le rayon EXACT des trois causes trouvées par probe.ts, pour qu'un correctif soit mesuré et pas deviné.
//
//   G : les 5 codes de contrôle que Rich retire dans `Text.__init__` (control.py:15, BEL BS VT FF CR)
//   H : les 6 points de code où « espace » ne veut pas dire la même chose en Python et en JS
//   I : la tabulation selon sa colonne, puisque Rich l'aligne sur un multiple de 8 (text.py:845)

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { printToConsole, render, renderThemedText, type Options } from "../src/index.js";
import { REFERENCE_COMMAND, referenceArgs } from "./reference.js";

const REPORT_DIR = path.join(os.tmpdir(), "termaid-probe2");
const CONCURRENCY = Math.max(2, os.cpus().length - 2);
const NL = "\n";

/** Ce que Rich retire d'un `Text`, par point de code. */
const RICH_STRIPPED: ReadonlyArray<readonly [string, number]> = [
  ["bel", 0x07], ["backspace", 0x08], ["vtab", 0x0b], ["formfeed", 0x0c], ["cr", 0x0d],
];
/** Les voisins immédiats, qui eux ne sont PAS retirés : la frontière compte autant que le lot. */
const RICH_KEPT: ReadonlyArray<readonly [string, number]> = [
  ["nul", 0x00], ["ack", 0x06], ["so", 0x0e], ["esc", 0x1b], ["del", 0x7f],
];
/** Là où `str.isspace()` et `/\s/` ne disent pas la même chose. */
const WHITESPACE_SPLIT: ReadonlyArray<readonly [string, number]> = [
  ["fs", 0x1c], ["gs", 0x1d], ["rs", 0x1e], ["us", 0x1f], ["nel", 0x85], ["bom", 0xfeff],
];

interface Probe { family: string; label: string; source: string; width: number; theme: string | null }

const both = (family: string, label: string, source: string): Probe[] => [
  { family, label: `${label}@80`, source, width: 80, theme: null },
  { family, label: `${label}@80.neon`, source, width: 80, theme: "neon" },
];

const G: Probe[] = [...RICH_STRIPPED, ...RICH_KEPT].flatMap(([name, cp]) => [
  ...both("G-control", `${name}-in-label`, `graph LR\n  A[a${String.fromCodePoint(cp)}b] --> B[c]\n`),
  ...both("G-control", `${name}-in-id`, `graph LR\n  A${String.fromCodePoint(cp)}X --> B\n`),
]);

const H: Probe[] = WHITESPACE_SPLIT.flatMap(([name, cp]) => {
  const c = String.fromCodePoint(cp);
  return [
    ...both("H-whitespace", `${name}-leading`, `${c}graph LR\n  A --> B\n`),
    ...both("H-whitespace", `${name}-trailing`, `graph LR\n  A --> B\n${c}`),
    ...both("H-whitespace", `${name}-in-label`, `graph LR\n  A[a${c}b] --> B\n`),
  ];
});

// Une tabulation posée à des colonnes différentes : Rich remplit jusqu'au prochain multiple de 8, donc le nombre
// d'espaces DÉPEND de la position, et un correctif qui poserait une constante se ferait prendre ici.
const I: Probe[] = [0, 1, 2, 3, 6, 7, 8, 9, 15, 16].flatMap((pad) =>
  both("I-tab-column", `tab-after-${pad}`, `graph LR\n  A[${"x".repeat(pad)}\tz] --> B[c]\n`)
);

const probes = [...G, ...H, ...I];

interface Divergence { family: string; label: string; source: string; expected: string; got: string }
let divergences: Divergence[] = [];
let checked = 0;

function spawned(argv: readonly string[], input: string, colour: boolean): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env = colour ? { ...process.env, FORCE_COLOR: "1" } : process.env;
    const child = execFile(REFERENCE_COMMAND, referenceArgs(argv), { encoding: "utf8", env, maxBuffer: Number.MAX_SAFE_INTEGER },
      (_e, stdout, stderr) => resolve({ stdout, stderr }));
    child.stdin?.end(input);
  });
}

function portDraw(p: Probe): string {
  try {
    const options: Options = { width: p.width };
    if (p.theme === null) return render(p.source, options) + NL;
    return printToConsole(renderThemedText(p.source, options, p.theme));
  } catch (e) {
    return `THROWN: ${(e as Error).message}`;
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = next++;
      if (index >= probes.length) return;
      const p = probes[index] as Probe;
      const argv = ["--width", String(p.width), ...(p.theme === null ? [] : ["--theme", p.theme])];
      const { stdout, stderr } = await spawned(argv, p.source, p.theme !== null);
      const expected = stderr.length > 0 && stdout.length === 0 ? `<refus>\n${stderr}` : stdout;
      const got = portDraw(p);
      checked++;
      if (got !== expected) divergences.push({ family: p.family, label: p.label, source: p.source, expected, got });
    }
  })
);

// Là où le port diverge EXPRÈS. Chaque harnais nomme SES cas, sinon une allowance périmée ne se voit nulle part.
const ASSUMED: ReadonlyArray<readonly [string, string]> = [
  ["bom-leading", "un BOM en tête est retiré avant la lecture de l'entête, quand la référence le garde et perd le diagramme (◉ 0.8.0)"],
];
const assumedFor = (label: string): string | undefined => ASSUMED.find(([at]) => label.startsWith(at))?.[1];

const assumed = divergences.filter((d) => assumedFor(d.label) !== undefined);
divergences = divergences.filter((d) => assumedFor(d.label) === undefined);
if (assumed.length > 0) {
  console.log(`divergences assumees : ${assumed.length}`);
  for (const [at, why] of ASSUMED) {
    const hits = assumed.filter((d) => d.label.startsWith(at));
    if (hits.length > 0) console.log(`  ${at} (${hits.length}) : ${why}`);
  }
}
for (const [at] of ASSUMED) {
  if (!assumed.some((d) => d.label.startsWith(at))) console.log(`allowance perimee, ce cas ne diverge plus : ${at}`);
}

const byFamily = new Map<string, string[]>();
for (const d of divergences) byFamily.set(d.family, [...(byFamily.get(d.family) ?? []), d.label]);
console.log(`sonde2 : ${checked - divergences.length}/${checked} identiques`);
for (const [family, labels] of [...byFamily].sort()) console.log(`  ${family} : ${labels.length}\n    ${labels.join("\n    ")}`);
if (divergences.length > 0) {
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  for (const [i, d] of divergences.entries()) {
    const stem = path.join(REPORT_DIR, `${String(i).padStart(3, "0")}-${d.label.replace(/[^\w.@-]/g, "_")}`);
    fs.writeFileSync(`${stem}.source`, d.source);
    fs.writeFileSync(`${stem}.expected`, d.expected);
    fs.writeFileSync(`${stem}.got`, d.got);
  }
  console.log(`\npaires dans ${REPORT_DIR}`);
}
