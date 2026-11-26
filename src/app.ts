import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";

import {
  analyzeWithAssistant,
  formatGeminiError,
  getAssistantStatus,
  streamAssistantChat,
} from "../server/assistant.js";
import {
  listRolePermissions,
  RBAC_ROLES,
  RBAC_ROLE_SET,
  requirePermission,
  type RbacRole,
} from "./auth/rbac.ts";
import {
  CASE_SEVERITIES,
  CASE_STATUSES,
  DomainError,
  pgRepository,
  type CyberTraceRepository,
} from "./db/repository.ts";
import {
  createRequireAuth,
  defaultTokenVerifier,
  type AuthenticatedRequest,
  type TokenVerifier,
} from "./middleware/auth.ts";
import { buildMispEvent, buildStix21Bundle } from "./services/iocExport.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIST_DIR = path.join(ROOT_DIR, "frontend", "dist");

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

function makeDetail(loc: string[], message: string, type = "value_error") {
  return { location: loc, message, type };
}

function validationError(details: Array<{ location: string[]; message: string; type: string }>) {
  return {
    error: {
      code: "validation_error",
      message: details[0]?.message || "Request validation failed.",
      details,
    },
  };
}

function normalizeOptionalString(
  value: unknown,
  fieldName: string,
  maxLength: number,
  details: Array<{ location: string[]; message: string; type: string }>,
): string | null | undefined {
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

function parseCreatePayload(body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [makeDetail(["body"], "Request body must be a JSON object", "dict_type")] };
  }

  const details: Array<{ location: string[]; message: string; type: string }> = [];
  for (const key of Object.keys(body)) {
    if (!CREATE_FIELDS.has(key)) {
      details.push(makeDetail(["body", key], "Extra inputs are not permitted", "extra_forbidden"));
    }
  }

  let title = "";
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

function parseUpdatePayload(body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [makeDetail(["body"], "Request body must be a JSON object", "dict_type")] };
  }

  const keys = Object.keys(body);
  const details: Array<{ location: string[]; message: string; type: string }> = [];
  for (const key of keys) {
    if (!CREATE_FIELDS.has(key)) {
      details.push(makeDetail(["body", key], "Extra inputs are not permitted", "extra_forbidden"));
    }
  }

  if (keys.length === 0) {
    details.push(makeDetail(["body"], "At least one case field must be provided.", "value_error"));
  }

  const updates: Record<string, string | null> = {};

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

function handleRouteError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof DomainError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({
    error: { code: "internal_error", message: fallbackMessage },
  });
}

