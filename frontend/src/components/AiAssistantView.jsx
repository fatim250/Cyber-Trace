import { useCallback, useEffect, useRef, useState } from "react";

import { useAssistant, WELCOME_MESSAGE } from "./AssistantContext.jsx";
import Icon from "./Icon.jsx";
import { getCases } from "../services/casesApi.js";
import {
  analyzeWithAssistant,
  createEvent,
  extractLogIndicators,
  getAssistantStatus,
  notifyWorkspaceUpdated,
  streamAssistantChat,
} from "../services/workspaceApi.js";

export const QUICK_PROMPTS = [
  {
    label: "Triage & next steps",
    detail: "Separate confirmed facts from hypotheses & prioritize actions",
    prompt: "Triage the current investigation context, separate confirmed facts from hypotheses, and recommend prioritized next forensic steps.",
  },
  {
    label: "Evidence & SHA-256 gaps",
    detail: "Audit unverified artifacts & chain-of-custody records",
    prompt: "Audit evidence items for missing SHA-256 verifications, custody gaps, and recommended acquisition checks.",
  },
  {
    label: "Correlate IOCs & events",
    detail: "Pivot across IPs, domains, hashes & account activity",
    prompt: "Correlate recorded events, IP/domain/user indicators, and analytical findings to identify potential lateral movement or account compromise.",
  },
  {
    label: "Team handoff brief",
    detail: "Draft an executive & SOC shift-handoff summary",
    prompt: "Draft a concise shift-handoff brief for the cyber response team covering status, verified facts, open risks, and next owner actions.",
  },
];

function renderInlineFormatted(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={idx} className="ai-inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="ai-code-block">
      <div className="ai-code-head">
        <span>{language || "telemetry"}</span>
        <button type="button" onClick={handleCopy}>
          <Icon name={copied ? "check" : "copy"} size={13} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="mono-input"><code>{code}</code></pre>
    </div>
  );
}

export function AssistantMessageBody({ content }) {
  const lines = content.split("\n");
  const blocks = [];
  let listItems = [];
  let listOrdered = false;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];

  const flushList = (keyPrefix) => {
    if (listItems.length === 0) return;
    const Tag = listOrdered ? "ol" : "ul";
    blocks.push(
      <Tag key={`${keyPrefix}-list`} className="ai-md-list">
        {listItems.map((item, i) => (
          <li key={i}>{renderInlineFormatted(item)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
  };

  const flushCode = (keyPrefix) => {
    blocks.push(
      <CodeBlock key={`${keyPrefix}-code`} language={codeLang} code={codeLines.join("\n")} />,
    );
    inCode = false;
    codeLang = "";
    codeLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushList(index);
        inCode = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      } else {
        flushCode(index);
      }
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!trimmed) {
      flushList(index);
      blocks.push(<div key={`sp-${index}`} className="ai-line-spacer" />);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch) {
      if (listItems.length > 0 && listOrdered) flushList(index);
      listOrdered = false;
      listItems.push(bulletMatch[1]);
      return;
    }
    if (orderedMatch) {
      if (listItems.length > 0 && !listOrdered) flushList(index);
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      return;
    }

    flushList(index);

    const headingMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      blocks.push(<h4 key={`h-${index}`} className="ai-md-heading">{renderInlineFormatted(headingMatch[1])}</h4>);
      return;
    }

    blocks.push(<p key={`p-${index}`}>{renderInlineFormatted(trimmed)}</p>);
  });

  if (inCode && codeLines.length > 0) flushCode("end");
  flushList("end");
  return <div className="ai-message-body">{blocks}</div>;
}

function formatMessageTime(ts) {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
  } catch {
    return "";
  }
}

