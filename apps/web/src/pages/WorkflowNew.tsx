import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileCode2 } from 'lucide-react';
import { api, type TemplateInfo } from '../lib/api';
import { toast } from '../lib/toast';

const DEFAULT_MANIFEST = `api_version: flowforge/v1
name: my-first-workflow
summary: My first FlowForge workflow
triggers:
  - type: schedule
    cron: "0 9 * * 1-5"
    timezone: UTC
steps:
  - id: fetch_data
    type: http
    with:
      method: GET
      url: "{{ env.FF_APP_URL }}/api/v1/demo/clients"
  - id: log_result
    type: log
    with:
      level: info
      message: "Fetched {{ len(steps.fetch_data.output.body.clients) }} clients"
`;

type TriggerType = 'schedule' | 'webhook' | 'manual';

/** Rewrite the top-level `triggers:` block of a manifest to reflect a chosen
 *  trigger type. Leaves the rest of the YAML (steps, name, summary) intact.
 *  If no `triggers:` key is present, the manifest is returned unchanged. */
function rewriteTriggers(yaml: string, type: TriggerType): string {
  const block =
    type === 'manual'
      ? 'triggers: []\n'
      : type === 'webhook'
        ? 'triggers:\n  - type: webhook\n'
        : 'triggers:\n  - type: schedule\n    cron: "0 9 * * 1-5"\n    timezone: UTC\n';
  const idx = yaml.search(/^triggers:/m);
  if (idx === -1) return yaml;
  const lines = yaml.slice(idx).split('\n');
  let endLine = lines.length;
  for (let i = 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      endLine = i;
      break;
    }
  }
  return yaml.slice(0, idx) + block + lines.slice(endLine).join('\n');
}

