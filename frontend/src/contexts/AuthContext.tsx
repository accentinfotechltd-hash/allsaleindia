import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api, clearToken, setToken } from "@/src/lib/api";

export type User = {
  id: string;
  email: string;
  full_name: string;
  picture?: string | null;
  provider?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  googleSigningIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  loginWithGoogle: () => Promise<{ cancelled: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | undefined>(undefined);

const AUTH_BASE = "https://auth.emergentagent.com/";

function extractSessionId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const hashIdx = rawUrl.indexOf("#");
  if (hashIdx >= 0) {
    const params = new URLSearchParams(rawUrl.slice(hashIdx + 1));
    const v = params.get("session_id");
    if (v) return v;
  }
  const qIdx = rawUrl.indexOf("?");
  if (qIdx >= 0) {
    const params = new URLSearchParams(rawUrl.slice(qIdx + 1));
    const v = params.get("session_id");
    if (v) return v;
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const processedSessionRef = useRef<string | null>(null);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    if (processedSessionRef.current === sessionId) return;
    processedSessionRef.current = sessionId;
    const res = await api<{ user: User; access_token: string }>("/auth/google-session", {
      method: "POST",
      auth: false,
      body: { session_id: sessionId },
    });
    await setToken(res.access_token);
    setUser(res.user);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  // Bootstrap: on web, check URL for session_id first (post-Google redirect);
  // otherwise fall back to /auth/me with stored token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
        if (sid) {
          try {
            await exchangeSessionId(sid);
            window.history.replaceState(null, "", window.location.pathname);
          } catch {
            // ignored
          } finally {
            if (!cancelled) setLoading(false);
          }
          return;
        }
      }
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, exchangeSessionId]);

  // Mobile cold start / deep links.
  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    (async () => {
      const initial = await Linking.getInitialURL();
      const sid = extractSessionId(initial);
      if (sid && mounted) {
        try {
          await exchangeSessionId(sid);
        } catch {
          // ignored
        }
      }
    })();
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) exchangeSessionId(sid).catch(() => {});
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [exchangeSessionId]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; access_token: string }>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    await setToken(res.access_token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    const res = await api<{ user: User; access_token: string }>("/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, full_name: fullName },
    });
    await setToken(res.access_token);
    setUser(res.user);
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<{ cancelled: boolean }> => {
    setGoogleSigningIn(true);
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const redirectUrl = window.location.origin + "/";
        window.location.href = `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl)}`;
        // Browser navigates away — return cancelled=false so caller doesn't show error.
        return { cancelled: false };
      }
      const redirectUrl = Linking.createURL("auth");
      const result = await WebBrowser.openAuthSessionAsync(
        `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl)}`,
        redirectUrl,
      );
      if (result.type !== "success" || !result.url) return { cancelled: true };
      const sid = extractSessionId(result.url);
      if (!sid) return { cancelled: true };
      await exchangeSessionId(sid);
      return { cancelled: false };
    } finally {
      setGoogleSigningIn(false);
    }
  }, [exchangeSessionId]);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{ user, loading, googleSigningIn, login, register, loginWithGoogle, logout, refresh }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
