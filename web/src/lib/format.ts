const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// "just now", "4 minutes ago", "yesterday".
export function timeAgo(iso: string | Date, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

// Uptime is shown to three decimals only when it is close to 100%, where the difference
// between 99.9 and 99.99 is the whole story.
export function formatUptime(pct: number | null) {
  if (pct === null) return '—';
  if (pct === 100) return '100%';
  return `${pct >= 99 ? pct.toFixed(3) : pct.toFixed(1)}%`;
}

export function formatMs(ms: number | null) {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export const formatDateTime = (iso: string | Date) => dateTime.format(new Date(iso));

// Order matters: Edge also says Chrome, Chrome also says Safari, Android also says Linux.
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
];

function firstMatch(list: [RegExp, string][], text: string) {
  return list.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

// Enough of a user agent to recognise a device: "Chrome on Windows".
export function describeDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device';
  const browser = firstMatch(BROWSERS, userAgent);
  const os = firstMatch(SYSTEMS, userAgent);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 40);
}
