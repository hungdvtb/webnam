import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

import AdminLayout from './layouts/AdminLayout';
import AdminDashboard from './pages/admin/Dashboard';
import ProductList from './pages/admin/ProductList';
import ProductForm from './pages/admin/ProductForm';
import CategoryList from './pages/admin/CategoryList';
import AttributeList from './pages/admin/AttributeList';
import MenuList from './pages/admin/MenuList';
import AccountList from './pages/admin/AccountList';
import WarehouseList from './pages/admin/WarehouseList';
import ShipmentList from './pages/admin/ShipmentList';
import OrderList from './pages/admin/OrderList';
import OrderDetail from './pages/admin/OrderDetail';
import InventoryMovement from './pages/admin/InventoryMovement';
import CustomerManagement from './pages/admin/CustomerManagement';
import ReportDashboard from './pages/admin/ReportDashboard';
import BlogList from './pages/admin/BlogList';
import BlogForm from './pages/admin/BlogForm';
import BannerList from './pages/admin/BannerList';
import BannerForm from './pages/admin/BannerForm';
import SiteSettings from './pages/admin/SiteSettings';

import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { UIProvider } from './context/UIContext';
import siteConfig from './config/site';
import { accountApi } from './services/api';

function App() {
  const [siteReady, setSiteReady] = useState(false);

  useEffect(() => {
    const resolveSite = async () => {
      try {
        const res = await accountApi.resolve(siteConfig.SITE_CODE);
        siteConfig.accountId = res.data.id;
        siteConfig.accountName = res.data.name;
        localStorage.setItem('activeAccountId', res.data.id);
        localStorage.setItem('activeSiteCode', siteConfig.SITE_CODE);
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

  return (
    <UIProvider>
      <AuthProvider>
        <CartProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="shop" element={<Shop />} />
                <Route path="details" element={<ProductDetail />} />
                <Route path="details/:id" element={<ProductDetail />} />
                <Route path="about" element={<About />} />
                <Route path="cart" element={<Cart />} />
                <Route path="checkout" element={<Checkout />} />
                <Route path="blog" element={<Blog />} />
                <Route path="blog/:slug" element={<PostDetail />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
              </Route>

              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminDashboard />} />
                <Route path="products" element={<ProductList />} />
                <Route path="products/new" element={<ProductForm />} />
                <Route path="products/edit/:id" element={<ProductForm />} />
                <Route path="categories" element={<CategoryList />} />
                <Route path="attributes" element={<AttributeList />} />
                <Route path="menus" element={<MenuList />} />
                <Route path="accounts" element={<AccountList />} />
                <Route path="warehouses" element={<WarehouseList />} />
                <Route path="shipments" element={<ShipmentList />} />
                <Route path="orders" element={<OrderList />} />
                <Route path="inventory" element={<InventoryMovement />} />
                <Route path="customers" element={<CustomerManagement />} />
                <Route path="blog" element={<BlogList />} />
                <Route path="blog/new" element={<BlogForm />} />
                <Route path="blog/edit/:id" element={<BlogForm />} />
                <Route path="banners" element={<BannerList />} />
                <Route path="banners/new" element={<BannerForm />} />
                <Route path="banners/edit/:id" element={<BannerForm />} />
                <Route path="settings" element={<SiteSettings />} />
                <Route path="reports" element={<ReportDashboard />} />
                <Route path="orders/:id" element={<OrderDetail />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </CartProvider>
      </AuthProvider>
    </UIProvider>
  );
}

export default App;
