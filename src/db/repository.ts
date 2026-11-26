import crypto from "node:crypto";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";

import { normalizeRbacRole, type AuthenticatedPrincipal, type RbacRole } from "../auth/rbac.ts";
import { db } from "./index.ts";
import {
  auditLogs,
  cases,
  custodyEntries,
  evidenceItems,
  organizationMembers,
  organizations,
  timelineEvents,
  users,
  type IndicatorRecord,
} from "./schema.ts";

export const CASE_STATUSES = new Set(["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"]);
export const CASE_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export class DomainError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function formatDashboardCaseStatus(status: string): string {
  switch (status) {
    case "IN_PROGRESS":
      return "In Progress";
    case "ESCALATED":
      return "Under Review";
    case "OPEN":
      return "Open";
    case "RESOLVED":
    case "CLOSED":
      return "Closed";
    default:
      return status;
  }
}

function serializeCaseRow(row: typeof cases.$inferSelect) {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    severity: row.severity,
    assignedTo: row.assignedTo,
    reporterName: row.reporterName,
    isDeleted: row.isDeleted,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function serializeEventRow(row: typeof timelineEvents.$inferSelect) {
  return {
    id: row.eventCode,
    caseNumber: row.caseNumber,
    occurredAt: toIso(row.occurredAt),
    eventType: row.eventType,
    recordType: row.recordType,
    description: row.description,
    sourceEvidence: row.sourceEvidence,
    analysisStatus: row.analysisStatus,
    indicators: Array.isArray(row.indicators) ? row.indicators : [],
  };
}

function serializeAuditRow(row: typeof auditLogs.$inferSelect) {
  return {
    id: row.id,
    caseId: row.caseId,
    caseNumber: row.caseNumber,
    action: row.action,
    actor: row.actor,
    actorUid: row.actorUid,
    changesJson: row.changesJson || {},
    createdAt: toIso(row.createdAt),
  };
}

function serializeEvidenceRow(
  row: typeof evidenceItems.$inferSelect,
  chain: Array<typeof custodyEntries.$inferSelect>,
) {
  return {
    id: row.evidenceCode,
    caseNumber: row.caseNumber,
    name: row.name,
    artifactType: row.artifactType,
    sourceHost: row.sourceHost,
    sizeBytes: Number(row.sizeBytes) || 0,
    expectedSha256: row.expectedSha256,
    observedSha256: row.observedSha256,
    comparisonPerformed: row.comparisonPerformed,
    algorithm: row.algorithm,
    sha256Matches: row.sha256Matches,
    collectedBy: row.collectedBy,
    collectedAt: toIso(row.collectedAt),
    verifiedAt: toNullableIso(row.verifiedAt),
    custodyChain: chain.map((c) => ({
      id: c.id,
      action: c.action,
      custodian: c.custodian,
      notes: c.notes,
      timestamp: toIso(c.timestamp),
    })),
  };
}

async function wrapDb<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    console.error("Database query failed:", error);
    throw new Error("Database operation failed. Please try again later.", { cause: error });
  }
}

