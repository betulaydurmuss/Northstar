import { defineConfig } from 'vitest/config';

// The database tests share the api's test database and migrations.
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://northstar:northstar@localhost:5432/northstar_test';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    env: { NODE_ENV: 'test', DATABASE_URL: databaseUrl },
  },
});
