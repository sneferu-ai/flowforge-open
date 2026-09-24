import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, GitBranch, History } from 'lucide-react';
import { api, type WorkflowDetail, type WorkflowSummary } from '../lib/api';
import { toast } from '../lib/toast';
import { formatDateTime } from '../lib/status';

interface VersionRow {
  id: string;
  version_num: number;
  is_current: boolean;
  created_at: string;
  manifest_yaml: string | null;
}

interface DiffLine {
  key: string;
  text: string;
  kind: 'same' | 'add' | 'remove';
}

/** Minimal LCS line diff — deterministic, dependency-free (§10.2 YAML diff). */
export function diffLines(a: string, b: string): DiffLine[] {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = al.length;
  const m = bl.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = al[i] === bl[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let key = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      out.push({ key: `s${key++}`, text: al[i], kind: 'same' });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ key: `r${key++}`, text: al[i], kind: 'remove' });
      i++;
    } else {
      out.push({ key: `a${key++}`, text: bl[j], kind: 'add' });
      j++;
    }
  }
  while (i < n) {
    out.push({ key: `r${key++}`, text: al[i], kind: 'remove' });
    i++;
  }
  while (j < m) {
    out.push({ key: `a${key++}`, text: bl[j], kind: 'add' });
    j++;
  }
  return out;
}

export default function WorkflowVersions() {
  const { id } = useParams<{ id: string }>();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const list = await api.get<{ data: WorkflowSummary[] }>('/workflows?include_disabled=true');
    const match = list.data.find((w) => w.id === id || w.slug === id);
    if (!match) {
      setError('Workflow not found');
      setLoading(false);
      return;
    }
    const detail = await api.get<{ data: WorkflowDetail }>(`/workflows/${match.id}`);
    setWf(detail.data);
    const rows = await api.get<{ data: VersionRow[] }>(`/workflows/${match.id}/versions`);
    setVersions(rows.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    setError('');
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [load]);

  const current = useMemo(() => versions.find((v) => v.is_current) ?? versions[0] ?? null, [versions]);
  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions.find((v) => !v.is_current) ?? null,
    [versions, selectedId],
  );

  const diff = useMemo(() => {
    if (!current || !selected) return [];
    /* Current is the base; the selected version's content is subtracted. */
    return diffLines(selected.manifest_yaml ?? '', current.manifest_yaml ?? '');
  }, [current, selected]);

  const hasChanges = useMemo(() => diff.some((line) => line.kind !== 'same'), [diff]);

  const promote = async () => {
    if (!wf || !selected || selected.is_current) return;
    setPromoting(true);
    try {
      const res = await api.post<{ data: { promoted_version: number } }>(
        `/workflows/${wf.id}/promote/${selected.id}`,
        {},
      );
      toast(`Version ${res.data.promoted_version} promoted`);
      await load();
      setSelectedId(null);
    } catch (err) {
      toast(`Promotion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPromoting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }} role="status" aria-label="Loading version history">
        <div className="skeleton" style={{ height: 'var(--skeleton-row-h)', width: 'calc(var(--space-8) * 6 + var(--space-1))', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 'var(--skeleton-block-h)', borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
          Version history
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load versions: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            Check the workflow still exists, then retry.
          </p>
          <button className="btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
        <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <Link to="/workflows" className="link-accent">Back to workflows</Link>
        </p>
      </div>
    );
  }

  if (!wf) return null;

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}>
            Version history
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            <Link to={`/workflows/${wf.id}`} className="link-accent">{wf.name}</Link>
            {' · '}{versions.length} {versions.length === 1 ? 'version' : 'versions'}
          </p>
        </div>
        <Link to={`/workflows/${wf.id}`} className="btn-secondary">
          <GitBranch style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
          Back to workflow
        </Link>
      </div>

      {versions.length === 0 ? (
        <div className="surface-card flex flex-col items-center text-center" style={{ padding: 'var(--space-16) var(--space-8)' }}>
          <History style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-4)' }} />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
            No versions recorded yet.
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-6)' }}>
            Open the workflow editor and save a manifest to create version 1.
          </p>
          <Link to={`/workflows/${wf.id}`} className="btn-primary">Open editor</Link>
        </div>
      ) : (
        <div className="grid versions-split" style={{ gap: 'var(--space-6)' }}>
          {/* Version list */}
          <ol className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  data-testid={`version-${v.version_num}`}
                  className="surface-card w-full text-left"
                  onClick={() => setSelectedId(v.id)}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderColor: v.id === selected?.id ? 'var(--accent)' : 'var(--border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <span className="flex items-center justify-between" style={{ gap: 'var(--space-2)' }}>
                    <span className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                      v{v.version_num}
                    </span>
                    {v.is_current && <span className="badge badge-accent">live</span>}
                  </span>
                  <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                    {formatDateTime(v.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {/* Diff panel */}
          <div className="surface-panel" data-testid="version-diff">
            <div
              className="flex items-center justify-between flex-wrap gap-2 border-b"
              style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
            >
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
                {selected
                  ? selected === current
                    ? `v${selected.version_num} is the live version`
                    : `Changes from v${selected.version_num} → live v${current?.version_num ?? '?'}`
                  : 'Select a version to compare'}
              </span>
              {selected && !selected.is_current && (
                <button
                  data-testid="promote-version-btn"
                  onClick={() => void promote()}
                  disabled={promoting}
                  className="btn-primary btn-sm"
                  style={{ padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}
                >
                  <ArrowUpRight style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  {promoting ? 'Promoting…' : `Promote v${selected.version_num}`}
                </button>
              )}
            </div>
            <div style={{ maxHeight: 'var(--scroll-list-max-h)', overflowY: 'auto', padding: 'var(--space-2) 0' }}>
              {!selected ? (
                <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  Select a version on the left to see its diff against live.
                </p>
              ) : !hasChanges ? (
                <p style={{ padding: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  No differences from the live manifest.
                </p>
              ) : (
                <div role="table" aria-label={`Diff of version ${selected.version_num} against live`}>
                  {diff.map((line) => (
                    <div
                      key={line.key}
                      className={line.kind === 'add' ? 'diff-line diff-line-add' : line.kind === 'remove' ? 'diff-line diff-line-remove' : 'diff-line'}
                      style={line.kind === 'same' ? { color: 'var(--fg-secondary)' } : undefined}
                      aria-hidden="true"
                    >
                      {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '− ' : '  '}
                      {line.text === '' ? '\u00A0' : line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
