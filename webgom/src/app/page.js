import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';
import { getStorefrontData } from '@/lib/api';
import config from '@/lib/config';

export default async function Home() {
  let homepageData = null;
  try {
    const data = await getStorefrontData();
    homepageData = data;
  } catch (error) {
    console.error("Failed to load homepage data:", error);
  }

  // Fallback categories if API fails
  const categories = homepageData?.categories || [
    { name: 'Gốm Men Lam', slug: 'gom-men-lam' },
    { name: 'Gốm Men Rạn', slug: 'gom-men-ran' },
    { name: 'Bộ Trà Cao Cấp', slug: 'bo-am-tra-dao' },
    { name: 'Tượng Nghệ Thuật', slug: 'tuong-phong-thuy' },
    { name: 'Gia Dụng Sang Trọng', slug: 'gia-dung' },
    { name: 'Đèn Trang Trí', slug: 'den-trang-tri' },
    { name: 'Quà Tặng Doanh Nghiệp', slug: 'qua-tang' },
  ];

  const featuredProducts = homepageData?.featured_products || [];

  return (
    <main>
      <div className={`container ${styles.mainLayout}`}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className="material-symbols-outlined">menu</span>
            <h2>DANH MỤC</h2>
          </div>
          <nav className={styles.categoryNav}>
            {categories.map((cat, idx) => (
              <a key={idx} href={`/category/${cat.slug}`}>
                {cat.name} <span className="material-symbols-outlined">chevron_right</span>
              </a>
            ))}
          </nav>
        </aside>

        <section className={styles.heroSection}>
          <div className={styles.heroBanner}>
            <Image 
              src="/hero.png" 
              alt="GÔM ĐẠI THÀNH Hero" 
              fill 
              sizes="100vw"
              style={{ objectFit: 'cover' }}
              priority
            />
            <div className={styles.heroOverlay}></div>
            <div className={styles.heroContent}>
              <p className={styles.heroSubtitle}>BỘ SƯU TẬP ĐỘC BẢN</p>
              <h2 className={styles.heroTitle}>TINH HOA<br/>ĐẤT VIÊT</h2>
              <button className="btn-primary">KHÁM PHÁ NGAY</button>
            </div>
          </div>
        </section>

        <div className={styles.heroSideBanners}>
          <div className={`${styles.sideBanner}`} style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDuJs7AEMW5BhRiTSb6HeuhqnehDWIXBJds5S-R4L7gDvpu9iRvjXOGw9G0PFNgaxhJe-p-uoJgHcdw0wwn3HpBgOH_Awt-IyHbfEmm8ztyGUOqQXdci4NRkuWvSQbvzr6-OYszJLUl47ZUdhbLMdy_U1dAubiH8hgKD_LwNLAGjbSde-MB-ZNygaaXRRKVh17dSQ_yVPq6WWaZSP7fGSDoPVIECAtWjokE2NQrJngScemh2Thmj0rIrgpd62eaP0brQZqTXTA7eY4')" }}>
            <div className={styles.bannerText}>
              <p>SẢN PHẨM NỔI BẬT</p>
              <h3>Bình Gốm Nghệ Thuật</h3>
            </div>
          </div>
          <div className={`${styles.sideBanner}`} style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCL8CT-l51lMCT946rK_56c6yrKRQ8qNjsmozS76KD5fPP74uXgux_dU0p7MJgArP1VLoqrMQP89W1Eh21bbMcszzGkdVT5U6-W11iE_PJzV4n9QKhekz7xbBJltqVgf7a84MqOIF0mGJ77l0NHY8qjRlFk5I1a4Dgdw39k0oQgGzK7P8SPlmTLOriljINStY_J-2Y6E9QypdKeQS5LkcdKgI0AXE54mnWyDVJ1qOSQ2nDhhNnHj-Johvt9IAA7tyqBitaY2d-ZZ0k')" }}>
            <div className={styles.bannerText}>
              <p>QUÀ TẶNG ĐẶC BIỆT</p>
              <h3>Ấm Chén Trà Đạo</h3>
            </div>
          </div>
        </div>
      </div>

      <section className={`container ${styles.valuesSection}`}>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">auto_fix_high</span>
          <h4>QUY TRÌNH CHẾ TÁC</h4>
          <p>Thủ công tỉ mỉ từng công đoạn</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">brush</span>
          <h4>NGHỆ NHÂN BÁT TRÀNG</h4>
          <p>Hội tụ những đôi tay tài hoa nhất</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">factory</span>
          <h4>DÂY CHUYỀN HIỆN ĐẠI</h4>
          <p>Kết hợp truyền thống và công nghệ</p>
        </div>
        <div className={styles.valueCard}>
          <span className="material-symbols-outlined">public</span>
          <h4>PHÂN PHỐI TOÀN QUỐC</h4>
          <p>Giao hàng an toàn và nhanh chóng</p>
        </div>
      </section>

      {/* Dynamic Products Group 1 */}
      {featuredProducts.length > 0 && (
        <section className={`container ${styles.productsSection}`}>
          <div className={styles.sectionHeader}>
            <div className={styles.headerLeft}>
              <h2 className={styles.sectionTitle}>SẢN PHẨM NỔI BẬT</h2>
              <div className={styles.sectionTabs}>
                <a href="#" className={styles.active}>TẤT CẢ</a>
              </div>
            </div>
            <a href="/products" className={styles.viewAll}>
              Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
            </a>
          </div>
          
          <div className={styles.productsGrid}>
            {featuredProducts.map((product) => (
              <Link href={`/product/${product.slug}`} key={product.id} className={styles.productCard}>
                <div className={styles.productImage}>
                  {product.primary_image ? (
                     <Image 
                        src={product.primary_image.url && product.primary_image.url.startsWith('http') 
                          ? product.primary_image.url 
                          : `${config.storageUrl}/${product.primary_image.path.startsWith('/') ? product.primary_image.path.substring(1) : product.primary_image.path}`} 
                        alt={product.name} 
                        fill 
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        style={{ objectFit: 'cover' }}
                        unoptimized
                      />
                  ) : (
                    <div className={styles.imagePlaceholder}>
                      <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#ccc' }}>image</span>
                    </div>
                  )}
                  {product.is_featured && <span className={`${styles.badge} ${styles.badgeHot}`}>HOT</span>}
                </div>
                <div className={styles.productInfo}>
                  <div className={styles.stars}>
                    {[...Array(5)].map((_, s) => (
                      <span key={s} className="material-symbols-outlined star">star</span>
                    ))}
                  </div>
                  <h4 className={styles.productName}>{product.name}</h4>
                  <div className={styles.productPrice}>
                    <span className={styles.currentPrice}>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Static Fallback if no featured products */}
      {featuredProducts.length === 0 && (
         <section className={`container ${styles.productsSection}`}>
         <div className={styles.sectionHeader}>
           <div className={styles.headerLeft}>
             <h2 className={styles.sectionTitle}>GỐM SỨ CAO CẤP</h2>
             <div className={styles.sectionTabs}>
               <a href="#" className={styles.active}>Mới nhất</a>
               <a href="#">Xem nhiều</a>
               <a href="#">Khuyến mãi</a>
             </div>
           </div>
           <a href="#" className={styles.viewAll}>
             Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
           </a>
         </div>
         
         <div className={styles.productsGrid}>
           {[1, 2, 3, 4].map((i) => (
             <div key={i} className={styles.productCard}>
               <div className={styles.productImage}>
                 <div className={styles.imagePlaceholder}></div>
                 {i === 1 && <span className={`${styles.badge} ${styles.badgeHot}`}>HOT</span>}
                 {i === 2 && <span className={`${styles.badge} ${styles.badgeSale}`}>-15%</span>}
               </div>
               <div className={styles.productInfo}>
                 <div className={styles.stars}>
                   {[...Array(5)].map((_, s) => (
                     <span key={s} className="material-symbols-outlined star" style={{ color: 'var(--accent)' }}>star</span>
                   ))}
                 </div>
                 <h4 className={styles.productName}>Bình Tỳ Bà Men Lam Vẽ Tay Cao Cấp Bát Tràng</h4>
                 <div className={styles.productPrice}>
                   <span className={styles.currentPrice}>2.850.000đ</span>
                   {i < 3 && <span className={styles.oldPrice}>3.500.000đ</span>}
                 </div>
               </div>
             </div>
           ))}
         </div>
       </section>
      )}
    </main>
  );
}
