# Đặc tả · GĐ 2 — Đồ thị mức file (File-level graph)

> Trạng thái: **✅ đã implement** (commit theo §10). Giữ tài liệu này làm đặc tả tham chiếu. Bám sát
> [docs/ARCHITECTURE.md](../ARCHITECTURE.md) và các quy ước trong đó — nhiều ràng buộc **không suy ra được từ code**.

## 0. Bối cảnh & mục tiêu

Hôm nay Huccanta chỉ có **một mức đồ thị**: mức **hàm** (`analyzeProject` → `Graph` gồm node = hàm,
edge = lời gọi). Lộ trình kiểm tra codebase (README, mục *Lộ trình*) cần thêm **mức file**:

- Node = **file**; edge = **quan hệ import/export THẬT giữa các file** (không đoán theo tên hàm).
- Chỉ **JS/TS** (để chính xác) — giống GĐ 1 Import Health. File ngôn ngữ khác bị bỏ qua.
- Tái dùng đúng cơ chế phân giải import đã có trong [server/importHealth.ts](../../server/importHealth.ts)
  (ts-morph in-memory FS: import tĩnh + re-export + dynamic `import()` + `require()`).

Kết quả cho phép: nhìn kiến trúc ở mức module, thấy **vòng phụ thuộc giữa file** (circular imports),
**file god-node** (quá nhiều file import vào / import ra), và là nền cho GĐ 4 (phủ runtime) + chế độ Contract.

### Phạm vi (in-scope)

1. Module builder `server/fileGraph.ts` → `fileGraphReport(files): FileGraph` (deterministic).
2. Kiểu dữ liệu `FileGraph` trong [src/types.ts](../../src/types.ts).
3. HTTP endpoint `POST /api/file-graph`.
4. MCP tool `file_graph` trong [server/mcp.ts](../../server/mcp.ts).
5. UI: toggle **Function | File** trên toolbar để xem đồ thị ở hai mức (Part B, xem §6).
6. Test: [tests/fileGraph.test.ts](../../tests/fileGraph.test.ts).
7. i18n + README/ARCHITECTURE cập nhật.

### Ngoài phạm vi (KHÔNG làm trong GĐ này)

- Chế độ **Contract** (route/OpenAPI/DB) — là GĐ riêng, cần parser route. Chỉ để chỗ trống trong
  enum `viewMode` của UI, **không** implement.
- Đa ngôn ngữ mức file (tree-sitter). File không phải JS/TS chỉ bị lọc bỏ, không báo lỗi.
- Sửa/di chuyển file (đó là Refactor Sandbox mở rộng, không thuộc GĐ 2).

## 1. Hợp đồng dữ liệu (thêm vào [src/types.ts](../../src/types.ts))

**Chỉ THÊM field/type mới — không đổi tên/bỏ field cũ** (quy ước "Hợp đồng dữ liệu", ARCHITECTURE §Hợp đồng).

```ts
// ---- GĐ 2: Đồ thị mức file (dựa trên import/export thật, chỉ JS/TS) ----
export type FileNodeKind = 'entry' | 'normal' | 'orphan';
// orphan = không ai import & không phải entry (đồng bộ với 'possibly-unused' của Import Health)

export interface FileGraphNode {
  id: string;        // = path đã normalize (vd "src/auth.ts"). Ổn định, khớp FileHealth.path.
  path: string;      // = id (giữ cả hai cho tiện đọc phía UI)
  label: string;     // tên hiển thị ngắn: basename, hoặc "dir/basename" nếu trùng basename
  kind: FileNodeKind;
  imports: number;   // outbound: số file khác file này import (dedup)
  importedBy: number;// inbound: số file import file này
  exports: number;   // số symbol export
  loc: number;       // số dòng (đếm '\n' + 1) — để ước lượng "kích thước" node
  inCycle: boolean;  // nằm trong vòng phụ thuộc file (import cycle)
  unresolved: number;// số import tương đối gãy (từ file này)
}

export interface FileGraphEdge {
  from: string;      // id file import
  to: string;        // id file bị import
  cycle: boolean;    // cạnh nằm trong một vòng phụ thuộc (SCC)
}

export interface FileGraph {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
  summary: {
    files: number;
    edges: number;
    cycles: number;        // số SCC có kích thước > 1 (hoặc self-loop)
    filesInCycle: number;  // số file thuộc một vòng phụ thuộc
    entries: number;
    orphans: number;
    unresolvedImports: number;
  };
}
```

## 2. Builder — `server/fileGraph.ts`

### 2.1 Nguyên tắc

