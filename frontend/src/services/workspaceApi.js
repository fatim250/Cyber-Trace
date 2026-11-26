const ANALYST_STORAGE_KEY = "cybertrace.activeAnalyst";
const PREFS_STORAGE_KEY = "cybertrace.workspacePrefs";

export function getActiveAnalyst() {
  try {
    return window.localStorage.getItem(ANALYST_STORAGE_KEY) || "Nadia Vance";
  } catch {
    return "Nadia Vance";
  }
}

export function setActiveAnalyst(name) {
  try {
    window.localStorage.setItem(ANALYST_STORAGE_KEY, name);
  } catch {
    // Ignore storage errors in restricted environments
  }
}

export function getWorkspacePrefs() {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { compactTables: false, defaultSeverity: "MEDIUM" };
    return { compactTables: false, defaultSeverity: "MEDIUM", ...JSON.parse(raw) };
  } catch {
    return { compactTables: false, defaultSeverity: "MEDIUM" };
  }
}

export function saveWorkspacePrefs(prefs) {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "X-CyberTrace-Actor": getActiveAnalyst(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) throw new Error("Unsupported server response format.");
    }
  }

  if (!response.ok) {
    const msg = payload?.error?.message || payload?.detail || `Request failed (HTTP ${response.status}).`;
    throw new Error(msg);
  }

  return payload;
}

export async function computeFileSha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function extractLogIndicators(rawText = "") {
  const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  const sha256Regex = /\b[a-fA-F0-9]{64}\b/g;
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const domainRegex = /\b(?:[a-zA-Z0-9-]+\.)+(?:com|net|org|io|gov|edu|local|corp|example|info|biz|ru|cn|xyz|cloud)\b/g;

  const indicators = [];
  const seen = new Set();
  const add = (type, value) => {
    const key = `${type}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    indicators.push({ type, value });
  };

  for (const m of rawText.match(ipv4Regex) || []) add("ip", m);
  for (const m of rawText.match(sha256Regex) || []) add("hash", m.toLowerCase());
  for (const m of rawText.match(emailRegex) || []) add("user", m);
  for (const m of rawText.match(domainRegex) || []) {
    if (![...seen].some((k) => k.startsWith("user:") && k.endsWith(`@${m}`))) {
      add("domain", m.toLowerCase());
    }
  }
  return indicators;
}

export const getEvidence = ({ caseNumber = "", query = "", signal } = {}) => {
  const params = new URLSearchParams();
  if (caseNumber) params.set("caseNumber", caseNumber);
  if (query.trim()) params.set("q", query.trim());
  const qs = params.toString();
  return apiRequest(`/api/v1/evidence${qs ? `?${qs}` : ""}`, { signal });
};

export const registerEvidence = (data) =>
  apiRequest("/api/v1/evidence", { method: "POST", body: JSON.stringify(data) });

export const verifyEvidence = (id, observedSha256) =>
  apiRequest(`/api/v1/evidence/${encodeURIComponent(id)}/verify`, {
    method: "POST",
    body: JSON.stringify({ observedSha256 }),
  });

export const addCustodyEntry = (id, data) =>
  apiRequest(`/api/v1/evidence/${encodeURIComponent(id)}/custody`, {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getEvents = ({ caseNumber = "", recordType = "", query = "", signal } = {}) => {
  const params = new URLSearchParams();
  if (caseNumber) params.set("caseNumber", caseNumber);
  if (recordType) params.set("recordType", recordType);
  if (query.trim()) params.set("q", query.trim());
  const qs = params.toString();
  return apiRequest(`/api/v1/events${qs ? `?${qs}` : ""}`, { signal });
};

export const createEvent = (data) =>
  apiRequest("/api/v1/events", { method: "POST", body: JSON.stringify(data) });

export const updateEvent = (id, data) =>
  apiRequest(`/api/v1/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const getIocs = ({ signal } = {}) => apiRequest("/api/v1/iocs", { signal });

export const getTeam = ({ signal } = {}) => apiRequest("/api/v1/team", { signal });

export const addTeamMember = (data) =>
  apiRequest("/api/v1/team", { method: "POST", body: JSON.stringify(data) });

export const getAuditLogs = ({ query = "", action = "", signal } = {}) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (action) params.set("action", action);
  const qs = params.toString();
  return apiRequest(`/api/v1/audit-logs${qs ? `?${qs}` : ""}`, { signal });
};

export const getCaseReport = (caseId, { signal } = {}) =>
  apiRequest(`/api/v1/reports/${encodeURIComponent(caseId)}`, { signal });

export async function streamAssistantChat({ messages, caseId, extraContext, onChunk, signal }) {
  const response = await fetch("/api/v1/assistant/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "X-CyberTrace-Actor": getActiveAnalyst(),
    },
    body: JSON.stringify({ messages, caseId, extraContext }),
    signal,
  });

  if (!response.ok) {
    let message = `AI Assistant request failed (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const block of lines) {
      const dataLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine.slice(6));
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.text) onChunk(parsed.text);
    }
  }
}

export const getAssistantStatus = ({ signal } = {}) =>
  apiRequest("/api/v1/assistant/status", { signal });

export function notifyWorkspaceUpdated() {
  window.dispatchEvent(new CustomEvent("cybertrace:workspace-updated"));
}

export const analyzeWithAssistant = ({ mode = "case", input = "", caseId, extraContext, signal }) =>
  apiRequest("/api/v1/assistant/analyze", {
    method: "POST",
    body: JSON.stringify({ mode, input, caseId, extraContext }),
    signal,
  });
