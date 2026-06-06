"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import WholesaleGalleryButton from "./WholesaleGalleryButton";
import { buildWholesaleMediaImages, buildWholesaleVideoHref, buildWholesaleVideoItems } from "./wholesaleMedia";
import styles from "./wholesale.module.css";

const FALLBACK_PRODUCT_IMAGE = "/logo-dai-thanh.png";
const VARIANT_STOCK_MIN = 8;
const VARIANT_STOCK_RANGE = 12;

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

const normalizeText = (value = "") => String(value ?? "").trim();

const truthy = (value) => (
  value === true
  || value === 1
  || value === "1"
  || normalizeText(value).toLowerCase() === "true"
);

const getProductIdentity = (product = {}) => normalizeText(product.id || product.slug || product.name);

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

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
};

const buildVariantDisplayStock = (product = {}, variantIndex = 0) => (
  VARIANT_STOCK_MIN + (hashString(`variant-stock:${getProductIdentity(product)}:${variantIndex}`) % VARIANT_STOCK_RANGE)
);

const applyVariantDisplayStock = (product = {}, rows = []) => {
  const normalizedRows = Array.isArray(rows) ? rows : [];

  if (normalizedRows.length === 0) {
    return [];
  }

  return normalizedRows.map((row, index) => ({
    ...row,
    display_stock: buildVariantDisplayStock(product, index),
  }));
};

const sumVariantDisplayStock = (rows = []) => (
  (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + Math.max(0, Math.round(Number(row.display_stock || 0))),
    0,
  )
);

const getParentOrderKey = (product = {}) => `parent:${getProductIdentity(product)}`;

const getProductOrderKey = (product = {}) => `product:${getProductIdentity(product)}`;

const getVariantOrderKey = (product = {}, variant = {}, label = "") => (
  `variant:${getProductIdentity(product)}:${normalizeText(variant.id || variant.sku || label)}`
);

const getOrderQuantity = (orderItems = {}, key = "") => Number(orderItems?.[key]?.quantity || 0);

const getParentOrderItems = (orderItems = {}, parentKey = "") => (
  Object.values(orderItems || {}).filter((item) => item?.parentKey === parentKey)
);

function QuantityStepper({
  value = 0,
  stock = 0,
  disabled = false,
  onChange,
}) {
  const numericValue = Math.max(0, Number(value || 0));
  const stockLimit = Math.max(0, Number(stock || 0));
  const isDisabled = disabled || stockLimit <= 0;

  const updateValue = (nextValue) => {
    if (typeof onChange === "function") {
      onChange(nextValue);
    }
  };

  return (
    <div className={styles.quantityStepper}>
      <button
        type="button"
        aria-label="Giảm số lượng"
        disabled={isDisabled || numericValue <= 0}
        onClick={() => updateValue(numericValue - 1)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">remove</span>
      </button>
      <input
        type="number"
        min="0"
        max={stockLimit || undefined}
        value={numericValue || ""}
        placeholder="0"
        disabled={isDisabled}
        onChange={(event) => updateValue(event.target.value)}
      />
      <button
        type="button"
        aria-label="Tăng số lượng"
        disabled={isDisabled || numericValue >= stockLimit}
        onClick={() => updateValue(numericValue + 1)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </div>
  );
}

const getVariantRows = (payload = {}) => {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.variations)) return payload.variations;
  if (Array.isArray(payload?.variants)) return payload.variants;
  if (Array.isArray(payload?.linked_products)) {
    return payload.linked_products.filter((item) => item?.pivot?.link_type === "super_link");
  }
  return [];
};

const getBundleItems = (payload = {}) => {
  if (Array.isArray(payload?.items) && payload.items.length > 0) return payload.items;
  if (Array.isArray(payload?.bundle_items) && payload.bundle_items.length > 0) return payload.bundle_items;
  if (Array.isArray(payload?.grouped_items) && payload.grouped_items.length > 0) return payload.grouped_items;
  return [];
};

const getBundleOptionUid = (product = {}) => normalizeText(
  product.bundle_option_uid || product.bundleOptionUid || product.option_uid,
);