- **Deterministic, local, không cloud** — như importHealth. Không đụng `node_modules` host
  (dùng ts-morph in-memory FS). Sắp xếp mọi output để ổn định giữa các lần chạy.
- **Tái dùng logic phân giải import của importHealth.** KHÔNG copy-paste rời rạc: refactor phần
  "dựng danh sách file input → resolve targets/unresolved cho mỗi file" thành một hàm dùng chung.

### 2.2 Refactor bắt buộc (chống trùng lặp)

Trích phần lõi của [server/importHealth.ts](../../server/importHealth.ts) thành module chia sẻ
`server/moduleGraph.ts` (tên gợi ý) export một hàm:

```ts
export interface FileDeps {
  path: string;                 // normalized
  parseError?: string;          // set nếu có syntactic diagnostics / lỗi tạo source file
  shebang: boolean;
  exports: number;
  targets: string[];            // path (normalized) các file trong project mà file này phụ thuộc, dedup + sort
  unresolvedImports: string[];  // specifier tương đối gãy (không phải asset), sort
}

// Dựng ts-morph in-memory, resolve import tĩnh/re-export/dynamic import()/require() giống hệt
// importHealth hiện tại. Trả map path -> FileDeps. importedBy KHÔNG tính ở đây (mỗi consumer tự tính).
export function collectFileDeps(files: SourceFileInput[]): FileDeps[];
```

Sau đó **viết lại `importHealthReport` để dùng `collectFileDeps`** (giữ nguyên output/kiểu
`ImportHealthReport` — test GĐ 1 phải vẫn xanh) và `fileGraphReport` cũng dùng chung hàm này.
Các hằng regex (`JS_TS`, `TYPE_DECL`, `ASSET_EXT`, `ENTRY_NAME`, …), `normalizePath`, `isRelative`,
`resolveRelative` chuyển vào module chia sẻ; import lại từ đó ở cả hai chỗ.

> Lý do: `entryReason`/verdict là *chính sách* của Import Health, còn *đồ thị phụ thuộc thô* là dữ
> liệu chung. Tách đúng chỗ này để hai tính năng không trôi lệch nhau.

### 2.3 Thuật toán `fileGraphReport`

1. `deps = collectFileDeps(files)`; bỏ file `parseError` khỏi **node**? → **KHÔNG bỏ**: vẫn tạo node
   (kind `normal`) nhưng `exports=0`, không có cạnh ra. (Đơn giản, khỏi mất file khỏi bản đồ.)
   `unresolved` vẫn đếm từ `unresolvedImports`.
2. Node: mỗi `FileDeps` → một `FileGraphNode`. `loc` = đếm dòng nội dung gốc (map path→content).
3. Edge: với mỗi `dep`, mỗi `target` → `{ from: dep.path, to: target, cycle: false }`. Chỉ tạo cạnh
   khi `target` là một node có thật (nó luôn thật vì `targets` chỉ chứa file trong input). **Bỏ self-edge**
   (`from === to`) khỏi danh sách cạnh nhưng vẫn cho phép self-loop đánh dấu `inCycle` (xem bước 5).
4. `importedBy` = đếm inbound theo `to`. `imports` = `dep.targets.length`.
5. **Vòng phụ thuộc**: chạy **Tarjan SCC** trên đồ thị file (tái dùng thuật toán SCC đã có ở
   [src/analyzer.ts](../../src/analyzer.ts) `analyzeGraph` — trích ra hàm `tarjanSCC(nodes, edges)` dùng
   chung nếu tiện, hoặc viết gọn tại chỗ; ưu tiên tái dùng). Một node `inCycle=true` nếu thuộc SCC
   kích thước > 1 **hoặc** có self-loop (file tự import — hiếm, nhưng đánh dấu). Cạnh có cả `from` và
   `to` cùng một SCC (size>1) → `cycle=true`.
6. **kind** của node:
   - `entry` nếu `entryReason(path, shebang)` (dùng lại hàm của Import Health) trả về khác `undefined`.
   - `orphan` nếu không phải entry **và** `importedBy === 0`.
   - còn lại `normal`.
7. **label**: basename (phần sau `/` cuối). Nếu ≥2 file khác path trùng basename → dùng
   `parentDir/basename` để phân biệt. Deterministic.
8. `summary`: đếm theo định nghĩa ở §1 (`cycles` = số SCC size>1 hoặc self-loop).
9. **Sắp xếp** trước khi trả:
   - `nodes`: theo `inCycle` giảm dần, rồi `importedBy` giảm, rồi `path` tăng (localeCompare).
   - `edges`: theo `from` rồi `to` (localeCompare) — ổn định, dễ so trong test.

