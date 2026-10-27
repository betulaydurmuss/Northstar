import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

// Creates a demo account with a handful of monitors that point at stable public sites,
// and gives each one thirty days of believable history (a few short outages, a daily
// rhythm in response times), so charts and uptime figures have something real to show.
const prisma = new PrismaClient();

const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 12) {
  console.error('Set SEED_DEMO_PASSWORD (at least 12 characters) in .env before seeding.');
  process.exit(1);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STEP = 5 * 60_000; // one historical check every five minutes

type Outage = { daysAgo: number; minutes: number; cause: string };

const monitors: { name: string; target: string; baseMs: number; outages: Outage[] }[] = [
  { name: 'Harbor & Pine Coffee', target: 'https://example.com', baseMs: 140, outages: [] },
  {
    name: 'Marlowe Dental Clinic',
    target: 'https://www.iana.org',
    baseMs: 310,
    outages: [{ daysAgo: 5.4, minutes: 10, cause: 'The server answered 502' }],
  },
  { name: 'Sable Architects', target: 'https://www.wikipedia.org', baseMs: 180, outages: [] },
  {
    name: 'Lumen Yoga Studio',
    target: 'https://www.mozilla.org',
    baseMs: 260,
    outages: [{ daysAgo: 18.2, minutes: 45, cause: 'No response within 10 seconds' }],
  },
  {
    name: 'Kettle & Crumb Bakery',
    target: 'https://httpbin.org/status/200',
    baseMs: 420,
    outages: [
      { daysAgo: 2.3, minutes: 25, cause: 'The server answered 503' },
      { daysAgo: 11.6, minutes: 15, cause: 'The domain name could not be resolved' },
    ],
  },
];

// Deterministic noise, so every fresh database looks the same in screenshots.
let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

function responseMs(base: number, at: number) {
  const hour = new Date(at).getUTCHours();
  const busy = 1 + 0.35 * Math.sin(((hour - 8) / 24) * 2 * Math.PI); // slower in the afternoon
  const spike = random() < 0.01 ? 2.5 : 1;
  return Math.round(base * busy * spike * (0.85 + random() * 0.3));
}

// History is written up to `until`: the first real check if the worker has already run,
// so seeded and live data never overlap.
async function seedHistory(monitorId: string, m: (typeof monitors)[number], until: number) {
  const now = until;
  const isDown = (at: number) =>
    m.outages.some((o) => {
      const start = now - o.daysAgo * DAY;
      return at >= start && at < start + o.minutes * 60_000;
    });

  // Last seven days as raw checks.
  const raw = [];
  for (let at = now - 7 * DAY; at < now; at += STEP) {
    const down = isDown(at);
    raw.push({
      monitorId,
      status: down ? ('down' as const) : ('up' as const),
      responseMs: down ? null : responseMs(m.baseMs, at),
      statusCode: down ? 503 : 200,
      error: down ? 'Seeded outage' : null,
      checkedAt: new Date(at),
    });
  }
  await prisma.checkResult.createMany({ data: raw });

  // Days 8 to 30 as hourly rows, as the nightly rollup would have left them.
  const hourly = [];
  const firstRawHour = Math.floor((now - 7 * DAY) / HOUR) * HOUR;
  for (let hour = firstRawHour - 23 * DAY; hour < firstRawHour; hour += HOUR) {
    let up = 0;
    const times: number[] = [];
    for (let at = hour; at < hour + HOUR; at += STEP) {
      if (isDown(at)) continue;
      up++;
      times.push(responseMs(m.baseMs, at));
    }
    times.sort((a, b) => a - b);
    hourly.push({
      monitorId,
      hour: new Date(hour),
      upCount: up,
      totalCount: HOUR / STEP,
      avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      p95Ms: times.length ? times[Math.floor(times.length * 0.95)]! : null,
      msCount: times.length,
    });
  }
  await prisma.checkHourly.createMany({ data: hourly });

  for (const o of m.outages) {
    const startedAt = new Date(now - o.daysAgo * DAY);
    await prisma.incident.create({
      data: {
        monitorId,
        startedAt,
        resolvedAt: new Date(startedAt.getTime() + o.minutes * 60_000),
        cause: o.cause,
      },
    });
  }
  await prisma.monitor.updateMany({
    where: { id: monitorId, state: 'pending' },
    data: { state: 'up', lastCheckedAt: new Date(now - STEP) },
  });
}

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
    const monitor =
      (await prisma.monitor.findFirst({ where: { ownerId: user.id, name: m.name } })) ??
      (await prisma.monitor.create({ data: { name: m.name, target: m.target, ownerId: user.id } }));
    const first = await prisma.checkResult.findFirst({
      where: { monitorId: monitor.id },
      orderBy: { checkedAt: 'asc' },
    });
    const hourly = await prisma.checkHourly.count({ where: { monitorId: monitor.id } });
    // Seeded once: skip monitors that already have a day or more of history.
    const hasHistory = hourly > 0 || (first && first.checkedAt.getTime() < Date.now() - DAY);
    if (!hasHistory) await seedHistory(monitor.id, m, first?.checkedAt.getTime() ?? Date.now());
  }

  console.log(`Seeded ${user.email} with ${monitors.length} monitors and 30 days of history.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
