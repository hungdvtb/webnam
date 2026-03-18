'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/context/CartContext';
import config from '@/lib/config';
import { placeWebOrder } from '@/lib/api';
import styles from './cart.module.css';

export default function CartPage() {
  const { cartItems, removeFromCart, updateQuantity, updateItem, restoreCombo, cartCount, cartTotal, clearCart } = useCart();

  const [formData, setFormData] = useState({
    customer_name: '',
    phone: '',
    address: '',
    province: '',
    district: '',
    ward: '',
    email: '',
    notes: '',
    paymentMethod: 'cod'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const formatPrice = (price) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);

  const getImageUrl = (item) => {
    const img = item.image;
    if (!img) return null;
    // Full URL stored directly in image_url field (DB standard)
    if (img.image_url && img.image_url.startsWith('http')) return img.image_url;
    // Legacy url field
    if (img.url && img.url.startsWith('http')) return img.url;
    // Relative path
    if (img.path) {
      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
      return `${config.storageUrl}/${cleanPath}`;
    }
    return null;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // ── Remove a sub-item from a bundle combo (uid-aware) ──────────────────────
  // Use uid when available (new items) to safely identify each slot even when
  // the same product id appears multiple times in a combo (different variants).
  const handleRemoveSubItem = (cartKey, uid) => {
    const item = cartItems.find(i => i.cartKey === cartKey);
    if (!item) return;
    const newGroupedItems = item.groupedItems.filter(
      gi => (gi.uid ?? gi.id) !== uid
    );
    updateItem(cartKey, { groupedItems: newGroupedItems });
  };

  // ── Change qty of a single sub-item inside a combo ─────────────────────────
  const handleSubItemQty = (cartKey, uid, delta) => {
    const item = cartItems.find(i => i.cartKey === cartKey);
    if (!item) return;
    const newGroupedItems = item.groupedItems.map(gi =>
      (gi.uid ?? gi.id) === uid
        ? { ...gi, qty: Math.max(1, (gi.qty || 1) + delta) }
        : gi
    );
    updateItem(cartKey, { groupedItems: newGroupedItems });
  };

  // ── Discount: 10% per bundle item that still has ALL original sub-items ─────
  const discount = cartItems.reduce((acc, item) => {
    if (!item.groupedItems?.length) return acc;
    const originalCount = item.originalSubCount ?? item.groupedItems.length;
    const isFullCombo = item.groupedItems.length >= originalCount;
    if (!isFullCombo) return acc;
    // 10% of this item's effective subtotal (sum of sub-items)
    const subTotal = item.groupedItems.reduce(
      (s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)),
      0
    );
    return acc + (subTotal * item.quantity * 0.1);
  }, 0);

  // ── Hide "Thêm sản phẩm khác" when EVERY cart item is a combo/bundle ────────
  const hasOnlyBundles = cartItems.length > 0 &&
    cartItems.every(item => item.groupedItems?.length > 0);

  const totalAfterDiscount = cartTotal - discount;

  // ── Submit order ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!formData.customer_name || !formData.phone || !formData.address) {
      alert('Vui lòng điền các thông tin bắt buộc.');
      return;
    }
    setIsSubmitting(true);
    try {
      const fullAddress = [formData.address, formData.ward, formData.district, formData.province]
        .filter(Boolean).join(', ');
      const orderData = {
        ...formData,
        address: fullAddress,
        discount,
        total: totalAfterDiscount,
        items: cartItems.map(item => ({
          product_id: item.id,
          quantity: item.quantity,
          options: item.options,
          sub_items: item.groupedItems?.map(gi => ({ id: gi.id, qty: gi.qty || 1 }))
        }))
      };
      const response = await placeWebOrder(orderData);
      setOrderNumber(response.order_number);
      setIsOrderSuccess(true);
      clearCart();
      window.scrollTo(0, 0);
    } catch (error) {
      console.error('Order placement failed:', error);
      alert('Có lỗi xảy ra khi đặt hàng. Vui lòng thử lại sau.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─── Order success ─── */
  if (isOrderSuccess) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.textAccent}`}
              style={{ fontSize: 90, marginBottom: '1.5rem', display: 'block' }}>
              verified_user
            </span>
            <h2 className={styles.pageTitle}>ĐẶT HÀNG THÀNH CÔNG</h2>
            <p className={styles.pageSubtitle} style={{ margin: '1rem 0 2.5rem' }}>
              Mã đơn hàng của bạn là <strong>{orderNumber}</strong>.<br />
              Chúng tôi sẽ liên hệ bạn sớm nhất để xác nhận đơn hàng.
            </p>
            <Link href="/" className={styles.ctaButton}
              style={{ width: 'auto', padding: '1rem 3rem', display: 'inline-block' }}>
              QUAY LẠI CỬA HÀNG
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Empty cart ─── */
  if (cartItems.length === 0) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.emptyIcon}`}>shopping_cart_off</span>
            <h2 className={styles.pageTitle} style={{ marginBottom: '0.75rem' }}>GIỎ HÀNG ĐANG TRỐNG</h2>
            <p className={styles.pageSubtitle}>
              Hãy chọn những tác phẩm gốm sứ ưng ý để khởi đầu di sản của riêng bạn.
            </p>
            <Link href="/products" className={styles.ctaButton}
              style={{ marginTop: '2.5rem', display: 'inline-block', width: 'auto', padding: '1rem 3rem' }}>
              BẮT ĐẦU MUA SẮM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Main checkout page ─── */
  return (
    <div className={styles.cartPage}>
      <main className="container">
        <div className={styles.pageHeader}>
          <h2 className={styles.pageTitle}>Giỏ hàng &amp; Thanh toán</h2>
          <p className={styles.pageSubtitle}>
            Hoàn tất quy trình để sở hữu những tuyệt tác gốm sứ thủ công
          </p>
        </div>

        <div className={styles.checkoutGrid}>
          {/* ════ LEFT: Delivery + Payment ════ */}
          <div className={styles.mainContent}>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>1</span>
                <h3 className={styles.sectionTitle}>Thông tin giao hàng</h3>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.inputGroup}>
                  <label>Họ và tên người nhận</label>
                  <input className={styles.inputField} type="text" name="customer_name"
                    placeholder="Nhập họ và tên" value={formData.customer_name}
                    onChange={handleInputChange} required />
                </div>
                <div className={styles.inputGroup}>
                  <label>Số điện thoại</label>
                  <input className={styles.inputField} type="tel" name="phone"
                    placeholder="Nhập số điện thoại" value={formData.phone}
                    onChange={handleInputChange} required />
                </div>

                <div className={styles.threeCol}>
                  <div className={styles.inputGroup}>
                    <label>Tỉnh / Thành phố</label>
                    <select className={styles.inputField} name="province"
                      value={formData.province} onChange={handleInputChange}>
                      <option value="">Chọn Tỉnh/Thành</option>
                      <option>Hà Nội</option><option>TP. Hồ Chí Minh</option>
                      <option>Đà Nẵng</option><option>Bắc Ninh</option>
                      <option>Hải Dương</option><option>Hưng Yên</option>
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Quận / Huyện</label>
                    <select className={styles.inputField} name="district"
                      value={formData.district} onChange={handleInputChange}>
                      <option value="">Chọn Quận/Huyện</option>
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Phường / Xã</label>
                    <select className={styles.inputField} name="ward"
                      value={formData.ward} onChange={handleInputChange}>
                      <option value="">Chọn Phường/Xã</option>
                    </select>
                  </div>
                </div>

                <div className={styles.fullWidth}>
                  <div className={styles.inputGroup}>
                    <label>Địa chỉ chi tiết</label>
                    <input className={styles.inputField} type="text" name="address"
                      placeholder="Ví dụ: 123 Đường Lê Lợi" value={formData.address}
                      onChange={handleInputChange} required />
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.sectionCard} style={{ marginBottom: 0 }}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>2</span>
                <h3 className={styles.sectionTitle}>Phương thức thanh toán</h3>
              </div>

              <div className={styles.paymentOptions}>
                <div
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'bank' ? styles.activeOption : ''}`}
                  onClick={() => setFormData(p => ({ ...p, paymentMethod: 'bank' }))}
                >
                  <input type="radio" name="paymentOption" readOnly checked={formData.paymentMethod === 'bank'} />
                  <span className={`material-symbols-outlined ${styles.paymentIcon}`}>account_balance</span>
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Chuyển khoản qua ngân hàng</span>
                    <span className={styles.paymentSubtext}>Thông tin tài khoản xuất hiện sau khi đặt hàng.</span>
                  </div>
                </div>
                <div
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'cod' ? styles.activeOption : ''}`}
                  onClick={() => setFormData(p => ({ ...p, paymentMethod: 'cod' }))}
                >
                  <input type="radio" name="paymentOption" readOnly checked={formData.paymentMethod === 'cod'} />
                  <span className={`material-symbols-outlined ${styles.paymentIcon}`}>local_shipping</span>
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Giao hàng và thu tiền tại nhà (COD)</span>
                    <span className={styles.paymentSubtext}>Thanh toán khi nhận được hàng.</span>
                  </div>
                </div>
              </div>

              <button className={styles.ctaButton} onClick={handleSubmit}
                disabled={isSubmitting} id="checkout-submit-btn">
                {isSubmitting ? 'ĐANG XỬ LÝ...' : 'XÁC NHẬN THANH TOÁN'}
              </button>
              <p className={styles.ctaNote}>
                Bằng cách nhấn xác nhận, quý khách đồng ý với Điều khoản &amp; Chính sách bảo mật của Gốm Đại Thành.
              </p>
            </section>
          </div>

          {/* ════ RIGHT: Order Summary ════ */}
          <aside className={styles.sidebar}>
            <div className={styles.summaryCard}>
              <h3>Tóm Tắt Đơn Hàng</h3>

              <div className={styles.cartList}>
                {cartItems.map((item) => {
                  const imgSrc = getImageUrl(item);
                  const originalCount = item.originalSubCount ?? item.groupedItems?.length ?? 0;
                  const isFullCombo = item.groupedItems?.length > 0 &&
                    item.groupedItems.length >= originalCount;

                  // Effective price for this cart item (dynamic for bundles)
                  const effectivePrice = item.groupedItems?.length > 0
                    ? item.groupedItems.reduce((s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)), 0)
                    : item.price;

                  return (
                    <div key={item.cartKey} className={styles.cartItem}>
                      <button className={styles.removeBtn}
                        onClick={() => removeFromCart(item.cartKey)} title="Xóa">
                        <span className="material-symbols-outlined">delete</span>
                      </button>

                      <div className={styles.itemMain}>
                        <div className={styles.itemImage}>
                          {imgSrc ? (
                            <Image src={imgSrc} alt={item.name} fill
                              style={{ objectFit: 'cover' }} unoptimized />
                          ) : (
                            <div style={{
                              width: '100%', height: '100%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', background: '#F0EDE6'
                            }}>
                              <span className="material-symbols-outlined"
                                style={{ color: '#C5A065', fontSize: 26 }}>image</span>
                            </div>
                          )}
                        </div>
                        <div className={styles.itemDetails}>
                          <h4 className={styles.itemName}>{item.name}</h4>
                          <p className={styles.itemMeta}>
                            {item.sku ? `SKU: ${item.sku}` :
                              (item.groupedItems?.length > 0 ? 'Combo bộ sưu tập' : 'Tác phẩm đơn')}
                          </p>
                          <div className={styles.itemActions}>
                            <div className={styles.quantityCtrl}>
                              <button onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}>−</button>
                              <input type="text" value={item.quantity} readOnly />
                              <button onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}>+</button>
                            </div>
                            <div className={styles.itemPrice}>
                              {formatPrice(effectivePrice * item.quantity)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Sub-items for bundle/combo with qty controls */}
                      {item.groupedItems?.length > 0 && (
                        <div className={styles.itemGroup}>
                          <span className={styles.groupLabel}>Sản phẩm trong combo</span>
                          <div className={styles.groupChildren}>
                            {item.groupedItems.map((gi) => {
                              const giUid = gi.uid ?? gi.id;
                              return (
                                <div key={giUid} className={styles.childItem}>
                                  <div className={styles.childIcon}>
                                    <span className="material-symbols-outlined">check_circle</span>
                                  </div>
                                  <span className={styles.childName} style={{ flex: 1 }}>
                                    {gi.name || `Sản phẩm #${gi.id}`}
                                  </span>
                                  {/* Sub-item unit price */}
                                  <span className={styles.childPrice}>
                                    {formatPrice(parseFloat(gi.price || 0))}
                                  </span>
                                  {/* Sub-item qty controls */}
                                  <div className={styles.subQtyCtrl}>
                                    <button onClick={() => handleSubItemQty(item.cartKey, giUid, -1)}>−</button>
                                    <span>{gi.qty || 1}</span>
                                    <button onClick={() => handleSubItemQty(item.cartKey, giUid, 1)}>+</button>
                                  </div>
                                  <button
                                    className={styles.childRemove}
                                    onClick={() => handleRemoveSubItem(item.cartKey, giUid)}
                                  >
                                    Xóa
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {/* Combo status & restore — separated below the list */}
                          <div className={styles.comboFooter}>
                            {isFullCombo ? (
                              <div className={styles.comboTag} style={{ color: '#2E7D32' }}>
                                ✓ Combo đầy đủ — Ưu đãi 10% đang áp dụng
                              </div>
                            ) : (
                              <>
                                <div className={styles.comboTag} style={{ color: '#94A3B8' }}>
                                  Mua đủ {originalCount} sản phẩm để được ưu đãi 10%
                                </div>
                                <button
                                  className={styles.restoreComboBtn}
                                  onClick={() => restoreCombo(item.cartKey)}
                                  title="Khôi phục lại đầy đủ các món trong combo"
                                >
                                  ↩ Khôi phục combo
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!hasOnlyBundles && (
                <Link href="/products" className={styles.addMoreBtn}>
                  + THÊM SẢN PHẨM KHÁC
                </Link>
              )}

              <div className={styles.summaryBody}>
                <div className={styles.summaryRow}>
                  <span>Tạm tính ({cartCount} sản phẩm)</span>
                  <span style={{ fontWeight: 600 }}>{formatPrice(cartTotal)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Phí vận chuyển</span>
                  <span style={{ fontWeight: 600 }}>Miễn phí</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Ưu đãi combo (10%)</span>
                  <span className={styles.discountText} style={{ fontWeight: 600 }}>
                    {discount > 0 ? `− ${formatPrice(discount)}` : '− 0₫'}
                  </span>
                </div>
              </div>

              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Tổng cộng</span>
                <span className={styles.totalPrice}>{formatPrice(totalAfterDiscount)}</span>
              </div>

              <div className={styles.trustBadges}>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>verified</span>
                  <span>Bảo hành 10 năm</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>local_shipping</span>
                  <span>Đóng gói chuyên dụng</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>workspace_premium</span>
                  <span>Chứng nhận Nghệ nhân</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
