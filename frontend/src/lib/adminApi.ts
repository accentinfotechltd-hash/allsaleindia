/**
 * Admin API helper — wraps fetch() with the x-admin-secret header and
 * persists the secret in SecureStore so admins don't have to re-enter
 * it on every screen.
 */
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const SECRET_KEY = "allsale_admin_secret";

export async function getAdminSecret(): Promise<string | null> {
  return await storage.secureGet<string>(SECRET_KEY, "");
}

export async function setAdminSecret(secret: string): Promise<void> {
  await storage.secureSet(SECRET_KEY, secret);
}

export async function clearAdminSecret(): Promise<void> {
  await storage.secureRemove(SECRET_KEY);
}

export type AdminApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

export class AdminUnauthorized extends Error {
  constructor(msg = "Admin secret missing or invalid") {
    super(msg);
    this.name = "AdminUnauthorized";
  }
}

export async function adminApi<T = any>(
  path: string,
  opts: AdminApiOptions = {},
): Promise<T> {
  const { method = "GET", body, query } = opts;
  const secret = await getAdminSecret();
  if (!secret) throw new AdminUnauthorized();

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

  const res = await fetch(url, {
    method,
    headers: {
      "x-admin-secret": secret,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 401 || res.status === 403) {
    throw new AdminUnauthorized(
      (data && data.detail) || "Admin secret invalid",
    );
  }
  if (!res.ok) {
    const detail = (data && data.detail) || res.statusText || "Request failed";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    throw new Error(msg);
  }
  return data as T;
}
