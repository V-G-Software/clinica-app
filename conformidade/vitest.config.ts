import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['testes/**/*.test.ts'],
    globalSetup: ['src/preparar.ts'],
    fileParallelism: false, // os arquivos compartilham contas e estado do backend
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 90_000,
  },
});
