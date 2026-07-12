// GĐ 2 — Đồ thị phụ thuộc MỨC FILE (chỉ JS/TS).
// Node = file, cạnh = quan hệ import THẬT. Tái dùng collectFileDeps (dùng chung với Import Health)
// để lấy đồ thị phụ thuộc thô, rồi: đánh dấu vòng phụ thuộc (Tarjan SCC), phân loại entry/normal/orphan.
// Deterministic, server-only (ts-morph). KHÔNG import từ src/ client.
import type { FileGraph, FileGraphEdge, FileGraphNode, FileNodeKind, SourceFileInput } from '../src/types';
import { collectFileDeps, entryReason } from './moduleGraph';

function basename(path: string) {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function parentBasename(path: string) {
  const parts = path.split('/');
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : path;
}

// Tarjan SCC trên đồ thị file. Trả sccOf (id → chỉ số component) và tập id thuộc SCC size>1.
function tarjan(ids: string[], out: Map<string, string[]>) {
  let index = 0;
  let sccCount = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const low = new Map<string, number>();
  const num = new Map<string, number>();
  const sccOf = new Map<string, number>();
  const bigScc = new Set<string>(); // id thuộc component có kích thước > 1

  function strongConnect(id: string) {
    num.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of out.get(id) ?? []) {
      if (!num.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, num.get(next) ?? 0));
      }
    }

    if (low.get(id) === num.get(id)) {
      const component: string[] = [];
      let current = '';
      do {
        current = stack.pop() ?? '';
        onStack.delete(current);
        sccOf.set(current, sccCount);
        component.push(current);
      } while (current && current !== id);
      if (component.length > 1) for (const member of component) bigScc.add(member);
      sccCount += 1;
    }
  }

  for (const id of ids) if (!num.has(id)) strongConnect(id);
  return { sccOf, bigScc };
}

export function fileGraphReport(files: SourceFileInput[]): FileGraph {
  const deps = collectFileDeps(files);
  const paths = deps.map((d) => d.path);
  const present = new Set(paths);

  // Nhãn hiển thị: basename, thêm thư mục cha nếu trùng basename giữa các file.
  const baseCount = new Map<string, number>();
  for (const p of paths) baseCount.set(basename(p), (baseCount.get(basename(p)) ?? 0) + 1);

  // Đồ thị: adjacency + self-loop; edges (bỏ self-edge).
  const out = new Map<string, string[]>();
  const selfLoop = new Set<string>();
  const importedBy = new Map<string, number>();
  const edges: FileGraphEdge[] = [];
  for (const p of paths) {
    out.set(p, []);
    importedBy.set(p, 0);
  }
  for (const dep of deps) {
    for (const target of dep.targets) {
      if (!present.has(target)) continue;
      if (target === dep.path) {
        selfLoop.add(dep.path);
        continue;
      }
      out.get(dep.path)!.push(target);
      importedBy.set(target, (importedBy.get(target) ?? 0) + 1);
      edges.push({ from: dep.path, to: target, cycle: false });
    }
  }

  const { sccOf, bigScc } = tarjan(paths, out);
  const inCycle = (id: string) => bigScc.has(id) || selfLoop.has(id);

  // Đánh dấu cạnh trong vòng: hai đầu cùng một SCC size>1.
  for (const edge of edges) {
    if (bigScc.has(edge.from) && bigScc.has(edge.to) && sccOf.get(edge.from) === sccOf.get(edge.to)) {
      edge.cycle = true;
    }
  }

  const nodes: FileGraphNode[] = deps.map((dep) => {
    const shebang = dep.shebang;
    const isEntry = !!entryReason(dep.path, shebang);
    const inbound = importedBy.get(dep.path) ?? 0;
    const kind: FileNodeKind = isEntry ? 'entry' : inbound === 0 ? 'orphan' : 'normal';
    const label = (baseCount.get(basename(dep.path)) ?? 0) > 1 ? parentBasename(dep.path) : basename(dep.path);
    return {
      id: dep.path,
      path: dep.path,
      label,
      kind,
      imports: dep.targets.filter((t) => present.has(t) && t !== dep.path).length,
      importedBy: inbound,
      exports: dep.exports,
      loc: dep.content.length ? dep.content.split('\n').length : 0,
      inCycle: inCycle(dep.path),
      unresolved: dep.unresolvedImports.length
    };
  });

  // Số vòng phụ thuộc = số SCC size>1 (đếm chỉ số component riêng) + số self-loop.
  const bigSccIds = new Set<number>();
  for (const id of bigScc) bigSccIds.add(sccOf.get(id)!);
  const cycles = bigSccIds.size + selfLoop.size;

  const summary = {
    files: nodes.length,
    edges: edges.length,
    cycles,
    filesInCycle: nodes.filter((n) => n.inCycle).length,
    entries: nodes.filter((n) => n.kind === 'entry').length,
    orphans: nodes.filter((n) => n.kind === 'orphan').length,
    unresolvedImports: nodes.reduce((sum, n) => sum + n.unresolved, 0)
  };

  nodes.sort(
    (a, b) => Number(b.inCycle) - Number(a.inCycle) || b.importedBy - a.importedBy || a.path.localeCompare(b.path)
  );
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { nodes, edges, summary };
}
