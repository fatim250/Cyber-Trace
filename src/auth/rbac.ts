import type { NextFunction, Response } from "express";

export const RBAC_ROLES = [
  "Admin",
  "Lead Investigator",
  "Analyst",
  "Read-Only Auditor",
] as const;

export type RbacRole = (typeof RBAC_ROLES)[number];

export const RBAC_ROLE_SET = new Set<string>(RBAC_ROLES);

export type Permission =
  | "read"
  | "write_investigations"
  | "delete_cases"
  | "manage_team";

const ROLE_PERMISSIONS: Record<RbacRole, Set<Permission>> = {
  Admin: new Set(["read", "write_investigations", "delete_cases", "manage_team"]),
  "Lead Investigator": new Set(["read", "write_investigations", "delete_cases"]),
  Analyst: new Set(["read", "write_investigations"]),
  "Read-Only Auditor": new Set(["read"]),
};

export function normalizeRbacRole(value: unknown, fallback: RbacRole = "Analyst"): RbacRole {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (RBAC_ROLE_SET.has(trimmed)) {
      return trimmed as RbacRole;
    }
  }
  return fallback;
}

export function hasPermission(role: string | undefined, permission: Permission): boolean {
  if (!role || !RBAC_ROLE_SET.has(role)) return false;
  return ROLE_PERMISSIONS[role as RbacRole].has(permission);
}

export function listRolePermissions(role: RbacRole): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role]);
}

export interface AuthenticatedPrincipal {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  memberId: number;
  memberCode: string;
  rbacRole: RbacRole;
  jobTitle: string;
  team: string;
}

export function requirePermission(permission: Permission) {
  return (req: { auth?: AuthenticatedPrincipal }, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        error: { code: "unauthorized", message: "Authentication required." },
      });
    }
    if (!hasPermission(req.auth.rbacRole, permission)) {
      return res.status(403).json({
        error: {
          code: "forbidden",
          message: `Your role (${req.auth.rbacRole}) does not have permission to perform this action.`,
        },
      });
    }
    return next();
  };
}
