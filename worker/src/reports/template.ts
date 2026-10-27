import type { ReportData } from './data.js';

// The monthly report as one self-contained HTML document: inline styles, inline SVG, the
// logo as a data URI. Nothing is fetched while rendering, so the PDF looks the same on
// every machine and the renderer can run with the network and JavaScript switched off.

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function formatUptime(pct: number | null) {
  if (pct === null) return '—';
  if (pct === 100) return '100%';
  return `${pct >= 99 ? pct.toFixed(3) : pct.toFixed(2)}%`;
}

export function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes === 0) return ms > 0 ? 'under a minute' : 'none';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

const formatMs = (ms: number | null) => (ms === null ? '—' : `${ms} ms`);
const dateTime = (d: Date) =>
  d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

// Status colours for print, each always explained in words in the legend beside it.
const TONES = {
  good: '#059669',
  warn: '#d97706',
  bad: '#dc2626',
  empty: '#e5e7eb',
};

function dayTone(uptime: number | null) {
  if (uptime === null) return TONES.empty;
  if (uptime >= 99.9) return TONES.good;
  if (uptime >= 99) return TONES.warn;
  return TONES.bad;
}

function dayStrip(days: ReportData['days']) {
  const cell = 14;
  const gap = 3;
  const width = days.length * (cell + gap) - gap;
  const rects = days
    .map(
      (d, i) =>
        `<rect x="${i * (cell + gap)}" y="0" width="${cell}" height="28" rx="2" fill="${dayTone(d.uptime)}"><title>${d.date}: ${formatUptime(d.uptime)}</title></rect>`,
    )
    .join('');
  const labels = [0, Math.floor(days.length / 2), days.length - 1]
    .map((i) => {
      const anchor = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
      const x = i === 0 ? 0 : i === days.length - 1 ? width : i * (cell + gap) + cell / 2;
      return `<text x="${x}" y="44" text-anchor="${anchor}" class="axis">${new Date(days[i]!.date).getUTCDate()}</text>`;
    })
    .join('');
  return `<svg width="${width}" height="48" viewBox="0 0 ${width} 48" role="img" aria-label="Daily availability">${rects}${labels}</svg>`;
}