export interface CreateAppOptions {
  repository?: CyberTraceRepository;
  verifyToken?: TokenVerifier;
  serveFrontend?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const repository = options.repository ?? pgRepository;
  const verifyToken = options.verifyToken ?? defaultTokenVerifier;
  const serveFrontend = options.serveFrontend ?? true;

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && (err as { status?: number }).status === 400 && "body" in err) {
      return res
        .status(422)
        .json(validationError([makeDetail(["body"], "Invalid JSON payload.", "json_invalid")]));
    }
    return next(err);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", (_req, res) => {
    res.json({ status: "ready" });
  });

  const requireAuth = createRequireAuth(repository, verifyToken);
  app.use("/api/v1", requireAuth);

  // Authenticated User & Organization Profile
  app.get("/api/v1/auth/me", (req: AuthenticatedRequest, res) => {
    const auth = req.auth!;
    res.json({
      user: auth,
      permissions: listRolePermissions(auth.rbacRole),
      availableRoles: RBAC_ROLES,
    });
  });

  app.patch(
    "/api/v1/organization",
    requirePermission("manage_team"),
    async (req: AuthenticatedRequest, res) => {
      const auth = req.auth!;
      const rawName = req.body?.name;
      if (typeof rawName !== "string" || !rawName.trim() || rawName.trim().length > 120) {
        return res
          .status(422)
          .json(
            validationError([
              makeDetail(["body", "name"], "Organization name must be between 1 and 120 characters."),
            ]),
          );
      }
      try {
        const updated = await repository.updateOrganization(auth.organizationId, rawName.trim(), auth);
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not update organization settings.");
      }
    },
  );

  // Dashboard Overview
  app.get(
    "/api/v1/dashboard/overview",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const overview = await repository.buildDashboardOverview(req.auth!);
        return res.json(overview);
      } catch (error) {
        return handleRouteError(res, error, "Could not load dashboard overview.");
      }
    },
  );

  // Cases CRUD
  app.get(
    "/api/v1/cases",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const details: Array<{ location: string[]; message: string; type: string }> = [];
      const rawQ = req.query.q;
      const q = typeof rawQ === "string" ? rawQ.trim() : "";
      if (q.length > 200) {
        details.push(makeDetail(["query", "q"], "String should have at most 200 characters", "string_too_long"));
      }

      const rawStatus = req.query.status;
      let statusFilter: string | null = null;
      if (typeof rawStatus === "string" && rawStatus !== "") {
        if (!CASE_STATUSES.has(rawStatus)) {
          details.push(makeDetail(["query", "status"], "Invalid status filter.", "enum"));
        } else {
          statusFilter = rawStatus;
        }
      }

      const rawSeverity = req.query.severity;
      let severityFilter: string | null = null;
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

      try {
        const result = await repository.listCases(req.auth!.organizationId, {
          q,
          status: statusFilter,
          severity: severityFilter,
          skip: effectiveSkip,
          limit: effectiveSize,
        });
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not fetch cases.");
      }
    },
  );

  app.get(
    "/api/v1/cases/metrics",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const metrics = await repository.getCaseMetrics(req.auth!.organizationId);
        return res.json(metrics);
      } catch (error) {
        return handleRouteError(res, error, "Could not fetch case metrics.");
      }
    },
  );

  app.post(
    "/api/v1/cases",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const parsed = parseCreatePayload(req.body);
      if (parsed.errors) {
        return res.status(422).json(validationError(parsed.errors));
      }
      try {
        const created = await repository.createCase(req.auth!.organizationId, parsed.data!, req.auth!);
        return res.status(201).json(created);
      } catch (error) {
        return handleRouteError(res, error, "Could not create case.");
      }
    },
  );

  app.get(
    "/api/v1/cases/:caseId",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const detail = await repository.getCaseDetail(req.auth!.organizationId, String(req.params.caseId));
        if (!detail) {
          return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
        }
        return res.json(detail);
      } catch (error) {
        return handleRouteError(res, error, "Could not load case detail.");
      }
    },
  );

  app.patch(
    "/api/v1/cases/:caseId",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const parsed = parseUpdatePayload(req.body);
      if (parsed.errors) {
        return res.status(422).json(validationError(parsed.errors));
      }
      try {
        const updated = await repository.updateCase(
          req.auth!.organizationId,
          String(req.params.caseId),
          parsed.data!,
          req.auth!,
        );
        if (!updated) {
          return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
        }
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not update case.");
      }
    },
  );

  app.delete(
    "/api/v1/cases/:caseId",
    requirePermission("delete_cases"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const deleted = await repository.deleteCase(
          req.auth!.organizationId,
          String(req.params.caseId),
          req.auth!,
        );
        if (!deleted) {
          return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
        }
        return res.status(204).send();
      } catch (error) {
        return handleRouteError(res, error, "Could not delete case.");
      }
    },
  );

  // Evidence Repository, SHA-256 Verification, and Chain of Custody
  app.get(
    "/api/v1/evidence",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim() : "";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      try {
        const result = await repository.listEvidence(req.auth!.organizationId, { caseNumber, q });
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not load evidence items.");
      }
    },
  );

  app.post(
    "/api/v1/evidence",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const { name, caseNumber, artifactType, sourceHost, sizeBytes, expectedSha256, observedSha256, notes } =
        req.body || {};
      if (typeof name !== "string" || !name.trim()) {
        return res.status(422).json(validationError([makeDetail(["body", "name"], "Evidence name is required.")]));
      }
      if (typeof caseNumber !== "string" || !caseNumber.trim()) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "caseNumber"], "A valid active case number is required.")]));
      }
      const expected = typeof expectedSha256 === "string" ? expectedSha256.trim().toLowerCase() : "";
      if (!/^[a-f0-9]{64}$/.test(expected)) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "expectedSha256"], "Expected SHA-256 must be a 64-character hex digest.")]));
      }
      const observed =
        typeof observedSha256 === "string" && observedSha256.trim()
          ? observedSha256.trim().toLowerCase()
          : null;
      if (observed && !/^[a-f0-9]{64}$/.test(observed)) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "observedSha256"], "Observed SHA-256 must be a 64-character hex digest.")]));
      }

      try {
        const record = await repository.createEvidence(
          req.auth!.organizationId,
          {
            name: name.trim(),
            caseNumber: caseNumber.trim(),
            artifactType: typeof artifactType === "string" && artifactType.trim() ? artifactType.trim() : "Log Artifact",
            sourceHost: typeof sourceHost === "string" && sourceHost.trim() ? sourceHost.trim() : "Unspecified host",
            sizeBytes: Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) >= 0 ? Number(sizeBytes) : 0,
            expectedSha256: expected,
            observedSha256: observed,
            notes: typeof notes === "string" ? notes.trim() : "",
          },
          req.auth!,
        );
        return res.status(201).json(record);
      } catch (error) {
        return handleRouteError(res, error, "Could not register evidence item.");
      }
    },
  );

  app.post(
    "/api/v1/evidence/:evidenceId/verify",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const observed =
        typeof req.body?.observedSha256 === "string" ? req.body.observedSha256.trim().toLowerCase() : "";
      if (!/^[a-f0-9]{64}$/.test(observed)) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "observedSha256"], "Observed SHA-256 must be a 64-character hex digest.")]));
      }
      try {
        const updated = await repository.verifyEvidence(
          req.auth!.organizationId,
          String(req.params.evidenceId),
          observed,
          req.auth!,
        );
        if (!updated) {
          return res.status(404).json({ error: { code: "not_found", message: "Evidence item not found." } });
        }
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not verify evidence item.");
      }
    },
  );

  app.post(
    "/api/v1/evidence/:evidenceId/custody",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
      const custodian = typeof req.body?.custodian === "string" ? req.body.custodian.trim() : "";
      const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
      if (!action || !custodian) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body"], "Custody action and custodian are required.")]));
      }
      try {
        const updated = await repository.addCustodyEntry(
          req.auth!.organizationId,
          String(req.params.evidenceId),
          { action, custodian, notes },
          req.auth!,
        );
        if (!updated) {
          return res.status(404).json({ error: { code: "not_found", message: "Evidence item not found." } });
        }
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not record custody entry.");
      }
    },
  );

  // Timeline Events, Findings, and IOC Correlation / Export
  app.get(
    "/api/v1/events",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim() : "";
      const recordType = typeof req.query.recordType === "string" ? req.query.recordType.trim() : "";
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      try {
        const result = await repository.listEvents(req.auth!.organizationId, { caseNumber, recordType, q });
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not load timeline events.");
      }
    },
  );

  app.post(
    "/api/v1/events",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const { caseNumber, eventType, recordType, description, sourceEvidence, analysisStatus, indicators } =
        req.body || {};
      if (typeof caseNumber !== "string" || !caseNumber.trim()) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "caseNumber"], "A valid active case number is required.")]));
      }
      if (typeof description !== "string" || !description.trim()) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "description"], "Event description is required.")]));
      }

      const normalizedIndicators = Array.isArray(indicators)
        ? indicators
            .filter(
              (i: unknown): i is { type: string; value: string } =>
                Boolean(i) &&
                typeof (i as { type?: unknown }).type === "string" &&
                typeof (i as { value?: unknown }).value === "string" &&
                Boolean((i as { value: string }).value.trim()),
            )
            .map((i) => ({ type: i.type.trim().toLowerCase(), value: i.value.trim() }))
        : [];

      try {
        const record = await repository.createEvent(
          req.auth!.organizationId,
          {
            caseNumber: caseNumber.trim(),
            eventType: typeof eventType === "string" && eventType.trim() ? eventType.trim() : "Investigation update",
            recordType: recordType === "Analytical finding" ? "Analytical finding" : "Recorded fact",
            description: description.trim(),
            sourceEvidence:
              typeof sourceEvidence === "string" && sourceEvidence.trim()
                ? sourceEvidence.trim()
                : "Manual analyst entry",
            analysisStatus:
              typeof analysisStatus === "string" && analysisStatus.trim()
                ? analysisStatus.trim()
                : "Pending review",
            indicators: normalizedIndicators,
          },
          req.auth!,
        );
        return res.status(201).json(record);
      } catch (error) {
        return handleRouteError(res, error, "Could not log timeline event.");
      }
    },
  );

  app.patch(
    "/api/v1/events/:eventId",
    requirePermission("write_investigations"),
    async (req: AuthenticatedRequest, res) => {
      const { analysisStatus, recordType } = req.body || {};
      try {
        const updated = await repository.updateEvent(
          req.auth!.organizationId,
          String(req.params.eventId),
          {
            analysisStatus: typeof analysisStatus === "string" && analysisStatus.trim() ? analysisStatus.trim() : undefined,
            recordType:
              recordType === "Recorded fact" || recordType === "Analytical finding"
                ? recordType
                : undefined,
          },
          req.auth!,
        );
        if (!updated) {
          return res.status(404).json({ error: { code: "not_found", message: "Event not found." } });
        }
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not update timeline event.");
      }
    },
  );

  app.get(
    "/api/v1/iocs",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim() : "";
      try {
        const result = await repository.listIocs(req.auth!.organizationId, { caseNumber });
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not load indicators.");
      }
    },
  );

  app.get(
    "/api/v1/iocs/export",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const format = typeof req.query.format === "string" ? req.query.format.trim().toLowerCase() : "stix";
      const caseNumber = typeof req.query.caseNumber === "string" ? req.query.caseNumber.trim().toUpperCase() : "";

      if (format !== "stix" && format !== "misp") {
        return res
          .status(422)
          .json(validationError([makeDetail(["query", "format"], "Supported export formats are 'stix' or 'misp'.")]));
      }

      try {
        const { items } = await repository.listIocs(req.auth!.organizationId, { caseNumber });
        const scopeSlug = caseNumber ? caseNumber.toLowerCase() : "workspace";
        res.setHeader("X-Content-Type-Options", "nosniff");

        if (format === "stix") {
          const bundle = buildStix21Bundle(items, {
            organizationName: req.auth!.organizationName,
            caseNumber: caseNumber || undefined,
          });
          res.setHeader("Content-Type", "application/stix+json; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="cybertrace-${scopeSlug}-stix21.json"`);
          return res.json(bundle);
        }

        const mispEvent = buildMispEvent(items, {
          organizationName: req.auth!.organizationName,
          caseNumber: caseNumber || undefined,
        });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="cybertrace-${scopeSlug}-misp.json"`);
        return res.json(mispEvent);
      } catch (error) {
        return handleRouteError(res, error, "Could not export indicators.");
      }
    },
  );

  // Cyber Teams & RBAC Administration
  app.get(
    "/api/v1/team",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const result = await repository.listTeam(req.auth!.organizationId);
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not load team roster.");
      }
    },
  );

  app.post(
    "/api/v1/team",
    requirePermission("manage_team"),
    async (req: AuthenticatedRequest, res) => {
      const { name, role, rbacRole, team, specialization, status, email } = req.body || {};
      if (typeof name !== "string" || !name.trim() || typeof role !== "string" || !role.trim()) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body"], "Team member name and job title are required.")]));
      }
      if (rbacRole !== undefined && (typeof rbacRole !== "string" || !RBAC_ROLE_SET.has(rbacRole.trim()))) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "rbacRole"], `RBAC role must be one of: ${RBAC_ROLES.join(", ")}.`)]));
      }
      const normalizedEmail =
        typeof email === "string" && email.trim()
          ? email.trim().toLowerCase()
          : `${name.trim().toLowerCase().replace(/\s+/g, ".")}@cybertrace.local`;

      try {
        const created = await repository.addTeamMember(
          req.auth!.organizationId,
          {
            name: name.trim(),
            role: role.trim(),
            rbacRole: typeof rbacRole === "string" ? rbacRole.trim() : "Analyst",
            team: typeof team === "string" && team.trim() ? team.trim() : "Security Operations",
            specialization:
              typeof specialization === "string" && specialization.trim()
                ? specialization.trim()
                : "General DFIR",
            status: typeof status === "string" && status.trim() ? status.trim() : "Active",
            email: normalizedEmail,
          },
          req.auth!,
        );
        return res.status(201).json(created);
      } catch (error) {
        return handleRouteError(res, error, "Could not add team member.");
      }
    },
  );

  app.patch(
    "/api/v1/team/:memberCode",
    requirePermission("manage_team"),
    async (req: AuthenticatedRequest, res) => {
      const { rbacRole, status, role, team } = req.body || {};
      if (rbacRole !== undefined && (typeof rbacRole !== "string" || !RBAC_ROLE_SET.has(rbacRole.trim()))) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "rbacRole"], `RBAC role must be one of: ${RBAC_ROLES.join(", ")}.`)]));
      }

      try {
        const updated = await repository.updateTeamMember(
          req.auth!.organizationId,
          String(req.params.memberCode),
          {
            rbacRole: typeof rbacRole === "string" ? (rbacRole.trim() as RbacRole) : undefined,
            status: typeof status === "string" && status.trim() ? status.trim() : undefined,
            jobTitle: typeof role === "string" && role.trim() ? role.trim() : undefined,
            team: typeof team === "string" && team.trim() ? team.trim() : undefined,
          },
          req.auth!,
        );
        if (!updated) {
          return res.status(404).json({ error: { code: "not_found", message: "Team member not found." } });
        }
        return res.json(updated);
      } catch (error) {
        return handleRouteError(res, error, "Could not update team member.");
      }
    },
  );

  // Global Audit Logs
  app.get(
    "/api/v1/audit-logs",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
      try {
        const result = await repository.listAuditLogs(req.auth!.organizationId, { q, action });
        return res.json(result);
      } catch (error) {
        return handleRouteError(res, error, "Could not load audit logs.");
      }
    },
  );

  // Case Forensic Report
  app.get(
    "/api/v1/reports/:caseId",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const report = await repository.getCaseReport(req.auth!.organizationId, String(req.params.caseId));
        if (!report) {
          return res.status(404).json({ error: { code: "not_found", message: "Case not found." } });
        }
        return res.json(report);
      } catch (error) {
        return handleRouteError(res, error, "Could not generate case report.");
      }
    },
  );

  // Gemini AI Investigation Assistant (server-side only, tenant-scoped)
  app.get("/api/v1/assistant/status", requirePermission("read"), (_req, res) => {
    res.json(getAssistantStatus());
  });

  app.post(
    "/api/v1/assistant/chat",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const { messages, caseId, extraContext } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res
          .status(422)
          .json(validationError([makeDetail(["body", "messages"], "Messages array is required.")]));
      }

      const auth = req.auth!;
      let contextText: string;
      try {
        contextText = await repository.buildAssistantContext(auth.organizationId, caseId);
      } catch (error) {
        return handleRouteError(res, error, "Could not assemble investigation context for AI assistant.");
      }

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
        const stream = await streamAssistantChat({
          messages,
          contextText,
          actor: `${auth.displayName} (${auth.rbacRole})`,
        });
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
    },
  );

  app.post(
    "/api/v1/assistant/analyze",
    requirePermission("read"),
    async (req: AuthenticatedRequest, res) => {
      const { mode = "case", input = "", caseId, extraContext } = req.body || {};
      const auth = req.auth!;
      let contextText: string;
      try {
        contextText = await repository.buildAssistantContext(auth.organizationId, caseId);
      } catch (error) {
        return handleRouteError(res, error, "Could not assemble investigation context for AI triage.");
      }

      if (typeof extraContext === "string" && extraContext.trim()) {
        contextText += `\n\nAdditional Engineer-Supplied Artifact / Log Context:\n${extraContext.trim().slice(0, 12000)}`;
      }

      try {
        const analysis = await analyzeWithAssistant({
          mode,
          input: typeof input === "string" ? input.slice(0, 15000) : "",
          contextText,
          actor: `${auth.displayName} (${auth.rbacRole})`,
        });
        return res.json({ analysis });
      } catch (error) {
        const formatted = formatGeminiError(error);
        return res.status(formatted.status).json({ error: { code: formatted.code, message: formatted.message } });
      }
    },
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "API route not found." } });
  });

  if (serveFrontend) {
    const indexHtmlPath = path.join(FRONTEND_DIST_DIR, "index.html");
    let buildInFlight: Promise<void> | null = null;

    const ensureFrontendBuilt = () => {
      if (fs.existsSync(indexHtmlPath)) return Promise.resolve();
      if (!buildInFlight) {
        buildInFlight = new Promise((resolve, reject) => {
          const child = spawn("npm", ["run", "build:frontend"], {
            cwd: ROOT_DIR,
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
    };

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
  }

  return app;
}