### 2.4 Ràng buộc kỹ thuật

- **Path normalize**: ts-morph in-memory trả path có `/` đầu → `normalizePath` bỏ `/` đầu để khớp key
  input (đúng như importHealth §ARCHITECTURE). `id`/`path` trong output là dạng đã normalize, **không** có
  `/` đầu.
- Module này là **server-only** (ts-morph, `node:*`). **KHÔNG được import từ `src/` client** (sẽ vỡ build
  trình duyệt — ARCHITECTURE §Kiến trúc). UI chỉ gọi qua `/api/file-graph`.

## 3. HTTP API — [server/index.ts](../../server/index.ts)

Thêm route, đặt ngay cạnh `/api/import-health`, cùng khuôn xử lý lỗi:

```ts
app.post('/api/file-graph', (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  try {
    res.json(fileGraphReport(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});
```

Dùng lại mã lỗi `missingFiles` / `analyzeFailed` đã có (không thêm mã mới → khỏi phải thêm bản dịch lỗi).

## 4. MCP tool — [server/mcp.ts](../../server/mcp.ts)

Thêm tool `file_graph`, khuôn giống `import_health` (nhận `sourceShape` = `path` thư mục hoặc `files`):

```ts
server.registerTool(
  'file_graph',
  {
    title: 'File dependency graph',
    description:
      'Đồ thị file (chỉ JS/TS): đồ thị phụ thuộc MỨC FILE dựa trên import/export THẬT ' +
      '(ts-morph, không đoán theo tên). Node = file, cạnh = quan hệ import. Trả node (entry/normal/orphan, ' +
      'imports/importedBy/exports/loc, inCycle), cạnh (đánh dấu cycle) và thống kê (vòng phụ thuộc, orphan…). ' +
      'Nhận "path" (thư mục) hoặc "files".',
    inputSchema: { ...sourceShape }
  },
  async ({ path, files }) => {
    return json(fileGraphReport(await loadFiles({ path, files })));
  }
);
```

Nhớ: MCP dùng stdio → **không `console.log` ra stdout**. Bump `version` của `McpServer` (0.2.0 → 0.3.0).

## 5. Test — [tests/fileGraph.test.ts](../../tests/fileGraph.test.ts)

Môi trường `node` (đã cấu hình ở [vitest.config.ts](../../vitest.config.ts)). Viết fixture in-memory
(không đọc filesystem). Các case tối thiểu:

1. **Chuỗi tuyến tính**: `a.ts` import `b.ts` import `c.ts`.
   - 3 node, 2 cạnh; không cycle; `a` là orphan? → `a` không ai import & không phải entry → `orphan`.
     `index.ts` sẽ là entry — dùng tên `main.ts` cho gốc để test cả entry: đặt gốc là `main.ts`
     (khớp `ENTRY_NAME`) → `kind === 'entry'`, `importedBy(c)===1`, `imports(main)===1`.
2. **Vòng phụ thuộc file**: `x.ts` import `y.ts`, `y.ts` import `x.ts`.
   - cả hai `inCycle===true`; 2 cạnh đều `cycle===true`; `summary.cycles===1`, `filesInCycle===2`.
3. **Import gãy**: file import `'./khong-ton-tai'` → `unresolved===1`, `summary.unresolvedImports>=1`;
   import asset `'./styles.css'` KHÔNG tính gãy.
4. **dynamic import/require** vẫn tạo cạnh (khớp hành vi importHealth).
5. **Không hồi quy GĐ 1**: import [tests/…]/importHealth và assert vài field vẫn đúng sau refactor
   (hoặc chạy lại test importHealth hiện có — nếu chưa có file test riêng cho importHealth, thêm 1 case
   khẳng định `importHealthReport` vẫn cho verdict entry/possibly-unused như trước cho cùng fixture).

Chạy `npm test` phải xanh toàn bộ (kể cả test cũ).

## 6. Part B — UI toggle Function | File ([src/App.tsx](../../src/App.tsx))

> Nếu tách PR: Part A (§1–5, backend + MCP + API + test) là MVP giao được độc lập, giống cách GĐ 1/GĐ 3
> ship backend trước. Part B thêm UI. Có thể làm cùng lượt.

- Thêm state `const [viewMode, setViewMode] = useState<'function' | 'file'>('function')`.
  (Chừa sẵn `'contract'` trong union kiểu để tương lai, nhưng **không** render nút Contract.)
