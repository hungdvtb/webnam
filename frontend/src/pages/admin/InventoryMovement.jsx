import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import SortIndicator from '../../components/SortIndicator';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import { useUI } from '../../context/UIContext';
import { useTableColumns } from '../../hooks/useTableColumns';
import { categoryApi, cmsApi, inventoryApi, orderApi, productApi } from '../../services/api';

const emptyPagination = { current_page: 1, last_page: 1, total: 0, per_page: 20 };
const todayValue = new Date().toISOString().slice(0, 10);
const tableViewportClass = 'max-h-[calc(100vh-310px)] overflow-auto';
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
const importQuickSearchClass = 'h-11 w-full rounded-sm border border-primary/15 bg-white pl-9 pr-9 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const importActionButtonClass = 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-center text-[11px] font-bold leading-tight text-primary transition hover:border-primary hover:bg-primary/[0.04] disabled:cursor-not-allowed disabled:opacity-60';
const importFieldLabelClass = 'mb-1 text-[12px] font-black uppercase tracking-[0.1em] text-primary/50';
const importFieldLabelHiddenClass = `${importFieldLabelClass} select-none opacity-0`;
const quickSearchInputClass = 'h-9 w-full rounded-sm border border-primary/15 bg-white pl-9 pr-9 text-[13px] text-primary outline-none transition placeholder:text-primary/35 focus:border-primary';
const inventorySearchCache = new Map();
const INVENTORY_SEARCH_CACHE_LIMIT = 80;
const INVENTORY_SEARCH_CACHE_TTL = 60 * 1000;
const IMPORT_PRINT_SETTINGS_KEY = 'inventory_import_print_templates';
const IMPORT_PRINT_DEFAULT_TEMPLATE_ID = 'inventory_import_default_template';
const IMPORT_PRINT_DEFAULT_TEMPLATE_NAME = 'BÃ¡ÂºÂ£n chÃƒÂ­nh';

