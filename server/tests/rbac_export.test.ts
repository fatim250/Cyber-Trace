import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasPermission,
  listRolePermissions,
  normalizeRbacRole,
  RBAC_ROLES,
} from "../../src/auth/rbac.ts";
import { buildMispEvent, buildStix21Bundle } from "../../src/services/iocExport.ts";

describe("RBAC Permission Matrix", () => {
  it("grants Admin all four permissions", () => {
    assert.equal(hasPermission("Admin", "read"), true);
    assert.equal(hasPermission("Admin", "write_investigations"), true);
    assert.equal(hasPermission("Admin", "delete_cases"), true);
    assert.equal(hasPermission("Admin", "manage_team"), true);
    assert.equal(listRolePermissions("Admin").length, 4);
  });

  it("allows Lead Investigator to delete cases but not manage team", () => {
    assert.equal(hasPermission("Lead Investigator", "read"), true);
    assert.equal(hasPermission("Lead Investigator", "write_investigations"), true);
    assert.equal(hasPermission("Lead Investigator", "delete_cases"), true);
    assert.equal(hasPermission("Lead Investigator", "manage_team"), false);
  });

  it("allows Analyst to read and write investigations only", () => {
    assert.equal(hasPermission("Analyst", "read"), true);
    assert.equal(hasPermission("Analyst", "write_investigations"), true);
    assert.equal(hasPermission("Analyst", "delete_cases"), false);
    assert.equal(hasPermission("Analyst", "manage_team"), false);
  });

  it("restricts Read-Only Auditor strictly to read permission", () => {
    assert.equal(hasPermission("Read-Only Auditor", "read"), true);
    assert.equal(hasPermission("Read-Only Auditor", "write_investigations"), false);
    assert.equal(hasPermission("Read-Only Auditor", "delete_cases"), false);
    assert.equal(hasPermission("Read-Only Auditor", "manage_team"), false);
  });

  it("rejects unknown roles and normalizes invalid inputs safely", () => {
    assert.equal(hasPermission("SuperRoot", "read"), false);
    assert.equal(hasPermission(undefined, "read"), false);
    assert.equal(normalizeRbacRole("Admin"), "Admin");
    assert.equal(normalizeRbacRole("InvalidRole", "Read-Only Auditor"), "Read-Only Auditor");
    assert.equal(RBAC_ROLES.length, 4);
  });
});

describe("STIX 2.1 & MISP IOC Exporters", () => {
  const sampleIocs = [
    {
      id: "ip:185.220.101.44",
      type: "ip",
      value: "185.220.101.44",
      cases: ["CT-2026-001"],
      sources: ["idp-signins.jsonl"],
      occurrences: 3,
      lastSeen: "2026-11-25T10:00:00.000Z",
    },
    {
      id: "domain:cdn-sync.example.test",
      type: "domain",
      value: "cdn-sync.example.test",
      cases: ["CT-2026-001"],
      sources: ["egress-proxy.log"],
      occurrences: 2,
      lastSeen: "2026-11-25T10:05:00.000Z",
    },
    {
      id: "hash:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      type: "hash",
      value: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      cases: ["CT-2026-002"],
      sources: ["edr-alerts.json"],
      occurrences: 1,
      lastSeen: "2026-11-25T10:10:00.000Z",
    },
    {
      id: "user:svc_backup@corp.local",
      type: "user",
      value: "svc_backup@corp.local",
      cases: ["CT-2026-001"],
      sources: ["idp-signins.jsonl"],
      occurrences: 1,
      lastSeen: "2026-11-25T10:12:00.000Z",
    },
  ];

  it("builds a valid STIX 2.1 bundle with identity and indicator patterns", () => {
    const bundle = buildStix21Bundle(sampleIocs, {
      organizationName: "Acme DFIR",
      caseNumber: "CT-2026-001",
    });

    assert.equal(bundle.type, "bundle");
    assert.equal(bundle.spec_version, "2.1");
    assert.match(bundle.id, /^bundle--/);
    assert.equal(bundle.objects.length, 5);

    const identity = bundle.objects[0] as Record<string, unknown>;
    assert.equal(identity.type, "identity");
    assert.equal(identity.name, "Acme DFIR");

    const ipIndicator = bundle.objects[1] as Record<string, unknown>;
    assert.equal(ipIndicator.pattern, "[ipv4-addr:value = '185.220.101.44']");

    const domainIndicator = bundle.objects[2] as Record<string, unknown>;
    assert.equal(domainIndicator.pattern, "[domain-name:value = 'cdn-sync.example.test']");

    const hashIndicator = bundle.objects[3] as Record<string, unknown>;
    assert.equal(
      hashIndicator.pattern,
      "[file:hashes.'SHA-256' = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']",
    );

    const emailIndicator = bundle.objects[4] as Record<string, unknown>;
    assert.equal(emailIndicator.pattern, "[email-addr:value = 'svc_backup@corp.local']");
  });

  it("builds a valid MISP Event JSON payload with attributes and tags", () => {
    const misp = buildMispEvent(sampleIocs, {
      organizationName: "Acme DFIR",
      caseNumber: "CT-2026-001",
    });

    assert.ok(misp.Event);
    assert.equal(misp.Event.Orgc.name, "Acme DFIR");
    assert.match(misp.Event.info, /CT-2026-001/);
    assert.equal(misp.Event.Attribute.length, 4);
    assert.equal(misp.Event.Attribute[0].type, "ip-dst");
    assert.equal(misp.Event.Attribute[1].type, "domain");
    assert.equal(misp.Event.Attribute[2].type, "sha256");
    assert.equal(misp.Event.Attribute[3].type, "email-src");
    assert.ok(misp.Event.Tag.some((tag) => tag.name === "tlp:amber"));
  });
});
