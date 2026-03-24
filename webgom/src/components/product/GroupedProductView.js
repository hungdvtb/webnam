'use client';

import Image from 'next/image';
import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';

import Breadcrumb from './common/Breadcrumb';

export default function GroupedProductView({
  product,
  displayPrice,
  formatPrice,
  selectedGroupItems,
  toggleGroupItem,
  getImageUrl,
  images,
  videoUrl,
  activeIndex,
  setActiveIndex,
  quantity,
  setQuantity,
  handleAddToCart,
  handleBuyNow,
  additionalInfo
}) {
  return (
    <>
      <Breadcrumb product={product} />
      <div className={styles.mainGrid}>
        <div className={styles.galleryColumn}>
          <ProductGallery
            images={images}
            videoUrl={videoUrl}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
            getImageUrl={getImageUrl}
            productName={product.name}
          />
        </div>

        <div className={styles.infoColumn}>
          <div className={styles.infoWrapper}>
            <div className={styles.titleSection}>
              <h1 className={styles.title}>{product.name}</h1>
            </div>

            <div className={styles.priceContainer}>
              <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
              {product.original_price > displayPrice && (
                <>
                  <span className={styles.originalPrice}>{formatPrice(product.original_price)}</span>
                  <p className={styles.savingsText}>
                    Tiết kiệm {formatPrice(product.original_price - displayPrice)} khi mua trọn bộ
                  </p>
                </>
              )}
            </div>

            <div className={styles.groupedCard}>
              <h3 className={styles.groupedTitle}>Cấu hình bộ sản phẩm</h3>
              <p className={styles.groupedSub}>Bạn có thể tùy chỉnh các thành phần bên dưới. Giá sẽ tự động cập nhật.</p>

              <div className={styles.groupedList}>
                {product.grouped_items?.map((item) => {
                  const isSelected = selectedGroupItems.includes(item.id);
                  const isRequired = item.is_required;

                  return (
                    <div
                      key={item.id}
                      className={`${styles.groupedItem} ${isSelected ? styles.itemSelected : ''} ${isRequired ? styles.itemRequired : ''}`}
                      onClick={() => !isRequired && toggleGroupItem(item.id)}
                    >
                      <div className={styles.itemCheck}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isRequired}
                          onChange={() => { }}
                        />
                      </div>
                      <div className={styles.itemThumb}>
                        <Image
                          src={getImageUrl(item.primary_image || { path: item.main_image })}
                          alt={item.name}
                          fill
                          style={{ objectFit: 'cover' }}
                          unoptimized
                        />
                      </div>
                      <div className={styles.itemInfo}>
                        <span className={styles.itemName}>
                          {item.name} {isRequired && <span className={styles.requiredTag}>(Mặc định)</span>}
                        </span>
                        <span className={styles.itemMeta}>Số lượng: {item.quantity || 1} | {formatPrice(item.price)}/món</span>
                      </div>
                      <div className={styles.itemPriceSum}>
                        {formatPrice(parseFloat(item.price) * (item.quantity || 1))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <SpecificationList product={product} />
            <ActionLinks additionalInfo={additionalInfo} />

            <div className={styles.actionSectionMB}>
              <QuantitySelector quantity={quantity} setQuantity={setQuantity} />
              <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
            </div>

            <TrustBadges />
          </div>
        </div>
      </div>
    </>
  );
}
