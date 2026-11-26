import { useCallback, useEffect, useState } from "react";

import { useAssistant } from "./AssistantContext.jsx";
import { useAuth } from "./AuthContext.jsx";
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
  updateOrganizationName,
  updateTeamMember,
} from "../services/workspaceApi.js";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function InvestigatorsPage() {
  const { profile, availableRoles, hasPermission, refreshProfile } = useAuth();
  const canManageTeam = hasPermission("manage_team");
  const [team, setTeam] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [form, setForm] = useState({
    name: "",
    role: "",
    rbacRole: "Analyst",
    team: "Digital Forensics",
    specialization: "",
    status: "Active",
    email: "",
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
      setNotice(`Invited ${added.name} (${added.rbacRole}) to ${profile?.organizationName || "your organization"}.`);
      setShowAdd(false);
      setForm({
        name: "",
        role: "",
        rbacRole: "Analyst",
        team: "Digital Forensics",
        specialization: "",
        status: "Active",
        email: "",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add team member.");
    }
  };

  const handleRoleChange = async (member, nextRole) => {
    setUpdatingId(member.id);
    setError("");
    try {
      await updateTeamMember(member.id, { rbacRole: nextRole });
      setNotice(`Updated ${member.name}'s RBAC role to ${nextRole}.`);
      await Promise.all([load(), refreshProfile()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update RBAC role.");
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <WorkspaceLayout mode={loading ? "loading" : "live"} cases={cases} pageTitle="Cyber Teams" showSearch={false}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TEAM GOVERNANCE & RBAC</span>
          <h1>Cyber Teams & Investigators</h1>
          <p>
            Manage {profile?.organizationName || "your organization"}'s DFIR, SOC, and Threat Intel members. Teammates invited by email automatically inherit their assigned RBAC role upon signing in with Google.
          </p>
        </div>
        {canManageTeam && (
          <button type="button" className="primary-button" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} /> Invite member
          </button>
        )}
      </div>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && (
        <div className="dashboard-error" role="alert">
          <Icon name="findings" size={16} />
          <div><strong>Team governance error</strong><p>{error}</p></div>
        </div>
      )}

      <div className="team-grid">
        {team.map((member) => {
          const isCurrentUser =
            profile?.email && member.email?.toLowerCase() === profile.email.toLowerCase();
          return (
            <article className="panel team-card" key={member.id}>
              <div className="team-card-head">
                <div>
                  <h3>
                    {member.name}
                    {isCurrentUser && <span className="team-you-tag"> · You</span>}
                  </h3>
                  <p>{member.role} · {member.team}</p>
                </div>
                <span className={`status-badge ${member.status === "On Call" ? "status-under-review" : "status-resolved"}`}>
                  {member.status}
                </span>
              </div>
              <dl className="team-card-meta">
                <div><dt>RBAC Role</dt><dd><strong>{member.rbacRole || "Analyst"}</strong></dd></div>
                <div><dt>Account status</dt><dd>{member.linkedAccount ? "Google verified" : "Pending sign-in"}</dd></div>
                <div><dt>Specialization</dt><dd>{member.specialization}</dd></div>
                <div><dt>Active cases</dt><dd className="tabular-nums">{member.activeCaseCount}</dd></div>
                <div><dt>Email</dt><dd className="mono-cell">{member.email}</dd></div>
              </dl>
              {canManageTeam && (
                <div className="team-card-actions team-rbac-row">
                  <label className="team-role-picker">
                    <span>Access level</span>
                    <select
                      aria-label={`RBAC role for ${member.name}`}
                      value={member.rbacRole || "Analyst"}
                      disabled={updatingId === member.id}
                      onChange={(e) => handleRoleChange(member, e.target.value)}
                    >
                      {availableRoles.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {showAdd && canManageTeam && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Invite team member">
            <div className="case-modal-heading">
              <div>
                <h2>Invite cyber team member</h2>
                <p>Pre-assign an RBAC role to a colleague's Google account email so they join your organization automatically.</p>
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
                  <span>Google email <b aria-hidden="true">*</b></span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="analyst@company.com"
                  />
                </label>
              </div>
              <div className="case-form-row">
                <label>
                  <span>Job title <b aria-hidden="true">*</b></span>
                  <input
                    required
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                    placeholder="e.g. Incident Responder"
                  />
                </label>
                <label>
                  <span>RBAC role</span>
                  <select value={form.rbacRole} onChange={(e) => setForm((p) => ({ ...p, rbacRole: e.target.value }))}>
                    {availableRoles.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
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
                <input
                  value={form.specialization}
                  onChange={(e) => setForm((p) => ({ ...p, specialization: e.target.value }))}
                  placeholder="e.g. Kubernetes & Cloud Logs"
                />
              </label>
              <div className="case-form-actions">
                <button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="primary-button">Invite member</button>
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
          <p>Immutable chronological record of verified user mutations across cases, evidence hashes, custody transfers, and RBAC updates.</p>
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
              <option value="EVENT_UPDATED">Event Updated</option>
              <option value="MEMBER_INVITED">Member Invited</option>
              <option value="MEMBER_ROLE_UPDATED">Role Updated</option>
              <option value="ORGANIZATION_UPDATED">Organization Updated</option>
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
                    <th>VERIFIED ACTOR</th>
                    <th>DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono-cell">{formatDateTime(entry.createdAt)}</td>
                      <td className="case-id mono-cell">{entry.caseNumber || "Org"}</td>
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
                    <span className="case-id mono-cell">{entry.caseNumber || "Org"}</span>
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
  const { profile } = useAuth();
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
      `- **Organization:** ${profile?.organizationName || "CyberTrace"}`,
      `- **Case Number:** ${c.caseNumber}`,
      `- **Title:** ${c.title}`,
      `- **Status:** ${c.status}`,
      `- **Severity:** ${c.severity}`,
      `- **Assigned Investigator:** ${c.assignedTo || "Unassigned"}`,
      `- **Generated By:** ${profile?.displayName || "Investigator"} (${profile?.rbacRole || "Analyst"})`,
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
      <div className="page-heading no-print">
        <div>
          <span className="eyebrow">DOCUMENTATION & HANDOFF</span>
          <h1>Investigation Reports</h1>
          <p>Export structured forensic reports, SHA-256 evidence ledgers, or print an executive PDF dossier.</p>
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
            onClick={() => window.print()}
          >
            <Icon name="reports" size={14} /> Print / Save PDF
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
        <>
          <div className="case-detail-grid no-print">
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

          <article className="printable-report-dossier" aria-label="Printable forensic dossier">
            <header className="print-dossier-header">
              <div>
                <p className="print-org-line">{profile?.organizationName || "CyberTrace"} · Forensic Investigation Dossier</p>
                <h1>{report.case.caseNumber}: {report.case.title}</h1>
              </div>
              <div className="print-dossier-meta">
                <span>Generated {formatDateTime(report.generatedAt)}</span>
                <span>Prepared by {profile?.displayName || "Investigator"} ({profile?.rbacRole || "Analyst"})</span>
              </div>
            </header>

            <section className="print-section">
              <h2>1. Executive Overview</h2>
              <p>{report.case.description || "No description provided."}</p>
              <dl className="print-meta-grid">
                <div><dt>Case Number</dt><dd>{report.case.caseNumber}</dd></div>
                <div><dt>Status</dt><dd>{report.case.status}</dd></div>
                <div><dt>Severity</dt><dd>{report.case.severity}</dd></div>
                <div><dt>Assigned Lead</dt><dd>{report.case.assignedTo || "Unassigned"}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(report.case.createdAt)}</dd></div>
                <div><dt>Last Updated</dt><dd>{formatDateTime(report.case.updatedAt)}</dd></div>
              </dl>
            </section>

            <section className="print-section">
              <h2>2. Evidence & SHA-256 Verification Ledger ({report.evidence.length})</h2>
              {report.evidence.length === 0 ? (
                <p>No evidence items registered for this case.</p>
              ) : (
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Artifact</th>
                      <th>Host</th>
                      <th>Expected SHA-256</th>
                      <th>Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.evidence.map((ev) => (
                      <tr key={ev.id}>
                        <td>{ev.id}</td>
                        <td>{ev.name}</td>
                        <td>{ev.sourceHost}</td>
                        <td className="mono-cell">{ev.expectedSha256}</td>
                        <td>{!ev.comparisonPerformed ? "PENDING" : ev.sha256Matches ? "PASS" : "MISMATCH"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="print-section">
              <h2>3. Chronological Timeline & Findings ({report.events.length})</h2>
              {report.events.length === 0 ? (
                <p>No timeline events logged for this case.</p>
              ) : (
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Type</th>
                      <th>Classification</th>
                      <th>Description</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.events.map((ev) => (
                      <tr key={ev.id}>
                        <td>{formatDateTime(ev.occurredAt)}</td>
                        <td>{ev.eventType}</td>
                        <td>{ev.recordType}</td>
                        <td>{ev.description}</td>
                        <td>{ev.sourceEvidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </article>
        </>
      )}
    </WorkspaceLayout>
  );
}

export function SettingsPage() {
  const { openAssistant } = useAssistant();
  const { profile, hasPermission, refreshProfile, signOut } = useAuth();
  const canManageTeam = hasPermission("manage_team");
  const [cases, setCases] = useState([]);
  const [aiStatus, setAiStatus] = useState(null);
  const [orgName, setOrgName] = useState(profile?.organizationName || "");
  const [prefs, setPrefs] = useState(() => getWorkspacePrefs());
  const [savedNotice, setSavedNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setOrgName(profile?.organizationName || "");
  }, [profile?.organizationName]);

  useEffect(() => {
    Promise.all([getCases({ limit: 50 }), getAssistantStatus().catch(() => ({ configured: false }))])
      .then(([caseRes, statusRes]) => {
        setCases(caseRes.items || []);
        setAiStatus(statusRes);
      });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    saveWorkspacePrefs(prefs);
    try {
      if (canManageTeam && orgName.trim() && orgName.trim() !== profile?.organizationName) {
        await updateOrganizationName(orgName.trim());
        await refreshProfile();
      }
      setSavedNotice("Workspace settings saved.");
      window.setTimeout(() => setSavedNotice(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save organization settings.");
    }
  };

  return (
    <WorkspaceLayout mode="live" cases={cases} pageTitle="Settings" showSearch={false}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE CONFIGURATION</span>
          <h1>Settings</h1>
          <p>Review your verified Google account, RBAC role, organization profile, and investigation defaults.</p>
        </div>
        <button type="button" className="secondary-button" onClick={signOut}>
          Sign out
        </button>
      </div>

      {savedNotice && <div className="case-success-notice" role="status">{savedNotice}</div>}
      {error && (
        <div className="dashboard-error" role="alert">
          <Icon name="findings" size={16} />
          <div><strong>Settings error</strong><p>{error}</p></div>
        </div>
      )}

      <div className="settings-stack">
        <section className="panel settings-ai-card">
          <div className="case-list-toolbar">
            <div>
              <h2>Authenticated investigator profile</h2>
              <p>Identity is verified via Google Sign-In and enforced server-side for every audit log entry.</p>
            </div>
          </div>
          <dl className="case-detail-list">
            <div><dt>Investigator</dt><dd>{profile?.displayName}</dd></div>
            <div><dt>Email</dt><dd className="mono-cell">{profile?.email}</dd></div>
            <div><dt>Organization</dt><dd>{profile?.organizationName}</dd></div>
            <div><dt>RBAC Role</dt><dd><strong>{profile?.rbacRole}</strong></dd></div>
          </dl>
        </section>

        <form className="panel case-form" onSubmit={handleSave}>
          {canManageTeam && (
            <label>
              <span>Organization display name</span>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                maxLength={120}
                required
              />
              <small>Shown in workspace headers, STIX/MISP threat bundles, and printed forensic reports.</small>
            </label>
          )}

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
            <button type="submit" className="primary-button">Save settings</button>
          </div>
        </form>

        <section className="panel settings-ai-card">
          <div className="case-list-toolbar">
            <div>
              <h2>AI Investigation Assistant</h2>
              <p>Server-side assistant integration grounded strictly in your organization's cases, evidence, and logs.</p>
            </div>
            {aiStatus && (
              <span className={`ai-conn-meta ${aiStatus.configured ? "is-ready" : "is-offline"}`}>
                {aiStatus.configured ? "AI Ready" : "Setup Needed"}
              </span>
            )}
          </div>
          <p className="settings-ai-note">
            {aiStatus?.configured
              ? `Ready (${aiStatus.model || "Gemini"}). Open the assistant from any case, log workbench, or header button.`
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
