import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  analyzeWithAssistant,
  formatGeminiError,
  getAssistantStatus,
  streamAssistantChat,
} from "./server/assistant.js";
import {
  CASE_SEVERITIES,
  CASE_STATUSES,
  SYSTEM_ACTOR,
  auditLogsStore,
  buildAssistantContext,
  buildDashboardOverview,
  casesStore,
  eventsStore,
  evidenceStore,
  nextAuditEntryId,
  nextCaseRecordId,
  nextCustodyEntryId,
  nextEventId,
  nextEvidenceId,
  nextTeamId,
  teamStore,
} from "./server/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIST_DIR = path.join(__dirname, "frontend", "dist");

const CREATE_FIELDS = new Set([
  "title",
  "description",
  "status",
  "severity",
  "assignedTo",
  "assigned_to",
  "reporterName",
  "reporter_name",
]);

function getActor(req) {
  const headerActor = req.get("x-cybertrace-actor");
  if (typeof headerActor === "string" && headerActor.trim()) {
    return headerActor.trim().slice(0, 160);
  }
  return SYSTEM_ACTOR;
}

function validationError(details) {
  return {
    error: {
      code: "validation_error",
      message: "Request validation failed.",
      details,
    },
  };
}

function makeDetail(loc, message, type = "value_error") {
  return { location: loc, message, type };
}

function normalizeOptionalString(value, fieldName, maxLength, details) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    details.push(makeDetail(["body", fieldName], "Input should be a valid string", "string_type"));
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    details.push(
      makeDetail(
        ["body", fieldName],
        `String should have at most ${maxLength} characters`,
        "string_too_long",
      ),
    );
    return undefined;
  }
  return trimmed || null;
}

function parseCreatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [makeDetail(["body"], "Request body must be a JSON object", "dict_type")] };
  }

  const details = [];
  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) {
      details.push(makeDetail(["body", key], "Extra inputs are not permitted", "extra_forbidden"));
    }
  }

  let title;
  if (body.title === undefined) {
    details.push(makeDetail(["body", "title"], "Field required", "missing"));
  } else if (typeof body.title !== "string") {
    details.push(makeDetail(["body", "title"], "Input should be a valid string", "string_type"));
  } else {
    title = body.title.trim();
    if (!title) {
      details.push(makeDetail(["body", "title"], "A case title is required.", "string_too_short"));
    } else if (title.length > 200) {
      details.push(makeDetail(["body", "title"], "String should have at most 200 characters", "string_too_long"));
    }
  }

  const description = normalizeOptionalString(body.description, "description", 10000, details);
  const rawAssignedTo = body.assignedTo !== undefined ? body.assignedTo : body.assigned_to;
  const assignedTo = normalizeOptionalString(rawAssignedTo, "assignedTo", 160, details);
  const rawReporterName = body.reporterName !== undefined ? body.reporterName : body.reporter_name;
  const reporterName = normalizeOptionalString(rawReporterName, "reporterName", 160, details);

  let status = "OPEN";
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !CASE_STATUSES.has(body.status.trim())) {
      details.push(makeDetail(["body", "status"], "Invalid case status.", "enum"));
    } else {
      status = body.status.trim();
    }
  }

  let severity = "MEDIUM";
  if (body.severity !== undefined) {
    if (typeof body.severity !== "string" || !CASE_SEVERITIES.has(body.severity.trim())) {
      details.push(makeDetail(["body", "severity"], "Invalid case severity.", "enum"));
    } else {
      severity = body.severity.trim();
    }
  }

  if (details.length > 0) {
    return { errors: details };
  }

  return {
    data: {
      title,
      description: description ?? null,
      status,
      severity,
      assignedTo: assignedTo ?? null,
      reporterName: reporterName ?? null,
    },
  };
}

function parseUpdatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [makeDetail(["body"], "Request body must be a JSON object", "dict_type")] };
  }

  const keys = Object.keys(body);
  const details = [];
  for (const key of keys) {
    if (!CREATE_FIELDS.has(key)) {
      details.push(makeDetail(["body", key], "Extra inputs are not permitted", "extra_forbidden"));
    }
  }

  if (keys.length === 0) {
    details.push(makeDetail(["body"], "At least one case field must be provided.", "value_error"));
  }

  const updates = {};

  if ("title" in body) {
    if (body.title === null) {
      details.push(makeDetail(["body", "title"], "Title cannot be null.", "value_error"));
    } else if (typeof body.title !== "string") {
      details.push(makeDetail(["body", "title"], "Input should be a valid string", "string_type"));
    } else {
      const trimmed = body.title.trim();
      if (!trimmed) {
        details.push(makeDetail(["body", "title"], "A case title cannot be blank.", "string_too_short"));
      } else if (trimmed.length > 200) {
        details.push(makeDetail(["body", "title"], "String should have at most 200 characters", "string_too_long"));
      } else {
        updates.title = trimmed;
      }
    }
  }

  if ("description" in body) {
    const val = normalizeOptionalString(body.description, "description", 10000, details);
    if (val !== undefined) updates.description = val;
  }

  if ("assignedTo" in body || "assigned_to" in body) {
    const raw = "assignedTo" in body ? body.assignedTo : body.assigned_to;
    const val = normalizeOptionalString(raw, "assignedTo", 160, details);
    if (val !== undefined) updates.assignedTo = val;
  }

  if ("reporterName" in body || "reporter_name" in body) {
    const raw = "reporterName" in body ? body.reporterName : body.reporter_name;
    const val = normalizeOptionalString(raw, "reporterName", 160, details);
    if (val !== undefined) updates.reporterName = val;
  }

  if ("status" in body) {
    if (body.status === null) {
      details.push(makeDetail(["body", "status"], "Status cannot be null.", "value_error"));
    } else if (typeof body.status !== "string" || !CASE_STATUSES.has(body.status.trim())) {
      details.push(makeDetail(["body", "status"], "Invalid case status.", "enum"));
    } else {
      updates.status = body.status.trim();
    }
  }

  if ("severity" in body) {
    if (body.severity === null) {
      details.push(makeDetail(["body", "severity"], "Severity cannot be null.", "value_error"));
    } else if (typeof body.severity !== "string" || !CASE_SEVERITIES.has(body.severity.trim())) {
      details.push(makeDetail(["body", "severity"], "Invalid case severity.", "enum"));
    } else {
      updates.severity = body.severity.trim();
    }
  }

  if (details.length > 0) {
    return { errors: details };
  }

  return { data: updates };
}

function findActiveCase(identifier) {
  const trimmed = String(identifier ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numericId = Number(trimmed);
    return casesStore.find((item) => item.id === numericId && !item.isDeleted) ?? null;
  }
  const upper = trimmed.toUpperCase();
  return casesStore.find((item) => item.caseNumber === upper && !item.isDeleted) ?? null;
}

function serializeCaseDetail(record) {
  const auditHistory = auditLogsStore
    .filter((entry) => entry.caseId === record.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const evidence = evidenceStore.filter((item) => item.caseNumber === record.caseNumber);
  const events = eventsStore
    .filter((item) => item.caseNumber === record.caseNumber)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { ...record, auditHistory, evidence, events };
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(422).json(validationError([makeDetail(["body"], "Invalid JSON payload.", "json_invalid")]));
  }
  return next(err);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/ready", (_req, res) => {
  res.json({ status: "ready", database: "connected" });
});

app.get("/api/v1/dashboard/overview", (req, res) => {
  const actor = req.query.actor || req.get("x-cybertrace-actor");
  res.json(buildDashboardOverview(typeof actor === "string" ? actor : undefined));
});