const getBundleOptionKey = (product = {}) => normalizeText(
  product.bundle_option_key || product.bundleOptionKey || product.option_key,
);

const getBundleOptionTitle = (product = {}) => normalizeText(
  product.bundle_option_title || product.bundleOptionTitle || product.option_title,
);

const isBundleOptionProduct = (product = {}) => (
  normalizeText(product.item_type || product.itemType) === "bundle_option"
  || getBundleOptionUid(product) !== ""
  || getBundleOptionKey(product) !== ""
  || getBundleOptionTitle(product) !== ""
);

const isBundleProduct = (product = {}) => normalizeText(product.type || product.productType).toLowerCase() === "bundle";

const hasVariantRows = (product = {}) => (
  Number(product.id || 0) > 0
  &&
  !isBundleOptionProduct(product)
  && (
    truthy(product.has_variants)
    || truthy(product.has_configurable_variants)
    || normalizeText(product.type || product.productType).toLowerCase() === "configurable"
    || Number(product.variants_count || product.variations_count || product.variant_count || 0) > 0
  )
);

const getVariantAttributes = (variant = {}) => {
  const rows = Array.isArray(variant.attribute_values)
    ? variant.attribute_values
    : (Array.isArray(variant.attributeValues) ? variant.attributeValues : []);

  return rows
    .map((entry) => normalizeText(entry?.value ?? entry?.label ?? entry?.name))
    .filter(Boolean)
    .join(" / ");
};

const getVariantLabel = (product = {}, variant = {}) => {
  const attributes = getVariantAttributes(variant);
  if (attributes) return attributes;

  const productName = normalizeText(product.name);
  const variantName = normalizeText(variant.name || variant.display_name || variant.full_name || variant.variant_name);
  if (productName && variantName.toLowerCase().startsWith(productName.toLowerCase())) {
    const suffix = variantName.slice(productName.length).replace(/^[-:–—\s]+/, "").trim();
    if (suffix) return suffix;
  }

  return variantName || `Mẫu #${variant.id || ""}`.trim();
};

