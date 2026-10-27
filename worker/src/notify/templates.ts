// Plain, light-themed HTML that renders the same in Gmail, Outlook and Apple Mail:
// tables for layout, inline styles, no web fonts, and a text version of every message.

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}`;
}

const STAR =
  '<svg width="22" height="22" viewBox="0 0 64 64" style="vertical-align:middle"><path d="M32 3 Q35.4 30.6 53 35 Q35.4 38.4 32 57 Q28.6 38.4 11 35 Q28.6 30.6 32 3 Z" fill="#4F46E5"/></svg>';

function layout(opts: {
  accent: string;
  label: string;
  heading: string;
  rows: [string, string][];
  link: string;
}) {
  const rows = opts.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;color:#6b7085;font-size:13px;width:140px">${escape(k)}</td><td style="padding:8px 0;color:#12131c;font-size:13px;font-family:Menlo,Consolas,monospace">${escape(v)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e5ee;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e3e5ee">${STAR}<span style="font-weight:600;font-size:15px;color:#12131c;vertical-align:middle;margin-left:8px">Northstar</span></td></tr>
<tr><td style="padding:24px">
<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:${opts.accent};border:1px solid ${opts.accent}">${escape(opts.label)}</span>
<h1 style="margin:14px 0 18px;font-size:20px;line-height:1.3;color:#12131c">${escape(opts.heading)}</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<a href="${escape(opts.link)}" style="display:inline-block;margin-top:20px;padding:10px 16px;background:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500">Open in Northstar</a>
</td></tr></table>
<p style="color:#8a90a8;font-size:12px;margin-top:16px">You are receiving this because you own this monitor in Northstar.</p>
</td></tr></table></body></html>`;
}

type Incident = { startedAt: Date; resolvedAt: Date | null; cause: string };
type Monitor = { name: string; target: string };

export function downEmail(monitor: Monitor, incident: Incident, link: string) {
  const subject = `Down: ${monitor.name}`;
  const rows: [string, string][] = [
    ['Monitor', monitor.name],
    ['Address', monitor.target],
    ['Reason', incident.cause],
    ['Since', incident.startedAt.toUTCString()],
  ];
  const text = `${monitor.name} is down.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${link}\n`;
  const html = layout({
    accent: '#dc2626',
    label: '✕ Down',
    heading: `${monitor.name} is down`,
    rows,
    link,
  });
  return { subject, text, html };
}

export function upEmail(monitor: Monitor, incident: Incident, link: string) {
  const lasted = formatDuration(
    (incident.resolvedAt ?? new Date()).getTime() - incident.startedAt.getTime(),
  );
  const subject = `Recovered: ${monitor.name} (down for ${lasted})`;
  const rows: [string, string][] = [
    ['Monitor', monitor.name],
    ['Address', monitor.target],
    ['Was down for', lasted],
    ['Cause', incident.cause],
  ];
  const text = `${monitor.name} is back up after ${lasted}.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${link}\n`;
  const html = layout({
    accent: '#059669',
    label: '✓ Operational',
    heading: `${monitor.name} is back up`,
    rows,
    link,
  });
  return { subject, text, html };
}
