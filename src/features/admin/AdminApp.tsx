/**
 * Admin Panel: login, layout and one route per section.
 * Each section is a folder next to this file.
 */
import { Navigate, Route, Routes } from 'react-router';
import { AdminLayout } from './AdminLayout';
import { AdminLogin } from './AdminLogin';
import { B2BRequestsPage } from './b2b/B2BRequestsPage';
import { ContentPage } from './content/ContentPage';
import { DashboardPage } from './dashboard/DashboardPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { OrderDetail } from './orders/OrderDetail';
import { OrdersPage } from './orders/OrdersPage';
import { PaymentsPage } from './payments/PaymentsPage';
import { can, type Section } from './permissions';
import { ProductEditor } from './products/ProductEditor';
import { ProductsPage } from './products/ProductsPage';
import { useAdminRole } from './session';
import { SettingsPage } from './settings/SettingsPage';
import { ShippingPage } from './shipping/ShippingPage';
import { StockPage } from './stock/StockPage';
import { useI18n } from '@/i18n';
import './admin.css';

function Guard({ section, children }: { section: Section; children: React.ReactNode }) {
  const role = useAdminRole();
  const { t } = useI18n();
  if (!role || !can(role, section)) return <p className="notice notice-warn">{t.admin.noAccess}</p>;
  return <>{children}</>;
}

export function AdminApp() {
  const role = useAdminRole();
  if (!role) return <AdminLogin />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<Guard section="orders"><OrdersPage /></Guard>} />
        <Route path="orders/:id" element={<Guard section="orders"><OrderDetail /></Guard>} />
        <Route path="b2b" element={<Guard section="b2b"><B2BRequestsPage /></Guard>} />
        <Route path="products" element={<Guard section="products"><ProductsPage /></Guard>} />
        <Route path="products/:id" element={<Guard section="products"><ProductEditor /></Guard>} />
        <Route path="stock" element={<Guard section="stock"><StockPage /></Guard>} />
        <Route path="shipping" element={<Guard section="shipping"><ShippingPage /></Guard>} />
        <Route path="payments" element={<Guard section="payments"><PaymentsPage /></Guard>} />
        <Route path="notifications" element={<Guard section="notifications"><NotificationsPage /></Guard>} />
        <Route path="content" element={<Guard section="content"><ContentPage /></Guard>} />
        <Route path="settings" element={<Guard section="settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
