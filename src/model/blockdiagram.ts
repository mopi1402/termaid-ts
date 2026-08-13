// Ported from src/termaid/model/blockdiagram.py.

export interface Block {
  id: string;
  label: string;
  shape: string;
  colSpan: number;
  /** A hole in the grid: it takes a cell and draws nothing. */
  isSpace: boolean;
  children: Block[];
  /** How many columns a nested group lays its own children out in, 0 meaning as many as they span. */
  columns: number;
}

export interface BlockLink {
  source: string;
  target: string;
  label: string;
}

export interface BlockDiagram {
  blocks: Block[];
  links: BlockLink[];
  /** How many columns the grid holds, 0 meaning as many as the blocks span. */
  columns: number;
  warnings: string[];
}

export const DEFAULT_SHAPE = "rectangle";
export const AUTO_COLUMNS = 0;

export const makeBlock = (id: string, fields: Partial<Block> = {}): Block => ({
  id,
  label: "",
  shape: DEFAULT_SHAPE,
  colSpan: 1,
  isSpace: false,
  children: [],
  columns: AUTO_COLUMNS,
  ...fields,
});

export const makeBlockDiagram = (fields: Partial<BlockDiagram> = {}): BlockDiagram => ({
  blocks: [],
  links: [],
  columns: AUTO_COLUMNS,
  warnings: [],
  ...fields,
});
