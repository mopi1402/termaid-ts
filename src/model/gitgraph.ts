// Ported from src/termaid/model/gitgraph.py.

/** How a commit is marked. */
export type CommitType = "NORMAL" | "REVERSE" | "HIGHLIGHT";

/** The branch a diagram starts on unless an init directive renames it. */
export const MAIN_BRANCH = "main";

export interface Commit {
  id: string;
  branch: string;
  type: CommitType;
  tag: string;
  parents: string[];
  /** Where the commit falls in the order it was written. */
  seq: number;
}

export interface Branch {
  name: string;
  /** Where the author asked for it to sit, or -1 for wherever it first appeared. */
  order: number;
  startCommit: string;
}

export interface GitGraph {
  commits: Commit[];
  branches: Branch[];
  direction: string;
  mainBranchName: string;
  warnings: string[];
}

export const makeGitGraph = (): GitGraph => ({
  commits: [],
  branches: [],
  direction: "LR",
  mainBranchName: MAIN_BRANCH,
  warnings: [],
});
