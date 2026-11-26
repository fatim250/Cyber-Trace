import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { createApp } from "../../src/app.ts";
import type { AuthenticatedPrincipal, RbacRole } from "../../src/auth/rbac.ts";
import { DomainError, type CyberTraceRepository } from "../../src/db/repository.ts";
import type { TokenVerifier } from "../../src/middleware/auth.ts";

interface MockCase {
  id: number;
  organizationId: number;
  caseNumber: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  assignedTo: string | null;
  reporterName: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MockEvent {
  organizationId: number;
  id: string;
  caseNumber: string;
  occurredAt: string;
  eventType: string;
  recordType: string;
  description: string;
  sourceEvidence: string;
  analysisStatus: string;
  indicators: Array<{ type: string; value: string }>;
}

interface MockMember {
  organizationId: number;
  id: string;
  memberCode: string;
  name: string;
  email: string;
  rbacRole: RbacRole;
  role: string;
  team: string;
  specialization: string;
  status: string;
}

function createInMemoryRepository() {
  const orgNames = new Map<number, { id: number; name: string; slug: string }>([
    [1, { id: 1, name: "Alpha Security", slug: "alpha-security" }],
    [2, { id: 2, name: "Beta Forensics", slug: "beta-forensics" }],
  ]);

  const principals = new Map<string, AuthenticatedPrincipal>([
    [
      "uid-admin-a",
      {
        uid: "uid-admin-a",
        email: "admin@alpha.test",
        displayName: "Alice Admin",
        photoUrl: null,
        organizationId: 1,
        organizationName: "Alpha Security",
        organizationSlug: "alpha-security",
        memberId: 1,
        memberCode: "TM-001",
        rbacRole: "Admin",
        jobTitle: "SOC Director",
        team: "Incident Command",
      },
    ],
    [
      "uid-lead-a",
      {
        uid: "uid-lead-a",
        email: "lead@alpha.test",
        displayName: "Liam Lead",
        photoUrl: null,
        organizationId: 1,
        organizationName: "Alpha Security",
        organizationSlug: "alpha-security",
        memberId: 2,
        memberCode: "TM-002",
        rbacRole: "Lead Investigator",
        jobTitle: "Lead DFIR",
        team: "Digital Forensics",
      },
    ],
    [
      "uid-analyst-a",
      {
        uid: "uid-analyst-a",
        email: "analyst@alpha.test",
        displayName: "Aria Analyst",
        photoUrl: null,
        organizationId: 1,
        organizationName: "Alpha Security",
        organizationSlug: "alpha-security",
        memberId: 3,
        memberCode: "TM-003",
        rbacRole: "Analyst",
        jobTitle: "Forensic Analyst",
        team: "Threat Intel",
      },
    ],
    [
      "uid-auditor-a",
      {
        uid: "uid-auditor-a",
        email: "auditor@alpha.test",
        displayName: "Owen Auditor",
        photoUrl: null,
        organizationId: 1,
        organizationName: "Alpha Security",
        organizationSlug: "alpha-security",
        memberId: 4,
        memberCode: "TM-004",
        rbacRole: "Read-Only Auditor",
        jobTitle: "Compliance Auditor",
        team: "Governance",
      },
    ],
    [
      "uid-admin-b",
      {
        uid: "uid-admin-b",
        email: "admin@beta.test",
        displayName: "Bryn Beta",
        photoUrl: null,
        organizationId: 2,
        organizationName: "Beta Forensics",
        organizationSlug: "beta-forensics",
        memberId: 5,
        memberCode: "TM-001",
        rbacRole: "Admin",
        jobTitle: "DFIR Lead",
        team: "Incident Command",
      },
    ],
  ]);

  let nextCaseId = 1;
  let nextEventSeq = 1;
  let nextMemberSeq = 10;

  const caseRows: MockCase[] = [];
  const eventRows: MockEvent[] = [];
  const teamRows: MockMember[] = [
    {
      organizationId: 1,
      id: "TM-001",
      memberCode: "TM-001",
      name: "Alice Admin",
      email: "admin@alpha.test",
      rbacRole: "Admin",
      role: "SOC Director",
      team: "Incident Command",
      specialization: "IR Governance",
      status: "Active",
    },
    {
      organizationId: 1,
      id: "TM-003",
      memberCode: "TM-003",
      name: "Aria Analyst",
      email: "analyst@alpha.test",
      rbacRole: "Analyst",
      role: "Forensic Analyst",
      team: "Threat Intel",
      specialization: "Log Analysis",
      status: "Active",
    },
  ];

  const repo: CyberTraceRepository = {
    async syncAuthenticatedUser(input) {
      const found = principals.get(input.uid);
      if (!found) {
        throw new DomainError(401, "unauthorized", "Unknown test user.");
      }
      const org = orgNames.get(found.organizationId)!;
      return { ...found, organizationName: org.name, organizationSlug: org.slug };
    },

    async updateOrganization(orgId, name) {
      const org = orgNames.get(orgId);
      if (!org) throw new DomainError(404, "not_found", "Organization not found.");
      org.name = name;
      return { ...org };
    },

    async buildDashboardOverview(auth) {
      const orgCases = caseRows.filter((c) => c.organizationId === auth.organizationId && !c.isDeleted);
      return {
        organization: { id: auth.organizationId, name: auth.organizationName, slug: auth.organizationSlug },
        metrics: {
          activeCases: orgCases.length,
          evidenceItems: 0,
          timelineEvents: eventRows.filter((e) => e.organizationId === auth.organizationId).length,
          openAlerts: 0,
        },
        cases: orgCases,
      };
    },

    async listCases(orgId, filters) {
      const filtered = caseRows.filter((c) => {
        if (c.organizationId !== orgId || c.isDeleted) return false;
        if (filters.status && c.status !== filters.status) return false;
        if (filters.severity && c.severity !== filters.severity) return false;
        if (filters.q) {
          const needle = filters.q.toLowerCase();
          if (!c.title.toLowerCase().includes(needle) && !c.caseNumber.toLowerCase().includes(needle)) {
            return false;
          }
        }
        return true;
      });
      const items = filtered.slice(filters.skip, filters.skip + filters.limit).map(({ organizationId: _o, ...rest }) => rest);
      return { items, total: filtered.length, page: 1, size: filters.limit };
    },

    async getCaseMetrics(orgId) {
      const orgCases = caseRows.filter((c) => c.organizationId === orgId && !c.isDeleted);
      return {
        totalCases: orgCases.length,
        openCases: orgCases.filter((c) => c.status === "OPEN").length,
        criticalCases: orgCases.filter((c) => c.severity === "CRITICAL").length,
        resolvedCases: orgCases.filter((c) => c.status === "RESOLVED" || c.status === "CLOSED").length,
      };
    },

    async createCase(orgId, data, actor) {
      const id = nextCaseId++;
      const now = new Date().toISOString();
      const row: MockCase = {
        id,
        organizationId: orgId,
        caseNumber: `CT-2026-${String(id).padStart(3, "0")}`,
        title: data.title,
        description: data.description,
        status: data.status,
        severity: data.severity,
        assignedTo: data.assignedTo || actor.displayName,
        reporterName: data.reporterName || actor.displayName,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      };
      caseRows.push(row);
      const { organizationId: _o, ...serialized } = row;
      return serialized;
    },

    async getCaseDetail(orgId, identifier) {
      const found = caseRows.find(
        (c) =>
          c.organizationId === orgId &&
          !c.isDeleted &&
          (String(c.id) === identifier || c.caseNumber.toUpperCase() === identifier.toUpperCase()),
      );
      if (!found) return null;
      const { organizationId: _o, ...serialized } = found;
      return { ...serialized, auditLogs: [], evidence: [], events: [] };
    },

    async updateCase(orgId, identifier, updates) {
      const found = caseRows.find(
        (c) =>
          c.organizationId === orgId &&
          !c.isDeleted &&
          (String(c.id) === identifier || c.caseNumber.toUpperCase() === identifier.toUpperCase()),
      );
      if (!found) return null;
      if (updates.title) found.title = updates.title;
      if (updates.status) found.status = updates.status;
      if (updates.severity) found.severity = updates.severity;
      found.updatedAt = new Date().toISOString();
      const { organizationId: _o, ...serialized } = found;
      return serialized;
    },

    async deleteCase(orgId, identifier) {
      const found = caseRows.find(
        (c) =>
          c.organizationId === orgId &&
          !c.isDeleted &&
          (String(c.id) === identifier || c.caseNumber.toUpperCase() === identifier.toUpperCase()),
      );
      if (!found) return false;
      found.isDeleted = true;
      return true;
    },

    async listEvidence() {
      return { items: [], total: 0 };
    },

    async createEvidence(orgId, data, actor) {
      const now = new Date().toISOString();
      return {
        id: "EV-9001",
        caseNumber: data.caseNumber,
        name: data.name,
        artifactType: data.artifactType,
        sourceHost: data.sourceHost,
        sizeBytes: data.sizeBytes,
        expectedSha256: data.expectedSha256,
        observedSha256: data.observedSha256,
        comparisonPerformed: Boolean(data.observedSha256),
        algorithm: "SHA-256",
        sha256Matches: data.observedSha256 ? data.observedSha256 === data.expectedSha256 : null,
        collectedBy: actor.displayName,
        collectedAt: now,
        verifiedAt: data.observedSha256 ? now : null,
        custodyChain: [],
      };
    },

    async verifyEvidence() {
      return null;
    },

    async addCustodyEntry() {
      return null;
    },

    async listEvents(orgId, filters) {
      const items = eventRows
        .filter((e) => e.organizationId === orgId && (!filters.caseNumber || e.caseNumber === filters.caseNumber))
        .map(({ organizationId: _o, ...rest }) => rest);
      return { items, total: items.length };
    },

    async createEvent(orgId, data) {
      const row: MockEvent = {
        organizationId: orgId,
        id: `EVT-${String(nextEventSeq++).padStart(4, "0")}`,
        caseNumber: data.caseNumber,
        occurredAt: new Date().toISOString(),
        eventType: data.eventType,
        recordType: data.recordType,
        description: data.description,
        sourceEvidence: data.sourceEvidence,
        analysisStatus: data.analysisStatus,
        indicators: data.indicators,
      };
      eventRows.push(row);
      const { organizationId: _o, ...serialized } = row;
      return serialized;
    },

    async updateEvent() {
      return null;
    },

    async listIocs(orgId, filters) {
      const map = new Map<string, { id: string; type: string; value: string; cases: Set<string>; sources: Set<string>; occurrences: number; lastSeen: string }>();
      for (const ev of eventRows) {
        if (ev.organizationId !== orgId) continue;
        if (filters?.caseNumber && ev.caseNumber !== filters.caseNumber) continue;
        for (const ind of ev.indicators) {
          const key = `${ind.type}:${ind.value}`;
          const existing = map.get(key) || {
            id: key,
            type: ind.type,
            value: ind.value,
            cases: new Set<string>(),
            sources: new Set<string>(),
            occurrences: 0,
            lastSeen: ev.occurredAt,
          };
          existing.cases.add(ev.caseNumber);
          existing.sources.add(ev.sourceEvidence);
          existing.occurrences += 1;
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
    },

    async listTeam(orgId) {
      const items = teamRows.filter((m) => m.organizationId === orgId);
      return { items, total: items.length };
    },

    async addTeamMember(orgId, data) {
      const code = `TM-${String(nextMemberSeq++).padStart(3, "0")}`;
      const member: MockMember = {
        organizationId: orgId,
        id: code,
        memberCode: code,
        name: data.name,
        email: data.email,
        rbacRole: (data.rbacRole as RbacRole) || "Analyst",
        role: data.role,
        team: data.team,
        specialization: data.specialization,
        status: data.status,
      };
      teamRows.push(member);
      return { ...member };
    },

    async updateTeamMember(orgId, memberCode, updates) {
      const found = teamRows.find((m) => m.organizationId === orgId && m.memberCode === memberCode);
      if (!found) return null;
      if (updates.rbacRole) found.rbacRole = updates.rbacRole;
      if (updates.status) found.status = updates.status;
      return { ...found };
    },

    async listAuditLogs() {
      return { items: [], total: 0 };
    },

    async getCaseReport() {
      return null;
    },

    async buildAssistantContext() {
      return "Test context";
    },
  };

  return repo;
}

const TOKEN_TO_USER: Record<string, { uid: string; email: string; displayName: string; photoUrl: null }> = {
  "token-admin-a": { uid: "uid-admin-a", email: "admin@alpha.test", displayName: "Alice Admin", photoUrl: null },
  "token-lead-a": { uid: "uid-lead-a", email: "lead@alpha.test", displayName: "Liam Lead", photoUrl: null },
  "token-analyst-a": { uid: "uid-analyst-a", email: "analyst@alpha.test", displayName: "Aria Analyst", photoUrl: null },
  "token-auditor-a": { uid: "uid-auditor-a", email: "auditor@alpha.test", displayName: "Owen Auditor", photoUrl: null },
  "token-admin-b": { uid: "uid-admin-b", email: "admin@beta.test", displayName: "Bryn Beta", photoUrl: null },
};

const mockTokenVerifier: TokenVerifier = async (token: string) => {
  const user = TOKEN_TO_USER[token];
  if (!user) throw new Error("Invalid token");
  return user;
};

describe("CyberTrace API Authentication, Multi-Tenancy, RBAC & IOC Export", () => {
  let server: http.Server;
  let baseUrl = "";

  before(async () => {
    const app = createApp({
      repository: createInMemoryRepository(),
      verifyToken: mockTokenVerifier,
      serveFrontend: false,
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("exposes unauthenticated /health check", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.equal(body.status, "ok");
  });

  it("rejects unauthenticated requests even with spoofed x-cybertrace-actor header", async () => {
    const res = await fetch(`${baseUrl}/api/v1/cases`, {
      headers: { "x-cybertrace-actor": "Alice Admin" },
    });
    assert.equal(res.status, 401);
  });

  it("hydrates verified profile and RBAC permissions via /api/v1/auth/me", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: "Bearer token-admin-a" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      user: { email: string; organizationName: string; rbacRole: string };
      permissions: string[];
    };
    assert.equal(body.user.email, "admin@alpha.test");
    assert.equal(body.user.organizationName, "Alpha Security");
    assert.equal(body.user.rbacRole, "Admin");
    assert.ok(body.permissions.includes("manage_team"));
  });

  it("enforces strict multi-tenant organization isolation across cases and IOCs", async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/cases`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-admin-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Alpha Tenant Intrusion",
        severity: "CRITICAL",
        status: "OPEN",
      }),
    });
    assert.equal(createRes.status, 201);
    const createdCase = (await createRes.json()) as { id: number; caseNumber: string };

    // Add an IOC event in Org A
    const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-analyst-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caseNumber: createdCase.caseNumber,
        eventType: "C2 Beacon",
        recordType: "Recorded fact",
        description: "Outbound beacon detected to 198.51.100.77",
        sourceEvidence: "firewall.log",
        indicators: [{ type: "ip", value: "198.51.100.77" }],
      }),
    });
    assert.equal(eventRes.status, 201);

    // Org B Admin must NOT see Org A's case or IOCs
    const orgBCasesRes = await fetch(`${baseUrl}/api/v1/cases`, {
      headers: { Authorization: "Bearer token-admin-b" },
    });
    assert.equal(orgBCasesRes.status, 200);
    const orgBCases = (await orgBCasesRes.json()) as { total: number };
    assert.equal(orgBCases.total, 0);

    const orgBDetailRes = await fetch(`${baseUrl}/api/v1/cases/${createdCase.caseNumber}`, {
      headers: { Authorization: "Bearer token-admin-b" },
    });
    assert.equal(orgBDetailRes.status, 404);

    const orgBStixRes = await fetch(`${baseUrl}/api/v1/iocs/export?format=stix`, {
      headers: { Authorization: "Bearer token-admin-b" },
    });
    assert.equal(orgBStixRes.status, 200);
    const orgBStix = (await orgBStixRes.json()) as { objects: unknown[] };
    assert.equal(orgBStix.objects.length, 1); // Only identity object, zero Org A IOCs
  });

  it("enforces 4-tier RBAC permissions on write, delete, and admin routes", async () => {
    // Read-Only Auditor cannot create a case
    const auditorCreate = await fetch(`${baseUrl}/api/v1/cases`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-auditor-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Unauthorized Auditor Case" }),
    });
    assert.equal(auditorCreate.status, 403);

    // Read-Only Auditor CAN read cases
    const auditorList = await fetch(`${baseUrl}/api/v1/cases`, {
      headers: { Authorization: "Bearer token-auditor-a" },
    });
    assert.equal(auditorList.status, 200);

    // Analyst can create a case, but CANNOT delete it or invite team members
    const analystCreate = await fetch(`${baseUrl}/api/v1/cases`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-analyst-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Analyst Investigation" }),
    });
    assert.equal(analystCreate.status, 201);
    const created = (await analystCreate.json()) as { id: number };

    const analystDelete = await fetch(`${baseUrl}/api/v1/cases/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer token-analyst-a" },
    });
    assert.equal(analystDelete.status, 403);

    const analystInvite = await fetch(`${baseUrl}/api/v1/team`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-analyst-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Bob", email: "bob@alpha.test", rbacRole: "Analyst" }),
    });
    assert.equal(analystInvite.status, 403);

    // Lead Investigator can delete cases, but CANNOT invite team members
    const leadInvite = await fetch(`${baseUrl}/api/v1/team`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-lead-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Bob", email: "bob@alpha.test", rbacRole: "Analyst" }),
    });
    assert.equal(leadInvite.status, 403);

    const leadDelete = await fetch(`${baseUrl}/api/v1/cases/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer token-lead-a" },
    });
    assert.equal(leadDelete.status, 204);

    // Admin CAN invite team members and rename the organization
    const adminInvite = await fetch(`${baseUrl}/api/v1/team`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token-admin-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Sam Specialist",
        email: "sam@alpha.test",
        rbacRole: "Lead Investigator",
        role: "Malware Analyst",
      }),
    });
    assert.equal(adminInvite.status, 201);

    const adminRename = await fetch(`${baseUrl}/api/v1/organization`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer token-admin-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Alpha DFIR Operations" }),
    });
    assert.equal(adminRename.status, 200);
    const renamed = (await adminRename.json()) as { id: number; name: string; slug: string };
    assert.equal(renamed.name, "Alpha DFIR Operations");
  });

  it("exports STIX 2.1 and MISP bundles with nosniff header", async () => {
    const stixRes = await fetch(`${baseUrl}/api/v1/iocs/export?format=stix`, {
      headers: { Authorization: "Bearer token-auditor-a" },
    });
    assert.equal(stixRes.status, 200);
    assert.equal(stixRes.headers.get("x-content-type-options"), "nosniff");
    const stix = (await stixRes.json()) as { type: string; spec_version: string; objects: unknown[] };
    assert.equal(stix.type, "bundle");
    assert.equal(stix.spec_version, "2.1");
    assert.equal(stix.objects.length, 2); // identity + 1 indicator

    const mispRes = await fetch(`${baseUrl}/api/v1/iocs/export?format=misp`, {
      headers: { Authorization: "Bearer token-auditor-a" },
    });
    assert.equal(mispRes.status, 200);
    assert.equal(mispRes.headers.get("x-content-type-options"), "nosniff");
    const misp = (await mispRes.json()) as { Event: { Attribute: Array<{ value: string }> } };
    assert.equal(misp.Event.Attribute.length, 1);
    assert.equal(misp.Event.Attribute[0].value, "198.51.100.77");
  });
});
