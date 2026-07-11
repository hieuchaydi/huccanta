// GĐ 1 — Import Health Report (chỉ JS/TS, để chính xác).
// Làm việc ở MỨC FILE dựa trên import/export THẬT (ts-morph resolve symbol), không đoán theo tên.
// Dùng in-memory FS: chỉ phân giải trong đám file được đưa vào → bare package = "ngoài",
// import tương đối trỏ tới file không có = "gãy" (unresolved).
// Bắt cả: import tĩnh, re-export, dynamic import(), require(), shebang, và parse lỗi (syntactic).
import { ModuleKind, Node, Project, ScriptTarget, SyntaxKind, ts } from 'ts-morph';
import type { FileHealth, FileVerdict, ImportHealthReport, SourceFileInput } from '../src/types';

const JS_TS = /\.(cjs|mjs|mts|cts|js|jsx|ts|tsx)$/i;
const TYPE_DECL = /\.d\.ts$/i;
const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const CONFIG_NAME = /\.(config|conf)\.[cm]?[jt]s$/i;
const ENTRY_NAME = /(^|\/)(index|main|app|server|cli|mod|entry|bootstrap)\.[cm]?[jt]sx?$/i;
// Import tới các asset này (không phải module JS/TS) không tính là "gãy" khi không phân giải được.
const ASSET_EXT = /\.(css|scss|sass|less|styl|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|md|txt|wasm|ya?ml|glsl|vert|frag|mp[34]|webm|ogg|wav)$/i;
// Thứ tự thử khi phân giải specifier tương đối của dynamic import()/require() về file trong project.
const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_FILES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'];

function normalizePath(p: string) {
  // In-memory FS của ts-morph trả path có "/" đầu (vd "/src/a.ts") — chuẩn hoá để khớp key input.
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function isRelative(spec: string) {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
}

function dirOf(p: string) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function joinPath(dir: string, rel: string) {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

// Resolver tối giản cho dynamic import()/require() (ts-morph không tự resolve chúng như import tĩnh).
function resolveRelative(fromPath: string, spec: string, added: Set<string>): string | undefined {
  const base = joinPath(dirOf(fromPath), spec);
  for (const ext of RESOLVE_EXTS) if (added.has(base + ext)) return base + ext;
  for (const idx of INDEX_FILES) if (added.has(base + idx)) return base + idx;
  return undefined;
}

function entryReason(path: string, shebang: boolean): string | undefined {
  if (shebang) return 'script có shebang (#!) — chạy trực tiếp';
  if (TEST_NAME.test(path)) return 'file test (được test runner chạy)';
  if (CONFIG_NAME.test(path)) return 'file cấu hình';
  if (/(^|\/)bin\//.test(path)) return 'nằm trong bin/';
  if (ENTRY_NAME.test(path)) return 'tên file kiểu entry (index/main/app/server…)';
  return undefined;
}

export function importHealthReport(files: SourceFileInput[]): ImportHealthReport {
  const inputs = files.filter((file) => JS_TS.test(file.path) && !TYPE_DECL.test(file.path));

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022
    }
  });

  const added = new Set<string>();
  const shebangs = new Set<string>();
  const health = new Map<string, FileHealth>();

  for (const file of inputs) {
    const path = normalizePath(file.path);
    if (added.has(path)) continue;
    const record: FileHealth = {
      path,
      verdict: 'ok',
      imports: 0,
      importedBy: 0,
      exports: 0,
      unresolvedImports: [],
      evidence: []
    };
    try {
      project.createSourceFile(path, file.content, { overwrite: true });
      added.add(path);
      if (file.content.startsWith('#!')) shebangs.add(path);
    } catch (error) {
      record.verdict = 'parse-error';
      record.error = error instanceof Error ? error.message : String(error);
    }
    health.set(path, record);
  }

  project.resolveSourceFileDependencies();
  const program = project.getProgram().compilerObject;

  for (const source of project.getSourceFiles()) {
    const key = normalizePath(source.getFilePath());
    const record = health.get(key);
    if (!record || record.verdict === 'parse-error') continue;

    // Parse lỗi thật = có syntactic diagnostics (không tính lỗi type).
    const syntactic = program.getSyntacticDiagnostics(source.compilerNode);
    if (syntactic.length > 0) {
      record.verdict = 'parse-error';
      record.error = ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ');
      continue;
    }

    record.exports = source.getExportSymbols().length;

    const targets = new Set<string>(); // file trong project mà file này phụ thuộc (dedup)
    const unresolved = new Set<string>();

    // import tĩnh + re-export (export ... from './x')
    for (const decl of [...source.getImportDeclarations(), ...source.getExportDeclarations()]) {
      const spec = decl.getModuleSpecifierValue();
      if (!spec) continue;
      const target = decl.getModuleSpecifierSourceFile();
      const targetKey = target ? normalizePath(target.getFilePath()) : undefined;
      if (targetKey && added.has(targetKey)) targets.add(targetKey);
      else if (isRelative(spec) && !ASSET_EXT.test(spec)) unresolved.add(spec);
    }

    // dynamic import() + require() — ts-morph không coi là import declaration.
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      const first = call.getArguments()[0];
      const isDynImport = expr.getKind() === SyntaxKind.ImportKeyword;
      const isRequire = Node.isIdentifier(expr) && expr.getText() === 'require';
      if (!((isDynImport || isRequire) && first && Node.isStringLiteral(first))) continue;
      const spec = first.getLiteralValue();
      if (!isRelative(spec)) continue;
      const targetKey = resolveRelative(key, spec, added);
      if (targetKey) targets.add(targetKey);
      else if (!ASSET_EXT.test(spec)) unresolved.add(spec);
    }

    record.imports = targets.size;
    record.unresolvedImports = [...unresolved];
    for (const targetKey of targets) {
      const targetRecord = health.get(targetKey);
      if (targetRecord) targetRecord.importedBy += 1;
    }
  }

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
