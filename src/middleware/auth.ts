import type { NextFunction, Request, Response } from "express";

import type { AuthenticatedPrincipal } from "../auth/rbac.ts";
import type { CyberTraceRepository } from "../db/repository.ts";
import { adminAuth } from "../lib/firebase-admin.ts";

export interface VerifiedTokenPayload {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

export type TokenVerifier = (token: string) => Promise<VerifiedTokenPayload>;

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedPrincipal;
}

export const defaultTokenVerifier: TokenVerifier = async (token: string) => {
  const decoded = await adminAuth.verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name,
    picture: decoded.picture,
  };
};

export function createRequireAuth(
  repository: CyberTraceRepository,
  verifyToken: TokenVerifier = defaultTokenVerifier,
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "Authentication required. Please sign in with Google.",
        },
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "Authentication token is empty.",
        },
      });
    }

    let decoded: VerifiedTokenPayload;
    try {
      decoded = await verifyToken(token);
    } catch (error) {
      console.error("Failed to verify Firebase ID token:", error);
      return res.status(401).json({
        error: {
          code: "invalid_token",
          message: "Session expired or invalid. Please sign in again.",
        },
      });
    }

    const email = decoded.email || `${decoded.uid}@users.cybertrace.local`;
    const displayName = decoded.name || email.split("@")[0] || "CyberTrace Analyst";

    try {
      const principal = await repository.syncAuthenticatedUser({
        uid: decoded.uid,
        email,
        displayName,
        photoUrl: decoded.picture || null,
      });
      req.auth = principal;
      return next();
    } catch (error) {
      console.error("Failed to hydrate authenticated user profile:", error);
      return res.status(503).json({
        error: {
          code: "service_unavailable",
          message: "Could not load your CyberTrace workspace profile. Please retry.",
        },
      });
    }
  };
}
