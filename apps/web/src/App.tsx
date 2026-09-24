import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Invite from './pages/Invite';
import Onboarding from './pages/Onboarding';
import SelectWorkspace from './pages/SelectWorkspace';
import Dashboard from './pages/Dashboard';
import Workflows from './pages/Workflows';
import WorkflowNew from './pages/WorkflowNew';
import WorkflowEditor from './pages/WorkflowEditor';
import WorkflowVersions from './pages/WorkflowVersions';
import Templates from './pages/Templates';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import Credentials from './pages/Credentials';
import Audit from './pages/Audit';
import Settings from './pages/Settings';
import SettingsApprovals from './pages/SettingsApprovals';
import SettingsPlan from './pages/SettingsPlan';
import SettingsWebhooks from './pages/SettingsWebhooks';
import SettingsSso from './pages/SettingsSso';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite" element={<Invite />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/select-workspace" element={<SelectWorkspace />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowNew />} />
        <Route path="/workflows/:id/versions" element={<WorkflowVersions />} />
        <Route path="/workflows/:id/edit" element={<WorkflowEditor />} />
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
        <Route path="/workflows/:workflowId/runs/:runId" element={<RunDetail />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="/credentials" element={<Credentials />} />
        <Route path="/audit" element={<Audit />} />
        {/* Spec §10.2 settings surfaces; members/allowlist live on the single
            Settings page and are aliased so every spec route resolves. */}
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/members" element={<Settings />} />
        <Route path="/settings/allowlist" element={<Settings />} />
        <Route path="/settings/credentials" element={<Credentials />} />
        <Route path="/settings/audit" element={<Audit />} />
        <Route path="/settings/approvals" element={<SettingsApprovals />} />
        <Route path="/settings/webhooks" element={<SettingsWebhooks />} />
        <Route path="/settings/plan" element={<SettingsPlan />} />
        <Route path="/settings/sso" element={<SettingsSso />} />
        {/* Unknown paths inside the app get an honest 404, never a blank main. */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** Authenticated catch-all — names the failure (no such page) and the way
 *  forward (back to a real surface). */
function NotFound() {
  const location = useLocation();
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 'var(--content-max)' }}>
      <div
        className="surface-card flex flex-col items-center text-center"
        style={{ padding: 'var(--space-16) var(--space-8)', marginTop: 'var(--space-12)' }}
      >
        <Compass
          style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)', color: 'var(--fg-disabled)', marginBottom: 'var(--space-4)' }}
          aria-hidden="true"
        />
        <h1
          className="page-title"
          style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)', marginBottom: 'var(--space-2)' }}
        >
          No page at this address
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>
          {location.pathname}
        </p>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', maxWidth: 'var(--empty-max)', marginBottom: 'var(--space-6)' }}>
          The route does not exist. Head back to a real surface from the sidebar, or use one of the links below.
        </p>
        <div className="flex" style={{ gap: 'var(--space-2)' }}>
          <Link to="/dashboard" className="btn-primary">Dashboard</Link>
          <Link to="/workflows" className="btn-secondary">Workflows</Link>
        </div>
      </div>
    </div>
  );
}