export default function AiAssistantView({ variant = "drawer", active = true, onOpenFullWorkspace }) {
  const {
    caseId,
    setCaseId,
    extraContext,
    setExtraContext,
    draftPrompt,
    setDraftPrompt,
    autoSendRequest,
    clearAutoSend,
    activeTab,
    setActiveTab,
    activeAnalyst,
    messages,
    setMessages,
    triageMode,
    setTriageMode,
    triageInput,
    setTriageInput,
    triageResult,
    setTriageResult,
  } = useAssistant();

  const [cases, setCases] = useState([]);
  const [aiStatus, setAiStatus] = useState({ configured: null, model: "" });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [savedId, setSavedId] = useState("");
  const [showContextEditor, setShowContextEditor] = useState(false);

  const [triageLoading, setTriageLoading] = useState(false);
  const [triageSaved, setTriageSaved] = useState(false);
  const [triageCopied, setTriageCopied] = useState(false);

  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const composerRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const isPage = variant === "page";

  useEffect(() => {
    if (!active) return;
    getCases({ limit: 50 })
      .then((res) => setCases(res.items || []))
      .catch(() => {});
    getAssistantStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus({ configured: false, model: "" }));
  }, [active]);

  useEffect(() => {
    if (draftPrompt) {
      setInput(draftPrompt);
      setDraftPrompt("");
    }
  }, [draftPrompt, setDraftPrompt]);

  useEffect(() => {
    if (extraContext && activeTab === "triage" && !triageInput) {
      setTriageMode("logs");
      setTriageInput(extraContext);
    }
  }, [extraContext, activeTab, triageInput, setTriageMode, setTriageInput]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const minH = isPage ? 124 : 112;
    const maxH = isPage ? 280 : 240;
    const nextHeight = Math.min(maxH, Math.max(minH, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
  }, [input, active, activeTab, isPage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const sendMessage = useCallback(
    async (promptText, overrides = {}) => {
      const text = (promptText ?? input).trim();
      if (!text || streaming) return;

      const effectiveCaseId = overrides.caseId !== undefined ? overrides.caseId : caseId;
      const effectiveExtra = overrides.extraContext !== undefined ? overrides.extraContext : extraContext;
      const now = Date.now();

      const userMsg = { id: `u-${now}`, role: "user", content: text, timestamp: now };
      const assistantId = `a-${now + 1}`;
      const nextHistory = [...messagesRef.current.filter((m) => m.id !== "welcome"), userMsg];

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", timestamp: now + 1 },
      ]);
      if (!promptText) setInput("");
      setError("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamAssistantChat({
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          caseId: effectiveCaseId || undefined,
          extraContext: effectiveExtra || undefined,
          signal: controller.signal,
          onChunk: (chunk) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
            );
          },
        });
        setAiStatus((prev) => ({ ...prev, configured: true }));
      } catch (cause) {
        if (!controller.signal.aborted) {
          const msg = cause instanceof Error ? cause.message : "AI request failed.";
          setError(msg);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content.trim() !== ""));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [caseId, extraContext, input, streaming, setMessages],
  );

  useEffect(() => {
    if (!active || !autoSendRequest || streaming) return;
    const req = autoSendRequest;
    clearAutoSend();
    sendMessage(req.prompt, {
      caseId: req.caseId !== undefined ? req.caseId : caseId,
      extraContext: req.extraContext !== undefined ? req.extraContext : extraContext,
    });
  }, [active, autoSendRequest, streaming, clearAutoSend, sendMessage, caseId, extraContext]);

  const handleResetChat = () => {
    if (streaming) abortRef.current?.abort();
    setMessages([WELCOME_MESSAGE]);
    setError("");
  };

  const handleCopy = async (id, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(""), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSaveToTimeline = async (id, text) => {
    const targetCase = caseId || cases[0]?.caseNumber;
    if (!targetCase) {
      setError("Select an investigation case first to save this finding.");
      return;
    }
    try {
      const indicators = extractLogIndicators(text);
      await createEvent({
        caseNumber: targetCase,
        eventType: "Investigation update",
        recordType: "Analytical finding",
        description: text.slice(0, 800),
        sourceEvidence: "AI Investigation Assistant",
        analysisStatus: "Requires review",
        indicators,
      });
      notifyWorkspaceUpdated();
      setSavedId(id);
      window.setTimeout(() => setSavedId(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save finding to timeline.");
    }
  };

  const runStructuredTriage = async (event) => {
    event.preventDefault();
    if (triageLoading) return;
    setTriageLoading(true);
    setError("");
    setTriageSaved(false);
    try {
      const res = await analyzeWithAssistant({
        mode: triageMode,
        input: triageInput,
        caseId: caseId || undefined,
        extraContext: extraContext || undefined,
      });
      setTriageResult(res.analysis);
      setAiStatus((prev) => ({ ...prev, configured: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Structured analysis failed.");
    } finally {
      setTriageLoading(false);
    }
  };

  const formatTriageMarkdown = (result) => {
    if (!result) return "";
    return [
      `Severity: ${result.severityAssessment}`,
      ``,
      `Summary: ${result.summary}`,
      result.suspectedTechniques?.length ? `\nTechniques:\n- ${result.suspectedTechniques.join("\n- ")}` : "",
      result.extractedIocs?.length
        ? `\nExtracted IOCs:\n- ${result.extractedIocs.map((i) => `[${i.type}] ${i.value} (${i.context})`).join("\n- ")}`
        : "",
      result.recommendedNextSteps?.length
        ? `\nNext Steps:\n${result.recommendedNextSteps.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const handleSaveTriageToTimeline = async () => {
    if (!triageResult) return;
    const targetCase = caseId || cases[0]?.caseNumber;
    if (!targetCase) {
      setError("Select an investigation case first to save this triage finding.");
      return;
    }
    try {
      const indicators = (triageResult.extractedIocs || [])
        .filter((i) => i?.type && i?.value)
        .map((i) => ({ type: i.type, value: i.value }));
      const description = `[AI Triage · ${triageResult.severityAssessment}] ${triageResult.summary}${
        triageResult.recommendedNextSteps?.[0] ? ` Next: ${triageResult.recommendedNextSteps[0]}` : ""
      }`;
      await createEvent({
        caseNumber: targetCase,
        eventType: triageMode === "logs" ? "Application activity" : "Investigation update",
        recordType: "Analytical finding",
        description: description.slice(0, 800),
        sourceEvidence: "AI Structured Triage",
        analysisStatus: "Requires review",
        indicators,
      });
      notifyWorkspaceUpdated();
      setTriageSaved(true);
      window.setTimeout(() => setTriageSaved(false), 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save triage finding.");
    }
  };

  const selectedCaseObj = cases.find((c) => c.caseNumber === caseId) || null;

  const consoleHeaderBar = (
    <div className="ai-console-toolbar">
      <div className="ai-console-toolbar-left">
        <div className="ai-tab-switch" role="tablist" aria-label="Assistant mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "chat"}
            className={activeTab === "chat" ? "is-active" : ""}
            onClick={() => setActiveTab("chat")}
          >
            Interactive Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "triage"}
            className={activeTab === "triage" ? "is-active" : ""}
            onClick={() => setActiveTab("triage")}
          >
            Structured Triage
          </button>
        </div>
        {aiStatus.configured !== null && (
          <span className={`ai-conn-pill ${aiStatus.configured ? "is-ready" : "is-offline"}`}>
            {aiStatus.configured ? "Connected" : "Setup needed"}
          </span>
        )}
      </div>

      <div className="ai-console-toolbar-right">
        {!isPage && onOpenFullWorkspace && (
          <button type="button" className="secondary-button ai-reset-btn" onClick={onOpenFullWorkspace}>
            <Icon name="expand" size={14} /> Open workbench
          </button>
        )}
        {activeTab === "chat" && messages.length > 1 && (
          <button className="secondary-button ai-reset-btn" type="button" onClick={handleResetChat}>
            New session
          </button>
        )}
      </div>
    </div>
  );

  const interactionBody = (
    <div className="ai-console-body">
      {!isPage && (
        <div className="ai-context-bar">
          <label className="ai-context-select">
            <span>Investigation scope</span>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">All workspace cases & telemetry</option>
              {cases.map((item) => (
                <option key={item.caseNumber} value={item.caseNumber}>
                  {item.caseNumber} — {item.title}
                </option>
              ))}
            </select>
          </label>
          {consoleHeaderBar}
        </div>
      )}

      {isPage && consoleHeaderBar}

      {!isPage && (extraContext || showContextEditor) && (
        <div className="ai-attached-context">
          <div className="ai-attached-header">
            <span>
              <Icon name="terminal" size={14} />
              {extraContext
                ? `Log / artifact buffer attached (${extraContext.length.toLocaleString()} chars)`
                : "Paste raw logs, command lines, or IOC excerpts to ground AI replies"}
            </span>
            <div className="ai-attached-btns">
              <button type="button" onClick={() => setShowContextEditor((v) => !v)}>
                {showContextEditor ? "Hide" : "Edit"}
              </button>
              {extraContext && (
                <button
                  type="button"
                  onClick={() => {
                    setExtraContext("");
                    setShowContextEditor(false);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {showContextEditor && (
            <textarea
              className="ai-context-textarea mono-input"
              rows={4}
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Paste raw syslog, PowerShell command, alert JSON, or hash list..."
            />
          )}
        </div>
      )}

      {error && (
        <div className="dashboard-error ai-error" role="alert">
          <Icon name="findings" size={16} />
          <div>
            <strong>Assistant unavailable</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {activeTab === "chat" ? (
        <>
          <div className="ai-messages" aria-live="polite">
            {messages.map((msg) => (
              <article key={msg.id} className={`ai-message ai-message-${msg.role}`}>
                <div className="ai-message-meta">
                  <div className="ai-message-author">
                    <span className={`ai-role-mark ai-role-${msg.role}`}>
                      <Icon name={msg.role === "user" ? "investigators" : "assistant"} size={14} />
                    </span>
                    <strong>{msg.role === "user" ? activeAnalyst : "CyberTrace AI"}</strong>
                    {msg.timestamp && (
                      <time className="tabular-nums">{formatMessageTime(msg.timestamp)}</time>
                    )}
                  </div>
                  {msg.role === "assistant" && msg.id !== "welcome" && msg.content && (
                    <div className="ai-message-actions">
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content)}
                        title="Copy response"
                      >
                        <Icon name={copiedId === msg.id ? "check" : "copy"} size={14} />
                        <span>{copiedId === msg.id ? "Copied" : "Copy"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveToTimeline(msg.id, msg.content)}
                        title="Save as analytical finding in case timeline"
                      >
                        <Icon name={savedId === msg.id ? "check" : "plus"} size={14} />
                        <span>{savedId === msg.id ? "Saved" : "Save finding"}</span>
                      </button>
                    </div>
                  )}
                </div>
                <AssistantMessageBody content={msg.content || (streaming ? "Analyzing investigation context…" : "")} />
              </article>
            ))}

            {messages.length === 1 && !isPage && (
              <div className="ai-starter-grid" aria-label="Recommended workflows">
                {QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="ai-starter-card"
                    disabled={streaming}
                    onClick={() => sendMessage(item.prompt)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </button>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {(messages.length > 1 || isPage) && (
            <div className="ai-quick-prompts">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="ai-quick-btn"
                  disabled={streaming}
                  onClick={() => sendMessage(item.prompt)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <form
            className="ai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <div className="ai-composer-shell">
              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Ask about case triage, IOC correlation, SHA-256 verification gaps, containment playbooks, or paste raw telemetry logs..."
                aria-label="Message AI Investigation Assistant"
                rows={4}
                disabled={streaming}
              />
              <div className="ai-composer-actions">
                <div className="ai-composer-tools">
                  {!isPage && (
                    <button
                      type="button"
                      className={`ai-attach-btn${showContextEditor || extraContext ? " is-attached" : ""}`}
                      onClick={() => setShowContextEditor((v) => !v)}
                    >
                      <Icon name="paperclip" size={14} />
                      <span>{extraContext ? "Edit attached logs" : "Attach logs"}</span>
                    </button>
                  )}
                  <span className="ai-scope-indicator">
                    Scope: <strong>{selectedCaseObj ? selectedCaseObj.caseNumber : "All workspace telemetry"}</strong>
                    {extraContext ? ` · ${extraContext.length.toLocaleString()} log chars` : ""}
                  </span>
                  <small className="ai-composer-hint">Enter to send · Shift+Enter for new line</small>
                </div>
                {streaming ? (
                  <button
                    type="button"
                    className="secondary-button ai-send-btn"
                    onClick={() => abortRef.current?.abort()}
                  >
                    Stop response
                  </button>
                ) : (
                  <button type="submit" className="primary-button ai-send-btn" disabled={!input.trim()}>
                    <Icon name="send" size={15} /> Send prompt
                  </button>
                )}
              </div>
            </div>
          </form>
        </>
      ) : (
        <div className="ai-triage-pane">
          <form className="ai-triage-form" onSubmit={runStructuredTriage}>
            <div className="ai-triage-mode-row">
              <button
                type="button"
                className={triageMode === "case" ? "is-active" : ""}
                onClick={() => setTriageMode("case")}
              >
                Case & Workspace Triage
              </button>
              <button
                type="button"
                className={triageMode === "logs" ? "is-active" : ""}
                onClick={() => setTriageMode("logs")}
              >
                Raw Log & IOC Triage
              </button>
            </div>
            <label>
              <span>{triageMode === "logs" ? "Paste raw logs or telemetry excerpt" : "Focus notes (optional)"}</span>
              <textarea
                value={triageInput}
                onChange={(e) => setTriageInput(e.target.value)}
                rows={triageMode === "logs" ? 9 : 5}
                placeholder={
                  triageMode === "logs"
                    ? "Paste JSONL, syslog, nginx access log, PowerShell command line, or alert JSON..."
                    : "Optional focus (e.g., check privilege escalation risk or containment readiness)..."
                }
                required={triageMode === "logs"}
              />
            </label>
            <button className="primary-button ai-triage-submit" type="submit" disabled={triageLoading}>
              <Icon name="assistant" size={15} />
              {triageLoading ? "Running forensic triage…" : "Run structured analysis"}
            </button>
          </form>

          {triageResult && (
            <div className="ai-triage-results">
              <div className="ai-triage-actions-bar">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleSaveTriageToTimeline}
                >
                  <Icon name={triageSaved ? "check" : "plus"} size={14} />
                  {triageSaved ? "Saved to timeline & IOCs" : "Save triage & IOCs to timeline"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(formatTriageMarkdown(triageResult)).catch(() => {});
                    setTriageCopied(true);
                    window.setTimeout(() => setTriageCopied(false), 2000);
                  }}
                >
                  <Icon name={triageCopied ? "check" : "copy"} size={14} />
                  {triageCopied ? "Copied" : "Copy brief"}
                </button>
              </div>

              <div className="ai-triage-block">
                <span className="ai-triage-label">Severity assessment</span>
                <strong>{triageResult.severityAssessment}</strong>
              </div>
              <div className="ai-triage-block">
                <span className="ai-triage-label">Technical summary</span>
                <p>{triageResult.summary}</p>
              </div>
              {triageResult.suspectedTechniques?.length > 0 && (
                <div className="ai-triage-block">
                  <span className="ai-triage-label">Observed techniques & patterns</span>
                  <ul>
                    {triageResult.suspectedTechniques.map((tech, idx) => (
                      <li key={idx}>{tech}</li>
                    ))}
                  </ul>
                </div>
              )}
              {triageResult.extractedIocs?.length > 0 && (
                <div className="ai-triage-block">
                  <span className="ai-triage-label">Extracted indicators (IOCs)</span>
                  <div className="ai-ioc-list">
                    {triageResult.extractedIocs.map((ioc, idx) => (
                      <div key={idx} className="ai-ioc-item">
                        <span className="ai-ioc-type">{ioc.type}</span>
                        <code>{ioc.value}</code>
                        <small>{ioc.context}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {triageResult.recommendedNextSteps?.length > 0 && (
                <div className="ai-triage-block">
                  <span className="ai-triage-label">Recommended next steps</span>
                  <ol>
                    {triageResult.recommendedNextSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!isPage) {
    return interactionBody;
  }

  return (
    <div className="ai-workbench-grid">
      <aside className="ai-context-rail">
        <section className="panel ai-rail-panel">
          <div className="case-list-toolbar">
            <div>
              <h2>Investigation context</h2>
              <p>Scope AI reasoning to a specific incident or all telemetry.</p>
            </div>
          </div>
          <div className="ai-rail-body">
            <label className="ai-context-select">
              <span>Target case</span>
              <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                <option value="">All workspace cases & telemetry</option>
                {cases.map((item) => (
                  <option key={item.caseNumber} value={item.caseNumber}>
                    {item.caseNumber} — {item.title}
                  </option>
                ))}
              </select>
            </label>

            {selectedCaseObj && (
              <dl className="ai-case-snapshot">
                <div>
                  <dt>Case ID</dt>
                  <dd className="mono-cell">{selectedCaseObj.caseNumber}</dd>
                </div>
                <div>
                  <dt>Severity</dt>
                  <dd><span className={`severity-badge severity-${selectedCaseObj.severity.toLowerCase()}`}>{selectedCaseObj.severity}</span></dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd><span className={`status-badge status-${selectedCaseObj.status.toLowerCase().replaceAll("_", "-")}`}>{selectedCaseObj.status.replaceAll("_", " ")}</span></dd>
                </div>
                <div>
                  <dt>Lead</dt>
                  <dd>{selectedCaseObj.assignedTo || "Unassigned"}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <section className="panel ai-rail-panel">
          <div className="case-list-toolbar">
            <div>
              <h2>Telemetry / log buffer</h2>
              <p>Attach raw logs or IOC dumps directly to your session.</p>
            </div>
            {extraContext && (
              <button type="button" className="table-action-link" onClick={() => setExtraContext("")}>
                Clear
              </button>
            )}
          </div>
          <div className="ai-rail-body">
            <textarea
              className="ai-context-textarea mono-input"
              rows={7}
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              placeholder="Paste syslog, PowerShell command lines, EDR JSONL, or proxy traces here to ground every AI reply..."
            />
            <div className="ai-rail-file-row">
              <label className="secondary-button file-upload-btn">
                <Icon name="upload" size={14} /> Load log file
                <input
                  type="file"
                  accept=".log,.txt,.json,.jsonl,.csv"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setExtraContext(text.slice(0, 32000));
                  }}
                />
              </label>
              <span className="tabular-nums ai-buffer-count">
                {extraContext.length.toLocaleString()} chars
              </span>
            </div>
          </div>
        </section>

        <section className="panel ai-rail-panel">
          <div className="case-list-toolbar">
            <div>
              <h2>Playbooks</h2>
              <p>Launch structured forensic prompts.</p>
            </div>
          </div>
          <div className="ai-rail-playbooks">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="ai-starter-card"
                disabled={streaming}
                onClick={() => {
                  setActiveTab("chat");
                  sendMessage(item.prompt);
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="panel ai-console-panel" aria-label="AI Investigation Console">
        {interactionBody}
      </section>
    </div>
  );
}
