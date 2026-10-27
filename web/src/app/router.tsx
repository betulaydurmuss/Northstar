import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../lib/auth';
import { Brand } from '../pages/Brand';
import { ForgotPassword } from '../pages/auth/ForgotPassword';
import { ResetPassword } from '../pages/auth/ResetPassword';
import { SignIn } from '../pages/auth/SignIn';
import { SignUp } from '../pages/auth/SignUp';
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
          { path: '/monitors/:id/edit', element: <EditMonitor /> },
          // Alert emails link here; it becomes the monitor's detail page with the charts.
          { path: '/monitors/:id', element: <EditMonitor /> },
          { path: '/settings/security', element: <Security /> },
        ],
      },
    ],
  },
]);
