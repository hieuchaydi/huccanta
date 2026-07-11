# CLAUDE.md

Ghi chú cho AI/agent làm việc trong repo này. Đọc kỹ trước khi sửa — nhiều quy ước ở đây **không suy ra được từ code** và dễ vấp.

## Huccanta là gì

Công cụ trực quan hoá **luồng gọi hàm** của mã nguồn JavaScript/TypeScript, chạy **100% local**. Quét code → dựng call graph → chỉ ra điểm rối (vòng gọi, phức tạp cao, fan-in/out lớn) kèm hướng gỡ, vẽ thành bản đồ tương tác.

> Tên thương hiệu chuẩn hoá là **Huccanta** (2 chữ `c`). Định danh code dùng `huccanta` (db `huccanta.db`, env `HUCCANTA_DB`, package `huccanta-code-flow-visualizer`, localStorage `huccanta:*`). Không dùng lại "mach"/"Mạch" — đó là tên cũ đã bỏ.

## Lệnh thường dùng

```bash
npm install
npm run dev       # dev: server API (3030, tsx watch) + Vite UI (5173) chạy song song
npm run build     # tsc -b (type-check) && vite build → dist/
npm run start     # chạy server; nếu có dist/ thì phục vụ luôn UI trên MỘT cổng (3030)
npm run serve     # = build && start
npm run mcp       # chạy MCP server (stdio) expose analyzer cho AI agent
npx huccanta-mcp <folder>   # chạy MCP server như packet từ project bất kỳ (bin)
npm run preview   # vite preview dist/ (KHÔNG có /api → tính năng phân tích không chạy)
npm test          # vitest run (tests/analyzer.test.ts)
npx vitest        # vitest chế độ watch
```

Sau `dev` mở `http://127.0.0.1:5173`; sau `start` mở `http://127.0.0.1:3030`.

## Môi trường & biến

- **Node ≥ 22 bắt buộc** — server dùng `node:sqlite`, module built-in chỉ có từ Node 22. Node cũ sẽ vỡ runtime với `Cannot find module 'node:sqlite'`. Đã khai báo trong `package.json > engines`.
- `PORT` (mặc định `3030`) — cổng Analyzer API / server production.
- `HUCCANTA_DB` (mặc định `./huccanta.db` cạnh `server/`) — đường dẫn file SQLite.

> ⚠️ **Đổi `PORT` thì cả server lẫn Vite dev proxy cùng đọc từ `process.env.PORT`** ([vite.config.ts](vite.config.ts)). Chạy dev với PORT khác: đặt cùng một `PORT` cho cả tiến trình (concurrently kế thừa env). Đừng hardcode lại cổng ở proxy.

## Kiến trúc & luồng dữ liệu

```
UI (React/Vite, SVG) ──/api (proxy dev, cùng cổng ở prod)──▶ Analyzer API (Express)
   localStorage                                                 ts-morph → Graph JSON
 (layout, mốc, ngôn ngữ)                                        SQLite (huccanta.db)
```

- **Đa ngôn ngữ**: điểm vào phân tích của server là **`analyzeProject(files)` (async)** trong [server/analyze.ts](server/analyze.ts). Nó chia file: JS/TS → `parseSources` (ts-morph, [src/analyzer.ts](src/analyzer.ts)); Python/Java/Go/C/C++/C# → `parseTreeSitter` (tree-sitter, [server/treesitter.ts](server/treesitter.ts)); gộp lại rồi `analyzeGraph` chấm điểm chung. `analyzeSources` (JS/TS-only, sync) vẫn còn cho test/tương thích.
- **KHÔNG import `server/treesitter.ts` hay `server/analyze.ts` từ client** (`src/`) — chúng dùng WASM/`node:*`, sẽ vỡ build trình duyệt. Client chỉ gọi API; lõi tree-sitter là server-only. `src/analyzer.ts` (ts-morph) cũng chỉ server dùng.
- Ở production, [server/index.ts](server/index.ts) phát hiện `dist/` tồn tại → `express.static(dist)` + SPA fallback cho mọi path không phải `/api/`. Một cổng duy nhất.
- **Packet**: [bin/huccanta-mcp.mjs](bin/huccanta-mcp.mjs) (khai báo `bin` trong package.json) cho phép `npx huccanta-mcp <folder>` chạy MCP server từ project bất kỳ; nó đăng ký `tsx` rồi nạp `server/mcp.ts`, `argv[2]` = thư mục root mặc định.

## Bản đồ file

