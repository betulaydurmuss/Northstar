import { useQuery } from '@tanstack/react-query';
import type { MonitorType } from '@northstar/shared/monitor';
import { api } from './api';

export type Monitor = {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  intervalSec: number;
  timeoutMs: number;
  retries: number;
  isActive: boolean;
  state: 'pending' | 'up' | 'down' | 'paused';
  lastCheckedAt: string | null;
  createdAt: string;
};

// Polled so the list reflects checks the worker has just run.
export function useMonitors() {
  return useQuery({
    queryKey: ['monitors'],
    queryFn: () => api<Monitor[]>('/monitors'),
    refetchInterval: 30_000,
  });
}

export function useMonitor(id: string | undefined) {
  return useQuery({
    queryKey: ['monitors', id],
    queryFn: () => api<Monitor>(`/monitors/${id}`),
    enabled: Boolean(id),
  });
}
