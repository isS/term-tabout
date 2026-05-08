import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑 src 下的测试，避免 build 后 dist 里的副本被重复执行
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
