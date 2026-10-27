import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMs } from '../lib/format';
import type { Range, SeriesPoint } from '../lib/monitors';

// One series, so no legend: the card title says what is plotted. A 2px line in the brand
// accent over a 10% wash, solid hairline grid, and a crosshair that snaps to the nearest
// bucket. Buckets that contained failed checks are shaded behind the line, so outages
// read at a glance without a second axis.

const tickFormat: Record<Range, Intl.DateTimeFormatOptions> = {
  '1h': { hour: '2-digit', minute: '2-digit' },
  '24h': { hour: '2-digit', minute: '2-digit' },
  '7d': { weekday: 'short', day: 'numeric' },
  '30d': { day: 'numeric', month: 'short' },
};

const bucketMs: Record<Range, number> = {
  '1h': 60_000,
  '24h': 15 * 60_000,
  '7d': 3_600_000,
  '30d': 6 * 3_600_000,
};

type Point = { t: number; avgMs: number | null; up: number; total: number };

// For day-scale ranges, one tick per local midnight (every few days for 30 days), so
// each label names a distinct day instead of repeating one.
function dayTicks(data: Point[], range: Range) {
  if (range !== '7d' && range !== '30d') return undefined;
  const first = data[0]?.t;
  const last = data.at(-1)?.t;
  if (first === undefined || last === undefined) return undefined;
  const step = range === '7d' ? 1 : 5;
  const ticks: number[] = [];
  const d = new Date(first);
  d.setHours(24, 0, 0, 0);
  for (; d.getTime() <= last; d.setDate(d.getDate() + step)) ticks.push(d.getTime());
  return ticks;
}

// Only the fields this tooltip reads, so it does not depend on Recharts' generics.
type TooltipProps = { active?: boolean; payload?: readonly { payload?: unknown }[] };

function ChartTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload as Point | undefined;
  if (!active || !p) return null;
  const failed = p.total - p.up;
  return (
    <div className="chart-tooltip">
      <strong className="mono">{formatMs(p.avgMs)}</strong>
      <span className="muted">
        {new Date(p.t).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
      <span className="muted">
        {p.total} check{p.total === 1 ? '' : 's'}
        {failed > 0 && <span style={{ color: 'var(--text)' }}> · {failed} failed</span>}
      </span>
    </div>
  );
}

export function ResponseChart({ points, range }: { points: SeriesPoint[]; range: Range }) {
  const data: Point[] = points.map((p) => ({ ...p, t: new Date(p.t).getTime() }));
  const fmt = new Intl.DateTimeFormat('en-GB', tickFormat[range]);
  const width = bucketMs[range];
  const failures = data.filter((p) => p.up < p.total);

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
          {failures.map((p) => (
            <ReferenceArea
              key={p.t}
              x1={p.t}
              x2={p.t + width}
              fill="var(--bad)"
              fillOpacity={0.12}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={dayTicks(data, range)}
            tickFormatter={(t: number) => fmt.format(t)}
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`)}
            tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            content={(props) => <ChartTooltip active={props.active} payload={props.payload} />}
            cursor={{ stroke: 'var(--faint)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="avgMs"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="var(--accent)"
            fillOpacity={0.1}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
