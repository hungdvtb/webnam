import Link from 'next/link';
import Image from 'next/image';
import { getWebProducts, getWebCategories, getWebCategory } from '@/lib/api';
import styles from './products.module.css';
import styles2 from './layout2.module.css';
import InfiniteProductList from '@/components/InfiniteProductList';
import InfiniteProductListLayout2 from '@/components/InfiniteProductListLayout2';
import CategoryDropdown from '@/components/CategoryDropdown';
import DesktopCategorySidebar from '@/components/DesktopCategorySidebar';
import SortSelect from '@/components/SortSelect';
import AttributeFiltersDropdown from '@/components/AttributeFiltersDropdown';
import { resolveMediaUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Sản phẩm gốm sứ Bát Tràng | GỐM ĐẠI THÀNH',
  description: 'Khám phá bộ sưu tập gốm sứ nghệ thuật độc bản, từ gốm men lam truyền thống đến những tác phẩm hiện đại.',
};

const PRODUCTS_PER_PAGE = 40;
const PAGE_GAP = 'gap';

function parsePageParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function appendParam(params, key, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => appendParam(params, key, item));
    return;
  }

  params.append(key, String(value));
}

function buildProductsHref(currentParams, overrides = {}) {
  const params = new URLSearchParams();

  Object.entries(currentParams || {}).forEach(([key, value]) => {
    appendParam(params, key, value);
  });

  Object.entries(overrides).forEach(([key, value]) => {
    params.delete(key);
    appendParam(params, key, value);
  });

  const query = params.toString();
  return query ? `/products?${query}` : '/products';
}

function getVisiblePages(currentPage, lastPage) {
  if (lastPage <= 7) {
    return Array.from({ length: lastPage }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, PAGE_GAP, lastPage];
  }

  if (currentPage >= lastPage - 3) {
    return [1, PAGE_GAP, lastPage - 4, lastPage - 3, lastPage - 2, lastPage - 1, lastPage];
  }

  return [1, PAGE_GAP, currentPage - 1, currentPage, currentPage + 1, PAGE_GAP, lastPage];
}

