import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../server/analyze';
import type { Graph } from '../src/types';

const byId = (graph: Graph, id: string) => graph.nodes.find((n) => n.id === id);

describe('analyzeProject (multi-language)', () => {
  it('phát hiện vòng gọi trong Python', async () => {
    const graph = await analyzeProject([
      {
        path: 'svc.py',
        content: 'def get_token(x):\n    if x:\n        return refresh(x)\n    return None\ndef refresh(x):\n    return get_token(x)\n'
      }
    ]);
    expect(byId(graph, 'svc.py#get_token')?.inCycle).toBe(true);
    expect(byId(graph, 'svc.py#refresh')?.inCycle).toBe(true);
    // cạnh hai chiều giữa hai hàm
    expect(graph.edges.length).toBe(2);
  });

  it('gắn tiền tố Class cho method Java nhưng vẫn khớp lời gọi theo tên trần', async () => {
    const graph = await analyzeProject([
      {
        path: 'Order.java',
        content: 'class Order {\n int total(int x){ return price(x) + tax(); }\n int price(int x){ return x; }\n int tax(){ return total(1); }\n}\n'
      }
    ]);
    expect(byId(graph, 'Order.java#Order.total')?.inCycle).toBe(true);
    expect(byId(graph, 'Order.java#Order.tax')?.inCycle).toBe(true);
    expect(byId(graph, 'Order.java#Order.price')?.inCycle).toBe(false);
  });

  it('gộp JS/TS (ts-morph) và ngôn ngữ khác (tree-sitter) trong cùng một đồ thị', async () => {
    const graph = await analyzeProject([
      { path: 'a.ts', content: 'export function a() { a(); }' },
      { path: 'b.py', content: 'def b():\n    b()\n' }
    ]);
    expect(byId(graph, 'a.ts#a')?.inCycle).toBe(true); // tự gọi = self-loop cycle
    expect(byId(graph, 'b.py#b')?.inCycle).toBe(true);
    expect(graph.nodes.length).toBe(2);
  });

  it('tính độ phức tạp theo nhánh rẽ cho Python', async () => {
    const graph = await analyzeProject([
      {
        path: 'c.py',
        content: 'def busy(items):\n    for i in items:\n        if i:\n            while i:\n                i -= 1\n'
      }
    ]);
    // base 1 + for + if + while = 4
    expect(byId(graph, 'c.py#busy')?.complexity).toBe(4);
  });
});
