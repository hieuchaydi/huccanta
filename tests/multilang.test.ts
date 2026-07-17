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

  it('gắn tiền tố Class cho method Java và giữ owner trong resolver tĩnh', async () => {
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

  it('resolve method theo owner/class thay vì chọn nhầm method trùng tên', async () => {
    const graph = await analyzeProject([
      {
        path: 'owners.java',
        content: `class A { int run(){ return this.helper(); } int helper(){ return 1; } }
          class B { int run(){ return this.helper(); } int helper(){ return 2; } }`
      }
    ]);

    const aRun = 'owners.java#A.run';
    const bRun = 'owners.java#B.run';
    const aHelper = 'owners.java#A.helper';
    const bHelper = 'owners.java#B.helper';
    expect(graph.edges.find((edge) => edge.from === aRun && edge.to === aHelper)?.resolution).toBe('exact');
    expect(graph.edges.find((edge) => edge.from === bRun && edge.to === bHelper)?.resolution).toBe('exact');
    expect(graph.edges.some((edge) => edge.from === aRun && edge.to === bHelper)).toBe(false);
    expect(graph.edges.some((edge) => edge.from === bRun && edge.to === aHelper)).toBe(false);
  });

  it('không nối call mơ hồ giữa hai symbol trùng tên ở các file khác nhau', async () => {
    const graph = await analyzeProject([
      { path: 'a.py', content: 'def helper():\n    return 1\n' },
      { path: 'b.py', content: 'def helper():\n    return 2\n' },
      { path: 'caller.py', content: 'def run():\n    return helper()\n' }
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['caller.py#run']));
    expect(graph.edges.some((edge) => edge.from === 'caller.py#run')).toBe(false);
  });

  it('không dùng tên duy nhất toàn project để đoán call xuyên file', async () => {
    const graph = await analyzeProject([
      { path: 'helper.py', content: 'def helper():\n    return 1\n' },
      { path: 'caller.py', content: 'def run():\n    return helper()\n' }
    ]);

    expect(graph.edges.some((edge) => edge.from === 'caller.py#run')).toBe(false);
  });

  it('không fallback về owner hiện tại khi call có receiver ngoài chưa resolve được', async () => {
    const graph = await analyzeProject([
      {
        path: 'receiver.java',
        content: `class A { int run(B other){ return other.helper(); } int helper(){ return 1; } }
          class B { int helper(){ return 2; } }`
      }
    ]);

    expect(graph.edges.some((edge) => edge.from === 'receiver.java#A.run')).toBe(false);
  });

  it('giữ nguyên guard receiver ngoài cho field_expression của C++', async () => {
    const graph = await analyzeProject([
      {
        path: 'receiver.cpp',
        content: `class B { public: int helper(){ return 2; } };
          class A { public: int helper(){ return 1; } int run(B other){ return other.helper(); } };`
      }
    ]);

    expect(graph.edges.some((edge) => edge.from === 'receiver.cpp#A.run')).toBe(false);
  });

  it('đọc đúng type và biến self của Go method receiver', async () => {
    const graph = await analyzeProject([
      {
        path: 'receiver.go',
        content: `package service
          type Service struct{}
          func (s *Service) Load(){ s.normalize() }
          func (s *Service) normalize(){}`
      }
    ]);

    expect(graph.edges.find((edge) =>
      edge.from === 'receiver.go#Service.Load' && edge.to === 'receiver.go#Service.normalize'
    )?.resolution).toBe('exact');
  });
});
