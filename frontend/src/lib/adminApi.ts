/**
 * Admin API helper — supports BOTH:
 *   1. Legacy `x-admin-secret` header (bootstrap owner only)
 *   2. JWT bearer token (new RBAC flow — owner, manager, support)
 *
 * Whichever credential is stored locally wins, with JWT preferred when both
 * exist.  Tokens + identity are persisted in SecureStore.
 */
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const SECRET_KEY = "allsale_admin_secret";
const TOKEN_KEY = "allsale_admin_token";
const IDENTITY_KEY = "allsale_admin_identity";

export type AdminRole = "owner" | "manager" | "support";

export type AdminIdentity = {
  id: string;
  email: string;
  full_name?: string | null;
  role: AdminRole;
};

// ---------------------------------------------------------------------------
// Credentials persistence
// ---------------------------------------------------------------------------
export async function getAdminSecret(): Promise<string | null> {
  return await storage.secureGet<string>(SECRET_KEY, "");
}
export async function setAdminSecret(secret: string): Promise<void> {
  await storage.secureSet(SECRET_KEY, secret);
}
export async function clearAdminSecret(): Promise<void> {
  await storage.secureRemove(SECRET_KEY);
}

export async function getAdminToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}
export async function setAdminToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function clearAdminToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  return await storage.secureGet<AdminIdentity | null>(IDENTITY_KEY, null);
}
export async function setAdminIdentity(id: AdminIdentity): Promise<void> {
  await storage.secureSet(IDENTITY_KEY, id);
}
export async function clearAdminIdentity(): Promise<void> {
  await storage.secureRemove(IDENTITY_KEY);
}

export async function clearAdminAuth(): Promise<void> {
  await Promise.all([
    clearAdminSecret(),
    clearAdminToken(),
    clearAdminIdentity(),
  ]);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class AdminUnauthorized extends Error {
  constructor(msg = "Admin auth missing or invalid") {
    super(msg);
    this.name = "AdminUnauthorized";
  }
}

export class AdminForbidden extends Error {
  constructor(msg = "Insufficient permissions for this action") {
    super(msg);
    this.name = "AdminForbidden";
  }
}

// ---------------------------------------------------------------------------
// adminApi() — unified fetch wrapper
// ---------------------------------------------------------------------------
export type AdminApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export async function adminApi<T = any>(
  path: string,
  opts: AdminApiOptions = {},
): Promise<T> {
  const { method = "GET", body, query } = opts;
  const token = await getAdminToken();
  const secret = !token ? await getAdminSecret() : null;

  if (!token && !secret) throw new AdminUnauthorized();

  let url = `${BASE}/api${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.append(k, String(v));
    }
    const q = params.toString();
    if (q) url += `?${q}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (secret) headers["x-admin-secret"] = secret;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 204 = no content (success on DELETE)
  if (res.status === 204) return null as unknown as T;

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 401) {
    throw new AdminUnauthorized((data && data.detail) || "Login required");
  }
  if (res.status === 403) {
    throw new AdminForbidden(
      (data && data.detail) || "Permission denied",
    );
  }
  if (!res.ok) {
    const detail = (data && data.detail) || res.statusText || "Request failed";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    throw new Error(msg);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Auth flows
// ---------------------------------------------------------------------------
type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  admin: AdminIdentity;
};

/** Sign in with email + password.  Persists JWT + identity. */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<AdminIdentity> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || "Invalid email or password";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const lr = data as LoginResponse;
  await setAdminToken(lr.access_token);
  await setAdminIdentity(lr.admin);
  // Clear any stale bootstrap secret — JWT is now the source of truth.
  await clearAdminSecret();
  return lr.admin;
}

/** Verify the cached JWT and refresh identity.  Returns null if expired. */
export async function fetchCurrentAdmin(): Promise<AdminIdentity | null> {
  const token = await getAdminToken();
  if (!token) return null;
  try {
    const me = await adminApi<AdminIdentity & { last_login_at?: string | null }>(
      "/admin/me",
    );
    await setAdminIdentity({
      id: me.id,
      email: me.email,
      full_name: me.full_name,
      role: me.role,
    });
    return me;
  } catch (e) {
    if (e instanceof AdminUnauthorized) {
      // Token expired — wipe identity but DON'T wipe the bootstrap secret
      // (an owner may still want to fall back to that).
      await clearAdminToken();
      await clearAdminIdentity();
      return null;
    }
    throw e;
  }
}

/** Synthetic identity for bootstrap-owner sessions (no JWT, only secret). */
export function bootstrapIdentity(): AdminIdentity {
  return {
    id: "bootstrap_owner",
    email: "(bootstrap)",
    full_name: "Bootstrap Owner",
    role: "owner",
  };
}

// ---------------------------------------------------------------------------
// RBAC helpers (UI gating)
// ---------------------------------------------------------------------------
/** True iff the given role is allowed to perform an action.  Owner has full access. */
export function hasRole(
  identity: AdminIdentity | null | undefined,
  allowed: AdminRole[],
): boolean {
  if (!identity) return false;
  if (identity.role === "owner") return true;
  return allowed.includes(identity.role);
}