| File | Vai trò |
|---|---|
| [src/App.tsx](src/App.tsx) | Toàn bộ UI: toolbar, panel files/điểm rối, bản đồ SVG, inspector, fetch API, persist localStorage/IndexedDB. File lớn nhất. |
| [src/analyzer.ts](src/analyzer.ts) | ts-morph AST (JS/TS) → `parseSources` (dựng đồ thị) → `analyzeGraph` (chấm điểm, dùng chung mọi ngôn ngữ). |
| [server/analyze.ts](server/analyze.ts) | **`analyzeProject(files)` async** — điểm vào đa ngôn ngữ (JS/TS ↔ tree-sitter → gộp → `analyzeGraph`). |
| [server/treesitter.ts](server/treesitter.ts) | Parser tree-sitter WASM cho Python/Java/Go/C/C++/C#. Cấu hình mỗi ngôn ngữ ở mảng `CONFIGS`. |
| [src/layout.ts](src/layout.ts) | Bố cục node: layered (longest-path) + force. |
| [src/types.ts](src/types.ts) | **Hợp đồng dữ liệu** `Graph`/`GraphNode`/`GraphEdge`/`Issue`/`SourceFileInput`. Giữ ổn định. |
| [src/i18n.ts](src/i18n.ts) | Từ điển `vi`/`en` + `makeT(lang)` → `t(key, params)`. |
| [server/index.ts](server/index.ts) | Express routes + phục vụ dist ở prod. |
| [server/db.ts](server/db.ts) | SQLite: `listProjects`/`getProject`/`saveProject`/`deleteProject`. |
| [server/scan.ts](server/scan.ts) | Duyệt thư mục/repo, lọc file nguồn, bỏ dir rác. |
| [server/mcp.ts](server/mcp.ts) | MCP server (stdio); tool `analyze_code`/`get_function` dùng `analyzeProject` (đa ngôn ngữ). |
| [bin/huccanta-mcp.mjs](bin/huccanta-mcp.mjs) | Bin cho packet: `npx huccanta-mcp <folder>`. |
| [tests/analyzer.test.ts](tests/analyzer.test.ts), [tests/multilang.test.ts](tests/multilang.test.ts) | Unit test JS/TS + đa ngôn ngữ (`analyzeProject`). |

## Hợp đồng dữ liệu (QUAN TRỌNG)

`GraphNode`/`GraphEdge`/`Issue` trong [src/types.ts](src/types.ts) là giao kèo giữa server và UI. **Thêm field thì được, đổi tên/bỏ field thì không** (sẽ vỡ cả hai đầu).

- Điểm rối là **`node.issues: Issue[]`** — dạng **mã hoá** `{ code, value?, fix }`. Client dịch ra ngôn ngữ đang chọn qua i18n (`issue.<code>.reason` / `issue.<code>.fix`). Server **không** trả chuỗi ngôn ngữ cho điểm rối.
  - Lịch sử: từng có `node.reasons`/`node.fixes` chứa chuỗi tiếng Việt hardcode — **đã gỡ bỏ** vì trùng lặp và phá thế song ngữ. Đừng thêm lại.
- `GraphNode.id` = `file#name`, thêm hậu tố `@line` (rồi `-2`,`-3`) nếu trùng.

## Analyzer — thuật toán & ngưỡng

`parseSources`: ts-morph bắt `function decl` (mọi độ sâu), arrow/function expression gán biến, method class (`Class.method`). Resolve đích lời gọi **qua symbol** trước, fallback theo tên trong cùng file. Không tính lời gọi nằm trong hàm con (hàm con là node riêng).

`analyzeGraph` (ngưỡng cố định — chỉnh ở đây nếu cần):
- `complexity` = 1 + mỗi `if/for/for-in/for-of/while/do/case/catch/?:` + mỗi `&&`/`||`.
- Vòng gọi: **Tarjan SCC** (component > 1 hoặc self-loop) → `inCycle=true`, cạnh trong SCC → `edge.cycle=true`.
- Issue: `cycle` nếu inCycle; `complexity` nếu ≥10; `fanOut` nếu ≥5; `fanIn` nếu ≥5.
- `level` = `hot` nếu inCycle hoặc complexity≥12; `warn` nếu có issue khác; else `ok`.
- `score` = `(inCycle?100:0) + complexity*3 + fanIn + fanOut`.

## Cạm bẫy & quy ước

