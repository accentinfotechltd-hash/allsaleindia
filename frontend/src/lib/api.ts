import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "allsale_token";

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

/** Public token accessor for non-JSON requests (file uploads, downloads). */
export async function getAuthToken(): Promise<string | null> {
  return await getToken();
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

/**
 * Rich error thrown on non-2xx responses. Exposes the HTTP status code
 * and, for 429 responses, parses the `Retry-After` header (in seconds)
 * so UI can show accurate cooldown countdowns. Use ``instanceof ApiError``
 * to branch on this beyond just reading the message.
 */
export class ApiError extends Error {
  status: number;
  retryAfter: number | null;   // seconds, populated from Retry-After on 429
  detail: unknown;
  constructor(status: number, message: string, opts: { retryAfter?: number | null; detail?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = opts.retryAfter ?? null;
    this.detail = opts.detail;
  }
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || res.statusText || "Request failed";
    const msg = typeof detail === "string" ? detail : JSON.stringify(detail);
    let retryAfter: number | null = null;
    if (res.status === 429) {
      const h = res.headers.get("Retry-After");
      const n = h ? parseInt(h, 10) : NaN;
      retryAfter = Number.isFinite(n) ? n : null;
    }
    throw new ApiError(res.status, msg, { retryAfter, detail: data });
  }
  return data as T;
}

export const ORIGIN_URL = BASE;
