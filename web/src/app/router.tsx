import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../lib/auth';
import { Brand } from '../pages/Brand';
import { ForgotPassword } from '../pages/auth/ForgotPassword';
import { ResetPassword } from '../pages/auth/ResetPassword';
import { SignIn } from '../pages/auth/SignIn';
import { SignUp } from '../pages/auth/SignUp';
import { AcceptInvite } from '../pages/auth/AcceptInvite';
import { ClientDetail } from '../pages/clients/ClientDetail';
import { StatusPageEditor } from '../pages/clients/StatusPageEditor';
import { Reports } from '../pages/Reports';
import { Clients } from '../pages/clients/Clients';
import { Expirations } from '../pages/Expirations';
import { Incidents } from '../pages/Incidents';
import { Import } from '../pages/monitors/Import';
import { EditMonitor, NewMonitor } from '../pages/monitors/MonitorForm';
import { Overview } from '../pages/Overview';
import { Security } from '../pages/settings/Security';
import { Styleguide } from '../pages/Styleguide';
import { AppShell } from './AppShell';
import { PublicShell } from './PublicShell';

// Loaded on its own: the public page is what most visitors see, and should be small.
const publicStatus = (byHost: boolean) => async () => {
  const { PublicStatus } = await import('../pages/status/PublicStatus');
  return { Component: () => <PublicStatus byHost={byHost} /> };
};

// Any host other than our own is a client's custom domain (status.client.com, a CNAME
// to us): there the whole site is that client's status page.
const APP_HOSTS = (import.meta.env.VITE_APP_HOSTS ?? 'localhost,127.0.0.1').split(',');
const onCustomDomain = !APP_HOSTS.includes(window.location.hostname);

const customDomainRouter = () => createBrowserRouter([{ path: '*', lazy: publicStatus(true) }]);

const appRouter = () =>
  createBrowserRouter([
    { path: '/status/:slug', lazy: publicStatus(false) },
    { path: '/invite/:token', element: <AcceptInvite /> },
    { path: '/sign-in', element: <SignIn /> },
    { path: '/sign-up', element: <SignUp /> },
    { path: '/forgot-password', element: <ForgotPassword /> },
    { path: '/reset-password', element: <ResetPassword /> },
    {
      element: <PublicShell />,
      children: [
        { path: '/brand', element: <Brand /> },
        { path: '/styleguide', element: <Styleguide /> },
      ],
    },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppShell />,
          children: [
            { path: '/', element: <Overview /> },
            { path: '/monitors/new', element: <NewMonitor /> },
            { path: '/monitors/import', element: <Import /> },
            { path: '/monitors/:id/edit', element: <EditMonitor /> },
            // The charting library is only needed here, so it loads with this page.
            {
              path: '/monitors/:id',
              lazy: async () => ({
                Component: (await import('../pages/monitors/MonitorDetail')).MonitorDetail,
              }),
            },
            { path: '/incidents', element: <Incidents /> },
            { path: '/clients', element: <Clients /> },
            { path: '/clients/:id', element: <ClientDetail /> },
            { path: '/clients/:id/status-page', element: <StatusPageEditor /> },
            { path: '/reports', element: <Reports /> },
            { path: '/expirations', element: <Expirations /> },
            { path: '/settings/security', element: <Security /> },
          ],
        },
      ],
    },
  ]);

export const router = onCustomDomain ? customDomainRouter() : appRouter();
