// L'audit elargi : plusieurs sources par type, une par FAMILLE DE FORMES que le type sait dessiner, et deux verdicts
// qui ne demandent aucune reference.
//
//   ABSENT   le jeton n'est nulle part dans le dessin
//   COUPE    un prefixe du jeton est la, sans points de suspension : la coupe est SILENCIEUSE, et c'est la pire
//            des deux, puisque le lecteur croit lire un libelle entier
//
// Le rendu est fait large, pour que la compaction ne puisse jamais expliquer un manque.

import { render } from "../src/index.js";

const ELLIPSIS = "…";
const WIDE = 200;
const MIN_PREFIX = 3;

interface Subject {
  type: string;
  shape: string;
  source: string;
  expect: readonly string[];
}

/** Les libelles sont rares a dessein : une presence dans la sortie est alors la bonne, jamais une coincidence. */
const S = ["Zephyr", "Kraken", "Basalt", "Nimbus", "Cobalt", "Quartz", "Obsidian", "Granite", "Marble", "Feldspar"];
const [Z, K, B, N, C, Q, O, G, M, F] = S as [string, string, string, string, string, string, string, string, string, string];

const SUBJECTS: readonly Subject[] = [
  // ---------------------------------------------------------------- flowchart
  { type: "flowchart", shape: "toutes les formes de noeud", expect: [Z, K, B, N, C, Q, O, G],
    source: `flowchart LR\n  a[${Z}] --> b(${K}) --> c([${B}]) --> d[[${N}]]\n  d --> e[(${C})] --> f((${Q})) --> g{${O}} --> h{{${G}}}\n` },
  { type: "flowchart", shape: "etiquettes d'arete", expect: [Z, K, B, N, C],
    source: `flowchart LR\n  ${Z} -->|${K}| ${B}\n  ${B} -.->|${N}| ${C}\n` },
  { type: "flowchart", shape: "sous-graphes imbriques", expect: [Z, K, B, N, C],
    source: `flowchart TD\n  subgraph ${Z}\n    subgraph ${K}\n      ${B} --> ${N}\n    end\n  end\n  ${N} --> ${C}\n` },
  { type: "flowchart", shape: "styles et classes", expect: [Z, K],
    source: `flowchart LR\n  ${Z} --> ${K}\n  classDef hot fill:#f00\n  class ${Z} hot\n` },

  // ---------------------------------------------------------------- state
  { type: "state", shape: "etats composites", expect: [Z, K, B, N],
    source: `stateDiagram-v2\n  [*] --> ${Z}\n  state ${Z} {\n    ${K} --> ${B} : ${N}\n  }\n  ${Z} --> [*]\n` },
  { type: "state", shape: "deux transitions entre les memes etats", expect: [Z, K, B, N, C],
    source: `stateDiagram-v2\n  [*] --> ${Z}\n  state ${Z} {\n    ${K} --> ${B} : ${N}\n    ${B} --> ${K} : ${C}\n  }\n` },
  { type: "state", shape: "notes et alias", expect: [Z, K, B],
    source: `stateDiagram-v2\n  state "${Z}" as s1\n  s1 --> ${K}\n  note right of ${K} : ${B}\n` },
  { type: "state", shape: "choix et fourche", expect: [Z, K, B],
    source: `stateDiagram-v2\n  state ${Z} <<choice>>\n  ${K} --> ${Z}\n  ${Z} --> ${B}\n` },

  // ---------------------------------------------------------------- sequence
  { type: "sequence", shape: "notes des trois cotes", expect: [Z, K, B, N, C],
    source: `sequenceDiagram\n  participant ${Z}\n  participant ${K}\n  Note left of ${Z}: ${B}\n  Note over ${Z},${K}: ${N}\n  Note right of ${K}: ${C}\n` },
  { type: "sequence", shape: "blocs loop, alt et opt", expect: [Z, K, B, N, C, Q],
    source: `sequenceDiagram\n  ${Z}->>${K}: ${B}\n  loop ${N}\n    ${K}->>${Z}: ${C}\n  end\n  alt ${Q}\n    ${Z}->>${K}: ok\n  end\n` },
  { type: "sequence", shape: "activation et destruction", expect: [Z, K, B, N],
    source: `sequenceDiagram\n  ${Z}->>+${K}: ${B}\n  ${K}-->>-${Z}: ${N}\n  destroy ${K}\n` },

  // ---------------------------------------------------------------- class
  { type: "class", shape: "membres et visibilites", expect: [Z, K, B, N],
    source: `classDiagram\n  class ${Z} {\n    +String ${K}\n    -int ${B}\n    #${N}() void\n  }\n` },
  { type: "class", shape: "cardinalites et relations", expect: [Z, K, B],
    source: `classDiagram\n  ${Z} "1" --> "*" ${K} : ${B}\n` },
  { type: "class", shape: "annotations", expect: [Z, K],
    source: `classDiagram\n  class ${Z} {\n    <<${K}>>\n  }\n` },

  // ---------------------------------------------------------------- er
  { type: "er", shape: "attributs, cles et commentaire", expect: [Z, K, B, N, C],
    source: `erDiagram\n  ${Z} {\n    string ${K} PK\n    string ${B} UK "${N}"\n    int ${C}\n  }\n` },
  { type: "er", shape: "cardinalites", expect: [Z, K, B],
    source: `erDiagram\n  ${Z} ||--o{ ${K} : ${B}\n` },

  // ---------------------------------------------------------------- gantt
  { type: "gantt", shape: "sections et etats de tache", expect: [Z, K, B, N, C],
    source: `gantt\n  title ${Z}\n  dateFormat YYYY-MM-DD\n  section ${K}\n    ${B} :done, t1, 2024-01-01, 2024-01-14\n    ${N} :active, t2, 2024-01-08, 2024-01-21\n  section ${C}\n    autre :t3, 2024-01-15, 5d\n` },
  { type: "gantt", shape: "jalon et dependance", expect: [Z, K, B],
    source: `gantt\n  title ${Z}\n  dateFormat YYYY-MM-DD\n  section s\n    ${K} :t1, 2024-01-01, 5d\n    ${B} :milestone, t2, after t1, 1d\n` },

  // ---------------------------------------------------------------- gitgraph
  { type: "gitgraph", shape: "branches, tags et fusion", expect: [Z, K, B, N, C],
    source: `gitGraph\n  commit id: "${Z}"\n  commit id: "${K}" tag: "${B}"\n  branch ${N}\n  commit id: "${C}"\n  checkout main\n  merge ${N}\n` },
  { type: "gitgraph", shape: "types de commit", expect: [Z, K, B],
    source: `gitGraph\n  commit id: "${Z}" type: HIGHLIGHT\n  commit id: "${K}" type: REVERSE\n  commit id: "${B}"\n` },

  // ---------------------------------------------------------------- journey
  { type: "journey", shape: "sections, notes et acteurs", expect: [Z, K, B, N, C],
    source: `journey\n  title ${Z}\n  section ${K}\n    ${B}: 5: ${N}\n    ${C}: 3: ${N}\n` },

  // ---------------------------------------------------------------- kanban
  { type: "kanban", shape: "colonnes, cartes et assignation", expect: [Z, K, B, N],
    source: `kanban\n  col1[${Z}]\n    t1[${K}]\n    t2[${B}] @${N}\n` },

  // ---------------------------------------------------------------- mindmap
  { type: "mindmap", shape: "profondeur", expect: [Z, K, B, N],
    source: `mindmap\n  ${Z}\n    ${K}\n      ${B}\n        ${N}\n` },
  { type: "mindmap", shape: "formes de noeud", expect: [Z, K, B],
    source: `mindmap\n  ${Z}\n    [${K}]\n    {{${B}}}\n` },

  // ---------------------------------------------------------------- packet
  { type: "packet", shape: "champs contigus", expect: [Z, K, B],
    source: `packet-beta\n  0-15: "${Z}"\n  16-31: "${K}"\n  32-63: "${B}"\n` },

  // ---------------------------------------------------------------- pie
  { type: "pie", shape: "titre et valeurs", expect: [Z, K, B, N],
    source: `pie showData\n  title ${Z}\n  "${K}" : 45\n  "${B}" : 30\n  "${N}" : 25\n` },

  // ---------------------------------------------------------------- quadrant
  { type: "quadrant", shape: "axes, quadrants et points", expect: [Z, K, B, N, C, Q, O, G, M, F],
    source: `quadrantChart\n  title ${Z}\n  x-axis ${K} --> ${B}\n  y-axis ${N} --> ${C}\n  quadrant-1 ${Q}\n  quadrant-2 ${O}\n  quadrant-3 ${G}\n  quadrant-4 ${M}\n  ${F}: [0.8, 0.9]\n` },

  // ---------------------------------------------------------------- timeline
  { type: "timeline", shape: "sections et evenements multiples", expect: [Z, K, B, N, C, Q],
    source: `timeline\n  title ${Z}\n  section ${K}\n    ${B} : ${N}, ${C}\n  section ${Q}\n    seul\n` },

  // ---------------------------------------------------------------- treemap
  { type: "treemap", shape: "imbrication et valeurs", expect: [Z, K, B, N, C],
    source: `treemap-beta\n"${Z}"\n  "${K}": 40\n  "${B}": 25\n  "${N}"\n    "${C}": 15\n` },

  // ---------------------------------------------------------------- xychart
  { type: "xychart", shape: "titre, deux axes, barres", expect: [Z, K, B, N, C, Q],
    source: `xychart-beta\n  title "${Z}"\n  x-axis "${K}" [${B}, ${N}, ${C}]\n  y-axis "${Q}" 0 --> 50\n  bar [10, 25, 40]\n` },
  { type: "xychart", shape: "courbe", expect: [Z, K, B],
    source: `xychart-beta\n  title "${Z}"\n  x-axis [${K}, ${B}]\n  line [5, 15]\n` },

  // ---------------------------------------------------------------- architecture
  { type: "architecture", shape: "groupes, services et jonctions", expect: [Z, K, B, N],
    source: `architecture-beta\n  group g1(cloud)[${Z}]\n  service s1(database)[${K}] in g1\n  service s2(server)[${B}] in g1\n  service s3(internet)[${N}]\n  s1:R --> L:s2\n  s2:R --> L:s3\n` },

  // ---------------------------------------------------------------- block
  { type: "block", shape: "toutes les formes", expect: [Z, K, B, N, C, Q],
    source: `block-beta\n  columns 3\n  a["${Z}"] b("${K}") c(["${B}"])\n  d{"${N}"} e(("${C}")) f{{"${Q}"}}\n` },
  { type: "block", shape: "fleches et espaces", expect: [Z, K],
    source: `block-beta\n  columns 3\n  a["${Z}"] space b["${K}"]\n  a --> b\n` },
];