- Toolbar: thêm cụm nút **Function | File** (dùng key i18n mới, xem §7). Đặt gần nút `Layout`/`group`.
- Khi `viewMode === 'file'` và đã có `sourceFiles`: gọi `postJson<FileGraph>('/api/file-graph', { files: sourceFiles })`,
  rồi **map `FileGraph` → `Graph`** để tái dùng nguyên bộ layout + render SVG hiện có, **hoặc** render
  riêng. Ưu tiên map sang `Graph` tối thiểu để đỡ đụng renderer:
  - `GraphNode`: `id=path`, `name=label`, `file=path`, `line=1`, `code=''`, `body=''`,
    `complexity=imports+importedBy` (tạm, để có kích thước), `fanIn=importedBy`, `fanOut=imports`,
    `inCycle`, `issues=[]`, `level = inCycle?'hot': (kind==='orphan'?'warn':'ok')`, `score=importedBy*2+imports`.
  - `GraphEdge`: `{ from, to, cycle }`.
  - Lưu ý: inspector panel (code hàm, caller/callee) sẽ trống ở file-mode — chấp nhận, hoặc hiển thị
    danh sách file import/được-import từ `FileGraph` gốc. Tối thiểu: không crash khi click node file.
- Chỉ JS/TS: nếu project có file không JS/TS, file-mode chỉ hiện các file JS/TS (đúng theo builder). Không cần cảnh báo.
- Chuyển mode phải **không phân tích lại mức hàm** không cần thiết — cache `Graph` mức hàm; fetch file-graph
  chỉ khi lần đầu vào file-mode hoặc khi `sourceFiles` đổi.

Giữ đúng quy ước i18n: **mọi chuỗi mới thêm cùng key vào cả `vi` và `en`** trong [src/i18n.ts](../../src/i18n.ts).

## 7. i18n — [src/i18n.ts](../../src/i18n.ts)

Thêm cùng key vào **cả hai** từ điển `vi` và `en`:

| key | vi | en |
|---|---|---|
| `view.function` | `Hàm` | `Function` |
| `view.file` | `File` | `File` |
| `view.title` | `Mức đồ thị: hàm hay file` | `Graph level: function or file` |
| `view.file.title` | `Đồ thị phụ thuộc mức file (import/export thật)` | `File dependency graph (real imports)` |
| `filegraph.orphan` | `mồ côi` | `orphan` |
| `filegraph.entry` | `entry` | `entry` |

(Thêm/bớt key tuỳ chỗ dùng thật; nguyên tắc: **không để lệch giữa `vi` và `en`**.)

## 8. Tài liệu

- **[README.md](../../README.md) + [README.en.md](../../README.en.md)**: đánh dấu GĐ 2 là ✅ trong mục *Lộ trình*;
  thêm dòng tool `file_graph` vào bảng MCP; nhắc endpoint `POST /api/file-graph`.
- **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**: thêm dòng vào *Bản đồ file* cho `server/fileGraph.ts` và
  `server/moduleGraph.ts`; một mục ngắn "GĐ 2 · File graph" giải thích việc tách `collectFileDeps` dùng chung
  với Import Health và ràng buộc server-only.

## 9. Tiêu chí nghiệm thu (Definition of Done)

- [ ] `npm run build` (tsc -b + vite) không lỗi type; `npm test` xanh (gồm test GĐ 1 cũ + test GĐ 2 mới).
- [ ] `POST /api/file-graph` với `{ files }` trả `FileGraph` đúng schema §1.
- [ ] MCP: `tools/list` có `file_graph`; gọi nó trên một thư mục JS/TS trả JSON đồ thị file. (Kiểm bằng
      lệnh stdio ở ARCHITECTURE §"Kiểm thử MCP nhanh".)
- [ ] `importHealthReport` **không đổi output** sau refactor (không hồi quy GĐ 1).
- [ ] Vòng phụ thuộc file được đánh dấu đúng (`inCycle`, `edge.cycle`, `summary.cycles`).
- [ ] UI: toggle Function↔File hoạt động, file-mode vẽ được đồ thị, click node không crash.
- [ ] i18n: không có key nào chỉ có ở một ngôn ngữ.
- [ ] README (vi+en) và ARCHITECTURE cập nhật.

## 10. Gợi ý commit (theo lịch sử repo)

- `refactor: tách collectFileDeps dùng chung cho Import Health`
- `feat: GĐ 2 · File dependency graph (fileGraphReport + /api/file-graph + MCP file_graph)`
- `feat(ui): toggle Function | File mức đồ thị`
- `docs: đánh dấu GĐ 2 xong, cập nhật bảng MCP + ARCHITECTURE`
