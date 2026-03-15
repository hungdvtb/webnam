'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import config from '@/lib/config';
import styles from './cart.module.css';

export default function CartPage() {
  const { cartItems, removeFromCart, updateQuantity, cartCount, cartTotal, clearCart } = useCart();
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState('cod');
  
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

  const handleCheckout = (e) => {
     e.preventDefault();
     alert('Cảm ơn quý khách đã tin tưởng Di Sản Gốm Việt. Nghệ nhân của chúng tôi sẽ liên hệ sớm nhất để xác nhận đơn hàng độc phẩm này.');
     clearCart();
     router.push('/');
  };

  if (cartItems.length === 0) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.emptyIcon}`}>shopping_cart_off</span>
            <h2 className={styles.pageTitle}>Giỏ hàng của bạn đang trống</h2>
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
          <h2 className={styles.pageTitle}>Trình Thanh Toán</h2>
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
                            title="Loại bỏ"
                          >
                            <span className="material-symbols-outlined">close</span>
                          </button>
                        </div>
                        <p className={styles.itemMeta}>
                          Mã sản phẩm: {item.sku} | Loại: {item.groupedItems?.length > 0 ? 'Combo Bộ Sưu Tập' : 'Tác Phẩm Đơn'}
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
                        <span className={styles.groupLabel}>Sản phẩm trong combo (Thành phần)</span>
                        <div className={styles.groupChildren}>
                           {item.groupedItems.map((gi, idx) => (
                             <div key={idx} className={styles.childItem}>
                                <div className={styles.childIcon}>
                                  <span className="material-symbols-outlined">
                                    {gi.category_id === 1 ? 'coffee' : 'verified'}
                                  </span>
                                </div>
                                <span className={styles.childName}>{gi.quantity}x {gi.name}</span>
                                {gi.is_required ? (
                                   <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>(Bắt buộc)</span>
                                ) : (
                                   <button className={styles.childRemove} onClick={() => alert('Thành phần này đang đi kèm trong combo mặc định.')}>Mặc định</button>
                                )}
                             </div>
                           ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <Link href="/products" className={`${styles.mt4} ${styles.textAccent}`} style={{ fontWeight: 600, fontSize: '0.9rem', textDecoration: 'underline', display: 'inline-block' }}>
                + Tiếp tục mua sắm
              </Link>
            </section>

            {/* Section 2: Delivery Details */}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>2</span>
                <h3 className={styles.sectionTitle}>Thông tin giao hàng</h3>
              </div>
              
              <form className={styles.formGrid}>
                <div className={styles.inputGroup}>
                  <label>Họ và tên</label>
                  <input className={styles.inputField} type="text" placeholder="Nguyễn Văn A" required />
                </div>
                <div className={styles.inputGroup}>
                  <label>Số điện thoại</label>
                  <input className={styles.inputField} type="tel" placeholder="090 123 4567" required />
                </div>
                <div className={`${styles.inputGroup} ${styles.fullWidth}`}>
                  <label>Địa chỉ nhận hàng</label>
                  <input className={styles.inputField} type="text" placeholder="Số nhà, tên đường, Phường/Xã..." required />
                </div>
                <div className={styles.inputGroup}>
                  <label>Tỉnh / Thành phố</label>
                  <select className={styles.inputField} required defaultValue="">
                    <option value="" disabled>Chọn Tỉnh/Thành</option>
                    <option value="hanoi">Hà Nội</option>
                    <option value="hcm">TP. Hồ Chí Minh</option>
                    <option value="danang">Đà Nẵng</option>
                  </select>
                </div>
                <div className={styles.inputGroup}>
                  <label>Quận / Huyện</label>
                  <select className={styles.inputField} required defaultValue="">
                    <option value="" disabled>Chọn Quận/Huyện</option>
                  </select>
                </div>
              </form>
            </section>

            {/* Section 3: Payment Method */}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>3</span>
                <h3 className={styles.sectionTitle}>Phương thức thanh toán</h3>
              </div>
              
              <div className={styles.paymentOptions}>
                <div 
                  className={`${styles.paymentOption} ${paymentMethod === 'cod' ? styles.activeOption : ''}`}
                  onClick={() => setPaymentMethod('cod')}
                >
                  <input type="radio" name="payment" checked={paymentMethod === 'cod'} onChange={() => {}} />
                  <div className={styles.optionText}>
                    <span className={styles.optionTitle}>Giao hàng và thu tiền (COD)</span>
                    <span className={styles.optionDesc}>Thanh toán khi bạn nhận được sản phẩm tại nhà.</span>
                  </div>
                  <span className={`material-symbols-outlined ${styles.textPrimary}`} style={{ fontSize: '24px' }}>local_shipping</span>
                </div>
                
                <div 
                  className={`${styles.paymentOption} ${paymentMethod === 'bank' ? styles.activeOption : ''}`}
                  onClick={() => setPaymentMethod('bank')}
                >
                  <input type="radio" name="payment" checked={paymentMethod === 'bank'} onChange={() => {}} />
                  <div className={styles.optionText}>
                    <span className={styles.optionTitle}>Chuyển khoản ngân hàng</span>
                    <span className={styles.optionDesc}>Thông tin tài khoản sẽ hiện sau khi nhấn đặt hàng.</span>
                  </div>
                  <span className={`material-symbols-outlined ${styles.textPrimary}`} style={{ fontSize: '24px' }}>account_balance</span>
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
                  <span>Mã ưu đãi (GIAMHOT)</span>
                  <span className={styles.textAccent}>- 0₫</span>
                </div>
                
                <div className={`${styles.summaryRow} ${styles.totalRow}`}>
                  <span>Tổng cộng</span>
                  <span className={styles.totalPrice}>{formatPrice(cartTotal)}</span>
                </div>
              </div>
              
              <button 
                className={styles.ctaButton}
                onClick={handleCheckout}
              >
                Hoàn tất đặt hàng
              </button>
              
              <div className={styles.trustBadges}>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>verified</span>
                  <span>Chất lượng cao cấp</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>package</span>
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
