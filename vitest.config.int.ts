import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Integration suite. These tests run against a real (in-memory) MongoDB
 * replica set, because every guarantee this codebase makes - the accept
 * transaction, the unique-index race, the movement ledgers, the CAS
 * transitions - is a database behaviour. Asserting them against mocked models
 * would only prove that the mocks behave as written.
 *
 * Kept separate from `npm test` so the default suite stays fast and offline.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    setupFiles: ['./test/support/test-env.ts'],
    // Transactions and unique-index races need a single shared replica set;
    // parallel files would fight over the same collections.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
