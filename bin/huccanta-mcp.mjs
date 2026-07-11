#!/usr/bin/env node
// Bin cho "packet": cho phép chạy Huccanta MCP server từ bất kỳ project nào.
//   npx huccanta-mcp <đường-dẫn-thư-mục>
// Đăng ký tsx để chạy TypeScript trực tiếp (không cần build), rồi nạp server/mcp.ts.
// process.argv được giữ nguyên nên mcp.ts đọc argv[2] = thư mục làm root mặc định.
import { register } from 'tsx/esm/api';

register();
await import('../server/mcp.ts');
