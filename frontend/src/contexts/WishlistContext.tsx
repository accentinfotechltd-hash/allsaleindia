import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/contexts/AuthContext";

type Ctx = {
  ids: Set<string>;
  count: number;
  has: (productId: string) => boolean;
  toggle: (productId: string) => Promise<boolean>; // returns new state (true=in wishlist)
  refresh: () => Promise<void>;
};

const WishlistCtx = createContext<Ctx | undefined>(undefined);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!user) {
      setIds(new Set());
      return;
    }
    try {
      const list = await api<string[]>("/wishlist/ids");
      setIds(new Set(list));
    } catch {
      // silently ignore — likely 401 during token refresh
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const has = useCallback((id: string) => ids.has(id), [ids]);

  const toggle = useCallback(
    async (productId: string) => {
      if (!user) {
        // Caller should redirect to login.
        return false;
      }
      const next = !ids.has(productId);
      // Optimistic update
      setIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(productId);
        else copy.delete(productId);
        return copy;
      });
      try {
        if (next) {
          await api(`/wishlist/${productId}`, { method: "POST" });
        } else {
          await api(`/wishlist/${productId}`, { method: "DELETE" });
        }
        return next;
      } catch (e) {
        // Roll back on failure
        setIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(productId);
          else copy.add(productId);
          return copy;
        });
        throw e;
      }
    },
    [ids, user],
  );

  return (
    <WishlistCtx.Provider value={{ ids, count: ids.size, has, toggle, refresh }}>
      {children}
    </WishlistCtx.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistCtx);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
}
