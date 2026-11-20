import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { createCase, getCase, getCases, updateCase } from "../services/casesApi.js";

const CASE_STATUSES = ["Open", "In Progress", "Under Review", "Closed"];
const EMPTY_FORM = {
  title: "",
  description: "",
  assignedInvestigator: "",
  status: "Open",
};

function formatDate(value, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function StatusBadge({ status }) {
  const modifier = status.toLowerCase().replaceAll(" ", "-");
  return <span className={`status-badge status-${modifier}`}><i />{status}</span>;
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

function CaseListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [skip, setSkip] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageSize = 50;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getCases({ query, status, skip, limit: pageSize, signal: controller.signal })
        .then(setResult)
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setResult(null);
          setError(cause instanceof Error ? cause.message : "An unexpected error occurred.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 250 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, status, skip, reloadKey]);

  const handleSearch = (value) => {
    setQuery(value);
    setSkip(0);
  };
  const handleStatus = (value) => {
    setStatus(value);
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
          <span className="eyebrow"><span className="eyebrow-dot" /> CASE MANAGEMENT</span>
          <h1>Investigation cases</h1>
          <p>Create and manage case records stored in the configured CyberTrace database.</p>
        </div>
        <Link className="primary-button" to="/cases/new"><Icon name="plus" size={15} /> New case</Link>
      </div>

      <section className="panel case-list-panel" aria-label="Investigation cases">
        <div className="case-list-toolbar">
          <div>
            <h2>Cases</h2>
            <p>{loading ? "Loading case records…" : error ? "Case records could not be loaded." : `${result.total} case${result.total === 1 ? "" : "s"} returned by the API`}</p>
          </div>
          <div className="case-list-controls">
            <label className="filter-control">
              <span className="sr-only">Filter cases by status</span>
              <select value={status} onChange={(event) => handleStatus(event.target.value)} aria-label="Filter cases by status">
                <option value="">All statuses</option>
                {CASE_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          </div>
        </div>

        {error ? <PageError message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : loading ? (
          <div className="case-loading" aria-live="polite">Loading cases from the database…</div>
        ) : result?.items.length === 0 ? (
          <div className="case-empty">
            <span className="empty-state-mark"><Icon name="cases" size={18} /></span>
            <strong>{result.total === 0 && !query && !status ? "No investigation cases yet" : "No cases match these filters"}</strong>
            <p>{result.total === 0 && !query && !status
              ? "Create your first investigation to get started."
              : "Try another search term or status filter."}</p>
            {result.total === 0 && !query && !status && <Link className="secondary-button" to="/cases/new">Create your first investigation</Link>}
          </div>
        ) : (
          <>
            <div className="table-scroll case-list-table-wrap">
              <table className="cases-table case-management-table">
                <thead>
                  <tr>
                    <th scope="col">CASE ID</th>
                    <th scope="col">TITLE</th>
                    <th scope="col">ASSIGNED INVESTIGATOR</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">CREATED</th>
                    <th scope="col">LAST UPDATED</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td><Link className="case-id case-title-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.caseNumber}</Link></td>
                      <td><Link className="case-title case-title-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>{item.title}</Link></td>
                      <td>{item.assignedInvestigator || "Unassigned"}</td>
                      <td><StatusBadge status={item.status} /></td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>{formatDate(item.updatedAt)}</td>
                      <td><Link className="table-action-link" to={`/cases/${encodeURIComponent(item.caseNumber)}`}>Details</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </WorkspaceLayout>
  );
}

function CaseFormPage({ editing = false }) {
  const navigate = useNavigate();
  const { caseNumber = "" } = useParams();
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
          assignedInvestigator: item.assignedInvestigator ?? "",
          status: item.status,
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
          <span className="eyebrow"><span className="eyebrow-dot" /> CASE MANAGEMENT</span>
          <h1>{editing ? "Edit case" : "Create a case"}</h1>
          <p>{editing ? `Update the information for ${caseNumber}.` : "Create a case record in the configured database."}</p>
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
            <textarea name="description" value={values.description} onChange={handleChange} maxLength={5000} rows={5} />
          </label>
          <div className="case-form-row">
            <label>
              <span>Assigned investigator</span>
              <input name="assignedInvestigator" value={values.assignedInvestigator} onChange={handleChange} maxLength={160} autoComplete="off" placeholder="Optional" />
              <small>Enter the investigator’s name. User-account linking is not configured in this project.</small>
            </label>
            <label>
              <span>Status</span>
              <select name="status" value={values.status} onChange={handleChange}>
                {CASE_STATUSES.map((item) => <option key={item}>{item}</option>)}
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
  const { caseNumber = "" } = useParams();
  const [record, setRecord] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
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
          <span className="eyebrow"><span className="eyebrow-dot" /> CASE MANAGEMENT</span>
          <h1>{loading ? "Case details" : record?.title ?? "Case not found"}</h1>
          <p>{record ? `Case ${record.caseNumber} · Created ${formatDate(record.createdAt, true)}` : "Review and update a saved case record."}</p>
        </div>
        {record && <Link className="primary-button" to={`/cases/${encodeURIComponent(record.caseNumber)}/edit`}>Edit case</Link>}
      </div>

      {error && <PageError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {loading ? <div className="case-loading">Loading case details…</div> : record && (
        <div className="case-detail-grid">
          <section className="panel case-detail-panel">
            <h2>Case information</h2>
            <dl className="case-detail-list">
              <div><dt>Case ID</dt><dd>{record.caseNumber}</dd></div>
              <div><dt>Title</dt><dd>{record.title}</dd></div>
              <div><dt>Assigned investigator</dt><dd>{record.assignedInvestigator || "Unassigned"}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={record.status} /></dd></div>
              <div><dt>Created</dt><dd>{formatDate(record.createdAt, true)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(record.updatedAt, true)}</dd></div>
              <div className="case-description"><dt>Description</dt><dd>{record.description || "No description provided."}</dd></div>
            </dl>
          </section>
          <section className="panel case-detail-panel">
            <h2>Update case status</h2>
            <p>Changes are saved to the case database.</p>
            <form className="status-update-form" onSubmit={saveStatus}>
              <label>
                <span>Status</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  {CASE_STATUSES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={savingStatus || status === record.status}>
                {savingStatus ? "Saving…" : "Update status"}
              </button>
            </form>
            <Link className="case-back-link" to="/cases">Back to all cases</Link>
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
