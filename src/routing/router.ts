// Ported from src/termaid/routing/router.py.
//
// Where an edge leaves a node and where it arrives, the A* run between the two, and the choice between the path that
// follows the flow and the one that cuts across it.

import { Direction, isHorizontal, isSelfReference, normalized, type Edge, type Graph, type Subgraph } from "../graph/model.js";
import { makePlacement, type GridLayout, type NodePlacement, type SubgraphBounds } from "../layout/grid.js";
import { cellId, findPath, simplifyPath, type Cell } from "./pathfinder.js";

export enum AttachDir {
  TOP = "TOP",
  BOTTOM = "BOTTOM",
  LEFT = "LEFT",
  RIGHT = "RIGHT",
}

export interface RoutedEdge {
  edge: Edge;
  /** Grid coordinates, corners only. */
  gridPath: Cell[];
  /** Character coordinates. */
  drawPath: Array<[number, number]>;
  startDir: AttachDir;
  endDir: AttachDir;
  label: string;
  index: number;
  /** The grid cells this path took, which the next edge routed reads as soft obstacles. */
  occupiedCells: Set<string>;
}

/** How much longer the flow-aligned path may be before the crossing one wins. */
const PREFER_BIAS = 3;
/** Room a spread arrival needs between its last turn and the border, or the corner and the arrowhead collide. */
const MIN_APPROACH = 4;
/** The most a spread endpoint moves per edge. */
const MAX_SPREAD_STEP = 2;
/** How far a jog is pushed off a subgraph border so the approach has room. */
const JOG_CLEARANCE = 3;

const same = (a: [number, number], b: [number, number]): boolean => a[0] === b[0] && a[1] === b[1];
const pointKey = (p: [number, number]): string => `${p[0]},${p[1]}`;

/** Every node inside a subgraph, its children included. */
function subgraphMembers(sb: SubgraphBounds, layout: GridLayout): NodePlacement[] {
  const ids = new Set<string>();
  const gather = (sg: Subgraph): void => {
    for (const id of sg.nodeIds) ids.add(id);
    for (const child of sg.children) gather(child);
  };
  gather(sb.subgraph);
  const members: NodePlacement[] = [];
  for (const id of ids) {
    const p = layout.placements.get(id);
    if (p !== undefined) members.push(p);
  }
  return members;
}

/**
 * The two placements an edge runs between. A SUBGRAPH endpoint has none of its own, so one is synthesised: the box is
 * the subgraph's, the grid cell is borrowed from the member closest to the other end.
 */
function resolveEndpoints(
  edge: Edge,
  layout: GridLayout,
  sgBounds: Map<string, SubgraphBounds>
): [NodePlacement | null, NodePlacement | null] {
  if (!edge.sourceIsSubgraph && !edge.targetIsSubgraph) {
    return [layout.placements.get(edge.source) ?? null, layout.placements.get(edge.target) ?? null];
  }

  const candidates = (nodeId: string, isSubgraph: boolean): NodePlacement[] => {
    if (!isSubgraph) {
      const p = layout.placements.get(nodeId);
      return p === undefined ? [] : [p];
    }
    const sb = sgBounds.get(nodeId);
    return sb === undefined ? [] : subgraphMembers(sb, layout);
  };

  const sources = candidates(edge.source, edge.sourceIsSubgraph);
  const targets = candidates(edge.target, edge.targetIsSubgraph);
  if (sources.length === 0 || targets.length === 0) return [null, null];

  const center = (p: NodePlacement): [number, number] => [
    p.drawX + Math.floor(p.drawWidth / 2),
    p.drawY + Math.floor(p.drawHeight / 2),
  ];

  let best: [NodePlacement, NodePlacement] | null = null;
  let bestKey: [number, string, string] | null = null;
  for (const s of sources) {
    for (const t of targets) {
      const [sx, sy] = center(s);
      const [tx, ty] = center(t);
      const key: [number, string, string] = [Math.abs(sx - tx) + Math.abs(sy - ty), s.nodeId, t.nodeId];
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        best = [s, t];
        bestKey = key;
      }
    }
  }
  if (best === null) return [null, null];

  const virtualize = (nodeId: string, isSubgraph: boolean, member: NodePlacement): NodePlacement => {
    if (!isSubgraph) return member;
    const sb = sgBounds.get(nodeId) as SubgraphBounds;
    const p = makePlacement(nodeId, { col: member.grid.col, row: member.grid.row });
    p.drawX = sb.x;
    p.drawY = sb.y;
    p.drawWidth = sb.width;
    p.drawHeight = sb.height;
    return p;
  };

  return [
    virtualize(edge.source, edge.sourceIsSubgraph, best[0]),
    virtualize(edge.target, edge.targetIsSubgraph, best[1]),
  ];
}

