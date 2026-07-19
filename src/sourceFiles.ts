// Chính sách file nguồn dùng chung cho UI, HTTP API, CLI và MCP.
// Giữ file này browser-safe: không import `node:*` để client có thể dùng trực tiếp.
export const MAX_SOURCE_FILES = 1_500;
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const MAX_SOURCE_FILE_BYTES = 800_000;

const SOURCE_FILE_RE = /\.(cjs|mjs|mts|cts|js|jsx|ts|tsx|py|pyi|java|go|c|h|cpp|cc|cxx|hpp|hh|hxx|cs)$/i;
const JS_TS_FILE_RE = /\.(cjs|mjs|mts|cts|js|jsx|ts|tsx)$/i;

export const SOURCE_FILE_ACCEPT =
  '.cjs,.mjs,.mts,.cts,.js,.jsx,.ts,.tsx,.py,.pyi,.java,.go,.c,.h,.cpp,.cc,.cxx,.hpp,.hh,.hxx,.cs';

export const IGNORED_SOURCE_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.output',
  '.svelte-kit',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'vendor'
]);

export function isSupportedSourcePath(filePath: string) {
  return SOURCE_FILE_RE.test(filePath) && !filePath.toLowerCase().endsWith('.d.ts');
}

export function isJavaScriptSourcePath(filePath: string) {
  return JS_TS_FILE_RE.test(filePath) && !filePath.toLowerCase().endsWith('.d.ts');
}

export function isIgnoredSourcePath(filePath: string) {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => IGNORED_SOURCE_DIRS.has(segment.toLowerCase()));
}
