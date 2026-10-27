import { createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../lib/auth';
import { Brand } from '../pages/Brand';
import { ForgotPassword } from '../pages/auth/ForgotPassword';
import { SignIn } from '../pages/auth/SignIn';
import { SignUp } from '../pages/auth/SignUp';
import { Overview } from '../pages/Overview';
import { Styleguide } from '../pages/Styleguide';
import { AppShell } from './AppShell';
import { PublicShell } from './PublicShell';

export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  { path: '/sign-up', element: <SignUp /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
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
        children: [{ path: '/', element: <Overview /> }],
      },
    ],
  },
]);
