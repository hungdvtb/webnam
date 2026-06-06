import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { useLocation, useNavigate } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, inventoryApi, cmsApi, aiApi, googleMerchantApi } from '../../services/api';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';
import ProductSortModal from '../../components/admin/ProductSortModal';
import ProductImageBulkAppendModal from '../../components/admin/ProductImageBulkAppendModal';
import ProductImageRefreshModal from '../../components/admin/ProductImageRefreshModal';
import ProductCategoryImageManagerModal from '../../components/admin/ProductCategoryImageManagerModal';
import ProductSeoBulkModal from '../../components/admin/ProductSeoBulkModal';
import { ACTIVE_PRODUCT_TYPE_KEYS, ACTIVE_PRODUCT_TYPE_OPTIONS, PRODUCT_TYPE_META, sanitizeActiveProductTypeValues } from '../../config/productTypes';
import {
    formatWholeMoneyInput,
    normalizeRoundedImportCostNumber,
    normalizeWholeMoneyDraft,
    normalizeWholeMoneyNumber,
} from '../../utils/money';
import { formatCategorySummary, getProductCategoryNames } from '../../utils/productCategories';
import { resolveProductPrimaryImageUrl } from '../../utils/mediaUrl';
import {
    hasAdminDataPermission,
    hasAdminPermission,
} from '../../utils/adminPermissions';

const TYPE_LABELS = PRODUCT_TYPE_META;
const PRODUCT_DETAIL_PATH = '/san-pham';
const PRODUCT_MANAGEMENT_PERSISTENT_STATE_KEY = 'product_management_persistent_state';
const PRODUCT_MANAGEMENT_WORKING_STATE_KEY = 'product_management_working_state';
const quantityFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

function normalizeQuantityDraft(value) {
    const rawValue = String(value ?? '').trimStart().replace(/,/g, '.');
    const numericValue = rawValue.replace(/[^0-9.]/g, '');
    if (!numericValue) {
        return '';
    }

    const [integerPartRaw, ...decimalParts] = numericValue.split('.');
    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || (decimalParts.length ? '0' : '');
    const decimalPart = decimalParts.join('').slice(0, 3);

    if (decimalParts.length > 0) {
        return `${integerPart || '0'}.${decimalPart}`;
    }

    return integerPart;
}

function parseQuantityNumber(value, fallback = null) {
    const normalizedValue = normalizeQuantityDraft(value);
    if (!normalizedValue || normalizedValue === '.') {
        return fallback;
    }

    const numericValue = Number(normalizedValue);
    return Number.isFinite(numericValue) ? Math.round(numericValue * 1000) / 1000 : fallback;
}

function formatQuantityValue(value) {
    return quantityFormatter.format(Number(value || 0));
}

function readStorageJson(storage, key) {
    if (!storage) {
        return null;
    }

    const rawValue = storage.getItem(key);
    if (!rawValue) {
        return null;
    }

    try {
        return JSON.parse(rawValue);
    } catch (error) {
        console.error(`Error parsing ${key}`, error);
        return null;
    }
}

function writeStorageJson(storage, key, value) {
    if (!storage) {
        return;
    }

    try {
        storage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Error saving ${key}`, error);
    }
}

function getSavedProductListState() {
    if (typeof window === 'undefined') {
        return { persistent: null, working: null, combined: null };
    }

    const persistent = readStorageJson(window.localStorage, PRODUCT_MANAGEMENT_PERSISTENT_STATE_KEY);
    const working = readStorageJson(window.sessionStorage, PRODUCT_MANAGEMENT_WORKING_STATE_KEY);

    return {
        persistent,
        working,
        combined: persistent || working
            ? {
                ...(persistent || {}),
                ...(working || {}),
            }
            : null,
    };
}

function normalizeStoredId(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const rawValue = String(value).trim();
    if (!rawValue) {
        return null;
    }

    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue) && String(numericValue) === rawValue) {
        return numericValue;
    }

    return rawValue;
}

function sanitizeStoredIdList(values) {
    const normalizedValues = Array.isArray(values)
        ? values
            .map((value) => normalizeStoredId(value))
            .filter((value) => value !== null)
        : [];

    return Array.from(
        new Map(normalizedValues.map((value) => [String(value), value])).values(),
    );
}

function normalizeStoredScrollTop(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function findScrollableAncestor(node) {
    if (typeof window === 'undefined' || !node) {
        return null;
    }

    let currentNode = node.parentElement;

    while (currentNode && currentNode !== document.body) {
        const style = window.getComputedStyle(currentNode);
        const overflowY = style.overflowY || style.overflow;

        if (/(auto|scroll|overlay)/i.test(overflowY)) {
            return currentNode;
        }

        currentNode = currentNode.parentElement;
    }

    return window;
}

function normalizeDomainValue(value) {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '');
}

function buildProductPageUrl(product, domains = []) {
    const slug = String(product?.slug || '').trim();
    const identifier = slug || String(product?.id || '').trim();
    if (!identifier) {
        return '';
    }

    const path = `${PRODUCT_DETAIL_PATH}/${encodeURIComponent(identifier)}`;
    const activeDomains = Array.isArray(domains)
        ? domains.filter((item) => item?.is_active !== false)
        : [];
    const requestedDomainId = String(product?.site_domain_id || '').trim();
    const selectedDomain = activeDomains.find((item) => String(item.id) === requestedDomainId)
        || activeDomains.find((item) => item?.is_default)
        || activeDomains[0];
    const domain = normalizeDomainValue(
        product?.siteDomain?.domain
        || product?.site_domain?.domain
        || selectedDomain?.domain
    );

    try {
        if (domain) {
            return new URL(path, `https://${domain}`).toString();
        }

        if (typeof window !== 'undefined' && window.location?.origin) {
            return new URL(path, window.location.origin).toString();
        }
    } catch (error) {
        if (typeof window !== 'undefined' && window.location?.origin) {
            return `${window.location.origin}${path}`;
        }
    }

    return path;
}

const DEFAULT_COLUMNS = [
    { id: 'sku', label: 'Mã SP', minWidth: '130px', fixed: true },
    { id: 'name', label: 'Tên Sản Phẩm', minWidth: '220px', fixed: true },
    { id: 'unit', label: 'ĐVT', minWidth: '96px', align: 'center', sortable: false },
    { id: 'specifications', label: 'Thông số', minWidth: '150px' },
    { id: 'cost_price', label: 'Giá dự kiến', minWidth: '120px' },
    { id: 'price', label: 'Giá bán', minWidth: '120px' },
    { id: 'images', label: 'Ảnh', minWidth: '80px' },
    { id: 'type', label: 'Loại hình', minWidth: '110px' },
    { id: 'category', label: 'Danh mục', minWidth: '120px' },
    { id: 'is_featured', label: 'Nổi bật', minWidth: '80px', align: 'center' },
    { id: 'is_new', label: 'Mới', minWidth: '80px', align: 'center' },
    { id: 'status', label: 'Bán', minWidth: '60px', align: 'center' },
    { id: 'seo_status', label: 'Mô tả SEO', minWidth: '100px', align: 'center', sortable: false },
    { id: 'actions', label: 'Thao tác', minWidth: '100px', align: 'right', fixed: true },
    { id: 'product_link', label: 'Link SP', minWidth: '150px' },
    { id: 'google_merchant', label: 'Google Merchant', minWidth: '140px', align: 'center', sortable: false },
];

const DEFAULT_SORT_CONFIG = { key: 'created_at', direction: 'desc', phase: 1 };
const DEFAULT_EXPORT_COLUMN_IDS = ['name', 'product_link'];
const CONTENT_ONLY_EXPORT_COLUMN_IDS = ['sku', 'name', 'child_names', 'description', 'specifications', 'meta_title', 'meta_description'];
const CONTENT_ONLY_IMPORT_FIELD_IDS = ['description', 'specifications', 'seo'];
const LOCAL_STRUCTURE_EXPORT_COLUMN_IDS = ['sku', 'name', 'type', 'bundle_title', 'child_names', 'variant_data', 'component_data', 'description', 'specifications', 'meta_title', 'meta_description'];
const EXPORT_EXCLUDED_COLUMN_IDS = new Set(['actions', 'images', 'unit']);
const DEFAULT_IMPORT_MODE = 'replace_all';
const DEFAULT_IMPORT_MISSING_PRODUCT_ACTION = 'create';
const INVENTORY_UNIT_FILTER_ASSIGNED = 'assigned';
const INVENTORY_UNIT_FILTER_UNASSIGNED = 'unassigned';
const SHOW_BULK_COPY_ACTION = false;
const SHOW_BULK_IMAGE_APPEND_ACTION = false;
const CATEGORY_COUNT_FILTER_OPTIONS = [
    { value: 'exact_2', label: 'Đúng 2 danh mục' },
    { value: 'exact_3', label: 'Đúng 3 danh mục' },
    { value: 'min_2', label: 'Từ 2 danh mục trở lên' },
    { value: 'min_3', label: 'Từ 3 danh mục trở lên' },
];
const EXTRA_EXPORT_FIELDS = [
    { id: 'id', label: 'ID' },
    { id: 'slug', label: 'Slug' },
    { id: 'stock', label: 'Tồn kho' },
    { id: 'special_price', label: 'Giá bán' },
    { id: 'description', label: 'Mô tả' },
    { id: 'additional_info', label: 'Thông tin bổ sung' },
    { id: 'meta_title', label: 'SEO title' },
    { id: 'meta_description', label: 'SEO description' },
    { id: 'meta_keywords', label: 'SEO keywords' },
    { id: 'weight', label: 'Khối lượng' },
    { id: 'supplier_product_code', label: 'Mã NCC' },
    { id: 'domain', label: 'Domain' },
    { id: 'video_url', label: 'Video URL' },
    { id: 'bundle_title', label: 'Tiêu đề bundle' },
    { id: 'child_skus', label: 'Mã SP con' },
    { id: 'child_names', label: 'Tên biến thể / thành phần' },
    { id: 'component_data', label: 'Thành phần bundle/grouped' },
    { id: 'attributes', label: 'Thuộc tính' },
    { id: 'primary_image_url', label: 'Ảnh đại diện' },
    { id: 'gallery_image_urls', label: 'Thư viện ảnh' },
    { id: 'variant_data', label: 'Biến thể' },
];
const IMPORT_BASE_FIELD_OPTIONS = [
    { id: 'name', label: 'Tên sản phẩm', description: 'Cập nhật cột Tên sản phẩm.' },
    { id: 'sku', label: 'SKU', description: 'Cập nhật SKU nếu dòng có định danh ổn định khác.' },
    { id: 'slug', label: 'Slug', description: 'Cập nhật đường dẫn slug của sản phẩm.' },
    { id: 'type', label: 'Loại sản phẩm', description: 'Cập nhật loại sản phẩm từ file Excel.' },
    { id: 'price', label: 'Giá', description: 'Cập nhật giá chính của sản phẩm.' },
    { id: 'special_price', label: 'Giá bán', description: 'Cập nhật giá bán ưu đãi hoặc giá khuyến mãi.' },
    { id: 'expected_cost', label: 'Giá nhập dự kiến', description: 'Cập nhật giá nhập dự kiến.' },
    { id: 'stock_quantity', label: 'Tồn kho', description: 'Cập nhật tồn kho theo file Excel.' },
    { id: 'category', label: 'Danh mục', description: 'Cập nhật danh mục chính và danh mục liên kết.' },
    { id: 'attributes', label: 'Thuộc tính', description: 'Cập nhật cột Thuộc tính dạng JSON hoặc text.' },
    { id: 'images', label: 'Ảnh', description: 'Cập nhật ảnh đại diện và thư viện ảnh.' },
    { id: 'description', label: 'Mô tả', description: 'Cập nhật mô tả nội dung sản phẩm.' },
    { id: 'status', label: 'Trạng thái', description: 'Cập nhật trạng thái đang bán hoặc tạm ẩn.' },
    { id: 'seo', label: 'SEO', description: 'Gồm SEO title, SEO description và SEO keywords.' },
    { id: 'additional_info', label: 'Thông tin bổ sung', description: 'Cập nhật block thông tin bổ sung dạng JSON.' },
    { id: 'specifications', label: 'Thông số kỹ thuật', description: 'Cập nhật bảng thông số kỹ thuật.' },
    { id: 'weight', label: 'Khối lượng', description: 'Cập nhật trọng lượng hoặc quy cách đóng gói.' },
    { id: 'video_url', label: 'Video URL', description: 'Cập nhật liên kết video sản phẩm.' },
    { id: 'bundle_title', label: 'Tiêu đề bundle', description: 'Cập nhật tiêu đề bundle nếu có.' },
    { id: 'component_data', label: 'Thành phần bundle/grouped', description: 'Cập nhật danh sách thành phần cho bộ/combo hoặc nhóm sản phẩm.' },
    { id: 'domain', label: 'Domain', description: 'Cập nhật domain gắn với sản phẩm.' },
    { id: 'is_featured', label: 'Nổi bật', description: 'Cập nhật cờ sản phẩm nổi bật.' },
    { id: 'is_new', label: 'Mới', description: 'Cập nhật cờ sản phẩm mới.' },
    { id: 'variant_data', label: 'Biến thể', description: 'Cập nhật danh sách biến thể từ cột Biến thể.' },
];

function extractFilenameFromDisposition(headerValue, fallbackFilename) {
    if (!headerValue) return fallbackFilename;

    const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch?.[1]) {
        try {
            return decodeURIComponent(utfMatch[1]);
        } catch (error) {
            return utfMatch[1];
        }
    }

    const basicMatch = headerValue.match(/filename=\"?([^\"]+)\"?/i);
    return basicMatch?.[1] || fallbackFilename;
}

function downloadBlobResponse(response, fallbackFilename) {
    const blob = response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data]);
    const filename = extractFilenameFromDisposition(
        response?.headers?.['content-disposition'],
        fallbackFilename,
    );
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
}

function getPrimaryImage(product) {
    return resolveProductPrimaryImageUrl(product, 'thumbnail', '');
}

function getDisplayStock(product) {
    const rawStock = product?.actual_stock ?? product?.stock_quantity ?? 0;
    const numericStock = Number(rawStock);

    return Number.isFinite(numericStock) ? numericStock : 0;
}

function getGoogleMerchantStatus(product) {
    const status = String(product?.google_merchant_sync_status || 'not_synced');
    const meta = {
        synced: { label: 'Đã đồng bộ', className: 'bg-green-100 text-green-700', icon: 'cloud_done' },
        error: { label: 'Lỗi đồng bộ', className: 'bg-red-100 text-red-700', icon: 'error' },
        not_synced: { label: 'Chưa đồng bộ', className: 'bg-stone-100 text-stone-600', icon: 'cloud_off' },
    };

    return meta[status] || meta.not_synced;
}

function getVariantParentProduct(product) {
    if (!product || typeof product !== 'object') {
        return null;
    }

    if (Array.isArray(product.parent_products) && product.parent_products.length > 0) {
        return product.parent_products[0] || null;
    }

    if (Array.isArray(product.parent_configurable) && product.parent_configurable.length > 0) {
        return product.parent_configurable[0] || null;
    }

    if (product.parent_configurable && !Array.isArray(product.parent_configurable) && typeof product.parent_configurable === 'object') {
        return product.parent_configurable;
    }

    return null;
}

function isVariantChildProduct(product) {
    return Boolean(getVariantParentProduct(product));
}

function getConfigurableParentProduct(product) {
    if (!product || typeof product !== 'object') {
        return null;
    }

    if (Array.isArray(product.parent_configurable) && product.parent_configurable.length > 0) {
        return product.parent_configurable[0] || null;
    }

    if (product.parent_configurable && !Array.isArray(product.parent_configurable) && typeof product.parent_configurable === 'object') {
        return product.parent_configurable;
    }

    if (Array.isArray(product.parentConfigurable) && product.parentConfigurable.length > 0) {
        return product.parentConfigurable[0] || null;
    }

    if (product.parentConfigurable && !Array.isArray(product.parentConfigurable) && typeof product.parentConfigurable === 'object') {
        return product.parentConfigurable;
    }

    const parentProducts = Array.isArray(product.parent_products)
        ? product.parent_products
        : (Array.isArray(product.parentProducts) ? product.parentProducts : []);

    return parentProducts.find((item) => {
        const linkType = String(item?.pivot?.link_type || item?.link_type || '').trim().toLowerCase();
        return linkType === 'super_link';
    }) || null;
}

function isConfigurableVariantChildProduct(product) {
    return Boolean(getConfigurableParentProduct(product));
}

function getProductEditTargetId(product) {
    return getVariantParentProduct(product)?.id || product?.id || null;
}

function getSupplierFilterLabel(suppliers, supplierId) {
    if (!supplierId) {
        return '';
    }

    if (supplierId === 'unassigned') {
        return 'Chưa gắn nhà cung cấp';
    }

    const supplier = suppliers.find((item) => String(item.id) === String(supplierId));
    if (!supplier) {
        return String(supplierId);
    }

    return supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name;
}

function normalizeInventoryUnitFilterValue(value) {
    if (Array.isArray(value)) {
        return normalizeInventoryUnitFilterValue(value[0] ?? '');
    }

    const normalizedValue = String(value ?? '').trim();

    if (
        normalizedValue === ''
        || normalizedValue === INVENTORY_UNIT_FILTER_ASSIGNED
        || normalizedValue === INVENTORY_UNIT_FILTER_UNASSIGNED
        || /^\d+$/.test(normalizedValue)
    ) {
        return normalizedValue;
    }

    return '';
}

function normalizeCategoryCountFilterValue(value) {
    const normalizedValue = String(value ?? '').trim();

    return CATEGORY_COUNT_FILTER_OPTIONS.some((option) => option.value === normalizedValue)
        ? normalizedValue
        : '';
}

function getCategoryCountFilterLabel(filterValue) {
    const normalizedValue = normalizeCategoryCountFilterValue(filterValue);

    return CATEGORY_COUNT_FILTER_OPTIONS.find((option) => option.value === normalizedValue)?.label || '';
}

function getInventoryUnitFilterLabel(units, filterValue) {
    const normalizedValue = normalizeInventoryUnitFilterValue(filterValue);

    if (!normalizedValue) {
        return '';
    }

    if (normalizedValue === INVENTORY_UNIT_FILTER_ASSIGNED) {
        return 'Đã có ĐVT';
    }

    if (normalizedValue === INVENTORY_UNIT_FILTER_UNASSIGNED) {
        return 'Chưa gán ĐVT';
    }

    return units.find((unit) => String(unit?.id) === normalizedValue)?.name || `ĐVT #${normalizedValue}`;
}

function resolveProductUnitLabel(product, parentProduct = null) {
    const candidates = [
        product?.unit?.name,
        product?.unit_name,
        parentProduct?.unit?.name,
        parentProduct?.unit_name,
    ];

    const matchedCandidate = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim() !== '');

    return matchedCandidate ? matchedCandidate.trim() : '';
}

function moveItemAfter(items, itemId, afterId, getId = (item) => item) {
    const nextItems = Array.isArray(items) ? [...items] : [];
    const itemIndex = nextItems.findIndex((item) => getId(item) === itemId);
    if (itemIndex === -1) {
        return nextItems;
    }

    const [item] = nextItems.splice(itemIndex, 1);
    const afterIndex = nextItems.findIndex((entry) => getId(entry) === afterId);

    if (afterIndex === -1) {
        nextItems.push(item);
        return nextItems;
    }

    nextItems.splice(afterIndex + 1, 0, item);
    return nextItems;
}

function getDefaultProductFilters() {
    return {
        search: '',
        category_id: [],
        category_count_filter: '',
        type: [],
        supplier_ids: [],
        inventory_unit_filter: '',
        has_images: '',
        has_seo: '',
        has_description: '',
        missing_purchase_price: '',
        multiple_suppliers: '',
        is_featured: '',
        is_new: '',
        min_price: '',
        max_price: '',
        min_stock: '',
        max_stock: '',
        start_date: '',
        end_date: '',
        attributes: {},
    };
}

function sanitizeAttributeFilterValues(rawValues, allowedValues = null) {
    const candidates = [];

    const pushCandidate = (value) => {
        if (value === null || value === undefined) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(pushCandidate);
            return;
        }

        const normalizedValue = String(value).trim();
        if (normalizedValue !== '') {
            candidates.push(normalizedValue);
        }
    };

    pushCandidate(rawValues);

    const uniqueCandidates = Array.from(new Set(candidates));
    if (!(allowedValues instanceof Set) || allowedValues.size === 0) {
        return uniqueCandidates;
    }

    return uniqueCandidates.filter((value) => allowedValues.has(value));
}

function sanitizeAttributeFilters(rawAttributes, attributeCatalog = []) {
    if (!rawAttributes || typeof rawAttributes !== 'object' || Array.isArray(rawAttributes)) {
        return {};
    }

    const catalogLookup = new Map(
        (Array.isArray(attributeCatalog) ? attributeCatalog : []).map((attribute) => [
            String(attribute?.id ?? '').trim(),
            new Set(
                (Array.isArray(attribute?.options) ? attribute.options : [])
                    .map((option) => String(option?.value ?? '').trim())
                    .filter(Boolean)
            ),
        ]).filter(([attributeId]) => attributeId !== '')
    );

    return Object.entries(rawAttributes).reduce((nextFilters, [attributeId, rawValues]) => {
        const normalizedAttributeId = String(attributeId ?? '').trim();
        if (normalizedAttributeId === '') {
            return nextFilters;
        }

        const allowedValues = catalogLookup.get(normalizedAttributeId) ?? null;
        const normalizedValues = sanitizeAttributeFilterValues(rawValues, allowedValues);
        if (normalizedValues.length === 0) {
            return nextFilters;
        }

        nextFilters[normalizedAttributeId] = normalizedValues;
        return nextFilters;
    }, {});
}

function sanitizeProductFilters(rawFilters, attributeCatalog = []) {
    const normalizeBinary = (value) => (value === true || value === 1 || value === '1') ? '1' : ((value === false || value === 0 || value === '0') ? '0' : '');
    
    const normalizedHasImages = normalizeBinary(rawFilters?.has_images);
    const normalizedHasSeo = normalizeBinary(rawFilters?.has_seo);
    const normalizedHasDescription = normalizeBinary(rawFilters?.has_description);

    return {
        ...rawFilters,
        has_images: normalizedHasImages,
        has_seo: normalizedHasSeo,
        has_description: normalizedHasDescription,
        category_count_filter: normalizeCategoryCountFilterValue(rawFilters?.category_count_filter),
        inventory_unit_filter: normalizeInventoryUnitFilterValue(rawFilters?.inventory_unit_filter),
        type: sanitizeActiveProductTypeValues(rawFilters?.type),
        attributes: sanitizeAttributeFilters(rawFilters?.attributes, attributeCatalog),
    };
}

function normalizeProductSortConfig(rawSortConfig) {
    if (!rawSortConfig) {
        return DEFAULT_SORT_CONFIG;
    }

    if (rawSortConfig.key === 'stock_quantity' || rawSortConfig.key === 'actual_stock' || rawSortConfig.key === 'sort_order') {
        return DEFAULT_SORT_CONFIG;
    }

    return rawSortConfig;
}

function normalizeCopiedSpecifications(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue
            .map((item) => ({
                label: String(item?.label ?? '').trim(),
                value: String(item?.value ?? '').trim(),
            }))
            .filter((item) => item.label || item.value);
    }

    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
        try {
            const parsed = JSON.parse(rawValue);
            return normalizeCopiedSpecifications(parsed);
        } catch (error) {
            return rawValue
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    const [labelPart, ...valueParts] = line.split(':');
                    return {
                        label: (labelPart || '').trim(),
                        value: valueParts.join(':').trim(),
                    };
                })
                .filter((item) => item.label || item.value);
        }
    }

    return [];
}

function normalizeCopiedAdditionalInfo(rawValue) {
    if (Array.isArray(rawValue)) {
        return rawValue
            .map((item) => ({
                title: String(item?.title ?? '').trim(),
                display_text: String(item?.display_text ?? '').trim(),
                post_id: item?.post_id ? String(item.post_id).trim() : '',
                post_title: String(item?.post_title ?? '').trim(),
                post_slug: String(item?.post_slug ?? '').trim(),
            }))
            .filter((item) => item.post_id);
    }

    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
        try {
            const parsed = JSON.parse(rawValue);
            return normalizeCopiedAdditionalInfo(parsed);
        } catch (error) {
            return [];
        }
    }

    return [];
}

function createEmptyBulkCopySelectionState() {
    return {
        specifications: [],
        additional_info: [],
    };
}

function buildBulkCopySpecificationItems(rawValue) {
    return normalizeCopiedSpecifications(rawValue).map((item, index) => ({
        ...item,
        copy_key: `specification-${index}`,
    }));
}

function buildBulkCopyAdditionalInfoItems(rawValue) {
    return normalizeCopiedAdditionalInfo(rawValue).map((item, index) => ({
        ...item,
        copy_key: `additional-info-${index}`,
    }));
}

function pickBulkCopyItems(items = [], selectedKeys = []) {
    const selectedKeyLookup = new Set(selectedKeys);

    return items
        .filter((item) => selectedKeyLookup.has(item.copy_key))
        .map(({ copy_key, ...payload }) => payload);
}

function resolveBundleOptionTitle(bundleItem) {
    const rawTitle = typeof bundleItem?.pivot?.option_title === 'string'
        ? bundleItem.pivot.option_title.trim()
        : '';

    return rawTitle || 'Mặc định';
}

function buildBundleOptionGroups(bundleItems) {
    if (!Array.isArray(bundleItems) || bundleItems.length === 0) {
        return [];
    }

    const groups = [];
    const groupMap = new Map();

    bundleItems.forEach((bundleItem, index) => {
        const optionTitle = resolveBundleOptionTitle(bundleItem);
        const optionUid = typeof bundleItem?.pivot?.bundle_option_uid === 'string'
            ? bundleItem.pivot.bundle_option_uid.trim()
            : '';
        const optionPostId = Number(bundleItem?.pivot?.option_post_id || 0);
        const groupKey = optionUid
            ? `uid:${optionUid}`
            : optionPostId > 0
            ? `post:${optionPostId}`
            : `title:${optionTitle.toLowerCase()}`;

        if (!groupMap.has(groupKey)) {
            const nextGroup = {
                key: groupKey,
                title: optionTitle,
                isDefault: Boolean(bundleItem?.pivot?.is_default),
                itemCount: 0,
                totalQuantity: 0,
                items: [],
            };

            groupMap.set(groupKey, nextGroup);
            groups.push(nextGroup);
        }

        const group = groupMap.get(groupKey);
        const quantity = Math.max(1, Number(bundleItem?.pivot?.quantity ?? 1) || 1);

        group.isDefault = group.isDefault || Boolean(bundleItem?.pivot?.is_default);
        group.itemCount += 1;
        group.totalQuantity += quantity;
        group.items.push({
            key: `${groupKey}-${bundleItem?.id || index}-${index}`,
            name: bundleItem?.name || 'Sản phẩm bundle',
            sku: bundleItem?.sku || '',
            quantity,
        });
    });

    return groups;
}

const QUICK_EDIT_DEFAULT_CORE_FIELD_IDS = ['name', 'sku', 'price', 'expected_cost', 'category_id', 'status'];
const QUICK_EDIT_CORE_FIELDS = [
    { id: 'name', label: 'Tên SP' },
    { id: 'sku', label: 'SKU' },
    { id: 'price', label: 'Giá bán' },
    { id: 'expected_cost', label: 'Giá nhập dự kiến' },
    { id: 'category_id', label: 'Danh mục' },
    { id: 'status', label: 'Trạng thái bán' },
    { id: 'type', label: 'Loại SP' },
    { id: 'is_featured', label: 'Nổi bật' },
    { id: 'is_new', label: 'Mới' },
];

function normalizeQuickEditSearchText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function normalizeQuickEditSkuValue(value) {
    return String(value ?? '').trim().replace(/\s+/g, '-');
}

function normalizeQuickEditAttributeValue(attribute, rawValue) {
    const frontendType = String(attribute?.frontend_type || '').toLowerCase();

    if (frontendType === 'multiselect') {
        if (Array.isArray(rawValue)) {
            return rawValue.map((value) => String(value));
        }

        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return [];
        }

        if (typeof rawValue === 'string') {
            try {
                const parsed = JSON.parse(rawValue);
                if (Array.isArray(parsed)) {
                    return parsed.map((value) => String(value));
                }
            } catch (error) {
                return rawValue
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean);
            }
        }

        return [];
    }

    if (frontendType === 'price') {
        return normalizeWholeMoneyDraft(rawValue);
    }

    if (rawValue === null || rawValue === undefined) {
        return '';
    }

    return String(rawValue);
}

function getQuickEditAttributeValue(product, attribute) {
    const attributeValue = product?.attribute_values?.find((item) => String(item?.attribute_id) === String(attribute?.id));
    return normalizeQuickEditAttributeValue(attribute, attributeValue?.value);
}

function normalizeQuickEditProductType(value) {
    return String(value || '').trim().toLowerCase();
}

function isExpandableAdminListProduct(product) {
    return ['configurable', 'grouped', 'bundle'].includes(normalizeQuickEditProductType(product?.type));
}

function hasLoadedAdminListChildren(product) {
    if (!isExpandableAdminListProduct(product)) {
        return true;
    }

    if (product?._children_loaded) {
        return true;
    }

    return Array.isArray(product?.variations)
        || Array.isArray(product?.grouped_items)
        || Array.isArray(product?.bundle_items);
}

function mergeAdminProductDetail(summaryProduct, detailProduct) {
    return {
        ...(summaryProduct || {}),
        ...(detailProduct || {}),
        _children_loaded: true,
    };
}

function getQuickEditConfigurableSourceId(product) {
    if (!product || typeof product !== 'object') {
        return null;
    }

    const parentProduct = getConfigurableParentProduct(product);
    if (parentProduct?.id !== undefined && parentProduct?.id !== null) {
        return normalizeStoredId(parentProduct.id);
    }

    if (normalizeQuickEditProductType(product?.type) === 'configurable') {
        return normalizeStoredId(product?.id);
    }

    return null;
}

function normalizeQuickEditAttributeSummaryValue(rawValue) {
    if (rawValue === null || rawValue === undefined) {
        return '';
    }

    if (Array.isArray(rawValue)) {
        return rawValue
            .map((item) => normalizeQuickEditAttributeSummaryValue(item))
            .filter(Boolean)
            .join(', ');
    }

    if (typeof rawValue === 'string') {
        const trimmedValue = rawValue.trim();
        if (!trimmedValue) {
            return '';
        }

        try {
            return normalizeQuickEditAttributeSummaryValue(JSON.parse(trimmedValue));
        } catch (_error) {
            return trimmedValue;
        }
    }

    if (typeof rawValue === 'object') {
        const objectValues = Object.values(rawValue)
            .map((item) => normalizeQuickEditAttributeSummaryValue(item))
            .filter(Boolean);

        return objectValues.length > 0
            ? objectValues.join(', ')
            : JSON.stringify(rawValue);
    }

    return String(rawValue);
}

function buildQuickEditAttributeSummary(product, attributes = []) {
    const attributeLookup = new Map(
        (Array.isArray(attributes) ? attributes : []).map((attribute) => [String(attribute.id), attribute]),
    );

    return (Array.isArray(product?.attribute_values) ? product.attribute_values : [])
        .map((attributeValue) => {
            const attribute = attributeValue?.attribute || attributeLookup.get(String(attributeValue?.attribute_id));
            const label = String(attribute?.name || '').trim();
            const value = normalizeQuickEditAttributeSummaryValue(attributeValue?.value);

            if (!value) {
                return '';
            }

            return label ? `${label}: ${value}` : value;
        })
        .filter(Boolean)
        .join(' • ');
}

function buildQuickEditEditableProduct(product, attributes = [], options = {}) {
    const parentProduct = options.parentProduct || null;

    return {
        ...product,
        quick_edit_row_type: options.rowType || 'product',
        quick_edit_parent_id: parentProduct?.id ?? null,
        quick_edit_parent_name: String(parentProduct?.name || ''),
        quick_edit_parent_sku: String(parentProduct?.sku || ''),
        quick_edit_variant_count: Number(options.variantCount ?? 0) || 0,
        quick_edit_attribute_summary: buildQuickEditAttributeSummary(product, attributes),
    };
}

function expandQuickEditProducts(product, attributes = []) {
    if (!product || typeof product !== 'object') {
        return [];
    }

    const variations = Array.isArray(product?.variations) ? product.variations : [];
    if (normalizeQuickEditProductType(product?.type) === 'configurable' && variations.length > 0) {
        return [
            buildQuickEditEditableProduct(product, attributes, {
                rowType: 'parent',
                variantCount: variations.length,
            }),
            ...variations.map((variation) => buildQuickEditEditableProduct(variation, attributes, {
                rowType: 'variant',
                parentProduct: product,
            })),
        ];
    }

    return [buildQuickEditEditableProduct(product, attributes)];
}

function groupQuickEditProducts(products = []) {
    const groups = [];
    const groupMap = new Map();
    let fallbackGroupIndex = 0;

    const ensureGroup = (rawGroupId) => {
        const groupId = rawGroupId === null || rawGroupId === undefined || rawGroupId === ''
            ? `quick-edit-group-${fallbackGroupIndex++}`
            : String(rawGroupId);

        if (!groupMap.has(groupId)) {
            const nextGroup = {
                id: groupId,
                parent: null,
                variants: [],
            };

            groupMap.set(groupId, nextGroup);
            groups.push(nextGroup);
        }

        return groupMap.get(groupId);
    };

    (Array.isArray(products) ? products : []).forEach((product) => {
        const rowType = String(product?.quick_edit_row_type || 'product');

        if (rowType === 'variant') {
            const variantGroup = ensureGroup(product?.quick_edit_parent_id ?? product?.id);
            variantGroup.variants.push(product);
            return;
        }

        const parentGroup = ensureGroup(product?.id);
        parentGroup.parent = product;
    });

    return groups
        .map((group) => {
            if (group.parent) {
                return group;
            }

            if (group.variants.length === 0) {
                return null;
            }

            return {
                ...group,
                parent: group.variants[0],
                variants: group.variants.slice(1),
            };
        })
        .filter(Boolean);
}

function getQuickEditRowLabel({ isVariantRow = false, isParentRow = false, hasVariants = false } = {}) {
    if (isVariantRow) {
        return 'Biến thể';
    }

    if (isParentRow || hasVariants) {
        return 'Sản phẩm cha';
    }

    return 'Sản phẩm đơn';
}

function getQuickEditRowLabelClass({ isVariantRow = false, isParentRow = false, hasVariants = false } = {}) {
    if (isVariantRow) {
        return 'border-sky-200 bg-sky-50 text-sky-700';
    }

    if (isParentRow || hasVariants) {
        return 'border-amber-200 bg-amber-50 text-amber-700';
    }

    return 'border-primary/15 bg-primary/[0.04] text-primary/75';
}

