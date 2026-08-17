// Ported from src/termaid/parser/gitgraph.py.

import { MAIN_BRANCH, makeGitGraph, type Commit, type CommitType, type GitGraph } from "../model/gitgraph.js";
import { pyRepr as repr, pyStrip, stripChars } from "../pycompat.js";

const COMMENT = "%%";
const DIRECTIVE = "%%{";
const HEADER = "gitGraph";
const DIRECTION_RE = /^(LR|TB|BT)\s*:?/i;
const INIT_RE = /%%\{init:\s*(\{[\s\S]*\})\s*\}%%/;

const COMMIT = "commit";
const BRANCH = "branch ";
const CHECKOUT = "checkout ";
const SWITCH = "switch ";
const MERGE = "merge ";
const CHERRY_PICK = "cherry-pick";
const RESET = "reset ";

const ID_RE = /id:\s*"([^"]*)"/;
const TYPE_RE = /type:\s*(NORMAL|REVERSE|HIGHLIGHT)/;
const TAG_RE = /tag:\s*"([^"]*)"/;
const BRANCH_RE = /^branch\s+"?([^"]+?)"?\s*(?:order:\s*(\d+))?\s*$/;
const MERGE_RE = /^merge\s+"?([^"]+?)"?(?:\s|$)/;
const RESET_RE = /^reset\s+"?([^"~]+?)"?\s*(?:~(\d+))?\s*$/;

const QUOTE = '"';
const CHERRY_SUFFIX = "-cherry";
/** What is appended again and again until a cherry-pick's id is one nothing else has taken. */
const CHERRY_RETRY = "-cp";
const NO_ORDER = -1;
const DEFAULT_TYPE: CommitType = "NORMAL";

/** A mermaid gitGraph definition. */
export function parseGitGraph(text: string): GitGraph {
  return new GitGraphParser(text).parse();
}

class GitGraphParser {
  private diagram = makeGitGraph();
  private currentBranch = MAIN_BRANCH;
  private heads = new Map<string, string>();
  private autoId = 0;
  private byId = new Map<string, Commit>();
  private branchNames = new Set<string>();
  private seq = 0;

  constructor(private text: string) {}

  parse(): GitGraph {
    const lines = this.preprocess(this.text);
    if (lines.length === 0) return this.diagram;

    const remaining: string[] = [];
    for (const line of lines) {
      if (line.startsWith("%%{init")) this.parseInit(line);
      else remaining.push(line);
    }
    if (remaining.length === 0) return this.diagram;

    const header = remaining[0] as string;
    let body = remaining;
    if (header.startsWith(HEADER)) {
      const direction = DIRECTION_RE.exec(pyStrip(header.slice(HEADER.length)));
      if (direction !== null) this.diagram.direction = (direction[1] as string).toUpperCase();
      body = remaining.slice(1);
    }

    this.currentBranch = this.diagram.mainBranchName;
    this.ensureBranch(this.currentBranch);
    for (const line of body) this.parseLine(line);
    return this.diagram;
  }

  /** The lines that carry something. A comment goes, except the init directive, which is read below. */
  private preprocess(text: string): string[] {
    const result: string[] = [];
    for (const line of text.split("\n")) {
      const stripped = pyStrip(line);
      if (stripped.startsWith(COMMENT) && !stripped.startsWith(DIRECTIVE)) continue;
      if (stripped !== "") result.push(stripped);
    }
    return result;
  }

  private parseInit(line: string): void {
    const directive = INIT_RE.exec(line);
    if (directive === null) return;
    const written = directive[1] as string;

    let config: unknown;
    try {
      config = JSON.parse(written);
    } catch {
      // A directive written with single quotes is still readable, and mermaid authors write them.
      try {
        config = JSON.parse(written.replaceAll("'", QUOTE));
      } catch {
        return;
      }
    }

    if (typeof config !== "object" || config === null) return;
    const record = config as Record<string, unknown>;
    const git = (record[HEADER] ?? record) as Record<string, unknown>;
    if (typeof git === "object" && git !== null && typeof git["mainBranchName"] === "string") {
      this.diagram.mainBranchName = git["mainBranchName"];
    }
  }

  private parseLine(line: string): void {
    if (line.startsWith(COMMIT)) return this.parseCommit(line);
    if (line.startsWith(BRANCH)) return this.parseBranch(line);

    if (line.startsWith(CHECKOUT) || line.startsWith(SWITCH)) {
      const rest = pyStrip(line.slice(line.search(/\s/)));
      if (rest !== "") {
        const name = stripChars(pyStrip(rest), QUOTE);
        if (this.branchNames.has(name)) this.currentBranch = name;
        else this.diagram.warnings.push(`Checkout non-existent branch: ${repr(name)}`);
      }
      return;
    }

    if (line.startsWith(MERGE)) return this.parseMerge(line);
    if (line.startsWith(CHERRY_PICK)) return this.parseCherryPick(line);
    if (line.startsWith(RESET)) return this.parseReset(line);

    this.diagram.warnings.push(`Unrecognized line: ${repr(line)}`);
  }

