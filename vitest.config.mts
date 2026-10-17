import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // 默认 node 环境；需要 DOM 的组件测试在文件顶部用 `// @vitest-environment jsdom` 单独声明
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'practice/**/*.test.ts'],
  },
});
