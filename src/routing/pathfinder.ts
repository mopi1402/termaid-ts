// Ported from src/termaid/routing/pathfinder.py.
//
// A* over the grid: four directions, Manhattan distance with a corner penalty, and an already-routed edge as a SOFT
// obstacle rather than a wall.
//
// The heap below is CPython's `heapq`, sift for sift. Two nodes of equal cost are separated by nothing but the heap's
// own shape, so any other heap would pick another path of the same length and draw another picture.

/** Up, down, left, right. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** What a step costs, what crossing another edge adds, and what turning adds. */
const STEP_COST = 1;
const SOFT_PENALTY = 2;
const CORNER_PENALTY = 0.5;
/** The corner penalty the heuristic adds where start and end are not on one axis. */
const HEURISTIC_CORNER = 1;
const MAX_ITERATIONS = 5000;

export type Cell = readonly [number, number];
export const cellId = (col: number, row: number): string => `${col},${row}`;

interface AStarNode {
  fCost: number;
  gCost: number;
  col: number;
  row: number;
  parent: AStarNode | null;
}

const less = (a: AStarNode, b: AStarNode): boolean => a.fCost < b.fCost;

/** CPython's `heapq._siftdown`. */
function siftDown(heap: AStarNode[], startPos: number, pos: number): void {
  const newItem = heap[pos] as AStarNode;
  while (pos > startPos) {
    const parentPos = (pos - 1) >> 1;
    const parent = heap[parentPos] as AStarNode;
    if (!less(newItem, parent)) break;
    heap[pos] = parent;
    pos = parentPos;
  }
  heap[pos] = newItem;
}

/** CPython's `heapq._siftup`: the smaller child rises all the way, then the item sinks back down. */
function siftUp(heap: AStarNode[], pos: number): void {
  const endPos = heap.length;
  const startPos = pos;
  const newItem = heap[pos] as AStarNode;
  let childPos = 2 * pos + 1;
  while (childPos < endPos) {
    const rightPos = childPos + 1;
    if (rightPos < endPos && !less(heap[childPos] as AStarNode, heap[rightPos] as AStarNode)) childPos = rightPos;
    heap[pos] = heap[childPos] as AStarNode;
    pos = childPos;
    childPos = 2 * pos + 1;
  }
  heap[pos] = newItem;
  siftDown(heap, startPos, pos);
}

function heapPush(heap: AStarNode[], item: AStarNode): void {
  heap.push(item);
  siftDown(heap, 0, heap.length - 1);
}

function heapPop(heap: AStarNode[]): AStarNode {
  const last = heap.pop() as AStarNode;
  if (heap.length === 0) return last;
  const top = heap[0] as AStarNode;
  heap[0] = last;
  siftUp(heap, 0);
  return top;
}

/** Manhattan distance, plus one where the two points do not share an axis. */
export function heuristic(c1: number, r1: number, c2: number, r2: number): number {
  const dx = Math.abs(c1 - c2);
  const dy = Math.abs(r1 - r2);
  return dx === 0 || dy === 0 ? dx + dy : dx + dy + HEURISTIC_CORNER;
}

function reconstruct(node: AStarNode): Cell[] {
  const path: Cell[] = [];
  let current: AStarNode | null = node;
  while (current !== null) {
    path.push([current.col, current.row]);
    current = current.parent;
  }
  path.reverse();
  return path;
}

/** Every cell from start to end, or null where nothing gets through. The two endpoints are walkable whatever holds them. */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  isFree: (col: number, row: number) => boolean,
  softObstacles: ReadonlySet<string> = new Set(),
  maxIterations: number = MAX_ITERATIONS
): Cell[] | null {
  if (startCol === endCol && startRow === endRow) return [[startCol, startRow]];

  const start: AStarNode = {
    fCost: heuristic(startCol, startRow, endCol, endRow),
    gCost: 0,
    col: startCol,
    row: startRow,
    parent: null,
  };

  const open: AStarNode[] = [start];
  const closed = new Set<string>();
  const bestG = new Map<string, number>([[cellId(startCol, startRow), 0]]);

  for (let iterations = 0; open.length > 0 && iterations < maxIterations; iterations++) {
    const current = heapPop(open);
    if (current.col === endCol && current.row === endRow) return reconstruct(current);

    const key = cellId(current.col, current.row);
    if (closed.has(key)) continue;
    closed.add(key);

    for (const [dc, dr] of DIRS) {
      const col = current.col + dc;
      const row = current.row + dr;
      const next = cellId(col, row);
      if (closed.has(next)) continue;

      const isEndpoint = col === endCol && row === endRow;
      if (!isEndpoint && !isFree(col, row)) continue;

      let stepCost = STEP_COST;
      if (softObstacles.has(next)) stepCost += SOFT_PENALTY;
      if (current.parent !== null) {
        const prevDc = current.col - current.parent.col;
        const prevDr = current.row - current.parent.row;
        if (dc !== prevDc || dr !== prevDr) stepCost += CORNER_PENALTY;
      }

      const g = current.gCost + stepCost;
      const known = bestG.get(next);
      if (known !== undefined && known <= g) continue;
      bestG.set(next, g);

      heapPush(open, { fCost: g + heuristic(col, row, endCol, endRow), gCost: g, col, row, parent: current });
    }
  }

  return null;
}

/** The same path with its straight runs collapsed: only the corners are kept. */
export function simplifyPath(path: Cell[]): Cell[] {
  if (path.length <= 2) return path;
  const result: Cell[] = [path[0] as Cell];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1] as Cell;
    const current = path[i] as Cell;
    const next = path[i + 1] as Cell;
    const turned = current[0] - prev[0] !== next[0] - current[0] || current[1] - prev[1] !== next[1] - current[1];
    if (turned) result.push(current);
  }
  result.push(path[path.length - 1] as Cell);
  return result;
}
