import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { categoryApi, orderApi, productApi, warehouseApi, warehouseShelfApi } from '../../services/api';
import { ACTIVE_PRODUCT_TYPE_OPTIONS, PRODUCT_TYPE_LABELS } from '../../config/productTypes';

const panelClass = 'rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClass = 'h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const textareaClass = 'min-h-[86px] rounded-sm border border-primary/15 bg-white p-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const primaryButton = 'inline-flex h-9 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-bold text-white transition hover:bg-umber disabled:cursor-not-allowed disabled:opacity-60';
const ghostButton = 'inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[12px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const dangerIconButton = 'inline-flex h-8 w-8 items-center justify-center rounded-sm border border-brick/15 bg-white text-brick/70 transition hover:border-brick hover:bg-brick hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE = 'attribute';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE = 'bundle_option_title';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE = 'bundle_title';
const PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS = 'bundle_option_status';
const supportedProductQuickFilterTypes = new Set(['select', 'multiselect']);
const shelfProductSearchDefaultFilters = {
    type: '',
    stock: '',
    attributeId: '',
    attributeValue: '',
    attributeId2: '',
    attributeValue2: '',
};
const sequenceProductSearchDefaultFilters = {
    ...shelfProductSearchDefaultFilters,
    categoryId: '',
};
const shelfProductTypeOptions = [
    { value: '', label: 'Tất cả loại' },
    { value: 'variation', label: 'Biến thể con' },
    ...ACTIVE_PRODUCT_TYPE_OPTIONS,
];
const shelfStockFilterOptions = [
    { value: '', label: 'Tất cả tồn' },
    { value: 'in_stock', label: 'Còn hàng' },
    { value: 'out_of_stock', label: 'Hết hàng' },
];
const emptyShelfForm = {
    warehouse_id: '',
    name: '',
    code: '',
    floor_count: 4,
    is_active: true,
    notes: '',
};

const extractPayload = (response) => response?.data?.data ?? response?.data ?? null;

const normalizeText = (value) => String(value ?? '').trim();

const normalizeQuickFilterOptionValue = (value) => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
        return value.map(normalizeQuickFilterOptionValue).filter(Boolean).join(', ');
    }

    return String(value).trim();
};

const normalizeLookupText = (value) => normalizeQuickFilterOptionValue(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const dedupeProductQuickFilterOptions = (options = []) => {
    const seenValues = new Set();

    return (Array.isArray(options) ? options : [])
        .map((option) => {
            const value = normalizeQuickFilterOptionValue(option?.value);
            const label = normalizeQuickFilterOptionValue(option?.label) || value;

            return value ? { ...option, value, label } : null;
        })
        .filter(Boolean)
        .filter((option) => {
            const lookupValue = normalizeLookupText(option.value || option.label);
            if (!lookupValue || seenValues.has(lookupValue)) return false;

            seenValues.add(lookupValue);
            return true;
        });
};

const buildShelfProductQuickFilterAttributes = (attributes = []) => {
    const normalizedAttributes = (Array.isArray(attributes) ? attributes : [])
        .filter((attribute) => supportedProductQuickFilterTypes.has(attribute?.frontend_type))
        .map((attribute) => ({
            ...attribute,
            quick_filter_kind: attribute?.quick_filter_kind || PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE,
            options: dedupeProductQuickFilterOptions(attribute?.options || []),
        }))
        .filter((attribute) => attribute.options.length > 0);

    const preferredAttributes = normalizedAttributes.filter(
        (attribute) => attribute.is_filterable_backend || attribute.is_filterable || attribute.is_filterable_frontend
    );

    return (preferredAttributes.length > 0 ? preferredAttributes : normalizedAttributes)
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'));
};

const getProductQuickFilterKind = (attribute) => (
    attribute?.quick_filter_kind || PRODUCT_QUICK_FILTER_KIND_ATTRIBUTE
);

const appendShelfProductQuickFilterParams = (params, attribute, value) => {
    const normalizedValue = normalizeQuickFilterOptionValue(value);
    if (!attribute || !normalizedValue) return params;

    const kind = getProductQuickFilterKind(attribute);

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_OPTION_TITLE) {
        params['bundle_filters[option_title]'] = normalizedValue;
        return params;
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_TITLE) {
        params['bundle_filters[bundle_title]'] = normalizedValue;
        return params;
    }

    if (kind === PRODUCT_QUICK_FILTER_KIND_BUNDLE_STATUS) {
        params['bundle_filters[option_status]'] = normalizedValue;
        return params;
    }

    if (attribute.id) {
        params[`attributes[${attribute.id}]`] = normalizedValue;
    }

    return params;
};

const splitSkuTokens = (value) => normalizeText(value)
    .split(/[\s,;=|]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

const normalizeSkuKey = (value) => normalizeText(value).toLowerCase();

const parseQuantityNumber = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;

        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }

    return null;
};

const formatQuantity = (value) => {
    const number = parseQuantityNumber(value);
    if (number === null) return '';

    return number.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
};

const resolveProductSku = (product) => normalizeText(product?.display_sku || product?.sku || product?.product_sku);

const resolveProductName = (product) => normalizeText(
    product?.display_name
    || product?.name
    || product?.product_name
    || product?.parent_product_name
);

const resolveProductImage = (product) => normalizeText(
    product?.main_image
    || product?.primary_image?.url
    || product?.image_url
);

const resolveProductStock = (product) => parseQuantityNumber(
    product?.available_to_sell,
    product?.computed_stock,
    product?.stock_quantity
);

const productUsesWarehouseSequence = (product) => {
    const type = normalizeText(product?.type || product?.product_type).toLowerCase();
    const entryKind = normalizeText(product?.entry_kind).toLowerCase();
    const hasVariantChildren = Boolean(
        product?.has_variations
        || product?.product_has_variations
        || Number(product?.variation_count || product?.product_variation_count || 0) > 0
        || (Array.isArray(product?.variations) && product.variations.length > 0)
    );

    if (entryKind === 'bundle_option') return false;
    if (entryKind !== 'variation' && hasVariantChildren) return false;
    if (['configurable', 'bundle'].includes(type)) return false;

    return true;
};

const resolveProductWarehouseSequence = (product) => {
    if (!productUsesWarehouseSequence(product)) return null;

    const raw = product?.warehouse_sequence
        ?? product?.product_warehouse_sequence
        ?? product?.storage_location?.warehouse_sequence
        ?? product?.storage_location?.product_warehouse_sequence;
    const number = Number(raw);

    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

const resolveProductRecordId = (product) => {
    const raw = product?.id ?? product?.target_product_id ?? product?.product_id;
    const number = Number(raw);

    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
};

const normalizeWarehouseSequenceDraft = (value) => String(value ?? '')
    .replace(/[^0-9]/g, '')
    .replace(/^0+/, '');

const buildSequenceRowKey = (product) => {
    const productId = resolveProductRecordId(product);
    if (productId) return `product:${productId}`;

    return `sku:${normalizeSkuKey(resolveProductSku(product))}`;
};

const extractFirstApiError = (error, fallback) => {
    const messages = error?.response?.data?.errors;
    const firstMessage = messages
        ? Object.values(messages).flat().filter(Boolean)[0]
        : null;

    return firstMessage || error?.response?.data?.message || fallback;
};

const getProductTypeLabel = (product) => {
    const entryKind = normalizeText(product?.entry_kind);
    if (entryKind === 'variation') return 'Biến thể';

    return PRODUCT_TYPE_LABELS[product?.type] || product?.type || 'Sản phẩm';
};

const extractProductRows = (response) => {
    const payload = response?.data;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.products)) return payload.products;

    return [];
};

const extractCategoryRows = (response) => {
    const payload = response?.data;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload)) return payload;

    return [];
};

const flattenProductPickerRows = (rows = []) => {
    const seen = new Set();
    const entries = [];

    const pushEntry = (entry, parent = null) => {
        if (!entry) return;
        const sku = resolveProductSku(entry);
        const id = entry.id ?? entry.product_id ?? entry.target_product_id ?? sku;
        const entryKind = entry.entry_kind || (parent ? 'variation' : 'product');
        const key = `${entryKind}:${id || sku}`;
        if (!id && !sku) return;
        if (seen.has(key)) return;

        seen.add(key);
        entries.push(parent ? {
            ...entry,
            entry_kind: entryKind,
            parent_product_id: parent.id,
            parent_product_name: parent.display_name || parent.name,
            parent_product_sku: parent.display_sku || parent.sku,
            main_image: resolveProductImage(entry) || resolveProductImage(parent),
        } : {
            ...entry,
            entry_kind: entryKind,
        });
    };

    (Array.isArray(rows) ? rows : []).forEach((product) => {
        pushEntry(product);
        if (Array.isArray(product?.variations)) {
            product.variations.forEach((variation) => pushEntry(variation, product));
        }
    });

    return entries;
};

const resolveProductLocationLabel = (product) => normalizeText(
    product?.location_label
    || product?.storage_location?.location_label
    || product?.shelf_location?.location_label
    || product?.storage_location?.location_code
    || product?.shelf_location?.location_code
);

const buildSequenceManagerRows = (productEntries = [], locations = [], includeLocationOnlyRows = true) => {
    const locationByProductId = new Map();
    const locationBySku = new Map();

    (Array.isArray(locations) ? locations : []).forEach((location) => {
        const productId = Number(location?.product_id ?? location?.product?.id);
        if (Number.isFinite(productId) && productId > 0 && !locationByProductId.has(productId)) {
            locationByProductId.set(Math.trunc(productId), location);
        }

        const skuKey = normalizeSkuKey(location?.product_sku || location?.product?.sku);
        if (skuKey && !locationBySku.has(skuKey)) {
            locationBySku.set(skuKey, location);
        }
    });

    const seen = new Set();
    const rows = [];
    const pushRow = (row) => {
        const key = buildSequenceRowKey(row);
        if (!key || key === 'sku:') return;
        if (seen.has(key)) return;

        seen.add(key);
        rows.push({ ...row, sequence_key: key });
    };

    (Array.isArray(productEntries) ? productEntries : []).forEach((entry) => {
        if (!productUsesWarehouseSequence(entry)) return;

        const productId = resolveProductRecordId(entry);
        const sku = resolveProductSku(entry);
        const location = (productId ? locationByProductId.get(productId) : null)
            || locationBySku.get(normalizeSkuKey(sku))
            || null;
        const sequence = resolveProductWarehouseSequence(entry) || resolveProductWarehouseSequence(location);

        pushRow({
            ...entry,
            product_id: productId || entry.product_id,
            warehouse_sequence: sequence,
            shelf_location: location,
            location_label: location?.location_label || entry.location_label || '',
        });
    });

    if (includeLocationOnlyRows) {
        (Array.isArray(locations) ? locations : []).forEach((location) => {
            if (!productUsesWarehouseSequence(location)) return;

            const productId = Number(location?.product_id);
            const normalizedProductId = Number.isFinite(productId) && productId > 0 ? Math.trunc(productId) : null;

            pushRow({
                id: normalizedProductId || undefined,
                product_id: normalizedProductId || undefined,
                sku: location?.product_sku,
                product_sku: location?.product_sku,
                name: location?.product_name,
                product_name: location?.product_name,
                warehouse_sequence: resolveProductWarehouseSequence(location),
                entry_kind: 'product',
                shelf_location: location,
                location_label: location?.location_label || '',
            });
        });
    }

    return rows.sort((left, right) => {
        const leftSequence = resolveProductWarehouseSequence(left);
        const rightSequence = resolveProductWarehouseSequence(right);

        if (leftSequence && rightSequence && leftSequence !== rightSequence) {
            return leftSequence - rightSequence;
        }
        if (leftSequence && !rightSequence) return -1;
        if (!leftSequence && rightSequence) return 1;

        return resolveProductSku(left).localeCompare(resolveProductSku(right), 'vi');
    });
};

const formatDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString('vi-VN');
};

const createFloorDrafts = (floorCount = 4) => {
    const count = Math.max(1, Number(floorCount) || 4);

    return Array.from({ length: count }, (_, index) => index + 1)
        .reduce((drafts, floor) => {
            drafts[floor] = '';
            return drafts;
        }, {});
};

const countSkuTokens = (value) => splitSkuTokens(value).length;

const escapePrintHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const nextShelfCode = (shelves = []) => {
    const nextNumber = shelves.length + 1;
    return `KE-${String(nextNumber).padStart(2, '0')}`;
};

const buildShelfTitle = (shelf) => {
    const code = normalizeText(shelf?.code);
    const name = normalizeText(shelf?.name);
    if (code && name && code !== name) return `${code} - ${name}`;
    return name || code || 'Kệ chưa đặt tên';
};

const LocationBadge = ({ item }) => (
    <div className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-gold/20 bg-gold/5 px-2 py-1 text-[11px] font-black text-primary">
        <span className="material-symbols-outlined text-[14px] text-gold">shelves</span>
        <span className="truncate">{item.location_label || 'Chưa có vị trí'}</span>
    </div>
);

const SequenceManagerModal = ({
    open,
    search,
    rows,
    drafts,
    loading,
    savingKey,
    error,
    rowErrors,
    selectedKeys,
    categoryOptions = [],
    filterAttributes,
    filters,
    filterPills,
    filterCount,
    activeFilterAttribute,
    activeFilterAttribute2Options,
    quickSetupOpen,
    onSearchChange,
    onDraftChange,
    onSave,
    onReload,
    onFilterChange,
    onResetFilters,
    onToggleQuickSetup,
    onToggleRow,
    onToggleAllRows,
    onPrintSelected,
    onPrintLabelsSelected,
    onClose,
}) => {
    if (!open) return null;

    const selectedKeySet = new Set(selectedKeys || []);
    const visibleKeys = rows.map((row) => row.sequence_key || buildSequenceRowKey(row)).filter(Boolean);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeySet.has(key));
    const selectedCount = selectedKeySet.size;
    const activeFilterBadge = filterCount > 0 ? `${filterCount} lọc` : 'Chưa lọc';

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-gold/25 bg-[#fcfcfa] shadow-2xl">
                <div className="flex items-center justify-between bg-primary px-6 py-4 text-white">
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-black uppercase tracking-[0.08em]">Quản lý số thứ tự</h2>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{rows.length} dòng sản phẩm</p>
                    </div>
                    <button type="button" onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-sm text-white/70 transition hover:bg-white/10 hover:text-white" title="Đóng">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="border-b border-primary/10 bg-[#fbfaf6] px-4 py-3">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="relative min-w-0 xl:w-[460px]">
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                            <input
                                value={search}
                                onChange={(event) => onSearchChange(event.target.value)}
                                className={`${inputClass} w-full pl-10 pr-10`}
                                placeholder="Tìm STT, SKU, tên sản phẩm..."
                            />
                            {search ? (
                                <button
                                    type="button"
                                    onClick={() => onSearchChange('')}
                                    className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-primary/40 transition hover:bg-primary/5 hover:text-primary"
                                    title="Xóa tìm kiếm"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.12em] ${filterCount > 0 ? 'border-green-200 bg-green-50 text-green-700' : 'border-primary/10 bg-white text-primary/45'}`}>
                                <span className="material-symbols-outlined text-[14px]">{filterCount > 0 ? 'flash_on' : 'flash_off'}</span>
                                {filterCount > 0 ? 'Đang bật' : activeFilterBadge}
                            </span>
                            <button
                                type="button"
                                onClick={onToggleQuickSetup}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/55 shadow-sm transition hover:border-primary/25 hover:text-primary"
                            >
                                <span className="material-symbols-outlined text-[15px]">playlist_add</span>
                                {quickSetupOpen ? 'Đóng' : 'Khai báo DS'}
                            </button>
                            <button
                                type="button"
                                onClick={onPrintSelected}
                                disabled={selectedCount === 0}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-gold/25 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary shadow-sm transition hover:border-gold hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                <span className="material-symbols-outlined text-[15px]">print</span>
                                In DS {selectedCount > 0 ? selectedCount : ''}
                            </button>
                            <button
                                type="button"
                                onClick={onPrintLabelsSelected}
                                disabled={selectedCount === 0}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-primary/15 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary shadow-sm transition hover:border-primary/35 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                <span className="material-symbols-outlined text-[15px]">label</span>
                                In tem {selectedCount > 0 ? selectedCount : ''}
                            </button>
                            <button type="button" onClick={onReload} disabled={loading} className={ghostButton}>
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>{loading ? 'progress_activity' : 'refresh'}</span>
                                Tải lại
                            </button>
                        </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                            value={filters.type}
                            onChange={(event) => onFilterChange('type', event.target.value)}
                            className={`${inputClass} min-w-[150px] flex-1 xl:flex-none`}
                        >
                            {shelfProductTypeOptions.map((option) => (
                                <option key={option.value || 'all-sequence-type'} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={filters.stock}
                            onChange={(event) => onFilterChange('stock', event.target.value)}
                            className={`${inputClass} min-w-[130px] flex-1 xl:flex-none`}
                        >
                            {shelfStockFilterOptions.map((option) => (
                                <option key={option.value || 'all-sequence-stock'} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={filters.categoryId || ''}
                            onChange={(event) => onFilterChange('categoryId', event.target.value)}
                            className={`${inputClass} min-w-[190px] flex-1 xl:flex-none`}
                        >
                            <option value="">Tất cả danh mục</option>
                            <option value="uncategorized">Chưa gắn danh mục</option>
                            {categoryOptions.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                        {filterAttributes.length > 0 ? (
                            <select
                                value={filters.attributeId}
                                onChange={(event) => onFilterChange('attributeId', event.target.value)}
                                className={`${inputClass} min-w-[180px] flex-1`}
                            >
                                {filterAttributes.map((attribute) => (
                                    <option key={attribute.id} value={attribute.id}>
                                        Lọc nhanh: {attribute.name}
                                    </option>
                                ))}
                            </select>
                        ) : null}
                        {filters.attributeValue && filterAttributes.length > 1 ? (
                            <select
                                value={filters.attributeId2}
                                onChange={(event) => onFilterChange('attributeId2', event.target.value)}
                                className={`${inputClass} min-w-[150px] flex-1 xl:flex-none`}
                            >
                                <option value="">Lọc 2</option>
                                {filterAttributes
                                    .filter((attribute) => String(attribute.id) !== String(filters.attributeId))
                                    .map((attribute) => (
                                        <option key={attribute.id} value={attribute.id}>
                                            {attribute.name}
                                        </option>
                                    ))}
                            </select>
                        ) : null}
                        {(search || filterCount > 0) ? (
                            <button
                                type="button"
                                onClick={onResetFilters}
                                className="inline-flex h-9 items-center justify-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45 transition hover:border-brick/20 hover:text-brick"
                            >
                                <span className="material-symbols-outlined text-[14px]">close</span>
                                Xóa lọc
                            </button>
                        ) : null}
                    </div>

                    {activeFilterAttribute?.options?.length ? (
                        <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
                            {activeFilterAttribute.options.map((option) => {
                                const isSelected = filters.attributeValue === option.value;

                                return (
                                    <button
                                        key={`${activeFilterAttribute.id}-${option.id || option.value}`}
                                        type="button"
                                        onClick={() => onFilterChange('attributeValue', isSelected ? '' : option.value)}
                                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/65 hover:border-primary/25 hover:bg-white'}`}
                                    >
                                        <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                        <span>{option.label || option.value}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}

                    {activeFilterAttribute2Options.length > 0 ? (
                        <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto border-t border-primary/5 pt-2 pb-1">
                            {activeFilterAttribute2Options.map((option) => {
                                const isSelected = filters.attributeValue2 === option.value;

                                return (
                                    <button
                                        key={`${activeFilterAttribute2.id}-${option.id || option.value}`}
                                        type="button"
                                        onClick={() => onFilterChange('attributeValue2', isSelected ? '' : option.value)}
                                        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-brick/10 bg-white text-brick/70 hover:border-brick/25 hover:bg-brick/5'}`}
                                    >
                                        <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                        <span>{option.label || option.value}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}

                    {filterPills.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {filterPills.map((pill) => (
                                <span key={pill.key} className="inline-flex max-w-full items-center rounded-full border border-primary/10 bg-white px-2 py-1 text-[10px] font-bold text-primary/55">
                                    <span className="truncate">{pill.label}</span>
                                </span>
                            ))}
                        </div>
                    ) : null}

                    {quickSetupOpen ? (
                        <div className="mt-3 overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                            <div className="grid grid-cols-[minmax(180px,1fr)_110px_120px_180px] bg-primary/[0.025] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                <span>Thuộc tính</span>
                                <span>Kiểu</span>
                                <span>Giá trị</span>
                                <span className="text-right">Khai báo</span>
                            </div>
                            <div className="max-h-56 overflow-auto divide-y divide-primary/10">
                                {filterAttributes.length > 0 ? filterAttributes.map((attribute) => {
                                    const isPrimary = String(attribute.id) === String(filters.attributeId);
                                    const isSecondary = String(attribute.id) === String(filters.attributeId2);

                                    return (
                                        <div key={`sequence-quick-setup-${attribute.id}`} className="grid grid-cols-[minmax(180px,1fr)_110px_120px_180px] items-center gap-2 px-3 py-2 text-[12px]">
                                            <div className="min-w-0">
                                                <p className="truncate font-bold text-primary">{attribute.name}</p>
                                                <p className="mt-0.5 truncate text-[10px] font-semibold text-primary/35">{attribute.code || 'product_attribute'}</p>
                                            </div>
                                            <span className="text-[11px] font-bold text-primary/45">{attribute.frontend_type || 'select'}</span>
                                            <span className="text-[11px] font-bold text-primary/45">{attribute.options?.length || 0} mục</span>
                                            <div className="flex justify-end gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => onFilterChange('attributeId', attribute.id)}
                                                    className={`inline-flex h-8 items-center rounded-sm border px-2 text-[10px] font-black uppercase tracking-[0.1em] transition ${isPrimary ? 'border-primary bg-primary text-white' : 'border-primary/10 bg-white text-primary/45 hover:border-primary/25 hover:text-primary'}`}
                                                >
                                                    Lọc chính
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onFilterChange('attributeId2', isSecondary ? '' : attribute.id)}
                                                    disabled={isPrimary}
                                                    className={`inline-flex h-8 items-center rounded-sm border px-2 text-[10px] font-black uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-35 ${isSecondary ? 'border-brick bg-brick text-white' : 'border-primary/10 bg-white text-primary/45 hover:border-brick/20 hover:text-brick'}`}
                                                >
                                                    Lọc phụ
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="px-3 py-6 text-center text-[12px] font-bold text-primary/35">
                                        Chưa có thuộc tính lọc nhanh
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>

                {error ? (
                    <div className="mx-4 mt-4 rounded-sm border border-brick/20 bg-brick/5 px-4 py-3 text-[13px] font-bold text-brick">
                        {error}
                    </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-auto p-4">
                    {loading ? (
                        <div className="flex h-64 items-center justify-center gap-2 text-[13px] font-bold text-primary/45">
                            <span className="material-symbols-outlined animate-spin text-[22px]">progress_activity</span>
                            Đang tải danh sách...
                        </div>
                    ) : rows.length > 0 ? (
                        <div className="overflow-x-auto rounded-sm border border-primary/10 bg-white">
                            <table className="min-w-[980px] w-full table-fixed text-left">
                                <thead className="sticky top-0 z-10 bg-[#fbfaf6] text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                    <tr>
                                        <th className="w-[54px] px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={allVisibleSelected}
                                                onChange={() => onToggleAllRows(visibleKeys)}
                                                disabled={visibleKeys.length === 0}
                                                className="size-4 accent-primary"
                                                title="Chọn tất cả dòng đang hiển thị"
                                            />
                                        </th>
                                        <th className="w-[120px] px-3 py-2 text-center">STT</th>
                                        <th className="w-[24%] px-3 py-2">SKU</th>
                                        <th className="px-3 py-2">Sản phẩm</th>
                                        <th className="w-[180px] px-3 py-2">Vị trí</th>
                                        <th className="w-[110px] px-3 py-2 text-right">Lưu</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-primary/10 text-[13px]">
                                    {rows.map((product) => {
                                        const key = product.sequence_key || buildSequenceRowKey(product);
                                        const sequence = resolveProductWarehouseSequence(product);
                                        const draft = drafts[key] ?? '';
                                        const normalizedDraft = normalizeWarehouseSequenceDraft(draft);
                                        const changed = normalizedDraft !== String(sequence || '');
                                        const saving = savingKey === key;
                                        const rowError = rowErrors[key] || '';
                                        const sku = resolveProductSku(product);
                                        const name = resolveProductName(product);
                                        const productId = resolveProductRecordId(product);
                                        const isSelected = selectedKeySet.has(key);
                                        const locationLabel = resolveProductLocationLabel(product);

                                        return (
                                            <tr key={key} className={`align-top hover:bg-primary/[0.025] ${isSelected ? 'bg-gold/[0.04]' : ''}`}>
                                                <td className="px-3 py-3 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => onToggleRow(key)}
                                                        className="size-4 accent-primary"
                                                        title="Chọn để in"
                                                    />
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <input
                                                        value={draft}
                                                        onChange={(event) => onDraftChange(key, event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                onSave(product);
                                                            }
                                                        }}
                                                        inputMode="numeric"
                                                        className="h-9 w-20 rounded-sm border border-gold/30 bg-[#fffaf0] px-2 text-center text-[13px] font-black text-gold outline-none transition placeholder:text-gold/35 focus:border-gold"
                                                        placeholder="-"
                                                    />
                                                    {rowError ? (
                                                        <p className="mt-1 text-[11px] font-bold leading-snug text-brick">{rowError}</p>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="break-words font-mono text-[12px] font-black text-primary">{sku || 'Chưa có SKU'}</span>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="min-w-0">
                                                        <p className="line-clamp-2 font-bold text-primary">{name || 'Sản phẩm chưa đặt tên'}</p>
                                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5 text-[10px] font-bold text-primary/45">{getProductTypeLabel(product)}</span>
                                                            {product.parent_product_name ? (
                                                                <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/45">{product.parent_product_name}</span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-black ${locationLabel ? 'border-gold/20 bg-gold/5 text-primary' : 'border-primary/10 bg-primary/[0.03] text-primary/35'}`}>
                                                        <span className="material-symbols-outlined text-[14px] text-gold">shelves</span>
                                                        <span className="truncate">{locationLabel || 'Chưa gán kệ'}</span>
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => onSave(product)}
                                                        disabled={saving || !productId || !changed}
                                                        className={primaryButton}
                                                    >
                                                        <span className={`material-symbols-outlined text-[17px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
                                                        Lưu
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex h-64 items-center justify-center px-4 text-center text-[13px] font-bold text-primary/40">
                            Không có sản phẩm phù hợp
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ShelfFormModal = ({
    open,
    form,
    warehouses,
    editing,
    saving,
    error,
    onChange,
    onClose,
    onSubmit,
}) => {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-gold/25 bg-[#fcfcfa] shadow-2xl">
                <div className="flex items-center justify-between bg-primary px-6 py-4 text-white">
                    <div>
                        <h2 className="text-lg font-black uppercase tracking-[0.08em]">{editing ? 'Sửa kệ' : 'Thêm kệ mới'}</h2>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Khai báo mã kệ và số tầng</p>
                    </div>
                    <button type="button" onClick={onClose} className="inline-flex size-10 items-center justify-center rounded-sm text-white/70 transition hover:bg-white/10 hover:text-white">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <form onSubmit={onSubmit} className="flex-1 space-y-5 overflow-auto p-6">
                    {error ? (
                        <div className="rounded-sm border border-brick/20 bg-brick/5 px-4 py-3 text-[13px] font-bold text-brick">
                            {error}
                        </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-1.5">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Kho</span>
                            <select
                                value={form.warehouse_id || ''}
                                onChange={(event) => onChange('warehouse_id', event.target.value)}
                                className={`${inputClass} w-full`}
                            >
                                <option value="">Không gắn kho cụ thể</option>
                                {warehouses.map((warehouse) => (
                                    <option key={warehouse.id} value={warehouse.id}>
                                        {warehouse.name}{warehouse.code ? ` (${warehouse.code})` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1.5">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Số tầng</span>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={form.floor_count}
                                onChange={(event) => onChange('floor_count', event.target.value)}
                                className={`${inputClass} w-full`}
                            />
                        </label>

                        <label className="space-y-1.5">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Mã kệ</span>
                            <input
                                required
                                value={form.code}
                                onChange={(event) => onChange('code', event.target.value)}
                                className={`${inputClass} w-full font-black uppercase tracking-[0.08em]`}
                                placeholder="VD: KE-01"
                            />
                        </label>

                        <label className="space-y-1.5">
                            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Tên kệ</span>
                            <input
                                required
                                value={form.name}
                                onChange={(event) => onChange('name', event.target.value)}
                                className={`${inputClass} w-full font-bold`}
                                placeholder="VD: Kệ 1"
                            />
                        </label>
                    </div>

                    <label className="block space-y-1.5">
                        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chú</span>
                        <textarea
                            value={form.notes}
                            onChange={(event) => onChange('notes', event.target.value)}
                            className={`${textareaClass} w-full`}
                            placeholder="VD: Kệ sát tường bên trái"
                        />
                    </label>

                    <label className="inline-flex cursor-pointer select-none items-center gap-3 rounded-sm border border-primary/10 bg-white px-3 py-2">
                        <input
                            type="checkbox"
                            checked={Boolean(form.is_active)}
                            onChange={(event) => onChange('is_active', event.target.checked)}
                            className="size-4 accent-primary"
                        />
                        <span className="text-[12px] font-bold text-primary">Kệ đang dùng</span>
                    </label>
                </form>

                <div className="flex justify-end gap-2 border-t border-primary/10 bg-stone/5 px-6 py-4">
                    <button type="button" onClick={onClose} className={ghostButton}>Hủy</button>
                    <button type="button" onClick={onSubmit} disabled={saving} className={primaryButton}>
                        <span className={`material-symbols-outlined text-[18px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
                        {editing ? 'Cập nhật' : 'Tạo kệ'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const WarehouseShelfManager = () => {
    const [warehouses, setWarehouses] = useState([]);
    const [categories, setCategories] = useState([]);
    const [shelves, setShelves] = useState([]);
    const [selectedShelfId, setSelectedShelfId] = useState(null);
    const [selectedShelf, setSelectedShelf] = useState(null);
    const [loadingShelves, setLoadingShelves] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState({ shelves: [], locations: [] });
    const [formOpen, setFormOpen] = useState(false);
    const [editingShelf, setEditingShelf] = useState(null);
    const [shelfForm, setShelfForm] = useState(emptyShelfForm);
    const [formSaving, setFormSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [floorDrafts, setFloorDrafts] = useState({});
    const [savingFloor, setSavingFloor] = useState(null);
    const [lastResult, setLastResult] = useState(null);
    const [pageError, setPageError] = useState('');
    const [productQuickFilterAttributes, setProductQuickFilterAttributes] = useState([]);
    const [activeSkuSearchFloor, setActiveSkuSearchFloor] = useState(null);
    const [skuSearchTerm, setSkuSearchTerm] = useState('');
    const [skuSearchFilters, setSkuSearchFilters] = useState(shelfProductSearchDefaultFilters);
    const [skuSearchResults, setSkuSearchResults] = useState([]);
    const [skuSearchLoading, setSkuSearchLoading] = useState(false);
    const [skuSearchError, setSkuSearchError] = useState('');
    const [sequenceManagerOpen, setSequenceManagerOpen] = useState(false);
    const [sequenceSearch, setSequenceSearch] = useState('');
    const [sequenceRows, setSequenceRows] = useState([]);
    const [sequenceDrafts, setSequenceDrafts] = useState({});
    const [sequenceLoading, setSequenceLoading] = useState(false);
    const [sequenceSavingKey, setSequenceSavingKey] = useState('');
    const [sequenceError, setSequenceError] = useState('');
    const [sequenceRowErrors, setSequenceRowErrors] = useState({});
    const [sequenceFilters, setSequenceFilters] = useState(sequenceProductSearchDefaultFilters);
    const [sequenceSelectedKeys, setSequenceSelectedKeys] = useState([]);
    const [sequenceQuickSetupOpen, setSequenceQuickSetupOpen] = useState(false);

    const loadShelves = useCallback(async (params = {}, signal) => {
        setLoadingShelves(true);
        setPageError('');
        try {
            const response = await warehouseShelfApi.getAll(params, signal);
            const data = extractPayload(response);
            const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
            setShelves(list);
            if (!selectedShelfId && list.length > 0) {
                setSelectedShelfId(list[0].id);
            }
        } catch (error) {
            if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
            console.error('Error loading shelves', error);
            setPageError(error.response?.data?.message || 'Không tải được danh sách kệ.');
        } finally {
            setLoadingShelves(false);
        }
    }, [selectedShelfId]);

    const loadWarehouses = useCallback(async () => {
        try {
            const response = await warehouseApi.getAll({ active_only: 1 });
            setWarehouses(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error loading warehouses', error);
        }
    }, []);

    const loadCategories = useCallback(async () => {
        try {
            const response = await categoryApi.getAll();
            setCategories(extractCategoryRows(response));
        } catch (error) {
            console.error('Error loading shelf sequence categories', error);
            setCategories([]);
        }
    }, []);

    const loadShelfDetail = useCallback(async (id) => {
        if (!id) {
            setSelectedShelf(null);
            setFloorDrafts({});
            return;
        }

        setLoadingDetail(true);
        try {
            const response = await warehouseShelfApi.getOne(id);
            const data = extractPayload(response);
            setSelectedShelf(data);
            setFloorDrafts(createFloorDrafts(data?.floor_count || 4));
            setActiveSkuSearchFloor(null);
            setSkuSearchResults([]);
        } catch (error) {
            console.error('Error loading shelf detail', error);
            setSelectedShelf(null);
            setPageError(error.response?.data?.message || 'Không tải được chi tiết kệ.');
        } finally {
            setLoadingDetail(false);
        }
    }, []);

    useEffect(() => {
        loadWarehouses();
        loadCategories();
        loadShelves();
    }, [loadCategories, loadShelves, loadWarehouses]);

    useEffect(() => {
        let cancelled = false;

        orderApi.getBootstrapCached({ mode: 'form' })
            .then((response) => {
                if (cancelled) return;

                const attributes = buildShelfProductQuickFilterAttributes(response?.data?.product_attributes || []);
                setProductQuickFilterAttributes(attributes);
                setSkuSearchFilters((previous) => ({
                    ...previous,
                    attributeId: previous.attributeId || String(attributes[0]?.id || ''),
                }));
                setSequenceFilters((previous) => ({
                    ...previous,
                    attributeId: previous.attributeId || String(attributes[0]?.id || ''),
                }));
            })
            .catch((error) => {
                if (!cancelled) {
                    console.error('Error loading shelf product quick filters', error);
                    setProductQuickFilterAttributes([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        loadShelfDetail(selectedShelfId);
    }, [loadShelfDetail, selectedShelfId]);

    useEffect(() => {
        const value = search.trim();
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            if (!value) {
                setSearchResults({ shelves: [], locations: [] });
                loadShelves({}, controller.signal);
                return;
            }

            setLoadingShelves(true);
            try {
                const response = await warehouseShelfApi.search({ q: value, limit: 80 }, controller.signal);
                const data = extractPayload(response) || {};
                setSearchResults({
                    shelves: Array.isArray(data.shelves) ? data.shelves : [],
                    locations: Array.isArray(data.locations) ? data.locations : [],
                });
                setShelves(Array.isArray(data.shelves) ? data.shelves : []);
            } catch (error) {
                if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return;
                console.error('Error searching shelf locations', error);
                setPageError(error.response?.data?.message || 'Không tra cứu được vị trí.');
            } finally {
                setLoadingShelves(false);
            }
        }, 260);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [loadShelves, search]);

    const shelfStats = useMemo(() => {
        const totalProducts = shelves.reduce((sum, shelf) => sum + Number(shelf.locations_count || 0), 0);
        const activeShelves = shelves.filter((shelf) => shelf.is_active).length;

        return { totalProducts, activeShelves };
    }, [shelves]);

    const selectedShelfFloors = useMemo(() => (
        Array.isArray(selectedShelf?.floors) ? selectedShelf.floors : []
    ), [selectedShelf]);

    const activeProductQuickFilterAttribute = useMemo(() => (
        productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(skuSearchFilters.attributeId)) || null
    ), [productQuickFilterAttributes, skuSearchFilters.attributeId]);

    const activeProductQuickFilterAttribute2 = useMemo(() => (
        productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(skuSearchFilters.attributeId2)) || null
    ), [productQuickFilterAttributes, skuSearchFilters.attributeId2]);

    const activeProductQuickFilterAttribute2Options = useMemo(() => {
        if (!skuSearchFilters.attributeValue || !activeProductQuickFilterAttribute2) return [];

        return activeProductQuickFilterAttribute2.options || [];
    }, [activeProductQuickFilterAttribute2, skuSearchFilters.attributeValue]);

    const activeSkuSearchFilterCount = useMemo(() => ([
        skuSearchFilters.type,
        skuSearchFilters.stock,
        skuSearchFilters.attributeValue,
        skuSearchFilters.attributeValue2,
    ].filter(Boolean).length), [skuSearchFilters]);

    const activeSkuSearchFilterPills = useMemo(() => {
        const pills = [];
        const searchValue = skuSearchTerm.trim();

        if (searchValue) {
            pills.push({ key: 'search', label: `Tìm: ${searchValue}` });
        }

        if (skuSearchFilters.type) {
            const label = skuSearchFilters.type === 'variation'
                ? 'Biến thể con'
                : (PRODUCT_TYPE_LABELS[skuSearchFilters.type] || skuSearchFilters.type);
            pills.push({ key: 'type', label });
        }

        if (skuSearchFilters.stock) {
            pills.push({
                key: 'stock',
                label: skuSearchFilters.stock === 'in_stock' ? 'Còn hàng' : 'Hết hàng',
            });
        }

        if (skuSearchFilters.attributeValue && activeProductQuickFilterAttribute) {
            pills.push({
                key: 'attribute-1',
                label: `${activeProductQuickFilterAttribute.name}: ${skuSearchFilters.attributeValue}`,
            });
        }

        if (skuSearchFilters.attributeValue2 && activeProductQuickFilterAttribute2) {
            pills.push({
                key: 'attribute-2',
                label: `${activeProductQuickFilterAttribute2.name}: ${skuSearchFilters.attributeValue2}`,
            });
        }

        return pills;
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        skuSearchFilters,
        skuSearchTerm,
    ]);

    const activeSequenceFilterAttribute = useMemo(() => (
        productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(sequenceFilters.attributeId)) || null
    ), [productQuickFilterAttributes, sequenceFilters.attributeId]);

    const activeSequenceFilterAttribute2 = useMemo(() => (
        productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(sequenceFilters.attributeId2)) || null
    ), [productQuickFilterAttributes, sequenceFilters.attributeId2]);

    const activeSequenceFilterAttribute2Options = useMemo(() => {
        if (!sequenceFilters.attributeValue || !activeSequenceFilterAttribute2) return [];

        return activeSequenceFilterAttribute2.options || [];
    }, [activeSequenceFilterAttribute2, sequenceFilters.attributeValue]);

    const activeSequenceFilterCount = useMemo(() => ([
        sequenceFilters.type,
        sequenceFilters.stock,
        sequenceFilters.categoryId,
        sequenceFilters.attributeValue,
        sequenceFilters.attributeValue2,
    ].filter(Boolean).length), [sequenceFilters]);

    const activeSequenceFilterPills = useMemo(() => {
        const pills = [];
        const searchValue = sequenceSearch.trim();

        if (searchValue) {
            pills.push({ key: 'search', label: `Tìm: ${searchValue}` });
        }

        if (sequenceFilters.type) {
            const label = sequenceFilters.type === 'variation'
                ? 'Biến thể con'
                : (PRODUCT_TYPE_LABELS[sequenceFilters.type] || sequenceFilters.type);
            pills.push({ key: 'type', label });
        }

        if (sequenceFilters.stock) {
            pills.push({
                key: 'stock',
                label: sequenceFilters.stock === 'in_stock' ? 'Còn hàng' : 'Hết hàng',
            });
        }

        if (sequenceFilters.categoryId) {
            const categoryLabel = sequenceFilters.categoryId === 'uncategorized'
                ? 'Chưa gắn danh mục'
                : (categories.find((category) => String(category.id) === String(sequenceFilters.categoryId))?.name || 'Danh mục');
            pills.push({ key: 'category', label: `Danh mục: ${categoryLabel}` });
        }

        if (sequenceFilters.attributeValue && activeSequenceFilterAttribute) {
            pills.push({
                key: 'attribute-1',
                label: `${activeSequenceFilterAttribute.name}: ${sequenceFilters.attributeValue}`,
            });
        }

        if (sequenceFilters.attributeValue2 && activeSequenceFilterAttribute2) {
            pills.push({
                key: 'attribute-2',
                label: `${activeSequenceFilterAttribute2.name}: ${sequenceFilters.attributeValue2}`,
            });
        }

        return pills;
    }, [
        activeSequenceFilterAttribute,
        activeSequenceFilterAttribute2,
        categories,
        sequenceFilters,
        sequenceSearch,
    ]);

    const loadSequenceRows = useCallback(async (value = '', signal) => {
        setSequenceLoading(true);
        setSequenceError('');

        try {
            const searchValue = normalizeText(value);
            const productParams = {
                picker: 1,
                fast_picker: 1,
                per_page: 200,
                allow_variants: 1,
                quick_filter_enabled: 1,
            };

            if (searchValue) {
                productParams.search = searchValue;
                productParams.filter_bundle_options_by_search = 1;
            }

            if (sequenceFilters.type && sequenceFilters.type !== 'variation') {
                productParams.type = sequenceFilters.type;
            }

            if (sequenceFilters.stock === 'in_stock') {
                productParams.min_stock = 1;
            }

            if (sequenceFilters.stock === 'out_of_stock') {
                productParams.max_stock = 0;
            }

            if (sequenceFilters.categoryId) {
                productParams.category_id = sequenceFilters.categoryId;
            }

            appendShelfProductQuickFilterParams(productParams, activeSequenceFilterAttribute, sequenceFilters.attributeValue);
            appendShelfProductQuickFilterParams(productParams, activeSequenceFilterAttribute2, sequenceFilters.attributeValue2);

            const locationRequest = warehouseShelfApi
                .search({ q: searchValue, limit: 120 }, signal)
                .catch((error) => {
                    if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') {
                        throw error;
                    }

                    console.error('Error loading sequence shelf locations', error);
                    return null;
                });

            const [productResponse, locationResponse] = await Promise.all([
                productApi.getAll(productParams, signal),
                locationRequest,
            ]);

            if (signal?.aborted) return;

            let productEntries = flattenProductPickerRows(extractProductRows(productResponse));

            if (sequenceFilters.type === 'variation') {
                productEntries = productEntries.filter((entry) => entry.entry_kind === 'variation' || entry.parent_product_id);
            }

            if (sequenceFilters.stock === 'in_stock') {
                productEntries = productEntries.filter((entry) => {
                    const stock = resolveProductStock(entry);
                    return stock === null || stock > 0;
                });
            }

            if (sequenceFilters.stock === 'out_of_stock') {
                productEntries = productEntries.filter((entry) => {
                    const stock = resolveProductStock(entry);
                    return stock !== null && stock <= 0;
                });
            }

            const locationData = extractPayload(locationResponse) || {};
            const locations = Array.isArray(locationData.locations) ? locationData.locations : [];
            const rows = buildSequenceManagerRows(productEntries, locations, activeSequenceFilterCount === 0).slice(0, 200);
            const rowKeySet = new Set(rows.map((row) => row.sequence_key || buildSequenceRowKey(row)));

            setSequenceRows(rows);
            setSequenceDrafts(rows.reduce((drafts, row) => {
                drafts[row.sequence_key] = String(resolveProductWarehouseSequence(row) || '');
                return drafts;
            }, {}));
            setSequenceSelectedKeys((previous) => previous.filter((key) => rowKeySet.has(key)));
            setSequenceRowErrors({});
        } catch (error) {
            if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;

            console.error('Error loading sequence manager products', error);
            setSequenceRows([]);
            setSequenceDrafts({});
            setSequenceError(error.response?.data?.message || 'Không tải được bảng số thứ tự.');
        } finally {
            if (!signal?.aborted) {
                setSequenceLoading(false);
            }
        }
    }, [
        activeSequenceFilterAttribute,
        activeSequenceFilterAttribute2,
        activeSequenceFilterCount,
        sequenceFilters,
    ]);

    useEffect(() => {
        if (!sequenceManagerOpen) return undefined;

        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            loadSequenceRows(sequenceSearch, controller.signal);
        }, 260);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [loadSequenceRows, sequenceManagerOpen, sequenceSearch]);

    const openSequenceManager = useCallback(() => {
        setSequenceSearch(search.trim());
        setSequenceError('');
        setSequenceRowErrors({});
        setSequenceSelectedKeys([]);
        setSequenceQuickSetupOpen(false);
        setSequenceManagerOpen(true);
    }, [search]);

    const updateSequenceFilter = useCallback((field, value) => {
        setSequenceFilters((previous) => {
            const next = { ...previous, [field]: value };

            if (field === 'attributeId') {
                next.attributeValue = '';
                if (String(next.attributeId2) === String(value)) {
                    next.attributeId2 = '';
                    next.attributeValue2 = '';
                }
            }

            if (field === 'attributeValue') {
                next.attributeValue2 = '';
            }

            if (field === 'attributeId2') {
                next.attributeValue2 = '';
            }

            return next;
        });
    }, []);

    const resetSequenceFilters = useCallback(() => {
        setSequenceSearch('');
        setSequenceFilters((previous) => ({
            ...sequenceProductSearchDefaultFilters,
            attributeId: previous.attributeId || String(productQuickFilterAttributes[0]?.id || ''),
        }));
        setSequenceSelectedKeys([]);
    }, [productQuickFilterAttributes]);

    const toggleSequenceRowSelection = useCallback((key) => {
        setSequenceSelectedKeys((previous) => (
            previous.includes(key)
                ? previous.filter((item) => item !== key)
                : [...previous, key]
        ));
    }, []);

    const toggleAllSequenceRows = useCallback((keys = []) => {
        const normalizedKeys = Array.from(new Set(keys.filter(Boolean)));
        if (normalizedKeys.length === 0) return;

        setSequenceSelectedKeys((previous) => {
            const previousSet = new Set(previous);
            const allSelected = normalizedKeys.every((key) => previousSet.has(key));

            if (allSelected) {
                return previous.filter((key) => !normalizedKeys.includes(key));
            }

            normalizedKeys.forEach((key) => previousSet.add(key));
            return Array.from(previousSet);
        });
    }, []);

    const getSelectedSequenceRows = useCallback(() => {
        const selectedSet = new Set(sequenceSelectedKeys);

        return sequenceRows.filter((row) => {
            const key = row.sequence_key || buildSequenceRowKey(row);
            return selectedSet.has(key);
        });
    }, [sequenceRows, sequenceSelectedKeys]);

    const printSelectedSequenceRows = useCallback(() => {
        const rowsToPrint = getSelectedSequenceRows();

        if (rowsToPrint.length === 0) {
            setSequenceError('Chọn ít nhất một sản phẩm để in STT và vị trí.');
            return;
        }

        const printedAt = new Date().toLocaleString('vi-VN');
        const tableRows = rowsToPrint.map((row, index) => {
            const key = row.sequence_key || buildSequenceRowKey(row);
            const draftSequence = normalizeWarehouseSequenceDraft(sequenceDrafts[key]);
            const sequence = draftSequence || String(resolveProductWarehouseSequence(row) || '');
            const locationLabel = resolveProductLocationLabel(row) || 'Chưa gán kệ';
            const sku = resolveProductSku(row) || 'Chưa có SKU';
            const name = resolveProductName(row) || 'Sản phẩm chưa đặt tên';

            return `
                <tr>
                    <td class="center">${index + 1}</td>
                    <td class="sequence">${escapePrintHtml(sequence || '-')}</td>
                    <td>${escapePrintHtml(sku)}</td>
                    <td>${escapePrintHtml(name)}</td>
                    <td>${escapePrintHtml(locationLabel)}</td>
                </tr>
            `;
        }).join('');

        const printWindow = window.open('', '_blank', 'width=980,height=720');
        if (!printWindow) {
            setSequenceError('Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi bấm In lại.');
            return;
        }

        printWindow.document.open();
        printWindow.document.write(`<!doctype html>
            <html>
                <head>
                    <meta charset="utf-8" />
                    <title>In STT vị trí sản phẩm</title>
                    <style>
                        * { box-sizing: border-box; }
                        body { margin: 24px; color: #0f2747; font-family: Arial, sans-serif; }
                        h1 { margin: 0; font-size: 20px; letter-spacing: .08em; text-transform: uppercase; }
                        .meta { margin: 6px 0 18px; color: #667085; font-size: 12px; }
                        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                        th, td { border: 1px solid #d8dee8; padding: 8px 10px; text-align: left; vertical-align: top; font-size: 12px; line-height: 1.35; }
                        th { background: #f4f6f9; color: #516070; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
                        .center { text-align: center; width: 46px; }
                        .sequence { width: 76px; text-align: center; font-size: 16px; font-weight: 800; color: #b98532; }
                        td:nth-child(3) { width: 170px; font-family: Consolas, monospace; font-weight: 700; }
                        td:nth-child(5) { width: 190px; font-weight: 700; }
                        @page { margin: 14mm; }
                    </style>
                </head>
                <body>
                    <h1>STT và vị trí sản phẩm</h1>
                    <div class="meta">Số dòng: ${rowsToPrint.length} | In lúc: ${escapePrintHtml(printedAt)}</div>
                    <table>
                        <thead>
                            <tr>
                                <th class="center">#</th>
                                <th>STT</th>
                                <th>SKU</th>
                                <th>Sản phẩm</th>
                                <th>Vị trí</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </body>
            </html>`);
        printWindow.document.close();
        printWindow.focus();
        window.setTimeout(() => {
            printWindow.print();
        }, 250);
    }, [getSelectedSequenceRows, sequenceDrafts]);

    const printSelectedSequenceLabels = useCallback(() => {
        const rowsToPrint = getSelectedSequenceRows();

        if (rowsToPrint.length === 0) {
            setSequenceError('Chọn ít nhất một sản phẩm để in tem nhãn.');
            return;
        }

        const printedAt = new Date().toLocaleString('vi-VN');
        const labels = rowsToPrint.map((row) => {
            const key = row.sequence_key || buildSequenceRowKey(row);
            const draftSequence = normalizeWarehouseSequenceDraft(sequenceDrafts[key]);
            const sequence = draftSequence || String(resolveProductWarehouseSequence(row) || '');
            const name = resolveProductName(row) || 'Sản phẩm chưa đặt tên';
            const labelText = sequence ? `${sequence} - ${name}` : name;
            const textClass = labelText.length > 64
                ? 'label-text tiny'
                : (labelText.length > 44 ? 'label-text compact' : 'label-text');

            return `
                <section class="label">
                    <div class="${textClass}">${escapePrintHtml(labelText)}</div>
                </section>
            `;
        }).join('');

        const printWindow = window.open('', '_blank', 'width=980,height=720');
        if (!printWindow) {
            setSequenceError('Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi bấm In tem lại.');
            return;
        }

        printWindow.document.open();
        printWindow.document.write(`<!doctype html>
            <html>
                <head>
                    <meta charset="utf-8" />
                    <title>In tem nhãn kệ</title>
                    <style>
                        * { box-sizing: border-box; }
                        body { margin: 0; color: #111827; font-family: Arial, sans-serif; }
                        .toolbar { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #667085; font-size: 12px; }
                        .sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4mm; padding: 9mm; }
                        .label {
                            min-height: 30mm;
                            border: 1.3px solid #111827;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 4mm 5mm;
                            page-break-inside: avoid;
                            break-inside: avoid;
                            text-align: center;
                        }
                        .label-text { font-size: 20pt; font-weight: 800; line-height: 1.12; }
                        .label-text.compact { font-size: 16pt; line-height: 1.12; }
                        .label-text.tiny { font-size: 13.5pt; line-height: 1.12; }
                        @page { size: A4 portrait; margin: 0; }
                        @media print {
                            .toolbar { display: none; }
                            .sheet { padding: 9mm; }
                        }
                    </style>
                </head>
                <body>
                    <div class="toolbar">Tem nhãn kệ | Số tem: ${rowsToPrint.length} | In lúc: ${escapePrintHtml(printedAt)}</div>
                    <main class="sheet">${labels}</main>
                </body>
            </html>`);
        printWindow.document.close();
        printWindow.focus();
        window.setTimeout(() => {
            printWindow.print();
        }, 250);
    }, [getSelectedSequenceRows, sequenceDrafts]);

    const updateSequenceDraft = useCallback((key, value) => {
        setSequenceDrafts((previous) => ({
            ...previous,
            [key]: normalizeWarehouseSequenceDraft(value),
        }));
        setSequenceRowErrors((previous) => {
            if (!previous[key]) return previous;

            const next = { ...previous };
            delete next[key];
            return next;
        });
    }, []);

    const saveSequenceRow = useCallback(async (product) => {
        const key = product.sequence_key || buildSequenceRowKey(product);
        const productId = resolveProductRecordId(product);
        const nextDraft = normalizeWarehouseSequenceDraft(sequenceDrafts[key]);
        const nextSequence = Number(nextDraft);
        const currentSequence = resolveProductWarehouseSequence(product);

        if (!productUsesWarehouseSequence(product)) {
            setSequenceRowErrors((previous) => ({
                ...previous,
                [key]: 'Dòng này không dùng STT kho.',
            }));
            return;
        }

        if (!productId) {
            setSequenceRowErrors((previous) => ({
                ...previous,
                [key]: 'Không xác định được sản phẩm cần sửa.',
            }));
            return;
        }

        if (!nextDraft || !Number.isFinite(nextSequence) || nextSequence <= 0) {
            setSequenceRowErrors((previous) => ({
                ...previous,
                [key]: 'Nhập STT lớn hơn 0.',
            }));
            return;
        }

        if (currentSequence === nextSequence) return;

        setSequenceSavingKey(key);
        setSequenceRowErrors((previous) => {
            if (!previous[key]) return previous;

            const next = { ...previous };
            delete next[key];
            return next;
        });

        try {
            const response = await productApi.update(productId, { warehouse_sequence: nextSequence });
            const savedProduct = extractPayload(response);
            const savedSequence = resolveProductWarehouseSequence(savedProduct) || nextSequence;
            const skuKey = normalizeSkuKey(resolveProductSku(product));

            setSequenceRows((previous) => previous
                .map((row) => {
                    const rowKey = row.sequence_key || buildSequenceRowKey(row);
                    if (rowKey !== key) return row;

                    return {
                        ...row,
                        warehouse_sequence: savedSequence,
                        product_warehouse_sequence: savedSequence,
                        warehouse_pick_label: `${savedSequence} - ${resolveProductName(row) || resolveProductSku(row) || 'Sản phẩm'}`,
                    };
                })
                .sort((left, right) => {
                    const leftSequence = resolveProductWarehouseSequence(left);
                    const rightSequence = resolveProductWarehouseSequence(right);

                    if (leftSequence && rightSequence && leftSequence !== rightSequence) {
                        return leftSequence - rightSequence;
                    }
                    if (leftSequence && !rightSequence) return -1;
                    if (!leftSequence && rightSequence) return 1;

                    return resolveProductSku(left).localeCompare(resolveProductSku(right), 'vi');
                }));
            setSequenceDrafts((previous) => ({
                ...previous,
                [key]: String(savedSequence),
            }));
            setSearchResults((previous) => ({
                shelves: previous.shelves,
                locations: previous.locations.map((location) => {
                    const sameProduct = Number(location.product_id) === productId
                        || (skuKey && normalizeSkuKey(location.product_sku) === skuKey);
                    if (!sameProduct) return location;

                    return {
                        ...location,
                        warehouse_sequence: savedSequence,
                        product_warehouse_sequence: savedSequence,
                        warehouse_pick_label: `${savedSequence} - ${location.product_name || resolveProductName(location) || 'Sản phẩm'}`,
                    };
                }),
            }));

            await Promise.allSettled([
                selectedShelf?.id ? loadShelfDetail(selectedShelf.id) : Promise.resolve(),
                loadShelves(search.trim() ? { search: search.trim() } : {}),
            ]);
        } catch (error) {
            console.error('Error saving warehouse sequence', error);
            const sequenceMessage = error?.response?.data?.errors?.warehouse_sequence?.[0];
            setSequenceRowErrors((previous) => ({
                ...previous,
                [key]: sequenceMessage || extractFirstApiError(error, 'Không lưu được số thứ tự.'),
            }));
        } finally {
            setSequenceSavingKey('');
        }
    }, [
        loadShelfDetail,
        loadShelves,
        search,
        selectedShelf?.id,
        sequenceDrafts,
    ]);

    const updateSkuSearchFilter = useCallback((field, value) => {
        setSkuSearchFilters((previous) => {
            const next = { ...previous, [field]: value };

            if (field === 'attributeId') {
                next.attributeValue = '';
                if (String(next.attributeId2) === String(value)) {
                    next.attributeId2 = '';
                    next.attributeValue2 = '';
                }
            }

            if (field === 'attributeValue') {
                next.attributeValue2 = '';
            }

            if (field === 'attributeId2') {
                next.attributeValue2 = '';
            }

            return next;
        });
    }, []);

    const resetSkuProductSearch = useCallback(() => {
        setSkuSearchTerm('');
        setSkuSearchFilters((previous) => ({
            ...shelfProductSearchDefaultFilters,
            attributeId: previous.attributeId || String(productQuickFilterAttributes[0]?.id || ''),
        }));
    }, [productQuickFilterAttributes]);

    const appendProductSkuToFloor = useCallback((floorNumber, product) => {
        const sku = resolveProductSku(product);
        if (!sku) {
            setLastResult({ type: 'error', message: 'Sản phẩm này chưa có SKU để gán vào kệ.' });
            return;
        }

        setActiveSkuSearchFloor(floorNumber);
        setFloorDrafts((previous) => {
            const currentValue = previous[floorNumber] || '';
            const currentSkuKeys = new Set(splitSkuTokens(currentValue).map(normalizeSkuKey));
            const skuKey = normalizeSkuKey(sku);

            if (currentSkuKeys.has(skuKey)) return previous;

            const nextValue = currentValue.trimEnd()
                ? `${currentValue.trimEnd()}\n${sku}`
                : sku;

            return { ...previous, [floorNumber]: nextValue };
        });
        setLastResult({
            type: 'idle',
            message: `Đã thêm ${sku} vào ô nhập tầng ${floorNumber}. Bấm Lưu tất cả để ghi vị trí.`,
        });
    }, []);

    useEffect(() => {
        if (!selectedShelf?.id || !activeSkuSearchFloor) {
            setSkuSearchResults([]);
            setSkuSearchLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            const searchValue = skuSearchTerm.trim();
            const params = {
                picker: 1,
                fast_picker: 1,
                per_page: 80,
                allow_variants: 1,
                quick_filter_enabled: 1,
            };

            if (searchValue) {
                params.search = searchValue;
                params.filter_bundle_options_by_search = 1;
            }

            if (skuSearchFilters.type && skuSearchFilters.type !== 'variation') {
                params.type = skuSearchFilters.type;
            }

            if (skuSearchFilters.stock === 'in_stock') {
                params.min_stock = 1;
            }

            if (skuSearchFilters.stock === 'out_of_stock') {
                params.max_stock = 0;
            }

            appendShelfProductQuickFilterParams(params, activeProductQuickFilterAttribute, skuSearchFilters.attributeValue);
            appendShelfProductQuickFilterParams(params, activeProductQuickFilterAttribute2, skuSearchFilters.attributeValue2);

            setSkuSearchLoading(true);
            setSkuSearchError('');
            try {
                const response = await productApi.getAll(params, controller.signal);
                if (controller.signal.aborted) return;

                let entries = flattenProductPickerRows(extractProductRows(response));

                if (skuSearchFilters.type === 'variation') {
                    entries = entries.filter((entry) => entry.entry_kind === 'variation' || entry.parent_product_id);
                }

                if (skuSearchFilters.stock === 'in_stock') {
                    entries = entries.filter((entry) => {
                        const stock = resolveProductStock(entry);
                        return stock === null || stock > 0;
                    });
                }

                if (skuSearchFilters.stock === 'out_of_stock') {
                    entries = entries.filter((entry) => {
                        const stock = resolveProductStock(entry);
                        return stock !== null && stock <= 0;
                    });
                }

                setSkuSearchResults(entries.slice(0, 80));
            } catch (error) {
                if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return;
                console.error('Error searching products for shelf floor', error);
                setSkuSearchError(error.response?.data?.message || 'Không tìm được sản phẩm.');
                setSkuSearchResults([]);
            } finally {
                if (!controller.signal.aborted) {
                    setSkuSearchLoading(false);
                }
            }
        }, 260);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [
        activeProductQuickFilterAttribute,
        activeProductQuickFilterAttribute2,
        activeSkuSearchFloor,
        selectedShelf?.id,
        skuSearchFilters,
        skuSearchTerm,
    ]);

    const openCreateShelf = () => {
        setEditingShelf(null);
        setShelfForm({
            ...emptyShelfForm,
            code: nextShelfCode(shelves),
            name: `Kệ ${shelves.length + 1}`,
            warehouse_id: warehouses[0]?.id ? String(warehouses[0].id) : '',
        });
        setFormError('');
        setFormOpen(true);
    };

    const openEditShelf = (shelf) => {
        setEditingShelf(shelf);
        setShelfForm({
            warehouse_id: shelf.warehouse_id ? String(shelf.warehouse_id) : '',
            name: shelf.name || '',
            code: shelf.code || '',
            floor_count: shelf.floor_count || 4,
            is_active: Boolean(shelf.is_active),
            notes: shelf.notes || '',
        });
        setFormError('');
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditingShelf(null);
        setShelfForm(emptyShelfForm);
        setFormError('');
    };

    const updateShelfForm = (field, value) => {
        setShelfForm((previous) => ({ ...previous, [field]: value }));
    };

    const submitShelfForm = async (event) => {
        event?.preventDefault?.();
        setFormSaving(true);
        setFormError('');
        try {
            const payload = {
                ...shelfForm,
                warehouse_id: shelfForm.warehouse_id ? Number(shelfForm.warehouse_id) : null,
                floor_count: Number(shelfForm.floor_count) || 4,
                is_active: Boolean(shelfForm.is_active),
            };
            const response = editingShelf
                ? await warehouseShelfApi.update(editingShelf.id, payload)
                : await warehouseShelfApi.create(payload);
            const savedShelf = extractPayload(response);

            await loadShelves(search.trim() ? { search: search.trim() } : {});
            setSelectedShelfId(savedShelf?.id || editingShelf?.id || selectedShelfId);
            closeForm();
        } catch (error) {
            console.error('Error saving shelf', error);
            const messages = error.response?.data?.errors;
            const firstMessage = messages
                ? Object.values(messages).flat().filter(Boolean)[0]
                : null;
            setFormError(firstMessage || error.response?.data?.message || 'Không lưu được kệ.');
        } finally {
            setFormSaving(false);
        }
    };

    const deleteShelf = async (shelf) => {
        if (!window.confirm(`Xóa ${buildShelfTitle(shelf)}?`)) return;

        try {
            await warehouseShelfApi.destroy(shelf.id);
            if (Number(selectedShelfId) === Number(shelf.id)) {
                setSelectedShelfId(null);
                setSelectedShelf(null);
            }
            await loadShelves(search.trim() ? { search: search.trim() } : {});
        } catch (error) {
            const messages = error.response?.data?.errors;
            const firstMessage = messages
                ? Object.values(messages).flat().filter(Boolean)[0]
                : null;
            alert(firstMessage || error.response?.data?.message || 'Không xóa được kệ.');
        }
    };

    const updateFloorDraft = (floorNumber, value) => {
        setFloorDrafts((previous) => ({ ...previous, [floorNumber]: value }));
    };

    const saveAllFloors = async () => {
        if (!selectedShelf) return;
        const floors = Object.entries(floorDrafts).reduce((payload, [floorNumber, value]) => {
            if (countSkuTokens(value) > 0) {
                payload[floorNumber] = value || '';
            }
            return payload;
        }, {});

        if (Object.keys(floors).length === 0) {
            setLastResult({ type: 'idle', message: 'Chưa có mã nào trong các ô nhập.' });
            return;
        }

        setSavingFloor('all');
        setLastResult(null);
        try {
            const response = await warehouseShelfApi.assign(selectedShelf.id, {
                mode: 'merge',
                floors,
            });
            const result = extractPayload(response);
            setLastResult({
                type: 'success',
                mode: 'merge',
                ...result,
            });
            setFloorDrafts(createFloorDrafts(selectedShelf.floor_count || 4));
            await loadShelfDetail(selectedShelf.id);
            await loadShelves(search.trim() ? { search: search.trim() } : {});
        } catch (error) {
            console.error('Error assigning all shelf floors', error);
            const messages = error.response?.data?.errors;
            const firstMessage = messages
                ? Object.values(messages).flat().filter(Boolean)[0]
                : null;
            setLastResult({
                type: 'error',
                message: firstMessage || error.response?.data?.message || 'Không lưu được vị trí các tầng.',
            });
        } finally {
            setSavingFloor(null);
        }
    };

    const removeLocation = async (location) => {
        if (!window.confirm(`Xóa vị trí của mã ${location.product_sku || ''}?`)) return;

        try {
            await warehouseShelfApi.removeLocation(location.id);
            await loadShelfDetail(selectedShelf.id);
            await loadShelves(search.trim() ? { search: search.trim() } : {});
        } catch (error) {
            alert(error.response?.data?.message || 'Không xóa được vị trí sản phẩm.');
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 bg-[#f7f8f5]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-primary">Quản lý vị trí kệ</h1>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-primary/40">
                        Nhập SKU theo từng tầng và tra cứu vị trí nhặt hàng
                    </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button type="button" onClick={openSequenceManager} className={ghostButton}>
                        <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
                        Quản lý STT
                    </button>

                    <div className="relative min-w-0 sm:w-[360px]">
                        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className={`${inputClass} w-full pl-10 pr-10`}
                            placeholder="Tìm SKU, tên sản phẩm, mã kệ..."
                        />
                        {search ? (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-primary/40 transition hover:bg-primary/5 hover:text-primary"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        ) : null}
                    </div>

                    <button type="button" onClick={openCreateShelf} className={primaryButton}>
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Thêm kệ
                    </button>
                </div>
            </div>

            {pageError ? (
                <div className="rounded-sm border border-brick/20 bg-brick/5 px-4 py-3 text-[13px] font-bold text-brick">
                    {pageError}
                </div>
            ) : null}

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                <aside className={`${panelClass} flex min-h-0 flex-col overflow-hidden`}>
                    <div className="grid grid-cols-3 border-b border-primary/10 bg-[#fbfaf6]">
                        <div className="px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/35">Kệ</p>
                            <p className="mt-1 text-lg font-black text-primary">{shelves.length}</p>
                        </div>
                        <div className="border-x border-primary/10 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/35">Đang dùng</p>
                            <p className="mt-1 text-lg font-black text-primary">{shelfStats.activeShelves}</p>
                        </div>
                        <div className="px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/35">SKU</p>
                            <p className="mt-1 text-lg font-black text-primary">{shelfStats.totalProducts}</p>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto">
                        {loadingShelves ? (
                            <div className="flex h-40 items-center justify-center">
                                <span className="material-symbols-outlined animate-spin text-3xl text-primary/35">progress_activity</span>
                            </div>
                        ) : shelves.length === 0 ? (
                            <div className="p-8 text-center">
                                <span className="material-symbols-outlined text-4xl text-primary/25">shelves</span>
                                <p className="mt-3 text-[13px] font-bold text-primary/55">Chưa có kệ phù hợp</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-primary/10">
                                {shelves.map((shelf) => {
                                    const active = Number(selectedShelfId) === Number(shelf.id);
                                    return (
                                        <button
                                            key={shelf.id}
                                            type="button"
                                            onClick={() => setSelectedShelfId(shelf.id)}
                                            className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition ${active ? 'bg-primary/[0.06]' : 'hover:bg-primary/[0.035]'}`}
                                        >
                                            <div className="min-w-0">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className={`rounded-sm px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${active ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
                                                        {shelf.code}
                                                    </span>
                                                    {!shelf.is_active ? (
                                                        <span className="rounded-sm bg-brick/10 px-2 py-1 text-[10px] font-black text-brick">Tạm ngưng</span>
                                                    ) : null}
                                                </div>
                                                <p className="mt-2 truncate text-[14px] font-black text-primary">{shelf.name}</p>
                                                <p className="mt-1 truncate text-[11px] font-semibold text-primary/45">
                                                    {shelf.warehouse_name || 'Không gắn kho'} · {shelf.floor_count || 4} tầng
                                                </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="text-[15px] font-black text-primary">{shelf.locations_count || 0}</p>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35">mã</p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </aside>

                <main className="flex min-h-0 flex-col gap-4 overflow-hidden">
                    {search.trim() ? (
                        <section className={`${panelClass} shrink-0 overflow-hidden`}>
                            <div className="flex items-center justify-between border-b border-primary/10 bg-[#fbfaf6] px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[18px] text-primary/45">manage_search</span>
                                    <h2 className="text-[13px] font-black uppercase tracking-[0.12em] text-primary">Kết quả tra cứu</h2>
                                </div>
                                <span className="text-[11px] font-bold text-primary/45">{searchResults.locations.length} vị trí</span>
                            </div>
                            <div className="max-h-52 overflow-auto p-3">
                                {searchResults.locations.length === 0 ? (
                                    <p className="px-2 py-6 text-center text-[13px] font-bold text-primary/45">Chưa tìm thấy SKU đã khai báo vị trí.</p>
                                ) : (
                                    <div className="grid gap-2 md:grid-cols-2">
                                        {searchResults.locations.map((item) => {
                                            const sequence = resolveProductWarehouseSequence(item);
                                            const showsSequence = productUsesWarehouseSequence(item);

                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => setSelectedShelfId(item.shelf_id)}
                                                    className="flex min-w-0 items-start justify-between gap-3 rounded-sm border border-primary/10 bg-white p-3 text-left transition hover:border-primary/25 hover:bg-primary/[0.03]"
                                                >
                                                    <div className="flex min-w-0 gap-3">
                                                        {showsSequence ? (
                                                            <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-sm border border-gold/30 bg-[#fffaf0] px-2 text-[13px] font-black text-gold">
                                                                {sequence || '-'}
                                                            </span>
                                                        ) : null}
                                                        <div className="min-w-0">
                                                            <div className="flex min-w-0 items-center gap-2">
                                                                <span className="truncate text-[13px] font-black text-primary">{item.product_sku || 'Chưa có SKU'}</span>
                                                                {item.product_deleted ? (
                                                                    <span className="rounded-sm bg-brick/10 px-1.5 py-0.5 text-[10px] font-bold text-brick">Đã xóa</span>
                                                                ) : null}
                                                            </div>
                                                            <p className="mt-1 line-clamp-1 text-[12px] font-semibold text-primary/60">{item.warehouse_pick_label || item.product_name}</p>
                                                        </div>
                                                    </div>
                                                    <LocationBadge item={item} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </section>
                    ) : null}

                    <section className={`${panelClass} flex min-h-0 flex-1 flex-col overflow-hidden`}>
                        {!selectedShelf ? (
                            <div className="flex min-h-[360px] flex-1 items-center justify-center p-8 text-center">
                                {loadingDetail ? (
                                    <span className="material-symbols-outlined animate-spin text-4xl text-primary/30">progress_activity</span>
                                ) : (
                                    <div>
                                        <span className="material-symbols-outlined text-5xl text-primary/20">shelves</span>
                                        <p className="mt-3 text-[14px] font-bold text-primary/55">Chọn một kệ để xem sản phẩm theo tầng</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="flex flex-col gap-3 border-b border-primary/10 bg-[#fbfaf6] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="truncate text-xl font-black text-primary">{buildShelfTitle(selectedShelf)}</h2>
                                            <span className="rounded-sm border border-primary/10 bg-white px-2 py-1 text-[11px] font-black text-primary/55">{selectedShelf.floor_count} tầng</span>
                                            <span className="rounded-sm border border-primary/10 bg-white px-2 py-1 text-[11px] font-black text-primary/55">{selectedShelf.locations_count || 0} mã</span>
                                        </div>
                                        <p className="mt-1 truncate text-[12px] font-semibold text-primary/45">
                                            {selectedShelf.warehouse_name || 'Không gắn kho'}{selectedShelf.updated_at ? ` · Cập nhật ${formatDate(selectedShelf.updated_at)}` : ''}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => openEditShelf(selectedShelf)} className={ghostButton}>
                                            <span className="material-symbols-outlined text-[18px]">edit</span>
                                            Sửa kệ
                                        </button>
                                        <button type="button" onClick={saveAllFloors} disabled={savingFloor === 'all'} className={primaryButton}>
                                            <span className={`material-symbols-outlined text-[18px] ${savingFloor === 'all' ? 'animate-spin' : ''}`}>{savingFloor === 'all' ? 'progress_activity' : 'done_all'}</span>
                                            Lưu tất cả
                                        </button>
                                        <button type="button" onClick={() => deleteShelf(selectedShelf)} className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-brick/20 bg-white px-4 text-[12px] font-bold text-brick transition hover:bg-brick hover:text-white">
                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                            Xóa
                                        </button>
                                    </div>
                                </div>

                                {lastResult ? (
                                    <div className={`mx-4 mt-4 rounded-sm border px-4 py-3 text-[13px] font-bold ${lastResult.type === 'error' ? 'border-brick/20 bg-brick/5 text-brick' : 'border-primary/15 bg-primary/[0.04] text-primary'}`}>
                                        {lastResult.message || (
                                            (() => {
                                                const savedCount = Number(lastResult.assigned_count || 0)
                                                    + Number(lastResult.moved_count || 0)
                                                    + Number(lastResult.unchanged_count || 0);

                                                return (
                                                    <>
                                                        Đã lưu vị trí {savedCount} mã.
                                                        {lastResult.missing_skus?.length ? (
                                                            <span className="ml-2 text-brick">Không tìm thấy: {lastResult.missing_skus.join(', ')}</span>
                                                        ) : null}
                                                    </>
                                                );
                                            })()
                                        )}
                                    </div>
                                ) : null}

                                <div className="min-h-0 flex-1 overflow-auto p-4">
                                    {loadingDetail ? (
                                        <div className="flex h-48 items-center justify-center">
                                            <span className="material-symbols-outlined animate-spin text-4xl text-primary/30">progress_activity</span>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {selectedShelfFloors.map((floor) => {
                                                const draft = floorDrafts[floor.floor_number] || '';
                                                const draftCount = countSkuTokens(draft);

                                                return (
                                                    <section key={floor.floor_number} className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                                        <div className="flex flex-col gap-3 border-b border-primary/10 bg-primary/[0.025] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className="flex size-11 items-center justify-center rounded-sm bg-primary text-white">
                                                                    <span className="text-lg font-black">{floor.floor_number}</span>
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-[15px] font-black text-primary">Tầng {floor.floor_number}</h3>
                                                                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary/35">{floor.items_count || 0} mã đang đặt</p>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
                                                            <div className="flex min-w-0 flex-col gap-3">
                                                                <div className="rounded-sm border border-primary/10 bg-[#fbfaf6] p-2">
                                                                    <div className="flex h-10 items-center rounded-sm border border-primary/10 bg-white px-3 shadow-sm transition focus-within:border-primary/30">
                                                                        <span className="material-symbols-outlined mr-2 text-[17px] text-primary/35">search</span>
                                                                        <input
                                                                            type="text"
                                                                            value={activeSkuSearchFloor === floor.floor_number ? skuSearchTerm : ''}
                                                                            onFocus={() => setActiveSkuSearchFloor(floor.floor_number)}
                                                                            onChange={(event) => {
                                                                                setActiveSkuSearchFloor(floor.floor_number);
                                                                                setSkuSearchTerm(event.target.value);
                                                                            }}
                                                                            className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#0F172A] placeholder:text-primary/30 focus:outline-none"
                                                                            placeholder={`Tìm SKU/tên để thêm tầng ${floor.floor_number}`}
                                                                        />
                                                                        {activeSkuSearchFloor === floor.floor_number && skuSearchTerm ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setSkuSearchTerm('')}
                                                                                className="ml-2 inline-flex size-7 items-center justify-center rounded-sm text-primary/35 transition hover:bg-primary/5 hover:text-brick"
                                                                                title="Xóa tìm kiếm"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                                            </button>
                                                                        ) : null}
                                                                        <span className={`ml-2 inline-flex size-7 items-center justify-center rounded-sm border border-primary/10 ${activeSkuSearchFilterCount > 0 ? 'bg-primary text-white' : 'bg-primary/[0.03] text-primary/40'}`} title="Bộ lọc">
                                                                            <span className="material-symbols-outlined text-[15px]">tune</span>
                                                                        </span>
                                                                    </div>

                                                                    {activeSkuSearchFloor === floor.floor_number ? (
                                                                        <>
                                                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                                                <div className="inline-flex h-9 min-w-[145px] items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">
                                                                                    <span className="material-symbols-outlined text-[16px]">storefront</span>
                                                                                    <span className="truncate">Nguồn SP</span>
                                                                                </div>
                                                                                <select
                                                                                    value={skuSearchFilters.type}
                                                                                    onFocus={() => setActiveSkuSearchFloor(floor.floor_number)}
                                                                                    onChange={(event) => {
                                                                                        setActiveSkuSearchFloor(floor.floor_number);
                                                                                        updateSkuSearchFilter('type', event.target.value);
                                                                                    }}
                                                                                    className={`${inputClass} min-w-[145px] flex-1`}
                                                                                >
                                                                                    {shelfProductTypeOptions.map((option) => (
                                                                                        <option key={option.value || 'all'} value={option.value}>
                                                                                            {option.label}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                                <select
                                                                                    value={skuSearchFilters.stock}
                                                                                    onFocus={() => setActiveSkuSearchFloor(floor.floor_number)}
                                                                                    onChange={(event) => {
                                                                                        setActiveSkuSearchFloor(floor.floor_number);
                                                                                        updateSkuSearchFilter('stock', event.target.value);
                                                                                    }}
                                                                                    className={`${inputClass} min-w-[130px] flex-1`}
                                                                                >
                                                                                    {shelfStockFilterOptions.map((option) => (
                                                                                        <option key={option.value || 'all-stock'} value={option.value}>
                                                                                            {option.label}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                                {productQuickFilterAttributes.length > 0 ? (
                                                                                    <select
                                                                                        value={skuSearchFilters.attributeId}
                                                                                        onFocus={() => setActiveSkuSearchFloor(floor.floor_number)}
                                                                                        onChange={(event) => {
                                                                                            setActiveSkuSearchFloor(floor.floor_number);
                                                                                            updateSkuSearchFilter('attributeId', event.target.value);
                                                                                        }}
                                                                                        className={`${inputClass} min-w-[160px] flex-1`}
                                                                                    >
                                                                                        {productQuickFilterAttributes.map((attribute) => (
                                                                                            <option key={attribute.id} value={attribute.id}>
                                                                                                Lọc nhanh: {attribute.name}
                                                                                            </option>
                                                                                        ))}
                                                                                    </select>
                                                                                ) : null}
                                                                                {skuSearchFilters.attributeValue && productQuickFilterAttributes.length > 1 ? (
                                                                                    <select
                                                                                        value={skuSearchFilters.attributeId2}
                                                                                        onFocus={() => setActiveSkuSearchFloor(floor.floor_number)}
                                                                                        onChange={(event) => {
                                                                                            setActiveSkuSearchFloor(floor.floor_number);
                                                                                            updateSkuSearchFilter('attributeId2', event.target.value);
                                                                                        }}
                                                                                        className={`${inputClass} min-w-[150px] flex-1`}
                                                                                    >
                                                                                        <option value="">Lọc 2</option>
                                                                                        {productQuickFilterAttributes
                                                                                            .filter((attribute) => String(attribute.id) !== String(skuSearchFilters.attributeId))
                                                                                            .map((attribute) => (
                                                                                                <option key={attribute.id} value={attribute.id}>
                                                                                                    {attribute.name}
                                                                                                </option>
                                                                                            ))}
                                                                                    </select>
                                                                                ) : null}
                                                                                {(skuSearchTerm || activeSkuSearchFilterCount > 0) ? (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setActiveSkuSearchFloor(floor.floor_number);
                                                                                            resetSkuProductSearch();
                                                                                        }}
                                                                                        className="inline-flex h-9 items-center justify-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45 transition hover:border-brick/20 hover:text-brick"
                                                                                    >
                                                                                        <span className="material-symbols-outlined text-[14px]">close</span>
                                                                                        Xóa lọc
                                                                                    </button>
                                                                                ) : null}
                                                                            </div>

                                                                            {activeProductQuickFilterAttribute?.options?.length ? (
                                                                                <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-1">
                                                                                    {activeProductQuickFilterAttribute.options.map((option) => {
                                                                                        const isSelected = skuSearchFilters.attributeValue === option.value;

                                                                                        return (
                                                                                            <button
                                                                                                key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    setActiveSkuSearchFloor(floor.floor_number);
                                                                                                    updateSkuSearchFilter('attributeValue', isSelected ? '' : option.value);
                                                                                                }}
                                                                                                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/65 hover:border-primary/25 hover:bg-white'}`}
                                                                                            >
                                                                                                <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                                                                <span>{option.label || option.value}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            ) : null}

                                                                            {activeProductQuickFilterAttribute2Options.length > 0 ? (
                                                                                <div className="custom-scrollbar mt-2 flex gap-1.5 overflow-x-auto border-t border-primary/5 pt-2 pb-1">
                                                                                    {activeProductQuickFilterAttribute2Options.map((option) => {
                                                                                        const isSelected = skuSearchFilters.attributeValue2 === option.value;

                                                                                        return (
                                                                                            <button
                                                                                                key={`${activeProductQuickFilterAttribute2.id}-${option.id || option.value}`}
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    setActiveSkuSearchFloor(floor.floor_number);
                                                                                                    updateSkuSearchFilter('attributeValue2', isSelected ? '' : option.value);
                                                                                                }}
                                                                                                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${isSelected ? 'border-brick bg-brick text-white shadow-sm' : 'border-brick/10 bg-white text-brick/70 hover:border-brick/25 hover:bg-brick/5'}`}
                                                                                            >
                                                                                                <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                                                                <span>{option.label || option.value}</span>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            ) : null}

                                                                            <div className="mt-2 overflow-hidden rounded-sm border border-primary/10 bg-white">
                                                                            {activeSkuSearchFilterPills.length > 0 ? (
                                                                                <div className="flex flex-wrap gap-1.5 border-b border-primary/10 bg-primary/[0.025] px-2 py-2">
                                                                                    {activeSkuSearchFilterPills.map((pill) => (
                                                                                        <span key={pill.key} className="inline-flex max-w-full items-center rounded-full border border-primary/10 bg-white px-2 py-1 text-[10px] font-bold text-primary/55">
                                                                                            <span className="truncate">{pill.label}</span>
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            ) : null}

                                                                            {skuSearchLoading ? (
                                                                                <div className="flex h-24 items-center justify-center gap-2 text-[12px] font-bold text-primary/45">
                                                                                    <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                                                                    Đang tìm sản phẩm...
                                                                                </div>
                                                                            ) : skuSearchError ? (
                                                                                <div className="px-3 py-4 text-[12px] font-bold text-brick">{skuSearchError}</div>
                                                                            ) : skuSearchResults.length > 0 ? (
                                                                                <div className="max-h-72 overflow-auto">
                                                                                    {skuSearchResults.map((product) => {
                                                                                        const sku = resolveProductSku(product);
                                                                                        const skuKey = normalizeSkuKey(sku);
                                                                                        const draftSkuKeys = new Set(splitSkuTokens(draft).map(normalizeSkuKey));
                                                                                        const floorSkuKeys = new Set((floor.items || []).map((item) => normalizeSkuKey(item.product_sku)));
                                                                                        const alreadyQueued = skuKey && draftSkuKeys.has(skuKey);
                                                                                        const alreadyOnFloor = skuKey && floorSkuKeys.has(skuKey);
                                                                                        const disabled = !sku || alreadyQueued || alreadyOnFloor;
                                                                                        const stock = resolveProductStock(product);
                                                                                        const image = resolveProductImage(product);
                                                                                        const sequence = resolveProductWarehouseSequence(product);
                                                                                        const showsSequence = productUsesWarehouseSequence(product);

                                                                                        return (
                                                                                            <button
                                                                                                key={`${product.entry_kind || 'product'}-${product.id || sku}`}
                                                                                                type="button"
                                                                                                onClick={() => appendProductSkuToFloor(floor.floor_number, product)}
                                                                                                disabled={disabled}
                                                                                                className={`flex w-full items-start justify-between gap-3 border-b border-primary/5 px-3 py-3 text-left transition last:border-b-0 disabled:cursor-not-allowed disabled:opacity-55 ${disabled ? 'bg-primary/[0.015]' : 'hover:bg-primary/[0.035]'}`}
                                                                                            >
                                                                                                <div className="flex min-w-0 flex-1 gap-3">
                                                                                                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-primary/10 bg-primary/[0.04]">
                                                                                                        {image ? (
                                                                                                            <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
                                                                                                        ) : (
                                                                                                            <span className="material-symbols-outlined text-[18px] text-primary/30">inventory_2</span>
                                                                                                        )}
                                                                                                    </div>
                                                                                                    <div className="min-w-0">
                                                                                                        <div className="flex min-w-0 items-start gap-2">
                                                                                                            {showsSequence ? (
                                                                                                                <span className="mt-0.5 flex min-w-7 shrink-0 items-center justify-center rounded-sm border border-gold/25 bg-[#fffaf0] px-1.5 text-[11px] font-black text-gold">
                                                                                                                    {sequence || '-'}
                                                                                                                </span>
                                                                                                            ) : null}
                                                                                                            <p className="line-clamp-2 text-[13px] font-black leading-[1.35] text-primary">{resolveProductName(product) || 'Sản phẩm chưa đặt tên'}</p>
                                                                                                        </div>
                                                                                                        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-primary/45">
                                                                                                            <span className="rounded-full border border-primary/10 bg-white px-2 py-0.5 font-mono">{sku || 'Chưa có SKU'}</span>
                                                                                                            <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">{getProductTypeLabel(product)}</span>
                                                                                                            {product.option_label ? (
                                                                                                                <span className="rounded-full border border-primary/10 bg-primary/[0.03] px-2 py-0.5">{product.option_label}</span>
                                                                                                            ) : null}
                                                                                                            {stock !== null ? (
                                                                                                                <span className={`rounded-full border border-primary/10 bg-white px-2 py-0.5 font-black ${stock > 0 ? 'text-emerald-700' : 'text-brick'}`}>
                                                                                                                    Còn {formatQuantity(stock)}
                                                                                                                </span>
                                                                                                            ) : null}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                </div>
                                                                                                <div className={`shrink-0 text-[10px] font-black uppercase tracking-[0.12em] ${disabled ? 'text-primary/30' : 'text-blue-600'}`}>
                                                                                                    {alreadyOnFloor ? 'Đã ở tầng' : (alreadyQueued ? 'Đã thêm' : 'Thêm')}
                                                                                                </div>
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            ) : (
                                                                                <div className="px-3 py-6 text-center text-[12px] font-bold text-primary/35">
                                                                                    Không có sản phẩm phù hợp
                                                                                </div>
                                                                            )}
                                                                            </div>
                                                                        </>
                                                                    ) : null}
                                                                </div>

                                                                <textarea
                                                                    value={draft}
                                                                    onChange={(event) => updateFloorDraft(floor.floor_number, event.target.value)}
                                                                    className={`${textareaClass} w-full font-mono`}
                                                                    placeholder={`Dán SKU cho tầng ${floor.floor_number}`}
                                                                />
                                                                <div className="flex items-center justify-between text-[11px] font-bold text-primary/45">
                                                                    <span>{draftCount} mã trong ô nhập</span>
                                                                    {draft ? (
                                                                        <button type="button" onClick={() => updateFloorDraft(floor.floor_number, '')} className="text-brick transition hover:text-umber">
                                                                            Xóa ô nhập
                                                                        </button>
                                                                    ) : null}
                                                                </div>
                                                            </div>

                                                            <div className="min-w-0 overflow-hidden rounded-sm border border-primary/10">
                                                                {floor.items?.length ? (
                                                                    <div className="max-h-72 overflow-auto">
                                                                        <table className="w-full table-fixed text-left">
                                                                            <thead className="sticky top-0 bg-[#fbfaf6] text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                                <tr>
                                                                                    <th className="w-[78px] px-3 py-2 text-center">STT</th>
                                                                                    <th className="w-[25%] px-3 py-2">SKU</th>
                                                                                    <th className="px-3 py-2">Sản phẩm</th>
                                                                                    <th className="w-[120px] px-3 py-2 text-right">#</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-primary/10 text-[13px]">
                                                                                {floor.items.map((item) => {
                                                                                    const sequence = resolveProductWarehouseSequence(item);
                                                                                    const showsSequence = productUsesWarehouseSequence(item);

                                                                                    return (
                                                                                        <tr key={item.id} className="hover:bg-primary/[0.025]">
                                                                                            <td className="px-3 py-2 text-center align-top">
                                                                                                {showsSequence ? (
                                                                                                    <span className="inline-flex min-w-8 items-center justify-center rounded-sm border border-gold/25 bg-[#fffaf0] px-2 py-1 text-[12px] font-black text-gold">
                                                                                                        {sequence || '-'}
                                                                                                    </span>
                                                                                                ) : null}
                                                                                            </td>
                                                                                            <td className="px-3 py-2 align-top">
                                                                                                <span className="break-words font-mono text-[12px] font-black text-primary">{item.product_sku || 'N/A'}</span>
                                                                                            </td>
                                                                                            <td className="px-3 py-2 align-top">
                                                                                                <div className="min-w-0">
                                                                                                    <p className="line-clamp-2 font-bold text-primary">{item.warehouse_pick_label || item.product_name || 'Sản phẩm không xác định'}</p>
                                                                                                    <p className="mt-0.5 text-[11px] font-semibold text-primary/40">
                                                                                                        {item.product_unit_name || 'Chưa có ĐVT'}{item.position_note ? ` · ${item.position_note}` : ''}
                                                                                                    </p>
                                                                                                </div>
                                                                                            </td>
                                                                                            <td className="px-3 py-2 text-right align-top">
                                                                                                <button type="button" onClick={() => removeLocation(item)} className={dangerIconButton} title="Xóa khỏi tầng">
                                                                                                    <span className="material-symbols-outlined text-[17px]">delete</span>
                                                                                                </button>
                                                                                            </td>
                                                                                        </tr>
                                                                                    );
                                                                                })}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex h-full min-h-[118px] items-center justify-center px-4 py-8 text-center text-[13px] font-bold text-primary/35">
                                                                        Tầng này chưa có mã sản phẩm
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </section>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </section>
                </main>
            </div>

            <ShelfFormModal
                open={formOpen}
                form={shelfForm}
                warehouses={warehouses}
                editing={Boolean(editingShelf)}
                saving={formSaving}
                error={formError}
                onChange={updateShelfForm}
                onClose={closeForm}
                onSubmit={submitShelfForm}
            />

            <SequenceManagerModal
                open={sequenceManagerOpen}
                search={sequenceSearch}
                rows={sequenceRows}
                drafts={sequenceDrafts}
                loading={sequenceLoading}
                savingKey={sequenceSavingKey}
                error={sequenceError}
                rowErrors={sequenceRowErrors}
                selectedKeys={sequenceSelectedKeys}
                categoryOptions={categories}
                filterAttributes={productQuickFilterAttributes}
                filters={sequenceFilters}
                filterPills={activeSequenceFilterPills}
                filterCount={activeSequenceFilterCount}
                activeFilterAttribute={activeSequenceFilterAttribute}
                activeFilterAttribute2Options={activeSequenceFilterAttribute2Options}
                quickSetupOpen={sequenceQuickSetupOpen}
                onSearchChange={setSequenceSearch}
                onDraftChange={updateSequenceDraft}
                onSave={saveSequenceRow}
                onReload={() => loadSequenceRows(sequenceSearch)}
                onFilterChange={updateSequenceFilter}
                onResetFilters={resetSequenceFilters}
                onToggleQuickSetup={() => setSequenceQuickSetupOpen((previous) => !previous)}
                onToggleRow={toggleSequenceRowSelection}
                onToggleAllRows={toggleAllSequenceRows}
                onPrintSelected={printSelectedSequenceRows}
                onPrintLabelsSelected={printSelectedSequenceLabels}
                onClose={() => setSequenceManagerOpen(false)}
            />
        </div>
    );
};

export default WarehouseShelfManager;
