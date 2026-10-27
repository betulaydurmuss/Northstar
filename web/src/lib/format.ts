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
