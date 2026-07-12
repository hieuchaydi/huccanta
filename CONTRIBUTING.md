# Đóng góp & phát hành

Hướng dẫn phát triển, kiểm tra và ra bản mới cho Huccanta. Xem [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) cho kiến trúc và quy ước code chi tiết.

## Chuẩn bị

- **Node.js ≥ 22** (server dùng `node:sqlite`).
- `npm install`

## Vòng lặp phát triển

```bash
npm run dev        # UI (5173) + Analyzer API (3030)
npm run mcp        # MCP server qua stdio (đa ngôn ngữ)
```

## Trước khi commit (bắt buộc)

```bash
npm run build      # tsc -b (type-check) + vite build
npm test           # vitest — phải xanh
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) chạy đúng hai lệnh này trên Node 22 cho mỗi push/PR vào `main`. Đừng push khi build/test đỏ.

## Không bao giờ commit

- **`*.db` / `*.sqlite`** — dữ liệu người dùng (project đã lưu). Đã nằm trong `.gitignore`.
- **`.env`, secrets, API key** (vd `ANTHROPIC_API_KEY`). Dùng `.env.example` nếu cần mẫu.
- **`node_modules/`, `dist/`, `*.log`, `tsconfig.tsbuildinfo`**.

Kiểm nhanh không rò rỉ trước khi push:

```bash
git ls-files | grep -iE '\.db($|-)|\.log$|(^|/)dist/|\.env$'   # phải không ra gì
```

> Muốn reset trạng thái app về sạch: xoá `huccanta.db*` (chỉ ảnh hưởng máy bạn, không đụng repo).

## Quy trình phát hành (SemVer)

Theo [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH` — sửa lỗi → PATCH, thêm tính năng tương thích → MINOR, thay đổi phá vỡ → MAJOR. (Đang < 1.0 nên API còn có thể đổi.)

1. Cập nhật code, `npm run build && npm test` xanh.
2. Bump `version` trong `package.json` (và chạy `npm install` để đồng bộ `package-lock.json`).
3. Commit: `git commit -m "release: vX.Y.Z — <tóm tắt>"`.
4. Gắn tag & push:

   ```bash
   git tag -a vX.Y.Z -m "Huccanta vX.Y.Z"
   git push origin main --follow-tags
   ```

5. Tạo GitHub Release từ tag:

   ```bash
   gh release create vX.Y.Z --title "Huccanta vX.Y.Z" --generate-notes --latest
   ```

   (Hoặc mở `https://github.com/hieuchaydi/huccanta/releases/new?tag=vX.Y.Z`.)

## Quy ước commit

- Tiền tố ngắn gọn: `feat:`, `fix:`, `perf:`, `docs:`, `ci:`, `release:`, `chore:`.
- Mô tả bằng thể mệnh lệnh, ngắn; giải thích *vì sao* nếu không hiển nhiên.
