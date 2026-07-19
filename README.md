# Huccanta

Công cụ kiểm tra codebase đa ngôn ngữ chạy local: JavaScript/TypeScript, Python, Java, Go, C/C++ và C#. Ngoài bản đồ hàm/file và Refactor Sandbox, source hiện có **Contract Radar** (nối HTTP client với Express/Fastify/Nest/Next route; kiểm schema/auth/status/test coverage) và **Change Contract** (kiểm snapshot trước/sau theo policy, trả PASS/FAIL/UNKNOWN + fingerprint). Dùng ngay trong UI, MCP, HTTP API hoặc CI CLI; chạy 100% trên máy bạn.

**Tiếng Việt** · **[English](README.en.md)**

![Huccanta demo — quét project, xem bản đồ hàm, trace luồng chạy và soi điểm rối](docs/demo.gif)

Huccanta quét code, dựng đồ thị lời gọi giữa các hàm, rồi chỉ ra những chỗ khó bảo trì — vòng gọi, hàm quá phức tạp, phụ thuộc chồng chéo — kèm gợi ý cách gỡ. Mọi phân tích chạy local; không có server ngoài, code không rời khỏi máy.

## Vì sao Huccanta (thay vì công cụ AI-codemap)?

Công cụ "AI codemap" (LLM đọc code rồi sinh sơ đồ/giải thích) mạnh ở phần *vẽ đẹp & mô tả*, nhưng có ba điểm yếu cố hữu: **bịa** (LLM đoán quan hệ, không chính xác 100%), **gửi code lên cloud** (nhiều đội không được phép), và **chỉ mô tả, không hành động**. Huccanta đi ngược lại:

| | Công cụ AI-codemap | **Huccanta** |
|---|---|---|
| Nguồn sự thật | LLM suy đoán (có thể bịa) | Phân tích tĩnh **tất định** (ts-morph / tree-sitter) |
| Riêng tư | Thường gửi code lên cloud | **100% local**, code không rời máy |
| Kết luận | Văn mô tả | **Bằng chứng + độ tin cậy**, không phán bừa |
| Hành động | Chỉ để xem | **Giả lập xóa/sửa → blast radius** trước khi đụng |
| Vai trò với AI | *Là* một LLM | **Công cụ cho AI agent gọi** (MCP) — cấp sự thật cho AI |

Nói ngắn: AI-codemap trả lời *"code của bạn trông thế nào"*; Huccanta trả lời ***"điều gì sẽ vỡ nếu bạn đổi nó"*** — và **không bịa, không rời máy**.

**Tính năng khác biệt (bán được):**

- **Refactor Sandbox** *(đã có)* — thử xóa file/hàm → thấy chính xác cái gì gãy + delta metric, trước khi commit. Không công cụ AI-codemap nào cho "thử refactor".
- **Contract Radar** *(đã có)* — nối các tầng không import nhau: `fetch`/Axios instance ↔ Express/Fastify plugin/NestJS/Next route; bắt endpoint, request/response field, auth, status bị lệch và route chưa có HTTP test.
- **Change Contract** *(đã có)* — agent khai báo phần được phép mất + ngân sách hồi quy; Huccanta kiểm before/after và phát chứng thư cấu trúc fail-closed có fingerprint.
- **Safe-delete có bằng chứng** *(đã có)* — dọn dead-code an toàn (độ tin cậy ≤ 85%, không phán "dead" liều).
- **Local-first** — hợp đội bảo mật / lĩnh vực bị quản: không được gửi code lên LLM cloud thì Huccanta là lựa chọn.
- **Guardrail cho code AI viết** *(đã có lõi)* — agent gọi `contract_radar` + `verify_change` qua MCP để tự kiểm route gọi hụt, import ảo và cycle mới.
- **CI gate** *(đã có)* — chặn PR làm hồi quy contract/cấu trúc theo exit code.

## So sánh với các project cùng vùng bài toán

Huccanta không cạnh tranh bằng cách tuyên bố “graph lớn hơn”. Nó chọn một điểm giao khác: **graph
để hiểu context, contract để quyết định patch có được nhận hay không**. Bảng dưới đây so sánh theo
chức năng công khai của từng project; số star chỉ là ảnh chụp tham khảo vì thay đổi theo thời gian.

