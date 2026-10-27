import { useState } from 'react';
import type { HourCell } from '../lib/monitors';

function tone(cell: HourCell) {
  if (!cell || cell.total === 0) return 'empty';
  if (cell.up === cell.total) return 'up';
  if (cell.up === 0) return 'down';
  return 'partial';
}

function describe(cell: HourCell) {
  if (!cell || cell.total === 0) return 'No checks';
  const pct = (cell.up / cell.total) * 100;
  const failed = cell.total - cell.up;
  return `${pct === 100 ? '100' : pct.toFixed(1)}% up · ${cell.total} checks${failed ? `, ${failed} failed` : ''}`;
}

// One cell per period, coloured by how much of it was up. Colour is never the only
// channel: the bar's label states the overall figure, each cell explains itself on
// hover, and the same numbers are in the table beside it.
export function UptimeBar({
  cells,
  labels,
  summary,
  height = 18,
}: {
  cells: HourCell[];
  labels: string[];
  summary: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div
      className="uptime-bar"
      role="img"
      aria-label={summary}
      onPointerLeave={() => setHover(null)}
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className={`uptime-cell uptime-${tone(cell)}${hover === i ? ' is-hover' : ''}`}
          style={{ height }}
          onPointerEnter={() => setHover(i)}
        />
      ))}
      {hover !== null && (
        <span
          className="chart-tooltip uptime-tip"
          style={{ left: `${((hover + 0.5) / cells.length) * 100}%` }}
        >
          <strong>{describe(cells[hover] ?? null)}</strong>
          <span className="muted">{labels[hover]}</span>
        </span>
      )}
    </div>
  );
}

// Labels for the last 24 whole hours, oldest first, matching the api's cells.
export function last24HourLabels(now = new Date()) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() - 23);
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  return Array.from({ length: 24 }, (_, i) => {
    const from = new Date(start.getTime() + i * 3_600_000);
    const to = new Date(from.getTime() + 3_600_000);
    return `${fmt.format(from)}–${fmt.format(to)}`;
  });
}
