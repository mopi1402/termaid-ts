// Ported from src/termaid/model/treemap.py.

export interface TreemapNode {
  label: string;
  value: number;
  children: TreemapNode[];
}

export interface Treemap {
  roots: TreemapNode[];
  warnings: string[];
}

export const makeTreemap = (): Treemap => ({ roots: [], warnings: [] });
export const makeTreemapNode = (label: string, value: number): TreemapNode => ({ label, value, children: [] });

/** What a node is WORTH: its own value where it is a leaf, and what its children add up to where it is not. */
export function totalValue(node: TreemapNode): number {
  if (node.children.length > 0) return node.children.reduce((sum, child) => sum + totalValue(child), 0);
  return node.value;
}

export const treemapTotal = (treemap: Treemap): number =>
  treemap.roots.reduce((sum, root) => sum + totalValue(root), 0);
