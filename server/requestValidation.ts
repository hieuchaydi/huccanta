import { Buffer } from 'node:buffer';
import {
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES
} from '../src/sourceFiles';
import type { SourceFileInput } from '../src/types';

export type SourceFilesValidation =
  | { ok: true; files: SourceFileInput[] }
  | { ok: false; status: 400 | 413; code: string; error: string };

export function validateSourceFiles(value: unknown, missingCode = 'missingFiles'): SourceFilesValidation {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, status: 400, code: missingCode, error: 'Thiếu danh sách files để phân tích.' };
  }
  if (value.length > MAX_SOURCE_FILES) {
    return {
      ok: false,
      status: 413,
      code: 'tooManyFiles',
      error: `Tối đa ${MAX_SOURCE_FILES} file nguồn cho mỗi lần phân tích.`
    };
  }

  const files: SourceFileInput[] = [];
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return invalidFiles();
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || typeof candidate.content !== 'string') return invalidFiles();

    const normalizedPath = candidate.path.replace(/\\/g, '/').trim();
    if (!normalizedPath || normalizedPath.length > 2_048 || normalizedPath.includes('\0')) return invalidFiles();
    if (paths.has(normalizedPath)) {
      return { ok: false, status: 400, code: 'duplicateFilePath', error: `Đường dẫn file bị trùng: ${normalizedPath}` };
    }
    paths.add(normalizedPath);

    const bytes = Buffer.byteLength(candidate.content, 'utf8');
    if (bytes > MAX_SOURCE_FILE_BYTES) {
      return {
        ok: false,
        status: 413,
        code: 'sourceFileTooLarge',
        error: `File ${normalizedPath} vượt giới hạn ${MAX_SOURCE_FILE_BYTES} byte.`
      };
    }
    totalBytes += bytes;
    if (totalBytes > MAX_SOURCE_BYTES) {
      return {
        ok: false,
        status: 413,
        code: 'sourcePayloadTooLarge',
        error: `Tổng source vượt giới hạn ${MAX_SOURCE_BYTES} byte.`
      };
    }
    files.push({ path: normalizedPath, content: candidate.content });
  }
  return { ok: true, files };
}

function invalidFiles(): SourceFilesValidation {
  return {
    ok: false,
    status: 400,
    code: 'invalidFiles',
    error: 'Mỗi file phải có path và content dạng chuỗi.'
  };
}