// Average response time per day: one series in the client's colour, one axis from zero.
function responseChart(days: ReportData['days'], color: string) {
  const W = 640;
  const H = 120;
  const left = 48;
  const bottom = 22;
  const values = days.map((d) => d.avgMs).filter((v): v is number => v !== null);
  if (values.length < 2) return '<p class="muted">Not enough data to draw response times.</p>';
  const max = Math.max(...values);
  const step = max > 2000 ? 1000 : max > 800 ? 250 : max > 300 ? 100 : 50;
  const top = Math.ceil((max * 1.1) / step) * step;
  const x = (i: number) => left + (i / Math.max(1, days.length - 1)) * (W - left - 8);
  const y = (v: number) => (H - bottom) * (1 - v / top) + 4;

  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const grid = ticks
    .map(
      (v) =>
        `<line x1="${left}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#e5e7eb" stroke-width="1"/><text x="${left - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${v} ms</text>`,
    )
    .join('');

  let path = '';
  let pen = false;
  days.forEach((d, i) => {
    if (d.avgMs === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.avgMs).toFixed(1)} `;
    pen = true;
  });
  const xLabels = [0, Math.floor(days.length / 2), days.length - 1]
    .map(
      (i) =>
        `<text x="${x(i)}" y="${H}" text-anchor="middle" class="axis">${new Date(days[i]!.date).getUTCDate()}</text>`,
    )
    .join('');

  return `<svg width="100%" viewBox="0 0 ${W} ${H + 4}" role="img" aria-label="Average response time per day">${grid}<path d="${path}" fill="none" stroke="${esc(color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${xLabels}</svg>`;
}

const STAR =
  '<svg width="12" height="12" viewBox="0 0 64 64"><path d="M32 3 Q35.4 30.6 53 35 Q35.4 38.4 32 57 Q28.6 38.4 11 35 Q28.6 30.6 32 3 Z" fill="#4F46E5"/></svg>';

export function reportHtml(data: ReportData, logoDataUri: string | null) {
  const accent = /^#[0-9a-f]{6}$/i.test(data.client.brandColor)
    ? data.client.brandColor
    : '#4F46E5';
  const logo = logoDataUri
    ? `<img src="${logoDataUri}" alt="" class="logo">`
    : `<div class="logo initial" style="background:${accent}">${esc(data.client.name.charAt(0).toUpperCase())}</div>`;

  const monitorRows = data.monitors
    .map(
      (m) => `<tr>
        <td><strong>${esc(m.name)}</strong><div class="mono muted small">${esc(m.target)}</div></td>
        <td class="num">${formatUptime(m.uptime)}</td>
        <td class="num">${formatMs(m.avgMs)}</td>
        <td class="num">${m.incidents}</td>
        <td class="num">${formatDuration(m.downtimeMs)}</td>
      </tr>`,
    )
    .join('');

  const incidentRows = data.incidents.length
    ? data.incidents
        .map(
          (i) => `<tr>
            <td>${esc(i.monitor)}</td>
            <td>${dateTime(i.startedAt)}</td>
            <td>${i.resolvedAt ? dateTime(i.resolvedAt) : 'Ongoing'}</td>
            <td class="num">${formatDuration(i.durationMs)}</td>
            <td class="muted">${esc(i.cause)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="muted">No incidents this month. Every check answered.</td></tr>';

  const sentence =
    data.overall.uptime === null
      ? `No checks were recorded for ${esc(data.client.name)} in ${data.periodLabel}.`
      : `${esc(data.client.name)}'s websites were available ${formatUptime(data.overall.uptime)} of the time in ${data.periodLabel}.`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(data.client.name)} · ${data.periodLabel} uptime report</title>
<style>
  @page { size: A4; margin: 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #12131c; font-size: 11px; line-height: 1.5; }
  .bar { height: 5px; background: ${accent}; border-radius: 3px; margin-bottom: 18px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .logo { width: 44px; height: 44px; object-fit: contain; border-radius: 6px; }
  .initial { color: #fff; font-weight: 600; font-size: 20px; display: grid; place-items: center; }
  h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
  h2 { font-size: 13px; margin: 18px 0 8px; }
  .muted { color: #6b7085; }
  .small { font-size: 9.5px; }
  .mono, .num { font-family: 'JetBrains Mono', Consolas, Menlo, monospace; }
  .num { text-align: right; white-space: nowrap; }
  .right { text-align: right; }
  .hero { margin-top: 18px; padding: 16px 20px; border: 1px solid #e3e5ee; border-radius: 10px; }
  .hero .value { font-size: 52px; font-weight: 600; letter-spacing: -0.03em; line-height: 1; }
  .hero p { margin: 8px 0 0; font-size: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
  .tile { border: 1px solid #e3e5ee; border-radius: 10px; padding: 12px 14px; }
  .tile .label { color: #6b7085; }
  .tile .value { font-size: 20px; font-weight: 600; margin-top: 2px; }
  .legend { display: flex; gap: 14px; margin-top: 6px; color: #6b7085; }
  .legend span::before { content: ''; display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: var(--c); }
  .axis { font-size: 9px; fill: #6b7085; font-family: Consolas, Menlo, monospace; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 500; color: #6b7085; border-bottom: 1px solid #d9dce6; padding: 6px 8px; }
  td { border-bottom: 1px solid #eceef4; padding: 7px 8px; vertical-align: top; }
  tr { break-inside: avoid; }
  .note { margin-top: 14px; padding: 10px 12px; background: #f6f7fb; border-radius: 8px; }
  footer { margin-top: 16px; display: flex; justify-content: space-between; color: #8a90a8; font-size: 9.5px; }
  footer .by { display: flex; gap: 5px; align-items: center; }
</style></head>
<body>
  <div class="bar"></div>
  <header>
    <div class="brand">${logo}<div><h1>${esc(data.client.name)}</h1><div class="muted">Prepared by ${esc(data.agency)}</div></div></div>
    <div class="right"><div style="font-weight:600;font-size:13px">Uptime report</div><div class="muted">${data.periodLabel}</div></div>
  </header>

  <section class="hero">
    <div class="muted">Availability</div>
    <div class="value">${formatUptime(data.overall.uptime)}</div>
    <p>${sentence}</p>
  </section>
  <div class="tiles">
    <div class="tile"><div class="label">Total downtime</div><div class="value">${formatDuration(data.overall.downtimeMs)}</div></div>
    <div class="tile"><div class="label">Incidents</div><div class="value">${data.overall.incidents}</div></div>
    <div class="tile"><div class="label">Average response</div><div class="value">${formatMs(data.overall.avgMs)}</div></div>
  </div>

  <h2>Day by day</h2>
  ${dayStrip(data.days)}
  <div class="legend">
    <span style="--c:${TONES.good}">99.9% or more</span>
    <span style="--c:${TONES.warn}">99% to 99.9%</span>
    <span style="--c:${TONES.bad}">Below 99%</span>
    <span style="--c:${TONES.empty}">No checks</span>
  </div>

  <h2>Average response time</h2>
  ${responseChart(data.days, accent)}

  <h2>Websites</h2>
  <table>
    <thead><tr><th>Website</th><th class="right">Uptime</th><th class="right">Avg response</th><th class="right">Incidents</th><th class="right">Downtime</th></tr></thead>
    <tbody>${monitorRows || '<tr><td colspan="5" class="muted">No websites are monitored for this client.</td></tr>'}</tbody>
  </table>

  <h2>Incidents</h2>
  <table>
    <thead><tr><th>Website</th><th>Started (UTC)</th><th>Ended (UTC)</th><th class="right">Duration</th><th>Cause</th></tr></thead>
    <tbody>${incidentRows}</tbody>
  </table>

  <div class="note">
    ${data.maintenanceMs > 0 ? `Planned maintenance (${formatDuration(data.maintenanceMs)}) is not counted against uptime. ` : ''}
    Uptime is the share of checks that succeeded, over ${data.overall.checks.toLocaleString('en')} checks this month from a single monitoring location.
  </div>

  <footer>
    <span>Generated ${dateTime(new Date())} UTC</span>
    <span class="by">${STAR} Monitored by Northstar</span>
  </footer>
</body></html>`;
}