1. **Thêm chuỗi UI**: phải thêm **cùng key vào cả `vi` và `en`** trong [src/i18n.ts](src/i18n.ts). Thiếu key → fallback về `vi`, rồi về chính key. Tham số nội suy dạng `{name}`.
2. **Thêm lỗi API**: server trả `{ code, error }` (code là khoá ổn định); thêm bản dịch `err.<code>` vào **cả `vi` và `en`**. Client dịch qua helper `errText(error, t, fallbackKey)` trong [src/App.tsx](src/App.tsx) (ưu tiên `err.<code>`, rồi message thô, rồi fallback). Lỗi ném ra từ `postJson`/`getJson` là `ApiError` mang `code`.
3. **Dedup project trong DB**: `signatureOf(name, files)` = hash của `name` + tập path đã sort (KHÔNG gồm nội dung). Nghĩa là: quét lại cùng project (cùng tên + cùng path) → **cập nhật** bản ghi cũ; hai project khác tên → bản ghi riêng dù trùng bố cục path. Đừng đổi về dedup chỉ theo path (gây đè nhầm giữa các project).
4. **Đổi localStorage keys = mất dữ liệu người dùng cũ** (layout/mốc/ngôn ngữ). Keys hiện tại: `huccanta:layouts`, `huccanta:baselines`, `huccanta:lang`, `huccanta-current-project`.
5. **`node:sqlite` là experimental** → có `ExperimentalWarning` lúc chạy, bình thường.
6. **Giới hạn upload folder qua trình duyệt**: ~1500 file / 40MB (client, [src/App.tsx](src/App.tsx)); file > 800KB và `.d.ts` bị bỏ khi quét (server, [server/scan.ts](server/scan.ts)). Repo lớn → dùng Quét Git.
7. **`preview` không có API** — muốn thử bản build đầy đủ thì `npm run start`.
8. **MCP server ([server/mcp.ts](server/mcp.ts))** dùng stdio → **KHÔNG `console.log` ra stdout** (làm hỏng giao thức JSON-RPC); log thì dùng `console.error` (stderr). Tool tái dùng `analyzeProject` + `collectSourceFiles`, nhận `path` (thư mục) hoặc `files`. Thêm tool mới bằng `server.registerTool(name, { title, description, inputSchema }, handler)` với `inputSchema` là zod raw shape.
9. **`web-tree-sitter` GHIM ở `0.22.6`** — grammar trong `tree-sitter-wasms@0.1.13` build bằng tree-sitter 0.20, KHÔNG nạp được trên web-tree-sitter ≥0.25 (lỗi `getDylinkMetadata`). Nâng web-tree-sitter phải nâng luôn nguồn grammar cho khớp ABI. API 0.22: `import Parser`, `Parser.init()`, `Parser.Language.load(path)`, `language.query(src)`.
10. **Tree-sitter khớp lời gọi theo TÊN TRẦN** (không resolve symbol). Method có tiền tố lớp (`Class.m`) cho `node.name`, nhưng index resolve theo tên trần vì call site cũng là tên trần. Tên trùng nhiều nơi mà không cùng file → bỏ cạnh (tránh sai). Độ phức tạp cho nhóm tree-sitter là **heuristic** (đếm node type khớp `BRANCH_RE`), kém chính xác hơn JS/TS.

### Thêm một ngôn ngữ (tree-sitter)

1. Kiểm tra `node_modules/tree-sitter-wasms/out/tree-sitter-<lang>.wasm` có sẵn.
2. Thêm một mục vào mảng `CONFIGS` trong [server/treesitter.ts](server/treesitter.ts): `grammar`, `extensions`, `defTypes` (node type định nghĩa hàm), `nameQuery` (bắt `@def` + `@name`), `callQuery` (bắt `@c` = tên hàm gọi), `classTypes` (bao ngoài để tạo tiền tố).
3. Thêm đuôi file vào `SOURCE_EXT` trong [server/scan.ts](server/scan.ts) và `JS_TS` regex KHÔNG được chứa nó.
4. Viết query đúng field name của grammar — spike nhanh: `node -e` load wasm rồi `language.query(...)` (xem git history của các query hiện có làm mẫu). Thêm case vào [tests/multilang.test.ts](tests/multilang.test.ts).

## Kiểm thử MCP nhanh

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx tsx server/mcp.ts
```

## Kiểm thử

Fixture là project mẫu `auth.js/token.js/util.js`: kỳ vọng **13 hàm, 14 cạnh**, vòng `getToken ↔ refresh`. Thêm thuật toán đồ thị mới → kèm fixture + test. Test chạy môi trường `node` ([vitest.config.ts](vitest.config.ts)).

## Không commit (đã .gitignore)

`node_modules/`, `dist/`, `*.log`, `huccanta.db*`, `tsconfig.tsbuildinfo`.

## Kiểm tra nhanh sau khi sửa

```bash
npm run build && npm test         # type-check + bundle + unit test
# smoke API (đổi cổng để khỏi đụng server đang chạy):
PORT=3040 node --import tsx server/index.ts &   # rồi curl /api/health, /api/analyze
```
