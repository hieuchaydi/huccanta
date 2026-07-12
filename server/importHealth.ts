// GĐ 1 — Import Health Report (chỉ JS/TS, để chính xác).
// Làm việc ở MỨC FILE dựa trên import/export THẬT (ts-morph resolve symbol), không đoán theo tên.
// Lõi dựng đồ thị phụ thuộc nằm ở moduleGraph.ts (dùng chung với File Graph GĐ 2); ở đây chỉ áp
// *chính sách* của Import Health: verdict (entry/possibly-unused/parse-error) + bằng chứng + độ tin cậy.
import type { FileHealth, FileVerdict, ImportHealthReport, SourceFileInput } from '../src/types';
import { collectFileDeps, entryReason } from './moduleGraph';

export function importHealthReport(files: SourceFileInput[]): ImportHealthReport {
  const deps = collectFileDeps(files);
  const health = new Map<string, FileHealth>();

  for (const dep of deps) {
    health.set(dep.path, {
      path: dep.path,
      verdict: dep.parseError ? 'parse-error' : 'ok',
      imports: dep.parseError ? 0 : dep.targets.length,
      importedBy: 0,
      exports: dep.exports,
      unresolvedImports: dep.unresolvedImports,
      evidence: [],
      error: dep.parseError
    });
  }

  // Tính importedBy (inbound) từ targets của mọi file.
  for (const dep of deps) {
    if (dep.parseError) continue;
    for (const targetKey of dep.targets) {
      const target = health.get(targetKey);
      if (target) target.importedBy += 1;
    }
  }

  const shebangs = new Set(deps.filter((d) => d.shebang).map((d) => d.path));

  // Chấm kết luận + bằng chứng.
  for (const record of health.values()) {
    if (record.verdict === 'parse-error') continue;
    const reason = entryReason(record.path, shebangs.has(record.path));
    if (reason) {
      record.verdict = 'entry';
      record.entryReason = reason;
      continue;
    }
    if (record.importedBy === 0) {
      record.verdict = 'possibly-unused';
      const evidence: string[] = [
        'Không file nào trong project import file này (kể cả dynamic import/require)',
        'Không phải entry point (index/main/test/config/bin/shebang)'
      ];
      let confidence = 55;
      if (record.exports > 0) {
        confidence += 15;
        evidence.push(`Có ${record.exports} export nhưng không nơi nào dùng`);
      } else {
        evidence.push('Không export gì (có thể là script chạy độc lập chưa được nối vào)');
      }
      if (record.imports === 0) {
        confidence += 10;
        evidence.push('Cô lập hoàn toàn (không import ra, không ai import vào)');
      }
      if (record.unresolvedImports.length > 0) {
        evidence.push(`Có ${record.unresolvedImports.length} import gãy`);
      }
      record.confidence = Math.min(confidence, 85); // không bao giờ khẳng định chắc chắn — dead-code rất dễ sai
      record.evidence = evidence;
    }
  }

  const list = [...health.values()];
  const summary = {
    files: list.length,
    entryPoints: list.filter((f) => f.verdict === 'entry').length,
    possiblyUnused: list.filter((f) => f.verdict === 'possibly-unused').length,
    parseErrors: list.filter((f) => f.verdict === 'parse-error').length,
    unresolvedImports: list.reduce((sum, f) => sum + f.unresolvedImports.length, 0)
  };

  // Sắp xếp: đáng chú ý trước (possibly-unused theo confidence, rồi parse-error, rồi còn lại).
  const rank: Record<FileVerdict, number> = { 'possibly-unused': 0, 'parse-error': 1, ok: 2, entry: 3 };
  list.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.confidence ?? 0) - (a.confidence ?? 0) || a.path.localeCompare(b.path));

  return { summary, files: list };
}