async function seedNewOrganization(
  orgId: number,
  ownerName: string,
  ownerUid: string,
) {
  const starterMembers = [
    {
      memberCode: "TM-002",
      email: "n.vance@cybertrace.local",
      name: "Nadia Vance",
      rbacRole: "Lead Investigator",
      jobTitle: "Lead DFIR Engineer",
      team: "Digital Forensics",
      specialization: "Identity & Cloud Telemetry",
      status: "Active",
    },
    {
      memberCode: "TM-003",
      email: "m.chen@cybertrace.local",
      name: "Marcus Chen",
      rbacRole: "Analyst",
      jobTitle: "Senior SOC Analyst",
      team: "Threat Detection",
      specialization: "Endpoint & EDR Triage",
      status: "Active",
    },
    {
      memberCode: "TM-004",
      email: "p.nair@cybertrace.local",
      name: "Priya Nair",
      rbacRole: "Lead Investigator",
      jobTitle: "Incident Commander",
      team: "Incident Response",
      specialization: "Containment & Coordination",
      status: "On Call",
    },
    {
      memberCode: "TM-005",
      email: "d.brooks@cybertrace.local",
      name: "Devon Brooks",
      rbacRole: "Read-Only Auditor",
      jobTitle: "Compliance & Threat Auditor",
      team: "Threat Intel",
      specialization: "IOC Governance & Attribution",
      status: "Active",
    },
  ];

  await db
    .insert(organizationMembers)
    .values(
      starterMembers.map((m) => ({
        organizationId: orgId,
        userUid: null,
        ...m,
      })),
    )
    .onConflictDoNothing();

  const caseSeeds = [
    {
      caseNumber: "CT-2026-00000028",
      title: "Identity provider access review",
      description:
        "Review anomalous SSO token issuance from external ASN and verify MFA challenge telemetry across privileged admin sessions.",
      status: "IN_PROGRESS",
      severity: "CRITICAL",
      assignedTo: ownerName,
      reporterName: "Security Operations",
      createdAt: new Date("2026-11-17T09:30:00.000Z"),
      updatedAt: new Date("2026-11-19T13:15:00.000Z"),
    },
    {
      caseNumber: "CT-2026-00000027",
      title: "Endpoint activity examination",
      description:
        "Correlate unsigned PowerShell child-process execution and LSASS read attempts on engineering workstation WS-ENG-042.",
      status: "ESCALATED",
      severity: "HIGH",
      assignedTo: "Marcus Chen",
      reporterName: "Endpoint Monitoring",
      createdAt: new Date("2026-11-12T14:10:00.000Z"),
      updatedAt: new Date("2026-11-18T16:40:00.000Z"),
    },
    {
      caseNumber: "CT-2026-00000026",
      title: "Web server access-log review",
      description:
        "Inspect edge reverse-proxy access logs for credential-stuffing bursts targeting /api/auth/token and verify WAF block coverage.",
      status: "OPEN",
      severity: "MEDIUM",
      assignedTo: "Priya Nair",
      reporterName: "Platform Engineering",
      createdAt: new Date("2026-11-09T08:45:00.000Z"),
      updatedAt: new Date("2026-11-17T11:20:00.000Z"),
    },
    {
      caseNumber: "CT-2026-00000025",
      title: "Removable media examination",
      description:
        "Completed forensic imaging and SHA-256 verification of unauthorized USB storage volume recovered from build lab.",
      status: "RESOLVED",
      severity: "LOW",
      assignedTo: "Nadia Vance",
      reporterName: "Physical Security",
      createdAt: new Date("2026-11-03T10:00:00.000Z"),
      updatedAt: new Date("2026-11-14T15:05:00.000Z"),
    },
  ];

  const insertedCases = await db
    .insert(cases)
    .values(caseSeeds.map((seed) => ({ organizationId: orgId, ...seed })))
    .onConflictDoNothing()
    .returning();

  const caseByNumber = new Map<string, typeof cases.$inferSelect>();
  for (const row of insertedCases) {
    caseByNumber.set(row.caseNumber, row);
  }
  if (caseByNumber.size === 0) return;

  await db.insert(auditLogs).values(
    insertedCases.map((row) => ({
      organizationId: orgId,
      caseId: row.id,
      caseNumber: row.caseNumber,
      action: "CASE_CREATED",
      actor: ownerName,
      actorUid: ownerUid,
      changesJson: {
        caseNumber: { old: null, new: row.caseNumber },
        title: { old: null, new: row.title },
        status: { old: null, new: row.status },
        severity: { old: null, new: row.severity },
      },
      createdAt: row.createdAt,
    })),
  );

  const evidenceSeeds = [
    {
      evidenceCode: "EV-2026-001",
      caseNumber: "CT-2026-00000028",
      name: "idp-auth-2026-11-19.jsonl",
      artifactType: "Authentication Log",
      sourceHost: "idp-edge-01.corp",
      sizeBytes: 4281904,
      expectedSha256: sha256("idp-auth-2026-11-19.jsonl-golden"),
      observedSha256: sha256("idp-auth-2026-11-19.jsonl-golden"),
      comparisonPerformed: true,
      sha256Matches: true,
      collectedBy: ownerName,
      collectedAt: new Date("2026-11-19T13:05:00.000Z"),
      verifiedAt: new Date("2026-11-19T13:10:00.000Z"),
      notes: "Exported read-only from identity audit stream; hash verified after transfer.",
    },
    {
      evidenceCode: "EV-2026-002",
      caseNumber: "CT-2026-00000027",
      name: "ws-eng-042-sysmon.evtx",
      artifactType: "Endpoint Telemetry",
      sourceHost: "WS-ENG-042",
      sizeBytes: 18940210,
      expectedSha256: sha256("ws-eng-042-sysmon.evtx-golden"),
      observedSha256: sha256("ws-eng-042-sysmon.evtx-golden"),
      comparisonPerformed: true,
      sha256Matches: true,
      collectedBy: "Marcus Chen",
      collectedAt: new Date("2026-11-18T16:15:00.000Z"),
      verifiedAt: new Date("2026-11-18T16:25:00.000Z"),
      notes: "Acquired via live EDR forensic collector.",
    },
    {
      evidenceCode: "EV-2026-003",
      caseNumber: "CT-2026-00000027",
      name: "ws-eng-042-memdump.raw",
      artifactType: "Memory Image",
      sourceHost: "WS-ENG-042",
      sizeBytes: 536870912,
      expectedSha256: sha256("ws-eng-042-memdump.raw-golden"),
      observedSha256: null,
      comparisonPerformed: false,
      sha256Matches: null,
      collectedBy: "Marcus Chen",
      collectedAt: new Date("2026-11-18T17:02:00.000Z"),
      verifiedAt: null,
      notes: "Pending secondary SHA-256 verification on forensic vault.",
    },
    {
      evidenceCode: "EV-2026-004",
      caseNumber: "CT-2026-00000026",
      name: "edge-proxy-access-11-17.log",
      artifactType: "Access Log",
      sourceHost: "edge-gw-eu02",
      sizeBytes: 9120450,
      expectedSha256: sha256("edge-proxy-access-11-17.log-golden"),
      observedSha256: sha256("edge-proxy-access-11-17.log-golden"),
      comparisonPerformed: true,
      sha256Matches: true,
      collectedBy: "Priya Nair",
      collectedAt: new Date("2026-11-17T11:00:00.000Z"),
      verifiedAt: new Date("2026-11-17T11:12:00.000Z"),
      notes: "Immutable archive snapshot from ingress proxy.",
    },
  ];

  for (const ev of evidenceSeeds) {
    const linked = caseByNumber.get(ev.caseNumber);
    if (!linked) continue;
    const [inserted] = await db
      .insert(evidenceItems)
      .values({
        organizationId: orgId,
        evidenceCode: ev.evidenceCode,
        caseId: linked.id,
        caseNumber: ev.caseNumber,
        name: ev.name,
        artifactType: ev.artifactType,
        sourceHost: ev.sourceHost,
        sizeBytes: ev.sizeBytes,
        expectedSha256: ev.expectedSha256,
        observedSha256: ev.observedSha256,
        comparisonPerformed: ev.comparisonPerformed,
        algorithm: "SHA-256",
        sha256Matches: ev.sha256Matches,
        collectedBy: ev.collectedBy,
        collectedAt: ev.collectedAt,
        verifiedAt: ev.verifiedAt,
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted) continue;
    const chainRows = [
      {
        organizationId: orgId,
        evidenceItemId: inserted.id,
        action: "Collected",
        custodian: ev.collectedBy,
        notes: ev.notes,
        timestamp: ev.collectedAt,
      },
    ];
    if (ev.comparisonPerformed && ev.verifiedAt) {
      chainRows.push({
        organizationId: orgId,
        evidenceItemId: inserted.id,
        action: "Verified",
        custodian: ev.collectedBy,
        notes: `SHA-256 verification ${ev.sha256Matches ? "passed" : "failed"}.`,
        timestamp: ev.verifiedAt,
      });
    }
    await db.insert(custodyEntries).values(chainRows);
  }

  const eventSeeds: Array<{
    eventCode: string;
    caseNumber: string;
    occurredAt: Date;
    eventType: string;
    recordType: string;
    description: string;
    sourceEvidence: string;
    analysisStatus: string;
    indicators: IndicatorRecord[];
  }> = [
    {
      eventCode: "EVT-0001",
      caseNumber: "CT-2026-00000028",
      occurredAt: new Date("2026-11-19T13:07:00.000Z"),
      eventType: "Authentication",
      recordType: "Analytical finding",
      description:
        "Impossible-travel sign-in sequence detected for principal ops-admin@corp from 185.220.101.44 (AS205100) 9 minutes after Berlin corporate IP.",
      sourceEvidence: "idp-auth-2026-11-19.jsonl",
      analysisStatus: "Requires review",
      indicators: [
        { type: "ip", value: "185.220.101.44" },
        { type: "user", value: "ops-admin@corp" },
      ],
    },
    {
      eventCode: "EVT-0002",
      caseNumber: "CT-2026-00000028",
      occurredAt: new Date("2026-11-19T13:09:00.000Z"),
      eventType: "Authentication",
      recordType: "Recorded fact",
      description:
        "OAuth refresh token grant issued for CLI session app-id 94f1a2c8 without FIDO2 step-up.",
      sourceEvidence: "idp-auth-2026-11-19.jsonl",
      analysisStatus: "Pending review",
      indicators: [{ type: "user", value: "ops-admin@corp" }],
    },
    {
      eventCode: "EVT-0003",
      caseNumber: "CT-2026-00000027",
      occurredAt: new Date("2026-11-18T16:22:00.000Z"),
      eventType: "File access",
      recordType: "Analytical finding",
      description:
        "Encoded PowerShell command attempted outbound beacon to cdn-telemetry-sync.example and accessed credential store handle.",
      sourceEvidence: "ws-eng-042-sysmon.evtx",
      analysisStatus: "Requires review",
      indicators: [
        { type: "domain", value: "cdn-telemetry-sync.example" },
        { type: "ip", value: "198.51.100.77" },
      ],
    },
    {
      eventCode: "EVT-0004",
      caseNumber: "CT-2026-00000027",
      occurredAt: new Date("2026-11-18T16:30:00.000Z"),
      eventType: "Evidence collection",
      recordType: "Recorded fact",
      description:
        "Volatile memory image acquired from WS-ENG-042 and queued for SHA-256 verification.",
      sourceEvidence: "ws-eng-042-memdump.raw",
      analysisStatus: "Reviewed",
      indicators: [],
    },
    {
      eventCode: "EVT-0005",
      caseNumber: "CT-2026-00000026",
      occurredAt: new Date("2026-11-17T11:10:00.000Z"),
      eventType: "Application activity",
      recordType: "Recorded fact",
      description:
        "412 HTTP 401 responses within 90 seconds against /api/auth/token from 203.0.113.19; automated rate limiter triggered.",
      sourceEvidence: "edge-proxy-access-11-17.log",
      analysisStatus: "Reviewed",
      indicators: [{ type: "ip", value: "203.0.113.19" }],
    },
  ];

  const eventValues = eventSeeds
    .map((ev) => {
      const linked = caseByNumber.get(ev.caseNumber);
      if (!linked) return null;
      return {
        organizationId: orgId,
        caseId: linked.id,
        ...ev,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (eventValues.length > 0) {
    await db.insert(timelineEvents).values(eventValues).onConflictDoNothing();
  }
}

export interface CyberTraceRepository {
  syncAuthenticatedUser(input: {
    uid: string;
    email: string;
    displayName: string;
    photoUrl?: string | null;
  }): Promise<AuthenticatedPrincipal>;
  updateOrganization(
    orgId: number,
    name: string,
    actor: AuthenticatedPrincipal,
  ): Promise<{ id: number; name: string; slug: string }>;
  buildDashboardOverview(auth: AuthenticatedPrincipal): Promise<Record<string, unknown>>;
  listCases(
    orgId: number,
    filters: {
      q?: string;
      status?: string | null;
      severity?: string | null;
      skip: number;
      limit: number;
    },
  ): Promise<{ items: ReturnType<typeof serializeCaseRow>[]; total: number; page: number; size: number }>;
  getCaseMetrics(orgId: number): Promise<{
    totalCases: number;
    openCases: number;
    criticalCases: number;
    resolvedCases: number;
  }>;
  createCase(
    orgId: number,
    data: {
      title: string;
      description: string | null;
      status: string;
      severity: string;
      assignedTo: string | null;
      reporterName: string | null;
    },
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeCaseRow>>;
  getCaseDetail(orgId: number, identifier: string): Promise<Record<string, unknown> | null>;
  updateCase(
    orgId: number,
    identifier: string,
    updates: Record<string, string | null>,
    actor: AuthenticatedPrincipal,
  ): Promise<Record<string, unknown> | null>;
  deleteCase(orgId: number, identifier: string, actor: AuthenticatedPrincipal): Promise<boolean>;
  listEvidence(
    orgId: number,
    filters: { caseNumber?: string; q?: string },
  ): Promise<{ items: ReturnType<typeof serializeEvidenceRow>[]; total: number }>;
  createEvidence(
    orgId: number,
    data: {
      name: string;
      caseNumber: string;
      artifactType: string;
      sourceHost: string;
      sizeBytes: number;
      expectedSha256: string;
      observedSha256: string | null;
      notes: string;
    },
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeEvidenceRow>>;
  verifyEvidence(
    orgId: number,
    evidenceCode: string,
    observedSha256: string,
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeEvidenceRow> | null>;
  addCustodyEntry(
    orgId: number,
    evidenceCode: string,
    data: { action: string; custodian: string; notes: string },
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeEvidenceRow> | null>;
  listEvents(
    orgId: number,
    filters: { caseNumber?: string; recordType?: string; q?: string },
  ): Promise<{ items: ReturnType<typeof serializeEventRow>[]; total: number }>;
  createEvent(
    orgId: number,
    data: {
      caseNumber: string;
      eventType: string;
      recordType: string;
      description: string;
      sourceEvidence: string;
      analysisStatus: string;
      indicators: IndicatorRecord[];
    },
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeEventRow>>;
  updateEvent(
    orgId: number,
    eventCode: string,
    data: { analysisStatus?: string; recordType?: string },
    actor: AuthenticatedPrincipal,
  ): Promise<ReturnType<typeof serializeEventRow> | null>;
  listIocs(
    orgId: number,
    filters?: { caseNumber?: string },
  ): Promise<{
    items: Array<{
      id: string;
      type: string;
      value: string;
      cases: string[];
      sources: string[];
      occurrences: number;
      lastSeen: string;
    }>;
    total: number;
  }>;
  listTeam(orgId: number): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
  addTeamMember(
    orgId: number,
    data: {
      name: string;
      role: string;
      rbacRole?: string;
      team: string;
      specialization: string;
      status: string;
      email: string;
    },
    actor: AuthenticatedPrincipal,
  ): Promise<Record<string, unknown>>;
  updateTeamMember(
    orgId: number,
    memberCode: string,
    updates: { rbacRole?: RbacRole; status?: string; jobTitle?: string; team?: string },
    actor: AuthenticatedPrincipal,
  ): Promise<Record<string, unknown> | null>;
  listAuditLogs(
    orgId: number,
    filters: { q?: string; action?: string },
  ): Promise<{ items: ReturnType<typeof serializeAuditRow>[]; total: number }>;
  getCaseReport(orgId: number, identifier: string): Promise<Record<string, unknown> | null>;
  buildAssistantContext(orgId: number, caseId?: string): Promise<string>;
}

async function findActiveCaseRow(orgId: number, identifier: string) {
  const trimmed = String(identifier ?? "").trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numericId = Number(trimmed);
    const [row] = await db
      .select()
      .from(cases)
      .where(and(eq(cases.organizationId, orgId), eq(cases.id, numericId), eq(cases.isDeleted, false)))
      .limit(1);
    return row ?? null;
  }
  const upper = trimmed.toUpperCase();
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.organizationId, orgId), eq(cases.caseNumber, upper), eq(cases.isDeleted, false)))
    .limit(1);
  return row ?? null;
}

async function hydrateEvidenceList(orgId: number, rows: Array<typeof evidenceItems.$inferSelect>) {
  if (rows.length === 0) return [];
  const allCustody = await db
    .select()
    .from(custodyEntries)
    .where(eq(custodyEntries.organizationId, orgId))
    .orderBy(asc(custodyEntries.timestamp), asc(custodyEntries.id));

  const byEvidenceId = new Map<number, Array<typeof custodyEntries.$inferSelect>>();
  for (const entry of allCustody) {
    const list = byEvidenceId.get(entry.evidenceItemId) || [];
    list.push(entry);
    byEvidenceId.set(entry.evidenceItemId, list);
  }

  return rows.map((row) => serializeEvidenceRow(row, byEvidenceId.get(row.id) || []));
}

async function serializeCaseDetailRow(orgId: number, row: typeof cases.$inferSelect) {
  const [auditRows, evRows, eventRows] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.caseId, row.id)))
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
    db
      .select()
      .from(evidenceItems)
      .where(and(eq(evidenceItems.organizationId, orgId), eq(evidenceItems.caseId, row.id)))
      .orderBy(desc(evidenceItems.collectedAt)),
    db
      .select()
      .from(timelineEvents)
      .where(and(eq(timelineEvents.organizationId, orgId), eq(timelineEvents.caseId, row.id)))
      .orderBy(desc(timelineEvents.occurredAt)),
  ]);

  const evidence = await hydrateEvidenceList(orgId, evRows);
  return {
    ...serializeCaseRow(row),
    auditHistory: auditRows.map(serializeAuditRow),
    evidence,
    events: eventRows.map(serializeEventRow),
  };
}

