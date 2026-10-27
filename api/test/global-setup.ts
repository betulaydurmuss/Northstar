import { execSync } from 'node:child_process';

// Brings the test database up to the latest migration once per run (creating it if it
// does not exist yet), so tests see the schema exactly as production will. Each test
// file empties the tables it uses, so no destructive reset is needed here.
export default function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://northstar:northstar@localhost:5432/northstar_test',
    },
  });
}
