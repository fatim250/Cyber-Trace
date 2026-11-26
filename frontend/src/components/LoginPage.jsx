import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./AuthContext.jsx";
import Icon from "./Icon.jsx";

export default function LoginPage() {
  const location = useLocation();
  const { firebaseUser, profile, loading, signingIn, authError, signInWithGoogle } = useAuth();

  const redirectTo = location.state?.from || "/";

  if (!loading && firebaseUser && profile) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="auth-screen">
      <div className="auth-layout">
        <section className="auth-overview" aria-label="CyberTrace overview">
          <div className="auth-brand">
            <span className="brand-mark"><Icon name="shield" size={20} /></span>
            <span>CyberTrace</span>
          </div>

          <h1 className="auth-headline">Digital forensics & incident response workspace</h1>
          <p className="auth-lead">
            Manage active security investigations, verify SHA-256 artifact integrity, correlate cross-case indicators, and triage telemetry with an integrated AI copilot.
          </p>

          <dl className="auth-capabilities">
            <div>
              <dt>Isolated team workspaces</dt>
              <dd>Every organization operates inside its own database-enforced tenant boundary with immutable audit attribution.</dd>
            </div>
            <div>
              <dt>Role-based governance</dt>
              <dd>Enforces Admin, Lead Investigator, Analyst, and Read-Only Auditor permissions across cases, evidence, and custody ledgers.</dd>
            </div>
            <div>
              <dt>Threat intelligence & reporting</dt>
              <dd>Export STIX 2.1 bundles, MISP events, and print-ready forensic handoff dossiers directly from verified case telemetry.</dd>
            </div>
          </dl>
        </section>

        <section className="panel auth-card" aria-label="Sign in to CyberTrace">
          <div className="auth-card-head">
            <span className="eyebrow">AUTHENTICATED ACCESS</span>
            <h2>Sign in to your workspace</h2>
            <p>
              Use your Google account to access your CyberTrace organization. First-time sign-ins automatically provision a private SOC workspace or link to a pending team invitation.
            </p>
          </div>

          {authError && (
            <div className="dashboard-error" role="alert">
              <Icon name="findings" size={16} />
              <div>
                <strong>Sign-in error</strong>
                <p>{authError}</p>
              </div>
            </div>
          )}

          <button
            type="button"
            className="primary-button auth-google-btn"
            onClick={signInWithGoogle}
            disabled={loading || signingIn}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.8 12.23c0-.72-.06-1.41-.18-2.08H12v3.94h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.5z"
              />
              <path
                fill="currentColor"
                d="M12 22c2.76 0 5.07-.91 6.76-2.47l-3.3-2.56c-.91.61-2.08.98-3.46.98-2.66 0-4.91-1.8-5.71-4.21H2.88v2.64A10 10 0 0 0 12 22z"
              />
              <path
                fill="currentColor"
                d="M6.29 13.74A6.01 6.01 0 0 1 5.97 12c0-.6.11-1.19.32-1.74V7.62H2.88A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.48l3.21-2.74z"
              />
              <path
                fill="currentColor"
                d="M12 5.95c1.5 0 2.85.52 3.91 1.53l2.93-2.93C17.06 2.89 14.75 2 12 2a10 10 0 0 0-9.12 5.62l3.41 2.64c.8-2.41 3.05-4.31 5.71-4.31z"
              />
            </svg>
            <span>{signingIn ? "Signing in…" : "Continue with Google"}</span>
          </button>

          <p className="auth-footnote">
            All case updates, SHA-256 verifications, and custody transfers are cryptographically attributed to your verified account.
          </p>
        </section>
      </div>
    </div>
  );
}
