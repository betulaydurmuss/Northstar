import type { NotificationJob } from '@northstar/shared/queues';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { downEmail, upEmail } from './templates.js';

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: false,
});

// Runs on the notifications queue, apart from checks, so a slow mail server never delays
// the next check and a failed send is retried by BullMQ on its own.
export async function sendIncidentEmail(job: NotificationJob) {
  const incident = await prisma.incident.findUnique({
    where: { id: job.incidentId },
    include: { monitor: { include: { owner: true } } },
  });
  if (!incident) return;

  const { monitor } = incident;
  const link = `${config.WEB_ORIGIN}/monitors/${monitor.id}`;
  const message =
    job.kind === 'incident-opened'
      ? downEmail(monitor, incident, link)
      : upEmail(monitor, incident, link);

  await transport.sendMail({ from: config.MAIL_FROM, to: monitor.owner.email, ...message });
}
