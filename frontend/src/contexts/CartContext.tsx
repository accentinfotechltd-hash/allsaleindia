import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/contexts/AuthContext";

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
};

const CartCtx = createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCart(EMPTY);
      return;
    }
    setLoading(true);
    try {
      const c = await api<Cart>("/cart");
      setCart(c);
    } catch {
      setCart(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user]);

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

  const itemCount = cart.items.reduce((sum, it) => sum + it.quantity, 0);

  return (
    <CartCtx.Provider
      value={{ cart, loading, itemCount, refresh, add, update, remove, applyCoupon, removeCoupon }}
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
