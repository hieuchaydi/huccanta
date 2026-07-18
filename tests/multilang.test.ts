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

  it('resolve self.method theo đúng owner khi Python có method trùng tên', async () => {
    const graph = await analyzeProject([
      {
        path: 'owners.py',
        content: `class A:
    def run(self):
        return self.helper()
    def helper(self):
        return 1

class B:
    def run(self):
        return self.helper()
    def helper(self):
        return 2
`
      }
    ]);

    expect(graph.edges.find((edge) =>
      edge.from === 'owners.py#A.run' && edge.to === 'owners.py#A.helper'
    )?.resolution).toBe('exact');
    expect(graph.edges.find((edge) =>
      edge.from === 'owners.py#B.run' && edge.to === 'owners.py#B.helper'
    )?.resolution).toBe('exact');
    expect(graph.edges.some((edge) => edge.from === 'owners.py#A.run' && edge.to === 'owners.py#B.helper')).toBe(false);
    expect(graph.edges.some((edge) => edge.from === 'owners.py#B.run' && edge.to === 'owners.py#A.helper')).toBe(false);
  });

  it('đếm branch node riêng của Python thay vì regex node type chung', async () => {
    const graph = await analyzeProject([
      {
        path: 'branches.py',
        content: `def decide(value, items):
    if value and items:
        return 1
    elif value:
        return 2
    match value:
        case 3:
            return 3
        case _:
            return 0

def active(items):
    return [item for item in items if item]
`
      }
    ]);

    // base + if + boolean operator + elif + 2 case clauses
    expect(byId(graph, 'branches.py#decide')?.complexity).toBe(6);
    // base + comprehension for + comprehension if
    expect(byId(graph, 'branches.py#active')?.complexity).toBe(3);
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

  it('resolve Python import module và alias module xuyên file', async () => {
    const graph = await analyzeProject([
      { path: 'pkg/__init__.py', content: '' },
      { path: 'pkg/helpers.py', content: 'def normalize(value):\n    return value.strip()\n' },
      {
        path: 'app.py',
        content: `import pkg.helpers
import pkg.helpers as tools

def direct(value):
    return pkg.helpers.normalize(value)

def aliased(value):
    return tools.normalize(value)
`
      }
    ]);

    expect(graph.edges.find((edge) =>
      edge.from === 'app.py#direct' && edge.to === 'pkg/helpers.py#normalize'
    )?.resolution).toBe('import');
    expect(graph.edges.find((edge) =>
      edge.from === 'app.py#aliased' && edge.to === 'pkg/helpers.py#normalize'
    )?.resolution).toBe('import');
  });

  it('resolve from-import, alias symbol và relative import theo module scope Python', async () => {
    const graph = await analyzeProject([
      { path: 'src/pkg/__init__.py', content: '' },
      { path: 'src/pkg/helpers.py', content: 'def normalize(value):\n    return value.strip()\n' },
      {
        path: 'src/pkg/service.py',
        content: `from . import helpers
from .helpers import normalize as clean

def through_module(value):
    return helpers.normalize(value)

def through_symbol(value):
    return clean(value)
`
      }
    ]);

    expect(graph.edges.find((edge) =>
      edge.from === 'src/pkg/service.py#through_module' && edge.to === 'src/pkg/helpers.py#normalize'
    )?.resolution).toBe('import');
    expect(graph.edges.find((edge) =>
      edge.from === 'src/pkg/service.py#through_symbol' && edge.to === 'src/pkg/helpers.py#normalize'
    )?.resolution).toBe('import');
  });

  it('resolve class được from-import nhưng không suy type cho instance Python', async () => {
    const graph = await analyzeProject([
      { path: 'pkg/__init__.py', content: '' },
      {
        path: 'pkg/models.py',
        content: `class Service:
    def run(self):
        return 1
`
      },
      {
        path: 'app.py',
        content: `from pkg.models import Service

def static_call():
    return Service.run()

def instance_call(service):
    return service.run()
`
      }
    ]);

    expect(graph.edges.find((edge) =>
      edge.from === 'app.py#static_call' && edge.to === 'pkg/models.py#Service.run'
    )?.resolution).toBe('import');
    expect(graph.edges.some((edge) => edge.from === 'app.py#instance_call')).toBe(false);
  });

  it('ưu tiên định nghĩa module-local khi trùng tên imported binding', async () => {
    const graph = await analyzeProject([
      { path: 'pkg/__init__.py', content: '' },
      { path: 'pkg/helpers.py', content: 'def normalize():\n    return 1\n' },
      {
        path: 'app.py',
        content: `from pkg.helpers import normalize

def normalize():
    return 2

def run():
    return normalize()
`
      }
    ]);

    expect(graph.edges.find((edge) => edge.from === 'app.py#run')?.to).toBe('app.py#normalize');
    expect(graph.edges.find((edge) => edge.from === 'app.py#run')?.resolution).toBe('same-file');
  });

  it('không nối from-import mơ hồ giữa submodule và symbol cùng tên', async () => {
    const graph = await analyzeProject([
      {
        path: 'pkg/__init__.py',
        content: `class helpers:
    def run(self):
        return 1
`
      },
      {
        path: 'pkg/helpers.py',
        content: 'def run():\n    return 2\n'
      },
      {
        path: 'app.py',
        content: `from pkg import helpers

def start():
    return helpers.run()
`
      }
    ]);

    expect(graph.edges.some((edge) => edge.from === 'app.py#start')).toBe(false);
  });

  it('không coi bare call trong Python class là self.method', async () => {
    const graph = await analyzeProject([
      {
        path: 'service.py',
        content: `class Service:
    def run(self):
        return helper()
    def helper(self):
        return 1
`
      }
    ]);

    expect(graph.edges.some((edge) => edge.from === 'service.py#Service.run')).toBe(false);
  });
});
