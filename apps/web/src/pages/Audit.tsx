import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, ScrollText, ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/status';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

interface AuditRow {
  id: string;
  sequence_num: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Shape of GET /api/v1/audit/verify (server: apps/server/src/audit/emit.ts). */
interface VerifyResult {
  valid: boolean;
  brokenAt: number | null;
  checked_count: number;
  truncated: boolean;
  anchor_sequence_num: number | null;
}

function metadataPreview(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

/** CSV export of the visible audit rows — built client-side from the same
 *  data the table renders (§10.2 audit export). */
function buildCsv(rows: AuditRow[], includeHeader: boolean): string {
  const header = [
    'sequence_num', 'created_at', 'actor_id', 'action', 'entity_type', 'entity_id', 'metadata',
  ].join(',');
  const lines = rows.map((row) => {
    const cells = [
      String(row.sequence_num),
      row.created_at,
      row.actor_id ?? 'system',
      row.action,
      row.entity_type,
      row.entity_id,
      `"${metadataPreview(row.metadata).replaceAll('"', '""')}"`,
    ];
    return cells.join(',');
  });
  return includeHeader ? [header, ...lines].join('\n') : lines.join('\n');
}

export default function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [verification, setVerification] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get<{ data: AuditRow[] }>('/audit?limit=200')
      .then((r) => { if (active) { setRows(r.data); setError(''); } })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (active) setLoading(false); });
    api
      .get<{ data: VerifyResult }>('/audit/verify')
      .then((r) => { if (active) setVerification(r.data); })
      .catch(() => { if (active) setVerification(null); });
    return () => { active = false; };
  }, [attempt]);

  const exportCsv = () => {
    if (rows.length === 0) return;
    const csv = buildCsv(rows, true);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flowforge-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max-audit)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
          Audit Log
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load the audit log: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            Check your connection, or that your plan includes the audit log, then retry.
          </p>
          <button className="btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="enter-fade-up"
      initial={{ opacity: 0, y: enterOffset() }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur('base'), ease: ease('default') }}
      style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max-audit)' }}
    >
      <div
        className="flex items-center justify-between flex-wrap"
        style={{ marginBottom: 'var(--space-6)', gap: 'var(--space-3)' }}
      >
        <div>
          <h1
            className="page-title"
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            Audit Log
          </h1>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-tertiary)',
              marginTop: 'var(--space-1)',
            }}
          >
            Append-only, SHA-256 hash-chained records.
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
        {verification ? (
          <div
            data-testid="audit-verification"
            className="status-pill"
            style={{
              color: verification.valid ? 'var(--status-complete)' : 'var(--status-failed)',
              backgroundColor: verification.valid
                ? 'var(--status-complete-subtle)'
                : 'var(--status-failed-subtle)',
              borderColor: verification.valid
                ? 'var(--status-complete-border)'
                : 'var(--status-failed-border)',
              padding: 'var(--space-2) var(--space-3)',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            {verification.valid ? (
              <ShieldCheck style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            ) : (
              <ShieldAlert style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            )}
            {verification.valid
              ? verification.truncated
                ? `Chain verified · ${verification.checked_count} events · retained from #${verification.anchor_sequence_num ?? 1}`
                : `Chain verified · ${verification.checked_count} events`
              : `Chain broken at seq ${verification.brokenAt ?? 'unknown'}`}
          </div>
        ) : null}

        <button
          data-testid="audit-export-btn"
          className="btn-secondary"
          onClick={exportCsv}
          disabled={rows.length === 0}
          title={rows.length === 0 ? 'No events to export' : 'Export the visible audit log as CSV'}
          style={{ fontSize: 'var(--text-sm)' }}
        >
          <Download style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
          Export
        </button>
        </div>
      </div>

      {loading ? (
        <div className="surface-panel" role="status" aria-label="Loading audit log">
          <div style={{ padding: 'var(--space-5)' }}>
            <div className="skeleton" style={{ height: 'calc(var(--space-3) * 1.5)', width: 'calc(var(--space-8) * 6 + var(--space-1))', marginBottom: 'var(--space-3)' }} />
            <div className="skeleton" style={{ height: 'var(--space-3)', width: '70%' }} />
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div
          className="surface-card"
          data-testid="audit-empty-state"
          style={{
            padding: 'var(--space-12) var(--space-8)',
            textAlign: 'center',
          }}
        >
          <ScrollText
            style={{
              width: 'var(--empty-icon)',
              height: 'var(--empty-icon)',
              color: 'var(--fg-disabled)',
              margin: '0 auto var(--space-3)',
              display: 'block',
            }}
          />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-1)' }}>
            No audit events yet.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', maxWidth: 'var(--empty-max)', margin: '0 auto' }}>
            Events land here whenever someone in the workspace creates, edits, runs, or deletes something.
          </p>
        </div>
      ) : (
        <div className="surface-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 'var(--space-16)' }}>Seq</th>
                <th style={{ width: 'var(--col-when)' }}>When</th>
                <th style={{ width: 'var(--col-actor)' }}>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const preview = metadataPreview(row.metadata);
                return (
                  <tr key={row.id} data-testid={`audit-row-${row.sequence_num}`}>
                    <td
                      className="tabular-nums"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--fg-tertiary)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {row.sequence_num}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-xs)' }}
                    >
                      {formatDateTime(row.created_at)}
                    </td>
                    <td style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                      {row.actor_id ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                          {row.actor_id.slice(0, 12)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--fg-tertiary)' }}>system</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          color: 'var(--fg-primary)',
                          fontWeight: 'var(--weight-medium)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                        {row.entity_type}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          color: 'var(--fg-tertiary)',
                          marginLeft: 'var(--space-2)',
                        }}
                      >
                        {row.entity_id.slice(0, 10)}…
                      </span>
                    </td>
                    <td>
                      {preview ? (
                        <details style={{ cursor: 'pointer' }}>
                          <summary
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--fg-tertiary)',
                              cursor: 'pointer',
                            }}
                          >
                            <span
                              style={{
                                display: 'inline-block',
                                maxWidth: 'var(--col-event-max)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                verticalAlign: 'bottom',
                              }}
                            >
                              {preview}
                            </span>
                          </summary>
                          <pre
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--fg-secondary)',
                              background: 'var(--bg-base)',
                              border: 'var(--border-width) solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              padding: 'var(--space-2) var(--space-3)',
                              marginTop: 'var(--space-2)',
                              maxWidth: 'var(--col-detail-max)',
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {preview}
                          </pre>
                        </details>
                      ) : (
                        <span style={{ color: 'var(--fg-disabled)', fontSize: 'var(--text-xs)' }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
