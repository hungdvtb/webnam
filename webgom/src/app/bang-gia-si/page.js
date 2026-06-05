import Link from "next/link";
import { getWebCategories, getWebProducts, getWebSiteSettings } from "@/lib/api";
import {
  resolveEntityImageUrl,
} from "@/lib/media";
import { buildProductCardKey } from "@/lib/productLinks";
import WholesaleControls from "./WholesaleControls";
import WholesaleOrderTable from "./WholesaleOrderTable";
import { buildWholesaleMediaImages, buildWholesaleVideoHref } from "./wholesaleMedia";
import styles from "./wholesale.module.css";

const PRODUCTS_PER_PAGE = 36;
const WHOLESALE_PRODUCT_TYPES = "simple,configurable";
const CATEGORY_PROBE_PER_PAGE = 1;
const FALLBACK_PRODUCT_IMAGE = "/logo-dai-thanh.png";
const ALLOWED_SORTS = new Set(["popular", "newest", "price_asc", "price_desc"]);
const VARIANT_STOCK_MIN = 8;
const VARIANT_STOCK_RANGE = 12;

export const metadata = {
  title: "Bảng giá sỉ | Gốm Đại Thành",
  description: "Bảng giá sỉ Gốm Đại Thành dành cho đại lý, cửa hàng và khách lấy số lượng.",
};

const getFirstParamValue = (value, fallback = "") => {
  if (Array.isArray(value)) {
    return String(value[0] ?? fallback).trim();
  }

  return String(value ?? fallback).trim();
};

