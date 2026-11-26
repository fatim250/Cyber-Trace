const API_BASE_URL = import.meta.env.VITE_CYBERTRACE_API_URL?.trim();
const DASHBOARD_PATH = "/api/v1/dashboard/overview";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateDashboardPayload(payload) {
  const valid =
    isRecord(payload) &&
    isRecord(payload.metrics) &&
    Array.isArray(payload.cases) &&
    isRecord(payload.evidenceIntegrity) &&
    Array.isArray(payload.evidenceIntegrity.verificationChecks) &&
    Array.isArray(payload.activityEvents) &&
    isRecord(payload.analytics);

  if (!valid) {
    throw new Error("The dashboard API returned data in an unsupported format.");
  }

  return payload;
}

export async function loadDashboardData({ signal, actor } = {}) {
  const baseUrl = API_BASE_URL ? API_BASE_URL.replace(/\/+$/, "") : "";
  const url = actor
    ? `${baseUrl}${DASHBOARD_PATH}?actor=${encodeURIComponent(actor)}`
    : `${baseUrl}${DASHBOARD_PATH}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Dashboard data could not be loaded (HTTP ${response.status}).`);
  }

  const payload = validateDashboardPayload(await response.json());
  return { mode: "live", data: payload };
}
