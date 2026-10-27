import {
  Activity,
  CalendarClock,
  FileText,
  Gauge,
  LayoutGrid,
  ListChecks,
  Package,
  UserCog,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { SECURITY_PATH, useIsAgency, useMe, useSignOut } from '../lib/auth';

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

export function AppShell() {
  const scrolled = useScrolled();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const isAgency = useIsAgency();
  const viewerClient = me?.membership?.role === 'client_viewer' ? me.membership.client : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo />
        </div>
        {me?.membership && (
          <div>
            <div className="nav-label">Monitoring</div>
            <nav className="nav">
              <NavLink to="/" end>
                <LayoutGrid size={16} /> Overview
              </NavLink>
              {isAgency ? (
                <NavLink to="/clients">
                  <Users size={16} /> Clients
                </NavLink>
              ) : (
                viewerClient && (
                  <NavLink to={'/clients/' + viewerClient.id}>
                    <Users size={16} /> {viewerClient.name}
                  </NavLink>
                )
              )}
              <NavLink to="/incidents">
                <Activity size={16} /> Incidents
              </NavLink>
              <NavLink to="/expirations">
                <CalendarClock size={16} /> Expiring soon
              </NavLink>
              <NavLink to="/reports">
                <FileText size={16} /> Reports
              </NavLink>
            </nav>
          </div>
        )}
        {me?.role === 'super_admin' && (
          <div>
            <div className="nav-label">Admin</div>
            <nav className="nav">
              <NavLink to="/admin/users">
                <UserCog size={16} /> Users
              </NavLink>
              <NavLink to="/admin/system">
                <Gauge size={16} /> System health
              </NavLink>
              <NavLink to="/admin/audit">
                <ListChecks size={16} /> Audit log
              </NavLink>
              <NavLink to="/admin/plans">
                <Package size={16} /> Plans
              </NavLink>
            </nav>
          </div>
        )}
        <div>
          <div className="nav-label">Account</div>
          <nav className="nav">
            <NavLink to={SECURITY_PATH}>
              <ShieldCheck size={16} /> Security
            </NavLink>
          </nav>
        </div>
      </aside>
      <div className="main">
        <header className={`topbar${scrolled ? ' scrolled' : ''}`}>
          <span className="muted">{me?.membership?.organization.name ?? me?.name}</span>
          <div className="row" style={{ gap: 4 }}>
            <span className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
              {me?.email}
            </span>
            <button className="btn btn-ghost" onClick={signOut} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
