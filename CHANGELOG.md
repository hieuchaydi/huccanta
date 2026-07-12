# Changelog

Các thay đổi đáng chú ý của Huccanta được ghi ở đây. Theo [Keep a Changelog](https://keepachangelog.com/) và [SemVer](https://semver.org/).

## [1.0.0] — 2026-07-12

Tái định vị thành **Repo Doctor evidence-first** — *"X-ray your codebase before you touch it."* Trọng tâm chuyển từ "trực quan hoá code" sang "ra quyết định sửa/xóa an toàn, có bằng chứng".

### Đã thêm

- **Import Health Report** (Repo Doctor GĐ 1, chỉ JS/TS) — báo cáo sức khoẻ import mức file dựa trên import/export thật (ts-morph, in-memory FS): file entry / có thể thừa (kèm bằng chứng + độ tin cậy ≤ 85%), import tương đối gãy (bỏ qua asset), thống kê. Bắt cả **dynamic `import()`, `require()`, shebang** và **parse-error thật** (syntactic). Qua tool MCP `import_health` + `POST /api/import-health`.
- **Refactor Sandbox** (Repo Doctor GĐ 3) — tool `simulate_change` + `POST /api/simulate`: giả lập **xóa file/hàm** trên đồ thị bóng mà không đụng filesystem → **blast radius** (nơi gọi gãy, hàm mồ côi, test liên quan) + **delta metric** (vòng gọi, điểm rối, fan-out trước→sau).

### Lộ trình còn lại

- **GĐ 2** — Đồ thị mức file (Function | File | Contract) trong UI.
- **GĐ 4** — Phủ static × runtime (chạy test rồi tô luồng thực sự chạy).
- Định hướng khác biệt: cross-stack contract/missing-code, AI-codegen guardrail, bus-factor map — xem *Tầm nhìn* trong [README](README.md).

## [0.3.0] — 2026-07-11

Bản công khai đầu tiên trên GitHub. / First public release.

### Tính năng chính

- **Bản đồ luồng gọi hàm** tương tác (SVG): node = hàm, cạnh = lời gọi. Kéo–thả, zoom, pan, nhớ vị trí.
- **Phát hiện điểm rối**: vòng gọi (Tarjan SCC), độ phức tạp cao, fan-in/fan-out lớn — kèm hướng gỡ.
- **Truy vết luồng chạy** (Trace) từ một hàm bất kỳ, và **so sánh trước/sau** khi sửa code.
- **Nhiều nguồn**: dán code, chọn thư mục local, hoặc quét URL repo Git.
- **Lưu project** vào máy bằng SQLite (`node:sqlite`), mở lại nhanh.

### Đa ngôn ngữ

- **JavaScript/TypeScript** qua ts-morph (resolve symbol chính xác).
- **Python, Java, Go, C, C++, C#** qua tree-sitter (khớp lời gọi theo tên — heuristic).

### MCP server (packet)

- MCP server qua stdio, expose analyzer thành 2 tool: `analyze_code` và `get_function`.
- Đóng gói dùng được từ project bất kỳ: `npx huccanta-mcp <folder>`.

### Giao diện & tài liệu

- UI **song ngữ Việt/English** (nhớ lựa chọn); điểm rối & lỗi API truyền dạng mã, client tự dịch.
- README song ngữ + GIF demo, CLAUDE.md cho người phát triển, giấy phép MIT, CI (GitHub Actions).

### Hiệu năng

- Tái dùng một Parser tree-sitter + cache Query theo ngôn ngữ (không rò rỉ heap WASM khi chạy dài).
- Cache kết quả phân tích theo chữ ký nội dung để không parse lại project mỗi lần.

### Yêu cầu

- **Node.js ≥ 22** (server dùng `node:sqlite`).

### Giới hạn đã biết

- Với nhóm tree-sitter, lời gọi khớp theo tên và độ phức tạp là heuristic — kém chính xác hơn JS/TS.
- File `.h` được phân tích bằng grammar C nên có thể bỏ sót cấu trúc C++.

[1.0.0]: https://github.com/hieuchaydi/huccanta/releases/tag/v1.0.0
[0.3.0]: https://github.com/hieuchaydi/huccanta/releases/tag/v0.3.0
