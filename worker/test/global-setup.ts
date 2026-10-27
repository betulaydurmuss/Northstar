import { execSync } from 'node:child_process';

// Applies the api's migrations to the test database; the worker owns no schema of its own.
export default function setup() {
  execSync('npx prisma migrate deploy --schema ../api/prisma/schema.prisma', {
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://northstar:northstar@localhost:5432/northstar_test',
    },
  });
}