/** One end of a path snapped onto a subgraph's border, the part drawn inside the box dropped. */
function clipEndpointToBox(drawPath: Array<[number, number]>, sb: SubgraphBounds, fromStart: boolean): void {
  if (drawPath.length < 2) return;

  const pts = fromStart ? drawPath.slice() : drawPath.slice().reverse();
  const x0 = sb.x;
  const y0 = sb.y;
  const x1 = sb.x + sb.width - 1;
  const y1 = sb.y + sb.height - 1;
  const strictlyInside = (p: [number, number]): boolean => x0 < p[0] && p[0] < x1 && y0 < p[1] && p[1] < y1;

  let k = 0;
  while (k < pts.length && strictlyInside(pts[k] as [number, number])) k++;
  // The path never leaves the box: nothing here can improve on it.
  if (k >= pts.length) return;

  let next: Array<[number, number]>;
  if (k === 0) {
    const [ax, ay] = pts[0] as [number, number];
    const [bx] = pts[1] as [number, number];
    const clamped: [number, number] =
      ax === bx ? [ax, Math.min(Math.max(ay, y0), y1)] : [Math.min(Math.max(ax, x0), x1), ay];
    next = [clamped, ...pts.slice(1)];
  } else {
    const [px, py] = pts[k - 1] as [number, number];
    const [qx, qy] = pts[k] as [number, number];
    const cross: [number, number] = px === qx ? [px, qy > py ? y1 : y0] : [qx > px ? x1 : x0, py];
    next = [cross, ...pts.slice(k)];
  }

  if (next.length >= 2 && same(next[0] as [number, number], next[1] as [number, number])) next = next.slice(1);
  if (next.length < 2) return;

  // A turn sitting right against the border leaves the last segment no room for a line cell and an arrowhead.
  if (next.length >= 4) {
    const [cx, cy] = next[0] as [number, number];
    const [nx, ny] = next[1] as [number, number];
    const [mx, my] = next[2] as [number, number];
    const [px, py] = next[3] as [number, number];
    if (cx === nx && ny === my && Math.abs(cy - ny) < JOG_CLEARANCE) {
      const sign = cy > ny ? 1 : -1;
      const shifted = cy - JOG_CLEARANCE * sign;
      if ((sign > 0 && py < shifted) || (sign < 0 && py > shifted)) {
        next[1] = [nx, shifted];
        next[2] = [mx, shifted];
      }
    } else if (cy === ny && nx === mx && Math.abs(cx - nx) < JOG_CLEARANCE) {
      const sign = cx > nx ? 1 : -1;
      const shifted = cx - JOG_CLEARANCE * sign;
      if ((sign > 0 && px < shifted) || (sign < 0 && px > shifted)) {
        next[1] = [shifted, ny];
        next[2] = [shifted, my];
      }
    }
  }

  drawPath.length = 0;
  drawPath.push(...(fromStart ? next : next.reverse()));
}

/** The grid cells each subgraph box covers, its member blocks and the border channel around them. */
function computeSgRegions(layout: GridLayout, sgBounds: Map<string, SubgraphBounds>): Map<string, Set<string>> {
  const regions = new Map<string, Set<string>>();
  for (const [id, sb] of sgBounds) {
    const members = subgraphMembers(sb, layout);
    if (members.length === 0) continue;
    const cols = members.map((p) => p.grid.col);
    const rows = members.map((p) => p.grid.row);
    const region = new Set<string>();
    for (let c = Math.min(...cols) - 1; c <= Math.max(...cols) + 1; c++) {
      for (let r = Math.min(...rows) - 1; r <= Math.max(...rows) + 1; r++) region.add(cellId(c, r));
    }
    regions.set(id, region);
  }
  return regions;
}

