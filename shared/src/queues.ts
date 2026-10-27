// The contract between the api, which schedules work, and the worker, which does it.

export const CHECKS_QUEUE = 'checks';
export const NOTIFICATIONS_QUEUE = 'notifications';
// Housekeeping on a clock: the nightly rollup, and later the daily certificate checks.
export const MAINTENANCE_QUEUE = 'maintenance';

// One repeating job per monitor. A stable id means re-registering is idempotent.
export const schedulerId = (monitorId: string) => `monitor:${monitorId}`;

export const REPORTS_QUEUE = 'reports';

export type CheckJob = { monitorId: string };

// Render one client's monthly report to PDF, and email it when `send` is set.
export type ReportJob = { reportId: string; send: boolean };

export type NotificationJob = {
  kind: 'incident-opened' | 'incident-resolved';
  incidentId: string;
};
