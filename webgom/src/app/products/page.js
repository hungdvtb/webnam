import Link from 'next/link';
import Image from 'next/image';
import { getWebProducts, getWebCategories, getWebCategory } from '@/lib/api';
import config from '@/lib/config';
import styles from './products.module.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: "Sản Phẩm Gốm Sứ Bát Tràng | Di Sản Gốm Việt",
  description: "Khám phá bộ sưu tập gốm sứ nghệ thuật độc bản, từ gốm men lam truyền thống đến những tác phẩm hiện đại.",
};

import InfiniteProductList from '@/components/InfiniteProductList';
import CategoryDropdown from '@/components/CategoryDropdown';

export default async function ProductsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const currentCategorySlug = resolvedSearchParams?.category || '';
  const currentSort = resolvedSearchParams?.sort || 'newest';
  const searchQuery = resolvedSearchParams?.search || '';

  // Fetch initial data
  let productsData = { data: [], current_page: 1, next_page_url: null };
  let categories = [];
  let categoryInfo = null;

  try {
    const promises = [
      getWebProducts({
        category: currentCategorySlug,
        sort: currentSort,
        search: searchQuery,
        per_page: 20
      }),
      getWebCategories()
    ];

    if (currentCategorySlug) {
      promises.push(getWebCategory(currentCategorySlug));
    }

    const results = await Promise.all(promises);
    productsData = results[0];
    categories = results[1];
    if (currentCategorySlug) {
      categoryInfo = results[2];
    }
  } catch (error) {
    console.error("Failed to fetch products/categories:", error);
  }

  // Default values if categoryInfo is missing fields
  let bannerUrl = "https://lh3.googleusercontent.com/aida-public/AB6AXuCDQ8Ea-asj4MqNWt__DC14rBckeakuNrV4NeBMt1KCPfXxhonNyKfLtopIUEa12ifSxvcDQ-OEHDokx9XbrB7xiT-_NMl1FKsLS31TQ5_6z2h-aLmO9---42ndOxzkrLzmER9niH4HEfehfwXIKcc_iuqxmlVq_OQzJOBc0GaheBG3YvVDB3l5GW0cfWi7mqLT1i6jzAv34yXKiaYA7oQXSVDCIENfxJdYyMqoykTo7LaaJVqNu-zp9nvIPb7qeebK3bjAb7CtNG4";

  if (categoryInfo?.banner_path) {
    const path = categoryInfo.banner_path.startsWith('/') ? categoryInfo.banner_path.substring(1) : categoryInfo.banner_path;
    bannerUrl = `${config.storageUrl}/${path}`;
  }

  const categoryTitle = searchQuery
    ? `Kết quả tìm kiếm: "${searchQuery}"`
    : (categoryInfo?.name || "Cửa hàng gốm sứ");
  const categoryDesc = searchQuery
    ? `Tìm thấy ${productsData.total || 0} sản phẩm phù hợp với từ khóa của bạn.`
    : categoryInfo?.description;

  // Determine relevant category for the "Explore Collection" button
  let collectionUrl = '/products';
  if (currentCategorySlug) {
    collectionUrl = `/products?category=${currentCategorySlug}`;
  } else if (productsData.data && productsData.data.length > 0) {
    const catCounts = {};
    productsData.data.forEach(p => {
      if (p.category?.slug) {
        catCounts[p.category.slug] = (catCounts[p.category.slug] || 0) + 1;
      }
    });

    let maxCount = 0;
    let bestSlug = '';
    for (const slug in catCounts) {
      if (catCounts[slug] > maxCount) {
        maxCount = catCounts[slug];
        bestSlug = slug;
      }
    }

    if (bestSlug) {
      collectionUrl = `/products?category=${bestSlug}`;
    }
  }

  return (
    <div className={styles.productsPage}>
      <main className="container py-8">
        {/* Breadcrumbs */}
        <nav className={styles.breadcrumbNav}>
          <Link href="/">Trang chủ</Link>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chevron_right</span>
          <span>Cửa hàng</span>
          {currentCategorySlug && (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chevron_right</span>
              <span className={styles.activePath}>{categoryInfo?.name || currentCategorySlug}</span>
            </>
          )}
          {searchQuery && (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chevron_right</span>
              <span className={styles.activePath}>Tìm kiếm: {searchQuery}</span>
            </>
          )}
        </nav>

        {/* Category Banner */}
        <div className={styles.categoryBanner}>
          <div className={styles.bannerOverlay}></div>
          <Image
            src={bannerUrl}
            alt={categoryTitle}
            fill
            sizes="100vw"
            style={{ objectFit: 'cover' }}
            priority
            unoptimized
          />
          <div className={styles.bannerContent}>
            <h2 className={styles.bannerTitle}>{categoryTitle}</h2>
            {categoryDesc && <p className={styles.bannerDesc}>{categoryDesc}</p>}
            <div>
              <Link href={collectionUrl} className="btn-primary" style={{ padding: '12px 32px', display: 'inline-block', textDecoration: 'none' }}>
                KHÁM PHÁ BỘ SƯU TẬP
              </Link>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>
            <span className="material-symbols-outlined" style={{ color: 'var(--accent)' }}>filter_list</span> Bộ lọc:
          </span>
          
          <CategoryDropdown 
            categories={categories} 
            currentCategorySlug={currentCategorySlug} 
          />

          <div className={styles.sortSelect}>
            <span style={{ fontSize: '14px', opacity: 0.6 }}>Sắp xếp:</span>
            <select defaultValue={currentSort}>
              <option value="newest">Phổ biến nhất</option>
              <option value="price_asc">Giá: Thấp đến Cao</option>
              <option value="price_desc">Giá: Cao đến Thấp</option>
              <option value="popular">Mới nhất</option>
            </select>
          </div>
        </div>

        <div className={styles.contentLayout}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.sidebarSection}>
              <h3 className={styles.sidebarTitle}>Danh mục</h3>
              <ul className={styles.sidebarList}>
                {categories.map((cat) => (
                  <li key={cat.id}>
                    <Link
                      href={`/products?category=${cat.slug}`}
                      className={`${styles.sidebarLink} ${currentCategorySlug === cat.slug ? styles.active : ''}`}
                    >
                      <span>{cat.name}</span>
                      <span className={styles.count}>({cat.products_count || 0})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

          </aside>

          {/* Product Grid Container */}
          <div style={{ flex: 1 }}>
            <InfiniteProductList
              initialData={productsData}
              category={currentCategorySlug}
              sort={currentSort}
              search={searchQuery}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
