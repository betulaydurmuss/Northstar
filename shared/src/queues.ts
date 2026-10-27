// The contract between the api, which schedules work, and the worker, which does it.

export const CHECKS_QUEUE = 'checks';
export const NOTIFICATIONS_QUEUE = 'notifications';
// Housekeeping on a clock: the nightly rollup, and later the daily certificate checks.
export const MAINTENANCE_QUEUE = 'maintenance';

// One repeating job per monitor. A stable id means re-registering is idempotent.
export const schedulerId = (monitorId: string) => `monitor:${monitorId}`;

export type CheckJob = { monitorId: string };

export type NotificationJob = {
  kind: 'incident-opened' | 'incident-resolved';
  incidentId: string;
};
