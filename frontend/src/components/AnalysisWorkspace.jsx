import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAssistant } from "./AssistantContext.jsx";
import { useAuth } from "./AuthContext.jsx";
import Icon from "./Icon.jsx";
import WorkspaceLayout from "./WorkspaceLayout.jsx";
import { getCases } from "../services/casesApi.js";
import {
  createEvent,
  exportIocs,
  extractLogIndicators,
  getEvents,
  getIocs,
  updateEvent,
} from "../services/workspaceApi.js";

const SAMPLE_LOG_SNIPPET = `2026-11-19T13:06:42Z idp-edge-01 auth_event user=ops-admin@corp src_ip=185.220.101.44 action=oauth_token_issue mfa=bypassed_cli app_id=94f1a2c8
2026-11-19T13:07:11Z ws-eng-042 sysmon_proc image=powershell.exe cmd="powershell -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA..." dst_domain=cdn-telemetry-sync.example dst_ip=198.51.100.77
2026-11-19T13:08:04Z ws-eng-042 file_hash sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 target=lsass_dump.dmp`;

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function CaseTimelinePage({ findingsOnly = false, correlationView = false }) {
  const { openAssistant } = useAssistant();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("write_investigations");
  const [events, setEvents] = useState([]);
  const [cases, setCases] = useState([]);
  const [caseFilter, setCaseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [showLogModal, setShowLogModal] = useState(false);
  const [form, setForm] = useState({
    caseNumber: "",
    eventType: "Authentication",
    recordType: findingsOnly ? "Analytical finding" : "Recorded fact",
    description: "",
    sourceEvidence: "",
    analysisStatus: findingsOnly ? "Requires review" : "Pending review",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [evRes, caseRes] = await Promise.all([
        getEvents({
          caseNumber: caseFilter,
          recordType: findingsOnly ? "Analytical finding" : "",
          query,
        }),
        getCases({ limit: 50 }),
      ]);
      setEvents(evRes.items || []);
      setCases(caseRes.items || []);
      setForm((p) => ({ ...p, caseNumber: p.caseNumber || caseRes.items?.[0]?.caseNumber || "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load timeline events.");
    } finally {
      setLoading(false);
    }
  }, [caseFilter, findingsOnly, query]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const onWorkspaceUpdate = () => loadData();
    window.addEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
    return () => window.removeEventListener("cybertrace:workspace-updated", onWorkspaceUpdate);
  }, [loadData]);

  const correlatedGroups = useMemo(() => {
    if (!correlationView) return [];
    const byType = new Map();
    for (const ev of events) {
      const key = ev.eventType || "Other";
      const arr = byType.get(key) || [];
      arr.push(ev);
      byType.set(key, arr);
    }
    return Array.from(byType.entries()).map(([eventType, list]) => ({
      eventType,
      count: list.length,
      cases: Array.from(new Set(list.map((i) => i.caseNumber))),
      items: list,
    }));
  }, [correlationView, events]);

  const handleStatusChange = async (eventId, analysisStatus) => {
    try {
      await updateEvent(eventId, { analysisStatus });
      setNotice(`Updated ${eventId} status to ${analysisStatus}.`);
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update event status.");
    }
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    try {
      const indicators = extractLogIndicators(form.description);
      await createEvent({ ...form, indicators });
      setNotice("Event recorded in timeline.");
      setShowLogModal(false);
      setForm((p) => ({ ...p, description: "", sourceEvidence: "" }));
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create event.");
    }
  };

  const pageTitle = findingsOnly
    ? "Forensic Findings"
    : correlationView
      ? "Event Correlation"
      : "Case Timeline";

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
          <span className="eyebrow">FORENSIC ANALYSIS</span>
          <h1>{pageTitle}</h1>
          <p>
            {findingsOnly
              ? "Review analytical findings, verify supporting evidence, and track investigator sign-off."
              : correlationView
                ? "Group related events across investigation cases to uncover shared attack chains."
                : "Chronological ledger of recorded facts and analytical findings across investigations."}
          </p>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              openAssistant({
                caseId: caseFilter,
                prompt: correlationView
                  ? "Correlate events and findings across cases to highlight shared actors, hosts, or techniques."
                  : "Summarize the key timeline events and prioritize findings awaiting review.",
              })
            }
          >
            <Icon name="assistant" size={15} /> AI Correlate
          </button>
          {canWrite && (
            <button type="button" className="primary-button" onClick={() => setShowLogModal(true)}>
              <Icon name="plus" size={15} /> Log event
            </button>
          )}
        </div>
      </div>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && (
        <div className="dashboard-error" role="alert">
          <Icon name="findings" size={18} />
          <div><strong>Timeline error</strong><p>{error}</p></div>
        </div>
      )}

      {correlationView && !loading && (
        <div className="correlation-grid">
          {correlatedGroups.map((group) => (
            <section className="panel" key={group.eventType}>
              <div className="case-list-toolbar">
                <div>
                  <h2>{group.eventType}</h2>
                  <p>{group.count} event{group.count === 1 ? "" : "s"} across {group.cases.join(", ")}</p>
                </div>
              </div>
              <div className="timeline-list">
                {group.items.map((ev) => (
                  <article className="timeline-event" key={ev.id}>
                    <span className={`timeline-marker${ev.recordType === "Analytical finding" ? " marker-finding" : ""}`} />
                    <div className="timeline-event-main">
                      <div className="timeline-event-heading">
                        <span className="event-type">{ev.caseNumber}</span>
                        <span className={`record-kind${ev.recordType === "Analytical finding" ? " record-finding" : ""}`}>
                          {ev.recordType}
                        </span>
                      </div>
                      <p>{ev.description}</p>
                    </div>
                    <time dateTime={ev.occurredAt}>{formatDateTime(ev.occurredAt)}</time>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {!correlationView && (
        <section className="panel">
          <div className="case-list-toolbar">
            <div>
              <h2>{findingsOnly ? "Findings review queue" : "Chronological events"}</h2>
              <p>{events.length} record{events.length === 1 ? "" : "s"}</p>
            </div>
            <div className="case-list-controls">
              <select
                aria-label="Filter by case"
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
            <div className="case-loading">Loading events…</div>
          ) : events.length === 0 ? (
            <div className="case-empty">
              <span className="empty-state-mark"><Icon name="timeline" size={18} /></span>
              <strong>No events found</strong>
              <p>Log an investigation event or adjust your filters.</p>
            </div>
          ) : (
            <div className="timeline-list">
              {events.map((ev) => (
                <article className="timeline-event" key={ev.id}>
                  <span className={`timeline-marker${ev.recordType === "Analytical finding" ? " marker-finding" : ""}`} />
                  <div className="timeline-event-main">
                    <div className="timeline-event-heading">
                      <span className="event-type">{ev.eventType}</span>
                      <span className={`record-kind${ev.recordType === "Analytical finding" ? " record-finding" : ""}`}>
                        {ev.recordType}
                      </span>
                      <Link className="case-id case-title-link" to={`/cases/${ev.caseNumber}`}>{ev.caseNumber}</Link>
                    </div>
                    <p>{ev.description}</p>
                    <div className="event-metadata">
                      <span><Icon name="evidence" size={13} />{ev.sourceEvidence}</span>
                      <label className="inline-status-edit">
                        <span className="sr-only">Analysis status</span>
                        <select
                          value={ev.analysisStatus}
                          disabled={!canWrite}
                          onChange={(e) => handleStatusChange(ev.id, e.target.value)}
                        >
                          <option>Not analyzed</option>
                          <option>Pending review</option>
                          <option>Requires review</option>
                          <option>Reviewed</option>
                          <option>Not applicable</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <time dateTime={ev.occurredAt}>{formatDateTime(ev.occurredAt)}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {showLogModal && (
        <div className="case-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowLogModal(false)}>
          <section className="panel case-modal" role="dialog" aria-modal="true" aria-label="Log timeline event">
            <div className="case-modal-heading">
              <div>
                <h2>Log forensic event or finding</h2>
                <p>IOCs (IPs, domains, SHA-256 hashes, users) are automatically indexed.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowLogModal(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </div>
            <form className="case-form case-modal-form" onSubmit={handleCreateEvent}>
              <div className="case-form-row">
                <label>
                  <span>Case</span>
                  <select value={form.caseNumber} onChange={(e) => setForm((p) => ({ ...p, caseNumber: e.target.value }))}>
                    {cases.map((c) => <option key={c.caseNumber} value={c.caseNumber}>{c.caseNumber} — {c.title}</option>)}
                  </select>
                </label>
                <label>
                  <span>Record type</span>
                  <select value={form.recordType} onChange={(e) => setForm((p) => ({ ...p, recordType: e.target.value }))}>
                    <option>Recorded fact</option>
                    <option>Analytical finding</option>
                  </select>
                </label>
              </div>
              <div className="case-form-row">
                <label>
                  <span>Event type</span>
                  <select value={form.eventType} onChange={(e) => setForm((p) => ({ ...p, eventType: e.target.value }))}>
                    <option>Authentication</option>
                    <option>File access</option>
                    <option>Application activity</option>
                    <option>Evidence collection</option>
                    <option>Investigation update</option>
                  </select>
                </label>
                <label>
                  <span>Source evidence</span>
                  <input
                    value={form.sourceEvidence}
                    onChange={(e) => setForm((p) => ({ ...p, sourceEvidence: e.target.value }))}
                    placeholder="e.g. sysmon-ws042.evtx"
                  />
                </label>
              </div>
              <label>
                <span>Description <b aria-hidden="true">*</b></span>
                <textarea
                  required
                  rows={4}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Describe the observed log event, indicator, or analytical finding..."
                />
              </label>
              <div className="case-form-actions">
                <button type="button" className="secondary-button" onClick={() => setShowLogModal(false)}>Cancel</button>
                <button type="submit" className="primary-button">Save to timeline</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </WorkspaceLayout>
  );
}

export function LogAnalysisPage() {
  const { openAssistant } = useAssistant();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("write_investigations");
  const [cases, setCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState("");
  const [logText, setLogText] = useState(SAMPLE_LOG_SNIPPET);
  const [sourceName, setSourceName] = useState("triage-paste.log");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getCases({ limit: 50 })
      .then((res) => {
        setCases(res.items || []);
        if (res.items?.[0]) setSelectedCase(res.items[0].caseNumber);
      })
      .catch(() => {});
  }, []);

  const extractedIocs = useMemo(() => extractLogIndicators(logText), [logText]);
  const lineCount = useMemo(() => logText.split("\n").filter((l) => l.trim()).length, [logText]);

  const handleFileLoad = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSourceName(file.name);
    const text = await file.text();
    setLogText(text.slice(0, 50000));
  };

  const handleSaveFinding = async () => {
    if (!selectedCase || !logText.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createEvent({
        caseNumber: selectedCase,
        eventType: "Application activity",
        recordType: "Recorded fact",
        description: `Parsed ${lineCount} log line(s) from ${sourceName} with ${extractedIocs.length} extracted indicator(s).`,
        sourceEvidence: sourceName,
        analysisStatus: "Pending review",
        indicators: extractedIocs,
      });
      setNotice(`Saved parsed indicators & log summary to ${selectedCase}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save log event.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceLayout
      mode="live"
      cases={cases}
      selectedCaseId={selectedCase}
      onSelectCase={setSelectedCase}
      pageTitle="Log Analysis"
      showSearch={false}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOG TRIAGE & IOC EXTRACTION</span>
          <h1>Log Analysis</h1>
          <p>Paste or load raw telemetry logs to extract IPs, domains, hashes, and principals, then run AI triage.</p>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              openAssistant({
                caseId: selectedCase,
                tab: "triage",
                extraContext: logText,
              })
            }
          >
            <Icon name="assistant" size={15} /> AI Log Triage
          </button>
        </div>
      </div>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && <div className="dashboard-error" role="alert"><Icon name="findings" size={16} /><div><strong>Error</strong><p>{error}</p></div></div>}

      <div className="log-analysis-grid">
        <section className="panel">
          <div className="case-list-toolbar">
            <div>
              <h2>Raw log workbench</h2>
              <p className="tabular-nums">{lineCount} non-empty line{lineCount === 1 ? "" : "s"} · {sourceName}</p>
            </div>
            <div className="case-list-controls">
              <label className="secondary-button file-upload-btn">
                <Icon name="upload" size={14} /> Load file
                <input type="file" accept=".log,.txt,.json,.jsonl,.csv" onChange={handleFileLoad} className="sr-only" />
              </label>
              <button type="button" className="secondary-button" onClick={() => setLogText(SAMPLE_LOG_SNIPPET)}>
                Load sample
              </button>
            </div>
          </div>
          <textarea
            className="log-editor mono-input"
            rows={12}
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            placeholder="Paste syslog, JSONL, EDR process trees, or proxy logs here..."
          />
          <div className="log-workbench-actions">
            <select
              aria-label="Target case"
              value={selectedCase}
              onChange={(e) => setSelectedCase(e.target.value)}
              className="compact-select"
            >
              {cases.map((c) => <option key={c.caseNumber} value={c.caseNumber}>{c.caseNumber} — {c.title}</option>)}
            </select>
            {canWrite && (
              <button
                type="button"
                className="secondary-button"
                onClick={handleSaveFinding}
                disabled={saving || !selectedCase || !logText.trim()}
              >
                {saving ? "Saving…" : "Save IOCs to Case Timeline"}
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="case-list-toolbar">
            <div>
              <h2>Extracted indicators ({extractedIocs.length})</h2>
              <p>Automatically parsed from the active log buffer.</p>
            </div>
          </div>
          {extractedIocs.length === 0 ? (
            <div className="case-empty">
              <strong>No indicators detected</strong>
              <p>Paste logs containing IPv4 addresses, domains, emails, or SHA-256 hashes.</p>
            </div>
          ) : (
            <div className="ai-ioc-list ioc-panel-list">
              {extractedIocs.map((ioc) => (
                <div className="ai-ioc-item" key={`${ioc.type}:${ioc.value}`}>
                  <span className="ai-ioc-type">{ioc.type}</span>
                  <code className="mono-cell">{ioc.value}</code>
                  <button
                    type="button"
                    className="table-action-link"
                    onClick={() =>
                      openAssistant({
                        caseId: selectedCase,
                        tab: "chat",
                        extraContext: logText,
                        prompt: `Investigate indicator ${ioc.type}: ${ioc.value} in the attached logs and workspace cases.`,
                      })
                    }
                  >
                    Ask AI
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </WorkspaceLayout>
  );
}

export function DigitalFootprintPage() {
  const { openAssistant } = useAssistant();
  const [iocs, setIocs] = useState([]);
  const [cases, setCases] = useState([]);
  const [caseFilter, setCaseFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadIocs = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([getIocs({ caseNumber: caseFilter }), getCases({ limit: 50 })])
      .then(([iocRes, caseRes]) => {
        setIocs(iocRes.items || []);
        setCases(caseRes.items || []);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not load workspace indicators.");
      })
      .finally(() => setLoading(false));
  }, [caseFilter]);

  useEffect(() => {
    loadIocs();
  }, [loadIocs]);

  useEffect(() => {
    window.addEventListener("cybertrace:workspace-updated", loadIocs);
    return () => window.removeEventListener("cybertrace:workspace-updated", loadIocs);
  }, [loadIocs]);

  const handleExport = async (format) => {
    setExporting(format);
    setError("");
    try {
      const filename = await exportIocs({ format, caseNumber: caseFilter });
      setNotice(`Exported ${format.toUpperCase()} bundle (${filename}).`);
      window.setTimeout(() => setNotice(""), 3500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export indicators.");
    } finally {
      setExporting("");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return iocs;
    return iocs.filter(
      (i) =>
        i.value.toLowerCase().includes(q) ||
        i.type.toLowerCase().includes(q) ||
        i.cases.some((c) => c.toLowerCase().includes(q)),
    );
  }, [iocs, query]);

  return (
    <WorkspaceLayout
      mode={loading ? "loading" : "live"}
      cases={cases}
      selectedCaseId={caseFilter}
      onSelectCase={setCaseFilter}
      query={query}
      onQueryChange={setQuery}
      pageTitle="Digital Footprint"
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">INDICATOR TRACE</span>
          <h1>Digital Footprint</h1>
          <p>Cross-case inventory of observed IP addresses, domains, SHA-256 hashes, and identity principals.</p>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={loading || Boolean(exporting)}
            onClick={() => handleExport("stix")}
          >
            <Icon name="download" size={14} />
            {exporting === "stix" ? "Exporting…" : "Export STIX 2.1"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={loading || Boolean(exporting)}
            onClick={() => handleExport("misp")}
          >
            <Icon name="download" size={14} />
            {exporting === "misp" ? "Exporting…" : "Export MISP"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              openAssistant({
                caseId: caseFilter,
                prompt: "Analyze the observed digital footprint indicators and identify high-risk pivots.",
              })
            }
          >
            <Icon name="assistant" size={15} /> AI Pivot Analysis
          </button>
        </div>
      </div>

      {notice && <div className="case-success-notice" role="status">{notice}</div>}
      {error && (
        <div className="dashboard-error" role="alert">
          <Icon name="findings" size={16} />
          <div><strong>Indicator error</strong><p>{error}</p></div>
        </div>
      )}

      <section className="panel">
        <div className="case-list-toolbar">
          <div>
            <h2>Observed indicators</h2>
            <p className="tabular-nums">{filtered.length} indicator{filtered.length === 1 ? "" : "s"}</p>
          </div>
          <div className="case-list-controls">
            <select
              aria-label="Filter indicators by case"
              value={caseFilter}
              onChange={(e) => setCaseFilter(e.target.value)}
              className="compact-select"
            >
              <option value="">All cases</option>
              {cases.map((c) => (
                <option key={c.caseNumber} value={c.caseNumber}>{c.caseNumber}</option>
              ))}
            </select>
            <button type="button" className="secondary-button" onClick={loadIocs}>
              <Icon name="refresh" size={14} /> Refresh
            </button>
          </div>
        </div>
        {loading ? (
          <div className="case-loading">Indexing workspace indicators…</div>
        ) : filtered.length === 0 ? (
          <div className="case-empty">
            <strong>No indicators match</strong>
            <p>Log events or parse telemetry in Log Analysis to populate indicators.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll desktop-table-wrap">
              <table className="cases-table">
                <thead>
                  <tr>
                    <th>TYPE</th>
                    <th>INDICATOR VALUE</th>
                    <th>LINKED CASES</th>
                    <th>SOURCES</th>
                    <th>HITS</th>
                    <th>LAST SEEN</th>
                    <th>TRACE</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td><span className="ai-ioc-type">{item.type}</span></td>
                      <td className="mono-cell">{item.value}</td>
                      <td>
                        {item.cases.map((c) => (
                          <Link key={c} className="case-id case-title-link" to={`/cases/${c}`} style={{ marginRight: 8 }}>
                            {c}
                          </Link>
                        ))}
                      </td>
                      <td>{item.sources.join(", ")}</td>
                      <td className="mono-cell">{item.occurrences}</td>
                      <td>{formatDateTime(item.lastSeen)}</td>
                      <td>
                        <button
                          type="button"
                          className="table-action-link"
                          onClick={() =>
                            openAssistant({
                              caseId: item.cases[0] || "",
                              prompt: `Trace indicator ${item.type} "${item.value}" across workspace cases and suggest containment/enrichment steps.`,
                            })
                          }
                        >
                          Trace with AI
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list">
              {filtered.map((item) => (
                <article className="mobile-data-card" key={item.id}>
                  <div className="mobile-card-top">
                    <span className="ai-ioc-type">{item.type}</span>
                    <span className="mobile-card-meta">{item.occurrences} hit{item.occurrences === 1 ? "" : "s"}</span>
                  </div>
                  <code className="mobile-card-hash mono-cell">{item.value}</code>
                  <p className="mobile-card-meta">
                    Sources: {item.sources.join(", ")} · {formatDateTime(item.lastSeen)}
                  </p>
                  <div className="mobile-card-actions">
                    {item.cases[0] && (
                      <Link className="secondary-button" to={`/cases/${item.cases[0]}`}>{item.cases[0]}</Link>
                    )}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        openAssistant({
                          caseId: item.cases[0] || "",
                          prompt: `Trace indicator ${item.type} "${item.value}" across workspace cases and suggest containment/enrichment steps.`,
                        })
                      }
                    >
                      Trace with AI
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </WorkspaceLayout>
  );
}
