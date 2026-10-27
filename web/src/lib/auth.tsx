import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api, refreshSession } from './api';

export type Me = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'super_admin';
};

// On first load there is no access token in memory, so try the refresh cookie before
// asking who we are. A failed refresh simply means "signed out".
async function loadMe(): Promise<Me | null> {
  const ok = await refreshSession();
  if (!ok) return null;
  return api<Me>('/auth/me').catch(() => null);
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: loadMe, staleTime: Infinity, retry: false });
}

export function useSetMe() {
  const qc = useQueryClient();
  return (me: Me | null) => qc.setQueryData(['me'], me);
}

export function RequireAuth() {
  const { data: me, isPending } = useMe();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="auth">
        <div className="skeleton" style={{ width: 160, height: 12 }} />
      </div>
    );
  }
  if (!me) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
