import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface IndicatorRecord {
  type: string;
  value: string;
}

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  uid: text("uid").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userUid: text("user_uid").references(() => users.uid, { onDelete: "set null" }),
    memberCode: text("member_code").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    rbacRole: text("rbac_role").notNull().default("Analyst"),
    jobTitle: text("job_title").notNull().default("DFIR Analyst"),
    team: text("team").notNull().default("Security Operations"),
    specialization: text("specialization").notNull().default("General DFIR"),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_members_org_email_idx").on(table.organizationId, table.email),
    index("org_members_user_uid_idx").on(table.userUid),
  ],
);

export const cases = pgTable(
  "cases",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseNumber: text("case_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("OPEN"),
    severity: text("severity").notNull().default("MEDIUM"),
    assignedTo: text("assigned_to"),
    reporterName: text("reporter_name"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cases_org_case_number_idx").on(table.organizationId, table.caseNumber),
    index("cases_org_updated_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    evidenceCode: text("evidence_code").notNull(),
    caseId: integer("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    caseNumber: text("case_number").notNull(),
    name: text("name").notNull(),
    artifactType: text("artifact_type").notNull().default("Log Artifact"),
    sourceHost: text("source_host").notNull().default("Unspecified host"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    expectedSha256: text("expected_sha256").notNull(),
    observedSha256: text("observed_sha256"),
    comparisonPerformed: boolean("comparison_performed").notNull().default(false),
    algorithm: text("algorithm").notNull().default("SHA-256"),
    sha256Matches: boolean("sha256_matches"),
    collectedBy: text("collected_by").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("evidence_org_code_idx").on(table.organizationId, table.evidenceCode),
    index("evidence_org_case_idx").on(table.organizationId, table.caseNumber),
  ],
);

export const custodyEntries = pgTable(
  "custody_entries",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    evidenceItemId: integer("evidence_item_id")
      .references(() => evidenceItems.id, { onDelete: "cascade" })
      .notNull(),
    action: text("action").notNull(),
    custodian: text("custodian").notNull(),
    notes: text("notes").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("custody_evidence_idx").on(table.organizationId, table.evidenceItemId)],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    eventCode: text("event_code").notNull(),
    caseId: integer("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    caseNumber: text("case_number").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    eventType: text("event_type").notNull().default("Investigation update"),
    recordType: text("record_type").notNull().default("Recorded fact"),
    description: text("description").notNull(),
    sourceEvidence: text("source_evidence").notNull().default("Manual analyst entry"),
    analysisStatus: text("analysis_status").notNull().default("Pending review"),
    indicators: jsonb("indicators").$type<IndicatorRecord[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("events_org_code_idx").on(table.organizationId, table.eventCode),
    index("events_org_case_idx").on(table.organizationId, table.caseNumber),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    caseId: integer("case_id").references(() => cases.id, { onDelete: "set null" }),
    caseNumber: text("case_number"),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    actorUid: text("actor_uid"),
    changesJson: jsonb("changes_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_org_created_idx").on(table.organizationId, table.createdAt)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  cases: many(cases),
  evidenceItems: many(evidenceItems),
  timelineEvents: many(timelineEvents),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userUid],
    references: [users.uid],
  }),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [cases.organizationId],
    references: [organizations.id],
  }),
  evidenceItems: many(evidenceItems),
  timelineEvents: many(timelineEvents),
  auditLogs: many(auditLogs),
}));

export const evidenceItemsRelations = relations(evidenceItems, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [evidenceItems.organizationId],
    references: [organizations.id],
  }),
  caseRecord: one(cases, {
    fields: [evidenceItems.caseId],
    references: [cases.id],
  }),
  custodyEntries: many(custodyEntries),
}));

export const custodyEntriesRelations = relations(custodyEntries, ({ one }) => ({
  organization: one(organizations, {
    fields: [custodyEntries.organizationId],
    references: [organizations.id],
  }),
  evidenceItem: one(evidenceItems, {
    fields: [custodyEntries.evidenceItemId],
    references: [evidenceItems.id],
  }),
}));

export const timelineEventsRelations = relations(timelineEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [timelineEvents.organizationId],
    references: [organizations.id],
  }),
  caseRecord: one(cases, {
    fields: [timelineEvents.caseId],
    references: [cases.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  caseRecord: one(cases, {
    fields: [auditLogs.caseId],
    references: [cases.id],
  }),
}));
