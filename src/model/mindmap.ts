// Ported from src/termaid/model/mindmap.py.

export interface MindmapNode {
  label: string;
  children: MindmapNode[];
}

export interface Mindmap {
  root: MindmapNode | null;
  warnings: string[];
}

export const makeMindmap = (): Mindmap => ({ root: null, warnings: [] });
export const makeMindmapNode = (label: string, children: MindmapNode[] = []): MindmapNode => ({ label, children });
