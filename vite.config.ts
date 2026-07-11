import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cổng của Analyzer API — khớp với PORT mà server dùng (mặc định 3030).
// Đặt PORT khi chạy dev để cả server lẫn proxy này cùng trỏ một cổng.
const API_PORT = process.env.PORT ?? '3030';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`
    }
  }
});