/** Boxes this edge has no business crossing: every subgraph neither of its ends belongs to. */
function foreignSgCells(edge: Edge, graph: Graph, regions: Map<string, Set<string>>): Set<string> {
  const cells = new Set<string>();
  if (regions.size === 0) return cells;

  const allowed = new Set<string>();
  for (const [endpoint, isSubgraph] of [
    [edge.source, edge.sourceIsSubgraph],
    [edge.target, edge.targetIsSubgraph],
  ] as Array<[string, boolean]>) {
    if (isSubgraph) {
      const found = graph.findSubgraphById(endpoint);
      // The subgraph, everything under it and everything around it: a borrowed cell may sit in a nested child box.
      const stack: Subgraph[] = found === null ? [] : [found];
      while (stack.length > 0) {
        const current = stack.pop() as Subgraph;
        allowed.add(current.id);
        stack.push(...current.children);
      }
      let up = found;
      while (up !== null) {
        allowed.add(up.id);
        up = up.parent;
      }
    } else {
      let sg = graph.findSubgraphForNode(endpoint);
      while (sg !== null) {
        allowed.add(sg.id);
        sg = sg.parent;
      }
    }
  }

  for (const [id, region] of regions) {
    if (allowed.has(id)) continue;
    for (const cell of region) cells.add(cell);
  }
  return cells;
}

/** The grid cell an edge attaches to on one side of a node. */
function attachPoint(placement: NodePlacement, dir: AttachDir): Cell {
  const { col, row } = placement.grid;
  if (dir === AttachDir.TOP) return [col, row - 1];
  if (dir === AttachDir.BOTTOM) return [col, row + 1];
  if (dir === AttachDir.LEFT) return [col - 1, row];
  return [col + 1, row];
}

/** The pair of sides the flow suggests, and the pair to fall back on. */
function determineDirections(
  src: NodePlacement,
  tgt: NodePlacement,
  direction: Direction
): [[AttachDir, AttachDir], [AttachDir, AttachDir]] {
  const sc = src.grid.col;
  const sr = src.grid.row;
  const tc = tgt.grid.col;
  const tr = tgt.grid.row;

  if (isHorizontal(direction)) {
    let preferred: [AttachDir, AttachDir];
    if (tc > sc) preferred = [AttachDir.RIGHT, AttachDir.LEFT];
    else if (tc < sc) {
      // A back edge leaves BELOW, which keeps it clear of the back edges arriving on top.
      return [
        [AttachDir.BOTTOM, AttachDir.BOTTOM],
        [AttachDir.BOTTOM, AttachDir.TOP],
      ];
    } else preferred = tr > sr ? [AttachDir.BOTTOM, AttachDir.TOP] : [AttachDir.TOP, AttachDir.BOTTOM];

    let alt: [AttachDir, AttachDir];
    if (tr > sr) alt = [AttachDir.BOTTOM, AttachDir.TOP];
    else if (tr < sr) alt = [AttachDir.TOP, AttachDir.BOTTOM];
    else alt = preferred;
    return [preferred, alt];
  }

  let preferred: [AttachDir, AttachDir];
  if (tr > sr) preferred = [AttachDir.BOTTOM, AttachDir.TOP];
  else if (tr < sr) {
    return [
      [AttachDir.RIGHT, AttachDir.RIGHT],
      [AttachDir.RIGHT, AttachDir.LEFT],
    ];
  } else preferred = tc > sc ? [AttachDir.RIGHT, AttachDir.LEFT] : [AttachDir.LEFT, AttachDir.RIGHT];

  let alt: [AttachDir, AttachDir];
  if (tc > sc) alt = [AttachDir.RIGHT, AttachDir.LEFT];
  else if (tc < sc) alt = [AttachDir.LEFT, AttachDir.RIGHT];
  else alt = preferred;
  return [preferred, alt];
}

