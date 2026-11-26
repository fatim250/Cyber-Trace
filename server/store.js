import crypto from "node:crypto";

export const CASE_STATUSES = new Set(["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"]);
export const CASE_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const SYSTEM_ACTOR = "system";

let nextCaseId = 1;
let nextAuditId = 1;
let nextEvidenceNum = 1;
let nextCustodyId = 1;
let nextEventNum = 1;
let nextTeamNum = 1;

export const casesStore = [];
export const auditLogsStore = [];
export const evidenceStore = [];
export const eventsStore = [];
export const teamStore = [];

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function seedWorkspace() {
  const teamSeeds = [
    {
      name: "Nadia Vance",
      role: "Lead DFIR Engineer",
      team: "Digital Forensics",
      specialization: "Identity & Cloud Telemetry",
      status: "Active",
      email: "n.vance@cybertrace.local",
    },
    {
      name: "Marcus Chen",
      role: "Senior SOC Analyst",
      team: "Threat Detection",
      specialization: "Endpoint & EDR Triage",
      status: "Active",
      email: "m.chen@cybertrace.local",
    },
    {
      name: "Priya Nair",
      role: "Incident Commander",
      team: "Incident Response",
      specialization: "Containment & Coordination",
      status: "On Call",
      email: "p.nair@cybertrace.local",
    },
    {
      name: "Devon Brooks",
      role: "Threat Intelligence Analyst",
      team: "Threat Intel",
      specialization: "IOC Correlation & Attribution",
      status: "Active",
      email: "d.brooks@cybertrace.local",
    },
  ];

  for (const member of teamSeeds) {
    teamStore.push({
      id: `TM-${String(nextTeamNum++).padStart(3, "0")}`,
      ...member,
    });
  }

  const caseSeeds = [
    {
      caseNumber: "CT-2026-00000028",
      title: "Identity provider access review",
      description:
        "Review anomalous SSO token issuance from external ASN and verify MFA challenge telemetry across privileged admin sessions.",
      status: "IN_PROGRESS",
      severity: "CRITICAL",
      assignedTo: "Nadia Vance",
      reporterName: "Security Operations",
      createdAt: "2026-11-17T09:30:00.000Z",
      updatedAt: "2026-11-19T13:15:00.000Z",
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
      createdAt: "2026-11-12T14:10:00.000Z",
      updatedAt: "2026-11-18T16:40:00.000Z",
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
      createdAt: "2026-11-09T08:45:00.000Z",
      updatedAt: "2026-11-17T11:20:00.000Z",
    },
    {
      caseNumber: "CT-2026-00000025",
      title: "Removable media examination",
      description:
        "Completed forensic imaging and SHA-256 verification of unauthorized USB storage volume recovered from build lab.",
      status: "RESOLVED",
      severity: "LOW",
      assignedTo: "Devon Brooks",
      reporterName: "Physical Security",
      createdAt: "2026-11-03T10:00:00.000Z",
      updatedAt: "2026-11-14T15:05:00.000Z",
    },
  ];

  for (const seed of caseSeeds) {
    const id = nextCaseId++;
    const record = {
      id,
      caseNumber: seed.caseNumber,
      title: seed.title,
      description: seed.description,
      status: seed.status,
      severity: seed.severity,
      assignedTo: seed.assignedTo,
      reporterName: seed.reporterName,
      isDeleted: false,
      createdAt: seed.createdAt,
      updatedAt: seed.updatedAt,
    };
    casesStore.push(record);
    auditLogsStore.push({
      id: nextAuditId++,
      caseId: id,
      caseNumber: record.caseNumber,
      action: "CASE_CREATED",
      actor: SYSTEM_ACTOR,
      changesJson: {
        caseNumber: { old: null, new: record.caseNumber },
        title: { old: null, new: record.title },
        status: { old: null, new: record.status },
        severity: { old: null, new: record.severity },
      },
      createdAt: seed.createdAt,
    });
  }

  const evidenceSeeds = [
    {
      caseNumber: "CT-2026-00000028",
      name: "idp-auth-2026-11-19.jsonl",
      artifactType: "Authentication Log",
      sourceHost: "idp-edge-01.corp",
      sizeBytes: 4281904,
      expectedSha256: sha256("idp-auth-2026-11-19.jsonl-golden"),
      observedSha256: sha256("idp-auth-2026-11-19.jsonl-golden"),
      comparisonPerformed: true,
      sha256Matches: true,
      collectedBy: "Nadia Vance",
      collectedAt: "2026-11-19T13:05:00.000Z",
      verifiedAt: "2026-11-19T13:10:00.000Z",
      notes: "Exported read-only from identity audit stream; hash verified after transfer.",
    },
    {
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
      collectedAt: "2026-11-18T16:15:00.000Z",
      verifiedAt: "2026-11-18T16:25:00.000Z",
      notes: "Acquired via live EDR forensic collector.",
    },
    {
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
      collectedAt: "2026-11-18T17:02:00.000Z",
      verifiedAt: null,
      notes: "Pending secondary SHA-256 verification on forensic vault.",
    },
    {
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
      collectedAt: "2026-11-17T11:00:00.000Z",
      verifiedAt: "2026-11-17T11:12:00.000Z",
      notes: "Immutable archive snapshot from ingress proxy.",
    },
  ];

  for (const ev of evidenceSeeds) {
    const id = `EV-2026-${String(nextEvidenceNum++).padStart(3, "0")}`;
    const custodyChain = [
      {
        id: nextCustodyId++,
        action: "Collected",
        custodian: ev.collectedBy,
        notes: ev.notes,
        timestamp: ev.collectedAt,
      },
    ];
    if (ev.comparisonPerformed) {
      custodyChain.push({
        id: nextCustodyId++,
        action: "Verified",
        custodian: ev.collectedBy,
        notes: `SHA-256 verification ${ev.sha256Matches ? "passed" : "failed"}.`,
        timestamp: ev.verifiedAt,
      });
    }
    evidenceStore.push({
      id,
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
      custodyChain,
    });
  }

  const eventSeeds = [
    {
      caseNumber: "CT-2026-00000028",
      occurredAt: "2026-11-19T13:07:00.000Z",
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
      caseNumber: "CT-2026-00000028",
      occurredAt: "2026-11-19T13:09:00.000Z",
      eventType: "Authentication",
      recordType: "Recorded fact",
      description: "OAuth refresh token grant issued for CLI session app-id 94f1a2c8 without FIDO2 step-up.",
      sourceEvidence: "idp-auth-2026-11-19.jsonl",
      analysisStatus: "Pending review",
      indicators: [{ type: "user", value: "ops-admin@corp" }],
    },
    {
      caseNumber: "CT-2026-00000027",
      occurredAt: "2026-11-18T16:22:00.000Z",
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
      caseNumber: "CT-2026-00000027",
      occurredAt: "2026-11-18T16:30:00.000Z",
      eventType: "Evidence collection",
      recordType: "Recorded fact",
      description: "Volatile memory image acquired from WS-ENG-042 and queued for SHA-256 verification.",
      sourceEvidence: "ws-eng-042-memdump.raw",
      analysisStatus: "Reviewed",
      indicators: [],
    },
    {
      caseNumber: "CT-2026-00000026",
      occurredAt: "2026-11-17T11:10:00.000Z",
      eventType: "Application activity",
      recordType: "Recorded fact",
      description:
        "412 HTTP 401 responses within 90 seconds against /api/auth/token from 203.0.113.19; automated rate limiter triggered.",
      sourceEvidence: "edge-proxy-access-11-17.log",
      analysisStatus: "Reviewed",
      indicators: [{ type: "ip", value: "203.0.113.19" }],
    },
  ];

  for (const ev of eventSeeds) {
    eventsStore.push({
      id: `EVT-${String(nextEventNum++).padStart(4, "0")}`,
      ...ev,
    });
  }
}

