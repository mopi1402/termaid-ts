// Ported from src/termaid/model/kanban.py.

export interface KanbanCard {
  title: string;
  /** A tag or an assignee, written after an `@` on the card's line. */
  metadata: string;
}

export interface KanbanColumn {
  title: string;
  cards: KanbanCard[];
}

export interface Kanban {
  title: string;
  columns: KanbanColumn[];
  warnings: string[];
}

export const makeKanban = (): Kanban => ({ title: "", columns: [], warnings: [] });
export const makeKanbanColumn = (title: string): KanbanColumn => ({ title, cards: [] });
