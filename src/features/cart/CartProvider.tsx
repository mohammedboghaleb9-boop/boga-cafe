/**
 * Cart state, kept in the browser so it survives a refresh.
 * The cart only stores choices (product, size, recipe, quantity);
 * prices and stock are always recomputed from the catalog.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartItem, CustomBlendSpec, PackSize } from '@/core/types';
import { uid } from '@/data/ids';

const STORAGE_KEY = 'boga-cart';

interface CartApi {
  items: CartItem[];
  count: number;
  addProduct: (productId: string, size: PackSize, qty: number, label: string) => void;
  addCustom: (blend: CustomBlendSpec, qty: number, label: string) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  toast: string | null;
  dismissToast: () => void;
}

const CartContext = createContext<CartApi | null>(null);

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

const sameBlend = (a: CustomBlendSpec, b: CustomBlendSpec) =>
  a.size === b.size &&
  a.lines.length === b.lines.length &&
  a.lines.every((l, i) => l.originId === b.lines[i].originId && l.percent === b.lines[i].percent);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const addProduct = useCallback((productId: string, size: PackSize, qty: number, label: string) => {
    setItems((cur) => {
      const found = cur.find((i) => i.type === 'product' && i.productId === productId && i.size === size);
      if (found) return cur.map((i) => (i === found ? { ...i, qty: i.qty + qty } : i));
      return [...cur, { id: uid(), type: 'product', productId, size, qty }];
    });
    setToast(label);
  }, []);

  const addCustom = useCallback((blend: CustomBlendSpec, qty: number, label: string) => {
    setItems((cur) => {
      const found = cur.find((i) => i.type === 'custom' && sameBlend(i.blend, blend));
      if (found) return cur.map((i) => (i === found ? { ...i, qty: i.qty + qty } : i));
      return [...cur, { id: uid(), type: 'custom', blend, qty }];
    });
    setToast(label);
  }, []);

  const value = useMemo<CartApi>(
    () => ({
      items,
      count: items.reduce((s, i) => s + i.qty, 0),
      addProduct,
      addCustom,
      setQty: (id, qty) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i))),
      remove: (id) => setItems((cur) => cur.filter((i) => i.id !== id)),
      clear: () => setItems([]),
      toast,
      dismissToast: () => setToast(null),
    }),
    [items, toast, addProduct, addCustom],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