seedWorkspace();

export function nextEvidenceId() {
  return `EV-2026-${String(nextEvidenceNum++).padStart(3, "0")}`;
}

export function nextCustodyEntryId() {
  return nextCustodyId++;
}

export function nextEventId() {
  return `EVT-${String(nextEventNum++).padStart(4, "0")}`;
}

export function nextTeamId() {
  return `TM-${String(nextTeamNum++).padStart(3, "0")}`;
}

export function nextAuditEntryId() {
  return nextAuditId++;
}

export function nextCaseRecordId() {
  return nextCaseId++;
}

export function formatDashboardCaseStatus(status) {
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

export function buildDashboardOverview(actorName = "Nadia Vance") {
  const activeCases = casesStore
    .filter((item) => !item.isDeleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);

  const openOrActiveCount = activeCases.filter(
    (item) => item.status === "OPEN" || item.status === "IN_PROGRESS" || item.status === "ESCALATED",
  ).length;

  const findingsRequiringReview = eventsStore.filter(
    (item) => item.analysisStatus === "Requires review" || item.analysisStatus === "Pending review",
  ).length;

  const verificationChecks = evidenceStore.map((item) => ({
    evidenceItemId: item.id,
    comparisonPerformed: item.comparisonPerformed,
    algorithm: item.algorithm,
    sha256Matches: item.sha256Matches,
    verifiedAt: item.verifiedAt,
  }));

  const sortedEvents = [...eventsStore].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const notifications = [];
  for (const item of activeCases) {
    if (item.severity === "CRITICAL" && item.status !== "RESOLVED" && item.status !== "CLOSED") {
      notifications.push({
        id: `notif-case-${item.caseNumber}`,
        message: `${item.caseNumber}: ${item.title} (${item.severity})`,
      });
    }
  }
  const pendingEvidence = evidenceStore.filter((item) => !item.comparisonPerformed);
  if (pendingEvidence.length > 0) {
    notifications.push({
      id: "notif-pending-sha",
      message: `${pendingEvidence.length} evidence item${pendingEvidence.length === 1 ? "" : "s"} awaiting SHA-256 verification.`,
    });
  }

  const authEvents = eventsStore.filter((e) => e.eventType === "Authentication").length;
  const fileEvents = eventsStore.filter((e) => e.eventType === "File access").length;
  const appEvents = eventsStore.filter((e) => e.eventType === "Application activity").length;
  const collectionEvents = eventsStore.filter((e) => e.eventType === "Evidence collection").length;

  const activeUser =
    teamStore.find((member) => member.name === actorName) || teamStore[0] || {
      name: "Nadia Vance",
      role: "Lead DFIR Engineer",
    };

  return {
    currentUser: {
      displayName: activeUser.name,
      role: activeUser.role,
    },
    currentCaseId: activeCases[0]?.caseNumber ?? "",
    notifications,
    metrics: {
      activeInvestigations: { value: openOrActiveCount },
      evidenceItems: { value: evidenceStore.length },
      eventsAnalyzed: { value: eventsStore.length },
      findingsRequiringReview: { value: findingsRequiringReview },
    },
    cases: activeCases.map((item) => ({
      id: item.caseNumber,
      numericId: item.id,
      caseNumber: item.caseNumber,
      title: item.title,
      assignedInvestigator: item.assignedTo || "Unassigned",
      status: formatDashboardCaseStatus(item.status),
      rawStatus: item.status,
      severity: item.severity,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    evidenceIntegrity: {
      totalItems: evidenceStore.length,
      verificationChecks,
    },
    activityEvents: sortedEvents,
    analytics: {
      eventVolume: [
        { label: "Nov 13", count: 14 },
        { label: "Nov 14", count: 22 },
        { label: "Nov 15", count: 19 },
        { label: "Nov 16", count: 31 },
        { label: "Nov 17", count: 28 },
        { label: "Nov 18", count: 44 },
        { label: "Nov 19", count: 36 + eventsStore.length },
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
        { label: "Nov 19", count: evidenceStore.length },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
}

export function buildAssistantContext(caseId) {
  const activeCases = casesStore.filter((item) => !item.isDeleted);
  if (caseId) {
    const normalized = String(caseId).trim().toUpperCase();
    const match = activeCases.find(
      (item) => item.caseNumber === normalized || String(item.id) === normalized,
    );
    if (match) {
      const linkedEvidence = evidenceStore.filter((ev) => ev.caseNumber === match.caseNumber);
      const linkedEvents = eventsStore.filter((ev) => ev.caseNumber === match.caseNumber);
      const linkedAudits = auditLogsStore.filter((au) => au.caseId === match.id);
      return JSON.stringify(
        {
          scope: "single_case",
          case: match,
          evidence: linkedEvidence,
          eventsAndFindings: linkedEvents,
          auditHistory: linkedAudits,
          teamMembers: teamStore,
        },
        null,
        2,
      );
    }
  }

  return JSON.stringify(
    {
      scope: "workspace_overview",
      activeCases,
      evidenceSummary: evidenceStore.map((ev) => ({
        id: ev.id,
        caseNumber: ev.caseNumber,
        name: ev.name,
        artifactType: ev.artifactType,
        sourceHost: ev.sourceHost,
        comparisonPerformed: ev.comparisonPerformed,
        sha256Matches: ev.sha256Matches,
      })),
      recentEventsAndFindings: eventsStore.slice(0, 15),
      teamMembers: teamStore,
    },
    null,
    2,
  );
}
