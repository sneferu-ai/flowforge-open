import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, Download, GitBranch, History, ListTree,
  Loader2, Play, Rocket, Save, ScrollText, ShieldCheck, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { ReactFlow, Background, Position, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type RunSummary, type WorkflowDetail, type WorkflowSummary } from '../lib/api';
import { toast } from '../lib/toast';
import { StatusPill, formatWhen } from '../lib/status';

interface TriggerInfo {
  id: string;
  type: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  next_fire_at: string | null;
  created_at: string;
}

interface ManifestResponse {
  manifest_yaml: string;
  version_num: number;
}

interface ValidationIssue {
  code?: string;
  message?: string;
  path?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/* Flow-canvas geometry — y-positions are coordinate math, not theme
   styling; node width references the token layer (--flow-node-w). */
const FLOW_ROW_SPACING = 88;

export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [yaml, setYaml] = useState('');
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const load = useCallback(async () => {
    const list = await api.get<{ data: WorkflowSummary[] }>('/workflows?include_disabled=true');
    const match = list.data.find((w) => w.id === id || w.slug === id);
    if (!match) {
      setError('Workflow not found');
      return;
    }
    const detail = await api.get<{ data: WorkflowDetail }>(`/workflows/${match.id}`);
    setWf(detail.data);
    void api
      .get<{ data: TriggerInfo[] }>(`/workflows/${match.id}/triggers`)
      .then((r) => setTriggers(r.data))
      .catch(() => setTriggers([]));
    void api
      .get<{ data: RunSummary[] }>(`/runs?workflow_id=${match.id}&limit=20`)
      .then((r) => setRuns(r.data))
      .catch(() => setRuns([]));
  }, [id]);

  useEffect(() => {
    setError('');
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, load]);

