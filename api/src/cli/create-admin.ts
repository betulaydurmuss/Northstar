import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword, passwordProblem } from '../auth/password.js';
import { prisma } from '../db.js';

// Creates the first platform admin. The password is typed at the prompt (or passed in
// ADMIN_PASSWORD for scripted setups) and never written to the repository or the shell history.
//
//   npm run admin:create -- admin@agency.com "Ada Lovelace"

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

async function main() {
  const email = (process.argv[2] ?? (await ask('Admin email: '))).toLowerCase();
  const name = process.argv[3] ?? (await ask('Name: '));
  const password = process.env.ADMIN_PASSWORD ?? (await ask('Password: ', true));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That is not an email address.');
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: 'super_admin' } });
    console.log(`${email} already existed and is now an admin. Its password was not changed.`);
  } else {
    await prisma.user.create({
      data: { email, name, role: 'super_admin', passwordHash: await hashPassword(password) },
    });
    console.log(`Created admin ${email}.`);
  }
  console.log('Two-factor setup will be required at the first sign-in.');
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