| Project | GitHub stars¹ | Trọng tâm | Điểm mạnh hơn Huccanta | Khoảng Huccanta chủ động khác |
|---|---:|---|---|---|
| [CodeGraph](https://github.com/colbymchenry/codegraph) | ≈60.6k | Semantic context cho coding agent | Persistent graph, file watcher, auto-sync, nhiều ngôn ngữ/agent, impact và context retrieval; repo tự báo cáo benchmark giảm 58% tool calls | Huccanta phát hành **Change Contract** `PASS/FAIL/UNKNOWN` + fingerprint và kiểm HTTP schema/auth/status, không chỉ trả context |
| [Nx](https://github.com/nrwl/nx) | ≈29.1k | Monorepo build/CI orchestration | Cache, affected task, plugin và distributed CI | Huccanta kiểm **evidence của thay đổi**, không chạy build thay Nx |
| [Semgrep](https://github.com/semgrep/semgrep) | ≈15.9k | Pattern/SAST/SCA/secrets | Rule ecosystem, security scanning và nhiều ngôn ngữ | Huccanta nối client HTTP ↔ backend route và kiểm ý định patch; không thay security scanner |
| [CodeQL](https://github.com/github/codeql) | ≈9.8k | Semantic query/security analysis | Data-flow/query engine và security coverage sâu | Huccanta dễ đọc hơn cho agent/reviewer ở contract drift, nhưng chưa có query engine tương đương |
| [Sourcegraph](https://github.com/sourcegraph/sourcegraph-public-snapshot) | ≈10.3k | Code search/intelligence ở quy mô nhiều repo | Index/search/reference/refactor lớn, cloud/self-hosted workflow | Huccanta local snapshot-first, hướng vào guardrail của một thay đổi cụ thể |

¹ Ảnh chụp ngày 2026-07-18; star chỉ biểu thị quy mô cộng đồng, không phải thước đo chất lượng hay
độ chính xác.

### Vì sao Huccanta biết hai phía khác nhau?

Đây là phần cần phân biệt với AI-codemap hoặc một graph chỉ dựa trên tên:

1. **Nguồn sự thật là AST, không phải LLM đoán.** `ts-morph` resolve symbol JS/TS; tree-sitter
   giữ node type, owner/class, receiver và vị trí source cho các ngôn ngữ còn lại.
2. **Mọi quan hệ có rule nối cụ thể.** Ví dụ `fetch('/api/users')` chỉ match route cùng method và
   path pattern; `this.helper()` được nối vào `Class.helper`, không chọn một method `helper` ngẫu
   nhiên ở class khác.
3. **Trường hợp không chứng minh được thì không nối.** Symbol trùng tên nhưng mơ hồ bị bỏ cạnh và
   được coi là thiếu bằng chứng; output không biến phỏng đoán thành “đúng”.
4. **Contract được kiểm ở boundary, không chỉ trong graph.** Radar so request/response fields,
   Authorization, status và HTTP test observation; vì vậy client/server có thể lệch dù không có
   import trực tiếp.
5. **Thay đổi có policy và fingerprint.** `verify_change` so snapshot trước/sau theo allow-list và
   budget; `UNKNOWN` fail-closed, còn fingerprint SHA-256 ràng buộc certificate với đúng input.

Chi tiết implementation: [server/contractRadar.ts](server/contractRadar.ts),
[server/changeContract.ts](server/changeContract.ts), [server/treesitter.ts](server/treesitter.ts).

## Benchmark có thể tái chạy

Chạy:

```bash
npm run benchmark
```

Benchmark dùng fixture cố định gồm 6 ngôn ngữ (Python, Java, Go, C, C++, C#), 10 vòng đo sau 1
warm-up; báo median và p95, không đo cache warm của `analyzeProject`. Nó còn assert ground-truth cho
7 cạnh đa ngôn ngữ, 3 cạnh import Python có nhãn evidence và 5 call thiếu bằng chứng phải bị bỏ. Đây
là benchmark cục bộ cho tốc độ và
tính đúng của resolver Huccanta, **không phải** phép so sánh apples-to-apples với CodeGraph. CodeGraph tự công bố
benchmark agent-level trên 7 repo, trong đó context graph giúp giảm tool calls; cần giữ hai loại đo
này tách biệt vì một bên đo parser, một bên đo hiệu quả agent. [Xem phương pháp CodeGraph](https://github.com/colbymchenry/codegraph#benchmark-results).

Kết quả mẫu dưới đây chạy trên Windows 11 (Node v24.11.1), 10 vòng đo ngày 2026-07-18; máy khác
sẽ dao động:

| Tác vụ | Fixture | Median | P95 |
|---|---:|---:|---:|
| `parseTreeSitter` | 6 ngôn ngữ / 6 file | 2.34 ms | 2.97 ms |
| `analyzeProject` | 6 ngôn ngữ / 6 file | 1.93 ms | 2.18 ms |
| `contractRadarReport` | 1 client / 1 route | 114.59 ms | 180.01 ms |

Ground-truth hiện tại **PASS**: 7/7 cạnh đa ngôn ngữ và 3/3 cạnh import Python mong đợi, 0 cạnh ngoài
nhãn, đúng breakdown `same-file: 2` / `exact: 5` / `import: 3`; 5/5 call mơ hồ, xuyên file chỉ có tên
trần hoặc receiver ngoài chưa resolve bị bỏ. Đây là regression fixture nhỏ, không phải claim accuracy 100% cho code thực. Muốn
mở rộng coverage phải thêm nhãn
`exact`, `same-file` hoặc `ambiguous/unresolved` theo từng ngôn ngữ.

## Định hướng, dữ liệu và phạm vi Python

1. **Định hướng:** Huccanta là evidence gate chạy local cho thay đổi code; graph giải thích context,
   Contract Radar/Change Contract quyết định patch có đủ bằng chứng hay không.
2. **Database:** project **có SQLite local** để lưu thư viện project, nhưng analyzer nhận `files/path`
   và không phụ thuộc DB. Không dùng graph DB hoặc cloud DB.
3. **Roadmap:** trạng thái đã có/đang harden/tiếp theo và exit criteria được quản lý tại
   [docs/ROADMAP.md](docs/ROADMAP.md), không trộn tính năng dự kiến với tính năng đã phát hành.
4. **Python:** resolver AST hỗ trợ class owner, `self`, module-scope import/alias, relative import,
   ambiguity guard và branch types riêng. Framework semantics, wildcard/dynamic import và type
   inference cho receiver bất kỳ vẫn là giới hạn công khai.

## Giới thiệu

Đọc một codebase lạ thường tốn thời gian vì luồng chạy nằm rải rác qua nhiều file. Huccanta biến nó thành một bản đồ: mỗi hàm là một node, mỗi lời gọi là một cạnh có hướng. Từ bản đồ đó, công cụ tự đánh dấu:

- **Vòng gọi (cycle)** — A gọi B, B gọi lại A (trực tiếp hoặc gián tiếp), khiến luồng chạy quẩn.
- **Độ phức tạp cao** — hàm nhiều nhánh rẽ, khó đọc và khó test.
- **Fan-in / fan-out lớn** — quá nhiều nơi phụ thuộc vào một hàm, hoặc một hàm gọi ra quá nhiều nơi.

Click vào một node để xem code thật, danh sách hàm gọi đến / bị gọi, lý do bị đánh dấu và hướng gỡ. Bật *Trace* để tô sáng luồng chạy từ một hàm bất kỳ, hoặc đặt *mốc* rồi sửa code để so sánh trước/sau.

Nguồn code có thể là: dán trực tiếp, chọn một thư mục local, hoặc dán URL repo Git để clone và quét. Project đã quét có thể lưu lại để mở nhanh lần sau.

**Ngôn ngữ hỗ trợ:** JavaScript/TypeScript (qua ts-morph, resolve symbol chính xác) và **Python, Java, Go, C/C++, C#** (qua tree-sitter). Nhóm tree-sitter dùng resolver tĩnh bảo thủ: qualified owner/receiver hoặc symbol cùng-file duy nhất; call xuyên file chỉ có tên trần và call mơ hồ đều bị bỏ cạnh thay vì đoán.

Để tránh treo máy khi quét nhầm repo sinh code hoặc monorepo quá lớn, mỗi lượt nhận tối đa 1.500 file nguồn, 800 KB/file và 40 MB source; `node_modules`, output build/cache và `vendor` được bỏ qua.

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

Huccanta expose lõi phân tích qua **Model Context Protocol** để AI agent (Cursor, Windsurf…) gọi trực tiếp bằng ngôn ngữ tự nhiên, tái dùng đúng analyzer đa ngôn ngữ của app.

MCP server đóng gói dạng **packet dùng được từ project bất kỳ** — trỏ vào thư mục cần phân tích:

```bash
npx huccanta-mcp /đường-dẫn/tới/project   # chạy như một công cụ độc lập (stdio)
npm run mcp                                # hoặc chạy trong repo này
```

Các công cụ ([server/mcp.ts](server/mcp.ts)):

| Tool | Tác dụng |
|---|---|
| `analyze_code` | Quét `path` (thư mục local) hoặc `files`, trả tổng quan (số hàm, lời gọi, điểm rối, vòng gọi) + danh sách điểm rối xếp hạng. Nếu chạy kèm thư mục (`npx huccanta-mcp <folder>`) thì có thể bỏ trống tham số. |
| `get_function` | Chi tiết một hàm theo `id` (`file#name`): code, callers, callees, điểm rối. |
| `import_health` | **(Kiểm tra repo, JS/TS)** Báo cáo sức khoẻ import mức file: file có thể thừa (kèm bằng chứng + độ tin cậy), entry point, import tương đối gãy, thống kê. |
| `file_graph` | **(Đồ thị file, JS/TS)** Đồ thị phụ thuộc mức file: node = file, cạnh = import thật; đánh dấu vòng phụ thuộc file, phân loại entry/normal/orphan, thống kê. |
| `simulate_change` | **(Refactor Sandbox)** Giả lập xóa file/hàm mà không đụng filesystem → blast radius (nơi gọi gãy, hàm mồ côi, test liên quan) + delta metric (vòng gọi, điểm rối, fan-out). |
| `contract_radar` | **(JS/TS)** Nối HTTP client với Express/Fastify/Nest/Next route; báo route/method/schema/auth/status drift, test coverage, no-local-consumer và dynamic unknown. |
| `verify_change` | **(Change Contract, JS/TS)** So sánh `beforeFiles`/`afterFiles` theo allow-list + regression budget; trả PASS/FAIL/UNKNOWN, evidence và SHA-256 fingerprint. |

Cấu hình cho một MCP client:

```json
{
  "mcpServers": {
    "huccanta": { "command": "npx", "args": ["huccanta-mcp", "/đường-dẫn/tới/project"] }
  }
}
```

## CI contract gate

Contract Radar có CLI trả exit code thật để chặn PR:

```bash
npx huccanta-contract .                         # strict: error hoặc unknown đều fail
npx huccanta-contract --allow-unknown .         # chỉ chặn bằng chứng lỗi chắc chắn
npx huccanta-contract --before base --after head --policy contract-policy.json
```

Repo này chạy `npm run contract:check` trong GitHub Actions. Change gate dùng cùng lõi
`verify_change`; fingerprint trong output ràng buộc đúng hai snapshot và policy đã kiểm.

## Tầm nhìn: Kiểm tra codebase bằng bằng chứng

> Đây là **hướng đi**, không phải tính năng đã có. Phần trên mô tả cái đang chạy hôm nay.
> Roadmap có exit criteria và trạng thái Python: [docs/ROADMAP.md](docs/ROADMAP.md).

Mục tiêu dài hạn: không chỉ *vẽ* code mà giúp *ra quyết định sửa/xóa an toàn*. Mỗi kết luận đi kèm **bằng chứng + độ tin cậy**, không phán từ một tín hiệu duy nhất.

**Ba trụ cột đang hướng tới:**

1. **Kết luận có bằng chứng.** Ví dụ một file "có thể thừa (82%)" kèm danh sách bằng chứng: không phải entry point, không ai import, export không được dùng, vắng mặt trong route/config, không test nào gọi tới, sửa lần cuối 19 tháng trước. Không bao giờ gọi "dead" chỉ từ một tín hiệu — dead-code rất dễ sai với DI, reflection, dynamic import, route decorator.
2. **Giả lập trước khi sửa (Refactor Sandbox).** Chọn xóa file/hàm, đổi tên, di chuyển, tách nhóm → dựng "đồ thị bóng" và báo *blast radius* (import hỏng, route mất handler, test liên quan, thay đổi cycle/fan-out/complexity) mà **không đụng filesystem**, rồi mới xuất kế hoạch/patch.
3. **Static × Runtime.** Phủ luồng "đã thực sự chạy" (từ test/command) lên "có thể gọi": **xanh** = cả hai thấy · **xám** = chỉ static · **tím** = chỉ runtime (framework gọi động) · **đỏ** = import/call/route hỏng.

Kèm **Missing-code detector**: import không resolve; package import nhưng chưa khai báo; frontend gọi API không có route (và route không ai dùng); env đọc nhưng thiếu trong `.env.example`; config trỏ file không tồn tại; interface thiếu method; route không có test. Với dự án đa ngôn ngữ, nối qua **hợp đồng thực tế** thay vì đoán: `fetch("/api/users")` → route/OpenAPI → `get_users()` → bảng `users`.

**Lộ trình (MVP — JS/TS là vùng chính xác nhất, polyglot dùng resolver bảo thủ):**

- ✅ **GĐ 1 · Import Health Report** *(đã có — tool `import_health` + `POST /api/import-health`)* — file entry / có thể thừa (confidence + bằng chứng); unresolved import (bỏ qua asset); thống kê. Dựa trên import/export thật của ts-morph.
- ✅ **GĐ 2 · Đồ thị mức file** *(đã có — tool `file_graph` + `POST /api/file-graph` + toggle **Hàm | File** trên UI)* — node = file, cạnh = import/export THẬT (ts-morph, không đoán theo tên hàm); bắt **vòng phụ thuộc file** (circular import), phân loại entry/normal/orphan. HTTP route contract đã nằm ở GĐ 4; OpenAPI/DB schema còn ở roadmap sau.
- ✅ **GĐ 3 · Giả lập xóa (Refactor Sandbox)** *(đã có — tool `simulate_change` + `POST /api/simulate`)* — bỏ node khỏi đồ thị bóng, liệt kê nơi gọi gãy + hàm mồ côi + test liên quan, tính lại cycle/fan-in-out. *(Làm sớm hơn GĐ 2 vì là điểm khác biệt chủ lực.)*
- ✅ **GĐ 4 · Contract Radar** *(đã có — UI + `contract_radar` + `POST /api/contract-radar` + CI CLI)* — nối HTTP client với route source thật, kiểm schema/auth/status và phủ HTTP test observation.
- ✅ **GĐ 5 · Change Contract** *(đã có — tool `verify_change` + `POST /api/change-contract`)* — kiểm ý định patch bằng structural delta + policy fail-closed.
- 🚧 **Lớp semantic Python** — đã resolve `import`, `from ... import`, alias và relative import ở module scope với evidence `import`; framework contract FastAPI/Flask/Django và type inference vẫn là việc tiếp theo.
- **GĐ 6 · Phủ test/runtime** — khai báo lệnh (vd `npm test`) rồi phủ trace runtime lên static graph.

**Không làm:** không chạy đua 30 ngôn ngữ · không thành nền tảng Neo4j · không AI chat chung chung · không "điểm sức khỏe" bí ẩn thiếu bằng chứng · không gọi "dead" chỉ vì fan-in = 0 · không đua graph 3D.

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
  contractRadar.ts  Nối HTTP client calls ↔ backend routes từ source JS/TS
  changeContract.ts Kiểm snapshot trước/sau theo policy + phát fingerprint
  contractCli.ts    CLI fail-closed cho CI/PR gate
  treesitter.ts  Parser tree-sitter (Python/Java/Go/C/C++/C#) → đồ thị
  index.ts       Express API local; phục vụ dist/ ở production
  db.ts          Lưu project vào SQLite (node:sqlite)
  scan.ts        Quét thư mục/repo, lọc file nguồn
  mcp.ts         MCP server (stdio) expose analyzer cho AI agent
bin/
  huccanta-mcp.mjs   Lệnh `npx huccanta-mcp <folder>` để chạy MCP từ project bất kỳ
  huccanta-contract.mjs  Lệnh contract gate cho CI
tests/
  analyzer.test.ts, multilang.test.ts, contractRadar.test.ts, changeContract.test.ts
```

## Công nghệ

React 18 · TypeScript · Vite 6 · Express · ts-morph · tree-sitter (WASM) · SQLite (`node:sqlite`) · MCP SDK · Vitest.

Chi tiết kiến trúc, thuật toán và quy ước phát triển: xem [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Quy trình đóng góp & phát hành: xem [CONTRIBUTING.md](CONTRIBUTING.md).
