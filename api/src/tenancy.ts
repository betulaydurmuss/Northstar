import type { Request, RequestHandler } from 'express';
import { HttpError } from './http.js';

// The one place that decides what a signed-in user may see. Every query for tenant data
// spreads one of these into its where clause, so isolation is not something each route
// has to remember to get right.
//
//   agency_admin   everything in their organization
//   client_viewer  only their own client inside that organization

export type Tenant = { organizationId: string; clientId: string | null; isAgency: boolean };

export function tenant(req: Request): Tenant {
  const m = req.auth?.membership;
  if (!m) throw new HttpError(403, 'This account does not belong to an agency');
  return {
    organizationId: m.organizationId,
    clientId: m.role === 'client_viewer' ? m.clientId : null,
    isAgency: m.role === 'agency_admin',
  };
}

// For tables that carry organization_id and client_id: monitors, domains.
export function scoped(req: Request) {
  const t = tenant(req);
  return {
    organizationId: t.organizationId,
    // A viewer whose client was removed sees nothing rather than everything.
    ...(t.isAgency ? {} : { clientId: t.clientId ?? '00000000-0000-0000-0000-000000000000' }),
  };
}

// For the clients table itself, where the client is the row.
export function scopedClients(req: Request) {
  const t = tenant(req);
  return {
    organizationId: t.organizationId,
    ...(t.isAgency ? {} : { id: t.clientId ?? '00000000-0000-0000-0000-000000000000' }),
  };
}

// For tables reached through a monitor: incidents, checks, certificates.
export function scopedByMonitor(req: Request) {
  return { monitor: scoped(req) };
}

// Changing anything is for the agency; client viewers only look.
export const requireAgency: RequestHandler = (req, _res, next) => {
  if (!tenant(req).isAgency) throw new HttpError(403, 'Only the agency can change this');
  next();
};
