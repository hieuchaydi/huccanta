import { describe, expect, it } from 'vitest';
import { isTrustedBrowserOrigin } from '../server/httpSecurity';
import { validateSourceFiles } from '../server/requestValidation';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_FILES } from '../src/sourceFiles';

describe('HTTP hardening', () => {
  it('accepts local browser origins and non-browser clients only', () => {
    expect(isTrustedBrowserOrigin(undefined)).toBe(true);
    expect(isTrustedBrowserOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isTrustedBrowserOrigin('https://localhost:3030')).toBe(true);
    expect(isTrustedBrowserOrigin('http://[::1]:3030')).toBe(true);
    expect(isTrustedBrowserOrigin('https://example.com')).toBe(false);
    expect(isTrustedBrowserOrigin('null')).toBe(false);
    expect(isTrustedBrowserOrigin('not a url')).toBe(false);
  });

  it('normalizes valid file paths and rejects malformed or duplicate payloads', () => {
    expect(validateSourceFiles([{ path: 'src\\app.ts', content: 'export {}' }])).toEqual({
      ok: true,
      files: [{ path: 'src/app.ts', content: 'export {}' }]
    });
    expect(validateSourceFiles([{ path: 'a.ts' }])).toMatchObject({ ok: false, code: 'invalidFiles' });
    expect(validateSourceFiles([
      { path: 'src\\a.ts', content: '' },
      { path: 'src/a.ts', content: '' }
    ])).toMatchObject({ ok: false, code: 'duplicateFilePath' });
  });

  it('enforces file-count and UTF-8 byte limits before parsing', () => {
    const tooMany = Array.from({ length: MAX_SOURCE_FILES + 1 }, (_, index) => ({ path: `${index}.ts`, content: '' }));
    expect(validateSourceFiles(tooMany)).toMatchObject({ ok: false, status: 413, code: 'tooManyFiles' });
    expect(validateSourceFiles([{ path: 'large.ts', content: 'é'.repeat(MAX_SOURCE_FILE_BYTES) }])).toMatchObject({
      ok: false,
      status: 413,
      code: 'sourceFileTooLarge'
    });
  });
});
