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
import InfiniteProductListLayout2 from '@/components/InfiniteProductListLayout2';
import CategoryDropdown from '@/components/CategoryDropdown';
import SortSelect from '@/components/SortSelect';
import AttributeFiltersDropdown from '@/components/AttributeFiltersDropdown';
import styles2 from './layout2.module.css';

export default async function ProductsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const currentCategorySlug = resolvedSearchParams?.category || '';
  const currentSort = resolvedSearchParams?.sort || 'popular';
  const searchQuery = resolvedSearchParams?.search || '';

  // Extract attributes from searchParams (e.g., attrs[color]=Red)
  const currentAttrs = {};
  Object.keys(resolvedSearchParams || {}).forEach(key => {
    if (key.startsWith('attrs[')) {
      const attrKey = key.match(/\[(.*?)\]/)[1];
      currentAttrs[attrKey] = resolvedSearchParams[key];
    }
  });

  // Fetch initial data
  let productsData = { data: [], current_page: 1, next_page_url: null, available_filters: [] };
  let categories = [];
  let categoryInfo = null;

  try {
    const promises = [
      getWebProducts({
        category: currentCategorySlug,
        sort: currentSort,
        search: searchQuery,
        attrs: currentAttrs,
        per_page: 24
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
  // Use the new high-quality generated banner as default
  let bannerUrl = "/banner-store.png";

  if (categoryInfo?.banner_path) {
    const path = categoryInfo.banner_path.startsWith('/') ? categoryInfo.banner_path.substring(1) : categoryInfo.banner_path;
    bannerUrl = `${config.storageUrl}/${path}`;
  }

  const categoryTitle = searchQuery
    ? `Kết quả tìm kiếm: "${searchQuery}"`
    : (categoryInfo?.name || "Cửa hàng gốm sứ");

  const categoryDesc = searchQuery
    ? `Tìm thấy ${productsData.total || 0} sản phẩm phù hợp với từ khóa của bạn.`
    : (categoryInfo?.description || `Khám phá bộ sưu tập ${productsData.total || 0} sản phẩm gốm sứ tinh xảo, chất lượng cao từ làng nghề Bát Tràng.`);

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

  const activeLayout = categoryInfo?.display_layout === 'layout_2' ? 'layout_2' : 'layout_1';

  if (activeLayout === 'layout_2') {
    return (
      <div className={styles2.container}>
        {/* Breadcrumbs */}
        <nav className={styles2.breadcrumbs}>
          <Link href="/" className={styles2.breadcrumbLink}>Trang chủ</Link>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', opacity: 0.4 }}>chevron_right</span>
          <Link href="/products" className={styles2.breadcrumbLink}>Cửa hàng</Link>
          {categoryInfo && (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: '14px', opacity: 0.4 }}>chevron_right</span>
              <span className={styles2.breadcrumbCurrent}>{categoryInfo.name}</span>
            </>
          )}
        </nav>

        {/* Page Header */}
        <header className={styles2.header}>
          <h1 className={styles2.title}>{categoryTitle}</h1>
          <p className={styles2.subtitle}>{categoryDesc}</p>
        </header>



        {/* Sub-category Filter (Horizontal) */}
        {categoryInfo?.children?.length > 0 && (
          <div className={styles2.subCategoryFilter} style={{ marginBottom: '1rem', display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
            {categoryInfo.children.map(child => (
              <Link 
                key={child.id}
                href={`/products?category=${child.slug}`}
                style={{
                  padding: '0.5rem 1.25rem',
                  backgroundColor: 'white',
                  border: '1px solid rgba(27, 54, 93, 0.1)',
                  borderRadius: '9999px',
                  fontSize: '0.8125rem',
                  fontWeight: '600',
                  color: '#1B365D',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s'
                }}
                className="hover-gold"
              >
                {child.name} ({child.products_count || 0})
              </Link>
            ))}
          </div>
        )}

        {/* Attribute Filters (Dropdowns) */}
        {productsData.available_filters?.length > 0 && (
          <AttributeFiltersDropdown 
            filters={productsData.available_filters}
            currentAttrs={currentAttrs}
            currentSort={currentSort}
          />
        )}


        {/* Products Grid */}
        <InfiniteProductListLayout2
          initialData={productsData}
          category={currentCategorySlug}
          sort={currentSort}
          search={searchQuery}
          initialAttrs={currentAttrs}
        />
      </div>
    );
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
            style={{ objectFit: 'cover', objectPosition: 'center' }}
            priority
          />
          <div className={styles.bannerContent}>
            <h2 className={styles.bannerTitle}>{categoryTitle}</h2>
            <p className={styles.bannerDesc}>{categoryDesc}</p>
            <Link href={collectionUrl} className="btn-accent" style={{ alignSelf: 'flex-start', padding: '0.8rem 2rem' }}>
              KHÁM PHÁ BỘ SƯU TẬP
            </Link>
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

          <SortSelect currentSort={currentSort} />
        </div>

        {/* Sub-category Filter for Layout 1 */}
        {categoryInfo?.children?.length > 0 && (
          <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {categoryInfo.children.map(child => (
              <Link 
                key={child.id}
                href={`/products?category=${child.slug}`}
                style={{
                  padding: '0.4rem 1rem',
                  backgroundColor: 'white',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  color: '#333',
                  textDecoration: 'none'
                }}
              >
                {child.name}
              </Link>
            ))}
          </div>
        )}

        <div className={styles.contentLayout}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.sidebarSection}>
              <h3 className={styles.sidebarTitle}>Danh mục</h3>
              <ul className={styles.sidebarList}>
                {(() => {
                  const renderTree = (parentId = null, level = 0) => {
                    return categories
                      .filter(cat => (parentId === null ? !cat.parent_id : cat.parent_id === parentId))
                      .map(cat => (
                        <li key={cat.id} style={{ marginLeft: level > 0 ? `${level * 12}px` : 0 }}>
                          <Link
                            href={`/products?category=${cat.slug}`}
                            className={`${styles.sidebarLink} ${currentCategorySlug === cat.slug ? styles.active : ''}`}
                            style={{ 
                              fontSize: level === 0 ? '0.9rem' : '0.85rem',
                              fontWeight: level === 0 ? '700' : '500',
                              opacity: level === 0 ? 1 : 0.8
                            }}
                          >
                            <span>{level > 0 ? '— ' : ''}{cat.name}</span>
                            <span className={styles.count}>({cat.products_count || 0})</span>
                          </Link>
                          {categories.some(c => c.parent_id === cat.id) && (
                            <ul className={styles.sidebarList}>
                              {renderTree(cat.id, level + 1)}
                            </ul>
                          )}
                        </li>
                      ));
                  };
                  return renderTree();
                })()}
              </ul>
            </div>
            {/* Attribute Filters */}
            {productsData.available_filters?.map(filter => {
              if (filter.type === 'price_range') {
                return (
                  <div key={filter.code} className={styles.sidebarSection}>
                    <h3 className={styles.sidebarTitle}>{filter.name}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                        Khoảng giá: {new Intl.NumberFormat('vi-VN').format(filter.min)} - {new Intl.NumberFormat('vi-VN').format(filter.max)}
                      </div>
                      <form action="/products" method="GET" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                         {/* Preserve other filters */}
                         {Object.entries(resolvedSearchParams || {}).map(([k, v]) => (
                           k !== 'min_price' && k !== 'max_price' && <input key={k} type="hidden" name={k} value={v} />
                         ))}
                         <input 
                           type="number" 
                           name="min_price" 
                           placeholder="Từ" 
                           defaultValue={resolvedSearchParams?.min_price}
                           style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem' }}
                         />
                         <input 
                           type="number" 
                           name="max_price" 
                           placeholder="Đến" 
                           defaultValue={resolvedSearchParams?.max_price}
                           style={{ width: '100%', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem' }}
                         />
                         <button type="submit" className="btn-accent" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
                           Lọc
                         </button>
                      </form>
                    </div>
                  </div>
                );
              }
              
              return (
                <div key={filter.code} className={styles.sidebarSection}>
                  <h3 className={styles.sidebarTitle}>{filter.name}</h3>
                  <div className={styles.checkboxList}>
                    {filter.options?.map(opt => {
                      const isActive = currentAttrs[filter.code] === opt.value || (Array.isArray(currentAttrs[filter.code]) && currentAttrs[filter.code].includes(opt.value));
                      
                      // Create new URL for this filter
                      const newParams = new URLSearchParams(resolvedSearchParams || {});
                      if (isActive) {
                        newParams.delete(`attrs[${filter.code}]`);
                        // If it was multiselect, we'd need to remove just this one, but for now let's assume single select for simple UI
                      } else {
                        newParams.set(`attrs[${filter.code}]`, opt.value);
                      }
                      
                      return (
                        <Link 
                          key={opt.value}
                          href={`/products?${newParams.toString()}`}
                          className={`${styles.checkboxItem} ${isActive ? styles.active : ''}`}
                          style={{ 
                            textDecoration: 'none', 
                            color: isActive ? 'var(--accent)' : 'inherit',
                            fontWeight: isActive ? '700' : 'normal'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                            {isActive ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                          <span>{opt.label}</span>
                          <span className={styles.count}>({opt.count})</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className={styles.sidebarPromo}>
              <h4 className={styles.promoTitle}>Bát Tràng Premium</h4>
              <p className={styles.promoText}>Tất cả sản phẩm đều được nghệ nhân vẽ tay thủ công 100%.</p>
              <button className={styles.promoBtn}>XEM CHI TIẾT CHẾ TÁC</button>
            </div>
          </aside>

          {/* Product Grid Container */}
          <div style={{ flex: 1 }}>
            <InfiniteProductList
              initialData={productsData}
              category={currentCategorySlug}
              sort={currentSort}
              search={searchQuery}
              initialAttrs={currentAttrs}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
