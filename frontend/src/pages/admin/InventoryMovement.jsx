import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import SortIndicator from '../../components/SortIndicator';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import { DEFAULT_INVENTORY_SECTION_KEY, buildInventoryPath, resolveInventorySectionKey } from '../../config/adminInventoryNavigation';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import { useTableColumns } from '../../hooks/useTableColumns';
import { ACTIVE_PRODUCT_TYPE_OPTIONS } from '../../config/productTypes';
import { aiApi, attributeApi, categoryApi, cmsApi, inventoryApi, orderApi, productApi } from '../../services/api';
import BatchReturnSlipModal from '../../components/admin/BatchReturnSlipModal';
import InventoryProductDailyOutboundDrawer from '../../components/admin/InventoryProductDailyOutboundDrawer';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import {
    formatRoundedImportCost,
    formatWholeMoneyInput,
    normalizeRoundedImportCostDraft,
    normalizeRoundedImportCostNumber,
    normalizeWholeMoneyDraft,
    normalizeWholeMoneyNumber,
    parseWholeMoneyValue,
} from '../../utils/money';

const emptyPagination = { current_page: 1, last_page: 1, total: 0, per_page: 20 };
const todayValue = new Date().toISOString().slice(0, 10);
const tableViewportClass = 'max-h-[calc(100vh-310px)] overflow-auto';
const stretchedTableViewportClass = 'min-h-0 flex-1 overflow-auto';
const panelClass = 'overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm';
const inputClass = 'h-8 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const selectClass = `${inputClass} pr-8`;
const primaryButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm bg-brick px-3 text-[12px] font-bold text-white transition hover:bg-umber disabled:cursor-not-allowed disabled:opacity-60';
const ghostButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-brick/20 bg-white px-3 text-[12px] font-bold text-brick transition hover:bg-brick hover:text-white disabled:cursor-not-allowed disabled:opacity-60';
const iconButton = (active) => `inline-flex h-8 w-8 items-center justify-center rounded-sm border transition ${active ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/5'}`;
const compactIconButton = (active) => `inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition ${active ? 'border-primary/35 bg-primary/10 text-primary' : 'border-transparent bg-transparent text-primary/55 hover:border-primary/15 hover:bg-primary/[0.05] hover:text-primary'}`;
const checkboxClass = 'size-4 rounded border-primary/20 accent-primary';
const importFieldClass = 'h-8 rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const importSelectClass = `${importFieldClass} pr-8`;
const importFieldLabelClass = 'mb-1 text-[12px] font-black uppercase tracking-[0.1em] text-primary/50';
const inventorySearchCache = new Map();
const COPY_FEEDBACK_RESET_MS = 1800;
const isCanceledRequest = (error) => (
    error?.name === 'CanceledError'
    || error?.code === 'ERR_CANCELED'
    || error?.message === 'canceled'
);

const copyTextToClipboard = async (value) => {
    const text = String(value ?? '').trim();
    if (!text) return;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    if (typeof document === 'undefined') {
        throw new Error('Clipboard API is unavailable');
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!copied) {
        throw new Error('Clipboard copy failed');
    }
};
const INVENTORY_SEARCH_CACHE_LIMIT = 80;
const INVENTORY_SEARCH_CACHE_TTL = 60 * 1000;
const IMPORT_PRINT_SETTINGS_KEY = 'inventory_import_print_templates';
const IMPORT_PRINT_DEFAULT_TEMPLATE_ID = 'inventory_import_default_template';
const IMPORT_PRINT_DEFAULT_TEMPLATE_NAME = 'Bản chính';
const IMPORT_MODAL_DRAFT_STORAGE_KEY = 'inventory_import_modal_draft_v1';
const IMPORT_PRINT_MODE_PUTAWAY = 'putaway';
const IMPORT_PRINT_MODE_STANDARD = 'standard';

const documentTabs = [
    ['imports', 'Phiếu nhập'],
    ['exports', 'Phiếu xuất'],
    ['returns', 'Phiếu hoàn'],
    ['damaged', 'Phiếu hỏng'],
    ['adjustments', 'Phiếu điều chỉnh'],
];
const slipSelectionTabKeys = ['imports', 'exports', 'returns', 'damaged', 'adjustments', 'trash'];
const createEmptySlipSelection = () => slipSelectionTabKeys.reduce((result, key) => {
    result[key] = {};
    return result;
}, {});
const trashSlipTypeLabels = {
    import: 'Phiếu nhập',
    export: 'Phiếu xuất',
    return: 'Phiếu hoàn',
    damaged: 'Phiếu hỏng',
    adjustment: 'Phiếu điều chỉnh',
};

const INVENTORY_TRACKING_WINDOW_DAYS = 15;
const PRODUCT_FILTER_PRESETS_STORAGE_KEY = 'inventory_product_filter_presets_v1';
const PRODUCT_SEARCH_HISTORY_STORAGE_KEY = 'inventory_product_search_history_v1';
const productMultiFilterKeys = ['status', 'cost_source', 'stock_alert', 'type', 'category_id', 'variant_scope'];
const normalizeStringFilterList = (value) => {
    const rawValues = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(',') : []);

    return Array.from(new Set(rawValues
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)));
};
const createDefaultProductFilters = () => ({
    search: '',
    ids: [],
    status: [],
    cost_source: [],
    stock_alert: [],
    type: [],
    category_id: [],
    variant_scope: [],
    import_starred: '',
    tracking_mode: '',
    tracking_daily_min: '1',
    date_from: '',
    date_to: '',
});
const defaultProductFilters = createDefaultProductFilters();
const defaultSupplierFilters = { search: '', status: '', month: '', date_from: '', date_to: '' };
const defaultSupplierCatalogFilters = { sku: '', name: '', category_id: '', type: '', variant_scope: '', missing_supplier_price: '', multiple_suppliers: '', supplier_ids: [] };
const ALL_SUPPLIER_CATALOG_VALUE = 'all';
const createDefaultSimpleFilters = () => ({
    imports: { search: '', date_from: '', date_to: '', inventory_import_status_id: '', entry_mode: '', has_invoice: '' },
    exports: { search: '', date_from: '', date_to: '', export_kind: '' },
    returns: { search: '', date_from: '', date_to: '' },
    damaged: { search: '', date_from: '', date_to: '' },
    adjustments: { search: '', date_from: '', date_to: '' },
    lots: { search: '', date_from: '', date_to: '' },
    trash: { search: '', date_from: '', date_to: '' },
});

const filterOptionLabel = (options, value) => options.find((option) => String(option.value) === String(value))?.label || String(value || '');
const summarizeOptionLabels = (options, values, emptyLabel = '') => {
    const selectedValues = normalizeStringFilterList(values);
    if (!selectedValues.length) return emptyLabel;

    const labelMap = new Map(options.map((option) => [String(option.value), option.label]));
    const labels = selectedValues.map((value) => labelMap.get(String(value)) || String(value));
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
};
const normalizeProductFilters = (filters = {}) => {
    const defaults = createDefaultProductFilters();
    const normalized = {
        ...defaults,
        ...filters,
        search: String(filters?.search ?? '').trimStart(),
        import_starred: ['1', 'true', 'yes', 'on'].includes(String(filters?.import_starred ?? filters?.inventory_import_starred ?? '').trim().toLowerCase()) ? '1' : '',
        tracking_mode: String(filters?.tracking_mode ?? '').trim(),
        tracking_daily_min: String(filters?.tracking_daily_min ?? defaults.tracking_daily_min).trim() || defaults.tracking_daily_min,
        date_from: String(filters?.date_from ?? '').trim(),
        date_to: String(filters?.date_to ?? '').trim(),
    };

    productMultiFilterKeys.forEach((key) => {
        normalized[key] = normalizeStringFilterList(filters?.[key]);
    });
    normalized.ids = normalizeStringFilterList(filters?.ids)
        .filter((id) => Number.isFinite(Number(id)) && Number(id) > 0);

    return normalized;
};
const createProductFilterPresetId = () => `inventory_product_filter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const normalizeProductFilterPreset = (preset) => {
    if (!preset || typeof preset !== 'object') return null;
    const name = String(preset.name || '').trim();
    if (!name) return null;

    return {
        id: String(preset.id || createProductFilterPresetId()),
        name,
        filters: normalizeProductFilters(preset.filters || {}),
        saved_at: preset.saved_at || new Date().toISOString(),
    };
};
const getProductFilterPresetStorageKey = () => {
    if (typeof window === 'undefined') return PRODUCT_FILTER_PRESETS_STORAGE_KEY;
    const accountId = Number(window.localStorage.getItem('activeAccountId') || 0);
    return accountId > 0
        ? `${PRODUCT_FILTER_PRESETS_STORAGE_KEY}_account_${accountId}`
        : PRODUCT_FILTER_PRESETS_STORAGE_KEY;
};
const readProductFilterPresets = () => {
    if (typeof window === 'undefined') return [];

    try {
        const parsed = JSON.parse(window.localStorage.getItem(getProductFilterPresetStorageKey()) || '[]');
        return Array.isArray(parsed)
            ? parsed.map(normalizeProductFilterPreset).filter(Boolean)
            : [];
    } catch (error) {
        window.localStorage.removeItem(getProductFilterPresetStorageKey());
        return [];
    }
};
const writeProductFilterPresets = (presets) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getProductFilterPresetStorageKey(), JSON.stringify(presets));
};
const getProductSearchHistoryStorageKey = () => {
    if (typeof window === 'undefined') return PRODUCT_SEARCH_HISTORY_STORAGE_KEY;
    const accountId = Number(window.localStorage.getItem('activeAccountId') || 0);
    return accountId > 0
        ? `${PRODUCT_SEARCH_HISTORY_STORAGE_KEY}_account_${accountId}`
        : PRODUCT_SEARCH_HISTORY_STORAGE_KEY;
};
const normalizeProductSearchHistoryItem = (value) => String(value ?? '').trim();
const normalizeProductSearchHistoryItems = (items = []) => {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
        .map(normalizeProductSearchHistoryItem)
        .filter((item) => {
            const key = normalizeSearchText(item);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 12);
};
const readProductSearchHistory = () => {
    if (typeof window === 'undefined') return [];

    try {
        const parsed = JSON.parse(window.localStorage.getItem(getProductSearchHistoryStorageKey()) || '[]');
        return normalizeProductSearchHistoryItems(parsed);
    } catch (error) {
        window.localStorage.removeItem(getProductSearchHistoryStorageKey());
        return [];
    }
};
const writeProductSearchHistory = (items) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getProductSearchHistoryStorageKey(), JSON.stringify(normalizeProductSearchHistoryItems(items)));
};
const IMPORT_QUICK_FILTER_PRESETS_STORAGE_KEY = 'inventory_import_quick_filter_presets_v1';
const supportedImportQuickFilterTypes = new Set(['select', 'multiselect']);
const normalizeImportQuickOptionValue = (value) => String(value ?? '').trim();
const normalizeImportQuickOptionKey = (value) => normalizeImportQuickOptionValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
const normalizeImportQuickFilterOption = (option, index = 0, attributeId = '') => {
    const rawValue = option && typeof option === 'object'
        ? (option.value ?? option.label)
        : option;
    const value = normalizeImportQuickOptionValue(rawValue);
    if (!value) return null;

    const rawLabel = option && typeof option === 'object'
        ? (option.label ?? option.value)
        : option;

    return {
        ...(option && typeof option === 'object' ? option : {}),
        id: option && typeof option === 'object' && option.id ? option.id : `${attributeId}_${index}_${normalizeImportQuickOptionKey(value)}`,
        value,
        label: normalizeImportQuickOptionValue(rawLabel) || value,
    };
};
const normalizeImportQuickFilterOptionsList = (options = [], attributeId = '') => {
    const seenValues = new Set();

    return (Array.isArray(options) ? options : [])
        .map((option, index) => normalizeImportQuickFilterOption(option, index, attributeId))
        .filter((option) => {
            const valueKey = normalizeImportQuickOptionKey(option?.value);
            if (!valueKey || seenValues.has(valueKey)) return false;

            seenValues.add(valueKey);
            return true;
        });
};
const buildImportQuickFilterAttributes = (attributes = []) => {
    const normalizedAttributes = (Array.isArray(attributes) ? attributes : [])
        .filter((attribute) => Number.isFinite(Number(attribute?.id)) && Number(attribute.id) > 0)
        .filter((attribute) => supportedImportQuickFilterTypes.has(attribute?.frontend_type))
        .map((attribute) => ({
            ...attribute,
            options: normalizeImportQuickFilterOptionsList(
                attribute?.options || attribute?.attribute_options || attribute?.attributeOptions || [],
                attribute?.id
            ),
        }))
        .filter((attribute) => attribute.options.length > 0);

    const backendPreferredAttributes = normalizedAttributes.filter(
        (attribute) => attribute.is_filterable_backend || attribute.is_filterable || attribute.is_filterable_frontend
    );

    return (backendPreferredAttributes.length > 0 ? backendPreferredAttributes : normalizedAttributes)
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'));
};
const mergeImportQuickFilterAttributes = (...sources) => {
    const merged = new Map();

    sources.flatMap((source) => (Array.isArray(source) ? source : [])).forEach((attribute) => {
        if (!attribute) return;
        const key = Number.isFinite(Number(attribute.id)) && Number(attribute.id) > 0
            ? `id:${attribute.id}`
            : (attribute.code ? `code:${attribute.code}` : '');
        if (!key) return;

        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...attribute });
            return;
        }

        merged.set(key, {
            ...existing,
            ...attribute,
            options: normalizeImportQuickFilterOptionsList([
                ...(existing.options || []),
                ...(attribute.options || []),
            ], attribute.id || existing.id),
            is_filterable: existing.is_filterable || attribute.is_filterable,
            is_filterable_backend: existing.is_filterable_backend || attribute.is_filterable_backend,
            is_filterable_frontend: existing.is_filterable_frontend || attribute.is_filterable_frontend,
        });
    });

    return Array.from(merged.values());
};
const createDefaultImportQuickFilters = () => ({
    category_id: '',
    attributes: {},
});
const normalizeImportQuickAttributeFilters = (attributes = {}) => {
    if (!attributes || typeof attributes !== 'object') return {};

    return Object.entries(attributes).reduce((normalized, [attributeId, values]) => {
        const normalizedValues = normalizeStringFilterList(values);
        if (normalizedValues.length) {
            normalized[String(attributeId)] = normalizedValues;
        }
        return normalized;
    }, {});
};
const normalizeImportQuickFilters = (filters = {}) => ({
    category_id: String(filters?.category_id ?? '').trim(),
    attributes: normalizeImportQuickAttributeFilters(filters?.attributes || {}),
});
const hasImportQuickFilters = (filters = {}) => {
    const normalized = normalizeImportQuickFilters(filters);
    return Boolean(normalized.category_id || Object.values(normalized.attributes).some((values) => values.length > 0));
};
const countImportQuickFilters = (filters = {}) => {
    const normalized = normalizeImportQuickFilters(filters);
    return (normalized.category_id ? 1 : 0)
        + Object.values(normalized.attributes).reduce((total, values) => total + values.length, 0);
};
const serializeImportQuickFilters = (filters = {}) => JSON.stringify(normalizeImportQuickFilters(filters));
const createImportQuickFilterPresetId = () => `inventory_import_quick_filter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const normalizeImportQuickFilterPreset = (preset) => {
    if (!preset || typeof preset !== 'object') return null;
    const name = String(preset.name || '').trim();
    if (!name) return null;

    return {
        id: String(preset.id || createImportQuickFilterPresetId()),
        name,
        filters: normalizeImportQuickFilters(preset.filters || {}),
        saved_at: preset.saved_at || new Date().toISOString(),
    };
};
const getImportQuickFilterPresetStorageKey = () => {
    if (typeof window === 'undefined') return IMPORT_QUICK_FILTER_PRESETS_STORAGE_KEY;
    const accountId = Number(window.localStorage.getItem('activeAccountId') || 0);
    return accountId > 0
        ? `${IMPORT_QUICK_FILTER_PRESETS_STORAGE_KEY}_account_${accountId}`
        : IMPORT_QUICK_FILTER_PRESETS_STORAGE_KEY;
};
const readImportQuickFilterPresets = () => {
    if (typeof window === 'undefined') return [];

    try {
        const parsed = JSON.parse(window.localStorage.getItem(getImportQuickFilterPresetStorageKey()) || '[]');
        return Array.isArray(parsed)
            ? parsed.map(normalizeImportQuickFilterPreset).filter(Boolean)
            : [];
    } catch (error) {
        window.localStorage.removeItem(getImportQuickFilterPresetStorageKey());
        return [];
    }
};
const writeImportQuickFilterPresets = (presets) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getImportQuickFilterPresetStorageKey(), JSON.stringify(presets));
};
const normalizeSupplierFilterIds = (value) => {
    const rawValues = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(',') : []);

    return Array.from(new Set(rawValues
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)));
};
const buildFilterChip = (key, label, value, onRemove) => {
    const normalizedValue = typeof value === 'string' ? value.trim() : value;
    if (normalizedValue == null || normalizedValue === '') return null;
    return { key, label, value: String(normalizedValue), onRemove };
};
const formatMonthFilterValue = (value) => {
    const matched = String(value || '').match(/^(\d{4})-(\d{2})$/);
    if (!matched) return value;
    return `${matched[2]}/${matched[1]}`;
};

const productStatusFilterOptions = [
    { value: 'active', label: 'Đang bán' },
    { value: 'inactive', label: 'Ngừng bán' },
];
const productCostSourceFilterOptions = [
    { value: 'actual', label: 'Đang dùng giá vốn' },
    { value: 'expected', label: 'Đang dùng giá dự kiến' },
    { value: 'empty', label: 'Chưa có giá' },
];
const productStockAlertFilterOptions = [
    { value: 'low', label: 'Sắp hết' },
    { value: 'out', label: 'Hết hàng' },
    { value: 'available', label: 'Tồn ổn' },
];
const productTypeFilterOptions = ACTIVE_PRODUCT_TYPE_OPTIONS;
const productVariantScopeFilterOptions = [
    { value: 'has_variants', label: 'Có biến thể' },
    { value: 'no_variants', label: 'Không có biến thể' },
    { value: 'only_variants', label: 'Chỉ biến thể con' },
    { value: 'roots', label: 'Chỉ sản phẩm gốc' },
];
const supplierStatusFilterOptions = [
    { value: '1', label: 'Đang dùng' },
    { value: '0', label: 'Ngừng dùng' },
];
const supplierCatalogVariantScopeFilterOptions = [
    { value: 'no_variants', label: 'Sản phẩm thường' },
    { value: 'only_variants', label: 'Biến thể' },
    { value: 'has_variants', label: 'Nhóm có biến thể' },
    { value: 'roots', label: 'Nhóm gốc' },
];
const importEntryModeFilterOptions = [
    { value: 'manual', label: 'Nhập tay' },
    { value: 'invoice_ai', label: 'AI đọc hóa đơn' },
];
const importHasInvoiceFilterOptions = [
    { value: 'with_invoice', label: 'Đã có hóa đơn' },
    { value: 'without_invoice', label: 'Chưa có hóa đơn' },
];
const exportKindFilterOptions = [
    { value: 'manual', label: 'Phiếu tạo tay' },
    { value: 'dispatch_auto', label: 'Phiếu tạo tự động' },
    { value: 'document', label: 'Phiếu theo đơn' },
];
const exportSourceOptions = [
    { value: 'online', label: 'Bán online' },
    { value: 'store', label: 'Bán tại cửa hàng' },
    { value: 'internal', label: 'Xuất nội bộ' },
    { value: 'display', label: 'Xuất trưng bày' },
];
const exportInvoiceModeOptions = [
    { value: 'standard', label: 'Hóa đơn điện tử chuẩn' },
    { value: 'cash_register', label: 'HĐĐT từ máy tính tiền' },
];
const exportInvoiceBuyerTypeOptions = [
    { value: 'individual', label: 'Cá nhân' },
    { value: 'business', label: 'Doanh nghiệp' },
];
const exportPaymentMethodOptions = [
    { value: 'cash', label: 'Tiền mặt' },
    { value: 'bank_transfer', label: 'Chuyển khoản' },
    { value: 'card', label: 'Thẻ / POS' },
    { value: 'e_wallet', label: 'Ví điện tử' },
    { value: 'cod', label: 'COD' },
];
const exportTaxRateOptions = [
    { value: '0', label: '0%' },
    { value: '5', label: '5%' },
    { value: '8', label: '8%' },
    { value: '10', label: '10%' },
];
const defaultExportInvoiceMeta = {
    sale_channel: 'online',
    invoice_requested: true,
    invoice_mode: 'standard',
    invoice_buyer_type: 'individual',
    invoice_buyer_name: '',
    invoice_company_name: '',
    invoice_tax_code: '',
    invoice_email: '',
    invoice_address: '',
    payment_method: 'bank_transfer',
    tax_rate: '10',
    storefront_reference: '',
};
const normalizeExportInvoiceRequested = (value) => value === true || value === '1' || value === 1 || value === 'true';
const getExportSaleChannelLabel = (value) => filterOptionLabel(exportSourceOptions, value);
const getExportInvoiceModeLabel = (value) => filterOptionLabel(exportInvoiceModeOptions, value);
const getExportBuyerTypeLabel = (value) => filterOptionLabel(exportInvoiceBuyerTypeOptions, value);
const getExportPaymentMethodLabel = (value) => filterOptionLabel(exportPaymentMethodOptions, value);
const buildExportInvoiceMeta = (raw = {}) => ({
    ...defaultExportInvoiceMeta,
    ...raw,
    invoice_requested: normalizeExportInvoiceRequested(raw.invoice_requested ?? defaultExportInvoiceMeta.invoice_requested),
});
const getExportInvoiceStatusMeta = (invoiceMeta = {}, fallbackCustomerName = '') => {
    const meta = buildExportInvoiceMeta(invoiceMeta);
    if (!meta.invoice_requested) {
        return { label: 'Không xuất HĐĐT', tone: 'slate', detail: 'Phiếu xuất này chưa yêu cầu hóa đơn điện tử.' };
    }

    const buyerName = String(meta.invoice_buyer_name || fallbackCustomerName || '').trim();
    const hasBusinessFields = String(meta.invoice_company_name || '').trim() && String(meta.invoice_tax_code || '').trim() && String(meta.invoice_address || '').trim();
    const isReady = meta.invoice_buyer_type === 'business'
        ? Boolean(hasBusinessFields)
        : Boolean(buyerName);

    if (isReady) {
        return {
            label: 'Sẵn sàng Sinvoice',
            tone: 'emerald',
            detail: meta.invoice_buyer_type === 'business'
                ? 'Đã có đủ thông tin doanh nghiệp để map sang hóa đơn điện tử.'
                : 'Đã có đủ thông tin người mua để tạo hóa đơn điện tử.',
        };
    }

    return {
        label: 'Thiếu dữ liệu HĐĐT',
        tone: 'amber',
        detail: meta.invoice_buyer_type === 'business'
            ? 'Cần tên đơn vị, mã số thuế và địa chỉ để lên hóa đơn doanh nghiệp.'
            : 'Cần tối thiểu tên người mua để đồng bộ phát hành hóa đơn.',
    };
};

const isDocumentTab = (tabKey) => documentTabs.some(([key]) => key === tabKey);
const isSlipTab = (tabKey) => isDocumentTab(tabKey) || tabKey === 'trash';

const documentTypeMap = { returns: 'return', damaged: 'damaged', adjustments: 'adjustment' };
const documentTitleMap = { returns: 'Phiếu hàng hoàn', damaged: 'Phiếu hàng hỏng', adjustments: 'Phiếu điều chỉnh' };
const pageSizeOptions = [20, 50, 100, 500];
const inventoryTableStorageVersion = 'v11';
const emptySortConfig = { key: null, direction: 'none' };
const productTrackingSortConfig = { key: 'tracking_status', direction: 'desc' };
const productTrackingColumnIds = new Set([
    'recent_outbound_quantity',
    'tracking_daily_average',
    'tracking_stock_coverage_days',
    'tracking_status',
]);
const getStoredPageSize = (key) => {
    if (typeof window === 'undefined') return 20;
    const raw = Number(localStorage.getItem(`inventory_page_size_${key}`) || 20);
    return pageSizeOptions.includes(raw) ? raw : 20;
};
const createSortState = () => ({
    products: emptySortConfig,
    suppliers: emptySortConfig,
    supplierPrices: emptySortConfig,
    imports: emptySortConfig,
    exports: emptySortConfig,
    returns: emptySortConfig,
    damaged: emptySortConfig,
    adjustments: emptySortConfig,
    lots: emptySortConfig,
    trash: emptySortConfig,
});
const nextSortConfig = (current, columnId) => {
    if (!current?.key || current.key !== columnId || current.direction === 'none') {
        return { key: columnId, direction: 'asc' };
    }
    if (current.direction === 'asc') {
        return { key: columnId, direction: 'desc' };
    }
    return emptySortConfig;
};

const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}đ`;
const formatImportCost = (value) => `${formatRoundedImportCost(value)}đ`;
const formatNumber = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(value ?? 0));
const formatOneDecimal = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(Number(value ?? 0));
const normalizeDecimalFilterDraft = (value) => {
    const raw = String(value ?? '').trimStart().replace(/\./g, ',');
    const normalized = raw.replace(/[^0-9,]/g, '');
    const [integerPartRaw, ...decimalParts] = normalized.split(',');
    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || (decimalParts.length ? '0' : '');
    const decimalPart = decimalParts.join('').slice(0, 2);

    if (decimalParts.length > 0) {
        return `${integerPart || '0'},${decimalPart}`;
    }

    return integerPart;
};
const stripNumericValue = (value) => String(value ?? '').replace(/[^0-9]/g, '');
const normalizeQuantityDraft = (value, { signed = false } = {}) => {
    const raw = String(value ?? '').trimStart().replace(/,/g, '.');
    const sign = signed && raw.startsWith('-') ? '-' : '';
    const unsigned = raw.replace(/^[+-]\s*/, '').replace(/[^0-9.]/g, '');
    if (!unsigned) return sign;

    const [integerPartRaw, ...decimalParts] = unsigned.split('.');
    const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || (decimalParts.length ? '0' : '');
    const decimalPart = decimalParts.join('').slice(0, 3);

    if (decimalParts.length > 0) {
        return `${sign}${integerPart || '0'}.${decimalPart}`;
    }

    return `${sign}${integerPart}`;
};
const parseQuantityDraft = (value, fallback = 0) => {
    const normalized = normalizeQuantityDraft(value);
    if (!normalized || normalized === '.') return fallback;
    const numericValue = Number(normalized);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};
const getProductStockAlertMeta = (row) => {
    const stock = Number(row?.actual_stock ?? row?.computed_stock ?? 0);
    const normalizedAlert = String(row?.stock_alert || '').trim();

    if (stock < 0) {
        return {
            key: 'oversold',
            label: 'Bán trước',
            badgeClass: 'border-rose-300 bg-rose-100 text-rose-800',
            textClass: 'text-rose-800',
        };
    }

    if (normalizedAlert === 'out' || stock === 0) {
        return {
            key: 'out',
            label: 'Hết hàng',
            badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
            textClass: 'text-rose-700',
        };
    }

    if (normalizedAlert === 'low' || stock <= 5) {
        return {
            key: 'low',
            label: 'Sắp hết',
            badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
            textClass: 'text-amber-700',
        };
    }

    return {
        key: 'available',
        label: 'An toàn',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        textClass: 'text-emerald-700',
    };
};
const getActualStockCellMeta = (row) => {
    const baseMeta = getProductStockAlertMeta(row);

    // 'available' and 'oversold' use their own defined textClass from baseMeta
    if (baseMeta.key === 'available' || baseMeta.key === 'oversold') {
        return baseMeta;
    }

    return {
        ...baseMeta,
        textClass: 'text-rose-700',
    };
};
const getProductTrackingMeta = (row) => {
    const demand = Number(row?.tracking_demand_quantity || 0);
    const level = String(row?.tracking_level || '').trim();

    if (level === 'restock' || row?.tracking_needs_restock) {
        return {
            key: 'restock',
            label: row?.tracking_level_label || 'Cần nhập',
            badgeClass: 'border-rose-300 bg-rose-100 text-rose-800',
            textClass: 'text-rose-700',
        };
    }

    if (level === 'fast') {
        return {
            key: 'fast',
            label: row?.tracking_level_label || 'Bán mạnh',
            badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-800',
            textClass: 'text-emerald-700',
        };
    }

    if (level === 'watch' || demand > 0) {
        return {
            key: 'watch',
            label: row?.tracking_level_label || 'Theo dõi',
            badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
            textClass: 'text-amber-700',
        };
    }

    return {
        key: 'slow',
        label: row?.tracking_level_label || 'Bán chậm',
        badgeClass: 'border-primary/10 bg-primary/[0.03] text-primary/55',
        textClass: 'text-primary/45',
    };
};
const renderTwoLineHeader = (topLine, bottomLine) => (
    <span className="inline-flex flex-col items-center whitespace-normal text-center text-[14px] font-bold leading-[1.1]">
        <span>{topLine}</span>
        <span>{bottomLine}</span>
    </span>
);
const getHeaderTooltipPlacementClass = (placement = 'center') => {
    if (placement === 'left') return 'left-0';
    if (placement === 'right') return 'right-0';
    return 'left-1/2 -translate-x-1/2';
};
const ColumnHeaderTooltip = ({ tooltip, placement = 'center', children }) => (
    <div className="relative inline-flex max-w-full items-center">
        <div className="min-w-0">{children}</div>
        <div
            className={`pointer-events-none absolute top-full z-[80] mt-2 rounded-sm border border-primary/15 bg-white px-4 py-2.5 text-left text-[12px] font-semibold leading-none text-primary opacity-0 shadow-[0_16px_40px_rgba(15,23,42,0.16)] transition duration-150 group-hover/header:translate-y-0 group-hover/header:opacity-100 group-focus-within/header:translate-y-0 group-focus-within/header:opacity-100 ${getHeaderTooltipPlacementClass(placement)} max-w-none whitespace-nowrap translate-y-1`}
            role="tooltip"
        >
            {tooltip}
        </div>
    </div>
);
const supplierPasteModeConfigs = {
    sku_price: {
        label: 'SKU + Giá',
        hint: 'Dán theo mẫu: `SKU TAB Giá` hoặc `SKU,Giá`',
        placeholder: 'SKU-01\t120000\nSKU-02\t150000',
        actionLabel: 'Nhận giá',
    },
    sku_supplier_code: {
        label: 'SKU + Mã NCC',
        hint: 'Dán theo mẫu: `SKU TAB Mã NCC` hoặc `SKU,Mã NCC`',
        placeholder: 'SKU-01\tSP000451\nSKU-02\t121212',
        actionLabel: 'Nhận mã NCC',
    },
    sku_supplier_code_price: {
        label: 'SKU + Mã NCC + Giá',
        hint: 'Dán theo mẫu: `SKU TAB Mã NCC TAB Giá` hoặc `SKU,Mã NCC,Giá`',
        placeholder: 'SKU-01\tSP000451\t120000\nSKU-02\t121212\t150000',
        actionLabel: 'Nhận dữ liệu',
    },
};
const parseSupplierPasteLine = (line, mode = 'sku_price') => {
    const parts = String(line ?? '')
        .split(/\t|,|;/)
        .map((item) => item.trim())
        .filter(Boolean);

    if (!parts.length) return null;

    const sku = String(parts[0] || '').trim();
    if (!sku) return null;

    if (mode === 'sku_supplier_code') {
        if (parts.length < 2) return null;
        const supplierProductCode = String(parts[1] || '').trim();
        return supplierProductCode ? { sku, supplier_product_code: supplierProductCode } : null;
    }

    if (mode === 'sku_supplier_code_price') {
        if (parts.length < 3) return null;
        const supplierProductCode = String(parts[1] || '').trim();
        const unitCost = normalizeRoundedImportCostDraft(parts[2]);
        if (!supplierProductCode || !unitCost) return null;
        return { sku, supplier_product_code: supplierProductCode, unit_cost: unitCost };
    }

    if (parts.length < 2) return null;
    const unitCost = normalizeRoundedImportCostDraft(parts[1]);
    return unitCost ? { sku, unit_cost: unitCost } : null;
};
const formatWholeNumberInput = (value) => {
    return formatWholeMoneyInput(value);
};
const parseWholeNumberInput = (value) => {
    return parseWholeMoneyValue(value);
};
const normalizeSignedWholeNumberInput = (value) => {
    return normalizeQuantityDraft(value, { signed: true });
};
const parseSignedWholeNumberInput = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '+' || raw === '-' || raw === '.' || raw === '-.') return null;

    const sign = raw.startsWith('-') ? -1 : 1;
    const normalized = normalizeQuantityDraft(raw.replace(/^[+-]\s*/, ''));
    if (!normalized || normalized === '.') return null;

    return sign * Number(normalized);
};
const nudgeSignedWholeNumberInput = (value, delta) => {
    const currentValue = parseSignedWholeNumberInput(value);

    if (currentValue == null) {
        return delta > 0 ? '1' : '-1';
    }

    return String(currentValue + delta);
};
const resolveDocumentUnitCostValue = (product) => {
    const cost = product?.current_cost ?? product?.supplier_unit_cost ?? product?.expected_cost;

    if (cost == null || !Number.isFinite(Number(cost))) {
        return '';
    }

    return String(Math.round(Number(cost)));
};
const roundCurrencyValue = (value) => Math.round(Number(value || 0) * 100) / 100;
const formatCompactDecimal = (value) => {
    const rounded = roundCurrencyValue(value);
    if (!Number.isFinite(rounded) || rounded === 0) return '0';
    const text = String(rounded);
    return text
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '');
};
const adjustmentKindMetaMap = {
    export_adjustment: {
        label: 'Điều chỉnh phiếu xuất',
        color: '#0F766E',
        subtle: '#CCFBF1',
        description: 'Chỉ sửa lại số liệu xuất, không vào tổng điều chỉnh tồn.',
    },
    stock_adjustment: {
        label: 'Điều chỉnh tồn kho độc lập',
        color: '#B45309',
        subtle: '#FEF3C7',
        description: 'Cộng hoặc trừ trực tiếp vào tồn kho.',
    },
};
const adjustmentSourceMetaMap = {
    manual_inventory: {
        label: 'Tạo tay từ quản lý kho',
        description: 'Phiếu này tác động trực tiếp vào tồn kho.',
    },
    return_reconciliation: {
        label: 'Tự động từ phiếu hoàn / chênh lệch xuất-hoàn',
        description: 'Phiếu này chỉ sửa số liệu xuất để công thức tồn kho tự tính lại.',
    },
};
const adjustmentQuantityScopeMetaMap = {
    export_quantity: { oldLabel: 'Xuất cũ', newLabel: 'Xuất mới' },
    sellable_stock: { oldLabel: 'Tồn cũ', newLabel: 'Tồn mới' },
    damaged_stock: { oldLabel: 'Hỏng cũ', newLabel: 'Hỏng mới' },
};
const getAdjustmentKindMeta = (value) => adjustmentKindMetaMap[value] || adjustmentKindMetaMap.stock_adjustment;
const getAdjustmentSourceMeta = (value) => adjustmentSourceMetaMap[value] || adjustmentSourceMetaMap.manual_inventory;
const getAdjustmentQuantityScopeMeta = (value) => adjustmentQuantityScopeMetaMap[value] || adjustmentQuantityScopeMetaMap.sellable_stock;
const formatSignedNumber = (value) => {
    const numericValue = Number(value || 0);
    if (numericValue > 0) return `+${formatNumber(numericValue)}`;
    return formatNumber(numericValue);
};
const extractLeadingSign = (value) => {
    const trimmed = String(value ?? '').trim();
    if (trimmed.startsWith('-')) return '-';
    if (trimmed.startsWith('+')) return '+';
    return '';
};
const sanitizeDecimalText = (value, maxDecimals = 2) => {
    const normalized = String(value ?? '').replace(',', '.');
    let output = '';
    let hasDot = false;

    for (const character of normalized) {
        if (/[0-9]/.test(character)) {
            output += character;
            continue;
        }
        if (character === '.' && !hasDot) {
            output += '.';
            hasDot = true;
        }
    }

    if (!output) return '';
    if (hasDot) {
        let [integerPart, decimalPart = ''] = output.split('.');
        integerPart = integerPart.replace(/^0+(?=\d)/, '');
        if (integerPart === '') integerPart = '0';
        decimalPart = decimalPart.slice(0, maxDecimals);
        return output.endsWith('.') && decimalPart === ''
            ? `${integerPart}.`
            : decimalPart
                ? `${integerPart}.${decimalPart}`
                : integerPart;
    }

    return output.replace(/^0+(?=\d)/, '');
};
const formatSignedAmountInput = (value) => {
    const sign = extractLeadingSign(value);
    const digits = stripNumericValue(String(value ?? '').replace(/^[+-]\s*/, ''));
    if (!digits) return sign;
    return `${sign}${formatNumber(digits)}`;
};
const formatSignedPercentInput = (value) => {
    const sign = extractLeadingSign(value);
    const unsigned = String(value ?? '').replace(/^[+-]\s*/, '');
    const numberText = sanitizeDecimalText(unsigned.replace('%', ''));
    const normalizedNumberText = numberText.endsWith('.') ? numberText.slice(0, -1) : numberText;
    if (!normalizedNumberText) return sign;
    return `${sign}${normalizedNumberText}`;
};
const parseImportAmountInput = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '+' || raw === '-') {
        return {
            value: 0,
            normalizedInput: raw,
            hasValue: false,
        };
    }

    const sign = raw.startsWith('-') ? -1 : 1;
    const digits = stripNumericValue(raw.replace(/^[+-]\s*/, ''));
    const amount = digits ? roundCurrencyValue(sign * Number(digits)) : 0;
    return {
        value: amount,
        normalizedInput: formatSignedAmountInput(raw),
        hasValue: digits !== '',
    };
};
const parseImportPercentInput = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '+' || raw === '-') {
        return {
            value: 0,
            normalizedInput: raw,
            hasValue: false,
        };
    }

    const sign = raw.startsWith('-') ? -1 : 1;
    const numericText = sanitizeDecimalText(raw.replace(/^[+-]\s*/, '').replace('%', ''));
    const numericValue = numericText ? Number(numericText) : 0;
    return {
        value: roundCurrencyValue(sign * (Number.isFinite(numericValue) ? numericValue : 0)),
        normalizedInput: formatSignedPercentInput(raw),
        hasValue: numericText !== '',
    };
};
const parseImportSurchargeFields = ({ amountInput = '', percentInput = '' }, subtotal = 0) => {
    const amountState = parseImportAmountInput(amountInput);
    const percentState = parseImportPercentInput(percentInput);
    const percentAmount = roundCurrencyValue((Number(subtotal || 0) * percentState.value) / 100);
    const totalAmount = roundCurrencyValue(amountState.value + percentAmount);
    const hasAmount = amountState.hasValue;
    const hasPercent = percentState.hasValue;

    let mode = 'amount';
    let value = amountState.value;
    if (hasAmount && hasPercent) {
        mode = 'mixed';
        value = amountState.value;
    } else if (hasPercent) {
        mode = 'percent';
        value = percentState.value;
    }

    return {
        mode,
        value: roundCurrencyValue(value),
        amount: totalAmount,
        percent: roundCurrencyValue(percentState.value),
        fixedAmount: roundCurrencyValue(amountState.value),
        percentAmount,
        normalizedAmountInput: amountState.normalizedInput,
        normalizedPercentInput: percentState.normalizedInput,
        hasValue: hasAmount || hasPercent,
    };
};
const buildImportChargeInputsFromData = (data = null) => {
    const mode = String(data?.extra_charge_mode || '').trim().toLowerCase();
    const formatAmountValue = (value) => {
        const roundedAmountValue = Math.round(Number(value || 0));
        return roundedAmountValue === 0 ? '' : formatSignedAmountInput(`${roundedAmountValue >= 0 ? '+' : '-'}${Math.abs(roundedAmountValue)}`);
    };
    const formatPercentValue = (value) => {
        const numericValue = roundCurrencyValue(value);
        return numericValue === 0 ? '' : formatSignedPercentInput(`${numericValue >= 0 ? '+' : '-'}${Math.abs(numericValue)}`);
    };

    if (mode === 'mixed') {
        return {
            amountInput: formatAmountValue(data?.extra_charge_value ?? 0),
            percentInput: formatPercentValue(data?.extra_charge_percent ?? 0),
        };
    }

    if (mode === 'amount') {
        return {
            amountInput: formatAmountValue(data?.extra_charge_value ?? data?.extra_charge_amount ?? 0),
            percentInput: '',
        };
    }

    if (mode === 'percent') {
        return {
            amountInput: '',
            percentInput: formatPercentValue(data?.extra_charge_value ?? data?.extra_charge_percent ?? 0),
        };
    }

    const legacyPercent = Number(data?.extra_charge_percent ?? 0);
    if (legacyPercent !== 0) {
        return {
            amountInput: '',
            percentInput: formatPercentValue(legacyPercent),
        };
    }

    return {
        amountInput: formatAmountValue(data?.extra_charge_amount ?? 0),
        percentInput: '',
    };
};
const sortSupplierComparisons = (items = []) => [...items]
    .map((item) => ({
        ...item,
        supplier_id: item?.supplier_id ?? null,
        unit_cost: item?.unit_cost != null ? Number(item.unit_cost) : null,
    }))
    .filter((item) => item.supplier_id != null && item.unit_cost != null && Number(item.unit_cost) > 0)
    .sort((left, right) => {
        if (left.unit_cost === right.unit_cost) {
            return String(left.supplier_name || '').localeCompare(String(right.supplier_name || ''), 'vi');
        }
        return left.unit_cost - right.unit_cost;
    })
    .map((item, index) => ({
        ...item,
        is_lowest: index === 0,
    }));
const buildSupplierCatalogDisplayNames = (row, preferredNames = [], preferredSupplierIds = []) => {
    const normalizedSupplierIds = normalizeSupplierFilterIds(preferredSupplierIds);
    const canUseFilter = normalizedSupplierIds.length > 0;
    const includeSupplierId = (supplierId) => !canUseFilter || normalizedSupplierIds.includes(Number(supplierId));
    const supplierNames = [
        ...preferredNames,
        ...(Array.isArray(row?.suppliers)
            ? row.suppliers.filter((item) => includeSupplierId(item?.id)).map((item) => item?.name)
            : []),
        ...(Array.isArray(row?.supplier_price_comparisons)
            ? row.supplier_price_comparisons.filter((item) => includeSupplierId(item?.supplier_id)).map((item) => item?.supplier_name)
            : []),
        ...(Array.isArray(row?.variants) ? row.variants.flatMap((variant) => (
            Array.isArray(variant?.suppliers)
                ? variant.suppliers.filter((item) => includeSupplierId(item?.id)).map((item) => item?.name)
                : []
        )) : []),
        ...(Array.isArray(row?.variants) ? row.variants.flatMap((variant) => (
            Array.isArray(variant?.supplier_price_comparisons)
                ? variant.supplier_price_comparisons.filter((item) => includeSupplierId(item?.supplier_id)).map((item) => item?.supplier_name)
                : []
        )) : []),
    ];

    return Array.from(new Set(supplierNames.map((value) => String(value || '').trim()).filter(Boolean)));
};
const summarizeSelectedSupplierNames = (names = []) => {
    if (!names.length) return 'Tất cả';
    if (names.length <= 2) return names.join(', ');
    return `${names.length} NCC đã chọn`;
};
const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
};
const formatPrintDate = (value) => {
    if (!value) return '-';
    const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN');
};
const formatFileSize = (value) => {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
};
const getImportAttachmentName = (attachment) => attachment?.original_name || attachment?.file_path?.split('/').pop() || 'Hóa đơn đính kèm';
const getImportAttachmentExtension = (attachment) => {
    const source = `${attachment?.original_name || ''}.${attachment?.file_path || ''}`.toLowerCase();
    const matched = source.match(/\.([a-z0-9]+)(?:$|\?)/);
    return matched?.[1] || '';
};
const isPdfAttachment = (attachment) => {
    const mimeType = String(attachment?.mime_type || '').toLowerCase();
    return mimeType.includes('pdf') || getImportAttachmentExtension(attachment) === 'pdf';
};
const isImageAttachment = (attachment) => {
    const mimeType = String(attachment?.mime_type || '').toLowerCase();
    const extension = getImportAttachmentExtension(attachment);
    return mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension);
};
const getImportAttachmentTypeLabel = (attachment) => {
    if (!attachment) return 'Hóa đơn';
    if (attachment.source_type === 'invoice') return 'Từ AI hóa đơn';
    return 'Tải lên thủ công';
};
const mapImportAttachment = (attachment) => ({
    id: attachment?.id || null,
    invoice_analysis_log_id: attachment?.invoice_analysis_log_id || null,
    source_type: attachment?.source_type || 'manual',
    disk: attachment?.disk || 'public',
    file_path: attachment?.file_path || '',
    original_name: attachment?.original_name || 'Hóa đơn đính kèm',
    mime_type: attachment?.mime_type || null,
    file_size: attachment?.file_size || 0,
    url: attachment?.url || null,
    created_at: attachment?.created_at || null,
    updated_at: attachment?.updated_at || null,
    invoiceAnalysisLog: attachment?.invoiceAnalysisLog || null,
});
const normalizeSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
const normalizeSupplierCodeKey = (value) => String(value ?? '').trim().toLowerCase();
const buildInventorySearchMeta = (row) => [
    row?.sku ? `Mã SP: ${row.sku}` : null,
    row?.supplier_product_code ? `Mã NCC: ${row.supplier_product_code}` : null,
    row?.parent_name ? `Thuộc: ${row.parent_name}` : null,
]
    .filter(Boolean)
    .join(' • ');
const normalizeImportStorageLocation = (source = {}) => {
    const location = source?.storage_location
        || source?.shelf_location
        || source?.product?.storage_location
        || source?.product?.shelf_location
        || null;
    const shelf = location?.shelf || null;
    const warehouse = shelf?.warehouse || null;
    const shelfName = String(location?.shelf_name ?? shelf?.name ?? source?.shelf_name ?? '').trim();
    const shelfCode = String(location?.shelf_code ?? shelf?.code ?? source?.shelf_code ?? '').trim();
    const warehouseName = String(location?.warehouse_name ?? warehouse?.name ?? source?.warehouse_name ?? '').trim();
    const warehouseCode = String(location?.warehouse_code ?? warehouse?.code ?? source?.warehouse_code ?? '').trim();
    const floorNumber = location?.floor_number ?? source?.floor_number ?? source?.storage_floor ?? '';
    const positionNote = String(location?.position_note ?? source?.position_note ?? '').trim();
    const locationLabel = String(
        source?.storage_location_label
        ?? source?.location_label
        ?? location?.location_label
        ?? location?.location_code
        ?? ''
    ).trim();
    const warehouseSequence = source?.warehouse_sequence
        ?? source?.product_warehouse_sequence
        ?? location?.warehouse_sequence
        ?? location?.product_warehouse_sequence
        ?? '';

    if (!locationLabel && !shelfName && !shelfCode && !floorNumber && !positionNote && !warehouseSequence) {
        return null;
    }

    return {
        id: location?.id || source?.storage_location_id || null,
        shelf_name: shelfName,
        shelf_code: shelfCode,
        warehouse_name: warehouseName,
        warehouse_code: warehouseCode,
        floor_number: floorNumber,
        position_note: positionNote,
        location_label: locationLabel,
        warehouse_sequence: warehouseSequence,
    };
};
const formatImportStorageShelf = (location = null) => {
    const shelfName = String(location?.shelf_name || '').trim();
    const shelfCode = String(location?.shelf_code || '').trim();
    return shelfName || shelfCode || 'Chưa gán kệ';
};
const formatImportStorageFloor = (location = null) => {
    const value = location?.floor_number;
    if (value === null || value === undefined || value === '') {
        return 'Chưa có tầng';
    }

    return `Tầng ${value}`;
};
const formatImportPutawayLocationLine = (location = null) => {
    if (!location) {
        return 'Chưa gán vị trí';
    }

    const shelf = formatImportStorageShelf(location);
    const floor = formatImportStorageFloor(location);
    const sequence = location?.warehouse_sequence;
    const note = String(location?.position_note || '').trim();
    const slot = sequence
        ? `Số ${sequence}`
        : note.replace(/^STT\s*kho\s*/i, 'Số ').replace(/^STT\s*/i, 'Số ');
    const parts = [shelf, floor, slot]
        .map((item) => String(item || '').trim())
        .filter(Boolean);

    return parts.length ? parts.join(' - ') : 'Chưa gán vị trí';
};
const buildImportStorageLocationSortKey = (location = null, item = {}) => {
    const shelf = String(location?.shelf_code || location?.shelf_name || '').toLocaleLowerCase('vi-VN');
    const floor = Number(location?.floor_number || 9999);
    const sequence = Number(location?.warehouse_sequence || 999999);
    const sku = String(item?.product_sku || '').toLocaleLowerCase('vi-VN');
    return `${shelf || 'zzzz'}|${String(floor).padStart(4, '0')}|${String(sequence).padStart(6, '0')}|${sku}`;
};
const sortImportPutawayItems = (items = []) => [...items].sort((left, right) => (
    String(left.putaway_sort_key || '').localeCompare(String(right.putaway_sort_key || ''), 'vi')
));
const resolveImportPutawayQuantity = (item = {}) => {
    const receivedQuantity = Number(item.received_quantity ?? 0);
    return receivedQuantity > 0 ? receivedQuantity : Number(item.quantity || 0);
};
const findExactInventorySearchMatch = (rows = [], query = '') => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return null;

    const exactMatches = rows.filter((row) => (
        normalizeSearchText(row?.sku) === normalizedQuery
        || normalizeSearchText(row?.supplier_product_code) === normalizedQuery
    ));

    return exactMatches.length === 1 ? exactMatches[0] : null;
};
const isInventorySearchRowImportStarred = (row) => (
    Boolean(row?.inventory_import_starred || row?.parent_inventory_import_starred)
);
const compareInventorySearchRows = (left, right, prioritizeImportStar = false) => {
    if (prioritizeImportStar && isInventorySearchRowImportStarred(right) !== isInventorySearchRowImportStarred(left)) {
        return isInventorySearchRowImportStarred(left) ? -1 : 1;
    }
    if ((right?._search_score || 0) !== (left?._search_score || 0)) {
        return (right?._search_score || 0) - (left?._search_score || 0);
    }
    if ((left?._source_rank ?? 0) !== (right?._source_rank ?? 0)) {
        return (left?._source_rank ?? 0) - (right?._source_rank ?? 0);
    }
    return String(left?.name || '').localeCompare(String(right?.name || ''), 'vi');
};
const sortInventorySearchRows = (rows = [], prioritizeImportStar = false) => [...rows]
    .sort((left, right) => compareInventorySearchRows(left, right, prioritizeImportStar));
const clearInventorySearchCache = () => inventorySearchCache.clear();
const scoreInventorySearchRow = (row, normalizedQuery) => {
    if (!normalizedQuery) return 0;

    const normalizedName = normalizeSearchText(row?.name);
    const normalizedSku = normalizeSearchText(row?.sku);
    const normalizedSupplierCode = normalizeSearchText(row?.supplier_product_code);
    const normalizedParentName = normalizeSearchText(row?.parent_name);

    let score = 0;
    if (normalizedSku === normalizedQuery) score += 1400;
    if (normalizedName === normalizedQuery) score += 1300;
    if (normalizedSupplierCode === normalizedQuery) score += 1200;
    if (normalizedName.startsWith(normalizedQuery)) score += 900;
    if (normalizedSku.startsWith(normalizedQuery)) score += 860;
    if (normalizedSupplierCode.startsWith(normalizedQuery)) score += 820;
    if (normalizedName.includes(normalizedQuery)) score += 620;
    if (normalizedSku.includes(normalizedQuery)) score += 580;
    if (normalizedSupplierCode.includes(normalizedQuery)) score += 540;
    if (normalizedParentName.includes(normalizedQuery)) score += 260;
    return score;
};
const flattenInventorySearchProducts = (products = [], normalizedQuery = '') => {
    const flattened = [];

    (products || []).forEach((product) => {
        if ((product?.has_variants || (Array.isArray(product?.variants) && product.variants.length > 0)) && Array.isArray(product.variants) && product.variants.length) {
            product.variants.forEach((variant) => {
                flattened.push({
                    ...variant,
                    parent_name: product.name,
                    parent_sku: product.sku,
                    parent_category_id: product.category_id,
                    parent_inventory_import_starred: Boolean(product.inventory_import_starred),
                    parent_attribute_values: product.attribute_values || [],
                    _search_score: scoreInventorySearchRow({
                        ...variant,
                        parent_name: product.name,
                        parent_sku: product.sku,
                    }, normalizedQuery),
                });
            });
            return;
        }

        flattened.push({
            ...product,
            _search_score: scoreInventorySearchRow(product, normalizedQuery),
        });
    });

    const uniqueRows = [];
    const seen = new Set();

    flattened
        .sort((left, right) => {
            if (right._search_score !== left._search_score) {
                return right._search_score - left._search_score;
            }
            return String(left.name || '').localeCompare(String(right.name || ''), 'vi');
        })
        .forEach((row) => {
            const id = Number(row?.id || 0);
            if (!id || seen.has(id)) return;
            seen.add(id);
            uniqueRows.push(row);
        });

    return uniqueRows;
};
const normalizeImportQuickAttributeMatchValue = (value) => normalizeSearchText(String(value ?? '').replace(/[\[\]{}"]/g, ' '));
const expandImportQuickAttributeValues = (value) => {
    if (Array.isArray(value)) return value.flatMap((item) => expandImportQuickAttributeValues(item));

    const rawValue = String(value ?? '').trim();
    if (!rawValue) return [];

    if ((rawValue.startsWith('[') && rawValue.endsWith(']')) || (rawValue.startsWith('{') && rawValue.endsWith('}'))) {
        try {
            const parsed = JSON.parse(rawValue);
            return expandImportQuickAttributeValues(parsed);
        } catch (error) {
            // Fall through to the raw value below.
        }
    }

    return [rawValue];
};
const inventorySearchRowMatchesFilters = (row, filters = {}) => {
    const normalizedFilters = normalizeImportQuickFilters(filters);

    if (normalizedFilters.category_id) {
        const categoryId = String(normalizedFilters.category_id);
        const rowCategoryId = row?.category_id != null ? String(row.category_id) : '';
        const parentCategoryId = row?.parent_category_id != null ? String(row.parent_category_id) : '';

        if (categoryId === 'uncategorized') {
            if (rowCategoryId || parentCategoryId) return false;
        } else if (rowCategoryId !== categoryId && parentCategoryId !== categoryId) {
            return false;
        }
    }

    const attributeFilters = normalizedFilters.attributes || {};
    const attributeEntries = Object.entries(attributeFilters);
    if (!attributeEntries.length) return true;

    return attributeEntries.every(([attributeId, selectedValues]) => {
        const selectedSet = new Set(selectedValues.map(normalizeImportQuickAttributeMatchValue).filter(Boolean));
        if (!selectedSet.size) return true;

        const ownAttributeValues = (Array.isArray(row?.attribute_values) ? row.attribute_values : [])
            .filter((attributeValue) => String(attributeValue?.attribute_id || '') === String(attributeId));
        const parentAttributeValues = (Array.isArray(row?.parent_attribute_values) ? row.parent_attribute_values : [])
            .filter((attributeValue) => String(attributeValue?.attribute_id || '') === String(attributeId));
        const candidateAttributeValues = ownAttributeValues.length ? ownAttributeValues : parentAttributeValues;

        return candidateAttributeValues.some((attributeValue) => (
            expandImportQuickAttributeValues(attributeValue?.value).some((value) => (
                selectedSet.has(normalizeImportQuickAttributeMatchValue(value))
            ))
        ));
    });
};
const pruneInventorySearchCache = () => {
    const now = Date.now();

    Array.from(inventorySearchCache.entries()).forEach(([cacheKey, cacheEntry]) => {
        if (!cacheEntry || now - cacheEntry.timestamp > INVENTORY_SEARCH_CACHE_TTL) {
            inventorySearchCache.delete(cacheKey);
        }
    });

    while (inventorySearchCache.size > INVENTORY_SEARCH_CACHE_LIMIT) {
        const oldestKey = inventorySearchCache.keys().next().value;
        if (!oldestKey) break;
        inventorySearchCache.delete(oldestKey);
    }
};
const inventorySearchCacheKey = ({ query, supplierId = null, limit = 20, prioritizeImportStar = false, onlyImportStarred = false, allowEmptySearch = false, filters = {} }) => {
    const normalizedQuery = normalizeSearchText(query);
    return `${supplierId || 'all'}::${limit}::${prioritizeImportStar ? 'import_star' : 'default'}::${onlyImportStarred ? 'starred_only' : 'all'}::${allowEmptySearch ? 'empty_ok' : 'query_only'}::${serializeImportQuickFilters(filters)}::${normalizedQuery}`;
};
const fetchInventorySearchResults = async ({ query, supplierId = null, limit = 20, signal, prioritizeImportStar = false, onlyImportStarred = false, allowEmptySearch = false, filters = {} } = {}) => {
    const trimmed = String(query ?? '').trim();
    const normalizedFilters = normalizeImportQuickFilters(filters);
    const filtersActive = hasImportQuickFilters(normalizedFilters);
    if (!trimmed && !filtersActive && !onlyImportStarred && !allowEmptySearch) return [];

    const cacheKey = inventorySearchCacheKey({ query: trimmed, supplierId, limit, prioritizeImportStar, onlyImportStarred, allowEmptySearch, filters: normalizedFilters });
    const cachedEntry = inventorySearchCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp <= INVENTORY_SEARCH_CACHE_TTL) {
        return cachedEntry.data;
    }

    const normalizedQuery = normalizeSearchText(trimmed);
    const params = {
        search: trimmed || undefined,
        quick_search: trimmed || undefined,
        with_variants: 1,
        variant_scope: 'roots',
        per_page: Math.max(limit * 2, 32),
        supplier_id: supplierId || undefined,
        picker: 1,
        without_summary: 1,
        import_starred: onlyImportStarred ? 1 : undefined,
        category_id: normalizedFilters.category_id || undefined,
    };
    Object.entries(normalizedFilters.attributes || {}).forEach(([attributeId, values]) => {
        if (values.length) {
            params[`attributes[${attributeId}]`] = values.join(',');
        }
    });

    const response = await inventoryApi.getProducts({
        ...params,
    }, signal);

    const rows = sortInventorySearchRows(flattenInventorySearchProducts(response.data?.data || [], normalizedQuery)
        .filter((row) => inventorySearchRowMatchesFilters(row, normalizedFilters))
        .filter((row) => !onlyImportStarred || isInventorySearchRowImportStarred(row))
        .map((row, index) => ({
            ...row,
            _search_score: scoreInventorySearchRow(row, normalizedQuery),
            _source_rank: index,
        }))
    , prioritizeImportStar).slice(0, limit);

    inventorySearchCache.set(cacheKey, {
        timestamp: Date.now(),
        data: rows,
    });
    pruneInventorySearchCache();
    return rows;
};

const moveArrayItem = (items = [], fromIndex, toIndex) => {
    if (
        fromIndex === toIndex
        || fromIndex < 0
        || toIndex < 0
        || fromIndex >= items.length
        || toIndex >= items.length
    ) {
        return items;
    }

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, movedItem);
    return nextItems;
};
const sortImportItemsByStarPriority = (items = []) => items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
        if (Boolean(right.item?.inventory_import_starred) !== Boolean(left.item?.inventory_import_starred)) {
            return left.item?.inventory_import_starred ? -1 : 1;
        }
        return left.index - right.index;
    })
    .map(({ item }) => item);
const updateInventoryImportStarInProductCollection = (rows = [], productId, starred) => (
    (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        inventory_import_starred: Number(row?.id || 0) === Number(productId) ? starred : Boolean(row?.inventory_import_starred),
        variants: Array.isArray(row?.variants)
            ? updateInventoryImportStarInProductCollection(row.variants, productId, starred)
            : row?.variants,
    }))
);
const normalizeImportProductId = (value) => {
    const numericValue = Number(value || 0);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};
const findImportDuplicateSelection = (items = [], productId, excludeIndex = null) => {
    const normalizedProductId = normalizeImportProductId(productId);
    if (!normalizedProductId) {
        return null;
    }

    const duplicateIndex = (items || []).findIndex((item, index) => (
        index !== excludeIndex
        && normalizeImportProductId(item?.product_id) === normalizedProductId
    ));

    if (duplicateIndex < 0) {
        return null;
    }

    return {
        productId: normalizedProductId,
        index: duplicateIndex,
        item: items[duplicateIndex],
    };
};
const findFirstDuplicateImportProductSelection = (items = []) => {
    const seenIndexes = new Map();

    for (let index = 0; index < (items || []).length; index += 1) {
        const item = items[index];
        const productId = normalizeImportProductId(item?.product_id);

        if (!productId) {
            continue;
        }

        if (seenIndexes.has(productId)) {
            const firstIndex = seenIndexes.get(productId);

            return {
                productId,
                firstIndex,
                firstItem: items[firstIndex],
                duplicateIndex: index,
                duplicateItem: item,
            };
        }

        seenIndexes.set(productId, index);
    }

    return null;
};
const buildImportDuplicateProductLabel = (product = null, item = null) => {
    const name = String(product?.name || item?.product_name || '').trim();
    const sku = String(product?.sku || item?.product_sku || '').trim();

    if (name && sku) {
        return `${name} (${sku})`;
    }

    return name || sku || 'Sản phẩm';
};
const hasImportSourceSnapshot = (item = {}) => [
    item.source_product_name,
    item.source_product_sku,
    item.source_supplier_product_code,
    item.source_unit_name,
    item.source_unit_cost,
    item.source_notes,
]
    .some((value) => String(value ?? '').trim() !== '');
const resolveImportSourceSnapshot = (item = {}) => {
    if (hasImportSourceSnapshot(item)) {
        return {
            source_product_name: item.source_product_name || '',
            source_product_sku: item.source_product_sku || '',
            source_supplier_product_code: item.source_supplier_product_code || '',
            source_unit_name: item.source_unit_name || '',
            source_unit_cost: item.source_unit_cost || '',
            source_notes: item.source_notes || '',
        };
    }

    if (!item.product_id || item.mapping_status === 'unmatched' || item.mapping_label === 'Đã map thủ công') {
        return {
            source_product_name: item.product_name || '',
            source_product_sku: item.product_sku || '',
            source_supplier_product_code: item.supplier_product_code || '',
            source_unit_name: item.unit_name || '',
            source_unit_cost: item.unit_cost || '',
            source_notes: item.notes || '',
        };
    }

    return {
        source_product_name: '',
        source_product_sku: '',
        source_supplier_product_code: '',
        source_unit_name: '',
        source_unit_cost: '',
        source_notes: '',
    };
};
const applyImportProductData = (item, product) => {
    const storageLocation = normalizeImportStorageLocation(product);

    return {
        ...item,
        ...resolveImportSourceSnapshot(item),
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        supplier_product_code: product.supplier_product_code || item.supplier_product_code || '',
        unit_name: product.unit_name || product.unit?.name || item.unit_name || '',
        unit_cost: String(normalizeRoundedImportCostNumber(product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost ?? 0) ?? 0),
        received_quantity: item.received_quantity || '0',
        storage_location: storageLocation,
        storage_location_label: storageLocation?.location_label || '',
        warehouse_sequence: product.warehouse_sequence ?? storageLocation?.warehouse_sequence ?? '',
        mapping_status: 'matched',
        mapping_label: item.mapping_status === 'unmatched' ? 'Đã map thủ công' : '',
        inventory_import_starred: Boolean(product.inventory_import_starred),
    };
};
const resetImportProductData = (item = {}) => {
    const sourceSnapshot = resolveImportSourceSnapshot(item);
    const hasSourceValues = Object.values(sourceSnapshot).some((value) => String(value ?? '').trim() !== '');

    return {
        ...item,
        ...sourceSnapshot,
        product_id: '',
        product_name: sourceSnapshot.source_product_name || '',
        product_sku: sourceSnapshot.source_product_sku || '',
        supplier_product_code: sourceSnapshot.source_supplier_product_code || '',
        unit_name: sourceSnapshot.source_unit_name || '',
        unit_cost: sourceSnapshot.source_unit_cost || '',
        notes: sourceSnapshot.source_notes || '',
        storage_location: null,
        storage_location_label: '',
        warehouse_sequence: '',
        mapping_status: hasSourceValues ? 'unmatched' : 'manual',
        mapping_label: '',
        inventory_import_starred: false,
    };
};

const createLine = (overrides = {}) => ({
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    product_id: '',
    product_name: '',
    product_sku: '',
    supplier_product_code: '',
    quantity: '1',
    received_quantity: '0',
    unit_name: '',
    unit_cost: '',
    notes: '',
    storage_location: null,
    storage_location_label: '',
    warehouse_sequence: '',
    update_supplier_price: true,
    inventory_import_starred: false,
    mapping_status: 'manual',
    mapping_label: '',
    source_product_name: '',
    source_product_sku: '',
    source_supplier_product_code: '',
    source_unit_name: '',
    source_unit_cost: '',
    source_notes: '',
    stock_bucket: 'sellable',
    direction: 'in',
    ...overrides,
});

const createSupplierForm = (supplier = null) => ({
    id: supplier?.id || null,
    code: supplier?.code || '',
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
    status: supplier?.status ?? true,
});

const createSupplierPriceForm = (price = null) => ({
    id: price?.id || null,
    product_id: price?.product?.id ? String(price.product.id) : (price?.product_id ? String(price.product_id) : ''),
    product_name: price?.product?.name || '',
    product_sku: price?.product?.sku || '',
    supplier_product_code: price?.supplier_product_code || '',
    unit_cost: price?.unit_cost != null ? normalizeRoundedImportCostDraft(price.unit_cost) : '',
    notes: price?.notes || '',
});

const mapSupplierCatalogEntry = (item) => ({
    id: item.id,
    product_id: item.id,
    supplier_price_id: item.supplier_price_id || null,
    sku: item.sku || '-',
    supplier_product_code: item.supplier_product_code || '',
    name: item.name || '-',
    unit_name: item.unit_name || item.unit?.name || '',
    parent_name: item.parent_name || null,
    parent_sku: item.parent_sku || null,
    category_name: item.category_name || null,
    price: item.price ?? null,
    unit_cost: normalizeRoundedImportCostNumber(item.supplier_unit_cost),
    inventory_import_starred: Boolean(item.inventory_import_starred),
    warehouse_sequence: item.warehouse_sequence ?? '',
    storage_location: normalizeImportStorageLocation(item),
    storage_location_label: item.storage_location_label || item.storage_location?.location_label || '',
    current_cost: item.current_cost ?? item.expected_cost ?? null,
    notes: item.supplier_notes || '',
    updated_at: item.supplier_price_updated_at || null,
    updater_name: item.supplier_updater_name || null,
    suppliers: Array.isArray(item.suppliers) ? item.suppliers : [],
    supplier_ids: Array.isArray(item.supplier_ids) ? item.supplier_ids : [],
    supplier_count: Number(item.supplier_count || 0),
    has_multiple_suppliers: Boolean(item.has_multiple_suppliers),
    supplier_price_comparisons: sortSupplierComparisons(item.supplier_price_comparisons || []),
    has_variants: Boolean(item.has_variants) || (Array.isArray(item.variants) && item.variants.length > 0),
    variant_count: Number(item.variant_count || (Array.isArray(item.variants) ? item.variants.length : 0)),
    variants: Array.isArray(item.variants) ? item.variants.map(mapSupplierCatalogEntry) : [],
});

const createImportForm = (data = null) => {
    const chargeInputs = buildImportChargeInputsFromData(data);
    const mappedItems = (data?.items || []).length
        ? data.items.map((item) => {
            const storageLocation = normalizeImportStorageLocation(item);

            return createLine({
                product_id: item.product_id,
                product_name: item.product?.name || item.product_name_snapshot || '',
                product_sku: item.product?.sku || item.product_sku_snapshot || '',
                supplier_product_code: item.supplier_product_code_snapshot || item.supplierPrice?.supplier_product_code || '',
                quantity: String(item.quantity || 1),
                received_quantity: String(item.received_quantity ?? 0),
                unit_name: item.unit_name_snapshot || item.product?.unit?.name || item.product?.unit_name || '',
                unit_cost: String(Math.round(Number(item.unit_cost || 0))),
                notes: item.notes || '',
                storage_location: storageLocation,
                storage_location_label: storageLocation?.location_label || '',
                warehouse_sequence: item.product?.warehouse_sequence ?? storageLocation?.warehouse_sequence ?? '',
                update_supplier_price: data?.update_supplier_prices ?? true,
                inventory_import_starred: Boolean(item.product?.inventory_import_starred ?? item.inventory_import_starred),
                mapping_status: item.product_id ? 'matched' : 'manual',
                mapping_label: item.product_id ? 'Đã map sản phẩm' : '',
            });
        })
        : [];
    const allMappedItemsCompleted = mappedItems.length > 0 && mappedItems.every((item) => (
        parseLineQuantity(item.received_quantity, 0) >= parseLineQuantity(item.quantity, 0)
    ));
    const mappedAttachments = Array.isArray(data?.attachments)
        ? data.attachments.map(mapImportAttachment)
        : [];
    const hasPurchaseInvoice = Object.prototype.hasOwnProperty.call(data || {}, 'has_purchase_invoice')
        ? Boolean(data?.has_purchase_invoice)
        : Boolean(
            mappedAttachments.length
            || Number(data?.attachments_count || 0) > 0
            || data?.invoice_analysis_log_id
            || (Array.isArray(data?.invoiceAnalysisLogs) && data.invoiceAnalysisLogs.length)
        );

    return {
        id: data?.id || null,
        import_number: data?.import_number || data?.document_number || '',
        supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
        supplier_name: data?.supplier?.name || data?.supplier_name || '',
        inventory_import_status_id: data?.inventory_import_status_id ? String(data.inventory_import_status_id) : '',
        status_is_manual: data?.status_is_manual ?? Boolean(data?.id && data?.inventory_import_status_id),
        auto_complete_import: data?.auto_complete_import ?? (!data?.id || allMappedItemsCompleted),
        auto_complete_import_touched: Boolean(data?.auto_complete_import_touched ?? data?.id),
        import_date: data?.import_date ? String(data.import_date).slice(0, 10) : todayValue,
        notes: data?.notes || '',
        update_supplier_prices: data?.update_supplier_prices ?? true,
        entry_mode: data?.entry_mode || 'manual',
        extra_charge_mode: data?.extra_charge_mode || 'percent',
        extra_charge_value: data?.extra_charge_value != null ? String(data.extra_charge_value) : '',
        extra_charge_amount_input: chargeInputs.amountInput,
        extra_charge_percent_input: chargeInputs.percentInput,
        invoice_analysis_log_id: data?.invoice_analysis_log_id ? String(data.invoice_analysis_log_id) : (data?.invoiceAnalysisLogs?.[0]?.id ? String(data.invoiceAnalysisLogs[0].id) : ''),
        invoice_number: data?.invoice_number || data?.invoiceAnalysisLogs?.[0]?.analysis_result?.raw_invoice?.invoice_number || '',
        has_purchase_invoice: hasPurchaseInvoice,
        analysis_log: data?.invoiceAnalysisLogs?.[0] || null,
        attachments: mappedAttachments,
        local_attachment_files: [],
        items: data?.id ? mappedItems : sortImportItemsByStarPriority(mappedItems),
    };
};

const createImportStatusForm = (status = null) => ({
    id: status?.id || null,
    name: status?.name || '',
    color: status?.color || '#10B981',
    affects_inventory: Boolean(status?.affects_inventory),
    is_active: status?.is_active ?? true,
    is_default: Boolean(status?.is_default),
});

const createImportInvoiceModalState = () => ({
    open: false,
    row: null,
    importInfo: null,
    attachments: [],
    selectedAttachmentId: null,
});
const buildImportModalDraftStorageKey = () => {
    if (typeof window === 'undefined') return IMPORT_MODAL_DRAFT_STORAGE_KEY;
    const activeAccountId = Number(localStorage.getItem('activeAccountId') || 0);
    return `${IMPORT_MODAL_DRAFT_STORAGE_KEY}_${activeAccountId > 0 ? activeAccountId : 'default'}`;
};
const normalizePersistedImportDraftItems = (items = []) => (
    Array.isArray(items)
        ? items.map((item) => createLine({
            ...item,
            key: item?.key || undefined,
        }))
        : []
);
const restorePersistedImportForm = (draftForm = null) => {
    const baseForm = createImportForm();
    if (!draftForm || typeof draftForm !== 'object') {
        return baseForm;
    }

    const restoredItems = normalizePersistedImportDraftItems(draftForm.items);

    return {
        ...baseForm,
        ...draftForm,
        attachments: Array.isArray(draftForm.attachments) ? draftForm.attachments.map(mapImportAttachment) : [],
        local_attachment_files: [],
        items: restoredItems,
    };
};
const buildPersistableImportModalDraft = ({
    form,
    importTableExpanded = false,
    importTableSettingsOpen = false,
    importCompleteToggleSnapshot = null,
}) => ({
    version: 1,
    saved_at: new Date().toISOString(),
    form: {
        ...form,
        analysis_log: null,
        attachments: Array.isArray(form?.attachments) ? form.attachments.map(mapImportAttachment) : [],
        local_attachment_files: [],
    },
    importTableExpanded: Boolean(importTableExpanded),
    importTableSettingsOpen: Boolean(importTableSettingsOpen),
    importCompleteToggleSnapshot: importCompleteToggleSnapshot
        ? {
            inventory_import_status_id: importCompleteToggleSnapshot.inventory_import_status_id || '',
            status_is_manual: Boolean(importCompleteToggleSnapshot.status_is_manual),
            items: normalizePersistedImportDraftItems(importCompleteToggleSnapshot.items),
        }
        : null,
    had_local_attachment_files: Array.isArray(form?.local_attachment_files) && form.local_attachment_files.length > 0,
});

const createDocumentForm = (tabKey, data = null) => ({
    id: data?.id || null,
    type: documentTypeMap[tabKey],
    adjustment_kind: data?.adjustment_kind || 'stock_adjustment',
    adjustment_source: data?.adjustment_source || 'manual_inventory',
    document_date: data?.document_date ? String(data.document_date).slice(0, 10) : todayValue,
    supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
    notes: data?.notes || '',
    items: (data?.items || []).length
        ? data.items.map((item) => createLine({
            product_id: item.product_id,
            product_name: item.product?.name || item.product_name_snapshot || '',
            product_sku: item.product?.sku || item.product_sku_snapshot || '',
            quantity: tabKey === 'adjustments'
                ? String(
                    Number(item.quantity || 0) < 0
                        ? Number(item.quantity || 0)
                        : ((item.direction || 'in') === 'out'
                            ? -Math.abs(Number(item.quantity || 0))
                            : Math.abs(Number(item.quantity || 0)))
                )
                : String(item.quantity || 1),
            unit_cost: item.unit_cost != null ? String(Math.round(Number(item.unit_cost || 0))) : '',
            notes: item.notes || '',
            stock_bucket: item.stock_bucket || 'sellable',
            direction: item.direction || 'in',
        }))
        : [createLine()],
});

const createStockAdjustmentModalState = () => ({
    open: false,
    mode: 'adjustment',
    document_date: todayValue,
    notes: '',
    items: [],
});

const getDocumentLineQuantityValue = (tabKey, item) => {
    if (tabKey === 'adjustments') {
        return parseSignedWholeNumberInput(item.quantity) ?? 0;
    }

    return Number(item.quantity || 0);
};

const getDocumentLineValue = (tabKey, item) => (
    getDocumentLineQuantityValue(tabKey, item) * Number(item.unit_cost || 0)
);

const createExportForm = (data = null) => ({
    id: data?.id || null,
    customer_name: data?.customer_name || '',
    customer_phone: data?.customer_phone || '',
    customer_email: data?.customer_email || '',
    shipping_address: data?.shipping_address || '',
    source: data?.source || data?.invoice_meta?.sale_channel || exportSourceOptions[0].value,
    notes: data?.notes || '',
    invoice_meta: buildExportInvoiceMeta(data?.invoice_meta || {}),
    items: (data?.items || []).length
        ? data.items.map((item) => createLine({
            product_id: item.product_id,
            product_name: item.product?.name || item.product_name_snapshot || '',
            product_sku: item.product?.sku || item.product_sku_snapshot || '',
            quantity: String(item.quantity || 1),
            unit_name: item.product?.unit?.name || item.product?.unit_name || item.unit_name || '',
            unit_cost: item.price != null
                ? String(Math.round(Number(item.price || 0)))
                : String(Math.round(Number(item.product?.current_price ?? item.product?.price ?? 0))),
            notes: item.options?.note || item.notes || '',
        }))
        : [createLine()],
});

const importItemColumns = [
    { id: 'product_name', label: 'Tên sản phẩm', minWidth: 300 },
    { id: 'product_sku', label: 'Mã SP', minWidth: 140 },
    { id: 'supplier_product_code', label: 'Mã NCC', minWidth: 150 },
    { id: 'quantity', label: 'Số lượng nhập', minWidth: 164, align: 'right' },
    { id: 'received_quantity', label: 'Số lượng đã về', minWidth: 164, align: 'right' },
    { id: 'outstanding_quantity', label: 'SL chưa về', minWidth: 120, align: 'center', draggable: false },
    { id: 'unit_name', label: 'ĐVT', minWidth: 100 },
    { id: 'notes', label: 'Ghi chú', minWidth: 180 },
    { id: 'unit_cost', label: 'Giá nhập', minWidth: 150, align: 'right' },
    { id: 'line_total', label: 'Thành tiền', minWidth: 130, align: 'right', draggable: false },
    { id: 'actions', label: 'Xóa', minWidth: 90, align: 'center', draggable: false },
];

const importPrintColumns = [
    { id: 'stt', label: 'STT', align: 'center', widthWeight: 0.7, render: (_item, index) => String(index + 1) },
    { id: 'product_name', label: 'Tên sản phẩm', align: 'left', widthWeight: 3.6, render: (item) => item.product_name || '-' },
    { id: 'product_sku', label: 'Mã SP', align: 'left', widthWeight: 1.7, render: (item) => item.product_sku || '-' },
    { id: 'supplier_product_code', label: 'Mã NCC', align: 'left', widthWeight: 1.8, render: (item) => item.supplier_product_code || '-' },
    { id: 'quantity', label: 'Số lượng nhập', align: 'right', widthWeight: 1.35, render: (item) => formatNumber(item.quantity || 0) },
    { id: 'received_quantity', label: 'Số lượng đã về', align: 'right', widthWeight: 1.35, render: (item) => formatNumber(item.received_quantity ?? 0) },
    { id: 'outstanding_quantity', label: 'SL chưa về', align: 'right', widthWeight: 1.15, render: (item) => formatNumber(Math.max(Number(item.quantity || 0) - Number(item.received_quantity ?? 0), 0)) },
    { id: 'unit_name', label: 'ĐVT', align: 'center', widthWeight: 0.95, render: (item) => item.unit_name || '-' },
    { id: 'notes', label: 'Ghi chú', align: 'left', widthWeight: 2.1, render: (item) => item.notes || '' },
    { id: 'unit_cost', label: 'Giá nhập', align: 'right', widthWeight: 1.4, render: (item) => formatCurrency(item.unit_cost || 0) },
    { id: 'line_total', label: 'Thành tiền', align: 'right', widthWeight: 1.5, render: (item) => formatCurrency(Number(item.quantity || 0) * Number(item.unit_cost || 0)) },
];
const importPutawayPrintColumns = [
    { id: 'stt', label: 'STT', align: 'center', widthWeight: 0.55, render: (_item, index) => String(index + 1) },
    {
        id: 'product_name',
        label: 'Tên sản phẩm',
        align: 'left',
        widthWeight: 4.35,
        renderHtml: (item) => `
            <div class="product-name">${escapePrintHtml(item.product_name || '-')}</div>
            <div class="product-sku">${escapePrintHtml(item.product_sku || '-')}</div>
        `,
    },
    { id: 'quantity', label: 'Số lượng', align: 'center', widthWeight: 0.9, render: (item) => formatNumber(item.quantity_to_putaway ?? item.quantity ?? 0) },
    { id: 'storage_location', label: 'Vị trí', align: 'center', widthWeight: 2.4, render: (item) => formatImportPutawayLocationLine(item.storage_location) },
];
const importPrintColumnMap = new Map(importPrintColumns.map((column) => [column.id, column]));
const importPrintColumnOrder = importPrintColumns.map((column) => column.id);
const IMPORT_PRINT_DEFAULT_COLUMN_IDS = ['product_name', 'quantity', 'unit_name', 'unit_cost', 'line_total'];
const orderImportPrintColumnIds = (columnIds = [], fallbackToDefault = true) => {
    const requestedIds = Array.from(new Set(
        (Array.isArray(columnIds) ? columnIds : [])
            .map((columnId) => String(columnId || '').trim())
            .filter(Boolean)
    ));
    const orderedIds = importPrintColumnOrder.filter((columnId) => requestedIds.includes(columnId));
    return orderedIds.length ? orderedIds : (fallbackToDefault ? [...IMPORT_PRINT_DEFAULT_COLUMN_IDS] : []);
};
const normalizeImportPrintTemplate = (template, index = 0) => {
    const templateId = String(template?.id || `inventory_import_template_${index + 1}`);
    return {
        id: templateId,
        name: String(template?.name || '').trim() || `Mẫu in ${index + 1}`,
        column_ids: orderImportPrintColumnIds(template?.column_ids),
        locked: Boolean(template?.locked) || templateId === IMPORT_PRINT_DEFAULT_TEMPLATE_ID,
    };
};
const ensureDefaultImportPrintTemplates = (templates = []) => {
    const normalizedTemplates = [];
    const seen = new Set();

    (Array.isArray(templates) ? templates : []).forEach((template, index) => {
        const normalizedTemplate = normalizeImportPrintTemplate(template, index);
        if (!normalizedTemplate.id || seen.has(normalizedTemplate.id)) return;
        seen.add(normalizedTemplate.id);
        normalizedTemplates.push(normalizedTemplate);
    });

    const defaultTemplate = {
        id: IMPORT_PRINT_DEFAULT_TEMPLATE_ID,
        name: IMPORT_PRINT_DEFAULT_TEMPLATE_NAME,
        column_ids: [...IMPORT_PRINT_DEFAULT_COLUMN_IDS],
        locked: true,
    };

    const defaultIndex = normalizedTemplates.findIndex((template) => template.id === IMPORT_PRINT_DEFAULT_TEMPLATE_ID);
    if (defaultIndex >= 0) {
        const existingDefault = normalizedTemplates[defaultIndex];
        normalizedTemplates[defaultIndex] = {
            ...existingDefault,
            ...defaultTemplate,
            name: existingDefault.name || defaultTemplate.name,
            column_ids: orderImportPrintColumnIds(existingDefault.column_ids),
        };
    } else {
        normalizedTemplates.unshift(defaultTemplate);
    }

    return normalizedTemplates.map((template) => ({
        ...template,
        locked: Boolean(template.locked) || template.id === IMPORT_PRINT_DEFAULT_TEMPLATE_ID,
        column_ids: orderImportPrintColumnIds(template.column_ids),
    }));
};
const getImportPrintTemplateById = (templates = [], templateId = '') => {
    const normalizedTemplates = ensureDefaultImportPrintTemplates(templates);
    return normalizedTemplates.find((template) => template.id === templateId) || normalizedTemplates[0];
};
const createImportPrintTemplateId = () => `inventory_import_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const escapePrintHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const buildImportPrintHtml = ({
    supplierName = 'Tất cả sản phẩm',
    importNumber = '',
    importDate = '',
    printedAt = '',
    columns = [],
    items = [],
    subtotal = 0,
    surcharge = 0,
    total = 0,
    notes = '',
    documents = [],
} = {}) => {
    const normalizedColumns = (Array.isArray(columns) ? columns : []).filter(Boolean);
    const totalWeight = normalizedColumns.reduce((sum, column) => sum + Number(column.widthWeight || 1), 0) || normalizedColumns.length || 1;
    const orientation = normalizedColumns.length > 6 || totalWeight > 11 ? 'landscape' : 'portrait';
    const normalizedDocuments = (Array.isArray(documents) && documents.length
        ? documents
        : [{
            supplierName,
            importNumber,
            importDate,
            items,
            subtotal,
            surcharge,
            total,
            notes,
        }]
    ).map((document) => ({
        supplierName: document?.supplierName || 'Tất cả sản phẩm',
        importNumber: document?.importNumber || '',
        importDate: document?.importDate || '',
        items: Array.isArray(document?.items) ? document.items : [],
        subtotal: Number(document?.subtotal || 0),
        surcharge: Number(document?.surcharge || 0),
        total: Number(document?.total || 0),
        notes: document?.notes || '',
    }));

    const headerCells = normalizedColumns.map((column) => {
        const width = ((Number(column.widthWeight || 1) / totalWeight) * 100).toFixed(2);
        return `<th class="align-${column.align || 'left'}" style="width:${width}%">${escapePrintHtml(column.label)}</th>`;
    }).join('');

    const renderBodyRows = (documentItems) => (documentItems.length
        ? documentItems.map((item, index) => `
            <tr>
                ${normalizedColumns.map((column) => {
                    const cellValue = typeof column.render === 'function' ? column.render(item, index) : item?.[column.id];
                    const normalizedCellValue = cellValue === null || cellValue === undefined || cellValue === '' ? '-' : cellValue;
                    return `<td class="align-${column.align || 'left'}">${escapePrintHtml(normalizedCellValue)}</td>`;
                }).join('')}
            </tr>
        `).join('')
        : `<tr><td colspan="${Math.max(normalizedColumns.length, 1)}" class="empty">Chưa có dòng sản phẩm.</td></tr>`);

    const renderTotalRow = (documentTotal) => (normalizedColumns.length > 1
        ? `
            <tfoot>
                <tr class="summary-row">
                    <td colspan="${normalizedColumns.length - 1}">Tổng tiền đơn</td>
                    <td class="align-right">${escapePrintHtml(formatCurrency(documentTotal))}</td>
                </tr>
            </tfoot>
        `
        : `
            <tfoot>
                <tr class="summary-row">
                    <td class="align-right">Tổng tiền đơn: ${escapePrintHtml(formatCurrency(documentTotal))}</td>
                </tr>
            </tfoot>
        `);

    const renderNotesSection = (documentNotes) => String(documentNotes || '').trim()
        ? `
            <div class="notes-block">
                <div class="section-title">Ghi chú</div>
                <div>${escapePrintHtml(documentNotes)}</div>
            </div>
        `
        : '';

    const sheetsHtml = normalizedDocuments.map((document, index) => {
        const printedAtLabel = formatDateTime(printedAt || new Date().toISOString());
        const sheetLabel = normalizedDocuments.length > 1
            ? `Bản in tối ưu cho khổ giấy A4 • Phiếu ${index + 1}/${normalizedDocuments.length}`
            : 'Bản in tối ưu cho khổ giấy A4';

        return `
            <section class="sheet">
                <div class="header">
                    <div class="title-block">
                        <h1>Phiếu nhập</h1>
                        <p>${escapePrintHtml(sheetLabel)}</p>
                    </div>
                    <div class="meta-card">
                        ${document.importNumber ? `
                            <div class="meta-row">
                                <div class="meta-label">Mã phiếu</div>
                                <div>${escapePrintHtml(document.importNumber)}</div>
                            </div>
                        ` : ''}
                        ${document.importDate ? `
                            <div class="meta-row">
                                <div class="meta-label">Ngày nhập</div>
                                <div>${escapePrintHtml(formatPrintDate(document.importDate))}</div>
                            </div>
                        ` : ''}
                        <div class="meta-row">
                            <div class="meta-label">Nhà cung cấp</div>
                            <div>${escapePrintHtml(document.supplierName)}</div>
                        </div>
                        <div class="meta-row">
                            <div class="meta-label">Ngày giờ in</div>
                            <div>${escapePrintHtml(printedAtLabel)}</div>
                        </div>
                        <div class="meta-row">
                            <div class="meta-label">Số dòng</div>
                            <div>${escapePrintHtml(formatNumber(document.items.length))}</div>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>${headerCells}</tr>
                    </thead>
                    <tbody>${renderBodyRows(document.items)}</tbody>
                    ${renderTotalRow(document.total)}
                </table>

                <div class="totals">
                    <div class="total-card">
                        <span>Tổng tiền hàng</span>
                        <strong>${escapePrintHtml(formatCurrency(document.subtotal))}</strong>
                    </div>
                    <div class="total-card">
                        <span>Phụ phí</span>
                        <strong>${escapePrintHtml(formatCurrency(document.surcharge))}</strong>
                    </div>
                    <div class="total-card">
                        <span>Tổng tiền đơn</span>
                        <strong>${escapePrintHtml(formatCurrency(document.total))}</strong>
                    </div>
                </div>

                ${renderNotesSection(document.notes)}
            </section>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8" />
    <title>Phiếu nhập</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap&subset=vietnamese" rel="stylesheet" />
    <style>
        @page { size: A4 ${orientation}; margin: 12mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: 'Roboto', sans-serif;
            color: #16324f;
            background: #ffffff;
        }
        .sheet {
            width: 100%;
        }
        .sheet + .sheet {
            break-before: page;
            page-break-before: always;
            margin-top: 8mm;
        }
        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 14px;
        }
        .title-block h1 {
            margin: 0 0 6px;
            font-size: 24px;
            font-weight: 700;
            color: #17324d;
        }
        .title-block p {
            margin: 0;
            font-size: 12px;
            color: #5f7288;
        }
        .meta-card {
            min-width: 260px;
            border: 1px solid #d8e3ef;
            border-radius: 8px;
            padding: 12px 14px;
            background: #f7fafc;
        }
        .meta-row {
            display: flex;
            gap: 10px;
            font-size: 12px;
            line-height: 1.5;
        }
        .meta-row + .meta-row {
            margin-top: 6px;
        }
        .meta-label {
            min-width: 92px;
            font-weight: 700;
            color: #5f7288;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        th, td {
            border: 1px solid #d8e3ef;
            padding: 7px 8px;
            font-size: 11px;
            line-height: 1.45;
            vertical-align: top;
            word-break: break-word;
        }
        thead th {
            background: #eff5fb;
            font-weight: 700;
            color: #17324d;
        }
        tbody tr:nth-child(even) td {
            background: #fbfdff;
        }
        .align-left { text-align: left; }
        .align-center { text-align: center; }
        .align-right { text-align: right; }
        .empty {
            padding: 16px 10px;
            text-align: center;
            color: #6b7d92;
        }
        .summary-row td {
            background: #edf4fb;
            font-weight: 700;
        }
        .totals {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-top: 12px;
        }
        .total-card {
            border: 1px solid #d8e3ef;
            border-radius: 8px;
            padding: 10px 12px;
            background: #ffffff;
        }
        .total-card span {
            display: block;
            margin-bottom: 4px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #6b7d92;
        }
        .total-card strong {
            font-size: 15px;
            color: #17324d;
        }
        .notes-block {
            margin-top: 12px;
            border: 1px solid #d8e3ef;
            border-radius: 8px;
            padding: 10px 12px;
            background: #ffffff;
            font-size: 11px;
            line-height: 1.55;
        }
        .section-title {
            margin-bottom: 6px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #6b7d92;
        }
        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    ${sheetsHtml}
</body>
</html>`;
};

const buildImportPutawayPrintHtml = ({
    printedAt = '',
    documents = [],
} = {}) => {
    const normalizedDocuments = (Array.isArray(documents) ? documents : []).map((document) => ({
        supplierName: document?.supplierName || 'Tất cả sản phẩm',
        importNumber: document?.importNumber || '',
        importDate: document?.importDate || '',
        items: sortImportPutawayItems(Array.isArray(document?.items) ? document.items : []),
        notes: document?.notes || '',
    }));
    const normalizedColumns = importPutawayPrintColumns;
    const totalWeight = normalizedColumns.reduce((sum, column) => sum + Number(column.widthWeight || 1), 0) || 1;
    const printedAtLabel = formatDateTime(printedAt || new Date().toISOString());
    const headerCells = normalizedColumns.map((column) => {
        const width = ((Number(column.widthWeight || 1) / totalWeight) * 100).toFixed(2);
        return `<th class="col-${column.id} align-${column.align || 'left'}" style="width:${width}%">${escapePrintHtml(column.label)}</th>`;
    }).join('');

    const renderBodyRows = (documentItems) => (documentItems.length
        ? documentItems.map((item, index) => `
            <tr class="${item.storage_location ? '' : 'missing-location'}">
                ${normalizedColumns.map((column) => {
                    if (typeof column.renderHtml === 'function') {
                        return `<td class="col-${column.id} align-${column.align || 'left'}">${column.renderHtml(item, index)}</td>`;
                    }

                    const cellValue = typeof column.render === 'function' ? column.render(item, index) : item?.[column.id];
                    const normalizedCellValue = cellValue === null || cellValue === undefined || cellValue === '' ? '-' : cellValue;
                    return `<td class="col-${column.id} align-${column.align || 'left'}">${escapePrintHtml(normalizedCellValue)}</td>`;
                }).join('')}
            </tr>
        `).join('')
        : `<tr><td colspan="${normalizedColumns.length}" class="empty">Chưa có dòng sản phẩm.</td></tr>`);

    const sheetsHtml = (normalizedDocuments.length ? normalizedDocuments : [{
        supplierName: 'Tất cả sản phẩm',
        importNumber: '',
        importDate: '',
        items: [],
        notes: '',
    }]).map((document, index) => {
        const sheetLabel = normalizedDocuments.length > 1
            ? `Phiếu ${index + 1}/${normalizedDocuments.length}`
            : 'Bảng xếp hàng';

        return `
            <section class="sheet">
                <div class="header">
                    <div class="title-block">
                        <h1>In xếp hàng</h1>
                        <p>${escapePrintHtml(sheetLabel)}</p>
                    </div>
                    <div class="meta-card">
                        <div class="meta-item">
                            <span class="meta-label">Mã phiếu</span>
                            <strong class="meta-value">${escapePrintHtml(document.importNumber || '-')}</strong>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Ngày nhập</span>
                            <strong class="meta-value">${escapePrintHtml(document.importDate ? formatPrintDate(document.importDate) : '-')}</strong>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Nhà cung cấp</span>
                            <strong class="meta-value">${escapePrintHtml(document.supplierName)}</strong>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Ngày giờ in</span>
                            <strong class="meta-value">${escapePrintHtml(printedAtLabel)}</strong>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>${headerCells}</tr>
                    </thead>
                    <tbody>${renderBodyRows(document.items)}</tbody>
                </table>
            </section>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8" />
    <title>In xếp hàng phiếu nhập</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap&subset=vietnamese" rel="stylesheet" />
    <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: 'Roboto', sans-serif;
            color: #16324f;
            background: #ffffff;
        }
        .sheet {
            width: 100%;
        }
        .sheet + .sheet {
            break-before: page;
            page-break-before: always;
            margin-top: 8mm;
        }
        .header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 12px;
        }
        .title-block h1 {
            margin: 0 0 6px;
            font-size: 24px;
            font-weight: 700;
            color: #17324d;
        }
        .title-block p {
            margin: 0;
            font-size: 12px;
            color: #5f7288;
        }
        .meta-card {
            width: 390px;
            border: 1px solid #d8e3ef;
            border-radius: 8px;
            padding: 10px 12px;
            background: #f7fafc;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 12px;
        }
        .meta-item {
            min-width: 0;
            font-size: 11px;
            line-height: 1.35;
        }
        .meta-label {
            display: block;
            margin-bottom: 2px;
            font-weight: 700;
            color: #5f7288;
        }
        .meta-value {
            display: block;
            min-width: 0;
            color: #17324d;
            overflow-wrap: anywhere;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        th, td {
            border: 1px solid #d8e3ef;
            padding: 7px 8px;
            font-size: 11px;
            line-height: 1.42;
            vertical-align: middle;
            word-break: break-word;
        }
        thead th {
            background: #eff5fb;
            font-weight: 700;
            color: #17324d;
        }
        tbody tr:nth-child(even) td {
            background: #fbfdff;
        }
        tbody tr.missing-location td {
            background: #fff7ed;
        }
        .align-left { text-align: left; }
        .align-center { text-align: center; }
        .align-right { text-align: right; }
        .col-stt,
        .col-quantity {
            font-weight: 700;
        }
        .product-name {
            font-weight: 500;
            color: #16324f;
        }
        .product-sku {
            margin-top: 3px;
            font-size: 9.5px;
            font-weight: 600;
            line-height: 1.25;
            color: #7b8da3;
        }
        .empty {
            padding: 16px 10px;
            text-align: center;
            color: #6b7d92;
        }
        @media print {
            body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</head>
<body>
    ${sheetsHtml}
</body>
</html>`;
};

const parseLineQuantity = (value, fallback = 0) => {
    return parseQuantityDraft(value, fallback);
};

const clampReceivedQuantity = (receivedValue, quantityValue) => {
    const quantity = Math.max(Number(quantityValue || 0), 0);
    const received = Math.max(Number(receivedValue || 0), 0);
    if (received > quantity) return quantity;
    return received;
};

const normalizeImportStatusKey = (value) => normalizeSearchText(value).replace(/\s+/g, '_');

const isCompletedImportStatus = (status) => {
    if (!status) return false;
    const code = normalizeImportStatusKey(status.code);
    const name = normalizeSearchText(status.name);
    return ['hoan_thanh', 'completed', 'complete', 'done'].includes(code)
        || ['hoan thanh', 'completed', 'complete', 'done'].includes(name)
        || (name.includes('completed') && !name.includes('partial') && !name.includes('incomplete'))
        || (name.includes('complete') && !name.includes('partial') && !name.includes('incomplete'));
};
const isNewImportStatus = (status) => {
    if (!status) return false;
    const code = normalizeImportStatusKey(status.code);
    const name = normalizeSearchText(status.name);
    return ['moi', 'new'].includes(code) || ['moi', 'new'].includes(name);
};
const importStatusDedupKey = (status) => {
    if (isNewImportStatus(status)) return 'new';
    if (isCompletedImportStatus(status)) return 'completed';
    const code = normalizeImportStatusKey(status?.code);
    const name = normalizeSearchText(status?.name);
    return code || name || String(status?.id || '');
};
const deduplicateImportStatuses = (statuses = []) => {
    const seen = new Set();

    return (Array.isArray(statuses) ? statuses : []).filter((status) => {
        const key = importStatusDedupKey(status);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const productColumns = [
    { id: 'select', label: '', minWidth: 46, align: 'center', draggable: false, sortable: false },
    { id: 'product', label: 'Sản phẩm', minWidth: 300 },
    { id: 'total_imported', label: 'Tổng nhập', minWidth: 72, align: 'right', headerTooltip: 'Cộng SL đã về từ các phiếu nhập.', headerRender: () => renderTwoLineHeader('Tổng', 'nhập') },
    { id: 'total_exported', label: 'Tổng xuất', minWidth: 72, align: 'right', headerTooltip: 'Cộng SL từ các phiếu xuất kho.', headerRender: () => renderTwoLineHeader('Tổng', 'xuất') },
    { id: 'recent_outbound_quantity', label: 'Đi 15 ngày', minWidth: 86, align: 'right', headerTooltip: 'Số lượng đã xuất trong 15 ngày gần nhất.', headerRender: () => renderTwoLineHeader('Đi', '15 ngày') },
    { id: 'total_returned', label: 'Tổng hoàn', minWidth: 72, align: 'right', headerTooltip: 'Cộng SL đã nhập lại từ phiếu hoàn.', headerRender: () => renderTwoLineHeader('Tổng', 'hoàn') },
    { id: 'total_damaged', label: 'Tổng hỏng', minWidth: 72, align: 'right', headerTooltip: 'Cộng SL từ các phiếu hỏng.', headerRender: () => renderTwoLineHeader('Tổng', 'hỏng') },
    { id: 'total_adjusted', label: 'Điều chỉnh tồn', minWidth: 92, align: 'right', headerTooltip: 'Cộng/trừ SL từ phiếu điều chỉnh tồn độc lập.', headerRender: () => renderTwoLineHeader('Điều chỉnh', 'tồn') },
    { id: 'computed_stock', label: 'Tồn kho', minWidth: 76, align: 'right', headerTooltip: 'Tổng nhập - Tổng xuất + Tổng hoàn - Tổng hỏng + Điều chỉnh tồn', headerRender: () => renderTwoLineHeader('Tồn', 'kho') },
    { id: 'pending_export_quantity', label: 'SL chờ xuất', minWidth: 82, align: 'right', headerTooltip: 'Cộng SL đã bán nhưng chưa có phiếu xuất.', headerRender: () => renderTwoLineHeader('SL chờ', 'xuất') },
    { id: 'pending_return_quantity', label: 'SL hoàn chờ về', minWidth: 90, align: 'right', headerTooltip: 'Cộng SL đơn hoàn chưa nhập lại kho.', headerRender: () => renderTwoLineHeader('SL hoàn', 'chờ về') },
    { id: 'actual_stock', label: 'Có thể bán', minWidth: 84, align: 'right', headerTooltip: 'Có thể bán = Tồn kho - SL chờ xuất', headerRender: () => renderTwoLineHeader('Có thể', 'bán') },
    { id: 'tracking_daily_average', label: 'TB/ngày', minWidth: 78, align: 'right', headerTooltip: 'Tốc độ đi trung bình trong 15 ngày, cộng cả lượng chờ xuất.', headerRender: () => renderTwoLineHeader('TB', 'ngày') },
    { id: 'tracking_stock_coverage_days', label: 'Đủ bán', minWidth: 82, align: 'right', headerTooltip: 'Ước tính tồn hiện tại đủ bán bao nhiêu ngày theo tốc độ 15 ngày.', headerRender: () => renderTwoLineHeader('Đủ', 'bán') },
    { id: 'tracking_status', label: 'Theo dõi', minWidth: 92, align: 'center', headerTooltip: 'Ưu tiên nhập hàng dựa trên lượng đi 15 ngày, chờ xuất và tồn còn lại.' },
    { id: 'expected_cost', label: 'Giá nhập dự kiến', minWidth: 108, align: 'right', headerRender: () => renderTwoLineHeader('Giá nhập', 'dự kiến') },
    { id: 'current_cost', label: 'Giá nhập thực tế', minWidth: 108, align: 'right', headerTooltip: 'Tổng tiền nhập hợp lệ / Tổng SL nhập hợp lệ', headerRender: () => renderTwoLineHeader('Giá nhập', 'thực tế') },
    { id: 'inventory_value', label: 'Thành tiền', minWidth: 104, align: 'right', headerTooltip: 'Có thể bán x giá đang dùng; thiếu giá thực tế thì lấy giá dự kiến', headerRender: () => renderTwoLineHeader('Thành', 'tiền') },
    { id: 'actions', label: 'Thao tác', minWidth: 190, align: 'center' },
];

const supplierColumns = [
    { id: 'name', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'code', label: 'Mã', minWidth: 120 },
    { id: 'phone', label: 'Điện thoại', minWidth: 135 },
    { id: 'prices_count', label: 'Bảng giá', minWidth: 95, align: 'right' },
    { id: 'import_slips_count', label: 'Số phiếu nhập', minWidth: 115, align: 'right' },
    { id: 'imported_quantity_total', label: 'Tổng số lượng', minWidth: 115, align: 'right' },
    { id: 'imported_amount_total', label: 'Tổng tiền nhập', minWidth: 135, align: 'right' },
    { id: 'actions', label: 'Thao tác', minWidth: 135, align: 'center' },
];

const supplierPriceBaseColumns = [
    { id: 'sku', label: 'Mã sản phẩm', minWidth: 150 },
    { id: 'name', label: 'Tên sản phẩm', minWidth: 280 },
    { id: 'price', label: 'Giá bán', minWidth: 110, align: 'right' },
    { id: 'supplier_unit_cost', label: 'Giá dự kiến', minWidth: 160, align: 'right' },
    { id: 'current_cost', label: 'Giá nhập thực tế', minWidth: 125, align: 'right', headerTooltip: 'Tổng tiền nhập hợp lệ / Tổng SL nhập hợp lệ; chưa có nhập thì tạm lấy giá dự kiến' },
    { id: 'supplier_price_updated_at', label: 'Sửa gần nhất', minWidth: 150, align: 'center' },
];

const importColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'supplier', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'date', label: 'Ngày nhập', minWidth: 150 },
    { id: 'status', label: 'Trạng thái', minWidth: 150 },
    { id: 'invoice', label: 'Hóa đơn', minWidth: 92, align: 'center' },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Tổng số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Tổng tiền', minWidth: 130, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 200 },
    { id: 'detail', label: 'Chi tiết', minWidth: 92, align: 'center', draggable: false, sortable: false },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const exportColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 140 },
    { id: 'source', label: 'Nguồn xuất', minWidth: 180 },
    { id: 'customer', label: 'Người nhận / nơi nhận', minWidth: 240 },
    { id: 'tracking', label: 'Mã vận đơn', minWidth: 190 },
    { id: 'date', label: 'Ngày xuất', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Tổng SL', minWidth: 110, align: 'right' },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const documentColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'supplier', label: 'Nhà cung cấp', minWidth: 200 },
    { id: 'date', label: 'Ngày', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Giá trị', minWidth: 120, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 200 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const adjustmentColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'kind', label: 'Loại điều chỉnh', minWidth: 180 },
    { id: 'source', label: 'Nguồn tạo phiếu', minWidth: 240 },
    { id: 'product', label: 'Sản phẩm', minWidth: 240 },
    { id: 'old_quantity', label: 'Số lượng cũ', minWidth: 120, align: 'right' },
    { id: 'new_quantity', label: 'Số lượng mới', minWidth: 120, align: 'right' },
    { id: 'difference', label: 'Chênh lệch', minWidth: 120, align: 'right' },
    { id: 'impact', label: 'Ảnh hưởng', minWidth: 220 },
    { id: 'date', label: 'Ngày', minWidth: 140 },
    { id: 'actions', label: 'Thao tác', minWidth: 160, align: 'center' },
];

const lotColumns = [
    { id: 'code', label: 'Mã lô', minWidth: 150 },
    { id: 'product', label: 'Sản phẩm', minWidth: 250 },
    { id: 'date', label: 'Ngày nhập', minWidth: 150 },
    { id: 'qty', label: 'Số lượng lô', minWidth: 110, align: 'right' },
    { id: 'remaining', label: 'Còn lại', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Giá nhập', minWidth: 110, align: 'right' },
    { id: 'source', label: 'Nguồn', minWidth: 180 },
];

const trashColumns = [
    { id: 'type', label: 'Loại phiếu', minWidth: 150 },
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'party', label: 'Đối tượng', minWidth: 240 },
    { id: 'date', label: 'Ngày xóa', minWidth: 150 },
    { id: 'qty', label: 'Số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Giá trị', minWidth: 120, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 220 },
    { id: 'actions', label: 'Thao tác', minWidth: 120, align: 'center' },
];

const supplierManagementColumns = [
    { id: 'name', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'code', label: 'Mã', minWidth: 120 },
    { id: 'phone', label: 'Điện thoại', minWidth: 135 },
    { id: 'prices_count', label: 'Bảng giá', minWidth: 95, align: 'right' },
    { id: 'import_slips_count', label: 'Số phiếu nhập', minWidth: 115, align: 'right' },
    { id: 'imported_amount_total', label: 'Tổng tiền nhập', minWidth: 135, align: 'right' },
    { id: 'updated_at', label: 'Cập nhật', minWidth: 150, align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: 190, align: 'center' },
];

const supplierPriceTableBaseColumns = [
    { id: 'supplier_product_code', label: 'Mã NCC', minWidth: 140 },
    { id: 'sku', label: 'Mã sản phẩm', minWidth: 150 },
    { id: 'name', label: 'Tên sản phẩm', minWidth: 280 },
    { id: 'price', label: 'Giá bán', minWidth: 110, align: 'right' },
    { id: 'unit_cost', label: 'Giá nhập dự kiến', minWidth: 160, align: 'right' },
    { id: 'current_cost', label: 'Giá nhập thực tế', minWidth: 125, align: 'right', headerTooltip: 'Tổng tiền nhập hợp lệ / Tổng SL nhập hợp lệ; chưa có nhập thì tạm lấy giá dự kiến' },
    { id: 'supplier_name', label: 'Nhà CC', minWidth: 180 },
    { id: 'updated_at', label: 'Sửa gần nhất', minWidth: 150, align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: 120, align: 'center' },
];

const inventorySortColumnMaps = {
    products: {
        product: 'name',
        total_imported: 'total_imported',
        total_exported: 'total_exported',
        recent_outbound_quantity: 'recent_outbound_quantity',
        total_returned: 'total_returned',
        total_damaged: 'total_damaged',
        total_adjusted: 'total_adjusted',
        computed_stock: 'computed_stock',
        pending_export_quantity: 'pending_export_quantity',
        pending_return_quantity: 'pending_return_quantity',
        actual_stock: 'actual_stock',
        tracking_daily_average: 'tracking_daily_average',
        tracking_stock_coverage_days: 'tracking_stock_coverage_days',
        tracking_status: 'tracking_priority_score',
        expected_cost: 'expected_cost',
        current_cost: 'cost_price',
        inventory_value: 'inventory_value',
    },
    suppliers: {
        name: 'name',
        code: 'code',
        phone: 'phone',
        prices_count: 'prices_count',
        import_slips_count: 'import_slips_count',
        imported_amount_total: 'imported_amount_total',
        updated_at: 'updated_at',
    },
    supplierPrices: {
        sku: 'sku',
        supplier_product_code: 'supplier_product_code',
        name: 'name',
        price: 'price',
        unit_cost: 'unit_cost',
        current_cost: 'current_cost',
        updated_at: 'updated_at',
    },
    imports: {
        code: 'code',
        supplier: 'supplier',
        date: 'date',
        status: 'status',
        line_count: 'line_count',
        qty: 'qty',
        amount: 'amount',
        note: 'note',
    },
    exports: {
        code: 'code',
        source: 'source',
        customer: 'customer',
        tracking: 'tracking',
        date: 'date',
        line_count: 'line_count',
        qty: 'qty',
    },
    documents: {
        code: 'code',
        supplier: 'supplier',
        date: 'date',
        line_count: 'line_count',
        qty: 'qty',
        amount: 'amount',
        note: 'note',
    },
    adjustments: {
        code: 'code',
        kind: 'kind',
        source: 'source',
        date: 'date',
    },
    lots: {
        code: 'code',
        product: 'product',
        date: 'date',
        qty: 'qty',
        remaining: 'remaining',
        amount: 'amount',
        source: 'source',
    },
    trash: {
        type: 'type',
        code: 'code',
        party: 'party',
        date: 'date',
        qty: 'qty',
        amount: 'amount',
        note: 'note',
    },
};

const ActiveFilterChips = ({ items = [], onClearAll = null, variant = 'block' }) => {
    const visibleItems = items.filter(Boolean);
    if (visibleItems.length === 0) return null;
    const isInline = variant === 'inline';

    return (
        <div className={isInline ? 'min-w-0 flex-1 overflow-x-auto' : 'border-y border-primary/10 bg-[#fbfcfe] px-3 py-2'}>
            <div className={isInline ? 'flex min-w-max items-center justify-end gap-2' : 'flex flex-wrap items-center gap-2'}>
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Đang lọc</div>
                {visibleItems.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        onClick={item.onRemove}
                        className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border border-primary/15 bg-white px-3 py-1 text-left text-[12px] text-primary transition hover:border-brick/35 hover:text-brick"
                        title={`Bỏ lọc ${String(item.label || '').toLowerCase()}`}
                    >
                        <span className={`${isInline ? 'max-w-[185px]' : 'max-w-[260px]'} truncate`}>
                            <span className="font-semibold text-primary/55">{item.label}:</span>
                            {' '}
                            <span className="font-black text-primary">{item.value}</span>
                        </span>
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                ))}
                {onClearAll ? (
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="inline-flex items-center rounded-full border border-primary/15 px-3 py-1 text-[12px] font-bold text-primary transition hover:border-primary hover:bg-white"
                    >
                        Xóa hết
                    </button>
                ) : null}
            </div>
        </div>
    );
};

const PanelHeader = ({ title, description, toggles = [], leadingActions = null, actions = null, activeFilterChips = [], onClearAllFilters = null, activeFilterPlacement = 'below' }) => {
    const hasActiveFilterChips = activeFilterChips.filter(Boolean).length > 0;
    const renderInlineFilterChips = activeFilterPlacement === 'toolbar' && hasActiveFilterChips;
    const renderBelowFilterChips = activeFilterPlacement !== 'toolbar' && hasActiveFilterChips;

    return (
        <>
            <div className={`flex items-center justify-between gap-2 px-3 py-2.5 ${renderBelowFilterChips ? '' : 'border-b border-primary/10'}`}>
                <div className="min-w-0 shrink-0">
                    <div className="text-[13px] font-black text-primary">{title}</div>
                    {description ? <div className="text-[11px] text-primary/45">{description}</div> : null}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    {renderInlineFilterChips ? <ActiveFilterChips items={activeFilterChips} onClearAll={onClearAllFilters} variant="inline" /> : null}
                    {leadingActions}
                    {toggles.map((toggle) => (
                        <button
                            key={toggle.id}
                            type="button"
                            onClick={toggle.onClick}
                            disabled={toggle.disabled}
                            className={`${iconButton(toggle.active)} ${toggle.disabled ? 'cursor-not-allowed opacity-45 hover:border-primary/15 hover:bg-white hover:text-primary' : ''}`}
                            title={toggle.disabled ? (toggle.disabledTitle || toggle.label) : toggle.label}
                        >
                            <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                        </button>
                    ))}
                    {actions}
                </div>
            </div>
            {renderBelowFilterChips ? <ActiveFilterChips items={activeFilterChips} onClearAll={onClearAllFilters} /> : null}
        </>
    );
};

const FilterPanel = ({ children, actions, singleLine = false }) => (
    <div className="border-b border-primary/10 bg-[#fbfcfe] px-3 py-2.5">
        {singleLine ? (
            <div className="overflow-visible">
                <div className="flex w-full min-w-0 items-center gap-2">
                    {children}
                    <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
                </div>
            </div>
        ) : (
            <div className="flex flex-wrap items-center gap-2">
                {children}
                <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
            </div>
        )}
    </div>
);

const InventoryMultiSelectFilter = ({
    options = [],
    value = [],
    onChange,
    placeholder = 'Tất cả',
    className = 'w-[175px]',
    menuClassName = 'w-[300px]',
    searchable = false,
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef(null);
    const selectedValues = useMemo(() => normalizeStringFilterList(value), [value]);
    const optionValues = useMemo(
        () => options.map((option) => String(option.value)).filter(Boolean),
        [options]
    );
    const selectedOptions = useMemo(
        () => options.filter((option) => selectedValues.includes(String(option.value))),
        [options, selectedValues]
    );
    const summaryLabel = selectedOptions.length
        ? (selectedOptions.length <= 2
            ? selectedOptions.map((option) => option.label).join(', ')
            : `${selectedOptions.slice(0, 2).map((option) => option.label).join(', ')} +${selectedOptions.length - 2}`)
        : placeholder;
    const filteredOptions = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return options;
        return options.filter((option) => [
            option.label,
            option.value,
            option.description,
        ].some((item) => String(item || '').toLowerCase().includes(needle)));
    }, [options, query]);
    const allSelected = optionValues.length > 0 && selectedValues.length === optionValues.length;

    useEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const applyNextValue = (nextValue) => {
        onChange?.(normalizeStringFilterList(nextValue));
    };

    return (
        <div ref={containerRef} className={`relative ${className}`.trim()}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={`flex w-full items-center justify-between gap-2 ${selectClass}`}
                title={selectedOptions.length ? selectedOptions.map((option) => option.label).join(', ') : summaryLabel}
            >
                <span className={`truncate text-left ${selectedOptions.length ? 'font-bold text-primary' : 'text-primary'}`}>{summaryLabel}</span>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-primary/45">
                    {open ? 'expand_less' : 'expand_more'}
                </span>
            </button>
            {open ? (
                <div className={`absolute left-0 top-full z-40 mt-1 max-w-[calc(100vw-2rem)] rounded-sm border border-primary/15 bg-white shadow-lg ${menuClassName}`}>
                    <button
                        type="button"
                        onClick={() => {
                            applyNextValue([]);
                            setOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 border-b border-primary/10 px-3 py-2.5 text-left transition hover:bg-[#f6f9fc] ${
                            selectedValues.length === 0 ? 'bg-primary/[0.04]' : ''
                        }`}
                    >
                        <span className="truncate text-[12px] font-black text-primary">{placeholder}</span>
                        {selectedValues.length === 0 ? <span className="material-symbols-outlined text-[18px] text-primary">check</span> : null}
                    </button>
                    <div className="flex flex-wrap items-center gap-2 border-b border-primary/10 px-3 py-2">
                        <button type="button" onClick={() => applyNextValue(optionValues)} disabled={!optionValues.length || allSelected} className={ghostButton}>Chọn hết</button>
                        <button type="button" onClick={() => applyNextValue([])} disabled={!selectedValues.length} className={ghostButton}>Bỏ chọn</button>
                    </div>
                    {searchable ? (
                        <div className="border-b border-primary/10 p-2">
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Tìm trong bộ lọc"
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                    ) : null}
                    <div className="max-h-72 overflow-auto p-1.5">
                        {!filteredOptions.length ? <div className="px-2 py-3 text-[12px] text-primary/45">Không có lựa chọn phù hợp.</div> : null}
                        {filteredOptions.map((option) => {
                            const optionValue = String(option.value);
                            const checked = selectedValues.includes(optionValue);

                            return (
                                <label key={optionValue} className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 transition hover:bg-[#f6f9fc]">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                            applyNextValue(
                                                checked
                                                    ? selectedValues.filter((item) => item !== optionValue)
                                                    : [...selectedValues, optionValue]
                                            );
                                        }}
                                        className={`${checkboxClass} mt-0.5`}
                                    />
                                    <span className={`min-w-0 truncate text-[12px] ${checked ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}>
                                        {option.label}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const ProductSavedSearchSelect = ({
    presets = [],
    selectedId = '',
    onSelect,
    onRename,
    onDelete,
    className = 'w-[180px]',
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef(null);
    const selectedPreset = useMemo(
        () => presets.find((preset) => preset.id === selectedId) || null,
        [presets, selectedId]
    );
    const filteredPresets = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return presets;
        return presets.filter((preset) => String(preset.name || '').toLowerCase().includes(needle));
    }, [presets, query]);

    useEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const selectPreset = (presetId) => {
        onSelect?.(presetId);
        setOpen(false);
        setQuery('');
    };

    return (
        <div ref={containerRef} className={`relative shrink-0 ${className}`.trim()}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                className={`flex w-full items-center justify-between gap-2 ${selectClass}`}
                title={selectedPreset?.name || 'Tìm kiếm đã lưu'}
            >
                <span className={`truncate text-left ${selectedPreset ? 'font-black text-primary' : 'text-primary'}`}>
                    {selectedPreset?.name || 'Tìm kiếm đã lưu'}
                </span>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-primary/45">
                    {open ? 'expand_less' : 'expand_more'}
                </span>
            </button>
            {open ? (
                <div className="absolute left-0 top-full z-50 mt-1 w-[390px] max-w-[calc(100vw-2rem)] rounded-sm border border-primary/15 bg-white shadow-lg">
                    <div className="border-b border-primary/10 p-2">
                        <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[17px] text-primary/35">search</span>
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Gõ để tìm tìm kiếm đã lưu"
                                className={`w-full pl-8 ${inputClass}`}
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="max-h-72 overflow-auto p-1.5">
                        <button
                            type="button"
                            onClick={() => selectPreset('')}
                            className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left transition hover:bg-[#f6f9fc] ${selectedId ? '' : 'bg-primary/[0.04]'}`}
                        >
                            <span className="truncate text-[12px] font-black text-primary">Tất cả tìm kiếm đã lưu</span>
                            {!selectedId ? <span className="material-symbols-outlined text-[18px] text-primary">check</span> : null}
                        </button>
                        {!filteredPresets.length ? (
                            <div className="px-2 py-3 text-[12px] text-primary/45">Không có tìm kiếm đã lưu phù hợp.</div>
                        ) : null}
                        {filteredPresets.map((preset) => {
                            const isSelected = preset.id === selectedId;

                            return (
                                <div key={preset.id} className={`group flex items-center gap-1 rounded-sm px-2 py-1.5 transition hover:bg-[#f6f9fc] ${isSelected ? 'bg-primary/[0.04]' : ''}`}>
                                    <button
                                        type="button"
                                        onClick={() => selectPreset(preset.id)}
                                        className="min-w-0 flex-1 text-left"
                                        title={preset.name}
                                    >
                                        <div className={`truncate text-[12px] ${isSelected ? 'font-black text-primary' : 'font-semibold text-primary'}`}>
                                            {preset.name}
                                        </div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onRename?.(preset.id);
                                        }}
                                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-primary/55 transition hover:bg-primary/[0.08] hover:text-primary"
                                        title="Sửa tên tìm kiếm này"
                                    >
                                        <span className="material-symbols-outlined text-[17px]">edit</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onDelete?.(preset.id);
                                        }}
                                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-brick/70 transition hover:bg-brick/10 hover:text-brick"
                                        title="Xóa tìm kiếm này"
                                    >
                                        <span className="material-symbols-outlined text-[17px]">delete</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const SummaryPanel = ({ items }) => (
    <div className="border-b border-primary/10 bg-white px-3 py-2.5">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
                <div key={item.label} className="rounded-sm border border-primary/10 bg-primary/[0.03] px-3 py-2">
                    <div className="truncate text-[11px] font-semibold text-primary/55">{item.label}</div>
                    <div className="mt-1 truncate text-[15px] font-black text-primary">{item.value}</div>
                </div>
            ))}
        </div>
    </div>
);

const CellText = ({ primary, secondary = null, mono = false }) => (
    <div className="min-w-0">
        <div className={`truncate font-semibold text-primary ${mono ? 'font-mono text-[12px]' : ''}`}>{primary}</div>
        {secondary ? <div className="mt-0.5 truncate text-[11px] text-primary/45">{secondary}</div> : null}
    </div>
);

const SupplierNameListCell = ({ names = [] }) => {
    const normalizedNames = Array.from(new Set((names || []).map((value) => String(value || '').trim()).filter(Boolean)));
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    if (!normalizedNames.length) {
        return <span className="block truncate text-[12px] text-primary/45">Chưa gắn NCC</span>;
    }

    const hiddenCount = Math.max(normalizedNames.length - 2, 0);
    const visibleLabel = hiddenCount > 0 ? normalizedNames.slice(0, 2).join(', ') : normalizedNames.join(', ');
    const fullLabel = normalizedNames.join(', ');

    return (
        <div ref={containerRef} className="relative min-w-0" title={fullLabel}>
            <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <span className="min-w-0 truncate font-semibold text-primary">{visibleLabel}</span>
                {hiddenCount > 0 ? (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpen((prev) => !prev);
                        }}
                        className="shrink-0 rounded-full border border-primary/15 bg-primary/[0.05] px-2 py-0.5 text-[10px] font-black text-primary transition hover:border-primary hover:bg-primary/[0.08]"
                        title={open ? 'Ẩn danh sách nhà cung cấp' : 'Xem đầy đủ nhà cung cấp'}
                    >
                        +{hiddenCount}
                    </button>
                ) : null}
            </div>
            {open ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-[260px] rounded-sm border border-primary/15 bg-white p-2 shadow-lg">
                    <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary/40">Nhà cung cấp</div>
                    <div className="max-h-48 space-y-1 overflow-auto pr-1">
                        {normalizedNames.map((name) => (
                            <div key={name} className="rounded-sm bg-[#f6f9fc] px-2 py-1 text-[12px] font-semibold text-primary">
                                {name}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const SupplierMultiSelectFilter = ({
    suppliers = [],
    value = [],
    onChange,
    disabled = false,
    placeholder = 'Tất cả',
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const selectedIds = useMemo(() => normalizeSupplierFilterIds(value), [value]);
    const allSupplierIds = useMemo(
        () => suppliers.map((supplier) => Number(supplier.id)).filter((id) => Number.isFinite(id) && id > 0),
        [suppliers]
    );
    const selectedNames = useMemo(() => {
        const nameMap = new Map(suppliers.map((supplier) => [Number(supplier.id), supplier.name]));
        return selectedIds.map((id) => nameMap.get(id)).filter(Boolean);
    }, [selectedIds, suppliers]);
    const summaryLabel = selectedIds.length
        ? (selectedNames.length === selectedIds.length
            ? summarizeSelectedSupplierNames(selectedNames)
            : `${selectedIds.length} NCC đã chọn`)
        : placeholder;
    const isAllChecked = allSupplierIds.length > 0 && selectedIds.length === allSupplierIds.length;

    useEffect(() => {
        if (!open) return undefined;

        const handlePointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const applyNextValue = (nextValue) => {
        onChange?.(normalizeSupplierFilterIds(nextValue));
    };

    return (
        <div ref={containerRef} className={`relative w-[260px] ${className}`.trim()}>
            <button
                type="button"
                onClick={() => {
                    if (!disabled) setOpen((prev) => !prev);
                }}
                disabled={disabled}
                className={`flex w-full items-center justify-between gap-2 ${selectClass} ${
                    disabled ? 'cursor-not-allowed opacity-60' : ''
                }`}
                title={selectedNames.length ? selectedNames.join(', ') : summaryLabel}
            >
                <span className="truncate text-left">{summaryLabel}</span>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-primary/45">
                    {open ? 'expand_less' : 'expand_more'}
                </span>
            </button>
            {open ? (
                <div className="absolute left-0 top-full z-30 mt-1 w-[320px] max-w-[calc(100vw-2rem)] rounded-sm border border-primary/15 bg-white shadow-lg">
                    <button
                        type="button"
                        onClick={() => {
                            applyNextValue([]);
                            setOpen(false);
                        }}
                        className={`flex w-full items-start justify-between gap-3 border-b border-primary/10 px-3 py-2.5 text-left transition hover:bg-[#f6f9fc] ${
                            selectedIds.length === 0 ? 'bg-primary/[0.04]' : ''
                        }`}
                    >
                        <div className="min-w-0">
                            <div className="truncate text-[12px] font-black text-primary">Tất cả</div>
                            <div className="mt-0.5 text-[11px] text-primary/45">Không lọc theo nhà cung cấp</div>
                        </div>
                        {selectedIds.length === 0 ? <span className="material-symbols-outlined text-[18px] text-primary">check</span> : null}
                    </button>
                    <div className="flex items-center gap-2 border-b border-primary/10 px-3 py-2">
                        <button type="button" onClick={() => applyNextValue(allSupplierIds)} disabled={!allSupplierIds.length || isAllChecked} className={ghostButton}>Chọn tất cả</button>
                        <button type="button" onClick={() => applyNextValue([])} disabled={!selectedIds.length} className={ghostButton}>Bỏ chọn tất cả</button>
                    </div>
                    <div className="max-h-64 overflow-auto p-1.5">
                        {!suppliers.length ? <div className="px-2 py-3 text-[12px] text-primary/45">Chưa có nhà cung cấp.</div> : null}
                        {suppliers.map((supplier) => {
                            const supplierId = Number(supplier.id);
                            const isChecked = selectedIds.includes(supplierId);

                            return (
                                <label key={supplier.id} className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 transition hover:bg-[#f6f9fc]">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                            applyNextValue(
                                                isChecked
                                                    ? selectedIds.filter((id) => id !== supplierId)
                                                    : [...selectedIds, supplierId]
                                            );
                                        }}
                                        className={`${checkboxClass} mt-0.5`}
                                    />
                                    <div className="min-w-0">
                                        <div className="truncate text-[12px] font-semibold text-primary">{supplier.name}</div>
                                        <div className="truncate text-[11px] text-primary/45">{supplier.code || supplier.phone || 'Chưa có mã NCC'}</div>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const StatusPill = ({ label, color = '#94A3B8', subtle = null }) => (
    <span
        className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black tracking-[0.08em] uppercase"
        style={{
            color,
            borderColor: color,
            backgroundColor: subtle || `${color}12`,
        }}
    >
        {label}
    </span>
);

const IndeterminateCheckbox = ({ checked, indeterminate = false, onChange, disabled = false, title = '' }) => {
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.indeterminate = Boolean(indeterminate && !checked);
        }
    }, [checked, indeterminate]);

    return (
        <input
            ref={inputRef}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            title={title}
            className={`${checkboxClass} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        />
    );
};

const ModalShell = ({
    open,
    title,
    onClose,
    children,
    footer,
    maxWidth = 'max-w-5xl',
    closeOnBackdrop = true,
    backdropClassName = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4',
    panelClassName = '',
    bodyClassName = 'max-h-[72vh] overflow-auto px-5 py-4',
    footerClassName = 'border-t border-primary/10 px-5 py-4',
}) => {
    if (!open) return null;
    return (
        <div className={backdropClassName} onClick={closeOnBackdrop ? onClose : undefined}>
            <div className={`w-full ${maxWidth} overflow-hidden rounded-sm bg-white shadow-2xl ${panelClassName}`.trim()} onClick={(event) => event.stopPropagation()}>
                <div className="flex shrink-0 items-center justify-between border-b border-primary/10 px-5 py-4">
                    <div className="text-[24px] font-black text-primary">{title}</div>
                    <button type="button" onClick={onClose} className="text-primary/35 transition hover:text-primary">
                        <span className="material-symbols-outlined text-[28px]">close</span>
                    </button>
                </div>
                <div className={bodyClassName}>{children}</div>
                {footer ? <div className={footerClassName}>{footer}</div> : null}
            </div>
        </div>
    );
};

const ProductLookupInput = ({ supplierId = null, onSelect, placeholder = 'Tìm tên, mã sản phẩm hoặc từ khóa liên quan', buttonLabel = 'Chọn' }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 1) {
            setResults([]);
            setLoading(false);
            return undefined;
        }

        let active = true;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const nextResults = await fetchInventorySearchResults({
                    query: trimmed,
                    supplierId,
                    limit: 10,
                    signal: controller.signal,
                });

                if (active) setResults(nextResults);
            } catch (error) {
                if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || error?.message === 'canceled') {
                    return;
                }
                if (active) setResults([]);
            } finally {
                if (active) setLoading(false);
            }
        }, 140);

        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [query, supplierId]);

    return (
        <div className="space-y-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className={`w-full ${inputClass}`} />
            {query.trim().length >= 1 ? (
                <div className="overflow-hidden rounded-sm border border-primary/10">
                    <div className="max-h-56 overflow-auto">
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tìm sản phẩm...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không có sản phẩm phù hợp.</div> : null}
                        {!loading && results.map((row) => (
                            <button
                                key={row.id}
                                type="button"
                                onClick={() => {
                                    onSelect(row);
                                    setQuery('');
                                    setResults([]);
                                }}
                                className="flex w-full items-center justify-between border-b border-primary/10 px-3 py-2 text-left transition last:border-b-0 hover:bg-primary/[0.04]"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-semibold text-primary">{row.name}</div>
                                    <div className="truncate text-[11px] text-primary/45">{buildInventorySearchMeta(row) || 'Chưa có thông tin mã sản phẩm'}</div>
                                </div>
                                <div className="ml-3 shrink-0 text-[12px] font-semibold text-primary/70">{buttonLabel}</div>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const ImportQuickAttributeFilterDropdown = ({ attributes = [], value = {}, onChange }) => {
    const [open, setOpen] = useState(false);
    const [activeAttributeId, setActiveAttributeId] = useState('');
    const containerRef = useRef(null);
    const filterableAttributes = useMemo(() => buildImportQuickFilterAttributes(attributes), [attributes]);
    const normalizedValue = normalizeImportQuickAttributeFilters(value);
    const selectedCount = Object.values(normalizedValue).reduce((total, values) => total + values.length, 0);
    const activeAttribute = filterableAttributes.find((attribute) => String(attribute.id) === String(activeAttributeId)) || null;

    useEffect(() => {
        if (!open) return undefined;

        const handleOutsideClick = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
                setActiveAttributeId('');
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [open]);

    useEffect(() => {
        if (activeAttributeId && !filterableAttributes.some((attribute) => String(attribute.id) === String(activeAttributeId))) {
            setActiveAttributeId('');
        }
    }, [activeAttributeId, filterableAttributes]);

    const toggleAttributeValue = (attributeId, optionValue) => {
        const key = String(attributeId);
        const currentValues = normalizedValue[key] || [];
        const nextValues = currentValues.includes(optionValue)
            ? currentValues.filter((item) => item !== optionValue)
            : [...currentValues, optionValue];

        onChange?.(normalizeImportQuickAttributeFilters({
            ...normalizedValue,
            [key]: nextValues,
        }));
    };

    const clearAttribute = (attributeId) => {
        const nextValue = { ...normalizedValue };
        delete nextValue[String(attributeId)];
        onChange?.(nextValue);
    };

    return (
        <div ref={containerRef} className="relative min-w-0">
            <button
                type="button"
                onClick={() => {
                    setOpen((prev) => {
                        const nextOpen = !prev;
                        if (nextOpen) {
                            setActiveAttributeId('');
                        }
                        return nextOpen;
                    });
                }}
                className={`flex h-12 w-full min-w-[170px] items-center justify-between gap-2 rounded-sm border bg-white px-3 text-[12px] font-bold text-primary shadow-sm transition hover:border-primary/30 ${selectedCount ? 'border-emerald-200 text-emerald-700' : 'border-primary/15'}`}
                title="Lọc theo thuộc tính sản phẩm"
            >
                <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="material-symbols-outlined shrink-0 text-[18px]">category</span>
                    <span className="truncate">{selectedCount ? `Thuộc tính: ${selectedCount}` : 'Thuộc tính'}</span>
                </span>
                <span className="material-symbols-outlined shrink-0 text-[18px] text-primary/40">{open ? 'expand_less' : 'expand_more'}</span>
            </button>

            {open ? (
                <div className="absolute right-0 top-[calc(100%+6px)] z-[145] w-[380px] max-w-[calc(100vw-2rem)] rounded-sm border border-primary/15 bg-white p-3 shadow-2xl">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        {activeAttribute ? (
                            <button
                                type="button"
                                onClick={() => setActiveAttributeId('')}
                                className="inline-flex h-7 min-w-0 items-center gap-1 rounded-sm border border-primary/10 bg-white px-2 text-[11px] font-black text-primary transition hover:bg-primary/[0.04]"
                            >
                                <span className="material-symbols-outlined text-[15px]">arrow_back</span>
                                <span className="truncate">{activeAttribute.name}</span>
                            </button>
                        ) : (
                            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Chọn thuộc tính</div>
                        )}
                        {selectedCount ? (
                            <button
                                type="button"
                                onClick={() => {
                                    onChange?.({});
                                    setActiveAttributeId('');
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded-sm border border-brick/15 bg-white px-2 text-[11px] font-bold text-brick transition hover:bg-brick/5"
                            >
                                <span className="material-symbols-outlined text-[15px]">backspace</span>
                                Xóa chọn
                            </button>
                        ) : null}
                    </div>

                    {!filterableAttributes.length ? (
                        <div className="rounded-sm border border-dashed border-primary/15 px-3 py-5 text-center text-[12px] text-primary/45">
                            Chưa có thuộc tính khả dụng để lọc.
                        </div>
                    ) : (
                        <div className="max-h-[360px] overflow-auto rounded-sm border border-primary/10 bg-[#f8fbff]">
                            {!activeAttribute ? (
                                filterableAttributes.map((attribute) => {
                                    const selectedValues = normalizedValue[String(attribute.id)] || [];

                                    return (
                                        <button
                                            key={attribute.id}
                                            type="button"
                                            onClick={() => setActiveAttributeId(String(attribute.id))}
                                            className="flex min-h-10 w-full items-center justify-between gap-3 border-b border-primary/10 bg-white px-3 py-2 text-left transition last:border-b-0 hover:bg-primary/[0.04]"
                                        >
                                            <span className="min-w-0 truncate text-[12px] font-black text-primary">{attribute.name}</span>
                                            <span className="inline-flex shrink-0 items-center gap-2">
                                                {selectedValues.length ? (
                                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                                        {selectedValues.length}
                                                    </span>
                                                ) : null}
                                                <span className="material-symbols-outlined text-[17px] text-primary/35">chevron_right</span>
                                            </span>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="bg-white">
                                    <div className="flex items-center justify-between gap-2 border-b border-primary/10 bg-[#f8fbff] px-3 py-2">
                                        <div className="min-w-0 truncate text-[11px] font-black uppercase tracking-[0.1em] text-primary/50">{activeAttribute.name}</div>
                                        {(normalizedValue[String(activeAttribute.id)] || []).length ? (
                                            <button
                                                type="button"
                                                onClick={() => clearAttribute(activeAttribute.id)}
                                                className="shrink-0 text-[11px] font-bold text-brick hover:underline"
                                            >
                                                Xóa
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="max-h-[300px] overflow-auto p-1">
                                        {activeAttribute.options.map((option) => {
                                            const selectedValues = normalizedValue[String(activeAttribute.id)] || [];
                                            const optionValue = normalizeImportQuickOptionValue(option.value);
                                            if (!optionValue) return null;
                                            const checked = selectedValues.includes(optionValue);

                                            return (
                                                <label key={option.id || optionValue} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-[12px] font-semibold text-primary transition hover:bg-[#f8fbff]">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleAttributeValue(activeAttribute.id, optionValue)}
                                                        className={checkboxClass}
                                                    />
                                                    <span className={checked ? 'font-black text-primary' : 'text-primary/70'}>{option.label || optionValue}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {selectedCount ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {filterableAttributes.flatMap((attribute) => (
                                (normalizedValue[String(attribute.id)] || []).map((selectedValue) => (
                                    <span key={`${attribute.id}_${selectedValue}`} className="inline-flex max-w-[180px] items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                        <span className="truncate">{attribute.name}: {selectedValue}</span>
                                    </span>
                                ))
                            )).slice(0, 6)}
                            {selectedCount > 6 ? (
                                <span className="inline-flex items-center rounded-full border border-primary/10 bg-white px-2 py-0.5 text-[10px] font-bold text-primary/55">
                                    +{selectedCount - 6}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
};

const ImportProductQuickSearch = ({
    onSelect,
    onToggleStar = null,
    supplierId = null,
    categoryOptions = [],
    attributes = [],
    onNotify = null,
    disabled = false,
    placeholder = 'Tìm tên, mã sản phẩm, mã NCC hoặc từ khóa liên quan',
    starLoadingProductIds = [],
    updateSupplierPrices = false,
    onUpdateSupplierPricesChange = null,
    onRefreshPricing = null,
    refreshPricingDisabled = false,
    refreshPricingLoading = false,
}) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [quickModeActive, setQuickModeActive] = useState(false);
    const [declarationModeActive, setDeclarationModeActive] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState([]);
    const [refreshNonce, setRefreshNonce] = useState(0);
    const [filters, setFilters] = useState(() => createDefaultImportQuickFilters());
    const [savedFilters, setSavedFilters] = useState(() => readImportQuickFilterPresets());
    const [selectedSavedFilterId, setSelectedSavedFilterId] = useState('');
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const normalizedFilters = useMemo(() => normalizeImportQuickFilters(filters), [filters]);
    const filtersKey = serializeImportQuickFilters(normalizedFilters);
    const quickFilterCount = countImportQuickFilters(normalizedFilters);
    const filtersActive = hasImportQuickFilters(normalizedFilters);

    useEffect(() => {
        if (disabled) {
            setOpen(false);
            setResults([]);
            setShowHistory(false);
            setDeclarationModeActive(false);
        }
    }, [disabled]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false);
                setActiveIndex(-1);
                setShowHistory(false);
                setDeclarationModeActive(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    useEffect(() => {
        const trimmed = query.trim();
        if (disabled || (trimmed.length < 1 && !filtersActive && !quickModeActive && !declarationModeActive)) {
            setResults([]);
            setLoading(false);
            return undefined;
        }

        let active = true;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const nextResults = await fetchInventorySearchResults({
                    query: trimmed,
                    supplierId,
                    limit: 20,
                    signal: controller.signal,
                    prioritizeImportStar: quickModeActive,
                    onlyImportStarred: quickModeActive,
                    allowEmptySearch: declarationModeActive,
                    filters: normalizedFilters,
                });

                if (active) {
                    setResults(nextResults);
                    setActiveIndex(nextResults.length ? 0 : -1);
                    setOpen(true);
                }
            } catch (error) {
                if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || error?.message === 'canceled') {
                    return;
                }
                if (active) {
                    setResults([]);
                    setOpen(true);
                    setActiveIndex(-1);
                }
            } finally {
                if (active) setLoading(false);
            }
        }, 120);

        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [query, disabled, supplierId, quickModeActive, declarationModeActive, refreshNonce, filtersActive, filtersKey]);

    const rememberQuery = (value) => {
        const trimmed = String(value || '').trim();
        if (!trimmed) return;
        setHistoryItems((prev) => [
            trimmed,
            ...prev.filter((item) => normalizeSearchText(item) !== normalizeSearchText(trimmed)),
        ].slice(0, 6));
    };

    const toggleQuickFilterDeclaration = async (row) => {
        if (!onToggleStar) return;

        const nextStarred = !Boolean(row.inventory_import_starred);
        const updatedProduct = await Promise.resolve(onToggleStar(row, nextStarred));
        const updatedResults = results.map((item) => (
            Number(item.id) === Number(row.id)
                ? {
                    ...item,
                    inventory_import_starred: Boolean(updatedProduct?.inventory_import_starred ?? nextStarred),
                }
                : item
        ));
        const nextResults = sortInventorySearchRows(
            updatedResults.filter((item) => !quickModeActive || isInventorySearchRowImportStarred(item)),
            quickModeActive
        );
        setResults(nextResults);
        setActiveIndex(nextResults.findIndex((item) => Number(item.id) === Number(row.id)));
    };

    const selectRow = async (row, index = null) => {
        if (declarationModeActive && onToggleStar) {
            await toggleQuickFilterDeclaration(row);
            if (index !== null) {
                setActiveIndex(index);
            }
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
        }

        rememberQuery(query);
        await Promise.resolve(onSelect?.(row));
        if (index !== null) {
            setActiveIndex(index);
        }
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const handleToggleStar = async (event, row) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onToggleStar) return;

        try {
            await toggleQuickFilterDeclaration(row);
        } catch (error) {
            // Toast is already handled by the parent callback.
        }
    };

    const clearQuery = () => {
        setQuery('');
        setResults([]);
        setActiveIndex(-1);
        setOpen(filtersActive || quickModeActive || declarationModeActive);
        setShowHistory(false);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const refreshSearchAndPricing = () => {
        clearInventorySearchCache();
        setRefreshNonce((prev) => prev + 1);
        setOpen(Boolean(query.trim()) || filtersActive || quickModeActive || declarationModeActive);
        setShowHistory(false);
        if (!refreshPricingDisabled && !refreshPricingLoading) {
            onRefreshPricing?.();
        }
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const handleHistoryPick = (item) => {
        setQuery(item);
        setOpen(true);
        setShowHistory(false);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const updateFilters = (nextFilters) => {
        const normalized = normalizeImportQuickFilters(nextFilters);
        setFilters(normalized);
        setSelectedSavedFilterId('');
        setOpen(Boolean(query.trim()) || hasImportQuickFilters(normalized) || quickModeActive || declarationModeActive);
        setShowHistory(false);
    };

    const beginQuickFilterDeclaration = () => {
        setQuickModeActive(false);
        setDeclarationModeActive(true);
        setShowHistory(false);
        setOpen(true);
        setRefreshNonce((prev) => prev + 1);
        onNotify?.({
            type: 'info',
            message: 'Chọn sản phẩm trong danh sách để lưu vào lọc nhanh.',
        });
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const applySavedFilter = (presetId) => {
        if (!presetId) {
            setSelectedSavedFilterId('');
            updateFilters(createDefaultImportQuickFilters());
            return;
        }

        const preset = savedFilters.find((item) => item.id === presetId);
        if (!preset) return;

        setSelectedSavedFilterId(preset.id);
        setFilters(normalizeImportQuickFilters(preset.filters));
        setOpen(true);
        setShowHistory(false);
    };

    const saveCurrentFilter = () => {
        if (!filtersActive) {
            onNotify?.({ type: 'warning', message: 'Hãy chọn danh mục hoặc thuộc tính trước khi lưu bộ lọc.' });
            return;
        }

        const suggestedName = [
            normalizedFilters.category_id
                ? (categoryOptions.find((option) => String(option.value) === String(normalizedFilters.category_id))?.label || 'Danh mục')
                : '',
            quickFilterCount > 0 ? `${quickFilterCount} lựa chọn` : '',
        ].filter(Boolean).join(' + ') || 'Bộ lọc phiếu nhập';
        const name = window.prompt('Đặt tên bộ lọc tìm nhanh', suggestedName);
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;

        const preset = {
            id: createImportQuickFilterPresetId(),
            name: normalizedName,
            filters: normalizedFilters,
            saved_at: new Date().toISOString(),
        };
        const nextPresets = [
            preset,
            ...savedFilters.filter((item) => item.name !== normalizedName),
        ].slice(0, 30);

        setSavedFilters(nextPresets);
        writeImportQuickFilterPresets(nextPresets);
        setSelectedSavedFilterId(preset.id);
        onNotify?.({ type: 'success', message: `Đã lưu bộ lọc "${normalizedName}".` });
    };

    const showDropdown = open && !showHistory && (query.trim().length > 0 || filtersActive || quickModeActive || declarationModeActive || loading);

    return (
        <div ref={containerRef} className="relative rounded-md border border-primary/10 bg-[#f8fbff] p-2 shadow-sm">
            <div className="grid min-w-0 gap-2 xl:grid-cols-[minmax(320px,1fr)_auto_auto_minmax(150px,190px)_minmax(170px,210px)_minmax(145px,185px)_auto] xl:items-stretch">
                <div className="flex h-12 min-w-0 items-stretch overflow-hidden rounded-sm border border-primary/15 bg-white shadow-sm">
                    <div className="flex w-11 shrink-0 items-center justify-center border-r border-primary/10 bg-primary/[0.03] text-primary/45">
                        <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
                        <span className="material-symbols-outlined shrink-0 text-[18px] text-primary/35">search</span>
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setShowHistory(false);
                                setOpen(true);
                            }}
                            onFocus={() => {
                                setOpen(true);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    if (query) clearQuery();
                                    return;
                                }
                                if (!showDropdown || !results.length) return;
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    setActiveIndex((prev) => (prev + 1 >= results.length ? 0 : prev + 1));
                                }
                                if (event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    setActiveIndex((prev) => (prev - 1 < 0 ? results.length - 1 : prev - 1));
                                }
                                if (event.key === 'Enter' && activeIndex >= 0) {
                                    event.preventDefault();
                                    selectRow(results[activeIndex], activeIndex);
                                }
                            }}
                            disabled={disabled}
                            placeholder={placeholder}
                            className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-primary outline-none placeholder:text-primary/30"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={clearQuery}
                        disabled={!query}
                        className="inline-flex w-11 shrink-0 items-center justify-center border-l border-primary/10 text-primary/35 transition hover:bg-primary/[0.04] hover:text-brick disabled:cursor-not-allowed disabled:opacity-35"
                        title="Xóa từ khóa"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setShowHistory((prev) => !prev);
                            setOpen(false);
                        }}
                        className={`inline-flex w-11 shrink-0 items-center justify-center border-l border-primary/10 transition hover:bg-primary/[0.04] ${showHistory ? 'bg-primary/[0.06] text-primary' : 'text-primary/35 hover:text-primary'}`}
                        title="Lịch sử tìm"
                    >
                        <span className="material-symbols-outlined text-[18px]">history</span>
                    </button>
                    <button
                        type="button"
                        onClick={refreshSearchAndPricing}
                        disabled={disabled || refreshPricingLoading}
                        className="inline-flex w-11 shrink-0 items-center justify-center border-l border-primary/10 text-primary/40 transition hover:bg-primary/[0.04] hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                        title={refreshPricingDisabled ? 'Làm mới kết quả tìm' : 'Làm mới kết quả tìm và giá nhập'}
                    >
                        <span className={`material-symbols-outlined text-[18px] ${refreshPricingLoading ? 'animate-spin' : ''}`}>refresh</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            const nextQuickModeActive = !quickModeActive;
                            setQuickModeActive(nextQuickModeActive);
                            setDeclarationModeActive(false);
                            setShowHistory(false);
                            setOpen(Boolean(query.trim()) || filtersActive || nextQuickModeActive);
                            requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        className={`relative inline-flex w-11 shrink-0 items-center justify-center border-l border-primary/10 text-white transition ${quickModeActive ? 'bg-blue-600 hover:bg-blue-700' : 'bg-primary/30 hover:bg-primary/45'}`}
                        title={quickModeActive ? 'Tắt lọc sản phẩm đã khai báo' : 'Chỉ hiện sản phẩm đã khai báo lọc nhanh'}
                    >
                        <span className="material-symbols-outlined text-[19px]">{quickModeActive ? 'flash_on' : 'flash_off'}</span>
                        <span className="absolute bottom-1 right-1 rounded-full bg-white px-1 text-[8px] font-black leading-3 text-blue-700">
                            {quickModeActive ? 'ON' : 'OFF'}
                        </span>
                    </button>
                </div>

                <button
                    type="button"
                    onClick={beginQuickFilterDeclaration}
                    className="inline-flex h-12 w-full min-w-[112px] items-center justify-center gap-1.5 rounded-sm border border-amber-200 bg-amber-50 px-3 text-[12px] font-black text-amber-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 xl:w-auto"
                    title="Tìm toàn bộ sản phẩm để khai báo vào lọc nhanh"
                >
                    <span className="material-symbols-outlined text-[17px]">star</span>
                    <span className="truncate">Khai báo</span>
                </button>

                <button
                    type="button"
                    onClick={() => onUpdateSupplierPricesChange?.(!updateSupplierPrices)}
                    className={`inline-flex h-12 w-full min-w-[128px] items-center justify-center gap-1.5 rounded-sm border px-3 text-[12px] font-bold shadow-sm transition xl:w-auto ${updateSupplierPrices ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-primary/15 bg-white text-primary/45 hover:border-primary/30 hover:text-primary'}`}
                    title="Đồng bộ lại giá nhập dự kiến cho sản phẩm được chọn"
                >
                    <span className="material-symbols-outlined text-[17px]">{updateSupplierPrices ? 'check_box' : 'check_box_outline_blank'}</span>
                    <span className="truncate">Đồng bộ giá</span>
                </button>

                <select
                    value={normalizedFilters.category_id}
                    onChange={(event) => updateFilters({ ...normalizedFilters, category_id: event.target.value })}
                    className={`h-12 min-w-0 rounded-sm border bg-white px-3 text-[12px] font-bold text-primary shadow-sm outline-none transition focus:border-primary ${normalizedFilters.category_id ? 'border-emerald-200 text-emerald-700' : 'border-primary/15'}`}
                    title="Lọc theo danh mục"
                >
                    <option value="">Tất cả danh mục</option>
                    {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>

                <ImportQuickAttributeFilterDropdown
                    attributes={attributes}
                    value={normalizedFilters.attributes}
                    onChange={(nextAttributes) => updateFilters({ ...normalizedFilters, attributes: nextAttributes })}
                />

                <select
                    value={selectedSavedFilterId}
                    onChange={(event) => applySavedFilter(event.target.value)}
                    className="h-12 min-w-0 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-bold text-primary shadow-sm outline-none transition focus:border-primary"
                    title="Bộ lọc đã lưu"
                >
                    <option value="">Bộ lọc đã lưu</option>
                    {savedFilters.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>

                <button
                    type="button"
                    onClick={saveCurrentFilter}
                    disabled={!filtersActive}
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-black text-primary shadow-sm transition hover:border-primary hover:bg-primary/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                    title="Lưu bộ lọc danh mục / thuộc tính hiện tại"
                >
                    <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
                    <span className="hidden 2xl:inline">Lưu bộ lọc</span>
                </button>
            </div>

            {showHistory ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-[145] w-full max-w-[420px] overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                    <div className="border-b border-primary/10 bg-[#f8fbff] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Lịch sử tìm</div>
                    {historyItems.length ? historyItems.map((item) => (
                        <button
                            key={`import_search_history_${item}`}
                            type="button"
                            onClick={() => handleHistoryPick(item)}
                            className="flex w-full items-center gap-2 border-b border-primary/10 px-3 py-2 text-left text-[13px] font-semibold text-primary transition last:border-b-0 hover:bg-primary/[0.04]"
                        >
                            <span className="material-symbols-outlined text-[16px] text-primary/35">history</span>
                            <span className="truncate">{item}</span>
                        </button>
                    )) : (
                        <div className="px-3 py-4 text-[12px] text-primary/45">Chưa có lịch sử tìm trong phiên này.</div>
                    )}
                </div>
            ) : null}

            {showDropdown ? (
                <div className="absolute left-0 top-[calc(100%+6px)] z-[140] w-full max-w-[690px] overflow-hidden rounded-sm border border-primary/20 bg-white shadow-2xl">
                    <div className="max-h-[396px] overflow-auto">
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tìm sản phẩm...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không tìm thấy sản phẩm phù hợp.</div> : null}
                        {!loading && results.map((row, index) => {
                            const metaItems = buildInventorySearchMeta(row).split(' • ').filter(Boolean);
                            const unitCost = row.supplier_unit_cost ?? row.current_cost ?? row.expected_cost ?? row.unit_cost ?? row.price ?? 0;

                            return (
                            <div
                                key={`quick_import_${row.id}`}
                                onMouseEnter={() => setActiveIndex(index)}
                                className={`grid min-h-[66px] grid-cols-[54px_minmax(0,1fr)_112px_94px] items-center border-b border-primary/10 px-3 transition last:border-b-0 ${activeIndex === index ? 'bg-primary/[0.07]' : 'hover:bg-primary/[0.04]'}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => selectRow(row, index)}
                                    className="flex size-9 items-center justify-center rounded-md border border-primary/10 bg-primary/[0.04] text-primary/45"
                                >
                                    <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => selectRow(row, index)}
                                    className="min-w-0 px-2 py-2 text-left"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <div className="truncate text-[13px] font-black text-primary">{row.name}</div>
                                            {row.inventory_import_starred ? <span className="material-symbols-outlined text-[16px] text-amber-500">star</span> : null}
                                        </div>
                                        <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                                            {metaItems.length ? metaItems.slice(0, 3).map((item) => (
                                                <span key={`${row.id}_${item}`} className="inline-flex max-w-[180px] items-center rounded-full border border-primary/10 bg-primary/[0.035] px-2 py-0.5 text-[10px] font-bold text-primary/60">
                                                    <span className="truncate">{item}</span>
                                                </span>
                                            )) : (
                                                <span className="text-[11px] text-primary/45">Chưa có thông tin mã sản phẩm</span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => selectRow(row, index)}
                                    className="px-2 text-right text-[15px] font-black text-blue-600"
                                >
                                    {formatCurrency(unitCost)}
                                </button>
                                <button
                                    type="button"
                                    onClick={(event) => handleToggleStar(event, row)}
                                    disabled={starLoadingProductIds.includes(Number(row.id))}
                                    className={`mr-2 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-sm border px-2 text-[11px] font-black transition ${
                                        row.inventory_import_starred
                                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                                            : 'border-primary/10 bg-white text-primary/45 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
                                    } ${starLoadingProductIds.includes(Number(row.id)) ? 'cursor-not-allowed opacity-50' : ''}`}
                                    title={row.inventory_import_starred ? 'Bỏ khỏi lọc nhanh' : 'Khai báo sản phẩm vào lọc nhanh'}
                                >
                                    <span className="material-symbols-outlined text-[17px]">{row.inventory_import_starred ? 'star' : 'star_outline'}</span>
                                    <span>{row.inventory_import_starred ? 'Đã lưu' : 'Khai báo'}</span>
                                </button>
                            </div>
                        );})}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const ImportLineProductLookupInput = ({
    value = '',
    selectedProductId = null,
    supplierId = null,
    onDraftChange = null,
    onSelect = null,
    onClearSelection = null,
    disabled = false,
    placeholder = 'Mã SP',
}) => {
    const [draftValue, setDraftValue] = useState(value || '');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const blurTimerRef = useRef(null);
    const autoAppliedRef = useRef('');
    const pendingSelectionRef = useRef(false);

    useEffect(() => {
        setDraftValue(value || '');
        pendingSelectionRef.current = false;
    }, [value, selectedProductId]);

    useEffect(() => () => {
        if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
        }
    }, []);

    const closeDropdown = () => {
        setOpen(false);
        setActiveIndex(-1);
        setResults([]);
    };

    const finalizeDraft = () => {
        if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
        }

        if (pendingSelectionRef.current) {
            closeDropdown();
            return;
        }

        if (Number(selectedProductId || 0) > 0) {
            if (!draftValue.trim()) {
                pendingSelectionRef.current = true;
                closeDropdown();
                void Promise.resolve(onClearSelection?.());
                return;
            }
            setDraftValue(value || '');
            closeDropdown();
            return;
        }

        onDraftChange?.(draftValue);
        closeDropdown();
    };

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                finalizeDraft();
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    });

    useEffect(() => {
        const trimmed = draftValue.trim();
        if (disabled || !open || trimmed.length < 1) {
            setResults([]);
            setLoading(false);
            return undefined;
        }

        let active = true;
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const nextResults = await fetchInventorySearchResults({
                    query: trimmed,
                    supplierId,
                    limit: 12,
                    signal: controller.signal,
                    prioritizeImportStar: true,
                });

                if (active) {
                    setResults(nextResults);
                    setActiveIndex(nextResults.length ? 0 : -1);
                }
            } catch (error) {
                if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED' || error?.message === 'canceled') {
                    return;
                }
                if (active) {
                    setResults([]);
                    setActiveIndex(-1);
                }
            } finally {
                if (active) setLoading(false);
            }
        }, 120);

        return () => {
            active = false;
            controller.abort();
            clearTimeout(timer);
        };
    }, [draftValue, disabled, open, supplierId]);

    const exactMatch = useMemo(() => findExactInventorySearchMatch(results, draftValue), [results, draftValue]);

    const selectProduct = async (product) => {
        pendingSelectionRef.current = true;
        setDraftValue(product?.sku || draftValue);
        setResults([]);
        closeDropdown();
        const selectionResult = await Promise.resolve(onSelect?.(product));
        if (selectionResult?.accepted === false) {
            pendingSelectionRef.current = false;
            setDraftValue(value || '');
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    };

    useEffect(() => {
        if (!exactMatch) {
            autoAppliedRef.current = '';
            return;
        }

        const autoKey = `${normalizeSearchText(draftValue)}::${exactMatch.id}`;
        if (Number(selectedProductId || 0) === Number(exactMatch.id)) {
            autoAppliedRef.current = autoKey;
            return;
        }
        if (autoAppliedRef.current === autoKey) {
            return;
        }

        autoAppliedRef.current = autoKey;
        pendingSelectionRef.current = true;
        setDraftValue(exactMatch?.sku || draftValue);
        setOpen(false);
        setActiveIndex(-1);
        setResults([]);
        void (async () => {
            const selectionResult = await Promise.resolve(onSelect?.(exactMatch));
            if (selectionResult?.accepted === false) {
                pendingSelectionRef.current = false;
                setDraftValue(value || '');
                requestAnimationFrame(() => inputRef.current?.focus());
            }
        })();
    }, [draftValue, exactMatch, onSelect, selectedProductId]);

    const showDropdown = open && (draftValue.trim().length > 0 || loading);

    return (
        <div ref={containerRef} className="relative">
            <input
                ref={inputRef}
                value={draftValue}
                onChange={(event) => {
                    setDraftValue(event.target.value);
                    setOpen(true);
                }}
                onFocus={() => {
                    if (blurTimerRef.current) {
                        clearTimeout(blurTimerRef.current);
                        blurTimerRef.current = null;
                    }
                    setOpen(true);
                }}
                onBlur={() => {
                    blurTimerRef.current = setTimeout(() => {
                        finalizeDraft();
                    }, 120);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finalizeDraft();
                        inputRef.current?.blur();
                        return;
                    }

                    if (!showDropdown || !results.length) {
                        if (event.key === 'Enter' && Number(selectedProductId || 0) > 0 && !draftValue.trim()) {
                            event.preventDefault();
                            pendingSelectionRef.current = true;
                            closeDropdown();
                            void Promise.resolve(onClearSelection?.());
                            return;
                        }
                        if (event.key === 'Enter' && exactMatch) {
                            event.preventDefault();
                            void selectProduct(exactMatch);
                        }
                        return;
                    }

                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setActiveIndex((prev) => (prev + 1 >= results.length ? 0 : prev + 1));
                    }
                    if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        setActiveIndex((prev) => (prev - 1 < 0 ? results.length - 1 : prev - 1));
                    }
                    if (event.key === 'Enter' && activeIndex >= 0) {
                        event.preventDefault();
                        void selectProduct(results[activeIndex]);
                    }
                }}
                disabled={disabled}
                placeholder={placeholder}
                className={`w-full ${importFieldClass}`}
            />

            {showDropdown ? (
                <div className="absolute left-0 top-[calc(100%+4px)] z-[160] w-[360px] max-w-[min(420px,calc(100vw-48px))] overflow-hidden rounded-sm border border-primary/20 bg-white shadow-2xl">
                    <div className="max-h-72 overflow-auto">
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tìm sản phẩm...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không tìm thấy sản phẩm phù hợp.</div> : null}
                        {!loading && results.map((row, index) => (
                            <button
                                key={`import_line_lookup_${row.id}`}
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => { void selectProduct(row); }}
                                className={`flex w-full items-center justify-between border-b border-primary/10 px-3 py-2 text-left transition last:border-b-0 ${activeIndex === index ? 'bg-primary/[0.07]' : 'hover:bg-primary/[0.04]'}`}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <div className="truncate text-[13px] font-semibold text-primary">{row.name}</div>
                                        {row.inventory_import_starred ? <span className="material-symbols-outlined text-[16px] text-amber-500">star</span> : null}
                                    </div>
                                    <div className="truncate text-[11px] text-primary/50">{buildInventorySearchMeta(row) || 'Chưa có thông tin mã sản phẩm'}</div>
                                </div>
                                <span className="ml-3 shrink-0 text-[11px] font-bold text-primary/70">Map</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const QuantityStepperInput = ({ value, onChange, min = 0 }) => {
    const currentValue = parseLineQuantity(value, min);

    const commitValue = (nextValue) => {
        onChange(normalizeQuantityDraft(String(Math.max(min, nextValue))));
    };

    return (
        <div className="flex h-8 w-full items-center overflow-hidden rounded-sm border border-primary/15 bg-white">
            <button type="button" onClick={() => commitValue(Math.max(min, currentValue - 1))} className="flex h-full w-7 items-center justify-center text-primary/65 transition hover:bg-primary/5 hover:text-primary" title="Giảm số lượng">
                <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
            <input
                value={value}
                onChange={(event) => onChange(normalizeQuantityDraft(event.target.value))}
                inputMode="decimal"
                className="h-full w-full border-x border-primary/10 bg-transparent px-2 text-center text-[12px] font-semibold text-primary outline-none"
                placeholder={String(min)}
            />
            <button type="button" onClick={() => commitValue(currentValue + 1)} className="flex h-full w-7 items-center justify-center text-primary/65 transition hover:bg-primary/5 hover:text-primary" title="Tăng số lượng">
                <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
        </div>
    );
};

const ImportItemsEditorTable = ({
    items,
    inventoryUnits,
    supplierId = null,
    settingsOpen,
    onCloseSettings,
    onToggleSettings,
    expanded = false,
    onToggleExpanded,
    onOpenPrint,
    onUpdateLine,
    onSelectProduct = null,
    onClearProduct = null,
    onRemoveLine,
    onMoveLine = null,
    onToggleProductStar = null,
    starLoadingProductIds = [],
    focusedRowKey = '',
    readOnly = false,
    hideActions = false,
    storageKey = 'inventory_import_modal_table_v3',
    bodyMaxHeightClass = null,
    headerMessage = 'Kéo biểu tượng ở tên sản phẩm để đổi thứ tự dòng. Sản phẩm gắn sao sẽ được ưu tiên khi tạo phiếu mới.',
}) => {
    const displayRows = useMemo(() => (
        items.map((item, index) => {
            const quantity = Number(item.quantity || 0);
            const received = Number(item.received_quantity ?? 0);
            return {
                ...item,
                _row_index: index,
                _is_incomplete: received < quantity,
            };
        })
    ), [items]);
    const tableColumns = useMemo(() => ([
        { id: 'stt', label: 'STT', minWidth: 68, align: 'center', draggable: false },
        ...importItemColumns.filter((column) => column.id !== 'stt' && (!hideActions || column.id !== 'actions')),
    ]), [hideActions]);
    const rowDragEnabled = Boolean(onMoveLine && !readOnly && !hideActions && displayRows.length > 1);
    const [draggingRowIndex, setDraggingRowIndex] = useState(null);
    const [dragOverRowIndex, setDragOverRowIndex] = useState(null);
    const rowRefs = useRef(new Map());

    const {
        availableColumns,
        visibleColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        setAvailableColumns,
        resetDefault,
        saveAsDefault,
    } = useTableColumns(storageKey, tableColumns);

    const clearRowDragState = () => {
        setDraggingRowIndex(null);
        setDragOverRowIndex(null);
    };

    useEffect(() => {
        if (!focusedRowKey) {
            return;
        }

        const rowElement = rowRefs.current.get(focusedRowKey);
        if (!rowElement) {
            return;
        }

        rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        const focusTarget = rowElement.querySelector('input, select, textarea, button');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }, [displayRows, focusedRowKey]);

    const handleRowDragStart = (event, rowIndex) => {
        if (!rowDragEnabled) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(rowIndex));
        setDraggingRowIndex(rowIndex);
        setDragOverRowIndex(rowIndex);
    };

    const handleRowDragOver = (event, rowIndex) => {
        if (!rowDragEnabled || draggingRowIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dragOverRowIndex !== rowIndex) {
            setDragOverRowIndex(rowIndex);
        }
    };

    const handleRowDrop = (event, rowIndex) => {
        if (!rowDragEnabled) return;
        event.preventDefault();
        const fromIndex = draggingRowIndex ?? Number(event.dataTransfer.getData('text/plain'));
        if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex === rowIndex) {
            clearRowDragState();
            return;
        }

        onMoveLine?.(fromIndex, rowIndex);
        clearRowDragState();
    };

    const renderCell = (row, columnId, rowIndex) => {
        if (columnId === 'stt') {
            return <div className="flex h-8 items-center justify-center text-[12px] font-bold text-primary/75">{rowIndex + 1}</div>;
        }

        if (columnId === 'product_name') {
            const secondaryText = [row.product_sku, row.supplier_product_code].filter(Boolean).join(' • ');
            return (
                <div className="flex items-start gap-2">
                    {rowDragEnabled ? (
                        <button
                            type="button"
                            draggable
                            onDragStart={(event) => handleRowDragStart(event, row._row_index)}
                            onDragEnd={clearRowDragState}
                            className="mt-0.5 inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/45 transition hover:border-primary/20 hover:text-primary active:cursor-grabbing"
                            title="Kéo để đổi thứ tự dòng"
                        >
                            <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
                        </button>
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-1">
                        {row.product_id ? (
                            <CellText primary={row.product_name || '-'} secondary={secondaryText || '-'} />
                        ) : (
                            <div className="space-y-1">
                                <div className="text-[12px] font-semibold text-primary/80">{row.product_name || 'Chưa gắn sản phẩm'}</div>
                                <div className="text-[11px] text-primary/45">{row.supplier_product_code || row.product_sku || 'Chưa có mã tham chiếu'}</div>
                                {row.mapping_status === 'unmatched' ? <StatusPill label="Chưa map" color="#D97706" subtle="#FEF3C7" /> : null}
                            </div>
                        )}
                    </div>
                    {row.product_id && onToggleProductStar ? (
                        <button
                            type="button"
                            onClick={() => { void onToggleProductStar(row, !Boolean(row.inventory_import_starred)); }}
                            disabled={starLoadingProductIds.includes(Number(row.product_id))}
                            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border transition ${
                                row.inventory_import_starred
                                    ? 'border-amber-300 bg-amber-50 text-amber-500'
                                    : 'border-primary/10 bg-white text-primary/35 hover:border-amber-200 hover:text-amber-500'
                            } ${starLoadingProductIds.includes(Number(row.product_id)) ? 'cursor-not-allowed opacity-50' : ''}`}
                            title={row.inventory_import_starred ? 'Bỏ khỏi lọc nhanh' : 'Khai báo sản phẩm vào lọc nhanh'}
                        >
                            <span className="material-symbols-outlined text-[18px]">{row.inventory_import_starred ? 'star' : 'star_outline'}</span>
                        </button>
                    ) : null}
                </div>
            );
        }

        if (columnId === 'product_sku') {
            if (readOnly) {
                return row.product_sku ? <span className="block truncate font-mono text-[12px] font-bold text-primary/80">{row.product_sku}</span> : <span className="text-[12px] text-primary/45">-</span>;
            }
            return onSelectProduct ? (
                <ImportLineProductLookupInput
                    value={row.product_sku}
                    selectedProductId={row.product_id}
                    supplierId={supplierId}
                    onDraftChange={(nextValue) => onUpdateLine(row._row_index, 'product_sku', nextValue)}
                    onSelect={(product) => onSelectProduct(row._row_index, product)}
                    onClearSelection={() => onClearProduct?.(row._row_index)}
                    placeholder="Tìm / nhập mã SP"
                />
            ) : <input value={row.product_sku} onChange={(event) => onUpdateLine(row._row_index, 'product_sku', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Mã SP" />;
        }

        if (columnId === 'supplier_product_code') {
            if (readOnly) {
                return row.supplier_product_code ? <span className="block truncate font-mono text-[12px] font-bold text-primary/80">{row.supplier_product_code}</span> : <span className="text-[12px] text-primary/45">-</span>;
            }
            return <input value={row.supplier_product_code} onChange={(event) => onUpdateLine(row._row_index, 'supplier_product_code', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Mã NCC" />;
        }

        if (columnId === 'quantity') {
            if (readOnly) {
                return <div className="text-right text-[12px] font-black text-primary">{formatNumber(row.quantity || 0)}</div>;
            }
            return <QuantityStepperInput value={row.quantity} onChange={(value) => onUpdateLine(row._row_index, 'quantity', value)} min={0.001} />;
        }

        if (columnId === 'received_quantity') {
            if (readOnly) {
                return <div className="text-right text-[12px] font-black text-primary">{formatNumber(row.received_quantity ?? 0)}</div>;
            }
            return <QuantityStepperInput value={row.received_quantity} onChange={(value) => onUpdateLine(row._row_index, 'received_quantity', value)} min={0} />;
        }

        if (columnId === 'outstanding_quantity') {
            const outstandingQuantity = Math.max(parseLineQuantity(row.quantity, 0) - parseLineQuantity(row.received_quantity, 0), 0);
            return <div className="flex h-8 items-center justify-center text-[12px] font-black text-primary">{formatNumber(outstandingQuantity)}</div>;
        }

        if (columnId === 'unit_name') {
            const normalizedCurrentValue = String(row.unit_name || '').trim();
            const hasCurrentValue = normalizedCurrentValue !== '' && !(inventoryUnits || []).some((unit) => normalizeSearchText(unit.name) === normalizeSearchText(normalizedCurrentValue));

            if (readOnly) {
                return row.unit_name ? <span className="block truncate text-[12px] font-semibold text-primary/80">{row.unit_name}</span> : <span className="text-[12px] text-primary/45">-</span>;
            }

            return (
                <select value={row.unit_name || ''} onChange={(event) => onUpdateLine(row._row_index, 'unit_name', event.target.value)} className={`w-full ${importSelectClass}`}>
                    <option value="">Chọn ĐVT</option>
                    {hasCurrentValue ? <option value={normalizedCurrentValue}>{normalizedCurrentValue}</option> : null}
                    {(inventoryUnits || []).map((unit) => (
                        <option key={unit.id} value={unit.name}>{unit.name}</option>
                    ))}
                </select>
            );
        }

        if (columnId === 'notes') {
            if (readOnly) {
                return row.notes ? <span className="block truncate text-[12px] text-primary/75">{row.notes}</span> : <span className="text-[12px] text-primary/45">-</span>;
            }
            return <input value={row.notes} onChange={(event) => onUpdateLine(row._row_index, 'notes', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Ghi chú" />;
        }

        if (columnId === 'unit_cost') {
            if (readOnly) {
                return <div className="text-right text-[12px] font-black text-primary">{formatCurrency(row.unit_cost || 0)}</div>;
            }
            return <input value={formatWholeNumberInput(row.unit_cost)} onChange={(event) => onUpdateLine(row._row_index, 'unit_cost', normalizeWholeMoneyDraft(event.target.value))} className={`w-full text-right ${importFieldClass}`} placeholder="0" />;
        }

        if (columnId === 'line_total') {
            return <div className="text-right text-[12px] font-black text-primary">{formatCurrency(Number(row.quantity || 0) * Number(row.unit_cost || 0))}</div>;
        }

        if (columnId === 'actions') {
            if (readOnly || hideActions) return null;
            return <button type="button" onClick={() => onRemoveLine(row._row_index)} className={dangerButton}>Xóa</button>;
        }

        return null;
    };

    return (
        <div className="overflow-hidden rounded-sm border border-primary/10">
            <div className="grid gap-2 border-b border-primary/10 bg-[#f8fafc] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0 text-[11px] font-bold text-primary/70">{headerMessage}</div>
                <div className="flex items-center justify-end gap-2">
                    {onOpenPrint ? (
                        <button
                            type="button"
                            onClick={onOpenPrint}
                            className={iconButton(false)}
                            title="In phiếu nhập"
                        >
                            <span className="material-symbols-outlined text-[18px]">print</span>
                        </button>
                    ) : null}
                    {onToggleExpanded ? (
                        <button
                            type="button"
                            onClick={onToggleExpanded}
                            className={iconButton(expanded)}
                            title={expanded ? 'Thu nhỏ bảng sản phẩm' : 'Phóng to bảng sản phẩm'}
                        >
                            <span className="material-symbols-outlined text-[18px]">{expanded ? 'close_fullscreen' : 'open_in_full'}</span>
                        </button>
                    ) : null}
                    <button type="button" onClick={onToggleSettings} className={iconButton(settingsOpen)} title="Cấu hình cột">
                        <span className="material-symbols-outlined text-[18px]">settings_suggest</span>
                    </button>
                </div>
            </div>

            {settingsOpen ? (
                <TableColumnSettingsPanel
                    availableColumns={availableColumns}
                    visibleColumns={visibleColumns}
                    toggleColumn={toggleColumn}
                    setAvailableColumns={setAvailableColumns}
                    resetDefault={resetDefault}
                    saveAsDefault={saveAsDefault}
                    onClose={onCloseSettings}
                    storageKey={storageKey}
                />
            ) : null}

            <div className={bodyMaxHeightClass || (expanded ? 'max-h-[68vh] overflow-auto' : 'max-h-[35vh] overflow-auto')}>
                <table className="w-full border-collapse table-fixed" style={{ minWidth: `${Math.max(totalTableWidth, 1180)}px` }}>
                    <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                        <tr>
                            {renderedColumns.map((column, index) => (
                                <th
                                    key={column.id}
                                    draggable={column.draggable !== false}
                                    onDragStart={column.draggable === false ? undefined : (event) => handleHeaderDragStart(event, index)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={column.draggable === false ? undefined : (event) => handleHeaderDrop(event, index)}
                                    className="relative border-b border-r border-primary/10 px-2.5 py-2 text-center text-[11px] font-bold text-primary"
                                    style={{ width: columnWidths[column.id] || column.minWidth }}
                                    title="Kéo tiêu đề để đổi vị trí cột"
                                >
                                    <div className={`flex items-center ${column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'}`}>
                                        <span className="truncate">{column.label}</span>
                                    </div>
                                    <div onMouseDown={(event) => handleColumnResize(column.id, event)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize transition hover:bg-brick/20" title="Kéo để đổi độ rộng cột" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.length === 0 ? (
                            <tr>
                                <td colSpan={renderedColumns.length} className="px-4 py-6 text-center text-[13px] text-primary/55">Chưa có dòng sản phẩm.</td>
                            </tr>
                        ) : null}
                        {displayRows.map((row, rowIndex) => (
                            <tr
                                key={row.key}
                                ref={(node) => {
                                    if (node) {
                                        rowRefs.current.set(row.key, node);
                                    } else {
                                        rowRefs.current.delete(row.key);
                                    }
                                }}
                                onDragOver={rowDragEnabled ? (event) => handleRowDragOver(event, row._row_index) : undefined}
                                onDrop={rowDragEnabled ? (event) => handleRowDrop(event, row._row_index) : undefined}
                                onDragEnd={rowDragEnabled ? clearRowDragState : undefined}
                                className={[
                                    row._is_incomplete ? 'bg-amber-50/70' : '',
                                    row.inventory_import_starred ? 'shadow-[inset_3px_0_0_0_rgba(245,158,11,0.95)]' : '',
                                    focusedRowKey === row.key ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : '',
                                    draggingRowIndex === row._row_index ? 'opacity-55' : '',
                                    dragOverRowIndex === row._row_index && draggingRowIndex !== row._row_index ? 'bg-primary/[0.06]' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                {renderedColumns.map((column) => (
                                    <td key={`${row.key}_${column.id}`} className={`${column.id === 'product_sku' && !readOnly ? 'relative overflow-visible z-[20]' : 'overflow-hidden'} border-b border-r border-primary/10 px-2.5 py-1.5 align-middle text-[12px] text-primary ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}>
                                        <div className="min-w-0">{renderCell(row, column.id, rowIndex)}</div>
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const InventoryTable = ({
    storageKey,
    columns,
    rows,
    renderCell,
    loading,
    pagination,
    onPageChange,
    footer,
    rowKey = 'id',
    rowClassName,
    settingsOpen = false,
    onCloseSettings,
    currentPerPage = 20,
    onPerPageChange,
    sortConfig = emptySortConfig,
    onSort,
    sortColumnMap = null,
    onRowDoubleClick,
    wrapperClassName = '',
    viewportClassName = tableViewportClass,
    headerTextClassName = 'text-[12px]',
    summaryCells = null,
}) => {
    const tableColumns = useMemo(() => {
        const baseColumns = columns.filter((column) => column.id !== 'stt');
        return [
            { id: 'stt', label: 'STT', minWidth: 56, align: 'center', draggable: false, sortable: false },
            ...baseColumns,
        ];
    }, [columns]);

    const {
        availableColumns,
        visibleColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        setAvailableColumns,
        resetDefault,
        saveAsDefault,
    } = useTableColumns(storageKey, tableColumns);

    const totalColumnCount = renderedColumns.length;
    const pageOffset = Math.max((((pagination?.current_page || 1) - 1) * Number(pagination?.per_page || currentPerPage || 0)), 0);
    const canSortColumn = (column) => {
        if (!onSort || column.sortable === false || column.id === 'stt') return false;
        if (sortColumnMap) return Boolean(sortColumnMap[column.id]);
        return !['actions', 'select'].includes(column.id);
    };
    const renderHeaderLabel = (column) => {
        const content = column.headerRender
            ? column.headerRender()
            : <span className="block min-w-0 truncate">{column.label}</span>;

        if (!column.headerTooltip) return content;

        const placement = column.headerTooltipPlacement || (column.align === 'right' ? 'right' : column.align === 'left' ? 'left' : 'center');
        return (
            <ColumnHeaderTooltip tooltip={column.headerTooltip} placement={placement}>
                {content}
            </ColumnHeaderTooltip>
        );
    };

    return (
        <div className={`${panelClass} ${wrapperClassName}`.trim()}>
            {settingsOpen ? (
                <TableColumnSettingsPanel
                    availableColumns={availableColumns}
                    visibleColumns={visibleColumns}
                    toggleColumn={toggleColumn}
                    setAvailableColumns={setAvailableColumns}
                    resetDefault={resetDefault}
                    saveAsDefault={saveAsDefault}
                    onClose={onCloseSettings}
                    storageKey={storageKey}
                />
            ) : null}
            <div className={viewportClassName}>
                <table className="w-full border-collapse table-fixed" style={{ minWidth: `${Math.max(totalTableWidth, 900)}px` }}>
                    <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                        <tr>
                            {renderedColumns.map((column, index) => (
                                <th
                                    key={column.id}
                                    draggable={column.draggable !== false}
                                    onDragStart={column.draggable === false ? undefined : (event) => handleHeaderDragStart(event, index)}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={column.draggable === false ? undefined : (event) => handleHeaderDrop(event, index)}
                                    onDoubleClick={canSortColumn(column) ? () => onSort(column.id) : undefined}
                                    title={canSortColumn(column) ? 'Double click để sắp xếp' : undefined}
                                    className={`group/header relative border-b border-r border-primary/10 px-3 py-3 text-center font-bold text-primary ${headerTextClassName} ${canSortColumn(column) ? 'cursor-pointer select-none' : ''}`}
                                    style={{ width: columnWidths[column.id] || column.minWidth }}
                                >
                                    <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : 'justify-center'}`}>
                                        {renderHeaderLabel(column)}
                                        {canSortColumn(column) ? <SortIndicator colId={column.id} sortConfig={sortConfig} showNeutral /> : null}
                                    </div>
                                    <div onMouseDown={(event) => handleColumnResize(column.id, event)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize transition hover:bg-brick/20" title="Kéo để đổi độ rộng cột" />
                                </th>
                            ))}
                        </tr>
                        {summaryCells ? (
                            <tr className="bg-[#fffdf7]">
                                {renderedColumns.map((column) => {
                                    const summaryCell = summaryCells[column.id];
                                    const cellConfig = summaryCell && typeof summaryCell === 'object'
                                        ? summaryCell
                                        : { value: summaryCell };
                                    const hasValue = cellConfig.value !== undefined && cellConfig.value !== null && cellConfig.value !== '';

                                    return (
                                        <th
                                            key={`summary_${column.id}`}
                                            className={`border-b border-r border-amber-200/70 px-2 py-1.5 text-[12px] ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}
                                            style={{ width: columnWidths[column.id] || column.minWidth }}
                                            title={cellConfig.title}
                                        >
                                            {hasValue ? (
                                                <span className={`inline-flex max-w-full items-center rounded-sm px-2 py-0.5 font-black ${
                                                    cellConfig.strong
                                                        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                                                        : 'text-primary'
                                                }`}>
                                                    <span className="truncate">{cellConfig.value}</span>
                                                </span>
                                            ) : (
                                                null
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        ) : null}
                    </thead>
                    <tbody>
                        {loading ? <tr><td colSpan={renderedColumns.length} className="px-4 py-10 text-center text-[13px] text-primary/55">Đang tải dữ liệu...</td></tr> : null}
                        {!loading && rows.length === 0 ? <tr><td colSpan={renderedColumns.length} className="px-4 py-10 text-center text-[13px] text-primary/55">Không có dữ liệu.</td></tr> : null}
                        {!loading && rows.map((row, rowIndex) => {
                            const key = typeof rowKey === 'function' ? rowKey(row) : row[rowKey];
                            return (
                                <tr
                                    key={key}
                                    onDoubleClick={(event) => {
                                        if (!onRowDoubleClick) return;
                                        if (event.target.closest('input, button, textarea, select, label, a')) return;
                                        const cell = event.target.closest('td[data-column-id]');
                                        onRowDoubleClick(row, cell?.dataset?.columnId || null, event);
                                    }}
                                    className={rowClassName ? rowClassName(row) : 'hover:bg-primary/[0.02]'}
                                >
                                    {renderedColumns.map((column) => (
                                        <td
                                            key={`${key}_${column.id}`}
                                            data-column-id={column.id}
                                            className={`${column.id === 'supplier_name' ? 'relative overflow-visible z-[20]' : 'overflow-hidden'} border-b border-r border-primary/10 px-3 py-2.5 text-[13px] text-primary ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}
                                        >
                                            <div className={`min-w-0 ${column.id === 'supplier_name' ? 'overflow-visible' : 'overflow-hidden'} text-ellipsis`}>
                                                {column.id === 'stt' ? pageOffset + rowIndex + 1 : renderCell(row, column.id, rowIndex)}
                                            </div>
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 px-3 py-3">
                <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-[12px] text-primary/55">
                        <span>Hiển thị</span>
                        <select
                            value={currentPerPage}
                            onChange={(event) => onPerPageChange?.(Number(event.target.value))}
                            className="h-8 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-semibold text-primary outline-none focus:border-primary"
                        >
                            {pageSizeOptions.map((size) => <option key={size} value={size}>{size} dòng</option>)}
                        </select>
                    </label>
                    <div className="text-[12px] text-primary/55">{footer}</div>
                </div>
                {pagination ? <Pagination pagination={pagination} onPageChange={onPageChange} /> : null}
            </div>
        </div>
    );
};

const InventoryMovement = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { section: sectionSlug } = useParams();
    const { showToast } = useUI();
    const { available: aiAvailable, disabledReason: aiDisabledReason } = useAiAvailability();
    const resolvedRouteSection = resolveInventorySectionKey(sectionSlug);
    const restoredSupplierContextRef = useRef(false);
    const restoredImportDraftRef = useRef(false);
    const importModalOpenRef = useRef(false);
    const importModalStateRef = useRef({ open: false, form: createImportForm() });
    const importDuplicateFocusTimeoutRef = useRef(null);
    const productCopyFeedbackTimeoutRef = useRef(null);
    const skipSupplierSearchResetRef = useRef(false);
    const savingSupplierPriceRowsRef = useRef(new Set());
    const productRequestControllerRef = useRef(null);
    const productRequestSequenceRef = useRef(0);
    const productSearchSyncRef = useRef('');
    const productSearchContainerRef = useRef(null);
    const supplierSearchSyncRef = useRef('');
    const supplierCatalogSearchSyncRef = useRef({ search: '', sku: '', name: '' });
    const simpleSearchSyncRef = useRef({
        imports: '',
        exports: '',
        returns: '',
        damaged: '',
        adjustments: '',
        lots: '',
        trash: '',
    });

    const [activeTab, setActiveTab] = useState(() => resolvedRouteSection || DEFAULT_INVENTORY_SECTION_KEY);
    const [categories, setCategories] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [inventoryUnits, setInventoryUnits] = useState([]);
    const [products, setProducts] = useState([]);
    const [productSummary, setProductSummary] = useState(null);
    const [suppliers, setSuppliers] = useState([]);
    const [supplierSummary, setSupplierSummary] = useState(null);
    const [selectedSupplierId, setSelectedSupplierId] = useState(null);
    const [supplierCatalog, setSupplierCatalog] = useState([]);
    const [importStatuses, setImportStatuses] = useState([]);
    const [imports, setImports] = useState([]);
    const [exportsData, setExportsData] = useState([]);
    const [returnsData, setReturnsData] = useState([]);
    const [damagedData, setDamagedData] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [lots, setLots] = useState([]);
    const [trashItems, setTrashItems] = useState([]);

    const [productPagination, setProductPagination] = useState(emptyPagination);
    const [supplierPagination, setSupplierPagination] = useState(emptyPagination);
    const [supplierCatalogPagination, setSupplierCatalogPagination] = useState(emptyPagination);
    const [importPagination, setImportPagination] = useState(emptyPagination);
    const [exportPagination, setExportPagination] = useState(emptyPagination);
    const [returnPagination, setReturnPagination] = useState(emptyPagination);
    const [damagedPagination, setDamagedPagination] = useState(emptyPagination);
    const [adjustmentPagination, setAdjustmentPagination] = useState(emptyPagination);
    const [lotPagination, setLotPagination] = useState(emptyPagination);
    const [trashPagination, setTrashPagination] = useState(emptyPagination);

    const [loading, setLoading] = useState({
        products: false, suppliers: false, supplierCatalog: false, imports: false, exports: false,
        returns: false, damaged: false, adjustments: false, lots: false, trash: false, saving: false,
        supplierModal: false, supplierPriceModal: false, importModal: false, documentModal: false,
        importStatuses: false, importStatusModal: false, invoiceAnalysis: false, importPriceRefresh: false,
        importInvoiceModal: false, importInvoiceUpload: false, stockAdjustment: false,
    });

    const [openPanels, setOpenPanels] = useState({
        products: { filters: true, stats: false, columns: false },
        suppliers: { filters: false, stats: false, columns: false },
        supplierPrices: { filters: false, stats: false, columns: false },
        imports: { filters: false, stats: false, columns: false },
        exports: { filters: false, stats: false, columns: false },
        returns: { filters: false, stats: false, columns: false },
        damaged: { filters: false, stats: false, columns: false },
        adjustments: { filters: false, stats: false, columns: false },
        lots: { filters: false, stats: false, columns: false },
        trash: { filters: false, stats: false, columns: false },
    });

    const [productFilters, setProductFilters] = useState(() => createDefaultProductFilters());
    const [productFilterPresets, setProductFilterPresets] = useState(() => readProductFilterPresets());
    const [selectedProductFilterPresetId, setSelectedProductFilterPresetId] = useState('');
    const [productSearchHistory, setProductSearchHistory] = useState(() => readProductSearchHistory());
    const [productSearchHistoryOpen, setProductSearchHistoryOpen] = useState(false);
    const [productDeclarationModeActive, setProductDeclarationModeActive] = useState(false);
    const [supplierFilters, setSupplierFilters] = useState(defaultSupplierFilters);
    const [supplierCatalogFilters, setSupplierCatalogFilters] = useState(defaultSupplierCatalogFilters);
    const [supplierQuickSearch, setSupplierQuickSearch] = useState('');
    const [simpleFilters, setSimpleFilters] = useState(() => createDefaultSimpleFilters());

    const selectedSupplierCatalogFilterIds = useMemo(
        () => normalizeSupplierFilterIds(supplierCatalogFilters.supplier_ids),
        [supplierCatalogFilters.supplier_ids]
    );
    const selectedSupplierCatalogFilterId = selectedSupplierCatalogFilterIds.length === 1
        ? selectedSupplierCatalogFilterIds[0]
        : null;
    const isAllSuppliersSelected = selectedSupplierCatalogFilterIds.length === 0;
    const hasMultipleSupplierSelections = selectedSupplierCatalogFilterIds.length > 1;
    const hasSupplierCatalogSelection = true;
    const hasSpecificSupplierSelection = selectedSupplierCatalogFilterId != null;
    const selectedSupplierCatalogApiId = selectedSupplierCatalogFilterId || 0;
    const currentSupplierCatalog = useMemo(
        () => (selectedSupplierCatalogFilterId != null
            ? (suppliers.find((item) => Number(item.id) === Number(selectedSupplierCatalogFilterId)) || null)
            : null),
        [selectedSupplierCatalogFilterId, suppliers]
    );
    const selectedSupplierCatalogNames = useMemo(() => {
        const supplierNameMap = new Map(suppliers.map((supplier) => [Number(supplier.id), supplier.name]));
        return selectedSupplierCatalogFilterIds
            .map((id) => supplierNameMap.get(Number(id)))
            .filter(Boolean);
    }, [selectedSupplierCatalogFilterIds, suppliers]);
    const selectedSupplierCatalogSummary = useMemo(() => {
        if (!selectedSupplierCatalogFilterIds.length) return '';
        if (selectedSupplierCatalogNames.length === selectedSupplierCatalogFilterIds.length) {
            return summarizeSelectedSupplierNames(selectedSupplierCatalogNames);
        }
        return `${selectedSupplierCatalogFilterIds.length} NCC đã chọn`;
    }, [selectedSupplierCatalogFilterIds, selectedSupplierCatalogNames]);
    const supplierCatalogSelectionKey = useMemo(
        () => (selectedSupplierCatalogFilterIds.length ? selectedSupplierCatalogFilterIds.join(',') : ALL_SUPPLIER_CATALOG_VALUE),
        [selectedSupplierCatalogFilterIds]
    );

    const [expandedGroups, setExpandedGroups] = useState({});
    const [expandedComparisons, setExpandedComparisons] = useState({});
    const [selectedPriceIds, setSelectedPriceIds] = useState({});
    const [selectedSlipIds, setSelectedSlipIds] = useState(() => createEmptySlipSelection());
    const [selectedProductRowsById, setSelectedProductRowsById] = useState({});
    const [priceDrafts, setPriceDrafts] = useState({});
    const [codeDrafts, setCodeDrafts] = useState({});
    const [savingPriceIds, setSavingPriceIds] = useState({});
    const [supplierDetailOpen, setSupplierDetailOpen] = useState({});
    const [groupPriceDrafts, setGroupPriceDrafts] = useState({});
    const [bulkPrice, setBulkPrice] = useState('');
    const [bulkNote, setBulkNote] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [pasteMode, setPasteMode] = useState('sku_price');
    const [showPasteBox, setShowPasteBox] = useState(false);
    const [supplierModal, setSupplierModal] = useState({ open: false, form: createSupplierForm(), source: null });
    const [supplierPriceModal, setSupplierPriceModal] = useState({ open: false, form: createSupplierPriceForm() });
    const [importModal, setImportModal] = useState({ open: false, form: createImportForm() });
    const [importAttachmentManagerOpen, setImportAttachmentManagerOpen] = useState(false);
    const importAttachmentInputRef = useRef(null);
    const [importInvoiceModal, setImportInvoiceModal] = useState(createImportInvoiceModalState());
    const [importInvoiceReplacingId, setImportInvoiceReplacingId] = useState(null);
    const [importInvoiceDeletingId, setImportInvoiceDeletingId] = useState(null);
    const [importCompleteToggleSnapshot, setImportCompleteToggleSnapshot] = useState(null);
    const [importStarLoadingProductIds, setImportStarLoadingProductIds] = useState([]);
    const [focusedImportRowKey, setFocusedImportRowKey] = useState('');
    const [importTableSettingsOpen, setImportTableSettingsOpen] = useState(false);
    const [importTableExpanded, setImportTableExpanded] = useState(false);
    const [importPrintModalOpen, setImportPrintModalOpen] = useState(false);
    const [importPrintLoading, setImportPrintLoading] = useState(false);
    const [importPrintSource, setImportPrintSource] = useState({ mode: 'modal', forms: [] });
    const [importPrintMode, setImportPrintMode] = useState(IMPORT_PRINT_MODE_PUTAWAY);
    const [importPrintTemplates, setImportPrintTemplates] = useState(() => ensureDefaultImportPrintTemplates([]));
    const [importPrintTemplateId, setImportPrintTemplateId] = useState(IMPORT_PRINT_DEFAULT_TEMPLATE_ID);
    const [importPrintTemplateName, setImportPrintTemplateName] = useState(IMPORT_PRINT_DEFAULT_TEMPLATE_NAME);
    const [importPrintColumnIds, setImportPrintColumnIds] = useState(() => [...IMPORT_PRINT_DEFAULT_COLUMN_IDS]);
    const [importPrintPreviewPrintedAt, setImportPrintPreviewPrintedAt] = useState(() => new Date().toISOString());
    const [importPrintSettingsLoaded, setImportPrintSettingsLoaded] = useState(false);
    const [importPrintSettingsLoading, setImportPrintSettingsLoading] = useState(false);
    const [importPrintSettingsSaving, setImportPrintSettingsSaving] = useState(false);
    const [importDetailModal, setImportDetailModal] = useState({ open: false, loading: false, form: createImportForm(), row: null });
    const [importDetailTableSettingsOpen, setImportDetailTableSettingsOpen] = useState(false);
    const [importStatusModal, setImportStatusModal] = useState({ open: false, form: createImportStatusForm() });
    const [documentModal, setDocumentModal] = useState({ open: false, tabKey: 'returns', form: createDocumentForm('returns') });
    const [stockAdjustmentModal, setStockAdjustmentModal] = useState(() => createStockAdjustmentModalState());
    const [batchReturnModal, setBatchReturnModal] = useState({ open: false, documentId: null });
    const [exportModal, setExportModal] = useState({ open: false, form: createExportForm() });
    const [dailyOutboundDrawer, setDailyOutboundDrawer] = useState({ open: false, product: null });
    const [pageSizes, setPageSizes] = useState(() => ({
        products: getStoredPageSize('products'),
        suppliers: getStoredPageSize('suppliers'),
        supplierPrices: getStoredPageSize('supplierPrices'),
        imports: getStoredPageSize('imports'),
        exports: getStoredPageSize('exports'),
        returns: getStoredPageSize('returns'),
        damaged: getStoredPageSize('damaged'),
        adjustments: getStoredPageSize('adjustments'),
        lots: getStoredPageSize('lots'),
        trash: getStoredPageSize('trash'),
    }));
    const [sortConfigs, setSortConfigs] = useState(() => createSortState());
    const [copiedProductCellId, setCopiedProductCellId] = useState(null);

    const clearPersistedImportDraft = () => {
        if (typeof window === 'undefined') return;
        localStorage.removeItem(buildImportModalDraftStorageKey());
    };

    const persistImportDraft = (draftPayload) => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(buildImportModalDraftStorageKey(), JSON.stringify(draftPayload));
    };

    const readPersistedImportDraft = () => {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(buildImportModalDraftStorageKey());
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            localStorage.removeItem(buildImportModalDraftStorageKey());
            return null;
        }
    };

    const setFlag = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));
    const fail = (error, fallback) => {
        const message = error?.response?.data?.errors
            ? Object.values(error.response.data.errors).flat().join('\n')
            : (error?.response?.data?.message || error?.message || fallback);
        showToast({ type: 'error', message });
    };
    const handleCopyProductCellValue = async (value, label, event, copyId) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        const normalizedValue = String(value ?? '').trim();
        if (!normalizedValue) return;

        try {
            await copyTextToClipboard(normalizedValue);
            const nextCopyId = copyId || normalizedValue;
            setCopiedProductCellId(nextCopyId);

            if (productCopyFeedbackTimeoutRef.current) {
                window.clearTimeout(productCopyFeedbackTimeoutRef.current);
            }

            productCopyFeedbackTimeoutRef.current = window.setTimeout(() => {
                setCopiedProductCellId((current) => (current === nextCopyId ? null : current));
            }, COPY_FEEDBACK_RESET_MS);

            showToast({ type: 'success', message: `Đã sao chép ${label}.` });
        } catch (error) {
            console.error('Failed to copy inventory product cell value', error);
            showToast({ type: 'error', message: `Không thể sao chép ${label}.` });
        }
    };
    const visibleProductRows = useMemo(
        () => (products || []).filter((row) => Number(row?.id || 0) > 0),
        [products]
    );
    const selectedProductRows = useMemo(
        () => Object.values(selectedProductRowsById).filter(Boolean),
        [selectedProductRowsById]
    );
    const productPageSelectionState = useMemo(() => {
        const total = visibleProductRows.length;
        const selectedCount = visibleProductRows.filter((row) => Boolean(selectedProductRowsById[String(row.id)])).length;

        return {
            total,
            selectedCount,
            checked: total > 0 && selectedCount === total,
            indeterminate: selectedCount > 0 && selectedCount < total,
        };
    }, [selectedProductRowsById, visibleProductRows]);

    const buildStockAdjustmentLine = (row) => {
        const currentQuantity = Number(row?.computed_stock ?? row?.stock_quantity ?? 0);

        return {
            key: `${row?.id || 'product'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            product_id: Number(row?.id || row?.product_id || 0),
            sku: row?.sku || '',
            name: row?.name || '',
            unit_name: row?.unit_name || '',
            current_quantity: currentQuantity,
            actual_quantity: normalizeQuantityDraft(Math.max(currentQuantity, 0)),
            display_cost: row?.display_cost ?? row?.current_cost ?? row?.expected_cost ?? null,
        };
    };

    const setProductRowSelected = (row, checked) => {
        if (!row?.id) return;
        const key = String(row.id);

        setSelectedProductRowsById((prev) => {
            if (checked) {
                return { ...prev, [key]: row };
            }

            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const setVisibleProductsSelected = (checked) => {
        setSelectedProductRowsById((prev) => {
            const next = { ...prev };
            visibleProductRows.forEach((row) => {
                const key = String(row.id);
                if (checked) {
                    next[key] = row;
                } else {
                    delete next[key];
                }
            });

            return next;
        });
    };

    const closeStockAdjustmentModal = () => {
        setStockAdjustmentModal(createStockAdjustmentModalState());
    };

    const openStockAdjustmentModal = (rows = selectedProductRows) => {
        const normalizedRows = (rows || []).filter((row) => Number(row?.id || row?.product_id || 0) > 0);
        if (!normalizedRows.length) {
            showToast({ type: 'warning', message: 'Vui lòng chọn ít nhất một sản phẩm để điều chỉnh tồn kho.' });
            return;
        }

        setStockAdjustmentModal({
            open: true,
            mode: 'adjustment',
            document_date: todayValue,
            notes: '',
            items: normalizedRows.map(buildStockAdjustmentLine),
        });
    };

    const updateStockAdjustmentLine = (index, field, value) => {
        setStockAdjustmentModal((prev) => ({
            ...prev,
            items: prev.items.map((item, itemIndex) => (
                itemIndex === index ? { ...item, [field]: value } : item
            )),
        }));
    };

    const removeStockAdjustmentLine = (index) => {
        setStockAdjustmentModal((prev) => ({
            ...prev,
            items: prev.items.filter((_, itemIndex) => itemIndex !== index),
        }));
    };

    const saveStockAdjustment = async () => {
        const items = stockAdjustmentModal.items
            .map((item) => {
                const actualText = String(item.actual_quantity ?? '').trim();
                const actualQuantity = parseQuantityDraft(actualText, Number.NaN);

                return {
                    product_id: Number(item.product_id || 0),
                    actual_quantity: actualQuantity,
                };
            })
            .filter((item) => item.product_id > 0);

        const hasInvalidQuantity = items.length !== stockAdjustmentModal.items.length
            || items.some((item) => !Number.isFinite(item.actual_quantity) || item.actual_quantity < 0);

        if (!items.length) {
            showToast({ type: 'warning', message: 'Danh sách điều chỉnh cần ít nhất một sản phẩm.' });
            return;
        }
        if (hasInvalidQuantity) {
            showToast({ type: 'warning', message: 'Vui lòng nhập số lượng thực tế hợp lệ cho tất cả sản phẩm.' });
            return;
        }

        setFlag('stockAdjustment', true);
        try {
            const response = await inventoryApi.adjustStockCount({
                mode: stockAdjustmentModal.mode || 'adjustment',
                document_date: stockAdjustmentModal.document_date || todayValue,
                notes: stockAdjustmentModal.notes || '',
                items,
            });
            const createdNumbers = (response.data?.created || [])
                .map((row) => row.number)
                .filter(Boolean)
                .join(', ');
            const message = createdNumbers
                ? `${response.data?.message || 'Đã tạo phiếu điều chỉnh tồn kho.'} (${createdNumbers})`
                : (response.data?.message || 'Tồn kho đã khớp, không tạo phiếu.');

            showToast({ type: 'success', message });
            closeStockAdjustmentModal();
            setSelectedProductRowsById({});
            fetchProducts(productPagination.current_page || 1);
            fetchImports(importPagination.current_page || 1);
            fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể tạo phiếu điều chỉnh tồn kho.');
        } finally {
            setFlag('stockAdjustment', false);
        }
    };

    const pageState = (setter, response) => setter({
        current_page: response.data.current_page,
        last_page: response.data.last_page,
        total: response.data.total,
        per_page: Number(response.data.per_page),
    });
    const buildSortParams = (section, sortOverride = null) => {
        const sort = sortOverride || sortConfigs[section] || emptySortConfig;
        const sortBy = inventorySortColumnMaps[section]?.[sort?.key];
        if (!sortBy || sort?.direction === 'none') return {};
        return { sort_by: sortBy, sort_order: sort.direction };
    };
    const buildSupplierPriceReturnContext = () => ({
        source: 'inventorySupplierPrices',
        target: buildInventoryPath('supplierPrices'),
        activeTab: 'supplierPrices',
        selectedSupplierId: selectedSupplierCatalogFilterId ?? ALL_SUPPLIER_CATALOG_VALUE,
        supplierQuickSearch,
        supplierCatalogFilters,
        supplierCatalogPage: supplierCatalogPagination.current_page || 1,
        supplierCatalogPerPage: pageSizes.supplierPrices,
        supplierSortConfig: sortConfigs.supplierPrices,
        supplierPanels: openPanels.supplierPrices,
    });
    const goToTab = (tabKey, options = {}) => {
        const resolvedTab = resolveInventorySectionKey(tabKey);
        if (!resolvedTab) return;

        const targetPath = buildInventoryPath(resolvedTab);
        setActiveTab(resolvedTab);

        if (location.pathname !== targetPath || Object.prototype.hasOwnProperty.call(options, 'state') || options.replace) {
            navigate(targetPath, {
                replace: options.replace ?? false,
                state: options.state,
            });
        }
    };

    const getImportPrintAccountId = () => {
        if (typeof window === 'undefined') return null;
        const activeAccountId = Number(localStorage.getItem('activeAccountId') || 0);
        return Number.isFinite(activeAccountId) && activeAccountId > 0 ? activeAccountId : null;
    };

    const applyImportPrintTemplate = (templateId, templates = importPrintTemplates, { refreshPreview = true } = {}) => {
        const template = getImportPrintTemplateById(templates, templateId);
        setImportPrintTemplateId(template.id);
        setImportPrintTemplateName(template.name);
        setImportPrintColumnIds([...template.column_ids]);
        if (refreshPreview) {
            setImportPrintPreviewPrintedAt(new Date().toISOString());
        }
        return template;
    };

    const persistImportPrintTemplates = async (nextTemplates, { successMessage = '', silent = false, selectTemplateId = null } = {}) => {
        const normalizedTemplates = ensureDefaultImportPrintTemplates(nextTemplates);
        setImportPrintTemplates(normalizedTemplates);

        if (selectTemplateId) {
            const selectedTemplate = getImportPrintTemplateById(normalizedTemplates, selectTemplateId);
            setImportPrintTemplateId(selectedTemplate.id);
            setImportPrintTemplateName(selectedTemplate.name);
            setImportPrintColumnIds([...selectedTemplate.column_ids]);
        }

        const accountId = getImportPrintAccountId();
        if (!accountId) {
            setImportPrintSettingsLoaded(true);
            if (successMessage && !silent) {
                showToast({ type: 'success', message: successMessage });
            }
            return normalizedTemplates;
        }

        setImportPrintSettingsSaving(true);
        try {
            await cmsApi.settings.update({
                account_id: accountId,
                settings: {
                    [IMPORT_PRINT_SETTINGS_KEY]: normalizedTemplates,
                },
            });

            if (successMessage && !silent) {
                showToast({ type: 'success', message: successMessage });
            }
        } catch (error) {
            if (!silent) {
                fail(error, 'Không thể lưu mẫu in phiếu nhập.');
            }
        } finally {
            setImportPrintSettingsSaving(false);
            setImportPrintSettingsLoaded(true);
        }

        return normalizedTemplates;
    };

    const loadImportPrintTemplates = async ({ silent = false } = {}) => {
        if (importPrintSettingsLoading) {
            return ensureDefaultImportPrintTemplates(importPrintTemplates);
        }

        setImportPrintSettingsLoading(true);
        try {
            const response = await cmsApi.settings.get();
            const rawTemplates = response.data?.[IMPORT_PRINT_SETTINGS_KEY];
            const normalizedTemplates = ensureDefaultImportPrintTemplates(rawTemplates);
            const selectedTemplate = getImportPrintTemplateById(normalizedTemplates, importPrintTemplateId);

            setImportPrintTemplates(normalizedTemplates);
            setImportPrintTemplateId(selectedTemplate.id);
            setImportPrintTemplateName(selectedTemplate.name);
            setImportPrintColumnIds([...selectedTemplate.column_ids]);
            setImportPrintSettingsLoaded(true);

            const shouldBackfill = !Array.isArray(rawTemplates) || JSON.stringify(rawTemplates) !== JSON.stringify(normalizedTemplates);
            if (shouldBackfill) {
                await persistImportPrintTemplates(normalizedTemplates, {
                    silent: true,
                    selectTemplateId: selectedTemplate.id,
                });
            }

            return normalizedTemplates;
        } catch (error) {
            const fallbackTemplates = ensureDefaultImportPrintTemplates([]);
            const fallbackTemplate = getImportPrintTemplateById(fallbackTemplates, IMPORT_PRINT_DEFAULT_TEMPLATE_ID);

            setImportPrintTemplates(fallbackTemplates);
            setImportPrintTemplateId(fallbackTemplate.id);
            setImportPrintTemplateName(fallbackTemplate.name);
            setImportPrintColumnIds([...fallbackTemplate.column_ids]);
            setImportPrintSettingsLoaded(true);

            if (!silent) {
                fail(error, 'Không thể tải mẫu in phiếu nhập.');
            }

            return fallbackTemplates;
        } finally {
            setImportPrintSettingsLoading(false);
        }
    };

    const closeImportPrintModal = () => {
        setImportPrintModalOpen(false);
        setImportPrintLoading(false);
        setImportPrintSource({ mode: 'modal', forms: [] });
        setImportPrintMode(IMPORT_PRINT_MODE_PUTAWAY);
    };

    const openImportPrintModalWithForms = async (forms = [], mode = 'selected') => {
        setImportPrintSource({ mode, forms });
        setImportPrintMode(IMPORT_PRINT_MODE_PUTAWAY);
        setImportPrintModalOpen(true);
        setImportPrintPreviewPrintedAt(new Date().toISOString());

        if (!importPrintSettingsLoaded) {
            await loadImportPrintTemplates({ silent: false });
            return;
        }

        applyImportPrintTemplate(importPrintTemplateId, importPrintTemplates);
    };

    const openImportPrintModal = async () => {
        await openImportPrintModalWithForms([], 'modal');
    };

    const openSelectedImportsPrintModal = async () => {
        const targetRows = imports.filter((row) => Boolean(selectedSlipIds.imports?.[String(row.id)]));
        if (!targetRows.length) {
            showToast({ type: 'warning', message: 'Hãy chọn ít nhất một phiếu nhập để in.' });
            return;
        }

        setImportPrintLoading(true);
        try {
            const responses = await Promise.all(targetRows.map((row) => inventoryApi.getImport(row.id)));
            const forms = responses.map((response) => synchronizeImportFormCompletion(createImportForm(response.data)));
            await openImportPrintModalWithForms(forms, 'selected');
        } catch (error) {
            fail(error, targetRows.length > 1 ? 'Không thể tải các phiếu nhập đã chọn để in.' : 'Không thể tải phiếu nhập để in.');
        } finally {
            setImportPrintLoading(false);
        }
    };

    const toggleImportPrintColumn = (columnId) => {
        const exists = importPrintColumnIds.includes(columnId);
        if (exists && importPrintColumnIds.length === 1) {
            showToast({ type: 'warning', message: 'Mẫu in cần ít nhất một cột hiển thị.' });
            return;
        }

        const nextColumnIds = exists
            ? orderImportPrintColumnIds(importPrintColumnIds.filter((id) => id !== columnId), false)
            : orderImportPrintColumnIds([...importPrintColumnIds, columnId], false);

        setImportPrintColumnIds(nextColumnIds);
        setImportPrintPreviewPrintedAt(new Date().toISOString());
    };

    const saveImportPrintTemplate = async (mode = 'update') => {
        const trimmedTemplateName = importPrintTemplateName.trim();
        if (!trimmedTemplateName) {
            showToast({ type: 'warning', message: 'Vui lòng nhập tên mẫu in.' });
            return;
        }

        const selectedColumnIds = orderImportPrintColumnIds(importPrintColumnIds, false);
        if (!selectedColumnIds.length) {
            showToast({ type: 'warning', message: 'Vui lòng chọn ít nhất một cột để in.' });
            return;
        }

        const currentTemplates = ensureDefaultImportPrintTemplates(importPrintTemplates);
        const canUpdateCurrentTemplate = mode === 'update' && currentTemplates.some((template) => template.id === importPrintTemplateId);
        const targetTemplateId = canUpdateCurrentTemplate ? importPrintTemplateId : createImportPrintTemplateId();
        const draftTemplate = {
            id: targetTemplateId,
            name: trimmedTemplateName,
            column_ids: selectedColumnIds,
            locked: targetTemplateId === IMPORT_PRINT_DEFAULT_TEMPLATE_ID,
        };

        const nextTemplates = currentTemplates.some((template) => template.id === targetTemplateId)
            ? currentTemplates.map((template) => (template.id === targetTemplateId ? { ...template, ...draftTemplate } : template))
            : [...currentTemplates, draftTemplate];

        await persistImportPrintTemplates(nextTemplates, {
            successMessage: canUpdateCurrentTemplate ? 'Đã lưu mẫu in.' : 'Đã tạo mẫu in mới.',
            selectTemplateId: targetTemplateId,
        });
        setImportPrintPreviewPrintedAt(new Date().toISOString());
    };

    const printImportSheet = () => {
        const selectedColumns = importPrintSelectedColumns;
        const isPutawayPrint = importPrintMode === IMPORT_PRINT_MODE_PUTAWAY;

        if (!isPutawayPrint && !selectedColumns.length) {
            showToast({ type: 'warning', message: 'Vui lòng chọn ít nhất một cột để in.' });
            return;
        }

        if (!importPrintDocuments.length) {
            showToast({ type: 'warning', message: 'Không có phiếu nhập hợp lệ để in.' });
            return;
        }

        const printedAt = new Date().toISOString();
        const printHtml = isPutawayPrint
            ? buildImportPutawayPrintHtml({
                printedAt,
                documents: importPrintDocuments,
            })
            : buildImportPrintHtml({
                printedAt,
                columns: selectedColumns,
                documents: importPrintDocuments,
            });

        const printWindow = window.open('', '_blank', 'width=1024,height=720');
        if (!printWindow) {
            showToast({ type: 'warning', message: 'Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup để tiếp tục.' });
            return;
        }

        setImportPrintPreviewPrintedAt(printedAt);
        printWindow.document.open();
        printWindow.document.write(printHtml);
        printWindow.document.close();
        printWindow.focus();
        printWindow.onafterprint = () => printWindow.close();
        window.setTimeout(() => {
            printWindow.print();
        }, 250);
    };

    const togglePanel = (section, panel) => {
        const nextOpen = !openPanels[section]?.[panel];
        setOpenPanels((prev) => ({ ...prev, [section]: { ...prev[section], [panel]: nextOpen } }));

        if (section === 'products' && panel === 'stats' && nextOpen && activeTab === 'products') {
            void fetchProducts(
                productPagination.current_page || 1,
                pageSizes.products,
                sortConfigs.products,
                productFilters,
                { includeSummary: true },
            );
        }
    };
    const updatePageSize = (key, size) => {
        const nextSize = pageSizeOptions.includes(size) ? size : 20;
        setPageSizes((prev) => ({ ...prev, [key]: nextSize }));
        localStorage.setItem(`inventory_page_size_${key}`, String(nextSize));
        return nextSize;
    };

    const flattenSupplierRows = (items = []) => {
        const rows = [];
        items.forEach((item) => {
            if (Array.isArray(item.variants) && item.variants.length) {
                item.variants.forEach((variant) => rows.push(variant));
                return;
            }
            rows.push(item);
        });
        return rows;
    };

    const getDefaultImportStatus = () => importStatuses.find((status) => status.is_default) || importStatuses[0] || null;
    const getImportStatusById = (statusId) => importStatuses.find((status) => String(status.id) === String(statusId)) || null;
    const getNewImportStatus = () => (
        importStatuses.find((status) => isNewImportStatus(status))
        || importStatuses.find((status) => !isCompletedImportStatus(status) && !status.affects_inventory)
        || getDefaultImportStatus()
        || null
    );
    const getCompletedImportStatus = () => importStatuses.find((status) => isCompletedImportStatus(status)) || null;
    const getIncompleteImportStatus = () => (
        importStatuses.find((status) => {
            const code = normalizeImportStatusKey(status.code);
            const name = normalizeSearchText(status.name);
            return ['hoan_thanh_1_phan', 'partial', 'partially_completed'].includes(code)
                || name.includes('1 phan')
                || name.includes('mot phan')
                || name.includes('chua du')
                || name.includes('partial');
        })
        || importStatuses.find((status) => !isCompletedImportStatus(status))
        || getDefaultImportStatus()
        || null
    );

    const normalizeImportItems = (items) => (items || []).map((item) => {
        const quantityText = normalizeQuantityDraft(item.quantity);
        const quantity = quantityText ? Number(quantityText) : 0;
        const receivedText = normalizeQuantityDraft(item.received_quantity);
        const receivedRaw = receivedText ? Number(receivedText) : 0;

        return {
            ...item,
            quantity: quantityText || '0',
            received_quantity: String(clampReceivedQuantity(receivedRaw, quantity)),
        };
    });

    const areAllImportItemsCompleted = (items) => {
        const relevantItems = (items || []).filter((item) => Number(item.product_id || 0) > 0);
        return relevantItems.length > 0 && relevantItems.every((item) => {
            const quantity = parseLineQuantity(item.quantity, 0);
            const received = parseLineQuantity(item.received_quantity, 0);
            return quantity > 0 && received >= quantity;
        });
    };

    const resolveSystemImportStatusByItems = (items, currentStatusId) => {
        const completedStatus = getCompletedImportStatus();
        const incompleteStatus = getIncompleteImportStatus();
        const currentStatus = getImportStatusById(currentStatusId);
        const allCompleted = areAllImportItemsCompleted(items);

        if (allCompleted && completedStatus) {
            return String(completedStatus.id);
        }

        if (!allCompleted && isCompletedImportStatus(currentStatus) && incompleteStatus) {
            return String(incompleteStatus.id);
        }

        return currentStatusId ? String(currentStatusId) : String(incompleteStatus?.id || '');
    };

    const applyImportItemsCompletionState = (items, completed) => normalizeImportItems(items || []).map((item) => {
        const quantity = parseLineQuantity(item.quantity, 0);
        return {
            ...item,
            received_quantity: completed ? String(quantity) : '0',
        };
    });

    const synchronizeImportFormCompletion = (form) => {
        const autoCompleteImport = Boolean(form.auto_complete_import);
        const nextItems = autoCompleteImport
            ? applyImportItemsCompletionState(form.items || [], true)
            : normalizeImportItems(form.items || []);
        const baseStatusId = form.inventory_import_status_id ? String(form.inventory_import_status_id) : '';
        const shouldAutoResolveStatus = !form.status_is_manual;
        let nextStatusId = baseStatusId;

        if (autoCompleteImport) {
            nextStatusId = getCompletedImportStatus()?.id ? String(getCompletedImportStatus().id) : baseStatusId;
        } else if (shouldAutoResolveStatus) {
            nextStatusId = getNewImportStatus()?.id
                ? String(getNewImportStatus().id)
                : resolveSystemImportStatusByItems(nextItems, baseStatusId);
        }

        return {
            ...form,
            auto_complete_import: autoCompleteImport,
            inventory_import_status_id: nextStatusId,
            items: nextItems,
        };
    };

    const applyImportAutoCompleteMode = (form, checked, statusOptionsOverride = null) => {
        const statusOptions = Array.isArray(statusOptionsOverride) ? statusOptionsOverride : importStatuses;
        const completedStatus = statusOptions.find((status) => isCompletedImportStatus(status)) || null;
        const newStatus = (
            statusOptions.find((status) => isNewImportStatus(status))
            || statusOptions.find((status) => !isCompletedImportStatus(status) && !status.affects_inventory)
            || statusOptions.find((status) => status.is_default)
            || statusOptions[0]
            || null
        );

        return synchronizeImportFormCompletion({
            ...form,
            auto_complete_import: Boolean(checked),
            auto_complete_import_touched: Boolean(form.auto_complete_import_touched),
            inventory_import_status_id: checked
                ? (completedStatus ? String(completedStatus.id) : form.inventory_import_status_id)
                : (newStatus ? String(newStatus.id) : form.inventory_import_status_id),
            status_is_manual: false,
            items: applyImportItemsCompletionState(form.items || [], checked),
        });
    };

    const highlightImportRow = (rowKey) => {
        setFocusedImportRowKey(rowKey || '');

        if (importDuplicateFocusTimeoutRef.current) {
            clearTimeout(importDuplicateFocusTimeoutRef.current);
            importDuplicateFocusTimeoutRef.current = null;
        }

        if (!rowKey) {
            return;
        }

        importDuplicateFocusTimeoutRef.current = setTimeout(() => {
            setFocusedImportRowKey((currentKey) => (currentKey === rowKey ? '' : currentKey));
            importDuplicateFocusTimeoutRef.current = null;
        }, 1800);
    };

    const notifyDuplicateImportProduct = (duplicate, product = null) => {
        const duplicateItem = duplicate?.item || duplicate?.firstItem || duplicate?.duplicateItem || null;
        const rowKey = duplicateItem?.key || '';
        const productLabel = buildImportDuplicateProductLabel(product, duplicateItem);

        if (rowKey) {
            highlightImportRow(rowKey);
        }

        showToast({
            type: 'warning',
            message: `${productLabel} đã tồn tại trong phiếu nhập.`,
        });

        return {
            accepted: false,
            duplicate: true,
            rowKey,
        };
    };

    const closeImportModal = () => {
        clearPersistedImportDraft();
        setImportTableSettingsOpen(false);
        setImportTableExpanded(false);
        setImportAttachmentManagerOpen(false);
        closeImportPrintModal();
        setImportCompleteToggleSnapshot(null);
        setImportStarLoadingProductIds([]);
        highlightImportRow('');
        setImportModal({
            open: false,
            form: applyImportAutoCompleteMode(createImportForm({
                inventory_import_status_id: getCompletedImportStatus()?.id || getDefaultImportStatus()?.id || null,
                update_supplier_prices: true,
                auto_complete_import: true,
            }), true),
        });
    };

    const closeImportInvoiceModal = () => {
        setImportInvoiceReplacingId(null);
        setImportInvoiceDeletingId(null);
        setImportInvoiceModal(createImportInvoiceModalState());
    };

    const syncImportInvoiceCountInList = (importId, attachmentsCount) => {
        const nextCount = Math.max(Number(attachmentsCount || 0), 0);
        setImports((prev) => prev.map((row) => (
            Number(row.id) === Number(importId)
                ? { ...row, attachments_count: nextCount }
                : row
        )));
    };

    const openImportInvoiceModal = async (row, preferredAttachmentId = null) => {
        if (!row?.id) return;

        setImportInvoiceReplacingId(null);
        setImportInvoiceDeletingId(null);
        setImportInvoiceModal({
            open: true,
            row,
            importInfo: {
                id: row.id,
                import_number: row.import_number,
                import_date: row.import_date,
                supplier_name: row.supplier?.name || row.supplier_name || '-',
                attachments_count: Number(row.attachments_count || 0),
            },
            attachments: [],
            selectedAttachmentId: null,
        });
        setFlag('importInvoiceModal', true);

        try {
            const response = await inventoryApi.getImportAttachments(row.id);
            const importInfo = response.data?.import || {};
            const attachments = Array.isArray(response.data?.attachments)
                ? response.data.attachments.map(mapImportAttachment)
                : [];
            const nextSelectedAttachmentId = attachments.some((attachment) => Number(attachment.id) === Number(preferredAttachmentId))
                ? Number(preferredAttachmentId)
                : (attachments[0]?.id || null);
            const nextCount = Number(importInfo.attachments_count ?? attachments.length);

            setImportInvoiceModal({
                open: true,
                row,
                importInfo: {
                    id: importInfo.id || row.id,
                    import_number: importInfo.import_number || row.import_number,
                    import_date: importInfo.import_date || row.import_date,
                    supplier_name: importInfo.supplier_name || row.supplier?.name || row.supplier_name || '-',
                    attachments_count: nextCount,
                },
                attachments,
                selectedAttachmentId: nextSelectedAttachmentId,
            });
            syncImportInvoiceCountInList(row.id, nextCount);
        } catch (error) {
            closeImportInvoiceModal();
            fail(error, 'Không thể tải danh sách hóa đơn.');
        } finally {
            setFlag('importInvoiceModal', false);
        }
    };

    const addImportInvoiceFiles = async (fileList) => {
        const files = Array.from(fileList || []).filter(Boolean);
        if (!importInvoiceModal.row?.id || !files.length) return;

        setFlag('importInvoiceUpload', true);
        try {
            const submitData = new FormData();
            files.forEach((file) => submitData.append('attachments[]', file));

            const response = await inventoryApi.addImportAttachments(importInvoiceModal.row.id, submitData);
            const createdAttachments = Array.isArray(response.data?.attachments)
                ? response.data.attachments.map(mapImportAttachment)
                : [];
            const nextCount = Number(response.data?.attachments_count ?? (importInvoiceModal.attachments.length + createdAttachments.length));

            setImportInvoiceModal((prev) => {
                const remainingAttachments = prev.attachments.filter(
                    (attachment) => !createdAttachments.some((createdAttachment) => Number(createdAttachment.id) === Number(attachment.id))
                );
                const mergedAttachments = [...createdAttachments, ...remainingAttachments];

                return {
                    ...prev,
                    attachments: mergedAttachments,
                    selectedAttachmentId: createdAttachments[0]?.id || prev.selectedAttachmentId || mergedAttachments[0]?.id || null,
                    importInfo: {
                        ...(prev.importInfo || {}),
                        attachments_count: nextCount,
                    },
                };
            });

            syncImportInvoiceCountInList(importInvoiceModal.row.id, nextCount);
            fetchImports(importPagination.current_page || 1);
            showToast({ type: 'success', message: response.data?.message || 'Đã thêm hóa đơn.' });
        } catch (error) {
            fail(error, 'Không thể thêm hóa đơn.');
        } finally {
            setFlag('importInvoiceUpload', false);
        }
    };

    const replaceImportInvoiceAttachment = async (attachment, file) => {
        if (!attachment?.id || !file || !importInvoiceModal.row?.id) return;

        setImportInvoiceReplacingId(attachment.id);
        try {
            const submitData = new FormData();
            submitData.append('file', file);

            const response = await inventoryApi.replaceImportAttachment(importInvoiceModal.row.id, attachment.id, submitData);
            const updatedAttachment = response.data?.attachment ? mapImportAttachment(response.data.attachment) : null;
            const nextCount = Number(response.data?.attachments_count ?? importInvoiceModal.attachments.length);

            if (updatedAttachment) {
                setImportInvoiceModal((prev) => ({
                    ...prev,
                    attachments: prev.attachments.map((currentAttachment) => (
                        Number(currentAttachment.id) === Number(updatedAttachment.id)
                            ? updatedAttachment
                            : currentAttachment
                    )),
                    selectedAttachmentId: updatedAttachment.id,
                    importInfo: {
                        ...(prev.importInfo || {}),
                        attachments_count: nextCount,
                    },
                }));
                syncImportInvoiceCountInList(importInvoiceModal.row.id, nextCount);
            }

            showToast({ type: 'success', message: response.data?.message || 'Đã thay hóa đơn.' });
        } catch (error) {
            fail(error, 'Không thể thay hóa đơn.');
        } finally {
            setImportInvoiceReplacingId(null);
        }
    };

    const deleteImportInvoiceAttachment = async (attachment) => {
        if (!attachment?.id || !importInvoiceModal.row?.id) return;
        if (!window.confirm(`Xóa hóa đơn "${getImportAttachmentName(attachment)}"?`)) return;

        setImportInvoiceDeletingId(attachment.id);
        try {
            const response = await inventoryApi.deleteImportAttachment(importInvoiceModal.row.id, attachment.id);
            const nextCount = Number(response.data?.attachments_count ?? 0);

            setImportInvoiceModal((prev) => {
                const remainingAttachments = prev.attachments.filter((currentAttachment) => Number(currentAttachment.id) !== Number(attachment.id));
                const hasCurrentSelection = remainingAttachments.some((currentAttachment) => Number(currentAttachment.id) === Number(prev.selectedAttachmentId));

                return {
                    ...prev,
                    attachments: remainingAttachments,
                    selectedAttachmentId: hasCurrentSelection ? prev.selectedAttachmentId : (remainingAttachments[0]?.id || null),
                    importInfo: {
                        ...(prev.importInfo || {}),
                        attachments_count: nextCount,
                    },
                };
            });

            syncImportInvoiceCountInList(importInvoiceModal.row.id, nextCount);
            fetchImports(importPagination.current_page || 1);
            showToast({ type: 'success', message: response.data?.message || 'Đã xóa hóa đơn.' });
        } catch (error) {
            fail(error, 'Không thể xóa hóa đơn.');
        } finally {
            setImportInvoiceDeletingId(null);
        }
    };

    const handleImportStatusChange = (statusId) => {
        setImportModal((prev) => {
            const selectedStatus = getImportStatusById(statusId);
            const selectedIsCompleted = isCompletedImportStatus(selectedStatus);
            const nextItems = selectedIsCompleted
                ? applyImportItemsCompletionState(prev.form.items, true)
                : (
                    isNewImportStatus(selectedStatus)
                        ? applyImportItemsCompletionState(prev.form.items, false)
                        : prev.form.items
                );
            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                inventory_import_status_id: statusId,
                status_is_manual: true,
                auto_complete_import: selectedIsCompleted,
                auto_complete_import_touched: true,
                items: nextItems,
            });
            return { ...prev, form: syncedForm };
        });
    };

    const handleImportAutoCompleteChange = (checked) => {
        setImportCompleteToggleSnapshot(null);
        setImportModal((prev) => ({
            ...prev,
            form: applyImportAutoCompleteMode({
                ...prev.form,
                auto_complete_import_touched: true,
            }, checked),
        }));
    };

    const updateImportLine = (index, field, value) => {
        setImportModal((prev) => {
            const nextItems = prev.form.items.map((item, itemIndex) => (
                itemIndex === index
                    ? { ...item, [field]: value }
                    : item
            ));

            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                items: nextItems,
            });

            return { ...prev, form: syncedForm };
        });
    };

    const markAllImportLinesCompleted = () => {
        const completedStatus = getCompletedImportStatus();
        if (importCompleteToggleSnapshot) {
            setImportModal((prev) => ({
                ...prev,
                form: synchronizeImportFormCompletion({
                    ...prev.form,
                    inventory_import_status_id: importCompleteToggleSnapshot.inventory_import_status_id,
                    status_is_manual: importCompleteToggleSnapshot.status_is_manual,
                    items: importCompleteToggleSnapshot.items.map((item) => ({ ...item })),
                }),
            }));
            setImportCompleteToggleSnapshot(null);
            return;
        }

        setImportModal((prev) => {
            setImportCompleteToggleSnapshot({
                inventory_import_status_id: prev.form.inventory_import_status_id,
                status_is_manual: Boolean(prev.form.status_is_manual),
                items: prev.form.items.map((item) => ({ ...item })),
            });

            const completedItems = prev.form.items.map((item) => {
                const quantity = parseLineQuantity(item.quantity, 0);
                return {
                    ...item,
                    quantity: String(quantity),
                    received_quantity: String(quantity),
                };
            });

            return {
                ...prev,
                form: synchronizeImportFormCompletion({
                    ...prev.form,
                    inventory_import_status_id: completedStatus ? String(completedStatus.id) : prev.form.inventory_import_status_id,
                    status_is_manual: false,
                    items: completedItems,
                }),
            };
        });
    };

    const removeImportLine = (index) => {
        setImportModal((prev) => {
            const nextItems = prev.form.items.filter((_, itemIndex) => itemIndex !== index);
            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                items: nextItems,
            });
            return { ...prev, form: syncedForm };
        });
    };

    const moveImportLine = (fromIndex, toIndex) => {
        setImportModal((prev) => {
            const nextItems = moveArrayItem(prev.form.items, fromIndex, toIndex);
            if (nextItems === prev.form.items) {
                return prev;
            }

            return {
                ...prev,
                form: synchronizeImportFormCompletion({
                    ...prev.form,
                    items: nextItems,
                }),
            };
        });
    };

    const toggleImportProductStar = async (productOrRow, nextStarred) => {
        const productId = Number(productOrRow?.product_id || productOrRow?.id || 0);
        if (!productId) return null;

        setImportStarLoadingProductIds((prev) => (
            prev.includes(productId) ? prev : [...prev, productId]
        ));

        try {
            const response = await inventoryApi.setImportStar(productId, {
                inventory_import_starred: Boolean(nextStarred),
            });
            const resolvedStarred = Boolean(response.data?.product?.inventory_import_starred ?? nextStarred);

            clearInventorySearchCache();
            setProducts((prev) => updateInventoryImportStarInProductCollection(prev, productId, resolvedStarred));
            setImportModal((prev) => {
                const nextItems = prev.form.items.map((item) => (
                    Number(item.product_id || 0) === productId
                        ? { ...item, inventory_import_starred: resolvedStarred }
                        : item
                ));

                return {
                    ...prev,
                    form: synchronizeImportFormCompletion({
                        ...prev.form,
                        items: resolvedStarred ? sortImportItemsByStarPriority(nextItems) : nextItems,
                    }),
                };
            });

            showToast({
                type: 'success',
                message: response.data?.message || (resolvedStarred
                    ? 'Đã lưu sản phẩm này vào lọc nhanh phiếu nhập.'
                    : 'Đã bỏ sản phẩm này khỏi lọc nhanh phiếu nhập.'),
            });

            return {
                id: productId,
                inventory_import_starred: resolvedStarred,
            };
        } catch (error) {
            fail(error, nextStarred ? 'Không thể lưu sản phẩm này vào lọc nhanh.' : 'Không thể bỏ sản phẩm này khỏi lọc nhanh.');
            throw error;
        } finally {
            setImportStarLoadingProductIds((prev) => prev.filter((id) => id !== productId));
        }
    };

    const syncImportItemsFromSupplier = async (supplierId) => {
        const numericSupplierId = Number(supplierId || 0);
        if (!numericSupplierId) return;

        const lines = importModal.form.items.filter((item) => item.product_id);
        if (!lines.length) return;

        try {
            const response = await inventoryApi.getSupplierPrices(numericSupplierId, { per_page: 500 });
            const flattened = flattenSupplierRows((response.data.data || []).map((item) => mapSupplierCatalogEntry(item)));
            const priceMap = new Map(flattened.map((row) => [Number(row.product_id || row.id), row]));

            setImportModal((prev) => ({
                ...prev,
                form: {
                    ...prev.form,
                    items: prev.form.items.map((item) => {
                        const matched = priceMap.get(Number(item.product_id));
                        if (!matched) return item;
                        return {
                            ...item,
                            supplier_product_code: matched.supplier_product_code || item.supplier_product_code,
                            unit_name: matched.unit_name || item.unit_name,
                            unit_cost: matched.unit_cost != null ? String(Math.round(Number(matched.unit_cost || 0))) : item.unit_cost,
                        };
                    }),
                },
            }));
        } catch (error) {
            // Leave manual values untouched if the supplier price library cannot be loaded.
        }
    };

    const refreshImportItemPricing = async () => {
        const productIds = importModal.form.items
            .map((item) => Number(item.product_id || 0))
            .filter(Boolean);

        if (!productIds.length) {
            showToast({ type: 'warning', message: 'Chưa có sản phẩm để làm mới giá nhập.' });
            return;
        }

        setFlag('importPriceRefresh', true);
        try {
            const response = await inventoryApi.getProducts({
                ids: productIds.join(','),
                per_page: Math.max(productIds.length, 20),
                supplier_id: importModal.form.supplier_id || undefined,
            });

            const productMap = new Map((response.data?.data || []).map((product) => [Number(product.id), product]));

            setImportModal((prev) => ({
                ...prev,
                form: synchronizeImportFormCompletion({
                    ...prev.form,
                    items: prev.form.items.map((item) => {
                        const product = productMap.get(Number(item.product_id || 0));
                        if (!product) return item;
                        const nextCost = product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost;
                        const storageLocation = normalizeImportStorageLocation(product) || item.storage_location || null;
                        if (nextCost == null && !storageLocation) return item;

                        return {
                            ...item,
                            unit_cost: nextCost == null ? item.unit_cost : String(Math.round(Number(nextCost || 0))),
                            storage_location: storageLocation,
                            storage_location_label: storageLocation?.location_label || item.storage_location_label || '',
                            warehouse_sequence: product.warehouse_sequence ?? storageLocation?.warehouse_sequence ?? item.warehouse_sequence ?? '',
                        };
                    }),
                }),
            }));

            showToast({ type: 'success', message: 'Đã cập nhật lại giá nhập mới nhất cho các dòng hiện có.' });
        } catch (error) {
            fail(error, 'Không thể làm mới giá nhập của các sản phẩm trong phiếu.');
        } finally {
            setFlag('importPriceRefresh', false);
        }
    };

    const buildImportPayloadItems = (items) => items
        .filter((item) => item.product_id)
        .map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity || 0),
            received_quantity: Number(item.received_quantity ?? 0),
            unit_cost: Number(item.unit_cost || 0),
            supplier_product_code: item.supplier_product_code || null,
            unit_name: item.unit_name || null,
            notes: item.notes || null,
            update_supplier_price: Boolean(item.update_supplier_price),
        }))
        .filter((item) => item.product_id && item.quantity > 0);

    const buildImportSubmitData = (form) => {
        const subtotalAmount = (form.items || []).reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_cost || 0)), 0);
        const surchargeState = parseImportSurchargeFields({
            amountInput: form.extra_charge_amount_input,
            percentInput: form.extra_charge_percent_input,
        }, subtotalAmount);
        const payload = new FormData();
        if (form.supplier_id) {
            payload.append('supplier_id', String(Number(form.supplier_id)));
        }
        if (form.inventory_import_status_id) {
            payload.append('inventory_import_status_id', String(Number(form.inventory_import_status_id)));
        }
        payload.append('status_is_manual', form.status_is_manual ? '1' : '0');
        payload.append('import_date', form.import_date || todayValue);
        payload.append('notes', form.notes || '');
        payload.append('entry_mode', form.entry_mode || 'manual');
        payload.append('extra_charge_mode', surchargeState.mode);
        payload.append('extra_charge_value', String(surchargeState.value));
        payload.append('extra_charge_amount', String(surchargeState.amount));
        payload.append('extra_charge_percent', String(surchargeState.percent));
        payload.append('update_supplier_prices', form.update_supplier_prices ? '1' : '0');
        payload.append('has_purchase_invoice', form.has_purchase_invoice ? '1' : '0');
        if (form.invoice_analysis_log_id) {
            payload.append('invoice_analysis_log_id', String(Number(form.invoice_analysis_log_id)));
        }
        payload.append('items', JSON.stringify(buildImportPayloadItems(form.items)));
        payload.append('attachments', JSON.stringify(
            (form.attachments || []).map((attachment) => ({
                id: attachment.id || null,
                invoice_analysis_log_id: attachment.invoice_analysis_log_id || null,
                source_type: attachment.source_type || 'manual',
                disk: attachment.disk || 'public',
                file_path: attachment.file_path,
                original_name: attachment.original_name || 'Tệp đính kèm',
                mime_type: attachment.mime_type || null,
                file_size: attachment.file_size || 0,
            }))
        ));
        (form.local_attachment_files || []).forEach((file) => {
            payload.append('attachment_files[]', file);
        });
        return payload;
    };

    const updateLine = (setter, index, field, value) => {
        setter((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                items: prev.form.items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
            },
        }));
    };

    const addLine = (setter) => {
        setter((prev) => ({ ...prev, form: { ...prev.form, items: [...prev.form.items, createLine()] } }));
    };

    const removeLine = (setter, index) => {
        setter((prev) => {
            const nextItems = prev.form.items.filter((_, itemIndex) => itemIndex !== index);
            return { ...prev, form: { ...prev.form, items: nextItems.length ? nextItems : [createLine()] } };
        });
    };

    const attachProductToLine = (setter, index, product) => {
        setter((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                items: prev.form.items.map((item, itemIndex) => itemIndex === index ? {
                    ...item,
                    product_id: product.id,
                    product_name: product.name,
                    product_sku: product.sku,
                    supplier_product_code: product.supplier_product_code || item.supplier_product_code || '',
                    unit_name: product.unit_name || product.unit?.name || item.unit_name || '',
                    unit_cost: resolveDocumentUnitCostValue(product),
                    mapping_status: 'matched',
                    mapping_label: item.mapping_status === 'unmatched' ? 'Đã map thủ công' : 'Đã chọn sản phẩm',
                } : item),
            },
        }));
    };

    const attachImportProductToLine = (index, product) => {
        if (!product?.id) {
            return { accepted: false };
        }

        const currentModal = importModalStateRef.current;
        const duplicateSelection = findImportDuplicateSelection(currentModal.form.items, product.id, index);
        if (duplicateSelection) {
            return notifyDuplicateImportProduct(duplicateSelection, product);
        }

        const nextItems = currentModal.form.items.map((item, itemIndex) => (
            itemIndex === index
                ? applyImportProductData(item, product)
                : item
        ));

        const nextState = {
            ...currentModal,
            form: synchronizeImportFormCompletion({
                ...currentModal.form,
                items: product.inventory_import_starred ? sortImportItemsByStarPriority(nextItems) : nextItems,
            }),
        };

        importModalStateRef.current = nextState;
        setImportModal(nextState);

        return { accepted: true };
    };

    const clearImportProductFromLine = (index) => {
        setImportModal((prev) => {
            const nextItems = prev.form.items.map((item, itemIndex) => (
                itemIndex === index
                    ? resetImportProductData(item)
                    : item
            ));

            return {
                ...prev,
                form: synchronizeImportFormCompletion({
                    ...prev.form,
                    items: nextItems,
                }),
            };
        });
    };

    const appendImportProductFromQuickSearch = (product) => {
        if (!product?.id) {
            return { accepted: false };
        }

        const currentModal = importModalStateRef.current;
        const duplicateSelection = findImportDuplicateSelection(currentModal.form.items, product.id);
        if (duplicateSelection) {
            return notifyDuplicateImportProduct(duplicateSelection, product);
        }

        let targetIndex = currentModal.form.items.findIndex((item) => !item.product_id);
        let nextItems = [...currentModal.form.items];

        if (targetIndex < 0) {
            targetIndex = nextItems.length;
            nextItems.push(createLine({
                update_supplier_price: Boolean(currentModal.form.update_supplier_prices),
            }));
        }

        nextItems = nextItems.map((item, itemIndex) => (
            itemIndex === targetIndex
                ? applyImportProductData(item, product)
                : item
        ));

        const nextState = {
            ...currentModal,
            form: synchronizeImportFormCompletion({
                ...currentModal.form,
                items: product.inventory_import_starred ? sortImportItemsByStarPriority(nextItems) : nextItems,
            }),
        };

        importModalStateRef.current = nextState;
        setImportModal(nextState);

        return { accepted: true };
    };

    const fetchInventoryUnits = async () => {
        try {
            const response = await inventoryApi.getUnits();
            setInventoryUnits(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            fail(error, 'Không thể tải danh sách đơn vị tính.');
        }
    };

    const openProductDailyOutboundDrawer = (product) => {
        if (!product?.id) return;
        setDailyOutboundDrawer({ open: true, product });
    };

    const closeProductDailyOutboundDrawer = () => {
        setDailyOutboundDrawer({ open: false, product: null });
    };

    const persistProductSearchHistory = (items) => {
        const normalizedItems = normalizeProductSearchHistoryItems(items);
        setProductSearchHistory(normalizedItems);
        writeProductSearchHistory(normalizedItems);
        return normalizedItems;
    };
    const rememberProductSearch = (value) => {
        const normalizedValue = normalizeProductSearchHistoryItem(value);
        if (normalizedValue.length < 2) return [];

        let normalizedItems = [];
        setProductSearchHistory((prev) => {
            normalizedItems = normalizeProductSearchHistoryItems([
                normalizedValue,
                ...prev.filter((item) => normalizeSearchText(item) !== normalizeSearchText(normalizedValue)),
            ]);
            writeProductSearchHistory(normalizedItems);
            return normalizedItems;
        });
        return normalizedItems;
    };

    const fetchProducts = async (
        page = 1,
        perPage = pageSizes.products,
        sortOverride = null,
        filtersOverride = productFilters,
        options = {},
    ) => {
        const includeSummary = options.includeSummary ?? true;
        const requestSequence = productRequestSequenceRef.current + 1;
        productRequestSequenceRef.current = requestSequence;
        if (productRequestControllerRef.current) {
            productRequestControllerRef.current.abort();
        }
        const controller = new AbortController();
        productRequestControllerRef.current = controller;
        setFlag('products', true);
        try {
            const response = await inventoryApi.getProducts({
                ...filtersOverride,
                page,
                per_page: perPage,
                without_summary: includeSummary ? undefined : 1,
                ...buildSortParams('products', sortOverride),
            }, controller.signal);
            if (controller.signal.aborted || productRequestSequenceRef.current !== requestSequence) {
                return;
            }
            setProducts(response.data.data || []);
            setProductSummary(includeSummary ? (response.data.summary || null) : null);
            rememberProductSearch(filtersOverride?.search);
            pageState(setProductPagination, response);
        } catch (error) {
            if (isCanceledRequest(error)) return;
            fail(error, 'Không thể tải sản phẩm kho.');
        } finally {
            if (productRequestSequenceRef.current === requestSequence) {
                if (productRequestControllerRef.current === controller) {
                    productRequestControllerRef.current = null;
                }
                setFlag('products', false);
            }
        }
    };

    const fetchSuppliers = async (page = 1, perPage = pageSizes.suppliers, sortOverride = null, filtersOverride = supplierFilters) => {
        setFlag('suppliers', true);
        try {
            const response = await inventoryApi.getSuppliers({ ...filtersOverride, page, per_page: perPage, ...buildSortParams('suppliers', sortOverride) });
            const rows = response.data.data || [];
            setSuppliers(rows);
            setSupplierSummary(response.data.summary || null);
            pageState(setSupplierPagination, response);
            setSelectedSupplierId((prev) => {
                if (prev === ALL_SUPPLIER_CATALOG_VALUE) {
                    return prev;
                }
                return rows.some((item) => item.id === prev) ? prev : (rows[0]?.id || null);
            });
        } catch (error) {
            fail(error, 'Không thể tải nhà cung cấp.');
        } finally {
            setFlag('suppliers', false);
        }
    };

    const fetchSupplierCatalog = async (
        page = 1,
        perPage = pageSizes.supplierPrices,
        sortOverride = null,
        filtersOverride = supplierCatalogFilters,
        searchOverride = supplierQuickSearch
    ) => {
        setFlag('supplierCatalog', true);
        try {
            const normalizedFilters = {
                ...filtersOverride,
                supplier_ids: normalizeSupplierFilterIds(filtersOverride?.supplier_ids),
            };
            const response = await inventoryApi.getSupplierPrices(selectedSupplierCatalogApiId, {
                ...normalizedFilters,
                search: String(searchOverride || '').trim(),
                page,
                per_page: perPage,
                ...buildSortParams('supplierPrices', sortOverride),
            });
            setSupplierCatalog((response.data.data || []).map((item) => mapSupplierCatalogEntry(item)));
            pageState(setSupplierCatalogPagination, response);
        } catch (error) {
            fail(error, 'Không thể tải bảng giá nhà cung cấp.');
        } finally {
            setFlag('supplierCatalog', false);
        }
    };

    const fetchImportStatuses = async () => {
        setFlag('importStatuses', true);
        try {
            const response = await inventoryApi.getImportStatuses({ active_only: 0 });
            const statuses = deduplicateImportStatuses(Array.isArray(response.data) ? response.data : []);
            setImportStatuses(statuses);
            return statuses;
        } catch (error) {
            fail(error, 'Không thể tải trạng thái phiếu nhập.');
            return [];
        } finally {
            setFlag('importStatuses', false);
        }
    };

    const refreshSupplierCatalog = async () => {
        if (!hasSupplierCatalogSelection) return;
        setPriceDrafts({});
        setCodeDrafts({});
        setGroupPriceDrafts({});
        await fetchSupplierCatalog(supplierCatalogPagination.current_page || 1, pageSizes.supplierPrices);
    };

    const fetchSimple = async (key, apiCall, setter, paginationSetter, page = 1, perPage = pageSizes[key] || 20) => {
        setFlag(key, true);
        try {
            const response = await apiCall(page, perPage);
            setter(response.data.data || []);
            pageState(paginationSetter, response);
        } catch (error) {
            fail(error, 'Không thể tải dữ liệu kho.');
        } finally {
            setFlag(key, false);
        }
    };

    const fetchImports = (page = 1, perPage = pageSizes.imports, sortOverride = null, filtersOverride = simpleFilters.imports) => fetchSimple('imports', (currentPage, currentPerPage) => inventoryApi.getImports({ ...filtersOverride, page: currentPage, per_page: currentPerPage, ...buildSortParams('imports', sortOverride) }), setImports, setImportPagination, page, perPage);
    const fetchExports = (page = 1, perPage = pageSizes.exports, sortOverride = null, filtersOverride = simpleFilters.exports) => fetchSimple('exports', (currentPage, currentPerPage) => inventoryApi.getExports({ ...filtersOverride, page: currentPage, per_page: currentPerPage, ...buildSortParams('exports', sortOverride) }), setExportsData, setExportPagination, page, perPage);
    const fetchDocuments = (type, page = 1, perPage = pageSizes[{ return: 'returns', damaged: 'damaged', adjustment: 'adjustments' }[type]], sortOverride = null, filtersOverride = simpleFilters[{ return: 'returns', damaged: 'damaged', adjustment: 'adjustments' }[type]]) => {
        const map = { return: ['returns', setReturnsData, setReturnPagination], damaged: ['damaged', setDamagedData, setDamagedPagination], adjustment: ['adjustments', setAdjustments, setAdjustmentPagination] };
        const [key, setter, paginationSetter] = map[type];
        return fetchSimple(key, (currentPage, currentPerPage) => inventoryApi.getDocuments(type, { ...filtersOverride, page: currentPage, per_page: currentPerPage, ...buildSortParams(key, sortOverride) }), setter, paginationSetter, page, perPage);
    };
    const fetchLots = (page = 1, perPage = pageSizes.lots, sortOverride = null, filtersOverride = simpleFilters.lots) => fetchSimple('lots', (currentPage, currentPerPage) => inventoryApi.getBatches({ ...filtersOverride, page: currentPage, per_page: currentPerPage, remaining_only: 1, ...buildSortParams('lots', sortOverride) }), setLots, setLotPagination, page, perPage);
    const fetchTrash = (page = 1, perPage = pageSizes.trash, sortOverride = null, filtersOverride = simpleFilters.trash) => fetchSimple('trash', (currentPage, currentPerPage) => inventoryApi.getTrashSlips({ ...filtersOverride, page: currentPage, per_page: currentPerPage, ...buildSortParams('trash', sortOverride) }), setTrashItems, setTrashPagination, page, perPage);
    const handleTableSort = (section, columnId) => {
        const next = nextSortConfig(sortConfigs[section], columnId);
        setSortConfigs((prev) => ({ ...prev, [section]: next }));

        if (section === 'products') return fetchProducts(1, pageSizes.products, next);
        if (section === 'suppliers') return fetchSuppliers(1, pageSizes.suppliers, next);
        if (section === 'supplierPrices') return fetchSupplierCatalog(1, pageSizes.supplierPrices, next);
        if (section === 'imports') return fetchImports(1, pageSizes.imports, next);
        if (section === 'exports') return fetchExports(1, pageSizes.exports, next);
        if (section === 'returns') return fetchDocuments('return', 1, pageSizes.returns, next);
        if (section === 'damaged') return fetchDocuments('damaged', 1, pageSizes.damaged, next);
        if (section === 'adjustments') return fetchDocuments('adjustment', 1, pageSizes.adjustments, next);
        if (section === 'lots') return fetchLots(1, pageSizes.lots, next);
        if (section === 'trash') return fetchTrash(1, pageSizes.trash, next);
        return undefined;
    };

    const fetchSimpleTabByKey = (tabKey, page = 1, perPage = pageSizes[tabKey], sortOverride = null, filtersOverride = simpleFilters[tabKey]) => {
        if (tabKey === 'imports') return fetchImports(page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'exports') return fetchExports(page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'returns') return fetchDocuments('return', page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'damaged') return fetchDocuments('damaged', page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'adjustments') return fetchDocuments('adjustment', page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'lots') return fetchLots(page, perPage, sortOverride, filtersOverride);
        if (tabKey === 'trash') return fetchTrash(page, perPage, sortOverride, filtersOverride);
        return undefined;
    };
    const refreshSlipTab = async (tabKey) => {
        if (tabKey === 'imports') return fetchImports(importPagination.current_page || 1, pageSizes.imports, sortConfigs.imports, simpleFilters.imports);
        if (tabKey === 'exports') return fetchExports(exportPagination.current_page || 1, pageSizes.exports, sortConfigs.exports, simpleFilters.exports);
        if (tabKey === 'returns') return fetchDocuments('return', returnPagination.current_page || 1, pageSizes.returns, sortConfigs.returns, simpleFilters.returns);
        if (tabKey === 'damaged') return fetchDocuments('damaged', damagedPagination.current_page || 1, pageSizes.damaged, sortConfigs.damaged, simpleFilters.damaged);
        if (tabKey === 'adjustments') return fetchDocuments('adjustment', adjustmentPagination.current_page || 1, pageSizes.adjustments, sortConfigs.adjustments, simpleFilters.adjustments);
        if (tabKey === 'trash') return fetchTrash(trashPagination.current_page || 1, pageSizes.trash, sortConfigs.trash, simpleFilters.trash);
        return undefined;
    };
    const refreshInventoryCoreViews = async (extraTabs = []) => {
        const requestedTabs = Array.from(new Set(extraTabs.filter(Boolean)));
        await Promise.all([
            ...requestedTabs.map((tabKey) => refreshSlipTab(tabKey)),
            fetchProducts(productPagination.current_page || 1, pageSizes.products, sortConfigs.products, productFilters),
            fetchLots(lotPagination.current_page || 1, pageSizes.lots, sortConfigs.lots, simpleFilters.lots),
        ]);
    };
    const getRelatedSlipTabs = (tabKey) => {
        if (tabKey === 'returns') return ['returns', 'adjustments'];
        if (tabKey === 'adjustments') return ['adjustments', 'returns'];
        return [tabKey];
    };
    const getRefreshTabsAfterSoftDelete = (tabKey) => Array.from(new Set([...getRelatedSlipTabs(tabKey), 'trash']));
    const getRefreshTabsAfterTrashRestore = (row) => Array.from(new Set([...getRelatedSlipTabs(row?.section_key), 'trash']));

    const productCategoryFilterOptions = useMemo(
        () => [
            { value: 'uncategorized', label: 'Chưa gắn danh mục' },
            ...categories.map((category) => ({ value: String(category.id), label: category.name })),
        ],
        [categories]
    );
    const importQuickAttributeOptions = useMemo(
        () => buildImportQuickFilterAttributes(allAttributes),
        [allAttributes]
    );
    const getCategoryNameById = (categoryId) => categories.find((category) => String(category.id) === String(categoryId))?.name || (String(categoryId) === 'uncategorized' ? 'Chưa gắn danh mục' : String(categoryId || ''));
    const getImportStatusNameById = (statusId) => importStatuses.find((status) => String(status.id) === String(statusId))?.name || String(statusId || '');

    const resolveProductSortForFilters = (filters, currentSort = sortConfigs.products) => {
        const trackingEnabled = String(filters?.tracking_mode || '') === '1';
        if (trackingEnabled) return productTrackingSortConfig;
        if (currentSort?.key === productTrackingSortConfig.key) return emptySortConfig;
        return currentSort || emptySortConfig;
    };
    const updateProductFilterValue = (key, value, options = {}) => {
        const autoApply = options.autoApply ?? true;
        const nextFilters = normalizeProductFilters({ ...productFilters, [key]: value });
        setSelectedProductFilterPresetId('');
        if (key === 'search' || !autoApply) {
            setProductFilters(nextFilters);
            return;
        }
        applyProductFilters(nextFilters);
    };
    const persistProductFilterPresets = (nextPresets) => {
        const normalizedPresets = nextPresets.map(normalizeProductFilterPreset).filter(Boolean);
        setProductFilterPresets(normalizedPresets);
        writeProductFilterPresets(normalizedPresets);
        return normalizedPresets;
    };
    const applyProductFilters = (nextFilters, sortOverride = sortConfigs.products, options = {}) => {
        const normalizedFilters = normalizeProductFilters(nextFilters);
        const nextSort = resolveProductSortForFilters(normalizedFilters, sortOverride);
        setProductFilters(normalizedFilters);
        productSearchSyncRef.current = normalizedFilters.search || '';
        if (!options.keepPresetSelection) {
            setSelectedProductFilterPresetId('');
        }
        setSortConfigs((prev) => ({ ...prev, products: nextSort }));
        fetchProducts(1, pageSizes.products, nextSort, normalizedFilters);
    };
    const applyProductSearchHistoryItem = (value) => {
        const normalizedValue = normalizeProductSearchHistoryItem(value);
        if (!normalizedValue) return;

        setProductSearchHistoryOpen(false);
        rememberProductSearch(normalizedValue);
        applyProductFilters({
            ...productFilters,
            search: normalizedValue,
        });
    };
    const removeProductSearchHistoryItem = (value, event = null) => {
        event?.preventDefault();
        event?.stopPropagation();
        persistProductSearchHistory(productSearchHistory.filter((item) => normalizeSearchText(item) !== normalizeSearchText(value)));
    };
    const clearProductSearchHistory = () => {
        persistProductSearchHistory([]);
        setProductSearchHistoryOpen(false);
    };
    const clearProductQuickSearch = () => {
        setProductSearchHistoryOpen(false);
        applyProductFilters({
            ...productFilters,
            search: '',
        });
    };
    const productQuickFilterActive = productFilters.import_starred === '1';
    const toggleProductImportQuickFilter = () => {
        applyProductFilters({
            ...productFilters,
            import_starred: productQuickFilterActive ? '' : '1',
        });
    };
    const toggleProductTrackingMode = () => {
        const enabled = String(productFilters.tracking_mode || '') === '1';
        applyProductFilters({
            ...productFilters,
            tracking_mode: enabled ? '' : '1',
            tracking_daily_min: productFilters.tracking_daily_min || defaultProductFilters.tracking_daily_min,
        }, enabled ? sortConfigs.products : productTrackingSortConfig);
    };
    const toggleProductDeclarationMode = () => {
        setProductDeclarationModeActive((currentValue) => {
            const nextValue = !currentValue;
            if (nextValue) {
                showToast({ type: 'info', message: 'Bấm dòng sản phẩm hoặc nút sao để lưu/bỏ lọc nhanh.' });
            }
            return nextValue;
        });
    };
    const toggleInventoryProductImportStar = async (row) => {
        const productId = Number(row?.id || 0);
        if (!productId) return null;

        const nextStarred = !Boolean(row?.inventory_import_starred);
        const updatedProduct = await toggleImportProductStar(row, nextStarred);
        const resolvedStarred = Boolean(updatedProduct?.inventory_import_starred ?? nextStarred);

        if (productQuickFilterActive && !resolvedStarred) {
            await fetchProducts(
                productPagination.current_page || 1,
                pageSizes.products,
                sortConfigs.products,
                productFilters
            );
        }

        return updatedProduct;
    };
    const clearProductFilter = (key) => {
        const nextFilters = normalizeProductFilters({ ...productFilters, [key]: createDefaultProductFilters()[key] ?? '' });
        applyProductFilters(nextFilters);
    };
    const clearAllProductFilters = () => {
        const nextFilters = createDefaultProductFilters();
        applyProductFilters(nextFilters);
    };
    const saveCurrentProductFilterPreset = ({ onlySelectedProducts = false } = {}) => {
        const selectedPresetProductIds = Array.from(new Set(
            selectedProductRows
                .map((row) => String(row?.id || '').trim())
                .filter((id) => Number.isFinite(Number(id)) && Number(id) > 0)
        ));

        if (onlySelectedProducts && selectedPresetProductIds.length === 0) {
            showToast({ type: 'warning', message: 'Hãy tick các mã muốn lưu trước.' });
            return null;
        }

        const normalizedFilters = normalizeProductFilters({
            ...productFilters,
            ids: onlySelectedProducts ? selectedPresetProductIds : productFilters.ids,
        });
        const activeParts = [
            onlySelectedProducts ? `${selectedPresetProductIds.length} mã đã chọn` : '',
            ...productFilterChips.map((chip) => `${chip.label} ${chip.value}`),
        ].filter(Boolean).slice(0, 3);
        const suggestedName = activeParts.length ? activeParts.join(' + ') : 'Tìm kiếm tồn kho';
        const name = window.prompt('Đặt tên tìm kiếm đã lưu', suggestedName);
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;

        const preset = {
            id: createProductFilterPresetId(),
            name: normalizedName,
            filters: normalizedFilters,
            saved_at: new Date().toISOString(),
        };
        const nextPresets = persistProductFilterPresets([
            preset,
            ...productFilterPresets.filter((item) => item.name !== normalizedName),
        ].slice(0, 40));

        setSelectedProductFilterPresetId(preset.id);
        if (onlySelectedProducts) {
            setSelectedProductRowsById({});
            applyProductFilters(normalizedFilters, sortConfigs.products, { keepPresetSelection: true });
        }
        showToast({ type: 'success', message: `Đã lưu tìm kiếm "${normalizedName}".` });
        return nextPresets;
    };
    const applyProductFilterPreset = (presetId) => {
        const preset = productFilterPresets.find((item) => item.id === presetId);
        if (!preset) return;

        setSelectedProductFilterPresetId(preset.id);
        setSelectedProductRowsById({});
        applyProductFilters(preset.filters, sortConfigs.products, { keepPresetSelection: true });
    };
    const renameSelectedProductFilterPreset = (presetId = selectedProductFilterPresetId) => {
        const preset = productFilterPresets.find((item) => item.id === presetId);
        if (!preset) return;

        const name = window.prompt('Sửa tên tìm kiếm đã lưu', preset.name);
        const normalizedName = String(name || '').trim();
        if (!normalizedName || normalizedName === preset.name) return;

        const duplicatedPreset = productFilterPresets.find((item) => item.id !== preset.id && item.name === normalizedName);
        if (duplicatedPreset) {
            showToast({ type: 'warning', message: 'Tên này đã tồn tại, hãy chọn tên khác.' });
            return;
        }

        persistProductFilterPresets(productFilterPresets.map((item) => (
            item.id === preset.id
                ? { ...item, name: normalizedName, saved_at: new Date().toISOString() }
                : item
        )));
        setSelectedProductFilterPresetId(preset.id);
        showToast({ type: 'success', message: `Đã đổi tên thành "${normalizedName}".` });
    };
    const deleteSelectedProductFilterPreset = (presetId = selectedProductFilterPresetId) => {
        const preset = productFilterPresets.find((item) => item.id === presetId);
        if (!preset) return;

        const confirmed = window.confirm(`Xóa tìm kiếm "${preset.name}"?`);
        if (!confirmed) return;

        persistProductFilterPresets(productFilterPresets.filter((item) => item.id !== preset.id));
        if (selectedProductFilterPresetId === preset.id) {
            setSelectedProductFilterPresetId('');
        }
        showToast({ type: 'success', message: 'Đã xóa tìm kiếm đã lưu.' });
    };

    const clearSupplierFilter = (key) => {
        const nextFilters = { ...supplierFilters, [key]: defaultSupplierFilters[key] ?? '' };
        setSupplierFilters(nextFilters);
        if (key === 'search') {
            supplierSearchSyncRef.current = nextFilters.search;
            fetchSuppliers(1, pageSizes.suppliers, null, nextFilters);
            return;
        }
        fetchSuppliers(1, pageSizes.suppliers, null, nextFilters);
    };
    const clearAllSupplierFilters = () => {
        const nextFilters = { ...defaultSupplierFilters };
        supplierSearchSyncRef.current = nextFilters.search;
        setSupplierFilters(nextFilters);
        fetchSuppliers(1, pageSizes.suppliers, null, nextFilters);
    };

    const clearSupplierCatalogFilter = (key) => {
        const nextFilters = { ...supplierCatalogFilters, [key]: defaultSupplierCatalogFilters[key] ?? '' };
        setSupplierCatalogFilters(nextFilters);
        if (key === 'supplier_ids') return;
        if (key === 'sku' || key === 'name') {
            supplierCatalogSearchSyncRef.current = {
                search: supplierQuickSearch,
                sku: nextFilters.sku,
                name: nextFilters.name,
            };
        }
        fetchSupplierCatalog(1, pageSizes.supplierPrices, null, nextFilters, supplierQuickSearch);
    };
    const clearSupplierQuickSearchFilter = () => {
        supplierCatalogSearchSyncRef.current = {
            search: '',
            sku: supplierCatalogFilters.sku,
            name: supplierCatalogFilters.name,
        };
        setSupplierQuickSearch('');
        fetchSupplierCatalog(1, pageSizes.supplierPrices, null, supplierCatalogFilters, '');
    };
    const clearAllSupplierCatalogFilters = () => {
        const nextFilters = { ...defaultSupplierCatalogFilters };
        supplierCatalogSearchSyncRef.current = { search: '', sku: '', name: '' };
        setSupplierQuickSearch('');
        setSupplierCatalogFilters(nextFilters);
        fetchSupplierCatalog(1, pageSizes.supplierPrices, null, nextFilters, '');
    };

    const clearSimpleFilter = (tabKey, key) => {
        const baseFilters = createDefaultSimpleFilters()[tabKey] || {};
        const nextFilters = { ...simpleFilters[tabKey], [key]: baseFilters[key] ?? '' };
        if (key === 'search') {
            simpleSearchSyncRef.current[tabKey] = nextFilters.search;
        }
        setSimpleFilters((prev) => ({ ...prev, [tabKey]: nextFilters }));
        fetchSimpleTabByKey(tabKey, 1, pageSizes[tabKey], null, nextFilters);
    };
    const clearAllSimpleFilters = (tabKey) => {
        const nextFilters = { ...(createDefaultSimpleFilters()[tabKey] || {}) };
        simpleSearchSyncRef.current[tabKey] = nextFilters.search || '';
        setSimpleFilters((prev) => ({ ...prev, [tabKey]: nextFilters }));
        fetchSimpleTabByKey(tabKey, 1, pageSizes[tabKey], null, nextFilters);
    };

    useEffect(() => () => {
        if (productCopyFeedbackTimeoutRef.current) {
            window.clearTimeout(productCopyFeedbackTimeoutRef.current);
        }
    }, []);

    const productFilterChips = [
        buildFilterChip('products_search', 'Tìm kiếm', productFilters.search, () => clearProductFilter('search')),
        buildFilterChip('products_ids', 'Mã trong tìm kiếm', normalizeStringFilterList(productFilters.ids).length ? `${normalizeStringFilterList(productFilters.ids).length} mã` : '', () => clearProductFilter('ids')),
        buildFilterChip('products_status', 'Trạng thái bán', summarizeOptionLabels(productStatusFilterOptions, productFilters.status), () => clearProductFilter('status')),
        buildFilterChip('products_cost_source', 'Trạng thái giá', summarizeOptionLabels(productCostSourceFilterOptions, productFilters.cost_source), () => clearProductFilter('cost_source')),
        buildFilterChip('products_stock_alert', 'Cảnh báo tồn', summarizeOptionLabels(productStockAlertFilterOptions, productFilters.stock_alert), () => clearProductFilter('stock_alert')),
        buildFilterChip('products_type', 'Loại sản phẩm', summarizeOptionLabels(productTypeFilterOptions, productFilters.type), () => clearProductFilter('type')),
        buildFilterChip('products_category', 'Danh mục', summarizeOptionLabels(productCategoryFilterOptions, productFilters.category_id), () => clearProductFilter('category_id')),
        buildFilterChip('products_variant_scope', 'Biến thể', summarizeOptionLabels(productVariantScopeFilterOptions, productFilters.variant_scope), () => clearProductFilter('variant_scope')),
        buildFilterChip('products_import_starred', 'Lọc nhanh', productFilters.import_starred === '1' ? 'Đã khai báo' : '', () => clearProductFilter('import_starred')),
        buildFilterChip('products_tracking_mode', 'Theo dõi nhập', productFilters.tracking_mode === '1' ? `Mã đi ${INVENTORY_TRACKING_WINDOW_DAYS} ngày` : '', () => clearProductFilter('tracking_mode')),
        buildFilterChip('products_tracking_daily_min', 'TB/ngày từ', productFilters.tracking_mode === '1' ? (productFilters.tracking_daily_min || defaultProductFilters.tracking_daily_min) : '', () => clearProductFilter('tracking_daily_min')),
        buildFilterChip('products_date_from', 'Từ ngày', productFilters.date_from ? formatPrintDate(productFilters.date_from) : '', () => clearProductFilter('date_from')),
        buildFilterChip('products_date_to', 'Đến ngày', productFilters.date_to ? formatPrintDate(productFilters.date_to) : '', () => clearProductFilter('date_to')),
    ].filter(Boolean);

    const supplierFilterChips = [
        buildFilterChip('suppliers_search', 'Tìm kiếm', supplierFilters.search, () => clearSupplierFilter('search')),
        buildFilterChip('suppliers_status', 'Trạng thái', supplierFilters.status ? filterOptionLabel(supplierStatusFilterOptions, supplierFilters.status) : '', () => clearSupplierFilter('status')),
        buildFilterChip('suppliers_month', 'Tháng', supplierFilters.month ? formatMonthFilterValue(supplierFilters.month) : '', () => clearSupplierFilter('month')),
        buildFilterChip('suppliers_date_from', 'Từ ngày', supplierFilters.date_from ? formatPrintDate(supplierFilters.date_from) : '', () => clearSupplierFilter('date_from')),
        buildFilterChip('suppliers_date_to', 'Đến ngày', supplierFilters.date_to ? formatPrintDate(supplierFilters.date_to) : '', () => clearSupplierFilter('date_to')),
    ].filter(Boolean);

    const supplierCatalogFilterChips = [
        buildFilterChip('supplier_prices_search', 'Tìm nhanh', supplierQuickSearch, clearSupplierQuickSearchFilter),
        buildFilterChip(
            'supplier_prices_suppliers',
            'Nhà cung cấp',
            selectedSupplierCatalogSummary,
            () => clearSupplierCatalogFilter('supplier_ids')
        ),
        buildFilterChip('supplier_prices_sku', 'Mã SP / Mã NCC', supplierCatalogFilters.sku, () => clearSupplierCatalogFilter('sku')),
        buildFilterChip('supplier_prices_name', 'Tên sản phẩm', supplierCatalogFilters.name, () => clearSupplierCatalogFilter('name')),
        buildFilterChip('supplier_prices_category', 'Danh mục', supplierCatalogFilters.category_id ? getCategoryNameById(supplierCatalogFilters.category_id) : '', () => clearSupplierCatalogFilter('category_id')),
        buildFilterChip('supplier_prices_type', 'Loại sản phẩm', supplierCatalogFilters.type ? filterOptionLabel(productTypeFilterOptions, supplierCatalogFilters.type) : '', () => clearSupplierCatalogFilter('type')),
        buildFilterChip('supplier_prices_variant_scope', 'Biến thể', supplierCatalogFilters.variant_scope ? filterOptionLabel(supplierCatalogVariantScopeFilterOptions, supplierCatalogFilters.variant_scope) : '', () => clearSupplierCatalogFilter('variant_scope')),
        buildFilterChip('supplier_prices_missing_price', 'Trạng thái giá', supplierCatalogFilters.missing_supplier_price === '1' ? 'Chưa có giá nhập' : '', () => clearSupplierCatalogFilter('missing_supplier_price')),
        buildFilterChip('supplier_prices_multiple_suppliers', 'Nguồn nhập', supplierCatalogFilters.multiple_suppliers === '1' ? 'Có nhiều nhà cung cấp' : '', () => clearSupplierCatalogFilter('multiple_suppliers')),
    ].filter(Boolean);

    useEffect(() => {
        if (!sectionSlug) {
            navigate(buildInventoryPath(DEFAULT_INVENTORY_SECTION_KEY), {
                replace: true,
                state: location.state,
            });
            return;
        }

        if (!resolvedRouteSection) {
            navigate(buildInventoryPath(DEFAULT_INVENTORY_SECTION_KEY), { replace: true });
            return;
        }

        setActiveTab((prev) => (prev === resolvedRouteSection ? prev : resolvedRouteSection));
    }, [location.state, navigate, resolvedRouteSection, sectionSlug]);

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const response = await categoryApi.getAll();
                setCategories(Array.isArray(response.data) ? response.data : (response.data?.data || []));
            } catch (error) {
                fail(error, 'Không thể tải danh mục.');
            }
        };
        const loadAttributes = async () => {
            try {
                const [attributeResponse, orderBootstrapResponse] = await Promise.all([
                    attributeApi.getAll({ entity_type: 'product', active_only: true }).catch(() => null),
                    orderApi.getBootstrapCached({ mode: 'form' }).catch(() => null),
                ]);
                const directAttributes = Array.isArray(attributeResponse?.data)
                    ? attributeResponse.data
                    : (attributeResponse?.data?.data || []);
                const bootstrapAttributes = Array.isArray(orderBootstrapResponse?.data?.product_attributes)
                    ? orderBootstrapResponse.data.product_attributes
                    : [];

                setAllAttributes(mergeImportQuickFilterAttributes(bootstrapAttributes, directAttributes));
            } catch (error) {
                fail(error, 'Không thể tải thuộc tính sản phẩm.');
            }
        };

        loadCategories();
        loadAttributes();
        fetchInventoryUnits();
        fetchImportStatuses();
    }, []);

    useEffect(() => {
        importModalOpenRef.current = importModal.open;
    }, [importModal.open]);

    useEffect(() => {
        importModalStateRef.current = importModal;
    }, [importModal]);

    useEffect(() => () => {
        if (importDuplicateFocusTimeoutRef.current) {
            clearTimeout(importDuplicateFocusTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        if (restoredImportDraftRef.current) return undefined;
        if (resolvedRouteSection !== 'imports') return undefined;

        const draft = readPersistedImportDraft();
        restoredImportDraftRef.current = true;
        if (!draft?.form) return undefined;

        let active = true;
        const restoreDraft = async () => {
            goToTab('imports', { replace: location.pathname !== buildInventoryPath('imports') });

            await ensureSuppliersLoaded();
            await fetchInventoryUnits();
            if (!importStatuses.length) {
                await fetchImportStatuses();
            }

            if (!active || importModalOpenRef.current) return;

            setImportTableSettingsOpen(Boolean(draft.importTableSettingsOpen));
            setImportTableExpanded(Boolean(draft.importTableExpanded));
            setImportCompleteToggleSnapshot(
                draft.importCompleteToggleSnapshot
                    ? {
                        inventory_import_status_id: draft.importCompleteToggleSnapshot.inventory_import_status_id || '',
                        status_is_manual: Boolean(draft.importCompleteToggleSnapshot.status_is_manual),
                        items: normalizePersistedImportDraftItems(draft.importCompleteToggleSnapshot.items),
                    }
                    : null
            );
            setImportStarLoadingProductIds([]);
            const restoredForm = synchronizeImportFormCompletion(restorePersistedImportForm(draft.form));
            setImportModal({
                open: true,
                form: restoredForm,
            });

            showToast({
                type: draft.had_local_attachment_files ? 'warning' : 'success',
                message: draft.had_local_attachment_files
                    ? 'Đã khôi phục phiếu nhập đang làm dở. Tệp đính kèm chưa tải lên cần chọn lại.'
                    : 'Đã khôi phục phiếu nhập đang làm dở.',
            });

            const duplicateSelection = findFirstDuplicateImportProductSelection(restoredForm.items);
            if (duplicateSelection) {
                notifyDuplicateImportProduct(duplicateSelection);
            }
        };

        void restoreDraft();
        return () => {
            active = false;
        };
    }, [resolvedRouteSection]);

    useEffect(() => {
        const returnContext = location.state?.returnContext;
        if (!returnContext || restoredSupplierContextRef.current || returnContext.source !== 'inventorySupplierPrices') {
            return;
        }

        restoredSupplierContextRef.current = true;
        skipSupplierSearchResetRef.current = true;
        goToTab(returnContext.activeTab || 'supplierPrices');
        setSupplierQuickSearch(returnContext.supplierQuickSearch || '');
        setSupplierCatalogFilters((prev) => ({
            ...prev,
            ...(returnContext.supplierCatalogFilters || {}),
            supplier_ids: normalizeSupplierFilterIds(
                returnContext.supplierCatalogFilters?.supplier_ids
                    ?? (
                        returnContext.selectedSupplierId
                        && returnContext.selectedSupplierId !== ALL_SUPPLIER_CATALOG_VALUE
                            ? [returnContext.selectedSupplierId]
                            : []
                    )
            ),
        }));
        if (returnContext.supplierPanels) {
            setOpenPanels((prev) => ({
                ...prev,
                supplierPrices: {
                    ...prev.supplierPrices,
                    ...returnContext.supplierPanels,
                },
            }));
        }
        if (returnContext.supplierSortConfig) {
            setSortConfigs((prev) => ({
                ...prev,
                supplierPrices: returnContext.supplierSortConfig,
            }));
        }
        if (returnContext.supplierCatalogPerPage) {
            const restoredPerPage = pageSizeOptions.includes(Number(returnContext.supplierCatalogPerPage))
                ? Number(returnContext.supplierCatalogPerPage)
                : pageSizes.supplierPrices;
            setPageSizes((prev) => ({
                ...prev,
                supplierPrices: restoredPerPage,
            }));
            localStorage.setItem('inventory_page_size_supplierPrices', String(restoredPerPage));
            setSupplierCatalogPagination((prev) => ({
                ...prev,
                current_page: Number(returnContext.supplierCatalogPage || 1),
                per_page: restoredPerPage,
            }));
        } else if (returnContext.supplierCatalogPage) {
            setSupplierCatalogPagination((prev) => ({
                ...prev,
                current_page: Number(returnContext.supplierCatalogPage || 1),
            }));
        }

        navigate(location.pathname, { replace: true, state: null });
    }, [location.pathname, location.state, navigate, pageSizes.supplierPrices]);

    useEffect(() => {
        if (activeTab === 'products') fetchProducts(productPagination.current_page || 1);
        if (activeTab === 'suppliers') fetchSuppliers(supplierPagination.current_page || 1);
        if (activeTab === 'supplierPrices') ensureSuppliersLoaded();
        if (activeTab === 'imports') fetchImports(importPagination.current_page || 1);
        if (activeTab === 'exports') fetchExports(exportPagination.current_page || 1);
        if (activeTab === 'returns') fetchDocuments('return', returnPagination.current_page || 1);
        if (activeTab === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
        if (activeTab === 'adjustments') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
        if (activeTab === 'lots') fetchLots(lotPagination.current_page || 1);
        if (activeTab === 'trash') fetchTrash(trashPagination.current_page || 1);
    }, [activeTab]);

    useEffect(() => () => {
        productRequestControllerRef.current?.abort();
        productRequestControllerRef.current = null;
    }, []);

    useEffect(() => {
        if (!productSearchHistoryOpen) return undefined;

        const handleOutsideClick = (event) => {
            if (!productSearchContainerRef.current?.contains(event.target)) {
                setProductSearchHistoryOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [productSearchHistoryOpen]);

    useEffect(() => {
        if (activeTab !== 'supplierPrices') return;
        fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
    }, [activeTab, supplierCatalogSelectionKey]);

    useEffect(() => {
        if (!importModal.open) return;
        if (importModal.form.inventory_import_status_id || importStatuses.length === 0) return;
        const fallbackStatus = importModal.form.auto_complete_import
            ? (getCompletedImportStatus() || getDefaultImportStatus())
            : (getNewImportStatus() || getDefaultImportStatus());
        if (!fallbackStatus) return;
        setImportModal((prev) => ({
            ...prev,
            form: synchronizeImportFormCompletion({
                ...prev.form,
                inventory_import_status_id: String(fallbackStatus.id),
            }),
        }));
    }, [importModal.open, importModal.form.auto_complete_import, importModal.form.inventory_import_status_id, importStatuses]);

    useEffect(() => {
        if (!importModal.open || importModal.form.id || importModal.form.auto_complete_import || importModal.form.auto_complete_import_touched) return;
        if (!importStatuses.length) return;

        setImportModal((prev) => {
            if (!prev.open || prev.form.id || prev.form.auto_complete_import || prev.form.auto_complete_import_touched) {
                return prev;
            }

            return {
                ...prev,
                form: applyImportAutoCompleteMode({
                    ...prev.form,
                    auto_complete_import_touched: false,
                }, true),
            };
        });
    }, [importModal.open, importModal.form.auto_complete_import, importModal.form.auto_complete_import_touched, importModal.form.id, importStatuses]);

    useEffect(() => {
        if (!importModal.open) return;
        persistImportDraft(buildPersistableImportModalDraft({
            form: importModal.form,
            importTableExpanded,
            importTableSettingsOpen,
            importCompleteToggleSnapshot,
        }));
    }, [importCompleteToggleSnapshot, importModal, importTableExpanded, importTableSettingsOpen]);

    useEffect(() => {
        if (!importModal.open && importPrintSource.mode === 'modal') {
            closeImportPrintModal();
            return;
        }

        if (!importPrintSettingsLoaded && !importPrintSettingsLoading) {
            loadImportPrintTemplates({ silent: true });
        }
    }, [importModal.open, importPrintSettingsLoaded, importPrintSettingsLoading, importPrintSource.mode]);

    useEffect(() => {
        setSelectedPriceIds({});
        setPriceDrafts({});
        setCodeDrafts({});
        setSavingPriceIds({});
        setExpandedGroups({});
        setExpandedComparisons({});
        setGroupPriceDrafts({});
        setBulkPrice('');
        setBulkNote('');
        setPasteText('');
    }, [supplierCatalogSelectionKey]);

    useEffect(() => {
        if (activeTab !== 'products') return undefined;
        const currentSearch = productFilters.search ?? '';
        const previousSearch = productSearchSyncRef.current ?? '';
        if (currentSearch === previousSearch) return undefined;
        productSearchSyncRef.current = currentSearch;
        const timer = setTimeout(() => {
            const nextSort = resolveProductSortForFilters(productFilters, sortConfigs.products);
            fetchProducts(1, pageSizes.products, nextSort, productFilters);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, productFilters.search]);

    useEffect(() => {
        if (activeTab !== 'suppliers') return undefined;
        const currentSearch = supplierFilters.search ?? '';
        const previousSearch = supplierSearchSyncRef.current ?? '';
        if (currentSearch === previousSearch) return undefined;
        supplierSearchSyncRef.current = currentSearch;
        const timer = setTimeout(() => {
            fetchSuppliers(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, supplierFilters.search]);

    useEffect(() => {
        const searchableTabs = ['imports', 'exports', 'returns', 'damaged', 'adjustments', 'lots', 'trash'];
        if (!searchableTabs.includes(activeTab)) return undefined;

        const currentSearch = simpleFilters[activeTab]?.search ?? '';
        const previousSearch = simpleSearchSyncRef.current[activeTab] ?? '';
        if (currentSearch === previousSearch) return undefined;

        simpleSearchSyncRef.current[activeTab] = currentSearch;
        const timer = setTimeout(() => {
            if (activeTab === 'imports') fetchImports(1);
            else if (activeTab === 'exports') fetchExports(1);
            else if (activeTab === 'returns') fetchDocuments('return', 1);
            else if (activeTab === 'damaged') fetchDocuments('damaged', 1);
            else if (activeTab === 'adjustments') fetchDocuments('adjustment', 1);
            else if (activeTab === 'lots') fetchLots(1);
            else if (activeTab === 'trash') fetchTrash(1);
        }, 250);

        return () => clearTimeout(timer);
    }, [
        activeTab,
        simpleFilters.imports.search,
        simpleFilters.exports.search,
        simpleFilters.returns.search,
        simpleFilters.damaged.search,
        simpleFilters.adjustments.search,
        simpleFilters.lots.search,
        simpleFilters.trash.search,
    ]);

    useEffect(() => {
        if (activeTab !== 'supplierPrices' || !hasSupplierCatalogSelection) return undefined;
        const currentSearchState = {
            search: supplierQuickSearch,
            sku: supplierCatalogFilters.sku,
            name: supplierCatalogFilters.name,
        };
        if (skipSupplierSearchResetRef.current) {
            skipSupplierSearchResetRef.current = false;
            supplierCatalogSearchSyncRef.current = currentSearchState;
            return undefined;
        }
        const previousSearchState = supplierCatalogSearchSyncRef.current;
        if (
            currentSearchState.search === previousSearchState.search
            && currentSearchState.sku === previousSearchState.sku
            && currentSearchState.name === previousSearchState.name
        ) {
            return undefined;
        }
        supplierCatalogSearchSyncRef.current = currentSearchState;
        const timer = setTimeout(() => {
            fetchSupplierCatalog(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, hasSupplierCatalogSelection, supplierQuickSearch, supplierCatalogFilters.sku, supplierCatalogFilters.name]);

    const ensureSuppliersLoaded = async () => {
        if (suppliers.length > 0) {
            if (!selectedSupplierId && suppliers[0]?.id) setSelectedSupplierId(suppliers[0].id);
            return;
        }
        await fetchSuppliers(1);
    };

    const currentSupplier = useMemo(
        () => (typeof selectedSupplierId === 'number' && Number.isFinite(selectedSupplierId)
            ? (suppliers.find((item) => Number(item.id) === Number(selectedSupplierId)) || null)
            : null),
        [selectedSupplierId, suppliers]
    );
    const supplierCatalogScopeLabel = currentSupplierCatalog?.name
        || (hasSpecificSupplierSelection
            ? (selectedSupplierCatalogSummary || '1 NCC đã chọn')
            : (hasMultipleSupplierSelections ? selectedSupplierCatalogSummary : 'Tất cả'));
    const supplierCatalogTitle = hasSpecificSupplierSelection
        ? `Giá nhập - ${currentSupplierCatalog?.name || '1 nhà cung cấp'}`
        : (hasMultipleSupplierSelections
            ? `Giá nhập - ${selectedSupplierCatalogFilterIds.length} nhà cung cấp`
            : 'Giá nhập từng nhà');
    const supplierCatalogDescription = hasSpecificSupplierSelection
        ? 'Mỗi nhà cung cấp có một bảng giá nhập riêng. Khi tạo phiếu nhập, giá sẽ tự đổ từ bảng này và vẫn có thể sửa tay.'
        : (isAllSuppliersSelected
            ? 'Đang hiển thị toàn bộ sản phẩm, không lọc theo nhà cung cấp.'
            : 'Đang lọc theo nhiều nhà cung cấp theo logic OR. Muốn chỉnh giá hoặc mã NCC, hãy lọc đúng 1 nhà cung cấp.');

    const supplierCatalogItemRows = useMemo(() => {
        const rows = [];
        supplierCatalog.forEach((product) => {
            if (product.has_variants) {
                (product.variants || []).forEach((variant) => {
                    rows.push({
                        ...variant,
                        row_kind: 'item',
                        row_id: `variant_${variant.id}`,
                        group_name: product.name,
                        parent_group_id: product.id,
                    });
                });
            } else {
                rows.push({ ...product, row_kind: 'item', row_id: `item_${product.id}` });
            }
        });
        return rows;
    }, [supplierCatalog]);
    const duplicateSupplierCodeIds = useMemo(() => {
        const ids = new Set();
        const buckets = new Map();

        supplierCatalogItemRows.forEach((row) => {
            const key = normalizeSupplierCodeKey(codeDrafts[row.id] ?? row.supplier_product_code);
            if (!key) return;

            const currentIds = buckets.get(key) || [];
            currentIds.push(row.id);
            buckets.set(key, currentIds);
        });

        buckets.forEach((rowIds) => {
            if (rowIds.length < 2) return;
            rowIds.forEach((rowId) => ids.add(rowId));
        });

        return ids;
    }, [codeDrafts, supplierCatalogItemRows]);

    const supplierRows = useMemo(() => {
        const rows = [];
        const normalizedQuickSearch = normalizeSearchText(supplierQuickSearch);
        const matchesQuickSearch = (row, extraFields = []) => {
            if (!normalizedQuickSearch) return true;
            return [row?.sku, row?.supplier_product_code, row?.name, row?.parent_name, row?.parent_sku, ...extraFields]
                .some((value) => normalizeSearchText(value).includes(normalizedQuickSearch));
        };
        const appendComparisonRow = (row) => {
            if (!expandedComparisons[row.id]) return;
            rows.push({
                ...row,
                row_kind: 'comparison',
                row_id: `comparison_${row.id}`,
                comparison_items: row.supplier_price_comparisons || [],
            });
        };

        supplierCatalog.forEach((product) => {
            if (product.has_variants) {
                const variants = product.variants || [];
                const productMatches = matchesQuickSearch(product);
                const matchedVariants = normalizedQuickSearch
                    ? variants.filter((variant) => matchesQuickSearch(variant, [product.name, product.sku]))
                    : variants;
                if (!productMatches && normalizedQuickSearch && matchedVariants.length === 0) {
                    return;
                }

                rows.push({
                    ...product,
                    row_kind: 'group',
                    row_id: `group_${product.id}`,
                    visible_variant_count: productMatches ? variants.length : matchedVariants.length,
                });

                const shouldShowVariants = normalizedQuickSearch
                    ? (productMatches ? variants : matchedVariants)
                    : (expandedGroups[product.id] ? variants : []);

                shouldShowVariants.forEach((variant) => {
                    const variantRow = {
                        ...variant,
                        row_kind: 'item',
                        row_id: `variant_${variant.id}`,
                        group_name: product.name,
                        parent_group_id: product.id,
                    };
                    rows.push(variantRow);
                    appendComparisonRow(variantRow);
                });
            } else if (matchesQuickSearch(product)) {
                const itemRow = { ...product, row_kind: 'item', row_id: `item_${product.id}` };
                rows.push(itemRow);
                appendComparisonRow(itemRow);
            }
        });
        return rows;
    }, [expandedComparisons, expandedGroups, supplierCatalog, supplierQuickSearch]);

    const allSupplierItemIdSet = useMemo(
        () => new Set(supplierCatalogItemRows.map((row) => row.id)),
        [supplierCatalogItemRows]
    );
    const visibleSupplierItemIds = useMemo(
        () => supplierRows.filter((row) => row.row_kind === 'item').map((row) => row.id),
        [supplierRows]
    );
    const allVisibleSelected = visibleSupplierItemIds.length > 0 && visibleSupplierItemIds.every((id) => selectedPriceIds[id]);
    const someVisibleSelected = !allVisibleSelected && visibleSupplierItemIds.some((id) => selectedPriceIds[id]);

    useEffect(() => {
        const validItemIds = new Set(supplierCatalogItemRows.map((row) => String(row.id)));
        const validGroupIds = new Set(
            supplierCatalog.filter((product) => product.has_variants).map((product) => String(product.id))
        );
        const pruneStateMap = (prev, allowedIds) => {
            let changed = false;
            const next = Object.entries(prev).reduce((result, [key, value]) => {
                if (allowedIds.has(String(key))) {
                    result[key] = value;
                    return result;
                }
                changed = true;
                return result;
            }, {});

            return changed ? next : prev;
        };

        setSelectedPriceIds((prev) => pruneStateMap(prev, validItemIds));
        setPriceDrafts((prev) => pruneStateMap(prev, validItemIds));
        setCodeDrafts((prev) => pruneStateMap(prev, validItemIds));
        setSavingPriceIds((prev) => pruneStateMap(prev, validItemIds));
        setExpandedComparisons((prev) => pruneStateMap(prev, validItemIds));
        setGroupPriceDrafts((prev) => pruneStateMap(prev, validGroupIds));
        setExpandedGroups((prev) => pruneStateMap(prev, validGroupIds));
    }, [supplierCatalog, supplierCatalogItemRows]);

    const selectedIds = useMemo(
        () => Object.entries(selectedPriceIds)
            .filter(([id, checked]) => checked && allSupplierItemIdSet.has(Number(id)))
            .map(([id]) => Number(id)),
        [allSupplierItemIdSet, selectedPriceIds]
    );
    const getVariantIdsByGroup = (groupId) => (supplierCatalog.find((item) => item.id === groupId)?.variants || []).map((variant) => variant.id);
    const getGroupSelectionState = (groupId) => {
        const ids = getVariantIdsByGroup(groupId);
        const checkedCount = ids.filter((id) => selectedPriceIds[id]).length;

        return {
            checked: ids.length > 0 && checkedCount === ids.length,
            indeterminate: checkedCount > 0 && checkedCount < ids.length,
        };
    };
    const setItemSelected = (itemId, checked) => {
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            if (checked) {
                next[itemId] = true;
            } else {
                delete next[itemId];
            }
            return next;
        });
    };
    const toggleAllVisibleSelections = (checked) => {
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            visibleSupplierItemIds.forEach((id) => {
                if (checked) {
                    next[id] = true;
                } else {
                    delete next[id];
                }
            });
            return next;
        });
    };
    const patchSupplierCatalogRow = (productId, updates) => {
        setSupplierCatalog((prev) => prev.map((product) => {
            if (product.id === productId) {
                return { ...product, ...updates };
            }
            if (Array.isArray(product.variants) && product.variants.length) {
                return {
                    ...product,
                    variants: product.variants.map((variant) => (
                        variant.id === productId ? { ...variant, ...updates } : variant
                    )),
                };
            }
            return product;
        }));
    };
const buildSavedSupplierPriceRowUpdates = (row, responseData, fallbackValues = {}) => {
        const nextUnitCost = normalizeRoundedImportCostNumber(responseData?.unit_cost ?? responseData?.supplier_unit_cost ?? fallbackValues.unit_cost ?? row.unit_cost) ?? 0;
        const nextUpdatedAt = responseData?.updated_at ?? responseData?.supplier_price_updated_at ?? new Date().toISOString();
        const nextExpectedCost = normalizeRoundedImportCostNumber(responseData?.product?.expected_cost ?? responseData?.expected_cost ?? nextUnitCost);

        return {
            supplier_price_id: responseData?.id ?? responseData?.supplier_price_id ?? row.supplier_price_id ?? null,
            supplier_product_code: String(responseData?.supplier_product_code ?? fallbackValues.supplier_product_code ?? row.supplier_product_code ?? '').trim(),
            unit_cost: nextUnitCost,
            supplier_unit_cost: nextUnitCost,
            expected_cost: nextExpectedCost ?? row.expected_cost,
            notes: responseData?.notes ?? fallbackValues.notes ?? row.notes ?? '',
            updated_at: nextUpdatedAt,
            updater_name: responseData?.updater?.name ?? responseData?.updater_name ?? row.updater_name ?? null,
            ...upsertSupplierComparison(row, nextUnitCost, nextUpdatedAt),
        };
    };
    const findLocalDuplicateSupplierCodeRow = (row, supplierProductCode) => {
        const normalizedCode = normalizeSupplierCodeKey(supplierProductCode);
        if (!normalizedCode) return null;

        return supplierCatalogItemRows.find((candidate) => (
            candidate.id !== row.id && normalizeSupplierCodeKey(codeDrafts[candidate.id] ?? candidate.supplier_product_code) === normalizedCode
        )) || null;
    };
    const toggleComparisonRow = (productId) => {
        setExpandedComparisons((prev) => ({ ...prev, [productId]: !prev[productId] }));
    };
    const getComparableSupplierCount = (row) => {
        const comparisonSupplierIds = Array.from(new Set((row.supplier_price_comparisons || []).map((item) => Number(item.supplier_id)).filter(Boolean)));
        return Math.max(Number(row.supplier_count || 0), comparisonSupplierIds.length);
    };
    const upsertSupplierComparison = (row, unitCost, updatedAt) => {
        const supplier = currentSupplierCatalog;
        const existingComparisons = row.supplier_price_comparisons || [];
        const nextComparisons = sortSupplierComparisons([
            ...existingComparisons.filter((item) => Number(item.supplier_id) !== Number(selectedSupplierCatalogApiId)),
            supplier ? {
                supplier_id: supplier.id,
                supplier_name: supplier.name,
                supplier_code: supplier.code || null,
                unit_cost: unitCost,
                updated_at: updatedAt,
            } : null,
        ].filter(Boolean));

        return {
            supplier_price_comparisons: nextComparisons,
            supplier_count: Math.max(Number(row.supplier_count || 0), nextComparisons.length, row.supplier_ids?.length || 0),
            has_multiple_suppliers: Math.max(Number(row.supplier_count || 0), nextComparisons.length, row.supplier_ids?.length || 0) > 1,
        };
    };
    const openSupplierCatalogProductEditor = (row, columnId) => {
        if (!row || row.row_kind === 'comparison' || columnId !== 'sku') return;
        navigate(`/admin/products/edit/${row.product_id || row.id}`, {
            state: {
                returnContext: buildSupplierPriceReturnContext(),
            },
        });
    };

    const markGroupSelected = (groupId, checked = true) => {
        const ids = getVariantIdsByGroup(groupId);
        if (!ids.length) return;
        setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            ids.forEach((id) => {
                if (checked) {
                    next[id] = true;
                } else {
                    delete next[id];
                }
            });
            return next;
        });
    };

    const supplierPriceColumns = useMemo(() => [
        {
            id: 'select',
            label: '',
            minWidth: 56,
            align: 'center',
            draggable: false,
            headerRender: () => (
                <IndeterminateCheckbox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    disabled={visibleSupplierItemIds.length === 0}
                    onChange={(event) => toggleAllVisibleSelections(event.target.checked)}
                    title="Chọn tất cả dòng đang hiển thị"
                />
            ),
        },
        ...supplierPriceTableBaseColumns,
    ], [allVisibleSelected, someVisibleSelected, visibleSupplierItemIds]);

    const applyPriceToIds = async (ids, cleaned) => {
        if (!hasSpecificSupplierSelection || !ids.length || !cleaned) return false;
        try {
            const numericValue = Number(cleaned);
            await inventoryApi.bulkSupplierPrices(selectedSupplierCatalogApiId, {
                items: supplierCatalogItemRows.filter((row) => ids.includes(row.id)).map((row) => ({
                    product_id: row.product_id,
                    supplier_product_code: String(codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim() || null,
                    unit_cost: numericValue,
                    notes: bulkNote || null,
                })),
            });
            setPriceDrafts((prev) => {
                const next = { ...prev };
                ids.forEach((id) => { next[id] = cleaned; });
                return next;
            });
            await fetchSupplierCatalog(supplierCatalogPagination.current_page || 1, pageSizes.supplierPrices);
            return true;
        } catch (error) {
            fail(error, 'Không thể áp giá hàng loạt.');
            return false;
        }
    };

    const applyBulkPrice = async () => {
        const cleaned = normalizeRoundedImportCostDraft(bulkPrice);
        if (!hasSpecificSupplierSelection || !selectedIds.length || !cleaned) return showToast({ type: 'warning', message: 'Hãy chọn dòng và nhập giá.' });
        const success = await applyPriceToIds(selectedIds, cleaned);
        if (success) {
            showToast({ type: 'success', message: 'Đã áp giá cho các dòng đã chọn.' });
        }
    };

    const applyGroupPrice = async (groupId) => {
        const cleaned = normalizeRoundedImportCostDraft(groupPriceDrafts[groupId] ?? bulkPrice);
        const ids = getVariantIdsByGroup(groupId);
        if (!ids.length || !cleaned) return showToast({ type: 'warning', message: 'Hãy nhập giá hàng loạt trước.' });
        setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
        setSelectedPriceIds((prev) => {
            const next = { ...prev };
            ids.forEach((id) => { next[id] = true; });
            return next;
        });
        const success = await applyPriceToIds(ids, cleaned);
        if (success) {
            showToast({ type: 'success', message: 'Đã áp giá cho toàn bộ biến thể.' });
        }
    };

    const applyPaste = () => {
        const skuMap = new Map(supplierCatalogItemRows.map((row) => [String(row.sku || '').toUpperCase(), row]));
        const nextPriceDrafts = {};
        const nextCodeDrafts = {};
        const nextSelected = {};
        let matchedCount = 0;
        let skippedCount = 0;

        pasteText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
            const parsed = parseSupplierPasteLine(line, pasteMode);
            if (!parsed) {
                skippedCount += 1;
                return;
            }

            const matched = skuMap.get(String(parsed.sku || '').toUpperCase());
            if (!matched) {
                skippedCount += 1;
                return;
            }

            if (Object.prototype.hasOwnProperty.call(parsed, 'unit_cost')) {
                nextPriceDrafts[matched.id] = parsed.unit_cost;
            }
            if (Object.prototype.hasOwnProperty.call(parsed, 'supplier_product_code')) {
                nextCodeDrafts[matched.id] = parsed.supplier_product_code;
            }
            nextSelected[matched.id] = true;
            matchedCount += 1;
        });

        if (!matchedCount) {
            showToast({ type: 'warning', message: 'Không có dòng nào đúng định dạng hoặc khớp SKU trong bảng hiện tại.' });
            return;
        }

        if (Object.keys(nextPriceDrafts).length > 0) {
            setPriceDrafts((prev) => ({ ...prev, ...nextPriceDrafts }));
        }
        if (Object.keys(nextCodeDrafts).length > 0) {
            setCodeDrafts((prev) => ({ ...prev, ...nextCodeDrafts }));
        }
        setSelectedPriceIds((prev) => ({ ...prev, ...nextSelected }));
        showToast({
            type: 'success',
            message: skippedCount > 0
                ? `Đã nhận dữ liệu ${formatNumber(matchedCount)} dòng, bỏ qua ${formatNumber(skippedCount)} dòng không hợp lệ hoặc không khớp SKU.`
                : `Đã nhận dữ liệu ${formatNumber(matchedCount)} dòng.`,
        });
    };
    const currentPasteModeConfig = supplierPasteModeConfigs[pasteMode] || supplierPasteModeConfigs.sku_price;

    const saveSupplierPriceRow = async (row, overrides = {}) => {
        const hasUnitCostOverride = Object.prototype.hasOwnProperty.call(overrides, 'unit_cost');
        const hasSupplierCodeOverride = Object.prototype.hasOwnProperty.call(overrides, 'supplier_product_code');
        const rawValue = hasUnitCostOverride ? (overrides.unit_cost ?? '') : (row.unit_cost ?? '');
        const cleaned = normalizeRoundedImportCostDraft(rawValue);
        const numericValue = normalizeRoundedImportCostNumber(rawValue) ?? (normalizeRoundedImportCostNumber(row.unit_cost) ?? 0);
        const supplierProductCode = String(hasSupplierCodeOverride ? (overrides.supplier_product_code ?? '') : (row.supplier_product_code ?? '')).trim();
        const currentSupplierCode = String(row.supplier_product_code || '').trim();
        const productId = Number(row.product_id || row.id || 0);
        if (!hasSpecificSupplierSelection || row.row_kind === 'group') return false;
        if (!productId) return false;
        if (Number(row.unit_cost || 0) === numericValue && currentSupplierCode === supplierProductCode) return false;
        if (savingSupplierPriceRowsRef.current.has(row.id)) return false;

        const duplicateRow = findLocalDuplicateSupplierCodeRow(row, supplierProductCode);
        if (duplicateRow) {
            showToast({
                type: 'error',
                message: `Mã NCC "${supplierProductCode}" đã trùng với ${duplicateRow.sku || duplicateRow.product_sku || duplicateRow.name || 'một sản phẩm khác'}.`,
            });
            return false;
        }

        savingSupplierPriceRowsRef.current.add(row.id);
        setSavingPriceIds((prev) => ({ ...prev, [row.id]: true }));
        try {
            const payload = {
                product_id: productId,
                supplier_product_code: supplierProductCode || null,
                unit_cost: numericValue,
                notes: row.notes || null,
            };
            const response = await inventoryApi.createSupplierPrice(selectedSupplierCatalogApiId, payload);
            const responseData = response.data || {};
            const nextCodeDraft = String(responseData.supplier_product_code ?? supplierProductCode).trim();
            const nextPriceDraft = normalizeRoundedImportCostDraft(responseData.unit_cost ?? numericValue);
            const savedRowUpdates = buildSavedSupplierPriceRowUpdates(row, responseData, {
                supplier_product_code: nextCodeDraft,
                unit_cost: nextPriceDraft,
                notes: payload.notes,
            });

            patchSupplierCatalogRow(productId, savedRowUpdates);
            if (hasUnitCostOverride) {
                setPriceDrafts((prev) => ({ ...prev, [row.id]: nextPriceDraft }));
            }
            if (hasSupplierCodeOverride) {
                setCodeDrafts((prev) => ({ ...prev, [row.id]: nextCodeDraft }));
            }
            return true;
        } catch (error) {
            fail(error, 'Không thể lưu giá dự kiến.');
            return false;
        } finally {
            savingSupplierPriceRowsRef.current.delete(row.id);
            setSavingPriceIds((prev) => ({ ...prev, [row.id]: false }));
        }
    };

    const saveSingleSupplierPrice = async (row, explicitValue = null) => {
        const rawValue = explicitValue ?? priceDrafts[row.id] ?? row.unit_cost ?? '';
        const cleaned = normalizeRoundedImportCostDraft(rawValue);
        if (!hasSpecificSupplierSelection || row.row_kind === 'group' || cleaned === '') return;

        await saveSupplierPriceRow(row, { unit_cost: cleaned });
    };

    const saveSingleSupplierCode = async (row, explicitValue = null) => {
        const normalizedCode = String(explicitValue ?? codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim();
        const currentCode = String(row.supplier_product_code || '').trim();
        if (!hasSpecificSupplierSelection || row.row_kind === 'group' || normalizedCode === currentCode) return;

        await saveSupplierPriceRow(row, {
            supplier_product_code: normalizedCode,
        });
    };

    const saveSupplierPrices = async () => {
        if (!hasSpecificSupplierSelection || !selectedIds.length) return showToast({ type: 'warning', message: 'Hãy chọn ít nhất một dòng giá.' });
        setFlag('saving', true);
        try {
            await inventoryApi.bulkSupplierPrices(selectedSupplierCatalogApiId, {
                items: supplierCatalogItemRows.filter((row) => selectedIds.includes(row.id)).map((row) => ({
                    product_id: row.product_id,
                    supplier_product_code: String(codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim() || null,
                    unit_cost: normalizeRoundedImportCostNumber(priceDrafts[row.id] ?? row.unit_cost ?? 0) ?? 0,
                    notes: bulkNote || null,
                })),
            });
            showToast({ type: 'success', message: 'Đã cập nhật bảng giá nhà cung cấp.' });
            await fetchSupplierCatalog(supplierCatalogPagination.current_page || 1, pageSizes.supplierPrices);
        } catch (error) {
            fail(error, 'Không thể cập nhật bảng giá nhà cung cấp.');
        } finally {
            setFlag('saving', false);
        }
    };

    const removeProduct = async (id) => {
        if (!window.confirm('Chuyển sản phẩm này vào thùng rác?')) return;
        try {
            await productApi.destroy(id);
            showToast({ type: 'success', message: 'Đã chuyển sản phẩm vào thùng rác.' });
            fetchProducts(productPagination.current_page || 1);
            fetchTrash(trashPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa sản phẩm.');
        }
    };

    const restoreProduct = async (id) => {
        try {
            await productApi.restore(id);
            showToast({ type: 'success', message: 'Đã khôi phục sản phẩm.' });
            fetchTrash(trashPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể khôi phục sản phẩm.');
        }
    };

    const forceDeleteProduct = async (id) => {
        if (!window.confirm('Xóa vĩnh viễn sản phẩm này?')) return;
        try {
            await productApi.forceDelete(id);
            showToast({ type: 'success', message: 'Đã xóa vĩnh viễn sản phẩm.' });
            fetchTrash(trashPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa vĩnh viễn sản phẩm.');
        }
    };

    const closeSupplierModal = () => {
        setSupplierModal({ open: false, form: createSupplierForm(), source: null });
    };

    const upsertSupplierInList = (supplier) => {
        if (!supplier?.id) return;
        setSuppliers((prev) => {
            const supplierId = Number(supplier.id);
            const existingSupplier = prev.find((item) => Number(item.id) === supplierId) || {};
            return [
                { ...existingSupplier, ...supplier },
                ...prev.filter((item) => Number(item.id) !== supplierId),
            ];
        });
    };

    const openCreateSupplier = async () => {
        await ensureSuppliersLoaded();
        setSupplierModal({ open: true, form: createSupplierForm(), source: null });
    };

    const openCreateSupplierFromImport = async () => {
        await ensureSuppliersLoaded();
        setSupplierModal({ open: true, form: createSupplierForm(), source: 'import' });
    };

    const openEditSupplier = (supplier) => setSupplierModal({ open: true, form: createSupplierForm(supplier), source: null });

    const saveSupplier = async () => {
        const form = supplierModal.form;
        if (!form.name.trim()) return showToast({ type: 'warning', message: 'Vui lòng nhập tên nhà cung cấp.' });
        const source = supplierModal.source;
        setFlag('supplierModal', true);
        try {
            const payload = { code: form.code || null, name: form.name.trim(), phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null, status: form.status ? 1 : 0 };
            let savedSupplierId = form.id;
            let savedSupplier = null;
            if (form.id) {
                const response = await inventoryApi.updateSupplier(form.id, payload);
                savedSupplier = response.data || null;
                savedSupplierId = savedSupplier?.id || form.id;
                showToast({ type: 'success', message: 'Đã cập nhật nhà cung cấp.' });
            } else {
                const response = await inventoryApi.createSupplier(payload);
                savedSupplier = response.data || null;
                savedSupplierId = savedSupplier?.id || null;
                showToast({ type: 'success', message: 'Đã tạo nhà cung cấp.' });
            }
            closeSupplierModal();
            upsertSupplierInList(savedSupplier);
            if (savedSupplierId) {
                setSelectedSupplierId(savedSupplierId);
                setSupplierDetailOpen((prev) => ({ ...prev, [savedSupplierId]: true }));
            }
            if (source === 'import' && savedSupplierId) {
                setImportModal((prev) => ({
                    ...prev,
                    form: {
                        ...prev.form,
                        supplier_id: String(savedSupplierId),
                        supplier_name: savedSupplier?.name || prev.form.supplier_name,
                    },
                }));
                await syncImportItemsFromSupplier(savedSupplierId);
            }
            await fetchSuppliers(supplierPagination.current_page || 1);
            if (source === 'import') {
                upsertSupplierInList(savedSupplier);
            }
        } catch (error) {
            fail(error, 'Không thể lưu nhà cung cấp.');
        } finally {
            setFlag('supplierModal', false);
        }
    };

    const deleteSupplier = async (supplier) => {
        if (!window.confirm(`Xóa nhà cung cấp "${supplier.name}"?`)) return;
        try {
            await inventoryApi.deleteSupplier(supplier.id);
            showToast({ type: 'success', message: 'Đã xóa nhà cung cấp.' });
            fetchSuppliers(supplierPagination.current_page || 1);
            if (selectedSupplierId === supplier.id) setSelectedSupplierId(null);
            if (selectedSupplierCatalogFilterIds.includes(Number(supplier.id))) {
                setSupplierCatalogFilters((prev) => ({
                    ...prev,
                    supplier_ids: normalizeSupplierFilterIds(prev.supplier_ids).filter((id) => id !== Number(supplier.id)),
                }));
            }
        } catch (error) {
            fail(error, 'Không thể xóa nhà cung cấp.');
        }
    };

    const openCreateSupplierPrice = () => {
        if (!hasSpecificSupplierSelection) return showToast({ type: 'warning', message: 'Hãy chọn nhà cung cấp trước.' });
        setSupplierPriceModal({ open: true, form: createSupplierPriceForm() });
    };

    const saveSupplierPriceEntry = async () => {
        if (!hasSpecificSupplierSelection) return showToast({ type: 'warning', message: 'Hãy chọn nhà cung cấp trước.' });
        const form = supplierPriceModal.form;
        if (!form.product_id) return showToast({ type: 'warning', message: 'Vui lòng chọn sản phẩm.' });
        if (!String(form.unit_cost || '').trim()) return showToast({ type: 'warning', message: 'Vui lòng nhập giá nhập.' });

        setFlag('supplierPriceModal', true);
        try {
            await inventoryApi.createSupplierPrice(selectedSupplierCatalogApiId, {
                product_id: Number(form.product_id),
                supplier_product_code: String(form.supplier_product_code || '').trim() || null,
                unit_cost: normalizeRoundedImportCostNumber(form.unit_cost) ?? 0,
                notes: form.notes || null,
            });
            setSupplierPriceModal({ open: false, form: createSupplierPriceForm() });
            showToast({ type: 'success', message: 'Đã thêm sản phẩm vào bảng giá.' });
            await fetchSupplierCatalog(1, pageSizes.supplierPrices);
        } catch (error) {
            fail(error, 'Không thể lưu dòng giá nhập.');
        } finally {
            setFlag('supplierPriceModal', false);
        }
    };

    const removeSupplierPrice = async (row) => {
        if (!hasSpecificSupplierSelection) return;
        if (!row.supplier_price_id) return showToast({ type: 'warning', message: 'Dòng này chưa có giá nhập để xóa.' });
        if (!window.confirm(`Xóa giá nhập của "${row.name}"?`)) return;
        try {
            await inventoryApi.deleteSupplierPrice(selectedSupplierCatalogApiId, row.supplier_price_id);
            showToast({ type: 'success', message: 'Đã xóa dòng giá nhập.' });
            await fetchSupplierCatalog(supplierCatalogPagination.current_page || 1, pageSizes.supplierPrices);
        } catch (error) {
            fail(error, 'Không thể xóa dòng giá nhập.');
        }
    };

    const openSupplierPriceTab = (supplierId = selectedSupplierId) => {
        if (supplierId) {
            setSelectedSupplierId(Number(supplierId));
            setSupplierCatalogFilters((prev) => ({ ...prev, supplier_ids: [Number(supplierId)] }));
        }
        goToTab('supplierPrices');
    };

    const openImportStatusManager = (status = null) => {
        setImportStatusModal({
            open: true,
            form: createImportStatusForm(status),
        });
    };

    const saveImportStatus = async () => {
        const form = importStatusModal.form;
        if (!form.name.trim()) {
            return showToast({ type: 'warning', message: 'Vui lòng nhập tên trạng thái phiếu nhập.' });
        }

        setFlag('importStatusModal', true);
        try {
            let response;
            const payload = {
                name: form.name.trim(),
                color: form.color || '#10B981',
                affects_inventory: form.affects_inventory ? 1 : 0,
                is_active: form.is_active ? 1 : 0,
                is_default: form.is_default ? 1 : 0,
            };

            if (form.id) {
                response = await inventoryApi.updateImportStatus(form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật trạng thái phiếu nhập.' });
            } else {
                response = await inventoryApi.createImportStatus(payload);
                showToast({ type: 'success', message: 'Đã tạo trạng thái phiếu nhập.' });
            }

            await fetchImportStatuses();
            setImportStatusModal({ open: false, form: createImportStatusForm() });
            if (response?.data?.id) {
                setImportModal((prev) => ({
                    ...prev,
                    form: {
                        ...prev.form,
                        inventory_import_status_id: String(response.data.id),
                    },
                }));
            }
        } catch (error) {
            fail(error, 'Không thể lưu trạng thái phiếu nhập.');
        } finally {
            setFlag('importStatusModal', false);
        }
    };

    const handleImportSupplierChange = async (supplierId) => {
        setImportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                supplier_id: supplierId,
            },
        }));

        if (supplierId) {
            await syncImportItemsFromSupplier(supplierId);
        }
    };

    const addImportAttachmentFiles = (fileList) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setImportModal((prev) => {
            const existingKeys = new Set((prev.form.local_attachment_files || []).map((file) => `${file.name}_${file.size}_${file.lastModified}`));
            const nextFiles = files.filter((file) => !existingKeys.has(`${file.name}_${file.size}_${file.lastModified}`));
            return {
                ...prev,
                form: {
                    ...prev.form,
                    has_purchase_invoice: true,
                    local_attachment_files: [...(prev.form.local_attachment_files || []), ...nextFiles],
                },
            };
        });
        setImportAttachmentManagerOpen(true);
    };

    const removeImportAttachment = (attachmentIndex) => {
        setImportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                attachments: prev.form.attachments.filter((_, index) => index !== attachmentIndex),
            },
        }));
    };

    const removeLocalImportFile = (fileIndex) => {
        setImportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                local_attachment_files: prev.form.local_attachment_files.filter((_, index) => index !== fileIndex),
            },
        }));
    };

    const openImportModalAttachmentPreview = (row) => {
        if (!row) return;

        let previewUrl = '';
        let shouldRevoke = false;
        if (row.kind === 'local' && row.file) {
            previewUrl = URL.createObjectURL(row.file);
            shouldRevoke = true;
        } else if (row.attachment) {
            previewUrl = row.attachment.url || resolveMediaUrl(row.attachment.file_path);
        }

        if (!previewUrl) {
            showToast({ type: 'warning', message: 'Tệp này chưa có đường dẫn để xem.' });
            return;
        }

        window.open(previewUrl, '_blank', 'noopener,noreferrer');
        if (shouldRevoke) {
            window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
        }
    };

    const replaceImportModalAttachmentFile = (row, file) => {
        if (!row || !file) return;
        setImportModal((prev) => {
            const currentFiles = prev.form.local_attachment_files || [];
            const currentAttachments = prev.form.attachments || [];

            if (row.kind === 'local') {
                return {
                    ...prev,
                    form: {
                        ...prev.form,
                        has_purchase_invoice: true,
                        local_attachment_files: currentFiles.map((currentFile, index) => (index === row.index ? file : currentFile)),
                    },
                };
            }

            return {
                ...prev,
                form: {
                    ...prev.form,
                    has_purchase_invoice: true,
                    attachments: currentAttachments.filter((_, index) => index !== row.index),
                    local_attachment_files: [...currentFiles, file],
                },
            };
        });
        setImportAttachmentManagerOpen(true);
        showToast({ type: 'success', message: 'Đã thay file hóa đơn. Lưu phiếu để cập nhật lên hệ thống.' });
    };

    const deleteImportModalAttachmentFile = (row) => {
        if (!row) return;
        const fileName = row.kind === 'local'
            ? row.file?.name
            : getImportAttachmentName(row.attachment);
        if (!window.confirm(`Xóa hóa đơn "${fileName || 'đã chọn'}"?`)) return;

        if (row.kind === 'local') {
            removeLocalImportFile(row.index);
        } else {
            removeImportAttachment(row.index);
        }
    };

    const analyzeInvoiceFile = async (file) => {
        if (!file) return;
        if (!aiAvailable) {
            showToast({ type: 'warning', message: aiDisabledReason });
            return;
        }

        setFlag('invoiceAnalysis', true);
        setImportCompleteToggleSnapshot(null);
        try {
            const submitData = new FormData();
            if (importModal.form.supplier_id) {
                submitData.append('supplier_id', String(Number(importModal.form.supplier_id)));
            }
            submitData.append('invoice_file', file);

            const response = await aiApi.readInvoice(submitData);
            const draft = response.data?.draft || {};
            const log = response.data?.log || null;
            const completedStatus = getCompletedImportStatus();
            const newStatus = getNewImportStatus();
            const defaultStatus = getDefaultImportStatus();
            const subtotalAmount = Number(draft.subtotal_amount || 0);
            const totalAmount = Number(draft.total_amount || subtotalAmount);
            const extraChargeAmount = Math.round(totalAmount - subtotalAmount);
            const mappedDraftItems = (draft.items || []).length
                ? draft.items.map((item) => createLine({
                    key: item.row_key || undefined,
                    product_id: item.product_id || '',
                    product_name: item.product_name || '',
                    product_sku: item.sku || '',
                    supplier_product_code: item.supplier_product_code || '',
                    quantity: String(item.quantity || 1),
                    received_quantity: String(item.received_quantity ?? 0),
                    unit_name: item.unit_name || '',
                    unit_cost: String(Math.round(Number(item.unit_cost || 0))),
                    notes: item.notes || '',
                    update_supplier_price: true,
                    mapping_status: item.mapping_status || (item.product_id ? 'matched' : 'unmatched'),
                    mapping_label: item.mapping_label || '',
                }))
                : null;

            setImportModal((prev) => {
                const autoCompleteImport = Boolean(prev.form.auto_complete_import ?? true);
                const fallbackStatus = autoCompleteImport
                    ? (completedStatus || defaultStatus)
                    : (newStatus || defaultStatus);
                const nextForm = {
                    ...prev.form,
                    supplier_id: prev.form.supplier_id || (draft.supplier_id ? String(draft.supplier_id) : ''),
                    inventory_import_status_id: prev.form.inventory_import_status_id || (fallbackStatus ? String(fallbackStatus.id) : ''),
                    status_is_manual: false,
                    auto_complete_import: autoCompleteImport,
                    import_date: draft.import_date || prev.form.import_date || todayValue,
                    notes: prev.form.notes || draft.notes || '',
                    entry_mode: 'invoice_ai',
                    extra_charge_mode: 'amount',
                    extra_charge_value: String(extraChargeAmount),
                    extra_charge_amount_input: extraChargeAmount === 0 ? '' : formatSignedAmountInput(`${extraChargeAmount >= 0 ? '+' : '-'}${Math.abs(extraChargeAmount)}`),
                    extra_charge_percent_input: '',
                    invoice_analysis_log_id: log?.id ? String(log.id) : prev.form.invoice_analysis_log_id,
                    invoice_number: draft.invoice_number || prev.form.invoice_number || '',
                    has_purchase_invoice: true,
                    analysis_log: log || prev.form.analysis_log,
                    attachments: log ? [
                        ...prev.form.attachments.filter((attachment) => Number(attachment.invoice_analysis_log_id || 0) !== Number(log.id)),
                        {
                            invoice_analysis_log_id: log.id,
                            source_type: 'invoice',
                            disk: log.disk || 'public',
                            file_path: log.file_path,
                            original_name: log.source_name || file.name,
                            mime_type: log.mime_type || file.type || null,
                            file_size: log.file_size || file.size || 0,
                            url: log.file_url || null,
                        },
                    ] : prev.form.attachments,
                    items: mappedDraftItems || prev.form.items,
                };

                return {
                    ...prev,
                    open: true,
                    form: synchronizeImportFormCompletion(nextForm),
                };
            });

            const draftDuplicateSelection = findFirstDuplicateImportProductSelection(mappedDraftItems || []);
            if (draftDuplicateSelection) {
                notifyDuplicateImportProduct(draftDuplicateSelection);
            }

            showToast({
                type: Array.isArray(draft.unmatched_lines) && draft.unmatched_lines.length ? 'warning' : 'success',
                message: Array.isArray(draft.unmatched_lines) && draft.unmatched_lines.length
                    ? `Đã tạo bản nháp từ hóa đơn. Còn ${draft.unmatched_lines.length} dòng chưa map sản phẩm.`
                    : 'Đã đọc hóa đơn và tạo bản nháp phiếu nhập.',
            });
        } catch (error) {
            fail(error, 'Không thể đọc hóa đơn đầu vào.');
        } finally {
            setFlag('invoiceAnalysis', false);
        }
    };

    const openCreateImport = async () => {
        goToTab('imports');
        clearPersistedImportDraft();
        await ensureSuppliersLoaded();
        await fetchInventoryUnits();
        let statusOptions = importStatuses;
        if (!importStatuses.length) {
            statusOptions = await fetchImportStatuses();
        }
        const completedStatus = statusOptions.find((status) => isCompletedImportStatus(status)) || null;
        const defaultStatus = statusOptions.find((status) => status.is_default) || statusOptions[0] || null;
        setImportTableSettingsOpen(false);
        closeImportPrintModal();
        setImportCompleteToggleSnapshot(null);
        highlightImportRow('');
        setImportModal({
            open: true,
            form: applyImportAutoCompleteMode(createImportForm({
                inventory_import_status_id: completedStatus?.id || defaultStatus?.id || null,
                update_supplier_prices: true,
                auto_complete_import: true,
                auto_complete_import_touched: false,
            }), true, statusOptions),
        });
    };

    const closeExportModal = () => {
        setExportModal({ open: false, form: createExportForm() });
    };

    const openCreateExport = async () => {
        goToTab('exports');
        setExportModal({ open: true, form: createExportForm() });
    };

    const updateExportInvoiceMetaField = (field, value) => {
        setExportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                invoice_meta: {
                    ...prev.form.invoice_meta,
                    [field]: value,
                },
            },
        }));
    };

    const updateExportSaleChannel = (value) => {
        const nextChannel = value || 'online';
        setExportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                source: nextChannel,
                invoice_meta: {
                    ...prev.form.invoice_meta,
                    sale_channel: nextChannel,
                    invoice_mode: nextChannel === 'store' ? 'cash_register' : prev.form.invoice_meta.invoice_mode === 'cash_register' ? 'standard' : prev.form.invoice_meta.invoice_mode,
                    payment_method: nextChannel === 'store' && prev.form.invoice_meta.payment_method === 'cod'
                        ? 'cash'
                        : prev.form.invoice_meta.payment_method,
                },
            },
        }));
    };

    const syncExportInvoiceBuyerFromCustomer = () => {
        setExportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                invoice_meta: {
                    ...prev.form.invoice_meta,
                    invoice_buyer_name: prev.form.customer_name || prev.form.invoice_meta.invoice_buyer_name,
                    invoice_email: prev.form.customer_email || prev.form.invoice_meta.invoice_email,
                    invoice_address: prev.form.shipping_address || prev.form.invoice_meta.invoice_address,
                },
            },
        }));
    };

    const attachExportProductToLine = (index, product) => {
        setExportModal((prev) => ({
            ...prev,
            form: {
                ...prev.form,
                items: prev.form.items.map((item, itemIndex) => (
                    itemIndex === index
                        ? {
                            ...item,
                            product_id: product.id,
                            product_name: product.name,
                            product_sku: product.sku,
                            unit_name: product.unit_name || product.unit?.name || item.unit_name || '',
                            unit_cost: String(Math.round(Number(product.current_price ?? product.price ?? product.current_cost ?? product.expected_cost ?? 0))),
                            notes: item.notes || '',
                        }
                        : item
                )),
            },
        }));
    };

    const openEditImport = async (row) => {
        await ensureSuppliersLoaded();
        await fetchInventoryUnits();
        if (!importStatuses.length) {
            await fetchImportStatuses();
        }
        setFlag('importModal', true);
        try {
            const response = await inventoryApi.getImport(row.id);
            const nextForm = synchronizeImportFormCompletion(createImportForm(response.data));
            setImportTableSettingsOpen(false);
            closeImportPrintModal();
            setImportCompleteToggleSnapshot(null);
            highlightImportRow('');
            setImportModal({ open: true, form: nextForm });
            const duplicateSelection = findFirstDuplicateImportProductSelection(nextForm.items);
            if (duplicateSelection) {
                notifyDuplicateImportProduct(duplicateSelection);
            }
        } catch (error) {
            fail(error, 'Không thể tải phiếu nhập để sửa.');
        } finally {
            setFlag('importModal', false);
        }
    };

    const closeImportDetailModal = () => {
        setImportDetailTableSettingsOpen(false);
        setImportDetailModal({ open: false, loading: false, form: createImportForm(), row: null });
    };

    const openImportDetail = async (row) => {
        setImportDetailTableSettingsOpen(false);
        setImportDetailModal({
            open: true,
            loading: true,
            form: createImportForm({
                id: row.id,
                import_number: row.import_number,
                supplier_id: row.supplier_id,
                supplier_name: row.supplier?.name || row.supplier_name || '',
                import_date: row.import_date,
                inventory_import_status_id: row.inventory_import_status_id,
                notes: row.notes || '',
                items: [],
            }),
            row,
        });

        try {
            const response = await inventoryApi.getImport(row.id);
            setImportDetailModal({
                open: true,
                loading: false,
                form: synchronizeImportFormCompletion(createImportForm(response.data)),
                row: response.data,
            });
        } catch (error) {
            closeImportDetailModal();
            fail(error, 'Không thể tải chi tiết phiếu nhập.');
        }
    };

    const saveImport = async () => {
        const form = synchronizeImportFormCompletion(importModal.form);
        if (!form.inventory_import_status_id) return showToast({ type: 'warning', message: 'Vui lòng chọn trạng thái phiếu nhập.' });

        const pendingMappedLines = form.items.filter((item) => !item.product_id && (item.product_name || item.product_sku || item.supplier_product_code || item.unit_cost || item.notes));
        if (pendingMappedLines.length) {
            return showToast({ type: 'warning', message: 'Còn dòng chưa map sản phẩm. Hãy chọn tay trước khi lưu phiếu nhập.' });
        }

        const duplicateSelection = findFirstDuplicateImportProductSelection(form.items);
        if (duplicateSelection) {
            notifyDuplicateImportProduct(duplicateSelection);
            return;
        }

        const items = buildImportPayloadItems(form.items);
        if (!items.length) return showToast({ type: 'warning', message: 'Phiếu nhập cần ít nhất một dòng sản phẩm.' });

        setFlag('saving', true);
        try {
            const payload = buildImportSubmitData(form);
            if (form.id) {
                await inventoryApi.updateImport(form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật phiếu nhập.' });
            } else {
                await inventoryApi.createImport(payload);
                showToast({ type: 'success', message: 'Đã tạo phiếu nhập.' });
            }

            closeImportModal();
            fetchImports(importPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchLots(lotPagination.current_page || 1);
            fetchSuppliers(supplierPagination.current_page || 1);
            if (hasSupplierCatalogSelection) fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu phiếu nhập.');
        } finally {
            setFlag('saving', false);
        }
    };

    const deleteImport = async (row) => {
        if (!window.confirm(`Xóa phiếu nhập ${row.import_number}?`)) return;
        try {
            await inventoryApi.deleteImport(row.id);
            showToast({ type: 'success', message: 'Đã chuyển phiếu nhập vào thùng rác.' });
            await refreshInventoryCoreViews(getRefreshTabsAfterSoftDelete('imports'));
        } catch (error) {
            fail(error, 'Không thể xóa phiếu nhập.');
        }
    };

    const openCreateDocument = async (tabKey) => {
        goToTab(tabKey);
        await ensureSuppliersLoaded();
        setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey) });
    };

    const openEditDocument = async (tabKey, row) => {
        await ensureSuppliersLoaded();
        setFlag('documentModal', true);
        try {
            const response = await inventoryApi.getDocument(documentTypeMap[tabKey], row.id);
            if (tabKey === 'returns' && response.data?.managed_batch_return) {
                setBatchReturnModal({ open: true, documentId: row.id });
                return;
            }
            setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey, response.data) });
        } catch (error) {
            fail(error, 'Không thể tải phiếu để sửa.');
        } finally {
            setFlag('documentModal', false);
        }
    };

    const saveExport = async () => {
        const form = exportModal.form;
        const source = form.source || exportSourceOptions[0].value;
        const items = form.items
            .filter((item) => Number(item.product_id || 0) > 0 && Number(item.quantity || 0) > 0)
            .map((item) => ({
                product_id: Number(item.product_id),
                quantity: Number(item.quantity || 0),
                price: Number(item.unit_cost || 0),
                options: {
                        note: item.notes || null,
                },
            }))
            .filter((item) => item.product_id && item.quantity > 0);

        if (!items.length) {
            return showToast({ type: 'warning', message: 'Phiếu xuất cần ít nhất một dòng sản phẩm.' });
        }

        setFlag('saving', true);
        try {
            await orderApi.store({
                customer_name: form.customer_name.trim() || 'Xuất kho trực tiếp',
                customer_phone: form.customer_phone.trim(),
                customer_email: form.customer_email.trim(),
                shipping_address: form.shipping_address.trim(),
                notes: form.notes.trim() || null,
                source,
                type: 'inventory_export',
                items,
            });

            showToast({ type: 'success', message: 'Đã tạo phiếu xuất.' });
            closeExportModal();
            fetchExports(exportPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể tạo phiếu xuất.');
        } finally {
            setFlag('saving', false);
        }
    };

    const saveDocument = async () => {
        const { tabKey, form } = documentModal;
        const type = documentTypeMap[tabKey];
        const items = form.items
            .filter((item) => item.product_id)
            .map((item) => ({
                product_id: Number(item.product_id),
                quantity: tabKey === 'adjustments'
                    ? parseSignedWholeNumberInput(item.quantity)
                    : Number(item.quantity || 0),
                notes: item.notes || null,
                unit_cost: item.unit_cost !== '' ? Number(item.unit_cost || 0) : null,
                stock_bucket: item.stock_bucket,
            }))
            .filter((item) => (
                item.product_id
                && Number.isFinite(item.quantity)
                && (tabKey === 'adjustments' ? item.quantity !== 0 : item.quantity > 0)
            ));
        if (!items.length) return showToast({ type: 'warning', message: 'Phiếu kho cần ít nhất một dòng sản phẩm.' });

        setFlag('saving', true);
        try {
            const payload = {
                document_date: form.document_date,
                supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
                notes: form.notes || null,
                items: items.map((item) => {
                    const base = { product_id: item.product_id, quantity: item.quantity, notes: item.notes };
                    if (type === 'return') base.unit_cost = item.unit_cost ?? 0;
                    if (type === 'adjustment') {
                        if (item.unit_cost != null) base.unit_cost = item.unit_cost;
                        if (item.stock_bucket && item.stock_bucket !== 'sellable') base.stock_bucket = item.stock_bucket;
                    }
                    if (type === 'damaged' && form.id && item.stock_bucket) {
                        base.stock_bucket = item.stock_bucket;
                    }
                    return base;
                }),
            };
            if (form.id) {
                await inventoryApi.updateDocument(type, form.id, payload);
                showToast({ type: 'success', message: 'Đã cập nhật phiếu kho.' });
            } else {
                await inventoryApi.createDocument(type, payload);
                showToast({ type: 'success', message: 'Đã tạo phiếu kho.' });
            }
            setDocumentModal({ open: false, tabKey, form: createDocumentForm(tabKey) });
            if (type === 'return') fetchDocuments('return', returnPagination.current_page || 1);
            if (type === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
            if (type === 'adjustment') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu phiếu kho.');
        } finally {
            setFlag('saving', false);
        }
    };

    const deleteDocument = async (tabKey, row) => {
        const confirmLabel = tabKey === 'adjustments' && row?.adjustment_kind === 'export_adjustment'
            ? `Xóa phiếu hoàn nguồn của ${row.document_number}?`
            : `Xóa ${documentTitleMap[tabKey].toLowerCase()} ${row.document_number}?`;
        if (!window.confirm(confirmLabel)) return;
        try {
            await inventoryApi.deleteDocument(documentTypeMap[tabKey], row.id);
            showToast({ type: 'success', message: 'Đã chuyển phiếu vào thùng rác.' });
            await refreshInventoryCoreViews(getRefreshTabsAfterSoftDelete(tabKey));
        } catch (error) {
            fail(error, 'Không thể xóa phiếu kho.');
        }
    };

    const openAdjustmentSource = async (row) => {
        if (row?.source_document_type === 'return' && row?.source_document_id) {
            await openEditDocument('returns', { id: row.source_document_id });
            return;
        }

        showToast({ type: 'warning', message: 'Phiếu này chưa có nguồn liên kết để mở nhanh.' });
    };

    const closeBatchReturnModal = () => {
        setBatchReturnModal({ open: false, documentId: null });
    };

    const handleBatchReturnSaved = async () => {
        closeBatchReturnModal();
        fetchDocuments('return', returnPagination.current_page || 1);
        fetchProducts(productPagination.current_page || 1);
        fetchLots(lotPagination.current_page || 1);
    };

    const deleteExport = async (row) => {
        if (!row.can_delete) {
            return showToast({ type: 'warning', message: 'Phiếu xuất này được tạo tự động từ đơn có mã vận đơn. Hãy vào đơn hàng để xử lý.' });
        }
        if (!window.confirm(`Xóa đơn ${row.order_number}?`)) return;
        try {
            await orderApi.destroy(row.id);
            showToast({ type: 'success', message: 'Đã chuyển phiếu xuất vào thùng rác.' });
            await refreshInventoryCoreViews(getRefreshTabsAfterSoftDelete('exports'));
        } catch (error) {
            fail(error, 'Không thể xóa phiếu xuất bán.');
        }
    };

    const bulkDeleteSelectedSlips = async (tabKey) => {
        const selectedRows = getSelectedSlipRows(tabKey);
        if (!selectedRows.length) {
            showToast({ type: 'warning', message: 'Hãy chọn ít nhất một phiếu.' });
            return;
        }

        if (!window.confirm(`Chuyển ${formatNumber(selectedRows.length)} phiếu đã chọn vào thùng rác?`)) return;

        try {
            if (tabKey === 'imports') {
                await inventoryApi.bulkDeleteImports(selectedRows.map((row) => row.id));
            } else if (tabKey === 'exports') {
                await orderApi.bulkDelete(selectedRows.map((row) => row.id));
            } else if (documentTypeMap[tabKey]) {
                await inventoryApi.bulkDeleteDocuments(documentTypeMap[tabKey], selectedRows.map((row) => row.id));
            }

            setSelectedSlipIds((prev) => ({ ...prev, [tabKey]: {} }));
            showToast({ type: 'success', message: `Đã chuyển ${formatNumber(selectedRows.length)} phiếu vào thùng rác.` });
            await refreshInventoryCoreViews(getRefreshTabsAfterSoftDelete(tabKey));
        } catch (error) {
            fail(error, 'Không thể xóa các phiếu đã chọn.');
        }
    };

    const restoreTrashSlip = async (row) => {
        try {
            if (row.slip_type_key === 'import') {
                await inventoryApi.restoreImport(row.id);
            } else if (row.slip_type_key === 'export') {
                await orderApi.restore(row.id);
            } else {
                await inventoryApi.restoreDocument(row.slip_type_key, row.id);
            }

            showToast({ type: 'success', message: 'Đã khôi phục phiếu.' });
            await refreshInventoryCoreViews(getRefreshTabsAfterTrashRestore(row));
        } catch (error) {
            fail(error, 'Không thể khôi phục phiếu.');
        }
    };

    const forceDeleteTrashSlip = async (row) => {
        if (!window.confirm(`Xóa vĩnh viễn ${trashSlipTypeLabels[row.slip_type_key] || 'phiếu'} ${row.code}?`)) return;

        try {
            if (row.slip_type_key === 'import') {
                await inventoryApi.forceDeleteImport(row.id);
            } else if (row.slip_type_key === 'export') {
                await orderApi.forceDelete(row.id);
            } else {
                await inventoryApi.forceDeleteDocument(row.slip_type_key, row.id);
            }

            showToast({ type: 'success', message: 'Đã xóa vĩnh viễn phiếu.' });
            await refreshInventoryCoreViews(['trash']);
        } catch (error) {
            fail(error, 'Không thể xóa vĩnh viễn phiếu.');
        }
    };

    const restoreSelectedTrashSlips = async () => {
        if (!selectedTrashRows.length) {
            showToast({ type: 'warning', message: 'Hãy chọn ít nhất một phiếu trong thùng rác.' });
            return;
        }

        const groupedRows = selectedTrashRows.reduce((result, row) => {
            if (!result[row.slip_type_key]) result[row.slip_type_key] = [];
            result[row.slip_type_key].push(row.id);
            return result;
        }, {});
        const refreshTabs = Array.from(new Set(selectedTrashRows.flatMap((row) => getRelatedSlipTabs(row.section_key))));

        try {
            const tasks = [];
            if (groupedRows.import?.length) tasks.push(inventoryApi.bulkRestoreImports(groupedRows.import));
            if (groupedRows.export?.length) tasks.push(orderApi.bulkRestore(groupedRows.export));
            if (groupedRows.return?.length) tasks.push(inventoryApi.bulkRestoreDocuments('return', groupedRows.return));
            if (groupedRows.damaged?.length) tasks.push(inventoryApi.bulkRestoreDocuments('damaged', groupedRows.damaged));
            if (groupedRows.adjustment?.length) tasks.push(inventoryApi.bulkRestoreDocuments('adjustment', groupedRows.adjustment));
            await Promise.all(tasks);

            setSelectedSlipIds((prev) => ({ ...prev, trash: {} }));
            showToast({ type: 'success', message: `Đã khôi phục ${formatNumber(selectedTrashRows.length)} phiếu.` });
            await refreshInventoryCoreViews([...refreshTabs, 'trash']);
        } catch (error) {
            fail(error, 'Không thể khôi phục các phiếu đã chọn.');
        }
    };

    const forceDeleteSelectedTrashSlips = async () => {
        if (!selectedTrashRows.length) {
            showToast({ type: 'warning', message: 'Hãy chọn ít nhất một phiếu trong thùng rác.' });
            return;
        }

        if (!window.confirm(`Xóa vĩnh viễn ${formatNumber(selectedTrashRows.length)} phiếu đã chọn?`)) return;

        const groupedRows = selectedTrashRows.reduce((result, row) => {
            if (!result[row.slip_type_key]) result[row.slip_type_key] = [];
            result[row.slip_type_key].push(row.id);
            return result;
        }, {});

        try {
            const tasks = [];
            if (groupedRows.import?.length) tasks.push(inventoryApi.bulkForceDeleteImports(groupedRows.import));
            if (groupedRows.export?.length) tasks.push(orderApi.bulkDelete(groupedRows.export, true));
            if (groupedRows.return?.length) tasks.push(inventoryApi.bulkForceDeleteDocuments('return', groupedRows.return));
            if (groupedRows.damaged?.length) tasks.push(inventoryApi.bulkForceDeleteDocuments('damaged', groupedRows.damaged));
            if (groupedRows.adjustment?.length) tasks.push(inventoryApi.bulkForceDeleteDocuments('adjustment', groupedRows.adjustment));
            await Promise.all(tasks);

            setSelectedSlipIds((prev) => ({ ...prev, trash: {} }));
            showToast({ type: 'success', message: `Đã xóa vĩnh viễn ${formatNumber(selectedTrashRows.length)} phiếu.` });
            await refreshInventoryCoreViews(['trash']);
        } catch (error) {
            fail(error, 'Không thể xóa vĩnh viễn các phiếu đã chọn.');
        }
    };

    const showProductTrackingColumns = productFilters.tracking_mode === '1';
    const productSummaryItems = useMemo(() => {
        if (!productSummary) return [];

        const trackingItems = showProductTrackingColumns ? [
            { label: `Đã đi ${productSummary.tracking_window_days || INVENTORY_TRACKING_WINDOW_DAYS} ngày`, value: formatNumber(productSummary.total_recent_outbound_quantity || 0) },
            { label: 'Dự kiến đi bán', value: formatNumber(productSummary.total_tracking_demand_quantity || 0) },
            { label: 'Mã đang theo dõi', value: formatNumber(productSummary.tracking_active_products || 0) },
            { label: 'Mã cần nhập', value: formatNumber(productSummary.tracking_needs_restock_products || 0) },
        ] : [];

        return [
            { label: 'Tổng số lượng tồn kho', value: formatNumber(productSummary.total_stock ?? productSummary.total_sellable_stock) },
            { label: 'SL chờ xuất', value: formatNumber(productSummary.total_pending_export || 0) },
            { label: 'SL hoàn chờ về', value: formatNumber(productSummary.total_pending_return || 0) },
            { label: 'Có thể bán', value: formatNumber(productSummary.total_actual_stock ?? productSummary.total_sellable_stock ?? 0) },
            ...trackingItems,
            { label: 'Tổng giá trị tồn kho', value: formatCurrency(productSummary.total_inventory_value || 0) },
            { label: 'Tổng mã', value: formatNumber(productSummary.total_products) },
            { label: 'Tổng nhập', value: formatNumber(productSummary.total_imported) },
            { label: 'Tổng xuất', value: formatNumber(productSummary.total_exported) },
            { label: 'Tổng hoàn', value: formatNumber(productSummary.total_returned) },
            { label: 'Tổng hỏng', value: formatNumber(productSummary.total_damaged) },
            { label: 'Điều chỉnh tồn độc lập', value: formatNumber(productSummary.total_adjusted) },
        ];
    }, [productSummary, showProductTrackingColumns]);
    const productTableSummaryCells = useMemo(() => {
        if (!productSummary) return null;

        const totalProducts = productSummary.total_products || productPagination.total || 0;
        return {
            stt: { value: 'Tổng', title: 'Tổng theo bộ lọc hiện tại' },
            product: { value: `${formatNumber(totalProducts)} mã`, title: 'Tổng số mã sản phẩm khớp bộ lọc' },
            total_imported: { value: formatNumber(productSummary.total_imported || 0), title: 'Tổng nhập theo bộ lọc' },
            total_exported: { value: formatNumber(productSummary.total_exported || 0), title: 'Tổng xuất theo bộ lọc' },
            recent_outbound_quantity: { value: showProductTrackingColumns ? formatNumber(productSummary.total_recent_outbound_quantity || 0) : '', title: `Tổng đã đi ${productSummary.tracking_window_days || INVENTORY_TRACKING_WINDOW_DAYS} ngày` },
            total_returned: { value: formatNumber(productSummary.total_returned || 0), title: 'Tổng hoàn theo bộ lọc' },
            total_damaged: { value: formatNumber(productSummary.total_damaged || 0), title: 'Tổng hỏng theo bộ lọc' },
            total_adjusted: { value: formatNumber(productSummary.total_adjusted || 0), title: 'Tổng điều chỉnh tồn theo bộ lọc' },
            computed_stock: { value: formatNumber(productSummary.total_stock ?? 0), title: 'Tổng tồn kho theo bộ lọc', strong: true },
            pending_export_quantity: { value: formatNumber(productSummary.total_pending_export || 0), title: 'Tổng số lượng chờ xuất theo bộ lọc' },
            pending_return_quantity: { value: formatNumber(productSummary.total_pending_return || 0), title: 'Tổng số lượng hoàn chờ về theo bộ lọc' },
            actual_stock: { value: formatNumber(productSummary.total_actual_stock ?? productSummary.total_sellable_stock ?? 0), title: 'Tổng có thể bán theo bộ lọc', strong: true },
            tracking_status: { value: showProductTrackingColumns ? `${formatNumber(productSummary.tracking_needs_restock_products || 0)} cần nhập` : '', title: 'Số mã cần nhập theo bộ lọc' },
            inventory_value: { value: formatCurrency(productSummary.total_inventory_value || 0), title: 'Tổng giá trị tồn kho theo bộ lọc', strong: true },
        };
    }, [productPagination.total, productSummary, showProductTrackingColumns]);

    const supplierSummaryItems = useMemo(() => !supplierSummary ? [] : [
        { label: 'Tổng nhà cung cấp', value: formatNumber(supplierSummary.total_suppliers) },
        { label: 'Tổng phiếu nhập', value: formatNumber(supplierSummary.total_import_slips) },
        { label: 'Tổng số lượng nhập', value: formatNumber(supplierSummary.total_imported_quantity) },
        { label: 'Tổng tiền nhập', value: formatCurrency(supplierSummary.total_imported_amount) },
    ], [supplierSummary]);

    const supplierPriceSummaryItems = useMemo(() => {
        return [
            { label: 'Nhà cung cấp', value: supplierCatalogScopeLabel },
            { label: 'Dòng đã chọn', value: formatNumber(selectedIds.length) },
            { label: 'Dòng đang hiển thị', value: formatNumber(visibleSupplierItemIds.length) },
            { label: 'Dòng đã nhập giá', value: formatNumber(Object.keys(priceDrafts).length) },
        ];
    }, [priceDrafts, selectedIds.length, supplierCatalogScopeLabel, visibleSupplierItemIds.length]);

    const supplierPriceSummaryCards = useMemo(() => {
        const itemRows = supplierRows.filter((row) => row.row_kind === 'item');
        const pricedRows = itemRows.filter((row) => Number(priceDrafts[row.id] ?? row.unit_cost ?? 0) > 0);
        return [
            { label: 'Nhà cung cấp', value: supplierCatalogScopeLabel },
            { label: 'Mã đang hiển thị', value: formatNumber(itemRows.length) },
            { label: 'Đã có giá dự kiến', value: formatNumber(pricedRows.length) },
            { label: 'Chưa có giá', value: formatNumber(Math.max(itemRows.length - pricedRows.length, 0)) },
            { label: 'Đang chọn sửa nhanh', value: formatNumber(selectedIds.length) },
            { label: 'Tổng tiền nhập', value: currentSupplierCatalog ? formatCurrency(currentSupplierCatalog.imported_amount_total || 0) : '-' },
        ];
    }, [currentSupplierCatalog, priceDrafts, selectedIds.length, supplierCatalogScopeLabel, supplierRows]);

    const simpleSummaryMap = useMemo(() => {
        const trashCounts = trashItems.reduce((result, row) => {
            const key = row?.slip_type_key || 'other';
            result[key] = (result[key] || 0) + 1;
            return result;
        }, {});

        return {
            imports: [
                { label: 'Tổng phiếu', value: formatNumber(importPagination.total) },
                { label: 'Số lượng trang', value: formatNumber(imports.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
                { label: 'Tiền trang', value: formatCurrency(imports.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
            ],
            exports: [
                { label: 'Tổng phiếu', value: formatNumber(exportPagination.total) },
                { label: 'Tự tạo từ vận chuyển', value: formatNumber(exportsData.filter((row) => row.export_kind === 'dispatch_auto').length) },
                { label: 'Phiếu tạo tay', value: formatNumber(exportsData.filter((row) => row.export_kind === 'manual').length) },
                { label: 'Số lượng trang', value: formatNumber(exportsData.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            ],
            returns: [
                { label: 'Tổng phiếu', value: formatNumber(returnPagination.total) },
                { label: 'Số lượng trang', value: formatNumber(returnsData.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
                { label: 'Giá trị trang', value: formatCurrency(returnsData.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
            ],
            damaged: [
                { label: 'Tổng phiếu', value: formatNumber(damagedPagination.total) },
                { label: 'Số lượng trang', value: formatNumber(damagedData.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
                { label: 'Giá trị trang', value: formatCurrency(damagedData.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
            ],
            adjustments: [
                { label: 'Tổng phiếu', value: formatNumber(adjustmentPagination.total) },
                { label: 'Chênh lệch trang', value: formatNumber(adjustments.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
                { label: 'Giá trị trang', value: formatCurrency(adjustments.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
            ],
            lots: [
                { label: 'Tổng lô', value: formatNumber(lotPagination.total) },
                { label: 'Tổng số lượng', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.quantity || 0), 0)) },
                { label: 'Còn lại', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0)) },
            ],
            trash: [
                { label: 'Tổng phiếu', value: formatNumber(trashPagination.total) },
                { label: 'Phiếu trên trang', value: formatNumber(trashItems.length) },
                { label: 'Phiếu nhập', value: formatNumber(trashCounts.import || 0) },
                { label: 'Phiếu xuất', value: formatNumber(trashCounts.export || 0) },
                { label: 'Phiếu kho', value: formatNumber((trashCounts.return || 0) + (trashCounts.damaged || 0) + (trashCounts.adjustment || 0)) },
            ],
        };
    }, [adjustmentPagination.total, adjustments, damagedData, damagedPagination.total, exportPagination.total, exportsData, importPagination.total, imports, lotPagination.total, lots, returnPagination.total, returnsData, trashItems, trashPagination.total]);

    const productCell = (row, columnId) => {
        if (columnId === 'select') {
            return (
                <input
                    type="checkbox"
                    checked={Boolean(selectedProductRowsById[String(row.id)])}
                    onChange={(event) => setProductRowSelected(row, event.target.checked)}
                    className={checkboxClass}
                    title="Chọn sản phẩm để điều chỉnh tồn kho"
                />
            );
        }
        if (columnId === 'product') {
            const stockMeta = getProductStockAlertMeta(row);
            const trackingMeta = getProductTrackingMeta(row);
            const trackingDemandQuantity = Number(row.tracking_demand_quantity || 0);
            const skuValue = String(row.sku || '').trim();
            const nameValue = String(row.name || '').trim();
            const copyBaseId = String(row.product_id || row.id || row.sku || row.name || 'product');
            const productId = Number(row?.id || 0);
            const starLoading = importStarLoadingProductIds.includes(productId);
            const productImportStarred = Boolean(row.inventory_import_starred);
            const handleProductStarClick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (starLoading) return;
                void toggleInventoryProductImportStar(row);
            };
            const handleProductCellActivation = () => {
                if (starLoading) return;
                if (productDeclarationModeActive) {
                    void toggleInventoryProductImportStar(row);
                    return;
                }

                openProductDailyOutboundDrawer(row);
            };

            return (
                <div
                    role="button"
                    tabIndex={0}
                    onClick={handleProductCellActivation}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleProductCellActivation();
                        }
                    }}
                    className={`group/productcell w-full rounded-sm text-left transition hover:bg-primary/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${productDeclarationModeActive ? 'bg-amber-50/70 ring-1 ring-amber-200' : ''}`}
                    title={productDeclarationModeActive ? 'Bấm để khai báo hoặc bỏ khỏi lọc nhanh' : 'Bấm để xem hàng đi hàng ngày'}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2">
                                    <span className="truncate font-mono text-[12px] font-black text-primary">{row.sku || 'Chưa có mã'}</span>
                                    <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-black ${stockMeta.badgeClass}`}>{stockMeta.label}</span>
                                    {productDeclarationModeActive ? (
                                        <button
                                            type="button"
                                            onClick={handleProductStarClick}
                                            disabled={starLoading}
                                            className={`inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                                productImportStarred
                                                    ? 'border-amber-300 bg-amber-100 text-amber-800'
                                                    : 'border-primary/15 bg-white text-primary/65 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
                                            }`}
                                            title={productImportStarred ? 'Bỏ khỏi lọc nhanh phiếu nhập' : 'Khai báo sản phẩm vào lọc nhanh phiếu nhập'}
                                        >
                                            <span className="material-symbols-outlined text-[15px]">{productImportStarred ? 'star' : 'star_outline'}</span>
                                            <span>{productImportStarred ? 'Đã lưu' : 'Khai báo'}</span>
                                        </button>
                                    ) : productImportStarred ? (
                                        <span className="material-symbols-outlined text-[16px] text-amber-500" title="Đã khai báo lọc nhanh phiếu nhập">star</span>
                                    ) : null}
                                    {showProductTrackingColumns && trackingDemandQuantity > 0 ? (
                                        <span
                                            className={`rounded-sm border px-2 py-0.5 text-[10px] font-black ${trackingMeta.badgeClass}`}
                                            title={`Đã đi ${formatNumber(row.recent_outbound_quantity || 0)} trong ${row.tracking_window_days || INVENTORY_TRACKING_WINDOW_DAYS} ngày, chờ xuất ${formatNumber(row.pending_export_quantity || 0)}`}
                                        >
                                            {trackingMeta.label}
                                        </span>
                                    ) : null}
                                </div>
                                {skuValue ? (
                                    <button
                                        type="button"
                                        onClick={(event) => { void handleCopyProductCellValue(skuValue, 'mã sản phẩm', event, `${copyBaseId}-sku`); }}
                                        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-all ${copiedProductCellId === `${copyBaseId}-sku` ? 'text-green-600 opacity-100' : 'text-primary/20 opacity-0 group-hover/productcell:opacity-100 hover:text-primary'}`}
                                        title="Sao chép mã sản phẩm"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">{copiedProductCellId === `${copyBaseId}-sku` ? 'check' : 'content_copy'}</span>
                                    </button>
                                ) : null}
                            </div>
                            <div className="mt-1 flex items-start gap-2">
                                <div className="min-w-0 flex-1 whitespace-normal break-words text-[13px] font-semibold leading-[1.35] text-primary" title={row.name || '-'}>
                                    {row.name || '-'}
                                </div>
                                {nameValue ? (
                                    <button
                                        type="button"
                                        onClick={(event) => { void handleCopyProductCellValue(nameValue, 'tên sản phẩm', event, `${copyBaseId}-name`); }}
                                        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-all ${copiedProductCellId === `${copyBaseId}-name` ? 'text-green-600 opacity-100' : 'text-primary/20 opacity-0 group-hover/productcell:opacity-100 hover:text-primary'}`}
                                        title="Sao chép tên sản phẩm"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">{copiedProductCellId === `${copyBaseId}-name` ? 'check' : 'content_copy'}</span>
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        {productDeclarationModeActive ? (
                            <button
                                type="button"
                                onClick={handleProductStarClick}
                                disabled={starLoading}
                                className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-sm border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    productImportStarred
                                        ? 'border-amber-300 bg-amber-100 text-amber-800'
                                        : 'border-primary/15 bg-white text-primary/55 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
                                }`}
                                title={productImportStarred ? 'Bỏ khỏi lọc nhanh phiếu nhập' : 'Khai báo sản phẩm vào lọc nhanh phiếu nhập'}
                            >
                                <span className="material-symbols-outlined text-[20px]">{productImportStarred ? 'star' : 'star_outline'}</span>
                            </button>
                        ) : (
                            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-primary/30 transition group-hover/productcell:text-primary/55">chevron_right</span>
                        )}
                    </div>
                </div>
            );
        }
        if (columnId === 'supplier_unit_cost') return row.supplier_unit_cost != null ? formatImportCost(row.supplier_unit_cost) : '-';
        if (columnId === 'expected_cost') return row.expected_cost != null ? formatImportCost(row.expected_cost) : '-';
        if (columnId === 'current_cost') return row.current_cost != null ? formatImportCost(row.current_cost) : '-';
        if (columnId === 'computed_stock') {
            return <span className="text-[14px] font-black text-primary">{formatNumber(row.computed_stock || 0)}</span>;
        }
        if (columnId === 'pending_export_quantity') {
            const waitingQuantity = Number(row.pending_export_quantity || 0);
            return (
                <span className={`text-[14px] font-black ${waitingQuantity > 0 ? 'text-amber-600' : 'text-primary/45'}`}>
                    {formatNumber(waitingQuantity)}
                </span>
            );
        }
        if (columnId === 'pending_return_quantity') {
            const pendingReturnQuantity = Number(row.pending_return_quantity || 0);
            return (
                <span className={`text-[14px] font-black ${pendingReturnQuantity > 0 ? 'text-sky-600' : 'text-primary/45'}`}>
                    {formatNumber(pendingReturnQuantity)}
                </span>
            );
        }
        if (columnId === 'recent_outbound_quantity') {
            const outboundQuantity = Number(row.recent_outbound_quantity || 0);
            return (
                <span className={`text-[14px] font-black ${outboundQuantity > 0 ? 'text-emerald-700' : 'text-primary/45'}`}>
                    {formatNumber(outboundQuantity)}
                </span>
            );
        }
        if (columnId === 'actual_stock') {
            const stockMeta = getActualStockCellMeta(row);
            return (
                <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-[14px] font-black ${stockMeta.textClass}`}>{formatNumber(row.actual_stock ?? 0)}</span>
                    <span className={`text-[11px] ${stockMeta.key === 'available' ? 'text-primary/45' : 'text-rose-600'}`}>{stockMeta.label}</span>
                </div>
            );
        }
        if (columnId === 'tracking_daily_average') {
            const average = Number(row.tracking_daily_average || 0);
            return (
                <span className={`text-[13px] font-black ${average > 0 ? 'text-primary' : 'text-primary/45'}`}>
                    {average > 0 ? formatOneDecimal(average) : '-'}
                </span>
            );
        }
        if (columnId === 'tracking_stock_coverage_days') {
            const demand = Number(row.tracking_demand_quantity || 0);
            const actualStock = Number(row.actual_stock ?? 0);
            const coverageDays = row.tracking_stock_coverage_days == null ? null : Number(row.tracking_stock_coverage_days);

            if (demand <= 0) {
                return <span className="text-[13px] font-black text-primary/45">-</span>;
            }

            if (actualStock <= 0) {
                return (
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[13px] font-black text-rose-700">0 ngày</span>
                        <span className="text-[11px] text-rose-600">Âm kho</span>
                    </div>
                );
            }

            const textClass = coverageDays !== null && coverageDays < 7
                ? 'text-rose-700'
                : (coverageDays !== null && coverageDays < 15 ? 'text-amber-700' : 'text-emerald-700');

            return (
                <span className={`text-[13px] font-black ${textClass}`}>
                    {coverageDays !== null ? `${formatNumber(coverageDays)} ngày` : '-'}
                </span>
            );
        }
        if (columnId === 'tracking_status') {
            const trackingMeta = getProductTrackingMeta(row);
            return (
                <span className={`inline-flex items-center rounded-sm border px-2 py-1 text-[11px] font-black ${trackingMeta.badgeClass}`}>
                    {trackingMeta.label}
                </span>
            );
        }
        if (columnId === 'inventory_value') {
            if (row.current_cost == null && row.expected_cost == null) return '-';
            return formatCurrency(row.inventory_value);
        }
        if (columnId === 'actions') {
            const productId = Number(row?.id || 0);
            const starLoading = importStarLoadingProductIds.includes(productId);

            return (
            <div className="flex items-center justify-center gap-1.5">
                <button
                    type="button"
                    onClick={() => { void toggleInventoryProductImportStar(row); }}
                    disabled={starLoading}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded-sm border px-2 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        row.inventory_import_starred
                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'border-primary/15 bg-white text-primary hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
                    }`}
                    title={row.inventory_import_starred ? 'Bỏ khỏi lọc nhanh phiếu nhập' : 'Khai báo sản phẩm vào lọc nhanh phiếu nhập'}
                >
                    <span className="material-symbols-outlined text-[17px]">{row.inventory_import_starred ? 'star' : 'star_outline'}</span>
                    <span>{row.inventory_import_starred ? 'Đã lưu' : 'Khai báo'}</span>
                </button>
                <button type="button" onClick={() => openStockAdjustmentModal([row])} className={ghostButton}>Điều chỉnh</button>
            </div>
            );
        }
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const supplierCell = (row, columnId) => {
        if (columnId === 'name') return <button type="button" onClick={() => setSelectedSupplierId(row.id)} className={`w-full text-left ${selectedSupplierId === row.id ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}><CellText primary={row.name} secondary={row.email || row.phone || 'Chưa có liên hệ'} /></button>;
        if (columnId === 'imported_amount_total') return formatCurrency(row.imported_amount_total || 0);
        if (columnId === 'updated_at') return row.updated_at ? formatDateTime(row.updated_at) : '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openSupplierPriceTab(row.id)} className={ghostButton}>Xem</button><button type="button" onClick={() => openEditSupplier(row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteSupplier(row)} className={dangerButton}>Xóa</button></div>;
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const supplierPriceCell = (row, columnId) => {
        if (row.row_kind === 'comparison') {
            if (columnId === 'sku') {
                return <div className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">So sánh giá nhập</div>;
            }
            if (columnId === 'name') {
                return (
                    <div className="space-y-2">
                        <div className="text-[12px] font-bold text-primary/65">
                            {row.name} {row.parent_name ? `| ${row.parent_name}` : ''}
                        </div>
                        {row.comparison_items?.length > 1 ? (
                            <div className="grid gap-2">
                                {row.comparison_items.map((item) => (
                                    <div key={`${row.id}_${item.supplier_id}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 ${item.is_lowest ? 'border-emerald-300 bg-emerald-50' : 'border-primary/10 bg-white'}`}>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-[12px] font-bold text-primary">{item.supplier_name}</span>
                                                {item.supplier_code ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">{item.supplier_code}</span> : null}
                                                {item.is_lowest ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">Rẻ nhất</span> : null}
                                            </div>
                                            <div className="text-[11px] text-primary/45">{item.updated_at ? `Cập nhật ${formatDateTime(item.updated_at)}` : 'Chưa có thời gian cập nhật'}</div>
                                        </div>
                                        <div className={`text-[13px] font-black ${item.is_lowest ? 'text-emerald-700' : 'text-primary'}`}>
                                            {formatImportCost(item.unit_cost)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-[12px] text-primary/55">Chưa đủ dữ liệu để so sánh giữa nhiều nhà cung cấp.</div>
                        )}
                    </div>
                );
            }
            if (columnId === 'supplier_name') {
                return <SupplierNameListCell names={buildSupplierCatalogDisplayNames({ ...row, supplier_price_comparisons: row.comparison_items }, [], selectedSupplierCatalogFilterIds)} />;
            }
            if (columnId === 'actions') {
                return (
                    <button
                        type="button"
                        onClick={() => toggleComparisonRow(row.id)}
                        className={iconButton(false)}
                        title="Ẩn so sánh giá NCC"
                    >
                        <span className="material-symbols-outlined text-[16px]">expand_less</span>
                    </button>
                );
            }
            return '-';
        }

        if (row.row_kind === 'group') {
            const groupSelection = getGroupSelectionState(row.id);
            if (columnId === 'select') {
                return (
                    <div className="flex items-center justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => setExpandedGroups((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-primary/15 text-primary/60 transition hover:border-primary hover:bg-primary/5 hover:text-primary"
                            title={expandedGroups[row.id] ? 'Thu gọn biến thể' : 'Xem biến thể'}
                        >
                            <span className="material-symbols-outlined text-[15px]">{expandedGroups[row.id] ? 'expand_more' : 'chevron_right'}</span>
                        </button>
                        <IndeterminateCheckbox
                            checked={groupSelection.checked}
                            indeterminate={groupSelection.indeterminate}
                            onChange={(event) => markGroupSelected(row.id, event.target.checked)}
                            title="Chọn toàn bộ biến thể của nhóm"
                        />
                    </div>
                );
            }
            if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.category_name || null} mono />;
            if (columnId === 'name') {
                return (
                    <div className="space-y-1">
                        <CellText primary={row.name} secondary={supplierQuickSearch.trim() ? `${formatNumber(row.visible_variant_count || 0)} / ${formatNumber(row.variant_count || 0)} biến thể khớp` : `${formatNumber(row.variant_count || 0)} biến thể`} />
                    </div>
                );
            }
            if (columnId === 'supplier_product_code') {
                return row.supplier_product_code
                    ? <span className="block truncate font-mono text-[12px] font-bold text-primary/80" title={row.supplier_product_code}>{row.supplier_product_code}</span>
                    : <span className="text-[11px] text-primary/35">Theo từng biến thể</span>;
            }
            if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
            if (columnId === 'unit_cost') {
                return (
                    <div className="flex items-center gap-2">
                        <input
                            value={formatRoundedImportCost(groupPriceDrafts[row.id] ?? '')}
                            onChange={(event) => setGroupPriceDrafts((prev) => ({ ...prev, [row.id]: normalizeRoundedImportCostDraft(event.target.value) }))}
                            placeholder="Giá nhóm"
                            className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                            disabled={!hasSpecificSupplierSelection}
                        />
                        <button type="button" onClick={() => applyGroupPrice(row.id)} disabled={!hasSpecificSupplierSelection} className={ghostButton}>Áp nhóm</button>
                    </div>
                );
            }
            if (columnId === 'current_cost') {
                const effectiveCurrentCost = row.current_cost ?? row.display_cost ?? row.expected_cost ?? null;
                return effectiveCurrentCost != null ? formatImportCost(effectiveCurrentCost) : '-';
            }
            if (columnId === 'supplier_name') {
                return <SupplierNameListCell names={buildSupplierCatalogDisplayNames(row, [], selectedSupplierCatalogFilterIds)} />;
            }
            return '-';
        }
        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center gap-2">
                    {row.parent_group_id ? <span className="material-symbols-outlined text-[14px] text-primary/25">subdirectory_arrow_right</span> : null}
                    <input
                        type="checkbox"
                        checked={Boolean(selectedPriceIds[row.id])}
                        onChange={(event) => setItemSelected(row.id, event.target.checked)}
                        className={checkboxClass}
                        title="Chọn dòng giá dự kiến"
                    />
                </div>
            );
        }
        if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.parent_name || row.category_name || null} mono />;
        if (columnId === 'name') {
            const comparableSuppliers = getComparableSupplierCount(row);
            const canCompare = comparableSuppliers > 1;
            const secondaryText = row.parent_name ? `SKU gốc: ${row.parent_sku || '-'}` : (row.category_name || null);

            return (
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-primary">{row.name}</span>
                        {canCompare ? (
                            <button
                                type="button"
                                onClick={() => toggleComparisonRow(row.id)}
                                className={compactIconButton(Boolean(expandedComparisons[row.id]))}
                                title={expandedComparisons[row.id] ? 'Ẩn so sánh giá NCC' : 'So sánh giá NCC'}
                            >
                                <span className="material-symbols-outlined text-[14px] leading-none">{expandedComparisons[row.id] ? 'expand_less' : 'compare_arrows'}</span>
                            </button>
                        ) : null}
                    </div>
                    {secondaryText ? <div className="mt-0.5 truncate text-[11px] text-primary/45">{secondaryText}</div> : null}
                </div>
            );
        }
        if (columnId === 'supplier_product_code') {
            const hasDuplicateSupplierCode = duplicateSupplierCodeIds.has(row.id);

            return (
                <div className="flex items-center gap-2">
                    <input
                        value={codeDrafts[row.id] ?? row.supplier_product_code ?? ''}
                        onChange={(event) => setCodeDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        onBlur={(event) => saveSingleSupplierCode(row, event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                saveSingleSupplierCode(row, event.currentTarget.value);
                            }
                        }}
                        className={`h-8 w-full rounded-sm border px-2 font-mono text-[12px] outline-none ${
                            hasDuplicateSupplierCode
                                ? 'border-rose-300 bg-rose-50 text-rose-700 focus:border-rose-500'
                                : 'border-primary/15 focus:border-primary'
                        }`}
                        disabled={!hasSpecificSupplierSelection}
                        placeholder="Nhập mã NCC"
                        title={hasDuplicateSupplierCode ? 'Mã NCC đang bị trùng trong bảng giá nhà cung cấp này.' : (row.supplier_product_code || '')}
                    />
                    {hasDuplicateSupplierCode ? <span className="shrink-0 text-[11px] font-semibold text-rose-600">Trùng mã</span> : null}
                    {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
                </div>
            );
        }
        if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
        if (columnId === 'current_cost') {
            const effectiveCurrentCost = row.current_cost ?? row.display_cost ?? row.expected_cost ?? null;
                return effectiveCurrentCost != null ? formatImportCost(effectiveCurrentCost) : '-';
        }
        if (columnId === 'supplier_name') {
            return <SupplierNameListCell names={buildSupplierCatalogDisplayNames(row, [], selectedSupplierCatalogFilterIds)} />;
        }
        if (columnId === 'unit_cost') return (
            <div className="flex items-center gap-2">
                <input
                    value={formatRoundedImportCost(priceDrafts[row.id] ?? (row.unit_cost ?? ''))}
                    onChange={(event) => setPriceDrafts((prev) => ({ ...prev, [row.id]: normalizeRoundedImportCostDraft(event.target.value) }))}
                    onBlur={() => saveSingleSupplierPrice(row)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            saveSingleSupplierPrice(row, event.currentTarget.value);
                        }
                    }}
                    className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                    disabled={!hasSpecificSupplierSelection}
                />
                {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
            </div>
        );
        if (columnId === 'updated_at') return row.updated_at ? formatDateTime(row.updated_at) : '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => removeSupplierPrice(row)} disabled={!hasSpecificSupplierSelection || !row.supplier_price_id} className={dangerButton}>{row.supplier_price_id ? 'Xóa' : 'Chưa có giá'}</button></div>;
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const selectedImportInvoiceAttachment = useMemo(() => {
        if (!importInvoiceModal.attachments.length) return null;
        return importInvoiceModal.attachments.find(
            (attachment) => Number(attachment.id) === Number(importInvoiceModal.selectedAttachmentId)
        ) || importInvoiceModal.attachments[0];
    }, [importInvoiceModal.attachments, importInvoiceModal.selectedAttachmentId]);

    const renderImportCell = (row, columnId) => {
        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(selectedSlipIds.imports?.[String(row.id)])}
                        onChange={(event) => setSlipRowSelected('imports', row, event.target.checked)}
                        title="Chọn phiếu nhập để in"
                    />
                </div>
            );
        }
        if (columnId === 'code') return <CellText primary={row.import_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || row.supplier_name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.import_date);
        if (columnId === 'status') {
            const status = row.statusConfig;
            return (
                <div className="space-y-1">
                    <StatusPill label={status?.name || row.status || 'Chưa có trạng thái'} color={status?.color || '#94A3B8'} />
                    <div className="text-[11px] text-primary/45">
                        {row.entry_mode === 'invoice_ai' ? 'AI đọc hóa đơn' : 'Nhập tay'}
                    </div>
                </div>
            );
        }
        if (columnId === 'invoice') {
            const attachmentsCount = Number(row.attachments_count || 0);
            const hasInvoice = Boolean(row.has_purchase_invoice);
            return (
                <div className="flex items-center justify-center">
                    <button
                        type="button"
                        onClick={() => openImportInvoiceModal(row)}
                        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-sm border transition ${
                            hasInvoice
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
                                : 'border-primary/15 bg-white text-primary/65 hover:border-primary hover:bg-primary/[0.05] hover:text-primary'
                        }`}
                        title={hasInvoice ? `Có hóa đơn đầu vào${attachmentsCount ? ` • ${formatNumber(attachmentsCount)} file` : ''}` : 'Không có hóa đơn đầu vào'}
                    >
                        <span className="material-symbols-outlined text-[18px]">{hasInvoice ? 'receipt_long' : 'attach_file'}</span>
                        {attachmentsCount > 0 ? (
                            <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                                {attachmentsCount > 99 ? '99+' : attachmentsCount}
                            </span>
                        ) : null}
                    </button>
                </div>
            );
        }
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'detail') {
            return (
                <div className="flex items-center justify-center">
                    <button
                        type="button"
                        onClick={() => openImportDetail(row)}
                        className={iconButton(false)}
                        title="Xem toàn bộ sản phẩm"
                    >
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                    </button>
                </div>
            );
        }
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditImport(row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteImport(row)} className={dangerButton}>Xóa</button></div>;
        return '-';
    };

    const renderExportCell = (row, columnId) => {
        const isManualExport = row.export_kind === 'manual';
        const sourceLabel = getExportSaleChannelLabel(row.source || (isManualExport ? 'internal' : 'online')) || 'Chưa rõ nguồn';
        const exportKindLabel = row.export_kind_label || (isManualExport ? 'Phiếu tạo tay' : 'Tự tạo từ vận chuyển');
        const exportKindColor = row.export_kind_color || (isManualExport ? '#7C3AED' : '#0F766E');
        const exportKindDescription = row.export_kind_description || (isManualExport ? 'Phiếu xuất nội bộ' : 'Từ đơn hàng đã gửi vận chuyển');
        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(selectedSlipIds.exports?.[String(row.id)])}
                        onChange={(event) => setSlipRowSelected('exports', row, event.target.checked)}
                        disabled={!row.can_delete}
                        title={row.can_delete ? 'Chọn phiếu xuất để xóa' : 'Phiếu xuất tự động không hỗ trợ xóa hàng loạt'}
                    />
                </div>
            );
        }
        if (columnId === 'code') {
            return (
                <CellText
                    primary={row.code || row.order_number}
                    secondary={row.code && row.code !== row.order_number ? `Đơn ${row.order_number}` : exportKindDescription}
                    mono
                />
            );
        }
        if (columnId === 'source') {
            return (
                <div className="space-y-1">
                    <StatusPill label={exportKindLabel} color={exportKindColor} />
                    <div className="text-[11px] text-primary/45">{sourceLabel}</div>
                </div>
            );
        }
        if (columnId === 'customer') {
            const primaryLabel = row.customer_name || (isManualExport ? 'Xuất kho nội bộ' : 'Khách chưa có tên');
            const secondaryParts = [
                row.customer_phone || null,
                row.shipping_address || null,
            ].filter(Boolean);
            return <CellText primary={primaryLabel} secondary={secondaryParts.join(' • ') || sourceLabel} />;
        }
        if (columnId === 'tracking') {
            if (!row.shipping_tracking_code) {
                return <CellText primary="Chưa có mã vận đơn" secondary={row.tracking_helper || (isManualExport ? 'Phiếu tạo tay không cần vận đơn' : 'Sẽ tự lên phiếu khi có mã vận đơn')} />;
            }
            return (
                <CellText
                    primary={row.shipping_tracking_code}
                    secondary={row.shipping_carrier_name || 'Đã gửi sang đơn vị vận chuyển'}
                    mono
                />
            );
        }
        if (columnId === 'date') return formatDateTime(row.exported_at || row.shipping_dispatched_at || row.created_at);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'status') {
            return (
                <div className="space-y-1">
                    <StatusPill label={row.status_pill_label || (isManualExport ? 'Phiếu nội bộ' : 'Đã gửi vận chuyển')} color={exportKindColor} />
                    <div className="text-[11px] text-primary/55">{row.notes || row.status || '-'}</div>
                </div>
            );
        }
        if (columnId === 'actions') {
            return (
                <div className="flex items-center justify-center gap-2">
                    <button type="button" onClick={() => navigate(`/admin/orders/edit/${row.id}`)} className={ghostButton}>{isManualExport ? 'Mở phiếu' : 'Mở đơn'}</button>
                    {row.can_delete ? <button type="button" onClick={() => deleteExport(row)} className={dangerButton}>Xóa</button> : null}
                </div>
            );
        }
        return '-';
    };

    const renderAdjustmentQuantityCell = (row, field) => {
        const lines = Array.isArray(row.adjustment_lines) ? row.adjustment_lines : [];
        if (!lines.length) return <span className="text-[12px] text-primary/45">-</span>;

        return (
            <div className="space-y-1 text-right">
                {lines.map((line) => {
                    const scopeMeta = getAdjustmentQuantityScopeMeta(line.quantity_scope);
                    const label = field === 'old_quantity'
                        ? scopeMeta.oldLabel
                        : field === 'new_quantity'
                            ? scopeMeta.newLabel
                            : 'Chênh lệch';
                    const rawValue = field === 'difference'
                        ? line.difference_quantity
                        : line[field];
                    const value = field === 'difference'
                        ? formatSignedNumber(line.difference_quantity || 0)
                        : (rawValue == null ? '-' : formatNumber(rawValue));
                    const valueClassName = field === 'difference'
                        ? (Number(line.difference_quantity || 0) > 0 ? 'text-emerald-700' : Number(line.difference_quantity || 0) < 0 ? 'text-rose-700' : 'text-primary')
                        : 'text-primary';

                    return (
                        <div key={`${field}_${line.id}`} className="rounded-sm bg-primary/[0.03] px-2 py-1">
                            <div className={`text-[12px] font-black ${valueClassName}`}>{value}</div>
                            <div className="text-[10px] text-primary/45">{label}</div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderAdjustmentCell = (row, columnId) => {
        const lines = Array.isArray(row.adjustment_lines) ? row.adjustment_lines : [];
        const kindMeta = getAdjustmentKindMeta(row.adjustment_kind);
        const sourceMeta = getAdjustmentSourceMeta(row.adjustment_source);
        const differenceValues = lines.map((line) => Number(line.difference_quantity || 0));
        const allPositive = differenceValues.length > 0 && differenceValues.every((value) => value >= 0);
        const allNegative = differenceValues.length > 0 && differenceValues.every((value) => value <= 0);
        const impactLabel = row.adjustment_kind === 'export_adjustment'
            ? 'Sửa dữ liệu xuất'
            : allPositive
                ? 'Cộng trực tiếp vào tồn'
                : allNegative
                    ? 'Trừ trực tiếp vào tồn'
                    : 'Cộng/trừ trực tiếp vào tồn';
        const impactDescription = row.adjustment_kind === 'export_adjustment'
            ? 'Không cộng vào tổng điều chỉnh, bảng tồn tự tính lại theo số xuất mới.'
            : 'Có tính vào cột tổng điều chỉnh của bảng tồn kho.';
        const sourceSecondary = row.adjustment_kind === 'export_adjustment'
            ? [
                row.source_document_number ? `Phiếu hoàn ${row.source_document_number}` : null,
                Array.isArray(row.source_order_numbers) && row.source_order_numbers.length ? row.source_order_numbers.join(', ') : null,
            ].filter(Boolean).join(' • ')
            : sourceMeta.description;

        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(selectedSlipIds.adjustments?.[String(row.id)])}
                        onChange={(event) => setSlipRowSelected('adjustments', row, event.target.checked)}
                        title="Chọn phiếu điều chỉnh"
                    />
                </div>
            );
        }
        if (columnId === 'code') {
            return <CellText primary={row.document_number} secondary={row.notes || null} mono />;
        }
        if (columnId === 'kind') {
            return (
                <div className="space-y-1">
                    <StatusPill label={kindMeta.label} color={kindMeta.color} subtle={kindMeta.subtle} />
                    <div className="text-[11px] text-primary/55">{kindMeta.description}</div>
                </div>
            );
        }
        if (columnId === 'source') {
            return (
                <CellText
                    primary={sourceMeta.label}
                    secondary={sourceSecondary || 'Không có nguồn liên kết'}
                />
            );
        }
        if (columnId === 'product') {
            if (!lines.length) return <span className="text-[12px] text-primary/45">-</span>;
            return (
                <div className="space-y-1">
                    {lines.map((line) => (
                        <CellText
                            key={`product_${line.id}`}
                            primary={line.product_name || '-'}
                            secondary={line.product_sku || null}
                        />
                    ))}
                </div>
            );
        }
        if (columnId === 'old_quantity' || columnId === 'new_quantity') {
            return renderAdjustmentQuantityCell(row, columnId);
        }
        if (columnId === 'difference') {
            return renderAdjustmentQuantityCell(row, 'difference');
        }
        if (columnId === 'impact') {
            return (
                <div className="space-y-1">
                    <div className={`text-[12px] font-black ${row.adjustment_kind === 'export_adjustment' ? 'text-teal-700' : 'text-amber-700'}`}>{impactLabel}</div>
                    <div className="text-[11px] text-primary/55">{impactDescription}</div>
                </div>
            );
        }
        if (columnId === 'date') return formatDateTime(row.document_date);
        if (columnId === 'actions') {
            return (
                <div className="flex items-center justify-center gap-2">
                    {row.adjustment_kind === 'export_adjustment' && row.can_open_source ? (
                        <button type="button" onClick={() => openAdjustmentSource(row)} className={ghostButton}>Mở nguồn</button>
                    ) : (
                        <button type="button" onClick={() => openEditDocument('adjustments', row)} className={ghostButton} disabled={!row.can_edit}>Sửa</button>
                    )}
                    <button type="button" onClick={() => deleteDocument('adjustments', row)} className={dangerButton}>
                        {row.adjustment_kind === 'export_adjustment' ? 'Xóa nguồn' : 'Xóa'}
                    </button>
                </div>
            );
        }
        return '-';
    };

    const renderDocumentCell = (row, columnId, tabKey) => {
        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(selectedSlipIds[tabKey]?.[String(row.id)])}
                        onChange={(event) => setSlipRowSelected(tabKey, row, event.target.checked)}
                        title={`Chọn ${documentTitleMap[tabKey].toLowerCase()}`}
                    />
                </div>
            );
        }
        if (columnId === 'code') return <CellText primary={row.document_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.document_date);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditDocument(tabKey, row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteDocument(tabKey, row)} className={dangerButton}>Xóa</button></div>;
        return '-';
    };

    const renderLotCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.batch_number} mono />;
        if (columnId === 'product') return <CellText primary={row.product?.name || '-'} secondary={row.product?.sku || '-'} />;
        if (columnId === 'date') return formatDateTime(row.received_at);
        if (columnId === 'qty') return formatNumber(row.quantity || 0);
        if (columnId === 'remaining') return formatNumber(row.remaining_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.unit_cost || 0);
        if (columnId === 'source') return row.source_label || row.source_name || row.meta?.source_name || '-';
        return '-';
    };

    const renderTrashCell = (row, columnId) => {
        if (columnId === 'select') {
            return (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(selectedSlipIds.trash?.[getSlipSelectionKey('trash', row)])}
                        onChange={(event) => setSlipRowSelected('trash', row, event.target.checked)}
                        title="Chọn phiếu trong thùng rác"
                    />
                </div>
            );
        }
        if (columnId === 'type') return <CellText primary={trashSlipTypeLabels[row.slip_type_key] || row.slip_type_label || '-'} />;
        if (columnId === 'code') return <CellText primary={row.code || '-'} mono />;
        if (columnId === 'party') return <CellText primary={row.party_name || '-'} secondary={row.secondary_name || null} />;
        if (columnId === 'date') return formatDateTime(row.deleted_at);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') {
            return (
                <div className="flex items-center justify-center gap-2">
                    <button type="button" onClick={() => restoreTrashSlip(row)} className={iconButton(false)} title="Khôi phục phiếu">
                        <span className="material-symbols-outlined text-[18px]">restore_from_trash</span>
                    </button>
                    <button type="button" onClick={() => forceDeleteTrashSlip(row)} className={iconButton(false)} title="Xóa vĩnh viễn">
                        <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                    </button>
                </div>
            );
        }
        return '-';
    };

    const tabRows = { imports, exports: exportsData, returns: returnsData, damaged: damagedData, adjustments, lots, trash: trashItems };
    const tabPagination = { imports: importPagination, exports: exportPagination, returns: returnPagination, damaged: damagedPagination, adjustments: adjustmentPagination, lots: lotPagination, trash: trashPagination };
    const tabLoading = { imports: loading.imports, exports: loading.exports, returns: loading.returns, damaged: loading.damaged, adjustments: loading.adjustments, lots: loading.lots, trash: loading.trash };
    const tabFetch = { imports: fetchImports, exports: fetchExports, returns: (page) => fetchDocuments('return', page), damaged: (page) => fetchDocuments('damaged', page), adjustments: (page) => fetchDocuments('adjustment', page), lots: fetchLots, trash: fetchTrash };

    const renderSimpleTab = (tabKey) => {
        const filters = simpleFilters[tabKey];
        const isImportTab = tabKey === 'imports';
        const isTrashTab = tabKey === 'trash';
        const shouldLiftQuickSearch = isSlipTab(tabKey);
        const selectionState = slipSelectionStates[tabKey] || { checked: false, indeterminate: false, count: 0, total: 0 };
        const columns = isImportTab
            ? importListColumns
            : tabKey === 'exports'
                ? exportListColumns
                : tabKey === 'lots'
                    ? lotColumns
                    : tabKey === 'trash'
                        ? trashListColumns
                        : tabKey === 'returns'
                            ? returnListColumns
                            : tabKey === 'damaged'
                                ? damagedListColumns
                                : adjustmentListColumns;
        const renderCell = isImportTab
            ? renderImportCell
            : tabKey === 'exports'
                ? renderExportCell
                : tabKey === 'adjustments'
                    ? renderAdjustmentCell
                    : tabKey === 'lots'
                        ? renderLotCell
                        : tabKey === 'trash'
                            ? renderTrashCell
                            : (row, columnId) => renderDocumentCell(row, columnId, tabKey);
        const sortMap = tabKey === 'adjustments'
            ? inventorySortColumnMaps.adjustments
            : ['returns', 'damaged'].includes(tabKey)
                ? inventorySortColumnMaps.documents
                : inventorySortColumnMaps[tabKey];
        const simpleFilterChips = [
            buildFilterChip(`${tabKey}_search`, 'Tìm kiếm', filters.search, () => clearSimpleFilter(tabKey, 'search')),
            buildFilterChip(`${tabKey}_date_from`, 'Từ ngày', filters.date_from ? formatPrintDate(filters.date_from) : '', () => clearSimpleFilter(tabKey, 'date_from')),
            buildFilterChip(`${tabKey}_date_to`, 'Đến ngày', filters.date_to ? formatPrintDate(filters.date_to) : '', () => clearSimpleFilter(tabKey, 'date_to')),
            ...(isImportTab ? [
                buildFilterChip(`${tabKey}_status`, 'Trạng thái', filters.inventory_import_status_id ? getImportStatusNameById(filters.inventory_import_status_id) : '', () => clearSimpleFilter(tabKey, 'inventory_import_status_id')),
                buildFilterChip(`${tabKey}_entry_mode`, 'Cách tạo', filters.entry_mode ? filterOptionLabel(importEntryModeFilterOptions, filters.entry_mode) : '', () => clearSimpleFilter(tabKey, 'entry_mode')),
                buildFilterChip(`${tabKey}_has_invoice`, 'Hóa đơn', filters.has_invoice ? filterOptionLabel(importHasInvoiceFilterOptions, filters.has_invoice) : '', () => clearSimpleFilter(tabKey, 'has_invoice')),
            ] : []),
            ...(tabKey === 'exports' ? [
                buildFilterChip(`${tabKey}_export_kind`, 'Nguồn xuất', filters.export_kind ? filterOptionLabel(exportKindFilterOptions, filters.export_kind) : '', () => clearSimpleFilter(tabKey, 'export_kind')),
            ] : []),
        ].filter(Boolean);
        const quickSearchControl = (
            <div className="relative w-full sm:w-[220px] sm:min-w-[220px]">
                <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                <input
                    value={filters.search}
                    onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: event.target.value } }))}
                    placeholder="Tìm nhanh"
                    className={`w-full pl-9 ${inputClass}`}
                />
            </div>
        );
        const extraActions = (
            <>
                {isImportTab ? (
                    <>
                        <button type="button" onClick={openImportStatusManager} className={ghostButton}>Trạng thái</button>
                        <button type="button" onClick={openCreateImport} className={primaryButton}>Tạo phiếu</button>
                    </>
                ) : null}
                {tabKey === 'exports' ? <button type="button" onClick={openCreateExport} className={primaryButton}>Tạo phiếu</button> : null}
                {['returns', 'damaged', 'adjustments'].includes(tabKey) ? <button type="button" onClick={() => openCreateDocument(tabKey)} className={primaryButton}>Tạo phiếu</button> : null}
            </>
        );
        const toolbarToggles = [
            { id: `${tabKey}_filters`, icon: 'filter_alt', label: 'Bộ lọc', active: openPanels[tabKey].filters, onClick: () => togglePanel(tabKey, 'filters') },
            ...(isSlipTab(tabKey) ? [{
                id: `${tabKey}_select`,
                icon: selectionState.checked ? 'check_box' : selectionState.indeterminate ? 'indeterminate_check_box' : 'check_box_outline_blank',
                label: selectionState.checked ? 'Bỏ chọn trang hiện tại' : 'Chọn trang hiện tại',
                disabledTitle: 'Không có phiếu khả dụng trên trang hiện tại',
                active: selectionState.count > 0,
                disabled: selectionState.total === 0,
                onClick: () => toggleAllSlipSelections(tabKey, !selectionState.checked),
            }] : []),
            ...(isImportTab ? [{
                id: `${tabKey}_print`,
                icon: 'print',
                label: `In ${formatNumber(selectionState.count)} phiếu đã chọn`,
                disabledTitle: 'Hãy chọn ít nhất một phiếu nhập để in',
                active: selectionState.count > 0,
                disabled: importPrintLoading || selectionState.count === 0,
                onClick: openSelectedImportsPrintModal,
            }] : []),
            ...(isSlipTab(tabKey) && !isTrashTab ? [{
                id: `${tabKey}_delete_selected`,
                icon: 'delete_sweep',
                label: `Xóa ${formatNumber(selectionState.count)} phiếu đã chọn`,
                disabledTitle: 'Hãy chọn ít nhất một phiếu để xóa',
                active: selectionState.count > 0,
                disabled: selectionState.count === 0,
                onClick: () => bulkDeleteSelectedSlips(tabKey),
            }, {
                id: `${tabKey}_open_trash`,
                icon: 'delete',
                label: 'Mở thùng rác phiếu',
                active: false,
                onClick: () => goToTab('trash'),
            }] : []),
            ...(isTrashTab ? [{
                id: `${tabKey}_restore_selected`,
                icon: 'restore_from_trash',
                label: `Khôi phục ${formatNumber(selectionState.count)} phiếu`,
                disabledTitle: 'Hãy chọn ít nhất một phiếu để khôi phục',
                active: selectionState.count > 0,
                disabled: selectionState.count === 0,
                onClick: restoreSelectedTrashSlips,
            }, {
                id: `${tabKey}_force_delete_selected`,
                icon: 'delete_forever',
                label: `Xóa vĩnh viễn ${formatNumber(selectionState.count)} phiếu`,
                disabledTitle: 'Hãy chọn ít nhất một phiếu để xóa vĩnh viễn',
                active: selectionState.count > 0,
                disabled: selectionState.count === 0,
                onClick: forceDeleteSelectedTrashSlips,
            }] : []),
            { id: `${tabKey}_stats`, icon: 'monitoring', label: 'Thống kê', active: openPanels[tabKey].stats, onClick: () => togglePanel(tabKey, 'stats') },
            { id: `${tabKey}_columns`, icon: 'view_column', label: 'Cài đặt cột', active: openPanels[tabKey].columns, onClick: () => togglePanel(tabKey, 'columns') },
        ];
        const filterPanel = openPanels[tabKey].filters ? (
            <FilterPanel actions={<button type="button" onClick={() => tabFetch[tabKey](1)} className={primaryButton}>Lọc</button>}>
                {!shouldLiftQuickSearch ? quickSearchControl : null}
                <input type="date" value={filters.date_from} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_from: event.target.value } }))} className={`w-[145px] ${inputClass}`} />
                <input type="date" value={filters.date_to} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_to: event.target.value } }))} className={`w-[145px] ${inputClass}`} />
                {isImportTab ? (
                    <>
                        <select value={filters.inventory_import_status_id} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, inventory_import_status_id: event.target.value } }))} className={`w-[190px] ${selectClass}`}>
                            <option value="">Tất cả trạng thái</option>
                            {importStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                        </select>
                        <select value={filters.entry_mode} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, entry_mode: event.target.value } }))} className={`w-[170px] ${selectClass}`}>
                            <option value="">Tất cả cách tạo</option>
                            <option value="manual">Nhập tay</option>
                            <option value="invoice_ai">AI đọc hóa đơn</option>
                        </select>
                        <select value={filters.has_invoice} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, has_invoice: event.target.value } }))} className={`w-[180px] ${selectClass}`}>
                            <option value="">Tất cả hóa đơn</option>
                            <option value="with_invoice">Đã có hóa đơn</option>
                            <option value="without_invoice">Chưa có hóa đơn</option>
                        </select>
                    </>
                ) : null}
                {tabKey === 'exports' ? (
                    <select value={filters.export_kind} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, exports: { ...prev.exports, export_kind: event.target.value } }))} className={`w-[190px] ${selectClass}`}>
                        <option value="">Tất cả nguồn xuất</option>
                        {exportKindFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                ) : null}
            </FilterPanel>
        ) : null;

        return (
            <div className="space-y-3">
                <div className={panelClass}>
                    <PanelHeader
                        title={tabKey === 'imports' ? 'Danh sách phiếu nhập' : tabKey === 'exports' ? 'Danh sách phiếu xuất bán' : tabKey === 'lots' ? 'Danh sách lô hàng' : tabKey === 'trash' ? 'Thùng rác phiếu' : documentTitleMap[tabKey]}
                        leadingActions={shouldLiftQuickSearch ? quickSearchControl : null}
                        activeFilterChips={simpleFilterChips}
                        onClearAllFilters={simpleFilterChips.length ? () => clearAllSimpleFilters(tabKey) : null}
                        toggles={toolbarToggles}
                        actions={extraActions}
                    />
                    {filterPanel}
                    {openPanels[tabKey].stats ? <SummaryPanel items={simpleSummaryMap[tabKey] || []} /> : null}
                    <InventoryTable storageKey={isImportTab ? `inventory_imports_table_${inventoryTableStorageVersion}_selection_v1` : `inventory_${tabKey}_table_${inventoryTableStorageVersion}`} columns={columns} rows={tabRows[tabKey]} renderCell={renderCell} loading={tabLoading[tabKey]} pagination={tabPagination[tabKey]} onPageChange={tabFetch[tabKey]} footer={isSlipTab(tabKey) ? `Kết quả: ${formatNumber(tabPagination[tabKey].total)} • Đã chọn: ${formatNumber(selectionState.count)} phiếu` : `Kết quả: ${formatNumber(tabPagination[tabKey].total)}`} rowKey={tabKey === 'trash' ? (row) => getSlipSelectionKey('trash', row) : 'id'} settingsOpen={openPanels[tabKey].columns} onCloseSettings={() => togglePanel(tabKey, 'columns')} currentPerPage={pageSizes[tabKey]} onPerPageChange={(value) => {
                        const nextSize = updatePageSize(tabKey, value);
                        if (tabKey === 'returns') return fetchDocuments('return', 1, nextSize);
                        if (tabKey === 'damaged') return fetchDocuments('damaged', 1, nextSize);
                        if (tabKey === 'adjustments') return fetchDocuments('adjustment', 1, nextSize);
                        return tabFetch[tabKey](1, nextSize);
                    }} sortConfig={sortConfigs[tabKey]} onSort={(columnId) => handleTableSort(tabKey, columnId)} sortColumnMap={sortMap} onRowDoubleClick={isImportTab ? openEditImport : undefined} />
                </div>
            </div>
        );
    };

    const productQuickSearchControl = (
        <>
            <div ref={productSearchContainerRef} className="relative w-[250px] min-w-[250px]">
                <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                <input
                    value={productFilters.search}
                    onChange={(event) => {
                        updateProductFilterValue('search', event.target.value);
                        setProductSearchHistoryOpen(false);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setProductSearchHistoryOpen(false);
                            return;
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            rememberProductSearch(productFilters.search);
                            applyProductFilters(productFilters);
                        }
                    }}
                    placeholder="Tìm nhanh mã hoặc tên"
                    className={`w-full pl-8 pr-16 ${inputClass}`}
                />
                <button
                    type="button"
                    onClick={() => setProductSearchHistoryOpen((prev) => !prev)}
                    className={`absolute right-8 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm transition ${
                        productSearchHistoryOpen
                            ? 'bg-primary/[0.08] text-primary'
                            : 'text-primary/35 hover:bg-primary/[0.05] hover:text-primary'
                    }`}
                    title="Lịch sử tìm kiếm"
                >
                    <span className="material-symbols-outlined text-[18px]">history</span>
                </button>
                <button
                    type="button"
                    onClick={clearProductQuickSearch}
                    disabled={!productFilters.search}
                    className="absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-primary/35 transition hover:bg-primary/[0.05] hover:text-brick disabled:cursor-not-allowed disabled:opacity-30"
                    title="Xóa từ khóa"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
                {productSearchHistoryOpen ? (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-[120] w-[320px] overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-primary/10 bg-[#f8fbff] px-3 py-2">
                            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Lịch sử tìm kiếm</div>
                            {productSearchHistory.length ? (
                                <button type="button" onClick={clearProductSearchHistory} className="text-[11px] font-bold text-brick hover:underline">
                                    Xóa hết
                                </button>
                            ) : null}
                        </div>
                        {productSearchHistory.length ? (
                            <div className="max-h-[280px] overflow-auto p-1.5">
                                {productSearchHistory.map((item) => (
                                    <div key={`product_search_history_${item}`} className="group flex items-center gap-1 rounded-sm px-2 py-1.5 transition hover:bg-primary/[0.04]">
                                        <button
                                            type="button"
                                            onClick={() => applyProductSearchHistoryItem(item)}
                                            className="min-w-0 flex flex-1 items-center gap-2 text-left text-[12px] font-bold text-primary"
                                            title={item}
                                        >
                                            <span className="material-symbols-outlined text-[16px] text-primary/35">history</span>
                                            <span className="truncate">{item}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => removeProductSearchHistoryItem(item, event)}
                                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-primary/35 opacity-0 transition hover:bg-brick/10 hover:text-brick group-hover:opacity-100"
                                            title="Xóa khỏi lịch sử"
                                        >
                                            <span className="material-symbols-outlined text-[17px]">close</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="px-3 py-4 text-[12px] font-semibold text-primary/45">Chưa có lịch sử tìm kiếm.</div>
                        )}
                    </div>
                ) : null}
            </div>
            <button
                type="button"
                onClick={toggleProductDeclarationMode}
                className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border px-3 text-[12px] font-black transition ${
                    productDeclarationModeActive
                        ? 'border-amber-300 bg-amber-100 text-amber-800 shadow-sm'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100'
                }`}
                title={productDeclarationModeActive ? 'Tắt chế độ khai báo lọc nhanh' : 'Bật chế độ khai báo sản phẩm lọc nhanh'}
            >
                <span className="material-symbols-outlined text-[17px]">star</span>
                <span className="truncate">{productDeclarationModeActive ? 'Đang khai báo' : 'Khai báo'}</span>
            </button>
        </>
    );

    const productListColumns = useMemo(
        () => {
            const columnDefs = showProductTrackingColumns
                ? productColumns
                : productColumns.filter((column) => !productTrackingColumnIds.has(column.id));

            return columnDefs.map((column) => (
                column.id === 'select'
                    ? {
                        ...column,
                        headerRender: () => (
                            <IndeterminateCheckbox
                                checked={productPageSelectionState.checked}
                                indeterminate={productPageSelectionState.indeterminate}
                                onChange={(event) => setVisibleProductsSelected(event.target.checked)}
                                disabled={productPageSelectionState.total === 0}
                                title="Chọn tất cả sản phẩm trên trang hiện tại"
                            />
                        ),
                    }
                    : column
            ));
        },
        [productPageSelectionState, showProductTrackingColumns]
    );

    const refreshProductsTable = () => fetchProducts(
        productPagination.current_page || 1,
        pageSizes.products,
        sortConfigs.products,
        productFilters
    );

    const productsTabContent = (
        <div className={`${panelClass} flex min-h-0 flex-1 flex-col`}>
            <PanelHeader
                title="Tồn kho"
                leadingActions={productQuickSearchControl}
                activeFilterChips={productFilterChips}
                activeFilterPlacement="toolbar"
                onClearAllFilters={productFilterChips.length ? clearAllProductFilters : null}
                toggles={[
                    { id: 'products_refresh', icon: 'refresh', label: 'Làm mới', active: loading.products, disabled: loading.products, disabledTitle: 'Đang làm mới dữ liệu', onClick: refreshProductsTable },
                    { id: 'products_import_quick_filter', icon: productQuickFilterActive ? 'flash_on' : 'flash_off', label: productQuickFilterActive ? 'Tắt chỉ hiện sản phẩm lọc nhanh' : 'Chỉ hiện sản phẩm lọc nhanh', active: productQuickFilterActive, onClick: toggleProductImportQuickFilter },
                    { id: 'products_tracking', icon: 'trending_up', label: `Mã cần theo dõi ${INVENTORY_TRACKING_WINDOW_DAYS} ngày`, active: productFilters.tracking_mode === '1', onClick: toggleProductTrackingMode },
                    { id: 'products_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.products.filters, onClick: () => togglePanel('products', 'filters') },
                    { id: 'products_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.products.stats, onClick: () => togglePanel('products', 'stats') },
                    { id: 'products_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.products.columns, onClick: () => togglePanel('products', 'columns') },
                ]}
                actions={(
                    <div className="flex items-center gap-2">
                        {selectedProductRows.length ? (
                            <button type="button" onClick={() => setSelectedProductRowsById({})} className={ghostButton}>
                                Bỏ chọn {formatNumber(selectedProductRows.length)}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => openStockAdjustmentModal()}
                            className={primaryButton}
                            disabled={!selectedProductRows.length}
                            title={selectedProductRows.length ? 'Điều chỉnh tồn kho các sản phẩm đã chọn' : 'Hãy chọn ít nhất một sản phẩm'}
                        >
                            Điều chỉnh tồn kho
                        </button>
                    </div>
                )}
            />
            {openPanels.products.filters ? (
                <FilterPanel
                    singleLine
                    actions={(
                        <>
                            {selectedProductRows.length ? (
                                <button
                                    type="button"
                                    onClick={() => saveCurrentProductFilterPreset({ onlySelectedProducts: true })}
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-sm border border-primary/15 bg-primary px-2 text-[12px] font-bold text-white transition hover:bg-primary/90"
                                    title={`Lưu tìm kiếm chỉ gồm ${formatNumber(selectedProductRows.length)} mã đang chọn`}
                                >
                                    <span className="material-symbols-outlined text-[18px]">playlist_add_check</span>
                                    {`Lưu ${formatNumber(selectedProductRows.length)} mã`}
                                </button>
                            ) : (
                                <button type="button" onClick={saveCurrentProductFilterPreset} className="inline-flex h-8 items-center justify-center gap-1 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-bold text-primary transition hover:border-primary hover:bg-primary/5">
                                    <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
                                    Lưu
                                </button>
                            )}
                        </>
                    )}
                >
                    <div className="flex shrink-0 items-center gap-1.5">
                        <ProductSavedSearchSelect
                            presets={productFilterPresets}
                            selectedId={selectedProductFilterPresetId}
                            onSelect={(presetId) => {
                                if (!presetId) {
                                    setSelectedProductFilterPresetId('');
                                    return;
                                }
                                applyProductFilterPreset(presetId);
                            }}
                            onRename={renameSelectedProductFilterPreset}
                            onDelete={deleteSelectedProductFilterPreset}
                            className="w-[170px]"
                        />
                    </div>
                    <InventoryMultiSelectFilter
                        value={productFilters.status}
                        onChange={(value) => updateProductFilterValue('status', value)}
                        options={productStatusFilterOptions}
                        placeholder="Tất cả trạng thái bán"
                        className="w-[135px] shrink-0"
                    />
                    <InventoryMultiSelectFilter
                        value={productFilters.cost_source}
                        onChange={(value) => updateProductFilterValue('cost_source', value)}
                        options={productCostSourceFilterOptions}
                        placeholder="Tất cả trạng thái giá"
                        className="w-[145px] shrink-0"
                    />
                    <InventoryMultiSelectFilter
                        value={productFilters.stock_alert}
                        onChange={(value) => updateProductFilterValue('stock_alert', value)}
                        options={productStockAlertFilterOptions}
                        placeholder="Tất cả tồn kho"
                        className="w-[130px] shrink-0"
                    />
                    <InventoryMultiSelectFilter
                        value={productFilters.type}
                        onChange={(value) => updateProductFilterValue('type', value)}
                        options={productTypeFilterOptions}
                        placeholder="Tất cả loại sản phẩm"
                        className="w-[145px] shrink-0"
                    />
                    <InventoryMultiSelectFilter
                        value={productFilters.category_id}
                        onChange={(value) => updateProductFilterValue('category_id', value)}
                        options={productCategoryFilterOptions}
                        placeholder="Tất cả danh mục"
                        className="w-[165px] shrink-0"
                        menuClassName="w-[360px]"
                        searchable
                    />
                    <InventoryMultiSelectFilter
                        value={productFilters.variant_scope}
                        onChange={(value) => updateProductFilterValue('variant_scope', value)}
                        options={productVariantScopeFilterOptions}
                        placeholder="Có biến thể / không"
                        className="w-[150px] shrink-0"
                    />
                    <select value={productFilters.tracking_mode} onChange={(event) => updateProductFilterValue('tracking_mode', event.target.value)} className={`w-[130px] shrink-0 ${selectClass}`}>
                        <option value="">Tất cả mã</option>
                        <option value="1">Mã cần theo dõi 15 ngày</option>
                    </select>
                    {productFilters.tracking_mode === '1' ? (
                        <input
                            type="text"
                            inputMode="decimal"
                            value={productFilters.tracking_daily_min}
                            onChange={(event) => updateProductFilterValue('tracking_daily_min', normalizeDecimalFilterDraft(event.target.value), { autoApply: false })}
                            onBlur={() => updateProductFilterValue('tracking_daily_min', productFilters.tracking_daily_min || defaultProductFilters.tracking_daily_min)}
                            placeholder="TB/ngày từ 1"
                            className={`w-[105px] shrink-0 ${inputClass}`}
                            title="Lọc mã có TB/ngày từ số này trở lên"
                        />
                    ) : null}
                    <input type="date" value={productFilters.date_from} onChange={(event) => updateProductFilterValue('date_from', event.target.value)} className={`w-[120px] shrink-0 ${inputClass}`} />
                    <input type="date" value={productFilters.date_to} onChange={(event) => updateProductFilterValue('date_to', event.target.value)} className={`w-[120px] shrink-0 ${inputClass}`} />
                </FilterPanel>
            ) : null}
            {openPanels.products.stats ? <SummaryPanel items={productSummaryItems} /> : null}
            <InventoryTable
                storageKey={`inventory_products_table_stock_v4_${inventoryTableStorageVersion}`}
                columns={productListColumns}
                rows={products}
                renderCell={productCell}
                loading={loading.products}
                pagination={productPagination}
                onPageChange={fetchProducts}
                footer={`Kết quả: ${formatNumber(productPagination.total)} mã`}
                settingsOpen={openPanels.products.columns}
                onCloseSettings={() => togglePanel('products', 'columns')}
                currentPerPage={pageSizes.products}
                onPerPageChange={(value) => fetchProducts(1, updatePageSize('products', value))}
                sortConfig={sortConfigs.products}
                onSort={(columnId) => handleTableSort('products', columnId)}
                sortColumnMap={inventorySortColumnMaps.products}
                summaryCells={productTableSummaryCells}
                wrapperClassName="flex min-h-0 flex-1 flex-col"
                viewportClassName={stretchedTableViewportClass}
                headerTextClassName="text-[14px]"
            />
        </div>
    );

    const suppliersTabContent = (
        <div className={panelClass}>
            <PanelHeader
                title="Quản lý nhà cung cấp"
                description="Chọn một nhà cung cấp rồi bấm Xem để mở trang giá nhập riêng."
                activeFilterChips={supplierFilterChips}
                onClearAllFilters={supplierFilterChips.length ? clearAllSupplierFilters : null}
                toggles={[
                    { id: 'suppliers_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.suppliers.filters, onClick: () => togglePanel('suppliers', 'filters') },
                    { id: 'suppliers_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.suppliers.stats, onClick: () => togglePanel('suppliers', 'stats') },
                    { id: 'suppliers_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.suppliers.columns, onClick: () => togglePanel('suppliers', 'columns') },
                ]}
                actions={<button type="button" onClick={openCreateSupplier} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>Thêm nhà cung cấp</button>}
            />
            {openPanels.suppliers.filters ? (
                <FilterPanel actions={<button type="button" onClick={() => fetchSuppliers(1)} className={primaryButton}>Lọc</button>}>
                    <input value={supplierFilters.search} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Tìm nhà cung cấp" className={`w-[220px] ${inputClass}`} />
                    <select value={supplierFilters.status} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, status: event.target.value }))} className={`w-[150px] ${selectClass}`}>
                        <option value="">Tất cả trạng thái</option>
                        <option value="1">Đang dùng</option>
                        <option value="0">Ngừng dùng</option>
                    </select>
                    <input type="month" value={supplierFilters.month} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, month: event.target.value }))} className={`w-[155px] ${inputClass}`} />
                    <input type="date" value={supplierFilters.date_from} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={`w-[145px] ${inputClass}`} />
                    <input type="date" value={supplierFilters.date_to} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={`w-[145px] ${inputClass}`} />
                </FilterPanel>
            ) : null}
            {openPanels.suppliers.stats ? <SummaryPanel items={supplierSummaryItems} /> : null}
            <InventoryTable
                storageKey={`inventory_suppliers_table_${inventoryTableStorageVersion}`}
                columns={supplierManagementColumns}
                rows={suppliers}
                renderCell={supplierCell}
                loading={loading.suppliers}
                pagination={supplierPagination}
                onPageChange={fetchSuppliers}
                footer={`Kết quả: ${formatNumber(supplierPagination.total)} nhà cung cấp`}
                settingsOpen={openPanels.suppliers.columns}
                onCloseSettings={() => togglePanel('suppliers', 'columns')}
                currentPerPage={pageSizes.suppliers}
                onPerPageChange={(value) => fetchSuppliers(1, updatePageSize('suppliers', value))}
                sortConfig={sortConfigs.suppliers}
                onSort={(columnId) => handleTableSort('suppliers', columnId)}
                sortColumnMap={inventorySortColumnMaps.suppliers}
            />
            {currentSupplier ? (
                <div className="border-t border-primary/10 bg-[#fbfcfe] px-3 py-3">
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Nhà cung cấp</div>
                            <div className="mt-1 text-[14px] font-black text-primary">{currentSupplier.name}</div>
                            <div className="text-[11px] text-primary/45">{currentSupplier.code || 'Chưa có mã'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Liên hệ</div>
                            <div className="mt-1 text-[13px] font-semibold text-primary">{currentSupplier.phone || 'Chưa có số điện thoại'}</div>
                            <div className="truncate text-[11px] text-primary/45">{currentSupplier.email || 'Chưa có email'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Địa chỉ</div>
                            <div className="mt-1 text-[12px] font-semibold text-primary">{currentSupplier.address || 'Chưa có địa chỉ'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chú</div>
                            <div className="mt-1 text-[12px] text-primary/70">{currentSupplier.notes || 'Chưa có ghi chú'}</div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );

    const supplierPricesTabContent = (
        <div className={panelClass}>
            <PanelHeader
                title={supplierCatalogTitle}
                description={supplierCatalogDescription}
                activeFilterChips={supplierCatalogFilterChips}
                onClearAllFilters={supplierCatalogFilterChips.length ? clearAllSupplierCatalogFilters : null}
                actions={
                    <>
                        <div className="relative w-[220px] min-w-[220px]">
                            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                            <input
                                value={supplierQuickSearch}
                                onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                placeholder="Tìm SKU / tên / mã NCC"
                                disabled={!hasSupplierCatalogSelection}
                                className={`w-full pl-9 ${inputClass}`}
                            />
                        </div>
<input value={formatRoundedImportCost(bulkPrice)} onChange={(event) => setBulkPrice(normalizeRoundedImportCostDraft(event.target.value))} placeholder="Giá áp chọn" disabled={!hasSpecificSupplierSelection} className={`w-[125px] ${inputClass}`} />
                        <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!hasSpecificSupplierSelection} className={ghostButton}>{showPasteBox ? 'Ẩn dán nhanh' : 'Dán nhanh'}</button>
                        <button type="button" onClick={applyBulkPrice} disabled={!hasSpecificSupplierSelection || !selectedIds.length} className={ghostButton}>Áp giá chọn</button>
                        <button type="button" onClick={refreshSupplierCatalog} disabled={!hasSupplierCatalogSelection || loading.supplierCatalog} className={ghostButton}><span className={`material-symbols-outlined text-[18px] ${loading.supplierCatalog ? 'animate-spin' : ''}`}>refresh</span>Làm mới</button>
                        {[
                            { id: 'supplierPrices_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.supplierPrices.filters, onClick: () => togglePanel('supplierPrices', 'filters') },
                            { id: 'supplierPrices_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.supplierPrices.stats, onClick: () => togglePanel('supplierPrices', 'stats') },
                            { id: 'supplierPrices_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.supplierPrices.columns, onClick: () => togglePanel('supplierPrices', 'columns') },
                        ].map((toggle) => (
                            <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                                <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                            </button>
                        ))}
                    </>
                }
            />
            {openPanels.supplierPrices.filters ? (
                <FilterPanel actions={<button type="button" onClick={() => fetchSupplierCatalog(1)} className={primaryButton}>Lọc</button>}>
                    <SupplierMultiSelectFilter
                        suppliers={suppliers}
                        value={supplierCatalogFilters.supplier_ids}
                        onChange={(nextSupplierIds) => setSupplierCatalogFilters((prev) => ({ ...prev, supplier_ids: nextSupplierIds }))}
                        disabled={loading.suppliers && suppliers.length === 0}
                        placeholder={loading.suppliers && suppliers.length === 0 ? 'Đang tải nhà cung cấp' : 'Tất cả'}
                    />
                    <input value={supplierCatalogFilters.sku} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, sku: event.target.value }))} placeholder="Lọc theo mã SP / mã NCC" className={`w-[170px] ${inputClass}`} />
                    <input value={supplierCatalogFilters.name} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, name: event.target.value }))} placeholder="Lọc theo tên sản phẩm" className={`w-[180px] ${inputClass}`} />
                    <select value={supplierCatalogFilters.category_id} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                    <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option>{productTypeFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                    <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả biến thể</option><option value="no_variants">Sản phẩm thường</option><option value="only_variants">Biến thể</option><option value="has_variants">Nhóm có biến thể</option><option value="roots">Nhóm gốc</option></select>
                    <select value={supplierCatalogFilters.missing_supplier_price} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, missing_supplier_price: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả trạng thái giá</option><option value="1">Chưa có giá nhập</option></select>
                    <select value={supplierCatalogFilters.multiple_suppliers} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, multiple_suppliers: event.target.value }))} className={`w-[180px] ${selectClass}`}><option value="">Tất cả nguồn nhập</option><option value="1">Có nhiều nhà cung cấp</option></select>
                </FilterPanel>
            ) : null}
            {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
            {showPasteBox ? (
                <div className="border-b border-primary/10 px-3 py-2.5">
                    <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] text-primary/55">{currentPasteModeConfig.hint}</div>
                        <select
                            value={pasteMode}
                            onChange={(event) => setPasteMode(event.target.value)}
                            className={`w-full lg:w-[220px] ${selectClass}`}
                        >
                            {Object.entries(supplierPasteModeConfigs).map(([value, config]) => (
                                <option key={value} value={value}>{config.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex gap-3">
                        <textarea
                            value={pasteText}
                            onChange={(event) => setPasteText(event.target.value)}
                            className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary"
                            placeholder={currentPasteModeConfig.placeholder}
                        />
                        <button type="button" onClick={applyPaste} className={primaryButton}>{currentPasteModeConfig.actionLabel}</button>
                    </div>
                </div>
            ) : null}
            <InventoryTable
                storageKey={`inventory_supplier_prices_table_${inventoryTableStorageVersion}`}
                columns={supplierPriceColumns}
                rows={supplierRows}
                renderCell={supplierPriceCell}
                loading={loading.supplierCatalog}
                pagination={supplierCatalogPagination}
                onPageChange={fetchSupplierCatalog}
                footer={`Hiển thị ${formatNumber(visibleSupplierItemIds.length)} / ${formatNumber(supplierCatalogPagination.total)} dòng giá`}
                rowKey="row_id"
                rowClassName={(row) => {
                    if (row.row_kind === 'comparison') return 'bg-[#fff8eb]';
                    if (row.parent_group_id) return selectedPriceIds[row.id] ? 'bg-sky-100 hover:bg-sky-100' : 'bg-slate-100 hover:bg-slate-100';
                    if (selectedPriceIds[row.id]) return 'bg-primary/[0.04] hover:bg-primary/[0.06]';
                    return 'hover:bg-primary/[0.02]';
                }}
                onRowDoubleClick={openSupplierCatalogProductEditor}
                settingsOpen={openPanels.supplierPrices.columns}
                onCloseSettings={() => togglePanel('supplierPrices', 'columns')}
                currentPerPage={pageSizes.supplierPrices}
                onPerPageChange={(value) => fetchSupplierCatalog(1, updatePageSize('supplierPrices', value))}
                sortConfig={sortConfigs.supplierPrices}
                onSort={(columnId) => handleTableSort('supplierPrices', columnId)}
                sortColumnMap={inventorySortColumnMaps.supplierPrices}
            />
        </div>
    );

    const getSlipSelectionKey = (tabKey, row) => (
        tabKey === 'trash'
            ? `${row.section_key}:${row.slip_type_key}:${row.id}`
            : String(row.id)
    );
    const isSlipRowSelectable = (tabKey, row) => {
        if (!row) return false;
        if (tabKey === 'exports') return Boolean(row.can_delete);
        return true;
    };
    const selectableSlipRows = {
        imports,
        exports: exportsData,
        returns: returnsData,
        damaged: damagedData,
        adjustments,
        trash: trashItems,
    };

    useEffect(() => {
        setSelectedSlipIds((prev) => {
            let changed = false;
            const next = { ...prev };

            slipSelectionTabKeys.forEach((tabKey) => {
                const currentSelection = prev[tabKey] || {};
                const allowedKeys = new Set((selectableSlipRows[tabKey] || [])
                    .filter((row) => isSlipRowSelectable(tabKey, row))
                    .map((row) => getSlipSelectionKey(tabKey, row)));
                const filteredSelection = Object.fromEntries(
                    Object.entries(currentSelection).filter(([key, checked]) => checked && allowedKeys.has(String(key)))
                );

                if (Object.keys(filteredSelection).length !== Object.keys(currentSelection).length) {
                    next[tabKey] = filteredSelection;
                    changed = true;
                }
            });

            return changed ? next : prev;
        });
    }, [imports, exportsData, returnsData, damagedData, adjustments, trashItems]);

    const getSelectedSlipRows = (tabKey) => (
        (selectableSlipRows[tabKey] || []).filter((row) => Boolean(selectedSlipIds[tabKey]?.[getSlipSelectionKey(tabKey, row)]))
    );
    const selectedImportRows = useMemo(
        () => getSelectedSlipRows('imports'),
        [imports, selectedSlipIds]
    );
    const selectedTrashRows = useMemo(
        () => getSelectedSlipRows('trash'),
        [trashItems, selectedSlipIds]
    );
    const slipSelectionStates = useMemo(() => {
        return slipSelectionTabKeys.reduce((result, tabKey) => {
            const rows = (selectableSlipRows[tabKey] || []).filter((row) => isSlipRowSelectable(tabKey, row));
            const selectedCount = rows.filter((row) => Boolean(selectedSlipIds[tabKey]?.[getSlipSelectionKey(tabKey, row)])).length;
            result[tabKey] = {
                checked: rows.length > 0 && selectedCount === rows.length,
                indeterminate: selectedCount > 0 && selectedCount < rows.length,
                count: selectedCount,
                total: rows.length,
            };
            return result;
        }, {});
    }, [imports, exportsData, returnsData, damagedData, adjustments, trashItems, selectedSlipIds]);
    const setSlipRowSelected = (tabKey, row, checked) => {
        const selectionKey = getSlipSelectionKey(tabKey, row);
        setSelectedSlipIds((prev) => {
            const nextTabSelection = { ...(prev[tabKey] || {}) };
            if (checked) {
                nextTabSelection[selectionKey] = true;
            } else {
                delete nextTabSelection[selectionKey];
            }
            return { ...prev, [tabKey]: nextTabSelection };
        });
    };
    const toggleAllSlipSelections = (tabKey, checked) => {
        const rows = (selectableSlipRows[tabKey] || []).filter((row) => isSlipRowSelectable(tabKey, row));
        setSelectedSlipIds((prev) => ({
            ...prev,
            [tabKey]: checked ? Object.fromEntries(rows.map((row) => [getSlipSelectionKey(tabKey, row), true])) : {},
        }));
    };
    const buildSelectableColumns = (tabKey, baseColumns, title) => ([
        {
            id: 'select',
            label: 'Chọn',
            minWidth: 72,
            align: 'center',
            draggable: false,
            sortable: false,
            headerRender: () => (
                <div className="flex items-center justify-center">
                    <IndeterminateCheckbox
                        checked={Boolean(slipSelectionStates[tabKey]?.checked)}
                        indeterminate={Boolean(slipSelectionStates[tabKey]?.indeterminate)}
                        onChange={(event) => toggleAllSlipSelections(tabKey, event.target.checked)}
                        disabled={!slipSelectionStates[tabKey]?.total}
                        title={title}
                    />
                </div>
            ),
        },
        ...baseColumns,
    ]);
    const importListColumns = useMemo(
        () => buildSelectableColumns('imports', importColumns, 'Chọn tất cả phiếu nhập trên trang hiện tại'),
        [slipSelectionStates.imports]
    );
    const exportListColumns = useMemo(
        () => buildSelectableColumns('exports', exportColumns, 'Chọn tất cả phiếu xuất có thể xóa trên trang hiện tại'),
        [slipSelectionStates.exports]
    );
    const returnListColumns = useMemo(
        () => buildSelectableColumns('returns', documentColumns, 'Chọn tất cả phiếu hoàn trên trang hiện tại'),
        [slipSelectionStates.returns]
    );
    const damagedListColumns = useMemo(
        () => buildSelectableColumns('damaged', documentColumns, 'Chọn tất cả phiếu hỏng trên trang hiện tại'),
        [slipSelectionStates.damaged]
    );
    const adjustmentListColumns = useMemo(
        () => buildSelectableColumns('adjustments', adjustmentColumns, 'Chọn tất cả phiếu điều chỉnh trên trang hiện tại'),
        [slipSelectionStates.adjustments]
    );
    const trashListColumns = useMemo(
        () => buildSelectableColumns('trash', trashColumns, 'Chọn tất cả phiếu trong thùng rác trên trang hiện tại'),
        [slipSelectionStates.trash]
    );
    const buildImportPrintDocument = (form) => {
        const supplierName = form?.supplier_name
            || suppliers.find((supplier) => String(supplier.id) === String(form?.supplier_id))?.name
            || 'Tất cả sản phẩm';
        const printableItems = (form?.items || [])
            .filter((item) => Number(item.product_id || 0) > 0)
            .map((item) => {
                const storageLocation = normalizeImportStorageLocation(item);
                const quantity = Number(item.quantity || 0);
                const receivedQuantity = Number(item.received_quantity ?? 0);
                const quantityToPutaway = resolveImportPutawayQuantity({
                    ...item,
                    quantity,
                    received_quantity: receivedQuantity,
                });

                return {
                    ...item,
                    supplier_name: supplierName,
                    quantity,
                    received_quantity: receivedQuantity,
                    quantity_to_putaway: quantityToPutaway,
                    unit_cost: Number(item.unit_cost || 0),
                    storage_location: storageLocation,
                    storage_location_label: storageLocation?.location_label || item.storage_location_label || '',
                    warehouse_sequence: item.warehouse_sequence ?? storageLocation?.warehouse_sequence ?? '',
                    putaway_sort_key: buildImportStorageLocationSortKey(storageLocation, item),
                };
            });
        const subtotal = printableItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_cost || 0)), 0);
        const surchargeState = parseImportSurchargeFields({
            amountInput: form?.extra_charge_amount_input,
            percentInput: form?.extra_charge_percent_input,
        }, subtotal);

        return {
            importNumber: form?.import_number || '',
            importDate: form?.import_date || '',
            supplierName,
            items: printableItems,
            subtotal,
            surcharge: surchargeState.amount,
            total: subtotal + surchargeState.amount,
            notes: form?.notes || '',
        };
    };
    const currentImportPrintDocument = useMemo(
        () => buildImportPrintDocument(importModal.form),
        [importModal.form, suppliers]
    );
    const importPrintDocuments = useMemo(
        () => (
            importPrintSource.mode === 'modal'
                ? [currentImportPrintDocument]
                : importPrintSource.forms.map((form) => buildImportPrintDocument(form))
        ),
        [importPrintSource, currentImportPrintDocument, suppliers]
    );
    const importPrintSummary = useMemo(() => ({
        documentCount: importPrintDocuments.length,
        lineCount: importPrintDocuments.reduce((sum, document) => sum + Number(document.items.length || 0), 0),
        total: importPrintDocuments.reduce((sum, document) => sum + Number(document.total || 0), 0),
    }), [importPrintDocuments]);
    const importPutawaySummary = useMemo(() => ({
        quantity: importPrintDocuments.reduce((sum, document) => (
            sum + document.items.reduce((itemSum, item) => itemSum + Number(item.quantity_to_putaway ?? item.quantity ?? 0), 0)
        ), 0),
        missingLocationCount: importPrintDocuments.reduce((sum, document) => (
            sum + document.items.filter((item) => !item.storage_location).length
        ), 0),
    }), [importPrintDocuments]);
    const selectedImportPrintCount = importPrintSummary.documentCount || selectedImportRows.length;
    const importDetailDocument = useMemo(
        () => buildImportPrintDocument(importDetailModal.form),
        [importDetailModal.form, suppliers]
    );
    const importDetailStatus = useMemo(
        () => getImportStatusById(importDetailModal.form.inventory_import_status_id) || importDetailModal.row?.statusConfig || null,
        [importDetailModal.form.inventory_import_status_id, importDetailModal.row, importStatuses]
    );

    const importSubtotal = useMemo(
        () => importModal.form.items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_cost || 0)), 0),
        [importModal.form.items]
    );
    const importSurchargeState = useMemo(
        () => parseImportSurchargeFields({
            amountInput: importModal.form.extra_charge_amount_input,
            percentInput: importModal.form.extra_charge_percent_input,
        }, importSubtotal),
        [importModal.form.extra_charge_amount_input, importModal.form.extra_charge_percent_input, importSubtotal]
    );
    const importSurchargeAmount = useMemo(
        () => importSurchargeState.amount,
        [importSurchargeState]
    );
    const importLineTotal = useMemo(
        () => importSubtotal + importSurchargeAmount,
        [importSubtotal, importSurchargeAmount]
    );
    const importPrintSelectedColumns = useMemo(
        () => orderImportPrintColumnIds(importPrintColumnIds)
            .map((columnId) => importPrintColumnMap.get(columnId))
            .filter(Boolean),
        [importPrintColumnIds]
    );
    const importPrintPreviewHtml = useMemo(
        () => (importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
            ? buildImportPutawayPrintHtml({
                printedAt: importPrintPreviewPrintedAt,
                documents: importPrintDocuments,
            })
            : buildImportPrintHtml({
                printedAt: importPrintPreviewPrintedAt,
                columns: importPrintSelectedColumns,
                documents: importPrintDocuments,
            })),
        [
            importPrintMode,
            importPrintPreviewPrintedAt,
            importPrintSelectedColumns,
            importPrintDocuments,
        ]
    );
    const importCompletion = useMemo(() => {
        const relevantItems = importModal.form.items.filter((item) => Number(item.product_id || 0) > 0);
        const orderedQuantity = relevantItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const receivedQuantity = relevantItems.reduce((sum, item) => sum + Number(item.received_quantity ?? 0), 0);
        const incompleteCount = relevantItems.filter((item) => Number(item.received_quantity ?? 0) < Number(item.quantity || 0)).length;
        return {
            totalLines: relevantItems.length,
            incompleteCount,
            orderedQuantity,
            receivedQuantity,
            allCompleted: relevantItems.length > 0 && incompleteCount === 0,
        };
    }, [importModal.form.items]);
    const documentLineTotal = useMemo(
        () => documentModal.form.items.reduce((sum, item) => sum + getDocumentLineValue(documentModal.tabKey, item), 0),
        [documentModal.form.items, documentModal.tabKey]
    );
    const exportLineTotal = useMemo(() => exportModal.form.items.reduce((sum, item) => sum + (Number(item.product_id || 0) > 0 ? Number(item.quantity || 0) * Number(item.unit_cost || 0) : 0), 0), [exportModal.form.items]);
    const exportTotalQuantity = useMemo(() => exportModal.form.items.reduce((sum, item) => sum + (Number(item.product_id || 0) > 0 ? Number(item.quantity || 0) : 0), 0), [exportModal.form.items]);
    const stockAdjustmentPreviewRows = useMemo(
        () => stockAdjustmentModal.items.map((item) => {
            const actualQuantity = parseQuantityDraft(item.actual_quantity, Number(item.current_quantity || 0));
            const differenceQuantity = actualQuantity - Number(item.current_quantity || 0);

            return {
                ...item,
                actualQuantity,
                differenceQuantity,
            };
        }),
        [stockAdjustmentModal.items]
    );
    const stockAdjustmentChangedCount = useMemo(
        () => stockAdjustmentPreviewRows.filter((item) => Math.abs(Number(item.differenceQuantity || 0)) >= 0.0005).length,
        [stockAdjustmentPreviewRows]
    );
    const stockAdjustmentTotalDifference = useMemo(
        () => stockAdjustmentPreviewRows.reduce((sum, item) => sum + Number(item.differenceQuantity || 0), 0),
        [stockAdjustmentPreviewRows]
    );
    const exportInvoiceMeta = exportModal.form.invoice_meta;
    const exportInvoiceStatusSummary = useMemo(
        () => getExportInvoiceStatusMeta(exportModal.form.invoice_meta, exportModal.form.customer_name),
        [exportModal.form.customer_name, exportModal.form.invoice_meta]
    );
    const documentWorkspace = isDocumentTab(activeTab) ? renderSimpleTab(activeTab) : null;
    const importModalAttachmentRows = useMemo(() => [
        ...(importModal.form.attachments || []).map((attachment, index) => ({
            key: `saved_${attachment.id || attachment.file_path || index}`,
            kind: 'saved',
            index,
            attachment,
            name: getImportAttachmentName(attachment),
            size: attachment.file_size,
            mimeType: attachment.mime_type,
            typeLabel: getImportAttachmentTypeLabel(attachment),
            icon: isPdfAttachment(attachment) ? 'picture_as_pdf' : (isImageAttachment(attachment) ? 'image' : 'description'),
            iconClass: isPdfAttachment(attachment) ? 'text-rose-600' : (isImageAttachment(attachment) ? 'text-sky-600' : 'text-primary/45'),
        })),
        ...(importModal.form.local_attachment_files || []).map((file, index) => {
            const pseudoAttachment = {
                original_name: file.name,
                mime_type: file.type,
                file_size: file.size,
                source_type: 'manual',
            };

            return {
                key: `local_${file.name}_${file.size}_${file.lastModified}_${index}`,
                kind: 'local',
                index,
                file,
                name: file.name,
                size: file.size,
                mimeType: file.type,
                typeLabel: 'Chưa lưu',
                icon: isPdfAttachment(pseudoAttachment) ? 'picture_as_pdf' : (isImageAttachment(pseudoAttachment) ? 'image' : 'description'),
                iconClass: isPdfAttachment(pseudoAttachment) ? 'text-rose-600' : (isImageAttachment(pseudoAttachment) ? 'text-sky-600' : 'text-primary/45'),
            };
        }),
    ], [importModal.form.attachments, importModal.form.local_attachment_files]);
    const importModalAttachmentCount = importModalAttachmentRows.length;
    useEffect(() => {
        if (!importModal.open || importModalAttachmentCount === 0) {
            setImportAttachmentManagerOpen(false);
        }
    }, [importModal.open, importModalAttachmentCount]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            {activeTab === 'products' ? productsTabContent : null}
            {activeTab === 'suppliers' ? suppliersTabContent : null}
            {activeTab === 'supplierPrices' ? supplierPricesTabContent : null}
            <ModalShell
                open={stockAdjustmentModal.open}
                title="Điều chỉnh tồn kho"
                onClose={closeStockAdjustmentModal}
                maxWidth="max-w-6xl"
                footer={(
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-[13px] font-black text-primary">
                            Dòng lệch: {formatNumber(stockAdjustmentChangedCount)} • Tổng chênh lệch: {formatSignedNumber(stockAdjustmentTotalDifference)}
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={closeStockAdjustmentModal} className={ghostButton}>Hủy</button>
                            <button
                                type="button"
                                onClick={saveStockAdjustment}
                                className={primaryButton}
                                disabled={loading.stockAdjustment || stockAdjustmentModal.items.length === 0}
                            >
                                {loading.stockAdjustment ? 'Đang tạo phiếu' : 'Tạo phiếu tự động'}
                            </button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-[180px,260px,minmax(0,1fr)]">
                        <div>
                            <div className={importFieldLabelClass}>Ngày</div>
                            <input
                                type="date"
                                value={stockAdjustmentModal.document_date}
                                onChange={(event) => setStockAdjustmentModal((prev) => ({ ...prev, document_date: event.target.value }))}
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                        <div>
                            <div className={importFieldLabelClass}>Kiểu điều chỉnh</div>
                            <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-primary/15 bg-white">
                                {[
                                    { value: 'adjustment', label: 'Phiếu điều chỉnh' },
                                    { value: 'import', label: 'Phiếu nhập' },
                                ].map((option) => (
                                    <label
                                        key={option.value}
                                        className={`flex h-10 cursor-pointer items-center justify-center border-r border-primary/10 px-3 text-[12px] font-black last:border-r-0 ${stockAdjustmentModal.mode === option.value ? 'bg-primary text-white' : 'text-primary hover:bg-primary/[0.04]'}`}
                                    >
                                        <input
                                            type="radio"
                                            name="stock_adjustment_mode"
                                            value={option.value}
                                            checked={stockAdjustmentModal.mode === option.value}
                                            onChange={(event) => setStockAdjustmentModal((prev) => ({ ...prev, mode: event.target.value }))}
                                            className="sr-only"
                                        />
                                        {option.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className={importFieldLabelClass}>Ghi chú thêm</div>
                            <input
                                value={stockAdjustmentModal.notes}
                                onChange={(event) => setStockAdjustmentModal((prev) => ({ ...prev, notes: event.target.value }))}
                                placeholder="Không bắt buộc"
                                className={`w-full ${inputClass}`}
                            />
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-sm border border-primary/10">
                        <div className="max-h-[56vh] overflow-auto">
                            <table className="w-full min-w-[920px] border-collapse">
                                <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                                    <tr>
                                        {['Sản phẩm', 'Tồn hệ thống', 'Số lượng thực tế', 'Chênh lệch', 'Giá vốn', 'Xóa'].map((label) => (
                                            <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary last:border-r-0">{label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockAdjustmentPreviewRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-4 py-8 text-center text-[13px] text-primary/55">Chưa có sản phẩm.</td>
                                        </tr>
                                    ) : null}
                                    {stockAdjustmentPreviewRows.map((item, index) => {
                                        const diff = Number(item.differenceQuantity || 0);
                                        const diffClass = diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-primary/45';

                                        return (
                                            <tr key={item.key}>
                                                <td className="border-b border-r border-primary/10 px-3 py-2 align-middle">
                                                    <CellText primary={item.name || '-'} secondary={item.sku || '-'} />
                                                </td>
                                                <td className="border-b border-r border-primary/10 px-3 py-2 text-right text-[13px] font-black text-primary">
                                                    {formatNumber(item.current_quantity || 0)}
                                                </td>
                                                <td className="border-b border-r border-primary/10 px-3 py-2">
                                                    <input
                                                        value={item.actual_quantity}
                                                        onChange={(event) => updateStockAdjustmentLine(index, 'actual_quantity', normalizeQuantityDraft(event.target.value))}
                                                        inputMode="decimal"
                                                        className={`w-full text-right ${inputClass}`}
                                                    />
                                                </td>
                                                <td className={`border-b border-r border-primary/10 px-3 py-2 text-right text-[13px] font-black ${diffClass}`}>
                                                    {formatSignedNumber(diff)}
                                                </td>
                                                <td className="border-b border-r border-primary/10 px-3 py-2 text-right text-[13px] font-semibold text-primary/75">
                                                    {item.display_cost != null ? formatImportCost(item.display_cost) : '-'}
                                                </td>
                                                <td className="border-b border-primary/10 px-3 py-2 text-center">
                                                    <button type="button" onClick={() => removeStockAdjustmentLine(index)} className={dangerButton}>Xóa</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </ModalShell>
            {false ? (
                <div className="grid items-start gap-3 xl:grid-cols-[300px,minmax(0,1fr)]">
                    <div className={`${panelClass} self-start`}>
                        <div className="border-b border-primary/10 px-3 py-2.5">
                            <input value={supplierFilters.search} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Tìm nhà cung cấp" className={`w-full ${inputClass}`} />
                        </div>
                        <div className="max-h-[280px] overflow-auto">
                            {loading.suppliers ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tải nhà cung cấp...</div> : null}
                            {!loading.suppliers && suppliers.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không có nhà cung cấp.</div> : null}
                            {!loading.suppliers && suppliers.map((supplier) => {
                                const isSelected = selectedSupplierId === supplier.id;
                                const isOpen = Boolean(supplierDetailOpen[supplier.id]);

                                return (
                                    <div key={supplier.id} className="border-b border-primary/10 last:border-b-0">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedSupplierId(supplier.id);
                                                setSupplierDetailOpen((prev) => ({ ...prev, [supplier.id]: !prev[supplier.id] }));
                                            }}
                                            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left transition ${isSelected ? 'bg-primary/[0.05]' : 'hover:bg-primary/[0.02]'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[18px] transition ${isOpen ? 'rotate-0 text-primary' : 'text-primary/45'}`}>{isOpen ? 'expand_more' : 'chevron_right'}</span>
                                            <span className={`min-w-0 flex-1 truncate text-[13px] ${isSelected ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}>{supplier.name}</span>
                                            {isSelected ? <span className="rounded-full bg-primary/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">Đang chọn</span> : null}
                                        </button>
                                        {isOpen ? (
                                            <div className="space-y-3 border-t border-primary/10 bg-[#fbfcfe] px-3 py-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[13px] font-black text-primary">{supplier.name}</div>
                                                        <div className="text-[11px] text-primary/45">{supplier.code || 'Chưa có mã nhà cung cấp'}</div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button type="button" onClick={() => openEditSupplier(supplier)} className={ghostButton}>Sửa</button>
                                                        <button type="button" onClick={() => deleteSupplier(supplier)} className={dangerButton}>Xóa</button>
                                                    </div>
                                                </div>
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Điện thoại</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.phone || 'Chưa có số điện thoại'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Email</div>
                                                        <div className="mt-1 break-all font-semibold text-primary">{supplier.email || 'Chưa có email'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Địa chỉ</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.address || 'Chưa có địa chỉ'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chú</div>
                                                        <div className="mt-1 leading-relaxed text-primary/70">{supplier.notes || 'Chưa có ghi chú'}</div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Bảng giá</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.prices_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Phiếu nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.import_slips_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Số lượng nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.imported_quantity_total || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Tiền nhập</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatCurrency(supplier.imported_amount_total || 0)}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 px-3 py-3">
                            <label className="inline-flex items-center gap-2 text-[12px] text-primary/55">
                                <span>Hiển thị</span>
                                <select value={pageSizes.suppliers} onChange={(event) => fetchSuppliers(1, updatePageSize('suppliers', Number(event.target.value)))} className="h-8 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-semibold text-primary outline-none focus:border-primary">
                                    {pageSizeOptions.map((size) => <option key={size} value={size}>{size} dòng</option>)}
                                </select>
                            </label>
                            <Pagination pagination={supplierPagination} onPageChange={fetchSuppliers} />
                        </div>
                    </div>

                    <div className={panelClass}>
                        <PanelHeader
                            title={currentSupplier ? `Bảng giá dự kiến - ${currentSupplier.name}` : 'Bảng giá dự kiến'}
                            actions={
                                <>
                                    <button type="button" onClick={openCreateSupplier} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>Thêm mới</button>
                                    <div className="relative w-[220px] min-w-[220px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                        <input
                                            value={supplierQuickSearch}
                                            onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                            placeholder="Tìm SKU / tên / mã NCC"
                                            disabled={!hasSupplierCatalogSelection}
                                            className={`w-full pl-9 ${inputClass}`}
                                        />
                                    </div>
<input value={formatRoundedImportCost(bulkPrice)} onChange={(event) => setBulkPrice(normalizeRoundedImportCostDraft(event.target.value))} placeholder="Giá áp chọn" disabled={!hasSpecificSupplierSelection} className={`w-[125px] ${inputClass}`} />
                                    <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!hasSpecificSupplierSelection} className={ghostButton}>{showPasteBox ? 'Ẩn dán nhanh' : 'Dán nhanh'}</button>
                                    <button type="button" onClick={applyBulkPrice} disabled={!hasSpecificSupplierSelection || !selectedIds.length} className={ghostButton}>Áp giá chọn</button>
                                    {[
                                        { id: 'supplierPrices_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.supplierPrices.filters, onClick: () => togglePanel('supplierPrices', 'filters') },
                                        { id: 'supplierPrices_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.supplierPrices.stats, onClick: () => togglePanel('supplierPrices', 'stats') },
                                        { id: 'supplierPrices_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.supplierPrices.columns, onClick: () => togglePanel('supplierPrices', 'columns') },
                                    ].map((toggle) => (
                                        <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                                            <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                                        </button>
                                    ))}
                                </>
                            }
                        />
                        {openPanels.supplierPrices.filters ? (
                            <FilterPanel actions={<button type="button" onClick={() => fetchSupplierCatalog(1)} className={primaryButton}>Lọc</button>}>
                                <input value={supplierCatalogFilters.sku} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, sku: event.target.value }))} placeholder="Lọc theo mã SP / mã NCC" className={`w-[170px] ${inputClass}`} />
                                <input value={supplierCatalogFilters.name} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, name: event.target.value }))} placeholder="Lọc theo tên sản phẩm" className={`w-[180px] ${inputClass}`} />
                                <select value={supplierCatalogFilters.category_id} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                                <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option>{productTypeFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                                <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Sản phẩm thường / biến thể</option><option value="no_variants">Sản phẩm thường</option><option value="only_variants">Biến thể</option><option value="has_variants">Nhóm có biến thể</option><option value="roots">Nhóm gốc</option></select>
                            </FilterPanel>
                        ) : null}
                        {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
                        {showPasteBox ? <div className="border-b border-primary/10 px-3 py-2.5"><div className="mb-2 text-[12px] text-primary/55">Dán theo mẫu: `SKU TAB Giá` hoặc `SKU,Giá`</div><div className="flex gap-3"><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" placeholder={'SKU-01\t120000\nSKU-02\t150000'} /><button type="button" onClick={applyPaste} className={primaryButton}>Nhận giá</button></div></div> : null}
                        <InventoryTable storageKey="inventory_supplier_prices_table_v2" columns={supplierPriceColumns} rows={supplierRows} renderCell={supplierPriceCell} loading={loading.supplierCatalog} pagination={supplierCatalogPagination} onPageChange={fetchSupplierCatalog} footer={`Hiển thị ${formatNumber(visibleSupplierItemIds.length)} / ${formatNumber(supplierCatalogPagination.total)} sản phẩm`} rowKey="row_id" rowClassName={(row) => {
                            if (row.row_kind === 'comparison') return 'bg-[#fff8eb]';
                            if (row.row_kind === 'group') return 'bg-[#f9fafb]';
                            if (row.parent_group_id) return selectedPriceIds[row.id] ? 'bg-sky-50' : 'bg-slate-50/80 hover:bg-slate-100';
                            return selectedPriceIds[row.id] ? 'bg-primary/[0.04]' : 'hover:bg-primary/[0.02]';
                        }} settingsOpen={openPanels.supplierPrices.columns} onCloseSettings={() => togglePanel('supplierPrices', 'columns')} currentPerPage={pageSizes.supplierPrices} onPerPageChange={(value) => fetchSupplierCatalog(1, updatePageSize('supplierPrices', value))} sortConfig={sortConfigs.supplierPrices} onSort={(columnId) => handleTableSort('supplierPrices', columnId)} sortColumnMap={inventorySortColumnMaps.supplierPrices} onRowDoubleClick={openSupplierCatalogProductEditor} />
                    </div>
                </div>
            ) : null}
            {isDocumentTab(activeTab) ? documentWorkspace : null}
            {['lots', 'trash'].includes(activeTab) ? renderSimpleTab(activeTab) : null}
            <ModalShell
                open={importInvoiceModal.open}
                title={`Hóa đơn phiếu nhập${importInvoiceModal.importInfo?.import_number ? ` • ${importInvoiceModal.importInfo.import_number}` : ''}`}
                onClose={closeImportInvoiceModal}
                maxWidth="max-w-[1180px]"
                footer={(
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={closeImportInvoiceModal} className={ghostButton}>Đóng</button>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                        <div>
                            <div className="text-[15px] font-black text-primary">
                                {importInvoiceModal.importInfo?.supplier_name || 'Chưa có nhà cung cấp'}
                            </div>
                            <div className="mt-1 text-[12px] text-primary/55">
                                Ngày nhập: {formatPrintDate(importInvoiceModal.importInfo?.import_date)}
                                {' • '}
                                {formatNumber(importInvoiceModal.importInfo?.attachments_count || importInvoiceModal.attachments.length)} hóa đơn
                            </div>
                        </div>
                        <label className={`${primaryButton} ${loading.importInvoiceUpload ? 'pointer-events-none opacity-60' : ''}`}>
                            <input
                                type="file"
                                multiple
                                accept=".pdf,image/*"
                                className="hidden"
                                disabled={loading.importInvoiceUpload}
                                onChange={(event) => {
                                    addImportInvoiceFiles(event.target.files);
                                    event.target.value = '';
                                }}
                            />
                            <span className="material-symbols-outlined text-[18px]">upload_file</span>
                            {loading.importInvoiceUpload ? 'Đang tải lên' : 'Thêm hóa đơn'}
                        </label>
                    </div>

                    {loading.importInvoiceModal ? (
                        <div className="flex h-[320px] items-center justify-center rounded-sm border border-primary/10 bg-[#fbfcfe] text-[13px] font-semibold text-primary/60">
                            Đang tải danh sách hóa đơn...
                        </div>
                    ) : (
                        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[13px] font-black text-primary">Danh sách hóa đơn</div>
                                            <div className="text-[12px] text-primary/55">Chọn một tệp để xem trước ảnh hoặc PDF.</div>
                                        </div>
                                        <div className="text-[12px] font-semibold text-primary/60">
                                            {formatNumber(importInvoiceModal.attachments.length)} tệp
                                        </div>
                                    </div>
                                </div>

                                {!importInvoiceModal.attachments.length ? (
                                    <div className="rounded-sm border border-dashed border-primary/20 bg-[#fbfcfe] px-4 py-8 text-center">
                                        <div className="text-[13px] font-black text-primary">Phiếu này chưa có hóa đơn</div>
                                        <div className="mt-1 text-[12px] text-primary/55">Bấm "Thêm hóa đơn" để tải ảnh hoặc PDF lên.</div>
                                    </div>
                                ) : (
                                    <div className="max-h-[62vh] space-y-3 overflow-auto pr-1">
                                        {importInvoiceModal.attachments.map((attachment) => {
                                            const isSelected = Number(selectedImportInvoiceAttachment?.id) === Number(attachment.id);
                                            const isReplacing = Number(importInvoiceReplacingId) === Number(attachment.id);
                                            const isDeleting = Number(importInvoiceDeletingId) === Number(attachment.id);

                                            return (
                                                <div
                                                    key={attachment.id || attachment.file_path}
                                                    className={`rounded-sm border p-3 transition ${
                                                        isSelected
                                                            ? 'border-primary bg-primary/[0.04]'
                                                            : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.02]'
                                                    }`}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => setImportInvoiceModal((prev) => ({ ...prev, selectedAttachmentId: attachment.id }))}
                                                        className="flex w-full items-start gap-3 text-left"
                                                    >
                                                        <span className={`material-symbols-outlined mt-0.5 text-[20px] ${isPdfAttachment(attachment) ? 'text-rose-600' : 'text-sky-600'}`}>
                                                            {isPdfAttachment(attachment) ? 'picture_as_pdf' : (isImageAttachment(attachment) ? 'image' : 'description')}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-[13px] font-black text-primary">{getImportAttachmentName(attachment)}</div>
                                                            <div className="mt-1 text-[11px] text-primary/55">
                                                                {getImportAttachmentTypeLabel(attachment)} • {formatFileSize(attachment.file_size)}
                                                            </div>
                                                            <div className="mt-1 text-[11px] text-primary/45">
                                                                {attachment.created_at ? formatDateTime(attachment.created_at) : 'Chưa có thời gian tải lên'}
                                                            </div>
                                                        </div>
                                                    </button>

                                                    <div className="mt-3 flex gap-2">
                                                        <label className={`${ghostButton} flex-1 ${isReplacing ? 'pointer-events-none opacity-60' : ''}`}>
                                                            <input
                                                                type="file"
                                                                accept=".pdf,image/*"
                                                                className="hidden"
                                                                disabled={isReplacing}
                                                                onChange={(event) => {
                                                                    replaceImportInvoiceAttachment(attachment, event.target.files?.[0]);
                                                                    event.target.value = '';
                                                                }}
                                                            />
                                                            <span className="material-symbols-outlined text-[18px]">sync</span>
                                                            {isReplacing ? 'Đang thay' : 'Thay file'}
                                                        </label>
                                                        <button
                                                            type="button"
                                                            onClick={() => deleteImportInvoiceAttachment(attachment)}
                                                            disabled={isDeleting}
                                                            className={dangerButton}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            {isDeleting ? 'Đang xóa' : 'Xóa'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                    <div>
                                        <div className="text-[13px] font-black text-primary">Xem trước hóa đơn</div>
                                        <div className="text-[12px] text-primary/55">
                                            {selectedImportInvoiceAttachment ? getImportAttachmentName(selectedImportInvoiceAttachment) : 'Chưa chọn tệp nào'}
                                        </div>
                                    </div>
                                    {selectedImportInvoiceAttachment?.url ? (
                                        <a href={selectedImportInvoiceAttachment.url} target="_blank" rel="noreferrer" className={ghostButton}>
                                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                            Mở tab mới
                                        </a>
                                    ) : null}
                                </div>

                                {!selectedImportInvoiceAttachment ? (
                                    <div className="flex h-[62vh] items-center justify-center rounded-sm border border-dashed border-primary/20 bg-white text-[13px] text-primary/55">
                                        Hãy chọn một hóa đơn để xem trước.
                                    </div>
                                ) : !selectedImportInvoiceAttachment.url ? (
                                    <div className="flex h-[62vh] items-center justify-center rounded-sm border border-dashed border-primary/20 bg-white px-6 text-center text-[13px] text-primary/55">
                                        Tệp này chưa có đường dẫn xem trước. Hãy thay lại hóa đơn hoặc mở sau khi tải lên thành công.
                                    </div>
                                ) : isImageAttachment(selectedImportInvoiceAttachment) ? (
                                    <div className="flex h-[62vh] items-center justify-center overflow-hidden rounded-sm border border-primary/10 bg-white">
                                        <img
                                            src={selectedImportInvoiceAttachment.url}
                                            alt={getImportAttachmentName(selectedImportInvoiceAttachment)}
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                ) : isPdfAttachment(selectedImportInvoiceAttachment) ? (
                                    <iframe
                                        title={getImportAttachmentName(selectedImportInvoiceAttachment)}
                                        src={selectedImportInvoiceAttachment.url}
                                        className="h-[62vh] w-full rounded-sm border border-primary/10 bg-white"
                                    />
                                ) : (
                                    <div className="flex h-[62vh] flex-col items-center justify-center rounded-sm border border-dashed border-primary/20 bg-white px-6 text-center">
                                        <span className="material-symbols-outlined text-[34px] text-primary/40">description</span>
                                        <div className="mt-3 text-[13px] font-black text-primary">Định dạng này chưa hỗ trợ xem trực tiếp</div>
                                        <div className="mt-1 text-[12px] text-primary/55">Bạn có thể mở tệp ở tab mới để xem đầy đủ.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </ModalShell>
            <ModalShell
                open={supplierModal.open}
                title={supplierModal.form.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
                onClose={closeSupplierModal}
                maxWidth="max-w-3xl"
                backdropClassName="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4"
                footer={(
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={closeSupplierModal} className={ghostButton}>Hủy</button>
                        <button type="button" onClick={saveSupplier} className={primaryButton} disabled={loading.supplierModal}>
                            {loading.supplierModal ? 'Đang lưu' : 'Lưu nhà cung cấp'}
                        </button>
                    </div>
                )}
            >
                <div className="grid gap-3 md:grid-cols-2">
                    <input
                        value={supplierModal.form.code}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, code: event.target.value } }))}
                        placeholder="Mã nhà cung cấp"
                        className={inputClass}
                    />
                    <input
                        value={supplierModal.form.name}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))}
                        placeholder="Tên nhà cung cấp"
                        className={inputClass}
                    />
                    <input
                        value={supplierModal.form.phone}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, phone: event.target.value } }))}
                        placeholder="Số điện thoại"
                        className={inputClass}
                    />
                    <input
                        value={supplierModal.form.email}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, email: event.target.value } }))}
                        placeholder="Email"
                        className={inputClass}
                    />
                    <input
                        value={supplierModal.form.address}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, address: event.target.value } }))}
                        placeholder="Địa chỉ"
                        className={`md:col-span-2 ${inputClass}`}
                    />
                    <textarea
                        value={supplierModal.form.notes}
                        onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))}
                        placeholder="Ghi chú"
                        className="min-h-[120px] rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary md:col-span-2"
                    />
                    <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary">
                        <input
                            type="checkbox"
                            checked={supplierModal.form.status}
                            onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.checked } }))}
                            className="size-4 accent-primary"
                        />
                        Đang sử dụng
                    </label>
                </div>
            </ModalShell>
            <ModalShell
                open={importModal.open}
                title={importModal.form.id ? 'Sửa phiếu nhập' : 'Tạo phiếu nhập'}
                onClose={closeImportModal}
                closeOnBackdrop={false}
                maxWidth="max-w-[calc(100vw-16px)] sm:max-w-[calc(100vw-24px)]"
                backdropClassName="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-2 sm:p-3"
                panelClassName="flex h-[calc(100vh-16px)] max-h-[calc(100vh-16px)] flex-col sm:h-[calc(100vh-24px)] sm:max-h-[calc(100vh-24px)]"
                bodyClassName="flex-1 overflow-auto px-5 py-4"
                footerClassName="shrink-0 border-t border-primary/10 px-5 py-4"
                footer={(
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="grid gap-2 text-[13px] font-semibold text-primary/75 sm:grid-cols-2 xl:grid-cols-4">
                            <div>Tổng tiền hàng: <span className="font-black text-primary">{formatCurrency(importSubtotal)}</span></div>
                            <div>Phụ phí: <span className="font-black text-primary">{formatCurrency(importSurchargeAmount)}</span></div>
                            <div>Tổng tiền đơn: <span className="font-black text-primary">{formatCurrency(importLineTotal)}</span></div>
                            <div>
                                Đã về / Nhập: <span className="font-black text-primary">{formatNumber(importCompletion.receivedQuantity)} / {formatNumber(importCompletion.orderedQuantity)}</span>
                                <span className={`ml-2 text-[12px] ${importCompletion.incompleteCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                    {importCompletion.totalLines > 0
                                        ? (importCompletion.incompleteCount > 0 ? `${formatNumber(importCompletion.incompleteCount)} dòng chưa đủ` : 'Tất cả đã về đủ')
                                        : 'Chưa có dòng sản phẩm'}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={closeImportModal} className={ghostButton}>Hủy</button>
                            <button type="button" onClick={saveImport} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Đang lưu' : 'Lưu phiếu nhập'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_44px_44px_44px_repeat(2,minmax(0,1fr))]">
                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Nhà cung cấp</div>
                            <div className="flex min-w-0 gap-2">
                                <select value={importModal.form.supplier_id} onChange={(event) => handleImportSupplierChange(event.target.value)} className={`min-w-0 flex-1 ${importSelectClass} h-11`}>
                                    <option value="">Tất cả sản phẩm</option>
                                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={openCreateSupplierFromImport}
                                    className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-black text-primary transition hover:border-primary hover:bg-primary/5"
                                    title="Thêm nhà cung cấp mới"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add</span>
                                    <span className="hidden sm:inline">Thêm NCC</span>
                                </button>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Trạng thái</div>
                            <div className="flex min-w-0 gap-2">
                                <div className="relative min-w-0 flex-1">
                                    <select value={importModal.form.inventory_import_status_id} onChange={(event) => handleImportStatusChange(event.target.value)} className={`w-full pr-12 ${importSelectClass} h-11`}>
                                        <option value="">Chọn trạng thái</option>
                                        {importStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => openImportStatusManager(importStatuses.find((status) => String(status.id) === String(importModal.form.inventory_import_status_id)) || null)}
                                        className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/70 transition hover:border-primary hover:text-primary"
                                        title="Quản lý trạng thái phiếu nhập"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">tune</span>
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleImportAutoCompleteChange(!Boolean(importModal.form.auto_complete_import))}
                                    className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border transition ${
                                        importModal.form.auto_complete_import
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                            : 'border-primary/15 bg-white text-primary/45 hover:border-primary/30 hover:text-primary'
                                    }`}
                                    title={importModal.form.auto_complete_import ? 'Đang tự hoàn thành phiếu nhập' : 'Tích để phiếu nhập tự hoàn thành ngay'}
                                >
                                    <span className="material-symbols-outlined text-[20px]">{importModal.form.auto_complete_import ? 'check_circle' : 'radio_button_unchecked'}</span>
                                </button>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Ngày nhập</div>
                            <input type="date" value={importModal.form.import_date} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, import_date: event.target.value } }))} className={`w-full ${importFieldClass} h-11`} />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Số hóa đơn</div>
                            <input value={importModal.form.invoice_number || ''} onChange={(event) => {
                                const value = event.target.value;
                                setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        invoice_number: value,
                                        has_purchase_invoice: prev.form.has_purchase_invoice || value.trim() !== '',
                                    },
                                }));
                            }} className={`w-full ${importFieldClass} h-11`} placeholder="Nhập số hóa đơn (nếu có)" />
                        </div>

                        <div className="min-w-0 xl:self-end">
                            <input
                                ref={importAttachmentInputRef}
                                type="file"
                                multiple
                                accept=".pdf,image/*"
                                className="hidden"
                                onChange={(event) => {
                                    addImportAttachmentFiles(event.target.files);
                                    event.target.value = '';
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    if (importModalAttachmentCount > 0) {
                                        setImportAttachmentManagerOpen((value) => !value);
                                        return;
                                    }
                                    importAttachmentInputRef.current?.click();
                                }}
                                className={`relative inline-flex h-11 w-full items-center justify-center rounded-sm border transition xl:w-11 ${
                                    importAttachmentManagerOpen
                                        ? 'border-primary bg-primary text-white'
                                        : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/[0.04]'
                                }`}
                                title={importModalAttachmentCount > 0 ? 'Xem / sửa / xóa hóa đơn đính kèm' : 'Đính kèm hóa đơn / chứng từ'}
                            >
                                <span className="material-symbols-outlined text-[18px]">attach_file</span>
                                {importModalAttachmentCount > 0 ? (
                                    <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black leading-[18px] text-white ring-2 ring-white">
                                        {importModalAttachmentCount}
                                    </span>
                                ) : null}
                            </button>
                        </div>

                        <div className="min-w-0 xl:self-end">
                            <button
                                type="button"
                                onClick={() => setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        has_purchase_invoice: !Boolean(prev.form.has_purchase_invoice),
                                    },
                                }))}
                                className={`relative inline-flex h-11 w-full items-center justify-center rounded-sm border transition xl:w-11 ${
                                    importModal.form.has_purchase_invoice
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        : 'border-primary/15 bg-white text-primary/45 hover:border-primary/30 hover:text-primary'
                                }`}
                                title={importModal.form.has_purchase_invoice ? 'Có hóa đơn đầu vào' : 'Không có hóa đơn đầu vào'}
                                aria-label={importModal.form.has_purchase_invoice ? 'Có hóa đơn đầu vào' : 'Không có hóa đơn đầu vào'}
                            >
                                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                                {importModal.form.has_purchase_invoice ? (
                                    <span className="material-symbols-outlined absolute -right-1 -top-1 rounded-full bg-emerald-600 text-[14px] leading-none text-white ring-2 ring-white">check_circle</span>
                                ) : null}
                            </button>
                        </div>

                        <div className="min-w-0 xl:self-end">
                            <label
                                className={`inline-flex h-11 w-full items-center justify-center rounded-sm border px-3 text-primary transition xl:w-11 ${
                                    !aiAvailable
                                        ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 hover:border-stone-200 hover:bg-stone-100'
                                        : 'cursor-pointer border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100'
                                }`}
                                title={!aiAvailable ? aiDisabledReason : 'Đọc hóa đơn bằng AI'}
                            >
                                <input type="file" accept=".pdf,image/*,.heic,.heif" className="hidden" disabled={!aiAvailable || loading.invoiceAnalysis} onChange={(event) => analyzeInvoiceFile(event.target.files?.[0])} />
                                <span className={`material-symbols-outlined text-[18px] ${loading.invoiceAnalysis ? 'animate-spin' : ''}`}>
                                    {loading.invoiceAnalysis ? 'progress_activity' : 'auto_awesome'}
                                </span>
                            </label>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Phụ phí tiền</div>
                            <input
                                value={importModal.form.extra_charge_amount_input}
                                onChange={(event) => setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        extra_charge_amount_input: formatSignedAmountInput(event.target.value),
                                    },
                                }))}
                                onBlur={(event) => setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        extra_charge_amount_input: parseImportAmountInput(event.target.value).normalizedInput,
                                    },
                                }))}
                                className="h-11 w-full rounded-sm border border-primary/15 bg-white px-3 text-right text-[13px] font-semibold text-primary outline-none transition placeholder:text-primary/35 focus:border-primary"
                                placeholder="+100.000"
                            />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Phụ phí %</div>
                            <input
                                value={importModal.form.extra_charge_percent_input}
                                onChange={(event) => setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        extra_charge_percent_input: formatSignedPercentInput(event.target.value),
                                    },
                                }))}
                                onBlur={(event) => setImportModal((prev) => ({
                                    ...prev,
                                    form: {
                                        ...prev.form,
                                        extra_charge_percent_input: parseImportPercentInput(event.target.value).normalizedInput,
                                    },
                                }))}
                                className="h-11 w-full rounded-sm border border-primary/15 bg-white px-3 text-right text-[13px] font-semibold text-primary outline-none transition placeholder:text-primary/35 focus:border-primary"
                                placeholder="+10"
                            />
                        </div>
                    </div>

                    {importAttachmentManagerOpen ? (
                        <div className="rounded-sm border border-primary/10 bg-[#f8fafc] p-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-[13px] font-black text-primary">Hóa đơn đính kèm</div>
                                    <div className="text-[12px] text-primary/55">{formatNumber(importModalAttachmentCount)} file</div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => importAttachmentInputRef.current?.click()}
                                        className={ghostButton}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">upload_file</span>
                                        Thêm file
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setImportAttachmentManagerOpen(false)}
                                        className={iconButton(false)}
                                        title="Đóng"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                </div>
                            </div>

                            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                                {importModalAttachmentRows.map((row) => (
                                    <div key={row.key} className="rounded-sm border border-primary/10 bg-white p-3">
                                        <div className="flex items-start gap-2">
                                            <span className={`material-symbols-outlined mt-0.5 text-[20px] ${row.iconClass}`}>{row.icon}</span>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-[13px] font-black text-primary" title={row.name}>{row.name}</div>
                                                <div className="mt-1 text-[11px] text-primary/55">
                                                    {row.typeLabel} • {formatFileSize(row.size)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 grid grid-cols-3 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => openImportModalAttachmentPreview(row)}
                                                className={ghostButton}
                                                title="Xem"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">visibility</span>
                                            </button>
                                            <label className={ghostButton} title="Thay file">
                                                <input
                                                    type="file"
                                                    accept=".pdf,image/*"
                                                    className="hidden"
                                                    onChange={(event) => {
                                                        replaceImportModalAttachmentFile(row, event.target.files?.[0]);
                                                        event.target.value = '';
                                                    }}
                                                />
                                                <span className="material-symbols-outlined text-[18px]">sync</span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => deleteImportModalAttachmentFile(row)}
                                                className={dangerButton}
                                                title="Xóa"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {!aiAvailable ? (
                        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900">
                            {aiDisabledReason}
                        </div>
                    ) : null}

                    {importModal.form.items.some((item) => item.mapping_status === 'unmatched') ? (
                        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusPill label="Chưa map đủ" color="#D97706" subtle="#FEF3C7" />
                                <div className="text-[13px] font-black text-amber-900">Có dòng chưa map sang sản phẩm nội bộ</div>
                            </div>
                            <div className="mt-2 space-y-1 text-[12px] text-amber-900/80">
                                {importModal.form.items.filter((item) => item.mapping_status === 'unmatched').map((item) => (
                                    <div key={`${item.key}_warning`}>
                                        {item.supplier_product_code || 'Không có mã NCC'} • {item.product_name || 'Chưa có tên sản phẩm'}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <ImportProductQuickSearch
                        supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null}
                        categoryOptions={productCategoryFilterOptions}
                        attributes={importQuickAttributeOptions}
                        onNotify={showToast}
                        onSelect={appendImportProductFromQuickSearch}
                        onToggleStar={toggleImportProductStar}
                        starLoadingProductIds={importStarLoadingProductIds}
                        updateSupplierPrices={Boolean(importModal.form.update_supplier_prices)}
                        onUpdateSupplierPricesChange={(checked) => setImportModal((prev) => ({
                            ...prev,
                            form: {
                                ...prev.form,
                                update_supplier_prices: checked,
                                items: prev.form.items.map((item) => ({ ...item, update_supplier_price: checked })),
                            },
                        }))}
                        onRefreshPricing={refreshImportItemPricing}
                        refreshPricingLoading={loading.importPriceRefresh}
                        refreshPricingDisabled={!importModal.form.items.some((item) => Number(item.product_id || 0) > 0)}
                        placeholder={importModal.form.supplier_id ? 'Tìm tên, mã SP, mã NCC hoặc từ khóa của nhà cung cấp đã chọn' : 'Tìm tên, mã SP, mã NCC hoặc từ khóa trong toàn bộ sản phẩm'}
                    />

                    <ImportItemsEditorTable
                        items={importModal.form.items}
                        inventoryUnits={inventoryUnits}
                        supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null}
                        settingsOpen={importTableSettingsOpen}
                        onToggleSettings={() => setImportTableSettingsOpen((prev) => !prev)}
                        onCloseSettings={() => setImportTableSettingsOpen(false)}
                        expanded={false}
                        bodyMaxHeightClass="max-h-[52vh] overflow-auto"
                        onToggleExpanded={() => setImportTableExpanded(true)}
                        onOpenPrint={openImportPrintModal}
                        onUpdateLine={updateImportLine}
                        onSelectProduct={attachImportProductToLine}
                        onClearProduct={clearImportProductFromLine}
                        onRemoveLine={removeImportLine}
                        onMoveLine={moveImportLine}
                        onToggleProductStar={toggleImportProductStar}
                        starLoadingProductIds={importStarLoadingProductIds}
                        focusedRowKey={!importTableExpanded ? focusedImportRowKey : ''}
                    />

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={markAllImportLinesCompleted} className={ghostButton} disabled={!importModal.form.items.length}>
                                <span className="material-symbols-outlined text-[18px]">done_all</span>
                                {importCompleteToggleSnapshot ? 'Khôi phục trước khi hoàn thành' : 'Tất cả hoàn thành'}
                            </button>
                        </div>
                        <textarea value={importModal.form.notes} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú chung cho phiếu nhập" className="min-h-[92px] w-full rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary lg:max-w-[620px]" />
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={importModal.open && importTableExpanded}
                title="Bảng sản phẩm phiếu nhập"
                onClose={() => setImportTableExpanded(false)}
                maxWidth="max-w-[96vw]"
            >
                <ImportItemsEditorTable
                    items={importModal.form.items}
                    inventoryUnits={inventoryUnits}
                    supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null}
                    settingsOpen={importTableSettingsOpen}
                    onToggleSettings={() => setImportTableSettingsOpen((prev) => !prev)}
                    onCloseSettings={() => setImportTableSettingsOpen(false)}
                    expanded
                    onToggleExpanded={() => setImportTableExpanded(false)}
                    onOpenPrint={openImportPrintModal}
                    onUpdateLine={updateImportLine}
                    onSelectProduct={attachImportProductToLine}
                    onClearProduct={clearImportProductFromLine}
                    onRemoveLine={removeImportLine}
                    onMoveLine={moveImportLine}
                    onToggleProductStar={toggleImportProductStar}
                    starLoadingProductIds={importStarLoadingProductIds}
                    focusedRowKey={importTableExpanded ? focusedImportRowKey : ''}
                />
            </ModalShell>
            <ModalShell
                open={importDetailModal.open}
                title={importDetailModal.form.import_number ? `Chi tiết ${importDetailModal.form.import_number}` : 'Chi tiết phiếu nhập'}
                onClose={closeImportDetailModal}
                maxWidth="max-w-[96vw]"
            >
                {importDetailModal.loading ? (
                    <div className="py-14 text-center text-[13px] font-semibold text-primary/60">Đang tải chi tiết phiếu nhập...</div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Mã phiếu</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{importDetailModal.form.import_number || 'Phiếu nhập'}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Nhà cung cấp</div>
                                <div className="mt-1 text-[14px] font-semibold text-primary">{importDetailDocument.supplierName}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Ngày nhập</div>
                                <div className="mt-1 text-[14px] font-semibold text-primary">{formatPrintDate(importDetailModal.form.import_date)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Trạng thái</div>
                                <div className="mt-1">
                                    {importDetailStatus ? (
                                        <StatusPill label={importDetailStatus.name} color={importDetailStatus.color || '#94A3B8'} />
                                    ) : (
                                        <span className="text-[13px] font-semibold text-primary/60">Chưa có trạng thái</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Số dòng</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatNumber(importDetailDocument.items.length)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Tổng tiền hàng</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatCurrency(importDetailDocument.subtotal)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Tổng tiền đơn</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatCurrency(importDetailDocument.total)}</div>
                            </div>
                        </div>

                        <ImportItemsEditorTable
                            items={importDetailModal.form.items}
                            inventoryUnits={inventoryUnits}
                            settingsOpen={importDetailTableSettingsOpen}
                            onToggleSettings={() => setImportDetailTableSettingsOpen((prev) => !prev)}
                            onCloseSettings={() => setImportDetailTableSettingsOpen(false)}
                            expanded
                            onOpenPrint={() => openImportPrintModalWithForms([importDetailModal.form], 'detail')}
                            readOnly
                            hideActions
                            storageKey="inventory_import_detail_table_v1"
                            headerMessage="Xem toàn bộ danh sách sản phẩm trong phiếu nhập."
                        />

                        {importDetailModal.form.notes ? (
                            <div className="rounded-sm border border-primary/10 bg-white p-4">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chú phiếu nhập</div>
                                <div className="mt-2 text-[13px] leading-6 text-primary/75">{importDetailModal.form.notes}</div>
                            </div>
                        ) : null}
                    </div>
                )}
            </ModalShell>
            <ModalShell
                open={importPrintModalOpen}
                title={importPrintSource.mode === 'selected' && selectedImportPrintCount > 1 ? `In ${formatNumber(selectedImportPrintCount)} phiếu nhập` : 'In phiếu nhập'}
                onClose={closeImportPrintModal}
                maxWidth="max-w-[1180px]"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] font-semibold text-primary/65">
                            {formatNumber(importPrintSummary.documentCount)} phiếu • {formatNumber(importPrintSummary.lineCount)} dòng sản phẩm
                            {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
                                ? ` • ${formatNumber(importPutawaySummary.quantity)} sản phẩm cần xếp`
                                : ` • ${formatNumber(importPrintSelectedColumns.length)} cột in`}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={closeImportPrintModal} className={ghostButton}>Đóng</button>
                            {importPrintMode === IMPORT_PRINT_MODE_STANDARD ? (
                                <>
                                    <button type="button" onClick={() => saveImportPrintTemplate('update')} className={ghostButton} disabled={importPrintSettingsSaving || importPrintLoading}>
                                        {importPrintSettingsSaving ? 'Đang lưu' : 'Lưu mẫu hiện tại'}
                                    </button>
                                    <button type="button" onClick={() => saveImportPrintTemplate('new')} className={ghostButton} disabled={importPrintSettingsSaving || importPrintLoading}>
                                        Lưu thành mẫu mới
                                    </button>
                                </>
                            ) : null}
                            <button type="button" onClick={printImportSheet} className={primaryButton} disabled={importPrintLoading || !importPrintDocuments.length}>
                                <span className="material-symbols-outlined text-[18px]">print</span>
                                {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY ? 'In bảng xếp hàng' : 'In theo mẫu đang chọn'}
                            </button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-[#f8fafc] p-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setImportPrintMode(IMPORT_PRINT_MODE_PUTAWAY);
                                setImportPrintPreviewPrintedAt(new Date().toISOString());
                            }}
                            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-[12px] font-black transition ${
                                importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'bg-white text-primary hover:bg-primary/5'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">shelves</span>
                            Xếp hàng
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setImportPrintMode(IMPORT_PRINT_MODE_STANDARD);
                                setImportPrintPreviewPrintedAt(new Date().toISOString());
                            }}
                            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-sm px-3 text-[12px] font-black transition ${
                                importPrintMode === IMPORT_PRINT_MODE_STANDARD
                                    ? 'bg-primary text-white shadow-sm'
                                    : 'bg-white text-primary hover:bg-primary/5'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                            Phiếu nhập
                        </button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                        <div className="space-y-4">
                            {importPrintMode === IMPORT_PRINT_MODE_STANDARD ? (
                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="space-y-3">
                                        <div>
                                            <div className={importFieldLabelClass}>Mẫu in</div>
                                            <select
                                                value={importPrintTemplateId}
                                                onChange={(event) => applyImportPrintTemplate(event.target.value)}
                                                className={`w-full ${selectClass}`}
                                            >
                                                {importPrintTemplates.map((template) => (
                                                    <option key={template.id} value={template.id}>
                                                        {template.name}{template.locked ? ' (mặc định)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <div className={importFieldLabelClass}>Tên mẫu</div>
                                            <input
                                                value={importPrintTemplateName}
                                                onChange={(event) => setImportPrintTemplateName(event.target.value)}
                                                className={`w-full ${inputClass}`}
                                                placeholder="Ví dụ: Bản chính"
                                            />
                                        </div>

                                        <button type="button" onClick={() => applyImportPrintTemplate(IMPORT_PRINT_DEFAULT_TEMPLATE_ID)} className={ghostButton}>
                                            Trả về mẫu mặc định
                                        </button>

                                        <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5 text-[12px] text-primary/70">
                                            <div>Nguồn in: <span className="font-bold text-primary">{importPrintSource.mode === 'selected' ? (importPrintSummary.documentCount > 1 ? `${formatNumber(importPrintSummary.documentCount)} phiếu đã chọn` : 'Phiếu nhập đã chọn') : importPrintSource.mode === 'detail' ? 'Popup chi tiết phiếu nhập' : 'Popup tạo / sửa phiếu nhập'}</span></div>
                                            <div className="mt-1">Nhà cung cấp: <span className="font-bold text-primary">{importPrintSummary.documentCount === 1 ? (importPrintDocuments[0]?.supplierName || '-') : 'Nhiều nhà cung cấp'}</span></div>
                                            <div className="mt-1">Ngày giờ preview: <span className="font-bold text-primary">{formatDateTime(importPrintPreviewPrintedAt)}</span></div>
                                            <div className="mt-1">Số phiếu / tổng tiền: <span className="font-bold text-primary">{formatNumber(importPrintSummary.documentCount)} / {formatCurrency(importPrintSummary.total)}</span></div>
                                            {importPrintLoading ? <div className="mt-1 text-primary/55">Đang chuẩn bị dữ liệu in...</div> : null}
                                            {importPrintSettingsLoading ? <div className="mt-1 text-primary/55">Đang tải mẫu in đã lưu...</div> : null}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[13px] font-black text-primary">Bảng xếp hàng</div>
                                            <div className="text-[12px] text-primary/55">Tên, mã, số lượng và vị trí xếp.</div>
                                        </div>
                                        <span className="material-symbols-outlined text-[24px] text-primary/35">shelves</span>
                                    </div>

                                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                                        <div>
                                            <dt className="font-bold text-primary/45">Số lượng</dt>
                                            <dd className="mt-0.5 text-[16px] font-black text-primary">{formatNumber(importPutawaySummary.quantity)}</dd>
                                        </div>
                                        <div>
                                            <dt className="font-bold text-primary/45">Chưa vị trí</dt>
                                            <dd className={`mt-0.5 text-[16px] font-black ${importPutawaySummary.missingLocationCount > 0 ? 'text-amber-600' : 'text-primary'}`}>
                                                {formatNumber(importPutawaySummary.missingLocationCount)}
                                            </dd>
                                        </div>
                                    </dl>

                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {importPutawayPrintColumns.filter((column) => column.id !== 'stt').map((column) => (
                                            <span key={column.id} className="rounded-sm border border-primary/10 bg-[#f8fafc] px-2 py-1 text-[11px] font-bold text-primary/65">
                                                {column.label}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="rounded-sm border border-primary/10 bg-white p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[13px] font-black text-primary">Phiếu đang in</div>
                                        <div className="text-[12px] text-primary/55">
                                            {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
                                                ? 'Bảng xếp hàng in A4 dọc theo từng phiếu.'
                                                : 'Mỗi phiếu sẽ in trên trang A4 riêng với đúng nhà cung cấp và dữ liệu sản phẩm.'}
                                        </div>
                                    </div>
                                    <div className="text-right text-[12px] font-semibold text-primary/60">
                                        {formatNumber(importPrintSummary.documentCount)} phiếu
                                    </div>
                                </div>

                                <div className="mt-3 max-h-56 space-y-2 overflow-auto">
                                    {!importPrintDocuments.length ? (
                                        <div className="rounded-sm border border-dashed border-primary/15 px-3 py-3 text-[12px] text-primary/55">Chưa có phiếu nhập để xem trước.</div>
                                    ) : importPrintDocuments.map((document, index) => (
                                        <div key={`${document.importNumber || 'print'}_${index}`} className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5 text-[12px] text-primary/70">
                                            <div className="font-black text-primary">{document.importNumber || `Phiếu ${index + 1}`}</div>
                                            <div className="mt-1 truncate">{document.supplierName}</div>
                                            <div className="mt-1">
                                                {formatNumber(document.items.length)} dòng
                                                {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
                                                    ? ` • ${formatNumber(document.items.reduce((sum, item) => sum + Number(item.quantity_to_putaway ?? item.quantity ?? 0), 0))} sản phẩm`
                                                    : ` • ${formatCurrency(document.total)}`}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {importPrintMode === IMPORT_PRINT_MODE_STANDARD ? (
                                <div className="rounded-sm border border-primary/10 bg-white p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[13px] font-black text-primary">Cột cần in</div>
                                            <div className="text-[12px] text-primary/55">Tick chọn các cột xuất hiện trên bản in A4.</div>
                                        </div>
                                        <div className="text-right text-[12px] font-semibold text-primary/60">
                                            {formatNumber(importPrintSelectedColumns.length)} / {formatNumber(importPrintColumns.length)} cột
                                        </div>
                                    </div>

                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        {importPrintColumns.map((column) => (
                                            <label key={column.id} className="flex items-center gap-2 rounded-sm border border-primary/10 px-3 py-2 text-[13px] font-semibold text-primary transition hover:border-primary/25 hover:bg-primary/[0.03]">
                                                <input
                                                    type="checkbox"
                                                    checked={importPrintColumnIds.includes(column.id)}
                                                    onChange={() => toggleImportPrintColumn(column.id)}
                                                    className="size-4 accent-primary"
                                                />
                                                <span>{column.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                <div>
                                    <div className="text-[13px] font-black text-primary">
                                        {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY ? 'Xem trước bảng xếp hàng' : 'Xem trước bản in'}
                                    </div>
                                    <div className="text-[12px] text-primary/55">
                                        {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY
                                            ? 'A4 dọc, sắp theo kệ và tầng.'
                                            : 'Tối ưu cho khổ giấy A4, tự chuyển ngang khi số cột quá nhiều.'}
                                    </div>
                                </div>
                                <div className="text-right text-[12px] text-primary/60">
                                    <div>{formatNumber(importPrintSummary.documentCount)} phiếu • {formatNumber(importPrintSummary.lineCount)} dòng</div>
                                    {importPrintMode === IMPORT_PRINT_MODE_PUTAWAY ? (
                                        <>
                                            <div>{formatNumber(importPutawaySummary.quantity)} sản phẩm cần xếp</div>
                                            {importPutawaySummary.missingLocationCount > 0 ? (
                                                <div className="font-bold text-amber-600">{formatNumber(importPutawaySummary.missingLocationCount)} dòng chưa có vị trí</div>
                                            ) : null}
                                        </>
                                    ) : (
                                        <div>{formatCurrency(importPrintSummary.total)} tổng tiền in</div>
                                    )}
                                </div>
                            </div>

                            {importPrintLoading ? (
                                <div className="flex h-[62vh] items-center justify-center rounded-sm border border-primary/10 bg-white text-[13px] font-semibold text-primary/60">
                                    Đang chuẩn bị bản xem trước...
                                </div>
                            ) : (
                                <iframe
                                    title={importPrintMode === IMPORT_PRINT_MODE_PUTAWAY ? 'Xem trước in bảng xếp hàng' : 'Xem trước in phiếu nhập'}
                                    srcDoc={importPrintPreviewHtml}
                                    className="h-[62vh] w-full rounded-sm border border-primary/10 bg-white"
                                />
                            )}
                        </div>
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={importStatusModal.open}
                title={importStatusModal.form.id ? 'Sửa trạng thái phiếu nhập' : 'Tạo trạng thái phiếu nhập'}
                onClose={() => setImportStatusModal({ open: false, form: createImportStatusForm() })}
                maxWidth="max-w-3xl"
                footer={(
                    <div className="flex justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                            {importStatuses.map((status) => (
                                <button key={status.id} type="button" onClick={() => setImportStatusModal({ open: true, form: createImportStatusForm(status) })} className={ghostButton}>
                                    {status.name}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setImportStatusModal({ open: false, form: createImportStatusForm() })} className={ghostButton}>Đóng</button>
                            <button type="button" onClick={saveImportStatus} className={primaryButton} disabled={loading.importStatusModal}>{loading.importStatusModal ? 'Đang lưu' : 'Lưu trạng thái'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="grid gap-3 md:grid-cols-2">
                    <input value={importStatusModal.form.name} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} placeholder="Tên trạng thái" className={inputClass} />
                    <div className="flex items-center gap-3 rounded-sm border border-primary/15 px-3">
                        <span className="text-[12px] font-bold text-primary/60">Màu hiển thị</span>
                        <input type="color" value={importStatusModal.form.color || '#10B981'} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, color: event.target.value } }))} className="h-10 w-14 cursor-pointer border-0 bg-transparent p-0" />
                        <StatusPill label={importStatusModal.form.name || 'Xem trước'} color={importStatusModal.form.color || '#10B981'} />
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary">
                        <input type="checkbox" checked={importStatusModal.form.affects_inventory} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, affects_inventory: event.target.checked } }))} className="size-4 accent-primary" />
                        Trạng thái này cập nhật tồn kho
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary">
                        <input type="checkbox" checked={importStatusModal.form.is_default} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, is_default: event.target.checked } }))} className="size-4 accent-primary" />
                        Đặt làm trạng thái mặc định
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary md:col-span-2">
                        <input type="checkbox" checked={importStatusModal.form.is_active} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, is_active: event.target.checked } }))} className="size-4 accent-primary" />
                        Đang sử dụng
                    </label>
                </div>
            </ModalShell>
            <ModalShell
                open={exportModal.open}
                title="Tạo phiếu xuất"
                onClose={closeExportModal}
                maxWidth="max-w-6xl"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="grid gap-2 sm:grid-cols-4">
                            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Nguồn xuất</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{getExportSaleChannelLabel(exportModal.form.source || exportSourceOptions[0].value)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Số dòng</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatNumber(exportModal.form.items.filter((item) => item.product_id).length)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Tổng số lượng</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatNumber(exportTotalQuantity)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Giá trị tạm tính</div>
                                <div className="mt-1 text-[15px] font-black text-primary">{formatCurrency(exportLineTotal)}</div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={closeExportModal} className={ghostButton}>Hủy</button>
                            <button type="button" onClick={saveExport} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Đang lưu' : 'Lưu phiếu xuất'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-4 py-3 text-[13px] text-primary/70">
                        Đơn hàng nào đã gửi sang đơn vị vận chuyển và có mã vận đơn sẽ tự xuất hiện ở mục này như một phiếu xuất tự động.
                        Mẫu dưới đây chỉ dùng cho các phiếu xuất tạo tay hoặc xuất nội bộ.
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
                        <div className="space-y-4">
                            <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] p-4">
                                <div className="mb-3 text-[12px] font-black uppercase tracking-[0.12em] text-primary/55">Thông tin phiếu xuất</div>
                                <div className="space-y-3">
                                    <div>
                                        <div className={importFieldLabelClass}>Nguồn xuất</div>
                                        <select value={exportModal.form.source} onChange={(event) => updateExportSaleChannel(event.target.value)} className={`w-full ${selectClass}`}>
                                            {exportSourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <div>
                                            <div className={importFieldLabelClass}>Người nhận / bộ phận</div>
                                            <input value={exportModal.form.customer_name} onChange={(event) => setExportModal((prev) => ({ ...prev, form: { ...prev.form, customer_name: event.target.value } }))} placeholder="Ví dụ: Khách lẻ / Bộ phận bán hàng" className={`w-full ${inputClass}`} />
                                        </div>
                                        <div>
                                            <div className={importFieldLabelClass}>Số điện thoại</div>
                                            <input value={exportModal.form.customer_phone} onChange={(event) => setExportModal((prev) => ({ ...prev, form: { ...prev.form, customer_phone: event.target.value } }))} placeholder="Không bắt buộc" className={`w-full ${inputClass}`} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className={importFieldLabelClass}>Nơi giao / nơi nhận</div>
                                        <input value={exportModal.form.shipping_address} onChange={(event) => setExportModal((prev) => ({ ...prev, form: { ...prev.form, shipping_address: event.target.value } }))} placeholder="Ví dụ: Quầy cửa hàng, kho giao nhanh, địa chỉ khách" className={`w-full ${inputClass}`} />
                                    </div>
                                    <div>
                                        <div className={importFieldLabelClass}>Ghi chú vận hành</div>
                                        <textarea value={exportModal.form.notes} onChange={(event) => setExportModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú thêm về lần xuất này" className="min-h-[120px] w-full rounded-sm border border-primary/15 p-3 text-[13px] text-primary outline-none focus:border-primary" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-sm border border-primary/10 bg-white p-4">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="text-[12px] font-black uppercase tracking-[0.12em] text-primary/55">Sản phẩm xuất kho</div>
                                        <div className="text-[12px] text-primary/45">Chỉ quản lí số lượng và giá trị tạm tính để theo dõi tồn kho nội bộ.</div>
                                    </div>
                                    <button type="button" onClick={() => addLine(setExportModal)} className={ghostButton}>Thêm dòng</button>
                                </div>
                                <ProductLookupInput
                                    onSelect={(product) => {
                                        const index = exportModal.form.items.findIndex((item) => !item.product_id);
                                        const targetIndex = index >= 0 ? index : exportModal.form.items.length;
                                        if (index < 0) addLine(setExportModal);
                                        attachExportProductToLine(targetIndex, product);
                                    }}
                                    placeholder="Tìm tên, mã sản phẩm để thêm nhanh vào phiếu xuất"
                                    buttonLabel="Thêm vào phiếu"
                                />
                                <div className="mt-4 overflow-hidden rounded-sm border border-primary/10">
                                    <table className="w-full border-collapse">
                                        <thead className="bg-[#f6f9fc]">
                                            <tr>
                                                {['Sản phẩm', 'Số lượng', 'Đơn giá xuất', 'Thành tiền', 'Ghi chú dòng', 'Xóa'].map((label) => (
                                                    <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary last:border-r-0">{label}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {exportModal.form.items.map((item, index) => (
                                                <tr key={item.key}>
                                                    <td className="border-b border-r border-primary/10 px-3 py-2 align-top">
                                                        <div className="space-y-2">
                                                            {item.product_id ? <CellText primary={item.product_name || '-'} secondary={[item.product_sku || '-', item.unit_name || null].filter(Boolean).join(' • ')} /> : <div className="text-[12px] text-primary/45">Chưa chọn sản phẩm</div>}
                                                            <ProductLookupInput onSelect={(product) => attachExportProductToLine(index, product)} placeholder="Đổi sản phẩm" buttonLabel="Chọn" />
                                                        </div>
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-2 align-top">
                                                        <input value={item.quantity} onChange={(event) => updateLine(setExportModal, index, 'quantity', normalizeQuantityDraft(event.target.value))} inputMode="decimal" className={`w-full ${inputClass}`} />
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-2 align-top">
                                                        <input value={formatWholeNumberInput(item.unit_cost)} onChange={(event) => updateLine(setExportModal, index, 'unit_cost', normalizeWholeMoneyDraft(event.target.value))} className={`w-full text-right ${inputClass}`} />
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-2 align-top text-right text-[13px] font-black text-primary">
                                                        {formatCurrency(Number(item.quantity || 0) * Number(item.unit_cost || 0))}
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-2 align-top">
                                                        <input value={item.notes} onChange={(event) => updateLine(setExportModal, index, 'notes', event.target.value)} className={`w-full ${inputClass}`} placeholder="Ghi chú riêng cho dòng này" />
                                                    </td>
                                                    <td className="border-b border-primary/10 px-3 py-2 align-top text-center">
                                                        <button type="button" onClick={() => removeLine(setExportModal, index)} className={dangerButton}>Xóa</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={documentModal.open}
                title={documentModal.form.id ? `Sửa ${documentTitleMap[documentModal.tabKey]}` : `Tạo ${documentTitleMap[documentModal.tabKey]}`}
                onClose={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })}
                footer={(
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-[13px] font-black text-primary">
                            {documentModal.tabKey === 'damaged'
                                ? `Tổng số lượng: ${formatNumber(documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}`
                                : `Tổng giá trị tạm tính: ${formatCurrency(documentLineTotal)}`}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })}
                                className={ghostButton}
                            >
                                Hủy
                            </button>
                            <button type="button" onClick={saveDocument} className={primaryButton} disabled={loading.saving}>
                                {loading.saving ? 'Đang lưu' : 'Lưu phiếu'}
                            </button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                        <input
                            type="date"
                            value={documentModal.form.document_date}
                            onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, document_date: event.target.value } }))}
                            className={inputClass}
                        />
                        <select
                            value={documentModal.form.supplier_id}
                            onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, supplier_id: event.target.value } }))}
                            className={selectClass}
                        >
                            <option value="">Không gắn nhà cung cấp</option>
                            {suppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                            ))}
                        </select>
                        <div className="flex items-center rounded-sm border border-primary/15 px-3 text-[13px] font-semibold text-primary">
                            {documentTitleMap[documentModal.tabKey]}
                        </div>
                    </div>

                    <ProductLookupInput
                        supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null}
                        onSelect={(product) => {
                            const index = documentModal.form.items.findIndex((item) => !item.product_id);
                            const targetIndex = index >= 0 ? index : documentModal.form.items.length;
                            if (index < 0) addLine(setDocumentModal);
                            attachProductToLine(setDocumentModal, targetIndex, product);
                        }}
                        buttonLabel="Thêm vào phiếu"
                    />

                    {documentModal.tabKey === 'adjustments' ? (
                        <div className="rounded-sm border border-primary/10 bg-[#f8fbff] px-3 py-2 text-[12px] font-medium text-primary/75">
                            Phiếu tạo tay tại đây luôn là điều chỉnh tồn kho độc lập: nhập số dương để cộng tồn, nhập số âm để trừ tồn. Các phiếu điều chỉnh phiếu xuất sẽ được hệ thống tự sinh từ phiếu hoàn hoặc chênh lệch xuất-hoàn.
                        </div>
                    ) : null}

                    <div className="overflow-hidden rounded-sm border border-primary/10">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#f6f9fc]">
                                <tr>
                                    {[
                                        'Sản phẩm',
                                        'Số lượng',
                                        documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? 'Giá vốn' : null,
                                        'Ghi chú',
                                        'Xóa',
                                    ].filter(Boolean).map((label) => (
                                        <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary">
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {documentModal.form.items.map((item, index) => (
                                    <tr key={item.key}>
                                        <td className="border-b border-r border-primary/10 px-3 py-2">
                                            <div className="space-y-2">
                                                {item.product_id ? (
                                                    <CellText primary={item.product_name || '-'} secondary={item.product_sku || '-'} />
                                                ) : (
                                                    <div className="text-[12px] text-primary/45">Chưa chọn sản phẩm</div>
                                                )}
                                                <ProductLookupInput
                                                    supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null}
                                                    onSelect={(product) => attachProductToLine(setDocumentModal, index, product)}
                                                    placeholder="Đổi sản phẩm"
                                                    buttonLabel="Chọn"
                                                />
                                            </div>
                                        </td>
                                        <td className="border-b border-r border-primary/10 px-3 py-2">
                                            {documentModal.tabKey === 'adjustments' ? (
                                                <div className="flex h-8 overflow-hidden rounded-sm border border-primary/15 bg-white transition focus-within:border-primary">
                                                    <input
                                                        value={item.quantity}
                                                        onChange={(event) => updateLine(
                                                            setDocumentModal,
                                                            index,
                                                            'quantity',
                                                            normalizeSignedWholeNumberInput(event.target.value)
                                                        )}
                                                        onKeyDown={(event) => {
                                                            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

                                                            event.preventDefault();
                                                            updateLine(
                                                                setDocumentModal,
                                                                index,
                                                                'quantity',
                                                                nudgeSignedWholeNumberInput(item.quantity, event.key === 'ArrowUp' ? 1 : -1)
                                                            );
                                                        }}
                                                        className="h-full flex-1 border-0 bg-transparent px-3 text-right text-[13px] text-primary outline-none placeholder:text-primary/35"
                                                        placeholder="Âm để giảm, dương để tăng"
                                                    />
                                                    <div className="flex w-6 flex-col border-l border-primary/10 bg-primary/[0.02]">
                                                        <button
                                                            type="button"
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => updateLine(setDocumentModal, index, 'quantity', nudgeSignedWholeNumberInput(item.quantity, 1))}
                                                            className="flex flex-1 items-center justify-center border-b border-primary/10 text-primary/45 transition hover:bg-primary/[0.06] hover:text-primary"
                                                            aria-label="Tăng số lượng điều chỉnh"
                                                        >
                                                            <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2 w-2 fill-current">
                                                                <path d="M5 2 9 7H1z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onMouseDown={(event) => event.preventDefault()}
                                                            onClick={() => updateLine(setDocumentModal, index, 'quantity', nudgeSignedWholeNumberInput(item.quantity, -1))}
                                                            className="flex flex-1 items-center justify-center text-primary/45 transition hover:bg-primary/[0.06] hover:text-primary"
                                                            aria-label="Giảm số lượng điều chỉnh"
                                                        >
                                                            <svg viewBox="0 0 10 10" aria-hidden="true" className="h-2 w-2 fill-current">
                                                                <path d="M1 3h8L5 8z" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <input
                                                    value={item.quantity}
                                                    onChange={(event) => updateLine(
                                                        setDocumentModal,
                                                        index,
                                                        'quantity',
                                                        normalizeQuantityDraft(event.target.value)
                                                    )}
                                                    inputMode="decimal"
                                                    className={`w-full text-right ${inputClass}`}
                                                />
                                            )}
                                        </td>
                                        {documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? (
                                            <td className="border-b border-r border-primary/10 px-3 py-2">
                                                <input
                                                    value={formatWholeNumberInput(item.unit_cost)}
                                                    onChange={(event) => updateLine(setDocumentModal, index, 'unit_cost', normalizeWholeMoneyDraft(event.target.value))}
                                                    className={`w-full text-right ${inputClass}`}
                                                />
                                            </td>
                                        ) : null}
                                        <td className="border-b border-r border-primary/10 px-3 py-2">
                                            <input
                                                value={item.notes}
                                                onChange={(event) => updateLine(setDocumentModal, index, 'notes', event.target.value)}
                                                className={`w-full ${inputClass}`}
                                                placeholder="Ghi chú"
                                            />
                                        </td>
                                        <td className="border-b border-primary/10 px-3 py-2 text-center">
                                            <button type="button" onClick={() => removeLine(setDocumentModal, index)} className={dangerButton}>
                                                Xóa
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex justify-between gap-2">
                        <button type="button" onClick={() => addLine(setDocumentModal)} className={ghostButton}>Thêm dòng</button>
                        <textarea
                            value={documentModal.form.notes}
                            onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))}
                            placeholder="Ghi chú phiếu kho"
                            className="min-h-[96px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary"
                        />
                    </div>
                </div>
            </ModalShell>
            <InventoryProductDailyOutboundDrawer
                open={dailyOutboundDrawer.open}
                product={dailyOutboundDrawer.product}
                onClose={closeProductDailyOutboundDrawer}
            />
            <BatchReturnSlipModal
                open={batchReturnModal.open}
                mode="edit"
                documentId={batchReturnModal.documentId}
                onClose={closeBatchReturnModal}
                onSaved={handleBatchReturnSaved}
                onNotify={showToast}
            />
        </div>
    );
};

export default InventoryMovement;

