import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import QRCode from 'qrcode';
import { provisionAdminTotp } from '../auth/admin-totp.js';
import { hashPassword, passwordProblem } from '../auth/password.js';
import { prisma } from '../db.js';

// Creates a platform admin and their second factor, on the server. The password is typed
// at the prompt (or passed in ADMIN_PASSWORD for scripted setups) and never written to the
// repository or the shell history. The authenticator QR code and backup codes are shown
// here, once: the web app never enrols admins, so knowing the password is not enough.
//
//   npm run admin:create -- admin@agency.com "Ada Lovelace"
//   npm run admin:create -- admin@agency.com --reset-2fa     (a lost phone)

let muted = false;
const output = new Writable({
  write(chunk, _enc, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });

async function ask(question: string, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  const answer = await rl.question('');
  muted = false;
  if (hidden) process.stdout.write('\n');
  return answer.trim();
}

async function showSecondFactor(userId: string) {
  const { secret, uri, backupCodes } = await provisionAdminTotp(userId);
  console.log('\nScan this with an authenticator app (Google Authenticator, 1Password, Authy):\n');
  console.log(await QRCode.toString(uri, { type: 'terminal', small: true }));
  console.log(`Or enter this key by hand: ${secret}\n`);
  console.log('Backup codes, each usable once if the phone is lost. Store them now:');
  for (const code of backupCodes) console.log(`  ${code}`);
  console.log('\nNone of this is shown again.');
}

async function main() {
  const args = process.argv.slice(2);
  const resetOnly = args.includes('--reset-2fa');
  const [emailArg, nameArg] = args.filter((a) => !a.startsWith('--'));
  const email = (emailArg ?? (await ask('Admin email: '))).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That is not an email address.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (resetOnly) {
    if (existing?.role !== 'super_admin') throw new Error(`${email} is not an admin.`);
    await prisma.session.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await showSecondFactor(existing.id);
    return;
  }

  let userId: string;
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: 'super_admin' } });
    console.log(`${email} already existed and is now an admin. Its password was not changed.`);
    userId = existing.id;
  } else {
    const name = nameArg ?? (await ask('Name: '));
    const password = process.env.ADMIN_PASSWORD ?? (await ask('Password: ', true));
    const problem = passwordProblem(password, email);
    if (problem) throw new Error(problem);
    const user = await prisma.user.create({
      data: { email, name, role: 'super_admin', passwordHash: await hashPassword(password) },
    });
    console.log(`Created admin ${email}.`);
    userId = user.id;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.totpEnabled) {
    console.log('Two-factor is already set up. Use --reset-2fa to replace it.');
  } else {
    await showSecondFactor(userId);
  }
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
