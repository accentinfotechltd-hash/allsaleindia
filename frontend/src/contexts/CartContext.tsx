import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/contexts/AuthContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { getStoredRef } from "@/src/lib/ref";

export type CartItem = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  quantity: number;
  category: string;
};

export type Cart = {
  items: CartItem[];
  subtotal_nzd: number;
  shipping_nzd: number;
  discount_nzd: number;
  total_nzd: number;
  subtotal_inr: number;
  coupon_code?: string | null;
  coupon_label?: string | null;
  points_used?: number;
  points_discount_nzd?: number;
  points_balance?: number;
  points_max_usable?: number;
  gift_wrap_fee_nzd?: number;
  gift_wrap_count?: number;
  // Tax / duty (per destination jurisdiction)
  tax_nzd?: number;
  tax_rate?: number;
  tax_country?: string | null;
  tax_label_key?: string | null;
  tax_threshold_nzd?: number;
  tax_over_threshold?: boolean;
  tax_at_border?: boolean;
  tax_inclusive?: boolean;
};

type CartState = {
  cart: Cart;
  loading: boolean;
  itemCount: number;
  refresh: () => Promise<void>;
  add: (productId: string, qty?: number) => Promise<void>;
  update: (productId: string, qty: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  applyCoupon: (code: string) => Promise<Cart>;
  removeCoupon: () => Promise<void>;
  setGiftWrap: (
    productId: string,
    giftWrap: boolean,
    giftMessage?: string,
  ) => Promise<Cart>;
};

const EMPTY: Cart = {
  items: [],
  subtotal_nzd: 0,
  shipping_nzd: 0,
  discount_nzd: 0,
  total_nzd: 0,
  subtotal_inr: 0,
  coupon_code: null,
  coupon_label: null,
  points_used: 0,
  points_discount_nzd: 0,
  points_balance: 0,
  points_max_usable: 0,
  gift_wrap_fee_nzd: 0,
  gift_wrap_count: 0,
};

const CartCtx = createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { country } = useRegion();
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [loading, setLoading] = useState(false);
  // Track per-user-session whether we've already tried auto-applying the
  // stored ambassador ref code. Prevents loops and respects manual coupon
  // entry — if the user removes a coupon, we don't re-add it.
  const autoRefAttemptedFor = useRef<string | null>(null);

  /** Best-effort apply of a stored ambassador ref code at most ONCE per
   * user session. Mirrors the web team's `applyCoupon()` auto-fire on cart
   * read. Silently no-ops if the cart is empty, already has a coupon, the
   * ref is invalid, or the user manually pasted a different code earlier. */
  const maybeAutoApplyRef = useCallback(async (currentCart: Cart, userId: string) => {
    if (autoRefAttemptedFor.current === userId) return currentCart;
    autoRefAttemptedFor.current = userId; // mark immediately to avoid races
    if (currentCart.items.length === 0) return currentCart;
    if (currentCart.coupon_code) return currentCart; // already has a coupon
    const stored = await getStoredRef();
    if (!stored) return currentCart;
    try {
      const next = await api<Cart>("/cart/coupon", {
        method: "POST",
        body: { code: stored.code },
      });
      setCart(next);
      return next;
    } catch {
      // Invalid/expired code — silently leave the cart alone.
      return currentCart;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setCart(EMPTY);
      autoRefAttemptedFor.current = null;
      return;
    }
    setLoading(true);
    try {
      // Pass the buyer's region so the backend can compute GST/VAT for the
      // correct jurisdiction (NZ 15%, AU 10%, UK 20%, etc.).
      const c = await api<Cart>(`/cart?country=${encodeURIComponent(country)}`);
      setCart(c);
      // Fire-and-forget: try to auto-apply ambassador ref code if present.
      void maybeAutoApplyRef(c, user.id);
    } catch {
      setCart(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user, country, maybeAutoApplyRef]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (productId: string, qty = 1) => {
    const c = await api<Cart>("/cart", {
      method: "POST",
      body: { product_id: productId, quantity: qty },
    });
    setCart(c);
    // Fire-and-forget analytics ping for seller dashboard.
    api(`/products/${productId}/track-cart-add`, { method: "POST", auth: false }).catch(
      () => {},
    );
  }, []);

  const update = useCallback(async (productId: string, qty: number) => {
    const c = await api<Cart>(`/cart/${productId}`, { method: "PUT", body: { quantity: qty } });
    setCart(c);
  }, []);

  const remove = useCallback(async (productId: string) => {
    const c = await api<Cart>(`/cart/${productId}`, { method: "DELETE" });
    setCart(c);
  }, []);

  const applyCoupon = useCallback(async (code: string) => {
    const c = await api<Cart>("/cart/coupon", {
      method: "POST",
      body: { code },
    });
    setCart(c);
    return c;
  }, []);

  const removeCoupon = useCallback(async () => {
    const c = await api<Cart>("/cart/coupon", { method: "DELETE" });
    setCart(c);
  }, []);

  const setGiftWrap = useCallback(
    async (productId: string, giftWrap: boolean, giftMessage?: string) => {
      const c = await api<Cart>(`/cart/${productId}/gift`, {
        method: "PATCH",
        body: {
          gift_wrap: giftWrap,
          gift_message: giftMessage,
        },
      });
      setCart(c);
      return c;
    },
    [],
  );

  const itemCount = cart.items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <CartCtx.Provider
      value={{ cart, loading, itemCount, refresh, add, update, remove, applyCoupon, removeCoupon, setGiftWrap }}
    >
      {children}
    </CartCtx.Provider>
  );
}

export function useCart(): CartState {
  const ctx = useContext(CartCtx);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
