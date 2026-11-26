import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAssistant } from "./AssistantContext.jsx";
import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { getCases } from "../services/casesApi.js";
import {
  addCustodyEntry,
  computeFileSha256,
  getEvidence,
  registerEvidence,
  verifyEvidence,
} from "../services/workspaceApi.js";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function IntegrityStatus({ item }) {
  if (!item.comparisonPerformed) {
    return <span className="status-badge status-under-review">Pending verification</span>;
  }
  if (item.sha256Matches) {
    return <span className="status-badge status-resolved">SHA-256 Verified</span>;
  }
  return <span className="status-badge status-escalated">Hash Mismatch</span>;
}

export function EvidenceWorkspace({ defaultTab = "repository" }) {
  const location = useLocation();
  const { openAssistant } = useAssistant();

  const activeTab =
    location.pathname.includes("/integrity")
      ? "integrity"
      : location.pathname.includes("/chain-of-custody")
        ? "custody"
        : defaultTab;

  const [evidence, setEvidence] = useState([]);
  const [cases, setCases] = useState([]);
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Register Evidence modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    caseNumber: "",
    artifactType: "Authentication Log",
    sourceHost: "",
    sizeBytes: "",
    expectedSha256: "",
    observedSha256: "",
    notes: "",
  });
  const [savingAdd, setSavingAdd] = useState(false);

  // Verify modal
  const [verifyItem, setVerifyItem] = useState(null);
  const [observedInput, setObservedInput] = useState("");
  const [verifying, setVerifying] = useState(false);

  // Custody modal
  const [custodyItem, setCustodyItem] = useState(null);
  const [custodyForm, setCustodyForm] = useState({ action: "Transferred", custodian: "", notes: "" });
  const [savingCustody, setSavingCustody] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [evRes, caseRes] = await Promise.all([
        getEvidence({ caseNumber: caseFilter, query }),
        getCases({ limit: 50 }),
      ]);
      setEvidence(evRes.items || []);
      setCases(caseRes.items || []);
      setAddForm((prev) => ({
        ...prev,
        caseNumber: prev.caseNumber || caseRes.items?.[0]?.caseNumber || "",
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load evidence records.");
    } finally {
      setLoading(false);
    }
  }, [caseFilter, query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileHashPick = async (event, target) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const digest = await computeFileSha256(file);
      if (target === "add") {
        setAddForm((prev) => ({
          ...prev,
          name: prev.name || file.name,
          sizeBytes: String(file.size),
          expectedSha256: digest,
          observedSha256: digest,
        }));
      } else if (target === "verify") {
        setObservedInput(digest);
      }
    } catch {
      setError("Could not compute SHA-256 digest in this browser.");
    }
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    setSavingAdd(true);
    setError("");
    try {
      const created = await registerEvidence({
        ...addForm,
        sizeBytes: Number(addForm.sizeBytes) || 0,
      });
      setNotice(`Registered ${created.id} (${created.name}) under ${created.caseNumber}.`);
      setShowAdd(false);
      setAddForm({
        name: "",
        caseNumber: cases[0]?.caseNumber || "",
        artifactType: "Authentication Log",
        sourceHost: "",
        sizeBytes: "",
        expectedSha256: "",
        observedSha256: "",
        notes: "",
      });
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to register evidence.");
    } finally {
      setSavingAdd(false);
    }
  };

  const submitVerify = async (event) => {
    event.preventDefault();
    if (!verifyItem) return;
    setVerifying(true);
    setError("");
    try {
      const updated = await verifyEvidence(verifyItem.id, observedInput);
      setNotice(
        updated.sha256Matches
          ? `${updated.id} passed SHA-256 verification.`
          : `${updated.id} failed SHA-256 verification (hash mismatch).`,
      );
      setVerifyItem(null);
      setObservedInput("");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  const submitCustody = async (event) => {
    event.preventDefault();
    if (!custodyItem) return;
    setSavingCustody(true);
    setError("");
    try {
      await addCustodyEntry(custodyItem.id, custodyForm);
      setNotice(`Recorded custody event for ${custodyItem.id}.`);
      setCustodyItem(null);
      setCustodyForm({ action: "Transferred", custodian: "", notes: "" });
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record custody entry.");
    } finally {
      setSavingCustody(false);
    }
  };

  const verifiedCount = evidence.filter((e) => e.comparisonPerformed && e.sha256Matches).length;
  const mismatchCount = evidence.filter((e) => e.comparisonPerformed && e.sha256Matches === false).length;
  const pendingCount = evidence.filter((e) => !e.comparisonPerformed).length;

  const pageTitle =
    activeTab === "integrity"
      ? "Evidence Integrity"
      : activeTab === "custody"
        ? "Chain of Custody"
        : "Evidence Repository";

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : error ? "unavailable" : "live"}
      cases={cases}
      selectedCaseId={caseFilter}
      onSelectCase={setCaseFilter}
      query={query}
      onQueryChange={setQuery}
      pageTitle={pageTitle}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVIDENCE MANAGEMENT</span>
          <h1>{pageTitle}</h1>
          <p>Register forensic artifacts, compute or verify SHA-256 digests, and maintain an auditable chain of custody.</p>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              openAssistant({
                caseId: caseFilter,
                prompt: "Audit evidence items for missing SHA-256 verification and chain-of-custody gaps.",
              })
            }
          >
            <Icon name="assistant" size={15} /> AI Audit
          </button>
          <button type="button" className="primary-button" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={15} /> Register evidence
          </button>
        </div>
      </div>

      <div className="module-tabs" role="navigation" aria-label="Evidence views">
        <Link className={activeTab === "repository" ? "is-active" : ""} to="/evidence">Repository</Link>
        <Link className={activeTab === "integrity" ? "is-active" : ""} to="/evidence/integrity">SHA-256 Integrity</Link>
        <Link className={activeTab === "custody" ? "is-active" : ""} to="/evidence/chain-of-custody">Chain of Custody</Link>
      </div>

      <section className="case-kpi-grid" aria-label="Evidence summary">
        <article className="case-kpi-card">
          <span className="metric-icon metric-blue"><Icon name="evidence" size={16} /></span>
          <span className="case-kpi-label">Registered artifacts</span>
          <strong className="tabular-nums">{evidence.length}</strong>
        </article>
        <article className="case-kpi-card">
          <span className="metric-icon metric-green"><Icon name="integrity" size={16} /></span>
          <span className="case-kpi-label">Verified SHA-256</span>
          <strong className="tabular-nums">{verifiedCount}</strong>
        </article>
        <article className="case-kpi-card">
          <span className="metric-icon metric-amber"><Icon name="timeline" size={16} /></span>
          <span className="case-kpi-label">Pending verification</span>
          <strong className="tabular-nums">{pendingCount}</strong>
        </article>
        <article className="case-kpi-card">
          <span className="metric-icon metric-violet"><Icon name="findings" size={16} /></span>
          <span className="case-kpi-label">Hash mismatches</span>
          <strong className="tabular-nums">{mismatchCount}</strong>
        </article>
      </section>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && (
        <div className="dashboard-error" role="alert">
          <Icon name="findings" size={18} />
          <div><strong>Evidence notice</strong><p>{error}</p></div>
        </div>
      )}

      {activeTab !== "custody" ? (
        <section className="panel case-list-panel">
          <div className="case-list-toolbar">
            <div>
              <h2>{activeTab === "integrity" ? "SHA-256 verification ledger" : "Artifact inventory"}</h2>
              <p>{evidence.length} forensic item{evidence.length === 1 ? "" : "s"} tracked</p>
            </div>
            <div className="case-list-controls">
              <select
                aria-label="Filter evidence by case"
                value={caseFilter}
                onChange={(e) => setCaseFilter(e.target.value)}
                className="compact-select"
              >
                <option value="">All cases</option>
                {cases.map((c) => (
                  <option key={c.caseNumber} value={c.caseNumber}>{c.caseNumber}</option>
                ))}
              </select>
              <button type="button" className="secondary-button" onClick={loadData}>
                <Icon name="refresh" size={14} /> Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="case-loading">Loading evidence artifacts…</div>
          ) : evidence.length === 0 ? (
            <div className="case-empty">
              <span className="empty-state-mark"><Icon name="evidence" size={18} /></span>
              <strong>No evidence items match</strong>
              <p>Register an artifact or clear your search filter.</p>
            </div>
          ) : (
            <>
              <div className="table-scroll desktop-table-wrap">
                <table className="cases-table">
                  <thead>
                    <tr>
                      <th>EVIDENCE ID</th>
                      <th>ARTIFACT</th>
                      <th>CASE</th>
                      <th>HOST / SOURCE</th>
                      <th>SIZE</th>
                      <th>SHA-256 DIGEST</th>
                      <th>INTEGRITY</th>
                      <th>ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map((item) => (
                      <tr key={item.id}>
                        <td className="mono-cell">{item.id}</td>
                        <td>
                          <strong className="case-title">{item.name}</strong>
                          <div className="table-subtext">{item.artifactType}</div>
                        </td>
                        <td><Link className="case-id case-title-link" to={`/cases/${item.caseNumber}`}>{item.caseNumber}</Link></td>
                        <td>{item.sourceHost}</td>
                        <td className="mono-cell">{formatBytes(item.sizeBytes)}</td>
                        <td className="mono-cell" title={item.expectedSha256}>
                          {item.expectedSha256.slice(0, 14)}…{item.expectedSha256.slice(-6)}
                        </td>
                        <td><IntegrityStatus item={item} /></td>
                        <td className="case-row-actions">
                          <button
                            type="button"
                            className="table-action-link"
                            onClick={() => {
                              setVerifyItem(item);
                              setObservedInput(item.observedSha256 || "");
                            }}
                          >
                            Verify SHA-256
                          </button>
                          <button
                            type="button"
                            className="table-action-link"
                            onClick={() => {
                              setCustodyItem(item);
                              setCustodyForm({ action: "Transferred", custodian: "", notes: "" });
                            }}
                          >
                            Custody
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-card-list">
                {evidence.map((item) => (
                  <article className="mobile-data-card" key={item.id}>
                    <div className="mobile-card-top">
                      <span className="case-id mono-cell">{item.id}</span>
                      <IntegrityStatus item={item} />
                    </div>
                    <strong>{item.name}</strong>
                    <p className="mobile-card-meta">
                      {item.artifactType} · {item.sourceHost} · {formatBytes(item.sizeBytes)}
                    </p>
                    <p className="mobile-card-hash mono-cell">
                      SHA-256: {item.expectedSha256.slice(0, 20)}…{item.expectedSha256.slice(-8)}
                    </p>
                    <div className="mobile-card-actions">
                      <Link className="secondary-button" to={`/cases/${item.caseNumber}`}>{item.caseNumber}</Link>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setVerifyItem(item);
                          setObservedInput(item.observedSha256 || "");
                        }}
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setCustodyItem(item)}
                      >
                        Custody
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <div className="custody-grid">
          {evidence.map((item) => (
            <section className="panel" key={item.id}>
              <div className="case-list-toolbar">
                <div>
                  <h2>{item.id} · {item.name}</h2>
                  <p>{item.caseNumber} · {item.artifactType} · {item.sourceHost}</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCustodyItem(item)}
                >
                  <Icon name="plus" size={14} /> Log handoff
                </button>
              </div>
              <ol className="case-audit-timeline">
                {(item.custodyChain || []).map((entry) => (
                  <li key={entry.id}>
                    <span className="case-audit-marker" />
                    <div>
                      <strong>{entry.action} — {entry.custodian}</strong>
                      <p>{entry.notes}</p>
                      <time dateTime={entry.timestamp}>{formatDate(entry.timestamp)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Register evidence">
            <div className="case-modal-heading">
              <div>
                <h2>Register forensic evidence</h2>
                <p>Optionally select a local file to compute its SHA-256 digest in-browser (file is not uploaded).</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowAdd(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <form className="case-form case-modal-form" onSubmit={submitAdd}>
              <label className="file-hash-picker">
                <span>Compute SHA-256 from local file (optional)</span>
                <input type="file" onChange={(e) => handleFileHashPick(e, "add")} />
              </label>
              <div className="case-form-row">
                <label>
                  <span>Artifact name <b aria-hidden="true">*</b></span>
                  <input
                    required
                    value={addForm.name}
                    onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. auth-gateway-11-25.jsonl"
                  />
                </label>
                <label>
                  <span>Linked case <b aria-hidden="true">*</b></span>
                  <select
                    required
                    value={addForm.caseNumber}
                    onChange={(e) => setAddForm((p) => ({ ...p, caseNumber: e.target.value }))}
                  >
                    {cases.map((c) => (
                      <option key={c.caseNumber} value={c.caseNumber}>{c.caseNumber} — {c.title}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="case-form-row">
                <label>
                  <span>Artifact type</span>
                  <select
                    value={addForm.artifactType}
                    onChange={(e) => setAddForm((p) => ({ ...p, artifactType: e.target.value }))}
                  >
                    <option>Authentication Log</option>
                    <option>Endpoint Telemetry</option>
                    <option>Access Log</option>
                    <option>Network Capture</option>
                    <option>Memory Image</option>
                    <option>Disk Artifact</option>
                  </select>
                </label>
                <label>
                  <span>Source host</span>
                  <input
                    value={addForm.sourceHost}
                    onChange={(e) => setAddForm((p) => ({ ...p, sourceHost: e.target.value }))}
                    placeholder="e.g. prod-bastion-02"
                  />
                </label>
              </div>
              <label>
                <span>Expected SHA-256 (64 hex chars) <b aria-hidden="true">*</b></span>
                <input
                  required
                  value={addForm.expectedSha256}
                  onChange={(e) => setAddForm((p) => ({ ...p, expectedSha256: e.target.value }))}
                  placeholder="64-character SHA-256 hex digest"
                  className="mono-input"
                />
              </label>
              <label>
                <span>Acquisition notes</span>
                <textarea
                  rows={2}
                  value={addForm.notes}
                  onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Collection method, write-blocker or read-only export details..."
                />
              </label>
              <div className="case-form-actions">
                <button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={savingAdd}>
                  {savingAdd ? "Saving…" : "Register artifact"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {verifyItem && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setVerifyItem(null)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Verify SHA-256">
            <div className="case-modal-heading">
              <div>
                <h2>Verify SHA-256 integrity</h2>
                <p>{verifyItem.id} · {verifyItem.name}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setVerifyItem(null)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <form className="case-form case-modal-form" onSubmit={submitVerify}>
              <label>
                <span>Expected SHA-256</span>
                <input readOnly value={verifyItem.expectedSha256} className="mono-input" />
              </label>
              <label className="file-hash-picker">
                <span>Or hash a local file to compare</span>
                <input type="file" onChange={(e) => handleFileHashPick(e, "verify")} />
              </label>
              <label>
                <span>Observed SHA-256 <b aria-hidden="true">*</b></span>
                <input
                  required
                  value={observedInput}
                  onChange={(e) => setObservedInput(e.target.value)}
                  placeholder="Paste observed 64-character SHA-256 hash"
                  className="mono-input"
                />
              </label>
              <div className="case-form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setObservedInput(verifyItem.expectedSha256)}
                >
                  Paste expected hash
                </button>
                <button type="submit" className="primary-button" disabled={verifying}>
                  {verifying ? "Verifying…" : "Run SHA-256 comparison"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {custodyItem && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCustodyItem(null)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Chain of custody">
            <div className="case-modal-heading">
              <div>
                <h2>Log chain-of-custody entry</h2>
                <p>{custodyItem.id} · {custodyItem.name}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setCustodyItem(null)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <form className="case-form case-modal-form" onSubmit={submitCustody}>
              <div className="case-form-row">
                <label>
                  <span>Custody action</span>
                  <select
                    value={custodyForm.action}
                    onChange={(e) => setCustodyForm((p) => ({ ...p, action: e.target.value }))}
                  >
                    <option>Transferred</option>
                    <option>Analyzed</option>
                    <option>Sealed</option>
                    <option>Archived</option>
                  </select>
                </label>
                <label>
                  <span>Custodian <b aria-hidden="true">*</b></span>
                  <input
                    required
                    value={custodyForm.custodian}
                    onChange={(e) => setCustodyForm((p) => ({ ...p, custodian: e.target.value }))}
                    placeholder="Engineer or vault name"
                  />
                </label>
              </div>
              <label>
                <span>Handoff notes</span>
                <textarea
                  rows={3}
                  value={custodyForm.notes}
                  onChange={(e) => setCustodyForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Purpose of transfer, storage seal ID, or analysis performed..."
                />
              </label>
              <div className="case-form-actions">
                <button type="button" className="secondary-button" onClick={() => setCustodyItem(null)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={savingCustody}>
                  {savingCustody ? "Recording…" : "Record custody entry"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}
