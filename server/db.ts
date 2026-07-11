import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceFileInput } from '../src/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.HUCCANTA_DB ?? path.join(here, '..', 'huccanta.db');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    source      TEXT NOT NULL,
    signature   TEXT NOT NULL,
    file_count  INTEGER NOT NULL,
    node_count  INTEGER NOT NULL,
    files       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

export interface ProjectMeta {
  id: string;
  name: string;
  source: string;
  fileCount: number;
  nodeCount: number;
  updatedAt: string;
}
export interface ProjectFull extends ProjectMeta {
  files: SourceFileInput[];
}

// Chữ ký nhận diện "cùng một project" để import lại thì cập nhật thay vì nhân đôi.
// Gồm tên + tập đường dẫn file (đã sort) — KHÔNG chỉ dựa vào đường dẫn, vì hai project
// khác nhau có thể trùng bố cục path tương đối (vd cùng có src/index.ts) và sẽ đè lên nhau.
// Cố ý bỏ qua nội dung file: sửa code rồi quét lại cùng project vẫn cập nhật đúng bản ghi cũ.
function signatureOf(name: string, files: SourceFileInput[]) {
  const paths = [...new Set(files.map((file) => file.path))].sort().join('|');
  return createHash('sha1').update(name).update('\0').update(paths).digest('hex');
}

export function listProjects(): ProjectMeta[] {
  const rows = db
    .prepare('SELECT id, name, source, file_count, node_count, updated_at FROM projects ORDER BY updated_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    source: String(row.source),
    fileCount: Number(row.file_count),
    nodeCount: Number(row.node_count),
    updatedAt: String(row.updated_at)
  }));
}

export function getProject(id: string): ProjectFull | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    source: String(row.source),
    fileCount: Number(row.file_count),
    nodeCount: Number(row.node_count),
    updatedAt: String(row.updated_at),
    files: JSON.parse(String(row.files)) as SourceFileInput[]
  };
}

export function saveProject(input: {
  name: string;
  source: string;
  files: SourceFileInput[];
  nodeCount: number;
}): ProjectMeta {
  const signature = signatureOf(input.name, input.files);
  const now = new Date().toISOString();
  // Một bộ file (signature) chỉ giữ một bản ghi — import lại sẽ cập nhật thay vì nhân đôi.
  const existing = db.prepare('SELECT id, created_at FROM projects WHERE signature = ?').get(signature) as
    | Record<string, unknown>
    | undefined;
  const id = existing ? String(existing.id) : randomUUID();
  const createdAt = existing ? String(existing.created_at) : now;

  db.prepare(
    `INSERT INTO projects (id, name, source, signature, file_count, node_count, files, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       source = excluded.source,
       signature = excluded.signature,
       file_count = excluded.file_count,
       node_count = excluded.node_count,
       files = excluded.files,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.name,
    input.source,
    signature,
    input.files.length,
    input.nodeCount,
    JSON.stringify(input.files),
    createdAt,
    now
  );

  return {
    id,
    name: input.name,
    source: input.source,
    fileCount: input.files.length,
    nodeCount: input.nodeCount,
    updatedAt: now
  };
}

export function deleteProject(id: string) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