const topTabs = [
    ['overview', 'TÃ¡Â»â€¢ng quan'],
    ['products', 'SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'],
    ['suppliers', 'NhÃƒÂ  cung cÃ¡ÂºÂ¥p'],
    ['supplierPrices', 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p tÃ¡Â»Â«ng nhÃƒÂ '],
    ['lots', 'LÃƒÂ´ hÃƒÂ ng'],
    ['trash', 'ThÃƒÂ¹ng rÃƒÂ¡c'],
];

const documentTabs = [
    ['imports', 'PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'],
    ['exports', 'PhiÃ¡ÂºÂ¿u xuÃ¡ÂºÂ¥t'],
    ['returns', 'PhiÃ¡ÂºÂ¿u hoÃƒÂ n'],
    ['damaged', 'PhiÃ¡ÂºÂ¿u hÃ¡Â»Âng'],
    ['adjustments', 'PhiÃ¡ÂºÂ¿u Ã„â€˜iÃ¡Â»Âu chÃ¡Â»â€°nh'],
];
const slipListTabKeys = ['imports', 'exports', 'returns', 'damaged', 'adjustments'];

const isDocumentTab = (tabKey) => documentTabs.some(([key]) => key === tabKey);

const documentTypeMap = { returns: 'return', damaged: 'damaged', adjustments: 'adjustment' };
const documentTitleMap = { returns: 'PhiÃ¡ÂºÂ¿u hÃƒÂ ng hoÃƒÂ n', damaged: 'PhiÃ¡ÂºÂ¿u hÃƒÂ ng hÃ¡Â»Âng', adjustments: 'PhiÃ¡ÂºÂ¿u Ã„â€˜iÃ¡Â»Âu chÃ¡Â»â€°nh' };
const pageSizeOptions = [20, 50, 100, 500];
const inventoryTableStorageVersion = 'v4';
const emptySortConfig = { key: null, direction: 'none' };
const getStoredPageSize = (key) => {
    if (typeof window === 'undefined') return 20;
    const raw = Number(localStorage.getItem(`inventory_page_size_${key}`) || 20);
    return pageSizeOptions.includes(raw) ? raw : 20;
};
const createSlipSelectionState = () => ({
    imports: {},
    exports: {},
    returns: {},
    damaged: {},
    adjustments: {},
});
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

const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}Ã„â€˜`;
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const stripNumericValue = (value) => String(value ?? '').replace(/[^0-9]/g, '');
const formatWholeNumberInput = (value) => {
    const cleaned = stripNumericValue(value);
    return cleaned ? formatNumber(cleaned) : '';
};
const parseWholeNumberInput = (value) => {
    const cleaned = stripNumericValue(value);
    return cleaned ? Number(cleaned) : null;
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
const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
};
const normalizeSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Ã„â€˜Ã„Â]/g, 'd')
    .toLowerCase()
    .trim();
const normalizeSupplierCodeKey = (value) => String(value ?? '').trim().toLowerCase();
const buildInventorySearchMeta = (row) => [
    row?.sku ? `MÃƒÂ£ SP: ${row.sku}` : null,
    row?.supplier_product_code ? `MÃƒÂ£ NCC: ${row.supplier_product_code}` : null,
    row?.parent_name ? `ThuÃ¡Â»â„¢c: ${row.parent_name}` : null,
]
    .filter(Boolean)
    .join(' Ã¢â‚¬Â¢ ');
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
const inventorySearchCacheKey = ({ query, supplierId = null, limit = 20 }) => {
    const normalizedQuery = normalizeSearchText(query);
    return `${supplierId || 'all'}::${limit}::${normalizedQuery}`;
};
const fetchInventorySearchResults = async ({ query, supplierId = null, limit = 20, signal } = {}) => {
    const trimmed = String(query ?? '').trim();
    if (!trimmed) return [];

    const cacheKey = inventorySearchCacheKey({ query: trimmed, supplierId, limit });
    const cachedEntry = inventorySearchCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp <= INVENTORY_SEARCH_CACHE_TTL) {
        return cachedEntry.data;
    }

    const normalizedQuery = normalizeSearchText(trimmed);
    const response = await inventoryApi.getProducts({
        search: trimmed,
        quick_search: trimmed,
        with_variants: 1,
        variant_scope: 'roots',
        per_page: Math.max(limit, 24),
        supplier_id: supplierId || undefined,
        picker: 1,
        without_summary: 1,
    }, signal);

    const rows = flattenInventorySearchProducts(response.data?.data || [], normalizedQuery)
        .map((row, index) => ({
            ...row,
            _search_score: scoreInventorySearchRow(row, normalizedQuery),
            _source_rank: index,
        }))
        .sort((left, right) => {
            if (right._search_score !== left._search_score) {
                return right._search_score - left._search_score;
            }
            if (left._source_rank !== right._source_rank) {
                return left._source_rank - right._source_rank;
            }
            return String(left.name || '').localeCompare(String(right.name || ''), 'vi');
        })
        .slice(0, limit);

    inventorySearchCache.set(cacheKey, {
        timestamp: Date.now(),
        data: rows,
    });
    pruneInventorySearchCache();
    return rows;
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
    update_supplier_price: true,
    mapping_status: 'manual',
    mapping_label: '',
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
    unit_cost: price?.unit_cost != null ? stripNumericValue(Math.round(Number(price.unit_cost || 0))) : '',
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
    unit_cost: item.supplier_unit_cost ?? null,
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

    return {
        id: data?.id || null,
        supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
        inventory_import_status_id: data?.inventory_import_status_id ? String(data.inventory_import_status_id) : '',
        status_is_manual: data?.status_is_manual ?? Boolean(data?.id && data?.inventory_import_status_id),
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
        analysis_log: data?.invoiceAnalysisLogs?.[0] || null,
        attachments: Array.isArray(data?.attachments)
            ? data.attachments.map((attachment) => ({
                id: attachment.id,
                invoice_analysis_log_id: attachment.invoice_analysis_log_id || null,
                source_type: attachment.source_type || 'manual',
                disk: attachment.disk || 'public',
                file_path: attachment.file_path,
                original_name: attachment.original_name || 'TÃ¡Â»â€¡p Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m',
                mime_type: attachment.mime_type || null,
                file_size: attachment.file_size || 0,
                created_at: attachment.created_at || null,
                url: attachment.url || null,
            }))
            : [],
        local_attachment_files: [],
        items: (data?.items || []).length
            ? data.items.map((item) => createLine({
                product_id: item.product_id,
                product_name: item.product?.name || item.product_name_snapshot || '',
                product_sku: item.product?.sku || item.product_sku_snapshot || '',
                supplier_product_code: item.supplier_product_code_snapshot || item.supplierPrice?.supplier_product_code || '',
                quantity: String(item.quantity || 1),
                received_quantity: String(item.received_quantity ?? 0),
                unit_name: item.unit_name_snapshot || item.product?.unit?.name || item.product?.unit_name || '',
                unit_cost: String(Math.round(Number(item.unit_cost || 0))),
                notes: item.notes || '',
                update_supplier_price: data?.update_supplier_prices ?? true,
                mapping_status: item.product_id ? 'matched' : 'manual',
                mapping_label: item.product_id ? 'Ã„ÂÃƒÂ£ map sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m' : '',
            }))
            : [],
    };
};
const normalizePrintableImportItems = (items = []) => (Array.isArray(items) ? items : [])
    .filter((item) => item && (
        Number(item.product_id || 0) > 0
        || String(item.product_name || '').trim()
        || String(item.product_sku || '').trim()
        || String(item.supplier_product_code || '').trim()
    ))
    .map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        received_quantity: Number(item.received_quantity ?? 0),
        unit_cost: Number(item.unit_cost || 0),
    }));
const buildPrintableImportDocument = (data = null) => {
    const form = createImportForm(data);
    const items = normalizePrintableImportItems(form.items);
    const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_cost || 0)), 0);
    const surcharge = parseImportSurchargeFields({
        amountInput: form.extra_charge_amount_input,
        percentInput: form.extra_charge_percent_input,
    }, subtotal).amount;

    return {
        id: data?.id || form.id || null,
        documentCode: data?.import_number || '',
        supplierName: data?.supplier?.name || 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m',
        importDate: data?.import_date || form.import_date || '',
        notes: form.notes || '',
        items,
        subtotal,
        surcharge,
        total: subtotal + surcharge,
        title: 'PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p',
        subtitle: 'BÃ¡ÂºÂ£n in tÃ¡Â»â€˜i Ã†Â°u cho khÃ¡Â»â€¢ giÃ¡ÂºÂ¥y A4',
    };
};
const appendUniqueFiles = (existingFiles = [], incomingFiles = []) => {
    const normalizedExistingFiles = Array.isArray(existingFiles) ? existingFiles : [];
    const candidateFiles = Array.from(incomingFiles || []);
    if (!candidateFiles.length) return normalizedExistingFiles;
    const existingKeys = new Set(normalizedExistingFiles.map((file) => `${file.name}_${file.size}_${file.lastModified}`));

    return [
        ...normalizedExistingFiles,
        ...candidateFiles.filter((file) => !existingKeys.has(`${file.name}_${file.size}_${file.lastModified}`)),
    ];
};
const removeAttachmentFromFormState = (form, attachmentIndex) => ({
    ...form,
    attachments: (form.attachments || []).filter((_, index) => index !== attachmentIndex),
});
const removeLocalFileFromFormState = (form, fileIndex) => ({
    ...form,
    local_attachment_files: (form.local_attachment_files || []).filter((_, index) => index !== fileIndex),
});
const appendAttachmentFilesToFormState = (form, fileList) => ({
    ...form,
    local_attachment_files: appendUniqueFiles(form.local_attachment_files || [], fileList),
});
const formatAttachmentFileSize = (value) => {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};
const getAttachmentPreviewKind = ({ mimeType = '', fileName = '' } = {}) => {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    const normalizedFileName = String(fileName || '').toLowerCase();

    if (normalizedMimeType.includes('pdf') || normalizedFileName.endsWith('.pdf')) return 'pdf';
    if (normalizedMimeType.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|svg|avif|heic|heif)$/i.test(normalizedFileName)) return 'image';
    return 'other';
};

const createImportStatusForm = (status = null) => ({
    id: status?.id || null,
    name: status?.name || '',
    color: status?.color || '#10B981',
    affects_inventory: Boolean(status?.affects_inventory),
    is_active: status?.is_active ?? true,
    is_default: Boolean(status?.is_default),
});

const createDocumentForm = (tabKey, data = null) => ({
    id: data?.id || null,
    type: documentTypeMap[tabKey],
    document_date: data?.document_date ? String(data.document_date).slice(0, 10) : todayValue,
    supplier_id: data?.supplier_id ? String(data.supplier_id) : '',
    notes: data?.notes || '',
    items: (data?.items || []).length
        ? data.items.map((item) => createLine({
            product_id: item.product_id,
            product_name: item.product?.name || item.product_name_snapshot || '',
            product_sku: item.product?.sku || item.product_sku_snapshot || '',
            quantity: String(item.quantity || 1),
            unit_cost: item.unit_cost != null ? String(Math.round(Number(item.unit_cost || 0))) : '',
            notes: item.notes || '',
            stock_bucket: item.stock_bucket || 'sellable',
            direction: item.direction || 'in',
        }))
        : [createLine()],
});

const importItemColumns = [
    { id: 'product_name', label: 'TÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 300 },
    { id: 'product_sku', label: 'MÃƒÂ£ SP', minWidth: 140 },
    { id: 'supplier_product_code', label: 'MÃƒÂ£ NCC', minWidth: 150 },
    { id: 'quantity', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng nhÃ¡ÂºÂ­p', minWidth: 164, align: 'right' },
    { id: 'received_quantity', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng Ã„â€˜ÃƒÂ£ vÃ¡Â»Â', minWidth: 164, align: 'right' },
    { id: 'outstanding_quantity', label: 'SL chÃ†Â°a vÃ¡Â»Â', minWidth: 120, align: 'center', draggable: false },
    { id: 'unit_name', label: 'Ã„ÂVT', minWidth: 100 },
    { id: 'notes', label: 'Ghi chÃƒÂº', minWidth: 180 },
    { id: 'unit_cost', label: 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p', minWidth: 150, align: 'right' },
    { id: 'line_total', label: 'ThÃƒÂ nh tiÃ¡Â»Ân', minWidth: 130, align: 'right', draggable: false },
    { id: 'actions', label: 'XÃƒÂ³a', minWidth: 90, align: 'center', draggable: false },
];

const importPrintColumns = [
    { id: 'stt', label: 'STT', align: 'center', widthWeight: 0.7, render: (_item, index) => String(index + 1) },
    { id: 'product_name', label: 'TÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', align: 'left', widthWeight: 3.6, render: (item) => item.product_name || '-' },
    { id: 'product_sku', label: 'MÃƒÂ£ SP', align: 'left', widthWeight: 1.7, render: (item) => item.product_sku || '-' },
    { id: 'supplier_product_code', label: 'MÃƒÂ£ NCC', align: 'left', widthWeight: 1.8, render: (item) => item.supplier_product_code || '-' },
    { id: 'quantity', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng nhÃ¡ÂºÂ­p', align: 'right', widthWeight: 1.35, render: (item) => formatNumber(item.quantity || 0) },
    { id: 'received_quantity', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng Ã„â€˜ÃƒÂ£ vÃ¡Â»Â', align: 'right', widthWeight: 1.35, render: (item) => formatNumber(item.received_quantity ?? 0) },
    { id: 'outstanding_quantity', label: 'SL chÃ†Â°a vÃ¡Â»Â', align: 'right', widthWeight: 1.15, render: (item) => formatNumber(Math.max(Number(item.quantity || 0) - Number(item.received_quantity ?? 0), 0)) },
    { id: 'unit_name', label: 'Ã„ÂVT', align: 'center', widthWeight: 0.95, render: (item) => item.unit_name || '-' },
    { id: 'notes', label: 'Ghi chÃƒÂº', align: 'left', widthWeight: 2.1, render: (item) => item.notes || '' },
    { id: 'unit_cost', label: 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p', align: 'right', widthWeight: 1.4, render: (item) => formatCurrency(item.unit_cost || 0) },
    { id: 'line_total', label: 'ThÃƒÂ nh tiÃ¡Â»Ân', align: 'right', widthWeight: 1.5, render: (item) => formatCurrency(Number(item.quantity || 0) * Number(item.unit_cost || 0)) },
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
        name: String(template?.name || '').trim() || `MÃ¡ÂºÂ«u in ${index + 1}`,
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
const resolveImportPrintOrientation = (columns = []) => {
    const normalizedColumns = (Array.isArray(columns) ? columns : []).filter(Boolean);
    const totalWeight = normalizedColumns.reduce((sum, column) => sum + Number(column.widthWeight || 1), 0) || normalizedColumns.length || 1;

    return {
        normalizedColumns,
        totalWeight,
        orientation: normalizedColumns.length > 6 || totalWeight > 11 ? 'landscape' : 'portrait',
    };
};
const buildImportPrintStyles = (orientation) => `
    <style>
        @page { size: A4 ${orientation}; margin: 12mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: Arial, "Helvetica Neue", sans-serif;
            color: #16324f;
            background: #ffffff;
        }
        .print-page + .print-page {
            page-break-before: always;
        }
        .sheet {
            width: 100%;
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
`;
const buildImportPrintDocumentMarkup = ({
    title = 'PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p',
    subtitle = 'BÃ¡ÂºÂ£n in tÃ¡Â»â€˜i Ã†Â°u cho khÃ¡Â»â€¢ giÃ¡ÂºÂ¥y A4',
    supplierName = 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m',
    documentCode = '',
    importDate = '',
    printedAt = '',
    columns = [],
    items = [],
    subtotal = 0,
    surcharge = 0,
    total = 0,
    notes = '',
} = {}) => {
    const { normalizedColumns, totalWeight } = resolveImportPrintOrientation(columns);
    const printedAtLabel = formatDateTime(printedAt || new Date().toISOString());
    const importDateLabel = importDate ? formatDateTime(importDate) : '-';

    const headerCells = normalizedColumns.map((column) => {
        const width = ((Number(column.widthWeight || 1) / totalWeight) * 100).toFixed(2);
        return `<th class="align-${column.align || 'left'}" style="width:${width}%">${escapePrintHtml(column.label)}</th>`;
    }).join('');

    const bodyRows = items.length
        ? items.map((item, index) => `
            <tr>
                ${normalizedColumns.map((column) => {
                    const cellValue = typeof column.render === 'function' ? column.render(item, index) : item?.[column.id];
                    const normalizedCellValue = cellValue === null || cellValue === undefined || cellValue === '' ? '-' : cellValue;
                    return `<td class="align-${column.align || 'left'}">${escapePrintHtml(normalizedCellValue)}</td>`;
                }).join('')}
            </tr>
        `).join('')
        : `<tr><td colspan="${Math.max(normalizedColumns.length, 1)}" class="empty">ChÃ†Â°a cÃƒÂ³ dÃƒÂ²ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m.</td></tr>`;

    const totalRow = normalizedColumns.length > 1
        ? `
            <tfoot>
                <tr class="summary-row">
                    <td colspan="${normalizedColumns.length - 1}">TÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n</td>
                    <td class="align-right">${escapePrintHtml(formatCurrency(total))}</td>
                </tr>
            </tfoot>
        `
        : `
            <tfoot>
                <tr class="summary-row">
                    <td class="align-right">TÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n: ${escapePrintHtml(formatCurrency(total))}</td>
                </tr>
            </tfoot>
        `;

    const notesSection = String(notes || '').trim()
        ? `
            <div class="notes-block">
                <div class="section-title">Ghi chÃƒÂº</div>
                <div>${escapePrintHtml(notes)}</div>
            </div>
        `
        : '';

    return `
        <div class="sheet">
            <div class="header">
                <div class="title-block">
                    <h1>${escapePrintHtml(title)}</h1>
                    <p>${escapePrintHtml(subtitle)}</p>
                </div>
                <div class="meta-card">
                    <div class="meta-row">
                        <div class="meta-label">NhÃƒÂ  cung cÃ¡ÂºÂ¥p</div>
                        <div>${escapePrintHtml(supplierName)}</div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-label">MÃƒÂ£ phiÃ¡ÂºÂ¿u</div>
                        <div>${escapePrintHtml(documentCode || '-')}</div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-label">NgÃƒÂ y nhÃ¡ÂºÂ­p</div>
                        <div>${escapePrintHtml(importDateLabel)}</div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-label">NgÃƒÂ y giÃ¡Â»Â in</div>
                        <div>${escapePrintHtml(printedAtLabel)}</div>
                    </div>
                    <div class="meta-row">
                        <div class="meta-label">SÃ¡Â»â€˜ dÃƒÂ²ng</div>
                        <div>${escapePrintHtml(formatNumber(items.length))}</div>
                    </div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>${headerCells}</tr>
                </thead>
                <tbody>${bodyRows}</tbody>
                ${totalRow}
            </table>

            <div class="totals">
                <div class="total-card">
                    <span>TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng</span>
                    <strong>${escapePrintHtml(formatCurrency(subtotal))}</strong>
                </div>
                <div class="total-card">
                    <span>PhÃ¡Â»Â¥ phÃƒÂ­</span>
                    <strong>${escapePrintHtml(formatCurrency(surcharge))}</strong>
                </div>
                <div class="total-card">
                    <span>TÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n</span>
                    <strong>${escapePrintHtml(formatCurrency(total))}</strong>
                </div>
            </div>

            ${notesSection}
        </div>
    `;
};
const buildImportPrintHtml = ({
    supplierName = 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m',
    printedAt = '',
    columns = [],
    items = [],
    subtotal = 0,
    surcharge = 0,
    total = 0,
    notes = '',
} = {}) => {
    const { orientation } = resolveImportPrintOrientation(columns);

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8" />
    <title>PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p</title>
    ${buildImportPrintStyles(orientation)}
</head>
<body>
    ${buildImportPrintDocumentMarkup({
        supplierName,
        printedAt,
        columns,
        items,
        subtotal,
        surcharge,
        total,
        notes,
    })}
</body>
</html>`;
};
const buildMultiImportPrintHtml = ({
    documents = [],
    columns = [],
    printedAt = '',
} = {}) => {
    const { orientation } = resolveImportPrintOrientation(columns);
    const normalizedDocuments = (Array.isArray(documents) ? documents : []).filter(Boolean);
    const documentPages = normalizedDocuments.length
        ? normalizedDocuments.map((document) => `
            <section class="print-page">
                ${buildImportPrintDocumentMarkup({
                    title: document.title || 'PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p',
                    subtitle: document.subtitle || 'BÃ¡ÂºÂ£n in tÃ¡Â»â€˜i Ã†Â°u cho khÃ¡Â»â€¢ giÃ¡ÂºÂ¥y A4',
                    supplierName: document.supplierName,
                    documentCode: document.documentCode,
                    importDate: document.importDate,
                    printedAt,
                    columns,
                    items: document.items,
                    subtotal: document.subtotal,
                    surcharge: document.surcharge,
                    total: document.total,
                    notes: document.notes,
                })}
            </section>
        `).join('')
        : `
            <section class="print-page">
                ${buildImportPrintDocumentMarkup({
                    supplierName: 'ChÃ†Â°a cÃƒÂ³ phiÃ¡ÂºÂ¿u',
                    printedAt,
                    columns,
                    items: [],
                    subtotal: 0,
                    surcharge: 0,
                    total: 0,
                    notes: '',
                })}
            </section>
        `;

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8" />
    <title>In phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p</title>
    ${buildImportPrintStyles(orientation)}
</head>
<body>
    ${documentPages}
</body>
</html>`;
};

const parseLineQuantity = (value, fallback = 0) => {
    const cleaned = String(value ?? '').replace(/[^0-9]/g, '');
    if (!cleaned) return fallback;
    return Number(cleaned);
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
        || name.includes('hoan thanh')
        || name.includes('completed')
        || name.includes('complete');
};

const productColumns = [
    { id: 'sku', label: 'MÃƒÂ£', minWidth: 150 },
    { id: 'name', label: 'TÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 250 },
    { id: 'type_label', label: 'LoÃ¡ÂºÂ¡i', minWidth: 150 },
    { id: 'total_imported', label: 'TÃ¡Â»â€¢ng nhÃ¡ÂºÂ­p', minWidth: 110, align: 'right' },
    { id: 'total_exported', label: 'TÃ¡Â»â€¢ng xuÃ¡ÂºÂ¥t bÃƒÂ¡n', minWidth: 125, align: 'right' },
    { id: 'total_returned', label: 'TÃ¡Â»â€¢ng hoÃƒÂ n', minWidth: 110, align: 'right' },
    { id: 'total_damaged', label: 'TÃ¡Â»â€¢ng hÃ¡Â»Âng', minWidth: 110, align: 'right' },
    { id: 'stock_quantity', label: 'TÃ¡Â»â€œn bÃƒÂ¡n Ã„â€˜Ã†Â°Ã¡Â»Â£c', minWidth: 120, align: 'right' },
    { id: 'damaged_quantity', label: 'TÃ¡Â»â€œn hÃ¡Â»Âng', minWidth: 110, align: 'right' },
    { id: 'expected_cost', label: 'GiÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n', minWidth: 120, align: 'right' },
    { id: 'current_cost', label: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i', minWidth: 130, align: 'right' },
    { id: 'inventory_value', label: 'ThÃƒÂ nh tiÃ¡Â»Ân tÃ¡Â»â€œn', minWidth: 140, align: 'right' },
    { id: 'price_status', label: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i giÃƒÂ¡', minWidth: 150 },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 145, align: 'center' },
];

const supplierColumns = [
    { id: 'name', label: 'NhÃƒÂ  cung cÃ¡ÂºÂ¥p', minWidth: 220 },
    { id: 'code', label: 'MÃƒÂ£', minWidth: 120 },
    { id: 'phone', label: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', minWidth: 135 },
    { id: 'prices_count', label: 'BÃ¡ÂºÂ£ng giÃƒÂ¡', minWidth: 95, align: 'right' },
    { id: 'import_slips_count', label: 'SÃ¡Â»â€˜ phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p', minWidth: 115, align: 'right' },
    { id: 'imported_quantity_total', label: 'TÃ¡Â»â€¢ng sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', minWidth: 115, align: 'right' },
    { id: 'imported_amount_total', label: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân nhÃ¡ÂºÂ­p', minWidth: 135, align: 'right' },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 135, align: 'center' },
];

const supplierPriceBaseColumns = [
    { id: 'sku', label: 'MÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 150 },
    { id: 'name', label: 'TÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 280 },
    { id: 'price', label: 'GiÃƒÂ¡ bÃƒÂ¡n', minWidth: 110, align: 'right' },
    { id: 'supplier_unit_cost', label: 'GiÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n', minWidth: 160, align: 'right' },
    { id: 'current_cost', label: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i', minWidth: 125, align: 'right' },
    { id: 'supplier_price_updated_at', label: 'SÃ¡Â»Â­a gÃ¡ÂºÂ§n nhÃ¡ÂºÂ¥t', minWidth: 150, align: 'center' },
];

const importColumns = [
    { id: 'code', label: 'MÃƒÂ£ phiÃ¡ÂºÂ¿u', minWidth: 150 },
    { id: 'supplier', label: 'NhÃƒÂ  cung cÃ¡ÂºÂ¥p', minWidth: 220 },
    { id: 'date', label: 'NgÃƒÂ y nhÃ¡ÂºÂ­p', minWidth: 150 },
    { id: 'status', label: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i', minWidth: 150 },
    { id: 'line_count', label: 'SÃ¡Â»â€˜ dÃƒÂ²ng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'TÃ¡Â»â€¢ng sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân', minWidth: 130, align: 'right' },
    { id: 'note', label: 'Ghi chÃƒÂº', minWidth: 200 },
    { id: 'invoice', label: 'HÃƒÂ³a Ã„â€˜Ã†Â¡n', minWidth: 88, align: 'center', draggable: false, sortable: false },
    { id: 'detail', label: 'Chi tiÃ¡ÂºÂ¿t', minWidth: 92, align: 'center', draggable: false, sortable: false },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 145, align: 'center' },
];

const exportColumns = [
    { id: 'code', label: 'MÃƒÂ£ Ã„â€˜Ã†Â¡n', minWidth: 140 },
    { id: 'customer', label: 'KhÃƒÂ¡ch hÃƒÂ ng', minWidth: 220 },
    { id: 'date', label: 'NgÃƒÂ y tÃ¡ÂºÂ¡o', minWidth: 150 },
    { id: 'line_count', label: 'SÃ¡Â»â€˜ dÃƒÂ²ng', minWidth: 90, align: 'right' },
    { id: 'revenue', label: 'Doanh thu', minWidth: 120, align: 'right' },
    { id: 'cost', label: 'GiÃƒÂ¡ vÃ¡Â»â€˜n', minWidth: 120, align: 'right' },
    { id: 'profit', label: 'LÃƒÂ£i gÃ¡Â»â„¢p', minWidth: 120, align: 'right' },
    { id: 'status', label: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i', minWidth: 120 },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 145, align: 'center' },
];

const documentColumns = [
    { id: 'code', label: 'MÃƒÂ£ phiÃ¡ÂºÂ¿u', minWidth: 150 },
    { id: 'supplier', label: 'NhÃƒÂ  cung cÃ¡ÂºÂ¥p', minWidth: 200 },
    { id: 'date', label: 'NgÃƒÂ y', minWidth: 150 },
    { id: 'line_count', label: 'SÃ¡Â»â€˜ dÃƒÂ²ng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'GiÃƒÂ¡ trÃ¡Â»â€¹', minWidth: 120, align: 'right' },
    { id: 'note', label: 'Ghi chÃƒÂº', minWidth: 200 },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 145, align: 'center' },
];

const lotColumns = [
    { id: 'code', label: 'MÃƒÂ£ lÃƒÂ´', minWidth: 150 },
    { id: 'product', label: 'SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 250 },
    { id: 'date', label: 'NgÃƒÂ y nhÃ¡ÂºÂ­p', minWidth: 150 },
    { id: 'qty', label: 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng lÃƒÂ´', minWidth: 110, align: 'right' },
    { id: 'remaining', label: 'CÃƒÂ²n lÃ¡ÂºÂ¡i', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p', minWidth: 110, align: 'right' },
    { id: 'source', label: 'NguÃ¡Â»â€œn', minWidth: 180 },
];

const trashColumns = [
    { id: 'code', label: 'MÃƒÂ£', minWidth: 140 },
    { id: 'product', label: 'SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 250 },
    { id: 'date', label: 'NgÃƒÂ y xÃƒÂ³a', minWidth: 150 },
    { id: 'price_status', label: 'TrÃ¡ÂºÂ¡ng thÃƒÂ¡i giÃƒÂ¡', minWidth: 140 },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 190, align: 'center' },
];

const supplierManagementColumns = [
    { id: 'name', label: 'NhÃƒÂ  cung cÃ¡ÂºÂ¥p', minWidth: 220 },
    { id: 'code', label: 'MÃƒÂ£', minWidth: 120 },
    { id: 'phone', label: 'Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i', minWidth: 135 },
    { id: 'prices_count', label: 'BÃ¡ÂºÂ£ng giÃƒÂ¡', minWidth: 95, align: 'right' },
    { id: 'import_slips_count', label: 'SÃ¡Â»â€˜ phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p', minWidth: 115, align: 'right' },
    { id: 'imported_amount_total', label: 'TÃ¡Â»â€¢ng tiÃ¡Â»Ân nhÃ¡ÂºÂ­p', minWidth: 135, align: 'right' },
    { id: 'updated_at', label: 'CÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t', minWidth: 150, align: 'center' },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 190, align: 'center' },
];

const supplierPriceTableBaseColumns = [
    { id: 'supplier_product_code', label: 'MÃƒÂ£ NCC', minWidth: 140 },
    { id: 'sku', label: 'MÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 150 },
    { id: 'name', label: 'TÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', minWidth: 280 },
    { id: 'price', label: 'GiÃƒÂ¡ bÃƒÂ¡n', minWidth: 110, align: 'right' },
    { id: 'unit_cost', label: 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p dÃ¡Â»Â± kiÃ¡ÂºÂ¿n', minWidth: 160, align: 'right' },
    { id: 'current_cost', label: 'GiÃƒÂ¡ vÃ¡Â»â€˜n hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i', minWidth: 125, align: 'right' },
    { id: 'updated_at', label: 'SÃ¡Â»Â­a gÃ¡ÂºÂ§n nhÃ¡ÂºÂ¥t', minWidth: 150, align: 'center' },
    { id: 'actions', label: 'Thao tÃƒÂ¡c', minWidth: 120, align: 'center' },
];

const inventorySortColumnMaps = {
    products: {
        sku: 'sku',
        name: 'name',
        total_imported: 'total_imported',
        total_exported: 'total_exported',
        total_returned: 'total_returned',
        total_damaged: 'total_damaged',
        stock_quantity: 'stock_quantity',
        damaged_quantity: 'damaged_quantity',
        expected_cost: 'expected_cost',
        current_cost: 'display_cost',
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
        customer: 'customer',
        date: 'date',
        line_count: 'line_count',
        revenue: 'revenue',
        cost: 'cost',
        profit: 'profit',
        status: 'status',
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
        code: 'sku',
        product: 'name',
        date: 'deleted_at',
    },
};

const PanelHeader = ({ title, description, toggles = [], actions = null }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/10 px-3 py-2.5">
        <div className="min-w-0 shrink-0">
            <div className="text-[13px] font-black text-primary">{title}</div>
            {description ? <div className="text-[11px] text-primary/45">{description}</div> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            {toggles.map((toggle) => (
                <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                    <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                </button>
            ))}
            {actions}
        </div>
    </div>
);

const FilterPanel = ({ children, actions }) => (
    <div className="border-b border-primary/10 bg-[#fbfcfe] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
            {children}
            <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </div>
    </div>
);

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

const ModalShell = ({ open, title, onClose, children, footer, maxWidth = 'max-w-5xl', closeOnBackdrop = true }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 p-4" onClick={closeOnBackdrop ? onClose : undefined}>
            <div className={`w-full ${maxWidth} overflow-hidden rounded-sm bg-white shadow-2xl`} onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
                    <div className="text-[24px] font-black text-primary">{title}</div>
                    <button type="button" onClick={onClose} className="text-primary/35 transition hover:text-primary">
                        <span className="material-symbols-outlined text-[28px]">close</span>
                    </button>
                </div>
                <div className="max-h-[72vh] overflow-auto px-5 py-4">{children}</div>
                {footer ? <div className="border-t border-primary/10 px-5 py-4">{footer}</div> : null}
            </div>
        </div>
    );
};

const ProductLookupInput = ({ supplierId = null, onSelect, placeholder = 'TÃƒÂ¬m tÃƒÂªn, mÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m hoÃ¡ÂºÂ·c tÃ¡Â»Â« khÃƒÂ³a liÃƒÂªn quan', buttonLabel = 'ChÃ¡Â»Ân' }) => {
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
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Ã„Âang tÃƒÂ¬m sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">KhÃƒÂ´ng cÃƒÂ³ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m phÃƒÂ¹ hÃ¡Â»Â£p.</div> : null}
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
                                    <div className="truncate text-[11px] text-primary/45">{buildInventorySearchMeta(row) || 'ChÃ†Â°a cÃƒÂ³ thÃƒÂ´ng tin mÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}</div>
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

const ImportProductQuickSearch = ({
    onSelect,
    supplierId = null,
    disabled = false,
    placeholder = 'TÃƒÂ¬m tÃƒÂªn, mÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m, mÃƒÂ£ NCC hoÃ¡ÂºÂ·c tÃ¡Â»Â« khÃƒÂ³a liÃƒÂªn quan',
}) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        if (disabled) {
            setOpen(false);
            setResults([]);
        }
    }, [disabled]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false);
                setActiveIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    useEffect(() => {
        const trimmed = query.trim();
        if (disabled || trimmed.length < 1) {
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
    }, [query, disabled, supplierId]);

    const selectRow = async (row, index = null) => {
        await Promise.resolve(onSelect?.(row));
        if (index !== null) {
            setActiveIndex(index);
        }
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const clearQuery = () => {
        setQuery('');
        setResults([]);
        setActiveIndex(-1);
        setOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const showDropdown = open && (query.trim().length > 0 || loading);

    return (
        <div ref={containerRef} className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[18px] text-primary/35">search</span>
            <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setOpen(true)}
                onKeyDown={(event) => {
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
                className={importQuickSearchClass}
            />
            {query ? (
                <button type="button" onClick={clearQuery} className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-primary/35 transition hover:text-brick">
                    <span className="material-symbols-outlined text-[18px]">cancel</span>
                </button>
            ) : null}

            {showDropdown ? (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[140] overflow-hidden rounded-sm border border-primary/20 bg-white shadow-2xl">
                    <div className="max-h-72 overflow-auto">
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Ã„Âang tÃƒÂ¬m sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m phÃƒÂ¹ hÃ¡Â»Â£p.</div> : null}
                        {!loading && results.map((row, index) => (
                            <button
                                key={`quick_import_${row.id}`}
                                type="button"
                                onClick={() => selectRow(row, index)}
                                className={`flex w-full items-center justify-between border-b border-primary/10 px-3 py-2 text-left transition last:border-b-0 ${activeIndex === index ? 'bg-primary/[0.07]' : 'hover:bg-primary/[0.04]'}`}
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-semibold text-primary">{row.name}</div>
                                    <div className="truncate text-[11px] text-primary/50">{buildInventorySearchMeta(row) || 'ChÃ†Â°a cÃƒÂ³ thÃƒÂ´ng tin mÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}</div>
                                </div>
                                <span className="ml-3 shrink-0 text-[11px] font-bold text-primary/70">ThÃƒÂªm</span>
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
        onChange(String(Math.max(min, nextValue)));
    };

    return (
        <div className="flex h-8 w-full items-center overflow-hidden rounded-sm border border-primary/15 bg-white">
            <button type="button" onClick={() => commitValue(Math.max(min, currentValue - 1))} className="flex h-full w-7 items-center justify-center text-primary/65 transition hover:bg-primary/5 hover:text-primary" title="GiÃ¡ÂºÂ£m sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng">
                <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
                className="h-full w-full border-x border-primary/10 bg-transparent px-2 text-center text-[12px] font-semibold text-primary outline-none"
                placeholder={String(min)}
            />
            <button type="button" onClick={() => commitValue(currentValue + 1)} className="flex h-full w-7 items-center justify-center text-primary/65 transition hover:bg-primary/5 hover:text-primary" title="TÃ„Æ’ng sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng">
                <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
        </div>
    );
};

const ImportItemsEditorTable = ({
    items,
    inventoryUnits,
    settingsOpen,
    onCloseSettings,
    onToggleSettings,
    expanded = false,
    onToggleExpanded,
    onOpenPrint,
    onUpdateLine,
    onRemoveLine,
    readOnly = false,
    hideActions = false,
    storageKey = 'inventory_import_modal_table_v3',
    headerMessage = 'DÃƒÂ²ng chÃ†Â°a vÃ¡Â»Â Ã„â€˜Ã¡Â»Â§ Ã„â€˜Ã†Â°Ã¡Â»Â£c Ã†Â°u tiÃƒÂªn lÃƒÂªn Ã„â€˜Ã¡ÂºÂ§u Ã„â€˜Ã¡Â»Æ’ theo dÃƒÂµi.',
}) => {
    const sortedRows = useMemo(() => {
        return items
            .map((item, index) => {
                const quantity = Number(item.quantity || 0);
                const received = Number(item.received_quantity ?? 0);
                return {
                    ...item,
                    _row_index: index,
                    _is_incomplete: received < quantity,
                };
            })
            .sort((left, right) => {
                if (left._is_incomplete === right._is_incomplete) {
                    return left._row_index - right._row_index;
                }
                return left._is_incomplete ? -1 : 1;
            });
    }, [items]);
    const tableColumns = useMemo(() => ([
        { id: 'stt', label: 'STT', minWidth: 68, align: 'center', draggable: false },
        ...importItemColumns.filter((column) => column.id !== 'stt' && (!hideActions || column.id !== 'actions')),
    ]), [hideActions]);

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

    const renderCell = (row, columnId, rowIndex) => {
        if (columnId === 'stt') {
            return <div className="flex h-8 items-center justify-center text-[12px] font-bold text-primary/75">{rowIndex + 1}</div>;
        }

        if (columnId === 'product_name') {
            const secondaryText = [row.product_sku, row.supplier_product_code].filter(Boolean).join(' Ã¢â‚¬Â¢ ');
            return (
                <div className="space-y-1">
                    {row.product_id ? (
                        <CellText primary={row.product_name || '-'} secondary={secondaryText || '-'} />
                    ) : (
                        <div className="space-y-1">
                            <div className="text-[12px] font-semibold text-primary/80">{row.product_name || 'ChÃ†Â°a gÃ¡ÂºÂ¯n sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}</div>
                            <div className="text-[11px] text-primary/45">{row.supplier_product_code || row.product_sku || 'ChÃ†Â°a cÃƒÂ³ mÃƒÂ£ tham chiÃ¡ÂºÂ¿u'}</div>
                            {row.mapping_status === 'unmatched' ? <StatusPill label="ChÃ†Â°a map" color="#D97706" subtle="#FEF3C7" /> : null}
                        </div>
                    )}
                </div>
            );
        }

        if (columnId === 'product_sku') {
            if (readOnly) {
                return row.product_sku ? <span className="block truncate font-mono text-[12px] font-bold text-primary/80">{row.product_sku}</span> : <span className="text-[12px] text-primary/45">-</span>;
            }
            return <input value={row.product_sku} onChange={(event) => onUpdateLine(row._row_index, 'product_sku', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="MÃƒÂ£ SP" />;
        }

        if (columnId === 'supplier_product_code') {
            return <input value={row.supplier_product_code} onChange={(event) => onUpdateLine(row._row_index, 'supplier_product_code', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Mã NCC" />;
        }

        if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
            if (columnId === 'unit_cost') {
                return (
                    <div className="flex items-center gap-2">
                        <input
                            value={formatWholeNumberInput(groupPriceDrafts[row.id] ?? '')}
                            onChange={(event) => setGroupPriceDrafts((prev) => ({ ...prev, [row.id]: stripNumericValue(event.target.value) }))}
                            placeholder="GiÃƒÂ¡ nhÃƒÂ³m"
                            className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                        />
                        <button type="button" onClick={() => applyGroupPrice(row.id)} className={ghostButton}>ÃƒÂp nhÃƒÂ³m</button>
                    </div>
                );
            }
            if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
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
                        title="ChÃ¡Â»Ân dÃƒÂ²ng giÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n"
                    />
                </div>
            );
        }
        if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.parent_name || row.category_name || null} mono />;
        if (columnId === 'name') {
            const comparableSuppliers = getComparableSupplierCount(row);
            const canCompare = comparableSuppliers > 1;
            const secondaryText = row.parent_name ? `SKU gÃ¡Â»â€˜c: ${row.parent_sku || '-'}` : (row.category_name || null);

            return (
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-primary">{row.name}</span>
                        {canCompare ? (
                            <button
                                type="button"
                                onClick={() => toggleComparisonRow(row.id)}
                                className={compactIconButton(Boolean(expandedComparisons[row.id]))}
                                title={expandedComparisons[row.id] ? 'Ã¡ÂºÂ¨n so sÃƒÂ¡nh giÃƒÂ¡ NCC' : 'So sÃƒÂ¡nh giÃƒÂ¡ NCC'}
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
                        placeholder="Nhập mã NCC"
                        title={hasDuplicateSupplierCode ? 'Mã NCC đang bị trùng trong bảng giá nhà cung cấp này.' : (row.supplier_product_code || '')}
                    />
                    {hasDuplicateSupplierCode ? <span className="shrink-0 text-[11px] font-semibold text-rose-600">Trùng mã</span> : null}
                    {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
                </div>
            );
        }
        if (columnId === 'price') return row.price != null ? formatCurrency(row.price) : '-';
        if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
        if (columnId === 'unit_cost') return (
            <div className="flex items-center gap-2">
                <input
                    value={formatWholeNumberInput(priceDrafts[row.id] ?? (row.unit_cost ?? ''))}
                    onChange={(event) => setPriceDrafts((prev) => ({ ...prev, [row.id]: stripNumericValue(event.target.value) }))}
                    onBlur={() => saveSingleSupplierPrice(row)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            saveSingleSupplierPrice(row, event.currentTarget.value);
                        }
                    }}
                    className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                />
                {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Ã„Âang lÃ†Â°u...</span> : null}
            </div>
        );
        if (columnId === 'updated_at') return row.updated_at ? formatDateTime(row.updated_at) : '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => removeSupplierPrice(row)} disabled={!row.supplier_price_id} className={dangerButton}>{row.supplier_price_id ? 'XÃƒÂ³a' : 'ChÃ†Â°a cÃƒÂ³ giÃƒÂ¡'}</button></div>;
        return typeof row[columnId] === 'number' ? formatNumber(row[columnId]) : (row[columnId] || '-');
    };

    const renderImportCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.import_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || row.supplier_name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.import_date);
        if (columnId === 'status') {
            const status = row.statusConfig;
            return (
                <div className="space-y-1">
                    <StatusPill label={status?.name || row.status || 'ChÃ†Â°a cÃƒÂ³ trÃ¡ÂºÂ¡ng thÃƒÂ¡i'} color={status?.color || '#94A3B8'} />
                    <div className="text-[11px] text-primary/45">
                        {row.entry_mode === 'invoice_ai' ? 'AI Ã„â€˜Ã¡Â»Âc hÃƒÂ³a Ã„â€˜Ã†Â¡n' : 'NhÃ¡ÂºÂ­p tay'}
                    </div>
                </div>
            );
        }
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'invoice') {
            const hasInvoice = Number(row.attachments_count || 0) > 0;
            return (
                <button
                    type="button"
                    onClick={() => openImportInvoiceModal(row)}
                    className={iconButton(hasInvoice)}
                    title={hasInvoice ? `Xem hÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m (${formatNumber(row.attachments_count || 0)})` : 'ThÃƒÂªm hoÃ¡ÂºÂ·c quÃ¡ÂºÂ£n lÃƒÂ½ hÃƒÂ³a Ã„â€˜Ã†Â¡n'}
                >
                    <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                </button>
            );
        }
        if (columnId === 'detail') {
            return (
                <button
                    type="button"
                    onClick={() => openImportDetail(row)}
                    className={iconButton(false)}
                    title="Xem chi tiÃ¡ÂºÂ¿t phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p"
                >
                    <span className="material-symbols-outlined text-[18px]">visibility</span>
                </button>
            );
        }
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditImport(row)} className={ghostButton}>SÃ¡Â»Â­a</button><button type="button" onClick={() => deleteImport(row)} className={dangerButton}>XÃƒÂ³a</button></div>;
        return '-';
    };

    const renderExportCell = (row, columnId) => {
        if (columnId === 'code') return <CellText primary={row.order_number} mono />;
        if (columnId === 'customer') return <CellText primary={row.customer_name || '-'} secondary={row.customer_phone || row.source || '-'} />;
        if (columnId === 'date') return formatDateTime(row.created_at);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'revenue') return formatCurrency(row.total_price || 0);
        if (columnId === 'cost') return formatCurrency(row.cost_total || 0);
        if (columnId === 'profit') return <span className="font-black text-emerald-600">{formatCurrency(row.profit_total || 0)}</span>;
        if (columnId === 'status') return row.status || '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => navigate(`/admin/orders/edit/${row.id}`)} className={ghostButton}>SÃ¡Â»Â­a</button><button type="button" onClick={() => deleteExport(row)} className={dangerButton}>XÃƒÂ³a</button></div>;
        return '-';
    };

    const renderDocumentCell = (row, columnId, tabKey) => {
        if (columnId === 'code') return <CellText primary={row.document_number} mono />;
        if (columnId === 'supplier') return <CellText primary={row.supplier?.name || '-'} />;
        if (columnId === 'date') return formatDateTime(row.document_date);
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditDocument(tabKey, row)} className={ghostButton}>SÃ¡Â»Â­a</button><button type="button" onClick={() => deleteDocument(tabKey, row)} className={dangerButton}>XÃƒÂ³a</button></div>;
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
        if (columnId === 'code') return <CellText primary={row.sku} mono />;
        if (columnId === 'product') return <CellText primary={row.name} />;
        if (columnId === 'date') return formatDateTime(row.deleted_at);
        if (columnId === 'price_status') return row.price_status || '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => restoreProduct(row.id)} className={ghostButton}>KhÃƒÂ´i phÃ¡Â»Â¥c</button><button type="button" onClick={() => forceDeleteProduct(row.id)} className={dangerButton}>XÃƒÂ³a hÃ¡ÂºÂ³n</button></div>;
        return '-';
    };

    const tabRows = { imports, exports: exportsData, returns: returnsData, damaged: damagedData, adjustments, lots, trash: trashItems };
    const tabPagination = { imports: importPagination, exports: exportPagination, returns: returnPagination, damaged: damagedPagination, adjustments: adjustmentPagination, lots: lotPagination, trash: trashPagination };
    const tabLoading = { imports: loading.imports, exports: loading.exports, returns: loading.returns, damaged: loading.damaged, adjustments: loading.adjustments, lots: loading.lots, trash: loading.trash };
    const tabFetch = { imports: fetchImports, exports: fetchExports, returns: (page) => fetchDocuments('return', page), damaged: (page) => fetchDocuments('damaged', page), adjustments: (page) => fetchDocuments('adjustment', page), lots: fetchLots, trash: fetchTrash };

    const renderSimpleTab = (tabKey) => {
        const filters = simpleFilters[tabKey];
        const isImportTab = tabKey === 'imports';
        const isSlipTab = slipListTabKeys.includes(tabKey);
        const columns = isImportTab ? importColumns : tabKey === 'exports' ? exportColumns : tabKey === 'lots' ? lotColumns : tabKey === 'trash' ? trashColumns : documentColumns;
        const renderCell = isImportTab ? renderImportCell : tabKey === 'exports' ? renderExportCell : tabKey === 'lots' ? renderLotCell : tabKey === 'trash' ? renderTrashCell : (row, columnId) => renderDocumentCell(row, columnId, tabKey);
        const sortMap = ['returns', 'damaged', 'adjustments'].includes(tabKey) ? inventorySortColumnMaps.documents : inventorySortColumnMaps[tabKey];
        const currentSelectedMap = selectedSlipIds[tabKey] || {};
        const currentRowIds = (tabRows[tabKey] || []).map((row) => String(row.id)).filter(Boolean);
        const selectedCurrentRowCount = currentRowIds.filter((rowId) => currentSelectedMap[rowId]).length;
        const selectedSlipCount = Object.keys(currentSelectedMap).filter((rowId) => currentSelectedMap[rowId]).length;
        const slipToggleButtons = isSlipTab ? [
            { id: `${tabKey}_stats`, icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels[tabKey].stats, onClick: () => togglePanel(tabKey, 'stats') },
            { id: `${tabKey}_columns`, icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels[tabKey].columns, onClick: () => togglePanel(tabKey, 'columns') },
        ] : [];
        const extraActions = (
            <>
                {isImportTab ? (
                    <>
                        <button type="button" onClick={openImportStatusManager} className={ghostButton}>TrÃ¡ÂºÂ¡ng thÃƒÂ¡i</button>
                        <button type="button" onClick={openCreateImport} className={primaryButton}>TÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u</button>
                    </>
                ) : null}
                {tabKey === 'exports' ? <button type="button" onClick={() => navigate('/admin/orders/new')} className={primaryButton}>TÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u</button> : null}
                {['returns', 'damaged', 'adjustments'].includes(tabKey) ? <button type="button" onClick={() => openCreateDocument(tabKey)} className={primaryButton}>TÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u</button> : null}
            </>
        );
        const selection = isSlipTab ? {
            headerTitle: 'ChÃ¡Â»Ân tÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ phiÃ¡ÂºÂ¿u Ã¡Â»Å¸ trang hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i',
            rowTitle: 'ChÃ¡Â»Ân phiÃ¡ÂºÂ¿u',
            allSelected: currentRowIds.length > 0 && selectedCurrentRowCount === currentRowIds.length,
            indeterminate: selectedCurrentRowCount > 0 && selectedCurrentRowCount < currentRowIds.length,
            onToggleAll: (checked) => toggleAllSlipRowsSelection(tabKey, tabRows[tabKey], checked),
            isSelected: (row) => Boolean(currentSelectedMap[String(row.id)]),
            onToggleRow: (row, checked) => toggleSlipRowSelection(tabKey, row.id, checked),
        } : null;
        const filterPanel = openPanels[tabKey].filters ? (
            <FilterPanel actions={<button type="button" onClick={() => tabFetch[tabKey](1)} className={primaryButton}>LÃ¡Â»Âc</button>}>
                {!isSlipTab ? <input value={filters.search} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: event.target.value } }))} placeholder="TÃƒÂ¬m nhanh" className={`w-[240px] ${inputClass}`} /> : null}
                <input type="date" value={filters.date_from} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_from: event.target.value } }))} className={`w-[145px] ${inputClass}`} />
                <input type="date" value={filters.date_to} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], date_to: event.target.value } }))} className={`w-[145px] ${inputClass}`} />
                {isImportTab ? (
                    <>
                        <select value={filters.inventory_import_status_id} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, inventory_import_status_id: event.target.value } }))} className={`w-[190px] ${selectClass}`}>
                            <option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ trÃ¡ÂºÂ¡ng thÃƒÂ¡i</option>
                            {importStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                        </select>
                        <select value={filters.entry_mode} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, entry_mode: event.target.value } }))} className={`w-[170px] ${selectClass}`}>
                            <option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ cÃƒÂ¡ch tÃ¡ÂºÂ¡o</option>
                            <option value="manual">NhÃ¡ÂºÂ­p tay</option>
                            <option value="invoice_ai">AI Ã„â€˜Ã¡Â»Âc hÃƒÂ³a Ã„â€˜Ã†Â¡n</option>
                        </select>
                        <select value={filters.has_invoice} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, imports: { ...prev.imports, has_invoice: event.target.value } }))} className={`w-[190px] ${selectClass}`}>
                            <option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ hÃƒÂ³a Ã„â€˜Ã†Â¡n</option>
                            <option value="with_invoice">Ã„ÂÃƒÂ£ cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n</option>
                            <option value="without_invoice">ChÃ†Â°a cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n</option>
                        </select>
                    </>
                ) : null}
            </FilterPanel>
        ) : null;
        const slipHeaderActions = isSlipTab ? (
            <>
                <div className="relative min-w-[260px] flex-1 md:max-w-[430px]">
                    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                    <input
                        value={filters.search}
                        onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: event.target.value } }))}
                        placeholder="TÃƒÂ¬m tÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m hoÃ¡ÂºÂ·c mÃƒÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ã„â€˜Ã¡Â»Æ’ lÃ¡Â»Âc phiÃ¡ÂºÂ¿u"
                        className={quickSearchInputClass}
                    />
                    {filters.search ? (
                        <button
                            type="button"
                            onClick={() => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: '' } }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/35 transition hover:text-brick"
                            title="XÃƒÂ³a tÃƒÂ¬m kiÃ¡ÂºÂ¿m"
                        >
                            <span className="material-symbols-outlined text-[18px]">cancel</span>
                        </button>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={() => togglePanel(tabKey, 'filters')}
                    className={iconButton(openPanels[tabKey].filters)}
                    title="BÃ¡Â»â„¢ lÃ¡Â»Âc"
                >
                    <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                </button>
                {isImportTab ? (
                    <button
                        type="button"
                        onClick={openImportListPrintModal}
                        disabled={selectedSlipCount === 0 || importListPrintLoading}
                        className={`${iconButton(false)} disabled:cursor-not-allowed disabled:opacity-45`}
                        title={selectedSlipCount > 0 ? `In ${formatNumber(selectedSlipCount)} phiÃ¡ÂºÂ¿u Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân` : 'ChÃ¡Â»Ân phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p Ã„â€˜Ã¡Â»Æ’ in'}
                    >
                        <span className={`material-symbols-outlined text-[18px] ${importListPrintLoading ? 'animate-spin' : ''}`}>
                            {importListPrintLoading ? 'progress_activity' : 'print'}
                        </span>
                    </button>
                ) : null}
                {selectedSlipCount > 0 ? (
                    <button type="button" onClick={() => bulkDeleteSlips(tabKey)} className={dangerButton}>
                        XÃƒÂ³a Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân ({formatNumber(selectedSlipCount)})
                    </button>
                ) : null}
                {extraActions}
                {slipToggleButtons.map((toggle) => (
                    <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                        <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                    </button>
                ))}
            </>
        ) : null;

        return (
            <div className="space-y-3">
                <div className={panelClass}>
                    <PanelHeader
                        title={tabKey === 'imports' ? 'Danh sÃƒÂ¡ch phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p' : tabKey === 'exports' ? 'Danh sÃƒÂ¡ch phiÃ¡ÂºÂ¿u xuÃ¡ÂºÂ¥t bÃƒÂ¡n' : tabKey === 'lots' ? 'Danh sÃƒÂ¡ch lÃƒÂ´ hÃƒÂ ng' : tabKey === 'trash' ? 'ThÃƒÂ¹ng rÃƒÂ¡c sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m' : documentTitleMap[tabKey]}
                        toggles={isSlipTab ? [] : [
                            { id: `${tabKey}_filters`, icon: 'filter_alt', label: 'BÃ¡Â»â„¢ lÃ¡Â»Âc', active: openPanels[tabKey].filters, onClick: () => togglePanel(tabKey, 'filters') },
                            { id: `${tabKey}_stats`, icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels[tabKey].stats, onClick: () => togglePanel(tabKey, 'stats') },
                            { id: `${tabKey}_columns`, icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels[tabKey].columns, onClick: () => togglePanel(tabKey, 'columns') },
                        ]}
                        actions={isSlipTab ? slipHeaderActions : extraActions}
                    />
                    {filterPanel}
                    {openPanels[tabKey].stats ? <SummaryPanel items={simpleSummaryMap[tabKey] || []} /> : null}
                    <InventoryTable storageKey={`inventory_${tabKey}_table_${inventoryTableStorageVersion}`} columns={columns} rows={tabRows[tabKey]} renderCell={renderCell} loading={tabLoading[tabKey]} pagination={tabPagination[tabKey]} onPageChange={tabFetch[tabKey]} footer={isSlipTab && selectedSlipCount > 0 ? `KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£: ${formatNumber(tabPagination[tabKey].total)} Ã¢â‚¬Â¢ Ã„ÂÃƒÂ£ chÃ¡Â»Ân: ${formatNumber(selectedSlipCount)}` : `KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£: ${formatNumber(tabPagination[tabKey].total)}`} settingsOpen={openPanels[tabKey].columns} onCloseSettings={() => togglePanel(tabKey, 'columns')} currentPerPage={pageSizes[tabKey]} onPerPageChange={(value) => {
                        const nextSize = updatePageSize(tabKey, value);
                        if (tabKey === 'returns') return fetchDocuments('return', 1, nextSize);
                        if (tabKey === 'damaged') return fetchDocuments('damaged', 1, nextSize);
                        if (tabKey === 'adjustments') return fetchDocuments('adjustment', 1, nextSize);
                        return tabFetch[tabKey](1, nextSize);
                    }} sortConfig={sortConfigs[tabKey]} onSort={(columnId) => handleTableSort(tabKey, columnId)} sortColumnMap={sortMap} selection={selection} />
                </div>
            </div>
        );
    };

    const suppliersTabContent = (
        <div className={panelClass}>
            <PanelHeader
                title="QuÃ¡ÂºÂ£n lÃƒÂ½ nhÃƒÂ  cung cÃ¡ÂºÂ¥p"
                description="ChÃ¡Â»Ân mÃ¡Â»â„¢t nhÃƒÂ  cung cÃ¡ÂºÂ¥p rÃ¡Â»â€œi bÃ¡ÂºÂ¥m Xem Ã„â€˜Ã¡Â»Æ’ mÃ¡Â»Å¸ tab giÃƒÂ¡ nhÃ¡ÂºÂ­p riÃƒÂªng."
                toggles={[
                    { id: 'suppliers_filters', icon: 'filter_alt', label: 'BÃ¡Â»â„¢ lÃ¡Â»Âc', active: openPanels.suppliers.filters, onClick: () => togglePanel('suppliers', 'filters') },
                    { id: 'suppliers_stats', icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels.suppliers.stats, onClick: () => togglePanel('suppliers', 'stats') },
                    { id: 'suppliers_columns', icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels.suppliers.columns, onClick: () => togglePanel('suppliers', 'columns') },
                ]}
                actions={<button type="button" onClick={openCreateSupplier} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>ThÃƒÂªm nhÃƒÂ  cung cÃ¡ÂºÂ¥p</button>}
            />
            {openPanels.suppliers.filters ? (
                <FilterPanel actions={<button type="button" onClick={() => fetchSuppliers(1)} className={primaryButton}>LÃ¡Â»Âc</button>}>
                    <input value={supplierFilters.search} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="TÃƒÂ¬m nhÃƒÂ  cung cÃ¡ÂºÂ¥p" className={`w-[220px] ${inputClass}`} />
                    <select value={supplierFilters.status} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, status: event.target.value }))} className={`w-[150px] ${selectClass}`}>
                        <option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ trÃ¡ÂºÂ¡ng thÃƒÂ¡i</option>
                        <option value="1">Ã„Âang dÃƒÂ¹ng</option>
                        <option value="0">NgÃ¡Â»Â«ng dÃƒÂ¹ng</option>
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
                footer={`KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£: ${formatNumber(supplierPagination.total)} nhÃƒÂ  cung cÃ¡ÂºÂ¥p`}
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
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">NhÃƒÂ  cung cÃ¡ÂºÂ¥p</div>
                            <div className="mt-1 text-[14px] font-black text-primary">{currentSupplier.name}</div>
                            <div className="text-[11px] text-primary/45">{currentSupplier.code || 'ChÃ†Â°a cÃƒÂ³ mÃƒÂ£'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">LiÃƒÂªn hÃ¡Â»â€¡</div>
                            <div className="mt-1 text-[13px] font-semibold text-primary">{currentSupplier.phone || 'ChÃ†Â°a cÃƒÂ³ sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i'}</div>
                            <div className="truncate text-[11px] text-primary/45">{currentSupplier.email || 'ChÃ†Â°a cÃƒÂ³ email'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°</div>
                            <div className="mt-1 text-[12px] font-semibold text-primary">{currentSupplier.address || 'ChÃ†Â°a cÃƒÂ³ Ã„â€˜Ã¡Â»â€¹a chÃ¡Â»â€°'}</div>
                        </div>
                        <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chÃƒÂº</div>
                            <div className="mt-1 text-[12px] text-primary/70">{currentSupplier.notes || 'ChÃ†Â°a cÃƒÂ³ ghi chÃƒÂº'}</div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );

    const supplierPricesTabContent = (
        <div className={panelClass}>
            <PanelHeader
                title={currentSupplier ? `GiÃƒÂ¡ nhÃ¡ÂºÂ­p - ${currentSupplier.name}` : 'GiÃƒÂ¡ nhÃ¡ÂºÂ­p tÃ¡Â»Â«ng nhÃƒÂ '}
                description={currentSupplier ? 'MÃ¡Â»â€”i nhÃƒÂ  cung cÃ¡ÂºÂ¥p cÃƒÂ³ mÃ¡Â»â„¢t bÃ¡ÂºÂ£ng giÃƒÂ¡ nhÃ¡ÂºÂ­p riÃƒÂªng. Khi tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p, giÃƒÂ¡ sÃ¡ÂºÂ½ tÃ¡Â»Â± Ã„â€˜Ã¡Â»â€¢ tÃ¡Â»Â« bÃ¡ÂºÂ£ng nÃƒÂ y vÃƒÂ  vÃ¡ÂºÂ«n cÃƒÂ³ thÃ¡Â»Æ’ sÃ¡Â»Â­a tay.' : 'ChÃ¡Â»Ân nhÃƒÂ  cung cÃ¡ÂºÂ¥p trong tab NhÃƒÂ  cung cÃ¡ÂºÂ¥p hoÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¢i nhanh ngay tÃ¡ÂºÂ¡i Ã„â€˜ÃƒÂ¢y Ã„â€˜Ã¡Â»Æ’ mÃ¡Â»Å¸ thÃ†Â° viÃ¡Â»â€¡n giÃƒÂ¡ nhÃ¡ÂºÂ­p.'}
                actions={
                    <>
                        <select
                            value={selectedSupplierId ? String(selectedSupplierId) : ''}
                            onChange={(event) => setSelectedSupplierId(event.target.value ? Number(event.target.value) : null)}
                            disabled={loading.suppliers && suppliers.length === 0}
                            className={`w-[220px] ${selectClass}`}
                        >
                            <option value="">{loading.suppliers ? 'Ã„Âang tÃ¡ÂºÂ£i nhÃƒÂ  cung cÃ¡ÂºÂ¥p' : 'ChÃ¡Â»Ân nhÃƒÂ  cung cÃ¡ÂºÂ¥p'}</option>
                            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                        </select>
                        <div className="relative w-[220px] min-w-[220px]">
                            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                            <input
                                value={supplierQuickSearch}
                                onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                placeholder="TÃƒÂ¬m SKU / tÃƒÂªn / mÃƒÂ£ NCC"
                                disabled={!selectedSupplierId}
                                className={`w-full pl-9 ${inputClass}`}
                            />
                        </div>
                        <input value={formatWholeNumberInput(bulkPrice)} onChange={(event) => setBulkPrice(stripNumericValue(event.target.value))} placeholder="GiÃƒÂ¡ ÃƒÂ¡p chÃ¡Â»Ân" disabled={!selectedSupplierId} className={`w-[125px] ${inputClass}`} />
                        <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!selectedSupplierId} className={ghostButton}>{showPasteBox ? 'Ã¡ÂºÂ¨n dÃƒÂ¡n nhanh' : 'DÃƒÂ¡n nhanh'}</button>
                        <button type="button" onClick={applyBulkPrice} disabled={!selectedSupplierId || !selectedIds.length} className={ghostButton}>ÃƒÂp giÃƒÂ¡ chÃ¡Â»Ân</button>
                        <button type="button" onClick={refreshSupplierCatalog} disabled={!selectedSupplierId || loading.supplierCatalog} className={ghostButton}><span className={`material-symbols-outlined text-[18px] ${loading.supplierCatalog ? 'animate-spin' : ''}`}>refresh</span>LÃƒÂ m mÃ¡Â»â€ºi</button>
                        {[
                            { id: 'supplierPrices_filters', icon: 'filter_alt', label: 'BÃ¡Â»â„¢ lÃ¡Â»Âc', active: openPanels.supplierPrices.filters, onClick: () => togglePanel('supplierPrices', 'filters') },
                            { id: 'supplierPrices_stats', icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels.supplierPrices.stats, onClick: () => togglePanel('supplierPrices', 'stats') },
                            { id: 'supplierPrices_columns', icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels.supplierPrices.columns, onClick: () => togglePanel('supplierPrices', 'columns') },
                        ].map((toggle) => (
                            <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                                <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                            </button>
                        ))}
                    </>
                }
            />
            {openPanels.supplierPrices.filters ? (
                <FilterPanel actions={<button type="button" onClick={() => fetchSupplierCatalog(1)} className={primaryButton}>LÃ¡Â»Âc</button>}>
                    <input value={supplierCatalogFilters.sku} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, sku: event.target.value }))} placeholder="LÃ¡Â»Âc theo mÃƒÂ£ SP / mÃƒÂ£ NCC" className={`w-[170px] ${inputClass}`} />
                    <input value={supplierCatalogFilters.name} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, name: event.target.value }))} placeholder="LÃ¡Â»Âc theo tÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m" className={`w-[180px] ${inputClass}`} />
                    <select value={supplierCatalogFilters.category_id} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ danh mÃ¡Â»Â¥c</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                    <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ loÃ¡ÂºÂ¡i sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</option><option value="simple">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng</option><option value="configurable">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option></select>
                    <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="no_variants">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng</option><option value="only_variants">BiÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="has_variants">NhÃƒÂ³m cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="roots">NhÃƒÂ³m gÃ¡Â»â€˜c</option></select>
                    <select value={supplierCatalogFilters.missing_supplier_price} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, missing_supplier_price: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ trÃ¡ÂºÂ¡ng thÃƒÂ¡i giÃƒÂ¡</option><option value="1">ChÃ†Â°a cÃƒÂ³ giÃƒÂ¡ nhÃ¡ÂºÂ­p</option></select>
                    <select value={supplierCatalogFilters.multiple_suppliers} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, multiple_suppliers: event.target.value }))} className={`w-[180px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ nguÃ¡Â»â€œn nhÃ¡ÂºÂ­p</option><option value="1">CÃƒÂ³ nhiÃ¡Â»Âu nhÃƒÂ  cung cÃ¡ÂºÂ¥p</option></select>
                </FilterPanel>
            ) : null}
            {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
            {showPasteBox ? <div className="border-b border-primary/10 px-3 py-2.5"><div className="mb-2 text-[12px] text-primary/55">DÃƒÂ¡n theo mÃ¡ÂºÂ«u: `SKU TAB GiÃƒÂ¡` hoÃ¡ÂºÂ·c `SKU,GiÃƒÂ¡`</div><div className="flex gap-3"><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" placeholder={'SKU-01\t120000\nSKU-02\t150000'} /><button type="button" onClick={applyPaste} className={primaryButton}>NhÃ¡ÂºÂ­n giÃƒÂ¡</button></div></div> : null}
            <InventoryTable
                storageKey={`inventory_supplier_prices_table_${inventoryTableStorageVersion}`}
                columns={supplierPriceColumns}
                rows={supplierRows}
                renderCell={supplierPriceCell}
                loading={loading.supplierCatalog}
                pagination={supplierCatalogPagination}
                onPageChange={fetchSupplierCatalog}
                footer={`HiÃ¡Â»Æ’n thÃ¡Â»â€¹ ${formatNumber(visibleSupplierItemIds.length)} / ${formatNumber(supplierCatalogPagination.total)} dÃƒÂ²ng giÃƒÂ¡`}
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
    const importPrintSupplierName = useMemo(
        () => suppliers.find((supplier) => String(supplier.id) === String(importModal.form.supplier_id))?.name || 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m',
        [suppliers, importModal.form.supplier_id]
    );
    const importPrintableItems = useMemo(
        () => importModal.form.items
            .filter((item) => Number(item.product_id || 0) > 0)
            .map((item) => ({
                ...item,
                quantity: Number(item.quantity || 0),
                received_quantity: Number(item.received_quantity ?? 0),
                unit_cost: Number(item.unit_cost || 0),
            })),
        [importModal.form.items]
    );
    const importPrintSelectedColumns = useMemo(
        () => orderImportPrintColumnIds(importPrintColumnIds)
            .map((columnId) => importPrintColumnMap.get(columnId))
            .filter(Boolean),
        [importPrintColumnIds]
    );
    const importPrintPreviewHtml = useMemo(
        () => buildImportPrintHtml({
            supplierName: importPrintSupplierName,
            printedAt: importPrintPreviewPrintedAt,
            columns: importPrintSelectedColumns,
            items: importPrintableItems,
            subtotal: importSubtotal,
            surcharge: importSurchargeAmount,
            total: importLineTotal,
            notes: importModal.form.notes || '',
        }),
        [
            importPrintSupplierName,
            importPrintPreviewPrintedAt,
            importPrintSelectedColumns,
            importPrintableItems,
            importSubtotal,
            importSurchargeAmount,
            importLineTotal,
            importModal.form.notes,
        ]
    );
    const importListPrintMetrics = useMemo(() => ({
        documents: importListPrintDocuments.length,
        lines: importListPrintDocuments.reduce((sum, document) => sum + Number(document.items?.length || 0), 0),
        total: importListPrintDocuments.reduce((sum, document) => sum + Number(document.total || 0), 0),
    }), [importListPrintDocuments]);
    const importListPrintSupplierSummary = useMemo(() => {
        const supplierNames = Array.from(new Set(
            importListPrintDocuments
                .map((document) => String(document.supplierName || '').trim())
                .filter(Boolean)
        ));

        if (supplierNames.length === 0) return 'ChÃ†Â°a cÃƒÂ³ nhÃƒÂ  cung cÃ¡ÂºÂ¥p';
        if (supplierNames.length === 1) return supplierNames[0];
        return `${formatNumber(supplierNames.length)} nhÃƒÂ  cung cÃ¡ÂºÂ¥p`;
    }, [importListPrintDocuments]);
    const importListPrintPreviewHtml = useMemo(
        () => buildMultiImportPrintHtml({
            documents: importListPrintDocuments,
            columns: importPrintSelectedColumns,
            printedAt: importPrintPreviewPrintedAt,
        }),
        [importListPrintDocuments, importPrintSelectedColumns, importPrintPreviewPrintedAt]
    );
    const importInvoiceAttachmentItems = useMemo(() => {
        const existingAttachments = (importInvoiceModal.form.attachments || []).map((attachment, index) => ({
            key: `existing_${attachment.id || index}_${attachment.file_path || attachment.original_name || 'attachment'}`,
            source: 'existing',
            attachmentIndex: index,
            name: attachment.original_name || `TÃ¡Â»â€¡p Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m ${index + 1}`,
            mimeType: attachment.mime_type || '',
            size: Number(attachment.file_size || 0),
            url: attachment.url || null,
            createdAt: attachment.created_at || null,
            sourceType: attachment.source_type || 'manual',
        }));
        const localAttachments = (importInvoiceModal.form.local_attachment_files || []).map((file, index) => ({
            key: `local_${file.name}_${file.size}_${file.lastModified}`,
            source: 'local',
            localFileIndex: index,
            name: file.name,
            mimeType: file.type || '',
            size: Number(file.size || 0),
            url: URL.createObjectURL(file),
            createdAt: null,
            sourceType: 'local',
        }));

        return [...existingAttachments, ...localAttachments];
    }, [importInvoiceModal.form.attachments, importInvoiceModal.form.local_attachment_files]);
    useEffect(() => () => {
        importInvoiceAttachmentItems
            .filter((item) => item.source === 'local' && item.url)
            .forEach((item) => URL.revokeObjectURL(item.url));
    }, [importInvoiceAttachmentItems]);
    useEffect(() => {
        if (!importInvoiceModal.open) return;

        if (!importInvoiceAttachmentItems.length) {
            if (importInvoicePreviewKey) {
                setImportInvoicePreviewKey('');
            }
            return;
        }

        if (!importInvoiceAttachmentItems.some((item) => item.key === importInvoicePreviewKey)) {
            setImportInvoicePreviewKey(importInvoiceAttachmentItems[0].key);
        }
    }, [importInvoiceAttachmentItems, importInvoiceModal.open, importInvoicePreviewKey]);
    const activeImportInvoicePreviewItem = useMemo(
        () => importInvoiceAttachmentItems.find((item) => item.key === importInvoicePreviewKey) || importInvoiceAttachmentItems[0] || null,
        [importInvoiceAttachmentItems, importInvoicePreviewKey]
    );
    const activeImportInvoicePreviewKind = useMemo(
        () => (activeImportInvoicePreviewItem
            ? getAttachmentPreviewKind({
                mimeType: activeImportInvoicePreviewItem.mimeType,
                fileName: activeImportInvoicePreviewItem.name,
            })
            : 'other'),
        [activeImportInvoicePreviewItem]
    );
    const importDetailForm = useMemo(
        () => (importDetailModal.record ? synchronizeImportFormCompletion(createImportForm(importDetailModal.record)) : null),
        [importDetailModal.record]
    );
    const importDetailPrintableDocument = useMemo(
        () => (importDetailModal.record ? buildPrintableImportDocument(importDetailModal.record) : null),
        [importDetailModal.record]
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
    const documentLineTotal = useMemo(() => documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0), [documentModal.form.items]);
    const createSlipActions = [
        { key: 'imports', label: 'PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p', icon: 'inventory_2', onClick: async () => { setCreateMenuOpen(false); await openCreateImport(); } },
        { key: 'exports', label: 'PhiÃ¡ÂºÂ¿u xuÃ¡ÂºÂ¥t', icon: 'shopping_cart', onClick: () => { setCreateMenuOpen(false); navigate('/admin/orders/new'); } },
        { key: 'returns', label: 'PhiÃ¡ÂºÂ¿u hoÃƒÂ n', icon: 'assignment_return', onClick: async () => { setCreateMenuOpen(false); setActiveTab('returns'); await openCreateDocument('returns'); } },
        { key: 'damaged', label: 'PhiÃ¡ÂºÂ¿u hÃ¡Â»Âng', icon: 'broken_image', onClick: async () => { setCreateMenuOpen(false); setActiveTab('damaged'); await openCreateDocument('damaged'); } },
        { key: 'adjustments', label: 'PhiÃ¡ÂºÂ¿u Ã„â€˜iÃ¡Â»Âu chÃ¡Â»â€°nh', icon: 'tune', onClick: async () => { setCreateMenuOpen(false); setActiveTab('adjustments'); await openCreateDocument('adjustments'); } },
    ];
    const documentWorkspace = isDocumentTab(activeTab) ? renderSimpleTab(activeTab) : null;

    return (
        <div className="space-y-4 px-5 pb-6 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[16px] font-black uppercase tracking-[0.18em] text-primary">QuÃ¡ÂºÂ£n lÃƒÂ½ kho</div>
                <div className="relative flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setCreateMenuOpen((prev) => !prev)} className={primaryButton}>
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        TÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u
                        <span className="material-symbols-outlined text-[18px]">{createMenuOpen ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    {createMenuOpen ? (
                        <div className="absolute right-0 top-full z-30 mt-2 min-w-[220px] overflow-hidden rounded-sm border border-primary/10 bg-white shadow-xl">
                            {createSlipActions.map((action) => (
                                <button
                                    key={action.key}
                                    type="button"
                                    onClick={action.onClick}
                                    className="flex w-full items-center gap-2 border-b border-primary/10 px-3 py-2.5 text-left text-[13px] font-semibold text-primary transition last:border-b-0 hover:bg-primary/[0.04]"
                                >
                                    <span className="material-symbols-outlined text-[18px]">{action.icon}</span>
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
            <div className={`${panelClass} p-2`}>
                <div className="flex flex-nowrap gap-2 overflow-x-auto">
                    {topTabs.map(([key, label]) => {
                        return (
                            <React.Fragment key={key}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCreateMenuOpen(false);
                                        setActiveTab(key);
                                    }}
                                    className={`h-10 shrink-0 rounded-sm border px-4 text-[12px] font-black transition ${activeTab === key ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/[0.03]'}`}
                                >
                                    {label}
                                </button>
                                {key === 'supplierPrices' ? documentTabs.map(([documentKey, documentLabel]) => (
                                    <button
                                        key={documentKey}
                                        type="button"
                                        onClick={() => {
                                            setCreateMenuOpen(false);
                                            setActiveTab(documentKey);
                                        }}
                                        className={`h-10 shrink-0 rounded-sm border px-4 text-[12px] font-black transition ${activeTab === documentKey ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/[0.03]'}`}
                                    >
                                        {documentLabel}
                                    </button>
                                )) : null}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
            {activeTab === 'overview' ? <div className={panelClass}><PanelHeader title="TÃ¡Â»â€¢ng quan kho" toggles={[{ id: 'overview_stats', icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels.overview.stats, onClick: () => togglePanel('overview', 'stats') }]} />{openPanels.overview.stats ? <SummaryPanel items={overviewItems} /> : null}</div> : null}
            {activeTab === 'products' ? <div className={panelClass}><PanelHeader title="SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m kho" toggles={[{ id: 'products_filters', icon: 'filter_alt', label: 'BÃ¡Â»â„¢ lÃ¡Â»Âc', active: openPanels.products.filters, onClick: () => togglePanel('products', 'filters') }, { id: 'products_stats', icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels.products.stats, onClick: () => togglePanel('products', 'stats') }, { id: 'products_columns', icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels.products.columns, onClick: () => togglePanel('products', 'columns') }]} actions={<button type="button" onClick={() => navigate('/admin/products/new')} className={primaryButton}>TÃ¡ÂºÂ¡o sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</button>} />{openPanels.products.filters ? <FilterPanel actions={<button type="button" onClick={() => fetchProducts(1)} className={primaryButton}>LÃ¡Â»Âc</button>}><input value={productFilters.search} onChange={(event) => setProductFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="TÃƒÂ¬m mÃƒÂ£ hoÃ¡ÂºÂ·c tÃƒÂªn" className={`w-[220px] ${inputClass}`} /><select value={productFilters.status} onChange={(event) => setProductFilters((prev) => ({ ...prev, status: event.target.value }))} className={`w-[150px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ trÃ¡ÂºÂ¡ng thÃƒÂ¡i bÃƒÂ¡n</option><option value="active">Ã„Âang bÃƒÂ¡n</option><option value="inactive">NgÃ¡Â»Â«ng bÃƒÂ¡n</option></select><select value={productFilters.cost_source} onChange={(event) => setProductFilters((prev) => ({ ...prev, cost_source: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ trÃ¡ÂºÂ¡ng thÃƒÂ¡i giÃƒÂ¡</option><option value="actual">Ã„Âang dÃƒÂ¹ng giÃƒÂ¡ vÃ¡Â»â€˜n</option><option value="expected">Ã„Âang dÃƒÂ¹ng giÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n</option><option value="empty">ChÃ†Â°a cÃƒÂ³ giÃƒÂ¡</option></select><select value={productFilters.type} onChange={(event) => setProductFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ loÃ¡ÂºÂ¡i sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</option><option value="simple">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng</option><option value="configurable">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option></select><select value={productFilters.category_id} onChange={(event) => setProductFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ danh mÃ¡Â»Â¥c</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={productFilters.variant_scope} onChange={(event) => setProductFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">CÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’ / khÃƒÂ´ng</option><option value="has_variants">CÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="no_variants">KhÃƒÂ´ng cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="only_variants">ChÃ¡Â»â€° biÃ¡ÂºÂ¿n thÃ¡Â»Æ’ con</option><option value="roots">ChÃ¡Â»â€° sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m gÃ¡Â»â€˜c</option></select><input type="date" value={productFilters.date_from} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={`w-[145px] ${inputClass}`} /><input type="date" value={productFilters.date_to} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={`w-[145px] ${inputClass}`} /></FilterPanel> : null}{openPanels.products.stats ? <SummaryPanel items={productSummaryItems} /> : null}<InventoryTable storageKey={`inventory_products_table_${inventoryTableStorageVersion}`} columns={productColumns} rows={products} renderCell={productCell} loading={loading.products} pagination={productPagination} onPageChange={fetchProducts} footer={`KÃ¡ÂºÂ¿t quÃ¡ÂºÂ£: ${formatNumber(productPagination.total)} mÃƒÂ£`} settingsOpen={openPanels.products.columns} onCloseSettings={() => togglePanel('products', 'columns')} currentPerPage={pageSizes.products} onPerPageChange={(value) => fetchProducts(1, updatePageSize('products', value))} sortConfig={sortConfigs.products} onSort={(columnId) => handleTableSort('products', columnId)} sortColumnMap={inventorySortColumnMaps.products} /></div> : null}
            {activeTab === 'suppliers' ? suppliersTabContent : null}
            {activeTab === 'supplierPrices' ? supplierPricesTabContent : null}
            {false ? (
                <div className="grid items-start gap-3 xl:grid-cols-[300px,minmax(0,1fr)]">
                    <div className={`${panelClass} self-start`}>
                        <div className="border-b border-primary/10 px-3 py-2.5">
                            <input value={supplierFilters.search} onChange={(event) => setSupplierFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="TÃƒÂ¬m nhÃƒÂ  cung cÃ¡ÂºÂ¥p" className={`w-full ${inputClass}`} />
                        </div>
                        <div className="max-h-[280px] overflow-auto">
                            {loading.suppliers ? <div className="px-3 py-4 text-[12px] text-primary/55">Ã„Âang tÃ¡ÂºÂ£i nhÃƒÂ  cung cÃ¡ÂºÂ¥p...</div> : null}
                            {!loading.suppliers && suppliers.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">KhÃƒÂ´ng cÃƒÂ³ nhÃƒÂ  cung cÃ¡ÂºÂ¥p.</div> : null}
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
                                            {isSelected ? <span className="rounded-full bg-primary/[0.08] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">Ã„Âang chÃ¡Â»Ân</span> : null}
                                        </button>
                                        {isOpen ? (
                                            <div className="space-y-3 border-t border-primary/10 bg-[#fbfcfe] px-3 py-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[13px] font-black text-primary">{supplier.name}</div>
                                                        <div className="text-[11px] text-primary/45">{supplier.code || 'ChÃ†Â°a cÃƒÂ³ mÃƒÂ£ nhÃƒÂ  cung cÃ¡ÂºÂ¥p'}</div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button type="button" onClick={() => openEditSupplier(supplier)} className={ghostButton}>SÃ¡Â»Â­a</button>
                                                        <button type="button" onClick={() => deleteSupplier(supplier)} className={dangerButton}>XÃƒÂ³a</button>
                                                    </div>
                                                </div>
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ã„ÂiÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.phone || 'ChÃ†Â°a cÃƒÂ³ sÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Email</div>
                                                        <div className="mt-1 break-all font-semibold text-primary">{supplier.email || 'ChÃ†Â°a cÃƒÂ³ email'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°</div>
                                                        <div className="mt-1 font-semibold text-primary">{supplier.address || 'ChÃ†Â°a cÃƒÂ³ Ã„â€˜Ã¡Â»â€¹a chÃ¡Â»â€°'}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] text-primary/70 sm:col-span-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chÃƒÂº</div>
                                                        <div className="mt-1 leading-relaxed text-primary/70">{supplier.notes || 'ChÃ†Â°a cÃƒÂ³ ghi chÃƒÂº'}</div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">BÃ¡ÂºÂ£ng giÃƒÂ¡</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.prices_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.import_slips_count || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng nhÃ¡ÂºÂ­p</div>
                                                        <div className="mt-1 text-[14px] font-black text-primary">{formatNumber(supplier.imported_quantity_total || 0)}</div>
                                                    </div>
                                                    <div className="rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">TiÃ¡Â»Ân nhÃ¡ÂºÂ­p</div>
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
                                <span>HiÃ¡Â»Æ’n thÃ¡Â»â€¹</span>
                                <select value={pageSizes.suppliers} onChange={(event) => fetchSuppliers(1, updatePageSize('suppliers', Number(event.target.value)))} className="h-8 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-semibold text-primary outline-none focus:border-primary">
                                    {pageSizeOptions.map((size) => <option key={size} value={size}>{size} dÃƒÂ²ng</option>)}
                                </select>
                            </label>
                            <Pagination pagination={supplierPagination} onPageChange={fetchSuppliers} />
                        </div>
                    </div>

                    <div className={panelClass}>
                        <PanelHeader
                            title={currentSupplier ? `BÃ¡ÂºÂ£ng giÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n - ${currentSupplier.name}` : 'BÃ¡ÂºÂ£ng giÃƒÂ¡ dÃ¡Â»Â± kiÃ¡ÂºÂ¿n'}
                            actions={
                                <>
                                    <button type="button" onClick={openCreateSupplier} className={primaryButton}><span className="material-symbols-outlined text-[18px]">add</span>ThÃƒÂªm mÃ¡Â»â€ºi</button>
                                    <div className="relative w-[220px] min-w-[220px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                        <input
                                            value={supplierQuickSearch}
                                            onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                            placeholder="TÃƒÂ¬m SKU / tÃƒÂªn / mÃƒÂ£ NCC"
                                            disabled={!selectedSupplierId}
                                            className={`w-full pl-9 ${inputClass}`}
                                        />
                                    </div>
                                    <input value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value.replace(/[^0-9]/g, ''))} placeholder="GiÃƒÂ¡ ÃƒÂ¡p chÃ¡Â»Ân" disabled={!selectedSupplierId} className={`w-[125px] ${inputClass}`} />
                                    <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!selectedSupplierId} className={ghostButton}>{showPasteBox ? 'Ã¡ÂºÂ¨n dÃƒÂ¡n nhanh' : 'DÃƒÂ¡n nhanh'}</button>
                                    <button type="button" onClick={applyBulkPrice} disabled={!selectedSupplierId || !selectedIds.length} className={ghostButton}>ÃƒÂp giÃƒÂ¡ chÃ¡Â»Ân</button>
                                    {[
                                        { id: 'supplierPrices_filters', icon: 'filter_alt', label: 'BÃ¡Â»â„¢ lÃ¡Â»Âc', active: openPanels.supplierPrices.filters, onClick: () => togglePanel('supplierPrices', 'filters') },
                                        { id: 'supplierPrices_stats', icon: 'monitoring', label: 'ThÃ¡Â»â€˜ng kÃƒÂª', active: openPanels.supplierPrices.stats, onClick: () => togglePanel('supplierPrices', 'stats') },
                                        { id: 'supplierPrices_columns', icon: 'view_column', label: 'CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t cÃ¡Â»â„¢t', active: openPanels.supplierPrices.columns, onClick: () => togglePanel('supplierPrices', 'columns') },
                                    ].map((toggle) => (
                                        <button key={toggle.id} type="button" onClick={toggle.onClick} className={iconButton(toggle.active)} title={toggle.label}>
                                            <span className="material-symbols-outlined text-[18px]">{toggle.icon}</span>
                                        </button>
                                    ))}
                                </>
                            }
                        />
                        {openPanels.supplierPrices.filters ? (
                            <FilterPanel actions={<button type="button" onClick={() => fetchSupplierCatalog(1)} className={primaryButton}>LÃ¡Â»Âc</button>}>
                                <input value={supplierCatalogFilters.sku} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, sku: event.target.value }))} placeholder="LÃ¡Â»Âc theo mÃƒÂ£ SP / mÃƒÂ£ NCC" className={`w-[170px] ${inputClass}`} />
                                <input value={supplierCatalogFilters.name} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, name: event.target.value }))} placeholder="LÃ¡Â»Âc theo tÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m" className={`w-[180px] ${inputClass}`} />
                                <select value={supplierCatalogFilters.category_id} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ danh mÃ¡Â»Â¥c</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
                                <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ loÃ¡ÂºÂ¡i sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</option><option value="simple">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng</option><option value="configurable">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option></select>
                                <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng / biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="no_variants">SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m thÃ†Â°Ã¡Â»Âng</option><option value="only_variants">BiÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="has_variants">NhÃƒÂ³m cÃƒÂ³ biÃ¡ÂºÂ¿n thÃ¡Â»Æ’</option><option value="roots">NhÃƒÂ³m gÃ¡Â»â€˜c</option></select>
                            </FilterPanel>
                        ) : null}
                        {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
                        {showPasteBox ? <div className="border-b border-primary/10 px-3 py-2.5"><div className="mb-2 text-[12px] text-primary/55">DÃƒÂ¡n theo mÃ¡ÂºÂ«u: `SKU TAB GiÃƒÂ¡` hoÃ¡ÂºÂ·c `SKU,GiÃƒÂ¡`</div><div className="flex gap-3"><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" placeholder={'SKU-01\t120000\nSKU-02\t150000'} /><button type="button" onClick={applyPaste} className={primaryButton}>NhÃ¡ÂºÂ­n giÃƒÂ¡</button></div></div> : null}
                        <InventoryTable storageKey="inventory_supplier_prices_table_v2" columns={supplierPriceColumns} rows={supplierRows} renderCell={supplierPriceCell} loading={loading.supplierCatalog} pagination={supplierCatalogPagination} onPageChange={fetchSupplierCatalog} footer={`HiÃ¡Â»Æ’n thÃ¡Â»â€¹ ${formatNumber(visibleSupplierItemIds.length)} / ${formatNumber(supplierCatalogPagination.total)} sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m`} rowKey="row_id" rowClassName={(row) => {
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
            <ModalShell open={supplierModal.open} title={supplierModal.form.id ? 'SÃ¡Â»Â­a nhÃƒÂ  cung cÃ¡ÂºÂ¥p' : 'ThÃƒÂªm nhÃƒÂ  cung cÃ¡ÂºÂ¥p'} onClose={() => setSupplierModal({ open: false, form: createSupplierForm() })} maxWidth="max-w-3xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setSupplierModal({ open: false, form: createSupplierForm() })} className={ghostButton}>HÃ¡Â»Â§y</button><button type="button" onClick={saveSupplier} className={primaryButton} disabled={loading.supplierModal}>{loading.supplierModal ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u nhÃƒÂ  cung cÃ¡ÂºÂ¥p'}</button></div>}><div className="grid gap-3 md:grid-cols-2"><input value={supplierModal.form.code} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, code: event.target.value } }))} placeholder="MÃƒÂ£ nhÃƒÂ  cung cÃ¡ÂºÂ¥p" className={inputClass} /><input value={supplierModal.form.name} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} placeholder="TÃƒÂªn nhÃƒÂ  cung cÃ¡ÂºÂ¥p" className={inputClass} /><input value={supplierModal.form.phone} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, phone: event.target.value } }))} placeholder="SÃ¡Â»â€˜ Ã„â€˜iÃ¡Â»â€¡n thoÃ¡ÂºÂ¡i" className={inputClass} /><input value={supplierModal.form.email} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, email: event.target.value } }))} placeholder="Email" className={inputClass} /><input value={supplierModal.form.address} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, address: event.target.value } }))} placeholder="Ã„ÂÃ¡Â»â€¹a chÃ¡Â»â€°" className={`md:col-span-2 ${inputClass}`} /><textarea value={supplierModal.form.notes} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chÃƒÂº" className="min-h-[120px] rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary md:col-span-2" /><label className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary"><input type="checkbox" checked={supplierModal.form.status} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.checked } }))} className="size-4 accent-primary" />Ã„Âang sÃ¡Â»Â­ dÃ¡Â»Â¥ng</label></div></ModalShell>
            <ModalShell
                open={importModal.open}
                title={importModal.form.id ? 'SÃ¡Â»Â­a phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p' : 'TÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'}
                onClose={closeImportModal}
                closeOnBackdrop={false}
                maxWidth="max-w-[1640px]"
                footer={(
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="grid gap-2 text-[13px] font-semibold text-primary/75 sm:grid-cols-2 xl:grid-cols-4">
                            <div>TÃ¡Â»â€¢ng tiÃ¡Â»Ân hÃƒÂ ng: <span className="font-black text-primary">{formatCurrency(importSubtotal)}</span></div>
                            <div>PhÃ¡Â»Â¥ phÃƒÂ­: <span className="font-black text-primary">{formatCurrency(importSurchargeAmount)}</span></div>
                            <div>TÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n: <span className="font-black text-primary">{formatCurrency(importLineTotal)}</span></div>
                            <div>
                                Ã„ÂÃƒÂ£ vÃ¡Â»Â / NhÃ¡ÂºÂ­p: <span className="font-black text-primary">{formatNumber(importCompletion.receivedQuantity)} / {formatNumber(importCompletion.orderedQuantity)}</span>
                                <span className={`ml-2 text-[12px] ${importCompletion.incompleteCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                    {importCompletion.totalLines > 0
                                        ? (importCompletion.incompleteCount > 0 ? `${formatNumber(importCompletion.incompleteCount)} dÃƒÂ²ng chÃ†Â°a Ã„â€˜Ã¡Â»Â§` : 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ Ã„â€˜ÃƒÂ£ vÃ¡Â»Â Ã„â€˜Ã¡Â»Â§')
                                        : 'ChÃ†Â°a cÃƒÂ³ dÃƒÂ²ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button type="button" onClick={closeImportModal} className={ghostButton}>HÃ¡Â»Â§y</button>
                            <button type="button" onClick={saveImport} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>NhÃƒÂ  cung cÃ¡ÂºÂ¥p</div>
                            <select value={importModal.form.supplier_id} onChange={(event) => handleImportSupplierChange(event.target.value)} className={`w-full ${importSelectClass} h-11`}>
                                <option value="">TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</option>
                                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>TrÃ¡ÂºÂ¡ng thÃƒÂ¡i</div>
                            <div className="relative">
                                <select value={importModal.form.inventory_import_status_id} onChange={(event) => handleImportStatusChange(event.target.value)} className={`w-full pr-12 ${importSelectClass} h-11`}>
                                    <option value="">ChÃ¡Â»Ân trÃ¡ÂºÂ¡ng thÃƒÂ¡i</option>
                                    {importStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => openImportStatusManager(importStatuses.find((status) => String(status.id) === String(importModal.form.inventory_import_status_id)) || null)}
                                    className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/70 transition hover:border-primary hover:text-primary"
                                    title="QuÃ¡ÂºÂ£n lÃƒÂ½ trÃ¡ÂºÂ¡ng thÃƒÂ¡i phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p"
                                >
                                    <span className="material-symbols-outlined text-[18px]">tune</span>
                                </button>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>NgÃƒÂ y nhÃ¡ÂºÂ­p</div>
                            <input type="date" value={importModal.form.import_date} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, import_date: event.target.value } }))} className={`w-full ${importFieldClass} h-11`} />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>SÃ¡Â»â€˜ hÃƒÂ³a Ã„â€˜Ã†Â¡n</div>
                            <input value={importModal.form.invoice_number || ''} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, invoice_number: event.target.value } }))} className={`w-full ${importFieldClass} h-11`} placeholder="NhÃ¡ÂºÂ­p sÃ¡Â»â€˜ hÃƒÂ³a Ã„â€˜Ã†Â¡n (nÃ¡ÂºÂ¿u cÃƒÂ³)" />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelHiddenClass}>Ã„ÂÃƒÂ­nh kÃƒÂ¨m</div>
                            <label className={importActionButtonClass}>
                                <input type="file" multiple className="hidden" onChange={(event) => addImportAttachmentFiles(event.target.files)} />
                                <span className="material-symbols-outlined text-[18px]">attach_file</span>
                                Ã„ÂÃƒÂ­nh kÃƒÂ¨m hÃƒÂ³a Ã„â€˜Ã†Â¡n / chÃ¡Â»Â©ng tÃ¡Â»Â«{(importModal.form.attachments || []).length + (importModal.form.local_attachment_files || []).length > 0 ? ` (${(importModal.form.attachments || []).length + (importModal.form.local_attachment_files || []).length})` : ''}
                            </label>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelHiddenClass}>BÃ¡ÂºÂ£n nhÃƒÂ¡p</div>
                            <label className={importActionButtonClass}>
                                <input type="file" accept=".pdf,image/*,.heic,.heif" className="hidden" onChange={(event) => analyzeInvoiceFile(event.target.files?.[0])} />
                                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                {loading.invoiceAnalysis ? 'Ã„Âang Ã„â€˜Ã¡Â»Âc Ã¡ÂºÂ£nh / PDF' : 'TÃ¡ÂºÂ¡o bÃ¡ÂºÂ£n nhÃƒÂ¡p tÃ¡Â»Â« hÃƒÂ³a Ã„â€˜Ã†Â¡n'}
                            </label>
                        </div>
                    </div>

                    {importModal.form.items.some((item) => item.mapping_status === 'unmatched') ? (
                        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusPill label="ChÃ†Â°a map Ã„â€˜Ã¡Â»Â§" color="#D97706" subtle="#FEF3C7" />
                                <div className="text-[13px] font-black text-amber-900">CÃƒÂ³ dÃƒÂ²ng chÃ†Â°a map sang sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m nÃ¡Â»â„¢i bÃ¡Â»â„¢</div>
                            </div>
                            <div className="mt-2 space-y-1 text-[12px] text-amber-900/80">
                                {importModal.form.items.filter((item) => item.mapping_status === 'unmatched').map((item) => (
                                    <div key={`${item.key}_warning`}>
                                        {item.supplier_product_code || 'KhÃƒÂ´ng cÃƒÂ³ mÃƒÂ£ NCC'} Ã¢â‚¬Â¢ {item.product_name || 'ChÃ†Â°a cÃƒÂ³ tÃƒÂªn sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>TÃƒÂ¬m nhanh sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</div>
                            <ImportProductQuickSearch
                                supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null}
                                onSelect={appendImportProductFromQuickSearch}
                                placeholder={importModal.form.supplier_id ? 'TÃƒÂ¬m tÃƒÂªn, mÃƒÂ£ SP, mÃƒÂ£ NCC hoÃ¡ÂºÂ·c tÃ¡Â»Â« khÃƒÂ³a cÃ¡Â»Â§a nhÃƒÂ  cung cÃ¡ÂºÂ¥p Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân' : 'TÃƒÂ¬m tÃƒÂªn, mÃƒÂ£ SP, mÃƒÂ£ NCC hoÃ¡ÂºÂ·c tÃ¡Â»Â« khÃƒÂ³a trong toÃƒÂ n bÃ¡Â»â„¢ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}
                            />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>GiÃƒÂ¡ nhÃ¡ÂºÂ­p dÃ¡Â»Â± kiÃ¡ÂºÂ¿n</div>
                            <label className="inline-flex h-11 w-full items-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary">
                                <input
                                    type="checkbox"
                                    checked={Boolean(importModal.form.update_supplier_prices)}
                                    onChange={(event) => setImportModal((prev) => ({
                                        ...prev,
                                        form: {
                                            ...prev.form,
                                            update_supplier_prices: event.target.checked,
                                            items: prev.form.items.map((item) => ({ ...item, update_supplier_price: event.target.checked })),
                                        },
                                    }))}
                                    className="size-4 accent-primary"
                                />
                                <span className="leading-tight">Ã„ÂÃ¡Â»â€œng bÃ¡Â»â„¢ lÃ¡ÂºÂ¡i giÃƒÂ¡ nhÃ¡ÂºÂ­p dÃ¡Â»Â± kiÃ¡ÂºÂ¿n</span>
                            </label>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>DÃ¡Â»Â¯ liÃ¡Â»â€¡u</div>
                            <button
                                type="button"
                                onClick={refreshImportItemPricing}
                                disabled={loading.importPriceRefresh || !importModal.form.items.some((item) => Number(item.product_id || 0) > 0)}
                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading.importPriceRefresh ? 'animate-spin' : ''}`}>refresh</span>
                                LÃƒÂ m mÃ¡Â»â€ºi
                            </button>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>PhÃ¡Â»Â¥ phÃƒÂ­ tiÃ¡Â»Ân</div>
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
                                placeholder="+100.000 hoÃ¡ÂºÂ·c -100.000"
                            />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>PhÃ¡Â»Â¥ phÃƒÂ­ %</div>
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
                                placeholder="+10 hoÃ¡ÂºÂ·c -10"
                            />
                        </div>
                    </div>

                    <ImportItemsEditorTable
                        items={importModal.form.items}
                        inventoryUnits={inventoryUnits}
                        settingsOpen={importTableSettingsOpen}
                        onToggleSettings={() => setImportTableSettingsOpen((prev) => !prev)}
                        onCloseSettings={() => setImportTableSettingsOpen(false)}
                        expanded={false}
                        onToggleExpanded={() => setImportTableExpanded(true)}
                        onOpenPrint={openImportPrintModal}
                        onUpdateLine={updateImportLine}
                        onRemoveLine={removeImportLine}
                    />

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={markAllImportLinesCompleted} className={ghostButton} disabled={!importModal.form.items.length}>
                                <span className="material-symbols-outlined text-[18px]">done_all</span>
                                {importCompleteToggleSnapshot ? 'KhÃƒÂ´i phÃ¡Â»Â¥c trÃ†Â°Ã¡Â»â€ºc khi hoÃƒÂ n thÃƒÂ nh' : 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ hoÃƒÂ n thÃƒÂ nh'}
                            </button>
                        </div>
                        <textarea value={importModal.form.notes} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chÃƒÂº chung cho phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p" className="min-h-[92px] w-full rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary lg:max-w-[620px]" />
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={importModal.open && importTableExpanded}
                title="BÃ¡ÂºÂ£ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p"
                onClose={() => setImportTableExpanded(false)}
                maxWidth="max-w-[96vw]"
            >
                <ImportItemsEditorTable
                    items={importModal.form.items}
                    inventoryUnits={inventoryUnits}
                    settingsOpen={importTableSettingsOpen}
                    onToggleSettings={() => setImportTableSettingsOpen((prev) => !prev)}
                    onCloseSettings={() => setImportTableSettingsOpen(false)}
                    expanded
                    onToggleExpanded={() => setImportTableExpanded(false)}
                    onOpenPrint={openImportPrintModal}
                    onUpdateLine={updateImportLine}
                    onRemoveLine={removeImportLine}
                />
            </ModalShell>
            <ModalShell
                open={importModal.open && importPrintModalOpen}
                title="In phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p"
                onClose={() => setImportPrintModalOpen(false)}
                maxWidth="max-w-[1180px]"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] font-semibold text-primary/65">
                            {formatNumber(importPrintableItems.length)} dÃƒÂ²ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ã¢â‚¬Â¢ {formatNumber(importPrintSelectedColumns.length)} cÃ¡Â»â„¢t in
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setImportPrintModalOpen(false)} className={ghostButton}>Ã„ÂÃƒÂ³ng</button>
                            <button type="button" onClick={() => saveImportPrintTemplate('update')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                {importPrintSettingsSaving ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u mÃ¡ÂºÂ«u hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i'}
                            </button>
                            <button type="button" onClick={() => saveImportPrintTemplate('new')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                LÃ†Â°u thÃƒÂ nh mÃ¡ÂºÂ«u mÃ¡Â»â€ºi
                            </button>
                            <button type="button" onClick={printImportSheet} className={primaryButton}>
                                <span className="material-symbols-outlined text-[18px]">print</span>
                                In theo mÃ¡ÂºÂ«u Ã„â€˜ang chÃ¡Â»Ân
                            </button>
                        </div>
                    </div>
                )}
            >
                <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="space-y-4">
                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="space-y-3">
                                <div>
                                    <div className={importFieldLabelClass}>MÃ¡ÂºÂ«u in</div>
                                    <select
                                        value={importPrintTemplateId}
                                        onChange={(event) => applyImportPrintTemplate(event.target.value)}
                                        className={`w-full ${selectClass}`}
                                    >
                                        {importPrintTemplates.map((template) => (
                                            <option key={template.id} value={template.id}>
                                                {template.name}{template.locked ? ' (mÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¹nh)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <div className={importFieldLabelClass}>TÃƒÂªn mÃ¡ÂºÂ«u</div>
                                    <input
                                        value={importPrintTemplateName}
                                        onChange={(event) => setImportPrintTemplateName(event.target.value)}
                                        className={`w-full ${inputClass}`}
                                        placeholder="VÃƒÂ­ dÃ¡Â»Â¥: BÃ¡ÂºÂ£n chÃƒÂ­nh"
                                    />
                                </div>

                                <button type="button" onClick={() => applyImportPrintTemplate(IMPORT_PRINT_DEFAULT_TEMPLATE_ID)} className={ghostButton}>
                                    TrÃ¡ÂºÂ£ vÃ¡Â»Â mÃ¡ÂºÂ«u mÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¹nh
                                </button>

                                <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5 text-[12px] text-primary/70">
                                    <div>NhÃƒÂ  cung cÃ¡ÂºÂ¥p: <span className="font-bold text-primary">{importPrintSupplierName}</span></div>
                                    <div className="mt-1">NgÃƒÂ y giÃ¡Â»Â preview: <span className="font-bold text-primary">{formatDateTime(importPrintPreviewPrintedAt)}</span></div>
                                    {importPrintSettingsLoading ? <div className="mt-1 text-primary/55">Ã„Âang tÃ¡ÂºÂ£i mÃ¡ÂºÂ«u in Ã„â€˜ÃƒÂ£ lÃ†Â°u...</div> : null}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[13px] font-black text-primary">CÃ¡Â»â„¢t cÃ¡ÂºÂ§n in</div>
                                    <div className="text-[12px] text-primary/55">Tick chÃ¡Â»Ân cÃƒÂ¡c cÃ¡Â»â„¢t xuÃ¡ÂºÂ¥t hiÃ¡Â»â€¡n trÃƒÂªn bÃ¡ÂºÂ£n in A4.</div>
                                </div>
                                <div className="text-right text-[12px] font-semibold text-primary/60">
                                    {formatNumber(importPrintSelectedColumns.length)} / {formatNumber(importPrintColumns.length)} cÃ¡Â»â„¢t
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
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                            <div>
                                <div className="text-[13px] font-black text-primary">Xem trÃ†Â°Ã¡Â»â€ºc bÃ¡ÂºÂ£n in</div>
                                <div className="text-[12px] text-primary/55">TÃ¡Â»â€˜i Ã†Â°u cho khÃ¡Â»â€¢ giÃ¡ÂºÂ¥y A4, tÃ¡Â»Â± chuyÃ¡Â»Æ’n ngang khi sÃ¡Â»â€˜ cÃ¡Â»â„¢t quÃƒÂ¡ nhiÃ¡Â»Âu.</div>
                            </div>
                            <div className="text-right text-[12px] text-primary/60">
                                <div>{formatNumber(importPrintableItems.length)} dÃƒÂ²ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</div>
                                <div>{formatCurrency(importLineTotal)} tÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n</div>
                            </div>
                        </div>

                        <iframe
                            title="Xem trÃ†Â°Ã¡Â»â€ºc in phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p"
                            srcDoc={importPrintPreviewHtml}
                            className="h-[62vh] w-full rounded-sm border border-primary/10 bg-white"
                        />
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={importListPrintModalOpen}
                title="In phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân"
                onClose={() => {
                    setImportListPrintModalOpen(false);
                    setImportListPrintDocuments([]);
                }}
                maxWidth="max-w-[1180px]"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] font-semibold text-primary/65">
                            {formatNumber(importListPrintMetrics.documents)} phiÃ¡ÂºÂ¿u Ã¢â‚¬Â¢ {formatNumber(importListPrintMetrics.lines)} dÃƒÂ²ng sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m Ã¢â‚¬Â¢ {formatNumber(importPrintSelectedColumns.length)} cÃ¡Â»â„¢t in
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setImportListPrintModalOpen(false);
                                    setImportListPrintDocuments([]);
                                }}
                                className={ghostButton}
                            >
                                Ã„ÂÃƒÂ³ng
                            </button>
                            <button type="button" onClick={() => saveImportPrintTemplate('update')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                {importPrintSettingsSaving ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u mÃ¡ÂºÂ«u hiÃ¡Â»â€¡n tÃ¡ÂºÂ¡i'}
                            </button>
                            <button type="button" onClick={() => saveImportPrintTemplate('new')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                LÃ†Â°u thÃƒÂ nh mÃ¡ÂºÂ«u mÃ¡Â»â€ºi
                            </button>
                            <button type="button" onClick={printSelectedImportSheets} className={primaryButton} disabled={importListPrintLoading || !importListPrintDocuments.length}>
                                <span className="material-symbols-outlined text-[18px]">print</span>
                                In phiÃ¡ÂºÂ¿u Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân
                            </button>
                        </div>
                    </div>
                )}
            >
                <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="space-y-4">
                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="space-y-3">
                                <div>
                                    <div className={importFieldLabelClass}>MÃ¡ÂºÂ«u in</div>
                                    <select
                                        value={importPrintTemplateId}
                                        onChange={(event) => applyImportPrintTemplate(event.target.value)}
                                        className={`w-full ${selectClass}`}
                                    >
                                        {importPrintTemplates.map((template) => (
                                            <option key={template.id} value={template.id}>
                                                {template.name}{template.locked ? ' (mÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¹nh)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <div className={importFieldLabelClass}>TÃƒÂªn mÃ¡ÂºÂ«u</div>
                                    <input
                                        value={importPrintTemplateName}
                                        onChange={(event) => setImportPrintTemplateName(event.target.value)}
                                        className={`w-full ${inputClass}`}
                                        placeholder="VÃƒÂ­ dÃ¡Â»Â¥: BÃ¡ÂºÂ£n chÃƒÂ­nh"
                                    />
                                </div>

                                <button type="button" onClick={() => applyImportPrintTemplate(IMPORT_PRINT_DEFAULT_TEMPLATE_ID)} className={ghostButton}>
                                    TrÃ¡ÂºÂ£ vÃ¡Â»Â mÃ¡ÂºÂ«u mÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¹nh
                                </button>

                                <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5 text-[12px] text-primary/70">
                                    <div>NhÃƒÂ  cung cÃ¡ÂºÂ¥p: <span className="font-bold text-primary">{importListPrintSupplierSummary}</span></div>
                                    <div className="mt-1">NgÃƒÂ y giÃ¡Â»Â preview: <span className="font-bold text-primary">{formatDateTime(importPrintPreviewPrintedAt)}</span></div>
                                    <div className="mt-1">SÃ¡Â»â€˜ phiÃ¡ÂºÂ¿u Ã„â€˜ÃƒÂ£ tÃ¡ÂºÂ£i: <span className="font-bold text-primary">{formatNumber(importListPrintMetrics.documents)}</span></div>
                                    {importPrintSettingsLoading ? <div className="mt-1 text-primary/55">Ã„Âang tÃ¡ÂºÂ£i mÃ¡ÂºÂ«u in Ã„â€˜ÃƒÂ£ lÃ†Â°u...</div> : null}
                                    {importListPrintLoading ? <div className="mt-1 text-primary/55">Ã„Âang tÃ¡ÂºÂ£i dÃ¡Â»Â¯ liÃ¡Â»â€¡u phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p...</div> : null}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[13px] font-black text-primary">CÃ¡Â»â„¢t cÃ¡ÂºÂ§n in</div>
                                    <div className="text-[12px] text-primary/55">Tick chÃ¡Â»Ân cÃƒÂ¡c cÃ¡Â»â„¢t xuÃ¡ÂºÂ¥t hiÃ¡Â»â€¡n trÃƒÂªn bÃ¡ÂºÂ£n in A4.</div>
                                </div>
                                <div className="text-right text-[12px] font-semibold text-primary/60">
                                    {formatNumber(importPrintSelectedColumns.length)} / {formatNumber(importPrintColumns.length)} cÃ¡Â»â„¢t
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
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                            <div>
                                <div className="text-[13px] font-black text-primary">Xem trÃ†Â°Ã¡Â»â€ºc bÃ¡ÂºÂ£n in</div>
                                <div className="text-[12px] text-primary/55">DÃƒÂ¹ng chung mÃ¡ÂºÂ«u in vÃ¡Â»â€ºi popup tÃ¡ÂºÂ¡o phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p, tÃ¡Â»Â± tÃ¡Â»â€˜i Ã†Â°u cho khÃ¡Â»â€¢ A4.</div>
                            </div>
                            <div className="text-right text-[12px] text-primary/60">
                                <div>{formatNumber(importListPrintMetrics.documents)} phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p</div>
                                <div>{formatCurrency(importListPrintMetrics.total)} tÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n</div>
                            </div>
                        </div>

                        <iframe
                            title="Xem trÃ†Â°Ã¡Â»â€ºc in phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p Ã„â€˜ÃƒÂ£ chÃ¡Â»Ân"
                            srcDoc={importListPrintPreviewHtml}
                            className="h-[62vh] w-full rounded-sm border border-primary/10 bg-white"
                        />
                    </div>
                </div>
            </ModalShell>
            <ModalShell
                open={importInvoiceModal.open}
                title={importInvoiceModal.importNumber ? `HÃƒÂ³a Ã„â€˜Ã†Â¡n phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p ${importInvoiceModal.importNumber}` : 'HÃƒÂ³a Ã„â€˜Ã†Â¡n phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'}
                onClose={closeImportInvoiceModal}
                maxWidth="max-w-[1280px]"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] font-semibold text-primary/65">
                            {(importInvoiceModal.form.attachments || []).length + (importInvoiceModal.form.local_attachment_files || []).length} hÃƒÂ³a Ã„â€˜Ã†Â¡n / chÃ¡Â»Â©ng tÃ¡Â»Â«
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={closeImportInvoiceModal} className={ghostButton}>Ã„ÂÃƒÂ³ng</button>
                            <button type="button" onClick={triggerImportInvoiceAddFiles} className={ghostButton}>
                                <span className="material-symbols-outlined text-[18px]">attach_file</span>
                                ThÃƒÂªm hÃƒÂ³a Ã„â€˜Ã†Â¡n
                            </button>
                            <button type="button" onClick={saveImportInvoiceModal} className={primaryButton} disabled={importInvoiceModal.loading || importInvoiceModal.saving}>
                                {importInvoiceModal.saving ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u hÃƒÂ³a Ã„â€˜Ã†Â¡n'}
                            </button>
                        </div>
                    </div>
                )}
            >
                <input
                    ref={importInvoiceAddInputRef}
                    type="file"
                    accept=".pdf,image/*,.heic,.heif"
                    multiple
                    className="hidden"
                    onChange={handleImportInvoiceAddFiles}
                />
                <input
                    ref={importInvoiceReplaceInputRef}
                    type="file"
                    accept=".pdf,image/*,.heic,.heif"
                    className="hidden"
                    onChange={handleImportInvoiceReplaceFile}
                />

                {importInvoiceModal.loading ? (
                    <div className="flex min-h-[320px] items-center justify-center text-[13px] font-semibold text-primary/55">
                        Ã„Âang tÃ¡ÂºÂ£i hÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m...
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">NhÃƒÂ  cung cÃ¡ÂºÂ¥p</div>
                                <div className="mt-1 text-[13px] font-bold text-primary">
                                    {importInvoiceModal.supplierName || 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}
                                </div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">NgÃƒÂ y nhÃ¡ÂºÂ­p</div>
                                <div className="mt-1 text-[13px] font-bold text-primary">{importInvoiceModal.form.import_date ? formatDateTime(importInvoiceModal.form.import_date) : '-'}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">SÃ¡Â»â€˜ hÃƒÂ³a Ã„â€˜Ã†Â¡n</div>
                                <div className="mt-1 text-[13px] font-bold text-primary">{importInvoiceModal.form.invoice_number || 'ChÃ†Â°a cÃƒÂ³ sÃ¡Â»â€˜ hÃƒÂ³a Ã„â€˜Ã†Â¡n'}</div>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2 rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                    <div>
                                        <div className="text-[13px] font-black text-primary">Danh sÃƒÂ¡ch hÃƒÂ³a Ã„â€˜Ã†Â¡n</div>
                                        <div className="text-[12px] text-primary/55">Xem, thÃƒÂªm, thay hoÃ¡ÂºÂ·c xÃƒÂ³a hÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m.</div>
                                    </div>
                                    <button type="button" onClick={triggerImportInvoiceAddFiles} className={ghostButton}>
                                        <span className="material-symbols-outlined text-[18px]">add</span>
                                        ThÃƒÂªm
                                    </button>
                                </div>

                                <div className="max-h-[62vh] overflow-auto rounded-sm border border-primary/10 bg-white">
                                    {!importInvoiceAttachmentItems.length ? (
                                        <div className="px-4 py-8 text-center text-[13px] text-primary/55">PhiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p nÃƒÂ y chÃ†Â°a cÃƒÂ³ hÃƒÂ³a Ã„â€˜Ã†Â¡n Ã„â€˜ÃƒÂ­nh kÃƒÂ¨m.</div>
                                    ) : importInvoiceAttachmentItems.map((item) => {
                                        const previewKind = getAttachmentPreviewKind({ mimeType: item.mimeType, fileName: item.name });
                                        return (
                                            <div
                                                key={item.key}
                                                className={`flex items-start gap-3 border-b border-primary/10 px-3 py-3 transition last:border-b-0 ${importInvoicePreviewKey === item.key ? 'bg-primary/[0.06]' : 'hover:bg-primary/[0.03]'}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setImportInvoicePreviewKey(item.key)}
                                                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                                >
                                                    <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border ${previewKind === 'pdf' ? 'border-rose-200 bg-rose-50 text-rose-700' : previewKind === 'image' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-primary/15 bg-white text-primary/65'}`}>
                                                        <span className="material-symbols-outlined text-[18px]">{previewKind === 'pdf' ? 'picture_as_pdf' : previewKind === 'image' ? 'image' : 'description'}</span>
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-[13px] font-semibold text-primary">{item.name}</div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-primary/50">
                                                            <span>{formatAttachmentFileSize(item.size)}</span>
                                                            <span>{item.source === 'local' ? 'ChÃ†Â°a lÃ†Â°u' : 'Ã„ÂÃƒÂ£ lÃ†Â°u'}</span>
                                                            {item.createdAt ? <span>{formatDateTime(item.createdAt)}</span> : null}
                                                        </div>
                                                    </div>
                                                </button>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => requestReplaceImportInvoiceFile(item)}
                                                        className={iconButton(false)}
                                                        title="Thay hÃƒÂ³a Ã„â€˜Ã†Â¡n"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">sync</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (!window.confirm(`XÃƒÂ³a hÃƒÂ³a Ã„â€˜Ã†Â¡n "${item.name}"?`)) return;
                                                            if (item.source === 'existing') {
                                                                removeImportInvoiceAttachment(item.attachmentIndex);
                                                            } else {
                                                                removeImportInvoiceLocalFile(item.localFileIndex);
                                                            }
                                                        }}
                                                        className={iconButton(false)}
                                                        title="XÃƒÂ³a hÃƒÂ³a Ã„â€˜Ã†Â¡n"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                                    <div>
                                        <div className="text-[13px] font-black text-primary">Xem hÃƒÂ³a Ã„â€˜Ã†Â¡n</div>
                                        <div className="text-[12px] text-primary/55">HÃ¡Â»â€” trÃ¡Â»Â£ xem trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p Ã¡ÂºÂ£nh vÃƒÂ  PDF.</div>
                                    </div>
                                    {activeImportInvoicePreviewItem?.url ? (
                                        <a
                                            href={activeImportInvoicePreviewItem.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={ghostButton}
                                        >
                                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                            MÃ¡Â»Å¸ tab mÃ¡Â»â€ºi
                                        </a>
                                    ) : null}
                                </div>

                                <div className="min-h-[62vh] overflow-hidden rounded-sm border border-primary/10 bg-[#f8fafc]">
                                    {!activeImportInvoicePreviewItem ? (
                                        <div className="flex h-[62vh] items-center justify-center px-6 text-center text-[13px] text-primary/55">
                                            ChÃ¡Â»Ân mÃ¡Â»â„¢t hÃƒÂ³a Ã„â€˜Ã†Â¡n trong danh sÃƒÂ¡ch Ã„â€˜Ã¡Â»Æ’ xem trÃ†Â°Ã¡Â»â€ºc.
                                        </div>
                                    ) : activeImportInvoicePreviewKind === 'pdf' && activeImportInvoicePreviewItem.url ? (
                                        <iframe
                                            title={activeImportInvoicePreviewItem.name}
                                            src={activeImportInvoicePreviewItem.url}
                                            className="h-[62vh] w-full bg-white"
                                        />
                                    ) : activeImportInvoicePreviewKind === 'image' && activeImportInvoicePreviewItem.url ? (
                                        <div className="flex h-[62vh] items-center justify-center bg-white p-4">
                                            <img
                                                src={activeImportInvoicePreviewItem.url}
                                                alt={activeImportInvoicePreviewItem.name}
                                                className="max-h-full max-w-full object-contain"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex h-[62vh] flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-primary/60">
                                            <span className="material-symbols-outlined text-[36px] text-primary/35">description</span>
                                            <div>KhÃƒÂ´ng thÃ¡Â»Æ’ xem trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p Ã„â€˜Ã¡Â»â€¹nh dÃ¡ÂºÂ¡ng nÃƒÂ y trong popup.</div>
                                            {activeImportInvoicePreviewItem?.url ? (
                                                <a href={activeImportInvoicePreviewItem.url} target="_blank" rel="noreferrer" className={primaryButton}>
                                                    <span className="material-symbols-outlined text-[18px]">download</span>
                                                    MÃ¡Â»Å¸ hoÃ¡ÂºÂ·c tÃ¡ÂºÂ£i tÃ¡Â»â€¡p
                                                </a>
                                            ) : null}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </ModalShell>
            <ModalShell
                open={importDetailModal.open}
                title={importDetailModal.record?.import_number ? `Chi tiÃ¡ÂºÂ¿t phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p ${importDetailModal.record.import_number}` : 'Chi tiÃ¡ÂºÂ¿t phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'}
                onClose={closeImportDetailModal}
                maxWidth="max-w-[96vw]"
                footer={(
                    <div className="flex justify-end">
                        <button type="button" onClick={closeImportDetailModal} className={ghostButton}>Ã„ÂÃƒÂ³ng</button>
                    </div>
                )}
            >
                {importDetailModal.loading ? (
                    <div className="flex min-h-[320px] items-center justify-center text-[13px] font-semibold text-primary/55">
                        Ã„Âang tÃ¡ÂºÂ£i chi tiÃ¡ÂºÂ¿t phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p...
                    </div>
                ) : importDetailModal.record && importDetailForm && importDetailPrintableDocument ? (
                    <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">MÃƒÂ£ phiÃ¡ÂºÂ¿u</div>
                                <div className="mt-1 font-mono text-[13px] font-bold text-primary">{importDetailModal.record.import_number || '-'}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">NhÃƒÂ  cung cÃ¡ÂºÂ¥p</div>
                                <div className="mt-1 text-[13px] font-bold text-primary">{importDetailModal.record.supplier?.name || 'TÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m'}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">NgÃƒÂ y nhÃ¡ÂºÂ­p</div>
                                <div className="mt-1 text-[13px] font-bold text-primary">{formatDateTime(importDetailModal.record.import_date)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">TrÃ¡ÂºÂ¡ng thÃƒÂ¡i</div>
                                <div className="mt-1">
                                    <StatusPill
                                        label={importDetailModal.record.statusConfig?.name || importDetailModal.record.status || 'ChÃ†Â°a cÃƒÂ³ trÃ¡ÂºÂ¡ng thÃƒÂ¡i'}
                                        color={importDetailModal.record.statusConfig?.color || '#94A3B8'}
                                    />
                                </div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-[#f8fafc] px-3 py-2.5">
                                <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">TÃ¡Â»â€¢ng tiÃ¡Â»Ân Ã„â€˜Ã†Â¡n</div>
                                <div className="mt-1 text-[13px] font-black text-primary">{formatCurrency(importDetailPrintableDocument.total)}</div>
                            </div>
                        </div>

                        {importDetailModal.record.notes ? (
                            <div className="rounded-sm border border-primary/10 bg-white px-3 py-3 text-[13px] text-primary/75">
                                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">Ghi chÃƒÂº</div>
                                {importDetailModal.record.notes}
                            </div>
                        ) : null}

                        <ImportItemsEditorTable
                            items={importDetailForm.items}
                            inventoryUnits={inventoryUnits}
                            settingsOpen={importDetailTableSettingsOpen}
                            onToggleSettings={() => setImportDetailTableSettingsOpen((prev) => !prev)}
                            onCloseSettings={() => setImportDetailTableSettingsOpen(false)}
                            expanded
                            readOnly
                            hideActions
                            storageKey="inventory_import_detail_table_v1"
                            headerMessage="Xem toÃƒÂ n bÃ¡Â»â„¢ danh sÃƒÂ¡ch sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m cÃ¡Â»Â§a phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p."
                        />
                    </div>
                ) : (
                    <div className="flex min-h-[220px] items-center justify-center text-[13px] font-semibold text-primary/55">
                        ChÃ†Â°a cÃƒÂ³ dÃ¡Â»Â¯ liÃ¡Â»â€¡u chi tiÃ¡ÂºÂ¿t phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p.
                    </div>
                )}
            </ModalShell>
            <ModalShell
                open={importStatusModal.open}
                title={importStatusModal.form.id ? 'SÃ¡Â»Â­a trÃ¡ÂºÂ¡ng thÃƒÂ¡i phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p' : 'TÃ¡ÂºÂ¡o trÃ¡ÂºÂ¡ng thÃƒÂ¡i phiÃ¡ÂºÂ¿u nhÃ¡ÂºÂ­p'}
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
                            <button type="button" onClick={() => setImportStatusModal({ open: false, form: createImportStatusForm() })} className={ghostButton}>Ã„ÂÃƒÂ³ng</button>
                            <button type="button" onClick={saveImportStatus} className={primaryButton} disabled={loading.importStatusModal}>{loading.importStatusModal ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u trÃ¡ÂºÂ¡ng thÃƒÂ¡i'}</button>
                        </div>
                    </div>
                )}
            >
                <div className="grid gap-3 md:grid-cols-2">
                    <input value={importStatusModal.form.name} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} placeholder="TÃƒÂªn trÃ¡ÂºÂ¡ng thÃƒÂ¡i" className={inputClass} />
                    <div className="flex items-center gap-3 rounded-sm border border-primary/15 px-3">
                        <span className="text-[12px] font-bold text-primary/60">MÃƒÂ u hiÃ¡Â»Æ’n thÃ¡Â»â€¹</span>
                        <input type="color" value={importStatusModal.form.color || '#10B981'} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, color: event.target.value } }))} className="h-10 w-14 cursor-pointer border-0 bg-transparent p-0" />
                        <StatusPill label={importStatusModal.form.name || 'Xem trÃ†Â°Ã¡Â»â€ºc'} color={importStatusModal.form.color || '#10B981'} />
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary">
                        <input type="checkbox" checked={importStatusModal.form.affects_inventory} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, affects_inventory: event.target.checked } }))} className="size-4 accent-primary" />
                        TrÃ¡ÂºÂ¡ng thÃƒÂ¡i nÃƒÂ y cÃ¡ÂºÂ­p nhÃ¡ÂºÂ­t tÃ¡Â»â€œn kho
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary">
                        <input type="checkbox" checked={importStatusModal.form.is_default} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, is_default: event.target.checked } }))} className="size-4 accent-primary" />
                        Ã„ÂÃ¡ÂºÂ·t lÃƒÂ m trÃ¡ÂºÂ¡ng thÃƒÂ¡i mÃ¡ÂºÂ·c Ã„â€˜Ã¡Â»â€¹nh
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-sm border border-primary/15 px-3 py-2 text-[13px] font-semibold text-primary md:col-span-2">
                        <input type="checkbox" checked={importStatusModal.form.is_active} onChange={(event) => setImportStatusModal((prev) => ({ ...prev, form: { ...prev.form, is_active: event.target.checked } }))} className="size-4 accent-primary" />
                        Ã„Âang sÃ¡Â»Â­ dÃ¡Â»Â¥ng
                    </label>
                </div>
            </ModalShell>
            <ModalShell open={documentModal.open} title={documentModal.form.id ? `SÃ¡Â»Â­a ${documentTitleMap[documentModal.tabKey]}` : `TÃ¡ÂºÂ¡o ${documentTitleMap[documentModal.tabKey]}`} onClose={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} footer={<div className="flex items-center justify-between gap-3"><div className="text-[13px] font-black text-primary">{documentModal.tabKey === 'damaged' ? `TÃ¡Â»â€¢ng sÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng: ${formatNumber(documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}` : `TÃ¡Â»â€¢ng giÃƒÂ¡ trÃ¡Â»â€¹ tÃ¡ÂºÂ¡m tÃƒÂ­nh: ${formatCurrency(documentLineTotal)}`}</div><div className="flex gap-2"><button type="button" onClick={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} className={ghostButton}>HÃ¡Â»Â§y</button><button type="button" onClick={saveDocument} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Ã„Âang lÃ†Â°u' : 'LÃ†Â°u phiÃ¡ÂºÂ¿u'}</button></div></div>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><input type="date" value={documentModal.form.document_date} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, document_date: event.target.value } }))} className={inputClass} /><select value={documentModal.form.supplier_id} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, supplier_id: event.target.value } }))} className={selectClass}><option value="">KhÃƒÂ´ng gÃ¡ÂºÂ¯n nhÃƒÂ  cung cÃ¡ÂºÂ¥p</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><div className="flex items-center rounded-sm border border-primary/15 px-3 text-[13px] font-semibold text-primary">{documentTitleMap[documentModal.tabKey]}</div></div><ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => { const index = documentModal.form.items.findIndex((item) => !item.product_id); const targetIndex = index >= 0 ? index : documentModal.form.items.length; if (index < 0) addLine(setDocumentModal); attachProductToLine(setDocumentModal, targetIndex, product); }} buttonLabel="ThÃƒÂªm vÃƒÂ o phiÃ¡ÂºÂ¿u" /><div className="overflow-hidden rounded-sm border border-primary/10"><table className="w-full border-collapse"><thead className="bg-[#f6f9fc]"><tr>{['SÃ¡ÂºÂ£n phÃ¡ÂºÂ©m', 'SÃ¡Â»â€˜ lÃ†Â°Ã¡Â»Â£ng', documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? 'GiÃƒÂ¡ vÃ¡Â»â€˜n' : null, documentModal.tabKey === 'adjustments' ? 'LoÃ¡ÂºÂ¡i tÃ¡Â»â€œn' : null, documentModal.tabKey === 'adjustments' ? 'HÃ†Â°Ã¡Â»â€ºng' : null, 'Ghi chÃƒÂº', 'XÃƒÂ³a'].filter(Boolean).map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary">{label}</th>)}</tr></thead><tbody>{documentModal.form.items.map((item, index) => <tr key={item.key}><td className="border-b border-r border-primary/10 px-3 py-2"><div className="space-y-2">{item.product_id ? <CellText primary={item.product_name || '-'} secondary={item.product_sku || '-'} /> : <div className="text-[12px] text-primary/45">ChÃ†Â°a chÃ¡Â»Ân sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m</div>}<ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => attachProductToLine(setDocumentModal, index, product)} placeholder="Ã„ÂÃ¡Â»â€¢i sÃ¡ÂºÂ£n phÃ¡ÂºÂ©m" buttonLabel="ChÃ¡Â»Ân" /></div></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.quantity} onChange={(event) => updateLine(setDocumentModal, index, 'quantity', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td>{documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.unit_cost} onChange={(event) => updateLine(setDocumentModal, index, 'unit_cost', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.stock_bucket} onChange={(event) => updateLine(setDocumentModal, index, 'stock_bucket', event.target.value)} className={`w-full ${selectClass}`}><option value="sellable">TÃ¡Â»â€œn bÃƒÂ¡n Ã„â€˜Ã†Â°Ã¡Â»Â£c</option><option value="damaged">TÃ¡Â»â€œn hÃ¡Â»Âng</option></select></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.direction} onChange={(event) => updateLine(setDocumentModal, index, 'direction', event.target.value)} className={`w-full ${selectClass}`}><option value="in">CÃ¡Â»â„¢ng</option><option value="out">TrÃ¡Â»Â«</option></select></td> : null}<td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.notes} onChange={(event) => updateLine(setDocumentModal, index, 'notes', event.target.value)} className={`w-full ${inputClass}`} placeholder="Ghi chÃƒÂº" /></td><td className="border-b border-primary/10 px-3 py-2 text-center"><button type="button" onClick={() => removeLine(setDocumentModal, index)} className={dangerButton}>XÃƒÂ³a</button></td></tr>)}</tbody></table></div><div className="flex justify-between gap-2"><button type="button" onClick={() => addLine(setDocumentModal)} className={ghostButton}>ThÃƒÂªm dÃƒÂ²ng</button><textarea value={documentModal.form.notes} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chÃƒÂº phiÃ¡ÂºÂ¿u kho" className="min-h-[96px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" /></div></div></ModalShell>
        </div>
    );
};

export default InventoryMovement;

