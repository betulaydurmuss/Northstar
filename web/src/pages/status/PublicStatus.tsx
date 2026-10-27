import '../../styles/status.css';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { StatusView, type PublicStatus as Data } from '../../components/StatusView';
import { api, ApiError } from '../../lib/api';

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, name);
    document.head.append(tag);
  }
  tag.content = content;
}

// Served at /status/:slug, or at the root of a client's own domain (status.client.com),
// where the host name says which page to show.
export function PublicStatus({ byHost = false }: { byHost?: boolean }) {
  const { slug } = useParams();
  const path = byHost
    ? `/public/status-host/${encodeURIComponent(window.location.hostname)}`
    : `/public/status/${slug}`;
  const status = useQuery({
    queryKey: ['public-status', path],
    queryFn: () => api<Data>(path),
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  useEffect(() => {
    if (!status.data) return;
    const title = `${status.data.title} · ${status.data.statusText}`;
    document.title = title;
    setMeta('description', `Live status of ${status.data.client.name}'s services.`);
    setMeta('og:title', title, 'property');
    setMeta('og:description', status.data.statusText, 'property');
    setMeta('theme-color', status.data.client.brandColor);
  }, [status.data]);

  if (status.isPending) {
    return (
      <div className="status-page">
        <div className="status-wrap">
          <div className="skeleton" style={{ height: 40, width: 220 }} />
          <div className="skeleton" style={{ height: 56 }} />
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      </div>
    );
  }
  if (status.isError) {
    const missing = status.error instanceof ApiError && status.error.status === 404;
    return (
      <div className="status-page">
        <div className="status-wrap" style={{ textAlign: 'center', paddingTop: 80 }}>
          <h1>{missing ? 'There is no status page here' : 'Status is unavailable right now'}</h1>
          <p className="muted">
            {missing
              ? 'Check the address, or ask the company for their status page link.'
              : 'Please try again in a minute.'}
          </p>
        </div>
      </div>
    );
  }
  return <StatusView data={status.data} />;
}
