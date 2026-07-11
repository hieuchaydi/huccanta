import type { Graph, GraphNode } from './types';

export type LayoutMode = 'layered' | 'force';

export function nodeWidth(node: GraphNode) {
  return Math.max(84, node.name.length * 8.2 + 34);
}

export const NODE_HEIGHT = 34;

export function layeredLayout(graph: Graph) {
  const layer = new Map(graph.nodes.map((node) => [node.id, 0]));
  const edges = graph.edges.filter((edge) => !edge.cycle && edge.from !== edge.to);

  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromLayer = layer.get(edge.from) ?? 0;
      const toLayer = layer.get(edge.to) ?? 0;
      if (toLayer < fromLayer + 1) {
        layer.set(edge.to, fromLayer + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, GraphNode[]>();
  for (const node of graph.nodes) {
    const column = layer.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }

  for (const [column, nodes] of columns) {
    nodes.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    nodes.forEach((node, index) => {
      node.x = 130 + column * 230;
      node.y = 78 + index * 86;
    });
  }
}

export function forceLayout(graph: Graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  graph.nodes.forEach((node, index) => {
    if (node.x === undefined || node.y === undefined) {
      node.x = 320 + Math.cos(index * 1.8) * 220 + index * 5;
      node.y = 280 + Math.sin(index * 1.3) * 190;
    }
  });

  for (let iteration = 0; iteration < 260; iteration += 1) {
    for (let a = 0; a < graph.nodes.length; a += 1) {
      for (let b = a + 1; b < graph.nodes.length; b += 1) {
        const left = graph.nodes[a];
        const right = graph.nodes[b];
        let dx = (left.x ?? 0) - (right.x ?? 0);
        let dy = (left.y ?? 0) - (right.y ?? 0);
        const distance = Math.hypot(dx, dy) || 0.1;
        const force = 9800 / (distance * distance);
        dx /= distance;
        dy /= distance;
        left.x = (left.x ?? 0) + dx * force;
        left.y = (left.y ?? 0) + dy * force;
        right.x = (right.x ?? 0) - dx * force;
        right.y = (right.y ?? 0) - dy * force;
      }
    }

    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to || from === to) continue;
      let dx = (to.x ?? 0) - (from.x ?? 0);
      let dy = (to.y ?? 0) - (from.y ?? 0);
      const distance = Math.hypot(dx, dy) || 0.1;
      const force = (distance - 165) * 0.02;
      dx /= distance;
      dy /= distance;
      from.x = (from.x ?? 0) + dx * force;
      from.y = (from.y ?? 0) + dy * force;
      to.x = (to.x ?? 0) - dx * force;
      to.y = (to.y ?? 0) - dy * force;
    }
  }

  const minX = Math.min(...graph.nodes.map((node) => node.x ?? 0));
  const minY = Math.min(...graph.nodes.map((node) => node.y ?? 0));
  graph.nodes.forEach((node) => {
    node.x = (node.x ?? 0) + 120 - minX;
    node.y = (node.y ?? 0) + 90 - minY;
  });
}

export function layoutGraph(graph: Graph, mode: LayoutMode) {
  if (mode === 'force') forceLayout(graph);
  else layeredLayout(graph);
  return graph;
}
