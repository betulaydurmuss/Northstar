import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { hashPassword, passwordProblem } from '../auth/password.js';
import { authLimiters, type AuthLimits } from '../auth/rate-limit.js';
import { setRefreshCookie, startSession } from '../auth/sessions.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../crypto.js';
import { prisma } from '../db.js';
import { HttpError } from '../http.js';
import { sendMail } from '../mail.js';
import { requireAgency, scopedClients } from '../tenancy.js';

const INVITE_TTL_MS = 72 * 3_600_000;

// The agency invites someone at the client; the link, valid for 72 hours and once,
// creates a client_viewer account that sees only that client.
export function invitesRouter(limits: AuthLimits) {
  const router = Router();
  const { perIp } = authLimiters(limits);
  // Invitations send email from our domain with text the agency chose; keep that from
  // becoming a way to send spam.
  const perInviter = rateLimit({
    windowMs: 3_600_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many invitations. Try again in an hour.' },
    keyGenerator: (req) => `invite:${req.auth?.userId ?? ''}`,
  });

  router.post('/clients/:id/invite', requireAuth(), requireAgency, perInviter, async (req, res) => {
    const { email } = z
      .object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') })
      .parse(req.body);
    const id = z.string().uuid().safeParse(req.params.id);
    const client = id.success
      ? await prisma.client.findFirst({ where: { AND: [{ id: id.data }, scopedClients(req)] } })
      : null;
    if (!client) throw new HttpError(404, 'Client not found');
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new HttpError(409, 'This email already has a Northstar account');
    }

    const token = randomToken();
    await prisma.invite.create({
      data: {
        clientId: client.id,
        email,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdById: req.auth!.userId,
      },
    });
    await sendMail({
      to: email,
      subject: `You're invited to ${client.name}'s uptime dashboard`,
      text: `You have been invited to see the uptime of ${client.name}'s websites on Northstar.\n\nCreate your account within 72 hours:\n${config.WEB_ORIGIN}/invite/${token}\n\nIf you were not expecting this, you can ignore it.`,
    });
    res.status(201).json({ email, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
  });

  async function findInvite(token: string) {
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { client: { select: { name: true, organizationId: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      throw new HttpError(404, 'This invitation has expired or was already used');
    }
    return invite;
  }

  router.get('/invites/:token', perIp, async (req, res) => {
    const invite = await findInvite(String(req.params.token));
    res.json({ email: invite.email, clientName: invite.client.name });
  });

  router.post('/invites/:token/accept', perIp, async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120), password: z.string() })
      .parse(req.body);
    const invite = await findInvite(String(req.params.token));
    const problem = passwordProblem(body.password, invite.email);
    if (problem) throw new HttpError(400, problem);

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.$transaction(async (tx) => {
      // Marking it used first, conditionally, means two clicks cannot create two accounts.
      const { count } = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (count === 0) throw new HttpError(404, 'This invitation has expired or was already used');
      return tx.user.create({
        data: {
          email: invite.email,
          name: body.name,
          passwordHash,
          membership: {
            create: {
              role: 'client_viewer',
              organizationId: invite.client.organizationId,
              clientId: invite.clientId,
            },
          },
        },
      });
    });

    const { accessToken, refreshToken } = await startSession(user, req, false);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ accessToken });
  });

  return router;
}
