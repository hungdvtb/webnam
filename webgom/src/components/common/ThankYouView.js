"use client";

import React from 'react';
import Link from 'next/link';

export default function ThankYouView({ orderNumber, formData, cartItems, cartTotal, discount, bankSettings }) {
  const finalTotal = (cartTotal || 0) - (discount || 0);

  const formatPrice = (price) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price || 0);

  const formatDate = () =>
    new Date().toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });

  const getItemImage = (item) =>
    item.main_image ||
    item.image ||
    (item.images?.find(i => i.is_primary) || item.images?.[0])?.image_url ||
    null;

  const paymentMethod = formData?.paymentMethod || formData?.payment_method || 'cod';
  const isBankTransfer = paymentMethod === 'bank';

  const name = formData?.customer_name || formData?.name || '';
  const phone = formData?.phone || formData?.customer_phone || '';
  const address = [formData?.address, formData?.ward, formData?.district, formData?.province]
    .filter(Boolean).join(', ');

  return (
    <div className="ty-page">
      {/* ══ CARD ══ */}
      <div className="ty-card">

        {/* ─── Banner Header ─── */}
        <div className="ty-banner">
          <div className="ty-banner-overlay" />
          <div className="ty-banner-bar ty-banner-bar--top" />
          <div className="ty-banner-bar ty-banner-bar--bottom" />

          <div className="ty-banner-content">
            <div className="ty-check-icon">
              <span className="material-symbols-outlined">check_circle</span>
            </div>
            <h1 className="ty-banner-title">Giao dịch Hoàn tất</h1>
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="ty-body">

          {/* Hero text */}
          <div className="ty-hero-text">
            <h2 className="ty-heading">Cảm ơn Quý khách đã trân trọng di sản!</h2>
            <p className="ty-subtitle">
              Đơn hàng của Quý khách đã được tiếp nhận và đang được các nghệ nhân chuẩn bị kỹ lưỡng tại làng nghề.
              Một thư xác nhận chi tiết đã được gửi đến địa chỉ email của Quý khách.
            </p>
          </div>

          {/* ─── Info grid ─── */}
          <div className="ty-info-grid">

            {/* Order Info */}
            <div className="ty-info-block">
              <h3 className="ty-info-title">
                <span className="material-symbols-outlined">receipt_long</span>
                Chi tiết Đơn hàng
              </h3>
              <div className="ty-info-rows">
                <div className="ty-info-row">
                  <span className="ty-label">Mã số đơn hàng:</span>
                  <span className="ty-value ty-value--bold">#{orderNumber}</span>
                </div>
                <div className="ty-info-row">
                  <span className="ty-label">Ngày đặt:</span>
                  <span className="ty-value">{formatDate()}</span>
                </div>
                <div className="ty-info-row">
                  <span className="ty-label">Phương thức:</span>
                  <span className="ty-value">
                    {isBankTransfer ? 'Chuyển khoản Ngân hàng' : 'Thanh toán khi nhận hàng (COD)'}
                  </span>
                </div>
                <div className="ty-info-row ty-info-row--total">
                  <span className="ty-label ty-label--total">Tổng cộng:</span>
                  <span className="ty-total">{formatPrice(finalTotal)}</span>
                </div>
              </div>
            </div>

            {/* Shipping Info */}
            <div className="ty-info-block">
              <h3 className="ty-info-title">
                <span className="material-symbols-outlined">local_shipping</span>
                Thông tin Giao nhận
              </h3>
              <div className="ty-shipping-info">
                {name && <p className="ty-ship-name">{name}</p>}
                {phone && (
                  <p className="ty-ship-row">
                    <span className="material-symbols-outlined">call</span> {phone}
                  </p>
                )}
                {address && (
                  <p className="ty-ship-row ty-ship-row--addr">
                    <span className="material-symbols-outlined">location_on</span>
                    <span>{address}</span>
                  </p>
                )}
                <p className="ty-estimate">Dự kiến giao hàng: 3-5 ngày làm việc</p>
              </div>
            </div>
          </div>

          {/* ─── Products ─── */}
          {cartItems && cartItems.length > 0 && (
            <div className="ty-products">
              <h3 className="ty-section-title">
                <span className="material-symbols-outlined">inventory_2</span>
                Sản phẩm đã chọn
              </h3>
              <div className="ty-product-list">
                {cartItems.map((item, idx) => {
                  const imgSrc = getItemImage(item);
                  const itemPrice = item.groupedItems?.length > 0
                    ? item.groupedItems.reduce((s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)), 0)
                    : (item.price || 0);
                  return (
                    <div key={idx} className="ty-product-row">
                      <div className="ty-product-img">
                        {imgSrc
                          ? <img src={imgSrc} alt={item.name} />
                          : <span className="material-symbols-outlined">image</span>
                        }
                      </div>
                      <div className="ty-product-info">
                        <h4 className="ty-product-name">{item.name}</h4>
                        <p className="ty-product-meta">Đơn giá: {formatPrice(itemPrice)}</p>
                      </div>
                      <div className="ty-product-right">
                        <p className="ty-product-total">{formatPrice(itemPrice * (item.quantity || 1))}</p>
                        <p className="ty-product-qty">
                          Số lượng: {(item.quantity || 1) < 10 ? `0${item.quantity || 1}` : item.quantity || 1}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Bank Transfer ─── */}
          {isBankTransfer && bankSettings && (
            <div className="ty-bank">
              <h4 className="ty-bank-title">
                <span className="material-symbols-outlined">payments</span>
                Hướng dẫn Chuyển khoản
              </h4>
              <div className="ty-bank-body">
                <div className="ty-bank-details">
                  <p><strong>Ngân hàng:</strong> {bankSettings.bank_name}</p>
                  <p>
                    <strong>Số tài khoản:</strong>{' '}
                    <span className="ty-bank-account">{bankSettings.bank_account_number}</span>
                  </p>
                  <p><strong>Chủ tài khoản:</strong> {bankSettings.bank_account_name}</p>
                  <div className="ty-bank-divider" />
                  <p>
                    <strong>Nội dung CK:</strong>{' '}
                    <span className="ty-bank-ref">
                      {bankSettings.bank_transfer_template?.replace('{order_number}', orderNumber) || orderNumber}
                    </span>
                  </p>
                </div>
                {bankSettings.bank_qr_code && (
                  <div className="ty-bank-qr">
                    <img src={bankSettings.bank_qr_code} alt="QR Chuyển khoản" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── CTA Buttons ─── */}
          <div className="ty-actions">
            <Link href="/products" className="ty-btn ty-btn--primary">
              TIẾP TỤC MUA SẮM
            </Link>
            <Link href="/account" className="ty-btn ty-btn--outline">
              XEM LỊCH SỬ ĐƠN HÀNG
            </Link>
          </div>
        </div>

        {/* ─── Footer strip ─── */}
        <div className="ty-footer-strip">
          <p>
            Mọi thắc mắc vui lòng liên hệ:{' '}
            <span className="ty-contact">1900 1234</span>{' '}
            hoặc{' '}
            <span className="ty-contact">hotro@disangomviet.vn</span>
          </p>
        </div>
      </div>

      <style>{`
        /* ── Page wrapper ── */
        .ty-page {
          background: #F9F5F0;
          min-height: 100vh;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 3rem 1rem 4rem;
          font-family: 'EB Garamond', serif;
        }

        /* ── Card ── */
        .ty-card {
          background: #fff;
          border: 3px double #C5A059;
          box-shadow: 0 20px 60px rgba(27,54,93,0.12);
          border-radius: 0.5rem;
          overflow: hidden;
          width: 100%;
          max-width: 880px;
          animation: tyFadeUp 0.7s ease-out both;
        }
        @keyframes tyFadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Banner ── */
        .ty-banner {
          position: relative;
          height: 200px;
          background: #1B365D;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .ty-banner-overlay {
          position: absolute; inset: 0;
          background:
            linear-gradient(135deg, rgba(197,160,89,0.12) 0%, transparent 60%),
            repeating-linear-gradient(45deg, transparent, transparent 24px, rgba(197,160,89,0.04) 24px, rgba(197,160,89,0.04) 25px);
        }
        .ty-banner-bar {
          position: absolute; left: 0; right: 0; height: 3px;
          background: linear-gradient(90deg, #C5A059 0%, rgba(197,160,89,0.4) 50%, #C5A059 100%);
        }
        .ty-banner-bar--top { top: 0; }
        .ty-banner-bar--bottom { bottom: 0; }
        .ty-banner-content {
          position: relative; z-index: 2; text-align: center;
        }
        .ty-check-icon {
          width: 68px; height: 68px; border-radius: 50%;
          background: #C5A059; color: #fff;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 1rem;
          box-shadow: 0 6px 20px rgba(197,160,89,0.45);
        }
        .ty-check-icon .material-symbols-outlined { font-size: 2.4rem; }
        .ty-banner-title {
          color: #fff;
          font-family: 'Playfair Display', serif;
          font-size: clamp(1.6rem, 4vw, 2.4rem);
          font-weight: 700;
          font-style: italic;
          letter-spacing: 0.02em;
          margin: 0;
          text-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        /* ── Body ── */
        .ty-body { padding: 2.5rem 2.5rem 2rem; }
        @media (max-width: 640px) { .ty-body { padding: 1.5rem 1.25rem 1.5rem; } }

        /* Hero text */
        .ty-hero-text { text-align: center; margin-bottom: 2.5rem; }
        .ty-heading {
          font-family: 'Playfair Display', serif;
          font-size: clamp(1.3rem, 3vw, 1.8rem);
          color: #1B365D;
          margin: 0 0 0.75rem;
          font-style: italic;
        }
        .ty-subtitle {
          font-size: 1rem; color: #64748b;
          line-height: 1.7; max-width: 600px; margin: 0 auto;
        }

        /* Info grid */
        .ty-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          margin-bottom: 2.5rem;
        }
        @media (max-width: 640px) { .ty-info-grid { grid-template-columns: 1fr; } }

        .ty-info-block {
          background: rgba(249,245,240,0.6);
          border: 1px solid rgba(197,160,89,0.25);
          border-radius: 0.25rem;
          overflow: hidden;
        }
        .ty-info-title {
          font-family: 'Playfair Display', serif;
          font-size: 1rem; font-weight: 700; color: #1B365D;
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.85rem 1.25rem;
          border-bottom: 1px solid rgba(197,160,89,0.2);
          margin: 0;
        }
        .ty-info-title .material-symbols-outlined { font-size: 1.2rem; color: #C5A059; }

        .ty-info-rows { padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
        .ty-info-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
        .ty-info-row--total { border-top: 1px solid rgba(197,160,89,0.2); padding-top: 0.75rem; margin-top: 0.25rem; }
        .ty-label { font-size: 0.85rem; color: #64748b; flex-shrink: 0; }
        .ty-label--total { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
        .ty-value { font-size: 0.9rem; color: #1B365D; text-align: right; }
        .ty-value--bold { font-weight: 700; font-size: 0.95rem; }
        .ty-total { font-size: 1.4rem; font-weight: 800; color: #1B365D; }

        /* Shipping */
        .ty-shipping-info { padding: 1rem 1.25rem; }
        .ty-ship-name { font-size: 1.05rem; font-weight: 700; color: #1B365D; margin: 0 0 0.5rem; }
        .ty-ship-row {
          display: flex; align-items: flex-start; gap: 0.4rem;
          font-size: 0.9rem; color: #64748b; margin: 0.35rem 0;
        }
        .ty-ship-row .material-symbols-outlined { font-size: 1rem; color: #C5A059; flex-shrink: 0; margin-top: 2px; }
        .ty-estimate { font-size: 0.82rem; font-style: italic; color: #C5A059; margin: 0.75rem 0 0; }

        /* Products */
        .ty-products { margin-bottom: 2.5rem; }
        .ty-section-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.1rem; font-weight: 700; color: #1B365D;
          display: flex; align-items: center; gap: 0.5rem;
          margin: 0 0 1rem;
        }
        .ty-section-title .material-symbols-outlined { color: #C5A059; font-size: 1.2rem; }
        .ty-product-list {
          border: 1px solid rgba(197,160,89,0.2);
          border-radius: 0.25rem; overflow: hidden;
        }
        .ty-product-row {
          display: flex; align-items: center; gap: 1rem;
          padding: 0.9rem 1.25rem;
          border-bottom: 1px solid rgba(197,160,89,0.12);
          background: #fff;
          transition: background 0.2s;
        }
        .ty-product-row:last-child { border-bottom: none; }
        .ty-product-row:hover { background: #fdfaf5; }
        .ty-product-img {
          width: 64px; height: 64px; flex-shrink: 0;
          border: 1px solid rgba(197,160,89,0.25); border-radius: 2px;
          overflow: hidden; display: flex; align-items: center; justify-content: center;
          background: #F9F5F0;
        }
        .ty-product-img img { width: 100%; height: 100%; object-fit: cover; }
        .ty-product-img .material-symbols-outlined { font-size: 1.6rem; color: rgba(197,160,89,0.5); }
        .ty-product-info { flex: 1; min-width: 0; }
        .ty-product-name {
          font-family: 'Playfair Display', serif; font-size: 0.98rem;
          color: #1B365D; margin: 0 0 0.25rem; font-weight: 600;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ty-product-meta { font-size: 0.8rem; color: #94a3b8; margin: 0; }
        .ty-product-right { text-align: right; flex-shrink: 0; }
        .ty-product-total { font-weight: 700; color: #1B365D; font-size: 0.95rem; margin: 0; }
        .ty-product-qty { font-size: 0.78rem; color: #94a3b8; margin: 0.2rem 0 0; }

        /* Bank */
        .ty-bank {
          margin-bottom: 2.5rem;
          padding: 1.5rem;
          background: #fdf9f0;
          border: 1px solid rgba(197,160,89,0.35);
          border-radius: 0.25rem;
        }
        .ty-bank-title {
          display: flex; align-items: center; gap: 0.5rem;
          font-family: 'Playfair Display', serif; font-size: 1.05rem;
          font-weight: 700; color: #1B365D; margin: 0 0 1.25rem;
        }
        .ty-bank-title .material-symbols-outlined { color: #C5A059; }
        .ty-bank-body { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
        .ty-bank-details { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; color: #374151; }
        .ty-bank-divider { height: 1px; background: rgba(197,160,89,0.2); margin: 0.5rem 0; }
        .ty-bank-account { font-size: 1.15rem; font-weight: 800; color: #1B365D; letter-spacing: 0.06em; }
        .ty-bank-ref { font-style: italic; font-weight: 700; color: #C5A059; }
        .ty-bank-qr {
          width: 120px; height: 120px; flex-shrink: 0;
          background: #fff; border: 1px solid rgba(197,160,89,0.3);
          padding: 4px; border-radius: 4px;
        }
        .ty-bank-qr img { width: 100%; height: 100%; object-fit: contain; }

        /* Actions */
        .ty-actions {
          display: flex; flex-wrap: wrap; gap: 1rem;
          justify-content: center; padding-top: 0.75rem;
        }
        .ty-btn {
          padding: 0.85rem 2.5rem;
          font-family: 'Playfair Display', serif; font-weight: 700;
          font-size: 0.85rem; letter-spacing: 0.12em; text-transform: uppercase;
          cursor: pointer; transition: all 0.2s; text-align: center; border-radius: 2px;
          min-width: 200px;
        }
        .ty-btn--primary {
          background: #1B365D; color: #fff; border: 2px solid #1B365D;
        }
        .ty-btn--primary:hover { background: #0e2040; border-color: #0e2040; }
        .ty-btn--outline {
          background: transparent; color: #C5A059; border: 2px solid #C5A059;
        }
        .ty-btn--outline:hover { background: #C5A059; color: #fff; }

        /* Footer strip */
        .ty-footer-strip {
          background: #F9F5F0; padding: 1rem 2.5rem;
          border-top: 1px solid rgba(197,160,89,0.15);
          text-align: center;
        }
        .ty-footer-strip p { font-size: 0.88rem; font-style: italic; color: #94a3b8; margin: 0; }
        .ty-contact { color: #C5A059; font-weight: 700; }

        @media (max-width: 640px) {
          .ty-card { border-width: 2px; }
          .ty-banner { height: 160px; }
          .ty-banner-title { font-size: 1.5rem; }
          .ty-check-icon { width: 56px; height: 56px; }
          .ty-check-icon .material-symbols-outlined { font-size: 2rem; }
          .ty-btn { min-width: 100%; }
        }
      `}</style>
    </div>
  );
}
