import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'dist/',
        'prisma/',
        '**/*.spec.ts',
        '**/*.test.ts',
        '**/*.d.ts',
      ],
    },
    reporters: ['verbose'],
  },
});
