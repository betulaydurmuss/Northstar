import '../../styles/status.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { StatusView, type PublicStatus } from '../../components/StatusView';
import { api, ApiError } from '../../lib/api';
import { useClient } from '../../lib/clients';

type Selection = { monitorId: string; displayName: string; groupName: string };
type SavedPage = {
  id: string;
  slug: string;
  domainVerifiedAt: string | null;
  title: string;
  isPublic: boolean;
  customDomain: string | null;
  monitors: { monitorId: string; displayName: string | null; groupName: string | null }[];
};
type Preview = PublicStatus & { monitorIds: string[] };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

// Before a custom domain is served, the agency proves it controls it with a TXT record.
function DomainProof({ page, clientId }: { page: SavedPage; clientId: string }) {
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api(`/status-pages/by-client/${clientId}/verify-domain`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page', clientId] }),
  });
  if (page.domainVerifiedAt) {
    return <StatusBadge status="up" label="Domain verified" />;
  }
  return (
    <div
      className="card card-raised stack"
      style={{ padding: 12, gap: 8, fontSize: 'var(--text-xs)' }}
    >
      <span>
        To prove the domain is yours, also add a <code>TXT</code> record at{' '}
        <code>_northstar.{page.customDomain}</code> with the value:
      </span>
      <code style={{ wordBreak: 'break-all' }}>northstar-verify={page.id}</code>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
        >
          {verify.isPending ? 'Checking DNS…' : 'Verify domain'}
        </button>
      </div>
      {verify.isError && (
        <span className="field-error">
          {verify.error instanceof ApiError ? verify.error.message : 'Could not check DNS'}
        </span>
      )}
    </div>
  );
}

