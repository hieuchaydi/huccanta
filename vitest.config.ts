import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Change Contract dựng nhiều graph trước/sau; trên máy CI chậm có thể vượt mặc định 5 giây.
    testTimeout: 30_000
  }
});
