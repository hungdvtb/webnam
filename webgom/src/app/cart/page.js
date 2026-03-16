'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import config from '@/lib/config';
import { placeWebOrder } from '@/lib/api';
import styles from './cart.module.css';

export default function CartPage() {
  const { cartItems, removeFromCart, updateQuantity, updateItem, cartCount, cartTotal, clearCart } = useCart();
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    customer_name: '',
    phone: '',
    address: '',
    email: '',
    notes: '',
    paymentMethod: 'cod'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  const getImageUrl = (item) => {
    const img = item.image;
    if (!img) return 'https://placehold.co/120';
    if (img.url && img.url.startsWith('http')) return img.url;
    if (img.path) {
      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
      return `${config.storageUrl}/${cleanPath}`;
    }
    return 'https://placehold.co/120';
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handlePaymentMethodChange = (method) => {
    setFormData(prev => ({ ...prev, paymentMethod: method }));
  };

  const handleRemoveSubItem = (cartKey, subItemId) => {
    const item = cartItems.find(i => i.cartKey === cartKey);
    if (!item) return;

    const newGroupedItems = item.groupedItems.filter(gi => gi.id !== subItemId);
    // Ideally we should recalculate price here if needed, but for now we just filter
    updateItem(cartKey, { groupedItems: newGroupedItems });
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    
    if (!formData.customer_name || !formData.phone || !formData.address) {
      alert('Vui lòng điền các thông tin bắt buộc.');
      return;
    }

    setIsSubmitting(true);
    try {
      const orderData = {
        ...formData,
        items: cartItems.map(item => ({
          product_id: item.id,
          quantity: item.quantity,
          options: item.options,
          sub_items: item.groupedItems?.map(gi => gi.id)
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

  if (isOrderSuccess) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.textAccent}`} style={{ fontSize: '100px', marginBottom: '2rem' }}>verified_user</span>
            <h2 className={styles.pageTitle} style={{ fontSize: '2.5rem' }}>ĐẶT HÀNG THÀNH CÔNG</h2>
            <p className={styles.pageSubtitle} style={{ fontSize: '1.2rem', margin: '1rem 0 2.5rem' }}>
              Mã đơn hàng của bạn là <strong>{orderNumber}</strong>. <br/>
              Nghệ nhân của chúng tôi sẽ liên hệ bạn sớm nhất để xác nhận đơn hàng độc phẩm này.
            </p>
            <Link href="/" className={styles.ctaButton} style={{ width: 'auto', padding: '1.25rem 3rem', display: 'inline-block' }}>
              QUAY LẠI CỬA HÀNG
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.emptyIcon}`}>shopping_cart_off</span>
            <h2 className={styles.pageTitle}>GIỎ HÀNG ĐANG TRỐNG</h2>
            <p className={styles.pageSubtitle}>Hãy chọn những tác phẩm gốm sứ ưng ý để khởi đầu di sản của riêng bạn.</p>
            <Link href="/products" className={styles.ctaButton} style={{ marginTop: '2.5rem', display: 'inline-block', width: 'auto', padding: '1.25rem 3rem' }}>
              BẮT ĐẦU MUA SẮM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cartPage}>
      <main className="container">
        <div className={styles.pageHeader}>
          <h2 className={styles.pageTitle}>TRÌNH THANH TOÁN</h2>
          <p className={styles.pageSubtitle}>Hoàn tất quy trình để sở hữu sản phẩm gốm sứ độc bản</p>
        </div>

        <div className={styles.checkoutGrid}>
          <div className={styles.mainContent}>
            
            {/* Section 1: Shopping Cart */}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>1</span>
                <h3 className={styles.sectionTitle}>Giỏ hàng của bạn</h3>
              </div>
              
              <div className={styles.cartList}>
                {cartItems.map((item) => (
                  <div key={item.cartKey} className={styles.cartItem}>
                    <div className={styles.itemMain}>
                      <div className={styles.itemImage}>
                        <Image 
                          src={getImageUrl(item)}
                          alt={item.name}
                          fill
                          style={{ objectFit: 'cover' }}
                          unoptimized
                        />
                      </div>
                      <div className={styles.itemDetails}>
                        <div className={styles.itemHeader}>
                          <h4 className={styles.itemName}>{item.name}</h4>
                          <button 
                            className={styles.iconBtn} 
                            onClick={() => removeFromCart(item.cartKey)}
                          >
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>
                        <p className={styles.itemMeta}>
                          Mã sản phẩm: {item.sku} | {item.groupedItems?.length > 0 ? 'Combo Bộ Sưu Tập' : 'Tác Phẩm Đơn'}
                        </p>
                        
                        <div className={styles.itemActions}>
                          <div className={styles.quantityCtrl}>
                            <button onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}>-</button>
                            <input type="text" value={item.quantity} readOnly />
                            <button onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}>+</button>
                          </div>
                          <div className={styles.itemPrice}>{formatPrice(item.price * item.quantity)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Sub-items (Combo feature) */}
                    {item.groupedItems?.length > 0 && (
                      <div className={styles.itemGroup}>
                        <span className={styles.groupLabel}>Sản phẩm trong combo (Có thể bỏ bớt)</span>
                        <div className={styles.groupChildren}>
                          {item.groupedItems.map((gi) => (
                            <div key={gi.id} className={styles.childItem}>
                              <div className={styles.childIcon}>
                                <span className="material-symbols-outlined">
                                  {gi.category_id === 1 ? 'coffee' : 'verified'}
                                </span>
                              </div>
                              <span className={styles.childName}>{gi.quantity}x {gi.name}</span>
                              {gi.is_required ? (
                                <span className={styles.textMuted} style={{ fontSize: '0.8rem', opacity: 0.5 }}>(Bắt buộc)</span>
                              ) : (
                                <button 
                                  className={styles.childRemove} 
                                  onClick={() => handleRemoveSubItem(item.cartKey, gi.id)}
                                >
                                  Loại bỏ
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <Link href="/products" className={styles.mt4} style={{ fontWeight: 600, fontSize: '0.9rem', textDecoration: 'underline', color: 'var(--accent)', display: 'inline-block' }}>
                + Tiếp tục mua sắm
              </Link>
            </section>

            {/* Section 2: Delivery Details */}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>2</span>
                <h3 className={styles.sectionTitle}>Thông tin giao hàng</h3>
              </div>
              
              <div className={styles.formGrid}>
                <div className={styles.inputGroup}>
                  <label>Họ và tên</label>
                  <input 
                    className={styles.inputField} 
                    type="text" 
                    name="customer_name"
                    placeholder="Nguyễn Văn A" 
                    value={formData.customer_name}
                    onChange={handleInputChange}
                    required 
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>Số điện thoại</label>
                  <input 
                    className={styles.inputField} 
                    type="tel" 
                    name="phone"
                    placeholder="090 123 4567" 
                    value={formData.phone}
                    onChange={handleInputChange}
                    required 
                  />
                </div>
                <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
                  <label>Địa chỉ nhận hàng</label>
                  <input 
                    className={styles.inputField} 
                    type="text" 
                    name="address"
                    placeholder="Số nhà, tên đường, Phường/Xã..." 
                    value={formData.address}
                    onChange={handleInputChange}
                    required 
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>Email (Không bắt buộc)</label>
                  <input 
                    className={styles.inputField} 
                    type="email" 
                    name="email"
                    placeholder="email@example.com" 
                    value={formData.email}
                    onChange={handleInputChange}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>Ghi chú đơn hàng</label>
                  <textarea 
                    className={styles.inputField} 
                    name="notes"
                    placeholder="Yêu cầu riêng về đóng gói, vận chuyển..." 
                    style={{ height: '46px', resize: 'none' }}
                    value={formData.notes}
                    onChange={handleInputChange}
                  ></textarea>
                </div>
              </div>
            </section>

            {/* Section 3: Payment Method */}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>3</span>
                <h3 className={styles.sectionTitle}>Phương thức thanh toán</h3>
              </div>
              
              <div className={styles.paymentOptions}>
                <div 
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'cod' ? styles.activeOption : ''}`}
                  onClick={() => handlePaymentMethodChange('cod')}
                >
                  <input type="radio" name="paymentOption" checked={formData.paymentMethod === 'cod'} readOnly />
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Giao hàng và thu tiền (COD)</span>
                    <span className={styles.paymentSubtext}>Thanh toán khi bạn nhận được sản phẩm tại nhà.</span>
                  </div>
                  <span className={`material-symbols-outlined ${styles.textAccent}`} style={{ fontSize: '24px' }}>local_shipping</span>
                </div>
                
                <div 
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'bank' ? styles.activeOption : ''}`}
                  onClick={() => handlePaymentMethodChange('bank')}
                >
                  <input type="radio" name="paymentOption" checked={formData.paymentMethod === 'bank'} readOnly />
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Chuyển khoản ngân hàng</span>
                    <span className={styles.paymentSubtext}>Thông tin tài khoản sẽ hiện sau khi nhấn đặt hàng.</span>
                  </div>
                  <span className={`material-symbols-outlined ${styles.textAccent}`} style={{ fontSize: '24px' }}>account_balance</span>
                </div>
              </div>
            </section>

          </div>

          {/* Sidebar */}
          <aside>
            <div className={styles.summaryCard}>
              <h3>Tóm tắt đơn hàng</h3>
              
              <div className={styles.summaryBody}>
                <div className={styles.summaryRow}>
                  <span>Tạm tính ({cartCount} sản phẩm)</span>
                  <span>{formatPrice(cartTotal)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Phí vận chuyển</span>
                  <span>Miễn phí</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Mã ưu đãi (LỘC XUÂN)</span>
                  <span className={styles.textAccent}>- 0₫</span>
                </div>
                
                <div className={styles.totalRow}>
                  <span>Tổng cộng</span>
                  <span className={styles.totalPrice}>{formatPrice(cartTotal)}</span>
                </div>
              </div>
              
              <button 
                className={styles.ctaButton}
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'ĐANG XỬ LÝ...' : 'HOÀN TẤT ĐẶT HÀNG'}
              </button>
              
              <div className={styles.trustBadges}>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>verified</span>
                  <span>Chất lượng cao cấp</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>package_2</span>
                  <span>Đóng gói an toàn</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>history</span>
                  <span>Bảo hành 5 năm</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
