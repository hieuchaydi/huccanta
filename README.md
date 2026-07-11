# Huccanta

Công cụ trực quan hoá luồng gọi hàm cho mã nguồn JavaScript/TypeScript, chạy 100% trên máy bạn.

**Tiếng Việt** · **[English](README.en.md)**

![Huccanta demo — quét project, xem bản đồ hàm, trace luồng chạy và soi điểm rối](docs/demo.gif)

Huccanta quét code, dựng đồ thị lời gọi giữa các hàm, rồi chỉ ra những chỗ khó bảo trì — vòng gọi, hàm quá phức tạp, phụ thuộc chồng chéo — kèm gợi ý cách gỡ. Mọi phân tích chạy local; không có server ngoài, code không rời khỏi máy.

## Giới thiệu

Đọc một codebase lạ thường tốn thời gian vì luồng chạy nằm rải rác qua nhiều file. Huccanta biến nó thành một bản đồ: mỗi hàm là một node, mỗi lời gọi là một cạnh có hướng. Từ bản đồ đó, công cụ tự đánh dấu:

- **Vòng gọi (cycle)** — A gọi B, B gọi lại A (trực tiếp hoặc gián tiếp), khiến luồng chạy quẩn.
- **Độ phức tạp cao** — hàm nhiều nhánh rẽ, khó đọc và khó test.
- **Fan-in / fan-out lớn** — quá nhiều nơi phụ thuộc vào một hàm, hoặc một hàm gọi ra quá nhiều nơi.

Click vào một node để xem code thật, danh sách hàm gọi đến / bị gọi, lý do bị đánh dấu và hướng gỡ. Bật *Trace* để tô sáng luồng chạy từ một hàm bất kỳ, hoặc đặt *mốc* rồi sửa code để so sánh trước/sau.

Nguồn code có thể là: dán trực tiếp, chọn một thư mục local, hoặc dán URL repo Git để clone và quét. Project đã quét có thể lưu lại để mở nhanh lần sau.

**Ngôn ngữ hỗ trợ:** JavaScript/TypeScript (qua ts-morph, resolve symbol chính xác) và **Python, Java, Go, C/C++, C#** (qua tree-sitter). Với nhóm tree-sitter, lời gọi được khớp theo tên hàm (heuristic) nên kém chính xác hơn JS/TS.

## Yêu cầu

- **Node.js ≥ 22** (server dùng `node:sqlite`, module built-in chỉ có từ Node 22).
- Git — chỉ cần nếu dùng tính năng quét repo qua URL.

## Cài đặt & chạy

```bash
npm install
npm run dev
```

`npm run dev` chạy song song hai tiến trình local: UI (Vite) ở cổng `5173` và Analyzer API (Express) ở cổng `3030`. Mở `http://127.0.0.1:5173`.

Bản production gộp cả hai vào một cổng:

```bash
npm run build     # type-check + bundle vào dist/
npm run start     # server phục vụ luôn UI + API tại http://127.0.0.1:3030
npm test          # chạy unit test (vitest)
```

Có thể đổi cổng API bằng biến `PORT`, và vị trí file SQLite bằng `HUCCANTA_DB`.

## Sử dụng

1. Bấm **Project** để dán code / URL Git, hoặc **Folder** để chọn thư mục. Lần đầu mở có sẵn project mẫu.
2. Đọc bản đồ: viền đỏ = trong vòng gọi, vàng = cần lưu ý, xanh = ổn.
3. Click một node để mở panel code, caller/callee, lý do và hướng gỡ.
4. Bật **Trace** rồi chọn một hàm để xem luồng chạy; chỉnh độ sâu bằng thanh trượt.
5. Đặt **mốc**, sửa code, phân tích lại để xem thay đổi về điểm rối và độ phức tạp.
6. Bấm **Lưu** để cất project vào máy; mở lại từ danh sách *Project đã lưu*.

## Đa ngôn ngữ (i18n)

Giao diện hỗ trợ **tiếng Việt** và **tiếng Anh**, chuyển bằng nút VI/EN trên toolbar. Lựa chọn được nhớ giữa các lần mở.

Cơ chế i18n gọn, tự viết, không phụ thuộc thư viện ngoài — ở [src/i18n.ts](src/i18n.ts):

