import nodemailer from 'nodemailer';
import { config } from './config.js';

// In tests nothing leaves the process: messages are serialised and kept in `sent`.
export const sent: { to: string; subject: string; text: string }[] = [];

const transport =
  config.NODE_ENV === 'test'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });

export async function sendMail(msg: { to: string; subject: string; text: string; html?: string }) {
  if (config.NODE_ENV === 'test') sent.push(msg);
  await transport.sendMail({ from: config.MAIL_FROM, ...msg });
}