export function StatusPageEditor() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const client = useClient(id);
  const saved = useQuery({
    queryKey: ['status-page', id],
    queryFn: () => api<SavedPage | null>(`/status-pages/by-client/${id}`),
  });
  const preview = useQuery({
    queryKey: ['status-page', id, 'preview'],
    queryFn: () => api<Preview>(`/status-pages/by-client/${id}/preview`),
  });

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [customDomain, setCustomDomain] = useState('');
  const [selection, setSelection] = useState<Selection[]>([]);
  const [ready, setReady] = useState(false);

  // Start from what is saved, or from sensible defaults for a first page.
  useEffect(() => {
    if (ready || saved.isPending || !preview.data || !client.data) return;
    const page = saved.data;
    setTitle(page?.title ?? `${client.data.name} status`);
    setSlug(page?.slug ?? slugify(client.data.name));
    setIsPublic(page?.isPublic ?? true);
    setCustomDomain(page?.customDomain ?? '');
    setSelection(
      page
        ? page.monitors.map((m) => ({
            monitorId: m.monitorId,
            displayName: m.displayName ?? '',
            groupName: m.groupName ?? '',
          }))
        : preview.data.monitorIds.map((monitorId) => ({
            monitorId,
            displayName: '',
            groupName: '',
          })),
    );
    setReady(true);
  }, [ready, saved.isPending, saved.data, preview.data, client.data]);

  const save = useMutation({
    mutationFn: () =>
      api<SavedPage>(`/status-pages/by-client/${id}`, {
        method: 'PUT',
        body: { title, slug, isPublic, customDomain, monitors: selection },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-page', id] }),
  });

  // The preview applies the unsaved selection to the latest real data.
  const draft = useMemo((): PublicStatus | null => {
    if (!preview.data) return null;
    const byId = new Map(preview.data.monitorIds.map((mid, i) => [mid, preview.data.monitors[i]!]));
    const monitors = selection.flatMap((s) => {
      const m = byId.get(s.monitorId);
      return m
        ? [{ ...m, name: s.displayName.trim() || m.name, group: s.groupName.trim() || null }]
        : [];
    });
    const down = monitors.filter((m) => m.status === 'down').length;
    const maintenance = preview.data.maintenance.some((w) => w.active);
    const status =
      down && down === monitors.length
        ? 'outage'
        : down
          ? 'degraded'
          : maintenance
            ? 'maintenance'
            : 'operational';
    const statusText = {
      operational: 'All systems operational',
      degraded: 'Some systems are down',
      outage: 'Major outage',
      maintenance: 'Scheduled maintenance in progress',
    }[status];
    // Incidents follow the draft too: hidden monitors drop out, renamed ones are retitled.
    const shown = new Map(monitors.map((m) => [m.key, m.name]));
    const retitle = (list: PublicStatus['activeIncidents']) =>
      list
        .filter((i) => shown.has(i.monitor))
        .map((i) => ({
          ...i,
          title: `${shown.get(i.monitor)} ${i.resolvedAt ? 'was' : 'is'} unavailable`,
        }));
    return {
      ...preview.data,
      title,
      monitors,
      status,
      statusText,
      activeIncidents: retitle(preview.data.activeIncidents),
      pastIncidents: retitle(preview.data.pastIncidents),
    };
  }, [preview.data, selection, title]);

  if (client.isPending || preview.isPending || saved.isPending)
    return <Skeleton rows={6} height={48} />;
  if (client.isError || preview.isError)
    return <ErrorState message="Could not load this client." />;

  const names = new Map(
    preview.data.monitorIds.map((mid, i) => [mid, preview.data.monitors[i]!.name]),
  );
  const selected = new Set(selection.map((s) => s.monitorId));
  const publicUrl = `${window.location.origin}/status/${slug}`;

  const move = (index: number, by: number) =>
    setSelection((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  const update = (index: number, change: Partial<Selection>) =>
    setSelection((list) => list.map((s, i) => (i === index ? { ...s, ...change } : s)));

  return (
    <>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 8 }}>
          <Link
            to={`/clients/${id}`}
            className="muted row"
            style={{ gap: 6, fontSize: 'var(--text-sm)' }}
          >
            <ArrowLeft size={14} /> {client.data.name}
          </Link>
          <h1>Status page</h1>
          <p className="muted">
            What {client.data.name}&apos;s customers see when they check whether the site is up.
          </p>
        </div>
        {saved.data?.isPublic && (
          <a className="btn" href={`/status/${saved.data.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open public page
          </a>
        )}
      </div>

      <div className="editor">
        <form
          className="card stack"
          style={{ gap: 18, alignSelf: 'start' }}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="sp-title">Title</label>
            <input
              id="sp-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="sp-slug">Address</label>
            <input
              id="sp-slug"
              className="input mono"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value))}
              required
            />
            <span
              className="muted mono"
              style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}
            >
              {publicUrl}
            </span>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Anyone with the link can see this page
          </label>

          <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>
              Services shown, in this order
            </legend>
            {selection.map((s, i) => (
              <div
                key={s.monitorId}
                className="card card-raised stack"
                style={{ padding: 12, gap: 8 }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{names.get(s.monitorId)}</strong>
                  <div className="row" style={{ gap: 0 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={i === selection.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setSelection((list) => list.filter((x) => x.monitorId !== s.monitorId))
                      }
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div
                  className="grid-2"
                  style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}
                >
                  <input
                    className="input"
                    placeholder="Public name"
                    aria-label={`Public name for ${names.get(s.monitorId)}`}
                    value={s.displayName}
                    onChange={(e) => update(i, { displayName: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Group (optional)"
                    aria-label={`Group for ${names.get(s.monitorId)}`}
                    value={s.groupName}
                    onChange={(e) => update(i, { groupName: e.target.value })}
                  />
                </div>
              </div>
            ))}
            {preview.data.monitorIds
              .filter((mid) => !selected.has(mid))
              .map((mid) => (
                <div key={mid} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{names.get(mid)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setSelection((list) => [
                        ...list,
                        { monitorId: mid, displayName: '', groupName: '' },
                      ])
                    }
                  >
                    Show
                  </button>
                </div>
              ))}
            {preview.data.monitorIds.length === 0 && (
              <p className="muted">This client has no monitors yet. Add one to list it here.</p>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="sp-domain">Custom domain (optional)</label>
            <input
              id="sp-domain"
              className="input mono"
              placeholder="status.harborpine.coffee"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.trim().toLowerCase())}
            />
            {customDomain && (
              <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                At the domain&apos;s DNS provider, add a <code>CNAME</code> record from{' '}
                <code>{customDomain}</code> to <code>{window.location.hostname}</code>.
              </span>
            )}
            {saved.data?.customDomain && saved.data.customDomain === customDomain && (
              <DomainProof page={saved.data} clientId={id} />
            )}
          </div>

          {save.isError && (
            <ErrorState
              message={save.error instanceof ApiError ? save.error.message : 'Could not save.'}
            />
          )}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : saved.data ? 'Save changes' : 'Publish page'}
            </button>
            {save.isSuccess && <span className="muted">Saved.</span>}
          </div>
        </form>

        <div className="editor-preview" aria-label="Preview">
          <div className="editor-preview-bar">
            <span className="mono">{publicUrl}</span>
            <span>Preview</span>
          </div>
          <div className="editor-preview-frame">{draft && <StatusView data={draft} />}</div>
        </div>
      </div>
    </>
  );
}
