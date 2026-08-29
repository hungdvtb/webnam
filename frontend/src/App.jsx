import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './layouts/Layout';
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductDetail from './pages/ProductDetail';
import About from './pages/About';
import Login from './pages/Login';
import Register from './pages/Register';
import PostDetail from './pages/PostDetail';
import Blog from './pages/Blog';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import UserDashboard from './pages/UserDashboard';

// Storefront (Website bán hàng)
import StorefrontLayout from './layouts/StorefrontLayout';
import StorefrontHome from './pages/storefront/StorefrontHome';
import StorefrontProducts from './pages/storefront/StorefrontProducts';
import StorefrontProductDetail from './pages/storefront/StorefrontProductDetail';
import StorefrontCheckout from './pages/storefront/StorefrontCheckout';
import StoreLocationsPage from './pages/storefront/StoreLocationsPage';
import OrderThankYou from './pages/OrderThankYou';

import AdminLayout from './layouts/AdminLayout';
import AdminDashboard from './pages/admin/Dashboard';
import ProductList from './pages/admin/ProductList';
import ProductForm from './pages/admin/ProductForm';
import ProductReviewManager from './pages/admin/ProductReviewManager';
import ProductFaqManager from './pages/admin/ProductFaqManager';
import CategoryList from './pages/admin/CategoryList';
import AttributeList from './pages/admin/AttributeList';
import MenuList from './pages/admin/MenuList';
import AccountList from './pages/admin/AccountList';
import WarehouseList from './pages/admin/WarehouseList';
import ShipmentList from './pages/admin/ShipmentList';
import OrderList from './pages/admin/OrderList';
import OrderDetail from './pages/admin/OrderDetail';
import OrderForm from './pages/admin/OrderForm';
import InventoryMovement from './pages/admin/InventoryMovement';
import ProductReplacementManager from './pages/admin/ProductReplacementManager';
import WarehouseShelfManager from './pages/admin/WarehouseShelfManager';
import CustomerManagement from './pages/admin/CustomerManagement';
import SalesReportPage from './pages/admin/SalesReportPage';
import WebAnalyticsReport from './pages/admin/WebAnalyticsReport';
import BlogList from './pages/admin/BlogList';
import BlogForm from './pages/admin/BlogForm';
import SiteSettings from './pages/admin/SiteSettings';
import ShippingSettingsPage from './pages/admin/ShippingSettingsPage';
import AiTrainingManager from './pages/admin/AiTrainingManager';
import UserList from './pages/admin/UserList';
import OrderStatusSettings from './pages/admin/OrderStatusSettings';
import LeadList from './pages/admin/LeadList';
import TelesalesCrm from './pages/admin/TelesalesCrm';
import QuickReplies from './pages/admin/QuickReplies';
import FixedCostTracker from './pages/admin/FixedCostTracker';
import FundManagement from './pages/admin/FundManagement';
import DebtManagement from './pages/admin/DebtManagement';
import AssetSummary from './pages/admin/AssetSummary';
import DailyProfitReport from './pages/admin/DailyProfitReport';
import MonthlyProfitReport from './pages/admin/MonthlyProfitReport';
import ProfitCenterManager from './pages/admin/ProfitCenterManager';
import RevenueReconciliationReport from './pages/admin/RevenueReconciliationReport';
import HumanResourcesManagement from './pages/admin/HumanResourcesManagement';
import FloatingContactButtons from './components/FloatingContactButtons';

import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { UIProvider } from './context/UIContext';
import siteConfig from './config/site';
import { accountApi } from './services/api';

