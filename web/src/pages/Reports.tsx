import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { api, ApiError, authorizedBlob } from '../lib/api';
import { useIsAgency } from '../lib/auth';
import { useClients } from '../lib/clients';
import { formatDateTime } from '../lib/format';

type Report = {
  id: string;
  client: { id: string; name: string };
  period: string;
  status: 'queued' | 'ready' | 'failed';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

// The default choice is last month, the most recent one that is complete.
function lastMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

async function download(report: Report) {
  const blob = await authorizedBlob(`/reports/${report.id}/pdf`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.client.name.replace(/[^\w-]+/g, '-')}-${report.period}-uptime-report.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const qc = useQueryClient();
  const isAgency = useIsAgency();
  const clients = useClients();
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Report[]>('/reports'),
    // While anything is rendering, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'queued') ? 3000 : false),
  });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { clientId: string; period: string }) =>
      api('/reports', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({ clientId: String(form.get('clientId')), period: String(form.get('period')) });
  }

  let body;
  if (reports.isPending) {
    body = <Skeleton rows={4} height={48} />;
  } else if (reports.isError) {
    body = <ErrorState message="Could not load reports." onRetry={() => reports.refetch()} />;
  } else if (reports.data.length === 0) {
    body = (
      <EmptyState
        title="No reports yet"
        body="A report for every client is created and emailed on the 1st of each month. You can also create one now."
      />
    );
  } else {
    body = (
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Month</th>
              <th>Status</th>
              <th>Emailed</th>
              <th aria-label="Download" />
            </tr>
          </thead>
          <tbody>
            {reports.data.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 500 }}>{r.client.name}</td>
                <td>{monthLabel(r.period)}</td>
                <td>
                  {r.status === 'ready' && <StatusBadge status="up" label="Ready" />}
                  {r.status === 'queued' && <StatusBadge status="pending" label="Rendering…" />}
                  {r.status === 'failed' && (
                    <span title={r.error ?? undefined}>
                      <StatusBadge status="down" label="Failed" />
                    </span>
                  )}
                </td>
                <td className="muted">{r.sentAt ? formatDateTime(r.sentAt) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {r.status === 'ready' && (
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        download(r).catch((err) =>
                          setDownloadError(
                            err instanceof ApiError ? err.message : 'Download failed',
                          ),
                        )
                      }
                    >
                      <Download size={15} /> PDF
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">
            Monthly uptime reports, branded for each client. Sent automatically on the 1st.
          </p>
        </div>
      </div>
      {isAgency && clients.data && clients.data.length > 0 && (
        <form className="card filters" style={{ alignItems: 'flex-end' }} onSubmit={onSubmit}>
          <FileText
            size={18}
            className="muted"
            aria-hidden="true"
            style={{ alignSelf: 'center' }}
          />
          <div className="field">
            <label htmlFor="r-client">Client</label>
            <select id="r-client" name="clientId" className="input" required>
              {clients.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-period">Month</label>
            <input
              id="r-period"
              name="period"
              type="month"
              className="input"
              defaultValue={lastMonth()}
              max={new Date().toISOString().slice(0, 7)}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            Create report
          </button>
          {create.isError && (
            <span className="field-error">
              {create.error instanceof ApiError ? create.error.message : 'Could not create it'}
            </span>
          )}
        </form>
      )}
      {downloadError && <ErrorState message={downloadError} />}
      {body}
    </>
  );
}
