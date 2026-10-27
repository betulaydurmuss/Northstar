import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// Creates a demo account with a handful of monitors that point at stable public sites,
// so the dashboard has something real to show on a fresh database.
const prisma = new PrismaClient();

const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 12) {
  console.error('Set SEED_DEMO_PASSWORD (at least 12 characters) in .env before seeding.');
  process.exit(1);
}

const monitors = [
  { name: 'Harbor & Pine Coffee', target: 'https://example.com' },
  { name: 'Marlowe Dental Clinic', target: 'https://www.iana.org' },
  { name: 'Sable Architects', target: 'https://www.wikipedia.org' },
  { name: 'Lumen Yoga Studio', target: 'https://www.mozilla.org' },
  { name: 'Kettle & Crumb Bakery', target: 'https://httpbin.org/status/200' },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@northstar.local' },
    update: {},
    create: {
      email: 'demo@northstar.local',
      name: 'Brightline Studio',
      passwordHash: await argon2.hash(password!, { type: argon2.argon2id }),
    },
  });

  for (const m of monitors) {
    const exists = await prisma.monitor.findFirst({ where: { ownerId: user.id, name: m.name } });
    if (!exists) await prisma.monitor.create({ data: { ...m, ownerId: user.id } });
  }

  console.log(`Seeded ${user.email} with ${monitors.length} monitors.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
