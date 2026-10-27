import { useQuery, useQueryClient } from '@tanstack/react-query';
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
