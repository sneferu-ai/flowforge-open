import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Check, Layers, Play } from 'lucide-react';
import { api, setCsrfToken, type MeResponse, type TemplateInfo } from '../lib/api';
import { toast } from '../lib/toast';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

/**
 * Three-step onboarding wizard (§10.2 /onboarding):
 *   1. Workspace — create it (POST /workspaces scopes the session),
 *   2. Template — instantiate one of the five templates,
 *   3. Run — trigger the first run and land on its live detail page.
 * Every step offers "skip" with an honest destination.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // Step 1 state
  const [wsName, setWsName] = useState('');
  const [wsBusy, setWsBusy] = useState(false);
  const [wsError, setWsError] = useState('');
  const [createdWorkspace, setCreatedWorkspace] = useState<string | null>(null);

  // Step 2 state
  const [tplBusy, setTplBusy] = useState<string | null>(null);
  const [tplError, setTplError] = useState('');
  const [createdWorkflow, setCreatedWorkflow] = useState<{ id: string; name: string } | null>(null);

  // Step 3 state
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get<{ data: MeResponse }>('/auth/me')
      .then((r) => {
        if (r.data.csrf_token) setCsrfToken(r.data.csrf_token);
        // Already in a workspace? Skip step 1.
        if (r.data.workspace && active) {
          setCreatedWorkspace(r.data.workspace.name);
          setStep(2);
        }
      })
      .catch(() => { /* proceed as logged-out; step 1 will surface the error */ });
    api
      .get<{ data: TemplateInfo[] }>('/templates')
      .then((r) => { if (active) setTemplates(r.data); })
      .catch(() => { if (active) setTemplates([]); })
      .finally(() => { if (active) setTemplatesLoading(false); });
    return () => { active = false; };
  }, []);

  const createWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsName.trim()) {
      setWsError('Give the workspace a name — you can change it later');
      return;
    }
    setWsError('');
    setWsBusy(true);
    try {
      const res = await api.post<{
        data: { id: string; name: string; slug: string; plan_id: string; csrf_token: string };
      }>('/workspaces', { name: wsName.trim() });
      if (res.data.csrf_token) setCsrfToken(res.data.csrf_token);
      setCreatedWorkspace(res.data.name);
      setStep(2);
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    } finally {
      setWsBusy(false);
    }
  };

  const pickTemplate = async (t: TemplateInfo) => {
    setTplBusy(t.id);
    setTplError('');
    try {
      const res = await api.post<{ data: { id: string; name: string } }>('/workflows/from-template', {
        template_id: t.id,
      });
      setCreatedWorkflow(res.data);
      setStep(3);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already exists')) {
        try {
          const list = await api.get<{ data: Array<{ id: string; name: string; slug: string | null }> }>(
            '/workflows?include_disabled=true'
          );
          const existing = list.data.find(
            (w) => w.name === t.name || w.slug === t.id || (w.slug ?? '').startsWith(t.id)
          );
          if (existing) {
            setCreatedWorkflow(existing);
            setStep(3);
            return;
          }
        } catch { /* fall through */ }
      }
      setTplError(`Could not create '${t.name}': ${message}`);
    } finally {
      setTplBusy(null);
    }
  };

  const runFirst = async () => {
    if (!createdWorkflow) return;
    setRunBusy(true);
    setRunError('');
    try {
      const res = await api.post<{ data: { run_id: string; status: string } }>(
        `/workflows/${createdWorkflow.id}/run`,
        { inputs: {} },
      );
      toast('Run started');
      navigate(`/runs/${res.data.run_id}`, { replace: true });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
      setRunBusy(false);
    }
  };

  const stepMeta: Array<{ label: string; done: boolean; active: boolean }> = [
    { label: 'Workspace', done: createdWorkspace !== null, active: step === 1 },
    { label: 'Template', done: step === 3, active: step === 2 },
    { label: 'Run', done: false, active: step === 3 },
  ];

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: 'var(--bg-base)', padding: 'var(--space-4)' }}
    >
      <motion.div
        className="surface-card w-full max-w-lg"
        style={{ padding: 'var(--space-8)' }}
        initial={{ opacity: 0, y: enterOffset() }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: dur('base'), ease: ease('emphasized') }}
      >
        {/* Stepper */}
        <ol className="flex items-center justify-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-8)' }} aria-label="Onboarding progress">
          {stepMeta.map((s, i) => (
            <li key={s.label} className="flex items-center" style={{ gap: 'var(--space-2)' }}>
              <span
                className="badge"
                style={
                  s.active
                    ? { borderColor: 'var(--accent-border)', color: 'var(--accent)', background: 'var(--accent-subtle)' }
                    : s.done
                      ? { borderColor: 'var(--status-complete-border)', color: 'var(--status-complete)' }
                      : undefined
                }
              >
                {s.done ? <Check style={{ width: 'var(--step-check)', height: 'var(--step-check)' }} /> : <span className="tabular-nums">{i + 1}</span>}
                {s.label}
              </span>
              {i < stepMeta.length - 1 && <span style={{ width: 'var(--step-connector-w)', height: 'var(--border-width)', background: 'var(--border-default)' }} aria-hidden="true" />}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div data-testid="onboarding-workspace">
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <Building2 style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--accent)' }} />
              <div>
                <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}>
                  Create your workspace
                </h1>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  One workspace holds your workflows, runs, and clients.
                </p>
              </div>
            </div>
            <form onSubmit={createWorkspace} className="flex flex-col gap-4">
              <div>
                <label htmlFor="onb-ws-name" className="field-label">Workspace name</label>
                <input
                  id="onb-ws-name"
                  className="input-field"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="Acme Agency"
                  autoFocus
                  disabled={wsBusy}
                  aria-invalid={wsError ? 'true' : undefined}
                  aria-describedby={wsError ? 'onboarding-error' : undefined}
                />
              </div>
              {wsError && (
                <p id="onboarding-error" className="form-error" data-testid="onboarding-error" style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
                  {wsError}
                </p>
              )}
              <button type="submit" className="btn-primary justify-center" disabled={wsBusy} aria-label="Create workspace">
                {wsBusy ? 'Creating…' : 'Create workspace'}
              </button>
            </form>
          </div>
        )}

        {step === 2 && (
          <div data-testid="onboarding-template">
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <Layers style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--accent)' }} />
              <div>
                <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}>
                  {createdWorkspace ? `${createdWorkspace} — pick a starting workflow` : 'Pick a starting workflow'}
                </h1>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  Five validated templates; you can edit the YAML after.
                </p>
              </div>
            </div>
            {templatesLoading ? (
              <div className="flex flex-col gap-2" role="status" aria-label="Loading templates">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 'var(--skeleton-card-h)', borderRadius: 'var(--radius-sm)' }} />
                ))}
              </div>
            ) : templates.length === 0 ? (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>
                No templates available right now. Continue to the workflow editor to author one from scratch.
              </p>
            ) : (
              <ol className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      data-testid={`onboarding-template-${t.id}`}
                      disabled={tplBusy !== null}
                      onClick={() => void pickTemplate(t)}
                      className="surface-card w-full text-left"
                      style={{
                        padding: 'var(--space-3) var(--space-4)',
                        opacity: tplBusy !== null && tplBusy !== t.id ? 0.5 : 1,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--fg-primary)', display: 'block' }}>
                        {tplBusy === t.id ? `Creating ${t.name}…` : t.name}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>{t.summary}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {tplError && (
              <p className="form-error" data-testid="onboarding-error" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
                {tplError}
              </p>
            )}
            <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)' }}>
              <Link to="/workflows/new" className="btn-secondary">
                Author YAML instead
              </Link>
              <Link to="/dashboard" className="btn-ghost">
                Skip for now
              </Link>
            </div>
          </div>
        )}

        {step === 3 && createdWorkflow && (
          <div data-testid="onboarding-run">
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <Play style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--accent)' }} />
              <div>
                <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', fontFamily: 'var(--font-display)' }}>
                  Run your first workflow
                </h1>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>
                  '{createdWorkflow.name}' is ready. Run it now and watch the steps live.
                </p>
              </div>
            </div>
            {runError && (
              <p className="form-error" data-testid="onboarding-error" style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}>
                {runError}
              </p>
            )}
            <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
              <button
                data-testid="onboarding-run-btn"
                className="btn-primary"
                onClick={() => void runFirst()}
                disabled={runBusy}
                aria-label="Run now"
              >
                <Play style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
                {runBusy ? 'Starting…' : 'Run Now'}
              </button>
              <Link to={`/workflows/${createdWorkflow.id}`} className="btn-secondary">
                Open editor
              </Link>
              <Link to="/dashboard" className="btn-ghost">
                Finish
              </Link>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
