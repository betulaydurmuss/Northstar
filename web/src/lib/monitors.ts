import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { MonitorType } from '@northstar/shared/monitor';
import { api } from './api';

export type HourCell = { up: number; total: number } | null;

export type Monitor = {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  intervalSec: number;
  timeoutMs: number;
  retries: number;
  clientId: string | null;
  client: { id: string; name: string; brandColor: string } | null;
  keyword: string | null;
  keywordMode: 'present' | 'absent' | null;
  keywordCaseSensitive: boolean;
  isActive: boolean;
  state: 'pending' | 'up' | 'down' | 'paused';
  lastCheckedAt: string | null;
  createdAt: string;
};

export type MonitorListItem = Monitor & { last24h: HourCell[]; uptime24h: number | null };

export type Range = '1h' | '24h' | '7d' | '30d';
export const RANGES: { value: Range; label: string }[] = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export type Stats = {
  range: Range;
  uptime: Record<'24h' | '7d' | '30d', number | null>;
  avgMs: number | null;
  p95Ms: number | null;
  checks: number;
};

export type SeriesPoint = { t: string; up: number; total: number; avgMs: number | null };

export type Check = {
  id: string;
  status: 'up' | 'down';
  responseMs: number | null;
  statusCode: number | null;
  error: string | null;
  checkedAt: string;
};

export type Incident = {
  id: string;
  monitor: { id: string; name: string };
  startedAt: string;
  resolvedAt: string | null;
  cause: string;
  durationMs: number;
};

// Everything live on screen refreshes on the same 30-second beat as the checks.
const LIVE = 30_000;

export function useMonitors(clientId?: string) {
  return useQuery({
    queryKey: clientId ? ['monitors', { clientId }] : ['monitors'],
    queryFn: () =>
      api<MonitorListItem[]>(clientId ? '/monitors?clientId=' + clientId : '/monitors'),
    refetchInterval: LIVE,
  });
}

export function useMonitor(id: string | undefined) {
  return useQuery({
    queryKey: ['monitors', id],
    queryFn: () => api<Monitor>(`/monitors/${id}`),
    enabled: Boolean(id),
    refetchInterval: LIVE,
  });
}

// keepPreviousData: switching range keeps the old chart on screen until the new one
// arrives, instead of flashing a skeleton.
export function useStats(id: string, range: Range) {
  return useQuery({
    queryKey: ['monitors', id, 'stats', range],
    queryFn: () => api<Stats>(`/monitors/${id}/stats?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE,
  });
}

export function useSeries(id: string, range: Range) {
  return useQuery({
    queryKey: ['monitors', id, 'series', range],
    queryFn: () => api<SeriesPoint[]>(`/monitors/${id}/series?range=${range}`),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE,
  });
}

export function useChecks(id: string) {
  return useQuery({
    queryKey: ['monitors', id, 'checks'],
    queryFn: () => api<Check[]>(`/monitors/${id}/checks?limit=20`),
    refetchInterval: LIVE,
  });
}

export function useIncidents(params: {
  monitorId?: string;
  status?: 'all' | 'ongoing' | 'resolved';
}) {
  const query = new URLSearchParams();
  if (params.monitorId) query.set('monitorId', params.monitorId);
  if (params.status) query.set('status', params.status);
  return useQuery({
    queryKey: ['incidents', params],
    queryFn: () => api<Incident[]>(`/incidents?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE,
  });
}