function App() {
  const [siteReady, setSiteReady] = useState(false);

  useEffect(() => {
    const resolveSite = async () => {
      const configuredSiteCode = String(siteConfig.SITE_CODE || '').trim();
      const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');

      if (!configuredSiteCode) {
        siteConfig.accountId = null;
        siteConfig.accountName = null;

        // Keep the active admin account across reloads when the app runs without a fixed site code.
        if (!isAdminRoute) {
          localStorage.removeItem('activeAccountId');
          localStorage.removeItem('activeSiteCode');
        }

        setSiteReady(true);
        return;
      }

      try {
        const res = await accountApi.resolve(configuredSiteCode);
        siteConfig.accountId = res.data.id;
        siteConfig.accountName = res.data.name;

        // Don't overwrite activeAccountId if we are in admin panel
        if (!window.location.pathname.startsWith('/admin')) {
            localStorage.setItem('activeAccountId', res.data.id);
        } else if (!localStorage.getItem('activeAccountId')) {
            localStorage.setItem('activeAccountId', res.data.id);
        }

        localStorage.setItem('activeSiteCode', configuredSiteCode);
      } catch (err) {
        console.warn('Could not resolve site_code, using defaults:', err.message);
      } finally {
        setSiteReady(true);
      }
    };
    resolveSite();
  }, []);

  if (!siteReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-background-light">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="font-ui text-xs uppercase tracking-widest text-stone">Đang kết nối cửa hàng...</p>
        </div>
      </div>
    );
  }

  const isQuickReplySidebarMode = typeof window !== 'undefined'
    && window.location.pathname === '/admin/quick-replies'
    && new URLSearchParams(window.location.search).get('mode') === 'zalo-sidebar';

  return (
    <UIProvider>
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <Routes>
              {/* ─── Storefront (Website bán hàng - Public) ─── */}
              <Route element={<StorefrontLayout />}>
                <Route index element={<StorefrontHome />} />
                <Route path="products" element={<StorefrontProducts />} />
                <Route path="product/:slugOrId" element={<StorefrontProductDetail />} />
                <Route path="san-pham" element={<StorefrontProducts />} />
                <Route path="san-pham/:slugOrId" element={<StorefrontProductDetail />} />
                <Route path="danh-muc/:slug" element={<StorefrontProducts />} />
                <Route path="dat-hang" element={<StorefrontCheckout />} />
                <Route path="stores" element={<StoreLocationsPage />} />
                <Route path="about" element={<About />} />
                <Route path="blog" element={<Blog />} />
                <Route path="blog/:slug" element={<PostDetail />} />
              </Route>

              {/* ─── Legacy Pages (Giữ lại) ─── */}
              <Route path="/old" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="shop" element={<Shop />} />
                <Route path="details" element={<Navigate to="/old/shop" replace />} />
                <Route path="details/:id" element={<ProductDetail />} />
                <Route path="about" element={<About />} />
                <Route path="cart" element={<Cart />} />
                <Route path="checkout" element={<Checkout />} />
                <Route path="blog" element={<Blog />} />
                <Route path="blog/:slug" element={<PostDetail />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="dashboard" element={<UserDashboard />} />
              </Route>

              <Route path="/cam-on" element={<OrderThankYou />} />
              <Route path="/old/cam-on" element={<OrderThankYou />} />
              <Route path="/cart" element={<Navigate to="/old/cart" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />

              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="products" element={<ProductList />} />
                <Route path="products/new" element={<ProductForm />} />
                <Route path="products/edit/:id" element={<ProductForm />} />
                <Route path="reviews" element={<ProductReviewManager />} />
                <Route path="product-faqs" element={<ProductFaqManager />} />
                <Route path="categories" element={<CategoryList />} />
                <Route path="attributes" element={<AttributeList />} />
                <Route path="menus" element={<MenuList />} />
                <Route path="accounts" element={<AccountList />} />
                <Route path="warehouses" element={<WarehouseList />} />
                <Route path="shipments" element={<ShipmentList />} />
                <Route path="pending-orders" element={<Navigate to="/admin/leads" replace />} />
                <Route path="orders" element={<OrderList />} />
                <Route path="orders/new" element={<OrderForm />} />
                <Route path="orders/edit/:id" element={<OrderForm />} />
                <Route path="inventory" element={<InventoryMovement />} />
                <Route path="inventory/vi-tri-ke" element={<WarehouseShelfManager />} />
                <Route path="inventory/ma-thay-the" element={<ProductReplacementManager mode="manage" />} />
                <Route path="inventory/tra-ma-kho" element={<ProductReplacementManager mode="lookup" />} />
                <Route path="inventory/:section" element={<InventoryMovement />} />
                <Route path="customers" element={<CustomerManagement />} />
                <Route path="leads" element={<LeadList />} />
                <Route path="telesales" element={<TelesalesCrm />} />
                <Route path="quick-replies" element={<QuickReplies />} />
                <Route path="blog" element={<BlogList />} />
                <Route path="blog/new" element={<BlogForm />} />
                <Route path="blog/edit/:id" element={<BlogForm />} />
                <Route path="settings" element={<SiteSettings />} />
                <Route path="storefront-themes" element={<Navigate to="/admin/settings?tab=themes" replace />} />
                <Route path="shipping-settings" element={<ShippingSettingsPage />} />
                <Route path="ai-training" element={<AiTrainingManager />} />
                <Route path="users" element={<UserList />} />
                <Route path="reports" element={<SalesReportPage />} />
                <Route path="reports/web-analytics" element={<WebAnalyticsReport />} />
                <Route path="finance/fixed-costs" element={<FixedCostTracker />} />
                <Route path="finance/funds" element={<FundManagement />} />
                <Route path="finance/debts" element={<DebtManagement />} />
                <Route path="finance/assets" element={<AssetSummary />} />
                <Route path="finance/daily-profit" element={<DailyProfitReport />} />
                <Route path="finance/monthly-profit" element={<MonthlyProfitReport />} />
                <Route path="finance/profit-centers" element={<ProfitCenterManager />} />
                <Route path="finance/revenue-reconciliation" element={<RevenueReconciliationReport />} />
                <Route path="payroll" element={<HumanResourcesManagement />} />
                <Route path="finance/*" element={<Navigate to="/admin" replace />} />
                <Route path="order-status-settings" element={<OrderStatusSettings />} />
                <Route path="carrier-mappings" element={<Navigate to="/admin/shipping-settings?tab=mapping" replace />} />
                <Route path="orders/:id" element={<OrderDetail />} />
              </Route>
            </Routes>
            {!isQuickReplySidebarMode && <FloatingContactButtons />}
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </UIProvider>
  );
}

export default App;
