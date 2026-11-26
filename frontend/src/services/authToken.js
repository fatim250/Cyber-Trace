import { auth } from "../lib/firebase.js";

/**
 * Retrieves a fresh Firebase ID token from memory/SDK without ever persisting
 * credentials to localStorage or sessionStorage.
 */
export async function getFreshIdToken(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

export async function buildAuthHeaders(extraHeaders = {}) {
  const token = await getFreshIdToken();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}
