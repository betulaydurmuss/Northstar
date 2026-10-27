import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Client = {
  id: string;
  name: string;
  contactEmail: string | null;
  brandColor: string;
  logoUrl: string | null;
  createdAt: string;
  monitors: number;
  down: number;
  uptime30d: number | null;
};

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: () => api<Client[]>('/clients'),
    refetchInterval: 30_000,
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ['clients', id],
    queryFn: () => api<Client>(`/clients/${id}`),
    enabled: Boolean(id),
  });
}

export type Expiration = {
  kind: 'certificate' | 'domain';
  id: string;
  name: string;
  monitor: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  expiresAt: string | null;
  daysLeft: number | null;
  detail: string | null;
  error: string | null;
  source: 'rdap' | 'manual' | null;
  checkedAt: string | null;
};

export function useExpirations(clientId: string) {
  return useQuery({
    queryKey: ['expirations', clientId],
    queryFn: () => api<Expiration[]>(`/expirations${clientId ? `?clientId=${clientId}` : ''}`),
  });
}