function routeEdge(
  edge: Edge,
  src: NodePlacement,
  tgt: NodePlacement,
  layout: GridLayout,
  direction: Direction,
  softObstacles: Set<string>
): RoutedEdge {
  const [preferred, alt] = determineDirections(src, tgt, direction);
  const free = (c: number, r: number): boolean => layout.isFree(c, r);

  // Neither node is excluded from the obstacles: an edge may not run through a node's border, and the pathfinder
  // already lets the two endpoints through.
  const startPref = attachPoint(src, preferred[0]);
  const endPref = attachPoint(tgt, preferred[1]);
  const pathPref = findPath(startPref[0], startPref[1], endPref[0], endPref[1], free, softObstacles);

  const startAlt = attachPoint(src, alt[0]);
  const endAlt = attachPoint(tgt, alt[1]);
  const pathAlt = findPath(startAlt[0], startAlt[1], endAlt[0], endAlt[1], free, softObstacles);

  let path: Cell[];
  let startDir: AttachDir;
  let endDir: AttachDir;
  if (pathPref !== null && pathAlt !== null) {
    if (pathPref.length <= pathAlt.length + PREFER_BIAS) [path, startDir, endDir] = [pathPref, preferred[0], preferred[1]];
    else [path, startDir, endDir] = [pathAlt, alt[0], alt[1]];
  } else if (pathPref !== null) [path, startDir, endDir] = [pathPref, preferred[0], preferred[1]];
  else if (pathAlt !== null) [path, startDir, endDir] = [pathAlt, alt[0], alt[1]];
  else [path, startDir, endDir] = [[startPref, endPref], preferred[0], preferred[1]];

  const simplified = simplifyPath(path);
  return {
    edge,
    gridPath: simplified,
    drawPath: simplified.map(([c, r]) => layout.gridToDrawCenter(c, r)),
    startDir,
    endDir,
    label: edge.label,
    index: 0,
    occupiedCells: new Set(path.map(([c, r]) => cellId(c, r))),
  };
}

/** A self reference loops out of the top, runs right and comes back into the right side. */
function routeSelfEdge(edge: Edge, src: NodePlacement, layout: GridLayout): RoutedEdge {
  const { col, row } = src.grid;
  const path: Cell[] = [
    [col, row - 1],
    [col, row - 2],
    [col + 2, row - 2],
    [col + 2, row],
    [col + 1, row],
  ];
  return {
    edge,
    gridPath: path,
    drawPath: path.map(([c, r]) => layout.gridToDrawCenter(c, r)),
    startDir: AttachDir.TOP,
    endDir: AttachDir.RIGHT,
    label: edge.label,
    index: 0,
    occupiedCells: new Set(path.map(([c, r]) => cellId(c, r))),
  };
}

/**
 * Edges arriving on the same cell, moved apart along the border so each one draws its own arrowhead. Only ARRIVALS:
 * edges leaving one node diverge from a shared junction on their own, and spreading a start jogs the border instead.
 */
function spreadSharedEndpoints(
  routed: RoutedEdge[],
  layout: GridLayout,
  sgBounds: Map<string, SubgraphBounds>
): void {
  const groups = new Map<string, RoutedEdge[]>();
  for (const re of routed) {
    if (re.drawPath.length < 2) continue;
    const key = pointKey(re.drawPath[re.drawPath.length - 1] as [number, number]);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [re]);
    else bucket.push(re);
  }

  for (const edges of groups.values()) {
    if (edges.length <= 1) continue;
    const first = edges[0] as RoutedEdge;
    const point = first.drawPath[first.drawPath.length - 1] as [number, number];
    const targetId = first.edge.target;
    let target = layout.placements.get(targetId) ?? null;
    if (target === null) {
      const sb = sgBounds.get(targetId);
      if (sb === undefined) continue;
      target = makePlacement(targetId, { col: 0, row: 0 });
      target.drawX = sb.x;
      target.drawY = sb.y;
      target.drawWidth = sb.width;
      target.drawHeight = sb.height;
    }
    applySpread(edges, point, target);
  }
}

