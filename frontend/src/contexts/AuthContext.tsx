import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, clearToken, setToken } from "@/src/lib/api";

export type User = {
  id: string;
  email: string;
  full_name: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

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

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