function buildQuickEditProductDraft(product, attributes = []) {
    const customAttributes = Object.fromEntries(
        attributes.map((attribute) => [String(attribute.id), getQuickEditAttributeValue(product, attribute)]),
    );

    return {
        id: product?.id ?? null,
        name: String(product?.name || ''),
        sku: String(product?.sku || ''),
        price: normalizeWholeMoneyDraft(product?.price),
        expected_cost: normalizeWholeMoneyDraft(product?.expected_cost ?? product?.cost_price),
        category_id: product?.category_id ? String(product.category_id) : '',
        status: Boolean(product?.status),
        type: String(product?.type || 'simple'),
        is_featured: Boolean(product?.is_featured),
        is_new: Boolean(product?.is_new),
        custom_attributes: customAttributes,
    };
}

function getQuickEditCoreComparableValue(fieldId, value) {
    if (fieldId === 'price') {
        return normalizeWholeMoneyNumber(value);
    }

    if (fieldId === 'expected_cost') {
        return normalizeRoundedImportCostNumber(value);
    }

    if (fieldId === 'status' || fieldId === 'is_featured' || fieldId === 'is_new') {
        return Boolean(value);
    }

    if (fieldId === 'category_id') {
        return value === '' || value === null || value === undefined ? '' : String(value);
    }

    if (fieldId === 'sku') {
        return normalizeQuickEditSkuValue(value);
    }

    return String(value ?? '').trim();
}

function getQuickEditAttributeComparableValue(attribute, value) {
    const frontendType = String(attribute?.frontend_type || '').toLowerCase();

    if (frontendType === 'multiselect') {
        return JSON.stringify(
            (Array.isArray(value) ? value : [])
                .map((item) => String(item))
                .sort(),
        );
    }

    if (frontendType === 'price') {
        return normalizeWholeMoneyNumber(value);
    }

    return String(value ?? '').trim();
}

function createQuickEditProductLookup(products = []) {
    const productMap = new Map();

    (Array.isArray(products) ? products : []).forEach((product) => {
        if (product?.id !== undefined && product?.id !== null) {
            productMap.set(String(product.id), product);
        }

        const children = product?.type === 'grouped'
            ? (product.grouped_items || [])
            : (product?.type === 'bundle' ? [] : (product?.variations || []));

        (Array.isArray(children) ? children : []).forEach((child) => {
            if (child?.id !== undefined && child?.id !== null) {
                productMap.set(String(child.id), child);
            }
        });
    });

    return productMap;
}

function findQuickEditGlazeAttribute(attributes = []) {
    return (Array.isArray(attributes) ? attributes : []).find((attribute) => (
        normalizeQuickEditSearchText(attribute?.name).includes('loai men')
    )) || null;
}

function buildQuickEditSearchIndex(product, draft = null, original = null) {
    const values = [];

    const pushValue = (value) => {
        if (value === null || value === undefined) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(pushValue);
            return;
        }

        const normalizedValue = String(value).trim();
        if (!normalizedValue) {
            return;
        }

        values.push(normalizedValue);
    };

    const pushProductReferences = (item) => {
        if (!item || typeof item !== 'object') {
            return;
        }

        pushValue(item.name);
        pushValue(item.sku);
        pushValue(item.variant_sku);
        pushValue(item.variant_code);
        pushValue(item.variation_sku);
        pushValue(item.variation_code);
        pushValue(item.supplier_product_code);
    };

    pushProductReferences(product);
    pushValue(product?.slug);
    pushValue(product?.id);
    pushValue(draft?.name);
    pushValue(draft?.sku);
    pushValue(original?.name);
    pushValue(original?.sku);
    pushValue(product?.quick_edit_parent_name);
    pushValue(product?.quick_edit_attribute_summary);
    pushProductReferences(getVariantParentProduct(product));
    pushProductReferences(getConfigurableParentProduct(product));

    (Array.isArray(product?.parent_products) ? product.parent_products : []).forEach(pushProductReferences);
    (Array.isArray(product?.parent_configurable) ? product.parent_configurable : []).forEach(pushProductReferences);
    (Array.isArray(product?.variations) ? product.variations : []).forEach(pushProductReferences);

    return normalizeQuickEditSearchText(values.join(' '));
}

