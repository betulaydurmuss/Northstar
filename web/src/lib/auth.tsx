import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, refreshSession, setAccessToken } from './api';

export type Me = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'super_admin';
  twoFactorEnabled: boolean;
  // An admin who has signed in but not yet enrolled a second factor.
  twoFactorSetupRequired: boolean;
  membership: {
    role: 'agency_admin' | 'client_viewer';
    organization: { id: string; name: string };
    client: { id: string; name: string } | null;
  } | null;
};

export const SECURITY_PATH = '/settings/security';

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

// Called after any successful sign-in: keep the token, then ask the api who we are.
export function useCompleteSignIn() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  return async (accessToken: string) => {
    setAccessToken(accessToken);
    const me = await api<Me>('/auth/me');
    qc.setQueryData(['me'], me);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(me.twoFactorSetupRequired ? SECURITY_PATH : (from ?? '/'), { replace: true });
  };
}

// Client viewers can look at everything they are shown but change nothing.
export function useIsAgency() {
  return useMe().data?.membership?.role === 'agency_admin';
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    qc.clear();
    qc.setQueryData(['me'], null);
    navigate('/sign-in', { replace: true });
  };
}

// The admin panel. The api enforces this too; here it only keeps others off the pages.
export function RequireAdmin() {
  const { data: me } = useMe();
  if (me?.role !== 'super_admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

// A platform admin with no agency has nothing to monitor; their home is the admin panel.
export function HomeOrAdmin({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (me?.role === 'super_admin' && !me.membership) return <Navigate to="/admin/users" replace />;
  return children;
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
  // Admins go nowhere else until they have a second factor.
  if (me.twoFactorSetupRequired && location.pathname !== SECURITY_PATH) {
    return <Navigate to={SECURITY_PATH} replace />;
  }
  return <Outlet />;
}
