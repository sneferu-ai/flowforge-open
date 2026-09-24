import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Layers } from 'lucide-react';
import { api, type TemplateInfo } from '../lib/api';
import { toast } from '../lib/toast';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

export default function Templates() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .get<{ data: TemplateInfo[] }>('/templates')
      .then((r) => {
        setTemplates(r.data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  const useTemplate = async (template: TemplateInfo) => {
    setBusy(template.id);
    try {
      const res = await api.post<{ data: { id: string; name: string } }>('/workflows/from-template', {
        template_id: template.id,
      });
      toast(`Workflow '${res.data.name}' created`);
      navigate(`/workflows/${res.data.id}`, { state: { justCreated: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already exists')) {
        // Idempotent re-run: open the existing instance (webhook path derives
        // from the template name/slug).
        try {
          const list = await api.get<{ data: Array<{ id: string; name: string; slug: string | null }> }>(
            '/workflows?include_disabled=true'
          );
          const existing = list.data.find(
            (w) => w.name === template.name || w.slug === template.id || (w.slug ?? '').startsWith(template.id)
          );
          if (existing) {
            toast(`Workflow '${existing.name}' already exists — opening it`);
            navigate(`/workflows/${existing.id}`, { state: { justCreated: true } });
            return;
          }
        } catch {
          /* fall through */
        }
        toast('A workflow with that name already exists in this workspace');
      } else {
        toast(`Could not create workflow: ${message}`);
      }
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max-wide)' }}>
        <h1
          className="page-title"
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 'var(--weight-semibold)',
            color: 'var(--fg-primary)',
            marginBottom: 'var(--space-6)',
          }}
        >
          Templates
        </h1>
        <div className="surface-card" style={{ padding: 'var(--space-6) var(--space-8)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--status-failed)', marginBottom: 'var(--space-4)' }}>
            Could not load templates: {error}
          </p>
          <button className="btn-secondary" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="enter-fade-up" style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max-wide)' }}>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1
          className="page-title"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}
        >
          Templates
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-1)' }}>
          Pre-filled, validated workflow manifests for the five freelancer operations. Pick one and run it.
        </p>
      </div>

      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        style={{ gap: 'var(--space-4)' }}
        role={loading ? 'status' : undefined}
        aria-label={loading ? 'Loading templates' : undefined}
      >
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: 'var(--skeleton-section-md)', borderRadius: 'var(--radius-md)' }}
              />
            ))
          : templates.length === 0 && (
              <div
                data-testid="templates-empty-state"
                className="surface-card flex flex-col items-center justify-center text-center"
                style={{ padding: 'var(--space-16) var(--space-8)', gridColumn: '1 / -1' }}
              >
                <Layers style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-4)' }} />
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginBottom: 'var(--space-2)' }}>
                  No templates available right now.
                </p>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', maxWidth: 'var(--empty-max)', marginBottom: 'var(--space-6)' }}>
                  Use the workflow editor to author a YAML manifest from scratch.
                </p>
                <Link to="/workflows/new" className="btn-primary">Create a workflow</Link>
              </div>
            )}
        {!loading &&
          templates.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: enterOffset() }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * dur('stagger'), duration: dur('base') }}
                className="tpl-card surface-card flex flex-col"
                style={{ padding: 'var(--space-6)' }}
              >
                <div
                  className="flex items-center"
                  style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
                >
                  <Layers style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)', color: 'var(--accent)', flexShrink: 0 }} />
                  <h2
                    style={{
                      fontSize: 'var(--text-lg)',
                      fontWeight: 'var(--weight-semibold)',
                      color: 'var(--fg-primary)',
                    }}
                  >
                    {t.name}
                  </h2>
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', flex: 1 }}>
                  {t.summary}
                </p>
                <button
                  data-testid={`template-use-${t.id}`}
                  disabled={busy === t.id}
                  onClick={() => void useTemplate(t)}
                  className="btn-primary"
                  style={{ marginTop: 'var(--space-4)', alignSelf: 'flex-start' }}
                  aria-label={`Use ${t.name} template`}
                >
                  {busy === t.id ? 'Creating…' : 'Use template'}
                </button>
              </motion.div>
            ))}
      </div>
    </div>
  );
}
