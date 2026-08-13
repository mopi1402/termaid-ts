// Ported from src/termaid/output/text.py.

import { Graph } from "../graph/model.js";
import { renderGraph, type RenderOptions } from "../renderer/draw.js";

/** A graph as plain text. */
export function renderText(graph: Graph, options: Partial<RenderOptions> = {}): string {
  return renderGraph(graph, options);
}
