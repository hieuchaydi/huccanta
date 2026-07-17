# Định hướng sản phẩm và roadmap

Cập nhật: 2026-07-18.

Tài liệu này tách rõ ba thứ thường bị trộn với nhau: **hướng đi dài hạn**, **phần đã chạy hôm nay**
và **việc dự kiến làm tiếp**. Một mục chỉ được đánh dấu hoàn tất khi code, test và tài liệu cùng có.

## 1. Định hướng sản phẩm

North star của Huccanta là **evidence gate cho thay đổi code chạy local**:

> Graph giúp agent/developer hiểu context; contract quyết định một patch có đủ bằng chứng để nhận hay
> không.

Vì vậy Huccanta không chạy đua làm graph lớn nhất hoặc hỗ trợ nhiều ngôn ngữ bằng mọi giá. Thứ tự ưu
tiên là:

1. Không biến suy đoán thành sự thật: thiếu bằng chứng phải là `unknown/unresolved`.
2. Mỗi verdict phải truy ngược được về file, symbol, route, policy hoặc test observation.
3. Mọi gate phải tái chạy được ở CLI/CI và trả exit code ổn định.
4. Source code, graph và snapshot mặc định ở local; không phụ thuộc cloud LLM.

## 2. Ranh giới dữ liệu và database

Huccanta **có database**, nhưng analyzer **không phụ thuộc database để phân tích**.

| Thành phần | Trạng thái | Vai trò |
|---|---|---|
| SQLite `huccanta.db` | Đã có | Thư viện project đã lưu: metadata và snapshot file để mở lại |
| `HUCCANTA_DB` | Đã có | Cho phép đổi vị trí SQLite local |
| API/MCP analyzer | Stateless theo request | Nhận `files`/`path`, dựng graph trong bộ nhớ; không cần record DB |
| Graph database/Neo4j | Không dùng | Không đưa thêm hạ tầng chỉ để lưu call graph hiện tại |
| Cloud database | Không dùng | Giữ cam kết local-first |

DB hiện có một bảng `projects`; implementation nằm ở [`server/db.ts`](../server/db.ts). File DB là dữ
liệu người dùng, đã bị loại khỏi Git và không được commit.

## 3. Roadmap phát triển

Không gắn ngày giả khi chưa có capacity. Mỗi chặng dùng **exit criteria** để biết thật sự hoàn thành.

| Trạng thái | Chặng | Kết quả cần đạt | Exit criteria |
|---|---|---|---|
| ✅ Đã có | Repo understanding | Function graph, File Graph, Import Health, Refactor Sandbox | Build/test xanh; evidence có source location |
| ✅ Đã có | Change guardrails | Contract Radar + Change Contract qua UI/API/MCP/CLI/CI | `PASS/FAIL/UNKNOWN`, policy và fingerprint cùng dùng một core |
| 🚧 Đang harden | Polyglot evidence | Resolver AST bảo thủ cho Python/Java/Go/C/C++/C# | Không nối bare-name xuyên file; benchmark ground-truth theo từng grammar |
| Tiếp theo | Python semantic layer | Resolve `import`/`from ... import`, alias/module scope; FastAPI/Flask/Django contracts | Fixture nhiều file có precision/recall và không giảm guard ambiguity |
| Tiếp theo | Test/runtime overlay | Phủ call thực tế từ test/command lên static graph | Static-only/runtime-only/both có provenance và command fingerprint |
| Sau đó | Contract sources | OpenAPI và DB/schema migration nối với client/route | Drift có source evidence; dynamic case đi vào `unknown` |

Khi thêm một chặng, PR phải cập nhật bảng này, README và test/benchmark liên quan. Không đánh dấu ✅
chỉ vì có mockup hoặc interface chưa được nối vào sản phẩm.

## 4. Trạng thái Python

Python (`.py`, `.pyi`) đã đi qua tree-sitter resolver mới, không còn dùng fallback “tên duy nhất toàn
project”. Phần đã có:

- định nghĩa hàm/method và owner class;
- `self.method()` được resolve về đúng class với evidence `exact`;
- call top-level duy nhất trong cùng file có evidence `same-file`;
- call tên trần xuyên file, receiver ngoài chưa biết type và tên mơ hồ đều để unresolved;
- complexity dùng node type Python tường minh: `if/elif`, loop/comprehension, `while`, `except`,
  `match/case`, conditional expression và boolean operator.

Phần **chưa có** và không được overclaim:

- import graph/alias Python xuyên module;
- type inference cho receiver bất kỳ;
- decorator/framework semantics cho FastAPI, Flask và Django;
- runtime dispatch, monkey patching và reflection.

Do đó Python hiện ưu tiên **precision trước recall**: thà thiếu cạnh có ghi rõ giới hạn còn hơn vẽ cạnh
sai. Các case owner, ambiguity, cross-file và complexity phải được khóa trong
[`tests/multilang.test.ts`](../tests/multilang.test.ts) và benchmark ground-truth.
