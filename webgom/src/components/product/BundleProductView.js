'use client';

import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';
import Image from 'next/image';

export default function BundleProductView({ 
  product, 
  displayPrice, 
  formatPrice, 
  getImageUrl,
  images,
  activeIndex,
  setActiveIndex,
  bundleItems,
  updateBundleItemQuantity,
  removeBundleItem,
  handleAddToCart,
  handleBuyNow
}) {
  // Group items by category for the bundle design
  const groupedBundleItems = bundleItems.reduce((acc, item) => {
    const groupName = item.category?.name || 'Sản phẩm đi kèm';
    if (!acc[groupName]) {
      acc[groupName] = [];
    }
    acc[groupName].push(item);
    return acc;
  }, {});

  return (
    <div className={styles.mainGrid}>
      <div className={styles.galleryColumn}>
        <div className={styles.galleryContainer}>
          <div className={styles.mainImage}>
             <Image
                src={getImageUrl(images[activeIndex])}
                alt={product.name}
                fill
                style={{ objectFit: 'cover' }}
                priority
              />
              <div className={styles.imageCaption}>
                <h3 className={styles.captionTitle}>"Không gian thờ tự trang nghiêm, chuẩn phong thủy"</h3>
                <p className={styles.captionSub}>Phối cảnh thực tế: Bộ sản phẩm men rạn cổ dát vàng tại tư gia.</p>
              </div>
          </div>
          
          <div className={styles.thumbnails}>
            {images.slice(0, 4).map((img, idx) => (
              <button 
                key={idx}
                className={`${styles.thumbBtn} ${activeIndex === idx ? styles.thumbActive : ''}`}
                onClick={() => setActiveIndex(idx)}
              >
                <Image
                  src={getImageUrl(img)}
                  alt={`${product.name} thumbnail ${idx + 1}`}
                  fill
                  style={{ objectFit: 'cover' }}
                />
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '4rem' }}>
          <SpecificationList product={product} />
          <ActionLinks />
          <TrustBadges />
        </div>
      </div>

      <div className={styles.infoColumn}>
        <div className={styles.scrollableConfig}>
          <div className={styles.bundleHeader}>
             <h2 className={styles.groupedTitle}>Cấu hình bộ sản phẩm</h2>
             <p className={styles.groupedSub}>Cá nhân hóa bộ đồ thờ theo kích thước ban thờ gia đình bạn.</p>
          </div>

          <div className={styles.bundleItemsList}>
            {Object.entries(groupedBundleItems).map(([groupName, items]) => (
              <div key={groupName} className={styles.bundleGroup}>
                <h3 className={styles.bundleGroupTitle}>{groupName}</h3>
                <div className={styles.bundleItemsInnerList}>
                  {items.map((item) => (
                    <div key={item.id} className={styles.bundleItem}>
                      <div className={styles.bundleItemThumb}>
                        <Image
                          src={getImageUrl(item.images?.[0] || item.primary_image)}
                          alt={item.name}
                          fill
                          style={{ objectFit: 'cover' }}
                        />
                      </div>
                      <div className={styles.bundleItemInfo}>
                        <span className={styles.bundleItemType}>{item.category?.name || 'SẢN PHẨM'}</span>
                        <span className={styles.bundleItemName}>{item.name}</span>
                        <span className={styles.bundleItemPrice}>{formatPrice(item.price)}</span>
                      </div>
                      <div className={styles.bundleItemActions}>
                        <div className={styles.miniQuantity}>
                          <button 
                            className={styles.miniQBtn}
                            onClick={() => updateBundleItemQuantity(item.id, item.qty - 1)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>remove</span>
                          </button>
                          <span className={styles.miniQValue}>{String(item.qty).padStart(2, '0')}</span>
                          <button 
                            className={styles.miniQBtn}
                            onClick={() => updateBundleItemQuantity(item.id, item.qty + 1)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
                          </button>
                        </div>
                        {!item.pivot?.is_required && (
                          <button 
                            className={styles.deleteItemBtn}
                            onClick={() => removeBundleItem(item.id)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.bundleSummary}>
            <div className={styles.summaryPrice}>
              <div>
                <p className={styles.summaryLabel}>tổng cộng dự kiến</p>
                <div className={styles.summaryTotal}>{formatPrice(displayPrice)}</div>
              </div>
              <div className={styles.summaryMeta}>
                Sản phẩm: {bundleItems.length}/{bundleItems.length}
              </div>
            </div>
            <div className={styles.buyGrid}>
              <button className={styles.btnPrimary} onClick={handleBuyNow}>
                Đặt hàng ngay
              </button>
              <button className={styles.btnOutline} onClick={handleAddToCart}>
                Thêm vào giỏ
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
