import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useNavigate } from "react-router-dom";

import AiAssistantDrawer from "./components/AiAssistantDrawer.jsx";
import AiWorkspacePage from "./components/AiWorkspacePage.jsx";
import { CaseTimelinePage, DigitalFootprintPage, LogAnalysisPage } from "./components/AnalysisWorkspace.jsx";
import { AssistantProvider, useAssistant } from "./components/AssistantContext.jsx";
import { CaseDetailsPage, CasesPage, EditCasePage, NewCasePage } from "./components/CaseManagement.jsx";
import { AnalyticsPanels, MetricCards, SectionHeading } from "./components/DashboardSections.jsx";
import { EvidenceWorkspace } from "./components/EvidenceWorkspace.jsx";
import Icon from "./components/Icon.jsx";
import { ActivityTimelinePanel, CasesPanel, EvidenceIntegrityPanel } from "./components/InvestigationPanels.jsx";
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

function DataModeNotice({ updatedAt }) {
  const updatedLabel = updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
    ? new Date(updatedAt).toLocaleString()
    : null;
  return (
    <div className="data-notice live-notice">
      <Icon name="integrity" size={16} />
      <strong>Connected workspace data</strong>
      <span>Live metrics, SHA-256 verification checks, and events from CyberTrace API.</span>
      {updatedLabel && <time className="tabular-nums" dateTime={updatedAt}>Updated {updatedLabel}</time>}
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const { openAssistant, activeAnalyst } = useAssistant();
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

    loadDashboardData({ signal: controller.signal, actor: activeAnalyst })
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
  }, [reloadKey, activeAnalyst]);

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
          <span className="eyebrow">DIGITAL FORENSICS WORKSPACE</span>
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

      {!loading && dashboard && <DataModeNotice updatedAt={data.updatedAt} />}

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
            <span><Icon name="shield" size={14} /> CyberTrace · Digital forensics workspace</span>
            <span>Connected workspace</span>
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

export default function App() {
  return (
    <AssistantProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/new" element={<NewCasePage />} />
          <Route path="/cases/:caseNumber/edit" element={<EditCasePage />} />
          <Route path="/cases/:caseNumber" element={<CaseDetailsPage />} />
          <Route path="/case-timeline" element={<CaseTimelinePage />} />
          <Route path="/evidence" element={<EvidenceWorkspace defaultTab="repository" />} />
          <Route path="/evidence/integrity" element={<EvidenceWorkspace defaultTab="integrity" />} />
          <Route path="/evidence/chain-of-custody" element={<EvidenceWorkspace defaultTab="custody" />} />
          <Route path="/analysis/digital-footprint" element={<DigitalFootprintPage />} />
          <Route path="/analysis/log-analysis" element={<LogAnalysisPage />} />
          <Route path="/analysis/event-correlation" element={<CaseTimelinePage correlationView />} />
          <Route path="/analysis/findings" element={<CaseTimelinePage findingsOnly />} />
          <Route path="/assistant" element={<AiWorkspacePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/investigators" element={<InvestigatorsPage />} />
          <Route path="/audit-logs" element={<AuditLogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <AiAssistantDrawer />
      </BrowserRouter>
    </AssistantProvider>
  );
}
