// Refactor Sandbox — giả lập một thay đổi (xoá file/hàm) trên "đồ thị bóng" và báo hậu quả,
// KHÔNG đụng filesystem. Tái dùng analyzeProject (đa ngôn ngữ) + analyzeGraph (chấm điểm lại).
//
// Ý tưởng: dựng đồ thị hiện tại → bỏ các node bị xoá + cạnh liên quan → chấm điểm lại →
// so sánh trước/sau (vòng gọi, điểm rối) và liệt kê blast radius (nơi gọi gãy, hàm thành mồ côi, test liên quan).
import { analyzeGraph } from '../src/analyzer';
import type { Graph, SimChange, SimulationResult, SourceFileInput } from '../src/types';
import { analyzeProject } from './analyze';

const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function cloneForShadow(graph: Graph, removed: Set<string>): Graph {
  return {
    nodes: graph.nodes
      .filter((node) => !removed.has(node.id))
      .map((node) => ({ ...node, issues: node.issues.map((issue) => ({ ...issue })) })),
    edges: graph.edges
      .filter((edge) => !removed.has(edge.from) && !removed.has(edge.to))
      .map((edge) => ({ ...edge }))
  };
}

const nameOf = (id: string) => id.split('#').slice(1).join('#') || id;

export async function simulateChange(files: SourceFileInput[], change: SimChange): Promise<SimulationResult> {
  const before = await analyzeProject(files);
  const byId = new Map(before.nodes.map((node) => [node.id, node]));

  // Tập node bị xoá.
  const removed = new Set<string>();
  const removedFiles: string[] = [];
  if (change.kind === 'delete-function') {
    if (byId.has(change.target)) removed.add(change.target);
  } else {
    const target = normalizePath(change.target);
    for (const node of before.nodes) {
      if (normalizePath(node.file) === target) removed.add(node.id);
    }
    if (removed.size > 0) removedFiles.push(target);
  }

  const found = removed.size > 0;

  // Nơi gọi tới hàm bị xoá (edge to ∈ removed, from ∉ removed) → lời gọi gãy.
  const callerMap = new Map<string, Set<string>>();
  for (const edge of before.edges) {
    if (removed.has(edge.to) && !removed.has(edge.from)) {
      const set = callerMap.get(edge.from) ?? new Set<string>();
      set.add(edge.to);
      callerMap.set(edge.from, set);
    }
  }

  // Đồ thị bóng + chấm điểm lại.
  const after = analyzeGraph(cloneForShadow(before, removed));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));

  const brokenCallers = [...callerMap.entries()]
    .map(([id, callees]) => {
      const node = byId.get(id)!;
      return {
        id,
        file: node.file,
        removedCallees: [...callees].map(nameOf),
        fanOutBefore: node.fanOut,
        fanOutAfter: afterById.get(id)?.fanOut ?? 0
      };
    })
    .sort((a, b) => b.fanOutBefore - b.fanOutAfter - (a.fanOutBefore - a.fanOutAfter));

  // Hàm mất hết nơi gọi sau thay đổi (fanIn: >0 → 0), không kể chính hàm bị xoá.
  const newlyOrphaned = after.nodes
    .filter((node) => node.fanIn === 0 && (byId.get(node.id)?.fanIn ?? 0) > 0)
    .map((node) => ({ id: node.id, file: node.file }));

  const affectedFiles = new Set<string>(brokenCallers.map((c) => c.file));
  const affectedTests = [...affectedFiles].filter((file) => TEST_NAME.test(file)).sort();

  const inCycleBefore = before.nodes.filter((n) => n.inCycle).length;
  const inCycleAfter = after.nodes.filter((n) => n.inCycle).length;
  const hotBefore = before.nodes.filter((n) => n.level !== 'ok').length;
  const hotAfter = after.nodes.filter((n) => n.level !== 'ok').length;

  const summary: string[] = [];
  if (!found) {
    summary.push(`Không tìm thấy "${change.target}" để ${change.kind === 'delete-file' ? 'xoá file' : 'xoá hàm'}.`);
  } else {
    const what = change.kind === 'delete-file' ? `file ${change.target}` : `hàm ${nameOf(change.target)}`;
    summary.push(`Xoá ${what}: bỏ ${removed.size} hàm khỏi đồ thị.`);
    summary.push(
      brokenCallers.length > 0
        ? `${brokenCallers.length} nơi gọi tới sẽ gãy: ${brokenCallers.slice(0, 5).map((c) => nameOf(c.id)).join(', ')}${brokenCallers.length > 5 ? '…' : ''}`
        : 'Không nơi nào đang gọi tới phần bị xoá (an toàn về lời gọi).'
    );
    if (newlyOrphaned.length > 0) {
      summary.push(`${newlyOrphaned.length} hàm mất hết nơi gọi (thành mồ côi): ${newlyOrphaned.slice(0, 5).map((o) => nameOf(o.id)).join(', ')}${newlyOrphaned.length > 5 ? '…' : ''}`);
    }
    if (affectedTests.length > 0) {
      summary.push(`${affectedTests.length} file test liên quan: ${affectedTests.join(', ')}`);
    }
    summary.push(`Hàm trong vòng gọi: ${inCycleBefore} → ${inCycleAfter}${inCycleAfter < inCycleBefore ? ` (phá ${inCycleBefore - inCycleAfter})` : ''}`);
    summary.push(`Điểm rối (hot+warn): ${hotBefore} → ${hotAfter}`);
    for (const caller of brokenCallers.slice(0, 3)) {
      if (caller.fanOutAfter !== caller.fanOutBefore) {
        summary.push(`Fan-out ${nameOf(caller.id)}: ${caller.fanOutBefore} → ${caller.fanOutAfter}`);
      }
    }
  }

  return {
    change,
    found,
    removed: { functions: removed.size, files: removedFiles },
    brokenCallers,
    newlyOrphaned,
    affectedTests,
    metrics: {
      functions: { before: before.nodes.length, after: after.nodes.length },
      functionsInCycle: { before: inCycleBefore, after: inCycleAfter },
      hotspots: { before: hotBefore, after: hotAfter }
    },
    summary
  };
}
