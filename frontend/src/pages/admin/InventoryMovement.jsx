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
const inventorySearchCache = new Map();
const INVENTORY_SEARCH_CACHE_LIMIT = 80;
const INVENTORY_SEARCH_CACHE_TTL = 60 * 1000;
const IMPORT_PRINT_SETTINGS_KEY = 'inventory_import_print_templates';
const IMPORT_PRINT_DEFAULT_TEMPLATE_ID = 'inventory_import_default_template';
const IMPORT_PRINT_DEFAULT_TEMPLATE_NAME = 'Bản chính';

const topTabs = [
    ['overview', 'Tổng quan'],
    ['products', 'Sản phẩm'],
    ['suppliers', 'Nhà cung cấp'],
    ['supplierPrices', 'Giá nhập từng nhà'],
    ['lots', 'Lô hàng'],
    ['trash', 'Thùng rác'],
];

const documentTabs = [
    ['imports', 'Phiếu nhập'],
    ['exports', 'Phiếu xuất'],
    ['returns', 'Phiếu hoàn'],
    ['damaged', 'Phiếu hỏng'],
    ['adjustments', 'Phiếu điều chỉnh'],
];

const isDocumentTab = (tabKey) => documentTabs.some(([key]) => key === tabKey);

const documentTypeMap = { returns: 'return', damaged: 'damaged', adjustments: 'adjustment' };
const documentTitleMap = { returns: 'Phiếu hàng hoàn', damaged: 'Phiếu hàng hỏng', adjustments: 'Phiếu điều chỉnh' };
const pageSizeOptions = [20, 50, 100, 500];
const inventoryTableStorageVersion = 'v4';
const emptySortConfig = { key: null, direction: 'none' };
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
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
const buildInventorySearchMeta = (row) => [
    row?.sku ? `Mã SP: ${row.sku}` : null,
    row?.supplier_product_code ? `Mã NCC: ${row.supplier_product_code}` : null,
    row?.parent_name ? `Thuộc: ${row.parent_name}` : null,
]
    .filter(Boolean)
    .join(' • ');
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
                original_name: attachment.original_name || 'Tệp đính kèm',
                mime_type: attachment.mime_type || null,
                file_size: attachment.file_size || 0,
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
                mapping_label: item.product_id ? 'Đã map sản phẩm' : '',
            }))
            : [],
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
    printedAt = '',
    columns = [],
    items = [],
    subtotal = 0,
    surcharge = 0,
    total = 0,
    notes = '',
} = {}) => {
    const normalizedColumns = (Array.isArray(columns) ? columns : []).filter(Boolean);
    const totalWeight = normalizedColumns.reduce((sum, column) => sum + Number(column.widthWeight || 1), 0) || normalizedColumns.length || 1;
    const orientation = normalizedColumns.length > 6 || totalWeight > 11 ? 'landscape' : 'portrait';
    const printedAtLabel = formatDateTime(printedAt || new Date().toISOString());

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
        : `<tr><td colspan="${Math.max(normalizedColumns.length, 1)}" class="empty">Chưa có dòng sản phẩm.</td></tr>`;

    const totalRow = normalizedColumns.length > 1
        ? `
            <tfoot>
                <tr class="summary-row">
                    <td colspan="${normalizedColumns.length - 1}">Tổng tiền đơn</td>
                    <td class="align-right">${escapePrintHtml(formatCurrency(total))}</td>
                </tr>
            </tfoot>
        `
        : `
            <tfoot>
                <tr class="summary-row">
                    <td class="align-right">Tổng tiền đơn: ${escapePrintHtml(formatCurrency(total))}</td>
                </tr>
            </tfoot>
        `;

    const notesSection = String(notes || '').trim()
        ? `
            <div class="notes-block">
                <div class="section-title">Ghi chú</div>
                <div>${escapePrintHtml(notes)}</div>
            </div>
        `
        : '';

    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8" />
    <title>Phiếu nhập</title>
    <style>
        @page { size: A4 ${orientation}; margin: 12mm; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
            font-family: Arial, "Helvetica Neue", sans-serif;
            color: #16324f;
            background: #ffffff;
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
</head>
<body>
    <div class="sheet">
        <div class="header">
            <div class="title-block">
                <h1>Phiếu nhập</h1>
                <p>Bản in tối ưu cho khổ giấy A4</p>
            </div>
            <div class="meta-card">
                <div class="meta-row">
                    <div class="meta-label">Nhà cung cấp</div>
                    <div>${escapePrintHtml(supplierName)}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-label">Ngày giờ in</div>
                    <div>${escapePrintHtml(printedAtLabel)}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-label">Số dòng</div>
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
                <span>Tổng tiền hàng</span>
                <strong>${escapePrintHtml(formatCurrency(subtotal))}</strong>
            </div>
            <div class="total-card">
                <span>Phụ phí</span>
                <strong>${escapePrintHtml(formatCurrency(surcharge))}</strong>
            </div>
            <div class="total-card">
                <span>Tổng tiền đơn</span>
                <strong>${escapePrintHtml(formatCurrency(total))}</strong>
            </div>
        </div>

        ${notesSection}
    </div>
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
    { id: 'sku', label: 'Mã', minWidth: 150 },
    { id: 'name', label: 'Tên sản phẩm', minWidth: 250 },
    { id: 'type_label', label: 'Loại', minWidth: 150 },
    { id: 'total_imported', label: 'Tổng nhập', minWidth: 110, align: 'right' },
    { id: 'total_exported', label: 'Tổng xuất bán', minWidth: 125, align: 'right' },
    { id: 'total_returned', label: 'Tổng hoàn', minWidth: 110, align: 'right' },
    { id: 'total_damaged', label: 'Tổng hỏng', minWidth: 110, align: 'right' },
    { id: 'stock_quantity', label: 'Tồn bán được', minWidth: 120, align: 'right' },
    { id: 'damaged_quantity', label: 'Tồn hỏng', minWidth: 110, align: 'right' },
    { id: 'expected_cost', label: 'Giá dự kiến', minWidth: 120, align: 'right' },
    { id: 'current_cost', label: 'Giá vốn hiện tại', minWidth: 130, align: 'right' },
    { id: 'inventory_value', label: 'Thành tiền tồn', minWidth: 140, align: 'right' },
    { id: 'price_status', label: 'Trạng thái giá', minWidth: 150 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
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
    { id: 'current_cost', label: 'Giá vốn hiện tại', minWidth: 125, align: 'right' },
    { id: 'supplier_price_updated_at', label: 'Sửa gần nhất', minWidth: 150, align: 'center' },
];

const importColumns = [
    { id: 'code', label: 'Mã phiếu', minWidth: 150 },
    { id: 'supplier', label: 'Nhà cung cấp', minWidth: 220 },
    { id: 'date', label: 'Ngày nhập', minWidth: 150 },
    { id: 'status', label: 'Trạng thái', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'qty', label: 'Tổng số lượng', minWidth: 110, align: 'right' },
    { id: 'amount', label: 'Tổng tiền', minWidth: 130, align: 'right' },
    { id: 'note', label: 'Ghi chú', minWidth: 200 },
    { id: 'actions', label: 'Thao tác', minWidth: 145, align: 'center' },
];

const exportColumns = [
    { id: 'code', label: 'Mã đơn', minWidth: 140 },
    { id: 'customer', label: 'Khách hàng', minWidth: 220 },
    { id: 'date', label: 'Ngày tạo', minWidth: 150 },
    { id: 'line_count', label: 'Số dòng', minWidth: 90, align: 'right' },
    { id: 'revenue', label: 'Doanh thu', minWidth: 120, align: 'right' },
    { id: 'cost', label: 'Giá vốn', minWidth: 120, align: 'right' },
    { id: 'profit', label: 'Lãi gộp', minWidth: 120, align: 'right' },
    { id: 'status', label: 'Trạng thái', minWidth: 120 },
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
    { id: 'code', label: 'Mã', minWidth: 140 },
    { id: 'product', label: 'Sản phẩm', minWidth: 250 },
    { id: 'date', label: 'Ngày xóa', minWidth: 150 },
    { id: 'price_status', label: 'Trạng thái giá', minWidth: 140 },
    { id: 'actions', label: 'Thao tác', minWidth: 190, align: 'center' },
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
    { id: 'current_cost', label: 'Giá vốn hiện tại', minWidth: 125, align: 'right' },
    { id: 'updated_at', label: 'Sửa gần nhất', minWidth: 150, align: 'center' },
    { id: 'actions', label: 'Thao tác', minWidth: 120, align: 'center' },
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
        <div>
            <div className="text-[13px] font-black text-primary">{title}</div>
            {description ? <div className="text-[11px] text-primary/45">{description}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

const ImportProductQuickSearch = ({
    onSelect,
    supplierId = null,
    disabled = false,
    placeholder = 'Tìm tên, mã sản phẩm, mã NCC hoặc từ khóa liên quan',
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
                        {loading ? <div className="px-3 py-4 text-[12px] text-primary/55">Đang tìm sản phẩm...</div> : null}
                        {!loading && results.length === 0 ? <div className="px-3 py-4 text-[12px] text-primary/55">Không tìm thấy sản phẩm phù hợp.</div> : null}
                        {!loading && results.map((row, index) => (
                            <button
                                key={`quick_import_${row.id}`}
                                type="button"
                                onClick={() => selectRow(row, index)}
                                className={`flex w-full items-center justify-between border-b border-primary/10 px-3 py-2 text-left transition last:border-b-0 ${activeIndex === index ? 'bg-primary/[0.07]' : 'hover:bg-primary/[0.04]'}`}
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-semibold text-primary">{row.name}</div>
                                    <div className="truncate text-[11px] text-primary/50">{buildInventorySearchMeta(row) || 'Chưa có thông tin mã sản phẩm'}</div>
                                </div>
                                <span className="ml-3 shrink-0 text-[11px] font-bold text-primary/70">Thêm</span>
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
            <button type="button" onClick={() => commitValue(Math.max(min, currentValue - 1))} className="flex h-full w-7 items-center justify-center text-primary/65 transition hover:bg-primary/5 hover:text-primary" title="Giảm số lượng">
                <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
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
    settingsOpen,
    onCloseSettings,
    onToggleSettings,
    expanded = false,
    onToggleExpanded,
    onOpenPrint,
    onUpdateLine,
    onRemoveLine,
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
        ...importItemColumns.filter((column) => column.id !== 'stt'),
    ]), []);

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
    } = useTableColumns('inventory_import_modal_table_v3', tableColumns);

    const renderCell = (row, columnId, rowIndex) => {
        if (columnId === 'stt') {
            return <div className="flex h-8 items-center justify-center text-[12px] font-bold text-primary/75">{rowIndex + 1}</div>;
        }

        if (columnId === 'product_name') {
            const secondaryText = [row.product_sku, row.supplier_product_code].filter(Boolean).join(' • ');
            return (
                <div className="space-y-1">
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
            );
        }

        if (columnId === 'product_sku') {
            return <input value={row.product_sku} onChange={(event) => onUpdateLine(row._row_index, 'product_sku', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Mã SP" />;
        }

        if (columnId === 'supplier_product_code') {
            return <input value={row.supplier_product_code} onChange={(event) => onUpdateLine(row._row_index, 'supplier_product_code', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Mã NCC" />;
        }

        if (columnId === 'quantity') {
            return <QuantityStepperInput value={row.quantity} onChange={(value) => onUpdateLine(row._row_index, 'quantity', value)} min={1} />;
        }

        if (columnId === 'received_quantity') {
            return <QuantityStepperInput value={row.received_quantity} onChange={(value) => onUpdateLine(row._row_index, 'received_quantity', value)} min={0} />;
        }

        if (columnId === 'outstanding_quantity') {
            const outstandingQuantity = Math.max(parseLineQuantity(row.quantity, 0) - parseLineQuantity(row.received_quantity, 0), 0);
            return <div className="flex h-8 items-center justify-center text-[12px] font-black text-primary">{formatNumber(outstandingQuantity)}</div>;
        }

        if (columnId === 'unit_name') {
            const normalizedCurrentValue = String(row.unit_name || '').trim();
            const hasCurrentValue = normalizedCurrentValue !== '' && !(inventoryUnits || []).some((unit) => normalizeSearchText(unit.name) === normalizeSearchText(normalizedCurrentValue));

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
            return <input value={row.notes} onChange={(event) => onUpdateLine(row._row_index, 'notes', event.target.value)} className={`w-full ${importFieldClass}`} placeholder="Ghi chú" />;
        }

        if (columnId === 'unit_cost') {
            return <input value={formatWholeNumberInput(row.unit_cost)} onChange={(event) => onUpdateLine(row._row_index, 'unit_cost', stripNumericValue(event.target.value))} className={`w-full text-right ${importFieldClass}`} placeholder="0" />;
        }

        if (columnId === 'line_total') {
            return <div className="text-right text-[12px] font-black text-primary">{formatCurrency(Number(row.quantity || 0) * Number(row.unit_cost || 0))}</div>;
        }

        if (columnId === 'actions') {
            return <button type="button" onClick={() => onRemoveLine(row._row_index)} className={dangerButton}>Xóa</button>;
        }

        return null;
    };

    return (
        <div className="overflow-hidden rounded-sm border border-primary/10">
            <div className="flex items-center justify-between border-b border-primary/10 bg-[#f8fafc] px-3 py-2">
                <div className="text-[11px] font-bold text-primary/70">Dòng chưa về đủ được ưu tiên lên đầu để theo dõi.</div>
                <div className="flex items-center gap-2">
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
                    <button
                        type="button"
                        onClick={onToggleExpanded}
                        className={iconButton(expanded)}
                        title={expanded ? 'Thu nhỏ bảng sản phẩm' : 'Phóng to bảng sản phẩm'}
                    >
                        <span className="material-symbols-outlined text-[18px]">{expanded ? 'close_fullscreen' : 'open_in_full'}</span>
                    </button>
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
                    storageKey="inventory_import_modal_table_v3"
                />
            ) : null}

            <div className={expanded ? 'max-h-[68vh] overflow-auto' : 'max-h-[35vh] overflow-auto'}>
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
                        {sortedRows.length === 0 ? (
                            <tr>
                                <td colSpan={renderedColumns.length} className="px-4 py-6 text-center text-[13px] text-primary/55">Chưa có dòng sản phẩm.</td>
                            </tr>
                        ) : null}
                        {sortedRows.map((row, rowIndex) => (
                            <tr key={row.key} className={row._is_incomplete ? 'bg-amber-50/70' : ''}>
                                {renderedColumns.map((column) => (
                                    <td key={`${row.key}_${column.id}`} className={`overflow-hidden border-b border-r border-primary/10 px-2.5 py-1.5 align-middle text-[12px] text-primary ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}>
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
}) => {
    const tableColumns = useMemo(() => {
        const baseColumns = columns.filter((column) => column.id !== 'stt');
        return [
            { id: 'stt', label: 'STT', minWidth: 72, align: 'center', draggable: false, sortable: false },
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

    return (
        <div className={panelClass}>
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
            <div className={tableViewportClass}>
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
                                    title={canSortColumn(column) ? 'Double click to sort' : undefined}
                                    className={`relative border-b border-r border-primary/10 px-3 py-3 text-center text-[12px] font-bold text-primary ${canSortColumn(column) ? 'cursor-pointer select-none' : ''}`}
                                    style={{ width: columnWidths[column.id] || column.minWidth }}
                                >
                                    <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : 'justify-center'}`}>
                                        <span className="block min-w-0 truncate">{column.headerRender ? column.headerRender() : column.label}</span>
                                        {canSortColumn(column) ? <SortIndicator colId={column.id} sortConfig={sortConfig} showNeutral /> : null}
                                    </div>
                                    <div onMouseDown={(event) => handleColumnResize(column.id, event)} className="absolute right-0 top-0 h-full w-2 cursor-col-resize transition hover:bg-brick/20" title="Kéo để đổi độ rộng cột" />
                                </th>
                            ))}
                        </tr>
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
                                        onRowDoubleClick(row);
                                    }}
                                    className={rowClassName ? rowClassName(row) : 'hover:bg-primary/[0.02]'}
                                >
                                    {renderedColumns.map((column) => (
                                        <td key={`${key}_${column.id}`} className={`overflow-hidden border-b border-r border-primary/10 px-3 py-2.5 text-[13px] text-primary ${column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'}`}>
                                            <div className="min-w-0 overflow-hidden text-ellipsis">{column.id === 'stt' ? pageOffset + rowIndex + 1 : renderCell(row, column.id, rowIndex)}</div>
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
    const { showToast } = useUI();
    const restoredSupplierContextRef = useRef(false);
    const skipSupplierSearchResetRef = useRef(false);

    const [activeTab, setActiveTab] = useState('products');
    const [dashboard, setDashboard] = useState(null);
    const [categories, setCategories] = useState([]);
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
        overview: false, products: false, suppliers: false, supplierCatalog: false, imports: false, exports: false,
        returns: false, damaged: false, adjustments: false, lots: false, trash: false, saving: false,
        supplierModal: false, supplierPriceModal: false, importModal: false, documentModal: false,
        importStatuses: false, importStatusModal: false, invoiceAnalysis: false, importPriceRefresh: false,
    });

    const [openPanels, setOpenPanels] = useState({
        overview: { stats: true },
        products: { filters: false, stats: false, columns: false },
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

    const [productFilters, setProductFilters] = useState({ search: '', status: '', cost_source: '', type: '', category_id: '', variant_scope: '', date_from: '', date_to: '' });
    const [supplierFilters, setSupplierFilters] = useState({ search: '', status: '', month: '', date_from: '', date_to: '' });
    const [supplierCatalogFilters, setSupplierCatalogFilters] = useState({ sku: '', name: '', category_id: '', type: '', variant_scope: '', missing_supplier_price: '', multiple_suppliers: '' });
    const [supplierQuickSearch, setSupplierQuickSearch] = useState('');
    const [simpleFilters, setSimpleFilters] = useState({
        imports: { search: '', date_from: '', date_to: '', inventory_import_status_id: '', entry_mode: '' },
        exports: { search: '', date_from: '', date_to: '' },
        returns: { search: '', date_from: '', date_to: '' },
        damaged: { search: '', date_from: '', date_to: '' },
        adjustments: { search: '', date_from: '', date_to: '' },
        lots: { search: '', date_from: '', date_to: '' },
        trash: { search: '', date_from: '', date_to: '' },
    });

    const [expandedGroups, setExpandedGroups] = useState({});
    const [expandedComparisons, setExpandedComparisons] = useState({});
    const [selectedPriceIds, setSelectedPriceIds] = useState({});
    const [priceDrafts, setPriceDrafts] = useState({});
    const [codeDrafts, setCodeDrafts] = useState({});
    const [savingPriceIds, setSavingPriceIds] = useState({});
    const [supplierDetailOpen, setSupplierDetailOpen] = useState({});
    const [groupPriceDrafts, setGroupPriceDrafts] = useState({});
    const [bulkPrice, setBulkPrice] = useState('');
    const [bulkNote, setBulkNote] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [showPasteBox, setShowPasteBox] = useState(false);
    const [createMenuOpen, setCreateMenuOpen] = useState(false);
    const [supplierModal, setSupplierModal] = useState({ open: false, form: createSupplierForm() });
    const [supplierPriceModal, setSupplierPriceModal] = useState({ open: false, form: createSupplierPriceForm() });
    const [importModal, setImportModal] = useState({ open: false, form: createImportForm() });
    const [importCompleteToggleSnapshot, setImportCompleteToggleSnapshot] = useState(null);
    const [importTableSettingsOpen, setImportTableSettingsOpen] = useState(false);
    const [importTableExpanded, setImportTableExpanded] = useState(false);
    const [importPrintModalOpen, setImportPrintModalOpen] = useState(false);
    const [importPrintTemplates, setImportPrintTemplates] = useState(() => ensureDefaultImportPrintTemplates([]));
    const [importPrintTemplateId, setImportPrintTemplateId] = useState(IMPORT_PRINT_DEFAULT_TEMPLATE_ID);
    const [importPrintTemplateName, setImportPrintTemplateName] = useState(IMPORT_PRINT_DEFAULT_TEMPLATE_NAME);
    const [importPrintColumnIds, setImportPrintColumnIds] = useState(() => [...IMPORT_PRINT_DEFAULT_COLUMN_IDS]);
    const [importPrintPreviewPrintedAt, setImportPrintPreviewPrintedAt] = useState(() => new Date().toISOString());
    const [importPrintSettingsLoaded, setImportPrintSettingsLoaded] = useState(false);
    const [importPrintSettingsLoading, setImportPrintSettingsLoading] = useState(false);
    const [importPrintSettingsSaving, setImportPrintSettingsSaving] = useState(false);
    const [importStatusModal, setImportStatusModal] = useState({ open: false, form: createImportStatusForm() });
    const [documentModal, setDocumentModal] = useState({ open: false, tabKey: 'returns', form: createDocumentForm('returns') });
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

    const setFlag = (key, value) => setLoading((prev) => ({ ...prev, [key]: value }));
    const fail = (error, fallback) => {
        const message = error?.response?.data?.errors ? Object.values(error.response.data.errors).flat().join('\n') : (error?.response?.data?.message || fallback);
        showToast({ type: 'error', message });
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
        target: '/admin/inventory',
        activeTab: 'supplierPrices',
        selectedSupplierId,
        supplierQuickSearch,
        supplierCatalogFilters,
        supplierCatalogPage: supplierCatalogPagination.current_page || 1,
        supplierCatalogPerPage: pageSizes.supplierPrices,
        supplierSortConfig: sortConfigs.supplierPrices,
        supplierPanels: openPanels.supplierPrices,
    });

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

    const openImportPrintModal = async () => {
        setImportPrintModalOpen(true);
        setImportPrintPreviewPrintedAt(new Date().toISOString());

        if (!importPrintSettingsLoaded) {
            await loadImportPrintTemplates({ silent: false });
            return;
        }

        applyImportPrintTemplate(importPrintTemplateId, importPrintTemplates);
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

        if (!selectedColumns.length) {
            showToast({ type: 'warning', message: 'Vui lòng chọn ít nhất một cột để in.' });
            return;
        }

        const printedAt = new Date().toISOString();
        const printHtml = buildImportPrintHtml({
            supplierName: importPrintSupplierName,
            printedAt,
            columns: selectedColumns,
            items: importPrintableItems,
            subtotal: importSubtotal,
            surcharge: importSurchargeAmount,
            total: importLineTotal,
            notes: importModal.form.notes || '',
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
        setOpenPanels((prev) => ({ ...prev, [section]: { ...prev[section], [panel]: !prev[section]?.[panel] } }));
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
        const quantityText = String(item.quantity ?? '').replace(/[^0-9]/g, '');
        const quantity = quantityText ? Number(quantityText) : 0;
        const receivedText = String(item.received_quantity ?? '').replace(/[^0-9]/g, '');
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

    const synchronizeImportFormCompletion = (form) => {
        const nextItems = normalizeImportItems(form.items || []);
        const baseStatusId = form.inventory_import_status_id ? String(form.inventory_import_status_id) : '';
        const shouldAutoResolveStatus = !form.status_is_manual;
        const nextStatusId = shouldAutoResolveStatus
            ? resolveSystemImportStatusByItems(nextItems, baseStatusId)
            : baseStatusId;

        return {
            ...form,
            inventory_import_status_id: nextStatusId,
            items: nextItems,
        };
    };

    const closeImportModal = () => {
        setImportTableSettingsOpen(false);
        setImportTableExpanded(false);
        setImportPrintModalOpen(false);
        setImportCompleteToggleSnapshot(null);
        setImportModal({
            open: false,
            form: createImportForm({
                inventory_import_status_id: getDefaultImportStatus()?.id || null,
                update_supplier_prices: true,
            }),
        });
    };

    const handleImportStatusChange = (statusId) => {
        setImportModal((prev) => {
            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                inventory_import_status_id: statusId,
                status_is_manual: true,
            });
            return { ...prev, form: syncedForm };
        });
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
                        if (nextCost == null) return item;

                        return {
                            ...item,
                            unit_cost: String(Math.round(Number(nextCost || 0))),
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
                    unit_cost: String(Math.round(Number(product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost ?? 0))),
                    mapping_status: 'matched',
                    mapping_label: item.mapping_status === 'unmatched' ? 'Đã map thủ công' : 'Đã chọn sản phẩm',
                } : item),
            },
        }));
    };

    const attachImportProductToLine = (index, product) => {
        setImportModal((prev) => {
            const nextItems = prev.form.items.map((item, itemIndex) => (
                itemIndex === index
                    ? {
                        ...item,
                        product_id: product.id,
                        product_name: product.name,
                        product_sku: product.sku,
                        supplier_product_code: product.supplier_product_code || item.supplier_product_code || '',
                        unit_name: product.unit_name || product.unit?.name || item.unit_name || '',
                        unit_cost: String(Math.round(Number(product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost ?? 0))),
                        received_quantity: item.received_quantity || '0',
                        mapping_status: 'matched',
                        mapping_label: item.mapping_status === 'unmatched' ? 'Đã map thủ công' : '',
                    }
                    : item
            ));

            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                items: nextItems,
            });

            return {
                ...prev,
                form: syncedForm,
            };
        });
    };

    const appendImportProductFromQuickSearch = (product) => {
        setImportModal((prev) => {
            let targetIndex = prev.form.items.findIndex((item) => !item.product_id);
            let nextItems = [...prev.form.items];

            if (targetIndex < 0) {
                targetIndex = nextItems.length;
                nextItems.push(createLine({
                    update_supplier_price: Boolean(prev.form.update_supplier_prices),
                }));
            }

            nextItems = nextItems.map((item, itemIndex) => (
                itemIndex === targetIndex
                    ? {
                        ...item,
                        product_id: product.id,
                        product_name: product.name,
                        product_sku: product.sku,
                        supplier_product_code: product.supplier_product_code || item.supplier_product_code || '',
                        unit_name: product.unit_name || product.unit?.name || item.unit_name || '',
                        unit_cost: String(Math.round(Number(product.supplier_unit_cost ?? product.current_cost ?? product.expected_cost ?? 0))),
                        received_quantity: item.received_quantity || '0',
                        mapping_status: 'matched',
                        mapping_label: item.mapping_status === 'unmatched' ? 'Đã map thủ công' : '',
                    }
                    : item
            ));

            const syncedForm = synchronizeImportFormCompletion({
                ...prev.form,
                items: nextItems,
            });

            return { ...prev, form: syncedForm };
        });
    };

    const fetchOverview = async () => {
        setFlag('overview', true);
        try {
            const response = await inventoryApi.getDashboard();
            setDashboard(response.data);
        } catch (error) {
            fail(error, 'Không thể tải tổng quan kho.');
            return false;
            return false;
        } finally {
            setFlag('overview', false);
        }
    };

    const fetchInventoryUnits = async () => {
        try {
            const response = await inventoryApi.getUnits();
            setInventoryUnits(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            fail(error, 'Không thể tải danh sách đơn vị tính.');
        }
    };

    const fetchProducts = async (page = 1, perPage = pageSizes.products, sortOverride = null) => {
        setFlag('products', true);
        try {
            const response = await inventoryApi.getProducts({ ...productFilters, page, per_page: perPage, ...buildSortParams('products', sortOverride) });
            setProducts(response.data.data || []);
            setProductSummary(response.data.summary || null);
            pageState(setProductPagination, response);
        } catch (error) {
            fail(error, 'Không thể tải sản phẩm kho.');
        } finally {
            setFlag('products', false);
        }
    };

    const fetchSuppliers = async (page = 1, perPage = pageSizes.suppliers, sortOverride = null) => {
        setFlag('suppliers', true);
        try {
            const response = await inventoryApi.getSuppliers({ ...supplierFilters, page, per_page: perPage, ...buildSortParams('suppliers', sortOverride) });
            const rows = response.data.data || [];
            setSuppliers(rows);
            setSupplierSummary(response.data.summary || null);
            pageState(setSupplierPagination, response);
            setSelectedSupplierId((prev) => rows.some((item) => item.id === prev) ? prev : (rows[0]?.id || null));
        } catch (error) {
            fail(error, 'Không thể tải nhà cung cấp.');
        } finally {
            setFlag('suppliers', false);
        }
    };

    const fetchSupplierCatalog = async (page = 1, perPage = pageSizes.supplierPrices, sortOverride = null) => {
        if (!selectedSupplierId) return;
        setFlag('supplierCatalog', true);
        try {
            const response = await inventoryApi.getSupplierPrices(selectedSupplierId, {
                ...supplierCatalogFilters,
                search: supplierQuickSearch.trim(),
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
            setImportStatuses(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            fail(error, 'Không thể tải trạng thái phiếu nhập.');
        } finally {
            setFlag('importStatuses', false);
        }
    };

    const refreshSupplierCatalog = async () => {
        if (!selectedSupplierId) return;
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

    const fetchImports = (page = 1, perPage = pageSizes.imports, sortOverride = null) => fetchSimple('imports', (currentPage, currentPerPage) => inventoryApi.getImports({ ...simpleFilters.imports, page: currentPage, per_page: currentPerPage, ...buildSortParams('imports', sortOverride) }), setImports, setImportPagination, page, perPage);
    const fetchExports = (page = 1, perPage = pageSizes.exports, sortOverride = null) => fetchSimple('exports', (currentPage, currentPerPage) => inventoryApi.getExports({ ...simpleFilters.exports, page: currentPage, per_page: currentPerPage, ...buildSortParams('exports', sortOverride) }), setExportsData, setExportPagination, page, perPage);
    const fetchDocuments = (type, page = 1, perPage = pageSizes[{ return: 'returns', damaged: 'damaged', adjustment: 'adjustments' }[type]], sortOverride = null) => {
        const map = { return: ['returns', setReturnsData, setReturnPagination], damaged: ['damaged', setDamagedData, setDamagedPagination], adjustment: ['adjustments', setAdjustments, setAdjustmentPagination] };
        const [key, setter, paginationSetter] = map[type];
        return fetchSimple(key, (currentPage, currentPerPage) => inventoryApi.getDocuments(type, { ...simpleFilters[key], page: currentPage, per_page: currentPerPage, ...buildSortParams(key, sortOverride) }), setter, paginationSetter, page, perPage);
    };
    const fetchLots = (page = 1, perPage = pageSizes.lots, sortOverride = null) => fetchSimple('lots', (currentPage, currentPerPage) => inventoryApi.getBatches({ ...simpleFilters.lots, page: currentPage, per_page: currentPerPage, remaining_only: 1, ...buildSortParams('lots', sortOverride) }), setLots, setLotPagination, page, perPage);
    const fetchTrash = (page = 1, perPage = pageSizes.trash, sortOverride = null) => fetchSimple('trash', (currentPage, currentPerPage) => inventoryApi.getProducts({ ...simpleFilters.trash, page: currentPage, per_page: currentPerPage, trash: 1, ...buildSortParams('trash', sortOverride) }), setTrashItems, setTrashPagination, page, perPage);
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

    useEffect(() => {
        const loadCategories = async () => {
            try {
                const response = await categoryApi.getAll();
                setCategories(Array.isArray(response.data) ? response.data : (response.data?.data || []));
            } catch (error) {
                fail(error, 'Không thể tải danh mục.');
            }
        };

        loadCategories();
        fetchOverview();
        fetchInventoryUnits();
        fetchImportStatuses();
    }, []);

    useEffect(() => {
        const returnContext = location.state?.returnContext;
        if (!returnContext || restoredSupplierContextRef.current || returnContext.source !== 'inventorySupplierPrices') {
            return;
        }

        restoredSupplierContextRef.current = true;
        skipSupplierSearchResetRef.current = true;
        setActiveTab(returnContext.activeTab || 'supplierPrices');
        if (returnContext.selectedSupplierId) {
            setSelectedSupplierId(Number(returnContext.selectedSupplierId));
        }
        setSupplierQuickSearch(returnContext.supplierQuickSearch || '');
        setSupplierCatalogFilters((prev) => ({
            ...prev,
            ...(returnContext.supplierCatalogFilters || {}),
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

    useEffect(() => {
        if (activeTab !== 'supplierPrices') return;
        if (selectedSupplierId) {
            fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
        } else {
            setSupplierCatalog([]);
            setSupplierCatalogPagination(emptyPagination);
        }
    }, [activeTab, selectedSupplierId]);

    useEffect(() => {
        if (!importModal.open) return;
        if (importModal.form.inventory_import_status_id || importStatuses.length === 0) return;
        const defaultStatus = getDefaultImportStatus();
        if (!defaultStatus) return;
        setImportModal((prev) => ({
            ...prev,
            form: synchronizeImportFormCompletion({
                ...prev.form,
                inventory_import_status_id: String(defaultStatus.id),
            }),
        }));
    }, [importModal.open, importModal.form.inventory_import_status_id, importStatuses]);

    useEffect(() => {
        if (!importModal.open) {
            setImportPrintModalOpen(false);
            return;
        }

        if (!importPrintSettingsLoaded && !importPrintSettingsLoading) {
            loadImportPrintTemplates({ silent: true });
        }
    }, [importModal.open, importPrintSettingsLoaded, importPrintSettingsLoading]);

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
    }, [selectedSupplierId]);

    useEffect(() => {
        if (activeTab !== 'suppliers') return undefined;
        const timer = setTimeout(() => {
            fetchSuppliers(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, supplierFilters.search]);

    useEffect(() => {
        if (activeTab !== 'supplierPrices' || !selectedSupplierId) return undefined;
        if (skipSupplierSearchResetRef.current) {
            skipSupplierSearchResetRef.current = false;
            return undefined;
        }
        const timer = setTimeout(() => {
            fetchSupplierCatalog(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [activeTab, selectedSupplierId, supplierQuickSearch, supplierCatalogFilters.sku, supplierCatalogFilters.name]);

    const ensureSuppliersLoaded = async () => {
        if (suppliers.length > 0) {
            if (!selectedSupplierId && suppliers[0]?.id) setSelectedSupplierId(suppliers[0].id);
            return;
        }
        await fetchSuppliers(1);
    };

    const currentSupplier = useMemo(
        () => suppliers.find((item) => item.id === selectedSupplierId) || null,
        [selectedSupplierId, suppliers]
    );

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
    const toggleComparisonRow = (productId) => {
        setExpandedComparisons((prev) => ({ ...prev, [productId]: !prev[productId] }));
    };
    const getComparableSupplierCount = (row) => {
        const comparisonSupplierIds = Array.from(new Set((row.supplier_price_comparisons || []).map((item) => Number(item.supplier_id)).filter(Boolean)));
        return Math.max(Number(row.supplier_count || 0), comparisonSupplierIds.length);
    };
    const upsertSupplierComparison = (row, unitCost, updatedAt) => {
        const supplier = suppliers.find((item) => item.id === selectedSupplierId);
        const existingComparisons = row.supplier_price_comparisons || [];
        const nextComparisons = sortSupplierComparisons([
            ...existingComparisons.filter((item) => Number(item.supplier_id) !== Number(selectedSupplierId)),
            supplier ? {
                supplier_id: supplier.id,
                supplier_name: supplier.name,
                supplier_code: supplier.code || null,
                unit_cost,
                updated_at: updatedAt,
            } : null,
        ].filter(Boolean));

        return {
            supplier_price_comparisons: nextComparisons,
            supplier_count: Math.max(Number(row.supplier_count || 0), nextComparisons.length, row.supplier_ids?.length || 0),
            has_multiple_suppliers: Math.max(Number(row.supplier_count || 0), nextComparisons.length, row.supplier_ids?.length || 0) > 1,
        };
    };
    const openSupplierCatalogProductEditor = (row) => {
        if (!row || row.row_kind === 'comparison') return;
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
        if (!selectedSupplierId || !ids.length || !cleaned) return false;
        try {
            const numericValue = Number(cleaned);
            await inventoryApi.bulkSupplierPrices(selectedSupplierId, {
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
        const cleaned = stripNumericValue(bulkPrice);
        if (!selectedSupplierId || !selectedIds.length || !cleaned) return showToast({ type: 'warning', message: 'Hãy chọn dòng và nhập giá.' });
        const success = await applyPriceToIds(selectedIds, cleaned);
        if (success) {
            showToast({ type: 'success', message: 'Đã áp giá cho các dòng đã chọn.' });
        }
    };

    const applyGroupPrice = async (groupId) => {
        const cleaned = stripNumericValue(groupPriceDrafts[groupId] ?? bulkPrice);
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
        const nextDrafts = {};
        const nextSelected = {};
        pasteText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
            const parts = line.split(/\t|,|;/).map((item) => item.trim()).filter(Boolean);
            if (parts.length < 2) return;
            const matched = skuMap.get(parts[0].toUpperCase());
            if (!matched) return;
            const cleaned = stripNumericValue(parts[1]);
            if (!cleaned) return;
            nextDrafts[matched.id] = cleaned;
            nextSelected[matched.id] = true;
        });
        setPriceDrafts((prev) => ({ ...prev, ...nextDrafts }));
        setSelectedPriceIds((prev) => ({ ...prev, ...nextSelected }));
    };

    const saveSupplierPriceRow = async (row, overrides = {}) => {
        const rawValue = overrides.unit_cost ?? priceDrafts[row.id] ?? row.unit_cost ?? '';
        const cleaned = stripNumericValue(rawValue);
        const numericValue = cleaned === '' ? 0 : Number(cleaned);
        const supplierProductCode = String(overrides.supplier_product_code ?? codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim();
        const currentSupplierCode = String(row.supplier_product_code || '').trim();
        if (!selectedSupplierId || row.row_kind === 'group') return false;
        if (Number(row.unit_cost || 0) === numericValue && currentSupplierCode === supplierProductCode) return false;

        setSavingPriceIds((prev) => ({ ...prev, [row.id]: true }));
        try {
            const response = await inventoryApi.createSupplierPrice(selectedSupplierId, {
                product_id: row.product_id,
                supplier_product_code: supplierProductCode || null,
                unit_cost: numericValue,
                notes: row.notes || null,
            });

            const updatedAt = response.data?.updated_at || new Date().toISOString();
            const comparisonUpdates = upsertSupplierComparison(row, numericValue, updatedAt);

            patchSupplierCatalogRow(row.id, {
                supplier_product_code: supplierProductCode,
                unit_cost: numericValue,
                updated_at: updatedAt,
                notes: response.data?.notes ?? row.notes,
                supplier_price_id: response.data?.id ?? row.supplier_price_id ?? null,
                updater_name: response.data?.updater?.name ?? row.updater_name ?? null,
                ...comparisonUpdates,
            });
            setPriceDrafts((prev) => ({ ...prev, [row.id]: cleaned }));
            setCodeDrafts((prev) => ({ ...prev, [row.id]: supplierProductCode }));
            return true;
        } catch (error) {
            fail(error, 'Không thể lưu giá dự kiến.');
        } finally {
            setSavingPriceIds((prev) => ({ ...prev, [row.id]: false }));
        }
    };

    const saveSingleSupplierPrice = async (row, explicitValue = null) => {
        const rawValue = explicitValue ?? priceDrafts[row.id] ?? row.unit_cost ?? '';
        const cleaned = stripNumericValue(rawValue);
        if (!selectedSupplierId || row.row_kind === 'group' || cleaned === '') return;

        await saveSupplierPriceRow(row, { unit_cost: cleaned });
    };

    const saveSingleSupplierCode = async (row, explicitValue = null) => {
        const normalizedCode = String(explicitValue ?? codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim();
        const currentCode = String(row.supplier_product_code || '').trim();
        if (!selectedSupplierId || row.row_kind === 'group' || normalizedCode === currentCode) return;

        await saveSupplierPriceRow(row, {
            supplier_product_code: normalizedCode,
            unit_cost: priceDrafts[row.id] ?? row.unit_cost ?? 0,
        });
    };

    const saveSupplierPrices = async () => {
        if (!selectedSupplierId || !selectedIds.length) return showToast({ type: 'warning', message: 'Hãy chọn ít nhất một dòng giá.' });
        setFlag('saving', true);
        try {
            await inventoryApi.bulkSupplierPrices(selectedSupplierId, {
                items: supplierCatalogItemRows.filter((row) => selectedIds.includes(row.id)).map((row) => ({
                    product_id: row.product_id,
                    supplier_product_code: String(codeDrafts[row.id] ?? row.supplier_product_code ?? '').trim() || null,
                    unit_cost: parseWholeNumberInput(priceDrafts[row.id] ?? row.unit_cost ?? 0) ?? 0,
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
            fetchOverview();
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
            fetchOverview();
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
            fetchOverview();
        } catch (error) {
            fail(error, 'Không thể xóa vĩnh viễn sản phẩm.');
        }
    };

    const openCreateSupplier = async () => {
        await ensureSuppliersLoaded();
        setSupplierModal({ open: true, form: createSupplierForm() });
    };
    const openEditSupplier = (supplier) => setSupplierModal({ open: true, form: createSupplierForm(supplier) });

    const saveSupplier = async () => {
        const form = supplierModal.form;
        if (!form.name.trim()) return showToast({ type: 'warning', message: 'Vui lòng nhập tên nhà cung cấp.' });
        setFlag('supplierModal', true);
        try {
            const payload = { code: form.code || null, name: form.name.trim(), phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null, status: form.status ? 1 : 0 };
            let savedSupplierId = form.id;
            if (form.id) {
                const response = await inventoryApi.updateSupplier(form.id, payload);
                savedSupplierId = response.data?.id || form.id;
                showToast({ type: 'success', message: 'Đã cập nhật nhà cung cấp.' });
            } else {
                const response = await inventoryApi.createSupplier(payload);
                savedSupplierId = response.data?.id || null;
                showToast({ type: 'success', message: 'Đã tạo nhà cung cấp.' });
            }
            setSupplierModal({ open: false, form: createSupplierForm() });
            if (savedSupplierId) {
                setSelectedSupplierId(savedSupplierId);
                setSupplierDetailOpen((prev) => ({ ...prev, [savedSupplierId]: true }));
            }
            fetchSuppliers(supplierPagination.current_page || 1);
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
        } catch (error) {
            fail(error, 'Không thể xóa nhà cung cấp.');
        }
    };

    const openCreateSupplierPrice = () => {
        if (!selectedSupplierId) return showToast({ type: 'warning', message: 'Hãy chọn nhà cung cấp trước.' });
        setSupplierPriceModal({ open: true, form: createSupplierPriceForm() });
    };

    const saveSupplierPriceEntry = async () => {
        if (!selectedSupplierId) return showToast({ type: 'warning', message: 'Hãy chọn nhà cung cấp trước.' });
        const form = supplierPriceModal.form;
        if (!form.product_id) return showToast({ type: 'warning', message: 'Vui lòng chọn sản phẩm.' });
        if (!String(form.unit_cost || '').trim()) return showToast({ type: 'warning', message: 'Vui lòng nhập giá nhập.' });

        setFlag('supplierPriceModal', true);
        try {
            await inventoryApi.createSupplierPrice(selectedSupplierId, {
                product_id: Number(form.product_id),
                supplier_product_code: String(form.supplier_product_code || '').trim() || null,
                unit_cost: parseWholeNumberInput(form.unit_cost) ?? 0,
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
        if (!selectedSupplierId) return;
        if (!row.supplier_price_id) return showToast({ type: 'warning', message: 'Dòng này chưa có giá nhập để xóa.' });
        if (!window.confirm(`Xóa giá nhập của "${row.name}"?`)) return;
        try {
            await inventoryApi.deleteSupplierPrice(selectedSupplierId, row.supplier_price_id);
            showToast({ type: 'success', message: 'Đã xóa dòng giá nhập.' });
            await fetchSupplierCatalog(supplierCatalogPagination.current_page || 1, pageSizes.supplierPrices);
        } catch (error) {
            fail(error, 'Không thể xóa dòng giá nhập.');
        }
    };

    const openSupplierPriceTab = (supplierId = selectedSupplierId) => {
        if (supplierId) setSelectedSupplierId(supplierId);
        setActiveTab('supplierPrices');
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
                    local_attachment_files: [...(prev.form.local_attachment_files || []), ...nextFiles],
                },
            };
        });
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

    const analyzeInvoiceFile = async (file) => {
        if (!file) return;

        setFlag('invoiceAnalysis', true);
        setImportCompleteToggleSnapshot(null);
        try {
            const submitData = new FormData();
            if (importModal.form.supplier_id) {
                submitData.append('supplier_id', String(Number(importModal.form.supplier_id)));
            }
            submitData.append('invoice_file', file);

            const response = await inventoryApi.analyzeImportInvoice(submitData);
            const draft = response.data?.draft || {};
            const log = response.data?.log || null;
            const defaultStatus = getDefaultImportStatus();
            const subtotalAmount = Number(draft.subtotal_amount || 0);
            const totalAmount = Number(draft.total_amount || subtotalAmount);
            const extraChargeAmount = Math.round(totalAmount - subtotalAmount);

            setImportModal((prev) => {
                const nextForm = {
                    ...prev.form,
                    supplier_id: prev.form.supplier_id || (draft.supplier_id ? String(draft.supplier_id) : ''),
                    inventory_import_status_id: prev.form.inventory_import_status_id || (defaultStatus ? String(defaultStatus.id) : ''),
                    status_is_manual: false,
                    import_date: draft.import_date || prev.form.import_date || todayValue,
                    notes: prev.form.notes || draft.notes || '',
                    entry_mode: 'invoice_ai',
                    extra_charge_mode: 'amount',
                    extra_charge_value: String(extraChargeAmount),
                    extra_charge_amount_input: extraChargeAmount === 0 ? '' : formatSignedAmountInput(`${extraChargeAmount >= 0 ? '+' : '-'}${Math.abs(extraChargeAmount)}`),
                    extra_charge_percent_input: '',
                    invoice_analysis_log_id: log?.id ? String(log.id) : prev.form.invoice_analysis_log_id,
                    invoice_number: draft.invoice_number || prev.form.invoice_number || '',
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
                    items: (draft.items || []).length
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
                        : prev.form.items,
                };

                return {
                    ...prev,
                    open: true,
                    form: synchronizeImportFormCompletion(nextForm),
                };
            });

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
        await ensureSuppliersLoaded();
        await fetchInventoryUnits();
        if (!importStatuses.length) {
            await fetchImportStatuses();
        }
        const defaultStatus = getDefaultImportStatus();
        setActiveTab('imports');
        setImportTableSettingsOpen(false);
        setImportPrintModalOpen(false);
        setImportCompleteToggleSnapshot(null);
        setImportModal({
            open: true,
            form: synchronizeImportFormCompletion(createImportForm({
                inventory_import_status_id: defaultStatus?.id || null,
                update_supplier_prices: true,
            })),
        });
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
            setImportTableSettingsOpen(false);
            setImportPrintModalOpen(false);
            setImportCompleteToggleSnapshot(null);
            setImportModal({ open: true, form: synchronizeImportFormCompletion(createImportForm(response.data)) });
        } catch (error) {
            fail(error, 'Không thể tải phiếu nhập để sửa.');
        } finally {
            setFlag('importModal', false);
        }
    };

    const saveImport = async () => {
        const form = synchronizeImportFormCompletion(importModal.form);
        if (!form.inventory_import_status_id) return showToast({ type: 'warning', message: 'Vui lòng chọn trạng thái phiếu nhập.' });

        const pendingMappedLines = form.items.filter((item) => !item.product_id && (item.product_name || item.product_sku || item.supplier_product_code || item.unit_cost || item.notes));
        if (pendingMappedLines.length) {
            return showToast({ type: 'warning', message: 'Còn dòng chưa map sản phẩm. Hãy chọn tay trước khi lưu phiếu nhập.' });
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
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
            fetchSuppliers(supplierPagination.current_page || 1);
            if (selectedSupplierId) fetchSupplierCatalog(supplierCatalogPagination.current_page || 1);
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
            showToast({ type: 'success', message: 'Đã xóa phiếu nhập.' });
            fetchImports(importPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu nhập.');
        }
    };

    const openCreateDocument = async (tabKey) => {
        await ensureSuppliersLoaded();
        setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey) });
    };

    const openEditDocument = async (tabKey, row) => {
        await ensureSuppliersLoaded();
        setFlag('documentModal', true);
        try {
            const response = await inventoryApi.getDocument(documentTypeMap[tabKey], row.id);
            setDocumentModal({ open: true, tabKey, form: createDocumentForm(tabKey, response.data) });
        } catch (error) {
            fail(error, 'Không thể tải phiếu để sửa.');
        } finally {
            setFlag('documentModal', false);
        }
    };

    const saveDocument = async () => {
        const { tabKey, form } = documentModal;
        const type = documentTypeMap[tabKey];
        const items = form.items.filter((item) => item.product_id).map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity || 0),
            notes: item.notes || null,
            unit_cost: item.unit_cost !== '' ? Number(item.unit_cost || 0) : null,
            stock_bucket: item.stock_bucket,
            direction: item.direction,
        })).filter((item) => item.product_id && item.quantity > 0);
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
                        base.stock_bucket = item.stock_bucket;
                        base.direction = item.direction;
                        if (item.unit_cost != null) base.unit_cost = item.unit_cost;
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
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể lưu phiếu kho.');
        } finally {
            setFlag('saving', false);
        }
    };

    const deleteDocument = async (tabKey, row) => {
        if (!window.confirm(`Xóa ${documentTitleMap[tabKey].toLowerCase()} ${row.document_number}?`)) return;
        try {
            await inventoryApi.deleteDocument(documentTypeMap[tabKey], row.id);
            showToast({ type: 'success', message: 'Đã xóa phiếu kho.' });
            if (tabKey === 'returns') fetchDocuments('return', returnPagination.current_page || 1);
            if (tabKey === 'damaged') fetchDocuments('damaged', damagedPagination.current_page || 1);
            if (tabKey === 'adjustments') fetchDocuments('adjustment', adjustmentPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu kho.');
        }
    };

    const deleteExport = async (row) => {
        if (!window.confirm(`Xóa đơn ${row.order_number}?`)) return;
        try {
            await orderApi.destroy(row.id);
            showToast({ type: 'success', message: 'Đã xóa phiếu xuất bán.' });
            fetchExports(exportPagination.current_page || 1);
            fetchProducts(productPagination.current_page || 1);
            fetchOverview();
            fetchLots(lotPagination.current_page || 1);
        } catch (error) {
            fail(error, 'Không thể xóa phiếu xuất bán.');
        }
    };

    const overviewItems = useMemo(() => {
        const summary = dashboard?.summary;
        if (!summary) return [];
        return [
            { label: 'Sản phẩm đang bán', value: formatNumber(summary.active_products) },
            { label: 'Tồn bán được', value: formatNumber(summary.total_units) },
            { label: 'Tồn hỏng', value: formatNumber(summary.damaged_units) },
            { label: 'Giá trị tồn', value: formatCurrency(summary.stock_value) },
            { label: 'Nhà cung cấp', value: formatNumber(summary.supplier_count) },
            { label: 'Nhập 30 ngày', value: formatCurrency(summary.imports_total) },
            { label: 'Trả hàng 30 ngày', value: formatCurrency(summary.returns_total) },
            { label: 'Hỏng 30 ngày', value: formatCurrency(summary.damaged_total) },
            { label: 'Lãi gộp 30 ngày', value: formatCurrency(summary.exports_profit) },
        ];
    }, [dashboard]);

    const productSummaryItems = useMemo(() => !productSummary ? [] : [
        { label: 'Tổng mã', value: formatNumber(productSummary.total_products) },
        { label: 'Tổng nhập', value: formatNumber(productSummary.total_imported) },
        { label: 'Tổng xuất bán', value: formatNumber(productSummary.total_exported) },
        { label: 'Tổng hoàn', value: formatNumber(productSummary.total_returned) },
        { label: 'Tổng hỏng', value: formatNumber(productSummary.total_damaged) },
        { label: 'Tồn bán được', value: formatNumber(productSummary.total_sellable_stock) },
        { label: 'Tồn hỏng', value: formatNumber(productSummary.total_damaged_stock) },
        { label: 'Tổng giá trị tồn', value: formatCurrency(productSummary.total_inventory_value) },
    ], [productSummary]);

    const supplierSummaryItems = useMemo(() => !supplierSummary ? [] : [
        { label: 'Tổng nhà cung cấp', value: formatNumber(supplierSummary.total_suppliers) },
        { label: 'Tổng phiếu nhập', value: formatNumber(supplierSummary.total_import_slips) },
        { label: 'Tổng số lượng nhập', value: formatNumber(supplierSummary.total_imported_quantity) },
        { label: 'Tổng tiền nhập', value: formatCurrency(supplierSummary.total_imported_amount) },
    ], [supplierSummary]);

    const supplierPriceSummaryItems = useMemo(() => {
        return [
            { label: 'Nhà cung cấp', value: currentSupplier?.name || 'Chưa chọn' },
            { label: 'Dòng đã chọn', value: formatNumber(selectedIds.length) },
            { label: 'Dòng đang hiển thị', value: formatNumber(visibleSupplierItemIds.length) },
            { label: 'Dòng đã nhập giá', value: formatNumber(Object.keys(priceDrafts).length) },
        ];
    }, [currentSupplier?.name, priceDrafts, selectedIds.length, visibleSupplierItemIds.length]);

    const supplierPriceSummaryCards = useMemo(() => {
        const itemRows = supplierRows.filter((row) => row.row_kind === 'item');
        const pricedRows = itemRows.filter((row) => Number(priceDrafts[row.id] ?? row.unit_cost ?? 0) > 0);
        return [
            { label: 'Nhà cung cấp', value: currentSupplier?.name || 'Chưa chọn' },
            { label: 'Mã đang hiển thị', value: formatNumber(itemRows.length) },
            { label: 'Đã có giá dự kiến', value: formatNumber(pricedRows.length) },
            { label: 'Chưa có giá', value: formatNumber(Math.max(itemRows.length - pricedRows.length, 0)) },
            { label: 'Đang chọn sửa nhanh', value: formatNumber(selectedIds.length) },
            { label: 'Tổng tiền nhập', value: formatCurrency(currentSupplier?.imported_amount_total || 0) },
        ];
    }, [currentSupplier?.imported_amount_total, currentSupplier?.name, priceDrafts, selectedIds.length, supplierRows]);

    const simpleSummaryMap = useMemo(() => ({
        imports: [
            { label: 'Tổng phiếu', value: formatNumber(importPagination.total) },
            { label: 'Số lượng trang', value: formatNumber(imports.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Tiền trang', value: formatCurrency(imports.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        exports: [
            { label: 'Tổng đơn', value: formatNumber(exportPagination.total) },
            { label: 'Doanh thu trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.total_price || 0), 0)) },
            { label: 'Giá vốn trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.cost_total || 0), 0)) },
            { label: 'Lãi gộp trang', value: formatCurrency(exportsData.reduce((sum, row) => sum + Number(row.profit_total || 0), 0)) },
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
            { label: 'Số lượng trang', value: formatNumber(adjustments.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0)) },
            { label: 'Giá trị trang', value: formatCurrency(adjustments.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)) },
        ],
        lots: [
            { label: 'Tổng lô', value: formatNumber(lotPagination.total) },
            { label: 'Tổng số lượng', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.quantity || 0), 0)) },
            { label: 'Còn lại', value: formatNumber(lots.reduce((sum, row) => sum + Number(row.remaining_quantity || 0), 0)) },
        ],
        trash: [
            { label: 'Tổng sản phẩm', value: formatNumber(trashPagination.total) },
            { label: 'Trang hiện tại', value: formatNumber(trashItems.length) },
        ],
    }), [adjustmentPagination.total, adjustments, damagedData, damagedPagination.total, exportPagination.total, exportsData, importPagination.total, imports, lotPagination.total, lots, returnPagination.total, returnsData, trashItems.length, trashPagination.total]);

    const productCell = (row, columnId) => {
        if (columnId === 'sku') return <CellText primary={row.sku} secondary={row.is_variant && row.parent_name ? `Thuộc: ${row.parent_name}` : null} mono />;
        if (columnId === 'name') return <CellText primary={row.name} secondary={row.category_name || 'Chưa phân loại'} />;
        if (columnId === 'expected_cost') return row.expected_cost != null ? formatCurrency(row.expected_cost) : '-';
        if (columnId === 'current_cost') return row.current_cost != null ? formatCurrency(row.current_cost) : '-';
        if (columnId === 'inventory_value') return formatCurrency(row.inventory_value);
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => navigate(`/admin/products/edit/${row.id}`)} className={ghostButton}>Sửa</button><button type="button" onClick={() => removeProduct(row.id)} className={dangerButton}>Xóa</button></div>;
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
                                            {formatCurrency(item.unit_cost)}
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
                            value={formatWholeNumberInput(groupPriceDrafts[row.id] ?? '')}
                            onChange={(event) => setGroupPriceDrafts((prev) => ({ ...prev, [row.id]: stripNumericValue(event.target.value) }))}
                            placeholder="Giá nhóm"
                            className="h-8 w-full rounded-sm border border-primary/15 px-2 text-right text-[13px] outline-none focus:border-primary"
                        />
                        <button type="button" onClick={() => applyGroupPrice(row.id)} className={ghostButton}>Áp nhóm</button>
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
        if (columnId === 'supplier_product_code') return (
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
                    className="h-8 w-full rounded-sm border border-primary/15 px-2 font-mono text-[12px] outline-none focus:border-primary"
                    placeholder="Nhập mã NCC"
                    title={row.supplier_product_code || ''}
                />
                {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
            </div>
        );
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
                {savingPriceIds[row.id] ? <span className="shrink-0 text-[11px] text-primary/45">Đang lưu...</span> : null}
            </div>
        );
        if (columnId === 'updated_at') return row.updated_at ? formatDateTime(row.updated_at) : '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => removeSupplierPrice(row)} disabled={!row.supplier_price_id} className={dangerButton}>{row.supplier_price_id ? 'Xóa' : 'Chưa có giá'}</button></div>;
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
                    <StatusPill label={status?.name || row.status || 'Chưa có trạng thái'} color={status?.color || '#94A3B8'} />
                    <div className="text-[11px] text-primary/45">
                        {row.entry_mode === 'invoice_ai' ? 'AI đọc hóa đơn' : 'Nhập tay'}
                    </div>
                </div>
            );
        }
        if (columnId === 'line_count') return formatNumber(row.items_count || 0);
        if (columnId === 'qty') return formatNumber(row.total_quantity || 0);
        if (columnId === 'amount') return formatCurrency(row.total_amount || 0);
        if (columnId === 'note') return <CellText primary={row.notes || '-'} />;
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => openEditImport(row)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteImport(row)} className={dangerButton}>Xóa</button></div>;
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
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => navigate(`/admin/orders/edit/${row.id}`)} className={ghostButton}>Sửa</button><button type="button" onClick={() => deleteExport(row)} className={dangerButton}>Xóa</button></div>;
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
        if (columnId === 'code') return <CellText primary={row.sku} mono />;
        if (columnId === 'product') return <CellText primary={row.name} />;
        if (columnId === 'date') return formatDateTime(row.deleted_at);
        if (columnId === 'price_status') return row.price_status || '-';
        if (columnId === 'actions') return <div className="flex items-center justify-center gap-2"><button type="button" onClick={() => restoreProduct(row.id)} className={ghostButton}>Khôi phục</button><button type="button" onClick={() => forceDeleteProduct(row.id)} className={dangerButton}>Xóa hẳn</button></div>;
        return '-';
    };

    const tabRows = { imports, exports: exportsData, returns: returnsData, damaged: damagedData, adjustments, lots, trash: trashItems };
    const tabPagination = { imports: importPagination, exports: exportPagination, returns: returnPagination, damaged: damagedPagination, adjustments: adjustmentPagination, lots: lotPagination, trash: trashPagination };
    const tabLoading = { imports: loading.imports, exports: loading.exports, returns: loading.returns, damaged: loading.damaged, adjustments: loading.adjustments, lots: loading.lots, trash: loading.trash };
    const tabFetch = { imports: fetchImports, exports: fetchExports, returns: (page) => fetchDocuments('return', page), damaged: (page) => fetchDocuments('damaged', page), adjustments: (page) => fetchDocuments('adjustment', page), lots: fetchLots, trash: fetchTrash };

    const renderSimpleTab = (tabKey) => {
        const filters = simpleFilters[tabKey];
        const isImportTab = tabKey === 'imports';
        const columns = isImportTab ? importColumns : tabKey === 'exports' ? exportColumns : tabKey === 'lots' ? lotColumns : tabKey === 'trash' ? trashColumns : documentColumns;
        const renderCell = isImportTab ? renderImportCell : tabKey === 'exports' ? renderExportCell : tabKey === 'lots' ? renderLotCell : tabKey === 'trash' ? renderTrashCell : (row, columnId) => renderDocumentCell(row, columnId, tabKey);
        const sortMap = ['returns', 'damaged', 'adjustments'].includes(tabKey) ? inventorySortColumnMaps.documents : inventorySortColumnMaps[tabKey];
        const extraActions = (
            <>
                {isImportTab ? (
                    <>
                        <button type="button" onClick={openImportStatusManager} className={ghostButton}>Trạng thái</button>
                        <button type="button" onClick={openCreateImport} className={primaryButton}>Tạo phiếu</button>
                    </>
                ) : null}
                {tabKey === 'exports' ? <button type="button" onClick={() => navigate('/admin/orders/new')} className={primaryButton}>Tạo phiếu</button> : null}
                {['returns', 'damaged', 'adjustments'].includes(tabKey) ? <button type="button" onClick={() => openCreateDocument(tabKey)} className={primaryButton}>Tạo phiếu</button> : null}
            </>
        );
        const filterPanel = openPanels[tabKey].filters ? (
            <FilterPanel actions={<button type="button" onClick={() => tabFetch[tabKey](1)} className={primaryButton}>Lọc</button>}>
                <input value={filters.search} onChange={(event) => setSimpleFilters((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], search: event.target.value } }))} placeholder="Tìm nhanh" className={`w-[240px] ${inputClass}`} />
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
                    </>
                ) : null}
            </FilterPanel>
        ) : null;

        return (
            <div className="space-y-3">
                <div className={panelClass}>
                    <PanelHeader
                        title={tabKey === 'imports' ? 'Danh sách phiếu nhập' : tabKey === 'exports' ? 'Danh sách phiếu xuất bán' : tabKey === 'lots' ? 'Danh sách lô hàng' : tabKey === 'trash' ? 'Thùng rác sản phẩm' : documentTitleMap[tabKey]}
                        toggles={[
                            { id: `${tabKey}_filters`, icon: 'filter_alt', label: 'Bộ lọc', active: openPanels[tabKey].filters, onClick: () => togglePanel(tabKey, 'filters') },
                            { id: `${tabKey}_stats`, icon: 'monitoring', label: 'Thống kê', active: openPanels[tabKey].stats, onClick: () => togglePanel(tabKey, 'stats') },
                            { id: `${tabKey}_columns`, icon: 'view_column', label: 'Cài đặt cột', active: openPanels[tabKey].columns, onClick: () => togglePanel(tabKey, 'columns') },
                        ]}
                        actions={extraActions}
                    />
                    {filterPanel}
                    {openPanels[tabKey].stats ? <SummaryPanel items={simpleSummaryMap[tabKey] || []} /> : null}
                    <InventoryTable storageKey={`inventory_${tabKey}_table_${inventoryTableStorageVersion}`} columns={columns} rows={tabRows[tabKey]} renderCell={renderCell} loading={tabLoading[tabKey]} pagination={tabPagination[tabKey]} onPageChange={tabFetch[tabKey]} footer={`Kết quả: ${formatNumber(tabPagination[tabKey].total)}`} settingsOpen={openPanels[tabKey].columns} onCloseSettings={() => togglePanel(tabKey, 'columns')} currentPerPage={pageSizes[tabKey]} onPerPageChange={(value) => {
                        const nextSize = updatePageSize(tabKey, value);
                        if (tabKey === 'returns') return fetchDocuments('return', 1, nextSize);
                        if (tabKey === 'damaged') return fetchDocuments('damaged', 1, nextSize);
                        if (tabKey === 'adjustments') return fetchDocuments('adjustment', 1, nextSize);
                        return tabFetch[tabKey](1, nextSize);
                    }} sortConfig={sortConfigs[tabKey]} onSort={(columnId) => handleTableSort(tabKey, columnId)} sortColumnMap={sortMap} />
                </div>
            </div>
        );
    };

    const suppliersTabContent = (
        <div className={panelClass}>
            <PanelHeader
                title="Quản lý nhà cung cấp"
                description="Chọn một nhà cung cấp rồi bấm Xem để mở tab giá nhập riêng."
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
                title={currentSupplier ? `Giá nhập - ${currentSupplier.name}` : 'Giá nhập từng nhà'}
                description={currentSupplier ? 'Mỗi nhà cung cấp có một bảng giá nhập riêng. Khi tạo phiếu nhập, giá sẽ tự đổ từ bảng này và vẫn có thể sửa tay.' : 'Chọn nhà cung cấp trong tab Nhà cung cấp hoặc đổi nhanh ngay tại đây để mở thư viện giá nhập.'}
                actions={
                    <>
                        <select
                            value={selectedSupplierId ? String(selectedSupplierId) : ''}
                            onChange={(event) => setSelectedSupplierId(event.target.value ? Number(event.target.value) : null)}
                            disabled={loading.suppliers && suppliers.length === 0}
                            className={`w-[220px] ${selectClass}`}
                        >
                            <option value="">{loading.suppliers ? 'Đang tải nhà cung cấp' : 'Chọn nhà cung cấp'}</option>
                            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                        </select>
                        <div className="relative w-[220px] min-w-[220px]">
                            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                            <input
                                value={supplierQuickSearch}
                                onChange={(event) => setSupplierQuickSearch(event.target.value)}
                                placeholder="Tìm SKU / tên / mã NCC"
                                disabled={!selectedSupplierId}
                                className={`w-full pl-9 ${inputClass}`}
                            />
                        </div>
                        <input value={formatWholeNumberInput(bulkPrice)} onChange={(event) => setBulkPrice(stripNumericValue(event.target.value))} placeholder="Giá áp chọn" disabled={!selectedSupplierId} className={`w-[125px] ${inputClass}`} />
                        <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!selectedSupplierId} className={ghostButton}>{showPasteBox ? 'Ẩn dán nhanh' : 'Dán nhanh'}</button>
                        <button type="button" onClick={applyBulkPrice} disabled={!selectedSupplierId || !selectedIds.length} className={ghostButton}>Áp giá chọn</button>
                        <button type="button" onClick={refreshSupplierCatalog} disabled={!selectedSupplierId || loading.supplierCatalog} className={ghostButton}><span className={`material-symbols-outlined text-[18px] ${loading.supplierCatalog ? 'animate-spin' : ''}`}>refresh</span>Làm mới</button>
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
                    <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option><option value="simple">Sản phẩm thường</option><option value="configurable">Sản phẩm có biến thể</option></select>
                    <select value={supplierCatalogFilters.variant_scope} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả biến thể</option><option value="no_variants">Sản phẩm thường</option><option value="only_variants">Biến thể</option><option value="has_variants">Nhóm có biến thể</option><option value="roots">Nhóm gốc</option></select>
                    <select value={supplierCatalogFilters.missing_supplier_price} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, missing_supplier_price: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả trạng thái giá</option><option value="1">Chưa có giá nhập</option></select>
                    <select value={supplierCatalogFilters.multiple_suppliers} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, multiple_suppliers: event.target.value }))} className={`w-[180px] ${selectClass}`}><option value="">Tất cả nguồn nhập</option><option value="1">Có nhiều nhà cung cấp</option></select>
                </FilterPanel>
            ) : null}
            {openPanels.supplierPrices.stats ? <SummaryPanel items={supplierPriceSummaryCards} /> : null}
            {showPasteBox ? <div className="border-b border-primary/10 px-3 py-2.5"><div className="mb-2 text-[12px] text-primary/55">Dán theo mẫu: `SKU TAB Giá` hoặc `SKU,Giá`</div><div className="flex gap-3"><textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} className="min-h-[88px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" placeholder={'SKU-01\t120000\nSKU-02\t150000'} /><button type="button" onClick={applyPaste} className={primaryButton}>Nhận giá</button></div></div> : null}
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
        () => suppliers.find((supplier) => String(supplier.id) === String(importModal.form.supplier_id))?.name || 'Tất cả sản phẩm',
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
        { key: 'imports', label: 'Phiếu nhập', icon: 'inventory_2', onClick: async () => { setCreateMenuOpen(false); await openCreateImport(); } },
        { key: 'exports', label: 'Phiếu xuất', icon: 'shopping_cart', onClick: () => { setCreateMenuOpen(false); navigate('/admin/orders/new'); } },
        { key: 'returns', label: 'Phiếu hoàn', icon: 'assignment_return', onClick: async () => { setCreateMenuOpen(false); setActiveTab('returns'); await openCreateDocument('returns'); } },
        { key: 'damaged', label: 'Phiếu hỏng', icon: 'broken_image', onClick: async () => { setCreateMenuOpen(false); setActiveTab('damaged'); await openCreateDocument('damaged'); } },
        { key: 'adjustments', label: 'Phiếu điều chỉnh', icon: 'tune', onClick: async () => { setCreateMenuOpen(false); setActiveTab('adjustments'); await openCreateDocument('adjustments'); } },
    ];
    const documentWorkspace = isDocumentTab(activeTab) ? (
        <div className="space-y-3">
            <div className={`${panelClass} p-2`}>
                <div className="flex flex-wrap gap-2">
                    {documentTabs.map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActiveTab(key)}
                            className={`h-10 shrink-0 rounded-sm border px-4 text-[12px] font-black transition ${activeTab === key ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/[0.03]'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {renderSimpleTab(activeTab)}
        </div>
    ) : null;

    return (
        <div className="space-y-4 px-5 pb-6 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[16px] font-black uppercase tracking-[0.18em] text-primary">Quản lý kho</div>
                <div className="relative flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setCreateMenuOpen((prev) => !prev)} className={primaryButton}>
                        <span className="material-symbols-outlined text-[18px]">add</span>
                        Tạo phiếu
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
                        const selected = key === 'documents' ? isDocumentTab(activeTab) : activeTab === key;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => {
                                    setCreateMenuOpen(false);
                                    if (key === 'documents') {
                                        setActiveTab(isDocumentTab(activeTab) ? activeTab : 'imports');
                                        return;
                                    }
                                    setActiveTab(key);
                                }}
                                className={`h-10 shrink-0 rounded-sm border px-4 text-[12px] font-black transition ${selected ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary/35 hover:bg-primary/[0.03]'}`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {activeTab === 'overview' ? <div className={panelClass}><PanelHeader title="Tổng quan kho" toggles={[{ id: 'overview_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.overview.stats, onClick: () => togglePanel('overview', 'stats') }]} />{openPanels.overview.stats ? <SummaryPanel items={overviewItems} /> : null}</div> : null}
            {activeTab === 'products' ? <div className={panelClass}><PanelHeader title="Sản phẩm kho" toggles={[{ id: 'products_filters', icon: 'filter_alt', label: 'Bộ lọc', active: openPanels.products.filters, onClick: () => togglePanel('products', 'filters') }, { id: 'products_stats', icon: 'monitoring', label: 'Thống kê', active: openPanels.products.stats, onClick: () => togglePanel('products', 'stats') }, { id: 'products_columns', icon: 'view_column', label: 'Cài đặt cột', active: openPanels.products.columns, onClick: () => togglePanel('products', 'columns') }]} actions={<button type="button" onClick={() => navigate('/admin/products/new')} className={primaryButton}>Tạo sản phẩm</button>} />{openPanels.products.filters ? <FilterPanel actions={<button type="button" onClick={() => fetchProducts(1)} className={primaryButton}>Lọc</button>}><input value={productFilters.search} onChange={(event) => setProductFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Tìm mã hoặc tên" className={`w-[220px] ${inputClass}`} /><select value={productFilters.status} onChange={(event) => setProductFilters((prev) => ({ ...prev, status: event.target.value }))} className={`w-[150px] ${selectClass}`}><option value="">Tất cả trạng thái bán</option><option value="active">Đang bán</option><option value="inactive">Ngừng bán</option></select><select value={productFilters.cost_source} onChange={(event) => setProductFilters((prev) => ({ ...prev, cost_source: event.target.value }))} className={`w-[170px] ${selectClass}`}><option value="">Tất cả trạng thái giá</option><option value="actual">Đang dùng giá vốn</option><option value="expected">Đang dùng giá dự kiến</option><option value="empty">Chưa có giá</option></select><select value={productFilters.type} onChange={(event) => setProductFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option><option value="simple">Sản phẩm thường</option><option value="configurable">Sản phẩm có biến thể</option></select><select value={productFilters.category_id} onChange={(event) => setProductFilters((prev) => ({ ...prev, category_id: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Tất cả danh mục</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={productFilters.variant_scope} onChange={(event) => setProductFilters((prev) => ({ ...prev, variant_scope: event.target.value }))} className={`w-[165px] ${selectClass}`}><option value="">Có biến thể / không</option><option value="has_variants">Có biến thể</option><option value="no_variants">Không có biến thể</option><option value="only_variants">Chỉ biến thể con</option><option value="roots">Chỉ sản phẩm gốc</option></select><input type="date" value={productFilters.date_from} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_from: event.target.value }))} className={`w-[145px] ${inputClass}`} /><input type="date" value={productFilters.date_to} onChange={(event) => setProductFilters((prev) => ({ ...prev, date_to: event.target.value }))} className={`w-[145px] ${inputClass}`} /></FilterPanel> : null}{openPanels.products.stats ? <SummaryPanel items={productSummaryItems} /> : null}<InventoryTable storageKey={`inventory_products_table_${inventoryTableStorageVersion}`} columns={productColumns} rows={products} renderCell={productCell} loading={loading.products} pagination={productPagination} onPageChange={fetchProducts} footer={`Kết quả: ${formatNumber(productPagination.total)} mã`} settingsOpen={openPanels.products.columns} onCloseSettings={() => togglePanel('products', 'columns')} currentPerPage={pageSizes.products} onPerPageChange={(value) => fetchProducts(1, updatePageSize('products', value))} sortConfig={sortConfigs.products} onSort={(columnId) => handleTableSort('products', columnId)} sortColumnMap={inventorySortColumnMaps.products} /></div> : null}
            {activeTab === 'suppliers' ? suppliersTabContent : null}
            {activeTab === 'supplierPrices' ? supplierPricesTabContent : null}
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
                                            disabled={!selectedSupplierId}
                                            className={`w-full pl-9 ${inputClass}`}
                                        />
                                    </div>
                                    <input value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value.replace(/[^0-9]/g, ''))} placeholder="Giá áp chọn" disabled={!selectedSupplierId} className={`w-[125px] ${inputClass}`} />
                                    <button type="button" onClick={() => setShowPasteBox((value) => !value)} disabled={!selectedSupplierId} className={ghostButton}>{showPasteBox ? 'Ẩn dán nhanh' : 'Dán nhanh'}</button>
                                    <button type="button" onClick={applyBulkPrice} disabled={!selectedSupplierId || !selectedIds.length} className={ghostButton}>Áp giá chọn</button>
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
                                <select value={supplierCatalogFilters.type} onChange={(event) => setSupplierCatalogFilters((prev) => ({ ...prev, type: event.target.value }))} className={`w-[160px] ${selectClass}`}><option value="">Tất cả loại sản phẩm</option><option value="simple">Sản phẩm thường</option><option value="configurable">Sản phẩm có biến thể</option></select>
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
            <ModalShell open={supplierModal.open} title={supplierModal.form.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={() => setSupplierModal({ open: false, form: createSupplierForm() })} maxWidth="max-w-3xl" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setSupplierModal({ open: false, form: createSupplierForm() })} className={ghostButton}>Hủy</button><button type="button" onClick={saveSupplier} className={primaryButton} disabled={loading.supplierModal}>{loading.supplierModal ? 'Đang lưu' : 'Lưu nhà cung cấp'}</button></div>}><div className="grid gap-3 md:grid-cols-2"><input value={supplierModal.form.code} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, code: event.target.value } }))} placeholder="Mã nhà cung cấp" className={inputClass} /><input value={supplierModal.form.name} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, name: event.target.value } }))} placeholder="Tên nhà cung cấp" className={inputClass} /><input value={supplierModal.form.phone} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, phone: event.target.value } }))} placeholder="Số điện thoại" className={inputClass} /><input value={supplierModal.form.email} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, email: event.target.value } }))} placeholder="Email" className={inputClass} /><input value={supplierModal.form.address} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, address: event.target.value } }))} placeholder="Địa chỉ" className={`md:col-span-2 ${inputClass}`} /><textarea value={supplierModal.form.notes} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú" className="min-h-[120px] rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary md:col-span-2" /><label className="inline-flex items-center gap-2 text-[13px] font-semibold text-primary"><input type="checkbox" checked={supplierModal.form.status} onChange={(event) => setSupplierModal((prev) => ({ ...prev, form: { ...prev.form, status: event.target.checked } }))} className="size-4 accent-primary" />Đang sử dụng</label></div></ModalShell>
            <ModalShell
                open={importModal.open}
                title={importModal.form.id ? 'Sửa phiếu nhập' : 'Tạo phiếu nhập'}
                onClose={closeImportModal}
                closeOnBackdrop={false}
                maxWidth="max-w-[1640px]"
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
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Nhà cung cấp</div>
                            <select value={importModal.form.supplier_id} onChange={(event) => handleImportSupplierChange(event.target.value)} className={`w-full ${importSelectClass} h-11`}>
                                <option value="">Tất cả sản phẩm</option>
                                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Trạng thái</div>
                            <div className="relative">
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
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Ngày nhập</div>
                            <input type="date" value={importModal.form.import_date} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, import_date: event.target.value } }))} className={`w-full ${importFieldClass} h-11`} />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Số hóa đơn</div>
                            <input value={importModal.form.invoice_number || ''} onChange={(event) => setImportModal((prev) => ({ ...prev, form: { ...prev.form, invoice_number: event.target.value } }))} className={`w-full ${importFieldClass} h-11`} placeholder="Nhập số hóa đơn (nếu có)" />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelHiddenClass}>Đính kèm</div>
                            <label className={importActionButtonClass}>
                                <input type="file" multiple className="hidden" onChange={(event) => addImportAttachmentFiles(event.target.files)} />
                                <span className="material-symbols-outlined text-[18px]">attach_file</span>
                                Đính kèm hóa đơn / chứng từ{(importModal.form.attachments || []).length + (importModal.form.local_attachment_files || []).length > 0 ? ` (${(importModal.form.attachments || []).length + (importModal.form.local_attachment_files || []).length})` : ''}
                            </label>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelHiddenClass}>Bản nháp</div>
                            <label className={importActionButtonClass}>
                                <input type="file" accept=".pdf,image/*,.heic,.heif" className="hidden" onChange={(event) => analyzeInvoiceFile(event.target.files?.[0])} />
                                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                {loading.invoiceAnalysis ? 'Đang đọc ảnh / PDF' : 'Tạo bản nháp từ hóa đơn'}
                            </label>
                        </div>
                    </div>

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

                    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Tìm nhanh sản phẩm</div>
                            <ImportProductQuickSearch
                                supplierId={importModal.form.supplier_id ? Number(importModal.form.supplier_id) : null}
                                onSelect={appendImportProductFromQuickSearch}
                                placeholder={importModal.form.supplier_id ? 'Tìm tên, mã SP, mã NCC hoặc từ khóa của nhà cung cấp đã chọn' : 'Tìm tên, mã SP, mã NCC hoặc từ khóa trong toàn bộ sản phẩm'}
                            />
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Giá nhập dự kiến</div>
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
                                <span className="leading-tight">Đồng bộ lại giá nhập dự kiến</span>
                            </label>
                        </div>

                        <div className="min-w-0">
                            <div className={importFieldLabelClass}>Dữ liệu</div>
                            <button
                                type="button"
                                onClick={refreshImportItemPricing}
                                disabled={loading.importPriceRefresh || !importModal.form.items.some((item) => Number(item.product_id || 0) > 0)}
                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-bold text-primary transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading.importPriceRefresh ? 'animate-spin' : ''}`}>refresh</span>
                                Làm mới
                            </button>
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
                                placeholder="+100.000 hoặc -100.000"
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
                                placeholder="+10 hoặc -10"
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
                title="In phiếu nhập"
                onClose={() => setImportPrintModalOpen(false)}
                maxWidth="max-w-[1180px]"
                footer={(
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-[12px] font-semibold text-primary/65">
                            {formatNumber(importPrintableItems.length)} dòng sản phẩm • {formatNumber(importPrintSelectedColumns.length)} cột in
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setImportPrintModalOpen(false)} className={ghostButton}>Đóng</button>
                            <button type="button" onClick={() => saveImportPrintTemplate('update')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                {importPrintSettingsSaving ? 'Đang lưu' : 'Lưu mẫu hiện tại'}
                            </button>
                            <button type="button" onClick={() => saveImportPrintTemplate('new')} className={ghostButton} disabled={importPrintSettingsSaving}>
                                Lưu thành mẫu mới
                            </button>
                            <button type="button" onClick={printImportSheet} className={primaryButton}>
                                <span className="material-symbols-outlined text-[18px]">print</span>
                                In theo mẫu đang chọn
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
                                    <div>Nhà cung cấp: <span className="font-bold text-primary">{importPrintSupplierName}</span></div>
                                    <div className="mt-1">Ngày giờ preview: <span className="font-bold text-primary">{formatDateTime(importPrintPreviewPrintedAt)}</span></div>
                                    {importPrintSettingsLoading ? <div className="mt-1 text-primary/55">Đang tải mẫu in đã lưu...</div> : null}
                                </div>
                            </div>
                        </div>

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
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-[#f8fafc] px-4 py-3">
                            <div>
                                <div className="text-[13px] font-black text-primary">Xem trước bản in</div>
                                <div className="text-[12px] text-primary/55">Tối ưu cho khổ giấy A4, tự chuyển ngang khi số cột quá nhiều.</div>
                            </div>
                            <div className="text-right text-[12px] text-primary/60">
                                <div>{formatNumber(importPrintableItems.length)} dòng sản phẩm</div>
                                <div>{formatCurrency(importLineTotal)} tổng tiền đơn</div>
                            </div>
                        </div>

                        <iframe
                            title="Xem trước in phiếu nhập"
                            srcDoc={importPrintPreviewHtml}
                            className="h-[62vh] w-full rounded-sm border border-primary/10 bg-white"
                        />
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
            <ModalShell open={documentModal.open} title={documentModal.form.id ? `Sửa ${documentTitleMap[documentModal.tabKey]}` : `Tạo ${documentTitleMap[documentModal.tabKey]}`} onClose={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} footer={<div className="flex items-center justify-between gap-3"><div className="text-[13px] font-black text-primary">{documentModal.tabKey === 'damaged' ? `Tổng số lượng: ${formatNumber(documentModal.form.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}` : `Tổng giá trị tạm tính: ${formatCurrency(documentLineTotal)}`}</div><div className="flex gap-2"><button type="button" onClick={() => setDocumentModal({ open: false, tabKey: 'returns', form: createDocumentForm('returns') })} className={ghostButton}>Hủy</button><button type="button" onClick={saveDocument} className={primaryButton} disabled={loading.saving}>{loading.saving ? 'Đang lưu' : 'Lưu phiếu'}</button></div></div>}><div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><input type="date" value={documentModal.form.document_date} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, document_date: event.target.value } }))} className={inputClass} /><select value={documentModal.form.supplier_id} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, supplier_id: event.target.value } }))} className={selectClass}><option value="">Không gắn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><div className="flex items-center rounded-sm border border-primary/15 px-3 text-[13px] font-semibold text-primary">{documentTitleMap[documentModal.tabKey]}</div></div><ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => { const index = documentModal.form.items.findIndex((item) => !item.product_id); const targetIndex = index >= 0 ? index : documentModal.form.items.length; if (index < 0) addLine(setDocumentModal); attachProductToLine(setDocumentModal, targetIndex, product); }} buttonLabel="Thêm vào phiếu" /><div className="overflow-hidden rounded-sm border border-primary/10"><table className="w-full border-collapse"><thead className="bg-[#f6f9fc]"><tr>{['Sản phẩm', 'Số lượng', documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? 'Giá vốn' : null, documentModal.tabKey === 'adjustments' ? 'Loại tồn' : null, documentModal.tabKey === 'adjustments' ? 'Hướng' : null, 'Ghi chú', 'Xóa'].filter(Boolean).map((label) => <th key={label} className="border-b border-r border-primary/10 px-3 py-2.5 text-center text-[12px] font-bold text-primary">{label}</th>)}</tr></thead><tbody>{documentModal.form.items.map((item, index) => <tr key={item.key}><td className="border-b border-r border-primary/10 px-3 py-2"><div className="space-y-2">{item.product_id ? <CellText primary={item.product_name || '-'} secondary={item.product_sku || '-'} /> : <div className="text-[12px] text-primary/45">Chưa chọn sản phẩm</div>}<ProductLookupInput supplierId={documentModal.form.supplier_id ? Number(documentModal.form.supplier_id) : null} onSelect={(product) => attachProductToLine(setDocumentModal, index, product)} placeholder="Đổi sản phẩm" buttonLabel="Chọn" /></div></td><td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.quantity} onChange={(event) => updateLine(setDocumentModal, index, 'quantity', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td>{documentModal.tabKey === 'returns' || documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.unit_cost} onChange={(event) => updateLine(setDocumentModal, index, 'unit_cost', event.target.value.replace(/[^0-9]/g, ''))} className={`w-full ${inputClass}`} /></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.stock_bucket} onChange={(event) => updateLine(setDocumentModal, index, 'stock_bucket', event.target.value)} className={`w-full ${selectClass}`}><option value="sellable">Tồn bán được</option><option value="damaged">Tồn hỏng</option></select></td> : null}{documentModal.tabKey === 'adjustments' ? <td className="border-b border-r border-primary/10 px-3 py-2"><select value={item.direction} onChange={(event) => updateLine(setDocumentModal, index, 'direction', event.target.value)} className={`w-full ${selectClass}`}><option value="in">Cộng</option><option value="out">Trừ</option></select></td> : null}<td className="border-b border-r border-primary/10 px-3 py-2"><input value={item.notes} onChange={(event) => updateLine(setDocumentModal, index, 'notes', event.target.value)} className={`w-full ${inputClass}`} placeholder="Ghi chú" /></td><td className="border-b border-primary/10 px-3 py-2 text-center"><button type="button" onClick={() => removeLine(setDocumentModal, index)} className={dangerButton}>Xóa</button></td></tr>)}</tbody></table></div><div className="flex justify-between gap-2"><button type="button" onClick={() => addLine(setDocumentModal)} className={ghostButton}>Thêm dòng</button><textarea value={documentModal.form.notes} onChange={(event) => setDocumentModal((prev) => ({ ...prev, form: { ...prev.form, notes: event.target.value } }))} placeholder="Ghi chú phiếu kho" className="min-h-[96px] flex-1 rounded-sm border border-primary/15 p-3 text-[13px] outline-none focus:border-primary" /></div></div></ModalShell>
        </div>
    );
};

export default InventoryMovement;