const ProductList = () => {
    const { user } = useAuth();
    const canViewProductCost = hasAdminDataPermission(user, 'cost.view');
    const canCreateProducts = hasAdminPermission(user, 'products.create');
    const canUpdateProducts = hasAdminPermission(user, 'products.update');
    const canDeleteProducts = hasAdminPermission(user, 'products.delete_soft');
    const canDeleteProductsPermanently = hasAdminPermission(user, 'products.delete_permanent');
    const canExportProducts = hasAdminPermission(user, 'products.export');
    const permittedProductColumns = useMemo(
        () => (canViewProductCost ? DEFAULT_COLUMNS : DEFAULT_COLUMNS.filter((column) => column.id !== 'cost_price')),
        [canViewProductCost]
    );
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const navigate = useNavigate();
    const location = useLocation();
    const initialSavedStateRef = useRef(null);
    if (!initialSavedStateRef.current) {
        initialSavedStateRef.current = getSavedProductListState();
    }
    const savedState = initialSavedStateRef.current.combined;
    const savedWorkingState = initialSavedStateRef.current.working;
    const pageRootRef = useRef(null);
    const tableScrollRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const pendingScrollRestoreRef = useRef(normalizeStoredScrollTop(savedWorkingState?.scrollTop));
    const pendingScrollRestoreLeftRef = useRef(normalizeStoredScrollTop(savedWorkingState?.scrollLeft));
    const workingStateSnapshotRef = useRef(null);
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const importInputRef = useRef(null);
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [inventoryUnits, setInventoryUnits] = useState([]);
    const [domains, setDomains] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIdsState] = useState(() => sanitizeStoredIdList(savedWorkingState?.selectedIds));
    const selectedIdsRef = useRef(selectedIds);
    const setSelectedIds = useCallback((value) => {
        const nextValue = typeof value === 'function'
            ? value(selectedIdsRef.current)
            : value;
        const normalizedValue = sanitizeStoredIdList(nextValue);
        selectedIdsRef.current = normalizedValue;
        setSelectedIdsState(normalizedValue);
    }, []);
    const [showSelectedOnly, setShowSelectedOnlyState] = useState(false);
    const showSelectedOnlyRef = useRef(showSelectedOnly);
    const setShowSelectedOnly = useCallback((value) => {
        const nextValue = Boolean(
            typeof value === 'function'
                ? value(showSelectedOnlyRef.current)
                : value
        );
        showSelectedOnlyRef.current = nextValue;
        setShowSelectedOnlyState(nextValue);
    }, []);
    const selectedOnlyRestorePageRef = useRef(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showImportConfigModal, setShowImportConfigModal] = useState(false);
    const [copiedText, setCopiedText] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    const [expandedRows, setExpandedRows] = useState(() => sanitizeStoredIdList(savedWorkingState?.expandedRows));
    const [loadingExpandedIds, setLoadingExpandedIds] = useState([]);
    const loadingExpandedIdSet = useMemo(
        () => new Set(loadingExpandedIds.map((id) => String(id))),
        [loadingExpandedIds],
    );
    const [exportColumnIds, setExportColumnIds] = useState(DEFAULT_EXPORT_COLUMN_IDS);
    const [exportOnlySelected, setExportOnlySelected] = useState(false);
    const [isExportingExcel, setIsExportingExcel] = useState(false);
    const [isImportingExcel, setIsImportingExcel] = useState(false);
    const [pendingImportFile, setPendingImportFile] = useState(null);
    const [importMode, setImportMode] = useState(DEFAULT_IMPORT_MODE);
    const [importMissingProductAction, setImportMissingProductAction] = useState(DEFAULT_IMPORT_MISSING_PRODUCT_ACTION);
    const [importUpdateFieldIds, setImportUpdateFieldIds] = useState([]);
    const [importAttributeSearch, setImportAttributeSearch] = useState('');
    const [importExcelErrors, setImportExcelErrors] = useState([]);
    const [importExcelErrorMessage, setImportExcelErrorMessage] = useState('');
    const [importExcelResultTone, setImportExcelResultTone] = useState('error');
    const [showProductSortModal, setShowProductSortModal] = useState(false);
    const [productSortItems, setProductSortItems] = useState([]);
    const [isProductSortLoading, setIsProductSortLoading] = useState(false);
    const [isProductSortSaving, setIsProductSortSaving] = useState(false);
    const [isProductSortDirty, setIsProductSortDirty] = useState(false);
    const productSortSnapshotRef = useRef([]);

    const toggleExpandRow = async (productId, e) => {
        if (e) e.stopPropagation();

        const productKey = String(productId);
        const isCurrentlyExpanded = expandedRows.some((id) => String(id) === productKey);
        if (isCurrentlyExpanded) {
            setExpandedRows((prev) => prev.filter((id) => String(id) !== productKey));
            return;
        }

        if (loadingExpandedIdSet.has(productKey)) {
            return;
        }

        const product = products.find((item) => String(item?.id) === productKey);
        if (product && isExpandableAdminListProduct(product) && !hasLoadedAdminListChildren(product)) {
            setLoadingExpandedIds((prev) => (
                prev.some((id) => String(id) === productKey) ? prev : [...prev, productId]
            ));

            try {
                const response = await productApi.getOne(productId, { context: 'edit' });
                const detailProduct = response.data || {};
                setProducts((prevProducts) => prevProducts.map((item) => (
                    String(item?.id) === productKey
                        ? mergeAdminProductDetail(item, detailProduct)
                        : item
                )));
            } catch (error) {
                console.error('Product row detail load error:', error);
                setNotification({
                    type: 'error',
                    message: error?.response?.data?.message || 'Không tải được chi tiết sản phẩm.',
                });
                setTimeout(() => setNotification(null), 4000);
                return;
            } finally {
                setLoadingExpandedIds((prev) => prev.filter((id) => String(id) !== productKey));
            }
        }

        setExpandedRows((prev) => (
            prev.some((id) => String(id) === productKey) ? prev : [...prev, productId]
        ));
    };


    const [showBulkUpdateModal, setShowBulkUpdateModal] = useState(false);
    const [showBulkImageAppendModal, setShowBulkImageAppendModal] = useState(false);
    const [showBulkImageRefreshModal, setShowBulkImageRefreshModal] = useState(false);
    const [showCategoryImageManagerModal, setShowCategoryImageManagerModal] = useState(false);
    const [showBulkSeoModal, setShowBulkSeoModal] = useState(false);
    const [bulkSeoAutoStartToken, setBulkSeoAutoStartToken] = useState(null);
    const [bulkUpdateData, setBulkUpdateData] = useState({});
    const [lastBulkUpdateLogId, setLastBulkUpdateLogId] = useState(null);
    const [openAttrId, setOpenAttrId] = useState(null);
    const [showBulkCopyModal, setShowBulkCopyModal] = useState(false);
    const [bulkCopySourceQuery, setBulkCopySourceQuery] = useState('');
    const [bulkCopySourceResults, setBulkCopySourceResults] = useState([]);
    const [bulkCopySourceProduct, setBulkCopySourceProduct] = useState(null);
    const [bulkCopySourceItems, setBulkCopySourceItems] = useState(createEmptyBulkCopySelectionState);
    const [bulkCopySelectedItemKeys, setBulkCopySelectedItemKeys] = useState(createEmptyBulkCopySelectionState);
    const [bulkCopySourceItemsLoading, setBulkCopySourceItemsLoading] = useState(false);
    const [bulkCopySourceItemsError, setBulkCopySourceItemsError] = useState('');
    const [submittingBulkCopy, setSubmittingBulkCopy] = useState(false);
    const bulkCopySourceRequestRef = useRef(0);
    const categoryImageManagerDirtyRef = useRef(false);
    const [duplicateConfirm, setDuplicateConfirm] = useState(null);
    const [submittingDuplicate, setSubmittingDuplicate] = useState(false);
    const [showQuickEditModal, setShowQuickEditModal] = useState(false);
    const [quickEditTargetIds, setQuickEditTargetIds] = useState([]);
    const [quickEditProducts, setQuickEditProducts] = useState([]);
    const [quickEditDrafts, setQuickEditDrafts] = useState({});
    const [quickEditOriginals, setQuickEditOriginals] = useState({});
    const [quickEditSelectedCoreFields, setQuickEditSelectedCoreFields] = useState(QUICK_EDIT_DEFAULT_CORE_FIELD_IDS);
    const [quickEditSelectedAttributeIds, setQuickEditSelectedAttributeIds] = useState([]);
    const [quickEditLoading, setQuickEditLoading] = useState(false);
    const [quickEditSubmitting, setQuickEditSubmitting] = useState(false);
    const [quickEditRowErrors, setQuickEditRowErrors] = useState({});
    const [quickEditSearchQuery, setQuickEditSearchQuery] = useState('');
    const [quickEditExpanded, setQuickEditExpanded] = useState(false);
    const [quickEditExpandedGroupIds, setQuickEditExpandedGroupIds] = useState([]);
    const quickEditTableScrollRef = useRef(null);
    const quickEditTopScrollbarRef = useRef(null);
    const quickEditHorizontalSyncSourceRef = useRef(null);
    const [quickEditTableMetrics, setQuickEditTableMetrics] = useState({ scrollWidth: 0, clientWidth: 0 });
    const [bulkSeoGenerating, setBulkSeoGenerating] = useState(false);
    const [bulkSeoProgress, setBulkSeoProgress] = useState({ current: 0, total: 0, failed: 0 });
    const [syncingGoogleMerchant, setSyncingGoogleMerchant] = useState(false);
    const [generatingAiReviews, setGeneratingAiReviews] = useState(false);
    const [aiReviewProgress, setAiReviewProgress] = useState({ current: 0, total: 0, failed: 0 });
    const [aiReviewProductStates, setAiReviewProductStates] = useState({});

    const [editingProductId, setEditingProductId] = useState(null);
    const [editForm, setEditForm] = useState({ price: '', expected_cost: '' });
    const [savingId, setSavingId] = useState(null);

    const quickEditSelectedAttributes = allAttributes.filter((attribute) => (
        quickEditSelectedAttributeIds.includes(String(attribute.id))
    ));
    const quickEditSelectedCoreFieldKey = quickEditSelectedCoreFields.join('|');
    const quickEditSelectedAttributeKey = quickEditSelectedAttributeIds.join('|');
    const quickEditNormalizedSearchQuery = normalizeQuickEditSearchText(quickEditSearchQuery);
    const quickEditProductGroups = useMemo(() => groupQuickEditProducts(quickEditProducts), [quickEditProducts]);
    const quickEditExpandedGroupIdSet = useMemo(
        () => new Set(quickEditExpandedGroupIds.map((id) => String(id))),
        [quickEditExpandedGroupIds],
    );
    const quickEditFilteredGroups = useMemo(() => (
        quickEditProductGroups
            .filter((group) => {
                if (!quickEditNormalizedSearchQuery) {
                    return true;
                }

                const parent = group?.parent;
                if (!parent) {
                    return false;
                }

                const parentKey = String(parent?.id ?? '');
                const parentMatches = buildQuickEditSearchIndex(
                    parent,
                    quickEditDrafts[parentKey],
                    quickEditOriginals[parentKey],
                ).includes(quickEditNormalizedSearchQuery);

                if (parentMatches) {
                    return true;
                }

                return group.variants.some((variant) => {
                    const variantKey = String(variant?.id ?? '');
                    const searchIndex = buildQuickEditSearchIndex(
                        variant,
                        quickEditDrafts[variantKey],
                        quickEditOriginals[variantKey],
                    );

                    return searchIndex.includes(quickEditNormalizedSearchQuery);
                });
            })
            .map((group) => ({
                ...group,
                isExpanded: quickEditExpandedGroupIdSet.has(String(group.id)),
                visibleVariants: quickEditExpandedGroupIdSet.has(String(group.id))
                    ? group.variants
                    : [],
            }))
    ), [
        quickEditDrafts,
        quickEditExpandedGroupIdSet,
        quickEditNormalizedSearchQuery,
        quickEditOriginals,
        quickEditProductGroups,
    ]);
    const quickEditRenderedRowCount = useMemo(
        () => quickEditFilteredGroups.reduce((total, group) => total + 1 + group.visibleVariants.length, 0),
        [quickEditFilteredGroups],
    );
    const quickEditHasHorizontalOverflow = quickEditTableMetrics.scrollWidth > (quickEditTableMetrics.clientWidth + 1);
    const quickEditTopScrollbarWidth = Math.max(quickEditTableMetrics.scrollWidth, quickEditTableMetrics.clientWidth, 0);

    const toggleQuickEditGroupExpansion = useCallback((groupId, event = null) => {
        if (event) {
            event.stopPropagation();
        }

        const normalizedGroupId = String(groupId ?? '').trim();
        if (!normalizedGroupId) {
            return;
        }

        setQuickEditExpandedGroupIds((prev) => (
            prev.includes(normalizedGroupId)
                ? prev.filter((value) => value !== normalizedGroupId)
                : [...prev, normalizedGroupId]
        ));
    }, []);

    const measureQuickEditTableMetrics = useCallback(() => {
        const scrollElement = quickEditTableScrollRef.current;
        if (!scrollElement) {
            setQuickEditTableMetrics((prev) => (
                prev.scrollWidth === 0 && prev.clientWidth === 0
                    ? prev
                    : { scrollWidth: 0, clientWidth: 0 }
            ));
            return;
        }

        const nextMetrics = {
            scrollWidth: scrollElement.scrollWidth,
            clientWidth: scrollElement.clientWidth,
        };

        setQuickEditTableMetrics((prev) => (
            prev.scrollWidth === nextMetrics.scrollWidth && prev.clientWidth === nextMetrics.clientWidth
                ? prev
                : nextMetrics
        ));
    }, []);

    const syncQuickEditHorizontalScroll = useCallback((source, scrollLeft) => {
        const target = source === 'top'
            ? quickEditTableScrollRef.current
            : quickEditTopScrollbarRef.current;

        if (!target) {
            return;
        }

        quickEditHorizontalSyncSourceRef.current = source;
        target.scrollLeft = scrollLeft;

        if (typeof window === 'undefined') {
            quickEditHorizontalSyncSourceRef.current = null;
            return;
        }

        window.requestAnimationFrame(() => {
            if (quickEditHorizontalSyncSourceRef.current === source) {
                quickEditHorizontalSyncSourceRef.current = null;
            }
        });
    }, []);

    const handleQuickEditTopScrollbarScroll = useCallback((event) => {
        if (quickEditHorizontalSyncSourceRef.current === 'table') {
            return;
        }

        syncQuickEditHorizontalScroll('top', event.currentTarget.scrollLeft);
    }, [syncQuickEditHorizontalScroll]);

    const handleQuickEditTableScroll = useCallback((event) => {
        if (quickEditHorizontalSyncSourceRef.current === 'top') {
            return;
        }

        syncQuickEditHorizontalScroll('table', event.currentTarget.scrollLeft);
    }, [syncQuickEditHorizontalScroll]);

    useEffect(() => {
        if (!showQuickEditModal) {
            return undefined;
        }

        const syncMetricsAndScrollbar = () => {
            measureQuickEditTableMetrics();

            const tableScrollElement = quickEditTableScrollRef.current;
            const topScrollElement = quickEditTopScrollbarRef.current;
            if (tableScrollElement && topScrollElement && topScrollElement.scrollLeft !== tableScrollElement.scrollLeft) {
                topScrollElement.scrollLeft = tableScrollElement.scrollLeft;
            }
        };

        if (typeof window === 'undefined') {
            syncMetricsAndScrollbar();
            return undefined;
        }

        const frameId = window.requestAnimationFrame(syncMetricsAndScrollbar);
        window.addEventListener('resize', syncMetricsAndScrollbar);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', syncMetricsAndScrollbar);
        };
    }, [
        showQuickEditModal,
        quickEditLoading,
        quickEditRenderedRowCount,
        quickEditSelectedCoreFieldKey,
        quickEditSelectedAttributeKey,
        quickEditExpanded,
        quickEditNormalizedSearchQuery,
        measureQuickEditTableMetrics,
    ]);

    useEffect(() => {
        if (!showQuickEditModal) {
            return;
        }

        const tableScrollElement = quickEditTableScrollRef.current;
        if (tableScrollElement) {
            tableScrollElement.scrollTop = 0;
        }
    }, [showQuickEditModal, quickEditNormalizedSearchQuery]);

    const resetQuickEditState = useCallback(() => {
        setShowQuickEditModal(false);
        setQuickEditTargetIds([]);
        setQuickEditProducts([]);
        setQuickEditDrafts({});
        setQuickEditOriginals({});
        setQuickEditSelectedCoreFields(QUICK_EDIT_DEFAULT_CORE_FIELD_IDS);
        setQuickEditSelectedAttributeIds([]);
        setQuickEditLoading(false);
        setQuickEditSubmitting(false);
        setQuickEditRowErrors({});
        setQuickEditSearchQuery('');
        setQuickEditExpanded(false);
        setQuickEditExpandedGroupIds([]);
        setQuickEditTableMetrics({ scrollWidth: 0, clientWidth: 0 });
        quickEditHorizontalSyncSourceRef.current = null;
    }, []);

    const closeQuickEditModal = useCallback(() => {
        if (quickEditSubmitting) {
            return;
        }

        resetQuickEditState();
    }, [quickEditSubmitting, resetQuickEditState]);

    useEffect(() => {
        if (!showQuickEditModal || typeof window === 'undefined') {
            return undefined;
        }

        const previousOverflow = window.document.body.style.overflow;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !quickEditSubmitting) {
                closeQuickEditModal();
            }
        };

        window.document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeQuickEditModal, quickEditSubmitting, showQuickEditModal]);

    const updateQuickEditDraft = (productId, field, value) => {
        const draftKey = String(productId);
        setQuickEditDrafts((prev) => ({
            ...prev,
            [draftKey]: {
                ...(prev[draftKey] || {}),
                [field]: value,
            },
        }));

        setQuickEditRowErrors((prev) => {
            if (!prev[draftKey]) {
                return prev;
            }

            const next = { ...prev };
            delete next[draftKey];
            return next;
        });
    };

    const updateQuickEditAttributeDraft = (productId, attributeId, value) => {
        const draftKey = String(productId);
        const attributeKey = String(attributeId);

        setQuickEditDrafts((prev) => ({
            ...prev,
            [draftKey]: {
                ...(prev[draftKey] || {}),
                custom_attributes: {
                    ...((prev[draftKey] && prev[draftKey].custom_attributes) || {}),
                    [attributeKey]: value,
                },
            },
        }));

        setQuickEditRowErrors((prev) => {
            if (!prev[draftKey]) {
                return prev;
            }

            const next = { ...prev };
            delete next[draftKey];
            return next;
        });
    };

    const toggleQuickEditCoreField = (fieldId) => {
        setQuickEditSelectedCoreFields((prev) => (
            prev.includes(fieldId)
                ? prev.filter((value) => value !== fieldId)
                : [...prev, fieldId]
        ));
    };

    const toggleQuickEditAttributeField = (attributeId) => {
        const normalizedId = String(attributeId);
        setQuickEditSelectedAttributeIds((prev) => (
            prev.includes(normalizedId)
                ? prev.filter((value) => value !== normalizedId)
                : [...prev, normalizedId]
        ));
    };

    const isQuickEditCoreFieldDirty = (productId, fieldId) => {
        const draft = quickEditDrafts[String(productId)];
        const original = quickEditOriginals[String(productId)];

        if (!draft || !original) {
            return false;
        }

        return getQuickEditCoreComparableValue(fieldId, draft[fieldId]) !== getQuickEditCoreComparableValue(fieldId, original[fieldId]);
    };

    const isQuickEditAttributeFieldDirty = (productId, attribute) => {
        const productKey = String(productId);
        const attributeKey = String(attribute.id);
        const draftValue = quickEditDrafts[productKey]?.custom_attributes?.[attributeKey];
        const originalValue = quickEditOriginals[productKey]?.custom_attributes?.[attributeKey];

        return getQuickEditAttributeComparableValue(attribute, draftValue) !== getQuickEditAttributeComparableValue(attribute, originalValue);
    };

    const openQuickEditModal = async (ids, event = null) => {
        if (event) {
            event.stopPropagation();
        }

        const normalizedIds = Array.from(
            new Map(
                (Array.isArray(ids) ? ids : [ids])
                    .map((value) => normalizeStoredId(value))
                    .filter((value) => value !== null)
                    .map((value) => [String(value), value]),
            ).values(),
        );

        if (normalizedIds.length === 0) {
            return;
        }

        setShowQuickEditModal(true);
        setQuickEditLoading(true);
        setQuickEditRowErrors({});
        setQuickEditSearchQuery('');
        setQuickEditExpanded(false);
        setQuickEditExpandedGroupIds([]);

        try {
            const visibleLookup = createQuickEditProductLookup(products);
            const selectedLookup = new Map();

            normalizedIds.forEach((id) => {
                const matched = visibleLookup.get(String(id));
                if (matched) {
                    selectedLookup.set(String(id), matched);
                }
            });

            const missingIds = normalizedIds.filter((id) => {
                const matchedProduct = selectedLookup.get(String(id));

                return !matchedProduct
                    || (isExpandableAdminListProduct(matchedProduct) && !hasLoadedAdminListChildren(matchedProduct));
            });
            let failedCount = 0;
            if (missingIds.length > 0) {
                const loadedProducts = await Promise.allSettled(
                    missingIds.map((id) => productApi.getOne(id, { context: 'edit' })),
                );

                loadedProducts.forEach((result, index) => {
                    const targetId = missingIds[index];
                    if (result.status === 'fulfilled' && result.value?.data) {
                        selectedLookup.set(String(targetId), result.value.data);
                    } else {
                        failedCount += 1;
                    }
                });

                if (failedCount > 0) {
                    setNotification({
                        type: 'error',
                        message: `Không tải được ${failedCount} sản phẩm cho chế độ sửa nhanh.`,
                    });
                    setTimeout(() => setNotification(null), 4000);
                }
            }

            const configurableSourceIds = Array.from(
                new Map(
                    normalizedIds
                        .map((id) => getQuickEditConfigurableSourceId(selectedLookup.get(String(id))))
                        .filter((value) => value !== null)
                        .map((value) => [String(value), value]),
                ).values(),
            );

            const configurableLookup = new Map();
            configurableSourceIds.forEach((id) => {
                const selectedProduct = selectedLookup.get(String(id));
                if (selectedProduct) {
                    configurableLookup.set(String(id), selectedProduct);
                }
            });
            const configurableSourceIdsToLoad = configurableSourceIds.filter((id) => {
                const cachedProduct = configurableLookup.get(String(id));

                return !cachedProduct || !hasLoadedAdminListChildren(cachedProduct);
            });
            let failedConfigurableCount = 0;
            if (configurableSourceIdsToLoad.length > 0) {
                const loadedConfigurableProducts = await Promise.allSettled(
                    configurableSourceIdsToLoad.map((id) => productApi.getOne(id, { context: 'edit' })),
                );

                loadedConfigurableProducts.forEach((result, index) => {
                    const targetId = configurableSourceIdsToLoad[index];
                    if (result.status === 'fulfilled' && result.value?.data) {
                        configurableLookup.set(String(targetId), result.value.data);
                    } else {
                        failedConfigurableCount += 1;
                    }
                });
            }

            if (failedConfigurableCount > 0) {
                const messageParts = [];

                if (failedCount > 0) {
                    messageParts.push(`không tải được ${failedCount} sản phẩm`);
                }

                if (failedConfigurableCount > 0) {
                    messageParts.push(`không tải đủ chi tiết biến thể cho ${failedConfigurableCount} sản phẩm có biến thể`);
                }

                setNotification({
                    type: 'error',
                    message: `Chế độ sửa nhanh: ${messageParts.join(' và ')}.`,
                });
                setTimeout(() => setNotification(null), 5000);
            }

            const resolvedProducts = [];
            const resolvedRowIds = new Set();

            normalizedIds.forEach((id) => {
                const selectedProduct = selectedLookup.get(String(id));
                if (!selectedProduct) {
                    return;
                }

                const configurableSourceId = getQuickEditConfigurableSourceId(selectedProduct);
                const expandedProducts = configurableSourceId !== null
                    ? expandQuickEditProducts(
                        configurableLookup.get(String(configurableSourceId))
                        || visibleLookup.get(String(configurableSourceId))
                        || (normalizeQuickEditProductType(selectedProduct?.type) === 'configurable' ? selectedProduct : null)
                        || selectedProduct,
                        allAttributes,
                    )
                    : expandQuickEditProducts(selectedProduct, allAttributes);

                expandedProducts.forEach((product) => {
                    if (!product?.id || resolvedRowIds.has(String(product.id))) {
                        return;
                    }

                    resolvedRowIds.add(String(product.id));
                    resolvedProducts.push(product);
                });
            });

            if (resolvedProducts.length === 0) {
                resetQuickEditState();
                return;
            }

            const glazeAttribute = findQuickEditGlazeAttribute(allAttributes);
            const nextDrafts = Object.fromEntries(
                resolvedProducts.map((product) => [String(product.id), buildQuickEditProductDraft(product, allAttributes)]),
            );
            const nextExpandedGroupIds = Array.from(
                new Map(
                    normalizedIds
                        .map((id) => {
                            const selectedProduct = selectedLookup.get(String(id));
                            if (!isVariantChildProduct(selectedProduct)) {
                                return null;
                            }

                            const sourceGroupId = getQuickEditConfigurableSourceId(selectedProduct);
                            return sourceGroupId === null
                                ? null
                                : [String(sourceGroupId), String(sourceGroupId)];
                        })
                        .filter(Boolean),
                ).values(),
            );

            setQuickEditTargetIds(resolvedProducts.map((product) => product.id));
            setQuickEditProducts(resolvedProducts);
            setQuickEditDrafts(nextDrafts);
            setQuickEditOriginals(nextDrafts);
            setQuickEditSelectedCoreFields(QUICK_EDIT_DEFAULT_CORE_FIELD_IDS);
            setQuickEditSelectedAttributeIds(glazeAttribute ? [String(glazeAttribute.id)] : []);
            setQuickEditExpandedGroupIds(nextExpandedGroupIds);
        } catch (error) {
            console.error('Quick edit load error:', error);
            setNotification({
                type: 'error',
                message: error?.response?.data?.message || 'Không thể mở cửa sổ sửa nhanh.',
            });
            setTimeout(() => setNotification(null), 4000);
            resetQuickEditState();
        } finally {
            setQuickEditLoading(false);
        }
    };

    const handleQuickEditSave = async () => {
        if (quickEditSubmitting || quickEditLoading) {
            return;
        }

        if (quickEditTargetIds.length === 0) {
            setNotification({ type: 'error', message: 'Chưa có sản phẩm nào để lưu sửa nhanh.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        if (quickEditSelectedCoreFields.length === 0 && quickEditSelectedAttributeIds.length === 0) {
            setNotification({ type: 'error', message: 'Hãy bật ít nhất 1 trường cần sửa.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        const validationErrors = {};
        const updates = [];

        quickEditTargetIds.forEach((productId) => {
            const draftKey = String(productId);
            const draft = quickEditDrafts[draftKey];
            const original = quickEditOriginals[draftKey];

            if (!draft || !original) {
                return;
            }

            const payload = {};
            const customAttributes = {};
            let rowError = '';

            quickEditSelectedCoreFields.forEach((fieldId) => {
                if (rowError) {
                    return;
                }

                if (fieldId === 'name') {
                    const nextName = String(draft.name ?? '').trim();
                    if (getQuickEditCoreComparableValue(fieldId, nextName) !== getQuickEditCoreComparableValue(fieldId, original.name)) {
                        if (!nextName) {
                            rowError = 'Tên sản phẩm không được để trống.';
                            return;
                        }

                        payload.name = nextName;
                    }
                    return;
                }

                if (fieldId === 'sku') {
                    const nextSku = normalizeQuickEditSkuValue(draft.sku);
                    if (getQuickEditCoreComparableValue(fieldId, nextSku) !== getQuickEditCoreComparableValue(fieldId, original.sku)) {
                        payload.sku = nextSku;
                    }
                    return;
                }

                if (fieldId === 'price') {
                    const nextPrice = normalizeWholeMoneyNumber(draft.price);
                    if (nextPrice === null) {
                        rowError = 'Giá bán phải là số hợp lệ.';
                        return;
                    }

                    if (getQuickEditCoreComparableValue(fieldId, nextPrice) !== getQuickEditCoreComparableValue(fieldId, original.price)) {
                        payload.price = nextPrice;
                    }
                    return;
                }

                if (fieldId === 'expected_cost') {
                    const rawExpectedCost = draft.expected_cost;
                    const trimmedExpectedCost = rawExpectedCost === null || rawExpectedCost === undefined
                        ? ''
                        : String(rawExpectedCost).trim();
                    const nextExpectedCost = normalizeRoundedImportCostNumber(rawExpectedCost);

                    if (trimmedExpectedCost && nextExpectedCost === null) {
                        rowError = 'Giá nhập dự kiến phải là số hợp lệ.';
                        return;
                    }

                    if (getQuickEditCoreComparableValue(fieldId, rawExpectedCost) !== getQuickEditCoreComparableValue(fieldId, original.expected_cost)) {
                        payload.expected_cost = trimmedExpectedCost ? nextExpectedCost : null;
                    }
                    return;
                }

                if (fieldId === 'category_id') {
                    const nextCategoryId = draft.category_id ? String(draft.category_id) : '';
                    if (getQuickEditCoreComparableValue(fieldId, nextCategoryId) !== getQuickEditCoreComparableValue(fieldId, original.category_id)) {
                        payload.category_id = nextCategoryId ? Number(nextCategoryId) : null;
                    }
                    return;
                }

                if (fieldId === 'type') {
                    const nextType = String(draft.type || '').trim();
                    if (nextType && getQuickEditCoreComparableValue(fieldId, nextType) !== getQuickEditCoreComparableValue(fieldId, original.type)) {
                        payload.type = nextType;
                    }
                    return;
                }

                if (fieldId === 'status' || fieldId === 'is_featured' || fieldId === 'is_new') {
                    if (getQuickEditCoreComparableValue(fieldId, draft[fieldId]) !== getQuickEditCoreComparableValue(fieldId, original[fieldId])) {
                        payload[fieldId] = Boolean(draft[fieldId]);
                    }
                }
            });

            quickEditSelectedAttributes.forEach((attribute) => {
                if (rowError) {
                    return;
                }

                const attributeKey = String(attribute.id);
                const draftValue = draft.custom_attributes?.[attributeKey];
                const originalValue = original.custom_attributes?.[attributeKey];

                if (getQuickEditAttributeComparableValue(attribute, draftValue) === getQuickEditAttributeComparableValue(attribute, originalValue)) {
                    return;
                }

                customAttributes[attributeKey] = Array.isArray(draftValue)
                    ? draftValue.map((value) => String(value))
                    : (draftValue ?? '');
            });

            if (rowError) {
                validationErrors[draftKey] = rowError;
                return;
            }

            if (Object.keys(customAttributes).length > 0) {
                payload.custom_attributes = customAttributes;
            }

            if (Object.keys(payload).length > 0) {
                updates.push({
                    id: productId,
                    payload,
                });
            }
        });

        if (Object.keys(validationErrors).length > 0) {
            setQuickEditRowErrors(validationErrors);
            setNotification({ type: 'error', message: 'Vui lòng kiểm tra các dòng đang báo lỗi trước khi lưu.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        if (updates.length === 0) {
            setNotification({ type: 'error', message: 'Chưa có thay đổi nào để lưu.' });
            setTimeout(() => setNotification(null), 3000);
            return;
        }

        setQuickEditSubmitting(true);
        setQuickEditRowErrors({});

        try {
            const results = await Promise.allSettled(
                updates.map((item) => productApi.update(item.id, item.payload)),
            );

            const failedIds = [];
            const failedErrors = {};
            let successCount = 0;

            results.forEach((result, index) => {
                const updateItem = updates[index];
                const rowKey = String(updateItem.id);

                if (result.status === 'fulfilled') {
                    successCount += 1;
                    return;
                }

                failedIds.push(updateItem.id);
                failedErrors[rowKey] = result.reason?.response?.data?.message || result.reason?.message || 'Không thể lưu sản phẩm này.';
            });

            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);

            if (failedIds.length > 0) {
                const failedLookup = new Set(failedIds.map((id) => String(id)));

                setQuickEditTargetIds(failedIds);
                setQuickEditProducts((current) => current.filter((product) => failedLookup.has(String(product.id))));
                setQuickEditDrafts((current) => Object.fromEntries(
                    Object.entries(current).filter(([key]) => failedLookup.has(String(key))),
                ));
                setQuickEditOriginals((current) => Object.fromEntries(
                    Object.entries(current).filter(([key]) => failedLookup.has(String(key))),
                ));
                setQuickEditRowErrors(failedErrors);

                setNotification({
                    type: 'error',
                    message: successCount > 0
                        ? `Đã lưu ${successCount} sản phẩm. Còn ${failedIds.length} sản phẩm cần kiểm tra lại.`
                        : 'Không thể lưu sửa nhanh cho các sản phẩm đã chọn.',
                });
                setTimeout(() => setNotification(null), 5000);
                return;
            }

            resetQuickEditState();
            setNotification({
                type: 'success',
                message: `Đã cập nhật nhanh ${successCount} sản phẩm thành công.`,
            });
            setTimeout(() => setNotification(null), 4000);
        } catch (error) {
            console.error('Quick edit save error:', error);
            setNotification({
                type: 'error',
                message: error?.response?.data?.message || 'Không thể lưu sửa nhanh.',
            });
            setTimeout(() => setNotification(null), 4000);
        } finally {
            setQuickEditSubmitting(false);
        }
    };

    const handleStartQuickEdit = (p, e) => {
        e.stopPropagation();
        setEditingProductId(p.id);
        setEditForm({
            price: normalizeWholeMoneyDraft(p.price),
            expected_cost: normalizeWholeMoneyDraft(p.expected_cost ?? p.cost_price)
        });
    };

    const handleCancelQuickEdit = (e) => {
        if (e) e.stopPropagation();
        setEditingProductId(null);
        setEditForm({ price: '', expected_cost: '' });
    };

    const handleSaveQuickEdit = async (e) => {
        e.stopPropagation();
        if (!editingProductId) return;
        
        setSavingId(editingProductId);
        try {
            const nextPrice = normalizeWholeMoneyNumber(editForm.price);
            const nextExpectedCost = normalizeRoundedImportCostNumber(editForm.expected_cost);

            if (nextPrice === null || nextExpectedCost === null) {
                setNotification({ type: 'error', message: 'Vui lòng nhập đầy đủ giá bán và giá dự kiến.' });
                return;
            }

            await productApi.update(editingProductId, {
                price: nextPrice,
                expected_cost: nextExpectedCost,
            });

            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);
            
            setNotification({ type: 'success', message: 'Cập nhật giá thành công' });
            setTimeout(() => setNotification(null), 3000);
            handleCancelQuickEdit();
        } catch (err) {
            setNotification({ type: 'error', message: 'Lỗi khi cập nhật giá: ' + (err.response?.data?.message || err.message) });
        } finally {
            setSavingId(null);
        }
    };

    const [notification, setNotification] = useState(null);

    const handleBulkGenerateSeo = async () => {
        const normalizedIds = Array.from(
            new Map(
                (Array.isArray(selectedIds) ? selectedIds : [])
                    .map((value) => normalizeStoredId(value))
                    .filter((value) => value !== null)
                    .map((value) => [String(value), value]),
            ).values(),
        );

        if (normalizedIds.length === 0) {
            setNotification({ type: 'error', message: 'Hãy chọn ít nhất 1 sản phẩm để tạo SEO AI.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        if (!aiAvailable) {
            setNotification({ type: 'error', message: disabledReason || 'AI chưa sẵn sàng.' });
            setTimeout(() => setNotification(null), 5000);
            return;
        }

        setBulkSeoGenerating(true);
        setBulkSeoProgress({ current: 0, total: normalizedIds.length, failed: 0 });

        let successCount = 0;
        const failedIds = [];

        try {
            for (let index = 0; index < normalizedIds.length; index += 1) {
                const targetId = normalizedIds[index];
                setBulkSeoProgress({
                    current: index,
                    total: normalizedIds.length,
                    failed: failedIds.length,
                });

                try {
                    await aiApi.generateProductSeo({
                        product_id: targetId,
                        persist: true,
                    });
                    successCount += 1;
                } catch (error) {
                    console.error('Bulk SEO AI error:', targetId, error);
                    failedIds.push(targetId);
                }

                setBulkSeoProgress({
                    current: index + 1,
                    total: normalizedIds.length,
                    failed: failedIds.length,
                });
            }

            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);

            if (failedIds.length > 0) {
                setNotification({
                    type: 'error',
                    message: successCount > 0
                        ? `Đã tạo SEO AI cho ${successCount} sản phẩm. Còn ${failedIds.length} sản phẩm bị lỗi.`
                        : 'Không thể tạo SEO AI cho các sản phẩm đã chọn.',
                });
                setTimeout(() => setNotification(null), 5000);
                return;
            }

            setNotification({
                type: 'success',
                message: `Đã tạo SEO AI và lưu thành công cho ${successCount} sản phẩm.`,
            });
            setTimeout(() => setNotification(null), 5000);
        } finally {
            setBulkSeoGenerating(false);
            setBulkSeoProgress({ current: 0, total: 0, failed: 0 });
        }
    };

    const openDuplicateConfirm = (ids) => {
        const normalizedIds = (Array.isArray(ids) ? ids : [ids])
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value));

        if (normalizedIds.length === 0) {
            return;
        }

        const firstProduct = products.find((item) => String(item.id) === String(normalizedIds[0]));

        setDuplicateConfirm({
            ids: normalizedIds,
            count: normalizedIds.length,
            sourceName: firstProduct?.name || `Sản phẩm #${normalizedIds[0]}`,
        });
    };

    const closeDuplicateConfirm = () => {
        if (submittingDuplicate) {
            return;
        }

        setDuplicateConfirm(null);
    };

    const [pagination, setPagination] = useState({ 
        current_page: savedState?.page || 1, 
        last_page: 1, 
        total: 0, 
        per_page: savedState?.perPage || 20 
    });

    const [isTrashView, setIsTrashView] = useState(savedState?.isTrashView || false);

    // Sanitize saved filters to ensure category_id and type are always arrays (legacy compatibility)
    const getInitialFilters = () => {
        const baseFilters = { ...getDefaultProductFilters(), ...(savedState?.filters || {}) };
        
        if (baseFilters.category_id && !Array.isArray(baseFilters.category_id)) {
            if (typeof baseFilters.category_id === 'string') {
                baseFilters.category_id = baseFilters.category_id.trim() === '' ? [] : baseFilters.category_id.split(',').filter(Boolean);
            } else {
                baseFilters.category_id = [baseFilters.category_id].filter(Boolean);
            }
        } else if (!baseFilters.category_id) {
            baseFilters.category_id = [];
        }
        
        if (baseFilters.type && !Array.isArray(baseFilters.type)) {
            if (typeof baseFilters.type === 'string') {
                baseFilters.type = baseFilters.type.trim() === '' ? [] : baseFilters.type.split(',').filter(Boolean);
            } else {
                baseFilters.type = [baseFilters.type].filter(Boolean);
            }
        } else if (!baseFilters.type) {
            baseFilters.type = [];
        }

        baseFilters.type = sanitizeActiveProductTypeValues(baseFilters.type);

        if (baseFilters.supplier_ids && !Array.isArray(baseFilters.supplier_ids)) {
            if (typeof baseFilters.supplier_ids === 'string') {
                baseFilters.supplier_ids = baseFilters.supplier_ids.trim() === '' ? [] : baseFilters.supplier_ids.split(',').filter(Boolean);
            } else {
                baseFilters.supplier_ids = [baseFilters.supplier_ids].filter(Boolean);
            }
        } else if (!baseFilters.supplier_ids) {
            baseFilters.supplier_ids = [];
        }

        if (baseFilters.supplier_id != null && baseFilters.supplier_id !== '') {
            baseFilters.supplier_ids = Array.from(new Set([...(baseFilters.supplier_ids || []), String(baseFilters.supplier_id)]));
        }

        delete baseFilters.supplier_id;
        baseFilters.inventory_unit_filter = normalizeInventoryUnitFilterValue(baseFilters.inventory_unit_filter);

        if (!baseFilters.attributes || typeof baseFilters.attributes !== 'object') {
            baseFilters.attributes = {};
        }
        
        return sanitizeProductFilters(baseFilters);
    };

    const [filters, setFilters] = useState(() => getInitialFilters());

    const [sortConfig, setSortConfig] = useState(
        () => normalizeProductSortConfig(savedState?.sortConfig)
    );

    if (!workingStateSnapshotRef.current) {
        workingStateSnapshotRef.current = {
            filters: getInitialFilters(),
            sortConfig: normalizeProductSortConfig(savedState?.sortConfig),
            page: savedState?.page || 1,
            perPage: savedState?.perPage || 20,
            isTrashView: savedState?.isTrashView || false,
            selectedIds: sanitizeStoredIdList(savedWorkingState?.selectedIds),
            expandedRows: sanitizeStoredIdList(savedWorkingState?.expandedRows),
            scrollTop: normalizeStoredScrollTop(savedWorkingState?.scrollTop),
            scrollLeft: normalizeStoredScrollTop(savedWorkingState?.scrollLeft),
            target: `${location.pathname}${location.search}`,
        };
    }

    const getCurrentScrollTop = useCallback(() => {
        if (typeof window === 'undefined') {
            return 0;
        }

        const scrollContainer = scrollContainerRef.current || tableScrollRef.current;
        if (scrollContainer && scrollContainer !== window) {
            return scrollContainer.scrollTop;
        }

        return window.scrollY || document.documentElement.scrollTop || 0;
    }, []);

    const getCurrentScrollLeft = useCallback(() => {
        if (typeof window === 'undefined') {
            return 0;
        }

        const scrollContainer = scrollContainerRef.current || tableScrollRef.current;
        if (scrollContainer && scrollContainer !== window) {
            return scrollContainer.scrollLeft;
        }

        return window.scrollX || document.documentElement.scrollLeft || 0;
    }, []);

    const writeWorkingStateSnapshot = useCallback((overrides = {}) => {
        const nextSnapshot = {
            ...(workingStateSnapshotRef.current || {}),
            ...overrides,
        };

        workingStateSnapshotRef.current = nextSnapshot;

        if (typeof window !== 'undefined') {
            writeStorageJson(window.sessionStorage, PRODUCT_MANAGEMENT_WORKING_STATE_KEY, nextSnapshot);
        }

        return nextSnapshot;
    }, []);

    const persistWorkingState = useCallback((overrides = {}) => (
        writeWorkingStateSnapshot({
            scrollTop: overrides.scrollTop ?? getCurrentScrollTop(),
            scrollLeft: overrides.scrollLeft ?? getCurrentScrollLeft(),
            ...overrides,
        })
    ), [getCurrentScrollLeft, getCurrentScrollTop, writeWorkingStateSnapshot]);

    const buildProductFormLocationState = useCallback(() => ({
        returnContext: {
            target: `${location.pathname}${location.search}`,
        },
    }), [location.pathname, location.search]);

    const navigateToProductForm = useCallback((target) => {
        persistWorkingState({
            filters,
            sortConfig,
            page: pagination.current_page,
            perPage: pagination.per_page,
            isTrashView,
            selectedIds,
            expandedRows,
            scrollTop: getCurrentScrollTop(),
            scrollLeft: getCurrentScrollLeft(),
            target: `${location.pathname}${location.search}`,
        });
        navigate(target, {
            state: buildProductFormLocationState(),
        });
    }, [
        buildProductFormLocationState,
        expandedRows,
        filters,
        getCurrentScrollLeft,
        getCurrentScrollTop,
        isTrashView,
        location.pathname,
        location.search,
        navigate,
        pagination.current_page,
        pagination.per_page,
        persistWorkingState,
        selectedIds,
        sortConfig,
    ]);

    // PERSISTENCE LOGIC: Save state whenever it changes
    useEffect(() => {
        const stateToSave = {
            filters,
            sortConfig,
            page: pagination.current_page,
            perPage: pagination.per_page,
            isTrashView
        };
        if (typeof window !== 'undefined') {
            writeStorageJson(window.localStorage, PRODUCT_MANAGEMENT_PERSISTENT_STATE_KEY, stateToSave);
        }
    }, [filters, sortConfig, pagination.current_page, pagination.per_page, isTrashView]);

    useEffect(() => {
        writeWorkingStateSnapshot({
            filters,
            sortConfig,
            page: pagination.current_page,
            perPage: pagination.per_page,
            isTrashView,
            selectedIds,
            expandedRows,
            scrollTop: getCurrentScrollTop(),
            scrollLeft: getCurrentScrollLeft(),
            target: `${location.pathname}${location.search}`,
        });
    }, [
        expandedRows,
        filters,
        getCurrentScrollLeft,
        getCurrentScrollTop,
        isTrashView,
        location.pathname,
        location.search,
        pagination.current_page,
        pagination.per_page,
        selectedIds,
        sortConfig,
        writeWorkingStateSnapshot,
    ]);

    const [trashCount, setTrashCount] = useState(0);

    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('product_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const searchContainerRef = useRef(null);

    const {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
        setVisibleColumns
    } = useTableColumns('product_list', permittedProductColumns);

    const exportFieldOptions = [
        ...availableColumns
            .filter((column) => !EXPORT_EXCLUDED_COLUMN_IDS.has(column.id))
            .map((column) => ({
                id: column.id,
                label: column.label,
            })),
        ...EXTRA_EXPORT_FIELDS.filter((field) => !availableColumns.some((column) => column.id === field.id)),
    ];
    const importAttributeFieldOptions = [...allAttributes]
        .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), 'vi'))
        .map((attribute) => ({
            id: `attr_${attribute.id}`,
            label: `Thuộc tính: ${attribute.name}`,
            description: 'Chỉ cập nhật cột thuộc tính riêng của trường này khi file có đúng cột tương ứng.',
        }));
    const importFieldOptions = [
        ...IMPORT_BASE_FIELD_OPTIONS,
        ...importAttributeFieldOptions,
    ];
    const normalizedImportAttributeSearch = importAttributeSearch.trim().toLowerCase();
    const filteredImportAttributeFieldOptions = normalizedImportAttributeSearch === ''
        ? importAttributeFieldOptions
        : importAttributeFieldOptions.filter((option) => {
            const haystack = `${option.label} ${option.id} ${option.description}`.toLowerCase();
            return haystack.includes(normalizedImportAttributeSearch);
        });
    const selectedImportAttributeCount = importUpdateFieldIds.filter((id) => String(id).startsWith('attr_')).length;
    const selectedImportBaseFieldCount = importUpdateFieldIds.length - selectedImportAttributeCount;
    const isSelectiveImport = importMode === 'update_selected_fields';

    useEffect(() => {
        const nextExportFieldOptions = [
            ...availableColumns
                .filter((column) => !EXPORT_EXCLUDED_COLUMN_IDS.has(column.id))
                .map((column) => ({
                    id: column.id,
                    label: column.label,
                })),
            ...EXTRA_EXPORT_FIELDS.filter((field) => !availableColumns.some((column) => column.id === field.id)),
        ];

        if (nextExportFieldOptions.length === 0) {
            return;
        }

        const validIds = new Set(nextExportFieldOptions.map((option) => option.id));
        setExportColumnIds((prev) => {
            const filtered = prev.filter((id) => validIds.has(id));
            if (filtered.length > 0) {
                return filtered;
            }

            const preferredDefaults = DEFAULT_EXPORT_COLUMN_IDS.filter((id) => validIds.has(id));
            if (preferredDefaults.length > 0) {
                return preferredDefaults;
            }

            return nextExportFieldOptions.slice(0, 2).map((option) => option.id);
        });
    }, [availableColumns]);

    useEffect(() => {
        const validImportFieldIds = new Set([
            ...IMPORT_BASE_FIELD_OPTIONS.map((option) => option.id),
            ...(allAttributes || []).map((attribute) => `attr_${attribute.id}`),
        ]);

        setImportUpdateFieldIds((prev) => prev.filter((id) => validImportFieldIds.has(id)));
    }, [allAttributes]);

    useEffect(() => {
        const scrollContainer = tableScrollRef.current || findScrollableAncestor(pageRootRef.current);
        scrollContainerRef.current = scrollContainer;

        if (!scrollContainer) {
            return undefined;
        }

        const scrollTarget = scrollContainer === window ? window : scrollContainer;
        const handleScroll = () => {
            const scrollTop = scrollContainer === window
                ? (window.scrollY || document.documentElement.scrollTop || 0)
                : scrollContainer.scrollTop;
            const scrollLeft = scrollContainer === window
                ? (window.scrollX || document.documentElement.scrollLeft || 0)
                : scrollContainer.scrollLeft;

            writeWorkingStateSnapshot({ scrollTop, scrollLeft });
        };

        scrollTarget.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            handleScroll();
            scrollTarget.removeEventListener('scroll', handleScroll);
        };
    }, [writeWorkingStateSnapshot]);

    useEffect(() => {
        if (loading) {
            return undefined;
        }

        const scrollTop = pendingScrollRestoreRef.current;
        const scrollLeft = pendingScrollRestoreLeftRef.current;
        if ((scrollTop === null || scrollTop === undefined) && (scrollLeft === null || scrollLeft === undefined)) {
            return undefined;
        }

        let firstFrameId = 0;
        let secondFrameId = 0;

        firstFrameId = window.requestAnimationFrame(() => {
            secondFrameId = window.requestAnimationFrame(() => {
                const scrollContainer = scrollContainerRef.current;

                if (scrollContainer && scrollContainer !== window) {
                    if (scrollTop !== null && scrollTop !== undefined) {
                        scrollContainer.scrollTop = scrollTop;
                    }
                    if (scrollLeft !== null && scrollLeft !== undefined) {
                        scrollContainer.scrollLeft = scrollLeft;
                    }
                } else {
                    window.scrollTo(scrollLeft || 0, scrollTop || 0);
                }

                pendingScrollRestoreRef.current = null;
                pendingScrollRestoreLeftRef.current = null;
                writeWorkingStateSnapshot({
                    scrollTop: scrollTop ?? 0,
                    scrollLeft: scrollLeft ?? 0,
                });
            });
        });

        return () => {
            window.cancelAnimationFrame(firstFrameId);
            window.cancelAnimationFrame(secondFrameId);
        };
    }, [loading, pagination.current_page, products.length, writeWorkingStateSnapshot]);

    useEffect(() => {
        let isMounted = true;

        const initialize = async () => {
            const attributeCatalog = await fetchInitialData();
            if (!isMounted) {
                return;
            }

            fetchProducts(
                pagination.current_page,
                filters,
                sortConfig,
                pagination.per_page,
                attributeCatalog
            );
        };

        initialize();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterRef.current && !filterRef.current.contains(event.target) && !event.target.closest('[data-filter-btn]')) setShowAdvanced(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(event.target) && !event.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (!event.target.closest('[data-attr-dropdown]')) setOpenAttrId(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const hasInitializedSearchEffectRef = useRef(false);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!hasInitializedSearchEffectRef.current) {
                hasInitializedSearchEffectRef.current = true;

                if (filters.search && filters.search.trim() !== '') {
                    localStorage.setItem('product_list_search_current_term', filters.search);
                } else {
                    localStorage.removeItem('product_list_search_current_term');
                }

                return;
            }

            const lastSearchStored = localStorage.getItem('product_list_search_current_term');
            if (filters.search !== lastSearchStored) {
                if (filters.search && filters.search.trim() !== '') {
                    localStorage.setItem('product_list_search_current_term', filters.search);
                    fetchProducts(1);
                    addToSearchHistory(filters.search);
                } else if (lastSearchStored !== null) {
                    localStorage.removeItem('product_list_search_current_term');
                    fetchProducts(1);
                }
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [filters.search]);

    useEffect(() => {
        if (!isTrashView) fetchTrashCount();
    }, [isTrashView, products]);

    const fetchInitialData = async () => {
        try {
            const [catRes, attrRes, supplierRes, unitRes, domainRes] = await Promise.all([
                categoryApi.getAll(),
                attributeApi.getAll({ entity_type: 'product', active_only: true }),
                inventoryApi.getSuppliers({ per_page: 500 }),
                inventoryApi.getUnits(),
                cmsApi.domains.getAll().catch(() => ({ data: [] })),
            ]);
            const productAttributes = Array.isArray(attrRes.data) ? attrRes.data : [];
            setCategories(catRes.data || []);
            setAllAttributes(productAttributes);
            setFilters((prev) => sanitizeProductFilters(prev, productAttributes));
            setTempFilters((prev) => prev ? sanitizeProductFilters(prev, productAttributes) : prev);
            setSuppliers(supplierRes.data?.data || []);
            setInventoryUnits(Array.isArray(unitRes.data) ? unitRes.data : []);
            setDomains((domainRes.data || []).filter((item) => item?.is_active));

            const attrColumns = productAttributes.map(attr => ({
                id: `attr_${attr.id}`,
                label: attr.name,
                minWidth: '150px',
                isAttribute: true,
                attrId: attr.id
            }));

            const supplierCodeColumn = { id: 'supplier_product_code', label: 'Mã NCC', minWidth: '130px' };
            const actionColumn = permittedProductColumns.find((column) => column.id === 'actions');
            const productLinkColumn = permittedProductColumns.find((column) => column.id === 'product_link');
            const leadingColumns = permittedProductColumns.filter((column) => !['actions', 'product_link'].includes(column.id));
            const baseColumns = [
                ...leadingColumns.slice(0, 2),
                ...(productLinkColumn ? [productLinkColumn] : []),
                ...leadingColumns.slice(2),
                ...(permittedProductColumns.some((column) => column.id === 'supplier_product_code') ? [] : [supplierCodeColumn]),
                ...(actionColumn ? [actionColumn] : []),
            ];
            const combinedColumns = [...baseColumns.slice(0, -1), ...attrColumns, baseColumns[baseColumns.length - 1]];

            const savedOrder = localStorage.getItem('product_list_column_order');
            let sortedColumns = [...combinedColumns];
            if (savedOrder) {
                const orderIds = JSON.parse(savedOrder);
                sortedColumns = [...combinedColumns].sort((a, b) => {
                    const indexA = orderIds.indexOf(a.id);
                    const indexB = orderIds.indexOf(b.id);
                    if (indexA === -1 && indexB === -1) return 0;
                    if (indexA === -1) return 1;
                    if (indexB === -1) return -1;
                    return indexA - indexB;
                });
            }
            sortedColumns = moveItemAfter(sortedColumns, 'product_link', 'name', (column) => column.id);
            sortedColumns = moveItemAfter(
                sortedColumns,
                'unit',
                sortedColumns.some((column) => column.id === 'product_link') ? 'product_link' : 'name',
                (column) => column.id,
            );
            setAvailableColumns(sortedColumns);

            const savedVisible = localStorage.getItem('product_list_columns');
            if (savedVisible) {
                const savedIds = JSON.parse(savedVisible);
                const mergedVisible = [
                    ...combinedColumns.map((column) => column.id).filter((id) => savedIds.includes(id)),
                    ...combinedColumns.map((column) => column.id).filter((id) => !savedIds.includes(id)),
                ];
                const orderedVisible = moveItemAfter(
                    moveItemAfter(mergedVisible, 'product_link', 'name'),
                    'unit',
                    mergedVisible.includes('product_link') ? 'product_link' : 'name',
                );
                setVisibleColumns(orderedVisible);
                localStorage.setItem('product_list_columns', JSON.stringify(orderedVisible));
            } else {
                setVisibleColumns(sortedColumns.map(c => c.id));
            }
            return productAttributes;
        } catch (error) {
            console.error("Error fetching initial data", error);
            return [];
        }
    };

    const buildQueryParams = useCallback((page = 1, currentFilters = filters, currentSort = sortConfig, limit = pagination.per_page, attributeCatalog = allAttributes) => {
        const normalizedFilters = sanitizeProductFilters(currentFilters, attributeCatalog);
        const selectedOnlyIds = showSelectedOnlyRef.current
            ? sanitizeStoredIdList(selectedIdsRef.current)
            : [];
        const effectivePerPage = selectedOnlyIds.length > 0
            ? Math.max(limit, selectedOnlyIds.length)
            : limit;
        const params = {
            page,
            per_page: effectivePerPage,
            is_trash: isTrashView ? 1 : 0,
            sort_by: currentSort.direction === 'none' ? 'id' : currentSort.key,
            sort_order: currentSort.direction === 'none' ? 'desc' : currentSort.direction
        };

        if (selectedOnlyIds.length > 0) {
            params.selected_ids = selectedOnlyIds.join(',');
        }

        if (normalizedFilters.search) {
            params.search = normalizedFilters.search;
        }

        if (Array.isArray(normalizedFilters.category_id) && normalizedFilters.category_id.length > 0) {
            params.category_ids = normalizedFilters.category_id.join(',');
        }

        if (normalizedFilters.category_count_filter) {
            params.category_count_filter = normalizedFilters.category_count_filter;
        }

        if (Array.isArray(normalizedFilters.type) && normalizedFilters.type.length > 0) {
            params.type = normalizedFilters.type.join(',');
        }

        if (Array.isArray(normalizedFilters.supplier_ids) && normalizedFilters.supplier_ids.length > 0) {
            params.supplier_ids = normalizedFilters.supplier_ids.join(',');
        }

        if (normalizedFilters.inventory_unit_filter) {
            params.inventory_unit_filter = normalizedFilters.inventory_unit_filter;
        }

        if (normalizedFilters.missing_purchase_price) {
            params.missing_purchase_price = 1;
        }

        if (normalizedFilters.multiple_suppliers) {
            params.multiple_suppliers = 1;
        }

        ['has_images', 'has_seo', 'has_description', 'is_featured', 'is_new', 'min_price', 'max_price', 'min_stock', 'max_stock', 'start_date', 'end_date'].forEach((key) => {
            if (normalizedFilters[key] !== '' && normalizedFilters[key] !== null && normalizedFilters[key] !== undefined) {
                params[key] = normalizedFilters[key];
            }
        });

        if (normalizedFilters.attributes) {
            Object.entries(normalizedFilters.attributes).forEach(([id, val]) => {
                if (val && (Array.isArray(val) ? val.length > 0 : val !== '')) {
                    params[`attributes[${id}]`] = Array.isArray(val) ? val.join(',') : val;
                }
            });
        }

        return params;
    }, [allAttributes, filters, isTrashView, pagination.per_page, sortConfig]);

    const imageManagerScopeLabel = selectedIds.length > 0
        ? `${selectedIds.length} sản phẩm đã chọn`
        : 'toàn bộ sản phẩm theo bộ lọc hiện tại';

    const imageManagerScopeQueryParams = useMemo(() => {
        if (selectedIds.length > 0) {
            return {
                page: 1,
                per_page: 100,
                is_trash: 0,
                selected_ids: sanitizeStoredIdList(selectedIds).join(','),
                sort_by: sortConfig.direction === 'none' ? 'id' : sortConfig.key,
                sort_order: sortConfig.direction === 'none' ? 'desc' : sortConfig.direction,
            };
        }

        const params = {
            ...buildQueryParams(1, filters, sortConfig, 100),
            page: 1,
            per_page: 100,
            is_trash: 0,
        };

        delete params.selected_ids;
        return params;
    }, [buildQueryParams, filters, selectedIds, sortConfig]);

    const fetchTrashCount = async () => {
        try {
            const response = await productApi.getAll({ is_trash: 1, per_page: 1 });
            setTrashCount(response.data.total || 0);
        } catch (error) { console.error("Error fetching trash count", error); }
    };

    const fetchProducts = async (page = 1, currentFilters = filters, currentSort = sortConfig, limit = pagination.per_page, attributeCatalog = allAttributes) => {
        setLoading(true);
        try {
            const normalizedFilters = sanitizeProductFilters(currentFilters, attributeCatalog);
            const params = buildQueryParams(page, normalizedFilters, currentSort, limit, attributeCatalog);
            params.summary = 1;
            const response = await productApi.getAll(params);
            setProducts(response.data.data);
            setExpandedRows([]);
            setLoadingExpandedIds([]);
            setPagination({
                current_page: response.data.current_page,
                last_page: response.data.last_page,
                total: response.data.total,
                per_page: parseInt(response.data.per_page)
            });
        } catch (error) { console.error("Error fetching products", error); } finally { setLoading(false); }
    };

    const syncProductSortItems = (nextItems) => {
        const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
        const currentIds = normalizedItems.map((item) => Number(item?.id) || 0);
        const snapshotIds = (productSortSnapshotRef.current || []).map((item) => Number(item?.id) || 0);

        setProductSortItems(normalizedItems);
        setIsProductSortDirty(JSON.stringify(currentIds) !== JSON.stringify(snapshotIds));
    };

    const fetchProductSortItems = async () => {
        setIsProductSortLoading(true);
        try {
            const response = await productApi.getSortItems();
            const items = Array.isArray(response.data?.data) ? response.data.data : [];
            productSortSnapshotRef.current = items;
            setProductSortItems(items);
            setIsProductSortDirty(false);
        } catch (error) {
            console.error('Error fetching product sort items', error);
            setNotification({ type: 'error', message: 'Không tải được danh sách sắp xếp sản phẩm.' });
        } finally {
            setIsProductSortLoading(false);
        }
    };

    const handleOpenProductSortModal = () => {
        setShowProductSortModal(true);
        fetchProductSortItems();
    };

    const handleCloseProductSortModal = () => {
        if (isProductSortDirty && !window.confirm('Bạn có thay đổi thứ tự chưa lưu. Đóng bảng sắp xếp?')) {
            return;
        }

        setShowProductSortModal(false);
    };

    const moveProductSortItem = (productId, nextIndex) => {
        syncProductSortItems((() => {
            const currentItems = [...productSortItems];
            const currentIndex = currentItems.findIndex((item) => item.id === productId);

            if (currentIndex < 0) {
                return currentItems;
            }

            const boundedIndex = Math.min(Math.max(nextIndex, 0), currentItems.length - 1);
            if (boundedIndex === currentIndex) {
                return currentItems;
            }

            const [movedItem] = currentItems.splice(currentIndex, 1);
            currentItems.splice(boundedIndex, 0, movedItem);
            return currentItems;
        })());
    };

    const handleMoveProductSortUp = (productId) => {
        const currentIndex = productSortItems.findIndex((item) => item.id === productId);
        if (currentIndex <= 0) {
            return;
        }

        moveProductSortItem(productId, currentIndex - 1);
    };

    const handleMoveProductSortDown = (productId) => {
        const currentIndex = productSortItems.findIndex((item) => item.id === productId);
        if (currentIndex < 0 || currentIndex >= productSortItems.length - 1) {
            return;
        }

        moveProductSortItem(productId, currentIndex + 1);
    };

    const handleMoveProductSortToPosition = (productId, nextPosition) => {
        moveProductSortItem(productId, nextPosition - 1);
    };

    const handleResetProductSort = () => {
        syncProductSortItems([...(productSortSnapshotRef.current || [])]);
    };

    const handleRefreshProductSort = () => {
        if (isProductSortDirty && !window.confirm('Bạn có thay đổi thứ tự chưa lưu. Tải lại dữ liệu từ máy chủ?')) {
            return;
        }

        fetchProductSortItems();
    };

    const handleSortProductsAlphabetically = () => {
        syncProductSortItems(
            [...productSortItems].sort((left, right) => {
                const nameCompare = String(left?.name || '').localeCompare(String(right?.name || ''), 'vi', {
                    sensitivity: 'base',
                    numeric: true,
                });

                if (nameCompare !== 0) {
                    return nameCompare;
                }

                const skuCompare = String(left?.sku || '').localeCompare(String(right?.sku || ''), 'vi', {
                    sensitivity: 'base',
                    numeric: true,
                });

                if (skuCompare !== 0) {
                    return skuCompare;
                }

                return Number(left?.id || 0) - Number(right?.id || 0);
            }),
        );
    };

    const handleSaveProductSort = async () => {
        if (productSortItems.length === 0) {
            return;
        }

        setIsProductSortSaving(true);
        try {
            await productApi.reorder(productSortItems.map((item) => item.id));
            productSortSnapshotRef.current = [...productSortItems];
            setIsProductSortDirty(false);
            setNotification({ type: 'success', message: 'Đã lưu thứ tự sản phẩm.' });
        } catch (error) {
            console.error('Error saving product sort', error);
            setNotification({ type: 'error', message: 'Không lưu được thứ tự sản phẩm.' });
        } finally {
            setIsProductSortSaving(false);
        }
    };

    const handleTempFilterChange = (e) => {
        const { name, value } = e.target;
        setTempFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleTempMultiSelectChange = (name, value) => {
        setTempFilters(prev => {
            const currentValues = prev[name] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            return {
                ...prev,
                [name]: name === 'type' ? sanitizeActiveProductTypeValues(newValues) : newValues
            };
        });
    };

    const handleTempAttributeFilterChange = (attrId, value) => {
        setTempFilters(prev => {
            const currentValues = prev.attributes[attrId] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            return { ...prev, attributes: { ...prev.attributes, [attrId]: newValues } };
        });
    };

    const applyFilters = () => {
        const normalizedFilters = sanitizeProductFilters(tempFilters, allAttributes);
        setTempFilters(normalizedFilters);
        setFilters(normalizedFilters);
        setShowAdvanced(false);
        fetchProducts(1, normalizedFilters);
    };

    const removeFilter = (key, value = null) => {
        setFilters(prev => {
            let newFilters = { ...prev };
            if (key === 'attributes') {
                const currentVals = prev.attributes[value.attrId] || [];
                const newVals = currentVals.filter(v => v !== value.val);
                newFilters.attributes = { ...prev.attributes, [value.attrId]: newVals };
            } else if (key === 'category_id') {
                newFilters.category_id = (Array.isArray(prev.category_id) ? prev.category_id : []).filter(id => id !== value);
            } else if (key === 'type') {
                newFilters.type = (Array.isArray(prev.type) ? prev.type : []).filter(t => t !== value);
            } else if (key === 'supplier_ids') {
                newFilters.supplier_ids = (Array.isArray(prev.supplier_ids) ? prev.supplier_ids : []).filter(id => id !== value);
            } else if (key === 'stock') {
                newFilters.min_stock = '';
                newFilters.max_stock = '';
            } else if (key === 'date') {
                newFilters.start_date = '';
                newFilters.end_date = '';
            } else if (key === 'missing_purchase_price' || key === 'multiple_suppliers') {
                newFilters[key] = '';
            } else {
                newFilters[key] = '';
            }
            const normalizedFilters = sanitizeProductFilters(newFilters, allAttributes);
            fetchProducts(1, normalizedFilters);
            return normalizedFilters;
        });
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleAttributeFilterChange = (attrId, value) => {
        setFilters(prev => {
            const currentValues = prev.attributes[attrId] || [];
            let newValues;
            if (currentValues.includes(value)) newValues = currentValues.filter(v => v !== value);
            else newValues = [...currentValues, value];
            const updated = { ...prev, attributes: { ...prev.attributes, [attrId]: newValues } };
            fetchProducts(1, updated);
            return updated;
        });
    };

    const handleReset = () => {
        const resetFilters = getDefaultProductFilters();
        const defaultSort = DEFAULT_SORT_CONFIG;
        
        localStorage.removeItem(PRODUCT_MANAGEMENT_PERSISTENT_STATE_KEY);
        localStorage.removeItem('product_list_search_current_term');
        if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(PRODUCT_MANAGEMENT_WORKING_STATE_KEY);
        }
        
        setFilters(resetFilters);
        setTempFilters(resetFilters);
        setSortConfig(defaultSort);
        setSelectedIds([]);
        setExpandedRows([]);
        setPagination(prev => ({ ...prev, current_page: 1 }));
        setIsTrashView(false);
        
        fetchProducts(1, resetFilters, defaultSort);
    };

    const handleRefresh = () => fetchProducts(1);

    const closeImportErrorModal = () => {
        setImportExcelErrors([]);
        setImportExcelErrorMessage('');
        setImportExcelResultTone('error');
    };

    const resetImportConfig = () => {
        setPendingImportFile(null);
        setImportMode(DEFAULT_IMPORT_MODE);
        setImportMissingProductAction(DEFAULT_IMPORT_MISSING_PRODUCT_ACTION);
        setImportUpdateFieldIds([]);
        setImportAttributeSearch('');
        setShowImportConfigModal(false);
    };

    const closeImportConfigModal = () => {
        if (isImportingExcel) return;
        resetImportConfig();
    };

    const openExportModal = () => {
        if (isTrashView) return;
        setExportOnlySelected(selectedIds.length > 0);
        setShowExportModal(true);
    };

    const applyContentOnlyExportPreset = () => {
        setExportColumnIds(
            CONTENT_ONLY_EXPORT_COLUMN_IDS.filter((id) => exportFieldOptions.some((option) => option.id === id))
        );
    };

    const applyLocalStructureExportPreset = () => {
        setExportColumnIds(
            LOCAL_STRUCTURE_EXPORT_COLUMN_IDS.filter((id) => exportFieldOptions.some((option) => option.id === id))
        );
    };

    const toggleExportColumn = (columnId) => {
        setExportColumnIds((prev) => (
            prev.includes(columnId)
                ? prev.filter((id) => id !== columnId)
                : [...prev, columnId]
        ));
    };

    const handleSelectAllExportColumns = () => {
        setExportColumnIds(exportFieldOptions.map((option) => option.id));
    };

    const handleDownloadExportExcel = async () => {
        if (exportColumnIds.length === 0) {
            setNotification({ type: 'error', message: 'Hãy chọn ít nhất 1 cột để xuất Excel.' });
            setTimeout(() => setNotification(null), 3000);
            return;
        }

        setIsExportingExcel(true);
        try {
            const params = {
                ...buildQueryParams(1, filters, sortConfig, pagination.per_page),
                columns: exportColumnIds.join(','),
            };

            if (exportOnlySelected && selectedIds.length > 0) {
                params.selected_ids = selectedIds.join(',');
            }

            const response = await productApi.downloadExcel(params);
            downloadBlobResponse(response, 'san-pham.xlsx');
            setShowExportModal(false);
        } catch (error) {
            console.error('Product export error:', error);
            setNotification({
                type: 'error',
                message: error?.response?.data?.message || 'KhÃ´ng thá»ƒ xuáº¥t Excel sáº£n pháº©m.',
            });
            setTimeout(() => setNotification(null), 3500);
        } finally {
            setIsExportingExcel(false);
        }
    };

    const handleOpenImportPicker = () => {
        if (isImportingExcel) return;
        importInputRef.current?.click();
    };

    const handleImportModeChange = (nextMode) => {
        setImportMode(nextMode);
        setImportMissingProductAction(nextMode === 'update_selected_fields' ? 'skip' : 'create');
    };

    const applyContentOnlyImportPreset = () => {
        setImportMode('update_selected_fields');
        setImportMissingProductAction('skip');
        setImportUpdateFieldIds(
            CONTENT_ONLY_IMPORT_FIELD_IDS.filter((id) => importFieldOptions.some((option) => option.id === id))
        );
    };

    const applyLocalStructureImportPreset = () => {
        setImportMode('replace_all');
        setImportMissingProductAction('create');
        setImportUpdateFieldIds([]);
    };

    const toggleImportUpdateField = (fieldId) => {
        setImportUpdateFieldIds((prev) => (
            prev.includes(fieldId)
                ? prev.filter((id) => id !== fieldId)
                : [...prev, fieldId]
        ));
    };

    const handleSelectAllImportFields = () => {
        setImportUpdateFieldIds(importFieldOptions.map((option) => option.id));
    };

    const handleSelectImportBaseFields = () => {
        setImportUpdateFieldIds((prev) => Array.from(new Set([
            ...prev.filter((id) => String(id).startsWith('attr_')),
            ...IMPORT_BASE_FIELD_OPTIONS.map((option) => option.id),
        ])));
    };

    const handleSelectImportAttributeFields = () => {
        setImportUpdateFieldIds((prev) => Array.from(new Set([
            ...prev.filter((id) => !String(id).startsWith('attr_')),
            ...importAttributeFieldOptions.map((option) => option.id),
        ])));
    };

    const handleClearImportAttributeFields = () => {
        setImportUpdateFieldIds((prev) => prev.filter((id) => !String(id).startsWith('attr_')));
    };

    const handleClearImportFields = () => {
        setImportUpdateFieldIds([]);
    };

    const handleImportFileChange = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        closeImportErrorModal();
        setPendingImportFile(file);
        setImportMode(DEFAULT_IMPORT_MODE);
        setImportMissingProductAction(DEFAULT_IMPORT_MISSING_PRODUCT_ACTION);
        setImportUpdateFieldIds([]);
        setImportAttributeSearch('');
        setShowImportConfigModal(true);
    };

    const handleSubmitImportExcel = async () => {
        if (!pendingImportFile) {
            return;
        }

        if (isSelectiveImport && importUpdateFieldIds.length === 0) {
            setNotification({ type: 'error', message: 'Hãy chọn ít nhất 1 trường cần cập nhật.' });
            setTimeout(() => setNotification(null), 3000);
            return;
        }

        const data = new FormData();
        data.append('file', pendingImportFile);
        data.append('mode', importMode);
        data.append('missing_product_action', importMissingProductAction);

        if (isSelectiveImport) {
            importUpdateFieldIds.forEach((fieldId) => data.append('update_fields[]', fieldId));
        }

        setIsImportingExcel(true);
        closeImportErrorModal();
        try {
            const response = await productApi.importExcel(data);
            const importErrors = Array.isArray(response?.data?.errors)
                ? response.data.errors
                : [];
            const message = response?.data?.message || 'Import Excel thành công.';
            setNotification({
                type: 'success',
                message,
            });
            setTimeout(() => setNotification(null), 4000);
            resetImportConfig();
            if (importErrors.length > 0) {
                setImportExcelErrors(importErrors);
                setImportExcelErrorMessage(message);
                setImportExcelResultTone('warning');
            }
            fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);
        } catch (error) {
            console.error('Product import error:', error);
            console.error('Product import response data:', error?.response?.data);
            const rawImportErrors = error?.response?.data?.errors;
            const importErrors = Array.isArray(rawImportErrors)
                ? rawImportErrors
                : rawImportErrors && typeof rawImportErrors === 'object'
                    ? Object.entries(rawImportErrors).flatMap(([column, messages]) => {
                        const normalizedMessages = Array.isArray(messages) ? messages : [messages];

                        return normalizedMessages
                            .filter(Boolean)
                            .map((item) => ({
                                row: '-',
                                column,
                                message: typeof item === 'string' ? item : 'Lỗi import không xác định.',
                            }));
                    })
                    : [];
            const message = error?.response?.data?.message || 'KhÃ´ng thá»ƒ import file Excel sáº£n pháº©m.';

            if (importErrors.length > 0) {
                resetImportConfig();
                setImportExcelErrors(importErrors);
                setImportExcelErrorMessage(message);
                setImportExcelResultTone('error');
            } else {
                setNotification({ type: 'error', message });
                setTimeout(() => setNotification(null), 4000);
            }
        } finally {
            setIsImportingExcel(false);
        }
    };

    const areAllVisibleProductsSelected = products.length > 0
        && products.every((product) => selectedIds.includes(product.id));

    const handleExitSelectedOnlyMode = useCallback(() => {
        const restorePage = selectedOnlyRestorePageRef.current ?? pagination.current_page ?? 1;
        selectedOnlyRestorePageRef.current = null;
        setShowSelectedOnly(false);
        fetchProducts(restorePage, filters, sortConfig, pagination.per_page);
    }, [filters, pagination.current_page, pagination.per_page, sortConfig]);

    const handleToggleSelectedOnly = useCallback(() => {
        if (selectedIdsRef.current.length === 0) {
            return;
        }

        if (showSelectedOnlyRef.current) {
            handleExitSelectedOnlyMode();
            return;
        }

        selectedOnlyRestorePageRef.current = pagination.current_page ?? 1;
        setShowSelectedOnly(true);
        fetchProducts(1, filters, sortConfig, pagination.per_page);
    }, [filters, handleExitSelectedOnlyMode, pagination.current_page, pagination.per_page, sortConfig]);

    const handleClearSelectedProducts = useCallback(() => {
        setSelectedIds([]);

        if (showSelectedOnlyRef.current) {
            handleExitSelectedOnlyMode();
        }
    }, [handleExitSelectedOnlyMode]);

    const toggleSelectAll = () => {
        const visibleProductIdMap = new Map(products.map((product) => [String(product.id), product.id]));
        let nextSelectedIds = [];

        if (areAllVisibleProductsSelected) {
            nextSelectedIds = selectedIdsRef.current.filter((id) => !visibleProductIdMap.has(String(id)));
        } else {
            nextSelectedIds = Array.from(
                new Map([
                    ...selectedIdsRef.current.map((id) => [String(id), id]),
                    ...products.map((product) => [String(product.id), product.id]),
                ]).values(),
            );
        }

        setSelectedIds(nextSelectedIds);

        if (!showSelectedOnlyRef.current) {
            return;
        }

        if (nextSelectedIds.length === 0) {
            handleExitSelectedOnlyMode();
            return;
        }

        fetchProducts(1, filters, sortConfig, pagination.per_page);
    };

    const toggleSelectProduct = (id) => {
        const nextSelectedIds = selectedIdsRef.current.includes(id)
            ? selectedIdsRef.current.filter((item) => item !== id)
            : [...selectedIdsRef.current, id];

        setSelectedIds(nextSelectedIds);

        if (!showSelectedOnlyRef.current) {
            return;
        }

        if (nextSelectedIds.length === 0) {
            handleExitSelectedOnlyMode();
            return;
        }

        fetchProducts(1, filters, sortConfig, pagination.per_page);
    };

    const handleRowSelectionClick = (id, event) => {
        if (event?.defaultPrevented) return;

        const interactiveTarget = event?.target?.closest?.(
            'button, a, input, textarea, select, option, [data-no-row-select="true"]'
        );

        if (interactiveTarget) return;
        toggleSelectProduct(id);
    };

    const addToSearchHistory = (term) => {
        if (!term || term.trim() === '' || term.length < 2) return;
        setSearchHistory(prev => {
            const filtered = prev.filter(item => item !== term);
            const updated = [term, ...filtered].slice(0, 10);
            localStorage.setItem('product_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    const hasInitializedTrashViewRef = useRef(false);
    useEffect(() => {
        if (!hasInitializedTrashViewRef.current) {
            hasInitializedTrashViewRef.current = true;
            return;
        }

        fetchProducts(1);
    }, [isTrashView]);

    useEffect(() => {
        if (showSelectedOnly && selectedIds.length === 0) {
            selectedOnlyRestorePageRef.current = null;
            setShowSelectedOnly(false);
        }
    }, [selectedIds.length, setShowSelectedOnly, showSelectedOnly]);

    const handleDelete = async (id) => {
        if (!window.confirm(isTrashView ? "Bạn có chắc muốn xóa VĨNH VIỄN sản phẩm này? Hành động này không thể hoàn tác." : "Chuyển sản phẩm này vào thùng rác?")) return;
        setLoading(true);
        try {
            if (isTrashView) await productApi.forceDelete(id);
            else await productApi.destroy(id);

            setNotification({ type: 'success', message: isTrashView ? 'Đã xóa vĩnh viễn sản phẩm' : 'Đã chuyển vào thùng rác' });

            // If current page is now empty, go back one page
            const newPage = (products.length === 1 && pagination.current_page > 1)
                ? pagination.current_page - 1
                : pagination.current_page;

            fetchProducts(newPage);
            if (!isTrashView) fetchTrashCount();
        } catch (error) {
            console.error("Delete error:", error);
            setNotification({ type: 'error', message: 'Lỗi khi thực hiện thao tác!' });
        } finally { setLoading(false); }
    };

    const handleRestore = async (id) => {
        setLoading(true);
        try {
            await productApi.restore(id);
            setNotification({ type: 'success', message: 'Đã khôi phục sản phẩm' });
            fetchProducts(pagination.current_page);
        } catch (error) { setNotification({ type: 'error', message: 'Lỗi khi khôi phục!' }); } finally { setLoading(false); }
    };

    const handleBulkDelete = async () => {
        if (!window.confirm(isTrashView ? `Xóa vĩnh viễn ${selectedIds.length} sản phẩm?` : `Xóa ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            if (isTrashView) await productApi.bulkForceDelete(selectedIds);
            else await productApi.bulkDelete(selectedIds);
            setSelectedIds([]);
            fetchProducts(1);
            setNotification({ type: 'success', message: 'Thao tác thành công' });
        } catch (error) { setNotification({ type: 'error', message: "Lỗi thực hiện!" }); } finally { setLoading(false); }
    };

    const handleBulkRestore = async () => {
        if (!window.confirm(`Khôi phục ${selectedIds.length} sản phẩm?`)) return;
        setLoading(true);
        try {
            await productApi.bulkRestore(selectedIds);
            setSelectedIds([]);
            fetchProducts(1);
            setNotification({ type: 'success', message: 'Đã khôi phục thành công' });
        } catch (error) { setNotification({ type: 'error', message: "Lỗi thực hiện!" }); } finally { setLoading(false); }
    };

    const handleSyncGoogleMerchantProduct = async (id, event) => {
        event?.stopPropagation();
        setSyncingGoogleMerchant(true);
        try {
            await googleMerchantApi.syncProduct(id);
            setNotification({ type: 'success', message: 'Đã đồng bộ Google Merchant.' });
            fetchProducts(pagination.current_page);
        } catch (error) {
            const message = error.response?.data?.message || 'Không thể đồng bộ Google Merchant.';
            setNotification({ type: 'error', message });
        } finally {
            setSyncingGoogleMerchant(false);
        }
    };

    const handleSyncSelectedGoogleMerchant = async () => {
        if (selectedIds.length === 0 || isTrashView) return;
        setSyncingGoogleMerchant(true);
        try {
            const response = await googleMerchantApi.syncProducts({ ids: selectedIds, queue: true });
            const failed = Number(response.data?.failed || 0);
            setNotification({
                type: failed > 0 ? 'error' : 'success',
                message: response.data?.status === 'queued'
                    ? `Đã đưa ${response.data?.queued || selectedIds.length} sản phẩm vào hàng đợi Google Merchant.`
                    : failed > 0
                    ? `Đồng bộ Google Merchant xong, lỗi ${failed} sản phẩm.`
                    : `Đã đồng bộ ${selectedIds.length} sản phẩm lên Google Merchant.`,
            });
            fetchProducts(pagination.current_page);
        } catch (error) {
            const message = error.response?.data?.message || 'Không thể đồng bộ Google Merchant.';
            setNotification({ type: 'error', message });
        } finally {
            setSyncingGoogleMerchant(false);
        }
    };

    const handleRegenerateAiReviews = async (ids, event = null) => {
        event?.stopPropagation();

        const normalizedIds = Array.from(
            new Map(
                (Array.isArray(ids) ? ids : [ids])
                    .map((value) => normalizeStoredId(value))
                    .filter((value) => value !== null)
                    .map((value) => [String(value), value]),
            ).values(),
        );

        if (normalizedIds.length === 0 || isTrashView) {
            setNotification({ type: 'error', message: 'Hãy chọn ít nhất 1 sản phẩm đang bán để tạo review AI.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        if (!aiAvailable) {
            setNotification({ type: 'error', message: disabledReason || 'AI chưa sẵn sàng.' });
            setTimeout(() => setNotification(null), 5000);
            return;
        }

        if (generatingAiReviews) {
            return;
        }

        if (!window.confirm(`Tạo lại review AI cho ${normalizedIds.length} sản phẩm? Review AI cũ của các sản phẩm này sẽ được thay bằng 90-100 review mới.`)) {
            return;
        }

        setGeneratingAiReviews(true);
        setAiReviewProgress({ current: 0, total: normalizedIds.length, failed: 0 });

        let successCount = 0;
        let failedCount = 0;
        let firstErrorMessage = '';

        try {
            for (let index = 0; index < normalizedIds.length; index += 1) {
                const productId = normalizedIds[index];
                const productKey = String(productId);

                setAiReviewProgress({ current: index, total: normalizedIds.length, failed: failedCount });
                setAiReviewProductStates((current) => ({
                    ...current,
                    [productKey]: { status: 'running', message: 'Đang tạo review AI' },
                }));

                try {
                    const response = await productApi.regenerateAiReviews(productId, { replace: true });
                    const result = response?.data?.result || {};
                    successCount += 1;
                    setAiReviewProductStates((current) => ({
                        ...current,
                        [productKey]: {
                            status: 'success',
                            message: `${result.reviews || 0} review, ${result.replies || 0} phản hồi`,
                        },
                    }));
                } catch (error) {
                    failedCount += 1;
                    const errorMessage = error?.response?.data?.message || 'Không tạo được review AI';
                    firstErrorMessage ||= errorMessage;
                    setAiReviewProductStates((current) => ({
                        ...current,
                        [productKey]: {
                            status: 'error',
                            message: errorMessage,
                        },
                    }));
                }

                setAiReviewProgress({ current: index + 1, total: normalizedIds.length, failed: failedCount });
            }

            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);

            setNotification({
                type: failedCount > 0 ? 'error' : 'success',
                message: failedCount > 0
                    ? (successCount > 0
                        ? `Đã tạo review AI cho ${successCount} sản phẩm, lỗi ${failedCount} sản phẩm: ${firstErrorMessage}`
                        : `Không tạo được review AI: ${firstErrorMessage}`)
                    : `Đã tạo lại review AI cho ${successCount} sản phẩm.`,
            });
            setTimeout(() => setNotification(null), 6000);
        } finally {
            setGeneratingAiReviews(false);
            setAiReviewProgress({ current: 0, total: 0, failed: 0 });
        }
    };

    const handleSyncAllGoogleMerchant = async () => {
        if (isTrashView) return;
        if (!window.confirm('Đồng bộ sản phẩm đang bán và xóa khỏi Merchant các sản phẩm tạm ngừng đã từng đồng bộ?')) return;
        setSyncingGoogleMerchant(true);
        try {
            const response = await googleMerchantApi.syncProducts({ all: true });
            setNotification({ type: 'success', message: `Đã đưa ${response.data?.queued || 0} sản phẩm vào hàng đợi Google Merchant.` });
        } catch (error) {
            const message = error.response?.data?.message || 'Không thể đồng bộ toàn bộ Google Merchant.';
            setNotification({ type: 'error', message });
        } finally {
            setSyncingGoogleMerchant(false);
        }
    };

    const handleDuplicate = async (id) => {
        setLoading(true);
        try {
            const response = await productApi.duplicate(id);
            const newProduct = response.data?.data || response.data;
            navigateToProductForm(`/admin/products/edit/${newProduct.id}?mode=duplicate`);
        } catch (error) {
            console.error("Duplicate error:", error);
            const msg = error.response?.data?.message || "Lỗi khi nhân bản sản phẩm!";
            setNotification({ type: 'error', message: msg });
        } finally { setLoading(false); }
    };

    const handleBulkDuplicate = async () => {
        if (selectedIds.length === 1) {
            handleDuplicate(selectedIds[0]);
            return;
        }
        setLoading(true);
        try {
            const results = await Promise.all(selectedIds.map(id => productApi.duplicate(id)));
            const count = results.length;
            setSelectedIds([]);
            fetchProducts(1); // Back to page 1 to see the new copies
            setNotification({ type: 'success', message: `Đã nhân bản thành công ${count} sản phẩm.` });
            setTimeout(() => setNotification(null), 5000);
        } catch (error) {
            console.error("Duplicate error:", error);
            const msg = error.response?.data?.message || "Lỗi khi nhân bản sản phẩm!";
            setNotification({ type: 'error', message: msg });
        } finally { setLoading(false); }
    };

    const requestDuplicate = (id) => {
        navigateToProductForm(`/admin/products/edit/${id}?mode=duplicate`);
    };

    const requestBulkDuplicate = () => {
        if (selectedIds.length === 0) {
            return;
        }

        if (selectedIds.length === 1) {
            navigateToProductForm(`/admin/products/edit/${selectedIds[0]}?mode=duplicate`);
            return;
        }

        openDuplicateConfirm(selectedIds);
    };

    const handleConfirmDuplicate = async () => {
        const duplicateIds = duplicateConfirm?.ids || [];

        if (duplicateIds.length === 0) {
            return;
        }

        setSubmittingDuplicate(true);
        setLoading(true);
        try {
            if (duplicateIds.length === 1) {
                const response = await productApi.duplicate(duplicateIds[0]);
                const newProduct = response.data?.data || response.data;

                setDuplicateConfirm(null);
                navigateToProductForm(`/admin/products/edit/${newProduct.id}?mode=duplicate`);
            } else {
                const results = await Promise.all(duplicateIds.map((id) => productApi.duplicate(id)));
                const count = results.length;

                setDuplicateConfirm(null);
                setSelectedIds([]);
                fetchProducts(1);
                setNotification({ type: 'success', message: `Đã nhân bản thành công ${count} sản phẩm.` });
                setTimeout(() => setNotification(null), 5000);
            }
        } catch (error) {
            console.error("Duplicate error:", error);
            const msg = error.response?.data?.message || "Lỗi khi nhân bản sản phẩm!";
            setNotification({ type: 'error', message: msg });
        } finally {
            setSubmittingDuplicate(false);
            setLoading(false);
        }
    };

    const toggleBulkSupplierSelection = (supplierId) => {
        setBulkUpdateData((prev) => {
            const currentSupplierIds = Array.isArray(prev.supplier_ids) ? prev.supplier_ids : [];
            const normalizedId = String(supplierId);

            return {
                ...prev,
                supplier_ids: currentSupplierIds.includes(normalizedId)
                    ? currentSupplierIds.filter((id) => id !== normalizedId)
                    : [...currentSupplierIds, normalizedId]
            };
        });
    };

    const closeBulkCopyModal = () => {
        bulkCopySourceRequestRef.current += 1;
        setShowBulkCopyModal(false);
        setBulkCopySourceQuery('');
        setBulkCopySourceResults([]);
        setBulkCopySourceProduct(null);
        setBulkCopySourceItems(createEmptyBulkCopySelectionState());
        setBulkCopySelectedItemKeys(createEmptyBulkCopySelectionState());
        setBulkCopySourceItemsLoading(false);
        setBulkCopySourceItemsError('');
        setSubmittingBulkCopy(false);
    };

    const toggleBulkCopyItemSelection = (groupKey, itemKey) => {
        setBulkCopySelectedItemKeys((prev) => {
            const currentKeys = Array.isArray(prev[groupKey]) ? prev[groupKey] : [];
            const nextKeys = currentKeys.includes(itemKey)
                ? currentKeys.filter((key) => key !== itemKey)
                : [...currentKeys, itemKey];

            return {
                ...prev,
                [groupKey]: nextKeys,
            };
        });
    };

    const setBulkCopyGroupSelection = (groupKey, selectAll) => {
        setBulkCopySelectedItemKeys((prev) => ({
            ...prev,
            [groupKey]: selectAll
                ? (bulkCopySourceItems[groupKey] || []).map((item) => item.copy_key)
                : [],
        }));
    };

    const fetchBulkCopySourceProducts = (query = bulkCopySourceQuery) => {
        if (!showBulkCopyModal) return;

        const trimmedQuery = query.trim().toLowerCase();
        const selectedProductMap = new Set(selectedIds.map((id) => String(id)));
        const selectedProductsOnly = products.filter((product) => selectedProductMap.has(String(product.id)));

        const filteredProducts = trimmedQuery
            ? selectedProductsOnly.filter((product) => (
                String(product.name || '').toLowerCase().includes(trimmedQuery)
                || String(product.sku || '').toLowerCase().includes(trimmedQuery)
            ))
            : selectedProductsOnly;

        setBulkCopySourceResults(filteredProducts);
    };

    useEffect(() => {
        if (!showBulkCopyModal) return undefined;

        const timer = setTimeout(() => {
            fetchBulkCopySourceProducts();
        }, 150);

        return () => clearTimeout(timer);
    }, [bulkCopySourceQuery, products, selectedIds, showBulkCopyModal]);

    useEffect(() => {
        if (!bulkCopySourceProduct?.id) return;

        const stillSelected = selectedIds.some((id) => String(id) === String(bulkCopySourceProduct.id));
        if (!stillSelected) {
            setBulkCopySourceProduct(null);
        }
    }, [bulkCopySourceProduct, selectedIds]);

    useEffect(() => {
        if (bulkCopySourceProduct?.id || !showBulkCopyModal) return;

        bulkCopySourceRequestRef.current += 1;
        setBulkCopySourceItems(createEmptyBulkCopySelectionState());
        setBulkCopySelectedItemKeys(createEmptyBulkCopySelectionState());
        setBulkCopySourceItemsLoading(false);
        setBulkCopySourceItemsError('');
    }, [bulkCopySourceProduct, showBulkCopyModal]);

    useEffect(() => {
        if (!showBulkCopyModal || !bulkCopySourceProduct?.id) return undefined;

        const requestId = bulkCopySourceRequestRef.current + 1;
        bulkCopySourceRequestRef.current = requestId;
        let isCurrent = true;

        setBulkCopySourceItemsLoading(true);
        setBulkCopySourceItemsError('');
        setBulkCopySourceItems(createEmptyBulkCopySelectionState());
        setBulkCopySelectedItemKeys(createEmptyBulkCopySelectionState());

        productApi.getOne(bulkCopySourceProduct.id, { context: 'edit' })
            .then((response) => {
                if (!isCurrent || bulkCopySourceRequestRef.current !== requestId) return;

                const sourceProduct = response.data || {};
                const nextSourceItems = {
                    specifications: buildBulkCopySpecificationItems(sourceProduct.specifications),
                    additional_info: buildBulkCopyAdditionalInfoItems(sourceProduct.additional_info),
                };

                setBulkCopySourceItems(nextSourceItems);
                setBulkCopySelectedItemKeys({
                    specifications: nextSourceItems.specifications.map((item) => item.copy_key),
                    additional_info: nextSourceItems.additional_info.map((item) => item.copy_key),
                });
            })
            .catch((error) => {
                if (!isCurrent || bulkCopySourceRequestRef.current !== requestId) return;

                console.error('Bulk copy source load error:', error);
                setBulkCopySourceItems(createEmptyBulkCopySelectionState());
                setBulkCopySelectedItemKeys(createEmptyBulkCopySelectionState());
                setBulkCopySourceItemsError(error.response?.data?.message || 'Không thể tải dữ liệu chi tiết từ sản phẩm nguồn.');
            })
            .finally(() => {
                if (!isCurrent || bulkCopySourceRequestRef.current !== requestId) return;
                setBulkCopySourceItemsLoading(false);
            });

        return () => {
            isCurrent = false;
        };
    }, [bulkCopySourceProduct?.id, showBulkCopyModal]);

    const handleBulkCopySubmit = async () => {
        if (!bulkCopySourceProduct?.id) {
            setNotification({ type: 'error', message: 'Hãy chọn sản phẩm nguồn để sao chép.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        if (bulkCopySourceItemsLoading) {
            setNotification({ type: 'error', message: 'Dữ liệu sản phẩm nguồn đang được tải, vui lòng thử lại sau giây lát.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        const selectedSpecifications = pickBulkCopyItems(
            bulkCopySourceItems.specifications,
            bulkCopySelectedItemKeys.specifications
        );
        const selectedAdditionalInfo = pickBulkCopyItems(
            bulkCopySourceItems.additional_info,
            bulkCopySelectedItemKeys.additional_info
        );
        const fieldsToCopy = [];
        const basic_info = {};

        if (selectedSpecifications.length > 0) {
            fieldsToCopy.push('specifications');
            basic_info.specifications = JSON.stringify(selectedSpecifications);
        }

        if (selectedAdditionalInfo.length > 0) {
            fieldsToCopy.push('additional_info');
            basic_info.additional_info = JSON.stringify(selectedAdditionalInfo);
        }

        if (fieldsToCopy.length === 0) {
            setNotification({ type: 'error', message: 'Hãy chọn ít nhất 1 mục cần sao chép.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        const targetIds = selectedIds.filter((id) => String(id) !== String(bulkCopySourceProduct.id));

        if (targetIds.length === 0) {
            setNotification({ type: 'error', message: 'Sau khi loại sản phẩm nguồn, không còn sản phẩm đích nào để cập nhật.' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        setSubmittingBulkCopy(true);

        try {
            const response = await productApi.bulkUpdateAttributes({
                ids: targetIds,
                basic_info,
                merge_fields: fieldsToCopy,
            });

            closeBulkCopyModal();
            setSelectedIds([]);
            setLastBulkUpdateLogId(response.data.log_id);
            fetchProducts(pagination.current_page);
            const copiedLabelParts = [];
            if (selectedSpecifications.length > 0) {
                copiedLabelParts.push(`${selectedSpecifications.length} dòng thông số`);
            }
            if (selectedAdditionalInfo.length > 0) {
                copiedLabelParts.push(`${selectedAdditionalInfo.length} mục bổ sung`);
            }
            setNotification({
                type: 'success',
                message: `Đã sao chép ${copiedLabelParts.join(', ')} từ "${bulkCopySourceProduct.name}" cho ${targetIds.length} sản phẩm.`,
                action: 'undo',
            });
            setTimeout(() => setNotification(null), 10000);
        } catch (error) {
            console.error('Bulk copy error:', error);
            const msg = error.response?.data?.message || 'Không thể sao chép thuộc tính từ sản phẩm nguồn.';
            setNotification({ type: 'error', message: msg });
            setTimeout(() => setNotification(null), 4000);
        } finally {
            setSubmittingBulkCopy(false);
        }
    };

    const handleBulkUpdateAttributesSubmit = async () => {
        // Separate basic info from attributes
        const basicInfoFields = ['category_id', 'category_ids', 'price', 'expected_cost', 'stock_quantity', 'supplier_ids', 'inventory_unit_id', 'is_featured', 'is_new', 'status', 'type'];
        const basic_info = {};
        const attributes = {};
        
        for (const key in bulkUpdateData) {
            const val = bulkUpdateData[key];
            if (val !== '' && val !== null && (!Array.isArray(val) || val.length > 0)) {
                if (basicInfoFields.includes(key)) {
                    basic_info[key] = val;
                } else {
                    attributes[key] = val;
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(basic_info, 'price')) {
            const normalizedPrice = normalizeWholeMoneyNumber(basic_info.price);
            if (normalizedPrice === null) {
                setNotification({ type: 'error', message: 'Giá bán phải là số hợp lệ.' });
                setTimeout(() => setNotification(null), 4000);
                return;
            }
            basic_info.price = normalizedPrice;
        }

        if (Object.prototype.hasOwnProperty.call(basic_info, 'expected_cost')) {
            const normalizedExpectedCost = normalizeRoundedImportCostNumber(basic_info.expected_cost);
            if (normalizedExpectedCost === null) {
                setNotification({ type: 'error', message: 'Giá dự kiến phải là số hợp lệ.' });
                setTimeout(() => setNotification(null), 4000);
                return;
            }
            basic_info.expected_cost = normalizedExpectedCost;
        }

        if (Object.prototype.hasOwnProperty.call(basic_info, 'stock_quantity')) {
            const rawStockQuantity = String(basic_info.stock_quantity ?? '').trim();
            if (rawStockQuantity === '') {
                delete basic_info.stock_quantity;
            } else {
                const normalizedStockQuantity = parseQuantityNumber(rawStockQuantity);
                if (normalizedStockQuantity === null || normalizedStockQuantity < 0) {
                    setNotification({ type: 'error', message: 'Tồn kho phải là số hợp lệ không âm.' });
                    setTimeout(() => setNotification(null), 4000);
                    return;
                }
                basic_info.stock_quantity = normalizedStockQuantity;
            }
        }
        
        if (Object.prototype.hasOwnProperty.call(basic_info, 'inventory_unit_id')) {
            const normalizedInventoryUnitId = Number(basic_info.inventory_unit_id);
            if (!Number.isInteger(normalizedInventoryUnitId) || normalizedInventoryUnitId <= 0) {
                setNotification({ type: 'error', message: 'Đơn vị tính không hợp lệ.' });
                setTimeout(() => setNotification(null), 4000);
                return;
            }
            basic_info.inventory_unit_id = normalizedInventoryUnitId;
        }

        if (Object.keys(basic_info).length === 0 && Object.keys(attributes).length === 0) {
            setNotification({ type: 'error', message: 'Vui lòng chọn hoặc nhập ít nhất 1 thông tin để cập nhật!' });
            setTimeout(() => setNotification(null), 4000);
            return;
        }

        setLoading(true);
        try {
            const response = await productApi.bulkUpdateAttributes({
                ids: selectedIds,
                basic_info,
                attributes
            });
            setShowBulkUpdateModal(false);
            setBulkUpdateData({});
            setSelectedIds([]);
            setLastBulkUpdateLogId(response.data.log_id);
            fetchProducts(pagination.current_page);
            setNotification({ 
                type: 'success', 
                message: 'Cập nhật hàng loạt thành công!',
                action: 'undo'
            });
            setTimeout(() => setNotification(null), 10000); // Longer timeout to allow undo
        } catch (error) {
            console.error("Bulk update error:", error);
            const msg = error.response?.data?.message || (error.response?.status === 422 ? 'Dữ liệu không hợp lệ!' : 'Lỗi cập nhật sản phẩm!');
            setNotification({ type: 'error', message: msg });
            setTimeout(() => setNotification(null), 4000);
        } finally { setLoading(false); }
    };

    const handleUndoBulkUpdate = async () => {
        if (!lastBulkUpdateLogId) return;
        setLoading(true);
        try {
            await productApi.bulkUpdateUndo(lastBulkUpdateLogId);
            setLastBulkUpdateLogId(null);
            fetchProducts(pagination.current_page);
            setNotification({ type: 'success', message: 'Đã hoàn tác cập nhật thành công!' });
            setTimeout(() => setNotification(null), 4000);
        } catch (error) {
            console.error("Undo error:", error);
            setNotification({ type: 'error', message: 'Lỗi khi hoàn tác!' });
            setTimeout(() => setNotification(null), 4000);
        } finally { setLoading(false); }
    };

    const handleBulkImageRefreshApplied = async (payload) => {
        const updatedRecords = Number(payload?.summary?.updated_records || 0);
        const updatedProducts = Number(payload?.summary?.updated_products || 0);
        const failedRecords = Number(payload?.summary?.failed_records || 0);
        const appliedFileNames = Number(payload?.summary?.applied_file_names || 0);

        await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);

        setNotification({
            type: failedRecords > 0 ? 'error' : 'success',
            message: failedRecords > 0
                ? `Đã cập nhật ${updatedRecords} ảnh cho ${updatedProducts} sản phẩm từ ${appliedFileNames} tên file. Có ${failedRecords} bản ghi lỗi.`
                : `Đã cập nhật ${updatedRecords} ảnh cho ${updatedProducts} sản phẩm từ ${appliedFileNames} tên file.`,
        });
        setTimeout(() => setNotification(null), 5000);
    };

    const handleBulkImageAppendApplied = async (payload) => {
        const appliedProducts = Number(payload?.summary?.applied_products || 0);
        const createdRecords = Number(payload?.summary?.created_records || 0);
        const failedProducts = Number(payload?.summary?.failed_products || 0);

        await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);

        setNotification({
            type: failedProducts > 0 ? 'error' : 'success',
            message: failedProducts > 0
                ? `Đã thêm ${createdRecords} ảnh vào ${appliedProducts} sản phẩm. Có ${failedProducts} sản phẩm lỗi.`
                : `Đã thêm ${createdRecords} ảnh vào ${appliedProducts} sản phẩm.`,
        });
        setTimeout(() => setNotification(null), 5000);
    };

    const handleOpenCategoryImageManager = () => {
        categoryImageManagerDirtyRef.current = false;
        setShowCategoryImageManagerModal(true);
    };

    const handleCategoryImageManagerChanged = () => {
        categoryImageManagerDirtyRef.current = true;
    };

    const handleCloseCategoryImageManager = async () => {
        setShowCategoryImageManagerModal(false);

        if (categoryImageManagerDirtyRef.current) {
            categoryImageManagerDirtyRef.current = false;
            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);
        }
    };

    const handleCopy = (text, message, e, copyId) => {
        if (e) e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopiedText(copyId || text);
        if (message) {
            setNotification({ type: 'success', message: `Đã sao chép ${message}: ${text}` });
            setTimeout(() => setNotification(null), 2000);
        }
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleOpenProductLink = (product, e) => {
        if (e) e.stopPropagation();

        const productLink = buildProductPageUrl(product, domains);
        if (!productLink) {
            setNotification({ type: 'error', message: 'San pham nay chua co link de mo.' });
            setTimeout(() => setNotification(null), 2000);
            return;
        }

        window.open(productLink, '_blank', 'noopener,noreferrer');
    };

    const handleCopyAll = (p, e) => {
        if (e) e.stopPropagation();
        
        const typeLabel = TYPE_LABELS[p.type]?.label || p.type;
        const catName = formatCategorySummary(getProductCategoryNames(p, categories), '-');
        const priceValue = normalizeWholeMoneyNumber(p.price) ?? 0;
        const expectedCostValue = normalizeRoundedImportCostNumber(p.expected_cost ?? p.cost_price) ?? 0;
        const price = `${new Intl.NumberFormat('vi-VN').format(priceValue)}₫`;
        const costPrice = `${new Intl.NumberFormat('vi-VN').format(expectedCostValue)}₫`;
        const stock = getDisplayStock(p);
        
        let attrsStr = '';
        if (p.attribute_values && p.attribute_values.length > 0) {
            attrsStr = '\n' + p.attribute_values.map(av => {
                const attr = allAttributes.find(a => String(a.id) === String(av.attribute_id));
                const label = attr ? attr.name : `Attr ${av.attribute_id}`;
                let val = av.value;
                try {
                    const parsed = JSON.parse(val);
                    val = Array.isArray(parsed) ? parsed.join(', ') : parsed;
                } catch(e) {}
                return `${label}: ${val}`;
            }).join('\n');
        }

        const text = `Tên SP: ${p.name}\nMã SP: ${p.sku}\nLoại: ${typeLabel}\nDanh mục: ${catName}\nGiá bán: ${price}\nGiá dự kiến: ${costPrice}\nKho: ${stock}\nThông số: ${p.specifications || '-'}${attrsStr}`;
        
        navigator.clipboard.writeText(text);
        setCopiedText('all_' + p.id);
        setNotification({ type: 'success', message: 'Đã sao chép toàn bộ thuộc tính sản phẩm' });
        setTimeout(() => setNotification(null), 2000);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleSaveInlineEdit = async () => {
        if (!editingCell) return;
        const { id, field } = editingCell;
        try {
            setLoading(true);
            const payloadField = field === 'cost_price' ? 'expected_cost' : field;
            const payloadValue = field === 'price'
                ? normalizeWholeMoneyNumber(editValue)
                : (field === 'cost_price' ? normalizeRoundedImportCostNumber(editValue) : editValue);

            if ((field === 'price' || field === 'cost_price') && payloadValue === null) {
                setNotification({ type: 'error', message: 'Giá phải là số hợp lệ.' });
                return;
            }

            await productApi.update(id, { [payloadField]: payloadValue });
            await fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);
            setJustUpdatedId(id);
            setTimeout(() => setJustUpdatedId(null), 2000);
        } catch (error) { alert("Lỗi!"); } finally { setEditingCell(null); setLoading(false); }
    };

    const getSortKeyForColumn = (column) => {
        const columnId = typeof column === 'string' ? column : column?.id;

        if (!columnId) return null;
        if (columnId === 'actions' || columnId === 'images') return null;
        if (columnId === 'stock') return 'actual_stock';
        return columnId;
    };

    const isSortableColumn = (column) => {
        if (typeof column === 'object' && column?.sortable === false) {
            return false;
        }

        return getSortKeyForColumn(column) !== null;
    };

    const handleSort = (columnId) => {
        const key = getSortKeyForColumn(columnId);
        if (!key) return;

        let newSort;
        if (sortConfig.key !== key) {
            newSort = { key, direction: 'desc', phase: 1 };
        } else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            if (nextPhase === 3) newSort = { key: 'id', direction: 'desc', phase: 1 };
            else newSort = { key, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
        }
        setSortConfig(newSort);
        localStorage.setItem('product_list_sort', JSON.stringify(newSort));
        fetchProducts(1, filters, newSort);
    };

    const getAttributeValue = (product, attrId) => {
        const valObj = product.attribute_values?.find(av => av.attribute_id === attrId);
        if (!valObj) return '-';
        try {
            const parsed = JSON.parse(valObj.value);
            return Array.isArray(parsed) ? parsed.join(', ') : parsed;
        } catch (e) { return valObj.value; }
    };

    const renderQuickEditCoreFieldInput = (product, fieldId) => {
        const productKey = String(product.id);
        const draft = quickEditDrafts[productKey] || {};
        const isDirty = isQuickEditCoreFieldDirty(product.id, fieldId);
        const commonClass = `h-10 w-full rounded-sm border px-3 text-[12px] font-semibold outline-none transition-all ${
            isDirty
                ? 'border-amber-400 bg-amber-50 text-primary'
                : 'border-primary/15 bg-white text-primary'
        }`;

        if (fieldId === 'name') {
            return (
                <input
                    type="text"
                    value={draft.name || ''}
                    onChange={(event) => updateQuickEditDraft(product.id, 'name', event.target.value)}
                    className={commonClass}
                    disabled={quickEditSubmitting}
                    data-quick-edit-field="name"
                />
            );
        }

        if (fieldId === 'sku') {
            return (
                <input
                    type="text"
                    value={draft.sku || ''}
                    onChange={(event) => updateQuickEditDraft(product.id, 'sku', event.target.value)}
                    className={commonClass}
                    disabled={quickEditSubmitting}
                    data-quick-edit-field="sku"
                />
            );
        }

        if (fieldId === 'price' || fieldId === 'expected_cost') {
            return (
                <input
                    type="text"
                    value={formatWholeMoneyInput(draft[fieldId])}
                    onChange={(event) => updateQuickEditDraft(product.id, fieldId, normalizeWholeMoneyDraft(event.target.value))}
                    className={`${commonClass} text-right`}
                    inputMode="numeric"
                    disabled={quickEditSubmitting}
                    data-quick-edit-field={fieldId}
                />
            );
        }

        if (fieldId === 'category_id') {
            return (
                <select
                    value={draft.category_id || ''}
                    onChange={(event) => updateQuickEditDraft(product.id, 'category_id', event.target.value)}
                    className={commonClass}
                    disabled={quickEditSubmitting}
                    data-quick-edit-field="category_id"
                >
                    <option value="">Chưa gắn danh mục</option>
                    {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                </select>
            );
        }

        if (fieldId === 'type') {
            return (
                <select
                    value={draft.type || 'simple'}
                    onChange={(event) => updateQuickEditDraft(product.id, 'type', event.target.value)}
                    className={commonClass}
                    disabled={quickEditSubmitting}
                    data-quick-edit-field="type"
                >
                    {ACTIVE_PRODUCT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            );
        }

        if (fieldId === 'status' || fieldId === 'is_featured' || fieldId === 'is_new') {
            const fieldLabel = fieldId === 'status'
                ? 'Đang bán'
                : (fieldId === 'is_featured' ? 'Nổi bật' : 'Mới');

            return (
                <select
                    value={draft[fieldId] ? '1' : '0'}
                    onChange={(event) => updateQuickEditDraft(product.id, fieldId, event.target.value === '1')}
                    className={commonClass}
                    disabled={quickEditSubmitting}
                    data-quick-edit-field={fieldId}
                >
                    <option value="1">{fieldLabel}: Bật</option>
                    <option value="0">{fieldLabel}: Tắt</option>
                </select>
            );
        }

        return <span className="text-[12px] text-primary/40">--</span>;
    };

    const renderQuickEditAttributeInput = (product, attribute) => {
        const productKey = String(product.id);
        const attributeKey = String(attribute.id);
        const frontendType = String(attribute?.frontend_type || '').toLowerCase();
        const draftValue = quickEditDrafts[productKey]?.custom_attributes?.[attributeKey]
            ?? (frontendType === 'multiselect' ? [] : '');
        const isDirty = isQuickEditAttributeFieldDirty(product.id, attribute);
        const commonClass = `w-full rounded-sm border px-3 text-[12px] font-semibold outline-none transition-all ${
            isDirty
                ? 'border-amber-400 bg-amber-50 text-primary'
                : 'border-primary/15 bg-white text-primary'
        }`;

        if (frontendType === 'select') {
            return (
                <select
                    value={draftValue || ''}
                    onChange={(event) => updateQuickEditAttributeDraft(product.id, attribute.id, event.target.value)}
                    className={`${commonClass} h-10`}
                    disabled={quickEditSubmitting}
                    data-quick-edit-attribute={attribute.id}
                >
                    <option value="">Để trống</option>
                    {(attribute.options || []).map((option) => (
                        <option key={option.id} value={option.value}>{option.value}</option>
                    ))}
                </select>
            );
        }

        if (frontendType === 'multiselect') {
            const currentValues = Array.isArray(draftValue) ? draftValue : [];
            return (
                <div className={`max-h-28 space-y-1 overflow-y-auto rounded-sm border p-2 ${isDirty ? 'border-amber-300 bg-amber-50/80' : 'border-primary/15 bg-white'}`}>
                    {(attribute.options || []).map((option) => {
                        const checked = currentValues.includes(option.value);
                        return (
                            <label key={option.id} className="flex items-center gap-2 text-[11px] font-medium text-primary/85">
                                <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={checked}
                                    disabled={quickEditSubmitting}
                                    data-quick-edit-attribute={attribute.id}
                                    onChange={(event) => {
                                        const nextValues = event.target.checked
                                            ? [...currentValues, option.value]
                                            : currentValues.filter((value) => value !== option.value);
                                        updateQuickEditAttributeDraft(product.id, attribute.id, nextValues);
                                    }}
                                />
                                <span>{option.value}</span>
                            </label>
                        );
                    })}
                </div>
            );
        }

        if (frontendType === 'textarea') {
            return (
                <textarea
                    rows="3"
                    value={draftValue || ''}
                    onChange={(event) => updateQuickEditAttributeDraft(product.id, attribute.id, event.target.value)}
                    className={`${commonClass} min-h-[88px] py-2`}
                    disabled={quickEditSubmitting}
                    data-quick-edit-attribute={attribute.id}
                />
            );
        }

        if (frontendType === 'date') {
            return (
                <input
                    type="date"
                    value={draftValue || ''}
                    onChange={(event) => updateQuickEditAttributeDraft(product.id, attribute.id, event.target.value)}
                    className={`${commonClass} h-10`}
                    disabled={quickEditSubmitting}
                    data-quick-edit-attribute={attribute.id}
                />
            );
        }

        if (frontendType === 'price') {
            return (
                <input
                    type="text"
                    value={formatWholeMoneyInput(draftValue)}
                    onChange={(event) => updateQuickEditAttributeDraft(product.id, attribute.id, normalizeWholeMoneyDraft(event.target.value))}
                    className={`${commonClass} h-10 text-right`}
                    inputMode="numeric"
                    disabled={quickEditSubmitting}
                    data-quick-edit-attribute={attribute.id}
                />
            );
        }

        return (
            <input
                type="text"
                value={draftValue || ''}
                onChange={(event) => updateQuickEditAttributeDraft(product.id, attribute.id, event.target.value)}
                className={`${commonClass} h-10`}
                disabled={quickEditSubmitting}
                data-quick-edit-attribute={attribute.id}
            />
        );
    };

    const bulkCopyTargetCount = bulkCopySourceProduct
        ? selectedIds.filter((id) => String(id) !== String(bulkCopySourceProduct.id)).length
        : selectedIds.length;
    const bulkCopySelectedSpecificationCount = bulkCopySelectedItemKeys.specifications.length;
    const bulkCopySelectedAdditionalInfoCount = bulkCopySelectedItemKeys.additional_info.length;
    const bulkCopySelectedItemCount = bulkCopySelectedSpecificationCount + bulkCopySelectedAdditionalInfoCount;

    const renderBulkCopyGroup = (groupKey, options) => {
        const items = bulkCopySourceItems[groupKey] || [];
        const selectedKeys = bulkCopySelectedItemKeys[groupKey] || [];
        const selectedKeyLookup = new Set(selectedKeys);
        const hasItems = items.length > 0;
        const allSelected = hasItems && selectedKeys.length === items.length;

        return (
            <div
                className={`rounded-sm border transition-all ${
                    selectedKeys.length > 0
                        ? 'border-gold/30 bg-gold/[0.04] shadow-sm'
                        : 'border-primary/10 bg-white'
                }`}
            >
                <div className="flex flex-col gap-3 border-b border-primary/10 px-4 py-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <div className="text-[13px] font-bold text-primary">{options.title}</div>
                        <div className="mt-1 text-[11px] text-primary/55">{options.description}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                            selectedKeys.length > 0 ? 'bg-gold/10 text-gold' : 'bg-primary/5 text-primary/45'
                        }`}>
                            {selectedKeys.length}/{items.length} đã chọn
                        </span>
                        <button
                            type="button"
                            onClick={() => setBulkCopyGroupSelection(groupKey, true)}
                            disabled={!hasItems || allSelected}
                            className="rounded-sm border border-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Chọn tất cả
                        </button>
                        <button
                            type="button"
                            onClick={() => setBulkCopyGroupSelection(groupKey, false)}
                            disabled={selectedKeys.length === 0}
                            className="rounded-sm border border-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary transition-all hover:border-primary/25 hover:bg-primary/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Bỏ chọn tất cả
                        </button>
                    </div>
                </div>

                {hasItems ? (
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar divide-y divide-primary/8">
                        {items.map((item, index) => {
                            const isChecked = selectedKeyLookup.has(item.copy_key);
                            const primaryText = options.getPrimaryText(item, index);
                            const secondaryText = options.getSecondaryText(item, index);

                            return (
                                <label
                                    key={item.copy_key}
                                    className={`flex cursor-pointer gap-3 px-4 py-3 transition-colors ${
                                        isChecked ? 'bg-gold/[0.04]' : 'hover:bg-primary/[0.03]'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleBulkCopyItemSelection(groupKey, item.copy_key)}
                                        className="mt-0.5 h-4 w-4 rounded border-primary/30 text-amber-600 focus:ring-amber-500"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="break-words text-[13px] font-bold text-primary">{primaryText}</p>
                                                {secondaryText ? (
                                                    <p className="mt-1 break-words text-[11px] text-primary/55">{secondaryText}</p>
                                                ) : null}
                                            </div>
                                            <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-primary/30">
                                                #{index + 1}
                                            </span>
                                        </div>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-4 py-8 text-center text-[12px] text-stone/45">
                        {options.emptyText}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div ref={pageRootRef} className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-page-container { font-family: 'Roboto', sans-serif; display: flex; flex-direction: column; height: 100%; background-color: #F8FAFC; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-text-13 { font-size: 13px !important; color: #0F172A !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .sticky-col-0 { position: sticky; left: 0; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                .sticky-col-1 { position: sticky; left: 40px; z-index: 10; background: #FCFEFF; border-right: 1px solid #E2E8F0 !important; }
                .sticky-col-2 { position: sticky; left: 170px; z-index: 10; background: #FCFEFF; border-right: 2px solid #E2E8F0 !important; }
                tr.bg-primary\/5 .sticky-col-0, tr.bg-primary\/5 .sticky-col-1, tr.bg-primary\/5 .sticky-col-2 { background-color: #E2E8F0 !important; }
                .table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
                  /* Parent & Child Product Styles - Simplified */
                .row-root {
                    background-color: #FFFFFF !important;
                    position: relative;
                }
                .row-root:hover {
                    background-color: #FFFBF0 !important;
                }
                .row-root .sticky-col-0, .row-root .sticky-col-1, .row-root .sticky-col-2 {
                    background-color: white !important;
                }
                .row-root:hover .sticky-col-0, .row-root:hover .sticky-col-1, .row-root:hover .sticky-col-2 {
                    background-color: #FFFBF0 !important;
                }

                .row-parent { 
                    background-color: #FFFFFF !important;
                    position: relative;
                }
                .row-parent:hover {
                    background-color: #FFFBF0 !important; /* Light gold tint for hover */
                }
                .row-parent .sticky-col-0, .row-parent .sticky-col-1, .row-parent .sticky-col-2 { 
                    background-color: white !important; 
                }
                .row-parent:hover .sticky-col-0, .row-parent:hover .sticky-col-1, .row-parent:hover .sticky-col-2 { 
                    background-color: #FFFBF0 !important; 
                }
                
                .row-child { 
                    background-color: #eef2f7 !important;
                    position: relative;
                }
                .row-child:hover {
                    background-color: #e2e8f0 !important;
                }
                .row-child .sticky-col-0, .row-child .sticky-col-1, .row-child .sticky-col-2 { 
                    background-color: #eef2f7 !important;
                }
                .row-child:hover .sticky-col-0, .row-child:hover .sticky-col-1, .row-child:hover .sticky-col-2 { 
                    background-color: #e2e8f0 !important; 
                }
                
                /* Standard row hover fixes for sticky columns */
                tr:hover .sticky-col-0, tr:hover .sticky-col-1, tr:hover .sticky-col-2 {
                    background-color: #FFFBF0 !important;
                }
                tr.bg-gold\/10 .sticky-col-0, tr.bg-gold\/10 .sticky-col-1, tr.bg-gold\/10 .sticky-col-2 {
                    background-color: #fef3c7 !important;
                }
                
                .row-child .child-indent { 
                    padding-left: 48px !important;
                }
                
                .expand-btn {
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .expand-btn:hover {
                    background-color: #9C845A;
                    color: white;
                    transform: scale(1.1);
                }
                
                .row-empty-child {
                    background-color: #fff1f2 !important;
                }
                
                .quick-edit-input {
                    display: inline-block !important;
                    width: auto !important;
                    min-width: 80px !important;
                    max-width: 100px !important;
                    background: white !important;
                    border: 2px solid #9C845A !important;
                    border-radius: 4px !important;
                    padding: 2px 6px !important;
                    font-size: 13px !important;
                    font-weight: 800 !important;
                    color: #1B365D !important;
                    outline: none !important;
                }
                
                .quick-edit-btn {
                    padding: 4px;
                    border-radius: 4px;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                }
                .quick-edit-btn:hover {
                    background-color: rgba(156, 132, 90, 0.1);
                    color: #9C845A;
                }
                .quick-save-btn {
                    color: #059669;
                }
                .quick-save-btn:hover {
                    background-color: #ecfdf5;
                }
                .quick-cancel-btn {
                    color: #dc2626;
                }
                .quick-cancel-btn:hover {
                    background-color: #fef2f2;
                }

            `}</style>

            {notification && (
                <div className={`fixed top-6 right-6 z-[2000] p-4 rounded-md shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined">{notification.type === 'error' ? 'report' : 'check_circle'}</span>
                        <span className="font-bold">{notification.message}</span>
                    </div>
                    {notification.action === 'undo' && (
                        <button
                            onClick={handleUndoBulkUpdate}
                            className="bg-white text-primary border border-primary/20 hover:bg-primary hover:text-white px-3 py-1 rounded-sm text-[11px] font-black uppercase tracking-tighter transition-all shadow-sm"
                        >
                            Hoàn tác (Undo)
                        </button>
                    )}
                    <button onClick={() => setNotification(null)} className="ml-2 opacity-50 hover:opacity-100 flex items-center"><span className="material-symbols-outlined text-[18px]">close</span></button>
                </div>
            )}

            <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImportFileChange}
            />

            {showImportConfigModal && (
                <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4" onClick={closeImportConfigModal}>
                    <div
                        className="bg-white rounded w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-6 pt-6 pb-4 shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined">upload_file</span>
                                    Import Excel sản phẩm
                                </h2>
                                <p className="mt-2 text-[13px] text-primary/65">
                                    Chọn chế độ import và quyết định rõ những trường nào được phép cập nhật từ file Excel.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeImportConfigModal}
                                className="text-gray-500 hover:text-brick disabled:opacity-40"
                                disabled={isImportingExcel}
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 pr-5 custom-scrollbar space-y-4">
                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">File đã chọn</div>
                            <div className="mt-1 text-[13px] font-bold text-primary break-all">{pendingImportFile?.name || 'Chưa có file'}</div>
                        </div>

                        <div className="rounded-sm border border-primary/10 p-4">
                            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Preset tiện dùng</div>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-sm border border-primary/10 bg-primary/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[13px] font-bold text-primary">Nội dung web</div>
                                            <p className="mt-2 text-[12px] leading-5 text-primary/65">
                                                Chỉ cập nhật <strong>Mô tả</strong>, <strong>Thông số kỹ thuật</strong>, <strong>Meta title</strong> và <strong>Meta description</strong>,
                                                đồng thời bỏ qua dòng không khớp sản phẩm hiện có.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={applyContentOnlyImportPreset}
                                            className="shrink-0 rounded-sm border border-primary/20 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5"
                                        >
                                            Áp dụng
                                        </button>
                                    </div>
                                    <div className="mt-3 text-[12px] text-primary/70">
                                        Dùng khi import ngược từ local lên web chính. File nên giữ: <strong>SKU</strong>, <strong>Tên sản phẩm</strong>, <strong>Mô tả</strong>,
                                        <strong> Thông số kỹ thuật</strong>, <strong>Meta title</strong>, <strong>Meta description</strong>.
                                    </div>
                                </div>
                                <div className="rounded-sm border border-primary/10 bg-amber-50/70 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-[13px] font-bold text-primary">Dựng local</div>
                                            <p className="mt-2 text-[12px] leading-5 text-primary/65">
                                                Import đầy đủ cấu trúc sản phẩm, cho phép tạo mới nếu thiếu để local có đúng <strong>loại sản phẩm</strong>, <strong>biến thể</strong> và <strong>bundle/grouped</strong>.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={applyLocalStructureImportPreset}
                                            className="shrink-0 rounded-sm border border-primary/20 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5"
                                        >
                                            Áp dụng
                                        </button>
                                    </div>
                                    <div className="mt-3 text-[12px] text-primary/70">
                                        Dùng khi bạn muốn dựng dữ liệu web sang local để team biên tập nội dung ngay trên local.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {[
                                {
                                    value: 'replace_all',
                                    label: 'Import đầy đủ',
                                    description: 'Cập nhật toàn bộ các cột có dữ liệu trong file, giữ nguyên flow import hiện tại.',
                                },
                                {
                                    value: 'update_selected_fields',
                                    label: 'Cập nhật sản phẩm',
                                    description: 'Chỉ các trường được tick mới được cập nhật, các trường còn lại giữ nguyên.',
                                },
                            ].map((option) => {
                                const checked = importMode === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleImportModeChange(option.value)}
                                        className={`rounded-sm border px-4 py-4 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[14px] font-bold text-primary">{option.label}</div>
                                                <div className="mt-1 text-[12px] leading-5 text-primary/60">{option.description}</div>
                                            </div>
                                            <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                {checked ? 'check_circle' : 'radio_button_unchecked'}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="rounded-sm border border-primary/10 p-4">
                            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Sản phẩm chưa tồn tại</div>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                    {
                                        value: 'skip',
                                        label: 'Bỏ qua',
                                        description: 'Không tạo mới, chỉ log vào summary nếu dòng không khớp sản phẩm hiện có.',
                                    },
                                    {
                                        value: 'create',
                                        label: 'Tạo mới nếu thiếu',
                                        description: 'Cho phép tạo sản phẩm mới từ dòng Excel khi không tìm thấy sản phẩm cần cập nhật.',
                                    },
                                ].map((option) => {
                                    const checked = importMissingProductAction === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setImportMissingProductAction(option.value)}
                                            className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-[13px] font-bold text-primary">{option.label}</div>
                                                    <div className="mt-1 text-[12px] leading-5 text-primary/60">{option.description}</div>
                                                </div>
                                                <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                    {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {isSelectiveImport ? (
                            <>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleSelectAllImportFields}
                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                    >
                                        Chọn tất cả
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSelectImportBaseFields}
                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                    >
                                        Chọn trường cơ bản
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSelectImportAttributeFields}
                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                    >
                                        Chọn thuộc tính
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleClearImportFields}
                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-brick hover:bg-brick/5"
                                    >
                                        Bỏ chọn tất cả
                                    </button>
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-2 text-[12px] text-primary/65">
                                        Đang chọn <strong>{importUpdateFieldIds.length}</strong> trường:
                                        {' '}
                                        <strong>{selectedImportBaseFieldCount}</strong> cơ bản,
                                        {' '}
                                        <strong>{selectedImportAttributeCount}</strong> thuộc tính.
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-sm border border-primary/10 p-4">
                                        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between border-b border-primary/10 pb-3">
                                            <div>
                                                <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Trường cơ bản</div>
                                                <p className="mt-2 text-[12px] leading-5 text-primary/60">
                                                    Chọn các field chuẩn như mô tả, giá, SEO, thông số kỹ thuật, ảnh, biến thể hoặc bundle/grouped.
                                                </p>
                                            </div>
                                            <div className="text-[12px] text-primary/55">
                                                {selectedImportBaseFieldCount}/{IMPORT_BASE_FIELD_OPTIONS.length} đã chọn
                                            </div>
                                        </div>
                                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {IMPORT_BASE_FIELD_OPTIONS.map((option) => {
                                                const checked = importUpdateFieldIds.includes(option.id);
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        onClick={() => toggleImportUpdateField(option.id)}
                                                        className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="text-[13px] font-bold text-primary">{option.label}</div>
                                                                <div className="mt-1 text-[11px] leading-5 text-primary/55">{option.description}</div>
                                                                <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-primary/35">{option.id}</div>
                                                            </div>
                                                            <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                                {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="rounded-sm border border-primary/10 p-4">
                                        <div className="flex flex-col gap-3 border-b border-primary/10 pb-3">
                                            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                                                <div>
                                                    <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Thuộc tính có thể cập nhật</div>
                                                    <p className="mt-2 text-[12px] leading-5 text-primary/60">
                                                        Nếu file Excel có các cột thuộc tính riêng như bên xuất Excel, bạn có thể chọn đúng từng thuộc tính để chỉ cập nhật các cột đó.
                                                    </p>
                                                </div>
                                                <div className="text-[12px] text-primary/55">
                                                    {selectedImportAttributeCount}/{importAttributeFieldOptions.length} đã chọn
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                <div className="relative w-full md:max-w-sm">
                                                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                                    <input
                                                        type="text"
                                                        value={importAttributeSearch}
                                                        onChange={(event) => setImportAttributeSearch(event.target.value)}
                                                        placeholder="Tìm theo tên thuộc tính..."
                                                        className="w-full rounded-sm border border-primary/15 bg-white py-2 pl-10 pr-3 text-[13px] text-primary outline-none transition-all focus:border-primary/35 focus:ring-2 focus:ring-primary/10"
                                                    />
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleSelectImportAttributeFields}
                                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                                    >
                                                        Chọn hết thuộc tính
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleClearImportAttributeFields}
                                                        className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-brick hover:bg-brick/5"
                                                    >
                                                        Bỏ thuộc tính
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="rounded-sm bg-primary/[0.03] px-3 py-2 text-[12px] text-primary/65">
                                                Mẹo: nếu file dùng cột tổng <strong>Thuộc tính</strong> thì chọn field <strong>Thuộc tính</strong> ở phần trên. Nếu file có từng cột thuộc tính riêng, hãy tick đúng các thuộc tính bên dưới.
                                            </div>
                                        </div>
                                        <div className="mt-4 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                                            {filteredImportAttributeFieldOptions.length > 0 ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                    {filteredImportAttributeFieldOptions.map((option) => {
                                                        const checked = importUpdateFieldIds.includes(option.id);
                                                        return (
                                                            <button
                                                                key={option.id}
                                                                type="button"
                                                                onClick={() => toggleImportUpdateField(option.id)}
                                                                className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <div className="text-[13px] font-bold text-primary">{option.label}</div>
                                                                        <div className="mt-1 text-[11px] leading-5 text-primary/55">{option.description}</div>
                                                                        <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-primary/35">{option.id}</div>
                                                                    </div>
                                                                    <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                                        {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                                    </span>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] px-4 py-6 text-center text-[12px] text-primary/55">
                                                    {importAttributeFieldOptions.length === 0
                                                        ? 'Chưa có thuộc tính nào để chọn cập nhật.'
                                                        : 'Không tìm thấy thuộc tính nào khớp với từ khóa bạn vừa nhập.'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3 text-[13px] text-primary/70">
                                Hệ thống sẽ đọc toàn bộ cột có dữ liệu trong file để cập nhật sản phẩm hiện có hoặc tạo mới theo rule bạn vừa chọn.
                            </div>
                        )}
                        </div>

                        <div className="border-t border-primary/10 bg-white px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shrink-0">
                            <p className="text-[12px] text-primary/60">
                                Nhận diện sản phẩm theo SKU, đồng thời đối soát thêm ID, slug và link sản phẩm nếu file đang có sẵn các cột đó.
                            </p>
                            <div className="flex justify-end gap-3">
                                {canExportProducts && <button
                                    type="button"
                                    onClick={closeImportConfigModal}
                                    className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5"
                                    disabled={isImportingExcel}
                                >
                                    Hủy
                                </button>}
                                {(canCreateProducts || canUpdateProducts) && <button
                                    type="button"
                                    onClick={handleSubmitImportExcel}
                                    className="px-6 py-2 bg-primary text-white rounded-sm font-bold text-[13px] hover:bg-primary/90 flex items-center gap-2 disabled:opacity-60"
                                    disabled={isImportingExcel || !pendingImportFile || (isSelectiveImport && importUpdateFieldIds.length === 0)}
                                >
                                    {isImportingExcel ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">upload_file</span>}
                                    Bắt đầu import
                                </button>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showExportModal && (
                <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4" onClick={() => !isExportingExcel && setShowExportModal(false)}>
                    <div
                        className="bg-white rounded w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-6 pt-6 pb-4 shrink-0">
                            <div>
                                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined">download</span>
                                    Xuất sản phẩm ra Excel
                                </h2>
                                <p className="mt-2 text-[13px] text-primary/65">
                                    Chọn đúng các cột cần tải. Nếu cần dựng dữ liệu web sang local có cả biến thể và bundle/grouped, hãy dùng preset <strong>Dựng local</strong>.
                                    Nếu chỉ cần biên tập nội dung rồi import ngược lại web, hãy dùng preset <strong>Nội dung web</strong>.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => !isExportingExcel && setShowExportModal(false)}
                                className="text-gray-500 hover:text-brick disabled:opacity-40"
                                disabled={isExportingExcel}
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="sticky top-0 z-10 border-b border-primary/10 bg-white/95 backdrop-blur px-6 py-3 shrink-0">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <p className="text-[12px] text-primary/60">
                                    Đang chọn <strong>{exportColumnIds.length}</strong> cột để xuất.
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowExportModal(false)}
                                        className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5"
                                        disabled={isExportingExcel}
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDownloadExportExcel}
                                        className="px-6 py-2 bg-primary text-white rounded-sm font-bold text-[13px] hover:bg-primary/90 flex items-center gap-2"
                                        disabled={isExportingExcel}
                                    >
                                        {isExportingExcel ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">download</span>}
                                        Tải file Excel
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 pr-5 custom-scrollbar space-y-4">
                            <div className="rounded-sm border border-primary/10 p-4">
                                <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Preset tiện dùng</div>
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="rounded-sm border border-primary/10 bg-primary/[0.03] p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[13px] font-bold text-primary">Nội dung web</div>
                                                <p className="mt-2 text-[12px] leading-5 text-primary/65">
                                                    Xuất các cột phục vụ biên tập nội dung: <strong>SKU</strong>, <strong>Tên sản phẩm</strong>,
                                                    <strong> Tên biến thể / thành phần</strong>, <strong>Mô tả</strong>, <strong>Thông số kỹ thuật</strong>,
                                                    <strong> Meta title</strong> và <strong>Meta description</strong>.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={applyContentOnlyExportPreset}
                                                className="shrink-0 rounded-sm border border-primary/20 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5"
                                            >
                                                Chọn
                                            </button>
                                        </div>
                                    </div>
                                    <div className="rounded-sm border border-primary/10 bg-amber-50/70 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-[13px] font-bold text-primary">Dựng local</div>
                                                <p className="mt-2 text-[12px] leading-5 text-primary/65">
                                                    Xuất thêm <strong>Loại sản phẩm</strong>, <strong>Biến thể</strong>, <strong>Thành phần bundle/grouped</strong> và
                                                    <strong> Tiêu đề bundle</strong>, <strong>Meta title</strong>, <strong>Meta description</strong> để local dựng được đúng cấu trúc sản phẩm
                                                    và vẫn có đủ dữ liệu SEO để biên tập.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={applyLocalStructureExportPreset}
                                                className="shrink-0 rounded-sm border border-primary/20 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5"
                                            >
                                                Chọn
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={handleSelectAllExportColumns}
                                    className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                >
                                    Chọn tất cả
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExportColumnIds(DEFAULT_EXPORT_COLUMN_IDS.filter((id) => exportFieldOptions.some((option) => option.id === id)))}
                                    className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                >
                                    Chọn nhanh: Tên + Link
                                </button>
                                <button
                                    type="button"
                                    onClick={applyContentOnlyExportPreset}
                                    className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                >
                                    Chọn nhanh: Nội dung web
                                </button>
                                <button
                                    type="button"
                                    onClick={applyLocalStructureExportPreset}
                                    className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-primary hover:bg-primary/5"
                                >
                                    Chọn nhanh: Dựng local
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExportColumnIds([])}
                                    className="px-3 py-1.5 rounded-sm border border-primary/20 text-[12px] font-bold text-brick hover:bg-brick/5"
                                >
                                    Bỏ chọn hết
                                </button>
                            </div>

                            <div className="rounded-sm border border-primary/10 p-4">
                                <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Phạm vi xuất</div>
                                {selectedIds.length > 0 ? (
                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {[
                                            {
                                                value: 'selected',
                                                label: `Chỉ xuất ${selectedIds.length} sản phẩm đang chọn`,
                                                description: 'Chỉ lấy đúng các dòng bạn đang tick trong bảng sản phẩm.',
                                            },
                                            {
                                                value: 'all',
                                                label: 'Xuất toàn bộ sản phẩm',
                                                description: 'Bỏ qua danh sách đang tick và tải toàn bộ dữ liệu theo bộ lọc hiện tại.',
                                            },
                                        ].map((option) => {
                                            const checked = option.value === 'selected' ? exportOnlySelected : !exportOnlySelected;
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => setExportOnlySelected(option.value === 'selected')}
                                                    className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-[13px] font-bold text-primary">{option.label}</div>
                                                            <div className="mt-1 text-[12px] leading-5 text-primary/60">{option.description}</div>
                                                        </div>
                                                        <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                            {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="mt-3 text-[13px] text-primary/65">
                                        Chưa có sản phẩm nào được chọn, hệ thống sẽ xuất toàn bộ danh sách theo bộ lọc hiện tại.
                                    </p>
                                )}
                            </div>

                            <div className="rounded-sm border border-primary/10 p-4">
                                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between border-b border-primary/10 pb-3">
                                    <div>
                                        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Danh sách cột</div>
                                        <p className="mt-2 text-[12px] leading-5 text-primary/60">
                                            Cuộn trong khu vực này để duyệt nhanh toàn bộ cột. Các phần phía trên sẽ tự trôi đi để nhường không gian cho danh sách.
                                        </p>
                                    </div>
                                    <div className="text-[12px] text-primary/55">
                                        {exportFieldOptions.length} lựa chọn
                                    </div>
                                </div>

                                <div className="mt-4 min-h-[44vh] md:min-h-[52vh]">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {exportFieldOptions.map((option) => {
                                            const checked = exportColumnIds.includes(option.id);
                                            return (
                                                <button
                                                    key={option.id}
                                                    type="button"
                                                    onClick={() => toggleExportColumn(option.id)}
                                                    className={`rounded-sm border px-4 py-3 text-left transition-all ${checked ? 'border-primary bg-primary/[0.06] shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-[13px] font-bold text-primary">{option.label}</div>
                                                            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-primary/35">{option.id}</div>
                                                        </div>
                                                        <span className={`material-symbols-outlined text-[18px] ${checked ? 'text-primary' : 'text-primary/20'}`}>
                                                            {checked ? 'check_circle' : 'radio_button_unchecked'}
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {importExcelErrors.length > 0 && (
                <div className="fixed inset-0 z-[140] bg-black/60 flex items-center justify-center p-4" onClick={closeImportErrorModal}>
                    <div
                        className="bg-white rounded p-6 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-lg font-bold text-brick flex items-center gap-2">
                                    <span className="material-symbols-outlined">{importExcelResultTone === 'warning' ? 'warning' : 'error'}</span>
                                    {importExcelResultTone === 'warning' ? 'Import Excel hoàn tất với cảnh báo' : 'Import Excel thất bại'}
                                </h2>
                                <p className="mt-2 text-[13px] text-primary/65">{importExcelErrorMessage}</p>
                            </div>
                            <button type="button" onClick={closeImportErrorModal} className="text-gray-500 hover:text-brick">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                            {importExcelErrors.map((error, index) => (
                                <div key={`${error.row || 'row'}-${error.column || 'column'}-${index}`} className="rounded-sm border border-red-100 bg-red-50 px-4 py-3 text-[13px] text-red-800">
                                    <strong>DÃ²ng {error?.row || '-'}</strong>
                                    {error?.column ? ` - ${error.column}` : ''}
                                    : {error?.message || 'Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh.'}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                    <h1 className="admin-header-title italic">Quản lý sản phẩm</h1>
                    <AccountSelector user={user} />
                </div>

                <div className="bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex flex-wrap items-center gap-2">
                    <div className="flex gap-1 items-center">
                        {!isTrashView && canCreateProducts && (
                            <button
                                onClick={() => navigateToProductForm('/admin/products/new')}
                                className="bg-brick text-white px-3 h-9 flex items-center gap-2 hover:bg-umber transition-all rounded-sm shadow-sm font-bold text-[11px] uppercase tracking-wider shrink-0"
                                title="Thêm sản phẩm mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                <span className="hidden sm:inline">Tạo mới</span>
                            </button>
                        )}
                        <button onClick={handleRefresh} disabled={loading} className="p-1.5 border border-primary/10 bg-white text-primary rounded-sm w-9 h-9 hover:bg-primary/5 transition-all" title="Tải lại dữ liệu"><span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span></button>
                        <button data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`p-1.5 border rounded-sm w-9 h-9 ${showColumnSettings ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/30 hover:bg-primary/5'}`} title="Cấu hình hiển thị cột"><span className="material-symbols-outlined text-[18px]">settings_suggest</span></button>
                        {canUpdateProducts && <button onClick={handleOpenProductSortModal} className={`p-1.5 border rounded-sm w-9 h-9 ${showProductSortModal ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-primary border-primary/30 hover:bg-primary/5'}`} title="Sắp xếp thứ tự sản phẩm">
                            <span className="material-symbols-outlined text-[18px]">swap_vert</span>
                        </button>}
                        <button
                            data-filter-btn 
                            onClick={() => {
                                if (!showAdvanced) setTempFilters(sanitizeProductFilters(filters, allAttributes));
                                setShowAdvanced(!showAdvanced);
                            }}
                            className={`p-1.5 border transition-all rounded-sm w-9 h-9 ${showAdvanced ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary border-primary/20 hover:bg-primary/5'}`}
                            title="Bộ lọc nâng cao"
                        >
                            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                        </button>

                        {!isTrashView && (
                            <React.Fragment>
                                <button
                                    onClick={openExportModal}
                                    className="p-1.5 border border-primary/20 bg-white text-primary rounded-sm w-9 h-9 hover:bg-primary/5 transition-all"
                                    title="Xuất Excel"
                                >
                                    <span className="material-symbols-outlined text-[18px]">download</span>
                                </button>
                                <button
                                    onClick={handleOpenImportPicker}
                                    disabled={isImportingExcel}
                                    className={`p-1.5 border border-primary/20 bg-white text-primary rounded-sm w-9 h-9 hover:bg-primary/5 transition-all ${isImportingExcel ? 'opacity-70' : ''}`}
                                    title="Nhập Excel"
                                >
                                    <span className={`material-symbols-outlined text-[18px] ${isImportingExcel ? 'animate-refresh-spin' : ''}`}>
                                        upload_file
                                    </span>
                                </button>
                            </React.Fragment>
                        )}
                        
                        <div className="h-6 w-px bg-primary/20 mx-1"></div>

                        {/* Nhóm thao tác hàng loạt */}
                        <div className="flex gap-1 items-center border-primary/10 pr-1">
                            <button
                                type="button"
                                disabled={selectedIds.length === 0 || isTrashView || syncingGoogleMerchant || !canUpdateProducts}
                                onClick={handleSyncSelectedGoogleMerchant}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center ${
                                    selectedIds.length > 0 && !isTrashView && !syncingGoogleMerchant && canUpdateProducts
                                        ? 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white shadow-sm'
                                        : 'bg-slate-100 text-primary/30 cursor-not-allowed opacity-50 grayscale'
                                }`}
                                title="Đồng bộ Google Merchant các sản phẩm đã chọn"
                                aria-label="Đồng bộ Google Merchant các sản phẩm đã chọn"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${syncingGoogleMerchant ? 'animate-refresh-spin' : ''}`}>cloud_sync</span>
                            </button>
                            <button
                                type="button"
                                disabled={selectedIds.length === 0 || isTrashView || !canUpdateProducts}
                                onClick={() => openQuickEditModal(selectedIds)}
                                data-quick-edit-trigger="bulk"
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center ${
                                    selectedIds.length > 0 && !isTrashView && canUpdateProducts
                                        ? 'bg-sky-50 text-sky-700 hover:bg-sky-600 hover:text-white shadow-sm'
                                        : 'bg-slate-100 text-primary/30 cursor-not-allowed opacity-50 grayscale'
                                }`}
                                title="Sửa nhanh các sản phẩm đã chọn"
                                aria-label="Sửa nhanh các sản phẩm đã chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">flash_on</span>
                            </button>
                            <button
                                type="button"
                                disabled={selectedIds.length === 0 || isTrashView || !aiAvailable || !canUpdateProducts}
                                onClick={() => {
                                    const token = `seo-${Date.now()}`;
                                    setBulkSeoAutoStartToken(token);
                                    setShowBulkSeoModal(true);
                                }}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center ${
                                    selectedIds.length > 0 && !isTrashView && aiAvailable && canUpdateProducts
                                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white shadow-sm'
                                        : 'bg-slate-100 text-primary/30 cursor-not-allowed opacity-50 grayscale'
                                }`}
                                title={!aiAvailable ? disabledReason : 'Tạo SEO AI hàng loạt (Background Worker)'}
                                aria-label="Tạo SEO AI cho các sản phẩm đã chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                            </button>
                            <button
                                type="button"
                                disabled={selectedIds.length === 0 || isTrashView || !aiAvailable || !canUpdateProducts || generatingAiReviews}
                                onClick={(event) => handleRegenerateAiReviews(selectedIds, event)}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all flex items-center justify-center ${
                                    selectedIds.length > 0 && !isTrashView && aiAvailable && canUpdateProducts && !generatingAiReviews
                                        ? 'bg-cyan-50 text-cyan-700 hover:bg-cyan-600 hover:text-white shadow-sm'
                                        : 'bg-slate-100 text-primary/30 cursor-not-allowed opacity-50 grayscale'
                                }`}
                                title={!aiAvailable ? disabledReason : 'Tạo lại review AI cho các sản phẩm đã chọn'}
                                aria-label="Tạo lại review AI cho các sản phẩm đã chọn"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${generatingAiReviews ? 'animate-refresh-spin' : ''}`}>
                                    {generatingAiReviews ? 'progress_activity' : 'rate_review'}
                                </span>
                            </button>
                            <button
                                disabled={selectedIds.length === 0 || !canCreateProducts}
                                onClick={requestBulkDuplicate}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 && canCreateProducts ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title="Nhân bản các mục đã chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                            </button>
                            <button
                                disabled={selectedIds.length === 0 || isTrashView || !canUpdateProducts}
                                onClick={() => setShowBulkUpdateModal(true)}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 && !isTrashView && canUpdateProducts ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title="Cập nhật thuộc tính hàng loạt"
                            >
                                <span className="material-symbols-outlined text-[18px]">tune</span>
                            </button>
                            {SHOW_BULK_COPY_ACTION && (
                                <button
                                    disabled={selectedIds.length === 0 || isTrashView || !canUpdateProducts}
                                    onClick={() => setShowBulkCopyModal(true)}
                                    className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 && !isTrashView && canUpdateProducts ? 'bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                    title="Sao chép 2 mục từ 1 sản phẩm nguồn sang các sản phẩm đã chọn"
                                >
                                    <span className="material-symbols-outlined text-[18px]">conversion_path</span>
                                </button>
                            )}
                            {!isTrashView && canUpdateProducts && (
                                <button
                                    type="button"
                                    onClick={handleOpenCategoryImageManager}
                                    className="p-1.5 rounded-sm w-9 h-9 transition-all bg-amber-50 text-amber-700 shadow-sm hover:bg-amber-600 hover:text-white"
                                    title={selectedIds.length > 0
                                        ? `Quản lí ảnh cho ${selectedIds.length} sản phẩm đã chọn`
                                        : 'Quản lí ảnh cho toàn bộ sản phẩm theo bộ lọc hiện tại'}
                                    aria-label={selectedIds.length > 0
                                        ? `Quản lí ảnh cho ${selectedIds.length} sản phẩm đã chọn`
                                        : 'Quản lí ảnh cho toàn bộ sản phẩm theo bộ lọc hiện tại'}
                                >
                                    <span className="material-symbols-outlined text-[18px]">photo_library</span>
                                </button>
                            )}
                            {!isTrashView && canUpdateProducts && SHOW_BULK_IMAGE_APPEND_ACTION && (
                                <button
                                    type="button"
                                    onClick={() => setShowBulkImageAppendModal(true)}
                                    className="p-1.5 rounded-sm w-9 h-9 bg-primary/10 text-primary shadow-sm transition-all hover:bg-primary hover:text-white"
                                    title="ThÃªm áº£nh hÃ ng loáº¡t"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                                </button>
                            )}
                            {!isTrashView && canUpdateProducts && (
                                <button
                                    type="button"
                                    onClick={() => setShowBulkImageRefreshModal(true)}
                                    className="p-1.5 rounded-sm w-9 h-9 bg-sky-50 text-sky-700 shadow-sm transition-all hover:bg-sky-600 hover:text-white"
                                    title="Cập nhật lại ảnh theo tên file"
                                >
                                    <span className="material-symbols-outlined text-[18px]">imagesmode</span>
                                </button>
                            )}
                            <button
                                disabled={selectedIds.length === 0 || (isTrashView ? !canUpdateProducts : !canDeleteProducts)}
                                onClick={isTrashView ? handleBulkRestore : handleBulkDelete}
                                className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 && (isTrashView ? canUpdateProducts : canDeleteProducts) ? (isTrashView ? 'bg-green-600/10 text-green-600 hover:bg-green-600 hover:text-white shadow-sm' : 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm') : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                title={isTrashView ? "Khôi phục đã chọn" : "Xóa các mục đã chọn"}
                            >
                                <span className="material-symbols-outlined text-[18px]">{isTrashView ? 'restore_from_trash' : 'delete_sweep'}</span>
                            </button>
                            {isTrashView && canDeleteProductsPermanently && (
                                <button
                                    disabled={selectedIds.length === 0}
                                    onClick={handleBulkDelete}
                                    className={`p-1.5 rounded-sm w-9 h-9 transition-all ${selectedIds.length > 0 ? 'bg-brick/10 text-brick hover:bg-brick hover:text-white shadow-sm' : 'text-primary/30 cursor-not-allowed opacity-50 grayscale'}`}
                                    title="Xóa vĩnh viễn đã chọn"
                                >
                                    <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                                </button>
                            )}
                            {selectedIds.length > 0 && (
                                <div className="flex items-center gap-1 ml-1 pl-2 border-l border-primary/10">
                                    <button
                                        type="button"
                                        onClick={handleToggleSelectedOnly}
                                        className={`bg-transparent p-0 text-[11px] font-bold whitespace-nowrap transition-colors ${showSelectedOnly ? 'text-primary' : 'text-primary/40 hover:text-primary'}`}
                                        title={showSelectedOnly ? 'Tắt chế độ chỉ xem sản phẩm đã chọn' : 'Chỉ hiển thị các sản phẩm đang chọn'}
                                        aria-pressed={showSelectedOnly}
                                    >
                                        {selectedIds.length} chọn
                                    </button>
                                    {false && (
                                    <span className="text-[11px] font-bold text-primary/40 whitespace-nowrap">{selectedIds.length} chọn</span>
                                    )}
                                    {bulkSeoGenerating && (
                                        <span className="text-[11px] font-bold text-emerald-700 whitespace-nowrap">
                                            AI {bulkSeoProgress.current}/{bulkSeoProgress.total}
                                        </span>
                                    )}
                                    {generatingAiReviews && (
                                        <span className="text-[11px] font-bold text-cyan-700 whitespace-nowrap">
                                            Review AI {aiReviewProgress.current}/{aiReviewProgress.total}
                                            {aiReviewProgress.failed > 0 ? `, lỗi ${aiReviewProgress.failed}` : ''}
                                        </span>
                                    )}
                                    <button onClick={handleClearSelectedProducts} className="p-1 text-primary/40 hover:text-brick" title="Hủy chọn"><span className="material-symbols-outlined text-[16px]">close</span></button>
                                </div>
                            )}
                        </div>

                        <div className="h-6 w-px bg-primary/20 mx-1"></div>

                        <button
                            onClick={() => setIsTrashView(!isTrashView)}
                            className={`p-1.5 border rounded-sm w-9 h-9 transition-all relative ${isTrashView ? 'bg-primary text-white border-primary shadow-inner' : 'bg-white text-primary/60 border border-primary/20 hover:text-primary hover:border-primary'}`}
                            title={isTrashView ? "Quay lại sản phẩm hiện có" : "Xem sản phẩm đã xóa"}
                        >
                            <span className="material-symbols-outlined text-[18px]">{isTrashView ? 'arrow_back' : 'delete'}</span>
                        </button>
                    </div>

                    <div className="flex-1 relative" ref={searchContainerRef}>
                        <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-primary/40 text-[16px] pointer-events-none z-10">search</span>
                        <input
                            type="text"
                            name="search"
                            autoComplete="off"
                            placeholder="Tìm nhanh sản phẩm theo SKU / tên / mã NCC..."
                            className="w-full bg-primary/5 border border-primary/10 px-8 py-1.5 rounded-sm text-[14px] focus:outline-none focus:border-primary/30 transition-all relative z-0"
                            value={filters.search}
                            onChange={handleFilterChange}
                            onFocus={() => setShowSearchHistory(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setShowSearchHistory(false);
                                    fetchProducts(1);
                                    addToSearchHistory(filters.search);
                                }
                            }}
                        />
                        {filters.search && (
                            <button onClick={() => { setFilters(prev => ({ ...prev, search: '' })); setShowSearchHistory(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors">
                                <span className="material-symbols-outlined text-[16px]">cancel</span>
                            </button>
                        )}

                        {showSearchHistory && searchHistory.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[60] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1">
                                    <span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span>
                                    <button onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }} className="text-[10px] text-brick hover:underline font-bold">Xóa tất cả</button>
                                </div>
                                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                    {searchHistory.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors"
                                            onClick={() => {
                                                setFilters(prev => ({ ...prev, search: item }));
                                                setShowSearchHistory(false);
                                                // Fetch will be triggered by useEffect
                                            }}
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                <span className="text-[13px] text-[#0F172A] truncate font-medium">{item}</span>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const updated = searchHistory.filter(h => h !== item);
                                                    setSearchHistory(updated);
                                                    localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showAdvanced && tempFilters && (
                <div ref={filterRef} className="bg-white border border-primary/20 p-5 shadow-2xl mb-4 rounded-sm animate-in slide-in-from-top-4 duration-300 relative z-50 text-[#0F172A]">
                    <div className="flex justify-between items-center mb-6 pb-3 border-b border-primary/10">
                        <h4 className="font-bold text-primary flex items-center gap-2 text-[15px]"><span className="material-symbols-outlined text-[20px]">tune</span> Cấu hình bộ lọc sản phẩm</h4>
                        <div className="flex gap-4">
                            <button onClick={() => setTempFilters((prev) => ({ ...getDefaultProductFilters(), search: prev?.search || '' }))} className="text-[13px] font-bold text-primary/40 hover:text-brick transition-colors">Thiết lập lại</button>
                            <button onClick={applyFilters} className="bg-primary text-white px-8 py-2 rounded-sm font-bold text-[13px] hover:bg-primary/90 shadow-md transform active:scale-95 transition-all">Áp dụng bộ lọc</button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 border-t border-l border-primary/10 rounded-sm mb-6 bg-primary/[0.02]">
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Danh mục</label>
                            <div className="relative" data-attr-dropdown>
                                <button
                                    onClick={() => setOpenAttrId(openAttrId === 'category' ? null : 'category')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'category' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.category_id || []).length > 0 
                                            ? `Danh mục: ${(tempFilters.category_id || []).length}` 
                                            : `Chọn danh mục...`}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'category' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'category' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({
                                                            ...prev,
                                                            category_id: ['uncategorized', ...categories.map(c => String(c.id))]
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({ ...prev, category_id: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            <label className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={(tempFilters.category_id || []).includes('uncategorized')}
                                                    onChange={() => handleTempMultiSelectChange('category_id', 'uncategorized')}
                                                    className="w-4 h-4 accent-primary"
                                                />
                                                <span className={`text-[13px] ${(tempFilters.category_id || []).includes('uncategorized') ? 'font-bold text-primary' : 'text-stone-600'}`}>Chưa gắn danh mục</span>
                                            </label>
                                            {categories.map(c => (
                                                <label key={c.id} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={(tempFilters.category_id || []).includes(String(c.id))}
                                                        onChange={() => handleTempMultiSelectChange('category_id', String(c.id))}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.category_id || []).includes(String(c.id)) ? 'font-bold text-primary' : 'text-stone-600'}`}>{c.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Số lượng danh mục</label>
                            <select
                                name="category_count_filter"
                                value={tempFilters.category_count_filter || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary"
                            >
                                <option value="">Tất cả</option>
                                {CATEGORY_COUNT_FILTER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Loại sản phẩm</label>
                            <div className="relative" data-attr-dropdown>
                                <button
                                    onClick={() => setOpenAttrId(openAttrId === 'type' ? null : 'type')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'type' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.type || []).length > 0 
                                            ? `Loại: ${(tempFilters.type || []).length}` 
                                            : `Chọn loại...`}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'type' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'type' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({
                                                            ...prev,
                                                            type: ACTIVE_PRODUCT_TYPE_KEYS
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters(prev => ({ ...prev, type: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            {ACTIVE_PRODUCT_TYPE_OPTIONS.map((option) => (
                                                <label key={option.value} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={(tempFilters.type || []).includes(option.value)}
                                                        onChange={() => handleTempMultiSelectChange('type', option.value)}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.type || []).includes(option.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>{option.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Nhà cung cấp</label>
                            <div className="relative" data-attr-dropdown>
                                <button
                                    onClick={() => setOpenAttrId(openAttrId === 'supplier' ? null : 'supplier')}
                                    className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === 'supplier' ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                >
                                    <span className="truncate text-[13px] font-bold text-primary">
                                        {(tempFilters.supplier_ids || []).length > 0
                                            ? `NCC: ${(tempFilters.supplier_ids || []).length}`
                                            : 'Chọn nhà cung cấp...'}
                                    </span>
                                    <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === 'supplier' ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>

                                {openAttrId === 'supplier' && (
                                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[220px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                            <div className="flex border-b border-primary/5 mb-1 px-1 gap-1">
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-primary hover:bg-primary/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters((prev) => ({
                                                            ...prev,
                                                            supplier_ids: suppliers.map((supplier) => String(supplier.id)),
                                                        }));
                                                    }}
                                                >Chọn tất cả</button>
                                                <button
                                                    className="flex-1 py-1.5 text-[10px] font-black text-brick hover:bg-brick/5 uppercase tracking-widest"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setTempFilters((prev) => ({ ...prev, supplier_ids: [] }));
                                                    }}
                                                >Xóa hết</button>
                                            </div>
                                            <label className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={(tempFilters.supplier_ids || []).includes('unassigned')}
                                                    onChange={() => handleTempMultiSelectChange('supplier_ids', 'unassigned')}
                                                    className="w-4 h-4 accent-primary"
                                                />
                                                <span className={`text-[13px] ${(tempFilters.supplier_ids || []).includes('unassigned') ? 'font-bold text-primary' : 'text-stone-600'}`}>Chưa gắn nhà cung cấp</span>
                                            </label>
                                            {suppliers.map((supplier) => (
                                                <label key={supplier.id} className="px-3 py-2 hover:bg-primary/5 cursor-pointer flex items-center gap-3 transition-colors select-none" onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={(tempFilters.supplier_ids || []).includes(String(supplier.id))}
                                                        onChange={() => handleTempMultiSelectChange('supplier_ids', String(supplier.id))}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <span className={`text-[13px] ${(tempFilters.supplier_ids || []).includes(String(supplier.id)) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                        {supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Đơn vị tính</label>
                            <select
                                name="inventory_unit_filter"
                                value={tempFilters.inventory_unit_filter || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả đơn vị tính</option>
                                <option value={INVENTORY_UNIT_FILTER_ASSIGNED}>Đã có ĐVT</option>
                                <option value={INVENTORY_UNIT_FILTER_UNASSIGNED}>Chưa gán ĐVT</option>
                                {inventoryUnits.map((unit) => (
                                    <option key={unit.id} value={String(unit.id)}>
                                        {unit.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Giá nhập</label>
                            <select
                                name="missing_purchase_price"
                                value={tempFilters.missing_purchase_price || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả trạng thái giá nhập</option>
                                <option value="1">Chưa có giá nhập</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Nguồn nhập</label>
                            <select
                                name="multiple_suppliers"
                                value={tempFilters.multiple_suppliers || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả sản phẩm</option>
                                <option value="1">Có nhiều nhà cung cấp</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Anh san pham</label>
                            <select
                                name="has_images"
                                value={tempFilters.has_images || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tat ca trang thai anh</option>
                                <option value="1">Da co anh</option>
                                <option value="0">Chua co anh</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Nội dung chuẩn SEO</label>
                            <select
                                name="has_seo"
                                value={tempFilters.has_seo || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả trạng thái SEO</option>
                                <option value="1">Đã có Meta Description</option>
                                <option value="0">Chưa có Meta Description</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Mô tả sản phẩm</label>
                            <select
                                name="has_description"
                                value={tempFilters.has_description || ''}
                                onChange={handleTempFilterChange}
                                className="w-full h-10 bg-white border border-primary/20 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary shadow-sm"
                            >
                                <option value="">Tất cả trạng thái mô tả</option>
                                <option value="1">Đã có mô tả</option>
                                <option value="0">Chưa có mô tả</option>
                            </select>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Tồn kho</label>
                            <div className="flex items-center gap-2 h-10">
                                <input type="number" name="min_stock" placeholder="Từ" className="w-1/2 h-full bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.min_stock} onChange={handleTempFilterChange} />
                                <span className="text-primary/30 font-bold">-</span>
                                <input type="number" name="max_stock" placeholder="Đến" className="w-1/2 h-full bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary" value={tempFilters.max_stock} onChange={handleTempFilterChange} />
                            </div>
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày tạo (Từ)</label>
                            <input type="date" name="start_date" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.start_date} onChange={handleTempFilterChange} />
                        </div>
                        <div className="p-4 border-r border-b border-primary/10 space-y-1.5">
                            <label className="text-[13px] font-medium text-stone-600">Ngày tạo (Đến)</label>
                            <input type="date" name="end_date" className="w-full h-10 bg-white border border-primary/10 rounded-sm px-3 text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-primary cursor-pointer" value={tempFilters.end_date} onChange={handleTempFilterChange} />
                        </div>
                    </div>

                    {allAttributes.filter(a => a.is_filterable_backend).length > 0 && (
                        <div className="mt-8 pt-6 border-t border-primary/10">
                            <h5 className="text-[15px] font-bold text-[#111] mb-4">Lọc theo thuộc tính</h5>
                            <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 border-t border-l border-primary/10 rounded-sm bg-primary/[0.02]">
                                {allAttributes.filter(a => a.is_filterable_backend).map((attr) => (
                                    <div key={attr.id} className="p-4 space-y-2.5 border-r border-b border-primary/10 relative">
                                        <label className="text-[11px] font-bold text-stone-500 uppercase tracking-[0.15em]">{attr.name}</label>
                                        <div className="relative" data-attr-dropdown>
                                            <button
                                                onClick={() => setOpenAttrId(openAttrId === attr.id ? null : attr.id)}
                                                className={`w-full h-10 bg-white border rounded-sm px-3 pr-8 flex items-center transition-all ${openAttrId === attr.id ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 hover:border-primary/40 shadow-sm'}`}
                                            >
                                                <span className="truncate text-[13px] font-bold text-primary">
                                                    {(tempFilters.attributes[attr.id] || []).length > 0 
                                                        ? `${attr.name}: ${(tempFilters.attributes[attr.id] || []).length}` 
                                                        : `Chọn ${attr.name}...`}
                                                </span>
                                                <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform duration-300 ${openAttrId === attr.id ? 'rotate-180' : ''}`}>
                                                    expand_more
                                                </span>
                                            </button>

                                            {openAttrId === attr.id && (
                                                <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-primary/30 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] z-[1001] rounded-sm py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                        {(tempFilters.attributes[attr.id] || []).length > 0 && (
                                                            <button
                                                                className="w-full px-3 py-2 text-left text-[11px] font-black text-brick hover:bg-brick/5 border-b border-primary/5 mb-1 uppercase tracking-widest flex items-center gap-2"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setTempFilters(prev => ({
                                                                        ...prev,
                                                                        attributes: { ...prev.attributes, [attr.id]: [] }
                                                                    }));
                                                                }}
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">backspace</span>
                                                                Xóa các mục đã chọn
                                                            </button>
                                                        )}
                                                        {attr.options?.length > 0 ? (
                                                            attr.options.map(opt => (
                                                                <label 
                                                                    key={opt.id}
                                                                    className="px-3 py-2.5 hover:bg-primary/5 cursor-pointer flex items-center gap-3 group transition-colors select-none"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <div className="relative flex items-center">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={(tempFilters.attributes[attr.id] || []).includes(opt.value)}
                                                                            onChange={() => handleTempAttributeFilterChange(attr.id, opt.value)}
                                                                            className="w-4 h-4 accent-primary cursor-pointer rounded-sm border-2 border-primary/20"
                                                                        />
                                                                    </div>
                                                                    <span className={`text-[13px] transition-all ${(tempFilters.attributes[attr.id] || []).includes(opt.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>
                                                                        {opt.value}
                                                                    </span>
                                                                </label>
                                                            ))
                                                        ) : (
                                                            <div className="px-4 py-6 text-center text-stone-400 italic text-[12px]">Không có dữ liệu</div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Hiển thị các chip điều kiện đang lọc */}
            {(
                (filters.category_id || []).length > 0
                || Boolean(filters.category_count_filter)
                || (filters.type || []).length > 0
                || (filters.supplier_ids || []).length > 0
                || Boolean(filters.inventory_unit_filter)
                || Boolean(filters.missing_purchase_price)
                || Boolean(filters.multiple_suppliers)
                || filters.has_images === '0'
                || filters.has_images === '1'
                || filters.has_seo === '0'
                || filters.has_seo === '1'
                || filters.has_description === '0'
                || filters.has_description === '1'
                || Boolean(filters.min_stock)
                || Boolean(filters.max_stock)
                || Boolean(filters.start_date)
                || Boolean(filters.end_date)
                || Object.values(filters.attributes || {}).some(arr => arr.length > 0)
            ) && (
                <div className="flex flex-wrap items-center gap-2 mb-4 bg-primary/5 p-2 border border-primary/10 rounded-sm animate-in fade-in duration-300">
                    <span className="text-[13px] font-bold text-primary px-1 mr-1 border-r border-primary/20">Bộ lọc đang hoạt động:</span>
                    
                    {filters.category_id && Array.isArray(filters.category_id) && filters.category_id.length > 0 && filters.category_id.map(id => (
                        <div key={id} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Danh mục:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{id === 'uncategorized' ? 'Chưa gắn danh mục' : categories.find(c => String(c.id) === String(id))?.name}</span>
                            <button onClick={() => removeFilter('category_id', id)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}
                    
                    {filters.category_count_filter && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">SL danh mục:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{getCategoryCountFilterLabel(filters.category_count_filter)}</span>
                            <button onClick={() => removeFilter('category_count_filter')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {filters.type && Array.isArray(filters.type) && filters.type.length > 0 && filters.type.map(t => (
                        <div key={t} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Loại:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{TYPE_LABELS[t]?.label || t}</span>
                            <button onClick={() => removeFilter('type', t)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}

                    {filters.supplier_ids && Array.isArray(filters.supplier_ids) && filters.supplier_ids.length > 0 && filters.supplier_ids.map((supplierId) => (
                        <div key={supplierId} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">NCC:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{getSupplierFilterLabel(suppliers, supplierId)}</span>
                            <button onClick={() => removeFilter('supplier_ids', supplierId)} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    ))}

                    {filters.inventory_unit_filter && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">ĐVT:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{getInventoryUnitFilterLabel(inventoryUnits, filters.inventory_unit_filter)}</span>
                            <button onClick={() => removeFilter('inventory_unit_filter')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {filters.missing_purchase_price && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Giá nhập:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">Chưa có giá nhập</span>
                            <button onClick={() => removeFilter('missing_purchase_price')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {filters.multiple_suppliers && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Nguồn nhập:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">Có nhiều nhà cung cấp</span>
                            <button onClick={() => removeFilter('multiple_suppliers')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.has_images === '0' || filters.has_images === '1') && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ảnh:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.has_images === '1' ? 'Đã có ảnh' : 'Chưa có ảnh'}</span>
                            <button onClick={() => removeFilter('has_images')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.has_seo === '0' || filters.has_seo === '1') && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">SEO:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.has_seo === '1' ? 'Đã có SEO' : 'Chưa có SEO'}</span>
                            <button onClick={() => removeFilter('has_seo')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.has_description === '0' || filters.has_description === '1') && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Mô tả:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.has_description === '1' ? 'Đã có mô tả' : 'Chưa có mô tả'}</span>
                            <button onClick={() => removeFilter('has_description')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.min_stock || filters.max_stock) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Kho:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.min_stock || 0} → {filters.max_stock || '∞'}</span>
                            <button onClick={() => removeFilter('stock')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {(filters.start_date || filters.end_date) && (
                        <div className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                            <span className="text-[11px] text-primary/40">Ngày tạo:</span>
                            <span className="text-[13px] font-bold text-[#0F172A]">{filters.start_date || '...'} → {filters.end_date || '...'}</span>
                            <button onClick={() => removeFilter('date')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        </div>
                    )}

                    {Object.entries(filters.attributes).map(([attrId, vals]) => 
                        vals.map(val => (
                            <div key={`${attrId}-${val}`} className="bg-white border border-primary/30 px-2 py-1 rounded-sm flex items-center gap-2 shadow-sm">
                                <span className="text-[11px] text-primary/40">{allAttributes.find(a => String(a.id) === String(attrId))?.name}:</span>
                                <span className="text-[13px] font-bold text-[#0F172A]">{val}</span>
                                <button onClick={() => removeFilter('attributes', { attrId, val })} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button>
                            </div>
                        ))
                    )}

                    <button onClick={handleReset} className="ml-auto text-[13px] font-bold text-brick hover:underline px-2 pr-1 border-primary/20">Xóa tất cả bộ lọc</button>
                </div>
            )}

            {showColumnSettings && (
                <div ref={columnSettingsRef}>
                    <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="product_list" />
                </div>
            )}

            <ProductSortModal
                open={showProductSortModal}
                onClose={handleCloseProductSortModal}
                products={productSortItems}
                isLoading={isProductSortLoading}
                isSaving={isProductSortSaving}
                isDirty={isProductSortDirty}
                onSortAlphabetically={handleSortProductsAlphabetically}
                onMoveUp={handleMoveProductSortUp}
                onMoveDown={handleMoveProductSortDown}
                onMoveToPosition={handleMoveProductSortToPosition}
                onRefresh={handleRefreshProductSort}
                onReset={handleResetProductSort}
                onSave={handleSaveProductSort}
                editLinkState={buildProductFormLocationState()}
            />

            <div ref={tableScrollRef} className="flex-1 bg-white border border-primary/10 shadow-xl overflow-auto table-scrollbar relative rounded-md">
                <table className="text-left border-collapse table-fixed min-w-full admin-text-13" style={{ width: `${totalTableWidth}px` }}>
                    <thead className="admin-table-header sticky top-0 z-20 shadow-sm border-b border-primary/10">
                        <tr>
                            <th className="p-3 w-10 admin-table-header border border-primary/20 sticky-col-0"><input type="checkbox" checked={areAllVisibleProductsSelected} onChange={toggleSelectAll} className="size-4 accent-primary" /></th>
                            {renderedColumns.map((col, idx) => (
                                <th
                                    key={col.id}
                                    draggable={col.id !== 'actions'}
                                    onDragStart={(e) => handleHeaderDragStart(e, idx)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => handleHeaderDrop(e, idx)}
                                    onDoubleClick={isSortableColumn(col) ? () => handleSort(col.id) : undefined}
                                    className={`px-3 py-2.5 border border-primary/10 cursor-move hover:bg-primary/5 relative group ${col.id === 'sku' ? 'sticky-col-1' : col.id === 'name' ? 'sticky-col-2' : ''}`}
                                    style={{ width: columnWidths[col.id] || col.minWidth }}
                                    title={isSortableColumn(col) ? 'Nhấp đúp để sắp xếp' : undefined}
                                >
                                    <div className={`flex items-center gap-1.5 ${col.align === 'center' ? 'justify-center' : col.align === 'right' ? 'justify-end' : ''}`}>
                                        {col.id !== 'actions' && <span className="material-symbols-outlined text-[14px] opacity-20 group-hover:opacity-100 text-primary">drag_indicator</span>}
                                        <span className="truncate text-primary font-black">{col.label}</span>
                                        {isSortableColumn(col) ? (
                                            <SortIndicator colId={getSortKeyForColumn(col)} sortConfig={sortConfig} />
                                        ) : null}
                                    </div>
                                    {col.id !== 'actions' && <div onMouseDown={(e) => handleColumnResize(col.id, e)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/20 transition-colors" />}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {products.length === 0 ? (
                            <tr>
                                <td colSpan={renderedColumns.length + 1} className="p-12 text-center">
                                    <div className="flex flex-col items-center gap-2 text-primary/40">
                                        <span className="material-symbols-outlined text-[48px]">inventory_2</span>
                                        <p className="font-bold text-[15px]">Không tìm thấy sản phẩm nào</p>
                                        <p className="text-[13px]">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            products.map(product => {
                                const isParent = product.type === 'configurable' || product.type === 'grouped' || product.type === 'bundle';
                                const isExpanded = expandedRows.includes(product.id);
                                const bundleOptionGroups = product.type === 'bundle'
                                    ? buildBundleOptionGroups(product.bundle_items || [])
                                    : [];
                                const children = product.type === 'grouped'
                                    ? (product.grouped_items || [])
                                    : (product.type === 'bundle' ? [] : (product.variations || []));
                                
                                const renderRow = (p, isSubRow = false) => {
                                    const pIsParent = p.type === 'configurable' || p.type === 'grouped' || p.type === 'bundle';
                                    const pIsExpansionLoading = loadingExpandedIdSet.has(String(p.id));
                                    const pIsChild = isSubRow || isVariantChildProduct(p);
                                    const pUsesChildRowStyle = isSubRow
                                        ? product.type === 'configurable'
                                        : isConfigurableVariantChildProduct(p);
                                    const editTargetId = getProductEditTargetId(p);
                                    const aiReviewState = aiReviewProductStates[String(p.id)] || null;
                                    const aiReviewRunning = aiReviewState?.status === 'running';
                                    const aiReviewTitle = aiReviewState?.message
                                        ? `Review AI: ${aiReviewState.message}`
                                        : 'Tạo lại review AI cho sản phẩm này';
                                    
                                    // Custom aggregate price display for parent products
                                    let displayCostPrice = normalizeRoundedImportCostNumber(p.expected_cost ?? p.cost_price);
                                    let displayPrice = p.price;
                                    const pVariants = p.variations || [];
                                    const useVariantNameTextStyle = pIsParent || (!isSubRow && !pUsesChildRowStyle);
                                    const productNameRowClassName = useVariantNameTextStyle
                                        ? 'flex min-h-5 min-w-0 items-center gap-2'
                                        : 'flex min-h-[18px] min-w-0 items-center gap-2';
                                    const productNameTextClassName = useVariantNameTextStyle
                                        ? 'truncate text-[14px] leading-5 font-black tracking-tight text-primary'
                                        : 'truncate text-[13px] leading-[18px] font-bold text-[#111]';
                                    
                                    if (pIsParent && !isSubRow) {
                                        if (p.type === 'grouped') {
                                            const components = p.grouped_items || [];
                                            if (components.length > 0) {
                                                // Calculate sum of cost prices for Grouped Product
                                                displayCostPrice = components.reduce((sum, item) => sum + ((normalizeRoundedImportCostNumber(item.expected_cost ?? item.cost_price) ?? 0) * (item.pivot?.quantity || 1)), 0);
                                                
                                                // Calculate sum of selling prices (if price_type is 'sum')
                                                if (p.price_type === 'sum') {
                                                    displayPrice = components.reduce((sum, item) => sum + (Number(item.price || 0) * (item.pivot?.quantity || 1)), 0);
                                                }
                                            }
                                        } else if (pVariants.length > 0) {
                                            // Existing logic for Configurable products
                                            const vCostPrices = pVariants.map(v => normalizeRoundedImportCostNumber(v.expected_cost ?? v.cost_price));
                                            const firstCost = vCostPrices[0];
                                            const allCostSame = vCostPrices.every(cp => cp !== null && cp !== undefined && Number(cp) === Number(firstCost));
                                            displayCostPrice = allCostSame ? firstCost : null;

                                            const vPrices = pVariants.map(v => v.price);
                                            const firstPrice = vPrices[0];
                                            const allPriceSame = vPrices.every(pr => pr !== null && pr !== undefined && Number(pr) === Number(firstPrice));
                                            displayPrice = allPriceSame ? firstPrice : null;
                                        }
                                    }
                                    
                                    return (
                                        <motion.tr
                                            key={p.id}
                                            initial={isSubRow ? { opacity: 0, y: -10 } : false}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            onClick={(event) => handleRowSelectionClick(p.id, event)}
                                            onDoubleClick={() => {
                                                if (canUpdateProducts) {
                                                    navigateToProductForm(`/admin/products/edit/${editTargetId}`);
                                                }
                                            }}
                                            className={`transition-all group cursor-pointer ${
                                                selectedIds.includes(p.id) ? 'bg-gold/10' : 
                                                pIsParent ? 'row-parent' : 
                                                pUsesChildRowStyle ? 'row-child' : 'row-root'
                                            }`}
                                        >
                                            <td className="p-3 border border-primary/20 sticky-col-0" onDoubleClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-2">
                                                    {!isSubRow && pIsParent ? (
                                                        <button
                                                            onClick={(e) => toggleExpandRow(p.id, e)}
                                                            disabled={pIsExpansionLoading}
                                                            className={`size-6 flex items-center justify-center rounded-full border border-gold/30 text-gold transition-all expand-btn ${isExpanded ? 'bg-gold text-white rotate-90' : 'bg-white'} ${pIsExpansionLoading ? 'cursor-wait opacity-70' : ''}`}
                                                            title={isExpanded ? 'Thu gọn' : (p.type === 'grouped' ? 'Xem thành phần' : (p.type === 'bundle' ? 'Xem tùy chọn bundle' : 'Xem biến thể'))}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">{pIsExpansionLoading ? 'progress_activity' : 'chevron_right'}</span>
                                                        </button>
                                                    ) : !isSubRow ? (
                                                        <div className="size-6" /> // Spacer for non-configurable items
                                                    ) : null}
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.includes(p.id)}
                                                        onClick={(event) => event.stopPropagation()}
                                                        onChange={() => toggleSelectProduct(p.id)}
                                                        className="size-4 cursor-pointer accent-primary"
                                                    />
                                                </div>
                                            </td>
                                            {renderedColumns.map(col => {
                                                const cellStyle = { width: columnWidths[col.id] || col.minWidth };
                                                
                                                if (col.id === 'images') return <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 ${pUsesChildRowStyle ? 'bg-primary/[0.01]' : ''}`}><div className="size-10 bg-primary/5 border rounded overflow-hidden" onClick={(e) => { e.stopPropagation(); const url = getPrimaryImage(p); if (url) setPreviewImage({ url, name: p.name }); }}><img src={getPrimaryImage(p) || null} className="w-full h-full object-cover" alt="" /></div></td>;
                                                
                                                if (col.id === 'sku') return (
                                                    <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 sticky-col-1 font-mono font-bold text-primary group/cell ${pUsesChildRowStyle ? 'text-primary/60' : ''}`}>
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate">{p.sku}</span>
                                                            <button onClick={(e) => handleCopy(p.sku, 'mã sản phẩm', e, `${p.id}-sku`)} className={`${copiedText === `${p.id}-sku` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép mã SP">
                                                                <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-sku` ? 'check' : 'content_copy'}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                );
                                                
                                                if (col.id === 'name') return (
                                                    <td key={col.id} style={cellStyle} className={`px-3 py-2 border border-primary/20 sticky-col-2 font-bold group/cell ${pIsParent ? 'text-primary' : 'text-[#111]'} ${pUsesChildRowStyle ? 'child-indent' : ''}`}>
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <div className="flex flex-col gap-1 flex-1 overflow-hidden">
                                                                <div className={productNameRowClassName}>
                                                                    {pUsesChildRowStyle && (
                                                                        <span className="material-symbols-outlined shrink-0 text-[16px] text-slate-400">
                                                                            subdirectory_arrow_right
                                                                        </span>
                                                                    )}
                                                                    <span className={productNameTextClassName}>{p.name}</span>
                                                                    {isSubRow && product.type === 'grouped' && p.pivot && (
                                                                        <div className="flex items-center gap-1 shrink-0">
                                                                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-sm text-[10px] font-black">x{p.pivot.quantity}</span>
                                                                            {!p.pivot.is_required && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm text-[10px] font-black uppercase tracking-tighter">Tùy chọn</span>}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <button onClick={(e) => handleCopy(p.name, 'tên sản phẩm', e, `${p.id}-name`)} className={`${copiedText === `${p.id}-name` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all`} title="Sao chép tên SP">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-name` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );

                                                if (col.id === 'product_link') {
                                                    const productLink = buildProductPageUrl(p, domains);
                                                    const hasProductLink = Boolean(productLink);

                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleOpenProductLink(p, e)}
                                                                disabled={!hasProductLink}
                                                                title={productLink || 'San pham chua co link hop le'}
                                                                className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-black transition-all ${
                                                                    hasProductLink
                                                                        ? 'border-primary/20 bg-primary/[0.04] text-primary hover:bg-primary/[0.08]'
                                                                        : 'cursor-not-allowed border-primary/10 bg-primary/[0.02] text-primary/35'
                                                                }`}
                                                            >
                                                                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                                                <span>{hasProductLink ? 'Mo trang' : 'Chua co link'}</span>
                                                            </button>
                                                        </td>
                                                    );
                                                }
                                                
                                                if (col.id === 'supplier_product_code') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[12px] font-mono font-bold text-primary/80">
                                                        {p.supplier_product_code ? (
                                                            <span className="block truncate" title={p.supplier_product_code}>{p.supplier_product_code}</span>
                                                        ) : '--'}
                                                    </td>
                                                );

                                                if (col.id === 'cost_price') {
                                                    const isEditing = editingProductId === p.id;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#334155] font-bold tracking-tight group/cell">
                                                            <div className="flex items-center justify-between">
                                                                {isEditing ? (
                                                                    <div className="flex flex-col gap-1">
                                                                        <input type="text" className="w-24 border border-primary/20 rounded px-1.5 py-0.5 text-[11px] font-bold outline-none focus:border-primary" value={formatWholeMoneyInput(editForm.expected_cost)} onChange={(e) => setEditForm(prev => ({...prev, expected_cost: normalizeWholeMoneyDraft(e.target.value)}))} onBlur={() => setEditForm(prev => ({ ...prev, expected_cost: normalizeRoundedImportCostNumber(prev.expected_cost) ?? '' }))} onKeyDown={(e) => e.key === 'Enter' && handleSaveQuickEdit(e)} inputMode="numeric" autoFocus />
                                                                        <div className="flex gap-2">
                                                                            <button onClick={handleSaveQuickEdit} className="text-green-600 text-[10px] font-bold uppercase">Lưu</button>
                                                                            <button onClick={handleCancelQuickEdit} className="text-brick text-[10px] font-bold uppercase">Hủy</button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <React.Fragment>
                                                                        <span>{displayCostPrice != null ? new Intl.NumberFormat('vi-VN').format(Math.floor(displayCostPrice)) + '₫' : (pIsParent && pVariants.length > 0 ? '--' : '--')}</span>
                                                                        <div className="flex gap-1 shrink-0">
                                                                            {pIsChild && !isEditing && (
                                                                                <button onClick={(e) => handleStartQuickEdit(p, e)} className="quick-edit-btn opacity-0 group-hover/cell:opacity-100" title="Sửa nhanh giá dự kiến">
                                                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                                                </button>
                                                                            )}
                                                                            {displayCostPrice != null && (
                                                                                <button onClick={(e) => handleCopy(String(Math.floor(displayCostPrice)), 'giá dự kiến', e, `${p.id}-cost`)} className={`${copiedText === `${p.id}-cost` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all ml-1`} title="Sao chép giá dự kiến">
                                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-cost` ? 'check' : 'content_copy'}</span>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </React.Fragment>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }

                                                if (col.id === 'price') {
                                                    const isEditing = editingProductId === p.id;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-brick font-black tracking-tight group/cell">
                                                            <div className="flex items-center justify-between">
                                                                {isEditing ? (
                                                                    <div className="flex items-center gap-1 w-full">
                                                                        <input
                                                                            type="text"
                                                                            className="quick-edit-input" 
                                                                            value={formatWholeMoneyInput(editForm.price)}
                                                                            onChange={e => setEditForm({...editForm, price: normalizeWholeMoneyDraft(e.target.value)})}
                                                                            onClick={e => e.stopPropagation()}
                                                                            onDoubleClick={e => { e.stopPropagation(); e.target.select(); }}
                                                                        />
                                                                        <div className="flex flex-col gap-0.5">
                                                                            <button
                                                                                onClick={handleSaveQuickEdit}
                                                                                disabled={savingId === p.id}
                                                                                className="quick-edit-btn quick-save-btn" 
                                                                                title="Lưu"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px] font-bold">{savingId === p.id ? 'sync' : 'check'}</span>
                                                                            </button>
                                                                            <button
                                                                                onClick={handleCancelQuickEdit}
                                                                                className="quick-edit-btn quick-cancel-btn" 
                                                                                title="Hủy"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <React.Fragment>
                                                                        <span>{displayPrice ? new Intl.NumberFormat('vi-VN').format(Math.floor(displayPrice)) + '₫' : (pIsParent && pVariants.length > 0 ? '--' : (p.price ? new Intl.NumberFormat('vi-VN').format(Math.floor(p.price)) + '₫' : '--'))}</span>
                                                                        <div className="flex gap-1 shrink-0">
                                                                            {pIsChild && !isEditing && (
                                                                                <button onClick={(e) => handleStartQuickEdit(p, e)} className="quick-edit-btn opacity-0 group-hover/cell:opacity-100" title="Sửa nhanh giá bán">
                                                                                    <span className="material-symbols-outlined text-[16px]">edit</span>
                                                                                </button>
                                                                            )}
                                                                            {p.price && (
                                                                                <button onClick={(e) => handleCopy(String(Math.floor(displayPrice || p.price)), 'giá bán', e, `${p.id}-price`)} className={`${copiedText === `${p.id}-price` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all ml-1`} title="Sao chép giá bán">
                                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-price` ? 'check' : 'content_copy'}</span>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </React.Fragment>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }

                                                if (col.id === 'stock') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 font-black text-primary group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span>{formatQuantityValue(getDisplayStock(p))}</span>
                                                            <button onClick={(e) => handleCopy(String(getDisplayStock(p)), 'số lượng tồn kho', e, `${p.id}-stock`)} className={`${copiedText === `${p.id}-stock` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép tồn kho">
                                                                <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-stock` ? 'check' : 'content_copy'}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                );

                                                if (col.id === 'category') {
                                                    const categoryNames = getProductCategoryNames(p, categories);
                                                    const categorySummary = formatCategorySummary(categoryNames, '-');

                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#1e293b] font-medium group/cell align-top">
                                                            <div className="flex items-start justify-between gap-2">
                                                                {categoryNames.length > 0 ? (
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        {categoryNames.map((categoryName) => (
                                                                            <span
                                                                                key={`${p.id}-${categoryName}`}
                                                                                className="inline-flex items-center rounded-sm border border-primary/15 bg-primary/[0.04] px-2 py-1 text-[11px] font-bold leading-tight text-primary/80"
                                                                            >
                                                                                {categoryName}
                                                                            </span>
                                                                        ))}
                                                                        <button onClick={(e) => handleCopy(categorySummary, 'danh mục', e, `${p.id}-cat`)} className={`${copiedText === `${p.id}-cat` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép danh mục">
                                                                            <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-cat` ? 'check' : 'content_copy'}</span>
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-[12px] text-stone-400">-</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'unit') {
                                                    const unitLabel = resolveProductUnitLabel(p, isSubRow ? product : null);
                                                    const copyId = `${p.id}-unit`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#1e293b] font-medium group/cell">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="truncate">{unitLabel || '-'}</span>
                                                                {unitLabel && (
                                                                    <button onClick={(e) => handleCopy(unitLabel, 'đơn vị tính', e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép ĐVT">
                                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'type') {
                                                    const typeLabel = pUsesChildRowStyle
                                                        ? 'Biến thể con'
                                                        : (TYPE_LABELS[p.type]?.label || p.type);
                                                    const typeClass = pUsesChildRowStyle
                                                        ? 'border border-slate-300 bg-slate-100 text-slate-700'
                                                        : `border ${TYPE_LABELS[p.type]?.cls || ''}`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 group/cell">
                                                            <div className="flex items-center justify-between">
                                                                 <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${typeClass}`}>{typeLabel}</span>
                                                                <button onClick={(e) => handleCopy(typeLabel, 'loại sản phẩm', e, `${p.id}-type`)} className={`${copiedText === `${p.id}-type` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép loại sản phẩm">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-type` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'specifications') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-primary/70 italic group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate max-w-[150px]" title={p.specifications}>{p.specifications || '-'}</span>
                                                            {p.specifications && (
                                                                <button onClick={(e) => handleCopy(p.specifications, 'thông số kỹ thuật', e, `${p.id}-spec`)} className={`${copiedText === `${p.id}-spec` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-spec` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                                if (col.id === 'status') {
                                                    const statusText = p.status ? 'Bật' : 'Tắt';
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${p.status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{statusText}</span>
                                                                <button onClick={(e) => handleCopy(statusText, 'trạng thái', e, `${p.id}-status`)} className={`${copiedText === `${p.id}-status` ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title="Sao chép trạng thái">
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === `${p.id}-status` ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'is_featured' || col.id === 'is_new') {
                                                    const val = p[col.id];
                                                    const text = val ? 'Có' : 'Không';
                                                    const label = col.id === 'is_featured' ? 'nổi bật' : 'mới';
                                                    const copyId = `${p.id}-${col.id}`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                {val ? <span className="material-symbols-outlined text-gold">check_circle</span> : <span className="material-symbols-outlined text-primary/30">circle</span>}
                                                                <button onClick={(e) => handleCopy(text, label, e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${label}`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'google_merchant') {
                                                    const merchantStatus = getGoogleMerchantStatus(p);
                                                    const title = p.google_merchant_last_error
                                                        || (p.google_merchant_last_synced_at ? `Lần đồng bộ cuối: ${p.google_merchant_last_synced_at}` : 'Chưa đồng bộ Google Merchant');
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <span title={title} className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[10px] font-bold ${merchantStatus.className}`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{merchantStatus.icon}</span>
                                                                    {merchantStatus.label}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'seo_status') {
                                                    const hasSeo = Boolean(p.meta_description && String(p.meta_description).trim() !== '');
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-center group/cell">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold ${hasSeo ? 'bg-indigo-100 text-indigo-700' : 'bg-stone-100 text-stone-500'}`}>
                                                                    {hasSeo ? 'Có rồi' : 'Chưa'}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                if (col.id === 'actions') return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-right">
                                                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {isTrashView ? (
                                                                <React.Fragment>
                                                                    {canUpdateProducts && <button onClick={(e) => { e.stopPropagation(); handleRestore(p.id); }} className="p-1 hover:text-green-600" title="Khôi phục"><span className="material-symbols-outlined text-[18px]">restore</span></button>}
                                                                    {canDeleteProductsPermanently && <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="p-1 hover:text-brick" title="Xóa vĩnh viễn"><span className="material-symbols-outlined text-[18px]">delete_forever</span></button>}
                                                                </React.Fragment>
                                                            ) : (
                                                                <React.Fragment>
                                                                    {canUpdateProducts && <button onClick={(e) => handleSyncGoogleMerchantProduct(p.id, e)} className="p-1 hover:text-blue-700" title="Đồng bộ Google Merchant"><span className="material-symbols-outlined text-[18px]">cloud_sync</span></button>}
                                                                    {canUpdateProducts && <button onClick={(e) => handleRegenerateAiReviews([p.id], e)} disabled={!aiAvailable || generatingAiReviews} className={`p-1 disabled:cursor-not-allowed disabled:opacity-40 ${aiReviewState?.status === 'success' ? 'text-cyan-700' : aiReviewState?.status === 'error' ? 'text-red-600' : 'hover:text-cyan-700'}`} title={!aiAvailable ? disabledReason : aiReviewTitle}><span className={`material-symbols-outlined text-[18px] ${aiReviewRunning ? 'animate-refresh-spin' : ''}`}>{aiReviewRunning ? 'progress_activity' : 'rate_review'}</span></button>}
                                                                    {canCreateProducts && <button onClick={(e) => { e.stopPropagation(); requestDuplicate(p.id); }} className="p-1 hover:text-gold" title="Nhân bản"><span className="material-symbols-outlined text-[18px]">content_copy</span></button>}
                                                                    {canUpdateProducts && <button onClick={(e) => openQuickEditModal([p.id], e)} data-quick-edit-trigger={`row-${p.id}`} className="p-1 hover:text-sky-600" title="Sửa nhanh"><span className="material-symbols-outlined text-[18px]">flash_on</span></button>}
                                                                    {canUpdateProducts && <button onClick={(e) => { e.stopPropagation(); navigateToProductForm(`/admin/products/edit/${editTargetId}`); }} className="p-1 hover:text-primary" title="Sửa"><span className="material-symbols-outlined text-[18px]">edit</span></button>}
                                                                    {canDeleteProducts && <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="p-1 hover:text-brick" title="Xóa"><span className="material-symbols-outlined text-[18px]">delete</span></button>}
                                                                </React.Fragment>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                                if (col.isAttribute) {
                                                    const val = getAttributeValue(p, col.attrId);
                                                    const copyId = `${p.id}-${col.id}`;
                                                    return (
                                                        <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate group/cell">
                                                            <div className="flex items-center justify-between">
                                                                <span className="truncate">{val}</span>
                                                                {val && val !== '-' && (
                                                                    <button onClick={(e) => handleCopy(val, col.label || 'thuộc tính', e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${col.label}`}>
                                                                        <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    );
                                                }
                                                const defaultVal = String(p[col.id] ?? '-');
                                                const copyId = `${p.id}-${col.id}`;
                                                return (
                                                    <td key={col.id} style={cellStyle} className="px-3 py-2 border border-primary/20 text-[#111] truncate group/cell">
                                                        <div className="flex items-center justify-between">
                                                            <span className="truncate">{defaultVal}</span>
                                                            {defaultVal !== '-' && (
                                                                <button onClick={(e) => handleCopy(defaultVal, col.label || 'dữ liệu', e, copyId)} className={`${copiedText === copyId ? 'text-green-600' : 'text-primary/20 opacity-0 group-hover/cell:opacity-100'} hover:text-primary p-0.5 rounded transition-all shrink-0`} title={`Sao chép ${col.label}`}>
                                                                    <span className="material-symbols-outlined text-[14px]">{copiedText === copyId ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </motion.tr>
                                    );
                                };

                                return (
                                    <React.Fragment key={product.id}>
                                        {renderRow(product)}
                                        <AnimatePresence>
                                            {isExpanded && (
                                                <React.Fragment>
                                                    {product.type === 'bundle' ? (
                                                        bundleOptionGroups.length > 0 ? (
                                                            <motion.tr
                                                                initial={{ opacity: 0, height: 0 }}
                                                                animate={{ opacity: 1, height: 'auto' }}
                                                                exit={{ opacity: 0, height: 0 }}
                                                                className="row-child row-empty-child"
                                                            >
                                                                <td className="p-3 border border-primary/20 sticky-col-0" />
                                                                <td colSpan={renderedColumns.length} className="border border-primary/20 bg-[#fcfaf7] px-5 py-4">
                                                                    <div className="space-y-3">
                                                                        <div>
                                                                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">Tùy chọn bundle</p>
                                                                            <p className="mt-1 text-[12px] font-medium text-primary/65">
                                                                                {bundleOptionGroups.length} tùy chọn • {(product.bundle_items || []).length} dòng sản phẩm
                                                                            </p>
                                                                        </div>

                                                                        <div className="space-y-3">
                                                                            {bundleOptionGroups.map((option, optionIndex) => (
                                                                                <div key={`${product.id}-${option.key}`} className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                                                                                    <div className="flex items-start justify-between gap-3">
                                                                                        <div className="min-w-0">
                                                                                            <div className="flex flex-wrap items-center gap-2">
                                                                                                <span className="rounded-sm bg-primary/5 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
                                                                                                    Tùy chọn {optionIndex + 1}
                                                                                                </span>
                                                                                                {option.isDefault ? (
                                                                                                    <span className="rounded-sm bg-gold/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-gold">
                                                                                                        Mặc định
                                                                                                    </span>
                                                                                                ) : null}
                                                                                            </div>
                                                                                            <p className="mt-2 text-[13px] font-black text-[#0F172A]">{option.title}</p>
                                                                                        </div>

                                                                                        <div className="shrink-0 text-right">
                                                                                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/40">{option.itemCount} SP</p>
                                                                                            <p className="mt-1 text-[12px] font-bold text-primary/75">x{option.totalQuantity}</p>
                                                                                        </div>
                                                                                    </div>

                                                                                    <div className="mt-3 space-y-2">
                                                                                        {option.items.map((item) => (
                                                                                            <div key={item.key} className="flex items-start justify-between gap-3 rounded-sm border border-primary/10 bg-primary/[0.02] px-2.5 py-2">
                                                                                                <div className="min-w-0">
                                                                                                    <p className="truncate text-[12px] font-bold text-[#0F172A]">{item.name}</p>
                                                                                                    <p className="truncate text-[10px] font-mono text-primary/40">{item.sku || '--'}</p>
                                                                                                </div>
                                                                                                <span className="shrink-0 rounded-sm bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">x{item.quantity}</span>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </motion.tr>
                                                        ) : (
                                                            <motion.tr 
                                                                initial={{ opacity: 0, height: 0 }}
                                                                animate={{ opacity: 1, height: 'auto' }}
                                                                exit={{ opacity: 0, height: 0 }}
                                                                className="row-child row-empty-child"
                                                            >
                                                                <td className="p-3 border border-primary/20 sticky-col-0" />
                                                                <td colSpan={renderedColumns.length} className="px-8 py-5 border border-primary/20 text-red-400 italic text-[12px] font-bold flex items-center gap-2">
                                                                    <span className="material-symbols-outlined text-[16px]">info</span>
                                                                    Bundle này hiện chưa có tùy chọn nào
                                                                </td>
                                                            </motion.tr>
                                                        )
                                                    ) : children.length > 0 ? (
                                                        children.map(child => renderRow(child, true))
                                                    ) : (
                                                        <motion.tr 
                                                            initial={{ opacity: 0, height: 0 }}
                                                            animate={{ opacity: 1, height: 'auto' }}
                                                            exit={{ opacity: 0, height: 0 }}
                                                            className="row-child row-empty-child"
                                                        >
                                                            <td className="p-3 border border-primary/20 sticky-col-0" />
                                                            <td colSpan={renderedColumns.length} className="px-8 py-5 border border-primary/20 text-red-400 italic text-[12px] font-bold flex items-center gap-2">
                                                                <span className="material-symbols-outlined text-[16px]">info</span>
                                                                {product.type === 'grouped' ? 'Nhóm sản phẩm này hiện chưa có thành phần nào' : 'Sản phẩm này hiện chưa được cấu hình biến thể chi tiết'}
                                                            </td>
                                                        </motion.tr>
                                                    )}
                                                </React.Fragment>
                                            )}
                                        </AnimatePresence>
                                    </React.Fragment>
                                );
                            })


                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex-none mt-4 flex justify-between items-center admin-text-13 border-t-2 border-primary/10 pt-4">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-primary/80 uppercase text-[10px] tracking-widest">Hiển thị:</span>
                        <select className="border border-primary/20 rounded px-2 py-1 font-bold text-primary bg-white outline-none focus:border-primary transition-colors" value={pagination.per_page} onChange={(e) => { const lp = parseInt(e.target.value); fetchProducts(1, filters, sortConfig, lp); }}>
                            <option value="20">20 dòng</option>
                            <option value="50">50 dòng</option>
                            <option value="100">100 dòng</option>
                        </select>
                    </div>
                    <span className="text-[#111] font-bold italic">Tổng cộng: {pagination.total} sản phẩm</span>
                </div>
                <Pagination pagination={pagination} onPageChange={(page) => fetchProducts(page)} />
            </div>

            {previewImage && (
                <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4 scrollbar-hide" onClick={() => setPreviewImage(null)}>
                    <img src={previewImage.url} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                </div>
            )}

            {showQuickEditModal && typeof document !== 'undefined'
                ? createPortal(
                    <div
                        className={`fixed inset-0 z-[220] flex bg-slate-950/60 ${
                            quickEditExpanded
                                ? 'items-stretch justify-stretch p-0'
                                : 'items-center justify-center p-4'
                        }`}
                        onClick={closeQuickEditModal}
                    >
                        <div
                            data-quick-edit-modal="true"
                            className={`flex min-h-0 w-full flex-col overflow-hidden bg-white shadow-[0_32px_90px_rgba(15,23,42,0.28)] animate-in fade-in zoom-in-95 duration-200 transition-all ${
                                quickEditExpanded
                                    ? 'h-full max-h-none max-w-none rounded-none'
                                    : 'max-h-[92vh] max-w-7xl rounded-sm'
                            }`}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-4 border-b border-primary/10 px-6 py-5">
                                <div>
                                    <h2 className="flex items-center gap-2 text-lg font-bold text-primary">
                                        <span className="material-symbols-outlined text-sky-600">flash_on</span>
                                        Sửa nhanh sản phẩm
                                    </h2>
                                    <p className="mt-2 text-[13px] text-primary/65">
                                        Chỉnh trực tiếp ngay tại danh sách. Chỉ những ô thật sự thay đổi trong các cột đang bật mới được gửi lên hệ thống.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeQuickEditModal}
                                    disabled={quickEditSubmitting}
                                    className="text-gray-500 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="custom-scrollbar flex-1 min-h-0 space-y-4 overflow-y-auto px-6 pb-6 pt-5">
                                <div className="rounded-sm border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-950">
                                    Đang chuẩn bị sửa nhanh cho <strong>{quickEditProductGroups.length}</strong> sản phẩm.
                                    Hiện có <strong>{quickEditSelectedCoreFields.length + quickEditSelectedAttributeIds.length}</strong> cột đang bật.
                                    Nếu sửa nhiều sản phẩm cùng lúc, hệ thống chỉ lưu những ô bạn đã thay đổi, không ghi đè các trường khác.
                                </div>

                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
                                    <section className="rounded-sm border border-primary/10 bg-primary/[0.03] p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">Trường thông dụng</h3>
                                                <p className="mt-2 text-[12px] text-primary/60">
                                                    Bật cột nào thì cột đó mới xuất hiện trong bảng sửa nhanh bên dưới.
                                                </p>
                                            </div>
                                            <div className="rounded-sm bg-white px-3 py-1.5 text-[11px] font-bold text-primary/65 shadow-sm">
                                                {quickEditSelectedCoreFields.length}/{QUICK_EDIT_CORE_FIELDS.length} cột
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {QUICK_EDIT_CORE_FIELDS.map((field) => {
                                                const active = quickEditSelectedCoreFields.includes(field.id);
                                                return (
                                                    <button
                                                        key={field.id}
                                                        type="button"
                                                        onClick={() => toggleQuickEditCoreField(field.id)}
                                                        data-quick-edit-core-field={field.id}
                                                        className={`rounded-sm border px-3 py-2 text-[12px] font-bold transition-all ${
                                                            active
                                                                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                                                                : 'border-primary/15 bg-white text-primary/70 hover:border-primary/30 hover:bg-primary/[0.03]'
                                                        }`}
                                                    >
                                                        {field.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </section>

                                    <section className="rounded-sm border border-primary/10 bg-white p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">Thuộc tính thêm</h3>
                                                <p className="mt-2 text-[12px] text-primary/60">
                                                    Dùng để sửa nhanh các thuộc tính đang có trong hệ thống như loại men hoặc các thông tin cơ bản khác.
                                                </p>
                                            </div>
                                            <div className="rounded-sm bg-primary/[0.04] px-3 py-1.5 text-[11px] font-bold text-primary/65">
                                                {quickEditSelectedAttributeIds.length} thuộc tính
                                            </div>
                                        </div>

                                        {allAttributes.length > 0 ? (
                                            <div className="custom-scrollbar mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1">
                                                {[...allAttributes]
                                                    .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), 'vi'))
                                                    .map((attribute) => {
                                                        const active = quickEditSelectedAttributeIds.includes(String(attribute.id));
                                                        const isGlaze = normalizeQuickEditSearchText(attribute?.name).includes('loai men');

                                                        return (
                                                            <button
                                                                key={attribute.id}
                                                                type="button"
                                                                onClick={() => toggleQuickEditAttributeField(attribute.id)}
                                                                data-quick-edit-attribute-field={attribute.id}
                                                                className={`rounded-sm border px-3 py-2 text-[12px] font-bold transition-all ${
                                                                    active
                                                                        ? 'border-gold bg-gold text-white shadow-sm'
                                                                        : 'border-primary/15 bg-white text-primary/70 hover:border-primary/30 hover:bg-primary/[0.03]'
                                                                }`}
                                                            >
                                                                <span>{attribute.name}</span>
                                                                {isGlaze ? (
                                                                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${active ? 'bg-white/20 text-white' : 'bg-gold/10 text-gold'}`}>
                                                                        Gợi ý
                                                                    </span>
                                                                ) : null}
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        ) : (
                                            <div className="mt-3 rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-4 text-[12px] text-primary/55">
                                                Chưa có thuộc tính tùy chỉnh nào để thêm vào chế độ sửa nhanh.
                                            </div>
                                        )}
                                    </section>
                                </div>

                                <section className="space-y-3">
                                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                        <div>
                                            <h3 className="text-[14px] font-black uppercase tracking-[0.16em] text-primary">Bảng sửa nhanh</h3>
                                            <p className="mt-2 text-[12px] text-primary/60">
                                                Chỉnh trực tiếp từng ô, sau đó bấm <strong>Lưu sửa nhanh</strong>. Nút <strong>Hủy</strong> sẽ đóng cửa sổ mà không ghi thay đổi nào.
                                            </p>
                                        </div>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                                            <div className="relative min-w-0 sm:w-[320px]">
                                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/40">
                                                    search
                                                </span>
                                                <input
                                                    type="text"
                                                    value={quickEditSearchQuery}
                                                    onChange={(event) => setQuickEditSearchQuery(event.target.value)}
                                                    placeholder="Tìm tên sản phẩm, SKU, mã biến thể..."
                                                    className="h-10 w-full rounded-sm border border-primary/15 bg-white pl-10 pr-10 text-[12px] font-semibold text-primary outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                                    data-quick-edit-search="true"
                                                />
                                                {quickEditSearchQuery ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setQuickEditSearchQuery('')}
                                                        className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-primary/45 transition-colors hover:bg-primary/5 hover:text-primary"
                                                        aria-label="Xóa tìm kiếm sửa nhanh"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                    </button>
                                                ) : null}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setQuickEditExpanded((prev) => !prev)}
                                                className={`inline-flex h-10 items-center justify-center gap-2 rounded-sm border px-3 text-[12px] font-bold transition-all ${
                                                    quickEditExpanded
                                                        ? 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100'
                                                        : 'border-primary/15 bg-white text-primary/75 hover:border-primary/30 hover:bg-primary/[0.03]'
                                                }`}
                                                data-quick-edit-zoom="true"
                                                aria-pressed={quickEditExpanded}
                                            >
                                                <span className="material-symbols-outlined text-[16px]">
                                                    {quickEditExpanded ? 'fullscreen_exit' : 'open_in_full'}
                                                </span>
                                                {quickEditExpanded ? 'Thu gọn' : 'Phóng to'}
                                            </button>
                                            <div className="rounded-sm bg-primary/[0.04] px-3 py-2 text-[11px] text-primary/65">
                                                <strong>{quickEditFilteredGroups.length}</strong>
                                                {quickEditNormalizedSearchQuery ? `/${quickEditProductGroups.length}` : ''}
                                                {' '}sản phẩm • <strong>{quickEditSelectedCoreFields.length + quickEditSelectedAttributeIds.length}</strong> cột đang bật
                                            </div>
                                        </div>
                                    </div>

                                    {quickEditLoading ? (
                                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-10 text-center text-[12px] text-primary/60">
                                            <div className="flex items-center justify-center gap-2 text-primary">
                                                <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                                                Đang tải dữ liệu sửa nhanh...
                                            </div>
                                        </div>
                                    ) : quickEditProducts.length === 0 ? (
                                        <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-10 text-center text-[12px] text-primary/60">
                                            Không có sản phẩm nào sẵn sàng để sửa nhanh.
                                        </div>
                                    ) : quickEditFilteredGroups.length === 0 ? (
                                        <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-10 text-center text-[12px] text-primary/60">
                                            <div className="flex flex-col items-center gap-3">
                                                <span className="material-symbols-outlined text-[24px] text-primary/35">search_off</span>
                                                <p>Không tìm thấy sản phẩm phù hợp trong danh sách đang sửa nhanh.</p>
                                                <button
                                                    type="button"
                                                    onClick={() => setQuickEditSearchQuery('')}
                                                    className="inline-flex items-center gap-2 rounded-sm border border-primary/15 bg-white px-3 py-2 font-bold text-primary/75 transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                                                    Xóa tìm kiếm
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                                            {quickEditHasHorizontalOverflow ? (
                                                <div className="border-b border-primary/10 bg-[#F8FAFC] px-4 py-3">
                                                    <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <span className="material-symbols-outlined text-[16px] text-sky-600">swap_horiz</span>
                                                        <div
                                                            ref={quickEditTopScrollbarRef}
                                                            data-quick-edit-top-scrollbar="true"
                                                            onScroll={handleQuickEditTopScrollbarScroll}
                                                            className="custom-scrollbar flex-1 overflow-x-auto overflow-y-hidden"
                                                        >
                                                            <div
                                                                className="h-2 rounded-full bg-gradient-to-r from-primary/10 via-sky-400/30 to-primary/10"
                                                                style={{ width: quickEditTopScrollbarWidth }}
                                                            />
                                                        </div>
                                                        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                            Cuộn ngang nhanh
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : null}
                                            <div
                                                ref={quickEditTableScrollRef}
                                                data-quick-edit-table-scroll="true"
                                                onScroll={handleQuickEditTableScroll}
                                                className={`custom-scrollbar overflow-auto ${
                                                    quickEditExpanded
                                                        ? 'max-h-[68vh] md:max-h-[72vh] xl:max-h-[74vh]'
                                                        : 'max-h-[54vh]'
                                                }`}
                                            >
                                                <table data-quick-edit-table="true" className="min-w-full border-collapse">
                                                    <thead className="sticky top-0 z-20 bg-[#F8FAFC] shadow-sm">
                                                        <tr>
                                                            <th className="w-[72px] min-w-[72px] border border-primary/10 bg-[#F8FAFC] px-3 py-3 text-center text-[11px] font-black uppercase tracking-[0.16em] text-primary/60">
                                                                STT
                                                            </th>
                                                            <th className="min-w-[240px] border border-primary/10 bg-[#F8FAFC] px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-primary/60">
                                                                Sản phẩm
                                                            </th>
                                                            {quickEditSelectedCoreFields.map((fieldId) => (
                                                                <th key={`quick-edit-head-${fieldId}`} className="min-w-[180px] border border-primary/10 bg-[#F8FAFC] px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-primary/60">
                                                                    {QUICK_EDIT_CORE_FIELDS.find((field) => field.id === fieldId)?.label || fieldId}
                                                                </th>
                                                            ))}
                                                            {quickEditSelectedAttributes.map((attribute) => (
                                                                <th key={`quick-edit-head-attr-${attribute.id}`} className="min-w-[220px] border border-primary/10 bg-[#F8FAFC] px-3 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-primary/60">
                                                                    {attribute.name}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            let quickEditRowNumber = 0;

                                                            return quickEditFilteredGroups.map((group) => {
                                                                const parentProduct = group.parent;
                                                                const groupHasVariants = Array.isArray(group.variants) && group.variants.length > 0;

                                                                return [parentProduct, ...group.visibleVariants].map((product, rowIndex) => {
                                                                    quickEditRowNumber += 1;

                                                                    const rowError = quickEditRowErrors[String(product.id)];
                                                                    const rowType = String(product?.quick_edit_row_type || 'product');
                                                                    const isVariantRow = rowType === 'variant';
                                                                    const isParentRow = rowType === 'parent';
                                                                    const canToggleVariants = rowIndex === 0 && groupHasVariants;
                                                                    const rowLabel = getQuickEditRowLabel({
                                                                        isVariantRow,
                                                                        isParentRow,
                                                                        hasVariants: canToggleVariants,
                                                                    });
                                                                    const rowLabelClass = getQuickEditRowLabelClass({
                                                                        isVariantRow,
                                                                        isParentRow,
                                                                        hasVariants: canToggleVariants,
                                                                    });
                                                                    const rowBackgroundClass = rowError
                                                                        ? 'bg-red-50/70'
                                                                        : (isVariantRow ? 'bg-sky-50/80' : 'bg-white');

                                                                    return (
                                                                        <tr
                                                                            key={`quick-edit-row-${product.id}`}
                                                                            data-quick-edit-row-id={product.id}
                                                                            className={`align-top ${rowBackgroundClass}`}
                                                                        >
                                                                            <td className="w-[72px] min-w-[72px] border border-primary/10 px-3 py-3 text-center">
                                                                                <span className="text-[12px] font-black text-primary/70">
                                                                                    {quickEditRowNumber}
                                                                                </span>
                                                                            </td>
                                                                            <td className="min-w-[240px] border border-primary/10 px-3 py-3">
                                                                                <div className={`flex items-start gap-3 ${isVariantRow ? 'pl-4' : ''}`}>
                                                                                    {canToggleVariants ? (
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={(event) => toggleQuickEditGroupExpansion(group.id, event)}
                                                                                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border transition-all ${
                                                                                                group.isExpanded
                                                                                                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                                                                                                    : 'border-primary/15 bg-white text-primary/55 hover:border-primary/30 hover:bg-primary/[0.03] hover:text-primary'
                                                                                            }`}
                                                                                            title={group.isExpanded ? 'Thu gọn biến thể' : 'Mở biến thể'}
                                                                                            aria-label={group.isExpanded ? 'Thu gọn biến thể' : 'Mở biến thể'}
                                                                                            aria-expanded={group.isExpanded}
                                                                                        >
                                                                                            <span className={`material-symbols-outlined text-[18px] transition-transform ${group.isExpanded ? 'rotate-180' : ''}`}>
                                                                                                expand_more
                                                                                            </span>
                                                                                        </button>
                                                                                    ) : (
                                                                                        <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                                                                                    )}
                                                                                    <div className={`min-w-0 flex-1 ${isVariantRow ? 'border-l-2 border-sky-200 pl-3' : ''}`}>
                                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                                            <p className="text-[13px] font-black text-[#0F172A]">
                                                                                                {product.name || `Sản phẩm #${product.id}`}
                                                                                            </p>
                                                                                            <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-black ${rowLabelClass}`}>
                                                                                                {rowLabel}
                                                                                            </span>
                                                                                        </div>
                                                                                        {rowError ? (
                                                                                            <div className="mt-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                                                                                                {rowError}
                                                                                            </div>
                                                                                        ) : null}
                                                                                    </div>
                                                                                </div>
                                                                            </td>
                                                                            {quickEditSelectedCoreFields.map((fieldId) => (
                                                                                <td key={`quick-edit-cell-${product.id}-${fieldId}`} className="min-w-[180px] border border-primary/10 px-3 py-3">
                                                                                    {renderQuickEditCoreFieldInput(product, fieldId)}
                                                                                </td>
                                                                            ))}
                                                                            {quickEditSelectedAttributes.map((attribute) => (
                                                                                <td key={`quick-edit-cell-${product.id}-attr-${attribute.id}`} className="min-w-[220px] border border-primary/10 px-3 py-3">
                                                                                    {renderQuickEditAttributeInput(product, attribute)}
                                                                                </td>
                                                                            ))}
                                                                        </tr>
                                                                    );
                                                                });
                                                            });
                                                        })()}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </section>
                            </div>

                            <div className="flex flex-col gap-3 border-t border-primary/10 px-6 py-4 md:flex-row md:items-center md:justify-between">
                                <p className="text-[12px] text-primary/60">
                                    Hủy sẽ bỏ toàn bộ thay đổi chưa lưu. Lưu sửa nhanh chỉ cập nhật những ô đã đổi trong các cột đang bật.
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={closeQuickEditModal}
                                        disabled={quickEditSubmitting}
                                        data-quick-edit-cancel="true"
                                        className="rounded-sm border border-primary/20 px-4 py-2 text-[13px] font-bold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleQuickEditSave}
                                        data-quick-edit-save="true"
                                        disabled={
                                            quickEditSubmitting
                                            || quickEditLoading
                                            || quickEditProducts.length === 0
                                            || (quickEditSelectedCoreFields.length === 0 && quickEditSelectedAttributeIds.length === 0)
                                        }
                                        className="flex items-center gap-2 rounded-sm bg-sky-600 px-6 py-2 text-[13px] font-bold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {quickEditSubmitting ? (
                                            <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                                        ) : (
                                            <span className="material-symbols-outlined text-[16px]">save</span>
                                        )}
                                        Lưu sửa nhanh
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}

            <ProductImageBulkAppendModal
                open={showBulkImageAppendModal}
                selectedIds={selectedIds}
                onClose={() => setShowBulkImageAppendModal(false)}
                onApplied={handleBulkImageAppendApplied}
            />

            <ProductImageRefreshModal
                open={showBulkImageRefreshModal}
                selectedIds={selectedIds}
                onClose={() => setShowBulkImageRefreshModal(false)}
                onApplied={handleBulkImageRefreshApplied}
            />

            <ProductCategoryImageManagerModal
                open={showCategoryImageManagerModal}
                scopeLabel={imageManagerScopeLabel}
                listQueryParams={imageManagerScopeQueryParams}
                onClose={handleCloseCategoryImageManager}
                onChanged={handleCategoryImageManagerChanged}
            />

            {showBulkSeoModal && (
                <ProductSeoBulkModal
                    open={showBulkSeoModal}
                    initialSelectedIds={selectedIds}
                    autoStartToken={bulkSeoAutoStartToken}
                    onClose={() => {
                        setShowBulkSeoModal(false);
                        setBulkSeoAutoStartToken(null);
                        fetchProducts(pagination.current_page, filters, sortConfig, pagination.per_page);
                    }}
                />
            )}

            {showBulkUpdateModal && (
                <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-4 border-b border-primary/10 pb-4">
                            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined">tune</span> Cập nhật thuộc tính hàng loạt
                            </h2>
                            <button onClick={() => setShowBulkUpdateModal(false)} className="text-gray-500 hover:text-brick">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                        
                        <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 space-y-4">
                            <div className="bg-primary/5 border border-primary/20 text-primary p-3 rounded-sm text-[13px] mb-4">
                                <strong>Lưu ý:</strong> Đang chọn <strong>{selectedIds.length}</strong> sản phẩm. Bất kỳ giá trị nào bạn nhập ở đây sẽ ghi đè lên các sản phẩm được chọn. Để trống nếu bạn không muốn thay đổi thuộc tính đó.
                            </div>

                            <section className="space-y-4">
                                <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-brick pl-2 mb-3">Thông tin cơ bản</h3>
                                
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:items-center">
                                    <label className="text-[13px] font-bold text-primary/80">Danh mục chính</label>
                                    <div className="md:col-span-3">
                                        <select 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            value={bulkUpdateData.category_id || ''}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, category_id: e.target.value})}
                                        >
                                            <option value="">-- Bỏ qua --</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Giá dự kiến</label>
                                        <input
                                            type="text"
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="VNĐ"
                                            value={formatWholeMoneyInput(bulkUpdateData.expected_cost)}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, expected_cost: normalizeWholeMoneyDraft(e.target.value)})}
                                            onBlur={() => setBulkUpdateData(prev => ({ ...prev, expected_cost: normalizeRoundedImportCostNumber(prev.expected_cost) ?? '' }))}
                                            inputMode="numeric"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Giá bán</label>
                                        <input
                                            type="text"
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="VNĐ"
                                            value={formatWholeMoneyInput(bulkUpdateData.price)}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, price: normalizeWholeMoneyDraft(e.target.value)})}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Tồn kho</label>
                                        <input 
                                            type="text"
                                            inputMode="decimal"
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            placeholder="Số lượng"
                                            value={bulkUpdateData.stock_quantity ?? ''}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, stock_quantity: normalizeQuantityDraft(e.target.value)})}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Loại sản phẩm</label>
                                        <select 
                                            className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                            value={bulkUpdateData.type || ''}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, type: e.target.value})}
                                        >
                                            <option value="">-- Bỏ qua --</option>
                                            {ACTIVE_PRODUCT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[13px] font-bold text-primary/80">Nhà cung cấp</label>
                                        <div className="rounded-sm border border-primary/20 bg-primary/5 p-2">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <span className="text-[11px] font-bold text-primary/55">
                                                    {(bulkUpdateData.supplier_ids || []).length > 0
                                                        ? `Đã chọn ${(bulkUpdateData.supplier_ids || []).length} nhà cung cấp`
                                                        : '-- Bỏ qua --'}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setBulkUpdateData({ ...bulkUpdateData, supplier_ids: [] })}
                                                    className="text-[11px] font-bold text-brick hover:underline"
                                                >
                                                    Xóa chọn
                                                </button>
                                            </div>
                                            <div className="max-h-32 space-y-1 overflow-y-auto rounded-sm bg-white p-2">
                                                {suppliers.map((supplier) => (
                                                    <label key={supplier.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[12px] text-primary hover:bg-primary/5">
                                                        <input
                                                            type="checkbox"
                                                            checked={(bulkUpdateData.supplier_ids || []).includes(String(supplier.id))}
                                                            onChange={() => toggleBulkSupplierSelection(supplier.id)}
                                                            className="size-4 accent-primary"
                                                        />
                                                        <span className="truncate">
                                                            {supplier.code ? `${supplier.name} - ${supplier.code}` : supplier.name}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 max-w-sm space-y-1">
                                    <label className="text-[13px] font-bold text-primary/80">ĐVT</label>
                                    <select
                                        className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                        value={bulkUpdateData.inventory_unit_id || ''}
                                        onChange={e => setBulkUpdateData({ ...bulkUpdateData, inventory_unit_id: e.target.value })}
                                    >
                                        <option value="">-- Bỏ qua --</option>
                                        {inventoryUnits.map((unit) => (
                                            <option key={unit.id} value={unit.id}>{unit.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-primary/5 p-3 rounded-sm">
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Nổi bật:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.is_featured === undefined ? '' : bulkUpdateData.is_featured}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, is_featured: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Bật</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Mới:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.is_new === undefined ? '' : bulkUpdateData.is_new}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, is_new: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Bật</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-[13px] font-bold text-primary/80 whitespace-nowrap">Trạng thái:</label>
                                        <select 
                                            className="flex-1 bg-white border border-primary/20 px-2 py-1 rounded-sm text-[12px] focus:border-primary"
                                            value={bulkUpdateData.status === undefined ? '' : bulkUpdateData.status}
                                            onChange={e => setBulkUpdateData({...bulkUpdateData, status: e.target.value === '' ? undefined : e.target.value === '1'})}
                                        >
                                            <option value="">-- Giữ nguyên --</option>
                                            <option value="1">Kích hoạt</option>
                                            <option value="0">Tắt</option>
                                        </select>
                                    </div>
                                </div>
                            </section>

                            <section className="pt-4 space-y-4">
                                <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-brick pl-2 mb-3">Thuộc tính mở rộng</h3>

                            {allAttributes.map(attr => {
                                const val = bulkUpdateData[attr.id] || '';
                                return (
                                    <div key={attr.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 md:items-center">
                                        <label className="text-[13px] font-bold text-primary/80">{attr.name}</label>
                                        <div className="md:col-span-3">
                                            {attr.frontend_type === 'select' ? (
                                                <select 
                                                    className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                                    value={val}
                                                    onChange={e => setBulkUpdateData({...bulkUpdateData, [attr.id]: e.target.value})}
                                                >
                                                    <option value="">-- Bỏ qua --</option>
                                                    {attr.options?.map(opt => <option key={opt.id} value={opt.value}>{opt.value}</option>)}
                                                </select>
                                            ) : attr.frontend_type === 'multiselect' ? (
                                                <div className="flex flex-wrap gap-2 text-[13px]">
                                                    {attr.options?.map(opt => {
                                                        const isChecked = Array.isArray(val) && val.includes(opt.value);
                                                        return (
                                                            <label key={opt.id} className="flex items-center gap-1 cursor-pointer">
                                                                <input 
                                                                    type="checkbox" 
                                                                    className="accent-primary"
                                                                    checked={isChecked}
                                                                    onChange={e => {
                                                                        const curVals = Array.isArray(val) ? val : [];
                                                                        const newVals = e.target.checked ? [...curVals, opt.value] : curVals.filter(v => v !== opt.value);
                                                                        setBulkUpdateData({...bulkUpdateData, [attr.id]: newVals});
                                                                    }}
                                                                /> {opt.value}
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <input 
                                                    type="text" 
                                                    className="w-full bg-primary/5 border border-primary/20 px-3 py-2 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                                    placeholder="Nhập giá trị hoặc để trống bỏ qua..."
                                                    value={val}
                                                    onChange={e => setBulkUpdateData({...bulkUpdateData, [attr.id]: e.target.value})}
                                                />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            </section>
                        </div>

                        <div className="mt-6 pt-4 border-t border-primary/10 flex justify-end gap-3 shrink-0">
                            <button
                                onClick={() => setShowBulkUpdateModal(false)}
                                className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5"
                            >Hủy bỏ</button>
                            <button
                                onClick={handleBulkUpdateAttributesSubmit}
                                className="px-6 py-2 bg-primary text-white rounded-sm font-bold text-[13px] hover:bg-primary/90 flex items-center gap-2"
                                disabled={loading}
                            >
                                {loading ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">save</span>}
                                Áp dụng {selectedIds.length} SP
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showBulkCopyModal && (
                <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-white rounded p-6 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center mb-4 border-b border-primary/10 pb-4">
                            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                <span className="material-symbols-outlined">conversion_path</span> Sao chép từ 1 sản phẩm nguồn
                            </h2>
                            <button onClick={closeBulkCopyModal} className="text-gray-500 hover:text-brick">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 space-y-4">
                            <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-sm text-[13px]">
                                <strong>Lưu ý:</strong> Đang chọn <strong>{selectedIds.length}</strong> sản phẩm. Trong cửa sổ này bạn sẽ chọn <strong>1 sản phẩm nguồn từ chính danh sách đã tick</strong>, rồi copy 2 mục cần thiết sang các sản phẩm còn lại.
                            </div>

                            <section className="space-y-3">
                                <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-amber-500 pl-2">Sản phẩm nguồn</h3>

                                <div className="relative">
                                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary/35 text-[18px]">search</span>
                                    <input
                                        type="text"
                                        value={bulkCopySourceQuery}
                                        onChange={(event) => setBulkCopySourceQuery(event.target.value)}
                                        placeholder="Lọc trong các sản phẩm đã chọn theo tên hoặc SKU..."
                                        className="w-full h-11 bg-primary/5 border border-primary/20 pl-10 pr-4 rounded-sm text-[13px] focus:outline-none focus:border-primary"
                                    />
                                </div>

                                {bulkCopySourceProduct ? (
                                    <div className="rounded-sm border border-gold/20 bg-gold/5 px-4 py-3 flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gold">Đang chọn làm nguồn</p>
                                            <p className="mt-1 truncate text-[13px] font-bold text-primary">{bulkCopySourceProduct.name}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone/55">
                                                <span className="font-mono text-gold">{bulkCopySourceProduct.sku || 'Chưa có SKU'}</span>
                                                <span>{TYPE_LABELS[bulkCopySourceProduct.type]?.label || bulkCopySourceProduct.type || 'Sản phẩm'}</span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setBulkCopySourceProduct(null)}
                                            className="px-3 py-1.5 rounded-sm border border-brick/20 text-brick text-[11px] font-bold uppercase hover:bg-brick hover:text-white transition-all"
                                        >
                                            Bỏ chọn
                                        </button>
                                    </div>
                                ) : (
                                    <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-3 text-[12px] text-primary/60">
                                        Chưa chọn sản phẩm nguồn.
                                    </div>
                                )}

                                <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                    {bulkCopySourceResults.length > 0 ? bulkCopySourceResults.map((product) => {
                                        const isActive = String(bulkCopySourceProduct?.id || '') === String(product.id);
                                        return (
                                            <button
                                                key={product.id}
                                                type="button"
                                                onClick={() => setBulkCopySourceProduct(product)}
                                                className={`w-full rounded-sm border px-3 py-3 text-left transition-all ${isActive ? 'border-gold bg-gold/5 shadow-sm' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[13px] font-bold text-primary">{product.name}</p>
                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone/50">
                                                            <span className="font-mono text-gold">{product.sku || 'Chưa có SKU'}</span>
                                                            <span>{TYPE_LABELS[product.type]?.label || product.type || 'Sản phẩm'}</span>
                                                        </div>
                                                    </div>
                                                    <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-gold' : 'text-primary/20'}`}>
                                                        {isActive ? 'check_circle' : 'radio_button_unchecked'}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    }) : (
                                        <div className="rounded-sm border border-dashed border-stone/15 bg-stone/5 px-4 py-8 text-center text-[12px] text-stone/45">
                                            Không tìm thấy sản phẩm nguồn phù hợp trong danh sách đã chọn.
                                        </div>
                                    )}
                                </div>
                            </section>

                            <section className="space-y-3">
                                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                                    <div>
                                        <h3 className="text-[14px] font-black text-primary uppercase tracking-widest border-l-4 border-amber-500 pl-2">Mục cần sao chép</h3>
                                        <p className="mt-2 text-[12px] text-primary/60">
                                            Sau khi chọn sản phẩm nguồn, hệ thống hiển thị từng dòng chi tiết để bạn tick chọn. Mặc định các mục hiện có sẽ được chọn sẵn.
                                        </p>
                                    </div>
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-2 text-[11px] text-primary/60">
                                        Đã chọn <strong>{bulkCopySelectedItemCount}</strong> mục để sao chép.
                                    </div>
                                </div>

                                {!bulkCopySourceProduct ? (
                                    <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-5 text-[12px] text-primary/60">
                                        Chọn 1 sản phẩm nguồn để tải danh sách các dòng trong Bảng thông số kỹ thuật và Thông tin bổ sung.
                                    </div>
                                ) : bulkCopySourceItemsLoading ? (
                                    <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-8 text-center text-[12px] text-primary/60">
                                        <div className="flex items-center justify-center gap-2 text-primary">
                                            <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                                            Đang tải dữ liệu chi tiết từ sản phẩm nguồn...
                                        </div>
                                    </div>
                                ) : bulkCopySourceItemsError ? (
                                    <div className="rounded-sm border border-brick/20 bg-brick/5 px-4 py-4 text-[12px] text-brick">
                                        {bulkCopySourceItemsError}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {renderBulkCopyGroup('specifications', {
                                            title: 'Bảng thông số kỹ thuật',
                                            description: 'Các dòng có cùng nhãn sẽ được cập nhật theo dữ liệu nguồn, các dòng khác ở sản phẩm đích sẽ được giữ nguyên.',
                                            emptyText: 'Sản phẩm nguồn chưa có dòng thông số nào để sao chép.',
                                            getPrimaryText: (item, index) => item.label || `Dòng thông số ${index + 1}`,
                                            getSecondaryText: (item) => item.value || '',
                                        })}

                                        {renderBulkCopyGroup('additional_info', {
                                            title: 'Thông tin bổ sung',
                                            description: 'Các mục trùng bài viết liên kết sẽ được cập nhật, mục chưa có sẽ được thêm mới mà không làm mất mục khác.',
                                            emptyText: 'Sản phẩm nguồn chưa có mục thông tin bổ sung nào để sao chép.',
                                            getPrimaryText: (item, index) => item.title || item.post_title || item.display_text || `Mục bổ sung ${index + 1}`,
                                            getSecondaryText: (item) => {
                                                const metaParts = [];
                                                if (item.display_text) metaParts.push(item.display_text);
                                                if (item.post_title) metaParts.push(`Bài viết: ${item.post_title}`);
                                                if (item.post_slug) metaParts.push(`/${item.post_slug}`);
                                                if (item.post_id) metaParts.push(`ID ${item.post_id}`);
                                                return metaParts.join(' • ');
                                            },
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>

                        <div className="mt-6 pt-4 border-t border-primary/10 flex flex-col md:flex-row md:items-center md:justify-between gap-3 shrink-0">
                            <p className="text-[12px] text-primary/60">
                                Sẽ áp dụng cho <strong>{bulkCopyTargetCount}</strong> sản phẩm đích. Hiện đang chọn <strong>{bulkCopySelectedSpecificationCount}</strong> dòng thông số và <strong>{bulkCopySelectedAdditionalInfoCount}</strong> mục bổ sung.
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={closeBulkCopyModal}
                                    className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5"
                                >
                                    Hủy bỏ
                                </button>
                                <button
                                    onClick={handleBulkCopySubmit}
                                    className="px-6 py-2 bg-amber-600 text-white rounded-sm font-bold text-[13px] hover:bg-amber-700 flex items-center gap-2"
                                    disabled={submittingBulkCopy || bulkCopySourceItemsLoading || !bulkCopySourceProduct || bulkCopySelectedItemCount === 0}
                                >
                                    {submittingBulkCopy ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">conversion_path</span>}
                                    Sao chép cho {bulkCopyTargetCount} SP
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {duplicateConfirm && (
                <div
                    className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4"
                    onClick={closeDuplicateConfirm}
                >
                    <div
                        className="bg-white rounded p-6 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                            <div>
                                <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined text-amber-600">content_copy</span>
                                    Xác nhận sao chép sản phẩm
                                </h2>
                                <p className="mt-2 text-[13px] text-primary/70">
                                    Chỉ khi bấm <strong>Xác nhận sao chép</strong> thì hệ thống mới tạo bản nháp mới. Bấm <strong>Hủy</strong> sẽ bỏ lệnh sao chép.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeDuplicateConfirm}
                                disabled={submittingDuplicate}
                                className="text-gray-500 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                            {duplicateConfirm.count === 1 ? (
                                <React.Fragment>
                                    Sản phẩm nguồn: <strong>{duplicateConfirm.sourceName}</strong>.
                                    <div className="mt-1">Sau khi xác nhận, hệ thống sẽ tạo 1 bản nháp sao chép từ sản phẩm này.</div>
                                </React.Fragment>
                            ) : (
                                <React.Fragment>
                                    Đang chọn <strong>{duplicateConfirm.count}</strong> sản phẩm.
                                    <div className="mt-1">Sau khi xác nhận, hệ thống sẽ tạo {duplicateConfirm.count} bản nháp mới cho các sản phẩm đã chọn.</div>
                                </React.Fragment>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={closeDuplicateConfirm}
                                disabled={submittingDuplicate}
                                className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDuplicate}
                                disabled={submittingDuplicate}
                                className="px-6 py-2 bg-amber-600 text-white rounded-sm font-bold text-[13px] hover:bg-amber-700 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {submittingDuplicate ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">content_copy</span>}
                                {duplicateConfirm.count === 1 ? 'Xác nhận sao chép' : `Sao chép ${duplicateConfirm.count} sản phẩm`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductList;
