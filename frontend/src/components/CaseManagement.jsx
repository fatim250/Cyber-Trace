import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAssistant } from "./AssistantContext.jsx";
import { useAuth } from "./AuthContext.jsx";
import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { createCase, deleteCase, getCase, getCases, getCaseMetrics, updateCase } from "../services/casesApi.js";
import { getTeam, getWorkspacePrefs } from "../services/workspaceApi.js";

const CASE_STATUSES = ["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"];
const CASE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function makeEmptyForm() {
  const prefs = getWorkspacePrefs();
  return {
    title: "",
    description: "",
    assignedTo: "",
    reporterName: "",
    status: "OPEN",
    severity: prefs.defaultSeverity || "MEDIUM",
  };
}

function formatLabel(value = "") {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function StatusBadge({ status }) {
  const modifier = status.toLowerCase().replaceAll("_", "-");
  return <span className={`status-badge status-${modifier}`}>{formatLabel(status)}</span>;
}

function SeverityBadge({ severity }) {
  const modifier = severity.toLowerCase();
  return <span className={`severity-badge severity-${modifier}`}>{formatLabel(severity)}</span>;
}

function PageError({ message, onRetry }) {
  return (
    <div className="dashboard-error" role="alert">
      <Icon name="findings" size={18} />
      <div><strong>Case data is unavailable</strong><p>{message}</p></div>
      {onRetry && <button className="secondary-button" type="button" onClick={onRetry}>
        <Icon name="refresh" size={14} /> Retry
      </button>}
    </div>
  );
}

function getInitialCaseValues(caseRecord) {
  if (!caseRecord) return makeEmptyForm();
  return {
    title: caseRecord.title,
    description: caseRecord.description ?? "",
    assignedTo: caseRecord.assignedTo ?? "",
    reporterName: caseRecord.reporterName ?? "",
    status: caseRecord.status,
    severity: caseRecord.severity,
  };
}

function CaseFormModal({ caseRecord, teamMembers = [], onClose, onSaved }) {
  const editing = Boolean(caseRecord);
  const [values, setValues] = useState(() => getInitialCaseValues(caseRecord));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const handleChange = (event) => {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await updateCase(caseRecord.caseNumber, values)
        : await createCase(values);
      onSaved(editing ? `${saved.caseNumber} was updated.` : `${saved.caseNumber} was created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The case could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="case-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section className="panel case-modal" role="dialog" aria-modal="true" aria-labelledby="case-modal-title">
        <div className="case-modal-heading">
          <div>
            <h2 id="case-modal-title">{editing ? "Edit case" : "Create investigation case"}</h2>
            <p>{editing ? caseRecord.caseNumber : "Save a new investigation case to the workspace."}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close dialog" disabled={saving} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {error && <PageError message={error} />}
        <form className="case-form case-modal-form" onSubmit={handleSubmit}>
          <label>
            <span>Case title <b aria-hidden="true">*</b></span>
            <input name="title" value={values.title} onChange={handleChange} required minLength={1} maxLength={200} autoComplete="off" autoFocus />
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" value={values.description} onChange={handleChange} maxLength={10000} rows={4} />
          </label>
          <div className="case-form-row">
            <label>
              <span>Assigned to</span>
              <input
                name="assignedTo"
                list="team-member-suggestions"
                value={values.assignedTo}
                onChange={handleChange}
                maxLength={160}
                autoComplete="off"
                placeholder="Select or enter engineer"
              />
              <datalist id="team-member-suggestions">
                {teamMembers.map((m) => <option key={m.id} value={m.name}>{m.role}</option>)}
              </datalist>
            </label>
            <label>
              <span>Reporter name</span>
              <input name="reporterName" value={values.reporterName} onChange={handleChange} maxLength={160} autoComplete="off" placeholder="Optional" />
            </label>
          </div>
          <div className="case-form-row">
            <label>
              <span>Severity</span>
              <select name="severity" value={values.severity} onChange={handleChange}>
                {CASE_SEVERITIES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select name="status" value={values.status} onChange={handleChange}>
                {CASE_STATUSES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
          </div>
          <div className="case-form-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create case"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CaseListPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistant();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("write_investigations");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [skip, setSkip] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [metricsError, setMetricsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalCase, setModalCase] = useState(undefined);
  const [notice, setNotice] = useState("");
  const pageSize = 50;

  useEffect(() => {
    getTeam().then((res) => setTeamMembers(res.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      setLoading(true);
      setError("");
      getCases({ query, status, severity, skip, limit: pageSize, signal: controller.signal })
        .then(setResult)
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setResult(null);
          setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      getCaseMetrics({ signal: controller.signal })
        .then((summary) => {
          setMetrics(summary);
          setMetricsError("");
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setMetrics(null);
          setMetricsError(cause instanceof Error ? cause.message : "Metrics are unavailable.");
        });
    };

    const timer = window.setTimeout(load, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, severity, skip, reloadKey]);

  const handleSearch = (value) => {
    setQuery(value);
    setSkip(0);
  };
  const handleStatus = (value) => {
    setStatus(value);
    setSkip(0);
  };
  const handleSeverity = (value) => {
    setSeverity(value);
    setSkip(0);
  };
  const currentPage = Math.floor(skip / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : error ? "unavailable" : "live"}
      cases={result?.items ?? []}
      pageTitle="Cases"
      query={query}
      onQueryChange={handleSearch}
      onSelectCase={(caseNumber) => caseNumber && navigate(`/cases/${encodeURIComponent(caseNumber)}`)}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">CASE MANAGEMENT</span>
          <h1>Investigation cases</h1>
          <p>Create, triage, and collaborate on cyber investigation cases across your team.</p>
        </div>
        <div className="page-heading-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => openAssistant({ prompt: "Triage all active investigation cases and highlight critical priorities." })}
          >
            <Icon name="assistant" size={15} /> AI Triage
          </button>
          {canWrite && (
            <button className="primary-button" type="button" onClick={() => setModalCase(null)}>
              <Icon name="plus" size={15} /> New case
            </button>
          )}
        </div>
      </div>

      <section className="case-kpi-grid" aria-label="Case metrics" aria-busy={loading}>
        {[
          { key: "totalCases", label: "Total cases", tone: "cyan", icon: "cases" },
          { key: "openCases", label: "Open cases", tone: "blue", icon: "timeline" },
          { key: "criticalCases", label: "Critical cases", tone: "amber", icon: "findings" },
          { key: "resolvedCases", label: "Resolved cases", tone: "green", icon: "integrity" },
        ].map((item) => (
          <article className="case-kpi-card" key={item.key}>
            <span className={`metric-icon metric-${item.tone}`}><Icon name={item.icon} size={16} /></span>
            <span className="case-kpi-label">{item.label}</span>
            {metricsError ? <strong className="case-kpi-unavailable" title={metricsError}>Unavailable</strong>
              : metrics ? <strong className="tabular-nums">{metrics[item.key].toLocaleString()}</strong>
                : <span className="skeleton case-kpi-skeleton" aria-label="Loading case metric" />}
          </article>
        ))}
      </section>
      {metricsError && <p className="case-metrics-error" role="status">Case metrics are unavailable: {metricsError}</p>}
      {notice && <div className="case-success-notice" role="status">{notice}</div>}

      <section className="panel case-list-panel" aria-label="Investigation cases">
        <div className="case-list-toolbar">
          <div>
            <h2>Cases</h2>
            <p>{loading ? "Loading case records…" : error ? "Case records could not be loaded." : `${result.total} case${result.total === 1 ? "" : "s"} returned`}</p>
          </div>
          <div className="case-list-controls">
            <label className="filter-control">
              <span className="sr-only">Filter cases by status</span>
              <select value={status} onChange={(event) => handleStatus(event.target.value)} aria-label="Filter cases by status">
                <option value="">All statuses</option>
                {CASE_STATUSES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
            <label className="filter-control">
              <span className="sr-only">Filter cases by severity</span>
              <select value={severity} onChange={(event) => handleSeverity(event.target.value)} aria-label="Filter cases by severity">
                <option value="">All severities</option>
                {CASE_SEVERITIES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          </div>
        </div>

        {error ? <PageError message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : loading ? (
          <div className="case-loading" aria-live="polite">Loading cases…</div>
        ) : result?.items.length === 0 ? (
          <div className="case-empty">
            <span className="empty-state-mark"><Icon name="cases" size={18} /></span>
            <strong>{result.total === 0 && !query && !status && !severity ? "No investigation cases yet" : "No cases match these filters"}</strong>
            <p>{result.total === 0 && !query && !status && !severity
              ? "Create your first investigation to get started."
              : "Try another search term or status filter."}</p>
            {canWrite && result.total === 0 && !query && !status && !severity && (
              <button className="secondary-button" type="button" onClick={() => setModalCase(null)}>
                Create your first investigation
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="table-scroll desktop-table-wrap case-list-table-wrap">
              <table className="cases-table case-management-table">
                <thead>
                  <tr>
                    <th scope="col">CASE ID</th>
                    <th scope="col">TITLE</th>
                    <th scope="col">ASSIGNED TO</th>
                    <th scope="col">SEVERITY</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">CREATED</th>
                    <th scope="col">LAST UPDATED</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td><Link className="case-id case-title-link mono-cell" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.caseNumber}</Link></td>
                      <td><Link className="case-title case-title-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.title}</Link></td>
                      <td>{item.assignedTo || "Unassigned"}</td>
                      <td><SeverityBadge severity={item.severity} /></td>
                      <td><StatusBadge status={item.status} /></td>
                      <td className="mono-cell">{formatDate(item.createdAt)}</td>
                      <td className="mono-cell">{formatDate(item.updatedAt)}</td>
                      <td className="case-row-actions">
                        <Link className="table-action-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>Details</Link>
                        {canWrite && <button className="table-action-link" type="button" onClick={() => setModalCase(item)}>Edit</button>}
                        <button
                          className="table-action-link"
                          type="button"
                          onClick={() => openAssistant({ caseId: item.caseNumber })}
                        >
                          Ask AI
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-card-list">
              {result.items.map((item) => (
                <article className="mobile-data-card" key={item.id}>
                  <div className="mobile-card-top">
                    <Link className="case-id case-title-link mono-cell" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.caseNumber}</Link>
                    <div className="mobile-badge-pair">
                      <SeverityBadge severity={item.severity} />
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  <Link className="case-title case-title-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.title}</Link>
                  <p className="mobile-card-meta">
                    {item.assignedTo || "Unassigned"} · Updated {formatDate(item.updatedAt)}
                  </p>
                  <div className="mobile-card-actions">
                    <Link className="secondary-button" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>Details</Link>
                    {canWrite && <button className="secondary-button" type="button" onClick={() => setModalCase(item)}>Edit</button>}
                    <button className="secondary-button" type="button" onClick={() => openAssistant({ caseId: item.caseNumber })}>Ask AI</button>
                  </div>
                </article>
              ))}
            </div>

            <div className="case-pagination">
              <span>Showing {skip + 1}–{Math.min(skip + result.items.length, result.total)} of {result.total}</span>
              <div>
                <button className="secondary-button" type="button" onClick={() => setSkip(Math.max(0, skip - pageSize))} disabled={loading || skip === 0}>Previous</button>
                <span>Page {currentPage} of {pageCount}</span>
                <button className="secondary-button" type="button" onClick={() => setSkip(skip + pageSize)} disabled={loading || skip + pageSize >= result.total}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
      {modalCase !== undefined && (
        <CaseFormModal
          caseRecord={modalCase}
          teamMembers={teamMembers}
          onClose={() => setModalCase(undefined)}
          onSaved={(message) => {
            setModalCase(undefined);
            setNotice(message);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </WorkspaceLayout>
  );
}

function CaseFormPage({ editing = false }) {
  const navigate = useNavigate();
  const { caseNumber = "" } = useParams();
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState(makeEmptyForm);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getTeam().then((res) => setTeamMembers(res.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return undefined;
    const controller = new AbortController();
    setLoading(true);
    getCase(caseNumber, { signal: controller.signal })
      .then((item) => {
        setRecord(item);
        setValues({
          title: item.title,
          description: item.description ?? "",
          assignedTo: item.assignedTo ?? "",
          reporterName: item.reporterName ?? "",
          status: item.status,
          severity: item.severity,
        });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [caseNumber, editing]);

  const handleChange = (event) => {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = editing
        ? await updateCase(caseNumber, values)
        : await createCase(values);
      navigate(`/cases/${encodeURIComponent(saved.caseNumber)}`, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : error ? "unavailable" : "live"}
      cases={record ? [record] : []}
      selectedCaseId={record?.caseNumber ?? ""}
      onSelectCase={(selected) => selected && navigate(`/cases/${encodeURIComponent(selected)}`)}
      pageTitle={editing ? "Edit case" : "New case"}
      showSearch={false}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">CASE MANAGEMENT</span>
          <h1>{editing ? "Edit case" : "Create a case"}</h1>
          <p>{editing ? `Update the information for ${caseNumber}.` : "Create a case record in the workspace."}</p>
        </div>
        {record && <span className="page-context"><Icon name="cases" size={15} />{record.caseNumber}</span>}
      </div>

      {error && <PageError message={error} />}
      {loading ? <div className="case-loading">Loading case information…</div> : editing && !record ? null : (
        <form className="panel case-form" onSubmit={handleSubmit}>
          <label>
            <span>Case title <b aria-hidden="true">*</b></span>
            <input name="title" value={values.title} onChange={handleChange} required minLength={1} maxLength={200} autoComplete="off" />
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" value={values.description} onChange={handleChange} maxLength={10000} rows={5} />
          </label>
          <div className="case-form-row">
            <label>
              <span>Assigned to</span>
              <input
                name="assignedTo"
                list="team-member-page-suggestions"
                value={values.assignedTo}
                onChange={handleChange}
                maxLength={160}
                autoComplete="off"
                placeholder="Select or enter engineer"
              />
              <datalist id="team-member-page-suggestions">
                {teamMembers.map((m) => <option key={m.id} value={m.name}>{m.role}</option>)}
              </datalist>
            </label>
            <label>
              <span>Reporter name</span>
              <input name="reporterName" value={values.reporterName} onChange={handleChange} maxLength={160} autoComplete="off" placeholder="Optional" />
            </label>
          </div>
          <div className="case-form-row">
            <label>
              <span>Severity</span>
              <select name="severity" value={values.severity} onChange={handleChange}>
                {CASE_SEVERITIES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select name="status" value={values.status} onChange={handleChange}>
                {CASE_STATUSES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
              </select>
            </label>
          </div>
          <div className="case-form-actions">
            <Link className="secondary-button" to={editing && record ? `/cases/${encodeURIComponent(record.caseNumber)}` : "/cases"}>Cancel</Link>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create case"}
            </button>
          </div>
        </form>
      )}
    </WorkspaceLayout>
  );
}

function CaseDetailPage() {
  const navigate = useNavigate();
  const { openAssistant } = useAssistant();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("write_investigations");
  const canDelete = hasPermission("delete_cases");
  const { caseNumber = "" } = useParams();
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getCase(caseNumber, { signal: controller.signal })
      .then((item) => {
        setRecord(item);
        setStatus(item.status);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [caseNumber, reloadKey]);

  useEffect(() => {
    const onWorkspaceUpdate = () => setReloadKey((k) => k + 1);
    window.addEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
    return () => window.removeEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
  }, []);

  const saveStatus = async (event) => {
    event.preventDefault();
    setSavingStatus(true);
    setError("");
    try {
      const updated = await updateCase(caseNumber, { status });
      setRecord(updated);
      setStatus(updated.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
    } finally {
      setSavingStatus(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCase(record.caseNumber);
      navigate("/cases", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive case.");
      setDeleting(false);
    }
  };

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : error ? "unavailable" : "live"}
      cases={record ? [record] : []}
      selectedCaseId={record?.caseNumber ?? ""}
      onSelectCase={(selected) => selected && navigate(`/cases/${encodeURIComponent(selected)}`)}
      pageTitle="Case details"
      showSearch={false}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">CASE MANAGEMENT</span>
          <h1>{loading ? "Case details" : record?.title ?? "Case not found"}</h1>
          <p>{record ? `Case ${record.caseNumber} · Created ${formatDate(record.createdAt, true)}` : "Review and update a saved case record."}</p>
        </div>
        {record && (
          <div className="page-heading-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                openAssistant({
                  caseId: record.caseNumber,
                  prompt: `Analyze ${record.caseNumber} ("${record.title}"), summarize confirmed facts and evidence status, and recommend next forensic steps.`,
                })
              }
            >
              <Icon name="assistant" size={15} /> Ask AI about case
            </button>
            {canWrite && (
              <Link className="primary-button" to={`/cases/${encodeURIComponent(record.caseNumber)}/edit`}>Edit case</Link>
            )}
          </div>
        )}
      </div>

      {error && <PageError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {loading ? <div className="case-loading">Loading case details…</div> : record && (
        <div className="case-detail-grid">
          <section className="panel case-detail-panel">
            <h2>Case information</h2>
            <dl className="case-detail-list">
              <div><dt>Case ID</dt><dd className="mono-cell">{record.caseNumber}</dd></div>
              <div><dt>Title</dt><dd>{record.title}</dd></div>
              <div><dt>Assigned to</dt><dd>{record.assignedTo || "Unassigned"}</dd></div>
              <div><dt>Reporter</dt><dd>{record.reporterName || "Not specified"}</dd></div>
              <div><dt>Severity</dt><dd><SeverityBadge severity={record.severity} /></dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={record.status} /></dd></div>
              <div><dt>Created</dt><dd className="mono-cell">{formatDate(record.createdAt, true)}</dd></div>
              <div><dt>Last updated</dt><dd className="mono-cell">{formatDate(record.updatedAt, true)}</dd></div>
              <div className="case-description"><dt>Description</dt><dd>{record.description || "No description provided."}</dd></div>
            </dl>
          </section>

          <section className="panel case-detail-panel">
            <h2>Update case status</h2>
            <p>{canWrite ? "Changes are recorded in the case audit log." : "Read-only auditor access: status modifications are disabled."}</p>
            <form className="status-update-form" onSubmit={saveStatus}>
              <label>
                <span>Status</span>
                <select value={status} disabled={!canWrite} onChange={(event) => setStatus(event.target.value)}>
                  {CASE_STATUSES.map((item) => <option key={item} value={item}>{formatLabel(item)}</option>)}
                </select>
              </label>
              {canWrite && (
                <button className="primary-button" type="submit" disabled={savingStatus || status === record.status}>
                  {savingStatus ? "Saving…" : "Update status"}
                </button>
              )}
            </form>
            <div className="case-detail-footer-actions">
              <Link className="case-back-link" to="/cases">Back to all cases</Link>
              {canDelete && (
                !confirmDelete ? (
                  <button
                    type="button"
                    className="danger-text-button"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Icon name="trash" size={14} /> Archive case
                  </button>
                ) : (
                  <div className="confirm-delete-row">
                    <span>Archive this case?</span>
                    <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Cancel
                    </button>
                    <button type="button" className="danger-button" onClick={handleDelete} disabled={deleting}>
                      {deleting ? "Archiving…" : "Confirm"}
                    </button>
                  </div>
                )
              )}
            </div>
          </section>

          {record.evidence?.length > 0 && (
            <section className="panel case-detail-panel case-audit-panel">
              <div className="case-list-toolbar">
                <div>
                  <h2>Linked evidence ({record.evidence.length})</h2>
                  <p>Forensic artifacts and SHA-256 verification status for this case.</p>
                </div>
                <Link className="secondary-button" to="/evidence">Open Evidence Repository</Link>
              </div>
              <div className="table-scroll desktop-table-wrap">
                <table className="cases-table">
                  <thead>
                    <tr>
                      <th>EVIDENCE ID</th>
                      <th>ARTIFACT</th>
                      <th>HOST</th>
                      <th>SHA-256</th>
                      <th>VERIFICATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.evidence.map((ev) => (
                      <tr key={ev.id}>
                        <td className="mono-cell">{ev.id}</td>
                        <td><strong>{ev.name}</strong></td>
                        <td>{ev.sourceHost}</td>
                        <td className="mono-cell">{ev.expectedSha256.slice(0, 16)}…</td>
                        <td>
                          {!ev.comparisonPerformed ? "Pending" : ev.sha256Matches ? "Verified match" : "Mismatch"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {record.evidence.map((ev) => (
                  <article className="mobile-data-card" key={ev.id}>
                    <div className="mobile-card-top">
                      <span className="case-id mono-cell">{ev.id}</span>
                      <span className={`status-badge ${!ev.comparisonPerformed ? "status-under-review" : ev.sha256Matches ? "status-resolved" : "status-escalated"}`}>
                        {!ev.comparisonPerformed ? "Pending" : ev.sha256Matches ? "Verified" : "Mismatch"}
                      </span>
                    </div>
                    <strong>{ev.name}</strong>
                    <p className="mobile-card-meta">{ev.sourceHost} · {ev.artifactType}</p>
                    <p className="mobile-card-hash mono-cell">SHA-256: {ev.expectedSha256.slice(0, 20)}…</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="panel case-detail-panel case-audit-panel">
            <h2>Case activity</h2>
            <p>Changes recorded in the case audit history.</p>
            {record.auditHistory?.length ? (
              <ol className="case-audit-timeline">
                {record.auditHistory.map((entry) => (
                  <li key={entry.id}>
                    <span className="case-audit-marker" />
                    <div>
                      <strong>{formatLabel(entry.action.replace("CASE_", ""))}</strong>
                      <p>Actor: {entry.actor}</p>
                      <time dateTime={entry.createdAt}>{formatDate(entry.createdAt, true)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="case-audit-empty">No case activity has been recorded.</p>}
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function CasesPage() {
  return <CaseListPage />;
}

export function NewCasePage() {
  return <CaseFormPage />;
}

export function EditCasePage() {
  return <CaseFormPage editing />;
}

export function CaseDetailsPage() {
  return <CaseDetailPage />;
}
