import { defineConfig } from 'vitest/config';

// Repo-wide discipline tests (they scan every package's source).
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