  /** The attributes a commit line may carry, in any order: its id, its type, its tag. */
  private attributes(line: string): { id: string | null; type: CommitType; tag: string } {
    const id = ID_RE.exec(line);
    const type = TYPE_RE.exec(line);
    const tag = TAG_RE.exec(line);
    return {
      id: id === null ? null : (id[1] as string),
      type: type === null ? DEFAULT_TYPE : ((type[1] as string) as CommitType),
      tag: tag === null ? "" : (tag[1] as string),
    };
  }

  /** One commit, on the branch checked out, its parent being whatever that branch pointed at. */
  private record(id: string, type: CommitType, tag: string, parents: string[]): void {
    const commit: Commit = { id, branch: this.currentBranch, type, tag, parents, seq: this.seq };
    this.seq += 1;
    this.diagram.commits.push(commit);
    this.byId.set(id, commit);
    this.heads.set(this.currentBranch, id);
  }

  private nextId(): string {
    const id = String(this.autoId);
    this.autoId += 1;
    return id;
  }

  private parentsOfHead(): string[] {
    const head = this.heads.get(this.currentBranch);
    return head === undefined ? [] : [head];
  }

  private parseCommit(line: string): void {
    const { id, type, tag } = this.attributes(line);
    this.record(id ?? this.nextId(), type, tag, this.parentsOfHead());
  }

  private parseBranch(line: string): void {
    const branch = BRANCH_RE.exec(line);
    if (branch === null) return;
    const name = pyStrip((branch[1] as string));
    const order = branch[2] === undefined ? NO_ORDER : Number.parseInt(branch[2], 10);

    this.ensureBranch(name, order, this.heads.get(this.currentBranch) ?? "");

    // The new branch forks from where the old one stands, so it starts on the same commit.
    const head = this.heads.get(this.currentBranch);
    if (head !== undefined) this.heads.set(name, head);
    this.currentBranch = name;
  }

  private parseMerge(line: string): void {
    const merge = MERGE_RE.exec(line);
    if (merge === null) return;
    const merged = pyStrip((merge[1] as string));

    const { id, type, tag } = this.attributes(line);
    const parents = this.parentsOfHead();
    const other = this.heads.get(merged);
    if (other !== undefined) parents.push(other);

    this.record(id ?? this.nextId(), type, tag, parents);
  }

  private parseCherryPick(line: string): void {
    const source = ID_RE.exec(line);
    if (source === null) return;
    const sourceId = source[1] as string;

    if (!this.byId.has(sourceId)) {
      this.diagram.warnings.push(`Cherry-pick non-existent commit: ${repr(sourceId)}`);
      return;
    }

    let id = `${sourceId}${CHERRY_SUFFIX}`;
    while (this.byId.has(id)) id += CHERRY_RETRY;

    const tag = TAG_RE.exec(line);
    const parents = this.parentsOfHead();
    parents.push(sourceId);
    this.record(id, DEFAULT_TYPE, tag === null ? "" : (tag[1] as string), parents);
  }

  /** `reset <ref>[~N]`, which moves the branch's head back rather than adding anything. */
  private parseReset(line: string): void {
    const reset = RESET_RE.exec(line);
    if (reset === null) return;
    const ref = pyStrip((reset[1] as string));
    const back = reset[2] === undefined ? 0 : Number.parseInt(reset[2], 10);

    let id = this.heads.get(ref);
    if (id === undefined) {
      if (!this.byId.has(ref)) {
        this.diagram.warnings.push(`Reset to unknown ref: ${repr(ref)}`);
        return;
      }
      id = ref;
    }

    for (let i = 0; i < back; i++) {
      const commit = this.byId.get(id as string);
      const parent = commit?.parents[0];
      if (parent === undefined) {
        this.diagram.warnings.push(`Cannot walk back ${back} ancestors from ${repr(ref)}`);
        return;
      }
      id = parent;
    }

    this.heads.set(this.currentBranch, id as string);
  }

  private ensureBranch(name: string, order: number = NO_ORDER, startCommit = ""): void {
    if (this.branchNames.has(name)) return;
    this.branchNames.add(name);
    this.diagram.branches.push({ name, order, startCommit });
  }
}
