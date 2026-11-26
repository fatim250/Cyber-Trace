import { useCallback, useEffect, useState } from "react";

import { useAssistant } from "./AssistantContext.jsx";
import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { getCases } from "../services/casesApi.js";
import {
  addTeamMember,
  getAssistantStatus,
  getAuditLogs,
  getCaseReport,
  getTeam,
  getWorkspacePrefs,
  saveWorkspacePrefs,
} from "../services/workspaceApi.js";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function InvestigatorsPage() {
  const { activeAnalyst, switchAnalyst } = useAssistant();
  const [team, setTeam] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", team: "Digital Forensics", specialization: "", status: "Active", email: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, caseRes] = await Promise.all([getTeam(), getCases({ limit: 50 })]);
      setTeam(teamRes.items || []);
      setCases(caseRes.items || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load team roster.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const added = await addTeamMember(form);
      setNotice(`Added ${added.name} (${added.team}) to the CyberTrace roster.`);
      setShowAdd(false);
      setForm({ name: "", role: "", team: "Digital Forensics", specialization: "", status: "Active", email: "" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add team member.");
    }
  };

  return (
    <WorkspaceLayout mode={loading ? "loading" : "live"} cases={cases} pageTitle="Cyber Teams" showSearch={false}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TEAM COLLABORATION</span>
          <h1>Cyber Teams & Investigators</h1>
          <p>Manage DFIR, SOC, Incident Response, and Threat Intel engineers and switch active session attribution.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> Add team member
        </button>
      </div>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && <div className="dashboard-error" role="alert"><Icon name="findings" size={16} /><div><strong>Team error</strong><p>{error}</p></div></div>}

      <div className="team-grid">
        {team.map((member) => {
          const isCurrent = member.name === activeAnalyst;
          return (
            <article className="panel team-card" key={member.id}>
              <div className="team-card-head">
                <div>
                  <h3>{member.name}</h3>
                  <p>{member.role} · {member.team}</p>
                </div>
                <span className={`status-badge ${member.status === "On Call" ? "status-under-review" : "status-resolved"}`}>
                  {member.status}
                </span>
              </div>
              <dl className="team-card-meta">
                <div><dt>Specialization</dt><dd>{member.specialization}</dd></div>
                <div><dt>Active cases</dt><dd className="tabular-nums">{member.activeCaseCount}</dd></div>
                <div><dt>Contact</dt><dd className="mono-cell">{member.email}</dd></div>
              </dl>
              <div className="team-card-actions">
                <button
                  type="button"
                  className={isCurrent ? "primary-button" : "secondary-button"}
                  disabled={isCurrent}
                  onClick={() => {
                    switchAnalyst(member.name);
                    setNotice(`Active session switched to ${member.name}.`);
                  }}
                >
                  {isCurrent ? "Active session" : "Use as active analyst"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {showAdd && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Add team member">
            <div className="case-modal-heading">
              <div>
                <h2>Add cyber team member</h2>
                <p>Add an analyst or responder to assign cases and audit actions.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowAdd(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <form className="case-form case-modal-form" onSubmit={handleAdd}>
              <div className="case-form-row">
                <label>
                  <span>Full name <b aria-hidden="true">*</b></span>
                  <input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                </label>
                <label>
                  <span>Role <b aria-hidden="true">*</b></span>
                  <input required value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} placeholder="e.g. Incident Responder" />
                </label>
              </div>
              <div className="case-form-row">
                <label>
                  <span>Team / Unit</span>
                  <select value={form.team} onChange={(e) => setForm((p) => ({ ...p, team: e.target.value }))}>
                    <option>Digital Forensics</option>
                    <option>Threat Detection</option>
                    <option>Incident Response</option>
                    <option>Threat Intel</option>
                    <option>Cloud Security</option>
                  </select>
                </label>
                <label>
                  <span>Availability</span>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option>Active</option>
                    <option>On Call</option>
                    <option>Offline</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Specialization</span>
                <input value={form.specialization} onChange={(e) => setForm((p) => ({ ...p, specialization: e.target.value }))} placeholder="e.g. Kubernetes & Cloud Logs" />
              </label>
              <div className="case-form-actions">
                <button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="primary-button">Add member</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [cases, setCases] = useState([]);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [logRes, caseRes] = await Promise.all([
        getAuditLogs({ query, action: actionFilter }),
        getCases({ limit: 50 }),
      ]);
      setLogs(logRes.items || []);
      setCases(caseRes.items || []);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, query]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : "live"}
      cases={cases}
      query={query}
      onQueryChange={setQuery}
      pageTitle="Audit Logs"
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOVERNANCE & ACCOUNTABILITY</span>
          <h1>Audit Logs</h1>
          <p>Immutable chronological record of case updates, evidence SHA-256 verifications, and custody transfers.</p>
        </div>
      </div>

      <section className="panel">
        <div className="case-list-toolbar">
          <div>
            <h2>Recorded actions</h2>
            <p className="tabular-nums">{logs.length} audit event{logs.length === 1 ? "" : "s"}</p>
          </div>
          <div className="case-list-controls">
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="compact-select"
            >
              <option value="">All actions</option>
              <option value="CASE_CREATED">Case Created</option>
              <option value="CASE_UPDATED">Case Updated</option>
              <option value="CASE_STATUS_CHANGED">Status Changed</option>
              <option value="CASE_DELETED">Case Deleted</option>
              <option value="EVIDENCE_ADDED">Evidence Added</option>
              <option value="EVIDENCE_VERIFIED">Evidence Verified</option>
              <option value="CUSTODY_TRANSFERRED">Custody Transferred</option>
              <option value="EVENT_LOGGED">Event Logged</option>
            </select>
            <button type="button" className="secondary-button" onClick={load}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="case-loading">Loading audit logs…</div>
        ) : (
          <>
            <div className="table-scroll desktop-table-wrap">
              <table className="cases-table">
                <thead>
                  <tr>
                    <th>TIMESTAMP</th>
                    <th>CASE</th>
                    <th>ACTION</th>
                    <th>ACTOR</th>
                    <th>DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono-cell">{formatDateTime(entry.createdAt)}</td>
                      <td className="case-id mono-cell">{entry.caseNumber || `#${entry.caseId}`}</td>
                      <td><strong>{entry.action}</strong></td>
                      <td>{entry.actor}</td>
                      <td className="mono-cell">{JSON.stringify(entry.changesJson)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list">
              {logs.map((entry) => (
                <article className="mobile-data-card" key={entry.id}>
                  <div className="mobile-card-top">
                    <span className="case-id mono-cell">{entry.caseNumber || `#${entry.caseId}`}</span>
                    <span className="mobile-card-meta">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <strong>{entry.action}</strong>
                  <p className="mobile-card-meta">Actor: {entry.actor}</p>
                  <p className="mobile-card-hash mono-cell">{JSON.stringify(entry.changesJson)}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </WorkspaceLayout>
  );
}

export function ReportsPage() {
  const { openAssistant } = useAssistant();
  const [cases, setCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCases({ limit: 50 })
      .then((res) => {
        setCases(res.items || []);
        if (res.items?.[0]) setSelectedCase(res.items[0].caseNumber);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCase) return;
    setLoading(true);
    getCaseReport(selectedCase)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [selectedCase]);

  const buildMarkdown = () => {
    if (!report) return "";
    const c = report.case;
    const lines = [
      `# CyberTrace Forensic Investigation Report`,
      ``,
      `- **Case Number:** ${c.caseNumber}`,
      `- **Title:** ${c.title}`,
      `- **Status:** ${c.status}`,
      `- **Severity:** ${c.severity}`,
      `- **Assigned Investigator:** ${c.assignedTo || "Unassigned"}`,
      `- **Generated At:** ${report.generatedAt}`,
      ``,
      `## Executive Summary`,
      c.description || "No description provided.",
      ``,
      `## Evidence & SHA-256 Verification (${report.evidence.length})`,
      ...report.evidence.map(
        (ev) =>
          `- **${ev.id}** (${ev.name}) | Host: ${ev.sourceHost} | SHA-256: \`${ev.expectedSha256}\` | Verified: ${ev.comparisonPerformed ? (ev.sha256Matches ? "PASS" : "MISMATCH") : "PENDING"}`,
      ),
      ``,
      `## Timeline Events & Findings (${report.events.length})`,
      ...report.events.map(
        (ev) => `- [${ev.occurredAt}] **${ev.recordType}** (${ev.eventType}): ${ev.description} (Source: ${ev.sourceEvidence})`,
      ),
    ];
    return lines.join("\n");
  };

  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : "live"}
      cases={cases}
      selectedCaseId={selectedCase}
      onSelectCase={setSelectedCase}
      pageTitle="Reports"
      showSearch={false}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">DOCUMENTATION & HANDOFF</span>
          <h1>Investigation Reports</h1>
          <p>Export structured forensic reports, SHA-256 evidence ledgers, or generate an AI handoff brief.</p>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!selectedCase}
            onClick={() =>
              openAssistant({
                caseId: selectedCase,
                prompt: "Draft a complete executive and technical forensic handoff report for this case, noting verified SHA-256 evidence and open actions.",
              })
            }
          >
            <Icon name="assistant" size={15} /> AI Brief
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!report}
            onClick={() => downloadFile(JSON.stringify(report, null, 2), `${selectedCase}-report.json`, "application/json")}
          >
            <Icon name="download" size={14} /> Export JSON
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!report}
            onClick={() => downloadFile(buildMarkdown(), `${selectedCase}-report.md`, "text/markdown")}
          >
            <Icon name="download" size={14} /> Export Markdown
          </button>
        </div>
      </div>

      {report && (
        <div className="case-detail-grid">
          <section className="panel case-detail-panel">
            <h2>{report.case.caseNumber} — {report.case.title}</h2>
            <p>{report.case.description || "No description provided."}</p>
            <dl className="case-detail-list">
              <div><dt>Status</dt><dd>{report.case.status}</dd></div>
              <div><dt>Severity</dt><dd>{report.case.severity}</dd></div>
              <div><dt>Lead Engineer</dt><dd>{report.case.assignedTo || "Unassigned"}</dd></div>
              <div><dt>Evidence items</dt><dd className="tabular-nums">{report.evidence.length}</dd></div>
              <div><dt>Timeline events</dt><dd className="tabular-nums">{report.events.length}</dd></div>
              <div><dt>Audit entries</dt><dd className="tabular-nums">{report.auditHistory.length}</dd></div>
            </dl>
          </section>

          <section className="panel case-detail-panel">
            <h2>Markdown preview</h2>
            <pre className="report-preview mono-input">{buildMarkdown()}</pre>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function SettingsPage() {
  const { activeAnalyst, switchAnalyst, openAssistant } = useAssistant();
  const [team, setTeam] = useState([]);
  const [cases, setCases] = useState([]);
  const [aiStatus, setAiStatus] = useState(null);
  const [prefs, setPrefs] = useState(() => getWorkspacePrefs());
  const [savedNotice, setSavedNotice] = useState("");

  useEffect(() => {
    Promise.all([getTeam(), getCases({ limit: 50 }), getAssistantStatus().catch(() => ({ configured: false }))])
      .then(([teamRes, caseRes, statusRes]) => {
        setTeam(teamRes.items || []);
        setCases(caseRes.items || []);
        setAiStatus(statusRes);
      });
  }, []);

  const handleSave = (e) => {
    e.preventDefault();
    saveWorkspacePrefs(prefs);
    setSavedNotice("Workspace preferences saved.");
    window.setTimeout(() => setSavedNotice(""), 2500);
  };

  return (
    <WorkspaceLayout mode="live" cases={cases} pageTitle="Settings" showSearch={false}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE CONFIGURATION</span>
          <h1>Settings</h1>
          <p>Select your active investigator identity for audit attribution and configure workspace defaults.</p>
        </div>
      </div>

      {savedNotice && <div className="case-success-notice" role="status">{savedNotice}</div>}

      <div className="settings-stack">
        <form className="panel case-form" onSubmit={handleSave}>
          <label>
            <span>Active analyst identity</span>
            <select
              value={activeAnalyst}
              onChange={(e) => {
                switchAnalyst(e.target.value);
                setSavedNotice(`Active analyst updated to ${e.target.value}.`);
              }}
            >
              {team.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name} — {member.role} ({member.team})
                </option>
              ))}
            </select>
            <small>All case updates, evidence verifications, and custody logs are recorded under this analyst.</small>
          </label>

          <label>
            <span>Default new-case severity</span>
            <select
              value={prefs.defaultSeverity}
              onChange={(e) => setPrefs((p) => ({ ...p, defaultSeverity: e.target.value }))}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>

          <div className="case-form-actions">
            <button type="submit" className="primary-button">Save preferences</button>
          </div>
        </form>

        <section className="panel settings-ai-card">
          <div className="case-list-toolbar">
            <div>
              <h2>AI Investigation Assistant</h2>
              <p>Server-side assistant integration grounded in CyberTrace cases, evidence, and logs.</p>
            </div>
            {aiStatus && (
              <span className={`ai-conn-pill ${aiStatus.configured ? "is-ready" : "is-offline"}`}>
                {aiStatus.configured ? "Connected" : "Not configured"}
              </span>
            )}
          </div>
          <p className="settings-ai-note">
            {aiStatus?.configured
              ? `Connected and ready (${aiStatus.model || "Gemini"}). Open the assistant from any case, log workbench, or header button.`
              : "AI service is awaiting server secret configuration."}
          </p>
          <div>
            <button type="button" className="secondary-button" onClick={() => openAssistant({})}>
              <Icon name="assistant" size={15} /> Open AI Assistant
            </button>
          </div>
        </section>
      </div>
    </WorkspaceLayout>
  );
}
