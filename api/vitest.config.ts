import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests run against a real Postgres, in a database of their own so they never touch
// development data. CI provides one as a service container.
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://northstar:northstar@localhost:5432/northstar_test';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Uploaded logos and report files from tests never land in the real storage folder.
      STORAGE_DIR: join(tmpdir(), 'northstar-test-storage'),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'test-secret-that-is-long-enough-to-sign-tokens',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  },
});