export default function WorkflowNew() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState(false);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('schedule');
  const [yaml, setYaml] = useState(DEFAULT_MANIFEST);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    api
      .get<{ data: TemplateInfo[] }>('/templates')
      .then((r) => {
        if (!active) return;
        setTemplates(r.data);
        setTemplatesError(false);
      })
      .catch(() => {
        if (!active) return;
        setTemplates([]);
        setTemplatesError(true);
      })
      .finally(() => { if (active) setTemplatesLoading(false); });
    return () => { active = false; };
  }, []);

  const pickTemplate = (templateId: string) => {
    setSelected(templateId);
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      setYaml(tpl.manifest);
      setName(tpl.name);
      setSummary(tpl.summary);
      // Reflect the template's declared trigger in the selector.
      setTriggerType(/type:\s*webhook/.test(tpl.manifest) ? 'webhook' : 'schedule');
    } else {
      setYaml(DEFAULT_MANIFEST);
      setName('');
      setSummary('');
      setTriggerType('schedule');
    }
  };

  const changeTrigger = (type: TriggerType) => {
    setTriggerType(type);
    setYaml((prev) => rewriteTriggers(prev, type));
  };

  const save = async () => {
    setError('');
    if (!name.trim()) {
      setError('A workflow name is required');
      return;
    }
    // The manifest's `name:` must match the workflow name the API will
    // register — keep the envelope honest before sending.
    let manifestYaml = yaml;
    if (selected) {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (slug) manifestYaml = manifestYaml.replace(/^name:.*$/m, `name: ${slug}`);
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: { id: string; name: string } }>('/workflows', {
        name: name.trim(),
        summary: summary.trim() || undefined,
        manifest: manifestYaml,
      });
      toast(`Workflow '${res.data.name}' created`);
      navigate(`/workflows/${res.data.id}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max-wide)' }}>
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <div>
          <h1
            className="page-title"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
          >
            New Workflow
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
            Author a YAML manifest from scratch or start from a template.
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
          <Link to="/workflows" className="btn-ghost">
            Cancel
          </Link>
          <button
            id="save-workflow"
            data-testid="save-workflow"
            onClick={() => void save()}
            disabled={busy}
            className="btn-primary"
            aria-label="Create workflow"
          >
            {busy ? 'Creating…' : 'Create workflow'}
          </button>
        </div>
      </div>

      {error && (
        <p
          id="workflow-new-error"
          className="form-error"
          data-testid="workflow-new-error"
          style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--status-failed)' }}
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 'var(--space-6)' }}>
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
          <div className="surface-card" style={{ padding: 'var(--space-5)' }}>
            <label htmlFor="wf-name" className="field-label">
              Name
            </label>
            <input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Invoice Chaser"
              className="input-field"
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'workflow-new-error' : undefined}
            />
            <label htmlFor="wf-summary" className="field-label" style={{ marginTop: 'var(--space-4)' }}>
              Summary
            </label>
            <input
              id="wf-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What does this workflow do?"
              className="input-field"
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'workflow-new-error' : undefined}
            />
            <label htmlFor="wf-trigger" className="field-label" style={{ marginTop: 'var(--space-4)' }}>
              Trigger type
            </label>
            <select
              id="wf-trigger"
              value={triggerType}
              onChange={(e) => changeTrigger(e.target.value as TriggerType)}
              className="input-field"
            >
              <option value="schedule">Schedule (cron)</option>
              <option value="webhook">Webhook</option>
              <option value="manual">Manual</option>
            </select>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-2)' }}>
              Updates the{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>triggers:</code> block in the manifest.
            </p>
          </div>

          <div className="surface-card" style={{ padding: 'var(--space-5)' }}>
            <label htmlFor="template-picker" className="field-label">
              Start from a template
            </label>
            <select
              id="template-picker"
              data-testid="template-picker"
              value={selected}
              onChange={(e) => pickTemplate(e.target.value)}
              className="input-field"
              disabled={templatesLoading}
            >
              {templatesLoading ? (
                <option value="">Loading templates…</option>
              ) : (
                <option value="">Blank workflow</option>
              )}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {templatesError ? (
              <p
                data-testid="template-picker-error"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--status-failed)', marginTop: 'var(--space-2)' }}
              >
                Templates couldn't be loaded — the API is unreachable. You can still author a manifest by hand.
              </p>
            ) : (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-2)' }}>
                Templates are fully valid manifests — they run as-is against the demo services.
              </p>
            )}
          </div>

          <OutlinePreview yaml={yaml} />
        </div>

        <div
          className="surface-panel"
          data-testid={selected ? `template-${selected}` : 'manifest-editor-pane'}
        >
          <div
            className="flex items-center border-b"
            style={{
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              borderColor: 'var(--border-default)',
            }}
          >
            <FileCode2 style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)', color: 'var(--accent)' }} />
            <span id="manifest-editor-label" style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)' }}>Manifest (YAML)</span>
          </div>
          <textarea
            id="manifest-editor"
            data-testid="manifest-editor"
            aria-labelledby="manifest-editor-label"
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            spellCheck={false}
            className="manifest-editor font-mono"
            style={{
              width: '100%',
              height: 'var(--yaml-editor-new-h)',
              backgroundColor: 'var(--bg-base)',
              color: 'var(--fg-primary)',
              border: 'none',
              borderBottomLeftRadius: 'var(--radius-md)',
              borderBottomRightRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              lineHeight: 'var(--line-relaxed)',
              fontFamily: 'var(--font-mono)',
              resize: 'none',
              display: 'block',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Deterministic, dependency-free outline of the manifest being authored (§D6
 *  one-way diagram; the full graph view lives on the workflow detail page). */
function OutlinePreview({ yaml }: { yaml: string }) {
  const steps = [...yaml.matchAll(/^\s*- id:\s*(\S+)/gm)].map((m) => m[1]);
  const types = [...yaml.matchAll(/^\s*type:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  return (
    <div className="surface-card" style={{ padding: 'var(--space-5)' }}>
      <h2
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--fg-primary)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Steps
      </h2>
      {steps.length === 0 ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>No steps parsed yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {steps.map((id, i) => (
            <li
              key={`${id}-${i}`}
              className="flex items-center"
              style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}
            >
              <span
                className="tabular-nums"
                style={{ width: 'var(--icon-lg)', textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}
              >
                {i + 1}.
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }}>{id}</span>
            </li>
          ))}
        </ol>
      )}
      <h2
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--fg-primary)',
          marginBottom: 'var(--space-2)',
          marginTop: 'var(--space-4)',
        }}
      >
        Step types
      </h2>
      <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
        {types.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>No types parsed yet.</p>
        ) : (
          types.map((t, i) => (
            <span key={`${t}-${i}`} className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
              {t}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