  useEffect(() => {
    if (wf?.id && (location.state as { justCreated?: boolean } | null)?.justCreated) {
      void startEditing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf?.id]);

  const startEditing = async () => {
    if (!wf?.id) return;
    if (editing) return;
    setBusy('edit');
    try {
      const manifest = await api.get<{ data: ManifestResponse }>(`/workflows/${wf.id}/manifest`);
      setYaml(manifest.data.manifest_yaml);
      setEditing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    if (!wf) return;
    setBusy('save');
    try {
      const res = await api.put<{ data: { version_id: string | null; draft: boolean; version: number | null } }>(
        `/workflows/${wf.id}`,
        { manifest: yaml }
      );
      if (res.data.draft && res.data.version_id) {
        setDraftVersionId(res.data.version_id);
        toast(`Draft v${res.data.version} saved — promote it to go live`);
        setEditing(false);
      } else {
        toast('Saved');
        setEditing(false);
      }
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast(`Save failed: ${message}`);
    } finally {
      setBusy(null);
    }
  };

  const promote = async () => {
    if (!wf || !draftVersionId) return;
    setBusy('promote');
    try {
      const res = await api.post<{ data: { promoted_version: number } }>(`/workflows/${wf.id}/promote/${draftVersionId}`, {});
      setDraftVersionId(null);
      toast(`Version ${res.data.promoted_version} promoted`);
      await load();
    } catch (err) {
      toast(`Promotion failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    if (!wf) return;
    setBusy('run');
    try {
      const res = await api.post<{ data: { run_id: string; status: string } }>(`/workflows/${wf.id}/run`, {
        inputs: {},
      });
      toast('Run started');
      navigate(`/runs/${res.data.run_id}`);
    } catch (err) {
      toast(`Could not start run: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(null);
    }
  };

  const toggleEnabled = async () => {
    if (!wf) return;
    setBusy('toggle');
    try {
      await api.put<{ data: unknown }>(`/workflows/${wf.id}`, { is_enabled: !wf.is_enabled });
      await load();
    } catch (err) {
      toast(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  /** Validate the in-editor manifest against the engine schema (§5/§D4). */
  const validateManifest = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const res = await api.post<{ data: ValidationResult }>('/workflows/validate', {
        manifest: yaml,
      });
      setValidation(res.data);
    } catch (err) {
      toast(`Validation could not run: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setValidating(false);
    }
  };

  /** Export the current (live) manifest as a downloadable YAML file. */
  const exportManifest = async () => {
    if (!wf) return;
    try {
      const manifest = await api.get<{ data: ManifestResponse }>(`/workflows/${wf.id}/manifest`);
      const blob = new Blob([manifest.data.manifest_yaml], { type: 'application/x-yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${wf.slug ?? wf.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.v${manifest.data.version_num}.yaml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Manifest exported');
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const outline = useMemo(() => parseOutline(yaml || ''), [yaml]);

  /* Auto-generated, read-only flow diagram (§D6: the manifest is the single
   * source of truth; the graph is a one-way projection). */
  const flow = useMemo(() => {
    const nodes: Node[] = outline.steps.map((s, i) => ({
      id: s.id,
      position: { x: 0, y: i * FLOW_ROW_SPACING },
      data: { label: `${s.id} · ${s.type}` },
      type: undefined,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: {
        background: 'var(--bg-elevated)',
        color: 'var(--fg-primary)',
        border: 'var(--border-width) solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-code)',
        padding: 'var(--space-2) var(--space-3)',
        width: 'var(--flow-node-w)',
        textAlign: 'left',
      },
    }));
    const edges: Edge[] = nodes.slice(1).map((n, i) => ({
      id: `e-${nodes[i].id}-${n.id}`,
      source: nodes[i].id,
      target: n.id,
      type: 'smoothstep',
    }));
    return { nodes, edges };
  }, [outline]);

  if (error && !wf) {
    return (
      <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-6)' }}>
          Workflow
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-2)' }}>
            Could not load this workflow: {error}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-4)' }}>
            The workflow may have been deleted, or the server is unreachable. Check your connection and retry.
          </p>
          <div className="flex justify-center" style={{ gap: 'var(--space-2)' }}>
            <button className="btn-secondary" onClick={() => { setError(''); void load(); }}>
              Try again
            </button>
            <Link to="/workflows" className="btn-ghost">Back to workflows</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!wf) {
    return (
      <div style={{ padding: 'var(--space-8)' }} role="status" aria-label="Loading workflow">
        <div className="skeleton" style={{ height: 'var(--space-6)', width: 'calc(var(--space-8) * 6 + var(--space-1))', marginBottom: 'var(--space-4)' }} />
        <div className="skeleton" style={{ height: 'calc(var(--space-12) * 2 + var(--space-6))', borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h1
            className="page-title detail-name"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}
          >
            {wf.name}
          </h1>
          <p className="tabular-nums" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            {wf.slug ? `${wf.slug} · ` : ''}version {wf.current_version ?? 0}
            {wf.current_version_id && (
              <span style={{ marginLeft: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)', fontFamily: 'var(--font-mono)' }}>
                {wf.current_version_id.slice(0, 8)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-testid="toggle-enabled"
            onClick={() => void toggleEnabled()}
            disabled={busy === 'toggle'}
            className="btn-secondary"
            style={{ fontSize: 'var(--text-sm)' }}
            title={wf.is_enabled ? 'Disable workflow' : 'Enable workflow'}
            aria-label={wf.is_enabled ? 'Disable workflow' : 'Enable workflow'}
          >
            {busy === 'toggle' ? (
              <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            ) : wf.is_enabled ? (
              <ToggleRight style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--status-complete)' }} />
            ) : (
              <ToggleLeft style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--fg-tertiary)' }} />
            )} {busy === 'toggle' ? 'Toggling…' : wf.is_enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button
            data-testid="edit-manifest-btn"
            onClick={() => void startEditing()}
            disabled={busy === 'edit'}
            className="btn-secondary"
            style={{ fontSize: 'var(--text-sm)' }}
            aria-label="Edit manifest"
          >
            {busy === 'edit' ? (
              <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            ) : (
              <ScrollText style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            )} {busy === 'edit' ? 'Opening…' : 'Edit manifest'}
          </button>
          <Link
            to={`/workflows/${wf.id}/versions`}
            data-testid="versions-link"
            className="btn-ghost"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            <History style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} /> Versions
          </Link>
          <button
            data-testid="export-manifest-btn"
            onClick={() => void exportManifest()}
            className="btn-ghost"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            <Download style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} /> Export
          </button>
          <button
            data-testid="run-now-btn"
            onClick={() => void runNow()}
            disabled={busy === 'run' || !wf.is_enabled}
            className="btn-primary"
            style={{ fontSize: 'var(--text-sm)' }}
            title={!wf.is_enabled ? 'Enable the workflow to run it' : 'Run workflow now'}
            aria-label={wf.is_enabled ? 'Run Now' : 'Run Now (workflow disabled — enable it first)'}
          >
            {busy === 'run' ? (
              <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            ) : (
              <Play style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            )} {busy === 'run' ? 'Starting…' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Draft notice */}
      {draftVersionId && (
        <div
          className="flex items-center gap-3 rounded-lg"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--bg-elevated)',
            border: 'var(--border-width) solid var(--accent)',
          }}
        >
          <Rocket style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--accent)' }} />
          <p
            style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', flex: 1 }}
            data-testid="draft-notice"
          >
            A draft version is waiting. Promote it to update the live workflow.
          </p>
          <button
            data-testid="promote-btn"
            onClick={() => void promote()}
            disabled={busy === 'promote'}
            className="btn-primary btn-sm"
            style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' }}
            aria-label="Promote"
          >
            {busy === 'promote' ? (
              <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            ) : (
              <Rocket style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
            )} {busy === 'promote' ? 'Promoting…' : 'Promote'}
          </button>
        </div>
      )}

      {/* Manifest editor + auto-generated flow graph (§D6, §10.2 55/45) */}
      {editing && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <div
            className="surface-panel overflow-hidden"
            style={{ marginBottom: 'var(--space-3)' }}
          >
            <div
              className="flex items-center justify-between flex-wrap gap-2 border-b"
              style={{ padding: 'var(--space-2) var(--space-4)', borderColor: 'var(--border-default)' }}
            >
              <span id="manifest-editor-label" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', fontWeight: 'var(--weight-medium)' }}>
                Manifest (YAML) — edits become a draft version
              </span>
              <div className="flex items-center gap-2">
                <button
                  data-testid="validate-workflow-btn"
                  onClick={() => void validateManifest()}
                  disabled={validating}
                  className="btn-ghost btn-sm"
                  aria-label="Validate manifest"
                  style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' }}
                >
                  {validating ? (
                    <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  ) : (
                    <ShieldCheck style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  )}
                  {validating ? 'Validating…' : 'Validate'}
                </button>
                <button
                  onClick={() => { setEditing(false); setValidation(null); }}
                  className="btn-ghost btn-sm"
                  style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' }}
                >
                  Cancel
                </button>
                <button
                  id="save-workflow"
                  data-testid="save-workflow"
                  onClick={() => void saveDraft()}
                  disabled={busy === 'save'}
                  className="btn-primary btn-sm"
                  style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' }}
                  aria-label="Save version"
                >
                  {busy === 'save' ? (
                    <Loader2 className="animate-spin" style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  ) : (
                    <Save style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                  )} {busy === 'save' ? 'Saving…' : 'Save version'}
                </button>
              </div>
            </div>

            {validation && (
              <div
                data-testid="validation-result"
                className="flex items-start gap-2 border-b"
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderColor: 'var(--border-default)',
                  background: validation.valid ? 'var(--status-complete-subtle)' : 'var(--status-failed-subtle)',
                }}
              >
                {validation.valid ? (
                  <CheckCircle2 style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--status-complete)', flexShrink: 0, marginTop: 'calc(var(--space-1) / 2)' }} />
                ) : (
                  <AlertTriangle style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--status-failed)', flexShrink: 0, marginTop: 'calc(var(--space-1) / 2)' }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 'var(--text-sm)', color: validation.valid ? 'var(--status-complete)' : 'var(--status-failed)' }}>
                    {validation.valid
                      ? `Manifest is valid${validation.warnings.length > 0 ? ` — ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}` : ''}`
                      : `Manifest is invalid — ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'}`}
                  </p>
                  <ul className="flex flex-col" style={{ gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                    {validation.errors.slice(0, 8).map((e, i) => (
                      <li key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>
                        {e.path ? <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{e.path}</code> : null}
                        {e.path ? ': ' : ''}
                        {e.message ?? 'unknown validation error'}
                      </li>
                    ))}
                    {validation.warnings.slice(0, 4).map((w, i) => (
                      <li key={`w${i}`} style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                        {w.message ?? 'warning'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="grid editor-split">
              <textarea
                id="manifest-editor"
                data-testid="manifest-editor"
                aria-labelledby="manifest-editor-label"
                value={yaml}
                onChange={(e) => { setYaml(e.target.value); setValidation(null); }}
                spellCheck={false}
                className="manifest-editor"
                style={{
                  width: '100%',
                  height: 'var(--yaml-editor-h)',
                  background: 'var(--bg-base)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 'var(--line-relaxed)',
                  color: 'var(--fg-primary)',
                  padding: 'var(--space-4)',
                  resize: 'none',
                  border: 'none',
                  borderTop: 'var(--border-width) solid var(--border-subtle)',
                  display: 'block',
                }}
              />
              <FlowPreview nodes={flow.nodes} edges={flow.edges} stepCount={outline.steps.length} />
            </div>
            {outline.steps.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 border-t"
              style={{ padding: 'var(--space-3) var(--space-4)', borderColor: 'var(--border-default)' }}
            >
              <ListTree style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--fg-tertiary)' }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Steps:</span>
              {outline.steps.map((s) => (
                <span
                  key={s.id}
                  className="badge"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
                >
                  {s.id}
                </span>
              ))}
            </div>
          )}
            </div>
        </div>
      )}

      {/* Two-column: triggers + runs */}
      <div className="grid gap-6 split-half" style={{ marginTop: 'var(--space-8)' }}>
        {/* Triggers */}
        <section className="surface-panel" style={{ padding: 'var(--space-5)' }}>
          <h2 className="panel-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-3)' }}>
            Triggers
          </h2>
          {triggers.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                No triggers yet.
              </p>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                Add a <code style={{ fontFamily: 'var(--font-mono)' }}>triggers:</code> block to the
                manifest to fire this workflow on schedule or via webhook.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {triggers.map((t) => (
                <li key={t.id} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 'var(--text-sm)' }}>
                  <span
                    className="badge"
                    style={{ textTransform: 'uppercase', fontSize: 'var(--text-xs)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  >
                    {t.type}
                  </span>
                  {t.type === 'schedule' && typeof t.config.cron === 'string' && (
                    <code style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {t.config.cron}
                    </code>
                  )}
                  {t.type === 'schedule' && typeof t.config.timezone === 'string' && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{t.config.timezone}</span>
                  )}
                  {t.type === 'webhook' && (
                    <code style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>
                      /hooks/{wf.slug}/{String(t.config.path ?? '')}
                    </code>
                  )}
                  {t.type === 'webhook' && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                      auth: {String(t.config.auth_mode ?? 'hmac')}
                    </span>
                  )}
                  {t.next_fire_at && (
                    <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>
                      next {formatWhen(t.next_fire_at)}
                    </span>
                  )}
                  {!t.is_enabled && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)' }}>(disabled)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent runs */}
        <section className="surface-panel" style={{ padding: 'var(--space-5)' }}>
          <h2 className="panel-heading" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-3)' }}>
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>No runs yet — hit Run Now.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.slice(0, 8).map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3" style={{ fontSize: 'var(--text-sm)' }}>
                  <button
                    className="link-accent text-left truncate"
                    style={{ font: 'inherit' }}
                    onClick={() => navigate(`/runs/${run.id}`)}
                    aria-label={`View run from ${formatWhen(run.created_at)}`}
                  >
                    {formatWhen(run.created_at)}
                  </button>
                  <StatusPill status={run.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Footer: workflow ID */}
      <div
        className="flex items-center gap-2 tabular-nums"
        style={{ marginTop: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)' }}
      >
        <GitBranch style={{ width: 'var(--icon-xs)', height: 'var(--icon-xs)' }} />
        Workflow ID <code style={{ fontFamily: 'var(--font-mono)' }}>{wf.id}</code>
      </div>
    </div>
  );
}

interface OutlineStep {
  id: string;
  type: string;
}

function parseOutline(yamlText: string): { steps: OutlineStep[] } {
  /* Parse top-level steps only (`- id:` at column 0...2) and pair each id with
   * the `type:` line that follows it inside the same block. */
  const blockRe = /^ {0,2}- id:\s*(\S+)\s*\n((?: {0,6}\S.*\n)*)/gm;
  const steps: OutlineStep[] = [];
  for (const m of yamlText.matchAll(blockRe)) {
    const id = m[1];
    const body = m[2] ?? '';
    const typeMatch = body.match(/^ {0,6}type:\s*(\S+)\s*$/m);
    steps.push({ id, type: typeMatch?.[1] ?? 'step' });
  }
  return { steps };
}

/** Read-only auto-generated projection of the step sequence (§D6). */
function FlowPreview({
  nodes,
  edges,
  stepCount,
}: {
  nodes: Node[];
  edges: Edge[];
  stepCount: number;
}) {
  return (
    <div
      data-testid="workflow-flow-graph"
      style={{
        height: 'var(--yaml-editor-h)',
        borderLeft: 'var(--border-width) solid var(--border-subtle)',
        background: 'var(--bg-base)',
      }}
      aria-label="Auto-generated flow diagram"
    >
      {stepCount === 0 ? (
        <div className="flex flex-col items-center justify-center h-full" style={{ gap: 'var(--space-2)', padding: 'var(--space-4)' }}>
          <GitBranch style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--fg-disabled)' }} />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>
            No steps parsed yet — the diagram appears as soon as the manifest lists steps.
          </p>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll={false}
          defaultEdgeOptions={{
            style: { stroke: 'var(--accent)', strokeWidth: 1.5 },
            animated: false,
          }}
        >
          <Background gap={16} color="var(--border-subtle)" />
        </ReactFlow>
      )}
    </div>
  );
}