function renderPagination({ stylesModule, currentPage, lastPage, total, itemCount, currentParams }) {
  if (!lastPage || lastPage <= 1) {
    return null;
  }

  const startItem = total > 0 ? ((currentPage - 1) * PRODUCTS_PER_PAGE) + 1 : 0;
  const endItem = total > 0 ? startItem + itemCount - 1 : 0;
  const visiblePages = getVisiblePages(currentPage, lastPage);

  return (
    <div className={stylesModule.paginationWrap}>
      <p className={stylesModule.paginationMeta}>
        Hiển thị {startItem}-{endItem} trên {total} sản phẩm
      </p>

      <nav className={stylesModule.paginationNav} aria-label="Phân trang sản phẩm">
        {currentPage > 1 ? (
          <Link
            href={buildProductsHref(currentParams, { page: currentPage - 1 })}
            className={`${stylesModule.paginationLink} ${stylesModule.paginationLinkWide}`}
          >
            Trước
          </Link>
        ) : (
          <span
            className={`${stylesModule.paginationLink} ${stylesModule.paginationLinkWide} ${stylesModule.paginationLinkDisabled}`}
            aria-disabled="true"
          >
            Trước
          </span>
        )}

        {visiblePages.map((pageItem, index) => {
          if (pageItem === PAGE_GAP) {
            return (
              <span key={`gap-${index}`} className={stylesModule.paginationEllipsis}>
                ...
              </span>
            );
          }

          const isActive = currentPage === pageItem;

          return (
            <Link
              key={pageItem}
              href={buildProductsHref(currentParams, { page: pageItem })}
              className={`${stylesModule.paginationLink} ${isActive ? stylesModule.paginationLinkActive : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {pageItem}
            </Link>
          );
        })}

        {currentPage < lastPage ? (
          <Link
            href={buildProductsHref(currentParams, { page: currentPage + 1 })}
            className={`${stylesModule.paginationLink} ${stylesModule.paginationLinkWide}`}
          >
            Sau
          </Link>
        ) : (
          <span
            className={`${stylesModule.paginationLink} ${stylesModule.paginationLinkWide} ${stylesModule.paginationLinkDisabled}`}
            aria-disabled="true"
          >
            Sau
          </span>
        )}
      </nav>
    </div>
  );
}

export default async function ProductsPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const requestedCategorySlug = resolvedSearchParams?.category || '';
  const currentSort = resolvedSearchParams?.sort || 'popular';
  const searchQuery = resolvedSearchParams?.search || '';
  const currentPage = parsePageParam(resolvedSearchParams?.page);

  const currentAttrs = {};
  Object.keys(resolvedSearchParams || {}).forEach((key) => {
    if (key.startsWith('attrs[')) {
      const attrKey = key.match(/\[(.*?)\]/)?.[1];
      if (attrKey) {
        currentAttrs[attrKey] = resolvedSearchParams[key];
      }
    }
  });

  let productsData = {
    data: [],
    current_page: currentPage,
    last_page: 1,
    total: 0,
    available_filters: [],
  };
  let categories = [];
  let categoryInfo = null;

  const [productsResult, categoriesResult, categoryInfoResult] = await Promise.allSettled([
    getWebProducts({
      category: requestedCategorySlug,
      sort: currentSort,
      search: searchQuery,
      attrs: currentAttrs,
      page: currentPage,
      per_page: PRODUCTS_PER_PAGE,
    }),
    getWebCategories(),
    requestedCategorySlug ? getWebCategory(requestedCategorySlug) : Promise.resolve(null),
  ]);

  if (productsResult.status === 'fulfilled') {
    productsData = productsResult.value;
  } else {
    console.error('Failed to fetch products:', productsResult.reason);
  }

  if (categoriesResult.status === 'fulfilled') {
    categories = categoriesResult.value;
  } else {
    console.error('Failed to fetch categories:', categoriesResult.reason);
  }

  if (categoryInfoResult.status === 'fulfilled') {
    categoryInfo = categoryInfoResult.value;
  } else if (requestedCategorySlug) {
    console.warn(`Category slug "${requestedCategorySlug}" could not be resolved. Falling back to the full product collection.`, categoryInfoResult.reason);
  }

  const currentCategorySlug = categoryInfo?.slug
    || (categories.some((category) => category.slug === requestedCategorySlug) ? requestedCategorySlug : '');

  let bannerUrl = '/banner-store.png';

  if (categoryInfo?.banner_path) {
    bannerUrl = resolveMediaUrl(categoryInfo.banner_path) || bannerUrl;
  }

  const categoryTitle = searchQuery
    ? `Kết quả tìm kiếm: "${searchQuery}"`
    : (categoryInfo?.name || 'Cửa hàng gốm sứ');

  const categoryDesc = searchQuery
    ? `Tìm thấy ${productsData.total || 0} sản phẩm phù hợp với từ khóa của bạn.`
    : (categoryInfo?.meta_description || categoryInfo?.description || `Khám phá bộ sưu tập ${productsData.total || 0} sản phẩm gốm sứ tinh xảo, chất lượng cao từ làng nghề Bát Tràng.`);

  let collectionUrl = '/products';
  if (currentCategorySlug) {
    collectionUrl = `/products?category=${currentCategorySlug}`;
  } else if (productsData.data?.length > 0) {
    const categoryCounts = {};

    productsData.data.forEach((product) => {
      if (product.category?.slug) {
        categoryCounts[product.category.slug] = (categoryCounts[product.category.slug] || 0) + 1;
      }
    });

    let maxCount = 0;
    let bestSlug = '';

    Object.entries(categoryCounts).forEach(([slug, count]) => {
      if (count > maxCount) {
        maxCount = count;
        bestSlug = slug;
      }
    });

    if (bestSlug) {
      collectionUrl = `/products?category=${bestSlug}`;
    }
  }

  const activeLayout = categoryInfo?.display_layout === 'layout_2' ? 'layout_2' : 'layout_1';

  if (activeLayout === 'layout_2') {
    return (
      <div className={styles2.container}>
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

        <header className={styles2.header}>
          <h1 className={styles2.title}>{categoryTitle}</h1>
          <p className={styles2.subtitle}>{categoryDesc}</p>
        </header>

        {categoryInfo?.children?.length > 0 && (
          <div className={styles2.subCategoryFilter}>
            {categoryInfo.children.map((child) => (
              <Link
                key={child.id}
                href={`/products?category=${child.slug}`}
                className={`${styles2.subCategoryChip} ${currentCategorySlug === child.slug ? styles2.subCategoryChipActive : ''}`}
              >
                {child.name} ({child.products_count || 0})
              </Link>
            ))}
          </div>
        )}

        {productsData.available_filters?.length > 0 && (
          <AttributeFiltersDropdown
            filters={productsData.available_filters}
            currentAttrs={currentAttrs}
            currentSort={currentSort}
          />
        )}

        <InfiniteProductListLayout2 initialData={productsData} />

        {renderPagination({
          stylesModule: styles2,
          currentPage: productsData.current_page || currentPage,
          lastPage: productsData.last_page || 1,
          total: productsData.total || 0,
          itemCount: productsData.data?.length || 0,
          currentParams: resolvedSearchParams,
        })}
      </div>
    );
  }

  return (
    <div className={styles.productsPage}>
      <main className="container py-8">
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
            <Link href={collectionUrl} className={styles.bannerCta}>
              KHÁM PHÁ BỘ SƯU TẬP
            </Link>
          </div>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.filterBarHeader}>
            <span className={styles.filterLabel}>
              <span className="material-symbols-outlined" style={{ color: 'var(--accent)' }}>filter_list</span> Bộ lọc:
            </span>
          </div>

          <div className={styles.filterBarControls}>
            <CategoryDropdown
              categories={categories}
              currentCategorySlug={currentCategorySlug}
            />

            <SortSelect currentSort={currentSort} />
          </div>
        </div>

        {categoryInfo?.children?.length > 0 && (
          <div className={styles.subCategoryScroller}>
            {categoryInfo.children.map((child) => (
              <Link
                key={child.id}
                href={`/products?category=${child.slug}`}
                className={`${styles.subCategoryChip} ${currentCategorySlug === child.slug ? styles.subCategoryChipActive : ''}`}
              >
                {child.name}
              </Link>
            ))}
          </div>
        )}

        <div className={styles.contentLayout}>
          <aside className={styles.sidebar}>
            <DesktopCategorySidebar
              categories={categories}
              currentCategorySlug={currentCategorySlug}
            />

            {productsData.available_filters?.map((filter) => {
              if (filter.type === 'price_range') {
                return (
                  <div key={filter.code} className={styles.sidebarSection}>
                    <h3 className={styles.sidebarTitle}>{filter.name}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                        Khoảng giá: {new Intl.NumberFormat('vi-VN').format(filter.min)} - {new Intl.NumberFormat('vi-VN').format(filter.max)}
                      </div>
                      <form action="/products" method="GET" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {Object.entries(resolvedSearchParams || {}).map(([key, value]) => (
                          key !== 'min_price' && key !== 'max_price' && key !== 'page' && (
                            <input key={key} type="hidden" name={key} value={value} />
                          )
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
                    {filter.options?.map((option) => {
                      const isActive = currentAttrs[filter.code] === option.value
                        || (Array.isArray(currentAttrs[filter.code]) && currentAttrs[filter.code].includes(option.value));

                      const nextHref = buildProductsHref(resolvedSearchParams, {
                        [`attrs[${filter.code}]`]: isActive ? null : option.value,
                        page: null,
                      });

                      return (
                        <Link
                          key={option.value}
                          href={nextHref}
                          className={`${styles.checkboxItem} ${isActive ? styles.checkboxItemActive : ''}`}
                          style={{
                            textDecoration: 'none',
                            color: isActive ? 'var(--accent)' : 'inherit',
                            fontWeight: isActive ? '700' : 'normal',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                            {isActive ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                          <span>{option.label}</span>
                          <span className={styles.count}>({option.count})</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </aside>

          <div className={styles.productGridPanel}>
            <InfiniteProductList initialData={productsData} />

            {renderPagination({
              stylesModule: styles,
              currentPage: productsData.current_page || currentPage,
              lastPage: productsData.last_page || 1,
              total: productsData.total || 0,
              itemCount: productsData.data?.length || 0,
              currentParams: resolvedSearchParams,
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
