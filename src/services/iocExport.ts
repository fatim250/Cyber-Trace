import crypto from "node:crypto";

export interface ExportableIoc {
  id: string;
  type: string;
  value: string;
  cases: string[];
  sources: string[];
  occurrences: number;
  lastSeen: string;
}

function escapeStixValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toStixPattern(type: string, value: string): string {
  const safe = escapeStixValue(value);
  switch (type.toLowerCase()) {
    case "ip":
    case "ipv4":
      return `[ipv4-addr:value = '${safe}']`;
    case "domain":
      return `[domain-name:value = '${safe}']`;
    case "hash":
    case "sha256":
      return `[file:hashes.'SHA-256' = '${safe}']`;
    case "user":
    case "email":
      return value.includes("@")
        ? `[email-addr:value = '${safe}']`
        : `[user-account:account_login = '${safe}']`;
    default:
      return `[artifact:payload_bin = '${safe}']`;
  }
}

function toMispType(type: string, value: string): { category: string; type: string } {
  switch (type.toLowerCase()) {
    case "ip":
    case "ipv4":
      return { category: "Network activity", type: "ip-dst" };
    case "domain":
      return { category: "Network activity", type: "domain" };
    case "hash":
    case "sha256":
      return { category: "Payload delivery", type: "sha256" };
    case "user":
    case "email":
      return value.includes("@")
        ? { category: "Payload delivery", type: "email-src" }
        : { category: "Targeting data", type: "target-user" };
    default:
      return { category: "Other", type: "comment" };
  }
}

export function buildStix21Bundle(
  iocs: ExportableIoc[],
  options: { organizationName?: string; caseNumber?: string } = {},
) {
  const now = new Date().toISOString();
  const orgName = options.organizationName || "CyberTrace Organization";
  const identityId = `identity--${crypto.randomUUID()}`;

  const identityObj = {
    type: "identity",
    spec_version: "2.1",
    id: identityId,
    created: now,
    modified: now,
    name: orgName,
    identity_class: "organization",
  };

  const indicators = iocs.map((ioc) => ({
    type: "indicator",
    spec_version: "2.1",
    id: `indicator--${crypto.randomUUID()}`,
    created_by_ref: identityId,
    created: now,
    modified: now,
    name: `${ioc.type.toUpperCase()}: ${ioc.value}`,
    description: `Observed ${ioc.occurrences} time(s) across case(s): ${ioc.cases.join(", ")}. Sources: ${ioc.sources.join(", ")}.`,
    indicator_types: ["malicious-activity"],
    pattern: toStixPattern(ioc.type, ioc.value),
    pattern_type: "stix",
    valid_from: ioc.lastSeen || now,
    labels: [
      `ioc-type:${ioc.type.toLowerCase()}`,
      ...ioc.cases.map((c) => `case:${c}`),
    ],
  }));

  return {
    type: "bundle",
    id: `bundle--${crypto.randomUUID()}`,
    spec_version: "2.1",
    created: now,
    ...(options.caseNumber ? { description: `CyberTrace STIX 2.1 export for ${options.caseNumber}` } : {}),
    objects: [identityObj, ...indicators],
  };
}

export function buildMispEvent(
  iocs: ExportableIoc[],
  options: { organizationName?: string; caseNumber?: string } = {},
) {
  const now = new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const unixTs = String(Math.floor(now.getTime() / 1000));
  const orgName = options.organizationName || "CyberTrace Organization";
  const info = options.caseNumber
    ? `CyberTrace IOC Export — ${options.caseNumber}`
    : `CyberTrace Workspace IOC Export (${orgName})`;

  return {
    Event: {
      uuid: crypto.randomUUID(),
      info,
      date: isoDate,
      timestamp: unixTs,
      publish_timestamp: unixTs,
      threat_level_id: "2",
      analysis: "1",
      distribution: "0",
      published: false,
      Orgc: {
        uuid: crypto.randomUUID(),
        name: orgName,
      },
      Tag: [
        { name: "tlp:amber" },
        ...(options.caseNumber ? [{ name: `cybertrace:case="${options.caseNumber}"` }] : []),
      ],
      Attribute: iocs.map((ioc) => {
        const mapped = toMispType(ioc.type, ioc.value);
        return {
          uuid: crypto.randomUUID(),
          category: mapped.category,
          type: mapped.type,
          value: ioc.value,
          to_ids: true,
          timestamp: unixTs,
          comment: `Cases: ${ioc.cases.join(", ")} | Sources: ${ioc.sources.join(", ")} | Hits: ${ioc.occurrences}`,
        };
      }),
    },
  };
}