/** Le plus long prefixe du jeton qu'on retrouve dans le dessin, ou la chaine vide. */
function longestPrefix(drawn: string, token: string): string {
  for (let n = token.length - 1; n >= MIN_PREFIX; n--) {
    const prefix = token.slice(0, n);
    if (drawn.includes(prefix)) return prefix;
  }
  return "";
}

interface Finding {
  type: string;
  shape: string;
  token: string;
  verdict: "ABSENT" | "COUPE";
  detail: string;
}

const findings: Finding[] = [];
let tokens = 0;

for (const subject of SUBJECTS) {
  let drawn: string;
  try {
    drawn = render(subject.source, { width: WIDE });
  } catch (e) {
    findings.push({ type: subject.type, shape: subject.shape, token: "-", verdict: "ABSENT", detail: `LEVE : ${(e as Error).message}` });
    continue;
  }
  for (const token of subject.expect) {
    tokens++;
    if (drawn.includes(token)) continue;
    const prefix = longestPrefix(drawn, token);
    if (prefix === "" ) {
      findings.push({ type: subject.type, shape: subject.shape, token, verdict: "ABSENT", detail: "nulle part dans le dessin" });
    } else {
      const marked = drawn.includes(prefix + ELLIPSIS);
      findings.push({
        type: subject.type,
        shape: subject.shape,
        token,
        verdict: marked ? "ABSENT" : "COUPE",
        detail: marked ? `tronque et signale : ${prefix}${ELLIPSIS}` : `coupe SANS signal : ${prefix}`,
      });
    }
  }
}

const byType = new Map<string, Finding[]>();
for (const f of findings) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);

console.log(`${SUBJECTS.length} sources, ${tokens} jetons verifies\n`);
for (const subject of [...new Set(SUBJECTS.map((s) => s.type))]) {
  const hits = byType.get(subject) ?? [];
  console.log(`${subject.padEnd(14)} ${hits.length === 0 ? "complet" : `${hits.length} manque(s)`}`);
  for (const f of hits) console.log(`    ${f.verdict.padEnd(7)} ${f.token.padEnd(9)} ${f.detail}   [${f.shape}]`);
}
const cut = findings.filter((f) => f.verdict === "COUPE").length;
console.log(`\n${findings.length} manques sur ${tokens} jetons, dont ${cut} coupes SANS signal`);