const parsePageParam = (value) => {
  const parsed = Number.parseInt(getFirstParamValue(value, "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const formatNumber = (value) => new Intl.NumberFormat("vi-VN").format(Number(value || 0));

const formatWholesalePrice = (value) => {
  const price = Number(value || 0);

  if (!Number.isFinite(price) || price <= 0) {
    return "Liên hệ";
  }

  if (price >= 1000 && price % 1000 === 0) {
    return `${formatNumber(price / 1000)}K`;
  }

  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(price);
};

const getDisplayPrice = (product = {}) => {
  if (product.item_type === "bundle_option") {
    const explicitPrice = Number(product.bundle_option_discounted_price ?? product.current_price ?? 0);

    if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
      return explicitPrice;
    }

    return Number(product.bundle_option_total_price ?? product.price ?? 0);
  }

  return Number(product.current_price ?? product.price ?? 0);
};

const calculateWholesalePrice = (product = {}) => {
  const currentPrice = getDisplayPrice(product);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return 0;
  }

  return Math.floor((currentPrice * 0.8) / 5000) * 5000;
};

const hashString = (value = "") => {
  const text = String(value || "");
  let hash = 0;

  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  return Math.abs(hash);
};

const getProductIdentity = (product = {}) => String(product.id || product.slug || product.name || "").trim();

const getVariantCount = (product = {}) => {
  const count = Number(product.variants_count || product.variations_count || product.variant_count || 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const hasWholesaleVariants = (product = {}) => (
  String(product?.type || product?.productType || "").toLowerCase() === "configurable"
  || product?.has_variants === true
  || product?.has_configurable_variants === true
  || String(product?.has_variants || "").toLowerCase() === "true"
  || String(product?.has_configurable_variants || "").toLowerCase() === "true"
  || getVariantCount(product) > 0
);

const buildVariantDisplayStock = (product = {}, variantIndex = 0) => (
  VARIANT_STOCK_MIN + (hashString(`variant-stock:${getProductIdentity(product)}:${variantIndex}`) % VARIANT_STOCK_RANGE)
);

const buildStandaloneDisplayStock = (product = {}, index = 0) => (
  20 + (hashString(`${product.id || ""}:${product.sku || ""}:${product.name || ""}:${index}`) % 81)
);

const buildDisplayStock = (product = {}, index = 0) => {
  if (hasWholesaleVariants(product)) {
    const variantCount = getVariantCount(product);

    if (variantCount > 0) {
      return Array.from({ length: variantCount }).reduce(
        (sum, _, variantIndex) => sum + buildVariantDisplayStock(product, variantIndex),
        0,
      );
    }
  }

  return buildStandaloneDisplayStock(product, index);
};

const normalizeContactHref = (value = "", provider = "") => {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (/^(https?:|mailto:|tel:|zalo:)/i.test(trimmed)) {
    return trimmed;
  }

  if (provider === "zalo") {
    const zaloId = trimmed.replace(/[^\d]/g, "");

    if (zaloId) {
      return `https://zalo.me/${zaloId}`;
    }
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
};

const resolveZaloContactHref = (settings = {}) => {
  const zaloSource = (
    settings?.zalo_link
    || settings?.zalo_url
    || settings?.zaloUrl
    || settings?.contact_zalo
    || ""
  );
  const zaloHref = normalizeContactHref(zaloSource, "zalo");

  if (zaloHref) {
    return zaloHref;
  }

  return normalizeContactHref(settings?.contact_phone || settings?.footer_hotline || "", "zalo");
};

const categoryHasWholesaleProducts = async (category = {}) => {
  const slug = String(category?.slug || "").trim();

  if (!slug || Number(category?.products_count || 0) <= 0) {
    return false;
  }

  try {
    const payload = await getWebProducts({
      category: slug,
      types: WHOLESALE_PRODUCT_TYPES,
      page: 1,
      per_page: CATEGORY_PROBE_PER_PAGE,
      sort: "popular",
    });

    return Number(payload?.total || 0) > 0;
  } catch (error) {
    console.error(`Failed to check wholesale category "${slug}":`, error);
    return false;
  }
};

const filterWholesaleCategories = async (categories = []) => {
  const source = Array.isArray(categories) ? categories : [];

  if (source.length === 0) {
    return [];
  }

  const visibility = await Promise.all(source.map(categoryHasWholesaleProducts));
  return source.filter((category, index) => visibility[index]);
};

const buildWholesaleRowProduct = (product = {}) => ({
  id: product.id ?? null,
  name: product.name || "",
  slug: product.slug || "",
  sku: product.sku || "",
  type: product.type || "",
  productType: product.productType || "",
  item_type: product.item_type || "",
  itemType: product.itemType || "",
  has_variants: product.has_variants ?? false,
  has_configurable_variants: product.has_configurable_variants ?? false,
  variants_count: product.variants_count ?? 0,
  variations_count: product.variations_count ?? 0,
  variant_count: product.variant_count ?? 0,
  bundle_option_uid: product.bundle_option_uid || "",
  bundleOptionUid: product.bundleOptionUid || "",
  option_uid: product.option_uid || "",
  bundle_option_key: product.bundle_option_key || "",
  bundleOptionKey: product.bundleOptionKey || "",
  option_key: product.option_key || "",
  bundle_option_title: product.bundle_option_title || "",
  bundleOptionTitle: product.bundleOptionTitle || "",
  option_title: product.option_title || "",
});

const buildHref = (params = {}, updates = {}) => {
  const nextParams = new URLSearchParams();
  const source = {
    search: params.search,
    category: params.category,
    sort: params.sort,
    page: params.page,
    ...updates,
  };

  Object.entries(source).forEach(([key, value]) => {
    const normalized = String(value ?? "").trim();

    if (normalized && !(key === "sort" && normalized === "popular") && !(key === "page" && normalized === "1")) {
      nextParams.set(key, normalized);
    }
  });

  const query = nextParams.toString();
  return query ? `/bang-gia-si?${query}` : "/bang-gia-si";
};

function renderPagination({ currentPage, lastPage, total, itemCount, params }) {
  if (lastPage <= 1) {
    return null;
  }

  const pages = new Set([1, lastPage]);

  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= lastPage) {
      pages.add(page);
    }
  }

  const pageItems = Array.from(pages).sort((a, b) => a - b);

  return (
    <nav className={styles.pagination} aria-label="Phân trang bảng giá sỉ">
      <div className={styles.paginationMeta}>
        Đang xem {formatNumber(itemCount)} / {formatNumber(total)} sản phẩm
      </div>
      <div className={styles.paginationLinks}>
        {currentPage > 1 ? (
          <Link href={buildHref(params, { page: currentPage - 1 })} className={styles.paginationLink}>
            Trước
          </Link>
        ) : (
          <span className={`${styles.paginationLink} ${styles.paginationDisabled}`}>Trước</span>
        )}

        {pageItems.map((page, index) => {
          const previous = pageItems[index - 1];
          const showGap = previous && page - previous > 1;

          return (
            <span key={page} className={styles.paginationCluster}>
              {showGap ? <span className={styles.paginationGap}>...</span> : null}
              <Link
                href={buildHref(params, { page })}
                className={`${styles.paginationLink} ${page === currentPage ? styles.paginationActive : ""}`}
                aria-current={page === currentPage ? "page" : undefined}
              >
                {page}
              </Link>
            </span>
          );
        })}

        {currentPage < lastPage ? (
          <Link href={buildHref(params, { page: currentPage + 1 })} className={styles.paginationLink}>
            Sau
          </Link>
        ) : (
          <span className={`${styles.paginationLink} ${styles.paginationDisabled}`}>Sau</span>
        )}
      </div>
    </nav>
  );
}

export default async function WholesalePricePage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const currentPage = parsePageParam(resolvedSearchParams?.page);
  const currentSearch = getFirstParamValue(resolvedSearchParams?.search);
  const currentCategorySlug = getFirstParamValue(resolvedSearchParams?.category);
  const requestedSort = getFirstParamValue(resolvedSearchParams?.sort, "popular");
  const currentSort = ALLOWED_SORTS.has(requestedSort) ? requestedSort : "popular";

  let productsData = {
    data: [],
    current_page: currentPage,
    last_page: 1,
    total: 0,
  };
  let categories = [];
  let siteSettings = {};

  const [productsResult, categoriesResult, siteSettingsResult] = await Promise.allSettled([
    getWebProducts({
      category: currentCategorySlug,
      search: currentSearch,
      sort: currentSort,
      mobile_search: currentSearch ? "1" : "",
      page: currentPage,
      per_page: PRODUCTS_PER_PAGE,
      types: WHOLESALE_PRODUCT_TYPES,
    }),
    getWebCategories(),
    getWebSiteSettings(),
  ]);

  if (productsResult.status === "fulfilled") {
    productsData = productsResult.value;
  } else {
    console.error("Failed to fetch wholesale products:", productsResult.reason);
  }

  if (categoriesResult.status === "fulfilled") {
    categories = await filterWholesaleCategories(categoriesResult.value);
  } else {
    console.error("Failed to fetch wholesale categories:", categoriesResult.reason);
  }

  if (siteSettingsResult.status === "fulfilled") {
    siteSettings = siteSettingsResult.value && typeof siteSettingsResult.value === "object"
      ? siteSettingsResult.value
      : {};
  } else {
    console.error("Failed to fetch wholesale contact settings:", siteSettingsResult.reason);
  }

  const visibleCategorySlugs = new Set(categories.map((category) => String(category?.slug || "").trim()).filter(Boolean));
  const effectiveCategorySlug = currentCategorySlug && visibleCategorySlugs.has(currentCategorySlug)
    ? currentCategorySlug
    : "";

  if (currentCategorySlug && !effectiveCategorySlug) {
    try {
      productsData = await getWebProducts({
        category: "",
        search: currentSearch,
        sort: currentSort,
        mobile_search: currentSearch ? "1" : "",
        page: currentPage,
        per_page: PRODUCTS_PER_PAGE,
        types: WHOLESALE_PRODUCT_TYPES,
      });
    } catch (error) {
      console.error(`Failed to refetch wholesale products after hiding category "${currentCategorySlug}":`, error);
    }
  }

  const visibleProducts = (Array.isArray(productsData.data) ? productsData.data : [])
    .filter((product) => ["simple", "configurable"].includes(String(product?.type || "").toLowerCase()))
    .filter((product) => String(product?.item_type || product?.itemType || "product") !== "bundle_option");
  const contactHref = resolveZaloContactHref(siteSettings);
  const paginationParams = {
    search: currentSearch,
    category: effectiveCategorySlug,
    sort: currentSort,
    page: currentPage,
  };

  return (
    <main className={styles.wholesalePage} data-wholesale-page>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html,
            body {
              overflow-x: clip !important;
            }

            .mobile-sticky-header-shell {
              display: none !important;
            }

            .site-footer {
              display: none !important;
            }
          `,
        }}
      />
      <section className={styles.pageHeader}>
        <div className={styles.headerGrid}>
          <div className={styles.headerCopy}>
            <h1>Bảng giá sỉ Gốm Đại Thành</h1>
          </div>
        </div>
      </section>

      <section className={styles.policyStrip} aria-label="Cam kết khách sỉ">
        {[
          ["warehouse", "Nguồn hàng sẵn", "Số lượng hiển thị lớn, dễ gom mẫu theo nhóm hàng."],
          ["photo_library", "Ảnh & video đầy đủ", "Hỗ trợ tư liệu bán hàng cho đại lý và cộng tác viên."],
          ["inventory", "Đóng gói an toàn", "Ưu tiên kiện chắc, hạn chế rủi ro khi gửi xa."],
          ["chat", "Tư vấn Zalo", "Phản hồi nhanh khi cần chốt mẫu, báo số lượng hoặc lên đơn."],
        ].map(([icon, title, description]) => (
          <article key={title} className={styles.policyItem}>
            <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </section>

      <WholesaleControls
        categories={categories}
        currentCategorySlug={effectiveCategorySlug}
        currentSearch={currentSearch}
        currentSort={currentSort}
        total={productsData.total || 0}
        contactHref={contactHref}
        showSearch={false}
      />

      <section id="wholesale-table" className={styles.contentGrid}>
        <div className={styles.tablePanel}>
          <WholesaleOrderTable
            contactHref={contactHref}
            currentSearch={currentSearch}
            rows={visibleProducts.map((product, index) => {
              const imageSrc = resolveEntityImageUrl(product, "medium", FALLBACK_PRODUCT_IMAGE);
              const galleryImages = buildWholesaleMediaImages(product, product.name);
              const videoHref = buildWholesaleVideoHref(product);
              const wholesalePrice = calculateWholesalePrice(product);
              const stock = buildDisplayStock(product, index);

              return {
                key: buildProductCardKey(product),
                product: buildWholesaleRowProduct(product),
                imageSrc,
                galleryImages,
                videoHref,
                wholesalePrice,
                stock,
              };
            })}
          />

          {renderPagination({
            currentPage: productsData.current_page || currentPage,
            lastPage: productsData.last_page || 1,
            total: productsData.total || 0,
            itemCount: visibleProducts.length,
            params: paginationParams,
          })}
        </div>

        <aside id="wholesale-policy" className={styles.policyPanel}>
          <p className={styles.tableEyebrow}>Hỗ trợ đặt hàng</p>
          <h2>Chính sách khách sỉ</h2>
          <ul>
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
              <span>Ưu tiên xác nhận mẫu, số lượng và lịch đóng hàng qua Zalo.</span>
            </li>
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
              <span>Hỗ trợ ảnh, video sản phẩm để đại lý dùng cho tư vấn khách.</span>
            </li>
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
              <span>Đóng gói chống vỡ, có thể tách kiện theo nhóm hàng.</span>
            </li>
            <li>
              <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
              <span>Giao toàn quốc, phí vận chuyển báo theo địa chỉ và khối lượng đơn.</span>
            </li>
          </ul>
          <div className={styles.policyCallout}>
            <span className="material-symbols-outlined" aria-hidden="true">forum</span>
            <div>
              <strong>Cần bảng riêng theo nhóm hàng?</strong>
              <p>Gửi danh mục quan tâm, bên em gom mẫu và phản hồi số lượng sẵn nhanh nhất.</p>
            </div>
          </div>
          <a
            href={contactHref || "#wholesale-table"}
            className={styles.policyCta}
            target={contactHref ? "_blank" : undefined}
            rel={contactHref ? "noreferrer" : undefined}
          >
            <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
            Liên hệ đặt hàng
          </a>
        </aside>
      </section>
    </main>
  );
}
