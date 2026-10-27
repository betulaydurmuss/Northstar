/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Comma-separated host names that serve the dashboard. Any other host is treated as a
  // client's custom status page domain.
  readonly VITE_APP_HOSTS?: string;
}
