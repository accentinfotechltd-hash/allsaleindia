import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/contexts/AuthContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { useToast } from "@/src/components/UiOverlayProvider";
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
  const toast = useToast();
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [loading, setLoading] = useState(false);
  // Track per-user-session whether we've already tried auto-applying the
  // stored ambassador ref code. Prevents loops and respects manual coupon
  // entry — if the user removes a coupon, we don't re-add it.
  const autoRefAttemptedFor = useRef<string | null>(null);

  /** Best-effort apply of a stored ambassador ref code at most ONCE per
   * user session. Mirrors the web team's `applyCoupon()` auto-fire on cart
   * read. Silently no-ops if the cart is empty, already has a coupon, the
   * ref is invalid, the code is B2B-only (seller-recruit, can't be applied
   * at customer checkout), or the user manually pasted a different code
   * earlier. */
  const maybeAutoApplyRef = useCallback(async (currentCart: Cart, userId: string) => {
    if (autoRefAttemptedFor.current === userId) return currentCart;
    if (currentCart.items.length === 0) return currentCart; // try again on next refresh once cart has items
    if (currentCart.coupon_code) {
      // User already has a coupon — don't override it but mark attempted
      // so we don't keep checking on every refresh.
      autoRefAttemptedFor.current = userId;
      return currentCart;
    }
    const stored = await getStoredRef();
    if (!stored) {
      autoRefAttemptedFor.current = userId;
      return currentCart;
    }
    // B2B (seller-recruit) codes have no customer-side coupon doc — applying
    // them at checkout always returns 400 wrong_audience_b2b. Skip the
    // round-trip; the user can still sell-on-Allsale via the seller signup
    // flow which reads the same stored ref.
    if (stored.program === "B2B") {
      autoRefAttemptedFor.current = userId;
      return currentCart;
    }
    autoRefAttemptedFor.current = userId; // mark before the call to avoid double-fires
    try {
      const next = await api<Cart>("/cart/coupon", {
        method: "POST",
        body: { code: stored.code },
      });
      setCart(next);
      // Confirm to the shopper that an ambassador's code was auto-applied so
      // the discount line item in the cart isn't a mystery. Includes the
      // ambassador's name when available for warm fuzzies.
      try {
        const who = stored.name ? `${stored.name}'s` : "your referrer's";
        toast.show({
          title: `Applied ${who} code: ${stored.code}`,
          body: typeof next.discount_nzd === "number" && next.discount_nzd > 0
            ? `You saved NZ$${next.discount_nzd.toFixed(2)} on this order.`
            : "Discount applied at checkout.",
          kind: "success",
        });
      } catch {
        /* toast is best-effort */
      }
      return next;
    } catch {
      // Invalid/expired code — silently leave the cart alone.
      return currentCart;
    }
  }, [toast]);

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
    // If the visitor arrived via /a/{code} BEFORE adding anything to the
    // cart, the first refresh saw an empty cart and bailed out without
    // attempting attribution. Retry now that the cart has items.
    if (user?.id && c.items.length > 0 && !c.coupon_code) {
      void maybeAutoApplyRef(c, user.id);
    }
  }, [user?.id, maybeAutoApplyRef]);

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
