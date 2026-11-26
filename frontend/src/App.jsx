import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useNavigate } from "react-router-dom";

import AiAssistantDrawer from "./components/AiAssistantDrawer.jsx";
import AiWorkspacePage from "./components/AiWorkspacePage.jsx";
import { CaseTimelinePage, DigitalFootprintPage, LogAnalysisPage } from "./components/AnalysisWorkspace.jsx";
import { AssistantProvider, useAssistant } from "./components/AssistantContext.jsx";
import { AuthProvider, ProtectedRoute, useAuth } from "./components/AuthContext.jsx";
import { CaseDetailsPage, CasesPage, EditCasePage, NewCasePage } from "./components/CaseManagement.jsx";
import { AnalyticsPanels, MetricCards, SectionHeading } from "./components/DashboardSections.jsx";
import { EvidenceWorkspace } from "./components/EvidenceWorkspace.jsx";
import Icon from "./components/Icon.jsx";
import { ActivityTimelinePanel, CasesPanel, EvidenceIntegrityPanel } from "./components/InvestigationPanels.jsx";
import LoginPage from "./components/LoginPage.jsx";
import { AuditLogsPage, InvestigatorsPage, ReportsPage, SettingsPage } from "./components/TeamAndGovernance.jsx";
import WorkspaceLayout from "./components/WorkspaceLayout.jsx";
import { loadDashboardData } from "./services/dashboardApi.js";

function DashboardError({ message, onRetry }) {
  return (
    <div className="dashboard-error" role="alert">
      <Icon name="findings" size={18} />
      <div>
        <strong>Dashboard data is unavailable</strong>
        <p>{message}</p>
      </div>
      <button className="secondary-button" onClick={onRetry}>
        <Icon name="refresh" size={14} /> Retry
      </button>
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistant();
  const { profile } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    loadDashboardData({ signal: controller.signal })
      .then(setDashboard)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setDashboard(null);
        setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey, profile?.organizationId]);

  useEffect(() => {
    const onWorkspaceUpdate = () => setReloadKey((k) => k + 1);
    window.addEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
    return () => window.removeEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
  }, []);

  const data = dashboard?.data;
  const cases = data?.cases ?? [];
  const currentCaseId =
    selectedCaseId ||
    (cases.some((item) => item.id === data?.currentCaseId) ? data.currentCaseId : "") ||
    cases[0]?.id ||
    "";

  return (
    <WorkspaceLayout
      mode={dashboard?.mode ?? (loading ? "loading" : "unavailable")}
      currentUser={data?.currentUser}
      cases={cases}
      selectedCaseId={currentCaseId}
      onSelectCase={(caseNum) => {
        setSelectedCaseId(caseNum);
      }}
      query={query}
      onQueryChange={setQuery}
      notifications={data?.notifications ?? []}
      pageTitle="Dashboard"
    >
      <div className="page-heading" id="overview">
        <div>
          <span className="eyebrow">{profile?.organizationName || "DIGITAL FORENSICS WORKSPACE"}</span>
          <h1>Investigation overview</h1>
          <p>Trace active cases, verify SHA-256 evidence integrity, and triage events with AI assistance.</p>
        </div>
        <div className="page-heading-actions">
          {currentCaseId && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate(`/cases/${encodeURIComponent(currentCaseId)}`)}
            >
              <Icon name="cases" size={15} /> Open {currentCaseId}
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              openAssistant({
                caseId: currentCaseId,
                prompt: "Provide an executive triage overview of active critical cases, pending SHA-256 verifications, and findings requiring review.",
              })
            }
          >
            <Icon name="assistant" size={15} /> Ask AI Assistant
          </button>
        </div>
      </div>

      {error && <DashboardError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}

      {error && !dashboard ? null : (
        <>
          <section className="dashboard-section metrics-section" aria-label="Investigation metrics">
            <SectionHeading title="Workspace metrics" subtitle="Live counts across cases, evidence items, and analytical findings." />
            <MetricCards metrics={data?.metrics} loading={loading} />
          </section>

          <div className="overview-grid">
            <CasesPanel cases={cases} query={query} loading={loading} />
            <EvidenceIntegrityPanel integrity={data?.evidenceIntegrity} loading={loading} />
          </div>

          <AnalyticsPanels analytics={data?.analytics} cases={cases} loading={loading} />
          <ActivityTimelinePanel events={data?.activityEvents ?? []} query={query} loading={loading} />

          <footer className="dashboard-footer">
            <span><Icon name="shield" size={14} /> CyberTrace · {profile?.organizationName || "Digital forensics workspace"}</span>
            <span>{profile?.rbacRole || "Analyst"}</span>
          </footer>
        </>
      )}
    </WorkspaceLayout>
  );
}

function NotFoundPage() {
  return (
    <WorkspaceLayout mode="live" pageTitle="Not found" showSearch={false}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CYBERTRACE WORKSPACE</span>
          <h1>Page not found</h1>
          <p>The requested destination does not exist in this workspace.</p>
        </div>
      </div>
      <section className="panel module-placeholder">
        <span className="empty-state-mark"><Icon name="shield" size={18} /></span>
        <h2>Route not found</h2>
        <p>Return to the Dashboard or Cases workspace to continue your investigation.</p>
        <Link className="secondary-button" to="/">Back to Dashboard</Link>
      </section>
    </WorkspaceLayout>
  );
}

function AuthenticatedDrawer() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <AiAssistantDrawer />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AssistantProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/cases" element={<ProtectedRoute><CasesPage /></ProtectedRoute>} />
            <Route path="/cases/new" element={<ProtectedRoute><NewCasePage /></ProtectedRoute>} />
            <Route path="/cases/:caseNumber/edit" element={<ProtectedRoute><EditCasePage /></ProtectedRoute>} />
            <Route path="/cases/:caseNumber" element={<ProtectedRoute><CaseDetailsPage /></ProtectedRoute>} />
            <Route path="/case-timeline" element={<ProtectedRoute><CaseTimelinePage /></ProtectedRoute>} />
            <Route path="/evidence" element={<ProtectedRoute><EvidenceWorkspace defaultTab="repository" /></ProtectedRoute>} />
            <Route path="/evidence/integrity" element={<ProtectedRoute><EvidenceWorkspace defaultTab="integrity" /></ProtectedRoute>} />
            <Route path="/evidence/chain-of-custody" element={<ProtectedRoute><EvidenceWorkspace defaultTab="custody" /></ProtectedRoute>} />
            <Route path="/analysis/digital-footprint" element={<ProtectedRoute><DigitalFootprintPage /></ProtectedRoute>} />
            <Route path="/analysis/log-analysis" element={<ProtectedRoute><LogAnalysisPage /></ProtectedRoute>} />
            <Route path="/analysis/event-correlation" element={<ProtectedRoute><CaseTimelinePage correlationView /></ProtectedRoute>} />
            <Route path="/analysis/findings" element={<ProtectedRoute><CaseTimelinePage findingsOnly /></ProtectedRoute>} />
            <Route path="/assistant" element={<ProtectedRoute><AiWorkspacePage /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
            <Route path="/investigators" element={<ProtectedRoute><InvestigatorsPage /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute><AuditLogsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="*" element={<ProtectedRoute><NotFoundPage /></ProtectedRoute>} />
          </Routes>
          <AuthenticatedDrawer />
        </AssistantProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
