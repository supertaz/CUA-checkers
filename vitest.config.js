import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}', 'server.js'],
      exclude: [
        'src/app/layout.js',
        // page.js is a Next.js Server Component — jsdom cannot render server components;
        // excluded from coverage rather than adding a test that would give false confidence.
        'src/app/page.js',
        'src/app/globals.css',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
