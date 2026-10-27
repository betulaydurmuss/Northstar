import { encrypt } from '../crypto.js';
import { prisma } from '../db.js';
import { hashBackupCode, newBackupCodes, newTotpSecret, totpUri } from './totp.js';

// Gives an admin their second factor on the server, where only someone with shell access
// can see it. The web app refuses to enrol admins, so a password alone is never enough to
// take over an admin account, even before its owner has first signed in.
export async function provisionAdminTotp(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const secret = newTotpSecret();
  const backupCodes = newBackupCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: encrypt(secret),
      totpEnabled: true,
      totpLastEpoch: null,
      backupCodes: backupCodes.map(hashBackupCode),
    },
  });
  return { secret, uri: totpUri(user.email, secret), backupCodes };
}
