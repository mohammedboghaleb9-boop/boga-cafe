/**
 * Application shell: providers + every route of the site in one place.
 * Each route points to one section folder in src/features.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, MemoryRouter, Route, Routes } from 'react-router';
import { CartProvider } from '@/features/cart/CartProvider';
import { I18nProvider } from '@/i18n';
import { StoreLayout } from '@/shared/layout/StoreLayout';
import { B2BPage } from '@/features/b2b/B2BPage';
import { CartPage } from '@/features/cart/CartPage';
import { CheckoutPage } from '@/features/checkout/CheckoutPage';
import { OrderPage } from '@/features/checkout/OrderPage';
import { ContactPage } from '@/features/contact/ContactPage';
import { CustomBlendPage } from '@/features/custom-blend/CustomBlendPage';
import { HomePage } from '@/features/home/HomePage';
import { ProductPage } from '@/features/product/ProductPage';
import { ShopPage } from '@/features/shop/ShopPage';
import { SingleOriginPage } from '@/features/single-origin/SingleOriginPage';
import { NotFound } from './NotFound';

/**
 * browser → real domain (clean URLs). hash → static previews.
 * Some embedded previews forbid changing the URL; the demo then keeps
 * navigation in memory so every link still works.
 */
function pickRouter() {
  if (import.meta.env.VITE_ROUTER !== 'hash') return BrowserRouter;
  try {
    window.history.replaceState(window.history.state, '', window.location.hash || '#/');
    return HashRouter;
  } catch {
    return MemoryRouter;
  }
}

const Router = pickRouter();

// The Admin Panel is loaded only when someone opens /admin.
const AdminApp = lazy(() => import('@/features/admin/AdminApp').then((m) => ({ default: m.AdminApp })));

export function App() {
  return (
    <I18nProvider>
      <CartProvider>
        <Router>
          <Routes>
            <Route element={<StoreLayout />}>
              <Route index element={<HomePage />} />
              <Route path="shop" element={<ShopPage />} />
              <Route path="product/:slug" element={<ProductPage />} />
              <Route path="single-origin" element={<SingleOriginPage />} />
              <Route path="custom-blend" element={<CustomBlendPage />} />
              <Route path="b2b" element={<B2BPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="order/:id" element={<OrderPage />} />
              <Route path="contact" element={<ContactPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route
              path="admin/*"
              element={
                <Suspense fallback={null}>
                  <AdminApp />
                </Suspense>
              }
            />
          </Routes>
        </Router>
      </CartProvider>
    </I18nProvider>
  );
}
