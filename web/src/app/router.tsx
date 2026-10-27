import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../lib/auth';
import { Brand } from '../pages/Brand';
import { ForgotPassword } from '../pages/auth/ForgotPassword';
import { ResetPassword } from '../pages/auth/ResetPassword';
import { SignIn } from '../pages/auth/SignIn';
import { SignUp } from '../pages/auth/SignUp';
import { ClientDetail } from '../pages/clients/ClientDetail';
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

export const router = createBrowserRouter([
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
          { path: '/expirations', element: <Expirations /> },
          { path: '/settings/security', element: <Security /> },
        ],
      },
    ],
  },
]);