/** Each arrival moved along the node's border, the adjacent corner following it so no segment doubles back. */
function applySpread(edges: RoutedEdge[], point: [number, number], placement: NodePlacement): void {
  const n = edges.length;
  const [px, py] = point;
  const attach = (edges[0] as RoutedEdge).endDir;

  if (attach === AttachDir.TOP || attach === AttachDir.BOTTOM) {
    const minX = placement.drawX + 1;
    const maxX = placement.drawX + placement.drawWidth - 2;
    const range = maxX - minX;
    if (range < n - 1) return;
    const step = Math.min(MAX_SPREAD_STEP, Math.floor(range / Math.max(n - 1, 1)));
    edges.forEach((re, i) => {
      const offset = Math.trunc((i - (n - 1) / 2) * step);
      if (offset === 0) return;
      const x = Math.max(minX, Math.min(maxX, px + offset));
      const [, adjY] = re.drawPath[re.drawPath.length - 2] as [number, number];
      re.drawPath[re.drawPath.length - 1] = [x, py];
      re.drawPath[re.drawPath.length - 2] = [x, adjY];
    });
    return;
  }

  const minY = placement.drawY + 1;
  const maxY = placement.drawY + placement.drawHeight - 2;
  const range = maxY - minY;
  if (range < n - 1) return;
  const approach = Math.min(...edges.map((re) => Math.abs(px - (re.drawPath[re.drawPath.length - 2] as [number, number])[0])));
  if (approach < MIN_APPROACH) return;
  const step = Math.min(MAX_SPREAD_STEP, Math.floor(range / Math.max(n - 1, 1)));
  edges.forEach((re, i) => {
    const offset = Math.trunc((i - (n - 1) / 2) * step);
    if (offset === 0) return;
    const y = Math.max(minY, Math.min(maxY, py + offset));
    const [adjX] = re.drawPath[re.drawPath.length - 2] as [number, number];
    re.drawPath[re.drawPath.length - 1] = [px, y];
    re.drawPath.splice(re.drawPath.length - 1, 0, [adjX, y]);
  });
}

/** Every edge of the graph, routed in the order it was written, each one avoiding what the ones before it took. */
export function routeEdges(graph: Graph, layout: GridLayout): RoutedEdge[] {
  const direction = normalized(graph.direction);
  const routed: RoutedEdge[] = [];
  const softObstacles = new Set<string>();

  const sgBounds = new Map<string, SubgraphBounds>();
  for (const sb of layout.subgraphBounds) sgBounds.set(sb.subgraph.id, sb);
  const regions = computeSgRegions(layout, sgBounds);

  graph.edges.forEach((edge, index) => {
    const [src, tgt] = resolveEndpoints(edge, layout, sgBounds);
    if (src === null || tgt === null) return;

    if (isSelfReference(edge) && !edge.sourceIsSubgraph) {
      const re = routeSelfEdge(edge, src, layout);
      re.index = index;
      routed.push(re);
      return;
    }

    const forbidden = foreignSgCells(edge, graph, regions);
    const obstacles = new Set(softObstacles);
    for (const cell of forbidden) obstacles.add(cell);
    const re = routeEdge(edge, src, tgt, layout, direction, obstacles);
    re.index = index;
    for (const cell of re.occupiedCells) softObstacles.add(cell);

    // An edge whose end is a subgraph attaches to the BOX, not to the member node the routing borrowed.
    const sourceBox = sgBounds.get(edge.source);
    if (edge.sourceIsSubgraph && sourceBox !== undefined) clipEndpointToBox(re.drawPath, sourceBox, true);
    const targetBox = sgBounds.get(edge.target);
    if (edge.targetIsSubgraph && targetBox !== undefined) clipEndpointToBox(re.drawPath, targetBox, false);

    routed.push(re);
  });

  spreadSharedEndpoints(routed, layout, sgBounds);
  return routed;
}