app.get("/api/v1/cases", (req, res) => {
  const details = [];
  const rawQ = req.query.q;
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  if (q.length > 200) {
    details.push(makeDetail(["query", "q"], "String should have at most 200 characters", "string_too_long"));
  }

  const rawStatus = req.query.status;
  let statusFilter = null;
  if (typeof rawStatus === "string" && rawStatus !== "") {
    if (!CASE_STATUSES.has(rawStatus)) {
      details.push(makeDetail(["query", "status"], "Invalid status filter.", "enum"));
    } else {
      statusFilter = rawStatus;
    }
  }

  const rawSeverity = req.query.severity;
  let severityFilter = null;
  if (typeof rawSeverity === "string" && rawSeverity !== "") {
    if (!CASE_SEVERITIES.has(rawSeverity)) {
      details.push(makeDetail(["query", "severity"], "Invalid severity filter.", "enum"));
    } else {
      severityFilter = rawSeverity;
    }
  }

  const page = req.query.page !== undefined ? Number(req.query.page) : 1;
  const size = req.query.size !== undefined ? Number(req.query.size) : 50;
  const skip = req.query.skip !== undefined ? Number(req.query.skip) : null;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : null;

  if (!Number.isInteger(page) || page < 1) {
    details.push(makeDetail(["query", "page"], "Input should be greater than or equal to 1", "greater_than_equal"));
  }
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    details.push(makeDetail(["query", "size"], "Input should be between 1 and 100", "value_error"));
  }
  if (skip !== null && (!Number.isInteger(skip) || skip < 0)) {
    details.push(makeDetail(["query", "skip"], "Input should be greater than or equal to 0", "greater_than_equal"));
  }
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    details.push(makeDetail(["query", "limit"], "Input should be between 1 and 100", "value_error"));
  }

  if (details.length > 0) {
    return res.status(422).json(validationError(details));
  }

  const effectiveSize = limit !== null ? limit : size;
  const effectiveSkip = skip !== null ? skip : (page - 1) * effectiveSize;
  const term = q.toLowerCase();

  const filtered = casesStore
    .filter((item) => {
      if (item.isDeleted) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (severityFilter && item.severity !== severityFilter) return false;
      if (term) {
        return (
          item.title.toLowerCase().includes(term) ||
          item.caseNumber.toLowerCase().includes(term) ||
          (item.assignedTo || "").toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);

  const items = filtered.slice(effectiveSkip, effectiveSkip + effectiveSize);

  return res.json({
    items,
    total: filtered.length,
    page: Math.floor(effectiveSkip / effectiveSize) + 1,
    size: effectiveSize,
  });
});

app.get("/api/v1/cases/metrics", (_req, res) => {
  const active = casesStore.filter((item) => !item.isDeleted);
  return res.json({
    totalCases: active.length,
    openCases: active.filter((item) => item.status === "OPEN").length,
    criticalCases: active.filter((item) => item.severity === "CRITICAL").length,
    resolvedCases: active.filter((item) => item.status === "RESOLVED").length,
  });
});

app.post("/api/v1/cases", (req, res) => {
  const parsed = parseCreatePayload(req.body);
  if (parsed.errors) {
    return res.status(422).json(validationError(parsed.errors));
  }

  const actor = getActor(req);
  const now = new Date();
  const isoNow = now.toISOString();
  const id = nextCaseRecordId();
  const hexSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  const record = {
    id,
    caseNumber: `CT-${now.getUTCFullYear()}-${hexSuffix}`,
    title: parsed.data.title,
    description: parsed.data.description,
    status: parsed.data.status,
    severity: parsed.data.severity,
    assignedTo: parsed.data.assignedTo,
    reporterName: parsed.data.reporterName,
    isDeleted: false,
    createdAt: isoNow,
    updatedAt: isoNow,
  };

  casesStore.push(record);
  auditLogsStore.push({
    id: nextAuditEntryId(),
    caseId: id,
    caseNumber: record.caseNumber,
    action: "CASE_CREATED",
    actor,
    changesJson: {
      caseNumber: { old: null, new: record.caseNumber },
      title: { old: null, new: record.title },
      status: { old: null, new: record.status },
      severity: { old: null, new: record.severity },
    },
    createdAt: isoNow,
  });

  return res.status(201).json(record);
});

app.get("/api/v1/cases/:caseId", (req, res) => {
  const record = findActiveCase(req.params.caseId);
  if (!record) {
    return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
  }
  return res.json(serializeCaseDetail(record));
});

app.patch("/api/v1/cases/:caseId", (req, res) => {
  const record = findActiveCase(req.params.caseId);
  if (!record) {
    return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
  }

  const parsed = parseUpdatePayload(req.body);
  if (parsed.errors) {
    return res.status(422).json(validationError(parsed.errors));
  }

  const actor = getActor(req);
  const updates = parsed.data;
  const changes = {};
  for (const [field, newValue] of Object.entries(updates)) {
    const oldValue = record[field];
    if (oldValue !== newValue) {
      changes[field] = { old: oldValue, new: newValue };
    }
  }

  if (Object.keys(changes).length === 0) {
    return res.json(serializeCaseDetail(record));
  }

  const statusChanged = "status" in changes;
  for (const field of Object.keys(changes)) {
    record[field] = updates[field];
  }
  const isoNow = new Date().toISOString();
  record.updatedAt = isoNow;

  auditLogsStore.push({
    id: nextAuditEntryId(),
    caseId: record.id,
    caseNumber: record.caseNumber,
    action: statusChanged ? "CASE_STATUS_CHANGED" : "CASE_UPDATED",
    actor,
    changesJson: changes,
    createdAt: isoNow,
  });

  return res.json(serializeCaseDetail(record));
});

app.delete("/api/v1/cases/:caseId", (req, res) => {
  const record = findActiveCase(req.params.caseId);
  if (!record) {
    return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
  }

  if (!record.isDeleted) {
    const actor = getActor(req);
    const isoNow = new Date().toISOString();
    record.isDeleted = true;
    record.updatedAt = isoNow;
    auditLogsStore.push({
      id: nextAuditEntryId(),
      caseId: record.id,
      caseNumber: record.caseNumber,
      action: "CASE_DELETED",
      actor,
      changesJson: { isDeleted: { old: false, new: true } },
      createdAt: isoNow,
    });
  }

  return res.status(204).send();
});

// Evidence Repository, SHA-256 Verification, and Chain of Custody
app.get("/api/v1/evidence", (req, res) => {
  const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim().toUpperCase() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const items = evidenceStore
    .filter((item) => {
      if (caseNumber && item.caseNumber !== caseNumber) return false;
      if (q) {
        return (
          item.id.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.sourceHost.toLowerCase().includes(q) ||
          item.artifactType.toLowerCase().includes(q) ||
          item.expectedSha256.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  res.json({ items, total: items.length });
});

app.post("/api/v1/evidence", (req, res) => {
  const { name, caseNumber, artifactType, sourceHost, sizeBytes, expectedSha256, observedSha256, notes } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(422).json(validationError([makeDetail(["body", "name"], "Evidence name is required.")]));
  }
  const linkedCase = findActiveCase(caseNumber);
  if (!linkedCase) {
    return res.status(422).json(validationError([makeDetail(["body", "caseNumber"], "A valid active case number is required.")]));
  }
  const expected = typeof expectedSha256 === "string" ? expectedSha256.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    return res.status(422).json(validationError([makeDetail(["body", "expectedSha256"], "Expected SHA-256 must be a 64-character hex digest.")]));
  }
  const observed = typeof observedSha256 === "string" && observedSha256.trim()
    ? observedSha256.trim().toLowerCase()
    : null;
  if (observed && !/^[a-f0-9]{64}$/.test(observed)) {
    return res.status(422).json(validationError([makeDetail(["body", "observedSha256"], "Observed SHA-256 must be a 64-character hex digest.")]));
  }

  const actor = getActor(req);
  const isoNow = new Date().toISOString();
  const comparisonPerformed = Boolean(observed);
  const sha256Matches = comparisonPerformed ? expected === observed : null;
  const custodyChain = [
    {
      id: nextCustodyEntryId(),
      action: "Collected",
      custodian: actor,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : "Registered in Evidence Repository.",
      timestamp: isoNow,
    },
  ];
  if (comparisonPerformed) {
    custodyChain.push({
      id: nextCustodyEntryId(),
      action: "Verified",
      custodian: actor,
      notes: `Initial SHA-256 comparison ${sha256Matches ? "matched" : "detected mismatch"}.`,
      timestamp: isoNow,
    });
  }

  const record = {
    id: nextEvidenceId(),
    caseNumber: linkedCase.caseNumber,
    name: name.trim(),
    artifactType: typeof artifactType === "string" && artifactType.trim() ? artifactType.trim() : "Log Artifact",
    sourceHost: typeof sourceHost === "string" && sourceHost.trim() ? sourceHost.trim() : "Unspecified host",
    sizeBytes: Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) >= 0 ? Number(sizeBytes) : 0,
    expectedSha256: expected,
    observedSha256: observed,
    comparisonPerformed,
    algorithm: "SHA-256",
    sha256Matches,
    collectedBy: actor,
    collectedAt: isoNow,
    verifiedAt: comparisonPerformed ? isoNow : null,
    custodyChain,
  };

  evidenceStore.unshift(record);
  auditLogsStore.push({
    id: nextAuditEntryId(),
    caseId: linkedCase.id,
    caseNumber: linkedCase.caseNumber,
    action: "EVIDENCE_ADDED",
    actor,
    changesJson: { evidenceId: record.id, name: record.name, expectedSha256: record.expectedSha256 },
    createdAt: isoNow,
  });

  res.status(201).json(record);
});

app.post("/api/v1/evidence/:evidenceId/verify", (req, res) => {
  const item = evidenceStore.find((ev) => ev.id === req.params.evidenceId);
  if (!item) {
    return res.status(404).json({ error: { code: "not_found", message: "Evidence item not found." } });
  }
  const observed = typeof req.body?.observedSha256 === "string" ? req.body.observedSha256.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(observed)) {
    return res.status(422).json(validationError([makeDetail(["body", "observedSha256"], "Observed SHA-256 must be a 64-character hex digest.")]));
  }

  const actor = getActor(req);
  const isoNow = new Date().toISOString();
  item.observedSha256 = observed;
  item.comparisonPerformed = true;
  item.algorithm = "SHA-256";
  item.sha256Matches = item.expectedSha256 === observed;
  item.verifiedAt = isoNow;
  item.custodyChain.push({
    id: nextCustodyEntryId(),
    action: "Verified",
    custodian: actor,
    notes: item.sha256Matches
      ? "SHA-256 comparison confirmed exact integrity match."
      : "SHA-256 mismatch detected during verification.",
    timestamp: isoNow,
  });

  const linkedCase = findActiveCase(item.caseNumber);
  if (linkedCase) {
    auditLogsStore.push({
      id: nextAuditEntryId(),
      caseId: linkedCase.id,
      caseNumber: linkedCase.caseNumber,
      action: "EVIDENCE_VERIFIED",
      actor,
      changesJson: { evidenceId: item.id, sha256Matches: item.sha256Matches },
      createdAt: isoNow,
    });
  }

  res.json(item);
});

app.post("/api/v1/evidence/:evidenceId/custody", (req, res) => {
  const item = evidenceStore.find((ev) => ev.id === req.params.evidenceId);
  if (!item) {
    return res.status(404).json({ error: { code: "not_found", message: "Evidence item not found." } });
  }
  const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
  const custodian = typeof req.body?.custodian === "string" ? req.body.custodian.trim() : "";
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
  if (!action || !custodian) {
    return res.status(422).json(validationError([makeDetail(["body"], "Custody action and custodian are required.")]));
  }

  const actor = getActor(req);
  const isoNow = new Date().toISOString();
  item.custodyChain.push({
    id: nextCustodyEntryId(),
    action,
    custodian,
    notes: notes || `Transferred to ${custodian}.`,
    timestamp: isoNow,
  });

  const linkedCase = findActiveCase(item.caseNumber);
  if (linkedCase) {
    auditLogsStore.push({
      id: nextAuditEntryId(),
      caseId: linkedCase.id,
      caseNumber: linkedCase.caseNumber,
      action: "CUSTODY_TRANSFERRED",
      actor,
      changesJson: { evidenceId: item.id, action, custodian },
      createdAt: isoNow,
    });
  }

  res.json(item);
});

// Events, Findings, and IOC Correlation
app.get("/api/v1/events", (req, res) => {
  const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim().toUpperCase() : "";
  const recordType = typeof req.query.recordType === "string" ? req.query.recordType.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

  const items = eventsStore
    .filter((item) => {
      if (caseNumber && item.caseNumber !== caseNumber) return false;
      if (recordType && item.recordType !== recordType) return false;
      if (q) {
        const indicatorText = (item.indicators || []).map((i) => i.value).join(" ").toLowerCase();
        return (
          item.description.toLowerCase().includes(q) ||
          item.sourceEvidence.toLowerCase().includes(q) ||
          item.caseNumber.toLowerCase().includes(q) ||
          item.eventType.toLowerCase().includes(q) ||
          indicatorText.includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  res.json({ items, total: items.length });
});

app.post("/api/v1/events", (req, res) => {
  const { caseNumber, eventType, recordType, description, sourceEvidence, analysisStatus, indicators } = req.body || {};
  const linkedCase = findActiveCase(caseNumber);
  if (!linkedCase) {
    return res.status(422).json(validationError([makeDetail(["body", "caseNumber"], "A valid active case number is required.")]));
  }
  if (typeof description !== "string" || !description.trim()) {
    return res.status(422).json(validationError([makeDetail(["body", "description"], "Event description is required.")]));
  }

  const actor = getActor(req);
  const isoNow = new Date().toISOString();
  const normalizedIndicators = Array.isArray(indicators)
    ? indicators
        .filter((i) => i && typeof i.type === "string" && typeof i.value === "string" && i.value.trim())
        .map((i) => ({ type: i.type.trim().toLowerCase(), value: i.value.trim() }))
    : [];

  const record = {
    id: nextEventId(),
    caseNumber: linkedCase.caseNumber,
    occurredAt: isoNow,
    eventType: typeof eventType === "string" && eventType.trim() ? eventType.trim() : "Investigation update",
    recordType: recordType === "Analytical finding" ? "Analytical finding" : "Recorded fact",
    description: description.trim(),
    sourceEvidence: typeof sourceEvidence === "string" && sourceEvidence.trim() ? sourceEvidence.trim() : "Manual analyst entry",
    analysisStatus: typeof analysisStatus === "string" && analysisStatus.trim() ? analysisStatus.trim() : "Pending review",
    indicators: normalizedIndicators,
  };

  eventsStore.unshift(record);
  auditLogsStore.push({
    id: nextAuditEntryId(),
    caseId: linkedCase.id,
    caseNumber: linkedCase.caseNumber,
    action: "EVENT_LOGGED",
    actor,
    changesJson: { eventId: record.id, eventType: record.eventType, recordType: record.recordType },
    createdAt: isoNow,
  });

  res.status(201).json(record);
});

app.patch("/api/v1/events/:eventId", (req, res) => {
  const item = eventsStore.find((ev) => ev.id === req.params.eventId);
  if (!item) {
    return res.status(404).json({ error: { code: "not_found", message: "Event not found." } });
  }
  const { analysisStatus, recordType } = req.body || {};
  if (typeof analysisStatus === "string" && analysisStatus.trim()) {
    item.analysisStatus = analysisStatus.trim();
  }
  if (recordType === "Recorded fact" || recordType === "Analytical finding") {
    item.recordType = recordType;
  }
  res.json(item);
});

app.get("/api/v1/iocs", (_req, res) => {
  const map = new Map();
  for (const event of eventsStore) {
    for (const ioc of event.indicators || []) {
      const key = `${ioc.type}:${ioc.value}`;
      const existing = map.get(key) || {
        id: key,
        type: ioc.type,
        value: ioc.value,
        cases: new Set(),
        sources: new Set(),
        occurrences: 0,
        lastSeen: event.occurredAt,
      };
      existing.cases.add(event.caseNumber);
      existing.sources.add(event.sourceEvidence);
      existing.occurrences += 1;
      if (event.occurredAt > existing.lastSeen) existing.lastSeen = event.occurredAt;
      map.set(key, existing);
    }
  }
  const items = Array.from(map.values()).map((entry) => ({
    id: entry.id,
    type: entry.type,
    value: entry.value,
    cases: Array.from(entry.cases),
    sources: Array.from(entry.sources),
    occurrences: entry.occurrences,
    lastSeen: entry.lastSeen,
  }));
  res.json({ items, total: items.length });
});

// Cyber Teams & Investigators
app.get("/api/v1/team", (_req, res) => {
  const activeCases = casesStore.filter((c) => !c.isDeleted);
  const items = teamStore.map((member) => ({
    ...member,
    activeCaseCount: activeCases.filter(
      (c) => c.assignedTo === member.name && c.status !== "RESOLVED" && c.status !== "CLOSED",
    ).length,
  }));
  res.json({ items, total: items.length });
});

app.post("/api/v1/team", (req, res) => {
  const { name, role, team, specialization, status, email } = req.body || {};
  if (typeof name !== "string" || !name.trim() || typeof role !== "string" || !role.trim()) {
    return res.status(422).json(validationError([makeDetail(["body"], "Team member name and role are required.")]));
  }
  const member = {
    id: nextTeamId(),
    name: name.trim(),
    role: role.trim(),
    team: typeof team === "string" && team.trim() ? team.trim() : "Security Operations",
    specialization: typeof specialization === "string" && specialization.trim() ? specialization.trim() : "General DFIR",
    status: typeof status === "string" && status.trim() ? status.trim() : "Active",
    email: typeof email === "string" && email.trim() ? email.trim() : `${name.trim().toLowerCase().replace(/\s+/g, ".")}@cybertrace.local`,
  };
  teamStore.push(member);
  res.status(201).json({ ...member, activeCaseCount: 0 });
});

// Global Audit Logs
app.get("/api/v1/audit-logs", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
  const items = auditLogsStore
    .filter((entry) => {
      if (action && entry.action !== action) return false;
      if (q) {
        return (
          entry.action.toLowerCase().includes(q) ||
          entry.actor.toLowerCase().includes(q) ||
          (entry.caseNumber || "").toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  res.json({ items, total: items.length });
});

// Case Forensic Report
app.get("/api/v1/reports/:caseId", (req, res) => {
  const record = findActiveCase(req.params.caseId);
  if (!record) {
    return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
  }
  const detail = serializeCaseDetail(record);
  res.json({
    generatedAt: new Date().toISOString(),
    case: record,
    evidence: detail.evidence,
    events: detail.events,
    auditHistory: detail.auditHistory,
  });
});

// Gemini AI Investigation Assistant (server-side only)
app.get("/api/v1/assistant/status", (_req, res) => {
  res.json(getAssistantStatus());
});

app.post("/api/v1/assistant/chat", async (req, res) => {
  const { messages, caseId, extraContext } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(422).json(validationError([makeDetail(["body", "messages"], "Messages array is required.")]));
  }

  const actor = getActor(req);
  let contextText = buildAssistantContext(caseId);
  if (typeof extraContext === "string" && extraContext.trim()) {
    contextText += `\n\nAdditional Engineer-Supplied Artifact / Log Context:\n${extraContext.trim().slice(0, 12000)}`;
  }

  let closed = false;
  res.on("close", () => {
    if (!res.writableEnded) {
      closed = true;
    }
  });

  try {
    const stream = await streamAssistantChat({ messages, contextText, actor });
    if (closed) return;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    for await (const chunk of stream) {
      if (closed) break;
      const text = chunk?.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    if (!closed) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (error) {
    const formatted = formatGeminiError(error);
    if (!res.headersSent) {
      return res.status(formatted.status).json({ error: { code: formatted.code, message: formatted.message } });
    }
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/v1/assistant/analyze", async (req, res) => {
  const { mode = "case", input = "", caseId, extraContext } = req.body || {};
  const actor = getActor(req);
  let contextText = buildAssistantContext(caseId);
  if (typeof extraContext === "string" && extraContext.trim()) {
    contextText += `\n\nAdditional Engineer-Supplied Artifact / Log Context:\n${extraContext.trim().slice(0, 12000)}`;
  }

  try {
    const analysis = await analyzeWithAssistant({
      mode,
      input: typeof input === "string" ? input.slice(0, 15000) : "",
      contextText,
      actor,
    });
    res.json({ analysis });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: { code: formatted.code, message: formatted.message } });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "API route not found." } });
});

const indexHtmlPath = path.join(FRONTEND_DIST_DIR, "index.html");
let buildInFlight = null;

function ensureFrontendBuilt() {
  if (fs.existsSync(indexHtmlPath)) return Promise.resolve();
  if (!buildInFlight) {
    buildInFlight = new Promise((resolve, reject) => {
      const child = spawn("npm", ["run", "build:frontend"], {
        cwd: __dirname,
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        buildInFlight = null;
        if (code === 0) resolve();
        else reject(new Error(`Frontend build exited with code ${code}`));
      });
      child.on("error", (err) => {
        buildInFlight = null;
        reject(err);
      });
    });
  }
  return buildInFlight;
}

const staticMiddleware = express.static(FRONTEND_DIST_DIR);

app.use((req, res, next) => {
  ensureFrontendBuilt()
    .then(() => {
      staticMiddleware(req, res, (err) => {
        if (err) return next(err);
        if (req.method === "GET" || req.method === "HEAD") {
          return res.sendFile(indexHtmlPath);
        }
        return next();
      });
    })
    .catch(next);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`CyberTrace server listening on http://0.0.0.0:${port}`);
});
