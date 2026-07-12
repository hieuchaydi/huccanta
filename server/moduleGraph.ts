// Lõi dựng đồ thị phụ thuộc MỨC FILE cho JS/TS — dùng chung bởi Import Health (GĐ 1) và File Graph (GĐ 2).
// Dùng ts-morph in-memory FS: chỉ phân giải trong đám file được đưa vào → bare package = "ngoài",
// import tương đối trỏ tới file không có = "gãy" (unresolved).
// Bắt cả: import tĩnh, re-export, dynamic import(), require(), shebang, và parse lỗi (syntactic).
import { ModuleKind, Node, Project, ScriptTarget, SyntaxKind, ts } from 'ts-morph';
import type { SourceFileInput } from '../src/types';

export const JS_TS = /\.(cjs|mjs|mts|cts|js|jsx|ts|tsx)$/i;
export const TYPE_DECL = /\.d\.ts$/i;
export const TEST_NAME = /\.(test|spec)\.[cm]?[jt]sx?$/i;
export const CONFIG_NAME = /\.(config|conf)\.[cm]?[jt]s$/i;
export const ENTRY_NAME = /(^|\/)(index|main|app|server|cli|mod|entry|bootstrap)\.[cm]?[jt]sx?$/i;
// Import tới các asset này (không phải module JS/TS) không tính là "gãy" khi không phân giải được.
export const ASSET_EXT = /\.(css|scss|sass|less|styl|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|md|txt|wasm|ya?ml|glsl|vert|frag|mp[34]|webm|ogg|wav)$/i;
// Thứ tự thử khi phân giải specifier tương đối của dynamic import()/require() về file trong project.
const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const INDEX_FILES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'];

export function normalizePath(p: string) {
  // In-memory FS của ts-morph trả path có "/" đầu (vd "/src/a.ts") — chuẩn hoá để khớp key input.
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

export function isRelative(spec: string) {
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

// Vì sao coi là entry (nếu có). Dùng chung cho verdict Import Health và kind File Graph.
export function entryReason(path: string, shebang: boolean): string | undefined {
  if (shebang) return 'script có shebang (#!) — chạy trực tiếp';
  if (TEST_NAME.test(path)) return 'file test (được test runner chạy)';
  if (CONFIG_NAME.test(path)) return 'file cấu hình';
  if (/(^|\/)bin\//.test(path)) return 'nằm trong bin/';
  if (ENTRY_NAME.test(path)) return 'tên file kiểu entry (index/main/app/server…)';
  return undefined;
}

// Phụ thuộc mức file của một file nguồn (chưa gồm importedBy — mỗi consumer tự tính).
export interface FileDeps {
  path: string; // normalized, không có "/" đầu
  content: string; // nội dung gốc (để đếm loc, v.v.)
  parseError?: string; // set nếu tạo source file lỗi hoặc có syntactic diagnostics
  shebang: boolean;
  exports: number;
  targets: string[]; // path (normalized) các file trong project mà file này phụ thuộc, dedup + sort
  unresolvedImports: string[]; // specifier tương đối gãy (không phải asset), sort
}

// Dựng ts-morph in-memory, resolve import tĩnh/re-export/dynamic import()/require() và trả FileDeps
// cho mỗi file JS/TS (bỏ .d.ts). Deterministic: targets/unresolved đã sort.
export function collectFileDeps(files: SourceFileInput[]): FileDeps[] {
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
  const contentByPath = new Map<string, string>();
  const deps = new Map<string, FileDeps>();

  for (const file of inputs) {
    const path = normalizePath(file.path);
    if (added.has(path)) continue;
    contentByPath.set(path, file.content);
    const record: FileDeps = {
      path,
      content: file.content,
      shebang: false,
      exports: 0,
      targets: [],
      unresolvedImports: []
    };
    try {
      project.createSourceFile(path, file.content, { overwrite: true });
      added.add(path);
      if (file.content.startsWith('#!')) {
        record.shebang = true;
        shebangs.add(path);
      }
    } catch (error) {
      record.parseError = error instanceof Error ? error.message : String(error);
    }
    deps.set(path, record);
  }

  project.resolveSourceFileDependencies();
  const program = project.getProgram().compilerObject;

  for (const source of project.getSourceFiles()) {
    const key = normalizePath(source.getFilePath());
    const record = deps.get(key);
    if (!record || record.parseError) continue;

    // Parse lỗi thật = có syntactic diagnostics (không tính lỗi type).
    const syntactic = program.getSyntacticDiagnostics(source.compilerNode);
    if (syntactic.length > 0) {
      record.parseError = ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ');
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

    record.targets = [...targets].sort();
    record.unresolvedImports = [...unresolved].sort();
  }

  return [...deps.values()];
}