export const pgRepository: CyberTraceRepository = {
  async syncAuthenticatedUser({ uid, email, displayName, photoUrl = null }) {
    return wrapDb(async () => {
      const normalizedEmail = email.trim().toLowerCase();
      const safeName = displayName.trim() || normalizedEmail.split("@")[0] || "Investigator";

      // 1. Upsert user safely under concurrency (per cloudsql-setup skill)
      await db
        .insert(users)
        .values({
          uid,
          email: normalizedEmail,
          displayName: safeName,
          photoUrl,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: normalizedEmail,
            displayName: safeName,
            photoUrl,
            updatedAt: new Date(),
          },
        });

      // 2. Check existing membership by uid
      const existingByUid = await db
        .select({
          member: organizationMembers,
          org: organizations,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(eq(organizationMembers.userUid, uid))
        .orderBy(asc(organizationMembers.id))
        .limit(1);

      if (existingByUid.length > 0) {
        const { member, org } = existingByUid[0];
        return {
          uid,
          email: normalizedEmail,
          displayName: member.name || safeName,
          photoUrl,
          organizationId: org.id,
          organizationName: org.name,
          organizationSlug: org.slug,
          memberId: member.id,
          memberCode: member.memberCode,
          rbacRole: normalizeRbacRole(member.rbacRole, "Analyst"),
          jobTitle: member.jobTitle,
          team: member.team,
        };
      }

      // 3. Check pending invite by email
      const pendingInvite = await db
        .select({
          member: organizationMembers,
          org: organizations,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(
          and(
            ilike(organizationMembers.email, normalizedEmail),
            isNull(organizationMembers.userUid),
          ),
        )
        .orderBy(asc(organizationMembers.id))
        .limit(1);

      if (pendingInvite.length > 0) {
        const { member, org } = pendingInvite[0];
        const [linked] = await db
          .update(organizationMembers)
          .set({
            userUid: uid,
            name: member.name || safeName,
            status: "Active",
            updatedAt: new Date(),
          })
          .where(eq(organizationMembers.id, member.id))
          .returning();

        return {
          uid,
          email: normalizedEmail,
          displayName: linked.name,
          photoUrl,
          organizationId: org.id,
          organizationName: org.name,
          organizationSlug: org.slug,
          memberId: linked.id,
          memberCode: linked.memberCode,
          rbacRole: normalizeRbacRole(linked.rbacRole, "Analyst"),
          jobTitle: linked.jobTitle,
          team: linked.team,
        };
      }

      // 4. First-time user: provision a dedicated isolated organization deterministically by UID
      const orgSlug = `org-${sha256(uid).slice(0, 12)}`;
      const orgName = `${safeName.split(" ")[0]}'s CyberTrace SOC`;

      await db
        .insert(organizations)
        .values({ name: orgName, slug: orgSlug })
        .onConflictDoNothing();

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, orgSlug))
        .limit(1);

      await db
        .insert(organizationMembers)
        .values({
          organizationId: org.id,
          userUid: uid,
          memberCode: "TM-001",
          email: normalizedEmail,
          name: safeName,
          rbacRole: "Admin",
          jobTitle: "SOC Director & Lead Admin",
          team: "Digital Forensics",
          specialization: "Incident Command & Governance",
          status: "Active",
        })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.email],
          set: {
            userUid: uid,
            name: safeName,
            updatedAt: new Date(),
          },
        });

      const [member] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, org.id),
            eq(organizationMembers.userUid, uid),
          ),
        )
        .limit(1);

      // Seed starter cases/evidence/events once for this new tenant
      const existingCaseCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(cases)
        .where(eq(cases.organizationId, org.id));

      if ((existingCaseCount[0]?.count ?? 0) === 0) {
        await seedNewOrganization(org.id, safeName, uid);
      }

      return {
        uid,
        email: normalizedEmail,
        displayName: member.name,
        photoUrl,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        memberId: member.id,
        memberCode: member.memberCode,
        rbacRole: normalizeRbacRole(member.rbacRole, "Admin"),
        jobTitle: member.jobTitle,
        team: member.team,
      };
    });
  },

  async updateOrganization(orgId, name, actor) {
    return wrapDb(async () => {
      const [existing] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      if (!existing) {
        throw new DomainError(404, "not_found", "Organization not found.");
      }
      const [updated] = await db
        .update(organizations)
        .set({ name })
        .where(eq(organizations.id, orgId))
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: null,
        caseNumber: null,
        action: "ORGANIZATION_UPDATED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: { name: { old: existing.name, new: name } },
      });

      return { id: updated.id, name: updated.name, slug: updated.slug };
    });
  },

  async buildDashboardOverview(auth) {
    return wrapDb(async () => {
      const orgId = auth.organizationId;
      const [activeCaseRows, evRows, eventRows] = await Promise.all([
        db
          .select()
          .from(cases)
          .where(and(eq(cases.organizationId, orgId), eq(cases.isDeleted, false)))
          .orderBy(desc(cases.updatedAt), desc(cases.id)),
        db
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.organizationId, orgId))
          .orderBy(desc(evidenceItems.collectedAt)),
        db
          .select()
          .from(timelineEvents)
          .where(eq(timelineEvents.organizationId, orgId))
          .orderBy(desc(timelineEvents.occurredAt)),
      ]);

      const openOrActiveCount = activeCaseRows.filter(
        (item) =>
          item.status === "OPEN" || item.status === "IN_PROGRESS" || item.status === "ESCALATED",
      ).length;

      const findingsRequiringReview = eventRows.filter(
        (item) =>
          item.analysisStatus === "Requires review" || item.analysisStatus === "Pending review",
      ).length;

      const verificationChecks = evRows.map((item) => ({
        evidenceItemId: item.evidenceCode,
        comparisonPerformed: item.comparisonPerformed,
        algorithm: item.algorithm,
        sha256Matches: item.sha256Matches,
        verifiedAt: toNullableIso(item.verifiedAt),
      }));

      const notifications: Array<{ id: string; message: string }> = [];
      for (const item of activeCaseRows) {
        if (item.severity === "CRITICAL" && item.status !== "RESOLVED" && item.status !== "CLOSED") {
          notifications.push({
            id: `notif-case-${item.caseNumber}`,
            message: `${item.caseNumber}: ${item.title} (${item.severity})`,
          });
        }
      }
      const pendingEvidence = evRows.filter((item) => !item.comparisonPerformed);
      if (pendingEvidence.length > 0) {
        notifications.push({
          id: "notif-pending-sha",
          message: `${pendingEvidence.length} evidence item${pendingEvidence.length === 1 ? "" : "s"} awaiting SHA-256 verification.`,
        });
      }

      const authEvents = eventRows.filter((e) => e.eventType === "Authentication").length;
      const fileEvents = eventRows.filter((e) => e.eventType === "File access").length;
      const appEvents = eventRows.filter((e) => e.eventType === "Application activity").length;
      const collectionEvents = eventRows.filter((e) => e.eventType === "Evidence collection").length;

      return {
        currentUser: {
          displayName: auth.displayName,
          role: auth.rbacRole,
          jobTitle: auth.jobTitle,
          email: auth.email,
          organizationName: auth.organizationName,
        },
        currentCaseId: activeCaseRows[0]?.caseNumber ?? "",
        notifications,
        metrics: {
          activeInvestigations: { value: openOrActiveCount },
          evidenceItems: { value: evRows.length },
          eventsAnalyzed: { value: eventRows.length },
          findingsRequiringReview: { value: findingsRequiringReview },
        },
        cases: activeCaseRows.map((item) => ({
          id: item.caseNumber,
          numericId: item.id,
          caseNumber: item.caseNumber,
          title: item.title,
          assignedInvestigator: item.assignedTo || "Unassigned",
          status: formatDashboardCaseStatus(item.status),
          rawStatus: item.status,
          severity: item.severity,
          createdAt: toIso(item.createdAt),
          updatedAt: toIso(item.updatedAt),
        })),
        evidenceIntegrity: {
          totalItems: evRows.length,
          verificationChecks,
        },
        activityEvents: eventRows.map(serializeEventRow),
        analytics: {
          eventVolume: [
            { label: "Nov 13", count: 14 },
            { label: "Nov 14", count: 22 },
            { label: "Nov 15", count: 19 },
            { label: "Nov 16", count: 31 },
            { label: "Nov 17", count: 28 },
            { label: "Nov 18", count: 44 },
            { label: "Nov 19", count: 36 + eventRows.length },
          ],
          authenticationDistribution: [
            { label: "Authentication", count: authEvents },
            { label: "File access", count: fileEvents },
            { label: "Application activity", count: appEvents },
            { label: "Evidence collection", count: collectionEvents },
          ],
          evidenceCollectionTrend: [
            { label: "Nov 14", count: 1 },
            { label: "Nov 15", count: 1 },
            { label: "Nov 17", count: 1 },
            { label: "Nov 18", count: 2 },
            { label: "Nov 19", count: evRows.length },
          ],
        },
        updatedAt: new Date().toISOString(),
      };
    });
  },

  async listCases(orgId, { q = "", status = null, severity = null, skip, limit }) {
    return wrapDb(async () => {
      const rows = await db
        .select()
        .from(cases)
        .where(and(eq(cases.organizationId, orgId), eq(cases.isDeleted, false)))
        .orderBy(desc(cases.updatedAt), desc(cases.id));

      const term = q.trim().toLowerCase();
      const filtered = rows.filter((item) => {
        if (status && item.status !== status) return false;
        if (severity && item.severity !== severity) return false;
        if (term) {
          return (
            item.title.toLowerCase().includes(term) ||
            item.caseNumber.toLowerCase().includes(term) ||
            (item.assignedTo || "").toLowerCase().includes(term)
          );
        }
        return true;
      });

      const sliced = filtered.slice(skip, skip + limit).map(serializeCaseRow);
      return {
        items: sliced,
        total: filtered.length,
        page: Math.floor(skip / limit) + 1,
        size: limit,
      };
    });
  },

  async getCaseMetrics(orgId) {
    return wrapDb(async () => {
      const rows = await db
        .select()
        .from(cases)
        .where(and(eq(cases.organizationId, orgId), eq(cases.isDeleted, false)));

      return {
        totalCases: rows.length,
        openCases: rows.filter((item) => item.status === "OPEN").length,
        criticalCases: rows.filter((item) => item.severity === "CRITICAL").length,
        resolvedCases: rows.filter((item) => item.status === "RESOLVED").length,
      };
    });
  },

  async createCase(orgId, data, actor) {
    return wrapDb(async () => {
      const now = new Date();
      const hexSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
      const caseNumber = `CT-${now.getUTCFullYear()}-${hexSuffix}`;

      const [created] = await db
        .insert(cases)
        .values({
          organizationId: orgId,
          caseNumber,
          title: data.title,
          description: data.description,
          status: data.status,
          severity: data.severity,
          assignedTo: data.assignedTo,
          reporterName: data.reporterName || actor.displayName,
          isDeleted: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: created.id,
        caseNumber: created.caseNumber,
        action: "CASE_CREATED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: {
          caseNumber: { old: null, new: created.caseNumber },
          title: { old: null, new: created.title },
          status: { old: null, new: created.status },
          severity: { old: null, new: created.severity },
        },
        createdAt: now,
      });

      return serializeCaseRow(created);
    });
  },

  async getCaseDetail(orgId, identifier) {
    return wrapDb(async () => {
      const row = await findActiveCaseRow(orgId, identifier);
      if (!row) return null;
      return serializeCaseDetailRow(orgId, row);
    });
  },

  async updateCase(orgId, identifier, updates, actor) {
    return wrapDb(async () => {
      const existing = await findActiveCaseRow(orgId, identifier);
      if (!existing) return null;

      const changes: Record<string, { old: unknown; new: unknown }> = {};
      const patchValues: Partial<typeof cases.$inferInsert> = {};

      for (const [field, newValue] of Object.entries(updates)) {
        const oldValue = (existing as Record<string, unknown>)[field];
        if (oldValue !== newValue) {
          changes[field] = { old: oldValue, new: newValue };
          (patchValues as Record<string, unknown>)[field] = newValue;
        }
      }

      if (Object.keys(changes).length === 0) {
        return serializeCaseDetailRow(orgId, existing);
      }

      const now = new Date();
      patchValues.updatedAt = now;

      const [updated] = await db
        .update(cases)
        .set(patchValues)
        .where(and(eq(cases.organizationId, orgId), eq(cases.id, existing.id)))
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: updated.id,
        caseNumber: updated.caseNumber,
        action: "status" in changes ? "CASE_STATUS_CHANGED" : "CASE_UPDATED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: changes,
        createdAt: now,
      });

      return serializeCaseDetailRow(orgId, updated);
    });
  },

  async deleteCase(orgId, identifier, actor) {
    return wrapDb(async () => {
      const existing = await findActiveCaseRow(orgId, identifier);
      if (!existing) return false;

      const now = new Date();
      await db
        .update(cases)
        .set({ isDeleted: true, updatedAt: now })
        .where(and(eq(cases.organizationId, orgId), eq(cases.id, existing.id)));

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: existing.id,
        caseNumber: existing.caseNumber,
        action: "CASE_DELETED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: { isDeleted: { old: false, new: true } },
        createdAt: now,
      });

      return true;
    });
  },

  async listEvidence(orgId, { caseNumber = "", q = "" }) {
    return wrapDb(async () => {
      const rows = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.organizationId, orgId))
        .orderBy(desc(evidenceItems.collectedAt));

      const cn = caseNumber.trim().toUpperCase();
      const term = q.trim().toLowerCase();
      const filtered = rows.filter((item) => {
        if (cn && item.caseNumber !== cn) return false;
        if (term) {
          return (
            item.evidenceCode.toLowerCase().includes(term) ||
            item.name.toLowerCase().includes(term) ||
            item.sourceHost.toLowerCase().includes(term) ||
            item.artifactType.toLowerCase().includes(term) ||
            item.expectedSha256.toLowerCase().includes(term)
          );
        }
        return true;
      });

      const items = await hydrateEvidenceList(orgId, filtered);
      return { items, total: items.length };
    });
  },

  async createEvidence(orgId, data, actor) {
    return wrapDb(async () => {
      const linkedCase = await findActiveCaseRow(orgId, data.caseNumber);
      if (!linkedCase) {
        throw new DomainError(422, "validation_error", "A valid active case number is required.");
      }

      const now = new Date();
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(evidenceItems)
        .where(eq(evidenceItems.organizationId, orgId));

      const evidenceCode = `EV-${now.getUTCFullYear()}-${String((count || 0) + 1).padStart(3, "0")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const comparisonPerformed = Boolean(data.observedSha256);
      const sha256Matches = comparisonPerformed ? data.expectedSha256 === data.observedSha256 : null;

      const [inserted] = await db
        .insert(evidenceItems)
        .values({
          organizationId: orgId,
          evidenceCode,
          caseId: linkedCase.id,
          caseNumber: linkedCase.caseNumber,
          name: data.name,
          artifactType: data.artifactType,
          sourceHost: data.sourceHost,
          sizeBytes: data.sizeBytes,
          expectedSha256: data.expectedSha256,
          observedSha256: data.observedSha256,
          comparisonPerformed,
          algorithm: "SHA-256",
          sha256Matches,
          collectedBy: actor.displayName,
          collectedAt: now,
          verifiedAt: comparisonPerformed ? now : null,
        })
        .returning();

      const chainValues = [
        {
          organizationId: orgId,
          evidenceItemId: inserted.id,
          action: "Collected",
          custodian: actor.displayName,
          notes: data.notes || "Registered in Evidence Repository.",
          timestamp: now,
        },
      ];
      if (comparisonPerformed) {
        chainValues.push({
          organizationId: orgId,
          evidenceItemId: inserted.id,
          action: "Verified",
          custodian: actor.displayName,
          notes: `Initial SHA-256 comparison ${sha256Matches ? "matched" : "detected mismatch"}.`,
          timestamp: now,
        });
      }

      const insertedChain = await db.insert(custodyEntries).values(chainValues).returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: linkedCase.id,
        caseNumber: linkedCase.caseNumber,
        action: "EVIDENCE_ADDED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: {
          evidenceId: inserted.evidenceCode,
          name: inserted.name,
          expectedSha256: inserted.expectedSha256,
        },
        createdAt: now,
      });

      return serializeEvidenceRow(inserted, insertedChain);
    });
  },

  async verifyEvidence(orgId, evidenceCode, observedSha256, actor) {
    return wrapDb(async () => {
      const [item] = await db
        .select()
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.organizationId, orgId),
            eq(evidenceItems.evidenceCode, evidenceCode),
          ),
        )
        .limit(1);
      if (!item) return null;

      const now = new Date();
      const sha256Matches = item.expectedSha256 === observedSha256;

      const [updated] = await db
        .update(evidenceItems)
        .set({
          observedSha256,
          comparisonPerformed: true,
          algorithm: "SHA-256",
          sha256Matches,
          verifiedAt: now,
        })
        .where(and(eq(evidenceItems.organizationId, orgId), eq(evidenceItems.id, item.id)))
        .returning();

      await db.insert(custodyEntries).values({
        organizationId: orgId,
        evidenceItemId: item.id,
        action: "Verified",
        custodian: actor.displayName,
        notes: sha256Matches
          ? "SHA-256 comparison confirmed exact integrity match."
          : "SHA-256 mismatch detected during verification.",
        timestamp: now,
      });

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: item.caseId,
        caseNumber: item.caseNumber,
        action: "EVIDENCE_VERIFIED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: { evidenceId: item.evidenceCode, sha256Matches },
        createdAt: now,
      });

      const [hydrated] = await hydrateEvidenceList(orgId, [updated]);
      return hydrated;
    });
  },

  async addCustodyEntry(orgId, evidenceCode, { action, custodian, notes }, actor) {
    return wrapDb(async () => {
      const [item] = await db
        .select()
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.organizationId, orgId),
            eq(evidenceItems.evidenceCode, evidenceCode),
          ),
        )
        .limit(1);
      if (!item) return null;

      const now = new Date();
      await db.insert(custodyEntries).values({
        organizationId: orgId,
        evidenceItemId: item.id,
        action,
        custodian,
        notes: notes || `Transferred to ${custodian}.`,
        timestamp: now,
      });

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: item.caseId,
        caseNumber: item.caseNumber,
        action: "CUSTODY_TRANSFERRED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: { evidenceId: item.evidenceCode, action, custodian },
        createdAt: now,
      });

      const [hydrated] = await hydrateEvidenceList(orgId, [item]);
      return hydrated;
    });
  },

  async listEvents(orgId, { caseNumber = "", recordType = "", q = "" }) {
    return wrapDb(async () => {
      const rows = await db
        .select()
        .from(timelineEvents)
        .where(eq(timelineEvents.organizationId, orgId))
        .orderBy(desc(timelineEvents.occurredAt));

      const cn = caseNumber.trim().toUpperCase();
      const rt = recordType.trim();
      const term = q.trim().toLowerCase();

      const filtered = rows.filter((item) => {
        if (cn && item.caseNumber !== cn) return false;
        if (rt && item.recordType !== rt) return false;
        if (term) {
          const indicatorText = (item.indicators || []).map((i) => i.value).join(" ").toLowerCase();
          return (
            item.description.toLowerCase().includes(term) ||
            item.sourceEvidence.toLowerCase().includes(term) ||
            item.caseNumber.toLowerCase().includes(term) ||
            item.eventType.toLowerCase().includes(term) ||
            indicatorText.includes(term)
          );
        }
        return true;
      });

      const items = filtered.map(serializeEventRow);
      return { items, total: items.length };
    });
  },

  async createEvent(orgId, data, actor) {
    return wrapDb(async () => {
      const linkedCase = await findActiveCaseRow(orgId, data.caseNumber);
      if (!linkedCase) {
        throw new DomainError(422, "validation_error", "A valid active case number is required.");
      }

      const now = new Date();
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(timelineEvents)
        .where(eq(timelineEvents.organizationId, orgId));

      const eventCode = `EVT-${String((count || 0) + 1).padStart(4, "0")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

      const [created] = await db
        .insert(timelineEvents)
        .values({
          organizationId: orgId,
          eventCode,
          caseId: linkedCase.id,
          caseNumber: linkedCase.caseNumber,
          occurredAt: now,
          eventType: data.eventType,
          recordType: data.recordType,
          description: data.description,
          sourceEvidence: data.sourceEvidence,
          analysisStatus: data.analysisStatus,
          indicators: data.indicators,
        })
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: linkedCase.id,
        caseNumber: linkedCase.caseNumber,
        action: "EVENT_LOGGED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: {
          eventId: created.eventCode,
          eventType: created.eventType,
          recordType: created.recordType,
        },
        createdAt: now,
      });

      return serializeEventRow(created);
    });
  },

  async updateEvent(orgId, eventCode, data, actor) {
    return wrapDb(async () => {
      const [existing] = await db
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.organizationId, orgId),
            eq(timelineEvents.eventCode, eventCode),
          ),
        )
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof timelineEvents.$inferInsert> = {};
      const changes: Record<string, { old: unknown; new: unknown }> = {};

      if (data.analysisStatus && data.analysisStatus !== existing.analysisStatus) {
        patch.analysisStatus = data.analysisStatus;
        changes.analysisStatus = { old: existing.analysisStatus, new: data.analysisStatus };
      }
      if (data.recordType && data.recordType !== existing.recordType) {
        patch.recordType = data.recordType;
        changes.recordType = { old: existing.recordType, new: data.recordType };
      }

      if (Object.keys(patch).length === 0) {
        return serializeEventRow(existing);
      }

      const [updated] = await db
        .update(timelineEvents)
        .set(patch)
        .where(and(eq(timelineEvents.organizationId, orgId), eq(timelineEvents.id, existing.id)))
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: existing.caseId,
        caseNumber: existing.caseNumber,
        action: "EVENT_UPDATED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: { eventId: existing.eventCode, ...changes },
      });

      return serializeEventRow(updated);
    });
  },

  async listIocs(orgId, filters = {}) {
    return wrapDb(async () => {
      const cn = filters.caseNumber?.trim().toUpperCase() || "";
      const rows = await db
        .select()
        .from(timelineEvents)
        .where(eq(timelineEvents.organizationId, orgId))
        .orderBy(desc(timelineEvents.occurredAt));

      const map = new Map<
        string,
        {
          id: string;
          type: string;
          value: string;
          cases: Set<string>;
          sources: Set<string>;
          occurrences: number;
          lastSeen: string;
        }
      >();

      for (const event of rows) {
        if (cn && event.caseNumber !== cn) continue;
        const occurredAt = toIso(event.occurredAt);
        for (const ioc of event.indicators || []) {
          const key = `${ioc.type}:${ioc.value}`;
          const existing = map.get(key) || {
            id: key,
            type: ioc.type,
            value: ioc.value,
            cases: new Set<string>(),
            sources: new Set<string>(),
            occurrences: 0,
            lastSeen: occurredAt,
          };
          existing.cases.add(event.caseNumber);
          existing.sources.add(event.sourceEvidence);
          existing.occurrences += 1;
          if (occurredAt > existing.lastSeen) existing.lastSeen = occurredAt;
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
      return { items, total: items.length };
    });
  },

  async listTeam(orgId) {
    return wrapDb(async () => {
      const [members, activeCases] = await Promise.all([
        db
          .select()
          .from(organizationMembers)
          .where(eq(organizationMembers.organizationId, orgId))
          .orderBy(asc(organizationMembers.id)),
        db
          .select()
          .from(cases)
          .where(and(eq(cases.organizationId, orgId), eq(cases.isDeleted, false))),
      ]);

      const items = members.map((member) => ({
        id: member.memberCode,
        name: member.name,
        role: member.jobTitle,
        rbacRole: normalizeRbacRole(member.rbacRole, "Analyst"),
        team: member.team,
        specialization: member.specialization,
        status: member.status,
        email: member.email,
        linkedAccount: Boolean(member.userUid),
        activeCaseCount: activeCases.filter(
          (c) => c.assignedTo === member.name && c.status !== "RESOLVED" && c.status !== "CLOSED",
        ).length,
      }));
      return { items, total: items.length };
    });
  },

  async addTeamMember(orgId, data, actor) {
    return wrapDb(async () => {
      const normalizedEmail = data.email.trim().toLowerCase();
      const [existing] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            ilike(organizationMembers.email, normalizedEmail),
          ),
        )
        .limit(1);

      if (existing) {
        throw new DomainError(409, "conflict", "A team member with this email already exists in your organization.");
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, orgId));

      const memberCode = `TM-${String((count || 0) + 1).padStart(3, "0")}`;
      const rbacRole = normalizeRbacRole(data.rbacRole, "Analyst");

      const [inserted] = await db
        .insert(organizationMembers)
        .values({
          organizationId: orgId,
          userUid: null,
          memberCode,
          email: normalizedEmail,
          name: data.name,
          rbacRole,
          jobTitle: data.role,
          team: data.team,
          specialization: data.specialization,
          status: data.status,
        })
        .returning();

      await db.insert(auditLogs).values({
        organizationId: orgId,
        caseId: null,
        caseNumber: null,
        action: "MEMBER_INVITED",
        actor: actor.displayName,
        actorUid: actor.uid,
        changesJson: {
          memberCode: inserted.memberCode,
          email: inserted.email,
          rbacRole: inserted.rbacRole,
        },
      });

      return {
        id: inserted.memberCode,
        name: inserted.name,
        role: inserted.jobTitle,
        rbacRole: inserted.rbacRole,
        team: inserted.team,
        specialization: inserted.specialization,
        status: inserted.status,
        email: inserted.email,
        linkedAccount: false,
        activeCaseCount: 0,
      };
    });
  },

  async updateTeamMember(orgId, memberCode, updates, actor) {
    return wrapDb(async () => {
      const [existing] = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.memberCode, memberCode),
          ),
        )
        .limit(1);
      if (!existing) return null;

      // Prevent an Admin from demoting the last remaining Admin in the org
      if (updates.rbacRole && existing.rbacRole === "Admin" && updates.rbacRole !== "Admin") {
        const admins = await db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, orgId),
              eq(organizationMembers.rbacRole, "Admin"),
            ),
          );
        if (admins.length <= 1) {
          throw new DomainError(
            400,
            "last_admin",
            "Cannot demote the last remaining Admin in this organization.",
          );
        }
      }

      const patch: Partial<typeof organizationMembers.$inferInsert> = {
        updatedAt: new Date(),
      };
      const changes: Record<string, { old: unknown; new: unknown }> = {};

      if (updates.rbacRole && updates.rbacRole !== existing.rbacRole) {
        patch.rbacRole = updates.rbacRole;
        changes.rbacRole = { old: existing.rbacRole, new: updates.rbacRole };
      }
      if (updates.status && updates.status !== existing.status) {
        patch.status = updates.status;
        changes.status = { old: existing.status, new: updates.status };
      }
      if (updates.jobTitle && updates.jobTitle !== existing.jobTitle) {
        patch.jobTitle = updates.jobTitle;
        changes.jobTitle = { old: existing.jobTitle, new: updates.jobTitle };
      }
      if (updates.team && updates.team !== existing.team) {
        patch.team = updates.team;
        changes.team = { old: existing.team, new: updates.team };
      }

      const [updated] = await db
        .update(organizationMembers)
        .set(patch)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.id, existing.id),
          ),
        )
        .returning();

      if (Object.keys(changes).length > 0) {
        await db.insert(auditLogs).values({
          organizationId: orgId,
          caseId: null,
          caseNumber: null,
          action: "MEMBER_ROLE_UPDATED",
          actor: actor.displayName,
          actorUid: actor.uid,
          changesJson: { memberCode: updated.memberCode, email: updated.email, ...changes },
        });
      }

      return {
        id: updated.memberCode,
        name: updated.name,
        role: updated.jobTitle,
        rbacRole: updated.rbacRole,
        team: updated.team,
        specialization: updated.specialization,
        status: updated.status,
        email: updated.email,
        linkedAccount: Boolean(updated.userUid),
      };
    });
  },

  async listAuditLogs(orgId, { q = "", action = "" }) {
    return wrapDb(async () => {
      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, orgId))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));

      const term = q.trim().toLowerCase();
      const filtered = rows.filter((entry) => {
        if (action && entry.action !== action) return false;
        if (term) {
          return (
            entry.action.toLowerCase().includes(term) ||
            entry.actor.toLowerCase().includes(term) ||
            (entry.caseNumber || "").toLowerCase().includes(term)
          );
        }
        return true;
      });

      const items = filtered.map(serializeAuditRow);
      return { items, total: items.length };
    });
  },

  async getCaseReport(orgId, identifier) {
    return wrapDb(async () => {
      const row = await findActiveCaseRow(orgId, identifier);
      if (!row) return null;
      const detail = await serializeCaseDetailRow(orgId, row);
      return {
        generatedAt: new Date().toISOString(),
        case: serializeCaseRow(row),
        evidence: detail.evidence,
        events: detail.events,
        auditHistory: detail.auditHistory,
      };
    });
  },

  async buildAssistantContext(orgId, caseId) {
    return wrapDb(async () => {
      const [activeCaseRows, evRows, eventRows, members] = await Promise.all([
        db
          .select()
          .from(cases)
          .where(and(eq(cases.organizationId, orgId), eq(cases.isDeleted, false)))
          .orderBy(desc(cases.updatedAt)),
        db
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.organizationId, orgId))
          .orderBy(desc(evidenceItems.collectedAt)),
        db
          .select()
          .from(timelineEvents)
          .where(eq(timelineEvents.organizationId, orgId))
          .orderBy(desc(timelineEvents.occurredAt)),
        db
          .select()
          .from(organizationMembers)
          .where(eq(organizationMembers.organizationId, orgId)),
      ]);

      const teamSummary = members.map((m) => ({
        id: m.memberCode,
        name: m.name,
        role: m.jobTitle,
        rbacRole: m.rbacRole,
        team: m.team,
      }));

      if (caseId) {
        const normalized = String(caseId).trim().toUpperCase();
        const match = activeCaseRows.find(
          (item) => item.caseNumber === normalized || String(item.id) === normalized,
        );
        if (match) {
          const detail = await serializeCaseDetailRow(orgId, match);
          return JSON.stringify(
            {
              scope: "single_case",
              case: serializeCaseRow(match),
              evidence: detail.evidence,
              eventsAndFindings: detail.events,
              auditHistory: detail.auditHistory,
              teamMembers: teamSummary,
            },
            null,
            2,
          );
        }
      }

      return JSON.stringify(
        {
          scope: "workspace_overview",
          activeCases: activeCaseRows.map(serializeCaseRow),
          evidenceSummary: evRows.map((ev) => ({
            id: ev.evidenceCode,
            caseNumber: ev.caseNumber,
            name: ev.name,
            artifactType: ev.artifactType,
            sourceHost: ev.sourceHost,
            comparisonPerformed: ev.comparisonPerformed,
            sha256Matches: ev.sha256Matches,
          })),
          recentEventsAndFindings: eventRows.slice(0, 15).map(serializeEventRow),
          teamMembers: teamSummary,
        },
        null,
        2,
      );
    });
  },
};