- Mỗi ngôn ngữ là một từ điển phẳng `key → chuỗi`. `makeT(lang)` trả về hàm dịch `t(key, params?)`.
- Nội suy tham số theo cú pháp `{tên}`:

  ```ts
  const t = makeT('vi');
  t('status.result', { label: 'auth', nodes: 13, edges: 14 });
  // → "auth: 13 hàm, 14 lời gọi"
  ```

- Thiếu key ở ngôn ngữ đang chọn sẽ **fallback về tiếng Việt**, rồi cuối cùng trả về chính `key` (không bao giờ crash vì thiếu chuỗi).

Một điểm thiết kế quan trọng: **server không trả chuỗi đã dịch**. Điểm rối và lỗi API được truyền ở dạng **mã** (`issue.<code>`, `err.<code>`), client mới dịch ra ngôn ngữ đang chọn. Nhờ vậy đổi ngôn ngữ không cần phân tích lại.

**Thêm một chuỗi mới:** thêm cùng một `key` vào **cả hai** từ điển `vi` và `en`, rồi dùng `t('key')`.
**Thêm một ngôn ngữ:** thêm mã vào `type Lang` + mảng `LANGS`, tạo từ điển mới (copy đủ key của `vi`) rồi đăng ký vào `dict`.

## MCP server

Huccanta expose lõi phân tích qua **Model Context Protocol** để AI agent (Claude Code, Cursor…) gọi trực tiếp bằng ngôn ngữ tự nhiên, tái dùng đúng analyzer đa ngôn ngữ của app.

MCP server đóng gói dạng **packet dùng được từ project bất kỳ** — trỏ vào thư mục cần phân tích:

```bash
npx huccanta-mcp /đường-dẫn/tới/project   # chạy như một công cụ độc lập (stdio)
npm run mcp                                # hoặc chạy trong repo này
```

Hai công cụ ([server/mcp.ts](server/mcp.ts)):

| Tool | Tác dụng |
|---|---|
| `analyze_code` | Quét `path` (thư mục local) hoặc `files`, trả tổng quan (số hàm, lời gọi, điểm rối, vòng gọi) + danh sách điểm rối xếp hạng. Nếu chạy kèm thư mục (`npx huccanta-mcp <folder>`) thì có thể bỏ trống tham số. |
| `get_function` | Chi tiết một hàm theo `id` (`file#name`): code, callers, callees, điểm rối. |

Cấu hình cho một MCP client (ví dụ Claude Code):

```json
{
  "mcpServers": {
    "huccanta": { "command": "npx", "args": ["huccanta-mcp", "/đường-dẫn/tới/project"] }
  }
}
```

## Cấu trúc thư mục

```text
src/
  App.tsx        UI: toolbar, panel files/điểm rối, bản đồ SVG, inspector
  analyzer.ts    Parse AST (ts-morph) → đồ thị + chấm điểm rối (SCC, complexity, fan-in/out)
  layout.ts      Bố cục phân tầng / phóng xạ
  types.ts       Hợp đồng dữ liệu Graph / Node / Edge / Issue
  i18n.ts        Từ điển Việt/English + hàm dịch
server/
  analyze.ts     Điểm vào đa ngôn ngữ: chia JS/TS ↔ tree-sitter rồi gộp + chấm điểm
  treesitter.ts  Parser tree-sitter (Python/Java/Go/C/C++/C#) → đồ thị
  index.ts       Express API local; phục vụ dist/ ở production
  db.ts          Lưu project vào SQLite (node:sqlite)
  scan.ts        Quét thư mục/repo, lọc file nguồn
  mcp.ts         MCP server (stdio) expose analyzer cho AI agent
bin/
  huccanta-mcp.mjs   Lệnh `npx huccanta-mcp <folder>` để chạy MCP từ project bất kỳ
tests/
  analyzer.test.ts, multilang.test.ts
```

## Công nghệ

React 18 · TypeScript · Vite 6 · Express · ts-morph · tree-sitter (WASM) · SQLite (`node:sqlite`) · MCP SDK · Vitest.

Chi tiết kiến trúc, thuật toán và quy ước phát triển: xem [CLAUDE.md](CLAUDE.md). Quy trình đóng góp & phát hành: xem [CONTRIBUTING.md](CONTRIBUTING.md).
