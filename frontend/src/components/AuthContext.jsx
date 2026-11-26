import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from "firebase/auth";

import { auth, googleAuthProvider } from "../lib/firebase.js";
import { getAuthMe } from "../services/workspaceApi.js";
import Icon from "./Icon.jsx";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [availableRoles, setAvailableRoles] = useState([
    "Admin",
    "Lead Investigator",
    "Analyst",
    "Read-Only Auditor",
  ]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const hydrateProfile = useCallback(async (fbUser) => {
    if (!fbUser) {
      setProfile(null);
      setPermissions([]);
      return;
    }
    const payload = await getAuthMe();
    setProfile(payload.user);
    setPermissions(payload.permissions || []);
    if (Array.isArray(payload.availableRoles) && payload.availableRoles.length > 0) {
      setAvailableRoles(payload.availableRoles);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthError("");
      if (!fbUser) {
        setProfile(null);
        setPermissions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await hydrateProfile(fbUser);
      } catch (cause) {
        setProfile(null);
        setPermissions([]);
        setAuthError(
          cause instanceof Error
            ? cause.message
            : "Could not load your CyberTrace organization profile.",
        );
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [hydrateProfile]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError("");
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      await hydrateProfile(result.user);
    } catch (cause) {
      const code = cause?.code || "";
      if (code === "auth/popup-closed-by-user") {
        setAuthError("Sign-in popup was closed before completing authentication.");
      } else if (code === "auth/popup-blocked") {
        setAuthError("Sign-in popup was blocked by your browser. Please allow popups for this site and try again.");
      } else {
        setAuthError(cause instanceof Error ? cause.message : "Google Sign-In failed.");
      }
    } finally {
      setSigningIn(false);
    }
  }, [hydrateProfile]);

  const signOut = useCallback(async () => {
    setAuthError("");
    await firebaseSignOut(auth);
    setProfile(null);
    setPermissions([]);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;
    setAuthError("");
    await hydrateProfile(auth.currentUser);
  }, [hydrateProfile]);

  const hasPermission = useCallback(
    (permission) => permissions.includes(permission),
    [permissions],
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        permissions,
        availableRoles,
        loading,
        signingIn,
        authError,
        signInWithGoogle,
        signOut,
        refreshProfile,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}

export function ProtectedRoute({ children }) {
  const location = useLocation();
  const { firebaseUser, profile, loading, authError, refreshProfile, signOut } = useAuth();

  if (loading) {
    return (
      <div className="auth-screen">
        <section className="auth-card auth-loading-card" aria-busy="true">
          <div className="auth-brand">
            <span className="brand-mark"><Icon name="shield" size={20} /></span>
            <span>CyberTrace</span>
          </div>
          <h1>Verifying workspace session</h1>
          <p>Loading your organization profile and role permissions.</p>
        </section>
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!profile) {
    return (
      <div className="auth-screen">
        <section className="auth-card" role="alert">
          <div className="auth-brand">
            <span className="brand-mark"><Icon name="shield" size={20} /></span>
            <span>CyberTrace</span>
          </div>
          <h1>Workspace profile unavailable</h1>
          <p>{authError || "Your session could not be synchronized with your organization."}</p>
          <div className="auth-recovery-actions">
            <button type="button" className="primary-button" onClick={refreshProfile}>
              <Icon name="refresh" size={14} /> Retry connection
            </button>
            <button type="button" className="secondary-button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </section>
      </div>
    );
  }

  return children;
}