const getBundleItemQuantity = (item = {}) => {
  const value = Number(item.quantity ?? item.qty ?? item.pivot?.quantity ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const getBundleItemPrice = (item = {}) => {
  const candidates = [
    item.current_price,
    item.price,
    item.pivot?.price,
    item.variant?.current_price,
    item.variant?.price,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return 0;
};

const toSafeVariantRow = (variant = {}) => ({
  id: variant.id ?? null,
  name: variant.name || variant.display_name || variant.full_name || variant.variant_name || "",
  sku: variant.sku || "",
  current_price: variant.current_price ?? null,
  price: variant.price ?? null,
  main_image: variant.main_image || variant.mainImage || "",
  primary_image: variant.primary_image || variant.primaryImage || null,
  images: Array.isArray(variant.images) ? variant.images : [],
  gallery: Array.isArray(variant.gallery) ? variant.gallery : [],
  gallery_images: Array.isArray(variant.gallery_images) ? variant.gallery_images : [],
  galleryImages: Array.isArray(variant.galleryImages) ? variant.galleryImages : [],
  video_url: variant.video_url || variant.videoUrl || "",
  videoUrl: variant.videoUrl || variant.video_url || "",
  video_urls: Array.isArray(variant.video_urls) ? variant.video_urls : [],
  videoUrls: Array.isArray(variant.videoUrls) ? variant.videoUrls : [],
  videos: Array.isArray(variant.videos) ? variant.videos : [],
  attribute_values: Array.isArray(variant.attribute_values)
    ? variant.attribute_values.map((entry) => ({
      value: entry?.value ?? entry?.label ?? entry?.name ?? "",
      attribute_code: entry?.attribute_code ?? entry?.attribute?.code ?? "",
      attribute_name: entry?.attribute_name ?? entry?.attribute?.name ?? "",
    }))
    : [],
});

const toSafeBundleItemRow = (item = {}) => ({
  id: item.id ?? null,
  name: item.name || item.product_name || item.title || item.variant?.name || "",
  product_name: item.product_name || "",
  title: item.title || "",
  sku: item.sku || item.product_sku || item.variant?.sku || "",
  product_sku: item.product_sku || "",
  current_price: item.current_price ?? null,
  price: item.price ?? null,
  main_image: item.main_image || item.mainImage || item.variant?.main_image || item.variant?.mainImage || "",
  primary_image: item.primary_image || item.primaryImage || item.variant?.primary_image || item.variant?.primaryImage || null,
  images: Array.isArray(item.images) ? item.images : (Array.isArray(item.variant?.images) ? item.variant.images : []),
  gallery: Array.isArray(item.gallery) ? item.gallery : [],
  gallery_images: Array.isArray(item.gallery_images) ? item.gallery_images : [],
  galleryImages: Array.isArray(item.galleryImages) ? item.galleryImages : [],
  video_url: item.video_url || item.videoUrl || item.variant?.video_url || item.variant?.videoUrl || "",
  videoUrl: item.videoUrl || item.video_url || item.variant?.videoUrl || item.variant?.video_url || "",
  video_urls: Array.isArray(item.video_urls) ? item.video_urls : (Array.isArray(item.variant?.video_urls) ? item.variant.video_urls : []),
  videoUrls: Array.isArray(item.videoUrls) ? item.videoUrls : (Array.isArray(item.variant?.videoUrls) ? item.variant.videoUrls : []),
  videos: Array.isArray(item.videos) ? item.videos : (Array.isArray(item.variant?.videos) ? item.variant.videos : []),
  quantity: item.quantity ?? item.qty ?? item.pivot?.quantity ?? 1,
  qty: item.qty ?? null,
  option_uid: item.option_uid || item.bundle_option_uid || item.pivot?.bundle_option_uid || "",
  option_key: item.option_key || item.bundle_option_key || item.pivot?.option_key || "",
  option_title: item.option_title || item.bundle_option_title || item.option_post_title || item.pivot?.option_title || "",
  option_post_title: item.option_post_title || "",
  pivot: {
    quantity: item.pivot?.quantity ?? null,
    price: item.pivot?.price ?? null,
    option_title: item.pivot?.option_title || "",
    bundle_option_uid: item.pivot?.bundle_option_uid || "",
    option_key: item.pivot?.option_key || "",
  },
  variant: item.variant ? {
    name: item.variant.name || "",
    sku: item.variant.sku || "",
    current_price: item.variant.current_price ?? null,
    price: item.variant.price ?? null,
  } : null,
});

const buildBundleDetailEndpoint = (product = {}) => {
  const slug = normalizeText(product.slug || product.id);
  const params = new URLSearchParams();
  const uid = getBundleOptionUid(product);
  const key = getBundleOptionKey(product);
  const title = getBundleOptionTitle(product);

  if (uid) params.set("bundle_option_uid", uid);
  if (key) params.set("bundle_option_key", key);
  if (title) params.set("bundle_option", title);

  return `/web-api/products/${encodeURIComponent(slug)}/bundle-items-summary${params.toString() ? `?${params.toString()}` : ""}`;
};

const buildProductDetailEndpoint = (product = {}) => {
  const slug = normalizeText(product.slug || product.id);
  return `/web-api/products/${encodeURIComponent(slug)}/bundle-items-summary`;
};

const buildVariantEndpoint = (product = {}) => {
  const params = new URLSearchParams({
    parent_id: String(product.id || ""),
    allow_variants: "1",
    per_page: "80",
    sort: "popular",
  });

  return `/web-api/products?${params.toString()}`;
};

export default function WholesaleProductRow({
  product,
  imageSrc,
  galleryImages = [],
  videoHref = "",
  videoItems = [],
  wholesalePrice = 0,
  stock = 0,
  orderItems = {},
  onSetOrderQuantity,
  onAddOrderItem,
  expandAll = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [detailRows, setDetailRows] = useState([]);
  const [detailError, setDetailError] = useState("");
  const lastExpandAllRef = useRef(null);

  const isBundleOption = isBundleOptionProduct(product);
  const isBundleParent = isBundleProduct(product);
  const isBundleDetail = isBundleOption || isBundleParent;
  const isVariantProduct = hasVariantRows(product);
  const canExpand = isBundleDetail || isVariantProduct;
  const toggleLabel = isBundleDetail ? "Tùy chọn" : "Mẫu và size";
  const mobileToggleLabel = isBundleDetail ? "Xem tùy chọn" : "Xem mẫu và size";

  const loaded = detailRows.length > 0 || detailError;

  const fetchDetails = useCallback(async () => {
    if (!canExpand || loaded || isLoading) {
      return;
    }

    setIsLoading(true);
    setDetailError("");

    try {
      const endpoint = isBundleOption
        ? buildBundleDetailEndpoint(product)
        : (isBundleParent ? buildProductDetailEndpoint(product) : buildVariantEndpoint(product));
      const payload = await fetchFromApi(endpoint);
      const rows = isBundleDetail ? getBundleItems(payload) : getVariantRows(payload);
      setDetailRows(isBundleDetail ? rows.map(toSafeBundleItemRow) : rows.map(toSafeVariantRow));
    } catch (error) {
      console.error("Failed to load wholesale row details:", error);
      setDetailError("Chưa tải được dữ liệu chi tiết");
    } finally {
      setIsLoading(false);
    }
  }, [canExpand, isBundleDetail, isBundleOption, isBundleParent, isLoading, loaded, product]);

  useEffect(() => {
    if (!canExpand || lastExpandAllRef.current === expandAll) {
      return;
    }

    lastExpandAllRef.current = expandAll;

    if (expandAll) {
      setIsOpen(true);
      fetchDetails();
      return;
    }

    setIsOpen(false);
  }, [canExpand, expandAll, fetchDetails]);

  const toggleDetails = async () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen) {
      await fetchDetails();
    }
  };

  const summaryCount = useMemo(() => {
    const count = Number(product.variants_count || product.variations_count || product.variant_count || 0);
    return Number.isFinite(count) && count > 0 ? ` (${count})` : "";
  }, [product]);
  const detailRowsWithStock = useMemo(() => (
    isBundleDetail ? detailRows : applyVariantDisplayStock(product, detailRows)
  ), [detailRows, isBundleDetail, product]);
  const displayStock = isVariantProduct && detailRowsWithStock.length > 0
    ? sumVariantDisplayStock(detailRowsWithStock)
    : stock;
  const parentOrderKey = getParentOrderKey(product);
  const productOrderKey = getProductOrderKey(product);
  const productOrderImageSrc = galleryImages[0]?.src || imageSrc || FALLBACK_PRODUCT_IMAGE;
  const productOrderItem = {
    key: productOrderKey,
    parentKey: productOrderKey,
    name: product.name,
    parentName: product.name,
    price: wholesalePrice,
    stock: displayStock,
    imageSrc: productOrderImageSrc,
  };
  const productOrderQuantity = getOrderQuantity(orderItems, productOrderKey);
  const productLineTotal = productOrderQuantity * wholesalePrice;
  const parentOrderItems = getParentOrderItems(orderItems, parentOrderKey);
  const parentSelectedQuantity = parentOrderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const parentSelectedTotal = parentOrderItems.reduce(
    (sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)),
    0,
  );
  const hasDirectOrderControls = !isVariantProduct && !isBundleDetail;

  return (
    <>
      <tr className={`${styles.productTableRow} ${hasDirectOrderControls ? styles.directProductRow : styles.selectionProductRow}`}>
        <td data-label="Media" className={styles.mediaCell}>
          <WholesaleGalleryButton
            productName={product.name}
            images={galleryImages}
            videoHref={videoHref}
            videoItems={videoItems}
          />
        </td>
        <td data-label="Sản phẩm">
          <WholesaleGalleryButton
            productName={product.name}
            images={galleryImages}
            videoHref={videoHref}
            videoItems={videoItems}
            trigger="custom"
            triggerClassName={styles.productImageLink}
            triggerAriaLabel={`Xem hinh anh va video ${product.name}`}
          >
            <Image
              src={imageSrc || FALLBACK_PRODUCT_IMAGE}
              alt={product.name || "Sản phẩm gốm sứ"}
              width={76}
              height={76}
              sizes="76px"
              unoptimized
              className={styles.productImage}
            />
            {videoHref || videoItems.length > 0 ? (
              <span className={styles.imageVideoBadge} aria-label="Sản phẩm có video">
                <span className="material-symbols-outlined" aria-hidden="true">play_arrow</span>
              </span>
            ) : null}
          </WholesaleGalleryButton>
        </td>
        <td data-label="Thông tin">
          <div className={styles.productInfo}>
            <strong>{product.name}</strong>
            {canExpand ? (
              <div className={styles.productMetaLine}>
                <button
                  type="button"
                  className={`${styles.detailToggle} ${isOpen ? styles.detailToggleOpen : ""}`}
                  onClick={toggleDetails}
                  aria-expanded={isOpen}
                >
                  <span>{toggleLabel}{isBundleDetail ? "" : summaryCount}</span>
                  <span className="material-symbols-outlined" aria-hidden="true">expand_more</span>
                </button>
              </div>
            ) : null}
          </div>
        </td>
        <td data-label="Giá sỉ">
          <strong className={styles.wholesalePrice}>{formatWholesalePrice(wholesalePrice)}</strong>
        </td>
        <td data-label="Tồn kho">
          <span className={styles.stockBadge}>{formatNumber(displayStock)}</span>
        </td>
        <td data-label="Số lượng">
          {hasDirectOrderControls ? (
            <QuantityStepper
              value={productOrderQuantity}
              stock={displayStock}
              onChange={(nextQuantity) => onSetOrderQuantity?.(productOrderItem, nextQuantity)}
            />
          ) : (
            <span className={styles.parentOrderHint}>
              {formatNumber(parentSelectedQuantity)}
            </span>
          )}
        </td>
        <td data-label="Thành tiền">
          <strong className={styles.lineAmount}>
            {hasDirectOrderControls
              ? (productLineTotal > 0 ? formatWholesalePrice(productLineTotal) : "-")
              : (parentSelectedTotal > 0 ? formatWholesalePrice(parentSelectedTotal) : "-")}
          </strong>
        </td>
        <td data-label="Đặt hàng">
          {hasDirectOrderControls ? (
            <button
              type="button"
              className={styles.addOrderButton}
              onClick={() => onAddOrderItem?.(productOrderItem)}
              disabled={displayStock <= 0 || wholesalePrice <= 0}
            >
              <span className="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span>
              {productOrderQuantity > 0 ? "Thêm nữa" : "Thêm"}
            </button>
          ) : (
            <button
              type="button"
              className={styles.addOrderButton}
              onClick={toggleDetails}
              aria-expanded={isOpen}
            >
              <span className="material-symbols-outlined" aria-hidden="true">inventory_2</span>
              {isOpen ? "Đóng" : (parentSelectedQuantity > 0 ? `Đã chọn ${formatNumber(parentSelectedQuantity)}` : (
                <>
                  <span className={styles.desktopActionLabel}>Chọn mẫu</span>
                  <span className={styles.mobileActionLabel}>{mobileToggleLabel}{isBundleDetail ? "" : summaryCount}</span>
                </>
              ))}
            </button>
          )}
        </td>
      </tr>

      {isOpen ? (
        <>
          {detailError ? (
            <tr className={styles.detailStateRow}>
              <td colSpan={8}>
                <p className={styles.detailState}>{detailError}</p>
              </td>
            </tr>
          ) : null}

          {!detailError && isLoading ? (
            <tr className={styles.detailStateRow}>
              <td colSpan={8}>
                <p className={styles.detailState}>Đang tải dữ liệu chi tiết...</p>
              </td>
            </tr>
          ) : null}

          {!detailError && !isLoading && detailRowsWithStock.length === 0 ? (
            <tr className={styles.detailStateRow}>
              <td colSpan={8}>
                <p className={styles.detailState}>Chưa có dữ liệu chi tiết.</p>
              </td>
            </tr>
          ) : null}

          {!detailError && !isLoading && detailRowsWithStock.length > 0 && isBundleDetail ? (
            <tr className={styles.detailRow}>
              <td colSpan={8}>
                <div className={styles.detailPanel}>
                <div className={styles.detailList}>
                  {isBundleParent
                        ? Object.entries(detailRowsWithStock.reduce((groups, item) => {
                          const optionName = normalizeText(
                            item.option_title
                            || item.option_post_title
                            || item.pivot?.option_title,
                          ) || "Tùy chọn bộ";
                          const optionKey = normalizeText(item.option_uid || item.option_key || optionName);

                          if (!groups[optionKey]) {
                            groups[optionKey] = { name: optionName, items: [] };
                          }

                          groups[optionKey].items.push(item);
                          return groups;
                        }, {})).map(([optionKey, group]) => (
                          <div key={optionKey} className={styles.detailOptionGroup}>
                            <div className={styles.detailOptionHeader}>
                              <strong>{group.name}</strong>
                              <span>{formatNumber(group.items.length)} món</span>
                            </div>
                            {group.items.map((item, index) => {
                              const itemName = normalizeText(item.name || item.product_name || item.title || item.variant?.name) || "Sản phẩm trong bộ";
                              const quantity = getBundleItemQuantity(item);
                              const itemWholesalePrice = calculateWholesalePrice({ current_price: getBundleItemPrice(item) });
                              const ownItemGalleryImages = buildWholesaleMediaImages(item, itemName);
                              const itemGalleryImages = ownItemGalleryImages.length > 0 ? ownItemGalleryImages : galleryImages;
                              const ownItemVideoItems = buildWholesaleVideoItems(item, itemName);
                              const itemVideoItems = ownItemVideoItems.length > 0 ? ownItemVideoItems : videoItems;
                              const itemVideoHref = itemVideoItems[0]?.href || buildWholesaleVideoHref(item);

                              return (
                                <div key={`${item.id || itemName}-${index}`} className={styles.detailItem}>
                                  <div className={styles.detailMediaSlot}>
                                    <WholesaleGalleryButton
                                      productName={itemName}
                                      images={itemGalleryImages}
                                      videoHref={itemVideoHref}
                                      videoItems={itemVideoItems}
                                    />
                                  </div>
                                  <div className={styles.detailItemMain}>
                                    <strong>{itemName}</strong>
                                  </div>
                                  <span className={styles.detailQuantity}>SL: {formatNumber(quantity)}</span>
                                  <strong className={styles.detailPrice}>{formatWholesalePrice(itemWholesalePrice)}</strong>
                                </div>
                              );
                            })}
                          </div>
                        ))
                        : detailRowsWithStock.map((item, index) => {
                          const itemName = normalizeText(item.name || item.product_name || item.title || item.variant?.name) || "Sản phẩm trong bộ";
                          const quantity = getBundleItemQuantity(item);
                          const itemWholesalePrice = calculateWholesalePrice({ current_price: getBundleItemPrice(item) });
                          const ownItemGalleryImages = buildWholesaleMediaImages(item, itemName);
                          const itemGalleryImages = ownItemGalleryImages.length > 0 ? ownItemGalleryImages : galleryImages;
                          const ownItemVideoItems = buildWholesaleVideoItems(item, itemName);
                          const itemVideoItems = ownItemVideoItems.length > 0 ? ownItemVideoItems : videoItems;
                          const itemVideoHref = itemVideoItems[0]?.href || buildWholesaleVideoHref(item);

                          return (
                            <div key={`${item.id || itemName}-${index}`} className={styles.detailItem}>
                              <div className={styles.detailMediaSlot}>
                                <WholesaleGalleryButton
                                  productName={itemName}
                                  images={itemGalleryImages}
                                  videoHref={itemVideoHref}
                                  videoItems={itemVideoItems}
                                />
                              </div>
                              <div className={styles.detailItemMain}>
                                <strong>{itemName}</strong>
                              </div>
                              <span className={styles.detailQuantity}>SL: {formatNumber(quantity)}</span>
                              <strong className={styles.detailPrice}>{formatWholesalePrice(itemWholesalePrice)}</strong>
                            </div>
                          );
                        })}
                </div>
                </div>
              </td>
            </tr>
          ) : null}

          {!detailError && !isLoading && detailRowsWithStock.length > 0 && !isBundleDetail
            ? detailRowsWithStock.map((variant, index) => {
                      const variantWholesalePrice = calculateWholesalePrice(variant);
                      const label = getVariantLabel(product, variant);
                      const variantStock = Number(variant.display_stock || 0);
                      const variantOrderKey = getVariantOrderKey(product, variant, label);
                      const ownVariantGalleryImages = buildWholesaleMediaImages(variant, `${product.name} - ${label}`);
                      const variantGalleryImages = ownVariantGalleryImages.length > 0 ? ownVariantGalleryImages : galleryImages;
                      const ownVariantVideoItems = buildWholesaleVideoItems(variant, `${product.name} - ${label}`);
                      const variantVideoItems = ownVariantVideoItems.length > 0 ? ownVariantVideoItems : videoItems;
                      const variantVideoHref = variantVideoItems[0]?.href || buildWholesaleVideoHref(variant);
                      const variantOrderItem = {
                        key: variantOrderKey,
                        parentKey: parentOrderKey,
                        name: label,
                        parentName: product.name,
                        price: variantWholesalePrice,
                        stock: variantStock,
                        imageSrc: variantGalleryImages[0]?.src || imageSrc || FALLBACK_PRODUCT_IMAGE,
                      };
                      const variantOrderQuantity = getOrderQuantity(orderItems, variantOrderKey);
                      const variantLineTotal = variantOrderQuantity * variantWholesalePrice;

                      return (
                        <tr key={`${variant.id || variant.sku || label}-${index}`} className={styles.variantTableRow}>
                          <td data-label="Media" className={styles.mediaCell}>
                            <WholesaleGalleryButton
                              productName={`${product.name} - ${label}`}
                              images={variantGalleryImages}
                              videoHref={variantVideoHref}
                              videoItems={variantVideoItems}
                            />
                          </td>
                          <td data-label="Sản phẩm" className={styles.variantLeadCell}>
                            <span className={styles.variantIndent} aria-hidden="true" />
                          </td>
                          <td data-label="Thông tin">
                            <div className={styles.detailItemMain}>
                            <strong>{label}</strong>
                            </div>
                          </td>
                          <td data-label="Giá sỉ">
                            <strong className={styles.detailPrice}>{formatWholesalePrice(variantWholesalePrice)}</strong>
                          </td>
                          <td data-label="Tồn kho">
                            <span className={styles.variantStock}>{formatNumber(variantStock)}</span>
                          </td>
                          <td data-label="Số lượng">
                          <QuantityStepper
                            value={variantOrderQuantity}
                            stock={variantStock}
                            disabled={variantWholesalePrice <= 0}
                            onChange={(nextQuantity) => onSetOrderQuantity?.(variantOrderItem, nextQuantity)}
                          />
                          </td>
                          <td data-label="Thành tiền">
                            <strong className={styles.lineAmount}>
                            {variantLineTotal > 0 ? formatWholesalePrice(variantLineTotal) : "-"}
                          </strong>
                          </td>
                          <td data-label="Đặt hàng">
                          <button
                            type="button"
                            className={styles.addOrderButton}
                            onClick={() => onAddOrderItem?.(variantOrderItem)}
                            disabled={variantStock <= 0 || variantWholesalePrice <= 0}
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">add_shopping_cart</span>
                            {variantOrderQuantity > 0 ? "Thêm nữa" : "Thêm"}
                          </button>
                          </td>
                        </tr>
                      );
                    })
            : null}
        </>
      ) : null}
    </>
  );
}
